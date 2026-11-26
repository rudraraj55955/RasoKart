import cron, { type ScheduledTask } from "node-cron";
import {
  cleanupRunHistoryTable,
  db,
  emailDeliveryLogsTable,
  SYSTEM_CONFIG_DEFAULTS,
  SYSTEM_CONFIG_KEYS,
  systemConfigTable,
} from "@workspace/db";
import { desc, eq, sql } from "drizzle-orm";
import { logger } from "../lib/logger";

const MIN_RETENTION_DAYS = 7;
const HISTORY_LIMIT = 20;
const FAILED_CLEANUP_SUMMARY = "Cleanup could not complete. Check server logs for technical details.";
let retentionTask: ScheduledTask | null = null;

async function trimPasswordResetDeliveryCleanupHistory(): Promise<void> {
  const history = await db
    .select({ id: cleanupRunHistoryTable.id })
    .from(cleanupRunHistoryTable)
    .where(eq(cleanupRunHistoryTable.type, "password_reset_delivery"))
    .orderBy(desc(cleanupRunHistoryTable.ranAt));
  if (history.length > HISTORY_LIMIT) {
    const ids = history.slice(HISTORY_LIMIT).map(({ id }) => id);
    await db.execute(sql`DELETE FROM cleanup_run_history WHERE id = ANY(${ids})`);
  }
}

async function recordFailedCleanup(
  trigger: "scheduled" | "manual",
  retentionDays: number,
): Promise<void> {
  await db.insert(cleanupRunHistoryTable).values({
    type: "password_reset_delivery",
    trigger,
    triggeredBy: trigger,
    status: "failed",
    summary: FAILED_CLEANUP_SUMMARY,
    deleted: 0,
    retentionDays,
  });
  await trimPasswordResetDeliveryCleanupHistory();
}

export async function loadPasswordResetDeliveryRetentionDays(): Promise<number> {
  const [row] = await db
    .select({ value: systemConfigTable.value })
    .from(systemConfigTable)
    .where(eq(systemConfigTable.key, SYSTEM_CONFIG_KEYS.PASSWORD_RESET_DELIVERY_RETENTION_DAYS))
    .limit(1);
  const fallback = SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.PASSWORD_RESET_DELIVERY_RETENTION_DAYS];
  const parsed = Number.parseInt(row?.value ?? fallback, 10);
  return Number.isFinite(parsed) ? Math.max(MIN_RETENTION_DAYS, parsed) : 30;
}

export async function runPasswordResetDeliveryCleanup(
  trigger: "scheduled" | "manual" = "scheduled",
): Promise<{ deleted: number; retentionDays: number }> {
  let retentionDays = 0;
  try {
    retentionDays = await loadPasswordResetDeliveryRetentionDays();
    const result = await db.delete(emailDeliveryLogsTable).where(sql`
      ${emailDeliveryLogsTable.purpose} = 'PASSWORD_RESET'
      AND GREATEST(
        ${emailDeliveryLogsTable.createdAt},
        ${emailDeliveryLogsTable.updatedAt},
        COALESCE(${emailDeliveryLogsTable.lastEventAt}, ${emailDeliveryLogsTable.createdAt})
      ) < NOW() - (${retentionDays} || ' days')::interval
    `);
    const deleted = Number((result as { rowCount?: number }).rowCount ?? 0);

    await db.insert(cleanupRunHistoryTable).values({
      type: "password_reset_delivery",
      trigger,
      triggeredBy: trigger,
      status: "success",
      summary: null,
      deleted,
      retentionDays,
    });
    await trimPasswordResetDeliveryCleanupHistory();

    logger.info({ retentionDays, trigger, deleted }, "Password reset delivery retention cleanup complete");
    return { deleted, retentionDays };
  } catch (err) {
    try {
      await recordFailedCleanup(trigger, retentionDays);
    } catch (historyErr) {
      logger.warn({ err: historyErr, trigger }, "Failed to record password reset delivery cleanup failure");
    }
    throw err;
  }
}

export async function loadPasswordResetDeliveryCleanupHistory() {
  return db
    .select({
      id: cleanupRunHistoryTable.id,
      trigger: cleanupRunHistoryTable.trigger,
      ranAt: cleanupRunHistoryTable.ranAt,
      status: cleanupRunHistoryTable.status,
      summary: cleanupRunHistoryTable.summary,
      deleted: cleanupRunHistoryTable.deleted,
      retentionDays: cleanupRunHistoryTable.retentionDays,
    })
    .from(cleanupRunHistoryTable)
    .where(eq(cleanupRunHistoryTable.type, "password_reset_delivery"))
    .orderBy(desc(cleanupRunHistoryTable.ranAt))
    .limit(HISTORY_LIMIT);
}

export function initPasswordResetDeliveryRetentionScheduler(): void {
  retentionTask?.stop();
  retentionTask = cron.schedule("45 2 * * *", async () => {
    try {
      await runPasswordResetDeliveryCleanup("scheduled");
    } catch (err) {
      logger.error({ err }, "Password reset delivery retention cleanup failed");
    }
  });
  logger.info("Password reset delivery retention scheduler registered (runs nightly at 02:45)");
}