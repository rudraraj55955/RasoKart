import type { Store, Options, ClientRateLimitInfo } from "express-rate-limit";
import { db, rateLimitHitsTable } from "@workspace/db";
import { sql, lt } from "drizzle-orm";
import { logger } from "./logger";

/**
 * Postgres-backed Store for express-rate-limit.
 *
 * Each window counter is stored in the `rate_limit_hits` table.
 * Rows are never deleted on decrement/reset — they are pruned in bulk
 * by the hourly `rateLimitCleanupScheduler`.
 */
export class DbRateLimitStore implements Store {
  private windowMs: number = 15 * 60 * 1000;

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    const windowMs = this.windowMs;

    const rows = await db.execute<{ hits: number; expires_at: Date }>(sql`
      INSERT INTO rate_limit_hits (key, hits, expires_at)
      VALUES (
        ${key},
        1,
        NOW() + (${windowMs} || ' milliseconds')::interval
      )
      ON CONFLICT (key) DO UPDATE
        SET
          hits = CASE
            WHEN rate_limit_hits.expires_at < NOW()
              THEN 1
            ELSE rate_limit_hits.hits + 1
          END,
          expires_at = CASE
            WHEN rate_limit_hits.expires_at < NOW()
              THEN NOW() + (${windowMs} || ' milliseconds')::interval
            ELSE rate_limit_hits.expires_at
          END
      RETURNING hits, expires_at
    `);

    const row = (rows as any).rows?.[0] ?? (rows as any)[0];
    const totalHits: number = Number(row.hits);
    const resetTime: Date = row.expires_at instanceof Date
      ? row.expires_at
      : new Date(row.expires_at);

    return { totalHits, resetTime };
  }

  async decrement(key: string): Promise<void> {
    await db.execute(sql`
      UPDATE rate_limit_hits
      SET hits = GREATEST(hits - 1, 0)
      WHERE key = ${key}
        AND expires_at >= NOW()
    `);
  }

  async resetKey(key: string): Promise<void> {
    await db.execute(sql`
      DELETE FROM rate_limit_hits
      WHERE key = ${key}
    `);
  }

  async resetAll(): Promise<void> {
    await db.execute(sql`TRUNCATE rate_limit_hits`);
  }

  /**
   * Delete all rows whose window has already expired.
   * Called by the hourly rateLimitCleanupScheduler.
   * Returns the number of rows deleted.
   */
  async cleanup(): Promise<number> {
    const result = await db
      .delete(rateLimitHitsTable)
      .where(lt(rateLimitHitsTable.expiresAt, new Date()));

    const deleted = Number((result as any).rowCount ?? 0);
    if (deleted > 0) {
      logger.info({ deleted }, "Rate-limit cleanup: removed expired counters");
    }
    return deleted;
  }
}

export const dbRateLimitStore = new DbRateLimitStore();
