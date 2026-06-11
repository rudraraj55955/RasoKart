import cron, { type ScheduledTask } from "node-cron";
import { db, callbackNoncesTable } from "@workspace/db";
import { lt } from "drizzle-orm";
import { logger } from "../lib/logger";

let cleanupTask: ScheduledTask | null = null;

/**
 * Delete all rows from `callback_nonces` where `expires_at` is in the past.
 *
 * This is the scheduled counterpart to the lazy per-request prune in
 * `callbackAuth.ts`. The lazy prune only fires when a new nonce is written, so
 * during quiet periods (no inbound callbacks) expired rows accumulate. Running
 * this job every few hours keeps the table lean regardless of traffic.
 *
 * Returns the number of rows deleted.
 */
export async function pruneExpiredNonces(): Promise<number> {
  const result = await db
    .delete(callbackNoncesTable)
    .where(lt(callbackNoncesTable.expiresAt, new Date()));

  const deleted = Number((result as any).rowCount ?? 0);

  if (deleted > 0) {
    logger.info({ deleted }, "Nonce cleanup: pruned expired callback_nonces rows");
  } else {
    logger.debug("Nonce cleanup: no expired callback_nonces rows found");
  }

  return deleted;
}

/**
 * Register the nonce cleanup cron job.
 *
 * Runs every 6 hours (at :00 on hours 0, 6, 12, 18 UTC) so the table never
 * accumulates more than ~6 hours of stale rows even during fully quiet periods.
 * Calling this more than once is safe — the previous task is stopped first.
 */
export function initNonceCleanupScheduler(): void {
  if (cleanupTask) {
    cleanupTask.stop();
    cleanupTask = null;
  }

  cleanupTask = cron.schedule("0 */6 * * *", async () => {
    try {
      await pruneExpiredNonces();
    } catch (err) {
      logger.error({ err }, "Nonce cleanup job failed");
    }
  });

  logger.info("Nonce cleanup scheduler registered (runs every 6 hours)");
}
