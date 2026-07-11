/**
 * Admin — UPIGateway / EKQR Payin Settings
 *
 * GET  /api/admin/upigateway/settings          — read config (masked secrets)
 * PUT  /api/admin/upigateway/settings          — save config (AES-256-GCM encrypted)
 * POST /api/admin/upigateway/test-credentials  — test API key connectivity
 * POST /api/admin/upigateway/test-order        — create ₹1 test order
 * POST /api/admin/upigateway/check-status      — check test order status by client_txn_id + date
 *
 * White-label rule: this file (and all responses) is admin-only.
 * Merchants never receive raw provider IDs, API keys, or webhook secrets.
 */

import { Router } from "express";
import { db, systemConfigTable, auditLogsTable, SYSTEM_CONFIG_KEYS } from "@workspace/db";
import { inArray, eq } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { encryptSecret } from "../helpers/cryptoUtils";
import { loadUpigatewayConfig, upigatewayCreateOrder, upigatewayCheckStatus, upigatewayFormatDate } from "../helpers/upigatewayPayin";
import { notifyAdminsOfCredentialRotation } from "../helpers/adminNotifyEmail";

const router = Router();
router.use(requireAuth, requireAdmin);

// ── GET /settings ─────────────────────────────────────────────────────────────
router.get("/settings", async (req, res, next) => {
  try {
    const cfg = await loadUpigatewayConfig();
    res.json({
      enabled: cfg.enabled,
      env: cfg.env,
      baseUrl: cfg.baseUrl,
      apiKeySet: cfg.apiKeySet,
      apiKeyMasked: cfg.apiKeyMasked,
      merchantId: cfg.merchantId,
      createOrderEndpoint: cfg.createOrderEndpoint,
      checkStatusEndpoint: cfg.checkStatusEndpoint,
      webhookSecretSet: cfg.webhookSecretSet,
      minAmount: cfg.minAmount,
      maxAmount: cfg.maxAmount,
      merchantAccess: cfg.merchantAccess,
      lastUpdatedByEmail: cfg.lastUpdatedByEmail,
      lastUpdatedAt: cfg.lastUpdatedAt,
    });
  } catch (err) { next(err); }
});

// ── PUT /settings ─────────────────────────────────────────────────────────────
router.put("/settings", async (req, res, next) => {
  try {
    const user = (req as any).user;
    const {
      enabled, env, baseUrl, apiKey, webhookSecret, merchantId,
      createOrderEndpoint, checkStatusEndpoint, minAmount, maxAmount, merchantAccess,
    } = req.body as {
      enabled?: boolean; env?: "test" | "live"; baseUrl?: string;
      apiKey?: string; webhookSecret?: string; merchantId?: string;
      createOrderEndpoint?: string; checkStatusEndpoint?: string;
      minAmount?: number | string; maxAmount?: number | string;
      merchantAccess?: boolean;
    };

    const oldCfg = await loadUpigatewayConfig();

    const upsert = async (key: string, value: string) => {
      await db.insert(systemConfigTable)
        .values({ key, value, updatedByEmail: user.email })
        .onConflictDoUpdate({ target: systemConfigTable.key, set: { value, updatedByEmail: user.email } });
    };

    if (enabled !== undefined) await upsert(SYSTEM_CONFIG_KEYS.UPIGATEWAY_PAYIN_ENABLED, enabled ? "true" : "false");
    if (env !== undefined) await upsert(SYSTEM_CONFIG_KEYS.UPIGATEWAY_ENV, env);
    if (baseUrl !== undefined) await upsert(SYSTEM_CONFIG_KEYS.UPIGATEWAY_BASE_URL, baseUrl.trim());
    if (merchantId !== undefined) await upsert(SYSTEM_CONFIG_KEYS.UPIGATEWAY_MERCHANT_ID, merchantId.trim());
    if (createOrderEndpoint !== undefined) await upsert(SYSTEM_CONFIG_KEYS.UPIGATEWAY_CREATE_ORDER_ENDPOINT, createOrderEndpoint.trim());
    if (checkStatusEndpoint !== undefined) await upsert(SYSTEM_CONFIG_KEYS.UPIGATEWAY_CHECK_STATUS_ENDPOINT, checkStatusEndpoint.trim());
    if (minAmount !== undefined) await upsert(SYSTEM_CONFIG_KEYS.UPIGATEWAY_MIN_AMOUNT, String(minAmount));
    if (maxAmount !== undefined) await upsert(SYSTEM_CONFIG_KEYS.UPIGATEWAY_MAX_AMOUNT, String(maxAmount));
    if (merchantAccess !== undefined) await upsert(SYSTEM_CONFIG_KEYS.UPIGATEWAY_MERCHANT_ACCESS, merchantAccess ? "true" : "false");

    const credentialFields: string[] = [];
    if (apiKey !== undefined) {
      const encrypted = apiKey.trim() ? encryptSecret(apiKey.trim()) : "";
      if (encrypted) {
        await upsert(SYSTEM_CONFIG_KEYS.UPIGATEWAY_API_KEY, encrypted);
        credentialFields.push("API Key");
      } else {
        await db.delete(systemConfigTable).where(eq(systemConfigTable.key, SYSTEM_CONFIG_KEYS.UPIGATEWAY_API_KEY));
      }
    }
    if (webhookSecret !== undefined) {
      if (webhookSecret.trim()) {
        await upsert(SYSTEM_CONFIG_KEYS.UPIGATEWAY_WEBHOOK_SECRET, encryptSecret(webhookSecret.trim()));
        credentialFields.push("Webhook Secret");
      } else {
        await db.delete(systemConfigTable).where(eq(systemConfigTable.key, SYSTEM_CONFIG_KEYS.UPIGATEWAY_WEBHOOK_SECRET));
      }
    }

    const auditDetails: Record<string, unknown> = {
      section: "upigateway",
      ...(apiKey !== undefined && { apiKeyUpdated: true }),
      ...(webhookSecret !== undefined && { webhookSecretUpdated: true }),
      ...(enabled !== undefined && { enabled: { from: oldCfg.enabled, to: enabled } }),
      ...(env !== undefined && { env: { from: oldCfg.env, to: env } }),
      ...(minAmount !== undefined && { minAmount: { from: oldCfg.minAmount, to: Number(minAmount) } }),
      ...(maxAmount !== undefined && { maxAmount: { from: oldCfg.maxAmount, to: Number(maxAmount) } }),
    };

    await db.insert(auditLogsTable).values({
      adminId: user.id, adminEmail: user.email,
      action: "system_config_updated", targetType: "system_config", targetId: null,
      details: JSON.stringify(auditDetails),
      ipAddress: (req as any).ip ?? null,
    });

    if (credentialFields.length > 0) {
      notifyAdminsOfCredentialRotation({ gateway: "upigateway", changedFields: credentialFields, actorEmail: user.email })
        .catch(err => req.log.error({ err }, "Failed to dispatch upigateway credential rotation alert"));
    }

    req.log.info({ enabled, env, apiKeyUpdated: apiKey !== undefined }, "upigateway config updated");
    const cfg = await loadUpigatewayConfig();
    res.json({
      enabled: cfg.enabled, env: cfg.env, baseUrl: cfg.baseUrl,
      apiKeySet: cfg.apiKeySet, apiKeyMasked: cfg.apiKeyMasked,
      merchantId: cfg.merchantId, createOrderEndpoint: cfg.createOrderEndpoint,
      checkStatusEndpoint: cfg.checkStatusEndpoint, webhookSecretSet: cfg.webhookSecretSet,
      minAmount: cfg.minAmount, maxAmount: cfg.maxAmount, merchantAccess: cfg.merchantAccess,
      lastUpdatedByEmail: cfg.lastUpdatedByEmail, lastUpdatedAt: cfg.lastUpdatedAt,
    });
  } catch (err) { next(err); }
});

// ── POST /test-credentials ────────────────────────────────────────────────────
router.post("/test-credentials", async (req, res, next) => {
  try {
    const cfg = await loadUpigatewayConfig();
    if (!cfg.apiKeySet) {
      res.status(400).json({ ok: false, message: "API key not configured" });
      return;
    }

    // Try a reachability check on the base URL
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      const url = `${cfg.baseUrl.replace(/\/$/, "")}${cfg.createOrderEndpoint}`;
      // HEAD is often rejected; fall back to a minimal POST with missing params
      const testRes = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: cfg.apiKey, client_txn_id: "test_conn_check" }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      // Any HTTP response (even error) means the endpoint is reachable
      if (testRes.status < 500) {
        res.json({ ok: true, message: "Credentials configured and endpoint is reachable" });
      } else {
        res.json({ ok: false, message: `Endpoint returned ${testRes.status}` });
      }
    } catch {
      res.json({ ok: false, message: "Could not reach the configured API base URL — check the URL and network." });
    }
  } catch (err) { next(err); }
});

// ── POST /test-order ──────────────────────────────────────────────────────────
router.post("/test-order", async (req, res, next) => {
  try {
    const cfg = await loadUpigatewayConfig();
    if (!cfg.apiKeySet) {
      res.status(400).json({ ok: false, message: "API key not configured" });
      return;
    }

    const clientTxnId = `UGTEST_${Date.now()}`;
    const { raw, parsed } = await upigatewayCreateOrder(cfg, {
      key: cfg.apiKey,
      client_txn_id: clientTxnId,
      amount: "1.00",
      p_info: "RasoKart Admin Test",
      customer_name: "Admin Test",
      customer_email: "admin@rasokart.com",
      customer_mobile: "9999999999",
      redirect_url: "https://rasokart.com",
    });

    req.log.info({ clientTxnId, status: parsed.status }, "upigateway test order created");

    if (parsed.status) {
      res.json({
        ok: true,
        clientTxnId,
        paymentUrl: parsed.payment_url ?? null,
        message: parsed.msg,
        txnDate: upigatewayFormatDate(new Date()),
      });
    } else {
      res.json({ ok: false, clientTxnId, message: parsed.msg || "Order creation failed", raw });
    }
  } catch (err) { next(err); }
});

// ── POST /check-status ────────────────────────────────────────────────────────
router.post("/check-status", async (req, res, next) => {
  try {
    const { clientTxnId, txnDate } = req.body as { clientTxnId?: string; txnDate?: string };
    if (!clientTxnId) {
      res.status(400).json({ ok: false, message: "clientTxnId is required" });
      return;
    }

    const cfg = await loadUpigatewayConfig();
    if (!cfg.apiKeySet) {
      res.status(400).json({ ok: false, message: "API key not configured" });
      return;
    }

    const dateStr = txnDate || upigatewayFormatDate(new Date());
    const { raw, parsed } = await upigatewayCheckStatus(cfg, clientTxnId, dateStr);

    req.log.info({ clientTxnId, status: parsed.status }, "upigateway check status");

    res.json({
      ok: parsed.status,
      message: parsed.msg,
      data: parsed.data ? {
        status: parsed.data.status,
        amount: parsed.data.amount,
        upiTxnId: parsed.data.upi_txn_id ?? null,
        remark: parsed.data.remark ?? null,
      } : null,
      raw,
    });
  } catch (err) { next(err); }
});

export default router;
