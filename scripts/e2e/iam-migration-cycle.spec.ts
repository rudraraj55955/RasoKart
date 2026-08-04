/**
 * iam-migration-cycle.spec.ts
 *
 * Regression tests for the IAM migration engine, permission resolver, and
 * per-user override endpoints. Designed to catch catalog edits or schema
 * changes that would silently break admin access.
 *
 * Coverage:
 *  1. Migration cycle: preview → run → idempotent run → rollback → re-run
 *  2. resolveUserPermissions() soft-mode (no iam_migration_log) vs hard-mode (log present)
 *  3. Super Admin always bypasses requirePermission() regardless of migration state
 *  4. Per-user override endpoints: PUT single, PUT bulk, DELETE, GET user permissions
 *  5. Access-envelope guard: SA-only and cross-role ALLOW escalation blocked
 *  6. Non-SA admin cannot invoke Super-Admin-only IAM mutating endpoints
 *  7. Audit trail populated after each IAM write operation
 *
 * State contract:
 *   Before the suite, the migration may or may not have been run.
 *   After the suite, migration is always left in "run" state (matching production).
 *   The suite is SERIAL — migration state changes must happen in order.
 */

import { test, expect, request as apiRequest } from "@playwright/test";
import { execSync } from "child_process";

const API = process.env["API_BASE_URL"] ?? "http://localhost:80/api";

// ── helpers ──────────────────────────────────────────────────────────────────

async function login(email: string, password: string): Promise<string> {
  const ctx = await apiRequest.newContext();
  const r = await ctx.post(`${API}/auth/login`, { data: { email, password } });
  const status = r.status();
  const bodyText = await r.text();
  await ctx.dispose();
  if (status === 429) throw new Error(`Rate limited logging in as ${email}. Clear rate_limit_hits first.`);
  if (status < 200 || status >= 300) throw new Error(`Login failed for ${email}: HTTP ${status} ${bodyText}`);
  return (JSON.parse(bodyText) as { token: string }).token;
}

function clearRateLimits(): void {
  try {
    execSync(`psql "${process.env["DATABASE_URL"]}" -c "DELETE FROM rate_limit_hits;"`, { stdio: "pipe" });
  } catch { /* best-effort */ }
}

// ── constants ────────────────────────────────────────────────────────────────

const ADMIN_EMAIL    = "admin@rasokart.com";  // Super Admin (is_super_admin=true)
const ADMIN_PASS     = "Admin@123456";
const MERCHANT_EMAIL = "merchant@demo.com";
const MERCHANT_PASS  = "Merchant@123456";

const TEST_PLAIN_ADMIN_EMAIL = "test_e2e_plain_admin@iam-cycle.local";
const TEST_PASS = "TestRole@12345";

// ── Serial migration-cycle suite ─────────────────────────────────────────────
// test.describe.serial guarantees sequential execution even when Playwright is
// configured with fullyParallel:true — critical because each test mutates the
// global iam_migration_log state.

test.describe.serial("IAM migration cycle + resolver + overrides", () => {
  let saToken: string;
  let plainAdminToken: string;
  let merchantToken: string;
  let plainAdminId: number | null = null;

  // Track migration state before suite so we always restore to "run" at the end
  let wasMigratedBeforeSuite = false;

  test.beforeAll(async () => {
    clearRateLimits();

    [saToken, merchantToken] = await Promise.all([
      login(ADMIN_EMAIL, ADMIN_PASS),
      login(MERCHANT_EMAIL, MERCHANT_PASS),
    ]);

    // Capture initial migration state
    const ctx = await apiRequest.newContext();
    const statusR = await ctx.get(`${API}/iam/migration/status`, {
      headers: { Authorization: `Bearer ${saToken}` },
    });
    const statusBody = await statusR.json() as { migrated: boolean };
    wasMigratedBeforeSuite = statusBody.migrated;

    // Create a non-SA admin user for permission-isolation tests
    try {
      execSync(
        `psql "${process.env["DATABASE_URL"]}" -c "DELETE FROM users WHERE email = '${TEST_PLAIN_ADMIN_EMAIL}';"`,
        { stdio: "pipe" },
      );
      const createR = await ctx.post(`${API}/users`, {
        data: { email: TEST_PLAIN_ADMIN_EMAIL, password: TEST_PASS, name: "Plain Admin IAM Cycle e2e", role: "admin" },
        headers: { Authorization: `Bearer ${saToken}` },
      });
      if (createR.status() === 200 || createR.status() === 201) {
        plainAdminId = ((await createR.json()) as { id: number }).id;
      }
    } catch { /* non-fatal */ }

    await ctx.dispose();
    clearRateLimits();

    if (plainAdminId != null) {
      try {
        plainAdminToken = await login(TEST_PLAIN_ADMIN_EMAIL, TEST_PASS);
      } catch { /* non-fatal */ }
    }
  });

  test.afterAll(async () => {
    // Always leave migration in "run" state (matches production) regardless of
    // where the test cycle ended up.
    const ctx = await apiRequest.newContext();
    const statusR = await ctx.get(`${API}/iam/migration/status`, {
      headers: { Authorization: `Bearer ${saToken}` },
    });
    const status = await statusR.json() as { migrated: boolean };

    if (!status.migrated) {
      // Re-run migration to restore production state
      await ctx.post(`${API}/iam/migration/run`, { headers: { Authorization: `Bearer ${saToken}` } });
    }

    // Clean up the ephemeral test admin
    if (plainAdminId != null) {
      await ctx.delete(`${API}/users/${plainAdminId}`, {
        headers: { Authorization: `Bearer ${saToken}` },
      });
    }
    await ctx.dispose();

    // Belt-and-suspenders: also clean via psql in case delete above failed
    try {
      execSync(
        `psql "${process.env["DATABASE_URL"]}" -c "DELETE FROM users WHERE email = '${TEST_PLAIN_ADMIN_EMAIL}';"`,
        { stdio: "pipe" },
      );
    } catch { /* best-effort */ }
  });

  // ── Step 0: Rollback any prior migration so we start from a clean state ────
  // This ensures the "preview → run" cycle below always starts from soft-mode.

  test("step 0 — rollback any existing migration to enter soft-mode for cycle test", async ({ request }) => {
    const statusR = await request.get(`${API}/iam/migration/status`, {
      headers: { Authorization: `Bearer ${saToken}` },
    });
    expect(statusR.status()).toBe(200);
    const status = await statusR.json() as { migrated: boolean };

    if (status.migrated) {
      const rollbackR = await request.post(`${API}/iam/migration/rollback`, {
        headers: { Authorization: `Bearer ${saToken}` },
      });
      expect(rollbackR.status()).toBe(200);
      const body = await rollbackR.json() as { ok: boolean; message: string };
      expect(body.ok).toBe(true);
      expect(body.message).toMatch(/rolled back/i);
    }

    // Confirm we are now in soft-mode
    const afterR = await request.get(`${API}/iam/migration/status`, {
      headers: { Authorization: `Bearer ${saToken}` },
    });
    const after = await afterR.json() as { migrated: boolean };
    expect(after.migrated).toBe(false);
  });

  // ── 1. Preview (dry-run) ────────────────────────────────────────────────────

  test("1a — GET /iam/migration/preview returns dry-run summary with alreadyMigrated=false", async ({ request }) => {
    const r = await request.get(`${API}/iam/migration/preview`, {
      headers: { Authorization: `Bearer ${saToken}` },
    });
    expect(r.status()).toBe(200);
    const body = await r.json() as {
      alreadyMigrated: boolean;
      totalUsers: number;
      usersByRole: Record<string, number>;
      superAdminCount: number;
      permissionsPerRole: Record<string, { enabled: number; disabled: number }>;
      catalogSize: number;
      roleTemplateRows: number;
      unknownRoleUsers: unknown[];
    };
    expect(body.alreadyMigrated).toBe(false);
    expect(typeof body.totalUsers).toBe("number");
    expect(body.totalUsers).toBeGreaterThan(0);
    expect(body.superAdminCount).toBeGreaterThanOrEqual(1); // at least admin@rasokart.com
    expect(body.catalogSize).toBeGreaterThanOrEqual(59);
    expect(body.roleTemplateRows).toBeGreaterThanOrEqual(7 * 59);
    // Admin role should have enabled permissions
    expect(body.permissionsPerRole["admin"]).toBeDefined();
    expect(body.permissionsPerRole["admin"]!.enabled).toBeGreaterThan(0);
    // Customer role should have zero enabled permissions
    expect(body.permissionsPerRole["customer"]).toBeDefined();
    expect(body.permissionsPerRole["customer"]!.enabled).toBe(0);
  });

  test("1b — preview is SA-only: non-SA admin gets 403", async ({ request }) => {
    if (!plainAdminToken) { test.skip(true, "plain admin setup failed"); return; }
    const r = await request.get(`${API}/iam/migration/preview`, {
      headers: { Authorization: `Bearer ${plainAdminToken}` },
    });
    expect(r.status()).toBe(403);
  });

  test("1c — preview is SA-only: merchant gets 403", async ({ request }) => {
    const r = await request.get(`${API}/iam/migration/preview`, {
      headers: { Authorization: `Bearer ${merchantToken}` },
    });
    expect(r.status()).toBe(403);
  });

  // ── 2. Resolver in soft-mode (no iam_migration_log) ────────────────────────
  // After the rollback above, there is no migration log.
  // resolveUserPermissions() falls back to ROLE_DEFAULT_PERMISSIONS from code.

  test("2a — soft-mode: GET /iam/migration/status reports migrated=false", async ({ request }) => {
    const r = await request.get(`${API}/iam/migration/status`, {
      headers: { Authorization: `Bearer ${saToken}` },
    });
    expect(r.status()).toBe(200);
    const body = await r.json() as { migrated: boolean; templateRows: number; overrideRows: number };
    expect(body.migrated).toBe(false);
    expect(body.templateRows).toBe(0);  // no DB rows — templates come from code
    expect(body.overrideRows).toBe(0);
  });

  test("2b — soft-mode: SA can still reach all gated admin endpoints (SA bypasses resolver entirely)", async ({ request }) => {
    // Even without a migration log, SA must reach IAM endpoints
    const migStatusR = await request.get(`${API}/iam/migration/status`, {
      headers: { Authorization: `Bearer ${saToken}` },
    });
    expect(migStatusR.status()).toBe(200);

    const rolesR = await request.get(`${API}/iam/roles`, {
      headers: { Authorization: `Bearer ${saToken}` },
    });
    expect(rolesR.status()).toBe(200);
  });

  test("2c — soft-mode: non-SA admin accesses their own portal routes (role defaults from code)", async ({ request }) => {
    if (!plainAdminToken) { test.skip(true, "plain admin setup failed"); return; }
    // In soft-mode, resolveUserPermissions falls back to ROLE_DEFAULT_PERMISSIONS
    // admin role → admin_dashboard is true → admin can reach admin-dashboard-gated route
    const r = await request.get(`${API}/merchants`, {
      headers: { Authorization: `Bearer ${plainAdminToken}` },
    });
    // 200 = access granted; 403 = soft-mode resolver failed (regression!)
    expect(r.status()).toBe(200);
  });

  test("2d — soft-mode: GET /iam/users/:id/permissions reports migrated=false and shows code-derived effective perms", async ({ request }) => {
    if (!plainAdminId) { test.skip(true, "plain admin setup failed"); return; }
    const r = await request.get(`${API}/iam/users/${plainAdminId}/permissions`, {
      headers: { Authorization: `Bearer ${saToken}` },
    });
    expect(r.status()).toBe(200);
    const body = await r.json() as { migrated: boolean; effectivePermissions: Record<string, boolean>; overrides: unknown[] };
    expect(body.migrated).toBe(false);
    // In soft-mode, effective permissions come from ROLE_DEFAULT_PERMISSIONS for admin role
    // admin_dashboard is true for admin role by default
    expect(body.effectivePermissions["admin_dashboard"]).toBe(true);
    // IAM_READ is SA-only → false for non-SA admin
    expect(body.effectivePermissions["iam_read"]).toBe(false);
    // No overrides yet (we just rolled back)
    expect(body.overrides).toHaveLength(0);
  });

  // ── 3. Run migration (first time) ──────────────────────────────────────────

  test("3a — POST /iam/migration/run succeeds with ok=true and non-empty stats", async ({ request }) => {
    const r = await request.post(`${API}/iam/migration/run`, {
      headers: { Authorization: `Bearer ${saToken}` },
    });
    expect(r.status()).toBe(200);
    const body = await r.json() as {
      ok: boolean;
      message: string;
      totalUsers: number;
      templateRows: number;
      catalogRows: number;
      cutoffAt: string;
      alreadyMigrated?: boolean;
    };
    expect(body.ok).toBe(true);
    // First run: alreadyMigrated should be absent or false
    expect(body.alreadyMigrated).not.toBe(true);
    expect(body.totalUsers).toBeGreaterThan(0);
    expect(body.templateRows).toBeGreaterThanOrEqual(7 * 59);
    expect(body.catalogRows).toBeGreaterThanOrEqual(59);
    expect(typeof body.cutoffAt).toBe("string");
  });

  test("3b — run is SA-only: non-SA admin gets 403", async ({ request }) => {
    if (!plainAdminToken) { test.skip(true, "plain admin setup failed"); return; }
    const r = await request.post(`${API}/iam/migration/run`, {
      headers: { Authorization: `Bearer ${plainAdminToken}` },
    });
    expect(r.status()).toBe(403);
  });

  test("3c — after run: migration status reports migrated=true with populated counts", async ({ request }) => {
    const r = await request.get(`${API}/iam/migration/status`, {
      headers: { Authorization: `Bearer ${saToken}` },
    });
    expect(r.status()).toBe(200);
    const body = await r.json() as { migrated: boolean; templateRows: number; catalogRows: number; migratedAt: string };
    expect(body.migrated).toBe(true);
    expect(body.templateRows).toBeGreaterThanOrEqual(7 * 59);
    expect(body.catalogRows).toBeGreaterThanOrEqual(59);
    expect(typeof body.migratedAt).toBe("string");
  });

  // ── 4. Idempotent re-run ────────────────────────────────────────────────────

  test("4a — idempotent: POST /iam/migration/run a second time returns alreadyMigrated=true and ok=true", async ({ request }) => {
    const r = await request.post(`${API}/iam/migration/run`, {
      headers: { Authorization: `Bearer ${saToken}` },
    });
    expect(r.status()).toBe(200);
    const body = await r.json() as { ok: boolean; alreadyMigrated: boolean; message: string };
    expect(body.ok).toBe(true);
    expect(body.alreadyMigrated).toBe(true);
    expect(body.message).toMatch(/already run/i);
  });

  test("4b — idempotent: migration status is unchanged after second run", async ({ request }) => {
    const r = await request.get(`${API}/iam/migration/status`, {
      headers: { Authorization: `Bearer ${saToken}` },
    });
    const body = await r.json() as { migrated: boolean };
    expect(body.migrated).toBe(true);
  });

  // ── 5. Resolver in hard-mode (iam_migration_log present) ───────────────────

  test("5a — hard-mode: GET /iam/users/:id/permissions reports migrated=true and DB-derived effective perms", async ({ request }) => {
    if (!plainAdminId) { test.skip(true, "plain admin setup failed"); return; }
    const r = await request.get(`${API}/iam/users/${plainAdminId}/permissions`, {
      headers: { Authorization: `Bearer ${saToken}` },
    });
    expect(r.status()).toBe(200);
    const body = await r.json() as { migrated: boolean; effectivePermissions: Record<string, boolean>; roleTemplate: Record<string, boolean> };
    expect(body.migrated).toBe(true);
    // Hard-mode: effective permissions come from role_permissions DB rows
    // admin_dashboard is true in the admin role template
    expect(body.effectivePermissions["admin_dashboard"]).toBe(true);
    // IAM_READ is SA-only → false for non-SA admin
    expect(body.effectivePermissions["iam_read"]).toBe(false);
    // roleTemplate should be populated from DB (not empty)
    expect(Object.keys(body.roleTemplate).length).toBeGreaterThanOrEqual(59);
  });

  test("5b — hard-mode: non-SA admin still has role-default access (DB-backed template)", async ({ request }) => {
    if (!plainAdminToken) { test.skip(true, "plain admin setup failed"); return; }
    // After migration, resolveUserPermissions uses DB role_permissions rows for admin
    const r = await request.get(`${API}/merchants`, {
      headers: { Authorization: `Bearer ${plainAdminToken}` },
    });
    expect(r.status()).toBe(200);
  });

  // ── 6. Super Admin bypass — always passes requirePermission ────────────────

  test("6a — SA bypasses requirePermission: reaches IAM_READ-gated endpoint in hard-mode", async ({ request }) => {
    const r = await request.get(`${API}/iam/migration/status`, {
      headers: { Authorization: `Bearer ${saToken}` },
    });
    expect(r.status()).toBe(200);
  });

  test("6b — SA bypasses requirePermission: reaches IAM_MANAGE-gated endpoint (preview) in hard-mode", async ({ request }) => {
    const r = await request.get(`${API}/iam/migration/preview`, {
      headers: { Authorization: `Bearer ${saToken}` },
    });
    expect(r.status()).toBe(200);
    const body = await r.json() as { alreadyMigrated: boolean };
    expect(body.alreadyMigrated).toBe(true);
  });

  test("6c — SA bypasses requirePermission: reaches IAM_READ-gated /iam/audit endpoint", async ({ request }) => {
    const r = await request.get(`${API}/iam/audit`, {
      headers: { Authorization: `Bearer ${saToken}` },
    });
    expect(r.status()).toBe(200);
    const body = await r.json() as { entries: unknown[]; total: number };
    expect(Array.isArray(body.entries)).toBe(true);
    expect(typeof body.total).toBe("number");
  });

  test("6d — SA bypasses requirePermission: /iam/users list in hard-mode returns 200", async ({ request }) => {
    const r = await request.get(`${API}/iam/users`, {
      headers: { Authorization: `Bearer ${saToken}` },
    });
    expect(r.status()).toBe(200);
    const body = await r.json() as { users: unknown[] };
    expect(Array.isArray(body.users)).toBe(true);
  });

  test("6e — SA effectivePermissions response is { __all__: true }", async ({ request }) => {
    // GET own-user permissions for the SA — should return __all__:true sentinel
    // First, find the SA's userId
    const meR = await request.get(`${API}/auth/me`, {
      headers: { Authorization: `Bearer ${saToken}` },
    });
    expect(meR.status()).toBe(200);
    const me = await meR.json() as { id: number };
    const saId = me.id;
    expect(typeof saId).toBe("number");

    const r = await request.get(`${API}/iam/users/${saId}/permissions`, {
      headers: { Authorization: `Bearer ${saToken}` },
    });
    expect(r.status()).toBe(200);
    const body = await r.json() as { effectivePermissions: Record<string, boolean> | { __all__: true } };
    expect(body.effectivePermissions).toHaveProperty("__all__", true);
  });

  // ── 7. Per-user override endpoints ─────────────────────────────────────────

  test("7a — PUT single override: SA can DENY admin_transactions for plain admin", async ({ request }) => {
    if (!plainAdminId) { test.skip(true, "plain admin setup failed"); return; }
    const r = await request.put(`${API}/iam/users/${plainAdminId}/permissions/admin_transactions`, {
      headers: { Authorization: `Bearer ${saToken}` },
      data: { effect: "DENY" },
    });
    expect(r.status()).toBe(200);
    const body = await r.json() as { ok: boolean; permissionKey: string; effect: string };
    expect(body.ok).toBe(true);
    expect(body.permissionKey).toBe("admin_transactions");
    expect(body.effect).toBe("DENY");
  });

  test("7b — after DENY override: GET /permissions shows admin_transactions=false for plain admin", async ({ request }) => {
    if (!plainAdminId) { test.skip(true, "plain admin setup failed"); return; }
    const r = await request.get(`${API}/iam/users/${plainAdminId}/permissions`, {
      headers: { Authorization: `Bearer ${saToken}` },
    });
    expect(r.status()).toBe(200);
    const body = await r.json() as {
      effectivePermissions: Record<string, boolean>;
      overrides: Array<{ permissionKey: string; effect: string }>;
    };
    // Effective permission should now reflect the DENY override
    expect(body.effectivePermissions["admin_transactions"]).toBe(false);
    // Override should be recorded
    const override = body.overrides.find((o) => o.permissionKey === "admin_transactions");
    expect(override).toBeDefined();
    expect(override!.effect).toBe("DENY");
  });

  test("7c — PUT single override: SA can ALLOW admin_transactions (restore) for plain admin", async ({ request }) => {
    if (!plainAdminId) { test.skip(true, "plain admin setup failed"); return; }
    // admin_transactions is in admin role default (true), so ALLOW is within envelope
    const r = await request.put(`${API}/iam/users/${plainAdminId}/permissions/admin_transactions`, {
      headers: { Authorization: `Bearer ${saToken}` },
      data: { effect: "ALLOW" },
    });
    expect(r.status()).toBe(200);
    const body = await r.json() as { ok: boolean; effect: string };
    expect(body.ok).toBe(true);
    expect(body.effect).toBe("ALLOW");
  });

  test("7d — DELETE override: SA can remove the admin_transactions override, restoring role default", async ({ request }) => {
    if (!plainAdminId) { test.skip(true, "plain admin setup failed"); return; }
    const r = await request.delete(`${API}/iam/users/${plainAdminId}/permissions/admin_transactions`, {
      headers: { Authorization: `Bearer ${saToken}` },
    });
    expect(r.status()).toBe(200);
    const body = await r.json() as { ok: boolean; removed: boolean };
    expect(body.ok).toBe(true);
    expect(body.removed).toBe(true);
  });

  test("7e — after DELETE: GET /permissions shows admin_transactions=true (role default restored)", async ({ request }) => {
    if (!plainAdminId) { test.skip(true, "plain admin setup failed"); return; }
    const r = await request.get(`${API}/iam/users/${plainAdminId}/permissions`, {
      headers: { Authorization: `Bearer ${saToken}` },
    });
    expect(r.status()).toBe(200);
    const body = await r.json() as {
      effectivePermissions: Record<string, boolean>;
      overrides: Array<{ permissionKey: string }>;
    };
    // Back to role default = true
    expect(body.effectivePermissions["admin_transactions"]).toBe(true);
    // No override for this key anymore
    const override = body.overrides.find((o) => o.permissionKey === "admin_transactions");
    expect(override).toBeUndefined();
  });

  // ── 8. Bulk override endpoint ───────────────────────────────────────────────

  test("8a — PUT /permissions/bulk: SA can apply multiple overrides in one call", async ({ request }) => {
    if (!plainAdminId) { test.skip(true, "plain admin setup failed"); return; }
    const r = await request.put(`${API}/iam/users/${plainAdminId}/permissions/bulk`, {
      headers: { Authorization: `Bearer ${saToken}` },
      data: {
        overrides: {
          admin_transactions:  "DENY",
          admin_settlements:   "DENY",
        },
      },
    });
    expect(r.status()).toBe(200);
    const body = await r.json() as { ok: boolean; applied: number; removed: number };
    expect(body.ok).toBe(true);
    expect(body.applied).toBe(2);
    expect(body.removed).toBe(0);
  });

  test("8b — after bulk DENY: both overridden keys are false in effective permissions", async ({ request }) => {
    if (!plainAdminId) { test.skip(true, "plain admin setup failed"); return; }
    const r = await request.get(`${API}/iam/users/${plainAdminId}/permissions`, {
      headers: { Authorization: `Bearer ${saToken}` },
    });
    expect(r.status()).toBe(200);
    const body = await r.json() as { effectivePermissions: Record<string, boolean> };
    expect(body.effectivePermissions["admin_transactions"]).toBe(false);
    expect(body.effectivePermissions["admin_settlements"]).toBe(false);
  });

  test("8c — PUT /permissions/bulk: SA can remove overrides by passing null values", async ({ request }) => {
    if (!plainAdminId) { test.skip(true, "plain admin setup failed"); return; }
    const r = await request.put(`${API}/iam/users/${plainAdminId}/permissions/bulk`, {
      headers: { Authorization: `Bearer ${saToken}` },
      data: {
        overrides: {
          admin_transactions: null,
          admin_settlements:  null,
        },
      },
    });
    expect(r.status()).toBe(200);
    const body = await r.json() as { ok: boolean; removed: number };
    expect(body.ok).toBe(true);
    expect(body.removed).toBe(2);
  });

  test("8d — after bulk null: overrides removed and permissions return to role defaults", async ({ request }) => {
    if (!plainAdminId) { test.skip(true, "plain admin setup failed"); return; }
    const r = await request.get(`${API}/iam/users/${plainAdminId}/permissions`, {
      headers: { Authorization: `Bearer ${saToken}` },
    });
    expect(r.status()).toBe(200);
    const body = await r.json() as {
      effectivePermissions: Record<string, boolean>;
      overrides: unknown[];
    };
    expect(body.effectivePermissions["admin_transactions"]).toBe(true);
    expect(body.effectivePermissions["admin_settlements"]).toBe(true);
    expect(body.overrides).toHaveLength(0);
  });

  // ── 9. Access-envelope guard ─────────────────────────────────────────────────

  test("9a — ALLOW of SA-only permission for non-SA admin returns 403 (access-envelope guard)", async ({ request }) => {
    if (!plainAdminId) { test.skip(true, "plain admin setup failed"); return; }
    const r = await request.put(`${API}/iam/users/${plainAdminId}/permissions/iam_read`, {
      headers: { Authorization: `Bearer ${saToken}` },
      data: { effect: "ALLOW" },
    });
    expect(r.status()).toBe(403);
    const body = await r.json() as { error: string };
    expect(body.error).toMatch(/Super Admin.only|access envelope|SA-only/i);
  });

  test("9b — ALLOW of cross-role permission (merchant key for admin) returns 403", async ({ request }) => {
    if (!plainAdminId) { test.skip(true, "plain admin setup failed"); return; }
    // merchant_dashboard is not in admin role defaults → cross-role escalation → 403
    const r = await request.put(`${API}/iam/users/${plainAdminId}/permissions/merchant_dashboard`, {
      headers: { Authorization: `Bearer ${saToken}` },
      data: { effect: "ALLOW" },
    });
    expect(r.status()).toBe(403);
    const body = await r.json() as { error: string };
    expect(body.error).toMatch(/access envelope|role/i);
  });

  test("9c — bulk ALLOW of SA-only permission for non-SA admin returns 403", async ({ request }) => {
    if (!plainAdminId) { test.skip(true, "plain admin setup failed"); return; }
    const r = await request.put(`${API}/iam/users/${plainAdminId}/permissions/bulk`, {
      headers: { Authorization: `Bearer ${saToken}` },
      data: { overrides: { iam_manage: "ALLOW" } },
    });
    expect(r.status()).toBe(403);
  });

  test("9d — DENY of SA-only permission is permitted (DENY can only reduce access)", async ({ request }) => {
    if (!plainAdminId) { test.skip(true, "plain admin setup failed"); return; }
    // DENY never escalates — guard only applies to ALLOW; a DENY of an SA-only key is valid
    const r = await request.put(`${API}/iam/users/${plainAdminId}/permissions/iam_read`, {
      headers: { Authorization: `Bearer ${saToken}` },
      data: { effect: "DENY" },
    });
    // 200 = DENY applied (no-op since key is already false, but should succeed)
    expect(r.status()).toBe(200);
    const body = await r.json() as { ok: boolean; effect: string };
    expect(body.ok).toBe(true);
    expect(body.effect).toBe("DENY");
    // Clean up the DENY override
    await request.delete(`${API}/iam/users/${plainAdminId}/permissions/iam_read`, {
      headers: { Authorization: `Bearer ${saToken}` },
    });
  });

  // ── 10. Non-SA admin cannot invoke mutating IAM endpoints ─────────────────

  test("10a — non-SA admin cannot run migration", async ({ request }) => {
    if (!plainAdminToken) { test.skip(true, "plain admin setup failed"); return; }
    const r = await request.post(`${API}/iam/migration/run`, {
      headers: { Authorization: `Bearer ${plainAdminToken}` },
    });
    expect(r.status()).toBe(403);
  });

  test("10b — non-SA admin cannot rollback migration", async ({ request }) => {
    if (!plainAdminToken) { test.skip(true, "plain admin setup failed"); return; }
    const r = await request.post(`${API}/iam/migration/rollback`, {
      headers: { Authorization: `Bearer ${plainAdminToken}` },
    });
    expect(r.status()).toBe(403);
  });

  test("10c — non-SA admin cannot update role templates", async ({ request }) => {
    if (!plainAdminToken) { test.skip(true, "plain admin setup failed"); return; }
    const r = await request.put(`${API}/iam/roles/merchant/merchant_dashboard`, {
      headers: { Authorization: `Bearer ${plainAdminToken}` },
      data: { isEnabled: true },
    });
    expect(r.status()).toBe(403);
  });

  test("10d — non-SA admin cannot set per-user permission overrides", async ({ request }) => {
    if (!plainAdminToken || !plainAdminId) { test.skip(true, "plain admin setup failed"); return; }
    const r = await request.put(`${API}/iam/users/${plainAdminId}/permissions/admin_transactions`, {
      headers: { Authorization: `Bearer ${plainAdminToken}` },
      data: { effect: "DENY" },
    });
    expect(r.status()).toBe(403);
  });

  test("10e — non-SA admin cannot sync permissions catalog", async ({ request }) => {
    if (!plainAdminToken) { test.skip(true, "plain admin setup failed"); return; }
    const r = await request.post(`${API}/iam/permissions/sync`, {
      headers: { Authorization: `Bearer ${plainAdminToken}` },
    });
    expect(r.status()).toBe(403);
  });

  // ── 11. Audit trail populated after IAM writes ────────────────────────────

  test("11a — IAM audit trail contains entries after migration run", async ({ request }) => {
    const r = await request.get(`${API}/iam/audit`, {
      headers: { Authorization: `Bearer ${saToken}` },
    });
    expect(r.status()).toBe(200);
    const body = await r.json() as { entries: Array<{ action: string }>; total: number };
    expect(body.total).toBeGreaterThan(0);
    // Should contain at least one iam_migration_run entry from earlier in this test suite
    const runEntry = body.entries.find((e) => e.action === "iam_migration_run");
    expect(runEntry).toBeDefined();
  });

  test("11b — IAM audit trail is SA-only: merchant gets 403", async ({ request }) => {
    const r = await request.get(`${API}/iam/audit`, {
      headers: { Authorization: `Bearer ${merchantToken}` },
    });
    expect(r.status()).toBe(403);
  });

  // ── 12. Rollback (second rollback in cycle) ────────────────────────────────

  test("12a — POST /iam/migration/rollback clears all IAM data and returns to soft-mode", async ({ request }) => {
    const r = await request.post(`${API}/iam/migration/rollback`, {
      headers: { Authorization: `Bearer ${saToken}` },
    });
    expect(r.status()).toBe(200);
    const body = await r.json() as {
      ok: boolean;
      message: string;
      deletedTemplateRows: number;
      deletedOverrideRows: number;
    };
    expect(body.ok).toBe(true);
    expect(body.message).toMatch(/rolled back/i);
    expect(body.deletedTemplateRows).toBeGreaterThanOrEqual(0);
    expect(body.deletedOverrideRows).toBeGreaterThanOrEqual(0);
  });

  test("12b — rollback is SA-only: non-SA admin gets 403", async ({ request }) => {
    if (!plainAdminToken) { test.skip(true, "plain admin setup failed"); return; }
    const r = await request.post(`${API}/iam/migration/rollback`, {
      headers: { Authorization: `Bearer ${plainAdminToken}` },
    });
    expect(r.status()).toBe(403);
  });

  test("12c — after rollback: migration status is migrated=false, templateRows=0, overrideRows=0", async ({ request }) => {
    const r = await request.get(`${API}/iam/migration/status`, {
      headers: { Authorization: `Bearer ${saToken}` },
    });
    expect(r.status()).toBe(200);
    const body = await r.json() as { migrated: boolean; templateRows: number; overrideRows: number };
    expect(body.migrated).toBe(false);
    expect(body.templateRows).toBe(0);
    expect(body.overrideRows).toBe(0);
  });

  test("12d — rollback with no migration present returns 409", async ({ request }) => {
    // We just rolled back; calling rollback again should return 409 (nothing to roll back)
    const r = await request.post(`${API}/iam/migration/rollback`, {
      headers: { Authorization: `Bearer ${saToken}` },
    });
    expect(r.status()).toBe(409);
    const body = await r.json() as { error: string };
    expect(body.error).toMatch(/no.*migration|nothing to roll/i);
  });

  test("12e — soft-mode after rollback: non-SA admin retains access via code defaults", async ({ request }) => {
    if (!plainAdminToken) { test.skip(true, "plain admin setup failed"); return; }
    // After rollback, soft-mode should kick in and admin keeps their access
    const r = await request.get(`${API}/merchants`, {
      headers: { Authorization: `Bearer ${plainAdminToken}` },
    });
    expect(r.status()).toBe(200);
  });

  // ── 13. Re-run after rollback ──────────────────────────────────────────────

  test("13a — POST /iam/migration/run after rollback succeeds (re-run cycle)", async ({ request }) => {
    const r = await request.post(`${API}/iam/migration/run`, {
      headers: { Authorization: `Bearer ${saToken}` },
    });
    expect(r.status()).toBe(200);
    const body = await r.json() as { ok: boolean; alreadyMigrated?: boolean; templateRows: number };
    expect(body.ok).toBe(true);
    expect(body.alreadyMigrated).not.toBe(true);
    expect(body.templateRows).toBeGreaterThanOrEqual(7 * 59);
  });

  test("13b — after re-run: migration status is migrated=true again", async ({ request }) => {
    const r = await request.get(`${API}/iam/migration/status`, {
      headers: { Authorization: `Bearer ${saToken}` },
    });
    expect(r.status()).toBe(200);
    const body = await r.json() as { migrated: boolean; templateRows: number };
    expect(body.migrated).toBe(true);
    expect(body.templateRows).toBeGreaterThanOrEqual(7 * 59);
  });

  test("13c — re-run is idempotent: third call returns alreadyMigrated=true", async ({ request }) => {
    const r = await request.post(`${API}/iam/migration/run`, {
      headers: { Authorization: `Bearer ${saToken}` },
    });
    expect(r.status()).toBe(200);
    const body = await r.json() as { ok: boolean; alreadyMigrated: boolean };
    expect(body.ok).toBe(true);
    expect(body.alreadyMigrated).toBe(true);
  });

  // ── 14. Input validation on override endpoints ────────────────────────────

  test("14a — PUT /permissions/:key with unknown permission key returns 400", async ({ request }) => {
    if (!plainAdminId) { test.skip(true, "plain admin setup failed"); return; }
    const r = await request.put(`${API}/iam/users/${plainAdminId}/permissions/nonexistent_key_xyz`, {
      headers: { Authorization: `Bearer ${saToken}` },
      data: { effect: "ALLOW" },
    });
    expect(r.status()).toBe(400);
  });

  test("14b — PUT /permissions/:key with invalid effect value returns 400", async ({ request }) => {
    if (!plainAdminId) { test.skip(true, "plain admin setup failed"); return; }
    const r = await request.put(`${API}/iam/users/${plainAdminId}/permissions/admin_transactions`, {
      headers: { Authorization: `Bearer ${saToken}` },
      data: { effect: "GRANT" },  // invalid
    });
    expect(r.status()).toBe(400);
  });

  test("14c — PUT /permissions/bulk with empty overrides object returns 400", async ({ request }) => {
    if (!plainAdminId) { test.skip(true, "plain admin setup failed"); return; }
    const r = await request.put(`${API}/iam/users/${plainAdminId}/permissions/bulk`, {
      headers: { Authorization: `Bearer ${saToken}` },
      data: { overrides: {} },
    });
    expect(r.status()).toBe(400);
  });

  test("14d — PUT /roles/:role/:key with invalid role name returns 400", async ({ request }) => {
    const r = await request.put(`${API}/iam/roles/superadmin/admin_dashboard`, {
      headers: { Authorization: `Bearer ${saToken}` },
      data: { isEnabled: true },
    });
    expect(r.status()).toBe(400);
  });
});
