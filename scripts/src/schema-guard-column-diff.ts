/**
 * schema-guard-column-diff.ts
 *
 * Deep audit: for every pgTable() in lib/db/src/schema/, check that every
 * column is covered by either:
 *   (A) The CREATE TABLE IF NOT EXISTS body in schemaGuard.ts / db-migrate.ts, OR
 *   (B) An ALTER TABLE <table> ADD COLUMN IF NOT EXISTS <col> line in either file.
 *
 * A column missing from BOTH is a live hazard: on a fresh DB the CREATE TABLE
 * builds the table, but the column is absent — any SELECT * or named column
 * reference throws "column does not exist" → HTTP 500.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run schema-guard-column-diff
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

// Path overrides: set these env vars to point the script at fixture directories
// during automated negative-case testing. Production runs leave them unset.
const SCHEMA_DIR =
  process.env.SGCD_SCHEMA_DIR ?? path.join(ROOT, "lib/db/src/schema");
const SCHEMA_INDEX =
  process.env.SGCD_SCHEMA_INDEX ?? path.join(SCHEMA_DIR, "index.ts");
const SCHEMA_GUARD_FILE =
  process.env.SGCD_GUARD_FILE ??
  path.join(ROOT, "artifacts/api-server/src/lib/schemaGuard.ts");
const DB_MIGRATE_FILE =
  process.env.SGCD_MIGRATE_FILE ??
  path.join(ROOT, "scripts/src/db-migrate.ts");

// No tables are skipped. The four IAM tables (permissions, role_permissions,
// user_permissions, iam_migration_log) are delegated to the canonical
// lib/db/src/migrations/add-iam-rbac.ts file via schemaGuard's `await up(db)`
// call, but their CREATE TABLE bodies are also present in scripts/src/db-migrate.ts,
// which collectAllGuardedColumns() scans. They will therefore appear in the guarded
// set and pass the diff without any special-casing here.

// ---------------------------------------------------------------------------
// Parse Drizzle schema: extract table name → list of SQL column names
// ---------------------------------------------------------------------------

/**
 * Drizzle column definitions look like:
 *   columnName: dataType("sql_col_name", ...)
 *   or just: columnName: dataType("sql_col_name")
 * We want the SQL column name (the first string arg to the data-type function).
 * If no explicit SQL name is given, Drizzle uses the camelCase key converted
 * to snake_case. We handle both cases.
 */
function camelToSnake(s: string): string {
  return s.replace(/([A-Z])/g, (m) => `_${m.toLowerCase()}`);
}

/**
 * Walk `source` starting at `startIndex` (which must point at an opening `{`)
 * and return the text of the balanced body — i.e. everything between the
 * outermost `{` and its matching `}`, exclusive of both braces.
 *
 * This correctly handles any depth of nested `{...}` and is not fooled by
 * `}` characters inside string literals that appear on the same line
 * (Drizzle column definitions always keep string args on one line).
 */
export function extractBalancedBody(source: string, startIndex: number): string {
  let depth = 1;
  let i = startIndex + 1; // step past the opening `{`
  const bodyStart = i;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) break;
    }
    i++;
  }
  return source.slice(bodyStart, i);
}

export function extractDrizzleColumns(tableSource: string): Map<string, string[]> {
  // Map from SQL table name → [sql column names]
  const result = new Map<string, string[]>();

  // Locate each pgTable("sql_name", { … }) header.
  // We only need the table name and the position of the opening `{` of the
  // column-definition object; we then use extractBalancedBody() to get the
  // full body, which handles arbitrarily-deep nested braces correctly.
  const headerRe = /\bpgTable\s*\(\s*["']([^"']+)["']\s*,\s*\{/gs;
  let tm: RegExpExecArray | null;

  while ((tm = headerRe.exec(tableSource)) !== null) {
    const sqlTableName = tm[1];
    // tm.index + tm[0].length - 1  is the position of the `{` that opened
    // the column object (the last char of tm[0] is `{`).
    const openBraceIndex = tm.index + tm[0].length - 1;
    const body = extractBalancedBody(tableSource, openBraceIndex);

    const cols: string[] = [];

    // Each line in the body is:  propName: someType("sql_col_name", ...)
    // or                         propName: someType().  ← implicit name
    const lineRe = /^\s*([\w$]+)\s*:/gm;
    let lm: RegExpExecArray | null;

    while ((lm = lineRe.exec(body)) !== null) {
      const propName = lm[1];
      if (propName === "id") {
        // id is almost always serial primary key, included universally
        cols.push("id");
        continue;
      }

      // Find explicit SQL name: look for the first string literal after the colon
      // in the rest of that "line" (up to the next property or end of body).
      const afterColon = body.slice(lm.index + lm[0].length);
      // First string arg: ("sql_name" or 'sql_name'
      const explicitName = /\(\s*["']([^"']+)["']/.exec(afterColon);
      if (explicitName) {
        cols.push(explicitName[1]);
      } else {
        // Implicit: use snake_case of the JS property name
        cols.push(camelToSnake(propName));
      }
    }

    result.set(sqlTableName, cols);
  }

  return result;
}

function collectDrizzleSchema(): Map<string, string[]> {
  const indexSource = fs.readFileSync(SCHEMA_INDEX, "utf8");
  const exportRe = /export\s+\*\s+from\s+["']\.\/([^"']+)["']/g;
  const moduleNames: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = exportRe.exec(indexSource)) !== null) {
    moduleNames.push(m[1]);
  }

  const all = new Map<string, string[]>();
  for (const mod of moduleNames) {
    let filePath = path.join(SCHEMA_DIR, `${mod}.ts`);
    if (!fs.existsSync(filePath)) filePath = path.join(SCHEMA_DIR, `${mod}.tsx`);
    if (!fs.existsSync(filePath)) continue;
    const src = fs.readFileSync(filePath, "utf8");
    for (const [tbl, cols] of extractDrizzleColumns(src)) {
      const existing = all.get(tbl) ?? [];
      all.set(tbl, [...new Set([...existing, ...cols])]);
    }
  }
  return all;
}

// ---------------------------------------------------------------------------
// Parse guard files: extract CREATE TABLE bodies + ALTER TABLE ADD COLUMN
// ---------------------------------------------------------------------------

/**
 * Returns: Map<tableName, Set<columnName>> of columns known to be guarded.
 * A column is "guarded" if it appears in either:
 *   • A CREATE TABLE IF NOT EXISTS <table> ( ... ) block
 *   • An ALTER TABLE <table> ADD COLUMN IF NOT EXISTS <col>
 */
function collectGuardedColumns(source: string): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();

  function ensure(t: string): Set<string> {
    const k = t.toLowerCase();
    if (!result.has(k)) result.set(k, new Set());
    return result.get(k)!;
  }

  // ── ALTER TABLE <table> ADD COLUMN IF NOT EXISTS <col> ──────────────────
  const alterRe = /ALTER\s+TABLE\s+["']?(\w+)["']?\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+"?(\w+)"?/gi;
  let am: RegExpExecArray | null;
  while ((am = alterRe.exec(source)) !== null) {
    ensure(am[1]).add(am[2].toLowerCase());
  }

  // ── CREATE TABLE IF NOT EXISTS <table> ( ... ) ───────────────────────────
  // We need to extract the column list from the parenthesised body.
  // Strategy: find each CREATE TABLE IF NOT EXISTS, then scan forward to
  // collect the balanced parentheses block.
  const ctRe = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+"?(\w+)"?\s*\(/gi;
  let ctm: RegExpExecArray | null;

  while ((ctm = ctRe.exec(source)) !== null) {
    const tableName = ctm[1].toLowerCase();
    // ctm.index + ctm[0].length is the position just after the opening '('
    let depth = 1;
    let i = ctm.index + ctm[0].length;
    let body = "";
    while (i < source.length && depth > 0) {
      const ch = source[i];
      if (ch === "(") depth++;
      else if (ch === ")") { depth--; if (depth === 0) break; }
      body += ch;
      i++;
    }

    // Parse column names from the body.
    // Each column definition line starts with the column name (an identifier),
    // possibly preceded by whitespace.  CONSTRAINT lines start with CONSTRAINT
    // and should be skipped.
    const lines = body.split("\n");
    const set = ensure(tableName);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // Skip CONSTRAINT, PRIMARY KEY, UNIQUE, FOREIGN KEY, CHECK lines.
      // Use (\s|$) after the keyword so "checked_at" is not misidentified as
      // a CHECK constraint (case-insensitive match would make it so otherwise).
      if (/^(CONSTRAINT|PRIMARY|UNIQUE|FOREIGN|CHECK)(\s|$)/i.test(trimmed)) continue;
      // First token is the column name (possibly quoted)
      const nameMatch = /^"?(\w+)"?\s+/i.exec(trimmed);
      if (nameMatch) {
        set.add(nameMatch[1].toLowerCase());
      }
    }
  }

  return result;
}

function collectAllGuardedColumns(): Map<string, Set<string>> {
  const combined = new Map<string, Set<string>>();

  function merge(src: Map<string, Set<string>>): void {
    for (const [table, cols] of src) {
      const existing = combined.get(table) ?? new Set<string>();
      for (const c of cols) existing.add(c);
      combined.set(table, existing);
    }
  }

  for (const file of [SCHEMA_GUARD_FILE, DB_MIGRATE_FILE]) {
    if (!fs.existsSync(file)) continue;
    merge(collectGuardedColumns(fs.readFileSync(file, "utf8")));
  }

  return combined;
}

/**
 * Returns: Map<tableName, Set<columnName>> of columns defined in CREATE TABLE
 * bodies only — ALTER TABLE ADD COLUMN lines are intentionally excluded.
 *
 * This is used by the reverse check to validate ALTER TABLE ADD COLUMN claims
 * for tables that are entirely schemaGuard-owned (not tracked by Drizzle):
 * an ALTER TABLE claim for a column that never appears in the corresponding
 * CREATE TABLE body is a no-op guard that silently masks drift.
 */
export function collectCreateTableColumns(source: string): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();

  const ctRe = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+"?(\w+)"?\s*\(/gi;
  let ctm: RegExpExecArray | null;

  while ((ctm = ctRe.exec(source)) !== null) {
    const tableName = ctm[1].toLowerCase();
    let depth = 1;
    let i = ctm.index + ctm[0].length;
    let body = "";
    while (i < source.length && depth > 0) {
      const ch = source[i];
      if (ch === "(") depth++;
      else if (ch === ")") { depth--; if (depth === 0) break; }
      body += ch;
      i++;
    }

    const set = result.get(tableName) ?? new Set<string>();
    for (const line of body.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (/^(CONSTRAINT|PRIMARY|UNIQUE|FOREIGN|CHECK)(\s|$)/i.test(trimmed)) continue;
      const nameMatch = /^"?(\w+)"?\s+/i.exec(trimmed);
      if (nameMatch) {
        set.add(nameMatch[1].toLowerCase());
      }
    }
    result.set(tableName, set);
  }

  return result;
}
/**
 * Returns every ALTER TABLE <table> DROP COLUMN [IF EXISTS] <col> claim found
 * in the source text, preserving the 1-based line number of the match and
 * whether the IF EXISTS guard was present.
 *
 * Both variants are matched:
 *   • ALTER TABLE t DROP COLUMN IF EXISTS col  (safe variant)
 *   • ALTER TABLE t DROP COLUMN col            (unsafe variant — no IF EXISTS)
 *
 * The regex is applied over the FULL source (not line-by-line) so that
 * multiline ALTER TABLE statements are also captured.
 */
export function collectAlterTableDropClaims(
  source: string
): Array<{ table: string; col: string; lineNo: number; hasIfExists: boolean }> {
  const claims: Array<{ table: string; col: string; lineNo: number; hasIfExists: boolean }> = [];

  // (?:IF\s+EXISTS\s+)? makes the IF EXISTS clause optional so that bare
  // DROP COLUMN <col> statements are also captured.
  // \s+ between tokens allows the regex to span line breaks.
  // Flags: g = find all matches, i = case-insensitive.
  const dropRe =
    /ALTER\s+TABLE\s+["']?(\w+)["']?\s+DROP\s+COLUMN\s+(IF\s+EXISTS\s+)?"?(\w+)"?/gi;

  let m: RegExpExecArray | null;
  while ((m = dropRe.exec(source)) !== null) {
    // Derive the 1-based line number from the byte offset of the match.
    const lineNo = source.slice(0, m.index).split("\n").length;
    claims.push({
      table: m[1].toLowerCase(),
      col: m[3].toLowerCase(),
      lineNo,
      hasIfExists: m[2] !== undefined,
    });
  }
  return claims;
}

/**
 * Returns every ALTER TABLE <table> ADD COLUMN IF NOT EXISTS <col> claim found
 * in the source text, preserving the 1-based line number of the match for
 * diagnostics.
 *
 * The regex is applied over the FULL source (not line-by-line) so that
 * multiline ALTER TABLE statements — where the table name and ADD COLUMN
 * clause span two or more lines — are also captured.
 */
export function collectAlterTableClaims(
  source: string
): Array<{ table: string; col: string; lineNo: number }> {
  const claims: Array<{ table: string; col: string; lineNo: number }> = [];

  // \s+ between tokens allows the regex to span line breaks.
  // Flags: g = find all matches, i = case-insensitive.
  const alterRe =
    /ALTER\s+TABLE\s+["']?(\w+)["']?\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+"?(\w+)"?/gi;

  let m: RegExpExecArray | null;
  while ((m = alterRe.exec(source)) !== null) {
    // Derive the 1-based line number from the byte offset of the match.
    const lineNo = source.slice(0, m.index).split("\n").length;
    claims.push({
      table: m[1].toLowerCase(),
      col: m[2].toLowerCase(),
      lineNo,
    });
  }
  return claims;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const drizzle = collectDrizzleSchema();
  const guarded = collectAllGuardedColumns();
  // Columns defined in CREATE TABLE bodies across both guard files.
  // Used by the reverse check to validate ALTER TABLE claims on
  // schemaGuard-only tables (tables not tracked by Drizzle).
  const createTableCols = collectAllCreateTableColumns();

  // ── Forward check: every Drizzle column must be covered by a guard ──────
  console.log(`schema-guard-column-diff: checking ${drizzle.size} tables...\n`);

  const gaps: Array<{ table: string; missing: string[] }> = [];

  for (const [table, drizzleCols] of drizzle) {
    const guardedCols = guarded.get(table) ?? new Set<string>();
    const missing = drizzleCols.filter(
      (c) => !guardedCols.has(c.toLowerCase())
    );

    if (missing.length > 0) {
      gaps.push({ table, missing });
    }
  }

  let forwardOk = true;
  if (gaps.length === 0) {
    console.log(
      "✓ All Drizzle columns are covered by schemaGuard CREATE TABLE or ALTER TABLE guards."
    );
  } else {
    forwardOk = false;
    console.error(
      `✗ Found ${gaps.length} table(s) with columns missing from guards:\n`
    );
    for (const { table, missing } of gaps.sort((a, b) =>
      a.table.localeCompare(b.table)
    )) {
      console.error(`  ${table}:`);
      for (const col of missing) {
        console.error(`    • ${col}`);
      }
      console.error();
    }
  }

  // ── Reverse check: every ALTER TABLE ADD COLUMN claim must be real ────────
  //
  // Catches typo'd or deleted column names in schemaGuard.ts / db-migrate.ts
  // that silently become no-ops on production.
  //
  // Two cases are covered:
  //   1. Drizzle-tracked tables: the column must exist in the Drizzle schema.
  //   2. schemaGuard-only tables (no Drizzle pgTable): the column must appear
  //      in the corresponding CREATE TABLE body in schemaGuard.ts or
  //      db-migrate.ts.  An ALTER TABLE claim for a column absent from both is
  //      a no-op guard that silently masks drift just as badly.

  console.log(
    "\nschema-guard-alter-reverse-check: verifying ALTER TABLE ADD COLUMN claims...\n"
  );

  const stale: Array<{
    file: string;
    table: string;
    col: string;
    lineNo: number;
  }> = [];

  const filesToCheck: [string, string][] = [
    [SCHEMA_GUARD_FILE, "schemaGuard.ts"],
    [DB_MIGRATE_FILE, "db-migrate.ts"],
  ];

  // Pre-build a lowercase lookup map for fast column membership tests.
  const drizzleLower = new Map<string, Set<string>>();
  for (const [table, cols] of drizzle) {
    drizzleLower.set(
      table.toLowerCase(),
      new Set(cols.map((c) => c.toLowerCase()))
    );
  }

  for (const [filePath, label] of filesToCheck) {
    if (!fs.existsSync(filePath)) continue;
    const source = fs.readFileSync(filePath, "utf8");
    const claims = collectAlterTableClaims(source);

    for (const { table, col, lineNo } of claims) {
      const drizzleCols = drizzleLower.get(table);
      if (!drizzleCols) {
        // Table not tracked by Drizzle — schemaGuard owns it entirely.
        // Validate the column against the CREATE TABLE body in the guard files.
        const ctCols = createTableCols.get(table);
        if (!ctCols || !ctCols.has(col)) {
          stale.push({ file: label, table, col, lineNo });
        }
        continue;
      }
      if (!drizzleCols.has(col)) {
        stale.push({ file: label, table, col, lineNo });
      }
    }
  }

  let reverseOk = true;
  if (stale.length === 0) {
    console.log(
      "✓ All ALTER TABLE ADD COLUMN IF NOT EXISTS claims reference real columns\n" +
        "  (Drizzle schema for Drizzle-tracked tables; CREATE TABLE body for schemaGuard-only tables)."
    );
  } else {
    reverseOk = false;
    console.error(
      `✗ Found ${stale.length} ALTER TABLE claim(s) referencing a column that does not exist:\n`
    );
    console.error(
      "  These are stale or typo'd guards that execute as no-ops on production,\n" +
        "  masking column drift. Fix the column name or remove the ALTER TABLE line.\n" +
        "  • For Drizzle-tracked tables: the column must appear in the Drizzle schema.\n" +
        "  • For schemaGuard-only tables: the column must appear in the CREATE TABLE body\n" +
        "    in schemaGuard.ts or db-migrate.ts.\n"
    );
    for (const { file, table, col, lineNo } of stale) {
      console.error(`  ${file}:${lineNo}  ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${col}  ← not found in schema or CREATE TABLE body`);
    }
    console.error();
  }

  // ── Drop check: no DROP COLUMN guard may name a column still in the schema ─
  //
  // An ALTER TABLE … DROP COLUMN IF EXISTS line whose column still exists in
  // the Drizzle schema (or in the CREATE TABLE body for schemaGuard-only
  // tables) will silently delete a live column on the next deploy or fresh-DB
  // startup, producing "column does not exist" runtime errors.
  //
  // Two cases are covered:
  //   1. Drizzle-tracked tables: the column must NOT exist in the Drizzle schema.
  //   2. schemaGuard-only tables: the column must NOT appear in the CREATE TABLE
  //      body in schemaGuard.ts or db-migrate.ts.

  console.log(
    "\nschema-guard-drop-column-check: verifying ALTER TABLE DROP COLUMN claims...\n"
  );

  const liveDrop: Array<{
    file: string;
    table: string;
    col: string;
    lineNo: number;
    hasIfExists: boolean;
  }> = [];

  for (const [filePath, label] of filesToCheck) {
    if (!fs.existsSync(filePath)) continue;
    const source = fs.readFileSync(filePath, "utf8");
    const drops = collectAlterTableDropClaims(source);

    for (const { table, col, lineNo, hasIfExists } of drops) {
      const drizzleCols = drizzleLower.get(table);
      if (!drizzleCols) {
        // schemaGuard-only table — check CREATE TABLE body.
        const ctCols = createTableCols.get(table);
        if (ctCols && ctCols.has(col)) {
          liveDrop.push({ file: label, table, col, lineNo, hasIfExists });
        }
        continue;
      }
      // Drizzle-tracked table — the column must no longer be in the schema.
      if (drizzleCols.has(col)) {
        liveDrop.push({ file: label, table, col, lineNo, hasIfExists });
      }
    }
  }

  let dropOk = true;
  if (liveDrop.length === 0) {
    console.log(
      "✓ All ALTER TABLE DROP COLUMN [IF EXISTS] guards name columns that are no longer\n" +
        "  in the Drizzle schema (or CREATE TABLE body for schemaGuard-only tables)."
    );
  } else {
    dropOk = false;
    console.error(
      `✗ Found ${liveDrop.length} DROP COLUMN guard(s) targeting a column that is still live:\n`
    );
    console.error(
      "  These guards will silently delete a live column on the next deploy or\n" +
        "  fresh-DB startup, causing runtime 'column does not exist' errors.\n" +
        "  Remove the DROP COLUMN line, or first remove the column from the Drizzle\n" +
        "  schema (and the CREATE TABLE body for schemaGuard-only tables).\n" +
        "  • For Drizzle-tracked tables: the column must be absent from the Drizzle schema.\n" +
        "  • For schemaGuard-only tables: the column must be absent from the CREATE TABLE body\n" +
        "    in schemaGuard.ts or db-migrate.ts.\n" +
        "  • Bare DROP COLUMN (without IF EXISTS) is also flagged — add IF EXISTS or remove\n" +
        "    the column from the schema first.\n"
    );
    for (const { file, table, col, lineNo, hasIfExists } of liveDrop) {
      const dropClause = hasIfExists
        ? `DROP COLUMN IF EXISTS ${col}`
        : `DROP COLUMN ${col}`;
      console.error(
        `  ${file}:${lineNo}  ALTER TABLE ${table} ${dropClause}  ← column is still live in the schema`
      );
    }
    console.error();
  }

  if (!forwardOk || !reverseOk || !dropOk) {
    process.exit(1);
  }
}

// Only run main() when this file is executed directly, not when imported by
// a test or another module.
const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main();
}

function collectAllCreateTableColumns(): Map<string, Set<string>> {
  const combined = new Map<string, Set<string>>();

  for (const file of [SCHEMA_GUARD_FILE, DB_MIGRATE_FILE]) {
    if (!fs.existsSync(file)) continue;
    for (const [table, cols] of collectCreateTableColumns(fs.readFileSync(file, "utf8"))) {
      const existing = combined.get(table) ?? new Set<string>();
      for (const c of cols) existing.add(c);
      combined.set(table, existing);
    }
  }

  return combined;
}
