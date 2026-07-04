import { Router } from "express";
import { db, cashfreePaymentOrdersTable, cashfreePaymentLogsTable, transactionsTable, systemConfigTable, SYSTEM_CONFIG_KEYS, PAYIN_ORDER_STATUS } from "@workspace/db";
import { eq, and, ne } from "drizzle-orm";
import { logger } from "../lib/logger";
import { verifyCashfreeWebhookSignature } from "../helpers/cashfree";

const router = Router();

/**
 * POST /api/payment/cashfree-webhook
 *
 * Public endpoint — called by Cashfree when a payment is confirmed.
 * Verifies HMAC-SHA256 signature using X-Webhook-Signature + X-Webhook-Timestamp headers.
 * On SUCCESS: finds the merchant via cashfree_payment_orders, inserts a deposit transaction,
 * and logs the event to cashfree_payment_logs. Idempotent: duplicate order_id is a no-op.
 *
 * Cashfree webhook signature:
 *   HMAC-SHA256(timestamp + rawBody, webhookSecret) → base64
 *   Header: x-webhook-signature, x-webhook-timestamp
 */
router.post("/cashfree-webhook", async (req, res) => {
  const rawBody = ((req as any).rawBody as Buffer | undefined)?.toString("utf8") ?? JSON.stringify(req.body);
  const body = req.body as Record<string, unknown>;

  const signature = req.headers["x-webhook-signature"] as string | undefined;
  const timestamp = req.headers["x-webhook-timestamp"] as string | undefined;

  let processingResult: "credited" | "duplicate" | "ignored" | "error" = "ignored";
  let errorMessage: string | null = null;
  let merchantId: number | null = null;
  let cashfreeOrderId: string | null = null;
  let eventType: string | null = null;
  let amount: string | null = null;
  let status: string | null = null;

  try {
    // ── Signature verification ─────────────────────────────────────────────
    const [secretRow] = await db
      .select({ value: systemConfigTable.value })
      .from(systemConfigTable)
      .where(eq(systemConfigTable.key, SYSTEM_CONFIG_KEYS.CASHFREE_WEBHOOK_SECRET))
      .limit(1);

    const webhookSecret = secretRow?.value ?? "";
    if (webhookSecret) {
      const valid = verifyCashfreeWebhookSignature(rawBody, timestamp ?? "", signature ?? "", webhookSecret);
      if (!valid) {
        logger.warn({ cashfreeOrderId }, "Cashfree webhook rejected: invalid signature");
        res.status(401).json({ error: "Invalid webhook signature" });
        return;
      }
    }

    // ── Guard: Cashfree must be enabled ────────────────────────────────────
    const [enabledRow] = await db
      .select({ value: systemConfigTable.value })
      .from(systemConfigTable)
      .where(eq(systemConfigTable.key, SYSTEM_CONFIG_KEYS.CASHFREE_ENABLED))
      .limit(1);

    if (enabledRow?.value !== "true") {
      logger.warn({ body }, "Cashfree webhook received but Cashfree is disabled — ignoring");
      res.json({ success: true });
      await insertLog({ eventType: "unknown", cashfreeOrderId: null, merchantId: null, amount: null, status: null, rawPayload: rawBody, processingResult: "ignored", errorMessage: "Cashfree disabled" });
      return;
    }

    // ── Parse webhook payload ──────────────────────────────────────────────
    // Cashfree webhook structure: { type, data: { order: {...}, payment: {...} } }
    eventType = (body["type"] as string) ?? null;
    const data = body["data"] as Record<string, unknown> | undefined;
    const order = data?.["order"] as Record<string, unknown> | undefined;
    const payment = data?.["payment"] as Record<string, unknown> | undefined;

    cashfreeOrderId = (order?.["order_id"] as string) ?? null;
    amount = (payment?.["payment_amount"] as string | number | undefined)?.toString() ?? (order?.["order_amount"] as string | number | undefined)?.toString() ?? null;
    status = (payment?.["payment_status"] as string) ?? null;

    logger.info({ eventType, cashfreeOrderId, status }, "Cashfree payment webhook received");

    // Acknowledge immediately
    res.json({ success: true });

    // Only process SUCCESS payments
    if (!cashfreeOrderId) {
      processingResult = "ignored";
      errorMessage = "Missing order_id in payload";
      await insertLog({ eventType, cashfreeOrderId: null, merchantId: null, amount, status, rawPayload: rawBody, processingResult, errorMessage });
      return;
    }

    if (status?.toUpperCase() !== "SUCCESS") {
      processingResult = "ignored";
      errorMessage = `Non-success payment status: ${status}`;
      await insertLog({ eventType, cashfreeOrderId, merchantId: null, amount, status, rawPayload: rawBody, processingResult, errorMessage });
      return;
    }

    // ── Look up the order in our DB ────────────────────────────────────────
    const [cfOrder] = await db
      .select()
      .from(cashfreePaymentOrdersTable)
      .where(eq(cashfreePaymentOrdersTable.cashfreeOrderId, cashfreeOrderId))
      .limit(1);

    if (!cfOrder) {
      logger.warn({ cashfreeOrderId }, "Cashfree webhook: order not found in DB");
      processingResult = "ignored";
      errorMessage = "Order not found in DB";
      await insertLog({ eventType, cashfreeOrderId, merchantId: null, amount, status, rawPayload: rawBody, processingResult, errorMessage });
      return;
    }

    merchantId = cfOrder.merchantId;

    // ── Atomic idempotency: conditional UPDATE returning changed rows ───────
    // Only transitions status from non-paid → paid. Concurrent webhooks for the
    // same order will find zero updated rows and be treated as duplicates.
    const updated = await db
      .update(cashfreePaymentOrdersTable)
      .set({ status: PAYIN_ORDER_STATUS.PAID })
      .where(and(
        eq(cashfreePaymentOrdersTable.cashfreeOrderId, cashfreeOrderId),
        ne(cashfreePaymentOrdersTable.status, PAYIN_ORDER_STATUS.PAID),
      ))
      .returning({ id: cashfreePaymentOrdersTable.id });

    if (!updated.length) {
      logger.info({ cashfreeOrderId }, "Cashfree webhook: order already credited (atomic check) — skipping");
      processingResult = "duplicate";
      errorMessage = "Order already credited";
      await insertLog({ eventType, cashfreeOrderId, merchantId, amount, status, rawPayload: rawBody, processingResult, errorMessage });
      return;
    }

    // ── Insert deposit transaction ─────────────────────────────────────────
    // UTR is deterministic: prefer cf_payment_id (stable across retries);
    // fall back to cashfree_order_id (also stable). Never use Date.now().
    const paymentId = (payment?.["cf_payment_id"] as string | number | undefined)?.toString() ?? null;
    const utr = paymentId ? `CF-${paymentId}` : `CF-${cashfreeOrderId}`;
    const paidAmount = amount ?? cfOrder.amount?.toString() ?? "0";

    await db.insert(transactionsTable).values({
      merchantId: cfOrder.merchantId,
      provider: "cashfree",
      type: "deposit",
      status: "success",
      amount: paidAmount,
      currency: cfOrder.currency ?? "INR",
      utr,
      referenceId: cashfreeOrderId,
      description: `Cashfree payment — order ${cashfreeOrderId}`,
      metadata: rawBody,
    }).onConflictDoNothing();

    logger.info({ cashfreeOrderId, merchantId, amount: paidAmount, utr }, "Cashfree payment credited");
    processingResult = "credited";

    await insertLog({ eventType, cashfreeOrderId, merchantId, amount: paidAmount, status, rawPayload: rawBody, processingResult, errorMessage: null });

  } catch (err) {
    logger.error({ err, cashfreeOrderId }, "Cashfree webhook processing error");
    processingResult = "error";
    errorMessage = err instanceof Error ? err.message : String(err);
    try {
      await insertLog({ eventType, cashfreeOrderId, merchantId, amount, status, rawPayload: rawBody, processingResult: "error", errorMessage });
    } catch (logErr) {
      logger.warn({ logErr }, "Cashfree webhook: failed to insert log after error");
    }
  }
});

async function insertLog(params: {
  eventType: string | null;
  cashfreeOrderId: string | null;
  merchantId: number | null;
  amount: string | null;
  status: string | null;
  rawPayload: string;
  processingResult: "credited" | "duplicate" | "ignored" | "error";
  errorMessage: string | null;
}) {
  try {
    await db.insert(cashfreePaymentLogsTable).values({
      eventType: params.eventType ?? undefined,
      cashfreeOrderId: params.cashfreeOrderId ?? undefined,
      merchantId: params.merchantId ?? undefined,
      amount: params.amount ?? undefined,
      status: params.status ?? undefined,
      rawPayload: params.rawPayload,
      processingResult: params.processingResult,
      errorMessage: params.errorMessage ?? undefined,
    });
  } catch (err) {
    logger.warn({ err }, "Cashfree webhook: failed to insert log");
  }
}

export default router;
