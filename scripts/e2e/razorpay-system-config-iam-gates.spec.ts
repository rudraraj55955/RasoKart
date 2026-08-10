/**
 * razorpay-system-config-iam-gates.spec.ts
 *
 * Verifies that the two Razorpay system-config routes enforce the
 * ADMIN_SETTINGS IAM permission gate:
 *
 *  ✓ Super Admin (admin@rasokart.com, isSuperAdmin=true) → non-403 on all routes
 *  ✓ Regular admin with admin_settings DENIED via user_permissions → 403 on all routes
 *  ✓ Regular admin with admin_settings from the role (default) → 200 on GET/PUT
 *  ✓ Merchant → 403 on all routes
 *  ✓ Unauthenticated → 401 on all routes
 *
 * Routes tested (2):
 *   GET  /api/system-config/razorpay
 *   PUT  /api/system-config/razorpay
 *
 * The router applies `requirePermission(PERMISSIONS.ADMIN_SETTINGS)` at the
 * router level (systemConfig.ts), so every route on the router is protected.
 * This test pins that protection independently of the granular Razorpay
 * permission gates in adminRazorpay.ts so a future refactor (e.g. moving the
 * routes to a separate router) cannot silently drop the admin_settings guard.
 *
 * Note: admin_settings IS enabled in the default admin role_permissions row.
 * To get a non-permitted admin we insert a DENY override via user_permissions,
 * exactly mirroring how the production IAM system revokes individual permissions.
 *
 * State safety: the PUT tests use the existing `enabled` value read from the
 * server in beforeAll, so they are effectively a no-op for the enabled flag.
 * The original Razorpay config is fully restored in afterAll.
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

const TEST_DENIED_ADMIN_EMAIL    = "test_e2e_rzp_sc_denied@razorpay-sc-iam.local";
const TEST_PERMITTED_ADMIN_EMAIL = "test_e2e_rzp_sc_permitted@razorpay-sc-iam.local";
const TEST_PASS = "TestRzpSc@12345";

// Shape returned by GET /api/system-config/razorpay
interface RazorpaySystemConfig {
  enabled: boolean;
  minAmount: number;
  maxAmount: number;
  dailyLimit: number;
  keyIdSet: boolean;
  keySecretSet: boolean;
  webhookSecretSet: boolean;
}

// ── suite ─────────────────────────────────────────────────────────────────────

test.describe("Razorpay system-config IAM Gates", () => {
  let saToken: string;
  let deniedAdminToken: string;    // admin with admin_settings DENY override
  let permittedAdminToken: string; // admin with admin_settings from role (default)
  let merchantToken: string;

  let deniedAdminId: number;
  let permittedAdminId: number;

  // Snapshot of Razorpay config taken before tests run; restored in afterAll.
  let originalConfig: RazorpaySystemConfig;

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

    // ── Snapshot existing Razorpay system config ──────────────────────────────
    // Restore in afterAll so PUT tests are truly non-destructive.
    {
      const ctx = await apiRequest.newContext();
      const r = await ctx.get(`${API}/system-config/razorpay`, {
        headers: { Authorization: `Bearer ${saToken}` },
      });
      if (r.status() !== 200) {
        await ctx.dispose();
        throw new Error(`Could not snapshot Razorpay system-config before test run: HTTP ${r.status()}`);
      }
      originalConfig = await r.json() as RazorpaySystemConfig;
      await ctx.dispose();
    }

    // ── Create denied admin ───────────────────────────────────────────────────
    // role=admin, isSuperAdmin=false.  admin_settings IS enabled in the default
    // admin role_permissions row.  We explicitly DENY it via user_permissions to
    // simulate a restricted admin (e.g. one whose settings access was revoked).
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
          name: "Razorpay SC Denied Admin e2e",
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
          name: "Razorpay SC Permitted Admin e2e",
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
    // Restore Razorpay system config to exactly what it was before this suite.
    if (originalConfig && saToken) {
      try {
        const ctx = await apiRequest.newContext();
        await ctx.put(`${API}/system-config/razorpay`, {
          data: {
            enabled:    originalConfig.enabled,
            minAmount:  originalConfig.minAmount,
            maxAmount:  originalConfig.maxAmount,
            dailyLimit: originalConfig.dailyLimit,
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

  test("unauthenticated GET /system-config/razorpay → 401", async ({ request }) => {
    const r = await request.get(`${API}/system-config/razorpay`);
    expect(r.status()).toBe(401);
  });

  test("unauthenticated PUT /system-config/razorpay → 401", async ({ request }) => {
    const r = await request.put(`${API}/system-config/razorpay`, { data: {} });
    expect(r.status()).toBe(401);
  });

  // ── 2. Super Admin → non-403 on all routes ─────────────────────────────────

  test("super admin GET /system-config/razorpay → 200", async ({ request }) => {
    const r = await request.get(`${API}/system-config/razorpay`, {
      headers: { Authorization: `Bearer ${saToken}` },
    });
    expect(r.status()).not.toBe(401);
    expect(r.status()).not.toBe(403);
    expect(r.status()).toBe(200);
  });

  test("super admin PUT /system-config/razorpay → 200 (restores original enabled value)", async ({ request }) => {
    const r = await request.put(`${API}/system-config/razorpay`, {
      data: { enabled: originalConfig.enabled },
      headers: { Authorization: `Bearer ${saToken}` },
    });
    expect(r.status()).not.toBe(401);
    expect(r.status()).not.toBe(403);
    expect(r.status()).toBe(200);
  });

  // ── 3. Admin with admin_settings DENIED → 403 on all routes ───────────────

  test("admin with admin_settings denied GET /system-config/razorpay → 403", async ({ request }) => {
    const r = await request.get(`${API}/system-config/razorpay`, {
      headers: { Authorization: `Bearer ${deniedAdminToken}` },
    });
    expect(r.status()).toBe(403);
    const body = await r.json() as { error: string; permissionRequired?: string[] };
    expect(body.error).toBeTruthy();
  });

  test("admin with admin_settings denied PUT /system-config/razorpay → 403", async ({ request }) => {
    const r = await request.put(`${API}/system-config/razorpay`, {
      data: { enabled: originalConfig.enabled },
      headers: { Authorization: `Bearer ${deniedAdminToken}` },
    });
    expect(r.status()).toBe(403);
    const body = await r.json() as { error: string; permissionRequired?: string[] };
    expect(body.error).toBeTruthy();
  });

  // ── 4. Admin with admin_settings (from role) → 200 ────────────────────────

  test("permitted admin GET /system-config/razorpay → 200", async ({ request }) => {
    const r = await request.get(`${API}/system-config/razorpay`, {
      headers: { Authorization: `Bearer ${permittedAdminToken}` },
    });
    expect(r.status()).toBe(200);
    const body = await r.json() as RazorpaySystemConfig;
    expect(typeof body.enabled).toBe("boolean");
    expect(typeof body.keyIdSet).toBe("boolean");
    expect(typeof body.keySecretSet).toBe("boolean");
    expect(typeof body.webhookSecretSet).toBe("boolean");
    expect(typeof body.minAmount).toBe("number");
    expect(typeof body.maxAmount).toBe("number");
    expect(typeof body.dailyLimit).toBe("number");
  });

  test("permitted admin PUT /system-config/razorpay → 200 (restores original enabled value)", async ({ request }) => {
    const r = await request.put(`${API}/system-config/razorpay`, {
      data: { enabled: originalConfig.enabled },
      headers: { Authorization: `Bearer ${permittedAdminToken}` },
    });
    expect(r.status()).toBe(200);
  });

  // ── 5. Merchant → 403 on all routes ───────────────────────────────────────

  test("merchant GET /system-config/razorpay → 403", async ({ request }) => {
    const r = await request.get(`${API}/system-config/razorpay`, {
      headers: { Authorization: `Bearer ${merchantToken}` },
    });
    expect(r.status()).toBe(403);
  });

  test("merchant PUT /system-config/razorpay → 403", async ({ request }) => {
    const r = await request.put(`${API}/system-config/razorpay`, {
      data: {},
      headers: { Authorization: `Bearer ${merchantToken}` },
    });
    expect(r.status()).toBe(403);
  });

  // ── 6. 403 response shape ──────────────────────────────────────────────────
  //
  // requirePermission() must include permissionRequired: ["admin_settings"]
  // in the 403 body so callers can identify which gate was hit.

  test("403 body for denied admin GET /razorpay includes permissionRequired=['admin_settings']", async ({ request }) => {
    const r = await request.get(`${API}/system-config/razorpay`, {
      headers: { Authorization: `Bearer ${deniedAdminToken}` },
    });
    expect(r.status()).toBe(403);
    const body = await r.json() as { error: string; permissionRequired?: string[] };
    expect(Array.isArray(body.permissionRequired)).toBe(true);
    expect(body.permissionRequired).toContain("admin_settings");
  });

  test("403 body for denied admin PUT /razorpay includes permissionRequired=['admin_settings']", async ({ request }) => {
    const r = await request.put(`${API}/system-config/razorpay`, {
      data: { enabled: originalConfig.enabled },
      headers: { Authorization: `Bearer ${deniedAdminToken}` },
    });
    expect(r.status()).toBe(403);
    const body = await r.json() as { error: string; permissionRequired?: string[] };
    expect(Array.isArray(body.permissionRequired)).toBe(true);
    expect(body.permissionRequired).toContain("admin_settings");
  });

  // ── 7. Response shape validation ──────────────────────────────────────────
  //
  // GET must never leak raw credentials; only boolean "is it configured?" flags.

  test("GET /system-config/razorpay response never exposes raw key values", async ({ request }) => {
    const r = await request.get(`${API}/system-config/razorpay`, {
      headers: { Authorization: `Bearer ${saToken}` },
    });
    expect(r.status()).toBe(200);
    const bodyText = await r.text();
    // Raw Razorpay key patterns must not appear in the response
    expect(bodyText).not.toMatch(/rzp_live_[A-Za-z0-9]+/);
    expect(bodyText).not.toMatch(/rzp_test_[A-Za-z0-9]+/);
    expect(bodyText).not.toMatch(/RAZORPAY_KEY_SECRET/i);
    // Confirm the shape uses boolean flags, not raw credential values
    const body = JSON.parse(bodyText) as RazorpaySystemConfig;
    expect(typeof body.keyIdSet).toBe("boolean");
    expect(typeof body.keySecretSet).toBe("boolean");
    expect(typeof body.webhookSecretSet).toBe("boolean");
  });

  // ── 8. Config is unchanged after suite ────────────────────────────────────
  //
  // Confirm the enabled flag is exactly what it was before any PUT in this suite.

  test("Razorpay enabled flag matches pre-test snapshot after permitted admin PUT", async ({ request }) => {
    const r = await request.get(`${API}/system-config/razorpay`, {
      headers: { Authorization: `Bearer ${saToken}` },
    });
    expect(r.status()).toBe(200);
    const current = await r.json() as RazorpaySystemConfig;
    // All PUTs in this suite used `originalConfig.enabled`, so the value must be unchanged.
    expect(current.enabled).toBe(originalConfig.enabled);
  });
});
