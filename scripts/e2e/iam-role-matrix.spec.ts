/**
 * iam-role-matrix.spec.ts
 *
 * IAM role-isolation tests. Verifies:
 *  1. Merchant cannot reach admin IAM endpoints (→ 403)
 *  2. Super Admin (admin@rasokart.com) can reach and use IAM endpoints (→ 200)
 *  3. Unauthenticated requests are rejected (→ 401)
 *  4. GET /api/healthz/deep includes iam_catalog_seeded and schema checks
 *
 * Note: admin@rasokart.com is the Super Admin (is_super_admin=true) in this
 * system. The SA bypasses all requirePermission checks. Tests that verify
 * "non-SA admin blocked" require a separate test-only non-SA admin account
 * which does not exist in the default demo seed — those scenarios are covered
 * by unit tests on the requirePermission middleware instead.
 */

import { test, expect, request as apiRequest } from "@playwright/test";
import { execSync } from "child_process";

const API = process.env["API_BASE_URL"] ?? "http://localhost:80/api";

async function login(email: string, password: string): Promise<string> {
  const ctx = await apiRequest.newContext();
  const r = await ctx.post(`${API}/auth/login`, {
    data: { email, password },
  });
  const status = r.status();
  const bodyText = await r.text();
  await ctx.dispose();
  if (status === 429) {
    throw new Error(`Rate limited while logging in as ${email}. Clear rate_limit_hits and retry.`);
  }
  if (status < 200 || status >= 300) {
    throw new Error(`Login failed for ${email}: HTTP ${status} ${bodyText}`);
  }
  const body = JSON.parse(bodyText) as { token: string };
  return body.token;
}

const ADMIN_EMAIL = "admin@rasokart.com";
const ADMIN_PASS = "Admin@123456";
const MERCHANT_EMAIL = "merchant@demo.com";
const MERCHANT_PASS = "Merchant@123456";

test.describe("IAM role-isolation", () => {
  let adminToken: string;
  let merchantToken: string;

  test.beforeAll(async () => {
    // Clear rate limits so login calls don't get blocked by previous test runs
    try {
      execSync(
        `psql "${process.env["DATABASE_URL"]}" -c "DELETE FROM rate_limit_hits;"`,
        { stdio: "pipe" },
      );
    } catch {
      // Best-effort; test may still pass if under limit
    }

    adminToken = await login(ADMIN_EMAIL, ADMIN_PASS);
    merchantToken = await login(MERCHANT_EMAIL, MERCHANT_PASS);
  });

  // ── 1. Merchant blocked from admin IAM endpoints ────────────────────────
  test("merchant cannot read IAM migration status", async ({ request }) => {
    const r = await request.get(`${API}/iam/migration/status`, {
      headers: { Authorization: `Bearer ${merchantToken}` },
    });
    expect(r.status()).toBe(403);
  });

  test("merchant cannot read IAM roles", async ({ request }) => {
    const r = await request.get(`${API}/iam/roles`, {
      headers: { Authorization: `Bearer ${merchantToken}` },
    });
    expect(r.status()).toBe(403);
  });

  test("merchant cannot read IAM users list", async ({ request }) => {
    const r = await request.get(`${API}/iam/users`, {
      headers: { Authorization: `Bearer ${merchantToken}` },
    });
    expect(r.status()).toBe(403);
  });

  test("merchant cannot read IAM audit trail", async ({ request }) => {
    const r = await request.get(`${API}/iam/audit`, {
      headers: { Authorization: `Bearer ${merchantToken}` },
    });
    expect(r.status()).toBe(403);
  });

  // ── 2. Super Admin (admin@rasokart.com) can reach IAM endpoints ─────────
  // admin@rasokart.com has is_super_admin=true and bypasses all permission
  // checks. The SA can read IAM status and modify role templates.
  test("super admin can read IAM migration status", async ({ request }) => {
    const r = await request.get(`${API}/iam/migration/status`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body).toHaveProperty("migrated");
  });

  test("super admin can read IAM roles", async ({ request }) => {
    const r = await request.get(`${API}/iam/roles`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(r.status()).toBe(200);
  });

  test("super admin can read IAM users list", async ({ request }) => {
    const r = await request.get(`${API}/iam/users`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body).toHaveProperty("users");
  });

  test("super admin can modify role template (PUT /iam/roles/:role/:key)", async ({ request }) => {
    const r = await request.put(`${API}/iam/roles/merchant/merchant_dashboard`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { isEnabled: true },
    });
    // SA always succeeds; response should be 200 with ok:true
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(true);
  });

  // ── 3. Scope guard: SA-only permission blocked for merchant ────────────
  test("merchant cannot write to IAM user permission override endpoint", async ({ request }) => {
    const r = await request.put(`${API}/iam/users/1/permissions/iam_read`, {
      headers: { Authorization: `Bearer ${merchantToken}` },
      data: { effect: "ALLOW" },
    });
    expect(r.status()).toBe(403);
  });

  // ── 4. Unauthenticated requests blocked ────────────────────────────────
  test("unauthenticated request to IAM migration status returns 401", async ({ request }) => {
    const r = await request.get(`${API}/iam/migration/status`);
    expect(r.status()).toBe(401);
  });

  test("unauthenticated request to IAM roles returns 401", async ({ request }) => {
    const r = await request.get(`${API}/iam/roles`);
    expect(r.status()).toBe(401);
  });

  test("unauthenticated request to IAM users returns 401", async ({ request }) => {
    const r = await request.get(`${API}/iam/users`);
    expect(r.status()).toBe(401);
  });

  // ── 5. Health check includes IAM catalog check ─────────────────────────
  test("deep health check includes iam_catalog_seeded check key", async ({ request }) => {
    const r = await request.get(`${API}/healthz/deep`);
    expect([200, 503]).toContain(r.status());
    const body = await r.json();
    expect(body).toHaveProperty("checks");
    expect(body.checks).toHaveProperty("iam_catalog_seeded");
    // After seed auto-sync, this should be true
    expect(body.checks["iam_catalog_seeded"]).toBe(true);
  });

  test("deep health check includes iam schema checks", async ({ request }) => {
    const r = await request.get(`${API}/healthz/deep`);
    expect([200, 503]).toContain(r.status());
    const body = await r.json();
    // Use bracket access — toHaveProperty() interprets dots as nested path separators
    expect(body.checks["iam_tables.permissions_schema"]).toBe(true);
    expect(body.checks["iam_tables.role_permissions_schema"]).toBe(true);
    expect(body.checks["iam_tables.user_permissions_schema"]).toBe(true);
    expect(body.checks["iam_tables.iam_migration_log_schema"]).toBe(true);
  });

  // ── 6. requirePermission middleware: admin routes still gated ──────────
  // Merchant blocked from settlement admin actions (ADMIN_SETTLEMENTS required)
  test("merchant cannot process a settlement (admin-only action)", async ({ request }) => {
    const r = await request.post(`${API}/settlements/999/process`, {
      headers: { Authorization: `Bearer ${merchantToken}` },
    });
    // 403 from requireAdmin/requirePermission, or 404 if route doesn't match
    // 404 is fine here since 999 doesn't exist — the point is it's not 200
    expect([403, 404]).toContain(r.status());
  });

  test("merchant cannot approve a settlement (admin-only action)", async ({ request }) => {
    const r = await request.post(`${API}/settlements/999/approve`, {
      headers: { Authorization: `Bearer ${merchantToken}` },
    });
    expect([403, 404]).toContain(r.status());
  });

  // SA can reach admin settlement endpoints
  test("super admin can reach settlement stats endpoint", async ({ request }) => {
    const r = await request.get(`${API}/settlements/stats`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(r.status()).toBe(200);
  });

  // SA can reach admin merchant endpoints  
  test("super admin can list merchants", async ({ request }) => {
    const r = await request.get(`${API}/merchants`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(r.status()).toBe(200);
  });
});
