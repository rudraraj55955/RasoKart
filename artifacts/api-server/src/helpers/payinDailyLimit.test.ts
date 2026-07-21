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
});
