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
import { collectManifestColumns } from "./schema-guard-column-diff.js";

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
 *
 * A manifest file is automatically written that registers `guard_only_table`
 * with all the columns from `guardCreateTableColumns` (plus `id`).  This
 * satisfies the unregistered-guard-only-table check so that existing tests
 * which use this helper are not broken by that check.  Tests that specifically
 * want to exercise the unregistered-table path should override
 * `SGCD_MANIFEST_FILE` in the env they pass to `runScript`.
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

  // ── Migrate file: also has CREATE TABLE so the deploy-window check passes ─
  // The deploy-window check flags tables that have CREATE TABLE in schemaGuard
  // but not in db-migrate AND are not Drizzle-tracked.  Most tests using this
  // helper are exercising column-level drift, not the deploy-window scenario,
  // so we include a matching CREATE TABLE here to keep them green.  Tests that
  // specifically want to exercise the deploy-window gap path should build their
  // own fixture without this entry.
  const migrateContent = [
    `-- schemaGuard-only fixture (migrate)`,
    `CREATE TABLE IF NOT EXISTS guard_only_table (`,
    `  id SERIAL PRIMARY KEY,`,
    colDefs,
    `);`,
  ].join("\n") + "\n";

  const migrateFile = path.join(dir, "migrate.ts");
  fs.writeFileSync(migrateFile, migrateContent);

  // ── Manifest file: register guard_only_table so the unregistered-table
  // check passes for callers that are not testing that specific path ─────────
  const manifestFile = path.join(dir, "manifest.json");
  fs.writeFileSync(
    manifestFile,
    JSON.stringify({
      _readme: "fixture manifest — auto-generated by buildSchemaGuardOnlyFixtures",
      guard_only_table: ["id", ...opts.guardCreateTableColumns],
    }),
  );

  return {
    dir,
    env: {
      ...process.env,
      SGCD_SCHEMA_DIR: schemaDir,
      SGCD_SCHEMA_INDEX: path.join(schemaDir, "index.ts"),
      SGCD_GUARD_FILE: guardFile,
      SGCD_MIGRATE_FILE: migrateFile,
      SGCD_MANIFEST_FILE: manifestFile,
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

  // ── Manifest forward check ───────────────────────────────────────────────
  //
  // The manifest (schema-guard-only-columns.json) lists expected columns for
  // schemaGuard-only tables.  The script must exit 1 when a manifest column is
  // absent from the CREATE TABLE body, and exit 0 when all manifest columns are
  // present in the CREATE TABLE body.

  // Case M1: manifest column present in CREATE TABLE body → exit 0
  test("exits 0 when every manifest column is present in the CREATE TABLE body", () => {
    const { dir, env } = buildSchemaGuardOnlyFixtures({
      guardCreateTableColumns: ["tenant_id", "status", "created_at"],
    });
    fixtures.push({ dir });

    // Write a manifest that lists exactly the columns present in the CREATE TABLE
    const manifestFile = path.join(dir, "manifest.json");
    fs.writeFileSync(
      manifestFile,
      JSON.stringify({
        "_readme": "test manifest",
        "guard_only_table": ["id", "tenant_id", "status", "created_at"],
      }),
    );

    const code = runScript({ ...env, SGCD_MANIFEST_FILE: manifestFile });
    assert.equal(
      code,
      0,
      "script must exit 0 when all manifest columns are present in the CREATE TABLE body",
    );
  });

  // Case M2: manifest column missing from CREATE TABLE body → exit 1
  test("exits 1 when a manifest column is absent from the CREATE TABLE body", () => {
    const { dir, env } = buildSchemaGuardOnlyFixtures({
      guardCreateTableColumns: ["tenant_id", "status"], // 'missing_col' is NOT here
    });
    fixtures.push({ dir });

    const manifestFile = path.join(dir, "manifest.json");
    fs.writeFileSync(
      manifestFile,
      JSON.stringify({
        "guard_only_table": ["id", "tenant_id", "status", "missing_col"],
      }),
    );

    const { code, stdout, stderr } = runScriptFull({ ...env, SGCD_MANIFEST_FILE: manifestFile });
    assert.equal(
      code,
      1,
      "script must exit 1 when 'missing_col' is in the manifest but absent from the CREATE TABLE body",
    );
    const output = stdout + stderr;
    assert.ok(
      output.includes("missing_col"),
      `output must mention the missing column; got:\n${output}`,
    );
  });

  // Case M3: manifest references a table with no CREATE TABLE guard at all → exit 1
  test("exits 1 when a manifest table has no CREATE TABLE guard at all", () => {
    const { dir, env } = buildSchemaGuardOnlyFixtures({
      guardCreateTableColumns: ["tenant_id"],
      // guard only defines 'guard_only_table', not 'phantom_table'
    });
    fixtures.push({ dir });

    const manifestFile = path.join(dir, "manifest.json");
    fs.writeFileSync(
      manifestFile,
      JSON.stringify({
        // phantom_table has no CREATE TABLE in the guard files
        "phantom_table": ["id", "some_col"],
      }),
    );

    const code = runScript({ ...env, SGCD_MANIFEST_FILE: manifestFile });
    assert.equal(
      code,
      1,
      "script must exit 1 when a manifest table has no CREATE TABLE guard in any guard file",
    );
  });

  // Case M4: empty manifest + no guard-only tables → exit 0 (nothing to declare)
  //
  // Uses buildFixtures (Drizzle-tracked table) so that the unregistered-table
  // check has nothing to flag — the point of this test is that an empty manifest
  // is not itself an error.
  test("exits 0 when the manifest is empty and there are no guard-only tables", () => {
    const { dir, env } = buildFixtures({
      schemaColumns: ["name"],
      guardColumns: ["name"],
    });
    fixtures.push({ dir });

    const manifestFile = path.join(dir, "manifest.json");
    fs.writeFileSync(manifestFile, JSON.stringify({ "_readme": "empty manifest" }));

    const code = runScript({ ...env, SGCD_MANIFEST_FILE: manifestFile });
    assert.equal(
      code,
      0,
      "script must exit 0 when the manifest is empty and every guarded table is Drizzle-tracked",
    );
  });

  // Case M5: manifest file absent + no guard-only tables → exit 0
  //
  // Uses buildFixtures (Drizzle-tracked table) so that the unregistered-table
  // check has nothing to flag — the point of this test is that a missing
  // manifest file is not itself an error.
  test("exits 0 when the manifest file does not exist and there are no guard-only tables", () => {
    const { dir, env } = buildFixtures({
      schemaColumns: ["name"],
      guardColumns: ["name"],
    });
    fixtures.push({ dir });

    const nonExistentManifest = path.join(dir, "does-not-exist.json");
    const code = runScript({ ...env, SGCD_MANIFEST_FILE: nonExistentManifest });
    assert.equal(
      code,
      0,
      "script must exit 0 when the manifest file does not exist and every guarded table is Drizzle-tracked",
    );
  });

  // ── Manifest reverse check ───────────────────────────────────────────────
  //
  // The reverse check ensures that every column in a CREATE TABLE body of a
  // manifest-registered table also appears in the manifest.  This catches
  // column renames where the old name stays in the manifest (passing the
  // forward check) while the new name in the CREATE TABLE body goes unrecorded.

  // Case R1: CREATE TABLE has a column not declared in the manifest → exit 1
  test("exits 1 when a CREATE TABLE column is absent from the manifest", () => {
    // CREATE TABLE body has: id, tenant_id, new_col
    // Manifest declares:     id, tenant_id           ← new_col is missing
    //
    // The forward check passes (all manifest columns ARE in CREATE TABLE).
    // The reverse check fails because new_col is in CREATE TABLE but not in the manifest.
    const { dir, env } = buildSchemaGuardOnlyFixtures({
      guardCreateTableColumns: ["tenant_id", "new_col"],
    });
    fixtures.push({ dir });

    // Override the manifest so new_col is intentionally omitted (simulating a
    // rename where the developer updated CREATE TABLE but forgot the manifest).
    const manifestFile = path.join(dir, "manifest.json");
    fs.writeFileSync(
      manifestFile,
      JSON.stringify({
        _readme: "test manifest — new_col intentionally omitted to exercise the reverse check",
        guard_only_table: ["id", "tenant_id"],
      }),
    );

    const { code, stdout, stderr } = runScriptFull({ ...env, SGCD_MANIFEST_FILE: manifestFile });
    assert.equal(
      code,
      1,
      "script must exit 1 when 'new_col' is in the CREATE TABLE body but absent from the manifest",
    );
    const output = stdout + stderr;
    assert.ok(
      output.includes("new_col"),
      `output must mention the undeclared column; got:\n${output}`,
    );
  });

  // Case R2: all CREATE TABLE columns are declared in the manifest → exit 0
  test("exits 0 when all CREATE TABLE columns are declared in the manifest", () => {
    // CREATE TABLE body has: id, tenant_id, status
    // Manifest declares:     id, tenant_id, status   ← full match
    //
    // buildSchemaGuardOnlyFixtures already writes a manifest that lists
    // id + all guardCreateTableColumns, so the default env is sufficient.
    const { dir, env } = buildSchemaGuardOnlyFixtures({
      guardCreateTableColumns: ["tenant_id", "status"],
    });
    fixtures.push({ dir });

    const code = runScript(env);
    assert.equal(
      code,
      0,
      "script must exit 0 when every CREATE TABLE column is declared in the manifest",
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

  // ── Unregistered guard-only table check ─────────────────────────────────
  //
  // A CREATE TABLE guard with no matching Drizzle pgTable AND no manifest entry
  // is completely invisible to CI — neither the Drizzle forward check nor the
  // manifest forward check can audit it.  The script must exit 1 when such a
  // table is found, and exit 0 when the table is registered in the manifest.

  // Case U1: guard-only table with no manifest entry → exit 1
  test("exits 1 when a schemaGuard-only table has no manifest entry", () => {
    const { dir, env } = buildSchemaGuardOnlyFixtures({
      guardCreateTableColumns: ["tenant_id", "status"],
    });
    fixtures.push({ dir });

    // Override the manifest with an empty one so guard_only_table is not registered
    const emptyManifest = path.join(dir, "empty-manifest.json");
    fs.writeFileSync(emptyManifest, JSON.stringify({ _readme: "intentionally empty for test" }));

    const { code, stdout, stderr } = runScriptFull({ ...env, SGCD_MANIFEST_FILE: emptyManifest });
    assert.equal(
      code,
      1,
      "script must exit 1 when a CREATE TABLE guard has no Drizzle pgTable and no manifest entry",
    );
    const output = stdout + stderr;
    assert.ok(
      output.includes("guard_only_table"),
      `output must name the unregistered table; got:\n${output}`,
    );
  });

  // Case U2: guard-only table WITH a manifest entry → exit 0 (no unregistered warning)
  test("exits 0 when a schemaGuard-only table has a manifest entry covering all its columns", () => {
    const { dir, env } = buildSchemaGuardOnlyFixtures({
      guardCreateTableColumns: ["tenant_id", "status"],
    });
    fixtures.push({ dir });

    // The buildSchemaGuardOnlyFixtures helper already writes a manifest that
    // registers guard_only_table with id + guardCreateTableColumns, so using
    // the default SGCD_MANIFEST_FILE from env is sufficient.
    const code = runScript(env);
    assert.equal(
      code,
      0,
      "script must exit 0 when every guard-only table has a manifest entry that covers all its columns",
    );
  });

  // ── Cross-file consistency check ────────────────────────────────────────
  //
  // Verifies that the script exits 1 when a CREATE TABLE body in schemaGuard.ts
  // and db-migrate.ts define different column sets for the same table.  This is
  // the rename-without-sync scenario: a developer renames a column in one guard
  // file but leaves the old name in the other.  The combined forward check
  // misses it; the cross-file check must catch it.

  /**
   * Build a fixture pair where schemaGuard and db-migrate each have a CREATE
   * TABLE block for the same table, but with independently-specified column
   * lists.  Both files are Drizzle-tracked (via the schemaColumns list) so
   * the forward, reverse, manifest, and unregistered-table checks don't fire
   * independently of the cross-file scenario under test.
   *
   * guardColumns   — columns in schemaGuard.ts CREATE TABLE body
   * migrateColumns — columns in db-migrate.ts  CREATE TABLE body
   * schemaColumns  — columns in the Drizzle pgTable (must be a superset of
   *                  guardColumns ∪ migrateColumns so the forward check passes)
   */
  function buildCrossFileFixtures(opts: {
    schemaColumns: string[];
    guardColumns: string[];
    migrateColumns: string[];
  }): { dir: string; env: NodeJS.ProcessEnv } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sgcd-crossfile-"));

    // ── schema dir ──────────────────────────────────────────────────────────
    const schemaDir = path.join(dir, "schema");
    fs.mkdirSync(schemaDir, { recursive: true });

    fs.writeFileSync(
      path.join(schemaDir, "index.ts"),
      `export * from "./fixture_table";\n`,
    );

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

    // ── schemaGuard file ─────────────────────────────────────────────────────
    const guardColDefs = opts.guardColumns.map((c) => `  ${c} TEXT,`).join("\n");
    const guardFile = path.join(dir, "guard.ts");
    fs.writeFileSync(
      guardFile,
      [
        `-- schemaGuard fixture`,
        `CREATE TABLE IF NOT EXISTS fixture_table (`,
        `  id SERIAL PRIMARY KEY,`,
        guardColDefs,
        `);`,
      ].join("\n") + "\n",
    );

    // ── db-migrate file ──────────────────────────────────────────────────────
    const migrateColDefs = opts.migrateColumns
      .map((c) => `  ${c} TEXT,`)
      .join("\n");
    const migrateFile = path.join(dir, "migrate.ts");
    fs.writeFileSync(
      migrateFile,
      [
        `-- db-migrate fixture`,
        `CREATE TABLE IF NOT EXISTS fixture_table (`,
        `  id SERIAL PRIMARY KEY,`,
        migrateColDefs,
        `);`,
      ].join("\n") + "\n",
    );

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

  // Case CF-1: column in schemaGuard CREATE TABLE but absent from db-migrate → exit 1
  test("exits 1 when a column is in schemaGuard.ts CREATE TABLE but absent from db-migrate.ts for the same table", () => {
    // Simulates: developer renamed 'status_v1' → 'status_v2' in schemaGuard.ts
    // but forgot to update db-migrate.ts.  The combined forward check passes
    // (status_v1 satisfies it via db-migrate, status_v2 satisfies it via
    // schemaGuard) but the cross-file check must flag the inconsistency.
    const { dir, env } = buildCrossFileFixtures({
      // Drizzle schema has status_v2 (the renamed column)
      schemaColumns: ["status_v2"],
      // schemaGuard.ts was updated to use the new name
      guardColumns: ["status_v2"],
      // db-migrate.ts still has the old name — this is the drift
      migrateColumns: ["status_v1"],
    });
    fixtures.push({ dir });

    const { code, stdout, stderr } = runScriptFull(env);
    assert.equal(
      code,
      1,
      "script must exit 1 when 'status_v2' is in schemaGuard.ts but absent from db-migrate.ts CREATE TABLE",
    );
    // The error output must name the drifting column(s) so developers know what to fix.
    const output = stdout + stderr;
    assert.ok(
      output.includes("status_v2") || output.includes("status_v1"),
      `output must mention the drifting column name(s); got:\n${output}`,
    );
  });

  // Case CF-2: column in db-migrate CREATE TABLE but absent from schemaGuard → exit 1
  test("exits 1 when a column is in db-migrate.ts CREATE TABLE but absent from schemaGuard.ts for the same table", () => {
    // Mirror of CF-1: the rename was applied to db-migrate but not schemaGuard.
    const { dir, env } = buildCrossFileFixtures({
      schemaColumns: ["amount_cents"],
      // schemaGuard still has the old column name
      guardColumns: ["amount"],
      // db-migrate was updated to the new name
      migrateColumns: ["amount_cents"],
    });
    fixtures.push({ dir });

    const { code, stdout, stderr } = runScriptFull(env);
    assert.equal(
      code,
      1,
      "script must exit 1 when 'amount_cents' is in db-migrate.ts but absent from schemaGuard.ts CREATE TABLE",
    );
    const output = stdout + stderr;
    assert.ok(
      output.includes("amount_cents") || output.includes("amount"),
      `output must mention the drifting column name(s); got:\n${output}`,
    );
  });

  // Case CF-3: both files define the same column set → exit 0 (no cross-file drift)
  test("exits 0 when schemaGuard.ts and db-migrate.ts CREATE TABLE bodies define the same column set", () => {
    const { dir, env } = buildCrossFileFixtures({
      schemaColumns: ["status", "amount_cents"],
      guardColumns: ["status", "amount_cents"],   // in sync
      migrateColumns: ["status", "amount_cents"], // in sync
    });
    fixtures.push({ dir });

    const code = runScript(env);
    assert.equal(
      code,
      0,
      "script must exit 0 when both guard files define the same column set for the shared table",
    );
  });

  // Case CF-4: table only appears in one guard file → exit 0 (no cross-file check)
  //
  // Not every table needs a CREATE TABLE in both files.  Tables introduced
  // after the initial deploy typically only have a CREATE TABLE in schemaGuard
  // and ALTER TABLE ADD COLUMN lines in db-migrate.  The cross-file check must
  // not flag these — it only applies to tables present in BOTH files.
  test("exits 0 when a table has a CREATE TABLE in only one guard file (not a cross-file scenario)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sgcd-cf4-"));
    fixtures.push({ dir });

    // ── Schema dir ────────────────────────────────────────────────────────
    const schemaDir = path.join(dir, "schema");
    fs.mkdirSync(schemaDir, { recursive: true });
    fs.writeFileSync(
      path.join(schemaDir, "index.ts"),
      `export * from "./fixture_table";\n`,
    );
    fs.writeFileSync(
      path.join(schemaDir, "fixture_table.ts"),
      [
        `import { pgTable, text, serial } from "drizzle-orm/pg-core";`,
        `export const fixtureTable = pgTable("fixture_table", {`,
        `  id: serial("id").primaryKey(),`,
        `  name: text("name"),`,
        `});`,
      ].join("\n") + "\n",
    );

    // schemaGuard has the CREATE TABLE
    const guardFile = path.join(dir, "guard.ts");
    fs.writeFileSync(
      guardFile,
      [
        `CREATE TABLE IF NOT EXISTS fixture_table (`,
        `  id SERIAL PRIMARY KEY,`,
        `  name TEXT,`,
        `);`,
      ].join("\n") + "\n",
    );

    // db-migrate has only an ALTER TABLE ADD COLUMN (no CREATE TABLE for this table)
    const migrateFile = path.join(dir, "migrate.ts");
    fs.writeFileSync(
      migrateFile,
      `-- no CREATE TABLE here, only extensions\n` +
        `ALTER TABLE fixture_table ADD COLUMN IF NOT EXISTS name TEXT;\n`,
    );

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      SGCD_SCHEMA_DIR: schemaDir,
      SGCD_SCHEMA_INDEX: path.join(schemaDir, "index.ts"),
      SGCD_GUARD_FILE: guardFile,
      SGCD_MIGRATE_FILE: migrateFile,
    };

    const code = runScript(env);
    assert.equal(
      code,
      0,
      "script must exit 0 when the table only has a CREATE TABLE in schemaGuard — no cross-file check applies",
    );
  });

  // ── Deploy-window gap check ──────────────────────────────────────────────
  //
  // A table whose CREATE TABLE guard exists only in schemaGuard.ts (absent from
  // db-migrate.ts) and has no Drizzle pgTable is a deploy-window gap: on a
  // fresh VPS deploy, db-migrate runs BEFORE the server starts, so the table
  // won't exist until schemaGuard runs at server startup — causing 502s during
  // that window.

  /**
   * Build a fixture where schemaGuard.ts has a CREATE TABLE for a
   * schemaGuard-only table but db-migrate.ts does NOT.  Used to exercise the
   * deploy-window gap check specifically.  A manifest is written so the
   * unregistered-table check does not also fire.
   */
  function buildDeployWindowFixture(opts: {
    inMigrate: boolean;
  }): { dir: string; env: NodeJS.ProcessEnv } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sgcd-deploywin-"));

    // Empty Drizzle schema — the table is schemaGuard-only.
    const schemaDir = path.join(dir, "schema");
    fs.mkdirSync(schemaDir, { recursive: true });
    fs.writeFileSync(path.join(schemaDir, "index.ts"), `// no tables\n`);

    // schemaGuard.ts: CREATE TABLE for deploy_gap_table
    const guardFile = path.join(dir, "guard.ts");
    fs.writeFileSync(
      guardFile,
      [
        `-- schemaGuard deploy-window fixture`,
        `CREATE TABLE IF NOT EXISTS deploy_gap_table (`,
        `  id SERIAL PRIMARY KEY,`,
        `  ref_code TEXT,`,
        `);`,
      ].join("\n") + "\n",
    );

    // db-migrate.ts: optionally also has CREATE TABLE
    const migrateFile = path.join(dir, "migrate.ts");
    if (opts.inMigrate) {
      fs.writeFileSync(
        migrateFile,
        [
          `-- db-migrate deploy-window fixture`,
          `CREATE TABLE IF NOT EXISTS deploy_gap_table (`,
          `  id SERIAL PRIMARY KEY,`,
          `  ref_code TEXT,`,
          `);`,
        ].join("\n") + "\n",
      );
    } else {
      fs.writeFileSync(migrateFile, `-- empty\n`);
    }

    // Manifest: register deploy_gap_table so the unregistered-table check passes.
    const manifestFile = path.join(dir, "manifest.json");
    fs.writeFileSync(
      manifestFile,
      JSON.stringify({
        _readme: "deploy-window fixture manifest",
        deploy_gap_table: ["id", "ref_code"],
      }),
    );

    return {
      dir,
      env: {
        ...process.env,
        SGCD_SCHEMA_DIR: schemaDir,
        SGCD_SCHEMA_INDEX: path.join(schemaDir, "index.ts"),
        SGCD_GUARD_FILE: guardFile,
        SGCD_MIGRATE_FILE: migrateFile,
        SGCD_MANIFEST_FILE: manifestFile,
      },
    };
  }

  // Case DW-1: schemaGuard-only table in schemaGuard but not migrate → exit 1
  test("exits 1 when a schemaGuard-only table has CREATE TABLE in schemaGuard.ts but not in db-migrate.ts (deploy-window gap)", () => {
    const { dir, env } = buildDeployWindowFixture({ inMigrate: false });
    fixtures.push({ dir });

    const { code, stdout, stderr } = runScriptFull(env);
    assert.equal(
      code,
      1,
      "script must exit 1 when a schemaGuard-only table's CREATE TABLE is absent from db-migrate.ts",
    );
    const output = stdout + stderr;
    assert.ok(
      output.includes("deploy_gap_table"),
      `output must name the offending table; got:\n${output}`,
    );
    assert.ok(
      output.includes("db-migrate"),
      `output must mention db-migrate.ts; got:\n${output}`,
    );
  });

  // Case DW-2: schemaGuard-only table present in BOTH guard files → exit 0
  test("exits 0 when a schemaGuard-only table has CREATE TABLE in both schemaGuard.ts and db-migrate.ts", () => {
    const { dir, env } = buildDeployWindowFixture({ inMigrate: true });
    fixtures.push({ dir });

    const code = runScript(env);
    assert.equal(
      code,
      0,
      "script must exit 0 when the schemaGuard-only table is covered by a CREATE TABLE in both guard files",
    );
  });

  // Case DW-3: Drizzle-tracked table in schemaGuard only → exit 0 (excluded from check)
  test("exits 0 when a Drizzle-tracked table has CREATE TABLE only in schemaGuard.ts (Drizzle tables are excluded from the deploy-window check)", () => {
    // buildFixtures creates a Drizzle-tracked table with CREATE TABLE only in
    // the guard file and an empty migrate file.  The deploy-window check must
    // not flag this because Drizzle-tracked tables are managed by drizzle-kit.
    const { dir, env } = buildFixtures({
      schemaColumns: ["name"],
      guardColumns: ["name"],
    });
    fixtures.push({ dir });

    const code = runScript(env);
    assert.equal(
      code,
      0,
      "script must exit 0 when the table with CREATE TABLE only in schemaGuard.ts is tracked by Drizzle",
    );
  });

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
