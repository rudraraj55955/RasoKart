import { Router } from "express";
import { db, cashfreePaymentOrdersTable, cashfreePaymentLogsTable, ledgerEntriesTable, merchantsTable, systemConfigTable, SYSTEM_CONFIG_KEYS } from "@workspace/db";
import { eq, and, ne, sql, inArray } from "drizzle-orm";
import { logger } from "../lib/logger";
import { verifyCashfreeWebhookSignature } from "../helpers/cashfree";
import { decryptSecret } from "../helpers/cryptoUtils";

const router = Router();

/** Masks an order id for safe logging — keeps only a short prefix/suffix. */
function maskOrderId(id: string | null | undefined): string {
  if (!id) return "unknown";
  if (id.length <= 8) return `${id[0]}***`;
  return `${id.slice(0, 4)}***${id.slice(-4)}`;
}

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
 *
 * Signature verification rules (Cashfree PG):
 *   signedPayload = x-webhook-timestamp + rawBody (exact bytes, before JSON parsing)
 *   expected      = base64(HMAC_SHA256(signedPayload, secret))
 * Tries the configured webhookSecret first, then falls back to the Client Secret —
 * Cashfree PG webhooks are commonly signed with the Client Secret unless a distinct
 * webhook secret was explicitly configured for the endpoint.
 */
router.post("/cashfree", async (req, res) => {
  // Raw body MUST be the exact bytes Express captured via the JSON body-parser's
  // `verify` hook (see app.ts) — never JSON.stringify(req.body), which can reorder
  // keys / change whitespace and silently break signature verification.
  const rawBodyBuffer = (req as any).rawBody as Buffer | undefined;
  const rawBody = rawBodyBuffer ? rawBodyBuffer.toString("utf8") : "";
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

  logger.info({
    event: "payin_webhook_received",
    endpoint: "/api/webhooks/payin/cashfree",
    hasSignature: Boolean(signature),
    hasTimestamp: Boolean(timestamp),
    rawBodyLength: rawBody.length,
  }, "payin_webhook_received");

  try {
    // ── Signature verification (fail-closed only when at least one candidate
    // secret is configured). Tries CASHFREE_WEBHOOK_SECRET first, then falls
    // back to CASHFREE_CLIENT_SECRET — both decrypted and trimmed. ──────────
    const secretRows = await db
      .select({ key: systemConfigTable.key, value: systemConfigTable.value })
      .from(systemConfigTable)
      .where(inArray(systemConfigTable.key, [SYSTEM_CONFIG_KEYS.CASHFREE_WEBHOOK_SECRET, SYSTEM_CONFIG_KEYS.CASHFREE_CLIENT_SECRET]));

    const secretMap = new Map(secretRows.map((r) => [r.key, r.value]));

    function resolveSecret(key: string): string | null {
      const raw = secretMap.get(key);
      if (!raw) return null;
      const decrypted = decryptSecret(raw);
      const value = (decrypted.ok ? decrypted.value : raw).trim();
      return value || null;
    }

    const webhookSecret = resolveSecret(SYSTEM_CONFIG_KEYS.CASHFREE_WEBHOOK_SECRET);
    const clientSecret = resolveSecret(SYSTEM_CONFIG_KEYS.CASHFREE_CLIENT_SECRET);
    const candidateSecrets = [webhookSecret, clientSecret].filter((s): s is string => Boolean(s));

    if (candidateSecrets.length > 0) {
      logger.info({ event: "payin_webhook_signature_check_started", triedWebhookSecret: Boolean(webhookSecret), triedClientSecret: Boolean(clientSecret) }, "payin_webhook_signature_check_started");

      const valid = candidateSecrets.some((secret) => verifyCashfreeWebhookSignature(rawBody, timestamp ?? "", signature ?? "", secret));

      if (!valid) {
        logger.warn({ event: "payin_webhook_signature_check_failed", hasSignature: Boolean(signature), hasTimestamp: Boolean(timestamp), httpStatus: 401 }, "payin_webhook_signature_check_failed");
        res.status(401).json({ error: "Invalid webhook signature" });
        return;
      }
      logger.info({ event: "payin_webhook_signature_check_success" }, "payin_webhook_signature_check_success");
    } else {
      logger.warn("Payin webhook: no webhook/client secret configured — accepting without signature verification");
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

    if (!cashfreeOrderId) {
      res.json({ success: true, message: "Webhook verified, no order id in payload" });
      processingResult = "ignored";
      errorMessage = "Missing order_id in payload";
      logger.info({ event: "payin_webhook_processed", eventType, orderId: maskOrderId(null), processingResult, httpStatus: 200 }, "payin_webhook_processed");
      await insertLog({ eventType, cashfreeOrderId: null, merchantId: null, amount, status, rawPayload: rawBody, processingResult, errorMessage });
      return;
    }

    // ── Look up the order in our DB — determines the exact ack we send back.
    // Cashfree's dashboard "Test" button sends a dummy order_id that will
    // never exist in our DB; that must still ack 200 (signature already
    // passed), never 401/500, and must never trigger a wallet credit. ──────
    const [cfOrder] = await db
      .select()
      .from(cashfreePaymentOrdersTable)
      .where(eq(cashfreePaymentOrdersTable.cashfreeOrderId, cashfreeOrderId))
      .limit(1);

    if (!cfOrder) {
      res.json({ success: true, message: "Webhook verified, order not found for test payload" });
      logger.warn({ event: "payin_webhook_processed", eventType, orderId: maskOrderId(cashfreeOrderId), processingResult: "ignored", httpStatus: 200 }, "payin_webhook_processed");
      processingResult = "ignored";
      errorMessage = "Order not found in DB";
      await insertLog({ eventType, cashfreeOrderId, merchantId: null, amount, status, rawPayload: rawBody, processingResult, errorMessage });
      return;
    }

    if (status?.toUpperCase() !== "SUCCESS") {
      res.json({ success: true });
      processingResult = "ignored";
      errorMessage = `Non-success payment status: ${status}`;
      // Track failure reason on the order for admin visibility (sanitized, no raw payload).
      await db.update(cashfreePaymentOrdersTable)
        .set({ rawProviderStatus: status ?? null, failureReason: status && status.toUpperCase() !== "SUCCESS" ? `Payment ${status}` : null })
        .where(eq(cashfreePaymentOrdersTable.cashfreeOrderId, cashfreeOrderId));
      logger.info({ event: "payin_webhook_processed", eventType, orderId: maskOrderId(cashfreeOrderId), processingResult, httpStatus: 200 }, "payin_webhook_processed");
      await insertLog({ eventType, cashfreeOrderId, merchantId: null, amount, status, rawPayload: rawBody, processingResult, errorMessage });
      return;
    }

    // Acknowledge success case immediately after validation — the credit
    // transaction below is fast and idempotent regardless of whether the ack
    // has already been flushed to the client.
    res.json({ success: true });

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
      processingResult = "duplicate";
      errorMessage = "Order already credited";
      logger.info({ event: "payin_webhook_processed", eventType, orderId: maskOrderId(cashfreeOrderId), processingResult, httpStatus: 200 }, "payin_webhook_processed");
      await insertLog({ eventType, cashfreeOrderId, merchantId, amount: paidAmount, status, rawPayload: rawBody, processingResult, errorMessage });
      return;
    }

    processingResult = "credited";
    logger.info({ event: "payin_webhook_processed", eventType, orderId: maskOrderId(cashfreeOrderId), processingResult, httpStatus: 200 }, "payin_webhook_processed");
    await insertLog({ eventType, cashfreeOrderId, merchantId, amount: paidAmount, status, rawPayload: rawBody, processingResult, errorMessage: null });

  } catch (err) {
    processingResult = "error";
    errorMessage = err instanceof Error ? err.message : String(err);
    logger.error({ event: "payin_webhook_processed", eventType, orderId: maskOrderId(cashfreeOrderId), processingResult, httpStatus: res.headersSent ? res.statusCode : 500 }, "payin_webhook_processed");
    if (!res.headersSent) {
      // Never surface a 401/500 once we get this far — signature checks and
      // validation already happened; an unexpected internal error must still
      // ack so Cashfree doesn't retry-storm us. Wallet crediting is safely
      // idempotent via the atomic conditional UPDATE above.
      res.json({ success: true });
    }
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
