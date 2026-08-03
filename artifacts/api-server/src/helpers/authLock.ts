import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";

/**
 * Progressive lock durations applied after WINDOWS_BEFORE_FIRST_LOCK
 * consecutive per-hour windows have been fully exhausted for the same identifier.
 *
 * Tier 0 (count === THRESHOLD):      15 min
 * Tier 1 (count === THRESHOLD + 1):  30 min
 * Tier 2+ (count >= THRESHOLD + 2):  60 min
 */
const LOCK_DURATIONS_MS = [
  15 * 60 * 1000,
  30 * 60 * 1000,
  60 * 60 * 1000,
];

/** Number of fully-exhausted per-hour windows before the first soft-lock is imposed. */
export const WINDOWS_BEFORE_FIRST_LOCK = 3;

/**
 * Returns whether the identifier currently has an active soft-lock.
 * Fails open (returns `{ locked: false }`) if the table is unavailable so a
 * DB blip never permanently blocks legitimate users.
 */
export async function checkAuthLock(identifierHash: string): Promise<{ locked: boolean; lockedUntil?: Date }> {
  try {
    const rows = await db.execute<{ locked_until: Date | string | null }>(sql`
      SELECT locked_until
      FROM merchant_auth_locks
      WHERE identifier_hash = ${identifierHash}
      LIMIT 1
    `);
    const row = (rows as any).rows?.[0] ?? (rows as any)[0];
    if (!row) return { locked: false };
    const lockedUntil: Date | null = row.locked_until
      ? (row.locked_until instanceof Date ? row.locked_until : new Date(row.locked_until as string))
      : null;
    if (lockedUntil && lockedUntil > new Date()) {
      return { locked: true, lockedUntil };
    }
    return { locked: false };
  } catch (err) {
    logger.warn({ err, identifierHash }, "auth_lock_check_failed");
    return { locked: false };
  }
}

/**
 * Called when the per-identifier rate-limit window has been fully exhausted
 * (i.e., the rate-limiter middleware fires its 429 handler for this identifier).
 *
 * Atomically increments `window_exhaustion_count` and, once
 * WINDOWS_BEFORE_FIRST_LOCK consecutive windows have been hit, sets a
 * progressive `locked_until` timestamp that escalates with each additional hit.
 *
 * The lock expires automatically — no manual admin action required.
 */
export async function recordWindowExhaustion(identifierHash: string): Promise<void> {
  try {
    // Single atomic upsert: increment counter and compute locked_until in SQL
    // so there is no race between a read and a subsequent write.
    await db.execute(sql`
      INSERT INTO merchant_auth_locks (identifier_hash, window_exhaustion_count, locked_until, updated_at)
      VALUES (${identifierHash}, 1, NULL, NOW())
      ON CONFLICT (identifier_hash) DO UPDATE
        SET
          window_exhaustion_count = merchant_auth_locks.window_exhaustion_count + 1,
          locked_until = CASE
            WHEN merchant_auth_locks.window_exhaustion_count + 1 >= ${WINDOWS_BEFORE_FIRST_LOCK}
            THEN NOW() + (
              CASE
                WHEN merchant_auth_locks.window_exhaustion_count + 1 - ${WINDOWS_BEFORE_FIRST_LOCK} = 0
                  THEN ${LOCK_DURATIONS_MS[0]}
                WHEN merchant_auth_locks.window_exhaustion_count + 1 - ${WINDOWS_BEFORE_FIRST_LOCK} = 1
                  THEN ${LOCK_DURATIONS_MS[1]}
                ELSE ${LOCK_DURATIONS_MS[2]}
              END || ' milliseconds'
            )::interval
            ELSE merchant_auth_locks.locked_until
          END,
          updated_at = NOW()
    `);
    logger.info({ identifierHash }, "auth_lock_window_exhaustion_recorded");
  } catch (err) {
    logger.warn({ err, identifierHash }, "auth_lock_record_failed");
  }
}
