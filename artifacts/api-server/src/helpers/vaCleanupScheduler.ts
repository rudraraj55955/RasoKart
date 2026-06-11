import cron, { type ScheduledTask } from "node-cron";
import { db, systemConfigTable, SYSTEM_CONFIG_KEYS, SYSTEM_CONFIG_DEFAULTS } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "../lib/logger";

let cleanupTask: ScheduledTask | null = null;

export async function loadVaCleanupRetentionDays(): Promise<number> {
  const rows = await db
    .select()
    .from(systemConfigTable)
    .where(eq(systemConfigTable.key, SYSTEM_CONFIG_KEYS.VA_CLEANUP_RETENTION_DAYS));

  const raw =
    rows[0]?.value ?? SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.VA_CLEANUP_RETENTION_DAYS];
  const days = parseInt(raw);
  return isNaN(days) ? 30 : Math.max(0, days);
}

export async function runVaCleanup(): Promise<{ deleted: number }> {
  const retentionDays = await loadVaCleanupRetentionDays();

  if (retentionDays === 0) {
    logger.info("Virtual account auto-cleanup is disabled (retention_days = 0) — skipping");
    return { deleted: 0 };
  }

  // Delete closed virtual accounts whose updated_at is older than the retention
  // window. We anchor on updated_at (the moment the VA was closed) rather than
  // createdAt, so the retention window is measured from when the account was
  // actually deactivated, not when it was created.
  const deleteResult = await db.execute(sql`
    DELETE FROM virtual_accounts
    WHERE status = 'closed'
      AND updated_at < NOW() - (${retentionDays} || ' days')::interval
  `);
  const deleted = Number((deleteResult as any).rowCount ?? 0);

  logger.info({ retentionDays, deleted }, "Virtual account auto-cleanup complete");
  return { deleted };
}

export function initVaCleanupScheduler(): void {
  if (cleanupTask) {
    cleanupTask.stop();
    cleanupTask = null;
  }

  cleanupTask = cron.schedule("30 2 * * *", async () => {
    try {
      await runVaCleanup();
    } catch (err) {
      logger.error({ err }, "Virtual account auto-cleanup job failed");
    }
  });

  logger.info("VA cleanup scheduler registered (runs nightly at 02:30)");
}
