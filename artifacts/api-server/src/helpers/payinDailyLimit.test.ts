import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { db } from "@workspace/db";
import { getMerchantDailyPaidTotal } from "./payinDailyLimit";

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
