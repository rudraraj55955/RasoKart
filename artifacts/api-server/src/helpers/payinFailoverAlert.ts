/**
 * maybeFireFailoverAlert
 *
 * Best-effort admin alert for routing-chain exhaustion events.
 *
 * On every chain-exhaustion event (all configured gateways failed for a
 * given order), this helper:
 *   1. Reads FAILOVER_ALERT_THRESHOLD and FAILOVER_ALERT_WINDOW_MINUTES
 *      from system_config (falls back to 5 / 60 if the rows are absent or
 *      NaN-producing).
 *   2. Counts routing_log "failed" rows inside the rolling window.
 *   3. If count >= threshold AND no gateway_failover_exhausted notification
 *      already exists in the window (dedup guard), inserts one notification
 *      row per active admin.
 *
 * Never throws — any error is logged and swallowed so it never affects the
 * 503 response the caller is about to send.
 */

import {
  db,
  systemConfigTable,
  routingLogsTable,
  notificationsTable,
  usersTable,
  SYSTEM_CONFIG_KEYS,
} from "@workspace/db";
import { eq, and, gte, sql } from "drizzle-orm";

type MinLogger = {
  warn: (obj: object, msg: string) => void;
  error: (obj: object, msg: string) => void;
};

export async function maybeFireFailoverAlert(
  merchantId: number,
  log: MinLogger,
): Promise<void> {
  try {
    // ── 1. Read threshold & window from system_config ─────────────────────
    const alertConfigRows = await db
      .select({ key: systemConfigTable.key, value: systemConfigTable.value })
      .from(systemConfigTable)
      .where(eq(systemConfigTable.key, SYSTEM_CONFIG_KEYS.FAILOVER_ALERT_THRESHOLD));

    const alertWindowRows = await db
      .select({ key: systemConfigTable.key, value: systemConfigTable.value })
      .from(systemConfigTable)
      .where(eq(systemConfigTable.key, SYSTEM_CONFIG_KEYS.FAILOVER_ALERT_WINDOW_MINUTES));

    const rawThreshold = parseInt(alertConfigRows[0]?.value ?? "5");
    const rawWindow = parseInt(alertWindowRows[0]?.value ?? "60");

    // NaN-guard + minimum-value clamp (must be at least 1)
    const threshold = Number.isFinite(rawThreshold) && rawThreshold >= 1 ? rawThreshold : 5;
    const windowMinutes = Number.isFinite(rawWindow) && rawWindow >= 1 ? rawWindow : 60;
    const windowMs = windowMinutes * 60 * 1000;
    const windowStart = new Date(Date.now() - windowMs);

    // ── 2. Count failures in the rolling window ───────────────────────────
    const [countRow] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(routingLogsTable)
      .where(
        and(
          gte(routingLogsTable.createdAt, windowStart),
          eq(routingLogsTable.result, "failed"),
        ),
      );
    const failureCount = countRow?.count ?? 0;

    if (failureCount < threshold) {
      return;
    }

    // ── 3. Dedup guard — only one alert per window ────────────────────────
    const [existingAlert] = await db
      .select({ id: notificationsTable.id })
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.type, "gateway_failover_exhausted"),
          gte(notificationsTable.createdAt, windowStart),
        ),
      )
      .limit(1);

    if (existingAlert) {
      return;
    }

    // ── 4. Fetch active admins ────────────────────────────────────────────
    const adminUsers = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(eq(usersTable.role, "admin"), eq(usersTable.isActive, true)));

    if (adminUsers.length === 0) {
      return;
    }

    // ── 5. Read outage-start marker (for correlation with recovery event) ─
    const [chainMarker] = await db
      .select({ value: systemConfigTable.value })
      .from(systemConfigTable)
      .where(eq(systemConfigTable.key, SYSTEM_CONFIG_KEYS.PAYIN_CHAIN_EXHAUSTED_SINCE))
      .limit(1);
    const outageStartedAt = chainMarker?.value ?? new Date().toISOString();

    const windowLabel =
      windowMinutes >= 60
        ? `${windowMinutes / 60}h`
        : `${windowMinutes}m`;

    // ── 6. Insert one notification per admin ──────────────────────────────
    await db
      .insert(notificationsTable)
      .values(
        adminUsers.map((u) => ({
          userId: u.id,
          type: "gateway_failover_exhausted" as const,
          title: "Payment Gateway Failover Chain Exhausted",
          body: `All configured payment gateways failed ${failureCount} times in the last ${windowLabel}. Merchants may be unable to initiate deposits. Please review gateway health and routing configuration immediately.`,
          metadata: {
            failureCount,
            windowMinutes,
            triggerMerchantId: merchantId,
            outageStartedAt,
          },
        })),
      )
      .onConflictDoNothing();

    log.warn(
      {
        event: "payin_failover_exhausted_admin_notified",
        merchantId,
        failureCount,
        threshold,
        windowMinutes,
        adminCount: adminUsers.length,
      },
      "payin_failover_exhausted_admin_notified",
    );
  } catch (err) {
    log.error(
      { event: "payin_failover_alert_failed", merchantId, err },
      "payin_failover_alert_failed",
    );
  }
}
