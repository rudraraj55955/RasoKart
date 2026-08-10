/**
 * PayU Admin Configuration & Management
 *
 * Routes:
 *   GET  /api/admin/payu/config        — PayU integration status + masked credentials (UAT + Live)
 *   PUT  /api/admin/payu/config        — Save/update UAT or Live credentials (encrypted)
 *   PUT  /api/admin/payu/settings      — Toggle enabled, environment, limits
 *   POST /api/admin/payu/verify-live   — 4-step server-side live credential verification
 *   GET  /api/admin/payu/orders        — Paginated list of PayU orders
 *   GET  /api/admin/payu/webhook-logs  — Recent webhook logs
 *   POST /api/admin/payu/test-hash     — Generate test hash (UAT sanity check — no payment triggered)
 *
 * Credentials are NEVER returned in plain text — only:
 *   keySet:     true/false
 *   keyMasked:  "PK01****abcd"
 *   saltSet:    true/false
 *
 * Live credential pair:
 *   clientIdEncrypted     → Live Key
 *   clientSecretEncrypted → Live Salt
 * UAT credential pair (backward compat):
 *   apiKeyEncrypted       → UAT Key
 *   apiSecretEncrypted    → UAT Salt
 */

import { Router } from "express";
import { eq, desc, inArray } from "drizzle-orm";
import {
  db,
  payuPaymentOrdersTable,
  payuWebhookLogsTable,
  providerIntegrationsTable,
  systemConfigTable,
  SYSTEM_CONFIG_KEYS,
  PAYU_ORDER_STATUS,
} from "@workspace/db";
import { requireAuth, requireAdmin, requirePermission } from "../middlewares/auth";
import { PERMISSIONS } from "../permissions";
import { encryptSecret, decryptSecret } from "../helpers/cryptoUtils";
import {
  generatePayuHash,
  generatePayuTxnId,
  queryPayuTransactionStatus,
  type PayuEnv,
} from "../helpers/payu";

const router = Router();
router.use(requireAuth, requireAdmin, requirePermission(PERMISSIONS.ADMIN_SETTINGS));

function maskValue(raw: string): string {
  if (!raw) return "";
  if (raw.length <= 8) return "*".repeat(raw.length);
  return `${raw.slice(0, 4)}${"*".repeat(Math.max(0, raw.length - 8))}${raw.slice(-4)}`;
}

// ── Onboarding status derivation ──────────────────────────────────────────────

type PayuOnboardingStatus =
  | "ONBOARDING_PENDING"
  | "UAT_AVAILABLE"
  | "LIVE_CREDENTIALS_SAVED"
  | "LIVE_VERIFIED"
  | "LIVE_ACTIVE"
  | "LIVE_PENDING_ACTIVATION"
  | "PAYOUT_PENDING_ACTIVATION";

function deriveOnboardingStatus(
  uatKeySet: boolean,
  uatSaltSet: boolean,
  liveKeySet: boolean,
  liveSaltSet: boolean,
  liveVerified: boolean,
  env: string,
  enabled: boolean,
): PayuOnboardingStatus[] {
  if (!uatKeySet || !uatSaltSet) return ["ONBOARDING_PENDING", "PAYOUT_PENDING_ACTIVATION"];
  const statuses: PayuOnboardingStatus[] = [];
  statuses.push("UAT_AVAILABLE");
  if (liveKeySet && liveSaltSet) {
    if (liveVerified) {
      if (env === "live" && enabled) {
        statuses.push("LIVE_ACTIVE");
      } else {
        statuses.push("LIVE_VERIFIED");
      }
    } else {
      statuses.push("LIVE_CREDENTIALS_SAVED");
    }
  } else {
    statuses.push("LIVE_PENDING_ACTIVATION");
  }
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

    // UAT credentials (apiKeyEncrypted / apiSecretEncrypted)
    const rawUatKey  = row?.apiKeyEncrypted    ? decryptSecret(row.apiKeyEncrypted)    : null;
    const rawUatSalt = row?.apiSecretEncrypted ? decryptSecret(row.apiSecretEncrypted) : null;
    const uatKeyVal  = rawUatKey?.ok  ? rawUatKey.value  : "";
    const uatSaltVal = rawUatSalt?.ok ? rawUatSalt.value : "";
    const uatKeySet  = uatKeyVal.length > 0;
    const uatSaltSet = uatSaltVal.length > 0;

    // Live credentials (clientIdEncrypted / clientSecretEncrypted)
    const rawLiveKey  = row?.clientIdEncrypted     ? decryptSecret(row.clientIdEncrypted)     : null;
    const rawLiveSalt = row?.clientSecretEncrypted ? decryptSecret(row.clientSecretEncrypted) : null;
    const liveKeyVal  = rawLiveKey?.ok  ? rawLiveKey.value  : "";
    const liveSaltVal = rawLiveSalt?.ok ? rawLiveSalt.value : "";
    const liveKeySet  = liveKeyVal.length > 0;
    const liveSaltSet = liveSaltVal.length > 0;

    const env     = row?.environment ?? "uat";
    const enabled = row?.isEnabled ?? false;

    // Load live verification status from system_config
    const liveVerifiedRows = await db
      .select()
      .from(systemConfigTable)
      .where(
        inArray(systemConfigTable.key, [
          SYSTEM_CONFIG_KEYS.PAYU_LIVE_VERIFIED,
          SYSTEM_CONFIG_KEYS.PAYU_LIVE_VERIFIED_AT,
        ]),
      );
    const cfgMap = new Map(liveVerifiedRows.map(r => [r.key, r.value]));
    const liveVerified   = cfgMap.get(SYSTEM_CONFIG_KEYS.PAYU_LIVE_VERIFIED) === "true";
    const liveVerifiedAt = cfgMap.get(SYSTEM_CONFIG_KEYS.PAYU_LIVE_VERIFIED_AT) || null;

    const onboardingStatuses = deriveOnboardingStatus(
      uatKeySet, uatSaltSet, liveKeySet, liveSaltSet, liveVerified, env, enabled,
    );

    res.json({
      providerKey:        "payu",
      environment:        env,
      isEnabled:          enabled,
      // UAT credentials
      uatKeySet,
      uatKeyMasked:       uatKeySet  ? maskValue(uatKeyVal)  : "",
      uatSaltSet,
      // Live credentials
      liveKeySet,
      liveKeyMasked:      liveKeySet ? maskValue(liveKeyVal) : "",
      liveSaltSet,
      // Live verification
      liveVerified,
      liveVerifiedAt,
      // Backward-compat aliases (UAT = primary)
      keySet:    uatKeySet,
      keyMasked: uatKeySet ? maskValue(uatKeyVal) : "",
      saltSet:   uatSaltSet,
      // Webhook URL (for step 4 of activation flow)
      webhookUrl: row?.webhookUrl ?? "",
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
// Accept env: "uat" (default) or "live" to determine which column pair to write.
// Saving live credentials resets PAYU_LIVE_VERIFIED to "false" (forces re-verification).

router.put("/config", async (req, res, next) => {
  try {
    const user = (req as any).user;
    const { key, salt, notes, env } = req.body as {
      key?: unknown;
      salt?: unknown;
      notes?: unknown;
      env?: unknown;
    };

    const credEnv = env === "live" ? "live" : "uat";

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

    if (credEnv === "live") {
      // Live credentials → clientIdEncrypted / clientSecretEncrypted
      // All writes (provider row + three safety-reset config keys) are inside ONE transaction.
      // A failure at any point rolls back everything, preventing a state where new live
      // credentials exist with stale PAYU_LIVE_VERIFIED=true or PAYU_ENV=live.
      await db.transaction(async (tx) => {
        if (existing) {
          await tx.update(providerIntegrationsTable)
            .set({
              clientIdEncrypted:     encKey,
              clientSecretEncrypted: encSalt,
              environment:           "uat",   // force back to UAT until re-verified
              notes:                 typeof notes === "string" ? notes.slice(0, 1000) : undefined,
              updatedByEmail:        user.email,
            })
            .where(eq(providerIntegrationsTable.providerKey, "payu"));
        } else {
          await tx.insert(providerIntegrationsTable).values({
            providerKey:           "payu",
            providerNameInternal:  "PayU",
            displayNamePublic:     "RasoKart Gateway Plus",
            environment:           "uat",
            isEnabled:             false,
            isCustom:              false,
            clientIdEncrypted:     encKey,
            clientSecretEncrypted: encSalt,
            notes:                 typeof notes === "string" ? notes.slice(0, 1000) : undefined,
            updatedByEmail:        user.email,
          });
        }
        // Reset live verification AND active environment atomically —
        // no partial state can leave live initiation open during re-verification.
        for (const { key, value } of [
          { key: SYSTEM_CONFIG_KEYS.PAYU_LIVE_VERIFIED,    value: "false" },
          { key: SYSTEM_CONFIG_KEYS.PAYU_LIVE_VERIFIED_AT, value: "" },
          { key: SYSTEM_CONFIG_KEYS.PAYU_ENV,              value: "uat" },
        ] as { key: string; value: string }[]) {
          await tx.insert(systemConfigTable)
            .values({ key, value, updatedByEmail: user.email })
            .onConflictDoUpdate({ target: systemConfigTable.key, set: { value, updatedByEmail: user.email } });
        }
      });

      req.log.info({ event: "payu_live_credentials_saved", admin: user.email }, "payu_live_credentials_saved");
      res.json({ success: true, message: "PayU Live credentials saved (encrypted) — environment reset to UAT and verification cleared; complete re-verification before re-enabling Live" });
    } else {
      // UAT credentials → apiKeyEncrypted / apiSecretEncrypted
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
          providerKey:          "payu",
          providerNameInternal: "PayU",
          displayNamePublic:    "RasoKart Gateway Plus",
          environment:          "uat",
          isEnabled:            false,
          isCustom:             false,
          apiKeyEncrypted:      encKey,
          apiSecretEncrypted:   encSalt,
          notes:                typeof notes === "string" ? notes.slice(0, 1000) : undefined,
          updatedByEmail:       user.email,
        });
      }

      req.log.info({ event: "payu_uat_credentials_saved", admin: user.email }, "payu_uat_credentials_saved");
      res.json({ success: true, message: "PayU UAT credentials saved (encrypted)" });
    }
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

    // Live mode requires verification and live credentials
    if (env === "live") {
      const [row] = await db
        .select({
          clientIdEncrypted:     providerIntegrationsTable.clientIdEncrypted,
          clientSecretEncrypted: providerIntegrationsTable.clientSecretEncrypted,
        })
        .from(providerIntegrationsTable)
        .where(eq(providerIntegrationsTable.providerKey, "payu"))
        .limit(1);

      const liveKeyDecrypt  = row?.clientIdEncrypted     ? decryptSecret(row.clientIdEncrypted)     : null;
      const liveSaltDecrypt = row?.clientSecretEncrypted ? decryptSecret(row.clientSecretEncrypted) : null;
      const liveKeyOk  = liveKeyDecrypt?.ok  && (liveKeyDecrypt.value?.length ?? 0) > 0;
      const liveSaltOk = liveSaltDecrypt?.ok && (liveSaltDecrypt.value?.length ?? 0) > 0;

      if (!liveKeyOk || !liveSaltOk) {
        res.status(400).json({
          error: "Live mode requires saved live credentials. Save your PayU Live Key and Salt, then run the 4-step verification before switching to live.",
        });
        return;
      }

      const verifiedRows = await db
        .select()
        .from(systemConfigTable)
        .where(eq(systemConfigTable.key, SYSTEM_CONFIG_KEYS.PAYU_LIVE_VERIFIED));
      const liveVerified = verifiedRows[0]?.value === "true";

      if (!liveVerified) {
        req.log.warn({ admin: user.email }, "payu_settings_live_mode_unverified");
        res.status(400).json({
          error: "Live mode requires completing the 4-step verification. Go to PayU config → Activation Flow and run 'Verify with PayU API' before enabling live mode.",
        });
        return;
      }

      req.log.info({ event: "payu_settings_live_mode_enabled", admin: user.email }, "payu_settings_live_mode_enabled");
    }

    // Update provider_integrations row
    await db.update(providerIntegrationsTable)
      .set({
        isEnabled:      enabled === true,
        environment:    env,
        updatedByEmail: user.email,
      })
      .where(eq(providerIntegrationsTable.providerKey, "payu"));

    // Upsert system config keys
    const configUpdates: Array<{ key: string; value: string }> = [
      { key: SYSTEM_CONFIG_KEYS.PAYU_ENABLED,    value: enabled === true ? "true" : "false" },
      { key: SYSTEM_CONFIG_KEYS.PAYU_ENV,        value: env },
      { key: SYSTEM_CONFIG_KEYS.PAYU_SUSPENDED,  value: suspended === true ? "true" : "false" },
    ];
    if (minAmount !== undefined)  configUpdates.push({ key: SYSTEM_CONFIG_KEYS.PAYU_MIN_AMOUNT,   value: String(parseFloat(String(minAmount))  || 1) });
    if (maxAmount !== undefined)  configUpdates.push({ key: SYSTEM_CONFIG_KEYS.PAYU_MAX_AMOUNT,   value: String(parseFloat(String(maxAmount))  || 200000) });
    if (dailyLimit !== undefined) configUpdates.push({ key: SYSTEM_CONFIG_KEYS.PAYU_DAILY_LIMIT,  value: String(parseFloat(String(dailyLimit)) || 1000000) });

    for (const { key, value } of configUpdates) {
      await db.insert(systemConfigTable)
        .values({ key, value, updatedByEmail: user.email })
        .onConflictDoUpdate({ target: systemConfigTable.key, set: { value, updatedByEmail: user.email } });
    }

    req.log.info({ event: "payu_settings_saved", admin: user.email, enabled, env }, "payu_settings_saved");
    res.json({ success: true, message: `PayU settings saved — ${env.toUpperCase()} mode` });
  } catch (err) { next(err); }
});

// ── POST /api/admin/payu/verify-live ─────────────────────────────────────────
// 4-step server-side live credential verification.
// Step 1: Live credentials saved and decrypt cleanly.
// Step 2: PayU Verify API probe — a "not found" response proves creds are accepted.
// Step 3: SHA-512 hash generation test — confirms hash length = 128.
// Step 4: Webhook URL configured in provider_integrations row.
// On full pass: writes PAYU_LIVE_VERIFIED = "true" and PAYU_LIVE_VERIFIED_AT to system_config.

router.post("/verify-live", async (req, res, next) => {
  try {
    const user = (req as any).user;

    const [row] = await db
      .select()
      .from(providerIntegrationsTable)
      .where(eq(providerIntegrationsTable.providerKey, "payu"))
      .limit(1);

    // ── Step 1: credentials decrypt cleanly ────────────────────────────────
    const liveKeyDecrypt  = row?.clientIdEncrypted     ? decryptSecret(row.clientIdEncrypted)     : null;
    const liveSaltDecrypt = row?.clientSecretEncrypted ? decryptSecret(row.clientSecretEncrypted) : null;
    const liveKey  = liveKeyDecrypt?.ok  ? liveKeyDecrypt.value  : "";
    const liveSalt = liveSaltDecrypt?.ok ? liveSaltDecrypt.value : "";
    const step1Pass = liveKey.length > 0 && liveSalt.length > 0;

    const steps: Record<string, { pass: boolean; message: string }> = {
      credentialsDecrypt: {
        pass:    step1Pass,
        message: step1Pass
          ? "Live credentials loaded and decrypted successfully"
          : "Live credentials not saved or failed to decrypt — save Live Key and Salt first",
      },
      payuApiProbe:   { pass: false, message: "Skipped — credentials required first" },
      hashGeneration: { pass: false, message: "Skipped — credentials required first" },
      webhookUrl:     { pass: false, message: "Skipped — credentials required first" },
    };

    if (!step1Pass) {
      res.json({ allPassed: false, steps });
      return;
    }

    // ── Step 2: PayU Live API probe ─────────────────────────────────────────
    // Send a verify_payment request with a dummy txnid.
    //
    // Valid creds: PayU returns payuApiStatus=1 (request accepted).
    //   - With a dummy txnid the response will have transaction_details[txnid].status="Not Found"
    //     which arrives as probeResult.ok=true or status="not found" — both are passes.
    // Invalid creds: PayU returns payuApiStatus=0 (auth error) — this is a definitive failure.
    // Non-JSON / timeout / network error: inconclusive, treated as failure.
    //
    // We MUST use payuApiStatus (top-level 0/1 from PayU's JSON) rather than relying on the
    // presence of transaction_details, because an auth error response also lacks transaction_details
    // and would otherwise be indistinguishable from a valid "txnid not found" response.
    const dummyTxnid = `RKVERIFY${Date.now().toString(36).toUpperCase()}`;
    let step2Pass = false;
    let step2Message = "";

    try {
      const probeResult = await queryPayuTransactionStatus({
        key: liveKey, salt: liveSalt, txnid: dummyTxnid, env: "live",
      });

      if (probeResult.ok || probeResult.status === "not found") {
        // Both paths reach here only when PayU accepted the request (payuApiStatus=1).
        // Double-check the explicit status field to rule out any edge case.
        if (probeResult.payuApiStatus === 0) {
          // Explicit rejection from PayU despite a parseable response
          const rawSnippet = probeResult.raw ? probeResult.raw.slice(0, 200) : "no response body";
          step2Pass = false;
          step2Message = `PayU Live API rejected credentials (API status 0) — check your merchant key and salt. Response: ${rawSnippet}`;
        } else {
          step2Pass = true;
          step2Message = probeResult.ok
            ? "PayU Live API accepted credentials and returned transaction data"
            : "PayU Live API accepted credentials (txnid not found — expected for a test probe txnid)";
        }
      } else if (probeResult.payuApiStatus === 0) {
        // PayU explicitly rejected the credentials (auth failure, inactive account, etc.)
        const rawSnippet = probeResult.raw ? probeResult.raw.slice(0, 200) : "no response body";
        step2Pass = false;
        step2Message = `PayU Live API rejected credentials (API status 0) — verify your merchant key and salt are correct and the account is active for live mode. Response: ${rawSnippet}`;
      } else if (probeResult.errorMessage?.includes("timed out")) {
        step2Pass = false;
        step2Message = "PayU Live API request timed out — check network connectivity from the server";
      } else if (probeResult.errorMessage?.includes("parse")) {
        step2Pass = false;
        step2Message = "PayU Live API returned a non-JSON response — credentials may be invalid or the Live endpoint is unreachable";
      } else {
        step2Pass = false;
        step2Message = `PayU Live API error: ${probeResult.errorMessage ?? "unknown error"}`;
      }
    } catch {
      step2Pass = false;
      step2Message = "Unexpected error calling PayU Live API — check server logs";
    }

    steps["payuApiProbe"] = { pass: step2Pass, message: step2Message };

    // ── Step 3: Hash generation test ───────────────────────────────────────
    let step3Pass = false;
    let step3Message = "";
    try {
      const testHash = generatePayuHash({
        key:         liveKey,
        txnid:       dummyTxnid,
        amount:      "1.00",
        productinfo: "Live Verification Test",
        firstname:   "Verify",
        email:       "verify@rasokart.com",
        salt:        liveSalt,
      });
      step3Pass = testHash.length === 128;
      step3Message = step3Pass
        ? `SHA-512 hash generated — length ${testHash.length}, prefix: ${testHash.slice(0, 8)}…`
        : `Hash length unexpected: ${testHash.length} (expected 128)`;
    } catch (hashErr: any) {
      step3Pass = false;
      step3Message = `Hash generation failed: ${hashErr?.message ?? "unknown error"}`;
    }

    steps["hashGeneration"] = { pass: step3Pass, message: step3Message };

    // ── Step 4: Webhook URL configured ─────────────────────────────────────
    const webhookUrl = row?.webhookUrl ?? "";
    const step4Pass = webhookUrl.trim().length > 0;
    steps["webhookUrl"] = {
      pass:    step4Pass,
      message: step4Pass
        ? `Webhook callback URL configured: ${webhookUrl.slice(0, 60)}${webhookUrl.length > 60 ? "…" : ""}`
        : "Webhook callback URL is not configured. Set the webhook URL in the PayU provider integration row.",
    };

    const allPassed = step1Pass && step2Pass && step3Pass && step4Pass;

    // ── Write verification result ───────────────────────────────────────────
    if (allPassed) {
      const verifiedAt = new Date().toISOString();
      for (const { key, value } of [
        { key: SYSTEM_CONFIG_KEYS.PAYU_LIVE_VERIFIED,    value: "true" },
        { key: SYSTEM_CONFIG_KEYS.PAYU_LIVE_VERIFIED_AT, value: verifiedAt },
      ]) {
        await db.insert(systemConfigTable)
          .values({ key, value, updatedByEmail: user.email })
          .onConflictDoUpdate({ target: systemConfigTable.key, set: { value, updatedByEmail: user.email } });
      }
      req.log.info({ event: "payu_live_verified", admin: user.email }, "payu_live_verified");
      res.json({ allPassed: true, steps, verifiedAt, message: "All 4 verification steps passed — live mode is now unlocked" });
    } else {
      req.log.warn({ event: "payu_live_verify_failed", admin: user.email, steps }, "payu_live_verify_failed");
      res.json({ allPassed: false, steps, message: "Verification incomplete — see per-step results above" });
    }
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

    // UAT hash test always uses UAT credentials regardless of active env
    const envKey  = process.env["PAYU_UAT_KEY"];
    const envSalt = process.env["PAYU_UAT_SALT"];

    const keyDecrypt  = row?.apiKeyEncrypted    ? decryptSecret(row.apiKeyEncrypted)    : null;
    const saltDecrypt = row?.apiSecretEncrypted ? decryptSecret(row.apiSecretEncrypted) : null;
    const keyVal  = envKey  ?? (keyDecrypt?.ok  ? keyDecrypt.value  : "");
    const saltVal = envSalt ?? (saltDecrypt?.ok ? saltDecrypt.value : "");

    if (!keyVal || !saltVal) {
      res.status(400).json({ error: "UAT credentials not configured — save UAT Key and Salt first" });
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

    req.log.info({ event: "payu_test_hash_generated", env: "uat" }, "payu_test_hash_generated");

    res.json({
      success:    true,
      env:        "uat",
      testTxnid,
      testAmount,
      hashLength: hash.length,
      hashPrefix: hash.slice(0, 8) + "…",   // first 8 chars only — never return full hash
      message:    "SHA-512 hash generated successfully for UAT environment",
    });
  } catch (err) { next(err); }
});

export default router;
