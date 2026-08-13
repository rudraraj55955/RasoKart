/**
 * schema-guard-column-diff.test.ts
 *
 * Regression tests for the two parsing helpers that power the reverse-guard
 * check:
 *   • extractBalancedBody  — must extract the complete table body even when
 *     column option objects introduce multiple levels of nested braces.
 *   • extractDrizzleColumns — must find every column in a table definition,
 *     including those that come AFTER the first nested `{ ... }` argument.
 *   • collectAlterTableClaims — must capture both single-line and multiline
 *     ALTER TABLE ADD COLUMN IF NOT EXISTS statements.
 *
 * The reverse check (ALTER guard → Drizzle column membership) is tested
 * end-to-end: a stale multiline ALTER statement must produce a non-empty
 * stale array so that calling code can exit 1.
 *
 * Run with:
 *   pnpm --filter @workspace/scripts run test:schema-guard-column-diff
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractBalancedBody,
  extractDrizzleColumns,
  collectAlterTableClaims,
  collectManifestColumns,
} from "./schema-guard-column-diff.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ---------------------------------------------------------------------------
// extractBalancedBody
// ---------------------------------------------------------------------------

describe("extractBalancedBody", () => {
  it("extracts body between the outermost braces", () => {
    const src = "{ a: 1 }";
    assert.equal(extractBalancedBody(src, 0), " a: 1 ");
  });

  it("handles one level of nested braces without truncation", () => {
    const src = "{ a: fn({ opt: true }), b: 2 }";
    assert.equal(extractBalancedBody(src, 0), " a: fn({ opt: true }), b: 2 ");
  });

  it("handles multiple nested brace pairs (the brace-truncation regression)", () => {
    // Before the fix, extractDrizzleColumns used a single regex whose
    // `[^}]*` consumed the `{` of the first nested object and then the outer
    // `\}` would match that object's `}`, truncating everything after it.
    const src = [
      "{",
      '  colA: text("col_a"),',
      '  colB: timestamp("col_b", { withTimezone: true }),',
      '  colC: timestamp("col_c", { withTimezone: true }),',
      '  colD: text("col_d"),',
      "}",
    ].join("\n");

    const body = extractBalancedBody(src, 0);
    // All four columns must appear — before the fix, colB's `{ withTimezone: true }`
    // caused truncation so colC and colD were silently dropped.
    assert.ok(body.includes("colA"), "body must include colA");
    assert.ok(body.includes("colC"), "body must include colC (after first nested {})");
    assert.ok(body.includes("colD"), "body must include colD (after multiple nested {})");
    // The body is exclusive of the outermost braces; it ends just before the
    // final `}` of the pgTable column object, not after it.
    assert.ok(!body.endsWith("}"), "body must not end with the outer closing brace");
  });

  it("handles deeply nested braces", () => {
    const src = "{ a: fn({ b: fn2({ c: 1 }) }) }";
    assert.equal(extractBalancedBody(src, 0), " a: fn({ b: fn2({ c: 1 }) }) ");
  });
});

// ---------------------------------------------------------------------------
// extractDrizzleColumns
// ---------------------------------------------------------------------------

describe("extractDrizzleColumns", () => {
  it("finds all columns in a simple table", () => {
    const src = `
      export const t = pgTable("my_table", {
        id: serial("id").primaryKey(),
        name: text("name").notNull(),
      });
    `;
    const result = extractDrizzleColumns(src);
    assert.ok(result.has("my_table"));
    const cols = result.get("my_table")!;
    assert.ok(cols.includes("id"));
    assert.ok(cols.includes("name"));
  });

  it("captures columns that appear after the first nested { } argument (brace-truncation regression)", () => {
    // This is the exact scenario that was broken: a timestamp column with
    // { withTimezone: true } caused the old regex to stop, so any columns
    // defined after it were silently dropped.
    const src = `
      export const usersTable = pgTable("users", {
        id: serial("id").primaryKey(),
        createdAt: timestamp("created_at", { withTimezone: true }),
        lastSeenIp: text("last_seen_ip"),
        passwordUpdatedAt: timestamp("password_updated_at", { withTimezone: true }),
        lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
      });
    `;
    const result = extractDrizzleColumns(src);
    assert.ok(result.has("users"), "table 'users' should be found");
    const cols = result.get("users")!;
    assert.ok(cols.includes("last_seen_ip"), "last_seen_ip must be found after first nested {}");
    assert.ok(cols.includes("password_updated_at"), "password_updated_at must be found");
    assert.ok(cols.includes("last_login_at"), "last_login_at must be found");
  });

  it("derives snake_case name when no explicit SQL name is given", () => {
    const src = `
      export const t = pgTable("tbl", {
        myColumn: text(),
      });
    `;
    const result = extractDrizzleColumns(src);
    assert.ok(result.get("tbl")?.includes("my_column"));
  });
});

// ---------------------------------------------------------------------------
// collectManifestColumns
// ---------------------------------------------------------------------------

describe("collectManifestColumns", () => {
  let tmpDir: string;

  // Create a fresh temp dir for each test via a simple helper that tracks the
  // path so we can clean up after.
  const tmpDirs: string[] = [];
  function makeTmp(): string {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "sgcd-manifest-test-"));
    tmpDirs.push(d);
    return d;
  }

  // Cleanup after all tests in this describe block.
  // node:test doesn't support afterAll inside describe in older versions;
  // we rely on the OS to clean up /tmp directories after the process exits.

  it("returns an empty Map when the manifest file does not exist", () => {
    const result = collectManifestColumns("/nonexistent/path/manifest.json");
    assert.equal(result.size, 0);
  });

  it("returns an empty Map when the manifest has only _ keys", () => {
    const dir = makeTmp();
    const f = path.join(dir, "manifest.json");
    fs.writeFileSync(f, JSON.stringify({ _readme: "docs only" }));
    const result = collectManifestColumns(f);
    assert.equal(result.size, 0);
  });

  it("parses a manifest with one table entry and lowercases column names", () => {
    const dir = makeTmp();
    const f = path.join(dir, "manifest.json");
    fs.writeFileSync(
      f,
      JSON.stringify({ my_table: ["ID", "Status", "created_at"] }),
    );
    const result = collectManifestColumns(f);
    assert.equal(result.size, 1);
    assert.ok(result.has("my_table"));
    const cols = result.get("my_table")!;
    assert.deepEqual(cols, ["id", "status", "created_at"]);
  });

  it("parses a manifest with multiple table entries", () => {
    const dir = makeTmp();
    const f = path.join(dir, "manifest.json");
    fs.writeFileSync(
      f,
      JSON.stringify({
        _readme: "ignore me",
        table_a: ["id", "col1"],
        table_b: ["id", "col2", "col3"],
      }),
    );
    const result = collectManifestColumns(f);
    assert.equal(result.size, 2);
    assert.ok(result.has("table_a"));
    assert.ok(result.has("table_b"));
    assert.deepEqual(result.get("table_a"), ["id", "col1"]);
    assert.deepEqual(result.get("table_b"), ["id", "col2", "col3"]);
  });

  it("throws on malformed JSON", () => {
    const dir = makeTmp();
    const f = path.join(dir, "manifest.json");
    fs.writeFileSync(f, "{ not valid json");
    assert.throws(() => collectManifestColumns(f), /not valid JSON/i);
  });

  it("throws when a table entry is not an array of strings", () => {
    const dir = makeTmp();
    const f = path.join(dir, "manifest.json");
    fs.writeFileSync(f, JSON.stringify({ my_table: "not-an-array" }));
    assert.throws(() => collectManifestColumns(f), /array of strings/i);
  });
});

// ---------------------------------------------------------------------------
// collectAlterTableClaims
// ---------------------------------------------------------------------------

describe("collectAlterTableClaims", () => {
  it("finds a single-line ALTER TABLE statement", () => {
    const src = `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_ip TEXT`;
    const claims = collectAlterTableClaims(src);
    assert.equal(claims.length, 1);
    assert.equal(claims[0].table, "users");
    assert.equal(claims[0].col, "last_seen_ip");
    assert.equal(claims[0].lineNo, 1);
  });

  it("finds a multiline ALTER TABLE statement spanning two lines", () => {
    // Mirrors the real merchant_auth_locks guard in schemaGuard.ts:2057-2058
    // and db-migrate.ts:1684-1685.
    const src = [
      "  await exec.execute(sql`",
      "    ALTER TABLE merchant_auth_locks",
      "      ADD COLUMN IF NOT EXISTS last_exhaustion_at TIMESTAMPTZ",
      "  `);",
    ].join("\n");

    const claims = collectAlterTableClaims(src);
    assert.equal(claims.length, 1, "must find the multiline ALTER TABLE claim");
    assert.equal(claims[0].table, "merchant_auth_locks");
    assert.equal(claims[0].col, "last_exhaustion_at");
    // Line number should point at the ALTER TABLE line (line 2 in this snippet)
    assert.ok(claims[0].lineNo >= 2, "lineNo should reflect the position of ALTER TABLE");
  });

  it("finds multiple claims in the same source", () => {
    const src = [
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS col_a TEXT",
      "ALTER TABLE orders",
      "  ADD COLUMN IF NOT EXISTS col_b INTEGER",
    ].join("\n");

    const claims = collectAlterTableClaims(src);
    assert.equal(claims.length, 2);
    const tables = claims.map((c) => c.table);
    assert.ok(tables.includes("users"));
    assert.ok(tables.includes("orders"));
  });

  it("returns an empty array when no ALTER TABLE ADD COLUMN IF NOT EXISTS is present", () => {
    const src = "SELECT 1; CREATE TABLE foo (id SERIAL);";
    assert.deepEqual(collectAlterTableClaims(src), []);
  });

  // ── End-to-end: stale multiline ALTER TABLE is reported ─────────────────

  it("stale multiline ALTER TABLE column triggers a non-empty stale list (reverse-check regression)", () => {
    // Simulate the reverse check logic inline so we can assert exit-1 behaviour
    // without spawning a subprocess.
    //
    // A guard file contains a multiline ALTER TABLE for `typo_col_xyz`, which
    // does NOT exist in the Drizzle schema for `users`.  The reverse check must
    // report it as stale.
    const guardSource = [
      "  await exec.execute(sql`",
      "    ALTER TABLE users",
      "      ADD COLUMN IF NOT EXISTS typo_col_xyz TEXT",
      "  `);",
    ].join("\n");

    const drizzleSource = `
      export const usersTable = pgTable("users", {
        id: serial("id").primaryKey(),
        real_col: text("real_col"),
      });
    `;

    const claims = collectAlterTableClaims(guardSource);
    const drizzle = extractDrizzleColumns(drizzleSource);

    const drizzleLower = new Map<string, Set<string>>();
    for (const [table, cols] of drizzle) {
      drizzleLower.set(table.toLowerCase(), new Set(cols.map((c) => c.toLowerCase())));
    }

    const stale = claims.filter(({ table, col }) => {
      const drizzleCols = drizzleLower.get(table);
      return drizzleCols !== undefined && !drizzleCols.has(col);
    });

    assert.equal(
      stale.length,
      1,
      "stale multiline ALTER TABLE claim must be detected (would cause exit 1)"
    );
    assert.equal(stale[0].table, "users");
    assert.equal(stale[0].col, "typo_col_xyz");
  });
});
