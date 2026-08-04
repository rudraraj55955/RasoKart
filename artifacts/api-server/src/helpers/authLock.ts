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
 * Fixed namespace integer used as the first argument to pg_advisory_xact_lock so
 * auth-lock locks cannot collide with advisory locks taken elsewhere in the codebase.
 */
const ADVISORY_LOCK_NAMESPACE = 0x41555448; // hex for "AUTH"

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
 * **Concurrency safety:**
 * The function acquires `pg_advisory_xact_lock(NAMESPACE, hashtext(identifier))`
 * inside a transaction before reading any row state.  Advisory locks are
 * namespaced to this module and are automatically released at transaction end.
 * Unlike `SELECT … FOR UPDATE`, advisory locks serialize concurrent callers even
 * when no row exists yet (first exhaustion for a previously unseen identifier),
 * eliminating the new-row insert race entirely.
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
  try {
    await db.transaction(async (tx) => {
      // ── 1. Serialize all concurrent callers for this identifier ─────────────
      // pg_advisory_xact_lock blocks until the advisory lock is free, then
      // holds it for the lifetime of the transaction.  hashtext() maps the
      // identifier string to a 32-bit integer; combined with the fixed
      // ADVISORY_LOCK_NAMESPACE it produces a globally unique (class, id) pair
      // that cannot collide with other advisory locks in the codebase.
      // This works for new rows as well as existing ones — no row is needed.
      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_NAMESPACE}, hashtext(${identifierHash}))
      `);

      // ── 2. Read current state (no race — advisory lock is held) ────────────
      const stateRows = await tx.execute<{
        window_exhaustion_count: number;
        last_exhaustion_at: string | null;
        locked_until: string | null;
      }>(sql`
        SELECT window_exhaustion_count, last_exhaustion_at, locked_until
        FROM merchant_auth_locks
        WHERE identifier_hash = ${identifierHash}
      `);
      const existing = (stateRows as any).rows?.[0] ?? (stateRows as any)[0] ?? null;

      // ── 3. Compute new window exhaustion count ──────────────────────────────
      const now = Date.now();
      const curWindowStart = Math.floor(now / windowMs) * windowMs;
      const prevWindowStart = curWindowStart - windowMs;

      let newCount: number;

      if (!existing) {
        // New identifier — first exhausted window.
        newCount = 1;
      } else {
        const lastAt = existing.last_exhaustion_at
          ? new Date(existing.last_exhaustion_at).getTime()
          : null;

        if (lastAt !== null && lastAt >= curWindowStart) {
          // Same window: already recorded this exhaustion — no-op.
          return;
        } else if (lastAt !== null && lastAt >= prevWindowStart) {
          // Consecutive window: increment from the current persisted count.
          newCount = (existing.window_exhaustion_count ?? 0) + 1;
        } else {
          // Gap of more than one window, or null: reset streak to 1.
          newCount = 1;
        }
      }

      // ── 4. Compute locked_until ─────────────────────────────────────────────
      const nowDate = new Date(now);
      let newLockedUntil: Date | null = null;

      if (newCount >= WINDOWS_BEFORE_FIRST_LOCK) {
        const tier = Math.min(
          newCount - WINDOWS_BEFORE_FIRST_LOCK,
          LOCK_DURATIONS_MS.length - 1,
        );
        newLockedUntil = new Date(now + LOCK_DURATIONS_MS[tier]);
      } else if (existing?.locked_until) {
        // Preserve any still-active lock from a prior escalation tier.
        const existingLock = new Date(existing.locked_until);
        if (existingLock > nowDate) {
          newLockedUntil = existingLock;
        }
      }

      // ── 5. Persist ──────────────────────────────────────────────────────────
      await tx.execute(sql`
        INSERT INTO merchant_auth_locks
          (identifier_hash, window_exhaustion_count, locked_until, last_exhaustion_at, updated_at)
        VALUES (
          ${identifierHash},
          ${newCount},
          ${newLockedUntil},
          ${nowDate},
          ${nowDate}
        )
        ON CONFLICT (identifier_hash) DO UPDATE SET
          window_exhaustion_count = ${newCount},
          locked_until            = ${newLockedUntil},
          last_exhaustion_at      = ${nowDate},
          updated_at              = ${nowDate}
      `);
    });

    logger.info({ identifierHash }, "auth_lock_window_exhaustion_recorded");
  } catch (err) {
    logger.warn({ err, identifierHash }, "auth_lock_record_failed");
  }
}
