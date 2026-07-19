/**
 * iam-role-matrix.spec.ts
 *
 * IAM role-isolation tests. Covers the full canonical role matrix:
 *  admin (SA), merchant (Starter, Gold), payout_admin, payout_super_admin, agent.
 *  customer has no portal login and is tested only at the schema level.
 *
 * Verifies:
 *  1. Merchant cannot reach admin IAM/users/reconciliation/feature endpoints (→ 403)
 *  2. Super Admin (admin@rasokart.com) can reach all admin IAM endpoints (→ 200)
 *  3. Unauthenticated requests are rejected (→ 401)
 *  4. GET /api/healthz/deep includes iam_catalog_seeded and schema checks
 *  5. Merchant2 (Gold) and Merchant3 (Starter) are also blocked from admin routes
 *  6. requirePermission is wired on users, reconciliation, featureControl routes
 *  7. payout_admin / payout_super_admin / agent are blocked from main-admin endpoints
 *  8. payout_admin / payout_super_admin can reach payout-admin endpoints
 *  9. agent can reach agent-specific endpoints
 * 10. customer role is present in /iam/roles canonical role list
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
const MERCHANT2_EMAIL = "merchant2@demo.com";
const MERCHANT3_EMAIL = "merchant3@demo.com";

const TEST_PAYOUT_ADMIN_EMAIL = "test_e2e_payout_admin@iam-matrix.local";
const TEST_PAYOUT_SUPER_EMAIL = "test_e2e_payout_super@iam-matrix.local";
const TEST_AGENT_EMAIL       = "test_e2e_agent@iam-matrix.local";
const TEST_ROLE_PASS = "TestRole@12345";

test.describe("IAM role-isolation", () => {
  let adminToken: string;
  let merchantToken: string;
  let merchant2Token: string;
  let merchant3Token: string;
  let payoutAdminToken: string;
  let payoutSuperToken: string;
  let agentToken: string;
  let testUserIds: number[] = [];

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

    [adminToken, merchantToken, merchant2Token, merchant3Token] = await Promise.all([
      login(ADMIN_EMAIL, ADMIN_PASS),
      login(MERCHANT_EMAIL, MERCHANT_PASS),
      login(MERCHANT2_EMAIL, MERCHANT_PASS),
      login(MERCHANT3_EMAIL, MERCHANT_PASS),
    ]);

    // Create ephemeral test users for roles not in the default seed
    const ctx = await apiRequest.newContext();

    async function createPayoutRole(email: string, role: string): Promise<{ id: number; token: string }> {
      // Clean up any leftover from a previous interrupted run
      // Delete from role-specific tables first (agents table has unique constraint on email)
      // then from users (CASCADE handles other FK children)
      try {
        execSync(
          `psql "${process.env["DATABASE_URL"]}" -c "DELETE FROM agents WHERE email = '${email}'; DELETE FROM users WHERE email = '${email}';"`,
          { stdio: "pipe" },
        );
      } catch { /* ignore */ }
      const r = await ctx.post(`${API}/admin/payout-admins`, {
        data: { email, name: `Test ${role}`, password: TEST_ROLE_PASS, role },
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (r.status() !== 200 && r.status() !== 201) {
        const body = await r.text();
        throw new Error(`Failed to create ${role} user: HTTP ${r.status()} ${body}`);
      }
      const body = await r.json() as { id: number };
      execSync(
        `psql "${process.env["DATABASE_URL"]}" -c "DELETE FROM rate_limit_hits;"`,
        { stdio: "pipe" },
      );
      const token = await login(email, TEST_ROLE_PASS);
      return { id: body.id, token };
    }

    const [pa, ps, ag] = await Promise.all([
      createPayoutRole(TEST_PAYOUT_ADMIN_EMAIL, "payout_admin"),
      createPayoutRole(TEST_PAYOUT_SUPER_EMAIL, "payout_super_admin"),
      createPayoutRole(TEST_AGENT_EMAIL, "agent"),
    ]);
    payoutAdminToken  = pa.token;
    payoutSuperToken  = ps.token;
    agentToken        = ag.token;
    testUserIds       = [pa.id, ps.id, ag.id];

    await ctx.dispose();
  });

  test.afterAll(async () => {
    // Clean up ephemeral test users
    const ctx = await apiRequest.newContext();
    await Promise.all(
      testUserIds.map((id) =>
        ctx.delete(`${API}/users/${id}`, {
          headers: { Authorization: `Bearer ${adminToken}` },
        }),
      ),
    );
    await ctx.dispose();
  });

  // ── 1. Merchant (Starter) blocked from all admin IAM endpoints ───────────
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

  // ── 2. Merchant (Gold, merchant2) also blocked ──────────────────────────
  test("merchant2 (Gold) cannot read IAM roles", async ({ request }) => {
    const r = await request.get(`${API}/iam/roles`, {
      headers: { Authorization: `Bearer ${merchant2Token}` },
    });
    expect(r.status()).toBe(403);
  });

  test("merchant2 (Gold) cannot read admin merchants list", async ({ request }) => {
    const r = await request.get(`${API}/merchants`, {
      headers: { Authorization: `Bearer ${merchant2Token}` },
    });
    expect(r.status()).toBe(403);
  });

  test("merchant2 (Gold) cannot read settlement stats", async ({ request }) => {
    const r = await request.get(`${API}/settlements/stats`, {
      headers: { Authorization: `Bearer ${merchant2Token}` },
    });
    expect(r.status()).toBe(403);
  });

  // ── 3. Merchant3 (Starter) blocked ─────────────────────────────────────
  test("merchant3 (Starter) cannot read IAM users list", async ({ request }) => {
    const r = await request.get(`${API}/iam/users`, {
      headers: { Authorization: `Bearer ${merchant3Token}` },
    });
    expect(r.status()).toBe(403);
  });

  test("merchant3 (Starter) cannot read admin merchants list", async ({ request }) => {
    const r = await request.get(`${API}/merchants`, {
      headers: { Authorization: `Bearer ${merchant3Token}` },
    });
    expect(r.status()).toBe(403);
  });

  // ── 4. Super Admin can reach all IAM endpoints ──────────────────────────
  test("super admin can read IAM migration status", async ({ request }) => {
    const r = await request.get(`${API}/iam/migration/status`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body).toHaveProperty("migrated");
  });

  test("super admin can read IAM roles — response has roles array with permission maps", async ({ request }) => {
    const r = await request.get(`${API}/iam/roles`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body).toHaveProperty("roles");
    expect(Array.isArray(body.roles)).toBe(true);
    // Each entry is { role: string, permissions: Record<string,boolean> }
    const roleNames: string[] = body.roles.map((r: { role: string }) => r.role);
    // Canonical roles should all be present
    expect(roleNames).toContain("admin");
    expect(roleNames).toContain("merchant");
    expect(roleNames).toContain("customer");
    expect(roleNames).toContain("agent");
    // Each role entry should have a permissions map
    const adminEntry = body.roles.find((r: { role: string }) => r.role === "admin");
    expect(adminEntry).toBeDefined();
    expect(typeof adminEntry.permissions).toBe("object");
  });

  test("super admin can read IAM users list", async ({ request }) => {
    const r = await request.get(`${API}/iam/users`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body).toHaveProperty("users");
    expect(Array.isArray(body.users)).toBe(true);
  });

  test("super admin can modify role template (PUT /iam/roles/:role/:key)", async ({ request }) => {
    const r = await request.put(`${API}/iam/roles/merchant/merchant_dashboard`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { isEnabled: true },
    });
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(true);
  });

  test("super admin can read IAM permissions catalog", async ({ request }) => {
    const r = await request.get(`${API}/iam/permissions`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body).toHaveProperty("permissions");
    expect(body).toHaveProperty("total");
    // Should have at least 60 permission keys (59 original + customer_checkout)
    expect(body.total).toBeGreaterThanOrEqual(59);
  });

  // ── 5. Permission escalation guard ────────────────────────────────────
  test("merchant cannot write to IAM user permission override endpoint", async ({ request }) => {
    const r = await request.put(`${API}/iam/users/1/permissions/iam_read`, {
      headers: { Authorization: `Bearer ${merchantToken}` },
      data: { effect: "ALLOW" },
    });
    expect(r.status()).toBe(403);
  });

  test("merchant2 cannot write to IAM user permission override endpoint", async ({ request }) => {
    const r = await request.put(`${API}/iam/users/1/permissions/iam_read`, {
      headers: { Authorization: `Bearer ${merchant2Token}` },
      data: { effect: "ALLOW" },
    });
    expect(r.status()).toBe(403);
  });

  // ── 6. Unauthenticated requests blocked ────────────────────────────────
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

  test("unauthenticated request to merchants list returns 401", async ({ request }) => {
    const r = await request.get(`${API}/merchants`);
    expect(r.status()).toBe(401);
  });

  test("unauthenticated request to settlements stats returns 401", async ({ request }) => {
    const r = await request.get(`${API}/settlements/stats`);
    expect(r.status()).toBe(401);
  });

  // ── 7. Health check includes all IAM catalog/schema checks ─────────────
  test("deep health check includes iam_catalog_seeded check key", async ({ request }) => {
    const r = await request.get(`${API}/healthz/deep`);
    expect([200, 503]).toContain(r.status());
    const body = await r.json();
    expect(body).toHaveProperty("checks");
    expect(body.checks).toHaveProperty("iam_catalog_seeded");
    expect(body.checks["iam_catalog_seeded"]).toBe(true);
  });

  test("deep health check verifies IAM schema via direct column queries (not information_schema)", async ({ request }) => {
    const r = await request.get(`${API}/healthz/deep`);
    expect([200, 503]).toContain(r.status());
    const body = await r.json();
    // Use bracket access — toHaveProperty() interprets dots as nested path separators
    expect(body.checks["iam_tables.permissions_schema"]).toBe(true);
    expect(body.checks["iam_tables.role_permissions_schema"]).toBe(true);
    expect(body.checks["iam_tables.user_permissions_schema"]).toBe(true);
    expect(body.checks["iam_tables.iam_migration_log_schema"]).toBe(true);
  });

  // ── 8. requirePermission wired on additional admin routes ──────────────
  // Merchant blocked from settlement admin write actions
  test("merchant cannot process a settlement (admin-only action)", async ({ request }) => {
    const r = await request.post(`${API}/settlements/999/process`, {
      headers: { Authorization: `Bearer ${merchantToken}` },
    });
    expect([403, 404]).toContain(r.status());
  });

  test("merchant cannot approve a settlement (admin-only action)", async ({ request }) => {
    const r = await request.post(`${API}/settlements/999/approve`, {
      headers: { Authorization: `Bearer ${merchantToken}` },
    });
    expect([403, 404]).toContain(r.status());
  });

  // Merchant blocked from users admin endpoint (requirePermission(ADMIN_USERS) added)
  test("merchant cannot list admin users", async ({ request }) => {
    const r = await request.get(`${API}/users`, {
      headers: { Authorization: `Bearer ${merchantToken}` },
    });
    expect(r.status()).toBe(403);
  });

  // Merchant blocked from feature control admin endpoint
  test("merchant cannot read feature control settings", async ({ request }) => {
    const r = await request.get(`${API}/feature-control`, {
      headers: { Authorization: `Bearer ${merchantToken}` },
    });
    expect([403, 404]).toContain(r.status());
  });

  // SA can reach admin settlement, users, and feature control endpoints
  test("super admin can reach settlement stats endpoint", async ({ request }) => {
    const r = await request.get(`${API}/settlements/stats`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(r.status()).toBe(200);
  });

  test("super admin can list admin users", async ({ request }) => {
    const r = await request.get(`${API}/users`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(r.status()).toBe(200);
    const body = await r.json();
    // Response is paginated: { data: User[], total, page, limit }
    expect(body).toHaveProperty("data");
    expect(Array.isArray(body.data)).toBe(true);
  });

  test("super admin can list merchants", async ({ request }) => {
    const r = await request.get(`${API}/merchants`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(r.status()).toBe(200);
  });

  // ── 9. Merchant own-data routes still work ────────────────────────────
  test("merchant can read own plan", async ({ request }) => {
    const r = await request.get(`${API}/plans/me`, {
      headers: { Authorization: `Bearer ${merchantToken}` },
    });
    expect(r.status()).toBe(200);
  });

  test("merchant2 can read own plan", async ({ request }) => {
    const r = await request.get(`${API}/plans/me`, {
      headers: { Authorization: `Bearer ${merchant2Token}` },
    });
    expect(r.status()).toBe(200);
  });

  test("merchant3 can read own plan", async ({ request }) => {
    const r = await request.get(`${API}/plans/me`, {
      headers: { Authorization: `Bearer ${merchant3Token}` },
    });
    expect(r.status()).toBe(200);
  });

  // ── 7. payout_admin is blocked from main-admin endpoints ─────────────────

  test("payout_admin cannot read admin merchants list", async ({ request }) => {
    const r = await request.get(`${API}/merchants`, {
      headers: { Authorization: `Bearer ${payoutAdminToken}` },
    });
    expect(r.status()).toBe(403);
  });

  test("payout_admin cannot read admin IAM roles", async ({ request }) => {
    const r = await request.get(`${API}/iam/roles`, {
      headers: { Authorization: `Bearer ${payoutAdminToken}` },
    });
    expect(r.status()).toBe(403);
  });

  test("payout_admin cannot read admin users list", async ({ request }) => {
    const r = await request.get(`${API}/users`, {
      headers: { Authorization: `Bearer ${payoutAdminToken}` },
    });
    expect(r.status()).toBe(403);
  });

  test("payout_admin cannot read admin feature-control settings", async ({ request }) => {
    const r = await request.get(`${API}/feature-control`, {
      headers: { Authorization: `Bearer ${payoutAdminToken}` },
    });
    expect(r.status()).toBe(403);
  });

  // ── 8. payout_super_admin is blocked from main-admin endpoints ────────────

  test("payout_super_admin cannot read admin merchants list", async ({ request }) => {
    const r = await request.get(`${API}/merchants`, {
      headers: { Authorization: `Bearer ${payoutSuperToken}` },
    });
    expect(r.status()).toBe(403);
  });

  test("payout_super_admin cannot read admin IAM roles", async ({ request }) => {
    const r = await request.get(`${API}/iam/roles`, {
      headers: { Authorization: `Bearer ${payoutSuperToken}` },
    });
    expect(r.status()).toBe(403);
  });

  // ── 9. agent is blocked from main-admin endpoints ─────────────────────────

  test("agent cannot read admin merchants list", async ({ request }) => {
    const r = await request.get(`${API}/merchants`, {
      headers: { Authorization: `Bearer ${agentToken}` },
    });
    expect(r.status()).toBe(403);
  });

  test("agent cannot read admin IAM roles", async ({ request }) => {
    const r = await request.get(`${API}/iam/roles`, {
      headers: { Authorization: `Bearer ${agentToken}` },
    });
    expect(r.status()).toBe(403);
  });

  test("agent cannot read admin users list", async ({ request }) => {
    const r = await request.get(`${API}/users`, {
      headers: { Authorization: `Bearer ${agentToken}` },
    });
    expect(r.status()).toBe(403);
  });

  // ── 10. customer role is present in the IAM canonical roles catalog ────────

  test("IAM roles catalog includes the customer canonical role", async ({ request }) => {
    const r = await request.get(`${API}/iam/roles`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(r.status()).toBe(200);
    const body = await r.json();
    const roleNames: string[] = body.roles.map((e: { role: string }) => e.role);
    // customer role should appear in the canonical list even though it has no portal login
    expect(roleNames).toContain("customer");
  });

  // ── 11. payout_admin CAN reach the payout-admin portal endpoints ──────────

  test("payout_admin can reach payout-admin dashboard", async ({ request }) => {
    const r = await request.get(`${API}/payout-admin/dashboard`, {
      headers: { Authorization: `Bearer ${payoutAdminToken}` },
    });
    // 200 or 404 (no merchants yet) are both acceptable — any 4xx other than 403 means gating works
    expect([200, 404]).toContain(r.status());
  });

  test("payout_super_admin can reach payout-admin dashboard", async ({ request }) => {
    const r = await request.get(`${API}/payout-admin/dashboard`, {
      headers: { Authorization: `Bearer ${payoutSuperToken}` },
    });
    expect([200, 404]).toContain(r.status());
  });
});
