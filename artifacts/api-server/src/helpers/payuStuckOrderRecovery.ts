/**
 * PayU stuck payin order recovery scheduler.
 *
 * Runs every 15 minutes and scans payu_payment_orders for rows whose
 * status is INITIATED or PENDING and that are older than the configurable
 * stale window (system_config key: payu_stuck_order_stale_minutes, default 30).
 *
 * For each stuck order it queries PayU's Verify Payment API and takes action:
 *   - "success"   → creditWalletForPayu (already idempotent — INITIATED/PENDING→SUCCESS guard)
 *   - "failure" / "cancelled" → marks order FAILED / CANCELLED respectively
 *   - "pending"   → leaves as-is (genuine bank-processing limbo, not stuck)
 *   - "not found" → leaves as-is, logs warning (txnid not in PayU's DB yet — may need more time)
 *   - API error   → leaves as-is, logs warning (transient network issue)
 *
 * After individual recoveries, counts remaining stuck orders and fires an admin
 * alert email when the count meets or exceeds the configured threshold and the
 * cooldown (payu_stuck_order_alert_cooldown_hours, default 4 h) has elapsed.
 *
 * Security guarantees:
 *   - Only acts on PayU-confirmed "success" — never credits on ambiguous/missing status.
 *   - creditWalletForPayu's atomic WHERE status IN (INITIATED, PENDING) guard prevents
 *     double-credit even under concurrent scheduler + webhook delivery.
 *   - Only scans production merchant orders — demo/seed orders never trigger an alert.
 *   - Credentials loaded the same way as the initiation route (env-var → encrypted DB row).
 *     If credentials are unavailable, API checks are skipped but the alert path still fires.
 */

import cron from "node-cron";
import { and, count, eq, inArray, lte, sql } from "drizzle-orm";
import {
  db,
  payuPaymentOrdersTable,
  providerIntegrationsTable,
  merchantsTable,
  systemConfigTable,
  SYSTEM_CONFIG_KEYS,
  PAYU_ORDER_STATUS,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { decryptSecret } from "./cryptoUtils";
import { queryPayuTransactionStatus, type PayuEnv } from "./payu";
import { creditWalletForPayu } from "../routes/payuOrders";
import { notifyAdminsOfStuckPayuOrders } from "./adminNotifyEmail";

// ── Credential loader (mirrors payuOrders.ts — kept local to avoid touching frozen file) ──

async function loadPayuCredsForScheduler(env: PayuEnv): Promise<{ key: string; salt: string } | null> {
  const envKey  = env === "live" ? process.env["PAYU_LIVE_KEY"]  : process.env["PAYU_UAT_KEY"];
  const envSalt = env === "live" ? process.env["PAYU_LIVE_SALT"] : process.env["PAYU_UAT_SALT"];
  if (envKey && envSalt) return { key: envKey, salt: envSalt };

  try {
    const [row] = await db
      .select()
      .from(providerIntegrationsTable)
      .where(eq(providerIntegrationsTable.providerKey, "payu"))
      .limit(1);

    if (!row) return null;

    if (env === "live") {
      const keyResult  = row.clientIdEncrypted     ? decryptSecret(row.clientIdEncrypted)     : null;
      const saltResult = row.clientSecretEncrypted ? decryptSecret(row.clientSecretEncrypted) : null;
      if (!keyResult?.ok || !saltResult?.ok)      return null;
      if (!keyResult.value || !saltResult.value)  return null;
      return { key: keyResult.value, salt: saltResult.value };
    }

    const keyResult  = row.apiKeyEncrypted    ? decryptSecret(row.apiKeyEncrypted)    : null;
    const saltResult = row.apiSecretEncrypted ? decryptSecret(row.apiSecretEncrypted) : null;
    if (!keyResult?.ok || !saltResult?.ok)  return null;
    if (!keyResult.value || !saltResult.value) return null;
    return { key: keyResult.value, salt: saltResult.value };
  } catch {
    return null;
  }
}

async function getConfigInt(key: string, fallback: number): Promise<number> {
  try {
    const [row] = await db
      .select({ value: systemConfigTable.value })
      .from(systemConfigTable)
      .where(eq(systemConfigTable.key, key))
      .limit(1);
    const parsed = parseInt(row?.value ?? "", 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  } catch {
    return fallback;
  }
}

async function getConfigStr(key: string, fallback: string): Promise<string> {
  try {
    const [row] = await db
      .select({ value: systemConfigTable.value })
      .from(systemConfigTable)
      .where(eq(systemConfigTable.key, key))
      .limit(1);
    return row?.value ?? fallback;
  } catch {
    return fallback;
  }
}

// ── Per-order recovery outcomes ────────────────────────────────────────────────

export type OrderRecoveryOutcome =
  | "credited"           // PayU confirmed success → wallet credited
  | "duplicate"          // PayU confirmed success but already credited — idempotent
  | "marked_failed"      // PayU confirmed failure → order marked FAILED
  | "marked_cancelled"   // PayU confirmed cancellation → order marked CANCELLED
  | "pending_skip"       // PayU says still pending — not stuck, leave it
  | "not_found_skip"     // PayU doesn't know this txnid yet — leave it
  | "api_error_skip"     // PayU API call failed (network/parse) — leave it
  | "no_creds_skip";     // Credentials unavailable — cannot query PayU

export interface OrderRecoveryResult {
  txnid: string;
  orderId: number;
  merchantId: number;
  outcome: OrderRecoveryOutcome;
  payuStatus?: string;
  errorMessage?: string;
}

// ── Full scan result ───────────────────────────────────────────────────────────

export interface PayuStuckOrderScanResult {
  scannedCount: number;         // orders queried against PayU
  recoveredCount: number;       // orders actually credited (outcome=credited)
  markedFailedCount: number;    // orders transitioned to FAILED
  markedCancelledCount: number; // orders transitioned to CANCELLED
  remainingStuckCount: number;  // INITIATED/PENDING orders still remaining after scan
  alertSent: boolean;
  noCredsSkipped: boolean;      // true if scan was unable to call PayU due to missing creds
  details: OrderRecoveryResult[];
}

// ── Recovery logic ─────────────────────────────────────────────────────────────

export async function runPayuStuckOrderRecovery(
  _notifyFn: typeof notifyAdminsOfStuckPayuOrders = notifyAdminsOfStuckPayuOrders,
): Promise<PayuStuckOrderScanResult> {
  const [staleMinutes, threshold, cooldownHours] = await Promise.all([
    getConfigInt(SYSTEM_CONFIG_KEYS.PAYU_STUCK_ORDER_STALE_MINUTES, 30),
    getConfigInt(SYSTEM_CONFIG_KEYS.PAYU_STUCK_ORDER_ALERT_THRESHOLD, 3),
    getConfigInt(SYSTEM_CONFIG_KEYS.PAYU_STUCK_ORDER_ALERT_COOLDOWN_HOURS, 4),
  ]);

  const staleThreshold = new Date(Date.now() - staleMinutes * 60 * 1000);

  // Load PayU environment + credentials once per scan run
  const env = (await getConfigStr(SYSTEM_CONFIG_KEYS.PAYU_ENV, "uat")) as PayuEnv;
  const creds = await loadPayuCredsForScheduler(env);

  // Scope to production merchants — demo/seed orders must never trigger payment-integrity alerts
  const prodMerchantIds = db
    .select({ id: merchantsTable.id })
    .from(merchantsTable)
    .where(eq(merchantsTable.environment, "production"));

  // Find orders stuck in INITIATED or PENDING older than staleMinutes
  const stuckOrders = await db
    .select({
      id:         payuPaymentOrdersTable.id,
      txnid:      payuPaymentOrdersTable.txnid,
      merchantId: payuPaymentOrdersTable.merchantId,
    })
    .from(payuPaymentOrdersTable)
    .where(and(
      inArray(payuPaymentOrdersTable.status, [
        PAYU_ORDER_STATUS.INITIATED,
        PAYU_ORDER_STATUS.PENDING,
      ]),
      lte(payuPaymentOrdersTable.createdAt, staleThreshold),
      inArray(payuPaymentOrdersTable.merchantId, prodMerchantIds),
    ));

  if (stuckOrders.length === 0) {
    logger.debug({ staleMinutes }, "PayU stuck order recovery: no stuck orders found");
    return {
      scannedCount: 0,
      recoveredCount: 0,
      markedFailedCount: 0,
      markedCancelledCount: 0,
      remainingStuckCount: 0,
      alertSent: false,
      noCredsSkipped: false,
      details: [],
    };
  }

  logger.warn(
    { stuckCount: stuckOrders.length, staleMinutes, env },
    "PayU stuck order recovery: stuck orders detected — querying PayU status",
  );

  const details: OrderRecoveryResult[] = [];
  let recoveredCount = 0;
  let markedFailedCount = 0;
  let markedCancelledCount = 0;
  let noCredsSkipped = false;

  if (!creds) {
    // Cannot query PayU without credentials — mark all as skipped
    noCredsSkipped = true;
    logger.warn(
      { stuckCount: stuckOrders.length, env },
      "PayU stuck order recovery: credentials unavailable — skipping API checks, will alert",
    );
    for (const order of stuckOrders) {
      details.push({
        txnid:     order.txnid,
        orderId:   order.id,
        merchantId: order.merchantId,
        outcome:   "no_creds_skip",
      });
    }
  } else {
    // Process each order sequentially to avoid overwhelming PayU's API
    for (const order of stuckOrders) {
      const result = await recoverSingleOrder(order, creds, env);
      details.push(result);
      if (result.outcome === "credited")         recoveredCount++;
      if (result.outcome === "marked_failed")    markedFailedCount++;
      if (result.outcome === "marked_cancelled") markedCancelledCount++;
    }
  }

  // Re-count remaining stuck orders after all recoveries
  const [countRow] = await db
    .select({ cnt: count() })
    .from(payuPaymentOrdersTable)
    .where(and(
      inArray(payuPaymentOrdersTable.status, [
        PAYU_ORDER_STATUS.INITIATED,
        PAYU_ORDER_STATUS.PENDING,
      ]),
      lte(payuPaymentOrdersTable.createdAt, staleThreshold),
      inArray(payuPaymentOrdersTable.merchantId, prodMerchantIds),
    ));

  const remainingStuckCount = countRow?.cnt ?? 0;

  logger.info(
    {
      scanned: stuckOrders.length,
      recovered: recoveredCount,
      markedFailed: markedFailedCount,
      markedCancelled: markedCancelledCount,
      remaining: remainingStuckCount,
      threshold,
    },
    "PayU stuck order recovery: scan complete",
  );

  let alertSent = false;
  if (remainingStuckCount >= threshold) {
    await _notifyFn({
      stuck: remainingStuckCount,
      threshold,
      staleMinutes,
      cooldownHours,
      recovered: recoveredCount,
      noCredsSkipped,
    });
    alertSent = true;
  }

  return {
    scannedCount: stuckOrders.length,
    recoveredCount,
    markedFailedCount,
    markedCancelledCount,
    remainingStuckCount,
    alertSent,
    noCredsSkipped,
    details,
  };
}

async function recoverSingleOrder(
  order: { id: number; txnid: string; merchantId: number },
  creds: { key: string; salt: string },
  env: PayuEnv,
): Promise<OrderRecoveryResult> {
  const base = { txnid: order.txnid, orderId: order.id, merchantId: order.merchantId };

  let statusResult;
  try {
    statusResult = await queryPayuTransactionStatus({ key: creds.key, salt: creds.salt, txnid: order.txnid, env });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.warn({ ...base, errorMessage }, "PayU stuck order recovery: API call threw unexpectedly");
    return { ...base, outcome: "api_error_skip", errorMessage };
  }

  if (!statusResult.ok) {
    if (statusResult.status === "not found") {
      logger.info({ ...base, env }, "PayU stuck order recovery: txnid not found at PayU yet — skipping");
      return { ...base, outcome: "not_found_skip", payuStatus: "not found" };
    }
    logger.warn(
      { ...base, errorMessage: statusResult.errorMessage },
      "PayU stuck order recovery: API error — skipping",
    );
    return { ...base, outcome: "api_error_skip", errorMessage: statusResult.errorMessage };
  }

  const payuStatus = statusResult.status ?? "";

  if (payuStatus === "success") {
    logger.info({ ...base, mihpayid: statusResult.mihpayid }, "PayU stuck order recovery: PayU confirms success — crediting wallet");
    const creditResult = await creditWalletForPayu(
      order.txnid,
      statusResult.mihpayid ?? null,
      statusResult.bankRefNo ?? null,
      statusResult.paymentMode ?? null,
      "payu_stuck_order_recovery",
    );
    if (creditResult.outcome === "credited") {
      logger.info({ ...base }, "PayU stuck order recovery: wallet credited successfully");
      return { ...base, outcome: "credited", payuStatus };
    }
    if (creditResult.outcome === "duplicate") {
      logger.info({ ...base }, "PayU stuck order recovery: already credited — idempotent");
      return { ...base, outcome: "duplicate", payuStatus };
    }
    // credit_failed or error — log but do not re-mark; creditWalletForPayu already handled it
    logger.error(
      { ...base, creditOutcome: creditResult.outcome },
      "PayU stuck order recovery: creditWalletForPayu returned non-success outcome",
    );
    return { ...base, outcome: "api_error_skip", payuStatus, errorMessage: `creditWallet outcome=${creditResult.outcome}` };
  }

  if (payuStatus === "failure" || payuStatus === "failed") {
    await db
      .update(payuPaymentOrdersTable)
      .set({ status: PAYU_ORDER_STATUS.FAILED })
      .where(and(
        eq(payuPaymentOrdersTable.txnid, order.txnid),
        inArray(payuPaymentOrdersTable.status, [PAYU_ORDER_STATUS.INITIATED, PAYU_ORDER_STATUS.PENDING]),
      ));
    logger.info({ ...base, payuStatus }, "PayU stuck order recovery: marked FAILED per PayU");
    return { ...base, outcome: "marked_failed", payuStatus };
  }

  if (payuStatus === "cancelled" || payuStatus === "cancel") {
    await db
      .update(payuPaymentOrdersTable)
      .set({ status: PAYU_ORDER_STATUS.CANCELLED })
      .where(and(
        eq(payuPaymentOrdersTable.txnid, order.txnid),
        inArray(payuPaymentOrdersTable.status, [PAYU_ORDER_STATUS.INITIATED, PAYU_ORDER_STATUS.PENDING]),
      ));
    logger.info({ ...base, payuStatus }, "PayU stuck order recovery: marked CANCELLED per PayU");
    return { ...base, outcome: "marked_cancelled", payuStatus };
  }

  if (payuStatus === "pending") {
    logger.debug({ ...base }, "PayU stuck order recovery: PayU says still pending — skipping");
    return { ...base, outcome: "pending_skip", payuStatus };
  }

  // Unrecognised status — do NOT credit, log and skip
  logger.warn({ ...base, payuStatus }, "PayU stuck order recovery: unrecognised PayU status — skipping without credit");
  return { ...base, outcome: "not_found_skip", payuStatus };
}

// ── Scheduler init ─────────────────────────────────────────────────────────────

export function initPayuStuckOrderScheduler(): void {
  // Run every 15 minutes
  cron.schedule("*/15 * * * *", async () => {
    try {
      const result = await runPayuStuckOrderRecovery();
      if (result.scannedCount > 0) {
        logger.warn(
          {
            scanned: result.scannedCount,
            recovered: result.recoveredCount,
            remaining: result.remainingStuckCount,
            alertSent: result.alertSent,
          },
          "PayU stuck order scheduler: completed with stuck orders",
        );
      }
    } catch (err) {
      logger.error({ err }, "PayU stuck order scheduler error");
    }
  });
  logger.info("PayU stuck order recovery scheduler initialised (every 15 min)");
}
