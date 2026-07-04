import { Router } from "express";
import { db, cashfreePaymentOrdersTable, cashfreePaymentLogsTable, ledgerEntriesTable, merchantsTable, systemConfigTable, SYSTEM_CONFIG_KEYS } from "@workspace/db";
import { eq, and, ne, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { verifyCashfreeWebhookSignature } from "../helpers/cashfree";
import { decryptSecret } from "../helpers/cryptoUtils";

const router = Router();

/**
 * POST /api/webhooks/payin/cashfree
 *
 * Public endpoint — called by Cashfree when a UPI payin payment status changes.
 * Verifies HMAC-SHA256 signature using X-Webhook-Signature + X-Webhook-Timestamp headers.
 * On PAID: atomically transitions the order status (idempotent), credits the merchant
 * wallet balance, and writes a ledger entry — all inside a single DB transaction so the
 * wallet is credited exactly once even under concurrent/duplicate webhook delivery.
 *
 * White-label: never logs or stores the raw Cashfree order id in any merchant-facing
 * field; only the RasoKart publicOrderId / UTR reach merchant UI.
 */
router.post("/cashfree", async (req, res) => {
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
    // ── Signature verification (fail-closed only when a secret is configured) ──
    const [secretRow] = await db
      .select({ value: systemConfigTable.value })
      .from(systemConfigTable)
      .where(eq(systemConfigTable.key, SYSTEM_CONFIG_KEYS.CASHFREE_WEBHOOK_SECRET))
      .limit(1);

    const rawSecret = secretRow?.value ?? "";
    if (rawSecret) {
      const decryptedSecret = decryptSecret(rawSecret);
      const secretValue = decryptedSecret.ok ? decryptedSecret.value : rawSecret;
      const valid = verifyCashfreeWebhookSignature(rawBody, timestamp ?? "", signature ?? "", secretValue);
      if (!valid) {
        logger.warn("Payin webhook rejected: invalid signature");
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
      logger.warn("Payin webhook received but Cashfree is disabled — ignoring");
      res.json({ success: true });
      await insertLog({ eventType: "unknown", cashfreeOrderId: null, merchantId: null, amount: null, status: null, rawPayload: rawBody, processingResult: "ignored", errorMessage: "Cashfree disabled" });
      return;
    }

    // ── Parse webhook payload ──────────────────────────────────────────────
    eventType = (body["type"] as string) ?? null;
    const data = body["data"] as Record<string, unknown> | undefined;
    const order = data?.["order"] as Record<string, unknown> | undefined;
    const payment = data?.["payment"] as Record<string, unknown> | undefined;

    cashfreeOrderId = (order?.["order_id"] as string) ?? null;
    amount = (payment?.["payment_amount"] as string | number | undefined)?.toString() ?? (order?.["order_amount"] as string | number | undefined)?.toString() ?? null;
    status = (payment?.["payment_status"] as string) ?? null;
    const paymentGroup = (payment?.["payment_group"] as string) ?? null;

    logger.info({ eventType, status }, "Payin webhook received");

    // Acknowledge immediately — Cashfree only cares about a fast 2xx.
    res.json({ success: true });

    if (!cashfreeOrderId) {
      processingResult = "ignored";
      errorMessage = "Missing order_id in payload";
      await insertLog({ eventType, cashfreeOrderId: null, merchantId: null, amount, status, rawPayload: rawBody, processingResult, errorMessage });
      return;
    }

    if (status?.toUpperCase() !== "SUCCESS") {
      processingResult = "ignored";
      errorMessage = `Non-success payment status: ${status}`;
      // Track failure reason on the order for admin visibility (sanitized, no raw payload).
      await db.update(cashfreePaymentOrdersTable)
        .set({ rawProviderStatus: status ?? null, failureReason: status && status.toUpperCase() !== "SUCCESS" ? `Payment ${status}` : null })
        .where(eq(cashfreePaymentOrdersTable.cashfreeOrderId, cashfreeOrderId));
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
      logger.warn("Payin webhook: order not found in DB");
      processingResult = "ignored";
      errorMessage = "Order not found in DB";
      await insertLog({ eventType, cashfreeOrderId, merchantId: null, amount, status, rawPayload: rawBody, processingResult, errorMessage });
      return;
    }

    merchantId = cfOrder.merchantId;
    const orderId: string = cashfreeOrderId;

    const paymentId = (payment?.["cf_payment_id"] as string | number | undefined)?.toString() ?? null;
    const utrRaw = (payment?.["payment_method"] as Record<string, unknown> | undefined)?.["upi"] as Record<string, unknown> | undefined;
    const upiUtr = (utrRaw?.["utr"] as string | undefined) ?? null;
    const utr = upiUtr ?? (paymentId ? `RKPAYIN${paymentId}` : `RKPAYIN${cashfreeOrderId}`);
    const paidAmount = amount ?? cfOrder.amount?.toString() ?? "0";
    const depositAmt = Number(paidAmount);

    // ── Atomic idempotent credit: status transition + wallet credit + ledger
    // entry happen inside one DB transaction, gated on a conditional UPDATE
    // that only succeeds once per order (WHERE status != 'paid'). Concurrent
    // or duplicate webhook deliveries for the same order find zero updated
    // rows and are safely treated as duplicates — the wallet is never
    // credited twice for the same payment.
    const creditResult = await db.transaction(async (trx) => {
      const updated = await trx
        .update(cashfreePaymentOrdersTable)
        .set({
          status: "paid",
          utr,
          paymentMethod: paymentGroup ?? "upi",
          rawProviderStatus: status,
          paidAt: new Date(),
        })
        .where(and(
          eq(cashfreePaymentOrdersTable.cashfreeOrderId, orderId),
          ne(cashfreePaymentOrdersTable.status, "paid"),
        ))
        .returning({ id: cashfreePaymentOrdersTable.id, merchantId: cashfreePaymentOrdersTable.merchantId });

      if (!updated.length) {
        return { credited: false };
      }

      const [merchant] = await trx
        .select({ id: merchantsTable.id, balance: merchantsTable.balance })
        .from(merchantsTable)
        .where(eq(merchantsTable.id, cfOrder.merchantId))
        .limit(1);

      if (!merchant) {
        throw new Error("Merchant not found for payin order");
      }

      const balanceBefore = Number(merchant.balance ?? 0);
      const balanceAfter = balanceBefore + depositAmt;

      await trx.update(merchantsTable).set({
        balance: sql`CAST(COALESCE(balance, '0') AS DECIMAL) + ${depositAmt.toFixed(2)}`,
        totalDeposits: sql`CAST(COALESCE(total_deposits, '0') AS DECIMAL) + ${depositAmt.toFixed(2)}`,
        updatedAt: new Date(),
      }).where(eq(merchantsTable.id, merchant.id));

      await trx.insert(ledgerEntriesTable).values({
        merchantId: merchant.id,
        type: "deposit",
        amount: depositAmt.toFixed(2),
        balanceBefore: balanceBefore.toFixed(2),
        balanceAfter: balanceAfter.toFixed(2),
        referenceType: "payin_order",
        referenceId: updated[0]!.id,
        description: `RasoKart UPI deposit — order ${cfOrder.publicOrderId ?? cashfreeOrderId}`,
        createdBy: null,
      });

      return { credited: true };
    });

    if (!creditResult.credited) {
      logger.info("Payin webhook: order already credited (atomic check) — skipping");
      processingResult = "duplicate";
      errorMessage = "Order already credited";
      await insertLog({ eventType, cashfreeOrderId, merchantId, amount: paidAmount, status, rawPayload: rawBody, processingResult, errorMessage });
      return;
    }

    logger.info({ merchantId, amount: paidAmount }, "Payin deposit credited to wallet");
    processingResult = "credited";
    await insertLog({ eventType, cashfreeOrderId, merchantId, amount: paidAmount, status, rawPayload: rawBody, processingResult, errorMessage: null });

  } catch (err) {
    logger.error({ err }, "Payin webhook processing error");
    processingResult = "error";
    errorMessage = err instanceof Error ? err.message : String(err);
    try {
      await insertLog({ eventType, cashfreeOrderId, merchantId, amount, status, rawPayload: rawBody, processingResult: "error", errorMessage });
    } catch (logErr) {
      logger.warn({ logErr }, "Payin webhook: failed to insert log after error");
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
    logger.warn({ err }, "Payin webhook: failed to insert log");
  }
}

export default router;
