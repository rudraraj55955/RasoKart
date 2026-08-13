/**
 * schema-guard-column-diff.negtest.ts
 *
 * Negative-case regression test for schema-guard-column-diff.ts.
 *
 * Verifies that the script:
 *   • Exits 1 when a Drizzle schema column is absent from every guard file.
 *   • Exits 0 when every Drizzle schema column IS covered by a guard.
 *   • Exits 1 when a DROP COLUMN guard targets a column still live in the
 *     Drizzle schema (or CREATE TABLE body for schemaGuard-only tables).
 *   • Exits 0 when a DROP COLUMN guard targets a column that has already been
 *     removed from the schema.
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

interface SchemaGuardOnlyFixtureOptions {
  /**
   * Column names to include in the CREATE TABLE body of the guard file.
   * There is intentionally NO corresponding Drizzle pgTable, so the script
   * treats this as a schemaGuard-only table.
   */
  guardCreateTableColumns: string[];
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

/**
 * Build a fixture set for a schemaGuard-only table — i.e. a table that has a
 * CREATE TABLE guard but NO corresponding Drizzle pgTable.  This exercises the
 * branch of the drop-check that validates DROP COLUMN claims against the
 * CREATE TABLE body rather than the Drizzle schema.
 */
function buildSchemaGuardOnlyFixtures(opts: SchemaGuardOnlyFixtureOptions): {
  dir: string;
  env: NodeJS.ProcessEnv;
} {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sgcd-guardonly-"));

  // ── Empty schema dir (no Drizzle pgTable definitions) ────────────────────
  const schemaDir = path.join(dir, "schema");
  fs.mkdirSync(schemaDir, { recursive: true });

  // index.ts with no re-exports so drizzle schema is empty
  fs.writeFileSync(path.join(schemaDir, "index.ts"), `// no tables\n`);

  // ── Guard file: CREATE TABLE for a schemaGuard-only table ────────────────
  const colDefs = opts.guardCreateTableColumns
    .map((c) => `  ${c} TEXT,`)
    .join("\n");

  const guardContent = [
    `-- schemaGuard-only fixture`,
    `CREATE TABLE IF NOT EXISTS guard_only_table (`,
    `  id SERIAL PRIMARY KEY,`,
    colDefs,
    `);`,
  ].join("\n") + "\n";

  const guardFile = path.join(dir, "guard.ts");
  fs.writeFileSync(guardFile, guardContent);

  // ── Empty migrate file ────────────────────────────────────────────────────
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

/** Full result from spawning the script. */
interface ScriptResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Spawn the script with the given env overrides and return the exit code,
 * stdout, and stderr.
 */
function runScriptFull(env: NodeJS.ProcessEnv): ScriptResult {
  const result = spawnSync(
    "node",
    ["--import", "tsx/esm", SCRIPT],
    { env, encoding: "utf8" },
  );
  return {
    // spawnSync returns null status when the process was killed by a signal;
    // treat that as a failure (non-zero).
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/** Spawn the script with the given env overrides and return the exit code. */
function runScript(env: NodeJS.ProcessEnv): number {
  return runScriptFull(env).code;
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

  // ── DROP COLUMN guard tests ─────────────────────────────────────────────

  // Case 1: Drizzle-tracked table — DROP COLUMN for a column still in schema → exit 1
  test("exits 1 when a DROP COLUMN guard targets a column still live in the Drizzle schema", () => {
    const { dir, env } = buildFixtures({
      schemaColumns: ["name", "status"], // both columns still in Drizzle schema
      guardColumns: ["name", "status"],  // guard covers them
    });
    fixtures.push({ dir });

    // Append a DROP COLUMN for 'status' — which is still in the Drizzle schema
    const guardFile = env.SGCD_GUARD_FILE as string;
    fs.appendFileSync(
      guardFile,
      `ALTER TABLE fixture_table DROP COLUMN IF EXISTS status;\n`,
    );

    const code = runScript(env);
    assert.equal(
      code,
      1,
      "script must exit 1 when DROP COLUMN targets 'status' which is still in the Drizzle schema",
    );
  });

  // Case 2: Drizzle-tracked table — DROP COLUMN for a column no longer in schema → exit 0
  test("exits 0 when a DROP COLUMN guard targets a column already removed from the Drizzle schema", () => {
    const { dir, env } = buildFixtures({
      schemaColumns: ["name"],   // 'old_col' intentionally absent from schema
      guardColumns: ["name"],    // guard covers the live columns
    });
    fixtures.push({ dir });

    // DROP COLUMN for 'old_col' — which is NOT in the Drizzle schema (already removed)
    // and NOT in the CREATE TABLE body → drop check passes.
    const guardFile = env.SGCD_GUARD_FILE as string;
    fs.appendFileSync(
      guardFile,
      `ALTER TABLE fixture_table DROP COLUMN IF EXISTS old_col;\n`,
    );

    const code = runScript(env);
    assert.equal(
      code,
      0,
      "script must exit 0 when DROP COLUMN targets a column already absent from the Drizzle schema",
    );
  });

  // Case 3: schemaGuard-only table — DROP COLUMN for a column still in CREATE TABLE → exit 1
  test("exits 1 when a DROP COLUMN guard targets a column still live in a schemaGuard-only table", () => {
    const { dir, env } = buildSchemaGuardOnlyFixtures({
      guardCreateTableColumns: ["tenant_id", "ref_code"], // both still live
    });
    fixtures.push({ dir });

    // DROP COLUMN for 'ref_code' — which is still in the CREATE TABLE body
    const guardFile = env.SGCD_GUARD_FILE as string;
    fs.appendFileSync(
      guardFile,
      `ALTER TABLE guard_only_table DROP COLUMN IF EXISTS ref_code;\n`,
    );

    const code = runScript(env);
    assert.equal(
      code,
      1,
      "script must exit 1 when DROP COLUMN targets 'ref_code' which is still in the guard CREATE TABLE body",
    );
  });

  // Case 4: schemaGuard-only table — DROP COLUMN for a column absent from CREATE TABLE → exit 0
  test("exits 0 when a DROP COLUMN guard targets a column already removed from a schemaGuard-only table", () => {
    const { dir, env } = buildSchemaGuardOnlyFixtures({
      guardCreateTableColumns: ["tenant_id"], // 'legacy_col' intentionally absent
    });
    fixtures.push({ dir });

    // DROP COLUMN for 'legacy_col' — which is NOT in the CREATE TABLE body (already removed)
    const guardFile = env.SGCD_GUARD_FILE as string;
    fs.appendFileSync(
      guardFile,
      `ALTER TABLE guard_only_table DROP COLUMN IF EXISTS legacy_col;\n`,
    );

    const code = runScript(env);
    assert.equal(
      code,
      0,
      "script must exit 0 when DROP COLUMN targets a column already absent from the schemaGuard-only CREATE TABLE body",
    );
  });

  // ── Bare DROP COLUMN (without IF EXISTS) tests ──────────────────────────
  //
  // A developer who omits IF EXISTS still deletes the column unconditionally.
  // The check must catch this variant too.

  // Case 5: Drizzle-tracked table — bare DROP COLUMN for a column still in schema → exit 1
  test("exits 1 when a bare DROP COLUMN (no IF EXISTS) targets a column still live in the Drizzle schema", () => {
    const { dir, env } = buildFixtures({
      schemaColumns: ["name", "status"], // both columns still in Drizzle schema
      guardColumns: ["name", "status"],  // guard covers them
    });
    fixtures.push({ dir });

    // Bare DROP COLUMN for 'status' — which is still in the Drizzle schema
    const guardFile = env.SGCD_GUARD_FILE as string;
    fs.appendFileSync(
      guardFile,
      `ALTER TABLE fixture_table DROP COLUMN status;\n`,
    );

    const code = runScript(env);
    assert.equal(
      code,
      1,
      "script must exit 1 when bare DROP COLUMN targets 'status' which is still in the Drizzle schema",
    );
  });

  // Case 6: Drizzle-tracked table — bare DROP COLUMN for a column no longer in schema → exit 0 + warning
  test("exits 0 and emits a warning when a bare DROP COLUMN (no IF EXISTS) targets a column already removed from the Drizzle schema", () => {
    const { dir, env } = buildFixtures({
      schemaColumns: ["name"],   // 'old_col' intentionally absent from schema
      guardColumns: ["name"],    // guard covers the live columns
    });
    fixtures.push({ dir });

    // Bare DROP COLUMN for 'old_col' — which is NOT in the Drizzle schema (already removed)
    // and NOT in the CREATE TABLE body → drop check passes.
    const guardFile = env.SGCD_GUARD_FILE as string;
    fs.appendFileSync(
      guardFile,
      `ALTER TABLE fixture_table DROP COLUMN old_col;\n`,
    );

    const { code, stdout, stderr } = runScriptFull(env);
    const output = stdout + stderr;
    assert.equal(
      code,
      0,
      "script must exit 0 when bare DROP COLUMN targets a column already absent from the Drizzle schema",
    );
    assert.ok(
      output.includes("IF EXISTS"),
      `script must warn about missing IF EXISTS in output; got:\n${output}`,
    );
  });

  // Case 7: schemaGuard-only table — bare DROP COLUMN for a column still in CREATE TABLE → exit 1
  test("exits 1 when a bare DROP COLUMN (no IF EXISTS) targets a column still live in a schemaGuard-only table", () => {
    const { dir, env } = buildSchemaGuardOnlyFixtures({
      guardCreateTableColumns: ["tenant_id", "ref_code"], // both still live
    });
    fixtures.push({ dir });

    // Bare DROP COLUMN for 'ref_code' — which is still in the CREATE TABLE body
    const guardFile = env.SGCD_GUARD_FILE as string;
    fs.appendFileSync(
      guardFile,
      `ALTER TABLE guard_only_table DROP COLUMN ref_code;\n`,
    );

    const code = runScript(env);
    assert.equal(
      code,
      1,
      "script must exit 1 when bare DROP COLUMN targets 'ref_code' which is still in the guard CREATE TABLE body",
    );
  });

  // Case 8: schemaGuard-only table — bare DROP COLUMN for a column absent from CREATE TABLE → exit 0 + warning
  test("exits 0 and emits a warning when a bare DROP COLUMN (no IF EXISTS) targets a column already removed from a schemaGuard-only table", () => {
    const { dir, env } = buildSchemaGuardOnlyFixtures({
      guardCreateTableColumns: ["tenant_id"], // 'legacy_col' intentionally absent
    });
    fixtures.push({ dir });

    // Bare DROP COLUMN for 'legacy_col' — which is NOT in the CREATE TABLE body (already removed)
    const guardFile = env.SGCD_GUARD_FILE as string;
    fs.appendFileSync(
      guardFile,
      `ALTER TABLE guard_only_table DROP COLUMN legacy_col;\n`,
    );

    const { code, stdout, stderr } = runScriptFull(env);
    const output = stdout + stderr;
    assert.equal(
      code,
      0,
      "script must exit 0 when bare DROP COLUMN targets a column already absent from the schemaGuard-only CREATE TABLE body",
    );
    assert.ok(
      output.includes("IF EXISTS"),
      `script must warn about missing IF EXISTS in output; got:\n${output}`,
    );
  });

  // ── Typo'd table name in DROP COLUMN ────────────────────────────────────
  //
  // A DROP COLUMN whose table name does not appear in the Drizzle schema OR in
  // any CREATE TABLE body in the guard files is almost certainly a typo.  The
  // old check only verified the column name, so such a typo would silently pass
  // all checks.  The fixed check cross-validates the table name first.

  // Case N-a: DROP COLUMN with a typo'd table name → exit 1
  test("exits 1 when a DROP COLUMN guard references a table name that does not exist in the schema or any CREATE TABLE body", () => {
    const { dir, env } = buildFixtures({
      schemaColumns: ["name"],
      guardColumns: ["name"],
    });
    fixtures.push({ dir });

    // 'fixture_tabel' is a typo — the real table is 'fixture_table'
    const guardFile = env.SGCD_GUARD_FILE as string;
    fs.appendFileSync(
      guardFile,
      `ALTER TABLE fixture_tabel DROP COLUMN IF EXISTS name;\n`,
    );

    const { code, stderr } = runScriptFull(env);
    assert.equal(
      code,
      1,
      "script must exit 1 when DROP COLUMN references a table name absent from both the Drizzle schema and every CREATE TABLE body",
    );
    assert.ok(
      stderr.includes("fixture_tabel"),
      `script must name the typo'd table in the error output; got:\n${stderr}`,
    );
  });

  // Case N-b: DROP COLUMN with a typo'd table name in a schemaGuard-only context → exit 1
  test("exits 1 when a DROP COLUMN guard in a schemaGuard-only context references a table name not present in any CREATE TABLE body", () => {
    const { dir, env } = buildSchemaGuardOnlyFixtures({
      guardCreateTableColumns: ["tenant_id"],
    });
    fixtures.push({ dir });

    // 'guard_only_tabel' is a typo — the real table is 'guard_only_table'
    const guardFile = env.SGCD_GUARD_FILE as string;
    fs.appendFileSync(
      guardFile,
      `ALTER TABLE guard_only_tabel DROP COLUMN IF EXISTS tenant_id;\n`,
    );

    const { code, stderr } = runScriptFull(env);
    assert.equal(
      code,
      1,
      "script must exit 1 when DROP COLUMN references a typo'd table name absent from every CREATE TABLE body",
    );
    assert.ok(
      stderr.includes("guard_only_tabel"),
      `script must name the typo'd table in the error output; got:\n${stderr}`,
    );
  });

  // ── ALTER TABLE ADD COLUMN-only DROP detection ───────────────────────────

  // Case 9: schemaGuard-only table — DROP COLUMN for a column that exists ONLY via
  // ALTER TABLE ADD COLUMN (not in CREATE TABLE body) → exit 1.
  //
  // This is the specific gap this task targets: the old check only looked at the
  // CREATE TABLE body, so a column introduced exclusively via ALTER TABLE ADD COLUMN
  // would pass the drop-check undetected.  The fixed check uses the combined
  // `guarded` map (CREATE TABLE ∪ ALTER TABLE ADD COLUMN), so the DROP is caught.
  test("exits 1 when a DROP COLUMN guard targets a column that exists only via ALTER TABLE ADD COLUMN in a schemaGuard-only table", () => {
    const { dir, env } = buildSchemaGuardOnlyFixtures({
      guardCreateTableColumns: ["tenant_id"], // alter_only_col is NOT in CREATE TABLE
    });
    fixtures.push({ dir });

    const guardFile = env.SGCD_GUARD_FILE as string;

    // Add the column via ALTER TABLE ADD COLUMN only (not in CREATE TABLE body)
    fs.appendFileSync(
      guardFile,
      `ALTER TABLE guard_only_table ADD COLUMN IF NOT EXISTS alter_only_col TEXT;\n`,
    );

    // Now attempt to DROP that same column — should be caught because the column
    // is still live (covered by the ALTER TABLE ADD COLUMN line above).
    fs.appendFileSync(
      guardFile,
      `ALTER TABLE guard_only_table DROP COLUMN IF EXISTS alter_only_col;\n`,
    );

    const code = runScript(env);
    assert.equal(
      code,
      1,
      "script must exit 1 when DROP COLUMN targets 'alter_only_col' which is still live " +
        "via an ALTER TABLE ADD COLUMN guard (even though it is absent from the CREATE TABLE body)",
    );
  });

});
