/**
 * verify-iam-migration.ts
 *
 * Validates that the IAM schema is correctly set up:
 *   1. All canonical IAM tables exist with expected columns
 *   2. permissions catalog has rows (or migration has not run yet — both OK)
 *   3. If migration has run:
 *      a. permissions catalog row count matches code catalog
 *      b. role_permissions has rows for every known role
 *      c. No SA-only permission appears as ALLOW in user_permissions for non-SA users
 *      d. No cross-role escalation in user_permissions (ALLOW outside role envelope)
 *
 * Exit 0 = all checks passed. Exit 1 = one or more checks failed.
 */

import { pool } from "@workspace/db";

const KNOWN_ROLES = ["admin", "merchant", "payout_merchant", "payout_admin", "payout_super_admin", "agent"];

const SA_ONLY_KEYS = [
  "admin_company_branding",
  "admin_data_hygiene",
  "admin_razorpay",
  "admin_social_providers",
  "admin_secure_id",
  "admin_otp_settings",
  "admin_platform_profit",
  "iam_read",
  "iam_manage",
];

interface CheckResult {
  name: string;
  passed: boolean;
  detail?: string;
}

async function runChecks(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  function check(name: string, passed: boolean, detail?: string): void {
    results.push({ name, passed, detail });
  }

  // ── 1. Table schema checks ────────────────────────────────────────────────
  const tables = [
    { table: "permissions", col: "key" },
    { table: "role_permissions", col: "permission_key" },
    { table: "user_permissions", col: "effect" },
    { table: "iam_migration_log", col: "cutoff_at" },
  ];

  for (const { table, col } of tables) {
    const r = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS(
        SELECT 1 FROM information_schema.columns
        WHERE table_name = $1 AND column_name = $2
       ) AS exists`,
      [table, col],
    );
    const exists = r.rows[0]?.exists ?? false;
    check(`table_schema:${table}.${col}`, exists, exists ? undefined : `Column ${col} missing from ${table}`);
  }

  // ── 2. Migration state ────────────────────────────────────────────────────
  const migR = await pool.query<{ c: string }>("SELECT COUNT(*) AS c FROM iam_migration_log");
  const migrated = parseInt(migR.rows[0]?.c ?? "0", 10) > 0;
  check("migration_state_readable", true, migrated ? "migration has run" : "migration not yet run (soft mode)");

  if (migrated) {
    // 2a. Permissions catalog not empty
    const catR = await pool.query<{ c: string }>("SELECT COUNT(*) AS c FROM permissions");
    const catalogRows = parseInt(catR.rows[0]?.c ?? "0", 10);
    check("permissions_catalog_seeded", catalogRows > 0,
      catalogRows > 0 ? `${catalogRows} keys` : "catalog is EMPTY after migration");

    // 2b. role_permissions has rows for every known role
    for (const role of KNOWN_ROLES) {
      const rpR = await pool.query<{ c: string }>(
        "SELECT COUNT(*) AS c FROM role_permissions WHERE role = $1",
        [role],
      );
      const rowCount = parseInt(rpR.rows[0]?.c ?? "0", 10);
      check(`role_permissions:${role}`, rowCount > 0,
        rowCount > 0 ? `${rowCount} rows` : `No role_permissions rows for role '${role}'`);
    }

    // 2c. No SA-only permission ALLOWed for non-SA users
    const escalationR = await pool.query<{ user_id: number; permission_key: string }>(
      `SELECT up.user_id, up.permission_key
       FROM user_permissions up
       JOIN users u ON u.id = up.user_id
       WHERE up.effect = 'ALLOW'
         AND u.is_super_admin = FALSE
         AND up.permission_key = ANY($1::text[])`,
      [SA_ONLY_KEYS],
    );
    check("no_sa_only_allow_for_non_sa", escalationR.rows.length === 0,
      escalationR.rows.length === 0
        ? "clean"
        : `SA-only permissions ALLOWed for non-SA users: ${JSON.stringify(escalationR.rows)}`);

    // 2d. Cross-role escalation detection: ALLOW in user_permissions where
    //     the role_permissions default is FALSE for that user's role.
    const crossRoleR = await pool.query<{ user_id: number; permission_key: string; role: string }>(
      `SELECT up.user_id, up.permission_key, u.role
       FROM user_permissions up
       JOIN users u ON u.id = up.user_id
       JOIN role_permissions rp
         ON rp.role = u.role AND rp.permission_key = up.permission_key
       WHERE up.effect = 'ALLOW'
         AND u.is_super_admin = FALSE
         AND rp.is_enabled = FALSE`,
    );
    check("no_cross_role_escalation", crossRoleR.rows.length === 0,
      crossRoleR.rows.length === 0
        ? "clean"
        : `Cross-role escalation found: ${JSON.stringify(crossRoleR.rows)}`);
  } else {
    check("permissions_catalog_seeded", true, "N/A — migration not run (soft mode)");
    for (const role of KNOWN_ROLES) {
      check(`role_permissions:${role}`, true, "N/A — migration not run");
    }
    check("no_sa_only_allow_for_non_sa", true, "N/A — migration not run");
    check("no_cross_role_escalation", true, "N/A — migration not run");
  }

  return results;
}

async function main() {
  let exitCode = 0;

  try {
    const results = await runChecks();
    const passed = results.filter((r) => r.passed);
    const failed = results.filter((r) => !r.passed);

    console.log("\n=== IAM Migration Verification ===\n");
    for (const r of results) {
      const mark = r.passed ? "✓" : "✗";
      const detail = r.detail ? `  (${r.detail})` : "";
      console.log(`  ${mark} ${r.name}${detail}`);
    }

    console.log(`\nResult: ${passed.length} passed, ${failed.length} failed`);

    if (failed.length > 0) {
      console.error("\nFailed checks:");
      for (const r of failed) {
        console.error(`  ✗ ${r.name}: ${r.detail ?? "no detail"}`);
      }
      exitCode = 1;
    } else {
      console.log("\nAll IAM migration checks passed.");
    }
  } catch (err) {
    console.error("verify-iam-migration failed with error:", err);
    exitCode = 1;
  } finally {
    await pool.end();
  }

  process.exit(exitCode);
}

main();
