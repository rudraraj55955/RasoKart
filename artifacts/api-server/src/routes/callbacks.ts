import { createHmac, timingSafeEqual } from "crypto";
import { Router } from "express";
import { db, callbackLogsTable, qrCodesTable, apiKeysTable, merchantsTable, transactionsTable, qrPaymentEventsTable } from "@workspace/db";
import { eq, and, count, sql } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { logger } from "../lib/logger";
import { fireCallback, scheduleCallbackRetry } from "../helpers/callbackRetry";

const router = Router();

/**
 * Verify an HMAC-SHA256 signature of the raw request body.
 * Expected header format: `X-Signature: sha256=<hex_digest>`
 */
function verifyHmacSignature(secret: string, rawBody: Buffer, signatureHeader: string): boolean {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const provided = signatureHeader.startsWith("sha256=")
    ? signatureHeader.slice(7)
    : signatureHeader;

  if (provided.length !== expected.length) return false;

  try {
    return timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

// POST /api/callbacks — authenticated via X-Api-Key header (merchant API key)
// If the merchant has configured a callbackSecret, X-Signature is also required.
// Called by payment providers or merchant back-end to mark a QR as "used" on payment receipt
router.post("/", async (req, res) => {
  // --- Authentication via merchant API key ---
  const apiKeyHeader = (req.headers["x-api-key"] as string | undefined)?.trim();
  if (!apiKeyHeader) {
    res.status(401).json({ error: "X-Api-Key header is required" });
    return;
  }

  const [keyRow] = await db
    .select()
    .from(apiKeysTable)
    .where(eq(apiKeysTable.apiKey, apiKeyHeader))
    .limit(1);

  if (!keyRow || !keyRow.isActive) {
    res.status(401).json({ error: "Invalid or inactive API key" });
    return;
  }

  const merchantId = keyRow.merchantId;

  // --- HMAC signature check (if merchant has a callbackSecret configured) ---
  const [merchant] = await db
    .select({ callbackSecret: merchantsTable.callbackSecret })
    .from(merchantsTable)
    .where(eq(merchantsTable.id, merchantId))
    .limit(1);

  // signatureVerified: true = HMAC passed, false = HMAC rejected, null = no secret configured
  let signatureVerified: boolean | null = null;

  if (merchant?.callbackSecret) {
    const signatureHeader = (req.headers["x-signature"] as string | undefined)?.trim();
    if (!signatureHeader) {
      db.insert(callbackLogsTable).values({
        merchantId,
        url: req.originalUrl,
        status: "failed",
        attempts: 1,
        lastAttemptAt: new Date(),
        signatureVerified: false,
        responseBody: "X-Signature header is required for this merchant",
      }).catch((err: unknown) => {
        logger.warn({ err }, "Failed to log signature-missing callback attempt");
      });
      res.status(401).json({ error: "X-Signature header is required for this merchant" });
      return;
    }

    const rawBody = (req as any).rawBody as Buffer | undefined;
    if (!rawBody) {
      res.status(500).json({ error: "Unable to verify signature: raw body unavailable" });
      return;
    }

    if (!verifyHmacSignature(merchant.callbackSecret, rawBody, signatureHeader)) {
      db.insert(callbackLogsTable).values({
        merchantId,
        url: req.originalUrl,
        status: "failed",
        attempts: 1,
        lastAttemptAt: new Date(),
        signatureVerified: false,
        responseBody: "Invalid X-Signature",
      }).catch((err: unknown) => {
        logger.warn({ err }, "Failed to log signature-invalid callback attempt");
      });
      res.status(401).json({ error: "Invalid X-Signature" });
      return;
    }

    signatureVerified = true;
  }

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
  db.update(apiKeysTable)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeysTable.id, keyRow.id))
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

// GET /api/callbacks/secret — returns callback secret status for the authenticated merchant
router.get("/secret", async (req, res) => {
  const user = (req as any).user;
  if (user.role !== "merchant") {
    res.status(403).json({ error: "Merchant access only" });
    return;
  }

  const [merchant] = await db
    .select({ callbackSecret: merchantsTable.callbackSecret })
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

  await db
    .update(merchantsTable)
    .set({ callbackSecret: newSecret, updatedAt: new Date() })
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

// GET /api/callbacks
router.get("/", async (req, res) => {
  const user = (req as any).user;
  const { status, qrCodeId, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  if (user.role !== "admin") conditions.push(eq(callbackLogsTable.merchantId, user.merchantId!));
  if (status && status !== "all") conditions.push(eq(callbackLogsTable.status, status));
  if (qrCodeId) conditions.push(eq(callbackLogsTable.qrCodeId, parseInt(qrCodeId)));

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [{ total }] = await db.select({ total: count() }).from(callbackLogsTable).where(where);
  const data = await db.select().from(callbackLogsTable).where(where).limit(limitNum).offset(offset).orderBy(sql`${callbackLogsTable.createdAt} DESC`);

  res.json({ data, total, page: pageNum, limit: limitNum });
});

export default router;
