import { Router } from "express";
import { db, callbackLogsTable, qrCodesTable, apiKeysTable } from "@workspace/db";
import { eq, and, count, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { logger } from "../lib/logger";
import { fireCallback, scheduleCallbackRetry } from "../helpers/callbackRetry";

const router = Router();

// POST /api/callbacks — authenticated via X-Api-Key header (merchant API key)
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
  // When orderId is provided it is the precise, order-scoped identifier and is used exclusively.
  // merchantReference is only used when orderId is absent, avoiding ambiguous OR lookups.
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

  // --- Update API key lastUsedAt (fire-and-forget) ---
  db.update(apiKeysTable)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeysTable.id, keyRow.id))
    .catch(() => {});

  // --- Fire the QR's callbackUrl if set (async, non-blocking) ---
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

    (async () => {
      const now = new Date();
      const { ok, httpStatus, responseBody } = await fireCallback(capturedQr.callbackUrl!, bodyStr);

      if (ok) {
        await db.insert(callbackLogsTable).values({
          merchantId: capturedQr.merchantId,
          transactionId: transactionId ?? null,
          url: capturedQr.callbackUrl!,
          status: "success",
          httpStatus,
          requestBody: bodyStr,
          responseBody,
          attempts: 1,
          lastAttemptAt: now,
        });
      } else {
        logger.warn({ httpStatus, url: capturedQr.callbackUrl }, "QR callbackUrl fire failed — scheduling retries");

        const [inserted] = await db.insert(callbackLogsTable).values({
          merchantId: capturedQr.merchantId,
          transactionId: transactionId ?? null,
          url: capturedQr.callbackUrl!,
          status: "pending_retry",
          httpStatus,
          requestBody: bodyStr,
          responseBody,
          attempts: 1,
          lastAttemptAt: now,
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

// GET /api/callbacks
router.get("/", async (req, res) => {
  const user = (req as any).user;
  const { status, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  if (user.role !== "admin") conditions.push(eq(callbackLogsTable.merchantId, user.merchantId!));
  if (status && status !== "all") conditions.push(eq(callbackLogsTable.status, status));

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [{ total }] = await db.select({ total: count() }).from(callbackLogsTable).where(where);
  const data = await db.select().from(callbackLogsTable).where(where).limit(limitNum).offset(offset).orderBy(sql`${callbackLogsTable.createdAt} DESC`);

  res.json({ data, total, page: pageNum, limit: limitNum });
});

export default router;
