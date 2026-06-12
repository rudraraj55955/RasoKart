import cron, { type ScheduledTask } from "node-cron";
import { db, systemConfigTable, SYSTEM_CONFIG_KEYS, SYSTEM_CONFIG_DEFAULTS, cleanupRunHistoryTable } from "@workspace/db";
import { eq, inArray, sql, desc, asc } from "drizzle-orm";
import { logger } from "../lib/logger";

const HISTORY_LIMIT = 10;

let cleanupTask: ScheduledTask | null = null;

export async function loadQrCleanupRetentionDays(): Promise<number> {
  const rows = await db
    .select()
    .from(systemConfigTable)
    .where(eq(systemConfigTable.key, SYSTEM_CONFIG_KEYS.QR_CLEANUP_RETENTION_DAYS));

  const raw =
    rows[0]?.value ?? SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.QR_CLEANUP_RETENTION_DAYS];
  const days = parseInt(raw);
  return isNaN(days) ? 30 : Math.max(0, days);
}

async function persistQrCleanupStats(deleted: number, retentionDays: number, triggeredBy: string): Promise<void> {
  const now = new Date().toISOString();
  const entries = [
    { key: SYSTEM_CONFIG_KEYS.QR_CLEANUP_LAST_RUN_AT, value: now },
    { key: SYSTEM_CONFIG_KEYS.QR_CLEANUP_LAST_RUN_DELETED, value: String(deleted) },
  ];
  for (const entry of entries) {
    await db
      .insert(systemConfigTable)
      .values(entry)
      .onConflictDoUpdate({
        target: systemConfigTable.key,
        set: { value: entry.value, updatedAt: sql`now()` },
      });
  }

  await db.insert(cleanupRunHistoryTable).values({
    type: "qr",
    ranAt: new Date(),
    deleted,
    retentionDays,
    triggeredBy,
  });

  const allRows = await db
    .select({ id: cleanupRunHistoryTable.id })
    .from(cleanupRunHistoryTable)
    .where(eq(cleanupRunHistoryTable.type, "qr"))
    .orderBy(desc(cleanupRunHistoryTable.ranAt));

  if (allRows.length > HISTORY_LIMIT) {
    const idsToDelete = allRows.slice(HISTORY_LIMIT).map((r) => r.id);
    await db.execute(
      sql`DELETE FROM cleanup_run_history WHERE id = ANY(${idsToDelete})`
    );
  }
}

export async function runQrCleanup(triggeredBy: string = "scheduled"): Promise<{ expired: number; deleted: number }> {
  const retentionDays = await loadQrCleanupRetentionDays();

  if (retentionDays === 0) {
    logger.info("QR code auto-cleanup is disabled (retention_days = 0) — skipping");
    return { expired: 0, deleted: 0 };
  }

  // Step 1: Mark any active codes whose expires_at has passed as 'expired'.
  // This mirrors the opportunistic expireOldQrCodes() used in API routes, but
  // runs as a guaranteed background step so codes are caught even if no QR
  // route was ever called.
  const expireResult = await db.execute(sql`
    UPDATE qr_codes
    SET status = 'expired'
    WHERE expires_at IS NOT NULL
      AND expires_at < NOW()
      AND status = 'active'
  `);
  const expired = Number((expireResult as any).rowCount ?? 0);
  if (expired > 0) {
    logger.info({ expired }, "QR code auto-cleanup: marked active-but-past-expiry codes as expired");
  }

  // Step 2: Delete QR codes past their retention window.
  // - For expired-by-date codes: anchor on expires_at (the canonical moment the
  //   code became stale), so retentionDays is measured from actual expiry.
  // - For used codes: anchor on updated_at (when the code was marked 'used');
  //   used codes don't necessarily have an expires_at.
  const deleteResult = await db.execute(sql`
    DELETE FROM qr_codes
    WHERE
      (status = 'expired'
        AND expires_at IS NOT NULL
        AND expires_at < NOW() - (${retentionDays} || ' days')::interval)
      OR
      (status = 'used'
        AND updated_at < NOW() - (${retentionDays} || ' days')::interval)
  `);
  const deleted = Number((deleteResult as any).rowCount ?? 0);

  logger.info({ retentionDays, expired, deleted, triggeredBy }, "QR code auto-cleanup complete");

  await persistQrCleanupStats(deleted, retentionDays, triggeredBy);

  return { expired, deleted };
}

export async function loadQrCleanupLastRun(): Promise<{ lastRunAt: string | null; lastDeleted: number | null }> {
  const rows = await db
    .select()
    .from(systemConfigTable)
    .where(inArray(systemConfigTable.key, [
      SYSTEM_CONFIG_KEYS.QR_CLEANUP_LAST_RUN_AT,
      SYSTEM_CONFIG_KEYS.QR_CLEANUP_LAST_RUN_DELETED,
    ]));
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const lastRunAt = map.get(SYSTEM_CONFIG_KEYS.QR_CLEANUP_LAST_RUN_AT) ?? null;
  const lastDeletedRaw = map.get(SYSTEM_CONFIG_KEYS.QR_CLEANUP_LAST_RUN_DELETED);
  const lastDeleted = lastDeletedRaw != null ? parseInt(lastDeletedRaw) : null;
  return { lastRunAt, lastDeleted };
}

export async function loadQrCleanupHistory(): Promise<Array<{ id: number; ranAt: Date; deleted: number; retentionDays: number; triggeredBy: string }>> {
  return db
    .select()
    .from(cleanupRunHistoryTable)
    .where(eq(cleanupRunHistoryTable.type, "qr"))
    .orderBy(desc(cleanupRunHistoryTable.ranAt))
    .limit(HISTORY_LIMIT);
}

export function initQrCleanupScheduler(): void {
  if (cleanupTask) {
    cleanupTask.stop();
    cleanupTask = null;
  }

  cleanupTask = cron.schedule("0 2 * * *", async () => {
    try {
      await runQrCleanup("scheduled");
    } catch (err) {
      logger.error({ err }, "QR code auto-cleanup job failed");
    }
  });

  logger.info("QR cleanup scheduler registered (runs nightly at 02:00)");
}
