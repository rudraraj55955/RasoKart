import { Router } from "express";
import { db, callbackLogsTable, qrCodesTable, apiKeysTable, merchantsTable, transactionsTable, qrPaymentEventsTable, webhooksTable, callbackLogAttemptsTable, systemSettingsTable, credentialEventsTable } from "@workspace/db";
import { eq, and, count, countDistinct, sql, gte, lte, isNull, like, asc, desc } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { requireApiKey, verifyCallbackSignature } from "../middlewares/callbackAuth";
import { logger } from "../lib/logger";
import { fireCallback, scheduleCallbackRetry } from "../helpers/callbackRetry";

const router = Router();

// POST /api/callbacks — authenticated via X-Api-Key header (merchant API key)
// If the merchant has configured a callbackSecret, X-Signature is also required.
// Called by payment providers or merchant back-end to mark a QR as "used" on payment receipt
router.post("/", requireApiKey, verifyCallbackSignature, async (req, res) => {
  const merchantId: number = (req as any).callbackMerchantId;
  const signatureVerified: boolean | null = (req as any).signatureVerified;

  // --- Input validation ---
  const { orderId, merchantReference, amount, transactionId } = req.body as {
    orderId?: string;
    merchantReference?: string;
    amount?: string;
    transactionId?: number;
  };

  if (!orderId && !merchantReference) {
    res.status(400).json({ error: "orderId or merchantReference is required" });
    return;
  }

  // --- Deterministic QR matching: orderId takes priority over merchantReference ---
  let qr: typeof qrCodesTable.$inferSelect | undefined;

  if (orderId) {
    const [match] = await db
      .select()
      .from(qrCodesTable)
      .where(and(
        eq(qrCodesTable.merchantId, merchantId),
        eq(qrCodesTable.orderId, orderId),
        eq(qrCodesTable.status, "active"),
      ))
      .limit(1);
    qr = match;
  } else {
    const [match] = await db
      .select()
      .from(qrCodesTable)
      .where(and(
        eq(qrCodesTable.merchantId, merchantId),
        eq(qrCodesTable.merchantReference, merchantReference!),
        eq(qrCodesTable.status, "active"),
      ))
      .limit(1);
    qr = match;
  }

  if (!qr) {
    res.status(404).json({ error: "No active QR code found matching the provided identifiers" });
    return;
  }

  // --- Mark the QR code as used ---
  await db
    .update(qrCodesTable)
    .set({ status: "used" })
    .where(eq(qrCodesTable.id, qr.id));

  // --- Link the transaction to this QR code (if transactionId was provided) ---
  if (transactionId) {
    db.update(transactionsTable)
      .set({ qrCodeId: qr.id })
      .where(and(eq(transactionsTable.id, transactionId), eq(transactionsTable.merchantId, merchantId)))
      .catch(() => {});
  }

  // --- Always record a payment-received event (independent of webhook delivery) ---
  db.insert(qrPaymentEventsTable).values({
    qrCodeId: qr.id,
    merchantId: qr.merchantId,
    transactionId: transactionId ?? null,
    amount: amount ?? qr.amount ?? null,
    orderId: qr.orderId ?? orderId ?? null,
    merchantReference: qr.merchantReference ?? merchantReference ?? null,
  }).catch((err: unknown) => {
    logger.warn({ err, qrCodeId: qr!.id }, "Failed to insert qr_payment_event");
  });

  // --- Update API key lastUsedAt (fire-and-forget) ---
  const apiKeyId: number = (req as any).callbackApiKeyId;
  db.update(apiKeysTable)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeysTable.id, apiKeyId))
    .catch(() => {});

  // --- Fire the QR's callbackUrl if set (async, non-blocking) — webhook delivery only ---
  if (qr.callbackUrl) {
    const payload = {
      event: "payment.received",
      qrCodeId: qr.id,
      merchantId: qr.merchantId,
      orderId: qr.orderId ?? orderId,
      merchantReference: qr.merchantReference ?? merchantReference,
      amount: amount ?? qr.amount,
      transactionId: transactionId ?? null,
      status: "used",
    };
    const bodyStr = JSON.stringify(payload);
    const capturedQr = qr;
    const capturedSignatureVerified = signatureVerified;

    (async () => {
      const now = new Date();

      // Look up the merchant's webhook maxRetries so the initial schedule
      // respects the same cap used by processPendingRetries for later retries.
      const [webhookRow] = await db
        .select({ maxRetries: webhooksTable.maxRetries })
        .from(webhooksTable)
        .where(eq(webhooksTable.merchantId, capturedQr.merchantId))
        .limit(1);
      const merchantMaxRetries = webhookRow?.maxRetries ?? undefined;

      const { ok, httpStatus, responseBody } = await fireCallback(capturedQr.callbackUrl!, bodyStr);

      if (ok) {
        await db.insert(callbackLogsTable).values({
          merchantId: capturedQr.merchantId,
          qrCodeId: capturedQr.id,
          transactionId: transactionId ?? null,
          url: capturedQr.callbackUrl!,
          status: "success",
          httpStatus,
          requestBody: bodyStr,
          responseBody,
          attempts: 1,
          lastAttemptAt: now,
          signatureVerified: capturedSignatureVerified,
        });
      } else {
        logger.warn({ httpStatus, url: capturedQr.callbackUrl }, "QR callbackUrl fire failed — scheduling retries");

        const [inserted] = await db.insert(callbackLogsTable).values({
          merchantId: capturedQr.merchantId,
          qrCodeId: capturedQr.id,
          transactionId: transactionId ?? null,
          url: capturedQr.callbackUrl!,
          status: "pending_retry",
          httpStatus,
          requestBody: bodyStr,
          responseBody,
          attempts: 1,
          lastAttemptAt: now,
          signatureVerified: capturedSignatureVerified,
        }).returning({ id: callbackLogsTable.id });

        if (inserted) {
          await scheduleCallbackRetry(inserted.id, 1, merchantMaxRetries);
        }
      }
    })().catch((err: unknown) => {
      logger.warn({ err, url: capturedQr.callbackUrl }, "QR callbackUrl fire error");
    });
  }

  res.json({
    success: true,
    qrCodeId: qr.id,
    status: "used",
    callbackFired: !!qr.callbackUrl,
  });
});

// Authenticated routes below
router.use(requireAuth);

// GET /api/callbacks/stats — signature failure stats for the authenticated merchant
router.get("/stats", async (req, res) => {
  const user = (req as any).user;
  if (user.role !== "merchant") {
    res.status(403).json({ error: "Merchant access only" });
    return;
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [{ total }] = await db
    .select({ total: count() })
    .from(callbackLogsTable)
    .where(
      and(
        eq(callbackLogsTable.merchantId, user.merchantId),
        eq(callbackLogsTable.signatureVerified, false),
        gte(callbackLogsTable.createdAt, since),
      )
    );

  res.json({ signatureFailures24h: total });
});

// GET /api/callbacks/admin/stats — aggregate signature failure stats across all merchants (admin only)
router.get("/admin/stats", requireAdmin, async (req, res) => {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [row, thresholdRow, windowRow] = await Promise.all([
    db
      .select({
        signatureFailures24h: count(),
        affectedMerchants: countDistinct(callbackLogsTable.merchantId),
      })
      .from(callbackLogsTable)
      .where(
        and(
          eq(callbackLogsTable.signatureVerified, false),
          gte(callbackLogsTable.createdAt, since),
        )
      )
      .then(r => r[0]),
    db
      .select({ value: systemSettingsTable.value })
      .from(systemSettingsTable)
      .where(eq(systemSettingsTable.key, "signature_failure_alert_threshold"))
      .limit(1)
      .then(r => r[0]),
    db
      .select({ value: systemSettingsTable.value })
      .from(systemSettingsTable)
      .where(eq(systemSettingsTable.key, "signature_failure_alert_window_hours"))
      .limit(1)
      .then(r => r[0]),
  ]);

  const alertThreshold = thresholdRow?.value ? parseInt(thresholdRow.value, 10) : 10;
  const alertWindowHours = windowRow?.value ? parseFloat(windowRow.value) : 1;

  res.json({
    signatureFailures24h: row?.signatureFailures24h ?? 0,
    affectedMerchants: row?.affectedMerchants ?? 0,
    alertThreshold: isNaN(alertThreshold) ? 10 : alertThreshold,
    alertWindowHours: isNaN(alertWindowHours) ? 1 : alertWindowHours,
  });
});

// GET /api/callbacks/secret — returns callback secret status for the authenticated merchant
router.get("/secret", async (req, res) => {
  const user = (req as any).user;
  if (user.role !== "merchant") {
    res.status(403).json({ error: "Merchant access only" });
    return;
  }

  const [[merchant], [webhook]] = await Promise.all([
    db
      .select({
        callbackSecret: merchantsTable.callbackSecret,
      })
      .from(merchantsTable)
      .where(eq(merchantsTable.id, user.merchantId))
      .limit(1),
    db
      .select({ secretRotatedAt: webhooksTable.secretRotatedAt })
      .from(webhooksTable)
      .where(eq(webhooksTable.merchantId, user.merchantId))
      .limit(1),
  ]);

  if (!merchant) {
    res.status(404).json({ error: "Merchant not found" });
    return;
  }

  const secret = merchant.callbackSecret;
  const lastRotatedAt = webhook?.secretRotatedAt?.toISOString() ?? null;

  res.json({
    isSet: !!secret,
    secretPrefix: secret ? secret.slice(0, 8) + "..." : null,
    lastRotatedAt,
  });
});

// GET /api/callbacks/secret/history — credential event history for callback secret
router.get("/secret/history", async (req, res) => {
  const user = (req as any).user;
  if (user.role !== "merchant") {
    res.status(403).json({ error: "Merchant access only" });
    return;
  }

  const [merchant] = await db
    .select({
      callbackSecret: merchantsTable.callbackSecret,
      callbackSecretUpdatedAt: merchantsTable.callbackSecretUpdatedAt,
    })
    .from(merchantsTable)
    .where(eq(merchantsTable.id, user.merchantId))
    .limit(1);

  if (!merchant) {
    res.status(404).json({ error: "Merchant not found" });
    return;
  }

  const events: Array<{
    type: string;
    occurredAt: string;
    keyPrefix: string | null;
    description: string;
    isRevoked: boolean;
  }> = [];

  if (merchant.callbackSecretUpdatedAt) {
    events.push({
      type: "secret_rotated",
      occurredAt: merchant.callbackSecretUpdatedAt.toISOString(),
      keyPrefix: merchant.callbackSecret ? merchant.callbackSecret.slice(0, 8) + "..." : null,
      description: "Callback signing secret rotated",
      isRevoked: false,
    });
  }

  res.json({ data: events });
});

// POST /api/callbacks/secret/rotate — generate and store a new callback secret
router.post("/secret/rotate", async (req, res) => {
  const user = (req as any).user;
  if (user.role !== "merchant") {
    res.status(403).json({ error: "Merchant access only" });
    return;
  }

  const { randomBytes } = await import("crypto");
  const newSecret = randomBytes(32).toString("hex");

  const now = new Date();
  const rotateIp = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
    ?? req.socket.remoteAddress
    ?? "";

  await Promise.all([
    db
      .update(merchantsTable)
      .set({ callbackSecret: newSecret, callbackSecretUpdatedAt: now, updatedAt: now })
      .where(eq(merchantsTable.id, user.merchantId)),
    db
      .update(webhooksTable)
      .set({ secretRotatedAt: now })
      .where(eq(webhooksTable.merchantId, user.merchantId)),
    db.insert(credentialEventsTable).values({
      merchantId: user.merchantId,
      eventType: "callback_secret_rotated",
      actorId: user.id,
      actorEmail: user.email,
      keyPrefix: null,
      ipAddress: rotateIp || null,
    }),
  ]);

  req.log.info({ merchantId: user.merchantId }, "Callback secret rotated");

  res.json({ secret: newSecret });
});

// POST /api/callbacks/:id/retry — admin only
router.post("/:id/retry", requireAdmin, async (req, res) => {
  const id = parseInt(req.params['id'] as string);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid callback log ID" });
    return;
  }

  const [log] = await db
    .select({ id: callbackLogsTable.id, status: callbackLogsTable.status })
    .from(callbackLogsTable)
    .where(eq(callbackLogsTable.id, id))
    .limit(1);

  if (!log) {
    res.status(404).json({ error: "Callback log not found" });
    return;
  }

  if (log.status !== "failed") {
    res.status(400).json({ error: `Cannot retry a callback in '${log.status}' status — only 'failed' logs can be retried` });
    return;
  }

  const now = new Date();
  await db
    .update(callbackLogsTable)
    .set({ status: "pending_retry", attempts: 0, nextRetryAt: now })
    .where(eq(callbackLogsTable.id, id));

  await scheduleCallbackRetry(id, 0);

  req.log.info({ callbackLogId: id }, "Admin manually triggered callback retry");

  res.json({ success: true, id });
});

const REJECTION_REASON_PATTERNS: Record<string, string> = {
  stale_timestamp: "%outside the allowed window%",
  replay_detected: "%replay detected%",
  bad_signature: "%Invalid X-Signature%",
  missing_header: "%header is required%",
};

// GET /api/callbacks/:id/attempts — per-attempt delivery history
router.get("/:id/attempts", async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params['id'] as string);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid callback log ID" });
    return;
  }

  const [log] = await db
    .select({ id: callbackLogsTable.id, merchantId: callbackLogsTable.merchantId })
    .from(callbackLogsTable)
    .where(eq(callbackLogsTable.id, id))
    .limit(1);

  if (!log) {
    res.status(404).json({ error: "Callback log not found" });
    return;
  }

  if (user.role !== "admin" && log.merchantId !== user.merchantId) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  const attempts = await db
    .select()
    .from(callbackLogAttemptsTable)
    .where(eq(callbackLogAttemptsTable.callbackLogId, id))
    .orderBy(asc(callbackLogAttemptsTable.attemptNumber));

  res.json({ data: attempts });
});

// GET /api/callbacks
router.get("/", async (req, res) => {
  const user = (req as any).user;
  const { status, qrCodeId, signatureVerified, rejectionReason, eventType, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  if (user.role !== "admin") conditions.push(eq(callbackLogsTable.merchantId, user.merchantId!));
  if (status && status !== "all") conditions.push(eq(callbackLogsTable.status, status));
  if (qrCodeId) conditions.push(eq(callbackLogsTable.qrCodeId, parseInt(qrCodeId)));
  if (signatureVerified === "verified") conditions.push(eq(callbackLogsTable.signatureVerified, true));
  else if (signatureVerified === "failed") conditions.push(eq(callbackLogsTable.signatureVerified, false));
  else if (signatureVerified === "none") conditions.push(isNull(callbackLogsTable.signatureVerified));
  if (rejectionReason && REJECTION_REASON_PATTERNS[rejectionReason]) {
    conditions.push(like(callbackLogsTable.responseBody, REJECTION_REASON_PATTERNS[rejectionReason]));
  }
  if (eventType) conditions.push(eq(callbackLogsTable.eventType, eventType));

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [{ total }] = await db.select({ total: count() }).from(callbackLogsTable).where(where);
  const rows = await db
    .select({
      id: callbackLogsTable.id,
      merchantId: callbackLogsTable.merchantId,
      qrCodeId: callbackLogsTable.qrCodeId,
      transactionId: callbackLogsTable.transactionId,
      url: callbackLogsTable.url,
      status: callbackLogsTable.status,
      httpStatus: callbackLogsTable.httpStatus,
      requestBody: callbackLogsTable.requestBody,
      responseBody: callbackLogsTable.responseBody,
      attempts: callbackLogsTable.attempts,
      nextRetryAt: callbackLogsTable.nextRetryAt,
      lastAttemptAt: callbackLogsTable.lastAttemptAt,
      eventType: callbackLogsTable.eventType,
      signatureVerified: callbackLogsTable.signatureVerified,
      isTest: callbackLogsTable.isTest,
      createdAt: callbackLogsTable.createdAt,
      merchantName: merchantsTable.businessName,
      maxRetries: webhooksTable.maxRetries,
    })
    .from(callbackLogsTable)
    .leftJoin(merchantsTable, eq(callbackLogsTable.merchantId, merchantsTable.id))
    .leftJoin(webhooksTable, eq(callbackLogsTable.merchantId, webhooksTable.merchantId))
    .where(where)
    .limit(limitNum)
    .offset(offset)
    .orderBy(sql`${callbackLogsTable.createdAt} DESC`);

  res.json({ data: rows, total, page: pageNum, limit: limitNum });
});

export default router;
