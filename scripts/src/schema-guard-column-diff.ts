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

const SCHEMA_DIR = path.join(ROOT, "lib/db/src/schema");
const SCHEMA_INDEX = path.join(SCHEMA_DIR, "index.ts");
const SCHEMA_GUARD_FILE = path.join(ROOT, "artifacts/api-server/src/lib/schemaGuard.ts");
const DB_MIGRATE_FILE = path.join(ROOT, "scripts/src/db-migrate.ts");

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

// ---------------------------------------------------------------------------
// Reverse check: parse ALTER TABLE ADD COLUMN claims from a guard file
// ---------------------------------------------------------------------------

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

  // ── Reverse check: every ALTER TABLE ADD COLUMN claim must match Drizzle ─
  //
  // Catches typo'd or deleted column names in schemaGuard.ts / db-migrate.ts
  // that silently become no-ops on production (the column name doesn't exist
  // in the Drizzle schema any more, so the guard column never gets applied).
  //
  // Scope: only flag claims where the *table* IS known to Drizzle but the
  // *column* is NOT — tables that Drizzle doesn't track at all are legitimately
  // owned by schemaGuard and are skipped.

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
        // Table not tracked by Drizzle — schemaGuard owns it entirely; skip.
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
      "✓ All ALTER TABLE ADD COLUMN IF NOT EXISTS claims reference real Drizzle columns."
    );
  } else {
    reverseOk = false;
    console.error(
      `✗ Found ${stale.length} ALTER TABLE claim(s) that do not match any Drizzle column:\n`
    );
    console.error(
      "  These are stale or typo'd guards that execute as no-ops on production,\n" +
        "  masking column drift. Fix the column name or remove the ALTER TABLE line.\n"
    );
    for (const { file, table, col, lineNo } of stale) {
      console.error(`  ${file}:${lineNo}  ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${col}  ← not in Drizzle schema`);
    }
    console.error();
  }

  if (!forwardOk || !reverseOk) {
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
