import { Router } from "express";
import { db, razorpayPaymentOrdersTable, razorpayWebhookLogsTable, RAZORPAY_ORDER_STATUS } from "@workspace/db";
import { eq } from "drizzle-orm";
import { verifyRazorpayWebhookSignature } from "../helpers/razorpay";
import { creditWalletForRazorpay } from "./razorpayOrders";
import { logger } from "../lib/logger";

const router = Router();

/**
 * POST /api/webhooks/razorpay
 *
 * Public endpoint — called by Razorpay when a payment event occurs.
 * Verifies x-razorpay-signature using RAZORPAY_WEBHOOK_SECRET env var (never DB).
 * Supports: payment.captured, payment.failed, order.paid
 * Idempotent via razorpay_webhook_logs unique on webhook_event_id.
 * Webhook logs are masked — no raw sensitive payloads stored.
 */
router.post("/razorpay", async (req, res) => {
  const rawBody = ((req as any).rawBody as Buffer | undefined)?.toString("utf8") ?? JSON.stringify(req.body);
  const body = req.body as Record<string, unknown>;

  const incomingSignature = req.headers["x-razorpay-signature"] as string | undefined;
  const webhookEventId    = req.headers["x-razorpay-event-id"] as string | undefined;

  let processingResult: "credited" | "duplicate" | "ignored" | "failed_payment" | "error" = "ignored";
  let safeMessage: string | null = null;
  let merchantId: number | null = null;
  let razorpayOrderId: string | null = null;
  let razorpayPaymentId: string | null = null;
  let eventType: string | null = null;
  let amount: string | null = null;

  try {
    const webhookSecret = process.env["RAZORPAY_WEBHOOK_SECRET"] ?? "";
    if (webhookSecret) {
      if (!incomingSignature) {
        logger.warn({ webhookEventId }, "Razorpay webhook rejected: missing x-razorpay-signature header");
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      const valid = verifyRazorpayWebhookSignature(rawBody, incomingSignature, webhookSecret);
      if (!valid) {
        logger.warn({ webhookEventId }, "Razorpay webhook rejected: invalid signature");
        res.status(401).json({ error: "Invalid webhook signature" });
        return;
      }
    } else {
      logger.warn("Razorpay webhook secret not configured — accepting without verification (dev mode)");
    }

    eventType = (body["event"] as string) ?? null;
    const payload = body["payload"] as Record<string, unknown> | undefined;
    const paymentEntity = (payload?.["payment"] as Record<string, unknown>)?.["entity"] as Record<string, unknown> | undefined;
    const orderEntity   = (payload?.["order"]   as Record<string, unknown>)?.["entity"] as Record<string, unknown> | undefined;

    razorpayOrderId   = (paymentEntity?.["order_id"] as string) ?? (orderEntity?.["id"] as string) ?? null;
    razorpayPaymentId = (paymentEntity?.["id"] as string) ?? null;
    const amountRaw   = paymentEntity?.["amount"] ?? orderEntity?.["amount"];
    amount            = amountRaw != null ? String(Number(amountRaw) / 100) : null;

    logger.info({ eventType, razorpayOrderId, razorpayPaymentId, webhookEventId }, "Razorpay webhook received");

    res.json({ success: true });

    if (webhookEventId) {
      const [existing] = await db
        .select({ id: razorpayWebhookLogsTable.id })
        .from(razorpayWebhookLogsTable)
        .where(eq(razorpayWebhookLogsTable.webhookEventId, webhookEventId))
        .limit(1);
      if (existing) {
        logger.info({ webhookEventId }, "Razorpay webhook: duplicate event_id — skipping");
        processingResult = "duplicate";
        safeMessage = "Duplicate webhook event";
        await insertLog({ webhookEventId, eventType, razorpayOrderId, razorpayPaymentId, merchantId, amount, processingResult, safeMessage });
        return;
      }
    }

    if (!razorpayOrderId) {
      processingResult = "ignored";
      safeMessage = "Missing order_id in payload";
      await insertLog({ webhookEventId, eventType, razorpayOrderId, razorpayPaymentId, merchantId, amount, processingResult, safeMessage });
      return;
    }

    if (eventType === "payment.failed") {
      const [order] = await db
        .select()
        .from(razorpayPaymentOrdersTable)
        .where(eq(razorpayPaymentOrdersTable.razorpayOrderId, razorpayOrderId))
        .limit(1);
      if (order && order.status === RAZORPAY_ORDER_STATUS.CREATED || order?.status === RAZORPAY_ORDER_STATUS.PENDING) {
        await db
          .update(razorpayPaymentOrdersTable)
          .set({ status: RAZORPAY_ORDER_STATUS.FAILED, failureReason: "Payment declined" })
          .where(eq(razorpayPaymentOrdersTable.razorpayOrderId, razorpayOrderId));
        merchantId = order?.merchantId ?? null;
      }
      processingResult = "failed_payment";
      safeMessage = "Payment failed";
      await insertLog({ webhookEventId, eventType, razorpayOrderId, razorpayPaymentId, merchantId, amount, processingResult, safeMessage });
      return;
    }

    if (eventType !== "payment.captured" && eventType !== "order.paid") {
      processingResult = "ignored";
      safeMessage = `Unsupported event type: ${eventType}`;
      await insertLog({ webhookEventId, eventType, razorpayOrderId, razorpayPaymentId, merchantId, amount, processingResult, safeMessage });
      return;
    }

    const [order] = await db
      .select()
      .from(razorpayPaymentOrdersTable)
      .where(eq(razorpayPaymentOrdersTable.razorpayOrderId, razorpayOrderId))
      .limit(1);

    if (!order) {
      logger.warn({ razorpayOrderId }, "Razorpay webhook: order not found in DB");
      processingResult = "ignored";
      safeMessage = "Order not found in DB";
      await insertLog({ webhookEventId, eventType, razorpayOrderId, razorpayPaymentId, merchantId, amount, processingResult, safeMessage });
      return;
    }

    merchantId = order.merchantId;

    if (!razorpayPaymentId) {
      processingResult = "ignored";
      safeMessage = "Missing payment_id in payload";
      await insertLog({ webhookEventId, eventType, razorpayOrderId, razorpayPaymentId, merchantId, amount, processingResult, safeMessage });
      return;
    }

    const paymentMethod = typeof paymentEntity?.["method"] === "string" ? paymentEntity["method"] : null;
    const creditResult = await creditWalletForRazorpay(order.internalOrderId, razorpayPaymentId, paymentMethod);

    processingResult = creditResult === "credited" ? "credited" : creditResult === "duplicate" ? "duplicate" : "error";
    safeMessage = creditResult === "error" ? "Wallet credit failed" : null;

    logger.info({ razorpayOrderId, razorpayPaymentId, merchantId, creditResult }, "Razorpay webhook processed");
    await insertLog({ webhookEventId, eventType, razorpayOrderId, razorpayPaymentId, merchantId, amount, processingResult, safeMessage });

  } catch (err) {
    logger.error({ err, razorpayOrderId, webhookEventId }, "Razorpay webhook processing error");
    processingResult = "error";
    safeMessage = "Internal processing error";
    try {
      await insertLog({ webhookEventId, eventType, razorpayOrderId, razorpayPaymentId, merchantId, amount, processingResult, safeMessage });
    } catch (logErr) {
      logger.warn({ logErr }, "Razorpay webhook: failed to insert log after error");
    }
  }
});

async function insertLog(params: {
  webhookEventId?: string | null;
  eventType: string | null;
  razorpayOrderId: string | null;
  razorpayPaymentId: string | null;
  merchantId: number | null;
  amount: string | null;
  processingResult: string;
  safeMessage: string | null;
}): Promise<void> {
  try {
    await db.insert(razorpayWebhookLogsTable).values({
      webhookEventId:   params.webhookEventId ?? undefined,
      eventType:        params.eventType ?? undefined,
      razorpayOrderId:  params.razorpayOrderId ?? undefined,
      razorpayPaymentId: params.razorpayPaymentId ?? undefined,
      merchantId:       params.merchantId ?? undefined,
      amount:           params.amount ?? undefined,
      processingResult: params.processingResult,
      safeMessage:      params.safeMessage ?? undefined,
    }).onConflictDoNothing();
  } catch (err) {
    logger.warn({ err }, "Razorpay: failed to insert webhook log");
  }
}

export default router;
