import cron from "node-cron";
import { db, usersTable } from "@workspace/db";
import { lt, isNotNull, and } from "drizzle-orm";
import { logger } from "../lib/logger";

/**
 * Nightly job that NULLs out any `reports_badge_snoozed_until` values that
 * have already expired.
 *
 * The GET /api/auth/me endpoint already filters these out at query time
 * (returns null for past timestamps), so they are harmless to read paths.
 * This job removes the stale rows so the column stays clean and doesn't
 * accumulate indefinitely.
 */
export async function runSnoozeCleanup(): Promise<number> {
  const now = new Date();
  const result = await db
    .update(usersTable)
    .set({ reportsBadgeSnoozedUntil: null })
    .where(
      and(
        isNotNull(usersTable.reportsBadgeSnoozedUntil),
        lt(usersTable.reportsBadgeSnoozedUntil, now)
      )
    )
    .returning({ id: usersTable.id });
  return result.length;
}

export function initSnoozeCleanupScheduler(): void {
  // Run once a day at 03:00 UTC
  cron.schedule("0 3 * * *", async () => {
    try {
      const cleared = await runSnoozeCleanup();
      if (cleared > 0) {
        logger.info({ cleared }, "Snooze cleanup: cleared expired snooze timestamps");
      }
    } catch (err) {
      logger.error({ err }, "Snooze cleanup scheduler failed");
    }
  });

  logger.info("Snooze cleanup scheduler registered (runs daily at 03:00 UTC)");
}
