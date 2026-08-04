import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { db } from "@workspace/db";
import { getMerchantDailyPaidTotal, getStartOfDayInTimezone, canChangeMerchantTimezone } from "./payinDailyLimit";

// ─────────────────────────────────────────────────────────────────────────────
// getStartOfDayInTimezone — deterministic unit tests
//
// Each test injects a fixed `now` instant and asserts that the returned Date:
//   1. Has the correct UTC representation (result.toISOString()).
//   2. Formats as "YYYY-MM-DD, 00:00:00" in the target zone (zoneFormat).
//
// The critical DST test (Australia/Sydney spring-forward) catches the bug a
// naive single-offset algorithm has: using the offset at UTC midnight rather
// than at local midnight produces 23:00 on the previous local day instead of
// 00:00 on the correct day.
// ─────────────────────────────────────────────────────────────────────────────

/** Format a Date as "YYYY-MM-DD, HH:mm:ss" in the target IANA timezone. */
function zoneFormat(date: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).format(date);
}

describe("getStartOfDayInTimezone", () => {
  it("returns UTC midnight for the UTC timezone", () => {
    const now = new Date("2024-01-15T14:30:00Z");
    const result = getStartOfDayInTimezone("UTC", now);
    assert.equal(result.toISOString(), "2024-01-15T00:00:00.000Z");
    assert.equal(zoneFormat(result, "UTC"), "2024-01-15, 00:00:00");
  });

  it("falls back to UTC when timezone is null", () => {
    const now = new Date("2024-01-15T14:30:00Z");
    const result = getStartOfDayInTimezone(null, now);
    assert.equal(result.toISOString(), "2024-01-15T00:00:00.000Z");
  });

  it("falls back to UTC for an invalid timezone string", () => {
    const now = new Date("2024-01-15T14:30:00Z");
    const result = getStartOfDayInTimezone("Not/A/Real/Zone", now);
    assert.equal(result.toISOString(), "2024-01-15T00:00:00.000Z");
  });

  it("handles IST (UTC+5:30) — fractional offset, no DST", () => {
    // 2024-01-15 10:00 UTC = 2024-01-15 15:30 IST → local day is Jan 15
    // midnight IST = Jan 15 00:00 IST = Jan 14 18:30 UTC
    const now = new Date("2024-01-15T10:00:00Z");
    const result = getStartOfDayInTimezone("Asia/Kolkata", now);
    assert.equal(result.toISOString(), "2024-01-14T18:30:00.000Z");
    assert.equal(zoneFormat(result, "Asia/Kolkata"), "2024-01-15, 00:00:00");
  });

  it("handles NPT (UTC+5:45) — quarter-hour offset, no DST", () => {
    // 2024-01-15 10:00 UTC = 2024-01-15 15:45 NPT → local day is Jan 15
    // midnight NPT = Jan 15 00:00 NPT = Jan 14 18:15 UTC
    const now = new Date("2024-01-15T10:00:00Z");
    const result = getStartOfDayInTimezone("Asia/Kathmandu", now);
    assert.equal(result.toISOString(), "2024-01-14T18:15:00.000Z");
    assert.equal(zoneFormat(result, "Asia/Kathmandu"), "2024-01-15, 00:00:00");
  });

  it("handles Australia/Sydney on a non-DST winter day (AEST = UTC+10)", () => {
    // 2024-07-01 05:00 UTC = 2024-07-01 15:00 AEST → local day is Jul 1
    // midnight AEST = Jul 1 00:00 AEST = Jun 30 14:00 UTC
    const now = new Date("2024-07-01T05:00:00Z");
    const result = getStartOfDayInTimezone("Australia/Sydney", now);
    assert.equal(result.toISOString(), "2024-06-30T14:00:00.000Z");
    assert.equal(zoneFormat(result, "Australia/Sydney"), "2024-07-01, 00:00:00");
  });

  it("handles Australia/Sydney spring-forward DST day — iterative algorithm required", () => {
    // DST starts Oct 6, 2024 (first Sunday in October).
    // Transition: at 02:00 AEST (Oct 5, 16:00 UTC) clocks spring to 03:00 AEDT.
    //
    // now = Oct 6, 04:00 UTC = Oct 6, 15:00 AEDT — well into DST.
    // Local date in Sydney = Oct 6.
    //
    // The naive single-offset algorithm checks the zone at UTC midnight
    // (Oct 6, 00:00 UTC), which is already AEDT (UTC+11), and subtracts 11h
    // → Oct 5, 13:00 UTC → formats as Oct 5, 23:00 AEST. WRONG.
    //
    // The iterative algorithm must converge to Oct 5, 14:00 UTC, which formats
    // as Oct 6, 00:00 AEST — the correct local midnight before DST changed.
    const now = new Date("2024-10-06T04:00:00Z");
    const result = getStartOfDayInTimezone("Australia/Sydney", now);
    assert.equal(result.toISOString(), "2024-10-05T14:00:00.000Z",
      "spring-forward day: local midnight is in pre-DST period (AEST), not AEDT");
    assert.equal(zoneFormat(result, "Australia/Sydney"), "2024-10-06, 00:00:00",
      "result must format as 00:00:00 on Oct 6 in Sydney — not 23:00 on Oct 5");
  });

  it("handles Australia/Sydney fall-back DST day — midnight is in DST (AEDT)", () => {
    // Fall back: first Sunday in April 2024 = April 7.
    // Transition: at 03:00 AEDT (Apr 6, 16:00 UTC) clocks fall back to 02:00 AEST.
    //
    // now = Apr 7, 05:00 UTC = Apr 7, 15:00 AEST (after the transition).
    // Local date = Apr 7.
    // Local midnight (00:00 on Apr 7) occurred before the transition, so AEDT
    // (UTC+11) was in effect → midnight = Apr 6, 13:00 UTC.
    const now = new Date("2024-04-07T05:00:00Z");
    const result = getStartOfDayInTimezone("Australia/Sydney", now);
    assert.equal(result.toISOString(), "2024-04-06T13:00:00.000Z");
    assert.equal(zoneFormat(result, "Australia/Sydney"), "2024-04-07, 00:00:00");
  });

  it("handles a zone behind UTC (America/New_York, EST = UTC-5)", () => {
    // 2024-01-15 23:00 UTC = 2024-01-15 18:00 EST → local day is Jan 15
    // midnight EST = Jan 15 00:00 EST = Jan 15 05:00 UTC
    const now = new Date("2024-01-15T23:00:00Z");
    const result = getStartOfDayInTimezone("America/New_York", now);
    assert.equal(result.toISOString(), "2024-01-15T05:00:00.000Z");
    assert.equal(zoneFormat(result, "America/New_York"), "2024-01-15, 00:00:00");
  });

  it("handles a zone ahead of UTC (Asia/Tokyo, JST = UTC+9)", () => {
    // 2024-01-16 01:00 UTC = 2024-01-16 10:00 JST → local day is Jan 16
    // midnight JST = Jan 16 00:00 JST = Jan 15 15:00 UTC
    const now = new Date("2024-01-16T01:00:00Z");
    const result = getStartOfDayInTimezone("Asia/Tokyo", now);
    assert.equal(result.toISOString(), "2024-01-15T15:00:00.000Z");
    assert.equal(zoneFormat(result, "Asia/Tokyo"), "2024-01-16, 00:00:00");
  });
});

/**
 * Renders a drizzle SQL/condition object to a plain string for assertions,
 * without triggering the circular-reference crash JSON.stringify hits on
 * PgTable/PgColumn objects embedded in the chunks.
 */
function renderSqlLike(node: any, seen = new Set<any>()): string {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (typeof node !== "object") return String(node);
  if (seen.has(node)) return "";
  seen.add(node);
  if (Array.isArray(node)) return node.map((n) => renderSqlLike(n, seen)).join(" ");
  if (typeof node.name === "string") return node.name;
  if ("value" in node && (typeof node.value === "string" || typeof node.value === "number")) {
    return String(node.value);
  }
  if (Array.isArray(node.queryChunks)) return renderSqlLike(node.queryChunks, seen);
  if (Array.isArray(node.value)) return renderSqlLike(node.value, seen);
  return "";
}

// ─────────────────────────────────────────────────────────────────────────────
// canChangeMerchantTimezone — bypass-prevention tests
//
// The guard returns false (block the change) when the current local window has
// paid deposits, and true (allow) only when the daily total is zero.
//
// ## Why this prevents the bypass
//
// Switching from timezone A (wider window) to timezone B (narrower window)
// would exclude deposits made between the two window-start times, making them
// invisible to the daily limit check.  Because the change is blocked when
// daily total > 0, there are no deposits to exclude regardless of the new
// timezone.  This covers:
//
//  • East-to-west UTC+ switch (e.g. Tokyo UTC+9 → IST UTC+5:30):
//    window start moves from 15:00 UTC to 18:30 UTC, excluding deposits
//    made at, say, 18:00 UTC which are within the Tokyo window.
//
//  • Any positive-to-negative switch (UTC+ → UTC-):
//    window start moves forward by more than a whole day.
//
//  Both cases are blocked identically — the predicate is just "daily total > 0
//  in the current (old) window".
// ─────────────────────────────────────────────────────────────────────────────

describe("canChangeMerchantTimezone", () => {
  const originalSelect2 = db.select.bind(db);

  afterEach(() => {
    (db as any).select = originalSelect2;
  });

  function mockDailyTotal(total: number) {
    (db as any).select = () => ({
      from: () => ({
        where: async () => [{ total: String(total) }],
      }),
    });
  }

  it("returns true (change allowed) when the current window has no deposits", async () => {
    mockDailyTotal(0);
    const result = await canChangeMerchantTimezone(1, "Asia/Tokyo");
    assert.equal(result, true, "timezone change must be allowed when daily total is 0");
  });

  it("returns false (change blocked) when the current window has any deposits", async () => {
    mockDailyTotal(500);
    const result = await canChangeMerchantTimezone(1, "Asia/Tokyo");
    assert.equal(result, false, "timezone change must be blocked when daily total > 0");
  });

  it("blocks east-to-less-east switch (Tokyo → IST) that would exclude prior deposits", async () => {
    // Scenario that would be a bypass without this guard:
    //   - Merchant in Tokyo (UTC+9). Window for Jan 15 starts at Jan 14, 15:00 UTC.
    //   - Deposit at Jan 14, 18:00 UTC (= 03:00 JST Jan 15) — inside the Tokyo window.
    //   - IST window for Jan 15 starts at Jan 14, 18:30 UTC — 30 min AFTER that deposit.
    //   - Switching to IST would push the window start past the deposit (18:00 < 18:30),
    //     making it appear as if no limit was consumed.
    //
    // The guard checks the CURRENT (Tokyo) window total.  Since the deposit exists
    // (mocked total > 0), the guard returns false and the API returns HTTP 409.
    mockDailyTotal(1000); // deposit present in the Tokyo window
    const safe = await canChangeMerchantTimezone(42, "Asia/Tokyo");
    assert.equal(safe, false,
      "east-to-less-east switch (Tokyo → IST) must be blocked when the Tokyo window " +
      "has deposits that would fall outside the IST window");
  });

  it("uses the CURRENT (old) timezone's window, not UTC midnight, for the deposit check", async () => {
    // The guard must compute the daily total against the CURRENT timezone's startOfDay.
    // IST midnight is Jan 14, 18:30 UTC; a deposit at 20:00 UTC Jan 14 (= 01:30 IST Jan 15)
    // falls inside the IST window but NOT inside the UTC window (which starts at 00:00 UTC
    // Jan 15 — after the deposit).  Using UTC would miss this deposit and incorrectly
    // return true, opening the bypass.
    //
    // We verify the cutoff passed to the DB is the IST midnight Date by extracting
    // Date objects from the WHERE clause (same technique as the getMerchantDailyPaidTotal
    // IST-midnight forwarding test).
    const capturedCutoffs: number[] = [];

    (db as any).select = () => ({
      from: () => ({
        where: async (clause: any) => {
          function collectDates(node: any, seen = new Set<any>()): void {
            if (!node || typeof node !== "object" || seen.has(node)) return;
            seen.add(node);
            if (node instanceof Date) { capturedCutoffs.push(node.getTime()); return; }
            if ("value" in node && node.value instanceof Date) { capturedCutoffs.push(node.value.getTime()); return; }
            for (const v of Object.values(node)) collectDates(v, seen);
          }
          collectDates(clause);
          return [{ total: "0" }];
        },
      }),
    });

    const now = new Date("2024-01-15T10:00:00Z"); // 15:30 IST → local day Jan 15
    await canChangeMerchantTimezone(1, "Asia/Kolkata", now);

    // IST midnight = Jan 14, 18:30 UTC; UTC midnight = Jan 15, 00:00 UTC.
    const istMidnight  = new Date("2024-01-14T18:30:00.000Z").getTime();
    const utcMidnight  = new Date("2024-01-15T00:00:00.000Z").getTime();

    assert.ok(
      capturedCutoffs.includes(istMidnight),
      "canChangeMerchantTimezone must use IST midnight (Jan 14, 18:30 UTC) as the window cutoff, " +
      "not UTC midnight — otherwise deposits between 18:30 UTC and 00:00 UTC would escape the check",
    );
    assert.ok(
      !capturedCutoffs.includes(utcMidnight),
      "canChangeMerchantTimezone must NOT use UTC midnight as the cutoff when the current timezone is IST",
    );
  });
});

describe("getMerchantDailyPaidTotal", () => {
  const originalExecute = db.execute?.bind(db);
  const originalSelect = db.select.bind(db);

  afterEach(() => {
    (db as any).select = originalSelect;
    if (originalExecute) (db as any).execute = originalExecute;
  });

  function mockSelectResult(rows: Array<Record<string, unknown>>) {
    (db as any).select = () => ({
      from: () => ({
        where: async () => rows,
      }),
    });
  }

  it("returns 0 (never throws/NaNs) when there are no matching rows", async () => {
    mockSelectResult([]);
    const total = await getMerchantDailyPaidTotal(1, new Date());
    assert.equal(total, 0);
  });

  it("returns 0 when the aggregate row has a null/undefined total", async () => {
    mockSelectResult([{ total: undefined }]);
    const total = await getMerchantDailyPaidTotal(1, new Date());
    assert.equal(total, 0);
  });

  it("parses a numeric aggregate result", async () => {
    mockSelectResult([{ total: "1500.00" }]);
    const total = await getMerchantDailyPaidTotal(1, new Date());
    assert.equal(total, 1500);
  });

  it("builds a query filtered on the uppercase PAID status constant", async () => {
    let capturedWhere: any = null;
    (db as any).select = () => ({
      from: () => ({
        where: async (whereClause: any) => {
          capturedWhere = whereClause;
          return [{ total: "0" }];
        },
      }),
    });

    await getMerchantDailyPaidTotal(1, new Date());

    const rendered = renderSqlLike(capturedWhere);
    assert.match(rendered, /PAID/);
  });

  it("uses a paid_at-or-created_at cutoff (COALESCE) rather than paid_at alone", async () => {
    let capturedWhere: any = null;
    (db as any).select = () => ({
      from: () => ({
        where: async (whereClause: any) => {
          capturedWhere = whereClause;
          return [{ total: "0" }];
        },
      }),
    });

    await getMerchantDailyPaidTotal(1, new Date());

    const rendered = renderSqlLike(capturedWhere);
    assert.match(rendered, /COALESCE/i);
  });

  // ── providerKey filter tests ──────────────────────────────────────────────

  it("includes a providerKey column filter in the WHERE clause when providerKey is supplied", async () => {
    let capturedWhere: any = null;
    (db as any).select = () => ({
      from: () => ({
        where: async (whereClause: any) => {
          capturedWhere = whereClause;
          return [{ total: "0" }];
        },
      }),
    });

    await getMerchantDailyPaidTotal(1, new Date(), "upigateway");

    const rendered = renderSqlLike(capturedWhere);
    assert.match(
      rendered,
      /upigateway/,
      "WHERE clause must reference the providerKey value when providerKey is supplied",
    );
  });

  it("does NOT include a providerKey filter in the WHERE clause when providerKey is omitted", async () => {
    let capturedWhere: any = null;
    (db as any).select = () => ({
      from: () => ({
        where: async (whereClause: any) => {
          capturedWhere = whereClause;
          return [{ total: "0" }];
        },
      }),
    });

    await getMerchantDailyPaidTotal(1, new Date());

    const rendered = renderSqlLike(capturedWhere);
    assert.ok(
      !rendered.includes("upigateway") && !rendered.includes("cashfree"),
      `WHERE clause must not include any providerKey value when providerKey is omitted. Got: ${rendered}`,
    );
  });

  it("counts only rows matching the given providerKey — non-matching provider rows are excluded", async () => {
    let capturedWhere: any = null;
    let callCount = 0;

    (db as any).select = () => ({
      from: () => ({
        where: async (whereClause: any) => {
          callCount++;
          capturedWhere = whereClause;
          return [{ total: "800.00" }];
        },
      }),
    });

    const total = await getMerchantDailyPaidTotal(42, new Date(), "upigateway");

    assert.equal(total, 800, "should return the aggregate total from the filtered query");
    assert.equal(callCount, 1, "should execute exactly one query");

    const rendered = renderSqlLike(capturedWhere);
    assert.match(
      rendered,
      /upigateway/,
      "the executed query must include the providerKey filter",
    );
  });

  it("uses a different WHERE predicate for different providerKey values", async () => {
    const capturedWheres: string[] = [];

    (db as any).select = () => ({
      from: () => ({
        where: async (whereClause: any) => {
          capturedWheres.push(renderSqlLike(whereClause));
          return [{ total: "0" }];
        },
      }),
    });

    await getMerchantDailyPaidTotal(1, new Date(), "upigateway");
    await getMerchantDailyPaidTotal(1, new Date(), "cashfree_payin");
    await getMerchantDailyPaidTotal(1, new Date());

    assert.equal(capturedWheres.length, 3);

    assert.ok(
      capturedWheres[0]!.includes("upigateway"),
      "first call (upigateway) must include upigateway in WHERE",
    );
    assert.ok(
      capturedWheres[1]!.includes("cashfree_payin"),
      "second call (cashfree_payin) must include cashfree_payin in WHERE",
    );
    assert.ok(
      !capturedWheres[2]!.includes("upigateway") && !capturedWheres[2]!.includes("cashfree_payin"),
      "third call (no providerKey) must NOT include any providerKey value in WHERE",
    );
  });

  // ── Midnight boundary (UTC vs IST) tests ─────────────────────────────────
  //
  // The server computes startOfDay with setHours(0,0,0,0) which applies the
  // server's local timezone — not the merchant's local clock.  If the server
  // runs UTC and a merchant is in IST (UTC+5:30), "midnight IST" is 18:30 UTC
  // the previous calendar day.  getMerchantDailyPaidTotal accepts an explicit
  // startOfDay parameter so callers can pass the correct boundary; the tests
  // below verify that the Date value is faithfully forwarded to the GTE filter
  // rather than being recalculated inside the helper.

  it("forwards the exact startOfDay Date to the GTE filter (UTC midnight)", async () => {
    // Construct a UTC midnight boundary explicitly.
    const utcMidnight = new Date("2024-06-15T00:00:00.000Z");
    const capturedCutoffs: number[] = [];

    (db as any).select = () => ({
      from: () => ({
        where: async (whereClause: any) => {
          // Collect all Date instances embedded in the clause tree.
          function collectDates(node: any, seen = new Set<any>()): void {
            if (!node || typeof node !== "object" || seen.has(node)) return;
            seen.add(node);
            if (node instanceof Date) { capturedCutoffs.push(node.getTime()); return; }
            if ("value" in node && node.value instanceof Date) { capturedCutoffs.push(node.value.getTime()); return; }
            for (const v of Object.values(node)) collectDates(v, seen);
          }
          collectDates(whereClause);
          return [{ total: "500.00" }];
        },
      }),
    });

    const total = await getMerchantDailyPaidTotal(7, utcMidnight);

    assert.equal(total, 500, "should return the mocked total");
    assert.ok(
      capturedCutoffs.includes(utcMidnight.getTime()),
      `WHERE clause must embed the exact UTC midnight Date. Captured timestamps: ${capturedCutoffs}`,
    );
  });

  it("forwards the exact startOfDay Date to the GTE filter (IST midnight ≠ UTC midnight)", async () => {
    // IST midnight (UTC+5:30) on 2024-06-15 is 2024-06-14T18:30:00.000Z —
    // a full 5h30m earlier than UTC midnight on the same calendar date.
    const istMidnightAsUtc = new Date("2024-06-14T18:30:00.000Z");
    const utcMidnight = new Date("2024-06-15T00:00:00.000Z");

    // Sanity: the two boundaries are genuinely different.
    assert.notEqual(
      istMidnightAsUtc.getTime(),
      utcMidnight.getTime(),
      "IST midnight expressed in UTC must differ from UTC midnight",
    );

    const capturedCutoffs: number[] = [];

    (db as any).select = () => ({
      from: () => ({
        where: async (whereClause: any) => {
          // Extract all Date values embedded in the clause tree.
          function collectDates(node: any, seen = new Set<any>()): void {
            if (!node || typeof node !== "object" || seen.has(node)) return;
            seen.add(node);
            if (node instanceof Date) { capturedCutoffs.push(node.getTime()); return; }
            if ("value" in node && node.value instanceof Date) { capturedCutoffs.push(node.value.getTime()); return; }
            for (const v of Object.values(node)) collectDates(v, seen);
          }
          collectDates(whereClause);
          return [{ total: "0" }];
        },
      }),
    });

    await getMerchantDailyPaidTotal(7, istMidnightAsUtc);
    await getMerchantDailyPaidTotal(7, utcMidnight);

    // At least one of the two queries must have captured the IST boundary.
    assert.ok(
      capturedCutoffs.includes(istMidnightAsUtc.getTime()),
      "The IST-midnight startOfDay must appear verbatim in the generated WHERE clause",
    );
    // And the two captured cutoffs must differ, proving the helper doesn't
    // re-derive a fixed UTC midnight internally.
    assert.ok(
      capturedCutoffs.includes(utcMidnight.getTime()),
      "The UTC-midnight startOfDay must also appear verbatim in the generated WHERE clause",
    );
    const uniqueTimes = new Set(capturedCutoffs);
    assert.ok(
      uniqueTimes.size >= 2,
      "Passing different startOfDay values must produce different GTE cutoffs — the helper must not recalculate midnight internally",
    );
  });

  // ── Single-query / no application-layer re-summation tests ───────────────
  //
  // The helper delegates all aggregation to a single SQL SUM query.  The
  // application layer must not fan out multiple queries or re-add the
  // returned value — either pattern could produce an inflated total.  These
  // tests verify that contract at the mock boundary:
  //   1. Exactly one DB query is issued per call.
  //   2. The value returned by row[0].total is returned verbatim (cast to
  //      Number) with no additional JS-side arithmetic.
  //
  // Note: these tests mock the DB layer, so they verify the helper's own
  // contract, not the SQL aggregation itself.  An integration test with real
  // rows is the appropriate place to confirm the SUM de-duplicates correctly.

  it("issues exactly one DB query per call — no client-side fan-out", async () => {
    let queryCount = 0;

    (db as any).select = () => ({
      from: () => ({
        where: async () => {
          queryCount++;
          return [{ total: "1200.00" }];
        },
      }),
    });

    const result = await getMerchantDailyPaidTotal(99, new Date());

    assert.equal(queryCount, 1, "helper must issue exactly one DB query per invocation");
    assert.equal(result, 1200, "result must equal the aggregate from row[0].total");
  });

  it("returns the DB aggregate value as-is without re-adding in JS", async () => {
    // The helper must cast row[0].total to Number and return it directly.
    // No additional summation should occur in JavaScript.
    (db as any).select = () => ({
      from: () => ({
        where: async () => [{ total: "3000.00" }],
      }),
    });

    const result = await getMerchantDailyPaidTotal(5, new Date());
    assert.equal(
      result,
      3000,
      "returned value must equal the aggregate from row[0].total with no JS re-addition",
    );
  });

  it("returns 0 (not NaN or a double) when the DB aggregate is the string '0'", async () => {
    (db as any).select = () => ({
      from: () => ({
        where: async () => [{ total: "0" }],
      }),
    });

    const result = await getMerchantDailyPaidTotal(3, new Date());
    assert.equal(result, 0);
    assert.ok(Number.isFinite(result), "result must be a finite number, never NaN or ±Infinity");
  });
});
