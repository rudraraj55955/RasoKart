/**
 * razorpay-credential-save-iam.spec.ts
 *
 * Pins the IAM permission gate on the Razorpay credential-save path
 * (`PUT /api/admin/razorpay/config`) in adminRazorpay.ts.
 *
 * The routes are protected by:
 *   GET /config → requirePermission(["admin_razorpay", "razorpay_settings_view"])   ← OR
 *   PUT /config → requirePermission(["admin_razorpay", "razorpay_settings_manage"]) ← OR
 *
 * admin_razorpay is a SUPER_ADMIN_ONLY permission — it cannot be granted to a
 * regular admin via the REST IAM endpoint (access-envelope guard → 403).  A
 * regular admin without an explicit DB-level ALLOW override therefore always
 * gets 403 on all Razorpay routes.
 *
 * This suite uses the DENY pattern for the "restricted admin" cases (a fresh
 * regular admin starts with zero Razorpay permissions — the restriction comes
 * from the role's absence of admin_razorpay, not an explicit DENY) and a
 * DB-level ALLOW insert for the "permitted admin" case (mirroring how test 13
 * in razorpay-iam-gates.spec.ts grants razorpay_refunds_view to a plain admin).
 *
 *  ✓ Unauthenticated PUT /config → 401
 *  ✓ Unauthenticated GET /config → 401
 *  ✓ Regular admin (no admin_razorpay) → 403 on GET and PUT
 *  ✓  └─ 403 body includes permissionRequired array with the gate keys
 *  ✓ Super Admin → non-403 on GET and PUT
 *  ✓ Admin with admin_razorpay ALLOW (DB override) → non-403 on GET and PUT
 *  ✓ Merchant → 403
 *  ✓ GET /config never exposes raw Razorpay key values
 *  ✓ Config unchanged after suite (no state mutation)
 *
 * Routes tested:
 *   GET  /api/admin/razorpay/config  — credential presence check (read)
 *   PUT  /api/admin/razorpay/config  — credential-save (write, the primary gate)
 *
 * State safety:
 *   PUT /config with an empty body {} updates nothing (all fields are optional).
 *   The original config snapshot taken in beforeAll is verified at the end.
 *   All fixture users and DB overrides are cleaned up in afterAll.
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
  if (status < 200 || status >= 300) throw new Error(`Login failed for ${email}: HTTP ${status} ${bodyText}`);
  return (JSON.parse(bodyText) as { token: string }).token;
}

// ── constants ─────────────────────────────────────────────────────────────────

const ADMIN_EMAIL    = "admin@rasokart.com";
const ADMIN_PASS     = "Admin@123456";
const MERCHANT_EMAIL = "merchant@demo.com";
const MERCHANT_PASS  = "Merchant@123456";

// Unique fixture emails — scoped to avoid collision with other spec files.
const TEST_RESTRICTED_ADMIN_EMAIL = "test_e2e_rzp_cred_restricted@rzp-cred-iam.local";
const TEST_PERMITTED_ADMIN_EMAIL  = "test_e2e_rzp_cred_permitted@rzp-cred-iam.local";
const TEST_PASS = "TestRzpCred@12345";

// Shape returned by GET /api/admin/razorpay/config
interface RazorpayConfig {
  enabled: boolean;
  minAmount: number;
  maxAmount: number;
  dailyLimit: number;
  keyIdConfigured: boolean;
  keySecretConfigured: boolean;
  webhookSecretConfigured: boolean;
}

// ── suite ─────────────────────────────────────────────────────────────────────

test.describe("Razorpay credential-save IAM gate", () => {
  let saToken: string;
  let restrictedAdminToken: string; // regular admin — zero Razorpay perms
  let permittedAdminToken: string;  // regular admin + admin_razorpay ALLOW (DB insert)
  let merchantToken: string;

  let restrictedAdminId: number | null = null;
  let permittedAdminId:  number | null = null;

  // Snapshot of Razorpay config taken before tests run; verified at the end.
  let originalConfig: RazorpayConfig;

  // ── setup ──────────────────────────────────────────────────────────────────

  test.beforeAll(async () => {
    // Clear rate limits so login calls don't hit the limiter.
    try {
      execSync(`psql "${process.env["DATABASE_URL"]}" -c "DELETE FROM rate_limit_hits;"`, { stdio: "pipe" });
    } catch { /* best-effort */ }

    [saToken, merchantToken] = await Promise.all([
      login(ADMIN_EMAIL, ADMIN_PASS),
      login(MERCHANT_EMAIL, MERCHANT_PASS),
    ]);

    // ── Snapshot existing Razorpay config ─────────────────────────────────────
    {
      const ctx = await apiRequest.newContext();
      const r = await ctx.get(`${API}/admin/razorpay/config`, {
        headers: { Authorization: `Bearer ${saToken}` },
      });
      if (r.status() !== 200) {
        await ctx.dispose();
        throw new Error(`Could not snapshot Razorpay config before test run: HTTP ${r.status()}`);
      }
      originalConfig = await r.json() as RazorpayConfig;
      await ctx.dispose();
    }

    // ── Create restricted admin ───────────────────────────────────────────────
    // role=admin, isSuperAdmin=false.  admin_razorpay is a SA-only permission
    // and is NOT in the default admin role_permissions, so this user already
    // has zero Razorpay access — no explicit DENY override is needed.
    {
      execSync(
        `psql "${process.env["DATABASE_URL"]}" -c "DELETE FROM user_permissions WHERE user_id IN (SELECT id FROM users WHERE email = '${TEST_RESTRICTED_ADMIN_EMAIL}'); DELETE FROM users WHERE email = '${TEST_RESTRICTED_ADMIN_EMAIL}';"`,
        { stdio: "pipe" },
      );
      const ctx = await apiRequest.newContext();
      const r = await ctx.post(`${API}/users`, {
        data: {
          email: TEST_RESTRICTED_ADMIN_EMAIL,
          password: TEST_PASS,
          name: "Razorpay Cred Restricted Admin e2e",
          role: "admin",
        },
        headers: { Authorization: `Bearer ${saToken}` },
      });
      const status = r.status();
      if (status !== 200 && status !== 201) {
        const body = await r.text();
        await ctx.dispose();
        throw new Error(`Failed to create restricted admin fixture: HTTP ${status} ${body}`);
      }
      const body = await r.json() as { id: number };
      restrictedAdminId = body.id;
      await ctx.dispose();
    }

    execSync(`psql "${process.env["DATABASE_URL"]}" -c "DELETE FROM rate_limit_hits;"`, { stdio: "pipe" });
    restrictedAdminToken = await login(TEST_RESTRICTED_ADMIN_EMAIL, TEST_PASS);

    // ── Create permitted admin ────────────────────────────────────────────────
    // admin_razorpay is SA-only, so the REST IAM endpoint would reject an ALLOW
    // override (access-envelope guard → 403).  We insert directly into
    // user_permissions — same approach as test 13 in razorpay-iam-gates.spec.ts —
    // to verify that the *route-level* permission check honours it.
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
          name: "Razorpay Cred Permitted Admin e2e",
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

    // Insert the ALLOW override directly — bypasses the REST access-envelope
    // guard so we can confirm the route-level check honours it.
    execSync(
      `psql "${process.env["DATABASE_URL"]}" -c "INSERT INTO user_permissions (user_id, permission_key, effect) VALUES (${permittedAdminId}, 'admin_razorpay', 'ALLOW') ON CONFLICT (user_id, permission_key) DO UPDATE SET effect = 'ALLOW';"`,
      { stdio: "pipe" },
    );

    // Re-login after the DB insert so the permission resolver picks up the new
    // override on a clean request cycle.
    execSync(`psql "${process.env["DATABASE_URL"]}" -c "DELETE FROM rate_limit_hits;"`, { stdio: "pipe" });
    permittedAdminToken = await login(TEST_PERMITTED_ADMIN_EMAIL, TEST_PASS);
  });

  // ── teardown ───────────────────────────────────────────────────────────────

  test.afterAll(async () => {
    // Remove permission overrides first so FK constraints don't block user delete.
    try {
      execSync(
        `psql "${process.env["DATABASE_URL"]}" -c "DELETE FROM user_permissions WHERE user_id IN (SELECT id FROM users WHERE email IN ('${TEST_RESTRICTED_ADMIN_EMAIL}', '${TEST_PERMITTED_ADMIN_EMAIL}'));"`,
        { stdio: "pipe" },
      );
    } catch { /* best-effort */ }

    const ctx = await apiRequest.newContext();
    const toDelete: number[] = [restrictedAdminId, permittedAdminId].filter((id): id is number => id != null);
    await Promise.all(
      toDelete.map(id =>
        ctx.delete(`${API}/users/${id}`, { headers: { Authorization: `Bearer ${saToken}` } }),
      ),
    );
    await ctx.dispose();

    // Belt-and-suspenders psql cleanup in case the API delete above failed.
    try {
      execSync(
        `psql "${process.env["DATABASE_URL"]}" -c "DELETE FROM users WHERE email IN ('${TEST_RESTRICTED_ADMIN_EMAIL}', '${TEST_PERMITTED_ADMIN_EMAIL}');"`,
        { stdio: "pipe" },
      );
    } catch { /* best-effort */ }
  });

  // ── 1. Unauthenticated → 401 ───────────────────────────────────────────────

  test("unauthenticated GET /admin/razorpay/config → 401", async ({ request }) => {
    const r = await request.get(`${API}/admin/razorpay/config`);
    expect(r.status()).toBe(401);
  });

  test("unauthenticated PUT /admin/razorpay/config → 401", async ({ request }) => {
    const r = await request.put(`${API}/admin/razorpay/config`, { data: {} });
    expect(r.status()).toBe(401);
  });

  // ── 2. Super Admin → non-403 ──────────────────────────────────────────────

  test("super admin GET /admin/razorpay/config → 200", async ({ request }) => {
    const r = await request.get(`${API}/admin/razorpay/config`, {
      headers: { Authorization: `Bearer ${saToken}` },
    });
    expect(r.status()).not.toBe(401);
    expect(r.status()).not.toBe(403);
    expect(r.status()).toBe(200);
    const body = await r.json() as RazorpayConfig;
    expect(typeof body.enabled).toBe("boolean");
    expect(typeof body.keyIdConfigured).toBe("boolean");
    expect(typeof body.keySecretConfigured).toBe("boolean");
    expect(typeof body.webhookSecretConfigured).toBe("boolean");
  });

  test("super admin PUT /admin/razorpay/config → 200 (empty body, no-op)", async ({ request }) => {
    // An empty body is valid — all fields are optional; nothing is written.
    const r = await request.put(`${API}/admin/razorpay/config`, {
      data: {},
      headers: { Authorization: `Bearer ${saToken}` },
    });
    expect(r.status()).not.toBe(401);
    expect(r.status()).not.toBe(403);
    expect(r.status()).toBe(200);
  });

  // ── 3. Admin with admin_razorpay ALLOW (DB override) → non-403 ────────────

  test("permitted admin (admin_razorpay ALLOW) GET /admin/razorpay/config → non-403", async ({ request }) => {
    if (!permittedAdminToken) {
      test.skip(true, "Permitted admin setup failed — skipping");
      return;
    }
    const r = await request.get(`${API}/admin/razorpay/config`, {
      headers: { Authorization: `Bearer ${permittedAdminToken}` },
    });
    expect(r.status()).not.toBe(403);
    expect(r.status()).not.toBe(401);
    expect(r.status()).toBe(200);
    const body = await r.json() as RazorpayConfig;
    expect(typeof body.enabled).toBe("boolean");
    expect(typeof body.keyIdConfigured).toBe("boolean");
  });

  test("permitted admin (admin_razorpay ALLOW) PUT /admin/razorpay/config → non-403 (empty body, no-op)", async ({ request }) => {
    if (!permittedAdminToken) {
      test.skip(true, "Permitted admin setup failed — skipping");
      return;
    }
    const r = await request.put(`${API}/admin/razorpay/config`, {
      data: {},
      headers: { Authorization: `Bearer ${permittedAdminToken}` },
    });
    expect(r.status()).not.toBe(403);
    expect(r.status()).not.toBe(401);
    expect(r.status()).toBe(200);
  });

  // ── 4. Restricted admin (no Razorpay perms) → 403 ────────────────────────
  //
  // admin_razorpay is SA-only: a regular admin with no user_permissions
  // override starts with zero Razorpay access and must receive 403.

  test("restricted admin (no razorpay perms) GET /admin/razorpay/config → 403", async ({ request }) => {
    if (!restrictedAdminToken) {
      test.skip(true, "Restricted admin setup failed — skipping");
      return;
    }
    const r = await request.get(`${API}/admin/razorpay/config`, {
      headers: { Authorization: `Bearer ${restrictedAdminToken}` },
    });
    expect(r.status()).toBe(403);
  });

  test("restricted admin (no razorpay perms) PUT /admin/razorpay/config → 403", async ({ request }) => {
    if (!restrictedAdminToken) {
      test.skip(true, "Restricted admin setup failed — skipping");
      return;
    }
    const r = await request.put(`${API}/admin/razorpay/config`, {
      data: {},
      headers: { Authorization: `Bearer ${restrictedAdminToken}` },
    });
    expect(r.status()).toBe(403);
  });

  // ── 5. 403 body shape — permissionRequired array ──────────────────────────
  //
  // requirePermission() must include the keys array in the 403 body so callers
  // can identify exactly which gate was hit.  This pins the contract so a
  // future router split or middleware refactor cannot silently drop the field.

  test("403 body for restricted admin GET /config includes permissionRequired array", async ({ request }) => {
    if (!restrictedAdminToken) {
      test.skip(true, "Restricted admin setup failed — skipping");
      return;
    }
    const r = await request.get(`${API}/admin/razorpay/config`, {
      headers: { Authorization: `Bearer ${restrictedAdminToken}` },
    });
    expect(r.status()).toBe(403);
    const body = await r.json() as { error: string; permissionRequired?: string[]; mode?: string };
    expect(body.error).toBeTruthy();
    expect(Array.isArray(body.permissionRequired)).toBe(true);
    // GET /config gate: requirePermission(["admin_razorpay", "razorpay_settings_view"])
    expect(body.permissionRequired).toContain("admin_razorpay");
    expect(body.permissionRequired).toContain("razorpay_settings_view");
  });

  test("403 body for restricted admin PUT /config includes permissionRequired array", async ({ request }) => {
    if (!restrictedAdminToken) {
      test.skip(true, "Restricted admin setup failed — skipping");
      return;
    }
    const r = await request.put(`${API}/admin/razorpay/config`, {
      data: {},
      headers: { Authorization: `Bearer ${restrictedAdminToken}` },
    });
    expect(r.status()).toBe(403);
    const body = await r.json() as { error: string; permissionRequired?: string[]; mode?: string };
    expect(body.error).toBeTruthy();
    expect(Array.isArray(body.permissionRequired)).toBe(true);
    // PUT /config gate: requirePermission(["admin_razorpay", "razorpay_settings_manage"])
    expect(body.permissionRequired).toContain("admin_razorpay");
    expect(body.permissionRequired).toContain("razorpay_settings_manage");
  });

  // ── 6. Merchant → 403 ─────────────────────────────────────────────────────

  test("merchant GET /admin/razorpay/config → 403", async ({ request }) => {
    const r = await request.get(`${API}/admin/razorpay/config`, {
      headers: { Authorization: `Bearer ${merchantToken}` },
    });
    expect(r.status()).toBe(403);
  });

  test("merchant PUT /admin/razorpay/config → 403", async ({ request }) => {
    const r = await request.put(`${API}/admin/razorpay/config`, {
      data: {},
      headers: { Authorization: `Bearer ${merchantToken}` },
    });
    expect(r.status()).toBe(403);
  });

  // ── 7. Credential masking — GET /config never exposes raw keys ────────────

  test("GET /config response never exposes raw Razorpay key values", async ({ request }) => {
    const r = await request.get(`${API}/admin/razorpay/config`, {
      headers: { Authorization: `Bearer ${saToken}` },
    });
    expect(r.status()).toBe(200);
    const bodyText = await r.text();
    // Raw key patterns must never appear in the response body.
    expect(bodyText).not.toMatch(/rzp_live_[A-Za-z0-9]+/);
    expect(bodyText).not.toMatch(/rzp_test_[A-Za-z0-9]+/);
    expect(bodyText).not.toMatch(/RAZORPAY_KEY_SECRET/i);
    // Response must use boolean presence flags, not raw credential strings.
    const body = JSON.parse(bodyText) as RazorpayConfig;
    expect(typeof body.keyIdConfigured).toBe("boolean");
    expect(typeof body.keySecretConfigured).toBe("boolean");
    expect(typeof body.webhookSecretConfigured).toBe("boolean");
  });

  // ── 8. Config unchanged after suite ──────────────────────────────────────
  //
  // All PUT calls in this suite used an empty body {}, so no fields were
  // written.  Confirm the Razorpay config matches the pre-test snapshot.

  test("Razorpay config unchanged after suite (no state mutation)", async ({ request }) => {
    const r = await request.get(`${API}/admin/razorpay/config`, {
      headers: { Authorization: `Bearer ${saToken}` },
    });
    expect(r.status()).toBe(200);
    const current = await r.json() as RazorpayConfig;
    expect(current.enabled).toBe(originalConfig.enabled);
    expect(current.minAmount).toBe(originalConfig.minAmount);
    expect(current.maxAmount).toBe(originalConfig.maxAmount);
    expect(current.dailyLimit).toBe(originalConfig.dailyLimit);
  });
});
