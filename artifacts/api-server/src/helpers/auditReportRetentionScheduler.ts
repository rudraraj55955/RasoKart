import cron, { type ScheduledTask } from "node-cron";
import { db, systemConfigTable, SYSTEM_CONFIG_KEYS, SYSTEM_CONFIG_DEFAULTS, scheduledAuditReportLogsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "../lib/logger";

let retentionTask: ScheduledTask | null = null;

export async function loadAuditReportLogRetentionDays(): Promise<number> {
  const rows = await db
    .select()
    .from(systemConfigTable)
    .where(eq(systemConfigTable.key, SYSTEM_CONFIG_KEYS.AUDIT_REPORT_LOG_RETENTION_DAYS));

  const raw =
    rows[0]?.value ?? SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.AUDIT_REPORT_LOG_RETENTION_DAYS];
  const days = parseInt(raw);
  return isNaN(days) ? 90 : Math.max(0, days);
}

export async function runAuditReportLogCleanup(): Promise<{ deleted: number }> {
  const retentionDays = await loadAuditReportLogRetentionDays();

  if (retentionDays === 0) {
    logger.info("Audit report log retention is disabled (retention_days = 0) — skipping cleanup");
    return { deleted: 0 };
  }

  const deleteResult = await db.execute(sql`
    DELETE FROM ${scheduledAuditReportLogsTable}
    WHERE sent_at < NOW() - (${retentionDays} || ' days')::interval
  `);
  const deleted = Number((deleteResult as any).rowCount ?? 0);

  logger.info({ retentionDays, deleted }, "Audit report log cleanup complete");
  return { deleted };
}

export function initAuditReportRetentionScheduler(): void {
  if (retentionTask) {
    retentionTask.stop();
    retentionTask = null;
  }

  retentionTask = cron.schedule("30 2 * * *", async () => {
    try {
      await runAuditReportLogCleanup();
    } catch (err) {
      logger.error({ err }, "Audit report log retention cleanup job failed");
    }
  });

  logger.info("Audit report log retention scheduler registered (runs nightly at 02:30)");
}
