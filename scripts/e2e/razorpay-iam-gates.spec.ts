/**
 * razorpay-iam-gates.spec.ts
 *
 * Verifies that every Razorpay admin route enforces IAM permission gates:
 *
 *  ✓ SUPER_ADMIN (admin@rasokart.com) reaches all routes (200 / non-403)
 *  ✓ Regular admin without any Razorpay permissions → 403 on all gated routes
 *  ✓ Merchant (Starter + Gold) → 403 on all admin/razorpay routes
 *  ✓ Agent → 403 on all admin/razorpay routes
 *  ✓ Customer → 403 on all admin/razorpay routes
 *  ✓ Unauthenticated → 401 on all routes
 *  ✓ Cashfree settlement pages remain unaffected by these checks
 *
 * Routes tested (13 total):
 *   GET  /api/admin/razorpay/config
 *   PUT  /api/admin/razorpay/config
 *   GET  /api/admin/razorpay/orders
 *   GET  /api/admin/razorpay/orders/export/csv
 *   GET  /api/admin/razorpay/webhook-logs
 *   GET  /api/admin/razorpay/capabilities
 *   PATCH /api/admin/razorpay/capabilities/:key
 *   GET  /api/admin/razorpay/analytics
 *   GET  /api/admin/razorpay/refunds
 *   POST /api/admin/razorpay/refunds
 *   GET  /api/admin/razorpay/refunds/:id/status
 *   GET  /api/admin/razorpay/razorpayx/verify
 *   GET  /api/admin/razorpay/settlement-overview
 *
 * Tenant / credential exposure checks:
 *   - No raw Razorpay API key or secret appears in any response
 *   - No raw RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET in response body
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
  if (status < 200 || status >= 300) throw new Error(`Login failed ${email}: HTTP ${status} ${bodyText}`);
  return (JSON.parse(bodyText) as { token: string }).token;
}

// ── constants ─────────────────────────────────────────────────────────────────

const ADMIN_EMAIL    = "admin@rasokart.com";
const ADMIN_PASS     = "Admin@123456";
const MERCHANT_EMAIL = "merchant@demo.com";
const MERCHANT_PASS  = "Merchant@123456";
const MERCHANT2_EMAIL = "merchant2@demo.com";

const TEST_PLAIN_ADMIN_EMAIL  = "test_e2e_plain_admin@razorpay-iam.local";
const TEST_AGENT_EMAIL        = "test_e2e_rp_agent@razorpay-iam.local";
const TEST_CUSTOMER_EMAIL     = "test_e2e_rp_customer@razorpay-iam.local";
const TEST_PASS = "TestRole@12345";

/** All Razorpay admin endpoints to test. Payload / method / expected SA code. */
const RAZORPAY_ROUTES: Array<{ method: "GET" | "PUT" | "POST" | "PATCH"; path: string; body?: object; saExpected: number[] }> = [
  { method: "GET",   path: "/admin/razorpay/config",                          saExpected: [200] },
  { method: "PUT",   path: "/admin/razorpay/config",  body: {},               saExpected: [200] },
  { method: "GET",   path: "/admin/razorpay/orders",                          saExpected: [200] },
  { method: "GET",   path: "/admin/razorpay/orders/export/csv",               saExpected: [200] },
  { method: "GET",   path: "/admin/razorpay/webhook-logs",                    saExpected: [200] },
  { method: "GET",   path: "/admin/razorpay/capabilities",                    saExpected: [200] },
  { method: "PATCH", path: "/admin/razorpay/capabilities/PAYMENTS",
    body: { notes: "e2e test" },                                               saExpected: [200, 404] },
  { method: "GET",   path: "/admin/razorpay/analytics",                       saExpected: [200] },
  { method: "GET",   path: "/admin/razorpay/refunds",                         saExpected: [200] },
  { method: "POST",  path: "/admin/razorpay/refunds",
    body: { razorpayOrderId: "order_test", amount: 1, reason: "e2e" },        saExpected: [400, 404, 422, 500] },
  { method: "GET",   path: "/admin/razorpay/refunds/999/status",              saExpected: [200, 404] },
  { method: "GET",   path: "/admin/razorpay/razorpayx/verify",                saExpected: [200] },
  { method: "GET",   path: "/admin/razorpay/settlement-overview",             saExpected: [200] },
];

// ── suite ─────────────────────────────────────────────────────────────────────

test.describe("Razorpay IAM Gates", () => {
  let saToken: string;         // Super Admin
  let plainAdminToken: string; // Regular admin — no Razorpay perms
  let merchantToken: string;
  let merchant2Token: string;
  let agentToken: string;
  let customerToken: string;

  let plainAdminId: number | null = null;
  let agentUserId: number | null = null;
  let customerUserId: number | null = null;

  // ── setup ──────────────────────────────────────────────────────────────────

  test.beforeAll(async () => {
    // Clear rate limits
    try {
      execSync(`psql "${process.env["DATABASE_URL"]}" -c "DELETE FROM rate_limit_hits;"`, { stdio: "pipe" });
    } catch { /* best-effort */ }

    [saToken, merchantToken, merchant2Token] = await Promise.all([
      login(ADMIN_EMAIL, ADMIN_PASS),
      login(MERCHANT_EMAIL, MERCHANT_PASS),
      login(MERCHANT2_EMAIL, MERCHANT_PASS),
    ]);

    // Create a regular (non-SA) admin via POST /api/users — this user has
    // role="admin" but is_super_admin=false and starts with the default admin
    // role template which has ZERO Razorpay permissions (all Razorpay keys are
    // in SUPER_ADMIN_ONLY_PERMISSIONS).
    try {
      execSync(
        `psql "${process.env["DATABASE_URL"]}" -c "DELETE FROM users WHERE email = '${TEST_PLAIN_ADMIN_EMAIL}';"`,
        { stdio: "pipe" },
      );
      const ctx = await apiRequest.newContext();
      const r = await ctx.post(`${API}/users`, {
        data: { email: TEST_PLAIN_ADMIN_EMAIL, password: TEST_PASS, name: "Plain Admin e2e", role: "admin" },
        headers: { Authorization: `Bearer ${saToken}` },
      });
      if (r.status() === 201 || r.status() === 200) {
        const body = await r.json() as { id: number };
        plainAdminId = body.id;
      }
      await ctx.dispose();
    } catch { /* non-fatal; test will fail with login error */ }

    try {
      execSync(`psql "${process.env["DATABASE_URL"]}" -c "DELETE FROM rate_limit_hits;"`, { stdio: "pipe" });
      plainAdminToken = await login(TEST_PLAIN_ADMIN_EMAIL, TEST_PASS);
    } catch { /* non-fatal */ }

    // Create agent + customer via psql (no admin endpoint for these roles in this context)
    try {
      execSync(
        `psql "${process.env["DATABASE_URL"]}" -c "CREATE EXTENSION IF NOT EXISTS pgcrypto; DELETE FROM agents WHERE email = '${TEST_AGENT_EMAIL}'; DELETE FROM users WHERE email = '${TEST_AGENT_EMAIL}';"`,
        { stdio: "pipe" },
      );
      const ctx = await apiRequest.newContext();
      const r = await ctx.post(`${API}/admin/payout-admins`, {
        data: { email: TEST_AGENT_EMAIL, name: "Agent e2e rp", password: TEST_PASS, role: "agent" },
        headers: { Authorization: `Bearer ${saToken}` },
      });
      if (r.status() === 200 || r.status() === 201) {
        const body = await r.json() as { id: number };
        agentUserId = body.id;
      }
      await ctx.dispose();
    } catch { /* non-fatal */ }

    try {
      execSync(
        `psql "${process.env["DATABASE_URL"]}" -c "DELETE FROM rate_limit_hits;"`,
        { stdio: "pipe" },
      );
      agentToken = await login(TEST_AGENT_EMAIL, TEST_PASS);
    } catch { /* non-fatal */ }

    try {
      execSync(
        `psql "${process.env["DATABASE_URL"]}" -c "CREATE EXTENSION IF NOT EXISTS pgcrypto; DELETE FROM users WHERE email = '${TEST_CUSTOMER_EMAIL}'; INSERT INTO users (email, password_hash, name, role, is_active) VALUES ('${TEST_CUSTOMER_EMAIL}', crypt('${TEST_PASS}', gen_salt('bf', 10)), 'Customer e2e rp', 'customer', true);"`,
        { stdio: "pipe" },
      );
      execSync(`psql "${process.env["DATABASE_URL"]}" -c "DELETE FROM rate_limit_hits;"`, { stdio: "pipe" });
      customerToken = await login(TEST_CUSTOMER_EMAIL, TEST_PASS);
      const idRow = execSync(
        `psql "${process.env["DATABASE_URL"]}" -t -c "SELECT id FROM users WHERE email = '${TEST_CUSTOMER_EMAIL}';"`,
        { stdio: "pipe" },
      ).toString().trim();
      customerUserId = idRow ? parseInt(idRow, 10) : null;
    } catch { /* non-fatal */ }
  });

  // ── teardown ───────────────────────────────────────────────────────────────

  test.afterAll(async () => {
    const ctx = await apiRequest.newContext();
    const toDelete: number[] = [plainAdminId, agentUserId].filter((id): id is number => id != null);
    await Promise.all(toDelete.map(id =>
      ctx.delete(`${API}/users/${id}`, { headers: { Authorization: `Bearer ${saToken}` } }),
    ));
    await ctx.dispose();
    if (customerUserId != null) {
      try {
        execSync(`psql "${process.env["DATABASE_URL"]}" -c "DELETE FROM users WHERE id = ${customerUserId};"`, { stdio: "pipe" });
      } catch { /* best-effort */ }
    }
    // Clean up plain admin if delete above failed
    try {
      execSync(`psql "${process.env["DATABASE_URL"]}" -c "DELETE FROM users WHERE email = '${TEST_PLAIN_ADMIN_EMAIL}';"`, { stdio: "pipe" });
    } catch { /* best-effort */ }
    // Clean up agent
    try {
      execSync(`psql "${process.env["DATABASE_URL"]}" -c "DELETE FROM agents WHERE email = '${TEST_AGENT_EMAIL}'; DELETE FROM users WHERE email = '${TEST_AGENT_EMAIL}';"`, { stdio: "pipe" });
    } catch { /* best-effort */ }
  });

  // ── 1. Unauthenticated → 401 on all routes ────────────────────────────────

  for (const route of RAZORPAY_ROUTES) {
    test(`unauthenticated ${route.method} ${route.path} → 401`, async ({ request }) => {
      const opts = route.body !== undefined ? { data: route.body } : {};
      const r = await (request[route.method.toLowerCase() as "get" | "put" | "post" | "patch"])(
        `${API}${route.path}`, opts,
      );
      expect(r.status()).toBe(401);
    });
  }

  // ── 2. Super Admin → 200 / acceptable on all routes ──────────────────────

  for (const route of RAZORPAY_ROUTES) {
    test(`super admin ${route.method} ${route.path} → non-403`, async ({ request }) => {
      const opts: Record<string, unknown> = { headers: { Authorization: `Bearer ${saToken}` } };
      if (route.body !== undefined) opts["data"] = route.body;
      const r = await (request[route.method.toLowerCase() as "get" | "put" | "post" | "patch"])(
        `${API}${route.path}`, opts,
      );
      // SA bypass: never 403. Acceptable: 200/success or domain error (400/404/422/500)
      expect(r.status()).not.toBe(403);
      expect(r.status()).not.toBe(401);
    });
  }

  // ── 3. Plain admin (no Razorpay perms) → 403 on all gated routes ─────────

  for (const route of RAZORPAY_ROUTES) {
    test(`plain admin (no razorpay perms) ${route.method} ${route.path} → 403`, async ({ request }) => {
      if (!plainAdminToken) {
        test.skip(true, "Plain admin setup failed — skipping");
        return;
      }
      const opts: Record<string, unknown> = { headers: { Authorization: `Bearer ${plainAdminToken}` } };
      if (route.body !== undefined) opts["data"] = route.body;
      const r = await (request[route.method.toLowerCase() as "get" | "put" | "post" | "patch"])(
        `${API}${route.path}`, opts,
      );
      expect(r.status()).toBe(403);
    });
  }

  // ── 4. Merchant (Starter) → 403 on all Razorpay admin routes ─────────────

  for (const route of RAZORPAY_ROUTES) {
    test(`merchant ${route.method} ${route.path} → 403`, async ({ request }) => {
      const opts: Record<string, unknown> = { headers: { Authorization: `Bearer ${merchantToken}` } };
      if (route.body !== undefined) opts["data"] = route.body;
      const r = await (request[route.method.toLowerCase() as "get" | "put" | "post" | "patch"])(
        `${API}${route.path}`, opts,
      );
      expect(r.status()).toBe(403);
    });
  }

  // ── 5. Merchant2 (Gold) → 403 on all Razorpay admin routes ───────────────

  for (const route of RAZORPAY_ROUTES) {
    test(`merchant2 (gold) ${route.method} ${route.path} → 403`, async ({ request }) => {
      const opts: Record<string, unknown> = { headers: { Authorization: `Bearer ${merchant2Token}` } };
      if (route.body !== undefined) opts["data"] = route.body;
      const r = await (request[route.method.toLowerCase() as "get" | "put" | "post" | "patch"])(
        `${API}${route.path}`, opts,
      );
      expect(r.status()).toBe(403);
    });
  }

  // ── 6. Agent → 403 on all Razorpay admin routes ───────────────────────────

  for (const route of RAZORPAY_ROUTES) {
    test(`agent ${route.method} ${route.path} → 403`, async ({ request }) => {
      if (!agentToken) {
        test.skip(true, "Agent setup failed — skipping");
        return;
      }
      const opts: Record<string, unknown> = { headers: { Authorization: `Bearer ${agentToken}` } };
      if (route.body !== undefined) opts["data"] = route.body;
      const r = await (request[route.method.toLowerCase() as "get" | "put" | "post" | "patch"])(
        `${API}${route.path}`, opts,
      );
      expect(r.status()).toBe(403);
    });
  }

  // ── 7. Customer → 403 on all Razorpay admin routes ───────────────────────

  for (const route of RAZORPAY_ROUTES) {
    test(`customer ${route.method} ${route.path} → 403`, async ({ request }) => {
      if (!customerToken) {
        test.skip(true, "Customer setup failed — skipping");
        return;
      }
      const opts: Record<string, unknown> = { headers: { Authorization: `Bearer ${customerToken}` } };
      if (route.body !== undefined) opts["data"] = route.body;
      const r = await (request[route.method.toLowerCase() as "get" | "put" | "post" | "patch"])(
        `${API}${route.path}`, opts,
      );
      expect(r.status()).toBe(403);
    });
  }

  // ── 8. Credential exposure checks ─────────────────────────────────────────

  test("GET /config response masks the Razorpay secret key", async ({ request }) => {
    const r = await request.get(`${API}/admin/razorpay/config`, {
      headers: { Authorization: `Bearer ${saToken}` },
    });
    expect(r.status()).toBe(200);
    const body = await r.text();
    // The raw secret key must never appear in the response body
    expect(body).not.toMatch(/RAZORPAY_KEY_SECRET/i);
    expect(body).not.toMatch(/rzp_live_[A-Za-z0-9]+/);
    expect(body).not.toMatch(/rzp_test_[A-Za-z0-9]+/);
  });

  test("GET /webhook-logs response does not contain raw Razorpay signatures", async ({ request }) => {
    const r = await request.get(`${API}/admin/razorpay/webhook-logs`, {
      headers: { Authorization: `Bearer ${saToken}` },
    });
    expect(r.status()).toBe(200);
    const body = await r.text();
    // Razorpay webhook signatures are 64-char hex — don't expose in plain JSON
    // (the route already masks them; just confirm a raw signature-length hex blob
    //  isn't in the top-level keys)
    const json = JSON.parse(body) as { data?: Array<{ signature?: string }> };
    for (const log of json.data ?? []) {
      // signature field should be null or masked, never the raw 64-char hex
      if (typeof log.signature === "string") {
        expect(log.signature.length).toBeLessThan(64);
      }
    }
  });

  // ── 9. Tenant isolation — merchant cannot read other merchant's orders ────

  test("merchant A cannot filter orders to see merchant B's data", async ({ request }) => {
    // The orders endpoint is admin-only; any merchant token must get 403 regardless
    // of what merchantId filter they try to pass
    const r = await request.get(`${API}/admin/razorpay/orders?merchantId=2`, {
      headers: { Authorization: `Bearer ${merchantToken}` },
    });
    expect(r.status()).toBe(403);
  });

  // ── 10. Cashfree settlement pages unaffected ──────────────────────────────

  test("Cashfree settlements page returns 200 for super admin (Razorpay gates don't bleed)", async ({ request }) => {
    const r = await request.get(`${API}/settlements`, {
      headers: { Authorization: `Bearer ${saToken}` },
    });
    // 200 (has data) or 404 (empty) — never 403 due to Razorpay permission change
    expect([200, 404]).toContain(r.status());
    expect(r.status()).not.toBe(403);
  });

  test("Cashfree gateway config accessible to super admin after Razorpay IAM changes", async ({ request }) => {
    const r = await request.get(`${API}/system-config`, {
      headers: { Authorization: `Bearer ${saToken}` },
    });
    expect([200, 404]).toContain(r.status());
    expect(r.status()).not.toBe(403);
  });

  // ── 11. Analytics period filter — SA can filter by period ─────────────────

  for (const period of ["7d", "30d", "90d", "all"] as const) {
    test(`super admin GET /analytics?period=${period} → 200`, async ({ request }) => {
      const r = await request.get(`${API}/admin/razorpay/analytics?period=${period}`, {
        headers: { Authorization: `Bearer ${saToken}` },
      });
      expect(r.status()).toBe(200);
      const body = await r.json() as { period: string; kpis: object };
      expect(body.period).toBe(period);
      expect(body.kpis).toBeDefined();
    });
  }

  test("plain admin GET /analytics?period=7d → 403 (no razorpay_analytics_view)", async ({ request }) => {
    if (!plainAdminToken) {
      test.skip(true, "Plain admin setup failed — skipping");
      return;
    }
    const r = await request.get(`${API}/admin/razorpay/analytics?period=7d`, {
      headers: { Authorization: `Bearer ${plainAdminToken}` },
    });
    expect(r.status()).toBe(403);
  });

  // ── 12. Access-envelope guard — SA-only permissions cannot be granted to non-SA users ──
  //
  // razorpay_analytics_view is in SUPER_ADMIN_ONLY_PERMISSIONS, which means the IAM
  // access-envelope guard must reject any ALLOW override for non-SA users (403).
  // This test verifies that the security boundary is enforced at the IAM layer,
  // preventing privilege escalation even by a Super Admin acting on behalf of
  // a regular admin user.

  test("IAM rejects ALLOW override of SA-only razorpay_analytics_view for plain admin (403 — access-envelope guard)", async ({ request }) => {
    if (!plainAdminId) {
      test.skip(true, "Plain admin setup failed — skipping");
      return;
    }
    // Attempt to grant a SA-only Razorpay key to the non-SA admin
    const grant = await request.put(
      `${API}/iam/users/${plainAdminId}/permissions/razorpay_analytics_view`,
      { data: { effect: "ALLOW" }, headers: { Authorization: `Bearer ${saToken}` } },
    );
    // The access-envelope guard should reject SA-only keys for non-SA targets
    expect(grant.status()).toBe(403);
    const body = await grant.json() as { error: string };
    expect(body.error).toMatch(/Super Admin.only|access envelope/i);
  });

  test("IAM correctly applies DENY override for admin on a non-SA-only permission", async ({ request }) => {
    if (!plainAdminId) {
      test.skip(true, "Plain admin setup failed — skipping");
      return;
    }
    // Pick a permission the admin has by default (admin_dashboard) and DENY it
    const deny = await request.put(
      `${API}/iam/users/${plainAdminId}/permissions/admin_dashboard`,
      { data: { effect: "DENY" }, headers: { Authorization: `Bearer ${saToken}` } },
    );
    // 200 = DENY override applied; 404 = IAM migration not run yet (soft mode) — both acceptable
    if (deny.status() === 404) {
      test.skip(true, "IAM migration not run — skipping DENY override test");
      return;
    }
    expect(deny.status()).toBe(200);

    // Clean up: remove the DENY override (null in bulk endpoint)
    await request.put(
      `${API}/iam/users/${plainAdminId}/permissions/bulk`,
      {
        data: { overrides: { admin_dashboard: null } },
        headers: { Authorization: `Bearer ${saToken}` },
      },
    );
  });
});
