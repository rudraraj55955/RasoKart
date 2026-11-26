import { Router } from "express";
import { db, callbackLogsTable, qrCodesTable, apiKeysTable, merchantsTable, transactionsTable, qrPaymentEventsTable, webhooksTable, callbackLogAttemptsTable, systemSettingsTable, systemConfigTable, SYSTEM_CONFIG_KEYS, SYSTEM_CONFIG_DEFAULTS, credentialEventsTable, auditLogsTable } from "@workspace/db";
import { eq, and, count, countDistinct, sql, gte, lte, isNull, like, asc, desc, gt } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { requireApiKey, verifyCallbackSignature } from "../middlewares/callbackAuth";
import { logger } from "../lib/logger";
import { fireCallback, scheduleCallbackRetry } from "../helpers/callbackRetry";
import { maskIp } from "../helpers/apiKeyEmail";
import { encryptSecret, decryptSecret } from "../helpers/cryptoUtils";

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

      // Look up the merchant's webhook config so the initial schedule respects
      // both the per-merchant max-retries cap and custom delay overrides —
      // consistent with what processPendingRetries applies for later retries.
      const [webhookRow] = await db
        .select({
          maxRetries: webhooksTable.maxRetries,
          retryDelay1: webhooksTable.retryDelay1,
          retryDelay2: webhooksTable.retryDelay2,
          retryDelay3: webhooksTable.retryDelay3,
        })
        .from(webhooksTable)
        .where(eq(webhooksTable.merchantId, capturedQr.merchantId))
        .limit(1);
      const merchantMaxRetries = webhookRow?.maxRetries ?? undefined;
      const merchantDelayOverrides = webhookRow
        ? { delay1: webhookRow.retryDelay1, delay2: webhookRow.retryDelay2, delay3: webhookRow.retryDelay3 }
        : undefined;

      const firedAt = new Date();
      const { ok, httpStatus, responseBody } = await fireCallback(capturedQr.callbackUrl!, bodyStr);

      if (ok) {
        const [inserted] = await db.insert(callbackLogsTable).values({
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
        }).returning({ id: callbackLogsTable.id });

        if (inserted) {
          db.insert(callbackLogAttemptsTable).values({
            callbackLogId: inserted.id,
            attemptNumber: 1,
            firedAt,
            httpStatus: httpStatus ?? null,
            responseBody: responseBody ?? null,
          }).catch((err: unknown) => {
            logger.warn({ err, callbackLogId: inserted.id }, "Failed to insert initial callback_log_attempt record");
          });
        }
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
          db.insert(callbackLogAttemptsTable).values({
            callbackLogId: inserted.id,
            attemptNumber: 1,
            firedAt,
            httpStatus: httpStatus ?? null,
            responseBody: responseBody ?? null,
          }).catch((err: unknown) => {
            logger.warn({ err, callbackLogId: inserted.id }, "Failed to insert initial callback_log_attempt record");
          });

          await scheduleCallbackRetry(inserted.id, 1, merchantMaxRetries, merchantDelayOverrides);
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
  // The alert scheduler always looks back 24 h (hardcoded in checkAndAlertSignatureFailures).
  const ALERT_WINDOW_HOURS = 24;
  const since = new Date(Date.now() - ALERT_WINDOW_HOURS * 60 * 60 * 1000);

  const [row, thresholdRow] = await Promise.all([
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
    // Read threshold from system_config — the single source of truth used by
    // checkAndAlertSignatureFailures(). The old systemSettingsTable lookup was
    // reading from the wrong table (always fell back to the hardcoded 10).
    db
      .select({ value: systemConfigTable.value })
      .from(systemConfigTable)
      .where(eq(systemConfigTable.key, SYSTEM_CONFIG_KEYS.SIGNATURE_FAILURE_ALERT_THRESHOLD))
      .limit(1)
      .then(r => r[0]),
  ]);

  const rawThreshold = thresholdRow?.value
    ?? SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.SIGNATURE_FAILURE_ALERT_THRESHOLD];
  const alertThreshold = parseInt(rawThreshold, 10);

  res.json({
    signatureFailures24h: row?.signatureFailures24h ?? 0,
    affectedMerchants: row?.affectedMerchants ?? 0,
    alertThreshold: isNaN(alertThreshold) ? 10 : alertThreshold,
    alertWindowHours: ALERT_WINDOW_HOURS,
  });
});

// GET /api/callbacks/secret — returns callback secret status for the authenticated merchant
router.get("/secret", async (req, res) => {
  const user = (req as any).user;
  if (user.role !== "merchant") {
    res.status(403).json({ error: "Merchant access only" });
    return;
  }

  const [[merchant], [webhook], verifiedCount] = await Promise.all([
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
    db
      .select({ n: count() })
      .from(callbackLogsTable)
      .where(
        and(
          eq(callbackLogsTable.merchantId, user.merchantId),
          eq(callbackLogsTable.isTest, true),
          eq(callbackLogsTable.status, "success"),
        )
      ),
  ]);

  if (!merchant) {
    res.status(404).json({ error: "Merchant not found" });
    return;
  }

  const stored = merchant.callbackSecret;
  const lastRotatedAt = webhook?.secretRotatedAt?.toISOString() ?? null;
  const callbackVerified = (verifiedCount[0]?.n ?? 0) > 0;

  // Decrypt so the prefix is derived from the actual secret value, not the
  // "enc:v1:…" storage envelope.
  let secretPrefix: string | null = null;
  if (stored) {
    const dec = decryptSecret(stored);
    secretPrefix = dec.ok
      ? dec.value.slice(0, 8) + "..."
      : "????????..."; // decrypt failed (wrong SESSION_SECRET?) — show neutral placeholder
  }

  res.json({
    isSet: !!stored,
    secretPrefix,
    lastRotatedAt,
    callbackVerified,
  });
});

// GET /api/callbacks/secret/history — credential event history for callback secret
router.get("/secret/history", async (req, res) => {
  const user = (req as any).user;
  if (user.role !== "merchant") {
    res.status(403).json({ error: "Merchant access only" });
    return;
  }

  const { from, to } = req.query as Record<string, string>;

  const conditions: ReturnType<typeof eq>[] = [
    eq(credentialEventsTable.merchantId, user.merchantId),
    eq(credentialEventsTable.eventType, "callback_secret_rotated"),
  ];

  if (from) {
    const fromDate = new Date(from);
    fromDate.setUTCHours(0, 0, 0, 0);
    if (!isNaN(fromDate.getTime())) conditions.push(gte(credentialEventsTable.createdAt, fromDate) as any);
  }
  if (to) {
    const toDate = new Date(to);
    toDate.setUTCHours(23, 59, 59, 999);
    if (!isNaN(toDate.getTime())) conditions.push(lte(credentialEventsTable.createdAt, toDate) as any);
  }

  const rows = await db
    .select({
      eventType: credentialEventsTable.eventType,
      occurredAt: credentialEventsTable.createdAt,
      keyPrefix: credentialEventsTable.keyPrefix,
      ipAddress: credentialEventsTable.ipAddress,
      actorEmail: credentialEventsTable.actorEmail,
    })
    .from(credentialEventsTable)
    .where(and(...conditions))
    .orderBy(desc(credentialEventsTable.createdAt));

  const events = rows.map(r => ({
    eventType: "secret_rotated",
    occurredAt: r.occurredAt.toISOString(),
    keyPrefix: r.keyPrefix ?? null,
    description: "Callback signing secret rotated",
    isRevoked: false,
    ipAddress: r.ipAddress ? maskIp(r.ipAddress) : null,
    actorEmail: r.actorEmail ?? null,
  }));

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
  // Store encrypted at rest (AES-256-GCM via SESSION_SECRET).
  // verifyCallbackSignature decrypts before HMAC verification.
  // The plaintext is returned once to the merchant and never persisted.
  const encryptedSecret = encryptSecret(newSecret);

  const now = new Date();
  const rotateIp = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
    ?? req.socket.remoteAddress
    ?? "";

  await Promise.all([
    db
      .update(merchantsTable)
      .set({ callbackSecret: encryptedSecret, callbackSecretUpdatedAt: now, updatedAt: now })
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
    .select({ id: callbackLogsTable.id, status: callbackLogsTable.status, merchantId: callbackLogsTable.merchantId })
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

  // Look up per-merchant delay overrides so the re-scheduled retry respects them.
  const [adminRetryWebhookRow] = await db
    .select({
      maxRetries: webhooksTable.maxRetries,
      retryDelay1: webhooksTable.retryDelay1,
      retryDelay2: webhooksTable.retryDelay2,
      retryDelay3: webhooksTable.retryDelay3,
    })
    .from(webhooksTable)
    .where(eq(webhooksTable.merchantId, log.merchantId))
    .limit(1);
  const adminRetryDelayOverrides = adminRetryWebhookRow
    ? { delay1: adminRetryWebhookRow.retryDelay1, delay2: adminRetryWebhookRow.retryDelay2, delay3: adminRetryWebhookRow.retryDelay3 }
    : undefined;
  const adminRetryMaxRetries = adminRetryWebhookRow?.maxRetries;

  const now = new Date();
  await db
    .update(callbackLogsTable)
    .set({ status: "pending_retry", attempts: 0, nextRetryAt: now })
    .where(eq(callbackLogsTable.id, id));

  await scheduleCallbackRetry(id, 0, adminRetryMaxRetries, adminRetryDelayOverrides);

  req.log.info({ callbackLogId: id }, "Admin manually triggered callback retry");

  // Audit log — all admin mutations must be recorded for accountability.
  const adminUser = (req as any).user;
  await db.insert(auditLogsTable).values({
    adminId: adminUser.id as number,
    adminEmail: adminUser.email ?? "unknown",
    action: "admin_callback_retry",
    targetType: "callback_log",
    targetId: id,
    ipAddress: (req.headers["cf-connecting-ip"] as string | undefined) ?? req.ip ?? null,
    details: JSON.stringify({
      callbackLogId: id,
      previousStatus: log.status,
      merchantId: log.merchantId,
      triggeredBy: adminUser.email ?? adminUser.id,
    }),
  }).catch((err: unknown) => {
    req.log.warn({ err, callbackLogId: id }, "Failed to insert audit log for admin callback retry");
  });

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
  const { status, merchantId, qrCodeId, signatureVerified, rejectionReason, eventType, dateFrom, dateTo, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  if (user.role !== "admin") {
    conditions.push(eq(callbackLogsTable.merchantId, user.merchantId!));
  } else if (merchantId) {
    const parsedMerchantId = parseInt(merchantId);
    if (!isNaN(parsedMerchantId)) conditions.push(eq(callbackLogsTable.merchantId, parsedMerchantId));
  }
  if (status && status !== "all") conditions.push(eq(callbackLogsTable.status, status));
  if (qrCodeId) conditions.push(eq(callbackLogsTable.qrCodeId, parseInt(qrCodeId)));
  if (signatureVerified === "verified") conditions.push(eq(callbackLogsTable.signatureVerified, true));
  else if (signatureVerified === "failed") conditions.push(eq(callbackLogsTable.signatureVerified, false));
  else if (signatureVerified === "none") conditions.push(isNull(callbackLogsTable.signatureVerified));
  if (rejectionReason && REJECTION_REASON_PATTERNS[rejectionReason]) {
    conditions.push(like(callbackLogsTable.responseBody, REJECTION_REASON_PATTERNS[rejectionReason]));
  }
  if (eventType) conditions.push(eq(callbackLogsTable.eventType, eventType));
  if (dateFrom) {
    const fromDate = new Date(dateFrom);
    fromDate.setHours(0, 0, 0, 0);
    conditions.push(gte(callbackLogsTable.createdAt, fromDate));
  }
  if (dateTo) {
    const toDate = new Date(dateTo);
    toDate.setHours(23, 59, 59, 999);
    conditions.push(lte(callbackLogsTable.createdAt, toDate));
  }

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
