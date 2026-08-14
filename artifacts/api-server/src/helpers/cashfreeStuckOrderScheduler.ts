/**
 * Cashfree stuck payin order alert scheduler.
 *
 * Runs every 30 minutes and counts cashfree_payment_orders rows whose
 * status is not PAID and that are older than the configurable stale window
 * (system_config key: cashfree_stuck_order_stale_minutes, default 15).
 *
 * When the count meets or exceeds the threshold
 * (system_config key: cashfree_stuck_order_alert_threshold, default 5),
 * an email is sent to every active admin — no opt-out, same policy as
 * credential rotation alerts because payment integrity is critical.
 *
 * A cooldown (cashfree_stuck_order_alert_cooldown_hours, default 4 h)
 * prevents alert storms during prolonged outages.
 *
 * Wallet-load orders (cashfree_order_id LIKE 'WLOAD_%') are excluded because
 * they follow a different credit lifecycle and should not trigger this alert.
 */

import cron from "node-cron";
import {
  db,
  cashfreePaymentOrdersTable,
  merchantsTable,
  systemConfigTable,
  SYSTEM_CONFIG_KEYS,
  PAYIN_ORDER_STATUS,
} from "@workspace/db";
import { and, count, eq, inArray, lte, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { notifyAdminsOfStuckCashfreeOrders } from "./adminNotifyEmail";

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

export interface StuckOrderScanResult {
  stuckCount: number;
  staleMinutes: number;
  threshold: number;
  alertSent: boolean;
}

export async function runStuckCashfreeOrderScan(): Promise<StuckOrderScanResult> {
  const [staleMinutes, threshold, cooldownHours] = await Promise.all([
    getConfigInt(SYSTEM_CONFIG_KEYS.CASHFREE_STUCK_ORDER_STALE_MINUTES, 15),
    getConfigInt(SYSTEM_CONFIG_KEYS.CASHFREE_STUCK_ORDER_ALERT_THRESHOLD, 5),
    getConfigInt(SYSTEM_CONFIG_KEYS.CASHFREE_STUCK_ORDER_ALERT_COOLDOWN_HOURS, 4),
  ]);

  const staleThreshold = new Date(Date.now() - staleMinutes * 60 * 1000);

  // Scope to production merchants only — consistent with the dashboard card
  // which also defaults to envParam="production". Demo/seed orders should
  // never trigger a payment-integrity alert.
  const prodMerchantIds = db
    .select({ id: merchantsTable.id })
    .from(merchantsTable)
    .where(eq(merchantsTable.environment, "production"));

  // Only CREATED/PENDING are actionable stuck states.
  // FAILED and EXPIRED are terminal — counting them would fire the alert
  // forever on ordinary abandoned payments even when webhooks are healthy.
  const [row] = await db
    .select({ cnt: count() })
    .from(cashfreePaymentOrdersTable)
    .where(and(
      inArray(cashfreePaymentOrdersTable.status, [
        PAYIN_ORDER_STATUS.CREATED,
        PAYIN_ORDER_STATUS.PENDING,
      ]),
      lte(cashfreePaymentOrdersTable.createdAt, staleThreshold),
      sql`${cashfreePaymentOrdersTable.cashfreeOrderId} NOT LIKE 'WLOAD_%'`,
      inArray(cashfreePaymentOrdersTable.merchantId, prodMerchantIds),
    ));

  const stuckCount = row?.cnt ?? 0;

  logger.debug(
    { stuckCount, threshold, staleMinutes },
    "Cashfree stuck order scan complete",
  );

  let alertSent = false;
  if (stuckCount >= threshold) {
    await notifyAdminsOfStuckCashfreeOrders({ stuck: stuckCount, threshold, staleMinutes, cooldownHours });
    alertSent = true;
  }

  return { stuckCount, staleMinutes, threshold, alertSent };
}

export function initCashfreeStuckOrderScheduler(): void {
  // Run every 30 minutes
  cron.schedule("*/30 * * * *", async () => {
    try {
      const result = await runStuckCashfreeOrderScan();
      if (result.stuckCount > 0) {
        logger.warn(result, "Cashfree stuck order scheduler: found stuck orders");
      }
    } catch (err) {
      logger.error({ err }, "Cashfree stuck order scheduler error");
    }
  });
  logger.info("Cashfree stuck order scheduler initialised (every 30 min)");
}
