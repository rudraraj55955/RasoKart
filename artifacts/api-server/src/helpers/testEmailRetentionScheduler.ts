import cron, { type ScheduledTask } from "node-cron";
import { db, systemConfigTable, auditLogsTable, SYSTEM_CONFIG_KEYS, SYSTEM_CONFIG_DEFAULTS } from "@workspace/db";
import { eq, lt, sql } from "drizzle-orm";
import { logger } from "../lib/logger";

let cleanupTask: ScheduledTask | null = null;

export async function loadTestEmailRetentionDays(): Promise<number> {
  const rows = await db
    .select()
    .from(systemConfigTable)
    .where(eq(systemConfigTable.key, SYSTEM_CONFIG_KEYS.TEST_EMAIL_HISTORY_RETENTION_DAYS));

  const raw =
    rows[0]?.value ?? SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.TEST_EMAIL_HISTORY_RETENTION_DAYS];
  const days = parseInt(raw);
  return isNaN(days) ? 90 : Math.max(0, days);
}

export async function runTestEmailRetentionCleanup(): Promise<{ deleted: number }> {
  const retentionDays = await loadTestEmailRetentionDays();

  if (retentionDays === 0) {
    logger.info("Test email history auto-cleanup is disabled (retention_days = 0) — skipping");
    return { deleted: 0 };
  }

  const result = await db
    .delete(auditLogsTable)
    .where(
      sql`${auditLogsTable.action} = 'test_email_sent'
          AND ${auditLogsTable.createdAt} < NOW() - (${retentionDays} || ' days')::interval`,
    );

  const deleted = Number((result as any).rowCount ?? 0);

  if (deleted > 0) {
    logger.info({ deleted, retentionDays }, "Test email history cleanup: pruned old test_email_sent rows");
  } else {
    logger.debug({ retentionDays }, "Test email history cleanup: no rows old enough to prune");
  }

  return { deleted };
}

export function initTestEmailRetentionScheduler(): void {
  if (cleanupTask) {
    cleanupTask.stop();
    cleanupTask = null;
  }

  cleanupTask = cron.schedule("0 1 * * *", async () => {
    logger.debug("Test email history cleanup job triggered");
    try {
      await runTestEmailRetentionCleanup();
    } catch (err) {
      logger.error({ err }, "Test email history cleanup job failed");
    }
  });

  logger.info("Test email history retention scheduler registered (runs nightly at 01:00)");
}
