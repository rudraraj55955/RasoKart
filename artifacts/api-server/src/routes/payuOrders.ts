/**
 * PayU Hosted Checkout — Merchant-Facing Routes
 *
 * Security: PayU credentials are NEVER returned to the frontend.
 * Hash generation is server-side only. Transaction IDs are unique per request.
 *
 * Routes:
 *   GET  /api/merchant/payu/status           — is PayU enabled + environment
 *   POST /api/merchant/payu/initiate         — create order + return form params
 *   GET  /api/merchant/payu/check/:txnid     — status enquiry via PayU Verify API
 */

import { Router } from "express";
import { eq, and, inArray, sql, ne } from "drizzle-orm";
import {
  db,
  payuPaymentOrdersTable,
  providerIntegrationsTable,
  merchantWalletsTable,
  walletLedgerTable,
  transactionsTable,
  systemConfigTable,
  SYSTEM_CONFIG_KEYS,
  PAYU_ORDER_STATUS,
} from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { decryptSecret } from "../helpers/cryptoUtils";
import {
  generatePayuHash,
  generatePayuTxnId,
  queryPayuTransactionStatus,
  PAYU_PAYMENT_URL,
  type PayuEnv,
} from "../helpers/payu";

const router = Router();

// ── Credential loader ──────────────────────────────────────────────────────────

/**
 * Load PayU credentials for the given environment.
 * Priority: env vars → provider_integrations table (encrypted).
 * Returns null if credentials are missing or fail to decrypt.
 * NEVER logs or returns raw credential values.
 */
async function loadPayuCreds(env: PayuEnv): Promise<{ key: string; salt: string } | null> {
  const envKey  = env === "live" ? process.env["PAYU_LIVE_KEY"]  : process.env["PAYU_UAT_KEY"];
  const envSalt = env === "live" ? process.env["PAYU_LIVE_SALT"] : process.env["PAYU_UAT_SALT"];
  if (envKey && envSalt) return { key: envKey, salt: envSalt };

  const [row] = await db
    .select()
    .from(providerIntegrationsTable)
    .where(eq(providerIntegrationsTable.providerKey, "payu"))
    .limit(1);

  if (!row) return null;

  const keyResult  = row.apiKeyEncrypted    ? decryptSecret(row.apiKeyEncrypted)    : null;
  const saltResult = row.apiSecretEncrypted ? decryptSecret(row.apiSecretEncrypted) : null;

  if (!keyResult?.ok || !saltResult?.ok)  return null;
  if (!keyResult.value || !saltResult.value) return null;

  return { key: keyResult.value, salt: saltResult.value };
}

// ── Load PayU system config ───────────────────────────────────────────────────

async function loadPayuConfig(): Promise<{
  enabled: boolean;
  env: PayuEnv;
  suspended: boolean;
  minAmount: number;
  maxAmount: number;
  dailyLimit: number;
}> {
  const keys = [
    SYSTEM_CONFIG_KEYS.PAYU_ENABLED,
    SYSTEM_CONFIG_KEYS.PAYU_ENV,
    SYSTEM_CONFIG_KEYS.PAYU_SUSPENDED,
    SYSTEM_CONFIG_KEYS.PAYU_MIN_AMOUNT,
    SYSTEM_CONFIG_KEYS.PAYU_MAX_AMOUNT,
    SYSTEM_CONFIG_KEYS.PAYU_DAILY_LIMIT,
  ];
  const rows = await db.select().from(systemConfigTable).where(inArray(systemConfigTable.key, keys));
  const cfg = new Map(rows.map(r => [r.key, r.value]));
  return {
    enabled:    cfg.get(SYSTEM_CONFIG_KEYS.PAYU_ENABLED)   === "true",
    suspended:  cfg.get(SYSTEM_CONFIG_KEYS.PAYU_SUSPENDED) === "true",
    env:       (cfg.get(SYSTEM_CONFIG_KEYS.PAYU_ENV)       ?? "uat") as PayuEnv,
    minAmount:  parseFloat(cfg.get(SYSTEM_CONFIG_KEYS.PAYU_MIN_AMOUNT) ?? "1"),
    maxAmount:  parseFloat(cfg.get(SYSTEM_CONFIG_KEYS.PAYU_MAX_AMOUNT) ?? "200000"),
    dailyLimit: parseFloat(cfg.get(SYSTEM_CONFIG_KEYS.PAYU_DAILY_LIMIT) ?? "1000000"),
  };
}

// ── GET /api/merchant/payu/status ─────────────────────────────────────────────

router.get("/payu/status", requireAuth, async (req, res, next) => {
  try {
    const cfg = await loadPayuConfig();
    res.json({
      enabled:   !cfg.suspended && cfg.enabled,
      suspended: cfg.suspended,
      env:       cfg.env,
    });
  } catch (err) { next(err); }
});

// ── POST /api/merchant/payu/initiate ──────────────────────────────────────────
// Returns form params needed to redirect user to PayU Hosted Checkout.
// Credentials and hash computation stay server-side — never returned to client.

router.post("/payu/initiate", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (user.role !== "merchant" || !user.merchantId) {
      res.status(403).json({ error: "Merchant access only" });
      return;
    }

    const { amount, customerPhone, customerName, customerEmail, note } = req.body as {
      amount?: unknown;
      customerPhone?: unknown;
      customerName?: unknown;
      customerEmail?: unknown;
      note?: unknown;
    };

    const amountNum = parseFloat(String(amount ?? "0"));
    if (!amount || isNaN(amountNum) || amountNum <= 0) {
      res.status(400).json({ error: "Valid amount is required" });
      return;
    }
    if (!customerPhone || String(customerPhone).trim().length < 10) {
      res.status(400).json({ error: "customerPhone is required (min 10 digits)" });
      return;
    }

    const cfg = await loadPayuConfig();

    if (cfg.suspended) {
      res.status(503).json({ error: "PayU payment service is temporarily unavailable. Please try another method." });
      return;
    }
    if (!cfg.enabled) {
      res.status(400).json({ error: "PayU payment gateway is not enabled" });
      return;
    }
    if (amountNum < cfg.minAmount) {
      res.status(400).json({ error: `Minimum amount is ₹${cfg.minAmount}` });
      return;
    }
    if (amountNum > cfg.maxAmount) {
      res.status(400).json({ error: `Maximum amount is ₹${cfg.maxAmount}` });
      return;
    }

    const creds = await loadPayuCreds(cfg.env);
    if (!creds) {
      res.status(400).json({ error: "Payment gateway credentials are not configured" });
      return;
    }

    const txnid      = generatePayuTxnId(user.merchantId);
    const amountStr  = amountNum.toFixed(2);
    const productinfo = String(note ?? "RasoKart Merchant Deposit").slice(0, 100);
    const firstname  = String(customerName ?? "Merchant").slice(0, 60);
    const email      = String(customerEmail ?? "merchant@rasokart.com").slice(0, 254);
    const phone      = String(customerPhone).replace(/\D/g, "").slice(0, 10);

    const hash = generatePayuHash({
      key:         creds.key,
      txnid,
      amount:      amountStr,
      productinfo,
      firstname,
      email,
      salt:        creds.salt,
    });

    // Save order BEFORE redirecting (idempotent on txnid unique constraint)
    await db.insert(payuPaymentOrdersTable).values({
      merchantId:  user.merchantId,
      txnid,
      amount:      amountStr,
      productinfo,
      firstname,
      email,
      phone,
      environment: cfg.env,
      status:      PAYU_ORDER_STATUS.INITIATED,
    }).onConflictDoNothing();

    req.log.info({ event: "payu_order_initiated", merchantId: user.merchantId, txnid, env: cfg.env, amountStr }, "payu_order_initiated");

    // Return form params — key is masked, hash is included, salt NEVER returned
    res.json({
      txnid,
      amount:      amountStr,
      productinfo,
      firstname,
      email,
      phone,
      hash,
      key:         creds.key,       // PayU key is semi-public (visible in form); salt is never returned
      paymentUrl:  PAYU_PAYMENT_URL[cfg.env],
      env:         cfg.env,
    });
  } catch (err) { next(err); }
});

// ── GET /api/merchant/payu/check/:txnid ──────────────────────────────────────
// Status enquiry from PayU Verify Payment API — server-side credentials used.

router.get("/payu/check/:txnid", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (user.role !== "merchant" || !user.merchantId) {
      res.status(403).json({ error: "Merchant access only" });
      return;
    }

    const txnid = req.params["txnid"] as string;
    if (!txnid) {
      res.status(400).json({ error: "txnid is required" });
      return;
    }

    const [order] = await db
      .select()
      .from(payuPaymentOrdersTable)
      .where(and(
        eq(payuPaymentOrdersTable.txnid, txnid),
        eq(payuPaymentOrdersTable.merchantId, user.merchantId),
      ))
      .limit(1);

    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }

    const cfg = await loadPayuConfig();
    const creds = await loadPayuCreds(cfg.env);

    if (!creds) {
      res.json({ txnid, status: order.status, dbStatus: order.status, providerStatus: null });
      return;
    }

    const result = await queryPayuTransactionStatus({ key: creds.key, salt: creds.salt, txnid, env: cfg.env });

    req.log.info({ event: "payu_status_check", txnid, merchantId: user.merchantId, providerStatus: result.status }, "payu_status_check");

    res.json({
      txnid,
      amount:       order.amount,
      status:       order.status,
      providerStatus: result.ok ? result.status : null,
      mihpayid:     order.mihpayid ?? result.mihpayid ?? null,
      bankRefNo:    order.bankRefNo ?? result.bankRefNo ?? null,
      paymentMode:  order.paymentMode ?? result.paymentMode ?? null,
      paidAt:       order.paidAt?.toISOString() ?? null,
    });
  } catch (err) { next(err); }
});

// ── Exported wallet credit function ───────────────────────────────────────────
// Used by both payuWebhook.ts (s2s) and the return-callback handler.

export async function creditWalletForPayu(
  txnid:        string,
  mihpayid:     string | null,
  bankRefNo:    string | null,
  paymentMode:  string | null,
  source:       string,
): Promise<"credited" | "duplicate" | "error"> {
  try {
    return await db.transaction(async (tx) => {
      // Atomic: only one caller wins the INITIATED/PENDING→SUCCESS transition
      const updated = await tx
        .update(payuPaymentOrdersTable)
        .set({
          status:      PAYU_ORDER_STATUS.SUCCESS,
          mihpayid:    mihpayid ?? undefined,
          bankRefNo:   bankRefNo ?? undefined,
          paymentMode: paymentMode ?? undefined,
          hashVerified: true,
          paidAt:      new Date(),
        })
        .where(and(
          eq(payuPaymentOrdersTable.txnid, txnid),
          inArray(payuPaymentOrdersTable.status, [
            PAYU_ORDER_STATUS.INITIATED,
            PAYU_ORDER_STATUS.PENDING,
          ]),
        ))
        .returning({
          id:         payuPaymentOrdersTable.id,
          merchantId: payuPaymentOrdersTable.merchantId,
          amount:     payuPaymentOrdersTable.amount,
        });

      if (!updated.length) return "duplicate";

      const order     = updated[0]!;
      const amountStr = String(order.amount);
      const amountNum = parseFloat(amountStr);

      // Upsert wallet row
      await tx.insert(merchantWalletsTable)
        .values({ merchantId: order.merchantId })
        .onConflictDoNothing();

      const [wallet] = await tx
        .select()
        .from(merchantWalletsTable)
        .where(eq(merchantWalletsTable.merchantId, order.merchantId))
        .for("update");

      if (!wallet) throw new Error("Wallet not found after upsert");

      const pendingBefore   = parseFloat(wallet.pendingBalance  ?? "0");
      const availableBefore = parseFloat(wallet.availableBalance ?? "0");
      const pendingAfter    = pendingBefore + amountNum;
      const totalCollection = parseFloat(wallet.totalCollection  ?? "0") + amountNum;

      await tx
        .update(merchantWalletsTable)
        .set({
          pendingBalance:  String(pendingAfter),
          totalCollection: String(totalCollection),
        })
        .where(eq(merchantWalletsTable.merchantId, order.merchantId));

      // Immutable ledger entry
      await tx.insert(walletLedgerTable).values({
        merchantId:     order.merchantId,
        txnType:        "pending_credit",
        bucket:         "pending",
        amount:         amountStr,
        availableBefore: String(availableBefore),
        availableAfter:  String(availableBefore),
        pendingBefore:   String(pendingBefore),
        pendingAfter:    String(pendingAfter),
        referenceType:  "transaction",
        description:    `PayU payment credited — txnid ${txnid}${mihpayid ? `, mihpayid ${mihpayid}` : ""}`,
      });

      // Transaction record
      const utr = mihpayid ? `PAYU-${mihpayid}` : `PAYU-${txnid}`;
      await tx.insert(transactionsTable).values({
        merchantId: order.merchantId,
        provider:   "payu",
        type:       "deposit",
        status:     "success",
        amount:     amountStr,
        currency:   "INR",
        utr,
        referenceId: txnid,
        description: `PayU payment — txnid ${txnid} via ${source}`,
      }).onConflictDoNothing();

      return "credited";
    });
  } catch {
    return "error";
  }
}

export default router;
