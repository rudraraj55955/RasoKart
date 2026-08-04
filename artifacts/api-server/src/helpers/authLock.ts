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
 * Default rate-limit window: 1 hour — matches the OTP limiter windows.
 * Pass the actual window size from each call site for precision.
 */
const DEFAULT_WINDOW_MS = 60 * 60 * 1000;

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
 * **Key invariants:**
 * 1. At most ONE exhaustion event is recorded per `windowMs` window per
 *    identifier.  Repeated 429s within the same window are silently ignored so
 *    the count reflects _windows_ exhausted, not individual rejected requests.
 * 2. If a full window passes without any exhaustion the counter resets to 1,
 *    ensuring only truly consecutive windows accumulate toward a lock.
 * 3. Once WINDOWS_BEFORE_FIRST_LOCK consecutive windows are exhausted a
 *    progressive soft-lock is applied; it escalates with each additional
 *    exhaustion and expires automatically.
 *
 * The entire operation is expressed as a single INSERT … ON CONFLICT using a
 * CTE so the window-boundary check, count computation, and locked_until
 * derivation are atomic.
 *
 * @param identifierHash  HMAC hash of the identifier (email/phone/IP).
 * @param windowMs        Size of one rate-limit window in ms (default 1 hour).
 *                        Must match the window of the rate-limiter that calls
 *                        this function.
 */
export async function recordWindowExhaustion(
  identifierHash: string,
  windowMs: number = DEFAULT_WINDOW_MS,
): Promise<void> {
  const windowSeconds = windowMs / 1000;

  try {
    // ── SQL design ──────────────────────────────────────────────────────────
    //
    // cur_window_start  = floor(epoch_now / windowSeconds) * windowSeconds
    // prev_window_start = cur_window_start - windowSeconds
    //
    // Given the current row's last_exhaustion_at (= "last"):
    //   last >= cur_window_start  → same window → nc.val = NULL → skip INSERT
    //   last >= prev_window_start → consecutive  → nc.val = count + 1
    //   otherwise (gap > 1 window or NULL/no row) → nc.val = 1 (reset)
    //
    // The WHERE nc.val IS NOT NULL on the INSERT ensures the same-window
    // no-op: no rows are emitted from the CTE, so neither an INSERT nor
    // an ON CONFLICT update happens.
    //
    // For the ON CONFLICT case (row exists, new window):
    //   - window_exhaustion_count ← nc.val
    //   - locked_until ← new progressive lock IF nc.val >= threshold,
    //                   else preserve existing locked_until (it may still
    //                   be active from a prior lock)
    //   - last_exhaustion_at ← NOW()
    // ────────────────────────────────────────────────────────────────────────
    await db.execute(sql`
      WITH
        win AS (
          SELECT
            to_timestamp(floor(extract(epoch FROM NOW()) / ${windowSeconds}) * ${windowSeconds}) AS cur,
            to_timestamp((floor(extract(epoch FROM NOW()) / ${windowSeconds}) - 1) * ${windowSeconds}) AS prev
        ),
        cur_state AS (
          SELECT window_exhaustion_count AS cnt, last_exhaustion_at AS last_at
          FROM merchant_auth_locks
          WHERE identifier_hash = ${identifierHash}
        ),
        nc AS (
          SELECT
            CASE
              WHEN (SELECT last_at FROM cur_state) >= (SELECT cur FROM win)
              THEN NULL  -- same window: sentinel → WHERE below skips the INSERT
              WHEN (SELECT last_at FROM cur_state) >= (SELECT prev FROM win)
              THEN COALESCE((SELECT cnt FROM cur_state), 0) + 1  -- consecutive window
              ELSE 1                                              -- gap or new identifier
            END AS val
        )
      INSERT INTO merchant_auth_locks
        (identifier_hash, window_exhaustion_count, locked_until, last_exhaustion_at, updated_at)
      SELECT
        ${identifierHash},
        nc.val,
        CASE
          WHEN nc.val >= ${WINDOWS_BEFORE_FIRST_LOCK}
          THEN NOW() + (
            CASE
              WHEN nc.val - ${WINDOWS_BEFORE_FIRST_LOCK} = 0 THEN ${LOCK_DURATIONS_MS[0]}
              WHEN nc.val - ${WINDOWS_BEFORE_FIRST_LOCK} = 1 THEN ${LOCK_DURATIONS_MS[1]}
              ELSE ${LOCK_DURATIONS_MS[2]}
            END || ' milliseconds'
          )::interval
          ELSE NULL
        END,
        NOW(),
        NOW()
      FROM nc
      WHERE nc.val IS NOT NULL
      ON CONFLICT (identifier_hash) DO UPDATE
        SET
          window_exhaustion_count = EXCLUDED.window_exhaustion_count,
          locked_until = CASE
            WHEN EXCLUDED.locked_until IS NOT NULL
            THEN EXCLUDED.locked_until                  -- new lock imposed: use it
            ELSE merchant_auth_locks.locked_until       -- below threshold: preserve any active lock
          END,
          last_exhaustion_at = EXCLUDED.last_exhaustion_at,
          updated_at         = EXCLUDED.updated_at
    `);
    logger.info({ identifierHash }, "auth_lock_window_exhaustion_recorded");
  } catch (err) {
    logger.warn({ err, identifierHash }, "auth_lock_record_failed");
  }
}
