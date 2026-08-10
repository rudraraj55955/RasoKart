/**
 * payu-iam-gates.spec.ts
 *
 * Verifies that the PayU admin routes enforce the ADMIN_SETTINGS IAM
 * permission gate via `requirePermission(PERMISSIONS.ADMIN_SETTINGS)`:
 *
 *  ✓ Super Admin (admin@rasokart.com, isSuperAdmin=true) → non-403 on all routes
 *  ✓ Regular admin with admin_settings DENIED via user_permissions → 403 on all routes
 *  ✓ Regular admin with admin_settings from the role (default) → non-403 (200 or 400)
 *  ✓ Merchant → 403 on all routes
 *  ✓ Unauthenticated → 401 on all routes
 *
 * Routes tested (3):
 *   GET  /api/admin/payu/config     — integration status + masked credentials
 *   PUT  /api/admin/payu/config     — save/update UAT or Live credentials
 *   PUT  /api/admin/payu/settings   — toggle enabled, environment, limits
 *
 * The adminPayu router applies `requirePermission(PERMISSIONS.ADMIN_SETTINGS)`
 * at the router level (adminPayu.ts), so every route on the router is protected.
 * This test pins that protection independently of systemConfig.ts so a future
 * router split or middleware refactor cannot silently drop the guard.
 *
 * Note: admin_settings IS enabled in the default admin role_permissions row.
 * To get a non-permitted admin we insert a DENY override via user_permissions,
 * exactly mirroring how the production IAM system revokes individual permissions.
 *
 * State safety:
 *   - PUT /config with an invalid body is blocked at validation (400) for
 *     permitted users, so no credentials are actually written.
 *   - PUT /settings sends { enabled: false, environment: "uat" } which the
 *     afterAll restores to the original snapshot.
 */

import { test, expect, request as apiRequest } from "@playwright/test";
import { execSync } from "child_process";

const API = process.env["API_BASE_URL"] ?? "http://localhost:80/api";

// ── helpers ───────────────────────────────────────────────────────────────────

async function login(email: string, password: string): Promise<string> {
  const ctx = await apiRequest.newContext();
  const r = await ctx.post(`${API}/auth/login`, { data: { email, password } });
  const status = r.status();
  const bodyText = await r.text();
  await ctx.dispose();
  if (status === 429) throw new Error(`Rate limited logging in as ${email}. Clear rate_limit_hits first.`);
  if (status < 200 || status >= 300) throw new Error(`Login failed ${email}: HTTP ${status} ${bodyText}`);
  return (JSON.parse(bodyText) as { token: string }).token;
}

// ── constants ─────────────────────────────────────────────────────────────────

const ADMIN_EMAIL    = "admin@rasokart.com";
const ADMIN_PASS     = "Admin@123456";
const MERCHANT_EMAIL = "merchant@demo.com";
const MERCHANT_PASS  = "Merchant@123456";

const TEST_DENIED_ADMIN_EMAIL    = "test_e2e_payu_denied@payu-iam.local";
const TEST_PERMITTED_ADMIN_EMAIL = "test_e2e_payu_permitted@payu-iam.local";
const TEST_PASS = "TestPayu@12345";

// Shape returned by GET /api/admin/payu/config
interface PayuConfig {
  providerKey: string;
  environment: string;
  isEnabled: boolean;
  uatKeySet: boolean;
  liveKeySet: boolean;
}

// ── suite ─────────────────────────────────────────────────────────────────────

test.describe("PayU IAM Gates", () => {
  let saToken: string;
  let deniedAdminToken: string;    // admin with admin_settings DENY override
  let permittedAdminToken: string; // admin with admin_settings from role (default)
  let merchantToken: string;

  let deniedAdminId: number;
  let permittedAdminId: number;

  // Snapshot of PayU config taken before tests run; restored in afterAll.
  let originalPayuConfig: PayuConfig;

  // ── setup ──────────────────────────────────────────────────────────────────

  test.beforeAll(async () => {
    // Clear rate limits so login calls don't hit the limiter
    try {
      execSync(`psql "${process.env["DATABASE_URL"]}" -c "DELETE FROM rate_limit_hits;"`, { stdio: "pipe" });
    } catch { /* best-effort */ }

    [saToken, merchantToken] = await Promise.all([
      login(ADMIN_EMAIL, ADMIN_PASS),
      login(MERCHANT_EMAIL, MERCHANT_PASS),
    ]);

    // ── Snapshot existing PayU config ─────────────────────────────────────────
    // We restore this in afterAll so settings PUT tests are truly non-destructive.
    {
      const ctx = await apiRequest.newContext();
      const r = await ctx.get(`${API}/admin/payu/config`, {
        headers: { Authorization: `Bearer ${saToken}` },
      });
      if (r.status() !== 200) {
        await ctx.dispose();
        throw new Error(`Could not snapshot PayU config before test run: HTTP ${r.status()}`);
      }
      originalPayuConfig = await r.json() as PayuConfig;
      await ctx.dispose();
    }

    // ── Create denied admin ───────────────────────────────────────────────────
    // role=admin, isSuperAdmin=false.  admin_settings IS enabled in the default
    // admin role_permissions row.  We explicitly DENY it via user_permissions to
    // simulate a restricted admin (e.g. one whose settings access was revoked).
    // Failures here are hard errors — a silent skip would hide a broken guard.
    {
      execSync(
        `psql "${process.env["DATABASE_URL"]}" -c "DELETE FROM user_permissions WHERE user_id IN (SELECT id FROM users WHERE email = '${TEST_DENIED_ADMIN_EMAIL}'); DELETE FROM users WHERE email = '${TEST_DENIED_ADMIN_EMAIL}';"`,
        { stdio: "pipe" },
      );
      const ctx = await apiRequest.newContext();
      const r = await ctx.post(`${API}/users`, {
        data: {
          email: TEST_DENIED_ADMIN_EMAIL,
          password: TEST_PASS,
          name: "PayU Denied Admin e2e",
          role: "admin",
        },
        headers: { Authorization: `Bearer ${saToken}` },
      });
      const status = r.status();
      if (status !== 200 && status !== 201) {
        const body = await r.text();
        await ctx.dispose();
        throw new Error(`Failed to create denied admin fixture: HTTP ${status} ${body}`);
      }
      const body = await r.json() as { id: number };
      deniedAdminId = body.id;
      await ctx.dispose();
    }

    // Insert a DENY override so the resolver returns false for admin_settings.
    execSync(
      `psql "${process.env["DATABASE_URL"]}" -c "INSERT INTO user_permissions (user_id, permission_key, effect) VALUES (${deniedAdminId}, 'admin_settings', 'DENY') ON CONFLICT (user_id, permission_key) DO UPDATE SET effect = 'DENY';"`,
      { stdio: "pipe" },
    );

    execSync(`psql "${process.env["DATABASE_URL"]}" -c "DELETE FROM rate_limit_hits;"`, { stdio: "pipe" });
    deniedAdminToken = await login(TEST_DENIED_ADMIN_EMAIL, TEST_PASS);

    // ── Create permitted admin ────────────────────────────────────────────────
    // admin_settings is enabled in the default admin role_permissions row, so a
    // fresh admin already passes the permission check — no extra grant needed.
    {
      execSync(
        `psql "${process.env["DATABASE_URL"]}" -c "DELETE FROM user_permissions WHERE user_id IN (SELECT id FROM users WHERE email = '${TEST_PERMITTED_ADMIN_EMAIL}'); DELETE FROM users WHERE email = '${TEST_PERMITTED_ADMIN_EMAIL}';"`,
        { stdio: "pipe" },
      );
      const ctx = await apiRequest.newContext();
      const r = await ctx.post(`${API}/users`, {
        data: {
          email: TEST_PERMITTED_ADMIN_EMAIL,
          password: TEST_PASS,
          name: "PayU Permitted Admin e2e",
          role: "admin",
        },
        headers: { Authorization: `Bearer ${saToken}` },
      });
      const status = r.status();
      if (status !== 200 && status !== 201) {
        const body = await r.text();
        await ctx.dispose();
        throw new Error(`Failed to create permitted admin fixture: HTTP ${status} ${body}`);
      }
      const body = await r.json() as { id: number };
      permittedAdminId = body.id;
      await ctx.dispose();
    }

    execSync(`psql "${process.env["DATABASE_URL"]}" -c "DELETE FROM rate_limit_hits;"`, { stdio: "pipe" });
    permittedAdminToken = await login(TEST_PERMITTED_ADMIN_EMAIL, TEST_PASS);
  });

  // ── teardown ───────────────────────────────────────────────────────────────

  test.afterAll(async () => {
    // Restore PayU settings to exactly what they were before this suite ran.
    if (originalPayuConfig && saToken) {
      try {
        const ctx = await apiRequest.newContext();
        await ctx.put(`${API}/admin/payu/settings`, {
          data: {
            enabled:     originalPayuConfig.isEnabled,
            environment: originalPayuConfig.environment,
          },
          headers: { Authorization: `Bearer ${saToken}` },
        });
        await ctx.dispose();
      } catch { /* best-effort; config snapshot prevents silent mutation */ }
    }

    // Remove permission overrides first, then the users themselves
    try {
      execSync(
        `psql "${process.env["DATABASE_URL"]}" -c "DELETE FROM user_permissions WHERE user_id IN (SELECT id FROM users WHERE email IN ('${TEST_DENIED_ADMIN_EMAIL}', '${TEST_PERMITTED_ADMIN_EMAIL}'));"`,
        { stdio: "pipe" },
      );
    } catch { /* best-effort */ }

    const ctx = await apiRequest.newContext();
    const toDelete: number[] = [deniedAdminId, permittedAdminId].filter((id): id is number => id != null);
    await Promise.all(
      toDelete.map(id =>
        ctx.delete(`${API}/users/${id}`, { headers: { Authorization: `Bearer ${saToken}` } }),
      ),
    );
    await ctx.dispose();

    // Belt-and-suspenders psql cleanup in case the API delete above failed
    try {
      execSync(
        `psql "${process.env["DATABASE_URL"]}" -c "DELETE FROM users WHERE email IN ('${TEST_DENIED_ADMIN_EMAIL}', '${TEST_PERMITTED_ADMIN_EMAIL}');"`,
        { stdio: "pipe" },
      );
    } catch { /* best-effort */ }
  });

  // ── 1. Unauthenticated → 401 ───────────────────────────────────────────────

  test("unauthenticated GET /admin/payu/config → 401", async ({ request }) => {
    const r = await request.get(`${API}/admin/payu/config`);
    expect(r.status()).toBe(401);
  });

  test("unauthenticated PUT /admin/payu/config → 401", async ({ request }) => {
    const r = await request.put(`${API}/admin/payu/config`, { data: {} });
    expect(r.status()).toBe(401);
  });

  test("unauthenticated PUT /admin/payu/settings → 401", async ({ request }) => {
    const r = await request.put(`${API}/admin/payu/settings`, { data: {} });
    expect(r.status()).toBe(401);
  });

  // ── 2. Super Admin → non-403 on all routes ─────────────────────────────────

  test("super admin GET /admin/payu/config → 200", async ({ request }) => {
    const r = await request.get(`${API}/admin/payu/config`, {
      headers: { Authorization: `Bearer ${saToken}` },
    });
    expect(r.status()).not.toBe(401);
    expect(r.status()).not.toBe(403);
    expect(r.status()).toBe(200);
  });

  test("super admin PUT /admin/payu/config → non-403 (400 if body invalid)", async ({ request }) => {
    // SA bypasses IAM — never 401 or 403. Missing/short key+salt → 400 from validation.
    const r = await request.put(`${API}/admin/payu/config`, {
      data: {},
      headers: { Authorization: `Bearer ${saToken}` },
    });
    expect(r.status()).not.toBe(401);
    expect(r.status()).not.toBe(403);
    expect([200, 400]).toContain(r.status());
  });

  test("super admin PUT /admin/payu/settings → non-403 (restores original values)", async ({ request }) => {
    // Send the snapshotted values so this PUT is effectively a no-op.
    const r = await request.put(`${API}/admin/payu/settings`, {
      data: {
        enabled:     originalPayuConfig.isEnabled,
        environment: originalPayuConfig.environment,
      },
      headers: { Authorization: `Bearer ${saToken}` },
    });
    expect(r.status()).not.toBe(401);
    expect(r.status()).not.toBe(403);
    expect([200, 400]).toContain(r.status());
  });

  // ── 3. Admin with admin_settings DENIED → 403 on all routes ───────────────

  test("admin with admin_settings denied GET /admin/payu/config → 403", async ({ request }) => {
    const r = await request.get(`${API}/admin/payu/config`, {
      headers: { Authorization: `Bearer ${deniedAdminToken}` },
    });
    expect(r.status()).toBe(403);
    const body = await r.json() as { error: string; permissionRequired?: string[] };
    expect(body.error).toBeTruthy();
  });

  test("admin with admin_settings denied PUT /admin/payu/config → 403", async ({ request }) => {
    const r = await request.put(`${API}/admin/payu/config`, {
      data: { key: "some-key", salt: "some-salt" },
      headers: { Authorization: `Bearer ${deniedAdminToken}` },
    });
    expect(r.status()).toBe(403);
    const body = await r.json() as { error: string; permissionRequired?: string[] };
    expect(body.error).toBeTruthy();
  });

  test("admin with admin_settings denied PUT /admin/payu/settings → 403", async ({ request }) => {
    const r = await request.put(`${API}/admin/payu/settings`, {
      data: { enabled: false, environment: "uat" },
      headers: { Authorization: `Bearer ${deniedAdminToken}` },
    });
    expect(r.status()).toBe(403);
    const body = await r.json() as { error: string; permissionRequired?: string[] };
    expect(body.error).toBeTruthy();
  });

  // ── 4. Admin with admin_settings (from role) → non-403 ────────────────────

  test("permitted admin GET /admin/payu/config → 200", async ({ request }) => {
    const r = await request.get(`${API}/admin/payu/config`, {
      headers: { Authorization: `Bearer ${permittedAdminToken}` },
    });
    expect(r.status()).toBe(200);
    const body = await r.json() as PayuConfig;
    expect(body.providerKey).toBe("payu");
    expect(typeof body.isEnabled).toBe("boolean");
    expect(typeof body.uatKeySet).toBe("boolean");
  });

  test("permitted admin PUT /admin/payu/config → non-403 (400 if body invalid)", async ({ request }) => {
    // Passes the permission gate; empty body → 400 from validation — never 401/403.
    const r = await request.put(`${API}/admin/payu/config`, {
      data: {},
      headers: { Authorization: `Bearer ${permittedAdminToken}` },
    });
    expect(r.status()).not.toBe(401);
    expect(r.status()).not.toBe(403);
    expect([200, 400]).toContain(r.status());
  });

  test("permitted admin PUT /admin/payu/settings → non-403 (restores original values)", async ({ request }) => {
    const r = await request.put(`${API}/admin/payu/settings`, {
      data: {
        enabled:     originalPayuConfig.isEnabled,
        environment: originalPayuConfig.environment,
      },
      headers: { Authorization: `Bearer ${permittedAdminToken}` },
    });
    expect(r.status()).not.toBe(401);
    expect(r.status()).not.toBe(403);
    expect([200, 400]).toContain(r.status());
  });

  // ── 5. Merchant → 403 on all routes ───────────────────────────────────────

  test("merchant GET /admin/payu/config → 403", async ({ request }) => {
    const r = await request.get(`${API}/admin/payu/config`, {
      headers: { Authorization: `Bearer ${merchantToken}` },
    });
    expect(r.status()).toBe(403);
  });

  test("merchant PUT /admin/payu/config → 403", async ({ request }) => {
    const r = await request.put(`${API}/admin/payu/config`, {
      data: { key: "some-key", salt: "some-salt" },
      headers: { Authorization: `Bearer ${merchantToken}` },
    });
    expect(r.status()).toBe(403);
  });

  test("merchant PUT /admin/payu/settings → 403", async ({ request }) => {
    const r = await request.put(`${API}/admin/payu/settings`, {
      data: { enabled: false, environment: "uat" },
      headers: { Authorization: `Bearer ${merchantToken}` },
    });
    expect(r.status()).toBe(403);
  });

  // ── 6. 403 response shape ──────────────────────────────────────────────────
  //
  // requirePermission() must include permissionRequired: ["admin_settings"]
  // in the 403 body so callers can identify which gate was hit.

  test("403 body for denied admin GET /admin/payu/config includes permissionRequired=['admin_settings']", async ({ request }) => {
    const r = await request.get(`${API}/admin/payu/config`, {
      headers: { Authorization: `Bearer ${deniedAdminToken}` },
    });
    expect(r.status()).toBe(403);
    const body = await r.json() as { error: string; permissionRequired?: string[] };
    expect(Array.isArray(body.permissionRequired)).toBe(true);
    expect(body.permissionRequired).toContain("admin_settings");
  });

  test("403 body for denied admin PUT /admin/payu/settings includes permissionRequired=['admin_settings']", async ({ request }) => {
    const r = await request.put(`${API}/admin/payu/settings`, {
      data: { enabled: false, environment: "uat" },
      headers: { Authorization: `Bearer ${deniedAdminToken}` },
    });
    expect(r.status()).toBe(403);
    const body = await r.json() as { error: string; permissionRequired?: string[] };
    expect(Array.isArray(body.permissionRequired)).toBe(true);
    expect(body.permissionRequired).toContain("admin_settings");
  });

  // ── 7. Config is unchanged after suite ────────────────────────────────────
  //
  // Confirm PayU isEnabled/environment are exactly what they were before any PUT
  // in this suite.  (afterAll restores them; this test runs before afterAll.)

  test("PayU config matches pre-test snapshot after permitted admin PUT", async ({ request }) => {
    const r = await request.get(`${API}/admin/payu/config`, {
      headers: { Authorization: `Bearer ${saToken}` },
    });
    expect(r.status()).toBe(200);
    const current = await r.json() as PayuConfig;
    // All settings PUTs in this suite used the snapshotted values, so they must be unchanged.
    expect(current.isEnabled).toBe(originalPayuConfig.isEnabled);
    expect(current.environment).toBe(originalPayuConfig.environment);
  });
});
