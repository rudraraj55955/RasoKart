import { Router } from "express";
import { db, callbackLogsTable, qrCodesTable, apiKeysTable, merchantsTable, transactionsTable, qrPaymentEventsTable, credentialEventsTable, signatureFailureAlertLogsTable } from "@workspace/db";
import { eq, and, count, countDistinct, sql, gte, lte, isNull, like, asc, desc } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { requireApiKey, verifyCallbackSignature } from "../middlewares/callbackAuth";
import { logger } from "../lib/logger";
import { fireCallback, scheduleCallbackRetry, recordAttempt } from "../helpers/callbackRetry";
import { dismissSecretRotationNotifications } from "../helpers/webhookSecretChecker";
import { sendCallbackSecretRotatedEmail } from "../helpers/callbackSecretRotatedEmail";
import { loadSignatureAlertConfig } from "../helpers/signatureFailureAlert";

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
          eventType: "payment.received",
        }).returning({ id: callbackLogsTable.id });

        if (inserted) {
          await recordAttempt(inserted.id, 1, httpStatus, responseBody);
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
          eventType: "payment.received",
        }).returning({ id: callbackLogsTable.id });

        if (inserted) {
          await recordAttempt(inserted.id, 1, httpStatus, responseBody);
          await scheduleCallbackRetry(inserted.id, 1);
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

  const [{ threshold }, [row], breakdown, hourlyRows] = await Promise.all([
    loadSignatureAlertConfig(),
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
      ),

    db
      .select({
        merchantId: callbackLogsTable.merchantId,
        merchantName: merchantsTable.businessName,
        failures: count(),
      })
      .from(callbackLogsTable)
      .leftJoin(merchantsTable, eq(callbackLogsTable.merchantId, merchantsTable.id))
      .where(
        and(
          eq(callbackLogsTable.signatureVerified, false),
          gte(callbackLogsTable.createdAt, since),
        )
      )
      .groupBy(callbackLogsTable.merchantId, merchantsTable.businessName)
      .orderBy(sql`count(*) DESC`),

    db
      .select({
        hour: sql<string>`date_trunc('hour', ${callbackLogsTable.createdAt})`.as("hour"),
        count: count(),
      })
      .from(callbackLogsTable)
      .where(
        and(
          eq(callbackLogsTable.signatureVerified, false),
          gte(callbackLogsTable.createdAt, since),
        )
      )
      .groupBy(sql`date_trunc('hour', ${callbackLogsTable.createdAt})`)
      .orderBy(sql`date_trunc('hour', ${callbackLogsTable.createdAt}) ASC`),
  ]);

  // Build a complete 24-slot array with zeros for hours that had no failures
  const nowMs = Date.now();
  const hourlyMap = new Map<number, number>();
  for (const r of hourlyRows) {
    const slotMs = new Date(r.hour).getTime();
    hourlyMap.set(slotMs, r.count);
  }

  const hourlyTrend: { hour: string; count: number }[] = [];
  for (let i = 23; i >= 0; i--) {
    const slotMs = Math.floor((nowMs - i * 60 * 60 * 1000) / (60 * 60 * 1000)) * (60 * 60 * 1000);
    hourlyTrend.push({
      hour: new Date(slotMs).toISOString(),
      count: hourlyMap.get(slotMs) ?? 0,
    });
  }

  const signatureFailures24h = row?.signatureFailures24h ?? 0;
  res.json({
    signatureFailures24h,
    affectedMerchants: row?.affectedMerchants ?? 0,
    merchantBreakdown: breakdown,
    thresholdExceeded: signatureFailures24h > threshold,
    alertThreshold: threshold,
    hourlyTrend,
  });
});

// GET /api/callbacks/admin/alert-history — paginated history of signature failure alert dispatches (admin only)
router.get("/admin/alert-history", requireAdmin, async (req, res) => {
  const rawLimit = req.query["limit"];
  const limit = rawLimit ? Math.min(100, Math.max(1, parseInt(rawLimit as string, 10) || 20)) : 20;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(signatureFailureAlertLogsTable)
      .orderBy(desc(signatureFailureAlertLogsTable.sentAt))
      .limit(limit),
    db
      .select({ total: count() })
      .from(signatureFailureAlertLogsTable),
  ]);

  const data = rows.map(row => ({
    id: row.id,
    sentAt: row.sentAt,
    failureCount: row.failureCount,
    affectedMerchantCount: row.affectedMerchantCount,
    recipientCount: row.recipientCount,
    recipientEmails: (() => { try { return JSON.parse(row.recipientEmails) as string[]; } catch { return []; } })(),
    affectedMerchants: (() => { try { return JSON.parse(row.affectedMerchants) as { name: string; count: number }[]; } catch { return []; } })(),
    windowHours: row.windowHours,
    threshold: row.threshold,
  }));

  res.json({ data, total });
});

// GET /api/callbacks/secret — returns callback secret status for the authenticated merchant
router.get("/secret", async (req, res) => {
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

  const secret = merchant.callbackSecret;
  res.json({
    isSet: !!secret,
    secretPrefix: secret ? secret.slice(0, 8) + "..." : null,
    lastRotatedAt: merchant.callbackSecretUpdatedAt?.toISOString() ?? null,
  });
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
  await db
    .update(merchantsTable)
    .set({ callbackSecret: newSecret, callbackSecretUpdatedAt: now, updatedAt: now })
    .where(eq(merchantsTable.id, user.merchantId));

  req.log.info({ merchantId: user.merchantId }, "Callback secret rotated");

  // Record credential rotation event (fire-and-forget)
  db.insert(credentialEventsTable).values({
    merchantId: user.merchantId,
    eventType: "callback_secret_rotated",
  }).catch((err: unknown) => {
    req.log.warn({ err, merchantId: user.merchantId }, "Failed to record credential event for secret rotation");
  });

  // Dismiss any pending rotation reminder/overdue notifications for this user
  dismissSecretRotationNotifications(user.id).catch((err: unknown) => {
    req.log.warn({ err, userId: user.id }, "Failed to dismiss webhook secret rotation notifications");
  });

  // Send security alert email to the merchant (fire-and-forget)
  const rawIp = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
    ?? req.ip
    ?? "";
  db.select({ email: merchantsTable.email, businessName: merchantsTable.businessName })
    .from(merchantsTable)
    .where(eq(merchantsTable.id, user.merchantId))
    .limit(1)
    .then(([merchant]) => {
      if (!merchant) return;
      return sendCallbackSecretRotatedEmail({
        to: merchant.email,
        businessName: merchant.businessName,
        rotatedAt: now,
        ipAddress: rawIp,
      });
    })
    .catch((err: unknown) => {
      req.log.warn({ err, merchantId: user.merchantId }, "Failed to send callback secret rotation email");
    });

  res.json({ secret: newSecret });
});

// GET /api/callbacks/secret/history — credential rotation history for the authenticated merchant
router.get("/secret/history", async (req, res) => {
  const user = (req as any).user;
  if (user.role !== "merchant") {
    res.status(403).json({ error: "Merchant access only" });
    return;
  }

  const { page = "1", limit = "50" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(200, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const [{ total }] = await db
    .select({ total: count() })
    .from(credentialEventsTable)
    .where(eq(credentialEventsTable.merchantId, user.merchantId));

  const rows = await db
    .select()
    .from(credentialEventsTable)
    .where(eq(credentialEventsTable.merchantId, user.merchantId))
    .orderBy(asc(credentialEventsTable.createdAt))
    .limit(limitNum)
    .offset(offset);

  res.json({ data: rows, total, page: pageNum, limit: limitNum });
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

// GET /api/callbacks
router.get("/", async (req, res) => {
  const user = (req as any).user;
  const { status, qrCodeId, signatureVerified, rejectionReason, merchantId, eventType, from, to, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  if (user.role !== "admin") {
    conditions.push(eq(callbackLogsTable.merchantId, user.merchantId!));
  } else if (merchantId) {
    conditions.push(eq(callbackLogsTable.merchantId, parseInt(merchantId)));
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
  if (from) {
    const fromDate = new Date(from);
    if (!isNaN(fromDate.getTime())) conditions.push(gte(callbackLogsTable.createdAt, fromDate));
  }
  if (to) {
    const toDate = new Date(to);
    if (!isNaN(toDate.getTime())) conditions.push(lte(callbackLogsTable.createdAt, toDate));
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
      signatureVerified: callbackLogsTable.signatureVerified,
      isTest: callbackLogsTable.isTest,
      eventType: callbackLogsTable.eventType,
      createdAt: callbackLogsTable.createdAt,
      merchantName: merchantsTable.businessName,
    })
    .from(callbackLogsTable)
    .leftJoin(merchantsTable, eq(callbackLogsTable.merchantId, merchantsTable.id))
    .where(where)
    .limit(limitNum)
    .offset(offset)
    .orderBy(sql`${callbackLogsTable.createdAt} DESC`);

  res.json({ data: rows, total, page: pageNum, limit: limitNum });
});

export default router;
