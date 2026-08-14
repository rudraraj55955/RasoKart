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

/**
 * Path to the schemaGuard-only columns manifest file.
 * The manifest is a JSON object whose keys are SQL table names and whose values
 * are arrays of expected column names.  Keys starting with `_` are metadata
 * (e.g. `_readme`) and are ignored by the script.
 *
 * Override via SGCD_MANIFEST_FILE for automated negative-case testing.
 */
const MANIFEST_FILE =
  process.env.SGCD_MANIFEST_FILE ??
  path.join(__dirname, "schema-guard-only-columns.json");
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
 * Returns: Map<tableName, Map<columnName, dataType>> where dataType is the
 * first SQL keyword token that follows the column name in each CREATE TABLE
 * column definition line.
 *
 * For example, `amount NUMERIC NOT NULL` yields dataType = "NUMERIC".
 * `status TEXT DEFAULT 'pending'` yields dataType = "TEXT".
 *
 * This is used by the cross-file type-consistency check to detect cases where
 * a developer changed TEXT → NUMERIC (or any other type change) in one guard
 * file but left the old type in the other, which causes Drizzle to cast the
 * column incorrectly on existing DBs — producing silent data corruption or
 * cast errors at runtime.
 */
export function collectCreateTableColumnTypes(
  source: string
): Map<string, Map<string, string>> {
  const result = new Map<string, Map<string, string>>();

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

    const typeMap = result.get(tableName) ?? new Map<string, string>();
    for (const line of body.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // Skip CONSTRAINT, PRIMARY KEY, UNIQUE, FOREIGN KEY, CHECK lines.
      if (/^(CONSTRAINT|PRIMARY|UNIQUE|FOREIGN|CHECK)(\s|$)/i.test(trimmed)) continue;
      // Match: col_name TYPE ... or "col_name" TYPE ...
      // The first token is the column name, the second is the data type.
      const nameTypeMatch = /^"?(\w+)"?\s+(\w+)/i.exec(trimmed);
      if (nameTypeMatch) {
        const colName = nameTypeMatch[1].toLowerCase();
        const dataType = nameTypeMatch[2].toUpperCase();
        typeMap.set(colName, dataType);
      }
    }
    result.set(tableName, typeMap);
  }

  return result;
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
  // An ALTER TABLE … DROP COLUMN [IF EXISTS] line whose column still exists in
  // the Drizzle schema (or in the CREATE TABLE body or ALTER TABLE ADD COLUMN
  // for schemaGuard-only tables) will silently delete a live column on the next
  // deploy or fresh-DB startup, producing "column does not exist" runtime errors.
  //
  // Three cases are covered:
  //   1. Drizzle-tracked tables: the column must NOT exist in the Drizzle schema.
  //   2. Drizzle-tracked tables (rename footgun): the column is absent from Drizzle
  //      but still in the guard's own CREATE TABLE body — a self-canceling
  //      CREATE+DROP pair on a fresh DB indicating an incomplete rename.
  //   3. schemaGuard-only tables: the column must NOT appear in the combined
  //      guarded set (CREATE TABLE body ∪ ALTER TABLE ADD COLUMN) across
  //      schemaGuard.ts and db-migrate.ts.

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

  // Bare DROP COLUMN (no IF EXISTS) on a column that is already absent from
  // the schema.  Not a hard failure — the column is gone — but the statement
  // will throw "column does not exist" on any DB where the column was removed
  // by a different migration path.  Emit a warning so the developer knows to
  // add IF EXISTS for idempotency.
  const bareDropWarnings: Array<{
    file: string;
    table: string;
    col: string;
    lineNo: number;
  }> = [];

  // DROP COLUMN claims whose table name does not appear in the Drizzle schema
  // OR in any CREATE TABLE body in schemaGuard.ts / db-migrate.ts.  A typo'd
  // table name will never match any live column and will silently execute as a
  // no-op (or worse, throw "table does not exist" at runtime).
  const unknownTableDrops: Array<{
    file: string;
    table: string;
    col: string;
    lineNo: number;
  }> = [];

  for (const [filePath, label] of filesToCheck) {
    if (!fs.existsSync(filePath)) continue;
    const source = fs.readFileSync(filePath, "utf8");
    const drops = collectAlterTableDropClaims(source);

    for (const { table, col, lineNo, hasIfExists } of drops) {
      // ── Table-name existence check (new) ────────────────────────────────
      // The table must be known: either tracked by Drizzle OR have a CREATE
      // TABLE body in one of the guard files.  A table that satisfies neither
      // condition is a typo — flag it as a hard error regardless of the column.
      const inDrizzle = drizzleLower.has(table);
      const inCreateTable = createTableCols.has(table);
      if (!inDrizzle && !inCreateTable) {
        unknownTableDrops.push({ file: label, table, col, lineNo });
        continue;
      }

      const drizzleCols = drizzleLower.get(table);
      if (!drizzleCols) {
        // schemaGuard-only table — check CREATE TABLE body AND ALTER TABLE ADD COLUMN.
        // A column is "still live" if it appears in either guard source; using the
        // pre-built `guarded` map (which merges both) covers both cases in one lookup.
        const allGuardedForTable = guarded.get(table);
        if (allGuardedForTable?.has(col)) {
          liveDrop.push({ file: label, table, col, lineNo, hasIfExists });
        } else if (!hasIfExists) {
          // Column already absent from guard sources but no IF EXISTS — warn.
          bareDropWarnings.push({ file: label, table, col, lineNo });
        }
        continue;
      }
      // Drizzle-tracked table — the column must no longer be in the schema.
      if (drizzleCols.has(col)) {
        liveDrop.push({ file: label, table, col, lineNo, hasIfExists });
      } else if (!hasIfExists) {
        // Column already absent from Drizzle schema but no IF EXISTS guard.
        bareDropWarnings.push({ file: label, table, col, lineNo });
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

  // ── Unknown-table DROP error (hard failure) ──────────────────────────────
  //
  // A DROP COLUMN whose table name doesn't exist in the Drizzle schema OR any
  // CREATE TABLE body is almost certainly a typo.  It will never match a live
  // column on a correctly-deployed DB but will silently pass all column-level
  // checks, masking the mistake until runtime.
  if (unknownTableDrops.length > 0) {
    dropOk = false;
    console.error(
      `✗ Found ${unknownTableDrops.length} DROP COLUMN guard(s) referencing a table name that does not exist:\n`
    );
    console.error(
      "  The table name was not found in the Drizzle schema OR in any CREATE TABLE\n" +
        "  body in schemaGuard.ts / db-migrate.ts. This is almost certainly a typo.\n" +
        "  Fix the table name or remove the ALTER TABLE line.\n"
    );
    for (const { file, table, col, lineNo } of unknownTableDrops) {
      console.error(
        `  ${file}:${lineNo}  ALTER TABLE ${table} DROP COLUMN ... ${col}  ← table '${table}' is unknown`
      );
    }
    console.error();
  }

  // ── Bare-DROP warning (non-fatal) ─────────────────────────────────────────
  //
  // A bare DROP COLUMN without IF EXISTS will throw "column does not exist"
  // on any DB where the column was already removed by another migration path,
  // aborting the deploy.  Emit a warning even when the column is already gone
  // from the schema so the developer knows to add IF EXISTS for idempotency.
  if (bareDropWarnings.length > 0) {
    console.log(
      `\n⚠ Found ${bareDropWarnings.length} bare DROP COLUMN statement(s) without IF EXISTS:\n`
    );
    console.log(
      "  The column is already absent from the schema, so this is not a hard\n" +
        "  failure — but the bare DROP COLUMN will throw \"column does not exist\"\n" +
        "  on any database where the column was removed by a different migration\n" +
        "  path, aborting the deploy.  Add IF EXISTS to make the statement\n" +
        "  idempotent:\n" +
        "    ALTER TABLE <table> DROP COLUMN IF EXISTS <col>;\n"
    );
    for (const { file, table, col, lineNo } of bareDropWarnings) {
      console.log(
        `  ${file}:${lineNo}  ALTER TABLE ${table} DROP COLUMN ${col}  ← add IF EXISTS for idempotency`
      );
    }
    console.log();
  }

  // ── Manifest forward check: every manifest column must be in the CREATE TABLE body ─
  //
  // For schemaGuard-only tables (tables with a CREATE TABLE guard but no Drizzle
  // pgTable), the CREATE TABLE body is the sole source of truth for the DB schema.
  // If a developer adds a column to application code without updating the CREATE
  // TABLE body, the column is silently absent on a fresh install, producing
  // "column does not exist" at runtime.
  //
  // The manifest (schema-guard-only-columns.json) lists every column a schemaGuard-
  // only table's application code expects to exist.  This check ensures that the
  // CREATE TABLE body in schemaGuard.ts / db-migrate.ts actually defines all of them.
  //
  // Workflow for developers adding a column to a schemaGuard-only table:
  //   1. Add the column to the CREATE TABLE body in schemaGuard.ts / db-migrate.ts.
  //   2. Add the column name to the table's entry in schema-guard-only-columns.json.
  //   CI fails here if step 1 was done but step 2 was skipped, or vice-versa.

  console.log(
    "\nschema-guard-manifest-check: verifying schemaGuard-only column manifest...\n"
  );

  // Hoist `manifest` so the unregistered-table check below can also use it.
  let manifest = new Map<string, string[]>();
  let manifestOk = true;
  try {
    manifest = collectManifestColumns(MANIFEST_FILE);

    if (manifest.size === 0) {
      console.log(
        "✓ Manifest is empty — no schemaGuard-only tables declared."
      );
    } else {
      const manifestGaps: Array<{ table: string; missing: string[] }> = [];

      for (const [table, expectedCols] of manifest) {
        const ctCols = createTableCols.get(table);
        const missing = expectedCols.filter(
          (c) => !ctCols || !ctCols.has(c)
        );
        if (missing.length > 0) {
          manifestGaps.push({ table, missing });
        }
      }

      if (manifestGaps.length === 0) {
        console.log(
          "✓ All manifest columns are present in the CREATE TABLE body for their table."
        );
      } else {
        manifestOk = false;
        console.error(
          `✗ Found ${manifestGaps.length} schemaGuard-only table(s) whose CREATE TABLE body is missing manifest column(s):\n`
        );
        console.error(
          "  These columns are declared in schema-guard-only-columns.json as expected by\n" +
            "  application code, but are absent from the CREATE TABLE IF NOT EXISTS body in\n" +
            "  schemaGuard.ts / db-migrate.ts.  On a fresh DB the table will be created\n" +
            "  without them, causing 'column does not exist' at runtime.\n" +
            "  Fix: add the missing column(s) to the CREATE TABLE body, or remove them from\n" +
            "  the manifest if they are no longer used by application code.\n"
        );
        for (const { table, missing } of manifestGaps.sort((a, b) =>
          a.table.localeCompare(b.table)
        )) {
          console.error(`  ${table}:`);
          for (const col of missing) {
            console.error(`    • ${col}  ← present in manifest but absent from CREATE TABLE body`);
          }
          console.error();
        }
      }
    }
  } catch (err) {
    manifestOk = false;
    console.error(`✗ Failed to read schema-guard manifest: ${(err as Error).message}`);
  }

  // ── Manifest reverse check: every CREATE TABLE column must be in the manifest ─
  //
  // Complements the forward check above.  If a developer renames a column in the
  // CREATE TABLE body without updating the manifest, the old name stays in the
  // manifest and the forward check passes — the manifest just points to the old
  // (now absent) name, so that check is satisfied.  Meanwhile the new (renamed)
  // column is present in the CREATE TABLE body but absent from the manifest,
  // which this reverse check catches.
  //
  // Together, forward + reverse make the manifest a two-way contract:
  //   • Every manifest column must appear in the CREATE TABLE body (forward).
  //   • Every CREATE TABLE column must appear in the manifest (reverse).

  console.log(
    "\nschema-guard-manifest-reverse-check: verifying CREATE TABLE columns are declared in the manifest...\n"
  );

  let manifestReverseOk = true;
  if (manifest.size === 0) {
    // Manifest is empty — no tables registered, nothing to reverse-check.
    // (The forward check already logged the "empty" or "no tables" message.)
    console.log(
      "✓ Manifest is empty — no schemaGuard-only tables to reverse-check."
    );
  } else {
    const reverseGaps: Array<{ table: string; undeclared: string[] }> = [];

    for (const [table, manifestCols] of manifest) {
      const ctCols = createTableCols.get(table);
      // If there is no CREATE TABLE body for this table, the forward check
      // already reported it as a gap — skip here to avoid double-reporting.
      if (!ctCols) continue;

      const manifestColSet = new Set(manifestCols.map((c) => c.toLowerCase()));
      const undeclared = [...ctCols].filter((c) => !manifestColSet.has(c));
      if (undeclared.length > 0) {
        reverseGaps.push({ table, undeclared });
      }
    }

    if (reverseGaps.length === 0) {
      console.log(
        "✓ All CREATE TABLE columns for manifest-registered tables are declared in the manifest."
      );
    } else {
      manifestReverseOk = false;
      console.error(
        `✗ Found ${reverseGaps.length} schemaGuard-only table(s) with CREATE TABLE column(s) not declared in the manifest:\n`
      );
      console.error(
        "  These columns appear in the CREATE TABLE IF NOT EXISTS body in schemaGuard.ts /\n" +
          "  db-migrate.ts but are absent from schema-guard-only-columns.json.  This\n" +
          "  typically indicates a column was renamed: the old name was left in the manifest\n" +
          "  (so the forward check passes) while the new name went unrecorded.  Update the\n" +
          "  manifest entry to match the current CREATE TABLE body exactly.\n" +
          "  Fix: add the missing column(s) to the table's array in schema-guard-only-columns.json,\n" +
          "  and remove any stale column names that are no longer in the CREATE TABLE body.\n"
      );
      for (const { table, undeclared } of reverseGaps.sort((a, b) =>
        a.table.localeCompare(b.table)
      )) {
        console.error(`  ${table}:`);
        for (const col of undeclared) {
          console.error(`    • ${col}  ← present in CREATE TABLE body but absent from manifest`);
        }
        console.error();
      }
    }
  }

  // ── Unregistered guard-only table check ──────────────────────────────────
  //
  // Detects CREATE TABLE IF NOT EXISTS guards in schemaGuard.ts / db-migrate.ts
  // that have NEITHER a corresponding Drizzle pgTable NOR a manifest entry.
  //
  // Such a table is completely invisible to all other checks:
  //   • The manifest forward check can't audit it — it's not in the manifest.
  //   • The Drizzle forward check can't audit it — there's no Drizzle schema.
  //
  // This means any column drift in that table goes undetected by CI, silently
  // producing "column does not exist" errors on a fresh deploy.
  //
  // Every schemaGuard-only table must be registered in schema-guard-only-columns.json
  // so its columns are validated by the manifest forward check.
  //
  // Workflow for developers adding a new schemaGuard-only table:
  //   1. Add the CREATE TABLE IF NOT EXISTS block to schemaGuard.ts / db-migrate.ts.
  //   2. Add an entry for the table to schema-guard-only-columns.json with every
  //      column the application code expects to exist.
  //   CI fails here if step 2 is skipped.

  console.log(
    "\nschema-guard-unregistered-table-check: verifying all guard-only tables are in the manifest...\n"
  );

  let unregisteredOk = true;
  const manifestTableNames = new Set(manifest.keys());
  const unregistered: string[] = [];

  for (const table of createTableCols.keys()) {
    if (!drizzleLower.has(table) && !manifestTableNames.has(table)) {
      unregistered.push(table);
    }
  }

  if (unregistered.length === 0) {
    console.log(
      "✓ All CREATE TABLE guards for schemaGuard-only tables are registered in the manifest."
    );
  } else {
    unregisteredOk = false;
    console.error(
      `✗ Found ${unregistered.length} schemaGuard-only table(s) with no manifest entry:\n`
    );
    console.error(
      "  These tables have a CREATE TABLE IF NOT EXISTS guard in schemaGuard.ts /\n" +
        "  db-migrate.ts but no corresponding Drizzle pgTable and no entry in\n" +
        "  schema-guard-only-columns.json.  Their columns cannot be audited by CI —\n" +
        "  column drift goes undetected until a 'column does not exist' error at runtime.\n" +
        "  Fix: add an entry for the table to schema-guard-only-columns.json, listing\n" +
        "  every column that application code reads or writes.\n"
    );
    for (const table of unregistered.sort()) {
      console.error(`  ${table}  ← no Drizzle pgTable and no manifest entry`);
    }
    console.error();
  }

  // ── Cross-file consistency check ─────────────────────────────────────────
  //
  // Detects columns that were renamed in one guard file but left under their
  // old name in the other.  Because the forward check merges both files, the
  // old name satisfies the check via db-migrate.ts while the new name satisfies
  // it via schemaGuard.ts — so the combined check always passes even though the
  // two files are out of sync.
  //
  // Strategy: parse each guard file independently and collect the column set
  // from each CREATE TABLE body.  For every table that has a CREATE TABLE block
  // in BOTH files, the two column sets must be identical.  A column present in
  // schemaGuard.ts but absent from db-migrate.ts (or vice-versa) is flagged as
  // a cross-file rename that was not synced.
  //
  // Note: ALTER TABLE ADD COLUMN lines are intentionally excluded.  It is
  // normal and expected to add a column via ALTER in one file only (e.g.
  // as a post-initial-release extension).  Only the base CREATE TABLE body,
  // which is the authoritative table definition, must stay in sync.

  console.log(
    "\nschema-guard-cross-file-check: comparing CREATE TABLE column lists across guard files...\n"
  );

  const crossFileOk = checkCrossFileConsistency();

  // ── Deploy-window gap check ───────────────────────────────────────────────
  //
  // Flags tables that have a CREATE TABLE guard in schemaGuard.ts but NO
  // corresponding CREATE TABLE in db-migrate.ts, AND no Drizzle pgTable entry.
  //
  // On a fresh VPS deploy, db-migrate.ts runs BEFORE the server starts (and
  // therefore before schemaGuard executes).  A table whose CREATE TABLE exists
  // only in schemaGuard.ts will not exist during that window, causing
  // "relation does not exist" 502s until the server fully starts.
  //
  // Drizzle-tracked tables are excluded: they are managed by drizzle-kit push
  // / migrations and their existence is guaranteed through a different path.
  //
  // Every schemaGuard-only table (no Drizzle pgTable) must have a
  // CREATE TABLE IF NOT EXISTS guard in db-migrate.ts so it is created during
  // the pre-startup migration step, not only at server start.

  console.log(
    "\nschema-guard-deploy-window-check: checking for schemaGuard-only tables absent from db-migrate.ts...\n"
  );

  let deployWindowOk = true;

  if (fs.existsSync(SCHEMA_GUARD_FILE) && fs.existsSync(DB_MIGRATE_FILE)) {
    const guardSrc = fs.readFileSync(SCHEMA_GUARD_FILE, "utf8");
    const migrateSrc = fs.readFileSync(DB_MIGRATE_FILE, "utf8");

    const guardCreateTables = collectCreateTableColumns(guardSrc);
    const migrateCreateTables = collectCreateTableColumns(migrateSrc);

    const deployGaps: string[] = [];
    for (const table of guardCreateTables.keys()) {
      // Drizzle-tracked tables are managed by drizzle-kit and are excluded.
      if (drizzleLower.has(table)) continue;
      // Flag tables present in schemaGuard.ts but absent from db-migrate.ts.
      if (!migrateCreateTables.has(table)) {
        deployGaps.push(table);
      }
    }

    if (deployGaps.length === 0) {
      console.log(
        "✓ All schemaGuard-only tables (no Drizzle pgTable) also have a CREATE TABLE guard in db-migrate.ts."
      );
    } else {
      deployWindowOk = false;
      console.error(
        `✗ Found ${deployGaps.length} schemaGuard-only table(s) with no CREATE TABLE in db-migrate.ts:\n`
      );
      console.error(
        "  On a fresh VPS deploy, db-migrate.ts runs BEFORE the server starts (and before\n" +
          "  schemaGuard executes).  These tables will not exist during that window, causing\n" +
          "  'relation does not exist' 502s or startup errors until the server fully initialises.\n" +
          "  Fix: add a CREATE TABLE IF NOT EXISTS block for each table to db-migrate.ts so\n" +
          "  it is created during the pre-startup migration step, not only at server start.\n"
      );
      for (const table of deployGaps.sort()) {
        console.error(
          `  ${table}  ← CREATE TABLE in schemaGuard.ts but absent from db-migrate.ts`
        );
      }
      console.error();
    }
  } else {
    console.log(
      "✓ Deploy-window check skipped — one or both guard files are absent."
    );
  }

  // ── Cross-file type-consistency check ────────────────────────────────────
  //
  // Detects columns shared by schemaGuard.ts and db-migrate.ts CREATE TABLE
  // bodies that have different SQL data types.  A developer who changes
  // TEXT → NUMERIC in schemaGuard.ts but leaves db-migrate.ts with TEXT will
  // produce a type mismatch on existing DBs: Drizzle queries cast the column
  // as NUMERIC but the DB column was created as TEXT, causing silent data
  // corruption or cast errors at runtime.

  console.log(
    "\nschema-guard-cross-file-type-check: comparing CREATE TABLE column types across guard files...\n"
  );

  const crossFileTypeOk = checkCrossFileTypeConsistency();

  if (!forwardOk || !reverseOk || !dropOk || !manifestOk || !manifestReverseOk || !unregisteredOk || !crossFileOk || !deployWindowOk || !crossFileTypeOk) {
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

/**
 * Cross-file consistency check.
 *
 * Parses schemaGuard.ts and db-migrate.ts independently and compares the
 * FULL per-file column coverage (CREATE TABLE ∪ ALTER TABLE ADD COLUMN) for
 * every table that has any guard mention in BOTH files.  A column present in
 * one file's coverage but absent from the other's is flagged as cross-file
 * drift.
 *
 * Using full per-file coverage (not CREATE TABLE-only) correctly handles the
 * common "CREATE TABLE in one file + ALTER TABLE ADD COLUMN in the other"
 * pattern — both files end up covering the same column set, so the check
 * passes.  A genuine rename, where the new column name is absent from one
 * file entirely (neither CREATE TABLE nor ALTER TABLE ADD COLUMN), is still
 * caught because neither mechanism covers it in that file.
 *
 * Returns true (check passed) or false (drift found).
 */
function checkCrossFileConsistency(): boolean {
  const guardExists = fs.existsSync(SCHEMA_GUARD_FILE);
  const migrateExists = fs.existsSync(DB_MIGRATE_FILE);

  if (!guardExists || !migrateExists) {
    console.log(
      "✓ Cross-file check skipped — one or both guard files are absent."
    );
    return true;
  }

  const guardSrc = fs.readFileSync(SCHEMA_GUARD_FILE, "utf8");
  const migrateSrc = fs.readFileSync(DB_MIGRATE_FILE, "utf8");

  // Full per-file coverage: CREATE TABLE ∪ ALTER TABLE ADD COLUMN per table.
  const guardCols = collectGuardedColumns(guardSrc);
  const migrateCols = collectGuardedColumns(migrateSrc);

  // Narrow the comparison to tables that have a CREATE TABLE body in BOTH
  // guard files.  A table with CREATE TABLE in only one file and ALTER TABLE
  // ADD COLUMN extensions in the other is a common, legitimate pattern — the
  // base definition lives in one file while post-deploy expansions live in the
  // other.  We must not flag that pattern.  Cross-file drift only makes sense
  // to audit when both files independently define the table's base schema via
  // CREATE TABLE, because that's where a silent rename is most likely to occur.
  const guardCreateTables = collectCreateTableColumns(guardSrc);
  const migrateCreateTables = collectCreateTableColumns(migrateSrc);
  const commonTables = [...guardCreateTables.keys()].filter((t) =>
    migrateCreateTables.has(t)
  );

  if (commonTables.length === 0) {
    console.log(
      "✓ No tables share a CREATE TABLE block in both guard files — cross-file check not applicable."
    );
    return true;
  }

  const drifts: Array<{
    table: string;
    onlyInGuard: string[];
    onlyInMigrate: string[];
  }> = [];

  for (const table of commonTables) {
    const g = guardCols.get(table)!;
    const m = migrateCols.get(table)!;
    const onlyInGuard = [...g].filter((c) => !m.has(c)).sort();
    const onlyInMigrate = [...m].filter((c) => !g.has(c)).sort();
    if (onlyInGuard.length > 0 || onlyInMigrate.length > 0) {
      drifts.push({ table, onlyInGuard, onlyInMigrate });
    }
  }

  if (drifts.length === 0) {
    console.log(
      `✓ CREATE TABLE column lists match between schemaGuard.ts and db-migrate.ts` +
        ` for all ${commonTables.length} shared table(s).`
    );
    return true;
  }

  console.error(
    `✗ Found ${drifts.length} table(s) where the CREATE TABLE column lists differ between guard files:\n`
  );
  console.error(
    "  This typically indicates a column was renamed in one guard file but not the other.\n" +
      "  Because the forward check merges both files, the old name satisfies it via one file\n" +
      "  while the new name satisfies it via the other — so the rename goes undetected.\n" +
      "  Fix: update the CREATE TABLE body in both schemaGuard.ts and db-migrate.ts so\n" +
      "  they define the same column set for the affected table(s).\n"
  );
  for (const { table, onlyInGuard, onlyInMigrate } of drifts.sort((a, b) =>
    a.table.localeCompare(b.table)
  )) {
    console.error(`  ${table}:`);
    for (const col of onlyInGuard) {
      console.error(`    • ${col}  ← present in schemaGuard.ts (CREATE TABLE or ALTER TABLE) but absent from db-migrate.ts`);
    }
    for (const col of onlyInMigrate) {
      console.error(`    • ${col}  ← present in db-migrate.ts (CREATE TABLE or ALTER TABLE) but absent from schemaGuard.ts`);
    }
    console.error();
  }
  return false;
}

/**
 * Cross-file type-consistency check.
 *
 * Parses schemaGuard.ts and db-migrate.ts independently and compares the
 * data type of every column that appears in the CREATE TABLE body of BOTH
 * files for the same table.  A column whose type differs between the two
 * files is flagged as a hard error.
 *
 * Only CREATE TABLE bodies are examined (ALTER TABLE ADD COLUMN lines are
 * excluded) because the CREATE TABLE body is the authoritative definition
 * for the table's initial schema — the place where a silent type change is
 * most likely to occur.
 *
 * Returns true (check passed) or false (type mismatch found).
 */
function checkCrossFileTypeConsistency(): boolean {
  const guardExists = fs.existsSync(SCHEMA_GUARD_FILE);
  const migrateExists = fs.existsSync(DB_MIGRATE_FILE);

  if (!guardExists || !migrateExists) {
    console.log(
      "✓ Cross-file type check skipped — one or both guard files are absent."
    );
    return true;
  }

  const guardSrc = fs.readFileSync(SCHEMA_GUARD_FILE, "utf8");
  const migrateSrc = fs.readFileSync(DB_MIGRATE_FILE, "utf8");

  // Only check tables that have a CREATE TABLE body in BOTH files.
  const guardCreateTables = collectCreateTableColumns(guardSrc);
  const migrateCreateTables = collectCreateTableColumns(migrateSrc);
  const commonTables = [...guardCreateTables.keys()].filter((t) =>
    migrateCreateTables.has(t)
  );

  if (commonTables.length === 0) {
    console.log(
      "✓ No tables share a CREATE TABLE block in both guard files — cross-file type check not applicable."
    );
    return true;
  }

  const guardTypes = collectCreateTableColumnTypes(guardSrc);
  const migrateTypes = collectCreateTableColumnTypes(migrateSrc);

  const mismatches: Array<{
    table: string;
    col: string;
    guardType: string;
    migrateType: string;
  }> = [];

  for (const table of commonTables) {
    const gt = guardTypes.get(table);
    const mt = migrateTypes.get(table);
    if (!gt || !mt) continue;

    // Compare types only for columns present in BOTH files' CREATE TABLE bodies.
    for (const [col, gType] of gt) {
      const mType = mt.get(col);
      if (mType !== undefined && gType !== mType) {
        mismatches.push({ table, col, guardType: gType, migrateType: mType });
      }
    }
  }

  if (mismatches.length === 0) {
    console.log(
      `✓ Column data types match between schemaGuard.ts and db-migrate.ts` +
        ` for all ${commonTables.length} shared table(s).`
    );
    return true;
  }

  console.error(
    `✗ Found ${mismatches.length} column(s) with mismatched data types between schemaGuard.ts and db-migrate.ts:\n`
  );
  console.error(
    "  A column type mismatch means both guard files define the same column with\n" +
      "  different SQL types.  On an existing DB the column retains the type from\n" +
      "  db-migrate.ts, while Drizzle queries expect the type from schemaGuard.ts —\n" +
      "  causing silent data corruption or cast errors at runtime.\n" +
      "  Fix: update the CREATE TABLE body in both schemaGuard.ts and db-migrate.ts\n" +
      "  so the column type is identical in both files.\n"
  );
  for (const { table, col, guardType, migrateType } of mismatches.sort((a, b) =>
    a.table.localeCompare(b.table) || a.col.localeCompare(b.col)
  )) {
    console.error(
      `  ${table}.${col}: schemaGuard.ts=${guardType}  db-migrate.ts=${migrateType}  ← type mismatch`
    );
  }
  console.error();
  return false;
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

/**
 * Reads the schemaGuard-only columns manifest from `manifestPath` and returns
 * a Map<tableName, string[]> of expected columns.
 *
 * The manifest is a JSON object:
 *   { "table_name": ["col1", "col2", ...], "_readme": "..." }
 *
 * Keys starting with `_` are metadata and are silently skipped.
 * Column names are lowercased for case-insensitive comparison.
 *
 * Returns an empty Map when the file does not exist (production default when
 * no schemaGuard-only tables have been declared yet).
 */
export function collectManifestColumns(
  manifestPath: string
): Map<string, string[]> {
  if (!fs.existsSync(manifestPath)) return new Map();

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    throw new Error(
      `schema-guard manifest is not valid JSON: ${manifestPath}`
    );
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(
      `schema-guard manifest must be a JSON object at the top level: ${manifestPath}`
    );
  }

  const result = new Map<string, string[]>();
  for (const [key, value] of Object.entries(raw)) {
    // Skip metadata keys (e.g. _readme)
    if (key.startsWith("_")) continue;

    if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
      throw new Error(
        `schema-guard manifest key "${key}" must be an array of strings`
      );
    }

    result.set(key.toLowerCase(), value.map((c) => c.toLowerCase()));
  }

  return result;
}
