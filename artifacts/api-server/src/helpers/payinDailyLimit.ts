import { db, cashfreePaymentOrdersTable, PAYIN_ORDER_STATUS } from "@workspace/db";
import { eq, and, gte, sql } from "drizzle-orm";

/**
 * Returns a Date representing the start of the current calendar day in the
 * given IANA timezone (e.g. "Asia/Kolkata").  Falls back to UTC midnight when
 * the timezone string is null/undefined or not a valid IANA name.
 *
 * @param timezone - IANA timezone string or null/undefined (UTC fallback).
 * @param now      - Reference instant for "today"; defaults to new Date().
 *                   Inject a fixed Date in tests to get deterministic results.
 *
 * ## Algorithm
 *
 * A naive approach (compute offset once at UTC midnight, apply it) breaks on
 * DST transition days where the zone's offset differs between UTC midnight and
 * local midnight.  For example, Australia/Sydney on its spring-forward day:
 * UTC midnight is already in AEDT (UTC+11) but local midnight is still AEST
 * (UTC+10), so the naive offset produces 23:00 local rather than 00:00.
 *
 * The correct algorithm is iterative:
 *
 *  1. Determine today's date (Y, M, D) in the target zone from `now`.
 *  2. Start from a naive UTC estimate: Date.UTC(Y, M-1, D).
 *  3. Compute the zone's wall clock at the candidate UTC instant.
 *  4. Subtract the error between the zone clock and target midnight (00:00:00).
 *  5. Repeat until convergence (2-3 iterations in all real-world cases).
 *  6. Handle DST spring-forward gaps where local midnight doesn't exist:
 *     advance second-by-second to the first valid instant of the target date.
 */
export function getStartOfDayInTimezone(
  timezone: string | null | undefined,
  now: Date = new Date(),
): Date {
  const tz = timezone ?? "UTC";

  // Validate — Intl.DateTimeFormat throws RangeError for unknown zone names.
  let resolvedTz: string;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    resolvedTz = tz;
  } catch {
    resolvedTz = "UTC";
  }

  // Helper: decompose a UTC instant into wall-clock parts in the target zone.
  const zoneClock = (utcMs: number) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: resolvedTz,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false,
    }).formatToParts(new Date(utcMs));
    return {
      year:   Number(parts.find(p => p.type === "year")?.value   ?? 0),
      month:  Number(parts.find(p => p.type === "month")?.value  ?? 1),
      day:    Number(parts.find(p => p.type === "day")?.value    ?? 1),
      hour:   Number(parts.find(p => p.type === "hour")?.value   ?? 0),
      minute: Number(parts.find(p => p.type === "minute")?.value ?? 0),
      second: Number(parts.find(p => p.type === "second")?.value ?? 0),
    };
  };

  // Step 1 — today's date in the target zone.
  const today = zoneClock(now.getTime());

  // Step 2 — naive UTC estimate: treat local date as a UTC date.
  let utcMs = Date.UTC(today.year, today.month - 1, today.day);

  // Steps 3-5 — iterative refinement.
  for (let i = 0; i < 3; i++) {
    const clock    = zoneClock(utcMs);
    // Represent the zone's clock value and the target midnight as UTC ms
    // (purely for arithmetic — not as true UTC instants).
    const clockMs  = Date.UTC(clock.year, clock.month - 1, clock.day,
                              clock.hour, clock.minute, clock.second);
    const targetMs = Date.UTC(today.year, today.month - 1, today.day, 0, 0, 0);
    const errorMs  = clockMs - targetMs;
    if (errorMs === 0) break; // already converged
    utcMs -= errorMs;
  }

  // Step 6 — DST spring-forward gap: if local midnight doesn't exist the loop
  // converges on the last instant of the previous day.  Advance
  // second-by-second (max 3600 steps = 1h gap) to the first valid instant of
  // the target calendar day.
  const verify = zoneClock(utcMs);
  if (verify.year !== today.year || verify.month !== today.month || verify.day !== today.day) {
    const safetyLimitMs = utcMs + 3_600_000; // 1 hour forward at most
    while (utcMs <= safetyLimitMs) {
      utcMs += 1_000;
      const c = zoneClock(utcMs);
      if (c.year === today.year && c.month === today.month && c.day === today.day) break;
    }
  }

  return new Date(utcMs);
}

/**
 * Returns whether a merchant's timezone preference can be changed safely.
 *
 * ## The bypass attack this guards against
 *
 * Daily-limit enforcement uses the merchant's CURRENT stored timezone to
 * compute `startOfDay`.  If that timezone can be mutated arbitrarily, a
 * merchant can:
 *   1. Consume their daily limit under timezone A (window starts at T₀ UTC).
 *   2. Switch to timezone B whose window starts at T₁ > T₀ UTC.
 *   3. All deposits made between T₀ and T₁ are now before the new window →
 *      they are excluded from the daily count → the limit appears reset.
 *
 * ## The fix
 *
 * A timezone change is safe **only when the current local window contains no
 * paid deposits** — if the daily total is 0 there is nothing to exclude,
 * regardless of how far the new window start moves.  The PATCH /merchants/me
 * route calls this guard and returns HTTP 409 when it returns false.
 *
 * The check uses the CURRENT (old) timezone so that the window being
 * protected is the one that is actually in force; using UTC or the new
 * timezone would leave the gap open.
 *
 * @param merchantId     - Merchant whose daily total is checked.
 * @param currentTimezone - The merchant's timezone BEFORE the proposed change.
 * @param now             - Reference instant; defaults to new Date(). Inject in tests.
 */
export async function canChangeMerchantTimezone(
  merchantId: number,
  currentTimezone: string | null | undefined,
  now: Date = new Date(),
): Promise<boolean> {
  const windowStart = getStartOfDayInTimezone(currentTimezone, now);
  const dailyTotal  = await getMerchantDailyPaidTotal(merchantId, windowStart);
  return dailyTotal === 0;
}

/**
 * Sum of a merchant's PAID payin deposits for "today" (local server day).
 *
 * Extracted as its own function so this exact production incident — the
 * daily-limit check crashing or mis-comparing status — can be unit tested
 * in isolation:
 *  - status comparison always uses the uppercase `PAYIN_ORDER_STATUS.PAID`
 *    constant, never a raw/lowercase literal
 *  - the "today" cutoff uses COALESCE(paid_at, created_at) so rows created
 *    before `paid_at` existed/was populated are still counted
 *  - COALESCE(SUM(...), 0) plus a numeric fallback below guarantees this
 *    NEVER throws or returns NaN when a merchant has zero matching rows
 *
 * @param providerKey - When provided, only counts orders dispatched via that
 *   specific provider (e.g. "upigateway" for EKQR daily-limit checks).
 *   When omitted, counts across all providers (used for the global payin limit).
 */
export async function getMerchantDailyPaidTotal(
  merchantId: number,
  startOfDay: Date,
  providerKey?: string,
): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`COALESCE(SUM(${cashfreePaymentOrdersTable.amount}), 0)` })
    .from(cashfreePaymentOrdersTable)
    .where(and(
      eq(cashfreePaymentOrdersTable.merchantId, merchantId),
      eq(cashfreePaymentOrdersTable.status, PAYIN_ORDER_STATUS.PAID),
      gte(sql`COALESCE(${cashfreePaymentOrdersTable.paidAt}, ${cashfreePaymentOrdersTable.createdAt})`, startOfDay),
      ...(providerKey ? [eq(cashfreePaymentOrdersTable.providerKey, providerKey)] : []),
    ));
  const total = Number(row?.total ?? 0);
  return Number.isFinite(total) ? total : 0;
}
