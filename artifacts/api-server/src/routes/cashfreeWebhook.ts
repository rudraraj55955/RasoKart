import { Router } from "express";
import {
  db,
  cashfreePaymentOrdersTable,
  cashfreePaymentLogsTable,
  transactionsTable,
  systemConfigTable,
  SYSTEM_CONFIG_KEYS,
  PAYIN_ORDER_STATUS,
  payoutWalletLoadOrdersTable,
  merchantWalletsTable,
  walletLedgerTable,
} from "@workspace/db";
import { eq, and, ne, inArray } from "drizzle-orm";
import { logger } from "../lib/logger";
import { verifyCashfreeWebhookSignature } from "../helpers/cashfree";
import { decryptSecret } from "../helpers/cryptoUtils";
import { creditWalletForLoad } from "./payoutWalletLoad";

const router = Router();

/**
 * POST /api/payment/cashfree-webhook
 *
 * Public endpoint — called by Cashfree when a payment is confirmed.
 *
 * SIGNATURE ENFORCEMENT (fail-closed):
 *   Signing key resolution order:
 *     1. cashfree_webhook_secret (system_config) — explicit Cashfree webhook secret
 *     2. cashfree_client_secret  (system_config) — payin client secret as fallback
 *     3. Neither present → 401 (never bypass)
 *
 *   Algorithm: HMAC-SHA256(timestamp + rawBody, secret) → base64
 *   Headers:   x-webhook-signature, x-webhook-timestamp
 *
 * ACCOUNTING (on verified SUCCESS):
 *   All mutations run in a single DB transaction so a partial failure rolls back
 *   entirely and Cashfree's retry delivery will re-attempt rather than leaving a
 *   half-credited state. The transaction:
 *     1. Atomic status update  cashfree_payment_orders → PAID  (idempotency gate)
 *     2. Wallet upsert (ensure row exists)
 *     3. SELECT FOR UPDATE on wallet row (prevents concurrent balance corruption)
 *     4. UPDATE merchantWallets: pendingBalance ↑, totalCollection ↑
 *     5. INSERT walletLedger (pending_credit, immutable audit row)
 *     6. INSERT transactions (idempotent on UTR)
 *
 * Idempotency: step 1's conditional UPDATE returns 0 rows when already PAID → early
 * exit with processingResult=duplicate; no wallet/ledger mutation occurs.
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
    // ── Signature verification — FAIL CLOSED ──────────────────────────────
    // Load both candidate secrets in one round-trip. Both keys are stored
    // encrypted (enc:v1:…) when saved via Admin UI. resolveSecret() decrypts
    // with a plaintext fallback so both paths work regardless of how the
    // value was stored.
    const secretRows = await db
      .select({ key: systemConfigTable.key, value: systemConfigTable.value })
      .from(systemConfigTable)
      .where(inArray(systemConfigTable.key, [
        SYSTEM_CONFIG_KEYS.CASHFREE_WEBHOOK_SECRET,
        SYSTEM_CONFIG_KEYS.CASHFREE_CLIENT_SECRET,
      ]));

    const secretMap = new Map(secretRows.map(r => [r.key, r.value]));

    function resolveSecret(key: string): string | null {
      const raw = secretMap.get(key);
      if (!raw) return null;
      const decrypted = decryptSecret(raw);
      const value = (decrypted.ok ? decrypted.value : raw).trim();
      return value || null;
    }

    const webhookSecret  = resolveSecret(SYSTEM_CONFIG_KEYS.CASHFREE_WEBHOOK_SECRET);
    const clientSecretFb = resolveSecret(SYSTEM_CONFIG_KEYS.CASHFREE_CLIENT_SECRET);
    const signingSecret  = webhookSecret ?? clientSecretFb;

    // No signing credential configured → reject; never fall through to credit path.
    if (!signingSecret) {
      logger.error({}, "cashfree_payin_webhook_no_secret: rejected (fail-closed) — configure cashfree_webhook_secret or cashfree_client_secret");
      res.status(401).json({ error: "Webhook signing not configured" });
      return;
    }

    const valid = verifyCashfreeWebhookSignature(
      rawBody,
      timestamp ?? "",
      signature ?? "",
      signingSecret,
    );
    if (!valid) {
      logger.warn({ signingSource: webhookSecret ? "webhook_secret" : "client_secret_fallback" },
        "cashfree_payin_webhook_invalid_sig: rejected");
      res.status(401).json({ error: "Invalid webhook signature" });
      return;
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

    // Acknowledge immediately — Cashfree requires a fast 200 ACK.
    // All DB work below happens after the response is sent.
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

    // ── WALLET LOAD: orders prefixed WLOAD_ are payout wallet top-ups ──────
    if (cashfreeOrderId.startsWith("WLOAD_")) {
      const providerPaymentId = (payment?.["cf_payment_id"] as string | number | undefined)?.toString() ?? null;
      const [loadOrder] = await db
        .select()
        .from(payoutWalletLoadOrdersTable)
        .where(eq(payoutWalletLoadOrdersTable.internalOrderId, cashfreeOrderId))
        .limit(1);

      if (!loadOrder) {
        logger.warn({ cashfreeOrderId }, "Cashfree wallet load webhook: load order not found");
        await insertLog({ eventType, cashfreeOrderId, merchantId: null, amount, status, rawPayload: rawBody, processingResult: "ignored", errorMessage: "Wallet load order not found" });
        return;
      }

      merchantId = loadOrder.merchantId;
      const creditResult = await creditWalletForLoad(loadOrder, providerPaymentId);
      processingResult = creditResult === "credited" ? "credited" : creditResult === "duplicate" ? "duplicate" : "error";
      errorMessage     = creditResult === "error" ? "Wallet credit failed" : null;
      logger.info({ cashfreeOrderId, loadId: loadOrder.loadId, creditResult }, "Cashfree wallet load webhook processed");
      await insertLog({ eventType, cashfreeOrderId, merchantId, amount, status, rawPayload: rawBody, processingResult, errorMessage });
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

    // Compute UTR and amount outside the transaction (pure derivation, no I/O)
    const paymentId = (payment?.["cf_payment_id"] as string | number | undefined)?.toString() ?? null;
    const utr       = paymentId ? `CF-${paymentId}` : `CF-${cashfreeOrderId}`;
    const paidAmount = amount ?? cfOrder.amount?.toString() ?? "0";
    const paidAmountNum = parseFloat(paidAmount);

    // ── Atomic credit: status + wallet + ledger in one transaction ─────────
    // If any step fails, the entire transaction rolls back.
    // The order status stays non-PAID so Cashfree's retry delivery re-attempts.
    type CreditResult = "credited" | "duplicate";
    const creditResult: CreditResult = await db.transaction(async (tx) => {
      // Step 1: Atomic idempotency gate — only one concurrent delivery wins.
      const updated = await tx
        .update(cashfreePaymentOrdersTable)
        .set({ status: PAYIN_ORDER_STATUS.PAID })
        .where(and(
          eq(cashfreePaymentOrdersTable.cashfreeOrderId, cashfreeOrderId!),
          ne(cashfreePaymentOrdersTable.status, PAYIN_ORDER_STATUS.PAID),
        ))
        .returning({ id: cashfreePaymentOrdersTable.id });

      if (!updated.length) {
        // Already PAID — this is a duplicate delivery; skip all accounting.
        return "duplicate";
      }

      // Step 2: Ensure wallet row exists for this merchant.
      await tx
        .insert(merchantWalletsTable)
        .values({ merchantId: cfOrder.merchantId })
        .onConflictDoNothing();

      // Step 3: Lock the wallet row to prevent concurrent balance corruption.
      const [wallet] = await tx
        .select()
        .from(merchantWalletsTable)
        .where(eq(merchantWalletsTable.merchantId, cfOrder.merchantId))
        .for("update");

      if (!wallet) throw new Error(`Cashfree payin: wallet not found after upsert for merchantId=${cfOrder.merchantId}`);

      const pendingBefore   = parseFloat(wallet.pendingBalance   ?? "0");
      const availableBefore = parseFloat(wallet.availableBalance ?? "0");
      const pendingAfter    = pendingBefore + paidAmountNum;
      const totalCollection = parseFloat(wallet.totalCollection  ?? "0") + paidAmountNum;

      // Step 4: Credit the pending bucket and update total collection.
      await tx
        .update(merchantWalletsTable)
        .set({
          pendingBalance:  String(pendingAfter),
          totalCollection: String(totalCollection),
        })
        .where(eq(merchantWalletsTable.merchantId, cfOrder.merchantId));

      // Step 5: Immutable ledger audit row.
      await tx.insert(walletLedgerTable).values({
        merchantId:      cfOrder.merchantId,
        txnType:         "pending_credit",
        bucket:          "pending",
        amount:          paidAmount,
        availableBefore: String(availableBefore),
        availableAfter:  String(availableBefore),   // available unchanged; credit goes to pending
        pendingBefore:   String(pendingBefore),
        pendingAfter:    String(pendingAfter),
        referenceType:   "transaction",
        description:     `Cashfree payment credited — order ${cashfreeOrderId}, ref ${utr}`,
      });

      // Step 6: Transaction record — idempotent on UTR unique constraint.
      await tx.insert(transactionsTable).values({
        merchantId:  cfOrder.merchantId,
        provider:    "cashfree",
        type:        "deposit",
        status:      "success",
        amount:      paidAmount,
        currency:    cfOrder.currency ?? "INR",
        utr,
        referenceId: cashfreeOrderId!,
        description: `Cashfree payment — order ${cashfreeOrderId}`,
        metadata:    rawBody,
      }).onConflictDoNothing();

      return "credited";
    });

    if (creditResult === "duplicate") {
      logger.info({ cashfreeOrderId }, "Cashfree webhook: order already credited (atomic check) — skipping");
      processingResult = "duplicate";
      errorMessage = "Order already credited";
    } else {
      logger.info({ cashfreeOrderId, merchantId, amount: paidAmount, utr }, "Cashfree payin credited — wallet and ledger updated");
      processingResult = "credited";
    }

    await insertLog({ eventType, cashfreeOrderId, merchantId, amount: paidAmount, status, rawPayload: rawBody, processingResult, errorMessage: null });

  } catch (err) {
    // DB transaction rolled back — order status is still non-PAID.
    // Cashfree will retry delivery; the next attempt will re-attempt the full credit.
    logger.error({ err, cashfreeOrderId }, "Cashfree webhook processing error — transaction rolled back; Cashfree will retry");
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
