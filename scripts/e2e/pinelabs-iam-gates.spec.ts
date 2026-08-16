/**
 * pinelabs-iam-gates.spec.ts
 *
 * Verifies that Pine Labs credential routes enforce the admin_pinelabs /
 * pinelabs_settings_manage IAM permission gate, which is Super Admin-only:
 *
 *  ✓ Super Admin (admin@rasokart.com, isSuperAdmin=true) → non-403 on all routes
 *  ✓ Regular admin without the pinelabs IAM permission → 403 on all routes
 *  ✓ Merchant → 403 on all routes
 *  ✓ Unauthenticated → 401 on all routes
 *
 * Routes tested (2):
 *   PUT  /api/provider-integrations/integrations/pinelabs
 *   POST /api/admin/pinelabs/test-credentials
 *
 * Why these are SA-only:
 *   ADMIN_PINELABS and PINELABS_SETTINGS_MANAGE are in SUPER_ADMIN_ONLY_PERMISSIONS.
 *   Regular admins never hold these keys in their role template and cannot receive
 *   an ALLOW override via the IAM API.  The providerIntegrations PUT handler has
 *   an inline isSuperAdmin guard for key === "pinelabs" and the adminPineLabs router
 *   applies requirePermission(ADMIN_PINELABS) at the router level.
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

const TEST_PLAIN_ADMIN_EMAIL = "test_e2e_plain_admin@pinelabs-iam.local";
const TEST_PASS = "TestPinelabs@12345";

/** All Pine Labs admin endpoints to test. */
const PINELABS_ROUTES: Array<{
  method: "PUT" | "POST";
  path: string;
  body?: object;
  saExpected: number[];
}> = [
  {
    method: "PUT",
    path: "/provider-integrations/integrations/pinelabs",
    // Minimal no-op body — we're testing the auth gate, not the save logic.
    // Sending an empty body avoids triggering the live-mode credential guard.
    body: {},
    saExpected: [200],
  },
  {
    method: "POST",
    path: "/admin/pinelabs/test-credentials",
    saExpected: [200],   // Returns { pass: false, message: ... } when creds not set — never 4xx
  },
];

// ── suite ─────────────────────────────────────────────────────────────────────

test.describe("Pine Labs IAM Gates", () => {
  let saToken: string;         // Super Admin
  let plainAdminToken: string; // Regular admin — no pinelabs IAM permission
  let merchantToken: string;

  let plainAdminId: number | null = null;

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

    // Create a regular (non-SA) admin.  role="admin", isSuperAdmin=false.
    // The default admin role template does NOT include admin_pinelabs or
    // pinelabs_settings_manage (both are in SUPER_ADMIN_ONLY_PERMISSIONS).
    // No additional DENY override is needed — the plain admin simply lacks
    // the key by default.
    try {
      execSync(
        `psql "${process.env["DATABASE_URL"]}" -c "DELETE FROM users WHERE email = '${TEST_PLAIN_ADMIN_EMAIL}';"`,
        { stdio: "pipe" },
      );
      const ctx = await apiRequest.newContext();
      const r = await ctx.post(`${API}/users`, {
        data: {
          email: TEST_PLAIN_ADMIN_EMAIL,
          password: TEST_PASS,
          name: "Plain Admin Pine Labs e2e",
          role: "admin",
        },
        headers: { Authorization: `Bearer ${saToken}` },
      });
      if (r.status() === 200 || r.status() === 201) {
        const body = await r.json() as { id: number };
        plainAdminId = body.id;
      }
      await ctx.dispose();
    } catch { /* non-fatal; test will fail with login error */ }

    try {
      execSync(`psql "${process.env["DATABASE_URL"]}" -c "DELETE FROM rate_limit_hits;"`, { stdio: "pipe" });
      plainAdminToken = await login(TEST_PLAIN_ADMIN_EMAIL, TEST_PASS);
    } catch { /* non-fatal */ }
  });

  // ── teardown ───────────────────────────────────────────────────────────────

  test.afterAll(async () => {
    if (plainAdminId != null) {
      try {
        const ctx = await apiRequest.newContext();
        await ctx.delete(`${API}/users/${plainAdminId}`, {
          headers: { Authorization: `Bearer ${saToken}` },
        });
        await ctx.dispose();
      } catch { /* best-effort */ }
    }
    // Safety net: direct DB cleanup in case the API delete failed.
    try {
      execSync(
        `psql "${process.env["DATABASE_URL"]}" -c "DELETE FROM users WHERE email = '${TEST_PLAIN_ADMIN_EMAIL}';"`,
        { stdio: "pipe" },
      );
    } catch { /* best-effort */ }
  });

  // ── 1. Unauthenticated → 401 on all routes ────────────────────────────────

  for (const route of PINELABS_ROUTES) {
    test(`unauthenticated ${route.method} ${route.path} → 401`, async ({ request }) => {
      const opts = route.body !== undefined ? { data: route.body } : {};
      const r = await (request[route.method.toLowerCase() as "put" | "post"])(
        `${API}${route.path}`,
        opts,
      );
      expect(r.status()).toBe(401);
    });
  }

  // ── 2. Super Admin → non-403 on all routes ────────────────────────────────

  for (const route of PINELABS_ROUTES) {
    test(`super admin ${route.method} ${route.path} → non-403`, async ({ request }) => {
      const opts: Record<string, unknown> = {
        headers: { Authorization: `Bearer ${saToken}` },
      };
      if (route.body !== undefined) opts["data"] = route.body;
      const r = await (request[route.method.toLowerCase() as "put" | "post"])(
        `${API}${route.path}`,
        opts,
      );
      // SA bypass: never 403 or 401. Acceptable: 200/success or domain error (400/422/500).
      expect(r.status()).not.toBe(403);
      expect(r.status()).not.toBe(401);
    });
  }

  // ── 3. Plain admin (no pinelabs IAM permission) → 403 ────────────────────

  for (const route of PINELABS_ROUTES) {
    test(`plain admin (no pinelabs perm) ${route.method} ${route.path} → 403`, async ({ request }) => {
      if (!plainAdminToken) {
        test.skip(true, "Plain admin setup failed — skipping");
        return;
      }
      const opts: Record<string, unknown> = {
        headers: { Authorization: `Bearer ${plainAdminToken}` },
      };
      if (route.body !== undefined) opts["data"] = route.body;
      const r = await (request[route.method.toLowerCase() as "put" | "post"])(
        `${API}${route.path}`,
        opts,
      );
      expect(r.status()).toBe(403);
    });
  }

  // ── 4. Merchant → 403 on all routes ──────────────────────────────────────

  for (const route of PINELABS_ROUTES) {
    test(`merchant ${route.method} ${route.path} → 403`, async ({ request }) => {
      const opts: Record<string, unknown> = {
        headers: { Authorization: `Bearer ${merchantToken}` },
      };
      if (route.body !== undefined) opts["data"] = route.body;
      const r = await (request[route.method.toLowerCase() as "put" | "post"])(
        `${API}${route.path}`,
        opts,
      );
      expect(r.status()).toBe(403);
    });
  }

  // ── 5. Super Admin PUT — credential save succeeds (or returns domain error, not 403) ──

  test("super admin PUT /provider-integrations/integrations/pinelabs → 200 (gate open)", async ({ request }) => {
    // Send the current environment value back as-is — the save should go through.
    // We intentionally do not change isEnabled or credentials so this is a no-op.
    const r = await request.put(
      `${API}/provider-integrations/integrations/pinelabs`,
      {
        data: { notes: "e2e gate verification — no credential change" },
        headers: { Authorization: `Bearer ${saToken}` },
      },
    );
    // 200 = save succeeded; 404 = integration not seeded yet (acceptable in CI)
    expect([200, 404]).toContain(r.status());
    expect(r.status()).not.toBe(403);
    expect(r.status()).not.toBe(401);
  });

  // ── 6. Super Admin POST test-credentials → 200 with pass/fail payload ────

  test("super admin POST /admin/pinelabs/test-credentials → 200 with structured result", async ({ request }) => {
    const r = await request.post(
      `${API}/admin/pinelabs/test-credentials`,
      { headers: { Authorization: `Bearer ${saToken}` } },
    );
    expect(r.status()).toBe(200);
    const body = await r.json() as { pass: boolean; message: string };
    // The route always returns HTTP 200 with a pass/fail payload — never a raw 4xx/5xx
    expect(typeof body.pass).toBe("boolean");
    expect(typeof body.message).toBe("string");
  });

  // ── 7. IAM access-envelope guard ─────────────────────────────────────────
  //
  // By IAM design, the Super Admin is the "absolute permission authority":
  // a SA caller MAY grant admin_pinelabs to a non-SA user (returns 200).
  // However the PUT /provider-integrations/integrations/pinelabs route uses a
  // direct isSuperAdmin check (not the permission resolver), so even a non-SA
  // user that received an ALLOW override still cannot save Pine Labs credentials
  // via that endpoint.
  //
  // These tests verify:
  //  (a) SA can write an ALLOW override for admin_pinelabs onto a non-SA user
  //      (returns 200 — the "privileged delegation" path in the IAM route)
  //  (b) The PUT /integrations/pinelabs route still blocks that user (→ 403)
  //      because its guard checks isSuperAdmin, not the permission resolver.

  test("SA can ALLOW-grant admin_pinelabs to a plain admin via IAM (200 — SA absolute authority)", async ({ request }) => {
    if (!plainAdminId) {
      test.skip(true, "Plain admin setup failed — skipping");
      return;
    }
    const grant = await request.put(
      `${API}/iam/users/${plainAdminId}/permissions/admin_pinelabs`,
      {
        data: { effect: "ALLOW" },
        headers: { Authorization: `Bearer ${saToken}` },
      },
    );
    // SA is the absolute permission authority — granting SA-only keys is permitted
    // (the guard only blocks non-SA callers from escalating).
    expect([200, 404]).toContain(grant.status());
    expect(grant.status()).not.toBe(401);
    expect(grant.status()).not.toBe(403);

    // Clean up the override so it doesn't leak into other tests.
    await request.put(
      `${API}/iam/users/${plainAdminId}/permissions/bulk`,
      {
        data: { overrides: { admin_pinelabs: null } },
        headers: { Authorization: `Bearer ${saToken}` },
      },
    );
  });

  test("PUT /integrations/pinelabs still returns 403 for plain admin even after an ALLOW override (isSuperAdmin gate)", async ({ request }) => {
    if (!plainAdminId || !plainAdminToken) {
      test.skip(true, "Plain admin setup failed — skipping");
      return;
    }

    // Temporarily grant admin_pinelabs via direct DB insert to bypass the IAM
    // API and confirm the route-level isSuperAdmin check is truly independent.
    try {
      execSync(
        `psql "${process.env["DATABASE_URL"]}" -c "INSERT INTO user_permissions (user_id, permission_key, effect) VALUES (${plainAdminId}, 'admin_pinelabs', 'ALLOW') ON CONFLICT (user_id, permission_key) DO UPDATE SET effect = 'ALLOW';"`,
        { stdio: "pipe" },
      );
    } catch {
      test.skip(true, "DB insert for admin_pinelabs override failed — skipping");
      return;
    }

    try {
      // The PUT route checks user.isSuperAdmin directly — the DB override has
      // no effect on this specific guard.
      const r = await request.put(
        `${API}/provider-integrations/integrations/pinelabs`,
        {
          data: { notes: "e2e isSuperAdmin direct-check verification" },
          headers: { Authorization: `Bearer ${plainAdminToken}` },
        },
      );
      expect(r.status()).toBe(403);
    } finally {
      // Always clean up the override.
      try {
        execSync(
          `psql "${process.env["DATABASE_URL"]}" -c "DELETE FROM user_permissions WHERE user_id = ${plainAdminId} AND permission_key = 'admin_pinelabs';"`,
          { stdio: "pipe" },
        );
      } catch { /* best-effort */ }
    }
  });

  // ── 8. POST /admin/pinelabs/test-credentials blocked even with ALLOW override ──
  //
  // adminPineLabs.ts uses requireSuperAdmin (a direct isSuperAdmin flag check),
  // NOT requirePermission.  requireSuperAdmin cannot be bypassed by granting an
  // ALLOW override — the user must literally have isSuperAdmin=true in the DB.
  // This regression test pins that invariant so a future refactor cannot silently
  // swap requireSuperAdmin back to requirePermission (which is bypassable).

  test("POST /admin/pinelabs/test-credentials still returns 403 for plain admin even with admin_pinelabs ALLOW override (requireSuperAdmin gate)", async ({ request }) => {
    if (!plainAdminId || !plainAdminToken) {
      test.skip(true, "Plain admin setup failed — skipping");
      return;
    }

    // Insert the ALLOW override directly into user_permissions.
    try {
      execSync(
        `psql "${process.env["DATABASE_URL"]}" -c "INSERT INTO user_permissions (user_id, permission_key, effect) VALUES (${plainAdminId}, 'admin_pinelabs', 'ALLOW') ON CONFLICT (user_id, permission_key) DO UPDATE SET effect = 'ALLOW';"`,
        { stdio: "pipe" },
      );
    } catch {
      test.skip(true, "DB insert for admin_pinelabs override failed — skipping");
      return;
    }

    try {
      // requireSuperAdmin checks isSuperAdmin flag directly — an ALLOW override
      // in user_permissions has zero effect.  The endpoint must still return 403.
      const r = await request.post(
        `${API}/admin/pinelabs/test-credentials`,
        { headers: { Authorization: `Bearer ${plainAdminToken}` } },
      );
      expect(r.status()).toBe(403);
    } finally {
      try {
        execSync(
          `psql "${process.env["DATABASE_URL"]}" -c "DELETE FROM user_permissions WHERE user_id = ${plainAdminId} AND permission_key = 'admin_pinelabs';"`,
          { stdio: "pipe" },
        );
      } catch { /* best-effort */ }
    }
  });
});
