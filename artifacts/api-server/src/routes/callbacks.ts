import { Router } from "express";
import { db, callbackLogsTable, qrCodesTable, apiKeysTable, merchantsTable, transactionsTable, qrPaymentEventsTable } from "@workspace/db";
import { eq, and, count, countDistinct, sql, gte, isNull, like } from "drizzle-orm";
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

  const [row] = await db
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
    );

  res.json({
    signatureFailures24h: row?.signatureFailures24h ?? 0,
    affectedMerchants: row?.affectedMerchants ?? 0,
  });
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

// GET /api/callbacks
router.get("/", async (req, res) => {
  const user = (req as any).user;
  const { status, qrCodeId, signatureVerified, rejectionReason, page = "1", limit = "20" } = req.query as Record<string, string>;
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
