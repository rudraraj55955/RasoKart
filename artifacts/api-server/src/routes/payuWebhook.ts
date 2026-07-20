/**
 * PayU Payment Callbacks — Public Endpoints (no auth required)
 *
 *   POST /api/payment/payu-s2s      — PayU Server-to-Server webhook
 *   POST /api/payment/payu-return   — Browser redirect return (surl / furl)
 *
 * Security:
 *  - Both endpoints verify PayU response hash using SHA-512.
 *  - Atomic idempotency: only first caller with non-SUCCESS status wins.
 *  - Merchant wallet credited ONLY after verified SUCCESS + hash valid.
 *  - Duplicate callbacks return 200 (safe ACK) without re-crediting.
 *  - Hash failures are logged + rejected (401 for s2s, redirect for browser).
 */

import { Router } from "express";
import { eq, and, inArray } from "drizzle-orm";
import {
  db,
  payuPaymentOrdersTable,
  payuWebhookLogsTable,
  providerIntegrationsTable,
  systemConfigTable,
  SYSTEM_CONFIG_KEYS,
  PAYU_ORDER_STATUS,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { decryptSecret } from "../helpers/cryptoUtils";
import { verifyPayuResponseHash, type PayuEnv } from "../helpers/payu";
import { creditWalletForPayu } from "./payuOrders";

const router = Router();

// ── Credential loader (no auth context — uses logger not req.log) ─────────────

async function loadPayuSaltForEnv(env: PayuEnv): Promise<string | null> {
  const envSalt = env === "live" ? process.env["PAYU_LIVE_SALT"] : process.env["PAYU_UAT_SALT"];
  if (envSalt) return envSalt;

  const [row] = await db
    .select()
    .from(providerIntegrationsTable)
    .where(eq(providerIntegrationsTable.providerKey, "payu"))
    .limit(1);

  if (!row?.apiSecretEncrypted) return null;
  const result = decryptSecret(row.apiSecretEncrypted);
  return result.ok && result.value ? result.value : null;
}

async function loadPayuKeyForEnv(env: PayuEnv): Promise<string | null> {
  const envKey = env === "live" ? process.env["PAYU_LIVE_KEY"] : process.env["PAYU_UAT_KEY"];
  if (envKey) return envKey;

  const [row] = await db
    .select()
    .from(providerIntegrationsTable)
    .where(eq(providerIntegrationsTable.providerKey, "payu"))
    .limit(1);

  if (!row?.apiKeyEncrypted) return null;
  const result = decryptSecret(row.apiKeyEncrypted);
  return result.ok && result.value ? result.value : null;
}

// ── Log helper ────────────────────────────────────────────────────────────────

async function insertWebhookLog(params: {
  txnid: string | null;
  merchantId: number | null;
  amount: string | null;
  status: string | null;
  source: string;
  rawPayload: string;
  processingResult: "credited" | "duplicate" | "ignored" | "error" | "hash_invalid";
  hashVerified: boolean;
  errorMessage: string | null;
}) {
  try {
    await db.insert(payuWebhookLogsTable).values({
      txnid:            params.txnid ?? undefined,
      merchantId:       params.merchantId ?? undefined,
      amount:           params.amount ?? undefined,
      status:           params.status ?? undefined,
      source:           params.source,
      rawPayload:       params.rawPayload,
      processingResult: params.processingResult,
      hashVerified:     params.hashVerified,
      errorMessage:     params.errorMessage ?? undefined,
    });
  } catch (err) {
    logger.warn({ err }, "payu_webhook_log_insert_failed");
  }
}

// ── Shared payment processor ──────────────────────────────────────────────────

async function processPayuCallback(
  fields: Record<string, string>,
  rawPayload: string,
  source: "s2s_webhook" | "browser_return",
): Promise<{
  result:   "credited" | "duplicate" | "ignored" | "error" | "hash_invalid";
  txnid:    string | null;
  status:   string | null;
  merchantId: number | null;
  hashOk:   boolean;
}> {
  const txnid      = fields["txnid"] ?? null;
  const amount     = fields["amount"] ?? null;
  const productinfo = fields["productinfo"] ?? "";
  const firstname  = fields["firstname"] ?? "";
  const email      = fields["email"] ?? "";
  const status     = fields["status"] ?? null;
  const hash       = fields["hash"] ?? "";
  const udf1       = fields["udf1"] ?? "";
  const udf2       = fields["udf2"] ?? "";
  const udf3       = fields["udf3"] ?? "";
  const udf4       = fields["udf4"] ?? "";
  const udf5       = fields["udf5"] ?? "";
  const mihpayid   = fields["mihpayid"] ?? null;
  const bankRefNo  = fields["bank_ref_no"] ?? null;
  const paymentMode = fields["mode"] ?? null;

  if (!txnid) {
    return { result: "ignored", txnid: null, status, merchantId: null, hashOk: false };
  }

  // Load order to find env + merchant
  const [order] = await db
    .select()
    .from(payuPaymentOrdersTable)
    .where(eq(payuPaymentOrdersTable.txnid, txnid))
    .limit(1);

  if (!order) {
    logger.warn({ txnid, source }, "payu_callback_order_not_found");
    return { result: "ignored", txnid, status, merchantId: null, hashOk: false };
  }

  const env = (order.environment ?? "uat") as PayuEnv;
  const salt = await loadPayuSaltForEnv(env);
  const key  = await loadPayuKeyForEnv(env);

  if (!salt || !key) {
    logger.error({ txnid, source }, "payu_callback_missing_salt");
    return { result: "error", txnid, status, merchantId: order.merchantId, hashOk: false };
  }

  // Hash verification — mandatory for all status types
  const hashOk = verifyPayuResponseHash({
    key, txnid, amount: amount ?? String(order.amount), productinfo, firstname, email,
    udf1, udf2, udf3, udf4, udf5, status: status ?? "", salt, hash,
  });

  if (!hashOk) {
    logger.warn({ txnid, source }, "payu_callback_hash_invalid");
    await db.update(payuPaymentOrdersTable)
      .set({ rawResponse: rawPayload.slice(0, 4000), hashVerified: false })
      .where(and(
        eq(payuPaymentOrdersTable.txnid, txnid),
        inArray(payuPaymentOrdersTable.status, [PAYU_ORDER_STATUS.INITIATED, PAYU_ORDER_STATUS.PENDING]),
      ));
    return { result: "hash_invalid", txnid, status, merchantId: order.merchantId, hashOk: false };
  }

  // Update raw response + hash flag on the order
  await db.update(payuPaymentOrdersTable)
    .set({ rawResponse: rawPayload.slice(0, 4000), hashVerified: true })
    .where(eq(payuPaymentOrdersTable.txnid, txnid));

  const statusUpper = (status ?? "").toUpperCase();

  if (statusUpper !== "SUCCESS") {
    // FAILED / PENDING / CANCELLED — update status, do NOT credit wallet
    const newStatus =
      statusUpper === "FAILURE" || statusUpper === "FAILED"  ? PAYU_ORDER_STATUS.FAILED
      : statusUpper === "PENDING"                            ? PAYU_ORDER_STATUS.PENDING
      : statusUpper === "CANCELLED" || statusUpper === "CANCEL" ? PAYU_ORDER_STATUS.CANCELLED
      : PAYU_ORDER_STATUS.FAILED;

    const failureReason = fields["error_Message"] ?? fields["error"] ?? null;

    await db.update(payuPaymentOrdersTable)
      .set({ status: newStatus, failureReason: failureReason ?? undefined })
      .where(and(
        eq(payuPaymentOrdersTable.txnid, txnid),
        inArray(payuPaymentOrdersTable.status, [PAYU_ORDER_STATUS.INITIATED, PAYU_ORDER_STATUS.PENDING]),
      ));

    logger.info({ txnid, status, source, newStatus }, "payu_callback_non_success");
    return { result: "ignored", txnid, status, merchantId: order.merchantId, hashOk: true };
  }

  // SUCCESS — atomically credit wallet
  const creditResult = await creditWalletForPayu(txnid, mihpayid, bankRefNo, paymentMode, source);
  logger.info({ txnid, source, creditResult, mihpayid }, "payu_callback_success_processed");
  return { result: creditResult, txnid, status, merchantId: order.merchantId, hashOk: true };
}

// ── POST /api/payment/payu-s2s ────────────────────────────────────────────────

router.post("/payu-s2s", async (req, res) => {
  const body      = req.body as Record<string, string>;
  const rawPayload = JSON.stringify(body);

  // Always ACK immediately — PayU expects 200 within a few seconds
  res.json({ success: true });

  const { result, txnid, status, merchantId, hashOk } = await processPayuCallback(body, rawPayload, "s2s_webhook");
  await insertWebhookLog({
    txnid, merchantId, amount: body["amount"] ?? null, status, source: "s2s_webhook",
    rawPayload, processingResult: result === "hash_invalid" ? "hash_invalid" : result,
    hashVerified: hashOk, errorMessage: result === "error" ? "wallet credit failed" : null,
  });
});

// ── POST /api/payment/payu-return ─────────────────────────────────────────────
// Browser redirect from PayU (surl / furl). PayU POSTs form data here.
// After processing, redirect browser to merchant portal result page.

router.post("/payu-return", async (req, res) => {
  const body      = req.body as Record<string, string>;
  const rawPayload = JSON.stringify(body);
  const txnid     = body["txnid"] ?? "";
  const statusRaw = (body["status"] ?? "").toUpperCase();

  const { result, hashOk } = await processPayuCallback(body, rawPayload, "browser_return");

  await insertWebhookLog({
    txnid: txnid || null, merchantId: null, amount: body["amount"] ?? null,
    status: body["status"] ?? null, source: "browser_return",
    rawPayload, processingResult: result === "hash_invalid" ? "hash_invalid" : result,
    hashVerified: hashOk, errorMessage: result === "error" ? "wallet credit failed" : null,
  });

  if (!hashOk) {
    res.redirect(`/merchant/deposits?payu_status=hash_invalid&txnid=${encodeURIComponent(txnid)}`);
    return;
  }

  if (statusRaw === "SUCCESS" || result === "credited" || result === "duplicate") {
    res.redirect(`/merchant/deposits?payu_status=success&txnid=${encodeURIComponent(txnid)}`);
  } else if (statusRaw === "PENDING") {
    res.redirect(`/merchant/deposits?payu_status=pending&txnid=${encodeURIComponent(txnid)}`);
  } else if (statusRaw === "CANCELLED" || statusRaw === "CANCEL") {
    res.redirect(`/merchant/deposits?payu_status=cancelled&txnid=${encodeURIComponent(txnid)}`);
  } else {
    const errMsg = encodeURIComponent(body["error_Message"] ?? body["error"] ?? "Payment failed");
    res.redirect(`/merchant/deposits?payu_status=failed&txnid=${encodeURIComponent(txnid)}&error=${errMsg}`);
  }
});

export default router;
