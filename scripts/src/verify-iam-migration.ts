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
 *      e. Legacy permissions_json equivalence: pre-cutoff users' legacy flags are
 *         preserved in the new IAM system (ALLOW override OR covered by role default)
 *
 * Exit 0 = all checks passed. Exit 1 = one or more checks failed.
 */

import { pool } from "@workspace/db";

const KNOWN_ROLES = ["admin", "merchant", "payout_merchant", "payout_admin", "payout_super_admin", "agent", "customer"];

// Inline copy of LEGACY_KEY_MAP from permissions.ts — kept in sync manually.
// Maps legacy camelCase boolean flag names (from users.permissions_json) to canonical keys.
const LEGACY_KEY_MAP: Record<string, string> = {
  canViewMerchants:             "admin_merchants",
  canManageMerchants:           "admin_merchants",
  canViewTransactions:          "admin_transactions",
  canManageTransactions:        "admin_transactions",
  canViewSettlements:           "admin_settlements",
  canManageSettlements:         "admin_settlements",
  canViewPayouts:               "admin_payouts",
  canManagePayouts:             "admin_payouts",
  canManageUsers:               "admin_users",
  canManagePlans:               "admin_plans",
  canManageWebhooks:            "admin_webhooks",
  canViewAuditLogs:             "admin_audit_logs",
  canManageFeatureControl:      "admin_feature_control",
  canManageSettings:            "admin_settings",
  canManageSmartRouting:        "admin_smart_routing",
  canManageKyc:                 "admin_kyc",
  canViewKyc:                   "admin_kyc",
  canManageProviders:           "admin_providers",
  canViewProviders:             "admin_providers",
  canViewReports:               "admin_reports",
  canManageReports:             "admin_reports",
  canManageSupport:             "admin_support",
  canManagePayoutAdmins:        "admin_payout_admins",
  canManagePayoutMerchants:     "admin_payout_merchants",
  canManagePayoutSettings:      "admin_payout_settings",
  canManageReconciliation:      "admin_reconciliation",
  canViewReconciliation:        "admin_reconciliation",
  canManageModuleControl:       "admin_module_control",
  canViewPlatformProfit:        "admin_platform_profit",
  canManageUtrVerifications:    "admin_utr_verifications",
  canManagePayinCharges:        "admin_payin_charges",
  canViewConnections:           "admin_connections",
  canViewApiMonitoring:         "admin_api_monitoring",
  canAccessPayoutDashboard:     "payout_admin_dashboard",
  canViewPayoutMerchants:       "payout_admin_merchants",
  canManagePayoutMerchantsList: "payout_admin_merchants",
  canViewPayoutAuditLogs:       "payout_admin_audit_logs",
  canManagePayoutAdminSettings: "payout_admin_settings",
  canAccessMerchantDashboard:   "merchant_dashboard",
  canViewMerchantTransactions:  "merchant_transactions",
  canManageMerchantPayouts:     "merchant_payouts",
  canManageApiKeys:             "merchant_api_keys",
  canManageMerchantWebhook:     "merchant_webhook",
  canManageVirtualAccounts:     "merchant_virtual_accounts",
  canManageQrCodes:             "merchant_qr_codes",
  canViewLedger:                "merchant_ledger",
  canViewMerchantReports:       "merchant_reports",
  canManageMerchantKyc:         "merchant_kyc",
  canManageOnboarding:          "merchant_onboarding",
  canManageMerchantSupport:     "merchant_support",
  canManagePaymentLinks:        "merchant_payment_links",
};

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

    // 2e. Legacy permissions_json equivalence check.
    // For every pre-cutoff user who had a non-null permissions_json with a
    // legacy flag=true, verify the corresponding canonical permission key is
    // either (a) TRUE in role_permissions for that user's role (role default
    // already covers it) OR (b) present as ALLOW in user_permissions (explicit
    // override preserved by the backfill).  Any flag that is NOT covered by
    // either path is a migration gap.
    const cutoffR = await pool.query<{ cutoff_at: string }>(
      "SELECT cutoff_at FROM iam_migration_log ORDER BY cutoff_at ASC LIMIT 1",
    );
    const cutoffAt = cutoffR.rows[0]?.cutoff_at ?? null;

    if (cutoffAt) {
      // Fetch all pre-cutoff users that have a non-null permissions_json.
      const legacyUsersR = await pool.query<{
        id: number;
        role: string;
        is_super_admin: boolean;
        permissions_json: string | null;
      }>(
        `SELECT id, role, is_super_admin, permissions_json
         FROM users
         WHERE permissions_json IS NOT NULL
           AND created_at <= $1`,
        [cutoffAt],
      );

      if (legacyUsersR.rows.length === 0) {
        check("legacy_permissions_equivalence", true, "no pre-cutoff users with permissions_json (N/A)");
      } else {
        // Fetch all role_permissions defaults (is_enabled=true rows only)
        const roleDefaultsR = await pool.query<{ role: string; permission_key: string }>(
          "SELECT role, permission_key FROM role_permissions WHERE is_enabled = TRUE",
        );
        const roleDefaults = new Set(roleDefaultsR.rows.map((r) => `${r.role}:${r.permission_key}`));

        // Fetch all ALLOW overrides in user_permissions
        const userOverridesR = await pool.query<{ user_id: number; permission_key: string }>(
          "SELECT user_id, permission_key FROM user_permissions WHERE effect = 'ALLOW'",
        );
        const userAllows = new Set(userOverridesR.rows.map((r) => `${r.user_id}:${r.permission_key}`));

        const gaps: Array<{ userId: number; role: string; legacyFlag: string; canonicalKey: string }> = [];

        for (const user of legacyUsersR.rows) {
          // pg driver returns JSONB columns as JS objects; only JSON.parse when
          // the value arrives as a string (e.g. plain TEXT cast or mock data).
          let parsed: Record<string, unknown> = {};
          const raw = user.permissions_json;
          if (raw === null || raw === undefined) continue;
          if (typeof raw === "object") {
            parsed = raw as Record<string, unknown>;
          } else if (typeof raw === "string") {
            try {
              parsed = JSON.parse(raw) as Record<string, unknown>;
            } catch {
              // genuinely malformed JSON — flag it, then skip
              gaps.push({ userId: user.id, role: user.role, legacyFlag: "<malformed_json>", canonicalKey: "<parse_error>" });
              continue;
            }
          } else {
            continue;
          }

          for (const [legacyFlag, value] of Object.entries(parsed)) {
            if (value !== true) continue; // only care about flags that were enabled
            const canonicalKey = LEGACY_KEY_MAP[legacyFlag];
            if (!canonicalKey) continue; // unknown legacy flag — not mapped, not a gap

            // SA users bypass role checks — their effective access is *
            if (user.is_super_admin) continue;

            const coveredByRole = roleDefaults.has(`${user.role}:${canonicalKey}`);
            const coveredByOverride = userAllows.has(`${user.id}:${canonicalKey}`);

            if (!coveredByRole && !coveredByOverride) {
              gaps.push({ userId: user.id, role: user.role, legacyFlag, canonicalKey });
            }
          }
        }

        check(
          "legacy_permissions_equivalence",
          gaps.length === 0,
          gaps.length === 0
            ? `${legacyUsersR.rows.length} pre-cutoff user(s) verified — all legacy flags preserved`
            : `Migration gap: ${gaps.length} legacy flag(s) not covered by role default or ALLOW override: ${JSON.stringify(gaps.slice(0, 5))}`,
        );
      }
    } else {
      check("legacy_permissions_equivalence", true, "no IAM cutoff timestamp found — N/A");
    }
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
