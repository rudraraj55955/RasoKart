import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { inArray } from "drizzle-orm";
import { pool, db, usersTable, demoAccountRemovalsTable } from "@workspace/db";
import { DEMO_CREDENTIALS } from "@workspace/demo-credentials";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Lightweight liveness check — no DB access, always fast, used by load
// balancers / uptime pingers that just need to know the process is up.
router.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

router.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

// DEMO_CREDENTIALS imported from @workspace/demo-credentials — single source
// of truth. Edit lib/demo-credentials/src/index.ts to add/remove accounts.

// Deep readiness check — verifies the DB connection AND the presence of the
// tables/columns most likely to drift on a fresh/older VPS deploy (see
// lib/schemaGuard.ts). Also verifies that every documented demo/test account
// can actually authenticate (correct password hash, correct role, active) so
// a seed regression is caught here before traffic is routed to the new
// instance rather than surfacing as a silent 401 to a real customer.
//
// Intended for deploy-time smoke tests and as the Replit autoscale startup
// health check path (see artifact.toml services.production.health.startup).
// The shallow /api/healthz remains available for frequent uptime pings that
// just need to know the process is alive.
router.get("/healthz/deep", async (_req, res) => {
  const checks: Record<string, boolean> = {};
  let dbOk = true;

  try {
    await pool.query("SELECT 1");
    checks["database_connection"] = true;
  } catch (err) {
    dbOk = false;
    checks["database_connection"] = false;
    logger.error({ err }, "healthz_deep_db_connection_failed");
  }

  if (dbOk) {
    const tableChecks: Array<{ key: string; query: string; requireRows?: boolean }> = [
      { key: "users.is_super_admin", query: "SELECT is_super_admin FROM users LIMIT 1" },
      { key: "company_settings", query: "SELECT id FROM company_settings LIMIT 1" },
      { key: "merchant_auth_otps", query: "SELECT id FROM merchant_auth_otps LIMIT 1" },
      { key: "provider_integrations.is_custom", query: "SELECT is_custom FROM provider_integrations LIMIT 1" },
      { key: "routing_rules", query: "SELECT id FROM routing_rules LIMIT 1" },
      { key: "quiet_hours_queue.flushed", query: "SELECT flushed, deliver_after FROM quiet_hours_queue LIMIT 1" },
      // IAM table schema checks — SELECT directly from the expected column so
      // Postgres throws if the table or column is absent. information_schema is
      // intentionally avoided here: those queries never throw — they silently
      // return 0 rows on missing objects, which would falsely pass the check
      // even on a schema that is broken. requireRows=true adds an extra rowCount
      // guard for queries that expect at least one row to exist.
      { key: "iam_tables.permissions_schema",      query: "SELECT key FROM permissions LIMIT 1",                requireRows: false },
      { key: "iam_tables.role_permissions_schema",  query: "SELECT permission_key FROM role_permissions LIMIT 1", requireRows: false },
      { key: "iam_tables.user_permissions_schema",  query: "SELECT effect FROM user_permissions LIMIT 1",         requireRows: false },
      { key: "iam_tables.iam_migration_log_schema", query: "SELECT cutoff_at FROM iam_migration_log LIMIT 1",    requireRows: false },
    ];

    for (const { key, query, requireRows } of tableChecks) {
      try {
        const result = await pool.query(query);
        checks[key] = requireRows ? result.rows.length > 0 : true;
      } catch (err) {
        checks[key] = false;
        logger.error({ err, check: key }, "healthz_deep_schema_check_failed");
      }
    }

    // IAM catalog integrity check: if IAM migration has been run, the
    // permissions catalog must not be empty. An empty catalog after migration
    // means the sync step failed and enforcement will be broken.
    try {
      const migResult = await pool.query<{ c: string }>(
        "SELECT COUNT(*) AS c FROM iam_migration_log",
      );
      const migrated = parseInt(migResult.rows[0]?.c ?? "0", 10) > 0;
      if (migrated) {
        const catResult = await pool.query<{ c: string }>(
          "SELECT COUNT(*) AS c FROM permissions",
        );
        const catalogRows = parseInt(catResult.rows[0]?.c ?? "0", 10);
        const roleTemplateResult = await pool.query<{ c: string }>(
          "SELECT COUNT(*) AS c FROM role_permissions",
        );
        const roleTemplateRows = parseInt(roleTemplateResult.rows[0]?.c ?? "0", 10);
        if (catalogRows === 0) {
          checks["iam_catalog_seeded"] = false;
          logger.error(
            { catalogRows, roleTemplateRows },
            "healthz_deep_iam_catalog_empty: migration ran but permissions catalog has no rows",
          );
        } else {
          checks["iam_catalog_seeded"] = true;
          logger.info({ catalogRows, roleTemplateRows }, "healthz_deep_iam_catalog_ok");
        }
      } else {
        // Migration not yet run — soft enforcement mode; catalog check is N/A
        checks["iam_catalog_seeded"] = true;
      }
    } catch (err) {
      checks["iam_catalog_seeded"] = false;
      logger.error({ err }, "healthz_deep_iam_catalog_check_failed");
    }

    // Demo-credential check: verify every documented login can authenticate.
    // Respects SEED_EXCLUDE_DEMO_EMAILS (env var) and the demo_account_removals
    // table so excluded accounts aren't flagged as broken on envs that have
    // intentionally removed them.
    try {
      const envExcluded = new Set(
        (process.env.SEED_EXCLUDE_DEMO_EMAILS ?? "")
          .split(",")
          .map((e) => e.trim().toLowerCase())
          .filter(Boolean),
      );

      const dbExcludedRows = await db
        .select({ email: demoAccountRemovalsTable.email })
        .from(demoAccountRemovalsTable);
      const dbExcluded = new Set(dbExcludedRows.map((r) => r.email.toLowerCase()));

      const activeCredentials = DEMO_CREDENTIALS.filter(
        (c) => !envExcluded.has(c.email.toLowerCase()) && !dbExcluded.has(c.email.toLowerCase()),
      );

      if (activeCredentials.length === 0) {
        // All demo accounts excluded — nothing to verify; treat as pass.
        checks["demo_credentials"] = true;
      } else {
        const emails = activeCredentials.map((c) => c.email);
        const rows = await db
          .select({
            email: usersTable.email,
            passwordHash: usersTable.passwordHash,
            role: usersTable.role,
            isActive: usersTable.isActive,
          })
          .from(usersTable)
          .where(inArray(usersTable.email, emails));

        const byEmail = new Map(rows.map((r) => [r.email, r]));
        let allOk = true;

        for (const cred of activeCredentials) {
          const row = byEmail.get(cred.email);
          if (!row) {
            allOk = false;
            logger.error(
              { email: cred.email },
              "healthz_deep_demo_credential_missing: account documented in replit.md does not exist in the database",
            );
            continue;
          }

          const passwordOk = row.passwordHash ? await bcrypt.compare(cred.password, row.passwordHash) : false;
          const roleOk = row.role === cred.role;
          const activeOk = row.isActive;

          if (!passwordOk || !roleOk || !activeOk) {
            allOk = false;
            logger.error(
              {
                email: cred.email,
                passwordMatches: passwordOk,
                expectedRole: cred.role,
                actualRole: row.role,
                isActive: row.isActive,
              },
              "healthz_deep_demo_credential_broken: documented demo account cannot authenticate as expected",
            );
          }
        }

        checks["demo_credentials"] = allOk;
        if (allOk) {
          logger.info({ accounts: emails }, "healthz_deep_demo_credentials_ok");
        }
      }
    } catch (err) {
      checks["demo_credentials"] = false;
      logger.error({ err }, "healthz_deep_demo_credential_check_failed");
    }
  }

  const allOk = Object.values(checks).every(Boolean);
  res.status(allOk ? 200 : 503).json({ status: allOk ? "ok" : "degraded", checks });
});

export default router;
