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
import { notifyAdminsOfPayuCreditFailure } from "../helpers/adminNotifyEmail";

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

  if (!row) return null;

  // Live Salt → clientSecretEncrypted  |  UAT Salt → apiSecretEncrypted
  const encrypted = env === "live" ? row.clientSecretEncrypted : row.apiSecretEncrypted;
  if (!encrypted) return null;
  const result = decryptSecret(encrypted);
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

  if (!row) return null;

  // Live Key → clientIdEncrypted  |  UAT Key → apiKeyEncrypted
  const encrypted = env === "live" ? row.clientIdEncrypted : row.apiKeyEncrypted;
  if (!encrypted) return null;
  const result = decryptSecret(encrypted);
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
  processingResult: "credited" | "duplicate" | "credit_failed" | "ignored" | "error" | "hash_invalid";
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
  result:     "credited" | "duplicate" | "credit_failed" | "ignored" | "error" | "hash_invalid";
  txnid:      string | null;
  status:     string | null;
  merchantId: number | null;
  amount:     string | null;
  hashOk:     boolean;
}> {
  // Hoist txnid/amount/status so the outer catch can reference them in its return
  const txnid  = fields["txnid"]  ?? null;
  const amount = fields["amount"] ?? null;
  const status = fields["status"] ?? null;

  // Outer try/catch: ensures NO unhandled async throw escapes to the Express error handler.
  // Without this, any DB error inside the function propagates to the global error handler
  // (Express 5 auto-catches async rejections) which returns INTERNAL_ERROR JSON to the
  // customer's browser instead of a clean redirect — even after a valid payment.
  try {
    const productinfo = fields["productinfo"] ?? "";
    const firstname   = fields["firstname"]   ?? "";
    const email       = fields["email"]       ?? "";
    const hash        = fields["hash"]        ?? "";
    const udf1        = fields["udf1"]        ?? "";
    const udf2        = fields["udf2"]        ?? "";
    const udf3        = fields["udf3"]        ?? "";
    const udf4        = fields["udf4"]        ?? "";
    const udf5        = fields["udf5"]        ?? "";
    const mihpayid    = fields["mihpayid"]    ?? null;
    const bankRefNo   = fields["bank_ref_no"] ?? null;
    const paymentMode = fields["mode"]        ?? null;

    if (!txnid) {
      return { result: "ignored", txnid: null, status, merchantId: null, amount, hashOk: false };
    }

    // Load order to find env + merchant
    const [order] = await db
      .select()
      .from(payuPaymentOrdersTable)
      .where(eq(payuPaymentOrdersTable.txnid, txnid))
      .limit(1);

    if (!order) {
      logger.warn({ txnid, source }, "payu_callback_order_not_found");
      return { result: "ignored", txnid, status, merchantId: null, amount, hashOk: false };
    }

    const env  = (order.environment ?? "uat") as PayuEnv;
    const salt = await loadPayuSaltForEnv(env);
    const key  = await loadPayuKeyForEnv(env);

    if (!salt || !key) {
      logger.error({ txnid, source }, "payu_callback_missing_salt");
      return { result: "error", txnid, status, merchantId: order.merchantId, amount, hashOk: false };
    }

    // Hash verification — mandatory for all status types
    const hashOk = verifyPayuResponseHash({
      key, txnid, amount: amount ?? String(order.amount), productinfo, firstname, email,
      udf1, udf2, udf3, udf4, udf5, status: status ?? "", salt, hash,
    });

    if (!hashOk) {
      logger.warn({ txnid, source }, "payu_callback_hash_invalid");
      // Best-effort audit write — MUST NOT block the hash_invalid return if it fails.
      // raw_response / hash_verified are informational columns; a write failure here
      // must never prevent the caller from redirecting the customer cleanly.
      try {
        await db.update(payuPaymentOrdersTable)
          .set({ rawResponse: rawPayload.slice(0, 4000), hashVerified: false })
          .where(and(
            eq(payuPaymentOrdersTable.txnid, txnid),
            inArray(payuPaymentOrdersTable.status, [PAYU_ORDER_STATUS.INITIATED, PAYU_ORDER_STATUS.PENDING]),
          ));
      } catch (rawErr) {
        logger.warn({ rawErr, txnid, source }, "payu_raw_response_update_failed_hash_invalid");
      }
      return { result: "hash_invalid", txnid, status, merchantId: order.merchantId, amount, hashOk: false };
    }

    // Best-effort: persist raw response + hash flag for audit.
    // A failure here MUST NOT block the wallet credit — raw_response is informational only.
    // Schema-drift on the VPS (e.g. column added post-initial-deploy without an ALTER TABLE
    // guard) would cause this to throw; wrapping it prevents that from killing the credit.
    try {
      await db.update(payuPaymentOrdersTable)
        .set({ rawResponse: rawPayload.slice(0, 4000), hashVerified: true })
        .where(eq(payuPaymentOrdersTable.txnid, txnid));
    } catch (rawErr) {
      logger.warn({ rawErr, txnid, source }, "payu_raw_response_update_failed");
      // Continue — do not abort the credit because of an audit-column write failure
    }

    const statusUpper = (status ?? "").toUpperCase();

    if (statusUpper !== "SUCCESS") {
      // FAILED / PENDING / CANCELLED — update status, do NOT credit wallet
      const newStatus =
        statusUpper === "FAILURE" || statusUpper === "FAILED"     ? PAYU_ORDER_STATUS.FAILED
        : statusUpper === "PENDING"                               ? PAYU_ORDER_STATUS.PENDING
        : statusUpper === "CANCELLED" || statusUpper === "CANCEL" ? PAYU_ORDER_STATUS.CANCELLED
        : PAYU_ORDER_STATUS.FAILED;

      const failureReason = fields["error_Message"] ?? fields["error"] ?? null;

      // Best-effort status update — if it fails, order stays INITIATED (visible in admin view).
      try {
        await db.update(payuPaymentOrdersTable)
          .set({ status: newStatus, failureReason: failureReason ?? undefined })
          .where(and(
            eq(payuPaymentOrdersTable.txnid, txnid),
            inArray(payuPaymentOrdersTable.status, [PAYU_ORDER_STATUS.INITIATED, PAYU_ORDER_STATUS.PENDING]),
          ));
      } catch (statusErr) {
        logger.warn({ statusErr, txnid, source, newStatus }, "payu_status_update_failed");
      }

      logger.info({ txnid, status, source, newStatus }, "payu_callback_non_success");
      return { result: "ignored", txnid, status, merchantId: order.merchantId, amount, hashOk: true };
    }

    // SUCCESS — atomically credit wallet
    const creditResult = await creditWalletForPayu(txnid, mihpayid, bankRefNo, paymentMode, source);

    if (creditResult.outcome === "error") {
      // Hash verified + PayU confirmed payment, but wallet credit failed.
      // Fire admin alert — the order is now flagged CREDIT_FAILED in the DB.
      logger.error(
        { txnid, source, merchantId: creditResult.merchantId, amount: creditResult.amount },
        "payu_credit_failed_after_hash_verified",
      );
      notifyAdminsOfPayuCreditFailure({
        txnid,
        merchantId: creditResult.merchantId,
        amount:     creditResult.amount ?? amount,
        source,
      }).catch(err => logger.error({ err, txnid }, "payu_credit_failure_notification_error"));
    }

    logger.info({ txnid, source, outcome: creditResult.outcome, mihpayid }, "payu_callback_success_processed");

    const resultOutcome: "credited" | "duplicate" | "credit_failed" | "error" = creditResult.outcome;
    return {
      result:     resultOutcome,
      txnid,
      status,
      merchantId: creditResult.outcome === "error" ? creditResult.merchantId : order.merchantId,
      amount,
      hashOk:     true,
    };

  } catch (err) {
    // Unexpected error (DB connection failure, runtime exception, etc.).
    // Return a structured error result so the caller can redirect cleanly.
    logger.error({ err, source, txnid }, "payu_callback_unexpected_error");
    return {
      result:     "error",
      txnid,
      status,
      merchantId: null,
      amount,
      hashOk:     false,
    };
  }
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
    rawPayload,
    processingResult: result === "hash_invalid" ? "hash_invalid"
      : result === "credit_failed" ? "credit_failed"
      : result,
    hashVerified: hashOk,
    errorMessage: result === "error" ? "wallet credit failed — order flagged CREDIT_FAILED"
      : result === "credit_failed" ? "order already in CREDIT_FAILED state"
      : null,
  });
});

// ── GET /api/payment/payu-return ──────────────────────────────────────────────
// Direct GET (browser refresh, manual URL open) — redirect safely rather than 404.
router.get("/payu-return", (_req, res) => {
  res.redirect("/merchant/deposits");
});

// ── POST /api/payment/payu-return ─────────────────────────────────────────────
// Browser redirect from PayU (surl / furl). PayU POSTs form data here.
// After processing, ALWAYS redirect to the merchant portal result page.
//
// Why try/catch wraps the ENTIRE body: Express 5 auto-catches unhandled async
// rejections from async route handlers and passes them to the global error handler,
// which returns INTERNAL_ERROR JSON to the browser — even after a valid payment.
//
// Additional safety: req.body is defaulted to {} so that missing/mismatched
// Content-Type (body parser no-op) cannot throw before the try/catch runs.

router.post("/payu-return", async (req, res) => {
  // Default to empty object when body parser didn't run (wrong Content-Type, etc.)
  const body      = (typeof req.body === "object" && req.body !== null
    ? req.body : {}) as Record<string, string>;
  const rawPayload = JSON.stringify(body);
  const txnid      = body["txnid"] ?? "";
  const statusRaw  = (body["status"] ?? "").toUpperCase();

  try {
    const { result, hashOk, merchantId } = await processPayuCallback(body, rawPayload, "browser_return");

    await insertWebhookLog({
      txnid: txnid || null, merchantId, amount: body["amount"] ?? null,
      status: body["status"] ?? null, source: "browser_return",
      rawPayload,
      processingResult: result === "hash_invalid" ? "hash_invalid"
        : result === "credit_failed" ? "credit_failed"
        : result,
      hashVerified: hashOk,
      errorMessage: result === "error" ? "wallet credit failed — order flagged CREDIT_FAILED"
        : result === "credit_failed" ? "order already in CREDIT_FAILED state"
        : null,
    });

    if (!hashOk) {
      res.redirect(`/merchant/deposits?payu_status=hash_invalid&txnid=${encodeURIComponent(txnid)}`);
      return;
    }

    if (result === "error" || result === "credit_failed") {
      // Wallet credit failed (or was already marked failed by S2S).
      // Show a neutral pending state — the merchant's payment was collected by PayU
      // but their wallet was NOT credited. Admins are alerted to reconcile manually.
      res.redirect(`/merchant/deposits?payu_status=pending&txnid=${encodeURIComponent(txnid)}`);
    } else if (result === "credited" || result === "duplicate" || statusRaw === "SUCCESS") {
      res.redirect(`/merchant/deposits?payu_status=success&txnid=${encodeURIComponent(txnid)}`);
    } else if (statusRaw === "PENDING") {
      res.redirect(`/merchant/deposits?payu_status=pending&txnid=${encodeURIComponent(txnid)}`);
    } else if (statusRaw === "CANCELLED" || statusRaw === "CANCEL") {
      res.redirect(`/merchant/deposits?payu_status=cancelled&txnid=${encodeURIComponent(txnid)}`);
    } else {
      const errMsg = encodeURIComponent(body["error_Message"] ?? body["error"] ?? "Payment failed");
      res.redirect(`/merchant/deposits?payu_status=failed&txnid=${encodeURIComponent(txnid)}&error=${errMsg}`);
    }
  } catch (err) {
    // Defense-in-depth: processPayuCallback already has its own outer catch so this
    // branch fires only if insertWebhookLog itself throws unexpectedly (its own internal
    // catch normally swallows those) or some other truly unforeseen synchronous error.
    // Never expose raw INTERNAL_ERROR JSON to the customer after a real payment.
    // Redirect to pending — the S2S webhook credits the wallet independently.
    logger.error({ err, txnid, source: "browser_return" }, "payu_return_handler_unexpected_error");
    res.redirect(`/merchant/deposits?payu_status=pending&txnid=${encodeURIComponent(txnid)}`);
  }
});

export default router;
