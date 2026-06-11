import cron, { type ScheduledTask } from "node-cron";
import { db, systemConfigTable, SYSTEM_CONFIG_KEYS } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "../lib/logger";

const VA_CLEANUP_DEFAULT_DAYS = 30;

let cleanupTask: ScheduledTask | null = null;

export async function loadVaCleanupRetentionDays(): Promise<number> {
  const rows = await db
    .select()
    .from(systemConfigTable)
    .where(eq(systemConfigTable.key, SYSTEM_CONFIG_KEYS.VA_CLEANUP_RETENTION_DAYS));

  const raw = rows[0]?.value ?? String(VA_CLEANUP_DEFAULT_DAYS);
  const days = parseInt(raw);
  return isNaN(days) ? VA_CLEANUP_DEFAULT_DAYS : Math.max(0, days);
}

export async function runVaCleanup(): Promise<{ deleted: number }> {
  const retentionDays = await loadVaCleanupRetentionDays();

  if (retentionDays === 0) {
    logger.info("VA auto-cleanup is disabled (retention_days = 0) — skipping");
    return { deleted: 0 };
  }

  const deleteResult = await db.execute(sql`
    DELETE FROM virtual_accounts
    WHERE status = 'closed'
      AND updated_at < NOW() - (${retentionDays} || ' days')::interval
  `);
  const deleted = Number((deleteResult as any).rowCount ?? 0);

  logger.info({ retentionDays, deleted }, "VA auto-cleanup complete");
  return { deleted };
}

export function initVaCleanupScheduler(): void {
  if (cleanupTask) {
    cleanupTask.stop();
    cleanupTask = null;
  }

  cleanupTask = cron.schedule("0 3 * * *", async () => {
    try {
      await runVaCleanup();
    } catch (err) {
      logger.error({ err }, "VA auto-cleanup job failed");
    }
  });

  logger.info("VA cleanup scheduler registered (runs nightly at 03:00)");
}
