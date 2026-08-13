/**
 * schema-guard-coverage.ts
 *
 * Static analysis check: every pgTable() defined in lib/db/src/schema/ must
 * have a corresponding CREATE TABLE IF NOT EXISTS guard in either
 * artifacts/api-server/src/lib/schemaGuard.ts or scripts/src/db-migrate.ts.
 *
 * Without such a guard, a fresh or drifted database will throw
 * "relation does not exist" when a route first queries the table, returning
 * an opaque HTTP 500 that is hard to diagnose.
 *
 * This check was introduced after two confirmed incidents:
 *   • support_tickets / ticket_replies  — GET /api/support/tickets → 500
 *   • cashfree_payouts / cashfree_payout_webhook_logs — GET /api/cashfree-payout → 500
 *
 * Exit 0 = all Drizzle tables are covered by at least one guard (or explicitly
 *           listed in KNOWN_GAPS with a documented reason).
 * Exit 1 = one or more tables are missing from both guards and not documented
 *           as a known gap — a new gap was introduced.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run schema-guard-coverage
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

// ── Source files ─────────────────────────────────────────────────────────────

const SCHEMA_DIR = path.join(ROOT, "lib/db/src/schema");
const SCHEMA_INDEX = path.join(SCHEMA_DIR, "index.ts");
const SCHEMA_GUARD_FILE = path.join(ROOT, "artifacts/api-server/src/lib/schemaGuard.ts");
const DB_MIGRATE_FILE = path.join(ROOT, "scripts/src/db-migrate.ts");

// ── Known gaps ───────────────────────────────────────────────────────────────
//
// Tables present in the Drizzle schema that are NOT yet covered by either
// schemaGuard.ts or db-migrate.ts.  Each entry must have a documented reason.
//
// These tables existed before the guard pattern was established and rely on
// the base Drizzle-kit push/migration that runs during initial environment
// setup.  They do not yet have a CREATE TABLE IF NOT EXISTS guard, which
// means a fresh DB that skips the Drizzle push step will still 500 on first
// use.  Adding full guards for each is tracked as follow-up work.
//
// ⚠️  DO NOT add new tables here without a documented reason.  If you are
//     adding a new table to the Drizzle schema, add it to schemaGuard.ts
//     instead.  This list should only ever shrink, never grow.
const KNOWN_GAPS: Record<string, string> = {
  account_visibility_rules:
    "Pre-guard table — created by Drizzle push during initial setup; no route currently does a fresh-DB SELECT that could 500",
  activation_requests:
    "Pre-guard table — created by Drizzle push during initial setup; guard addition tracked as follow-up work",
  callback_nonces:
    "Pre-guard table — created by Drizzle push during initial setup; guard addition tracked as follow-up work",
  cashfree_payment_logs:
    "Pre-guard table — created by Drizzle push during initial setup; guard addition tracked as follow-up work",
  merchant_features:
    "Pre-guard table — created by Drizzle push during initial setup; guard addition tracked as follow-up work",
  merchant_products:
    "Pre-guard table — created by Drizzle push during initial setup; guard addition tracked as follow-up work",
  payment_links:
    "Pre-guard table — created by Drizzle push during initial setup; guard addition tracked as follow-up work",
  plan_history:
    "Pre-guard table — created by Drizzle push during initial setup; guard addition tracked as follow-up work",
  provider_metrics:
    "Pre-guard table — created by Drizzle push during initial setup; guard addition tracked as follow-up work",
  provider_product_visibility:
    "Pre-guard table — created by Drizzle push during initial setup; guard addition tracked as follow-up work",
  qr_payment_events:
    "Pre-guard table — created by Drizzle push during initial setup; guard addition tracked as follow-up work",
  routing_logs:
    "Pre-guard table — created by Drizzle push during initial setup; guard addition tracked as follow-up work",
  saved_filters:
    "Pre-guard table — created by Drizzle push during initial setup; guard addition tracked as follow-up work",
  signature_failure_alert_logs:
    "Pre-guard table — has ALTER TABLE guard in schemaGuard.ts for cooldown_hours column but no CREATE TABLE guard; tracked as follow-up work",
  storage_cleanup_runs:
    "Pre-guard table — created by Drizzle push during initial setup; guard addition tracked as follow-up work",
  va_balance_history:
    "Pre-guard table — created by Drizzle push during initial setup; guard addition tracked as follow-up work",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract all pgTable("table_name") table names from a TypeScript source file.
 * Matches both single- and double-quoted names.
 */
function extractDrizzleTables(source: string): string[] {
  const tables: string[] = [];
  // Matches: pgTable("table_name" or pgTable('table_name'
  const re = /\bpgTable\s*\(\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    tables.push(m[1]);
  }
  return tables;
}

/**
 * Extract all table names from CREATE TABLE IF NOT EXISTS statements in a
 * TypeScript/SQL source file.  Handles both raw SQL strings and tagged
 * template literals (sql`CREATE TABLE IF NOT EXISTS ...`).
 */
function extractGuardedTables(source: string): Set<string> {
  const tables = new Set<string>();
  // Matches: CREATE TABLE IF NOT EXISTS table_name
  // The table name is a plain identifier (word chars, no quotes needed in SQL).
  const re = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+["']?(\w+)["']?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    tables.add(m[1].toLowerCase());
  }
  return tables;
}

/**
 * Read every schema file exported from lib/db/src/schema/index.ts, collect
 * all pgTable() table names.
 */
function collectDrizzleTableNames(): string[] {
  const indexSource = fs.readFileSync(SCHEMA_INDEX, "utf8");

  // Collect the list of exported modules from index.ts.
  // Lines look like: export * from "./users";
  const exportRe = /export\s+\*\s+from\s+["']\.\/([^"']+)["']/g;
  const moduleNames: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = exportRe.exec(indexSource)) !== null) {
    moduleNames.push(m[1]);
  }

  const allTables: string[] = [];
  for (const mod of moduleNames) {
    // Try .ts extension first, then .tsx
    let filePath = path.join(SCHEMA_DIR, `${mod}.ts`);
    if (!fs.existsSync(filePath)) {
      filePath = path.join(SCHEMA_DIR, `${mod}.tsx`);
    }
    if (!fs.existsSync(filePath)) {
      console.warn(`  [WARN] schema module not found: ${mod}`);
      continue;
    }
    const source = fs.readFileSync(filePath, "utf8");
    const tables = extractDrizzleTables(source);
    allTables.push(...tables);
  }

  return [...new Set(allTables)].sort();
}

/**
 * Collect all tables covered by schemaGuard.ts and db-migrate.ts.
 */
function collectGuardedTableNames(): Set<string> {
  const guarded = new Set<string>();

  for (const file of [SCHEMA_GUARD_FILE, DB_MIGRATE_FILE]) {
    if (!fs.existsSync(file)) {
      console.warn(`  [WARN] guard file not found: ${file}`);
      continue;
    }
    const source = fs.readFileSync(file, "utf8");
    for (const t of extractGuardedTables(source)) {
      guarded.add(t);
    }
  }

  return guarded;
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main(): void {
  console.log("schema-guard-coverage: scanning Drizzle schema and guard files...\n");

  const drizzleTables = collectDrizzleTableNames();
  const guardedTables = collectGuardedTableNames();
  const knownGapNames = new Set(Object.keys(KNOWN_GAPS));

  console.log(`  Drizzle tables found : ${drizzleTables.length}`);
  console.log(`  Guarded tables found : ${guardedTables.size}`);
  console.log(`  Known gaps           : ${knownGapNames.size}`);
  console.log();

  // Tables that are in Drizzle but NOT in any guard
  const missingFromGuards = drizzleTables.filter(
    (t) => !guardedTables.has(t.toLowerCase()),
  );

  // Split into known gaps vs genuine new gaps
  const knownMissing = missingFromGuards.filter((t) => knownGapNames.has(t));
  const newGaps = missingFromGuards.filter((t) => !knownGapNames.has(t));

  // Tables listed as KNOWN_GAPS that actually ARE guarded now (stale entries)
  const staleKnownGaps = [...knownGapNames].filter(
    (t) => guardedTables.has(t.toLowerCase()),
  );

  // ── Report ────────────────────────────────────────────────────────────────

  if (knownMissing.length > 0) {
    console.log(`⚠  Known gaps (${knownMissing.length} tables — covered by Drizzle push, guard addition pending):`);
    for (const t of knownMissing.sort()) {
      console.log(`   • ${t}`);
      console.log(`     Reason: ${KNOWN_GAPS[t]}`);
    }
    console.log();
  }

  if (staleKnownGaps.length > 0) {
    console.log(`ℹ  Stale KNOWN_GAPS entries (${staleKnownGaps.length} — these tables now HAVE a guard, remove them from KNOWN_GAPS):`);
    for (const t of staleKnownGaps.sort()) {
      console.log(`   • ${t}`);
    }
    console.log();
  }

  if (newGaps.length > 0) {
    console.error(`✗  NEW UNGUARDED TABLES DETECTED (${newGaps.length}):`);
    console.error();
    for (const t of newGaps.sort()) {
      console.error(`   • ${t}`);
    }
    console.error();
    console.error("These tables are defined in lib/db/src/schema/ and used by route");
    console.error("handlers, but have NO CREATE TABLE IF NOT EXISTS guard in either:");
    console.error(`   • artifacts/api-server/src/lib/schemaGuard.ts`);
    console.error(`   • scripts/src/db-migrate.ts`);
    console.error();
    console.error("On a fresh or drifted database this will cause:");
    console.error('   "relation does not exist" → HTTP 500 on the first request to any');
    console.error("   route that queries that table.");
    console.error();
    console.error("You MUST do one of the following for each table listed above:");
    console.error("  A) Add a CREATE TABLE IF NOT EXISTS block to schemaGuard.ts");
    console.error("     (preferred — defense-in-depth, also protects production drift)");
    console.error("  B) Add a CREATE TABLE IF NOT EXISTS block to scripts/src/db-migrate.ts");
    console.error("     (acceptable if the table is part of the initial schema)");
    console.error("  C) If the table genuinely cannot 500 on a fresh DB (no route queries it");
    console.error("     before Drizzle push has run), document it in the KNOWN_GAPS map in");
    console.error("     scripts/src/schema-guard-coverage.ts with a clear reason.");
    console.error();
    process.exit(1);
  }

  if (staleKnownGaps.length > 0) {
    console.warn("schema-guard-coverage: WARN — stale KNOWN_GAPS entries found (see above).");
    console.warn("Please remove them from KNOWN_GAPS in schema-guard-coverage.ts.");
    console.warn();
  }

  console.log(`✓ schema-guard-coverage passed — all ${drizzleTables.length} Drizzle tables are either guarded or documented.`);
  if (knownMissing.length > 0) {
    console.log(`  (${knownMissing.length} table(s) in KNOWN_GAPS are pending guard addition — see above)`);
  }
  process.exit(0);
}

main();
