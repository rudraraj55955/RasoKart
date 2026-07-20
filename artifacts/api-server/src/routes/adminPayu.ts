/**
 * PayU Admin Configuration & Management
 *
 * Routes:
 *   GET  /api/admin/payu/config        — PayU integration status + masked credentials
 *   PUT  /api/admin/payu/config        — Save/update UAT or live credentials (encrypted)
 *   PUT  /api/admin/payu/settings      — Toggle enabled, environment, limits
 *   GET  /api/admin/payu/orders        — Paginated list of PayU orders
 *   GET  /api/admin/payu/webhook-logs  — Recent webhook logs
 *   POST /api/admin/payu/test-hash     — Generate test hash (UAT sanity check — no payment triggered)
 *
 * Credentials are NEVER returned in plain text — only:
 *   keySet:     true/false
 *   keyMasked:  "PK01****abcd"
 *   saltSet:    true/false
 */

import { Router } from "express";
import { eq, desc, and } from "drizzle-orm";
import {
  db,
  payuPaymentOrdersTable,
  payuWebhookLogsTable,
  providerIntegrationsTable,
  systemConfigTable,
  SYSTEM_CONFIG_KEYS,
  PAYU_ORDER_STATUS,
} from "@workspace/db";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { encryptSecret, decryptSecret } from "../helpers/cryptoUtils";
import { generatePayuHash, generatePayuTxnId, type PayuEnv } from "../helpers/payu";

const router = Router();
router.use(requireAuth, requireAdmin);

function maskValue(raw: string): string {
  if (!raw) return "";
  if (raw.length <= 8) return "*".repeat(raw.length);
  return `${raw.slice(0, 4)}${"*".repeat(Math.max(0, raw.length - 8))}${raw.slice(-4)}`;
}

// ── Onboarding status derivation ──────────────────────────────────────────────

type PayuOnboardingStatus =
  | "ONBOARDING_PENDING"
  | "UAT_AVAILABLE"
  | "LIVE_PENDING_ACTIVATION"
  | "PAYOUT_PENDING_ACTIVATION";

function deriveOnboardingStatus(keySet: boolean, saltSet: boolean, env: string, enabled: boolean): PayuOnboardingStatus[] {
  if (!keySet || !saltSet) return ["ONBOARDING_PENDING", "PAYOUT_PENDING_ACTIVATION"];
  const statuses: PayuOnboardingStatus[] = [];
  if (env === "uat" || !enabled) statuses.push("UAT_AVAILABLE");
  if (env !== "live" || !enabled) statuses.push("LIVE_PENDING_ACTIVATION");
  statuses.push("PAYOUT_PENDING_ACTIVATION");
  return statuses;
}

// ── GET /api/admin/payu/config ───────────────────────────────────────────────

router.get("/config", async (req, res, next) => {
  try {
    const [row] = await db
      .select()
      .from(providerIntegrationsTable)
      .where(eq(providerIntegrationsTable.providerKey, "payu"))
      .limit(1);

    const rawKey  = row?.apiKeyEncrypted    ? decryptSecret(row.apiKeyEncrypted)    : null;
    const rawSalt = row?.apiSecretEncrypted ? decryptSecret(row.apiSecretEncrypted) : null;
    const keyVal  = rawKey?.ok  ? rawKey.value  : "";
    const saltVal = rawSalt?.ok ? rawSalt.value : "";
    const keySet  = keyVal.length > 0;
    const saltSet = saltVal.length > 0;

    const env     = row?.environment ?? "uat";
    const enabled = row?.isEnabled ?? false;

    const onboardingStatuses = deriveOnboardingStatus(keySet, saltSet, env, enabled);

    res.json({
      providerKey:        "payu",
      environment:        env,
      isEnabled:          enabled,
      keySet,
      keyMasked:          keySet  ? maskValue(keyVal)  : "",
      saltSet,
      notes:              row?.notes ?? "",
      onboardingStatuses,
      primaryOnboardingStatus: onboardingStatuses[0] ?? "ONBOARDING_PENDING",
      capabilities: {
        hostedCheckout:  true,
        refund:          false,  // requires provider activation
        settlement:      false,  // requires provider activation
        subscription:    false,  // requires provider activation
        paymentLinks:    false,  // requires provider activation
        payout:          false,  // requires separate Payout activation
      },
      capabilityNote: "Refund, settlement, subscription, payment links, and payout are listed for audit — they are not active without provider activation.",
    });
  } catch (err) { next(err); }
});

// ── PUT /api/admin/payu/config ───────────────────────────────────────────────

router.put("/config", async (req, res, next) => {
  try {
    const user = (req as any).user;
    const { key, salt, notes } = req.body as {
      key?: unknown;
      salt?: unknown;
      notes?: unknown;
    };

    if (!key || typeof key !== "string" || key.trim().length < 4) {
      res.status(400).json({ error: "Valid PayU Key is required (min 4 chars)" });
      return;
    }
    if (!salt || typeof salt !== "string" || salt.trim().length < 4) {
      res.status(400).json({ error: "Valid PayU Salt is required (min 4 chars)" });
      return;
    }

    const encKey  = encryptSecret(key.trim());
    const encSalt = encryptSecret(salt.trim());

    const [existing] = await db
      .select({ id: providerIntegrationsTable.id })
      .from(providerIntegrationsTable)
      .where(eq(providerIntegrationsTable.providerKey, "payu"))
      .limit(1);

    if (existing) {
      await db.update(providerIntegrationsTable)
        .set({
          apiKeyEncrypted:    encKey,
          apiSecretEncrypted: encSalt,
          notes:              typeof notes === "string" ? notes.slice(0, 1000) : undefined,
          updatedByEmail:     user.email,
        })
        .where(eq(providerIntegrationsTable.providerKey, "payu"));
    } else {
      await db.insert(providerIntegrationsTable).values({
        providerKey:         "payu",
        providerNameInternal: "PayU",
        displayNamePublic:   "RasoKart Gateway Plus",
        environment:         "uat",
        isEnabled:           false,
        isCustom:            false,
        apiKeyEncrypted:     encKey,
        apiSecretEncrypted:  encSalt,
        notes:               typeof notes === "string" ? notes.slice(0, 1000) : undefined,
        updatedByEmail:      user.email,
      });
    }

    req.log.info({ event: "payu_credentials_saved", admin: user.email }, "payu_credentials_saved");
    res.json({ success: true, message: "PayU credentials saved (encrypted)" });
  } catch (err) { next(err); }
});

// ── PUT /api/admin/payu/settings ──────────────────────────────────────────────

router.put("/settings", async (req, res, next) => {
  try {
    const user = (req as any).user;
    const { enabled, environment, minAmount, maxAmount, dailyLimit, suspended } = req.body as {
      enabled?: unknown;
      environment?: unknown;
      minAmount?: unknown;
      maxAmount?: unknown;
      dailyLimit?: unknown;
      suspended?: unknown;
    };

    const env = String(environment ?? "uat");
    if (!["uat", "live"].includes(env)) {
      res.status(400).json({ error: "environment must be 'uat' or 'live'" });
      return;
    }
    if (env === "live") {
      req.log.warn({ admin: user.email }, "payu_settings_live_mode_attempted");
      res.status(400).json({ error: "Live mode can only be activated after PayU provider approval and live credentials are received. Set environment to 'uat' for sandbox testing." });
      return;
    }

    // Update provider_integrations row
    await db.update(providerIntegrationsTable)
      .set({
        isEnabled:     enabled === true,
        environment:   env,
        updatedByEmail: user.email,
      })
      .where(eq(providerIntegrationsTable.providerKey, "payu"));

    // Upsert system config keys
    const configUpdates: Array<{ key: string; value: string }> = [
      { key: SYSTEM_CONFIG_KEYS.PAYU_ENABLED,    value: enabled === true ? "true" : "false" },
      { key: SYSTEM_CONFIG_KEYS.PAYU_ENV,        value: env },
      { key: SYSTEM_CONFIG_KEYS.PAYU_SUSPENDED,  value: suspended === true ? "true" : "false" },
    ];
    if (minAmount !== undefined)  configUpdates.push({ key: SYSTEM_CONFIG_KEYS.PAYU_MIN_AMOUNT,   value: String(parseFloat(String(minAmount)) || 1) });
    if (maxAmount !== undefined)  configUpdates.push({ key: SYSTEM_CONFIG_KEYS.PAYU_MAX_AMOUNT,   value: String(parseFloat(String(maxAmount)) || 200000) });
    if (dailyLimit !== undefined) configUpdates.push({ key: SYSTEM_CONFIG_KEYS.PAYU_DAILY_LIMIT,  value: String(parseFloat(String(dailyLimit)) || 1000000) });

    for (const { key, value } of configUpdates) {
      await db.insert(systemConfigTable)
        .values({ key, value, updatedByEmail: user.email })
        .onConflictDoUpdate({ target: systemConfigTable.key, set: { value, updatedByEmail: user.email } });
    }

    req.log.info({ event: "payu_settings_saved", admin: user.email, enabled, env }, "payu_settings_saved");
    res.json({ success: true, message: "PayU settings saved" });
  } catch (err) { next(err); }
});

// ── GET /api/admin/payu/orders ───────────────────────────────────────────────

router.get("/orders", async (req, res, next) => {
  try {
    const limit  = Math.min(parseInt(String(req.query["limit"] ?? "50"), 10) || 50, 200);
    const offset = parseInt(String(req.query["offset"] ?? "0"), 10) || 0;

    const orders = await db
      .select()
      .from(payuPaymentOrdersTable)
      .orderBy(desc(payuPaymentOrdersTable.createdAt))
      .limit(limit)
      .offset(offset);

    res.json({
      orders: orders.map(o => ({
        id:          o.id,
        txnid:       o.txnid,
        merchantId:  o.merchantId,
        amount:      o.amount,
        status:      o.status,
        environment: o.environment,
        mihpayid:    o.mihpayid,
        bankRefNo:   o.bankRefNo,
        paymentMode: o.paymentMode,
        hashVerified: o.hashVerified,
        failureReason: o.failureReason,
        paidAt:      o.paidAt?.toISOString() ?? null,
        createdAt:   o.createdAt.toISOString(),
      })),
    });
  } catch (err) { next(err); }
});

// ── GET /api/admin/payu/webhook-logs ─────────────────────────────────────────

router.get("/webhook-logs", async (req, res, next) => {
  try {
    const limit  = Math.min(parseInt(String(req.query["limit"] ?? "50"), 10) || 50, 200);
    const offset = parseInt(String(req.query["offset"] ?? "0"), 10) || 0;

    const logs = await db
      .select()
      .from(payuWebhookLogsTable)
      .orderBy(desc(payuWebhookLogsTable.receivedAt))
      .limit(limit)
      .offset(offset);

    res.json({
      logs: logs.map(l => ({
        id:               l.id,
        txnid:            l.txnid,
        merchantId:       l.merchantId,
        amount:           l.amount,
        status:           l.status,
        source:           l.source,
        processingResult: l.processingResult,
        hashVerified:     l.hashVerified,
        errorMessage:     l.errorMessage,
        receivedAt:       l.receivedAt.toISOString(),
      })),
    });
  } catch (err) { next(err); }
});

// ── POST /api/admin/payu/test-hash ───────────────────────────────────────────
// UAT sanity check: generates a sample hash using stored UAT credentials.
// Does NOT create any order or trigger any payment.

router.post("/test-hash", async (req, res, next) => {
  try {
    const [row] = await db
      .select()
      .from(providerIntegrationsTable)
      .where(eq(providerIntegrationsTable.providerKey, "payu"))
      .limit(1);

    const env = (row?.environment ?? "uat") as PayuEnv;
    const envKey  = env === "live" ? process.env["PAYU_LIVE_KEY"]  : process.env["PAYU_UAT_KEY"];
    const envSalt = env === "live" ? process.env["PAYU_LIVE_SALT"] : process.env["PAYU_UAT_SALT"];

    const keyDecrypt  = row?.apiKeyEncrypted    ? decryptSecret(row.apiKeyEncrypted)    : null;
    const saltDecrypt = row?.apiSecretEncrypted ? decryptSecret(row.apiSecretEncrypted) : null;
    const keyVal  = envKey  ?? (keyDecrypt?.ok  ? keyDecrypt.value  : "");
    const saltVal = envSalt ?? (saltDecrypt?.ok ? saltDecrypt.value : "");

    if (!keyVal || !saltVal) {
      res.status(400).json({ error: "PayU credentials not configured — save key and salt first" });
      return;
    }

    const testTxnid  = generatePayuTxnId(0);
    const testAmount = "1.00";
    const hash = generatePayuHash({
      key:         keyVal,
      txnid:       testTxnid,
      amount:      testAmount,
      productinfo: "Test Payment",
      firstname:   "Test",
      email:       "test@rasokart.com",
      salt:        saltVal,
    });

    req.log.info({ event: "payu_test_hash_generated", env }, "payu_test_hash_generated");

    res.json({
      success:    true,
      env,
      testTxnid,
      testAmount,
      hashLength: hash.length,
      hashPrefix: hash.slice(0, 8) + "…",   // first 8 chars only — never return full hash in admin response
      message:    `SHA-512 hash generated successfully for ${env.toUpperCase()} environment`,
    });
  } catch (err) { next(err); }
});

export default router;
