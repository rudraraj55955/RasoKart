import cron, { type ScheduledTask } from "node-cron";
import { db, systemConfigTable, SYSTEM_CONFIG_KEYS } from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";
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

export async function runVaCleanup(): Promise<{ closed: number; deleted: number }> {
  const retentionDays = await loadVaCleanupRetentionDays();

  if (retentionDays === 0) {
    logger.info("VA auto-cleanup is disabled (retention_days = 0) — skipping");
    return { closed: 0, deleted: 0 };
  }

  // Step 1: Close active VAs that have never received any funds (totalCollection = '0.00')
  // and have no associated transactions, and were created more than retention days ago.
  const closeResult = await db.execute(sql`
    UPDATE virtual_accounts
    SET status = 'closed', updated_at = NOW()
    WHERE status = 'active'
      AND total_collection = '0.00'
      AND created_at < NOW() - (${retentionDays} || ' days')::interval
      AND id NOT IN (
        SELECT DISTINCT virtual_account_id
        FROM transactions
        WHERE virtual_account_id IS NOT NULL
      )
  `);
  const closed = Number((closeResult as any).rowCount ?? 0);

  if (closed > 0) {
    logger.info({ closed }, "VA cleanup: closed unused active virtual accounts");
  }

  // Step 2: Delete closed VAs that have zero balance and zero totalCollection,
  // no linked transactions, and were last updated more than retention days ago.
  const deleteResult = await db.execute(sql`
    DELETE FROM virtual_accounts
    WHERE status = 'closed'
      AND balance = '0.00'
      AND total_collection = '0.00'
      AND updated_at < NOW() - (${retentionDays} || ' days')::interval
      AND id NOT IN (
        SELECT DISTINCT virtual_account_id
        FROM transactions
        WHERE virtual_account_id IS NOT NULL
      )
  `);
  const deleted = Number((deleteResult as any).rowCount ?? 0);

  logger.info({ retentionDays, closed, deleted }, "VA auto-cleanup complete");

  await writeVaCleanupLastRun(deleted);

  return { closed, deleted };
}

async function writeVaCleanupLastRun(deleted: number): Promise<void> {
  const now = new Date().toISOString();
  const entries = [
    { key: SYSTEM_CONFIG_KEYS.VA_CLEANUP_LAST_RUN_AT, value: now },
    { key: SYSTEM_CONFIG_KEYS.VA_CLEANUP_LAST_DELETED, value: String(deleted) },
  ];
  for (const entry of entries) {
    await db
      .insert(systemConfigTable)
      .values({ key: entry.key, value: entry.value })
      .onConflictDoUpdate({
        target: systemConfigTable.key,
        set: { value: entry.value, updatedAt: sql`now()` },
      });
  }
}

export async function loadVaCleanupLastRun(): Promise<{ lastRunAt: string | null; lastDeleted: number | null }> {
  const rows = await db
    .select()
    .from(systemConfigTable)
    .where(inArray(systemConfigTable.key, [
      SYSTEM_CONFIG_KEYS.VA_CLEANUP_LAST_RUN_AT,
      SYSTEM_CONFIG_KEYS.VA_CLEANUP_LAST_DELETED,
    ]));
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const lastRunAt = map.get(SYSTEM_CONFIG_KEYS.VA_CLEANUP_LAST_RUN_AT) ?? null;
  const lastDeletedRaw = map.get(SYSTEM_CONFIG_KEYS.VA_CLEANUP_LAST_DELETED);
  const lastDeleted = lastDeletedRaw != null ? parseInt(lastDeletedRaw) : null;
  return { lastRunAt, lastDeleted };
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
