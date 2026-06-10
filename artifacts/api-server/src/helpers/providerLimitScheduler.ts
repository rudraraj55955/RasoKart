/**
 * Proactive provider-limit alert scheduler.
 *
 * Runs every hour and scans ALL active merchant connections to check
 * whether any have crossed the 80% or 100% monthly-limit threshold.
 * Alerts (in-app notification + email) are sent independent of whether
 * the merchant is logged in.
 *
 * Deduplication is handled at the DB level: each threshold fires at most
 * once per provider per billing month, enforced by the partial unique
 * index `notifications_provider_limit_dedup_idx`.
 */

import cron from "node-cron";
import { db, merchantConnectionsTable, merchantsTable, transactionsTable, usersTable } from "@workspace/db";
import { eq, and, gt, sql, sum, inArray } from "drizzle-orm";
import { maybeNotifyProviderLimit, maybeNotifyProviderLimitReset } from "./providerLimitNotifier";
import { logger } from "../lib/logger";

interface ConnectionRow {
  id: number;
  userId: number;
  merchantId: number;
  provider: string;
  monthlyLimit: number;
  merchantEmail: string;
  merchantName: string;
}

/** Fetch all active connections that have a monthly limit configured. */
async function loadActiveConnections(): Promise<ConnectionRow[]> {
  const rows = await db
    .select({
      id: merchantConnectionsTable.id,
      merchantId: merchantConnectionsTable.merchantId,
      provider: merchantConnectionsTable.provider,
      monthlyLimit: merchantConnectionsTable.monthlyLimit,
      merchantEmail: merchantsTable.email,
      merchantName: merchantsTable.businessName,
    })
    .from(merchantConnectionsTable)
    .innerJoin(merchantsTable, eq(merchantConnectionsTable.merchantId, merchantsTable.id))
    .where(
      and(
        eq(merchantConnectionsTable.isActive, true),
        gt(merchantConnectionsTable.monthlyLimit, "0"),
        eq(merchantsTable.status, "approved"),
      )
    );

  if (rows.length === 0) return [];

  // Resolve merchant userId (needed for notification.userId FK)
  const merchantIds = [...new Set(rows.map(r => r.merchantId))];
  const userRows = await db
    .select({ merchantId: usersTable.merchantId, userId: usersTable.id })
    .from(usersTable)
    .where(
      and(
        inArray(usersTable.merchantId, merchantIds),
        eq(usersTable.isActive, true),
      )
    );

  const merchantUserMap = new Map<number, number>();
  for (const u of userRows) {
    if (u.merchantId != null) merchantUserMap.set(u.merchantId, u.userId);
  }

  return rows
    .filter(r => merchantUserMap.has(r.merchantId))
    .map(r => ({
      id: r.id,
      userId: merchantUserMap.get(r.merchantId)!,
      merchantId: r.merchantId,
      provider: r.provider,
      monthlyLimit: Number(r.monthlyLimit),
      merchantEmail: r.merchantEmail,
      merchantName: r.merchantName,
    }));
}

/** Calculate current-month usage for a set of connection IDs in one query. */
async function buildUsageMap(connectionIds: number[]): Promise<Map<number, number>> {
  if (connectionIds.length === 0) return new Map();

  const rows = await db
    .select({
      connectionId: transactionsTable.connectionId,
      total: sum(transactionsTable.amount),
    })
    .from(transactionsTable)
    .where(
      and(
        sql`${transactionsTable.connectionId} = ANY(${sql.raw(`ARRAY[${connectionIds.join(",")}]::int[]`)})`,
        eq(transactionsTable.type, "deposit"),
        eq(transactionsTable.status, "success"),
        sql`date_trunc('month', ${transactionsTable.createdAt}) = date_trunc('month', now())`
      )
    )
    .groupBy(transactionsTable.connectionId);

  const map = new Map<number, number>();
  for (const r of rows) {
    if (r.connectionId != null) map.set(r.connectionId, Number(r.total ?? 0));
  }
  return map;
}

/** Core scan: check all active connections and fire alerts where needed. */
export async function runProviderLimitAlertScan(): Promise<void> {
  const connections = await loadActiveConnections();
  if (connections.length === 0) {
    logger.debug("Provider limit alert scan: no active connections to check");
    return;
  }

  const connectionIds = connections.map(c => c.id);
  const usageMap = await buildUsageMap(connectionIds);

  logger.info(
    { connectionCount: connections.length },
    "Provider limit alert scan starting"
  );

  let alertsFired = 0;
  let resetsFired = 0;

  await Promise.all(
    connections.map(async (conn) => {
      const monthlyUsed = usageMap.get(conn.id) ?? 0;
      const pct = conn.monthlyLimit > 0 ? monthlyUsed / conn.monthlyLimit : 0;

      try {
        if (pct >= 0.8) {
          await maybeNotifyProviderLimit(
            conn.userId,
            conn.provider,
            monthlyUsed,
            conn.monthlyLimit,
            conn.merchantEmail,
            conn.merchantName,
          );
          alertsFired++;
        }

        await maybeNotifyProviderLimitReset(conn.userId, conn.provider, conn.monthlyLimit);
        resetsFired++;
      } catch (err) {
        logger.warn(
          { err, connectionId: conn.id, provider: conn.provider, merchantId: conn.merchantId },
          "Provider limit alert scan failed for one connection — continuing"
        );
      }
    })
  );

  logger.info(
    { connectionCount: connections.length, alertsFired, resetsFired },
    "Provider limit alert scan complete"
  );
}

/** Register the hourly cron job. Called once at server startup. */
export function startProviderLimitAlertScheduler(): void {
  // Run at the top of every hour
  cron.schedule("0 * * * *", async () => {
    try {
      await runProviderLimitAlertScan();
    } catch (err) {
      logger.error({ err }, "Provider limit alert scheduler failed");
    }
  });

  logger.info("Provider limit alert scheduler registered (runs every hour)");
}
