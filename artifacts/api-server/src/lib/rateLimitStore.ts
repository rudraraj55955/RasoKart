import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

type ClientRateLimitInfo = { totalHits: number; resetTime: Date | undefined };

/**
 * A persistent rate-limit store backed by PostgreSQL.
 *
 * Counter rows live in the `rate_limit_hits` table. Each row is keyed by the
 * composite string `<limiterId>:<clientKey>` (e.g. `"login:127.0.0.1"` or
 * `"qr-create:5"`), ensuring that different limiters with the same client key
 * never share counters or reset windows even when their windowMs differs.
 *
 * On increment the store uses an UPSERT that:
 *   - resets the counter when the window has already expired, and
 *   - increments it atomically otherwise.
 *
 * This means counters survive server restarts and work correctly when multiple
 * server instances run in parallel, at the cost of one DB round-trip per
 * rate-limited request.
 */
export class PostgresRateLimitStore {
  private readonly windowMs: number;
  private readonly limiterId: string;

  constructor(limiterId: string, windowMs: number) {
    this.limiterId = limiterId;
    this.windowMs = windowMs;
  }

  private namespaced(clientKey: string): string {
    return `${this.limiterId}:${clientKey}`;
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    const nsKey = this.namespaced(key);
    const rows = await db.execute<{ hits: number; expires_at: Date }>(sql`
      INSERT INTO rate_limit_hits (key, hits, expires_at)
      VALUES (${nsKey}, 1, NOW() + ${this.windowMs} * INTERVAL '1 millisecond')
      ON CONFLICT (key) DO UPDATE
        SET hits = CASE
              WHEN rate_limit_hits.expires_at <= NOW() THEN 1
              ELSE rate_limit_hits.hits + 1
            END,
            expires_at = CASE
              WHEN rate_limit_hits.expires_at <= NOW()
                THEN NOW() + ${this.windowMs} * INTERVAL '1 millisecond'
              ELSE rate_limit_hits.expires_at
            END
      RETURNING hits, expires_at
    `);

    const row = rows.rows[0];
    return {
      totalHits: Number(row!.hits),
      resetTime: row!.expires_at instanceof Date ? row!.expires_at : new Date(row!.expires_at),
    };
  }

  async decrement(key: string): Promise<void> {
    const nsKey = this.namespaced(key);
    await db.execute(sql`
      UPDATE rate_limit_hits
      SET hits = GREATEST(hits - 1, 0)
      WHERE key = ${nsKey} AND expires_at > NOW()
    `);
  }

  async resetKey(key: string): Promise<void> {
    const nsKey = this.namespaced(key);
    await db.execute(sql`
      DELETE FROM rate_limit_hits WHERE key = ${nsKey}
    `);
  }

  async resetAll(): Promise<void> {
    await db.execute(sql`
      DELETE FROM rate_limit_hits WHERE key LIKE ${this.limiterId + ":%"}
    `);
  }
}
