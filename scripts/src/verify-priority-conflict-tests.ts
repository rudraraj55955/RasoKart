/**
 * verify-priority-conflict-tests.ts
 *
 * Pre-merge / CI guard for the smart-routing priority-conflict regression tests.
 *
 * Fails loudly (exit 1) if any of the following is true:
 *   - Either test file is missing (someone deleted it)
 *   - A required test-case description is absent from the file (someone renamed it)
 *   - Any skip marker (it.skip / describe.skip / { skip: ) exists anywhere in either
 *     file — these are guard files where every test case is required; skips are never
 *     legitimate and indicate an intentional or accidental bypass
 *   - The TAP output from running the mocked suite does not contain each required test
 *     as an active passing line (catches runtime skips via the skip option object or
 *     any other mechanism that survives the source check)
 *   - The mocked-DB test suite exits non-zero (a regression was introduced)
 *   - The real-DB test suite exits non-zero when DATABASE_URL is set
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run verify-priority-conflict-tests
 *
 * Exit code 0 = every check passed, 1 = one or more checks failed.
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const API_SERVER_DIR = path.join(ROOT, "artifacts/api-server");

const MOCKED_TEST = "artifacts/api-server/src/routes/smartRouting.priority-conflict.test.ts";
const REALDB_TEST = "artifacts/api-server/src/routes/smartRouting.priority-conflict.realdb.test.ts";

/**
 * Title strings that MUST appear as active (non-skipped) tests in their respective files.
 * These are matched both as source patterns and against TAP output lines.
 */
interface FileSpec {
  relPath: string;
  requiredTitles: Array<{ description: string; titleFragment: string }>;
}

const FILE_SPECS: FileSpec[] = [
  {
    relPath: MOCKED_TEST,
    requiredTitles: [
      {
        description: "concurrent-saves (Promise.all) test case",
        titleFragment: "concurrent saves (Promise.all)",
      },
      {
        description: "stale-tab sequential save test case",
        titleFragment: "stale-tab sequential save",
      },
    ],
  },
  {
    relPath: REALDB_TEST,
    requiredTitles: [
      {
        description: "real-DB concurrent POSTs test case",
        titleFragment: "two truly concurrent POSTs at the same priority",
      },
    ],
  },
];

/** Source-level patterns that indicate a test has been skipped. */
const SKIP_SOURCE_PATTERNS: RegExp[] = [
  /\bit\.skip\s*\(/,
  /\bdescribe\.skip\s*\(/,
  /\btest\.skip\s*\(/,
  /\bskip\s*:\s*(?:true|['"])/,
];

let allOk = true;

function fail(msg: string): void {
  console.error(`✗ FAIL | ${msg}`);
  allOk = false;
}

function ok(msg: string): void {
  console.log(`✓ OK   | ${msg}`);
}

function warn(msg: string): void {
  console.warn(`⚠  WARN | ${msg}`);
}

console.log("=== Smart Routing Priority-Conflict Test Guard ===\n");

// ─── Step 1: File existence, required-title presence, and no-skip-marker checks ───

for (const spec of FILE_SPECS) {
  const absPath = path.join(ROOT, spec.relPath);
  const label = path.basename(spec.relPath);

  if (!fs.existsSync(absPath)) {
    fail(`Test file missing: ${spec.relPath}`);
    continue;
  }
  ok(`File exists: ${spec.relPath}`);

  const contents = fs.readFileSync(absPath, "utf8");

  // 1a. Required title strings must be present in the file.
  for (const { description, titleFragment } of spec.requiredTitles) {
    if (!contents.includes(titleFragment)) {
      fail(`Required test case title not found in ${label}: "${titleFragment}" (${description})`);
    } else {
      ok(`Title present in ${label}: "${titleFragment}"`);
    }
  }

  // 1b. No skip markers are allowed anywhere in these guard files.
  for (const skipPattern of SKIP_SOURCE_PATTERNS) {
    if (skipPattern.test(contents)) {
      fail(
        `Skip marker detected in ${label} (pattern: ${skipPattern}). ` +
        `All test cases in this file are required — remove the skip and fix the underlying issue.`,
      );
    }
  }
  if (!SKIP_SOURCE_PATTERNS.some((p) => p.test(contents))) {
    ok(`No skip markers found in ${label}`);
  }
}

// ─── Step 2: Run the mocked suite with TAP reporter; verify active execution ───

console.log("\n--- Running mocked test suite (TAP) ---");
const mockedTestAbs = path.join(ROOT, MOCKED_TEST);

const mockedResult = spawnSync(
  "node",
  ["--import", "tsx", "--test", "--test-reporter=tap", mockedTestAbs],
  {
    cwd: API_SERVER_DIR,
    env: { ...process.env, NODE_ENV: "test" },
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  },
);

const mockedTap = (mockedResult.stdout ?? "") + (mockedResult.stderr ?? "");
process.stdout.write(mockedTap);

if (mockedResult.status !== 0) {
  fail("Mocked test suite exited non-zero — a priority-conflict regression may have been introduced");
} else {
  ok("Mocked test suite exited 0");
}

// Parse TAP: confirm each required title ran as a passing (non-skipped) test.
const mockedSpec = FILE_SPECS.find((s) => s.relPath === MOCKED_TEST)!;
for (const { description, titleFragment } of mockedSpec.requiredTitles) {
  const tapLines = mockedTap.split("\n");
  const matchingLine = tapLines.find((l) => l.includes(titleFragment));
  if (!matchingLine) {
    fail(
      `Required test "${titleFragment}" (${description}) did not appear in TAP output — ` +
      `it was not run at all (deleted at runtime or file was not loaded).`,
    );
  } else if (/# SKIP/i.test(matchingLine)) {
    fail(
      `Required test "${titleFragment}" (${description}) was SKIPPED in the TAP output: ${matchingLine.trim()}`,
    );
  } else if (/^not ok /i.test(matchingLine.trimStart())) {
    fail(
      `Required test "${titleFragment}" (${description}) FAILED in the TAP output: ${matchingLine.trim()}`,
    );
  } else {
    ok(`TAP confirms active execution: "${titleFragment}"`);
  }
}

// ─── Step 3: Real-DB suite — required when DATABASE_URL is set ───

console.log("\n--- Real-DB test suite ---");
if (!process.env["DATABASE_URL"]) {
  warn(
    "DATABASE_URL is not set — skipping real-DB test suite. " +
    "Run with DATABASE_URL set to validate the live Postgres unique-index constraint.",
  );
} else {
  const realDbTestAbs = path.join(ROOT, REALDB_TEST);
  const realDbResult = spawnSync(
    "node",
    ["--import", "tsx", "--test", "--test-reporter=tap", realDbTestAbs],
    {
      cwd: API_SERVER_DIR,
      env: { ...process.env, NODE_ENV: "test" },
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    },
  );

  const realDbTap = (realDbResult.stdout ?? "") + (realDbResult.stderr ?? "");
  process.stdout.write(realDbTap);

  if (realDbResult.status !== 0) {
    fail("Real-DB test suite exited non-zero — priority-conflict unique index may be broken");
  } else {
    ok("Real-DB test suite exited 0");
  }

  const realDbSpec = FILE_SPECS.find((s) => s.relPath === REALDB_TEST)!;
  for (const { description, titleFragment } of realDbSpec.requiredTitles) {
    const tapLines = realDbTap.split("\n");
    const matchingLine = tapLines.find((l) => l.includes(titleFragment));
    if (!matchingLine) {
      fail(
        `Required test "${titleFragment}" (${description}) did not appear in real-DB TAP output.`,
      );
    } else if (/# SKIP/i.test(matchingLine)) {
      fail(
        `Required test "${titleFragment}" (${description}) was SKIPPED in real-DB TAP output: ${matchingLine.trim()}`,
      );
    } else if (/^not ok /i.test(matchingLine.trimStart())) {
      fail(
        `Required test "${titleFragment}" (${description}) FAILED in real-DB TAP output: ${matchingLine.trim()}`,
      );
    } else {
      ok(`TAP confirms active real-DB execution: "${titleFragment}"`);
    }
  }
}

// ─── Summary ───

console.log("\n=== Summary ===");
if (!allOk) {
  console.error(
    "\n✗ One or more priority-conflict test guards failed.\n" +
    "  These tests exist to catch regressions in smartRouting.ts and routingRules.ts.\n" +
    "  Do NOT remove or skip them — fix the underlying issue instead.\n",
  );
  process.exit(1);
}

console.log("\n✓ All priority-conflict test guards passed.\n");
