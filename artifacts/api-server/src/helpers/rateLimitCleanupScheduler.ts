import cron from "node-cron";
import { dbRateLimitStore } from "../lib/rateLimitStore";
import { logger } from "../lib/logger";

/**
 * Hourly job that deletes expired rows from `rate_limit_hits`.
 *
 * The increment UPSERT resets counters opportunistically when a key is hit
 * again, but rows whose window expired without further hits are never cleaned
 * up in-line.  Running this every hour is sufficient — the longest window is
 * 60 min, so any surviving expired row will be gone within two hours of its
 * window closing.
 */
export function initRateLimitCleanupScheduler(): void {
  cron.schedule("0 * * * *", async () => {
    try {
      await dbRateLimitStore.cleanup();
    } catch (err) {
      logger.error({ err }, "Rate-limit cleanup scheduler failed");
    }
  });

  logger.info("Rate-limit cleanup scheduler registered (runs every hour)");
}
