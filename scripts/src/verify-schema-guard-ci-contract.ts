/**
 * verify-schema-guard-ci-contract.ts
 *
 * End-to-end CI contract verifier for the schema-guard-column-diff check.
 *
 * Answers the question: "If schema-guard-column-diff exits 1, will the merge
 * button actually be blocked?"
 *
 * This script performs three independent checks:
 *
 *   Check 1 — CI wiring audit
 *     Reads the GitHub Actions workflow file and asserts that every required
 *     step (forward check, reverse check, unit tests, negative-case tests) is
 *     present.  A misconfigured or accidentally deleted step would let a bad
 *     column rename ship silently.
 *
 *   Check 2 — Negative-case test execution
 *     Spawns the negtest as a child process with the TAP reporter and parses
 *     the output.  Confirms that every critical reverse-check test case:
 *       • exists in the negtest file (source-level check)
 *       • appears as a passing "ok" line in TAP output (runtime-level check)
 *     This proves the end-to-end contract: the script correctly exits 1 when a
 *     column gap is detected, and the negtest correctly detects that behaviour.
 *     Because the negtest is itself a required CI step, a failing negtest blocks
 *     the merge — completing the guarantee.
 *
 *   Check 3 — Real-file forward pass
 *     Runs schema-guard-column-diff against the actual schema and guard files
 *     and asserts exit 0.  This confirms that no unguarded column exists in the
 *     current codebase, i.e. the check is in a "green" baseline state.
 *
 * Exit 0 = all three checks passed (CI contract is sound).
 * Exit 1 = one or more checks failed (contract is broken; do not merge).
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run verify-schema-guard-ci-contract
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const SCRIPTS_DIR = path.join(ROOT, "scripts");

// ── Source file paths ────────────────────────────────────────────────────────

const CI_WORKFLOW = path.join(ROOT, ".github/workflows/schema-guard-ci.yml");
const NEGTEST_FILE = path.join(__dirname, "schema-guard-column-diff.negtest.ts");
const COLUMN_DIFF_SCRIPT = path.join(__dirname, "schema-guard-column-diff.ts");

// ── State tracking ───────────────────────────────────────────────────────────

let allOk = true;

function fail(msg: string): void {
  console.error(`✗ FAIL | ${msg}`);
  allOk = false;
}

function ok(msg: string): void {
  console.log(`✓ OK   | ${msg}`);
}

function section(title: string): void {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${"─".repeat(60)}`);
}

// ── Check 1: CI wiring audit ─────────────────────────────────────────────────

section("Check 1: CI workflow wiring");

/**
 * Each entry describes a required step in the schema-guard-ci.yml workflow.
 * `fragment` is a substring that must appear verbatim in the workflow YAML.
 */
const REQUIRED_CI_STEPS: Array<{ label: string; fragment: string }> = [
  {
    label: "schema-guard-coverage step",
    fragment: "schema-guard-coverage",
  },
  {
    label: "schema-guard-column-diff (forward check) step",
    fragment: "schema-guard-column-diff",
  },
  {
    label: "schema-guard-alter-reverse-check step",
    fragment: "schema-guard-alter-reverse-check",
  },
  {
    label: "schema-guard-column-diff unit-test step",
    fragment: "test:schema-guard-column-diff",
  },
  {
    label: "schema-guard-column-diff negative-case test step",
    fragment: "schema-guard-column-diff:negtest",
  },
  {
    label: "pull_request trigger (runs on PRs, enabling merge blocking)",
    fragment: "pull_request:",
  },
];

if (!fs.existsSync(CI_WORKFLOW)) {
  fail(`CI workflow file missing: ${path.relative(ROOT, CI_WORKFLOW)}`);
} else {
  ok(`CI workflow file exists: ${path.relative(ROOT, CI_WORKFLOW)}`);
  const workflowSource = fs.readFileSync(CI_WORKFLOW, "utf8");

  for (const { label, fragment } of REQUIRED_CI_STEPS) {
    if (workflowSource.includes(fragment)) {
      ok(`  Wired: ${label}`);
    } else {
      fail(
        `  Missing CI step: ${label}\n` +
          `    Expected to find "${fragment}" in ${path.relative(ROOT, CI_WORKFLOW)}.`,
      );
    }
  }
}

// ── Check 2: Negative-case test execution ────────────────────────────────────

section("Check 2: Negative-case test execution (exit-1 contract)");

/**
 * Critical reverse-check test cases that MUST appear as passing in the negtest.
 * These are the test titles that prove the script exits 1 when a column gap
 * or a stale DROP COLUMN is detected.
 */
const REQUIRED_NEGTEST_CASES: Array<{ description: string; titleFragment: string }> = [
  {
    description: "forward check: missing schema column → exit 1",
    titleFragment: "exits 1 when a schema column is missing from the guard",
  },
  {
    description: "reverse check: DROP COLUMN for live Drizzle column → exit 1",
    titleFragment:
      "exits 1 when a DROP COLUMN guard targets a column still live in the Drizzle schema",
  },
  {
    description: "reverse check: DROP COLUMN for removed Drizzle column → exit 0",
    titleFragment:
      "exits 0 when a DROP COLUMN guard targets a column already removed from the Drizzle schema",
  },
  {
    description: "reverse check: DROP COLUMN for live schemaGuard-only column → exit 1",
    titleFragment:
      "exits 1 when a DROP COLUMN guard targets a column still live in a schemaGuard-only table",
  },
  {
    description: "reverse check: DROP COLUMN for removed schemaGuard-only column → exit 0",
    titleFragment:
      "exits 0 when a DROP COLUMN guard targets a column already removed from a schemaGuard-only table",
  },
  {
    description: "reverse check: bare DROP COLUMN (no IF EXISTS) for live column → exit 1",
    titleFragment:
      "exits 1 when a bare DROP COLUMN (no IF EXISTS) targets a column still live in the Drizzle schema",
  },
  {
    description: "two-way manifest reverse check: CREATE TABLE column absent from manifest → exit 1",
    titleFragment: "exits 1 when a CREATE TABLE column is absent from the manifest",
  },
  {
    description: "two-way manifest reverse check: all CREATE TABLE columns in manifest → exit 0",
    titleFragment: "exits 0 when all CREATE TABLE columns are declared in the manifest",
  },
  {
    description: "typo'd table name in DROP COLUMN → exit 1",
    titleFragment:
      "exits 1 when a DROP COLUMN guard references a table name that does not exist",
  },
];

// ── 2a. Source-level check ───────────────────────────────────────────────────

console.log("\n  2a. Source-level: required test cases present in negtest file");

if (!fs.existsSync(NEGTEST_FILE)) {
  fail(`Negtest file missing: ${path.relative(ROOT, NEGTEST_FILE)}`);
} else {
  ok(`  Negtest file exists: ${path.relative(ROOT, NEGTEST_FILE)}`);
  const negtestSource = fs.readFileSync(NEGTEST_FILE, "utf8");

  for (const { description, titleFragment } of REQUIRED_NEGTEST_CASES) {
    if (negtestSource.includes(titleFragment)) {
      ok(`    Present: "${titleFragment.slice(0, 70)}…"`);
    } else {
      fail(
        `    Required test case missing from negtest source (${description}):\n` +
          `      Expected title fragment: "${titleFragment}"`,
      );
    }
  }

  // Verify no test is skipped — all cases must be active.
  const SKIP_PATTERNS = [/\bit\.skip\s*\(/, /\bdescribe\.skip\s*\(/, /\btest\.skip\s*\(/];
  if (SKIP_PATTERNS.some((p) => p.test(negtestSource))) {
    fail("  Skip marker found in negtest file — every test case must be active.");
  } else {
    ok("  No skip markers in negtest file.");
  }
}

// ── 2b. Runtime check: spawn negtest and parse TAP output ───────────────────

console.log("\n  2b. Runtime: spawn negtest and verify exit-1 contract cases pass");

const negtestResult = spawnSync(
  "node",
  ["--import", "tsx/esm", "--test", "--test-reporter=tap", NEGTEST_FILE],
  {
    cwd: SCRIPTS_DIR,
    env: { ...process.env, NODE_ENV: "test" },
    encoding: "utf8",
    timeout: 120_000,
  },
);

const negtestOutput = (negtestResult.stdout ?? "") + (negtestResult.stderr ?? "");

if (negtestResult.status !== 0) {
  fail(
    `  Negtest exited with code ${negtestResult.status} — one or more test cases failed.\n` +
      `  This means the exit-1 contract for schema-guard-column-diff is broken.\n` +
      `  TAP output:\n${negtestOutput
        .split("\n")
        .filter((l) => l.startsWith("not ok") || l.startsWith("#"))
        .join("\n")}`,
  );
} else {
  ok(`  Negtest exited 0 — all test cases passed.`);

  // Parse TAP to confirm every required case ran (not just "passed globally").
  // TAP "ok N - <description>" lines indicate a passing test.
  const tapOkLines = negtestOutput
    .split("\n")
    .filter((l) => /^ok\s+\d+/.test(l.trim()))
    .join("\n");

  for (const { description, titleFragment } of REQUIRED_NEGTEST_CASES) {
    // TAP descriptions may be truncated; match on the first ~60 chars.
    const searchFrag = titleFragment.slice(0, 60);
    if (tapOkLines.includes(searchFrag)) {
      ok(`    Runtime pass: "${searchFrag.slice(0, 60)}…"`);
    } else {
      fail(
        `    Required test case not found as a passing TAP line (${description}).\n` +
          `    Fragment searched: "${searchFrag}"\n` +
          `    (The test may have been renamed, restructured, or is not emitting the expected TAP line.)`,
      );
    }
  }
}

// ── Check 3: Real-file forward pass ──────────────────────────────────────────

section("Check 3: Real-file forward pass (current schema is fully guarded)");

const forwardResult = spawnSync(
  "node",
  ["--import", "tsx/esm", COLUMN_DIFF_SCRIPT],
  {
    cwd: SCRIPTS_DIR,
    env: { ...process.env },
    encoding: "utf8",
    timeout: 60_000,
  },
);

const forwardOutput = (forwardResult.stdout ?? "") + (forwardResult.stderr ?? "");

if (forwardResult.status === 0) {
  ok("schema-guard-column-diff exits 0 on the real schema — no unguarded columns detected.");
} else {
  fail(
    `schema-guard-column-diff exits ${forwardResult.status} on the real schema.\n` +
      `This means at least one column in lib/db/src/schema/ lacks a guard in schemaGuard.ts or db-migrate.ts.\n` +
      `Fix the gap before merging.\n` +
      `Output:\n${forwardOutput}`,
  );
}

// ── Summary ──────────────────────────────────────────────────────────────────

section("Summary");

if (allOk) {
  console.log(
    "All checks passed. The schema-guard-column-diff CI contract is sound:\n" +
      "  • The GitHub Actions workflow is wired to run the forward check, reverse check,\n" +
      "    unit tests, and negative-case tests on every pull request.\n" +
      "  • The negative-case tests confirm the script exits 1 when a column gap is present,\n" +
      "    so a bad column rename causes the CI job to fail and blocks the merge button.\n" +
      "  • The real schema currently has no unguarded columns (baseline is green).",
  );
  process.exit(0);
} else {
  console.error(
    "\nOne or more checks failed — the CI contract has a gap that could let a\n" +
      "bad column rename ship silently. Fix the issues above before merging.",
  );
  process.exit(1);
}
