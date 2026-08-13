/**
 * schema-guard-column-diff.negtest.ts
 *
 * Negative-case regression test for schema-guard-column-diff.ts.
 *
 * Verifies that the script:
 *   • Exits 1 when a Drizzle schema column is absent from every guard file.
 *   • Exits 0 when every Drizzle schema column IS covered by a guard.
 *
 * The test never touches the real schema or guard files. It creates temporary
 * fixture directories, points the script at them via the SGCD_* env-var
 * overrides added for this purpose, then spawns the script as a child process
 * and asserts the exit code.
 *
 * Run:
 *   pnpm --filter @workspace/scripts run schema-guard-column-diff:negtest
 */

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, "schema-guard-column-diff.ts");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface FixtureOptions {
  /** Column names to include in the pgTable definition */
  schemaColumns: string[];
  /** Column names to include in the guard CREATE TABLE body */
  guardColumns: string[];
}

/**
 * Create a self-contained temporary fixture set and return the env vars
 * needed to point schema-guard-column-diff.ts at them.
 */
function buildFixtures(opts: FixtureOptions): {
  dir: string;
  env: NodeJS.ProcessEnv;
} {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sgcd-negtest-"));

  // ── schema dir ────────────────────────────────────────────────────────────
  const schemaDir = path.join(dir, "schema");
  fs.mkdirSync(schemaDir, { recursive: true });

  // index.ts: re-exports the single fixture table module
  fs.writeFileSync(
    path.join(schemaDir, "index.ts"),
    `export * from "./fixture_table";\n`,
  );

  // fixture_table.ts: one pgTable with the requested columns
  const colDefs = opts.schemaColumns
    .map((c) => `  ${c}: text("${c}"),`)
    .join("\n");
  fs.writeFileSync(
    path.join(schemaDir, "fixture_table.ts"),
    [
      `import { pgTable, text, serial } from "drizzle-orm/pg-core";`,
      ``,
      `export const fixtureTable = pgTable("fixture_table", {`,
      `  id: serial("id").primaryKey(),`,
      colDefs,
      `});`,
    ].join("\n") + "\n",
  );

  // ── guard file ────────────────────────────────────────────────────────────
  const guardColDefs = opts.guardColumns
    .map((c) => `  ${c} TEXT,`)
    .join("\n");

  const guardContent = [
    `-- fixture guard`,
    `CREATE TABLE IF NOT EXISTS fixture_table (`,
    `  id SERIAL PRIMARY KEY,`,
    guardColDefs,
    `);`,
  ].join("\n") + "\n";

  const guardFile = path.join(dir, "guard.ts");
  fs.writeFileSync(guardFile, guardContent);

  // ── empty migrate file (no additional coverage) ──────────────────────────
  const migrateFile = path.join(dir, "migrate.ts");
  fs.writeFileSync(migrateFile, `-- empty\n`);

  return {
    dir,
    env: {
      ...process.env,
      SGCD_SCHEMA_DIR: schemaDir,
      SGCD_SCHEMA_INDEX: path.join(schemaDir, "index.ts"),
      SGCD_GUARD_FILE: guardFile,
      SGCD_MIGRATE_FILE: migrateFile,
    },
  };
}

/** Spawn the script with the given env overrides and return the exit code. */
function runScript(env: NodeJS.ProcessEnv): number {
  const result = spawnSync(
    "node",
    ["--import", "tsx/esm", SCRIPT],
    { env, encoding: "utf8" },
  );
  // spawnSync returns null status when the process was killed by a signal;
  // treat that as a failure (non-zero).
  return result.status ?? 1;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("schema-guard-column-diff negative-case contract", () => {
  const fixtures: Array<{ dir: string }> = [];

  after(() => {
    // Clean up temp dirs
    for (const f of fixtures) {
      fs.rmSync(f.dir, { recursive: true, force: true });
    }
  });

  test("exits 1 when a schema column is missing from the guard", () => {
    const { dir, env } = buildFixtures({
      schemaColumns: ["name", "mystery_col"], // mystery_col is NOT in guard
      guardColumns: ["name"],                 // guard only covers 'name'
    });
    fixtures.push({ dir });

    const code = runScript(env);
    assert.equal(
      code,
      1,
      "script must exit 1 when 'mystery_col' is present in schema but absent from the guard",
    );
  });

  test("exits 0 when all schema columns are covered by the guard", () => {
    const { dir, env } = buildFixtures({
      schemaColumns: ["name", "mystery_col"],
      guardColumns: ["name", "mystery_col"], // both covered
    });
    fixtures.push({ dir });

    const code = runScript(env);
    assert.equal(
      code,
      0,
      "script must exit 0 when every schema column has a guard entry",
    );
  });

  test("exits 1 when the guard CREATE TABLE is completely empty", () => {
    const { dir, env } = buildFixtures({
      schemaColumns: ["status", "amount"],
      guardColumns: [], // guard body is empty — no columns at all
    });
    fixtures.push({ dir });

    const code = runScript(env);
    assert.equal(
      code,
      1,
      "script must exit 1 when guard CREATE TABLE has no columns and schema has columns",
    );
  });

  test("exits 1 when only ALTER TABLE covers a column the CREATE TABLE misses", async () => {
    // This test verifies a subtle parser edge-case: the column exists in the
    // schemaGuard via ALTER TABLE ADD COLUMN IF NOT EXISTS, NOT in CREATE TABLE.
    // The script should count ALTER TABLE coverage too → exit 0 for that column.
    // Conversely, a column with NEITHER entry should still be flagged.
    const { dir, env } = buildFixtures({
      schemaColumns: ["present_via_alter", "completely_missing"],
      guardColumns: [], // nothing in CREATE TABLE
    });
    fixtures.push({ dir });

    // Append an ALTER TABLE line for 'present_via_alter' to the guard file
    const guardFile = env.SGCD_GUARD_FILE as string;
    fs.appendFileSync(
      guardFile,
      `ALTER TABLE fixture_table ADD COLUMN IF NOT EXISTS present_via_alter TEXT;\n`,
    );

    const code = runScript(env);
    assert.equal(
      code,
      1,
      "script must exit 1 because 'completely_missing' has no CREATE TABLE or ALTER TABLE guard",
    );
  });

  test("exits 0 when a column is covered only via ALTER TABLE ADD COLUMN IF NOT EXISTS", () => {
    const { dir, env } = buildFixtures({
      schemaColumns: ["alter_only_col"],
      guardColumns: [], // CREATE TABLE body is empty
    });
    fixtures.push({ dir });

    // Add ALTER TABLE coverage for the column
    const guardFile = env.SGCD_GUARD_FILE as string;
    fs.appendFileSync(
      guardFile,
      `ALTER TABLE fixture_table ADD COLUMN IF NOT EXISTS alter_only_col TEXT;\n`,
    );

    const code = runScript(env);
    assert.equal(
      code,
      0,
      "script must exit 0 when a column is fully covered by an ALTER TABLE guard alone",
    );
  });
});
