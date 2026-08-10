/**
 * ekqr-cap-config.spec.ts
 *
 * Verifies that the EKQR daily cap fields (dailyLimit, minAmount, maxAmount)
 * round-trip correctly through PUT → GET /api/system-config/ekqr, and that
 * invalid values are rejected with 400.
 *
 * If a future refactor drops one of these fields from the upsert logic the
 * round-trip assertions catch it immediately instead of silently reverting to
 * the seed default.
 *
 * Tests:
 *   1. PUT custom dailyLimit/minAmount/maxAmount → GET asserts all three exact values
 *   2. Negative dailyLimit → 400
 *   3. Zero dailyLimit → 400
 *   4. Negative minAmount → 400
 *   5. Negative maxAmount → 400
 *   6. Zero maxAmount → 400
 *   7. minAmount > maxAmount → 400
 *   8. Non-numeric dailyLimit → 400
 *
 * State: original EKQR cap config is snapshotted in beforeAll and fully
 * restored in afterAll so this suite is non-destructive.
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

const ADMIN_EMAIL = "admin@rasokart.com";
const ADMIN_PASS  = "Admin@123456";

interface EkqrConfig {
  enabled: boolean;
  env: "test" | "live";
  minAmount: number;
  maxAmount: number;
  dailyLimit: number;
  apiKeySet: boolean;
  webhookSecretSet: boolean;
}

// ── suite ─────────────────────────────────────────────────────────────────────

test.describe("EKQR Cap Config – round-trip and validation", () => {
  let saToken: string;
  let originalConfig: EkqrConfig;

  // ── setup ──────────────────────────────────────────────────────────────────

  test.beforeAll(async () => {
    // Clear rate limit hits so login doesn't get throttled
    try {
      execSync(`psql "${process.env["DATABASE_URL"]}" -c "DELETE FROM rate_limit_hits;"`, { stdio: "pipe" });
    } catch { /* best-effort */ }

    saToken = await login(ADMIN_EMAIL, ADMIN_PASS);

    // Snapshot existing EKQR config so we can restore it in afterAll
    const ctx = await apiRequest.newContext();
    const r = await ctx.get(`${API}/system-config/ekqr`, {
      headers: { Authorization: `Bearer ${saToken}` },
    });
    if (r.status() !== 200) {
      await ctx.dispose();
      throw new Error(`Could not snapshot EKQR config: HTTP ${r.status()}`);
    }
    originalConfig = await r.json() as EkqrConfig;
    await ctx.dispose();
  });

  // ── teardown ───────────────────────────────────────────────────────────────

  test.afterAll(async () => {
    if (!originalConfig || !saToken) return;
    try {
      const ctx = await apiRequest.newContext();
      await ctx.put(`${API}/system-config/ekqr`, {
        data: {
          enabled:    originalConfig.enabled,
          env:        originalConfig.env,
          minAmount:  originalConfig.minAmount,
          maxAmount:  originalConfig.maxAmount,
          dailyLimit: originalConfig.dailyLimit,
        },
        headers: { Authorization: `Bearer ${saToken}` },
      });
      await ctx.dispose();
    } catch { /* best-effort; snapshot prevents silent mutation */ }
  });

  // ── 1. Round-trip: PUT custom cap values → GET asserts exact values ─────────

  test("PUT custom dailyLimit/minAmount/maxAmount → GET returns all three exact values", async ({ request }) => {
    const payload = {
      dailyLimit: 750000,
      minAmount:  25,
      maxAmount:  150000,
    };

    const putRes = await request.put(`${API}/system-config/ekqr`, {
      data: payload,
      headers: { Authorization: `Bearer ${saToken}` },
    });
    expect(putRes.status()).toBe(200);

    const getRes = await request.get(`${API}/system-config/ekqr`, {
      headers: { Authorization: `Bearer ${saToken}` },
    });
    expect(getRes.status()).toBe(200);

    const body = await getRes.json() as EkqrConfig;
    expect(body.dailyLimit).toBe(payload.dailyLimit);
    expect(body.minAmount).toBe(payload.minAmount);
    expect(body.maxAmount).toBe(payload.maxAmount);
  });

  // ── 2. dailyLimit = negative → 400 ────────────────────────────────────────

  test("PUT dailyLimit=-1 → 400", async ({ request }) => {
    const r = await request.put(`${API}/system-config/ekqr`, {
      data: { dailyLimit: -1 },
      headers: { Authorization: `Bearer ${saToken}` },
    });
    expect(r.status()).toBe(400);
    const body = await r.json() as { error: string };
    expect(body.error).toBeTruthy();
  });

  // ── 3. dailyLimit = 0 → 400 ───────────────────────────────────────────────

  test("PUT dailyLimit=0 → 400", async ({ request }) => {
    const r = await request.put(`${API}/system-config/ekqr`, {
      data: { dailyLimit: 0 },
      headers: { Authorization: `Bearer ${saToken}` },
    });
    expect(r.status()).toBe(400);
    const body = await r.json() as { error: string };
    expect(body.error).toBeTruthy();
  });

  // ── 4. minAmount = negative → 400 ─────────────────────────────────────────

  test("PUT minAmount=-5 → 400", async ({ request }) => {
    const r = await request.put(`${API}/system-config/ekqr`, {
      data: { minAmount: -5 },
      headers: { Authorization: `Bearer ${saToken}` },
    });
    expect(r.status()).toBe(400);
    const body = await r.json() as { error: string };
    expect(body.error).toBeTruthy();
  });

  // ── 5. maxAmount = negative → 400 ─────────────────────────────────────────

  test("PUT maxAmount=-100 → 400", async ({ request }) => {
    const r = await request.put(`${API}/system-config/ekqr`, {
      data: { maxAmount: -100 },
      headers: { Authorization: `Bearer ${saToken}` },
    });
    expect(r.status()).toBe(400);
    const body = await r.json() as { error: string };
    expect(body.error).toBeTruthy();
  });

  // ── 6. maxAmount = 0 → 400 ────────────────────────────────────────────────

  test("PUT maxAmount=0 → 400", async ({ request }) => {
    const r = await request.put(`${API}/system-config/ekqr`, {
      data: { maxAmount: 0 },
      headers: { Authorization: `Bearer ${saToken}` },
    });
    expect(r.status()).toBe(400);
    const body = await r.json() as { error: string };
    expect(body.error).toBeTruthy();
  });

  // ── 7. minAmount > maxAmount → 400 ────────────────────────────────────────

  test("PUT minAmount=500000 with maxAmount=1000 → 400", async ({ request }) => {
    const r = await request.put(`${API}/system-config/ekqr`, {
      data: { minAmount: 500000, maxAmount: 1000 },
      headers: { Authorization: `Bearer ${saToken}` },
    });
    expect(r.status()).toBe(400);
    const body = await r.json() as { error: string };
    expect(body.error).toBeTruthy();
  });

  // ── 8. Non-numeric dailyLimit → 400 ───────────────────────────────────────

  test("PUT dailyLimit='abc' → 400", async ({ request }) => {
    const r = await request.put(`${API}/system-config/ekqr`, {
      data: { dailyLimit: "abc" },
      headers: { Authorization: `Bearer ${saToken}` },
    });
    expect(r.status()).toBe(400);
    const body = await r.json() as { error: string };
    expect(body.error).toBeTruthy();
  });

  // ── 9. Config unchanged after all invalid requests ─────────────────────────
  //
  // Confirms the DB was not mutated by any of the 400 responses above.

  test("config values are unchanged after all rejected PUTs", async ({ request }) => {
    const r = await request.get(`${API}/system-config/ekqr`, {
      headers: { Authorization: `Bearer ${saToken}` },
    });
    expect(r.status()).toBe(200);
    const body = await r.json() as EkqrConfig;
    // The round-trip test (test 1) set these values; they should still be there.
    expect(body.dailyLimit).toBe(750000);
    expect(body.minAmount).toBe(25);
    expect(body.maxAmount).toBe(150000);
  });
});
