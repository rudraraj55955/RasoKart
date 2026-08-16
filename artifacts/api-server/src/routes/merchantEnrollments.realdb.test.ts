/**
 * merchantEnrollments.realdb.test.ts — Integration tests for merchant enrollment routes.
 *
 * Uses a real Postgres DB (DATABASE_URL) and the real Express app (via generateToken)
 * so FK constraints, schemaGuard, and rate-limiter store are all exercised.
 *
 * Coverage:
 *   1. Unauthenticated access → 401
 *   2. List enrollments — returns all 12 known providers (enrolled + not_enrolled stubs)
 *   3. Merchant isolation — merchant B cannot see merchant A's enrollment
 *   4. Initiate enrollment (POST) — pending_kyc, onboarding info returned
 *   5. Category E provider → 422
 *   6. Category A provider → 422
 *   7. Credentials submission — response never exposes raw or enc:v1: value
 *   8. Credential presence flags — hasApiKey=true, encrypted blob absent from GET
 *   9. Status endpoint — no credentials in response
 *  10. Disconnect — clears credentials, sets disconnected, writes audit
 *  11. Duplicate protection — second POST upserts, no duplicate row
 *  12. PUT credentials → 404 when no enrollment exists
 *  13. DELETE → 404 when no enrollment exists
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { eq, and } from "drizzle-orm";
import {
  db,
  usersTable,
  merchantsTable,
  merchantProviderEnrollmentsTable,
} from "@workspace/db";
import { generateToken } from "../middlewares/auth";
import app from "../app";

// ── HTTP helpers ──────────────────────────────────────────────────────────────

type HttpResult = { status: number; body: unknown };

function makeRequest(
  server: http.Server,
  method: string,
  path: string,
  token: string,
  body?: unknown,
): Promise<HttpResult> {
  const addr = server.address() as { port: number };
  const data = body != null ? JSON.stringify(body) : undefined;
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: addr.port,
        path,
        method,
        headers: {
          ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}),
          Authorization: `Bearer ${token}`,
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (c: Buffer) => { raw += c.toString(); });
        res.on("end", () => {
          try { resolve({ status: res.statusCode ?? 0, body: JSON.parse(raw) }); }
          catch { resolve({ status: res.statusCode ?? 0, body: raw }); }
        });
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

// ── Test fixture helpers ──────────────────────────────────────────────────────

let server: http.Server;
let merchantIdA: number;
let merchantIdB: number;
let tokenA: string;
let tokenB: string;

const BASE = "/api/merchant/enrollments";

async function createTestMerchant(suffix: string) {
  const email = `enroll-test-${suffix}-${Date.now()}@rasokart-test.local`;
  const [merchant] = await db
    .insert(merchantsTable)
    .values({
      businessName: `Enroll Test ${suffix}`,
      contactName: "Test",
      email,
      phone: "9999999999",
      status: "active",
    })
    .returning({ id: merchantsTable.id });

  const [user] = await db
    .insert(usersTable)
    .values({ name: "Test", email, passwordHash: "x", role: "merchant", merchantId: merchant.id })
    .returning({ id: usersTable.id, email: usersTable.email, role: usersTable.role, merchantId: usersTable.merchantId });

  const token = generateToken(user as any);
  return { merchantId: merchant.id, userId: user.id, token };
}

async function cleanupMerchant(merchantId: number) {
  await db
    .delete(merchantProviderEnrollmentsTable)
    .where(eq(merchantProviderEnrollmentsTable.merchantId, merchantId));
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("merchant enrollment routes (real DB)", () => {
  before(async () => {
    server = http.createServer(app);
    await new Promise<void>(r => server.listen(0, "127.0.0.1", r));

    const a = await createTestMerchant("A");
    const b = await createTestMerchant("B");
    merchantIdA = a.merchantId;
    merchantIdB = b.merchantId;
    tokenA = a.token;
    tokenB = b.token;
  });

  after(async () => {
    await cleanupMerchant(merchantIdA);
    await cleanupMerchant(merchantIdB);
    await new Promise<void>((r, j) => server.close(e => e ? j(e) : r()));
  });

  // ── 1. Unauthenticated ────────────────────────────────────────────────────
  it("returns 401 without a token", async () => {
    const addr = server.address() as { port: number };
    const result = await new Promise<{ status: number }>((resolve, reject) => {
      const req = http.request(
        { hostname: "127.0.0.1", port: addr.port, path: BASE, method: "GET" },
        res => resolve({ status: res.statusCode ?? 0 }),
      );
      req.on("error", reject);
      req.end();
    });
    assert.ok(result.status === 401 || result.status === 403, `Expected 401/403, got ${result.status}`);
  });

  // ── 2. List enrollments ───────────────────────────────────────────────────
  it("GET / returns all 12 known providers including not_enrolled stubs", async () => {
    const r = await makeRequest(server, "GET", BASE, tokenA);
    assert.equal(r.status, 200);
    const list = r.body as any[];
    assert.ok(Array.isArray(list));
    assert.ok(list.length >= 12, `Expected ≥12 providers, got ${list.length}`);

    const phonePe = list.find((e: any) => e.providerSlug === "phonepe");
    assert.ok(phonePe, "phonepe should appear");
    assert.equal(phonePe.enrollmentStatus, "not_enrolled");
    assert.equal(phonePe.onboardingInfo?.category, "D");
    assert.ok((phonePe.onboardingInfo?.kycDocuments?.length ?? 0) > 0);
    // No credential blobs
    assert.equal(phonePe.encryptedApiKey, undefined);
    assert.ok(!JSON.stringify(phonePe).includes("enc:v1:"));
  });

  // ── 3. Merchant isolation ─────────────────────────────────────────────────
  it("merchant A's enrollment does not appear in merchant B's list", async () => {
    // Enroll merchant A in paytm
    const enroll = await makeRequest(server, "POST", BASE, tokenA, { providerSlug: "paytm" });
    assert.equal(enroll.status, 200);

    // Merchant B sees paytm as not_enrolled
    const listB = await makeRequest(server, "GET", BASE, tokenB);
    assert.equal(listB.status, 200);
    const bPaytm = (listB.body as any[]).find((e: any) => e.providerSlug === "paytm");
    assert.equal(bPaytm?.enrollmentStatus, "not_enrolled");
  });

  // ── 4. Initiate enrollment ────────────────────────────────────────────────
  it("POST / creates pending_kyc and returns onboarding info", async () => {
    const r = await makeRequest(server, "POST", BASE, tokenA, { providerSlug: "mobikwik" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const { enrollment, onboardingInfo } = r.body as any;
    assert.equal(enrollment.enrollmentStatus, "pending_kyc");
    assert.equal(enrollment.providerSlug, "mobikwik");
    assert.ok(onboardingInfo?.signupUrl);
    assert.ok((onboardingInfo?.kycDocuments?.length ?? 0) > 0);
    // No credential blobs in response
    assert.equal(enrollment.encryptedApiKey, undefined);
    assert.ok(!JSON.stringify(r.body).includes("enc:v1:"));
  });

  // ── 5. Category E rejected ────────────────────────────────────────────────
  it("POST / returns 422 for Category E provider (freecharge)", async () => {
    const r = await makeRequest(server, "POST", BASE, tokenA, { providerSlug: "freecharge" });
    assert.equal(r.status, 422, JSON.stringify(r.body));
  });

  // ── 6. Category A rejected ────────────────────────────────────────────────
  it("POST / returns 422 for Category A provider (ekqr)", async () => {
    const r = await makeRequest(server, "POST", BASE, tokenA, { providerSlug: "ekqr" });
    assert.equal(r.status, 422, JSON.stringify(r.body));
  });

  // ── 7. Credential submission ──────────────────────────────────────────────
  it("PUT /:slug/credentials stores creds, status=credentials_submitted, no raw values in response", async () => {
    const r = await makeRequest(
      server, "PUT", `${BASE}/mobikwik/credentials`, tokenA,
      { apiKey: "real-api-key-12345", apiSecret: "real-secret-67890" },
    );
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const { enrollment } = r.body as any;
    assert.equal(enrollment.enrollmentStatus, "credentials_submitted");
    assert.equal(enrollment.hasApiKey, true);
    assert.equal(enrollment.hasApiSecret, true);
    // Raw values must NEVER appear
    const raw = JSON.stringify(r.body);
    assert.ok(!raw.includes("real-api-key-12345"), "Raw API key in response");
    assert.ok(!raw.includes("real-secret-67890"), "Raw secret in response");
    assert.ok(!raw.includes("enc:v1:"), "Encrypted blob in response");
  });

  // ── 8. Credential presence in GET list ───────────────────────────────────
  it("GET / shows hasApiKey=true — encrypted blob absent", async () => {
    const r = await makeRequest(server, "GET", BASE, tokenA);
    assert.equal(r.status, 200);
    const mobikwik = (r.body as any[]).find((e: any) => e.providerSlug === "mobikwik");
    assert.ok(mobikwik);
    assert.equal(mobikwik.hasApiKey, true);
    assert.equal(mobikwik.encryptedApiKey, undefined);
    assert.ok(!JSON.stringify(mobikwik).includes("enc:v1:"));
  });

  // ── 9. Status endpoint ────────────────────────────────────────────────────
  it("GET /:slug/status returns status without credentials", async () => {
    const r = await makeRequest(server, "GET", `${BASE}/mobikwik/status`, tokenA);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const body = r.body as any;
    assert.equal(body.providerSlug, "mobikwik");
    assert.ok(body.enrollmentStatus);
    assert.equal(body.encryptedApiKey, undefined);
    assert.ok(!JSON.stringify(body).includes("enc:v1:"));
  });

  // ── 10. Disconnect ────────────────────────────────────────────────────────
  it("DELETE /:slug clears credentials, sets disconnected, writes audit", async () => {
    const r = await makeRequest(server, "DELETE", `${BASE}/mobikwik`, tokenA);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const { enrollment } = r.body as any;
    assert.equal(enrollment.enrollmentStatus, "disconnected");
    assert.equal(enrollment.hasApiKey, false);
    assert.equal(enrollment.hasApiSecret, false);

    // Verify directly in DB
    const [row] = await db
      .select()
      .from(merchantProviderEnrollmentsTable)
      .where(
        and(
          eq(merchantProviderEnrollmentsTable.merchantId, merchantIdA),
          eq(merchantProviderEnrollmentsTable.providerSlug, "mobikwik"),
        ),
      )
      .limit(1);
    assert.ok(row);
    assert.equal(row.encryptedApiKey, null);
    assert.equal(row.encryptedApiSecret, null);
    assert.equal(row.enrollmentStatus, "disconnected");
    assert.ok(row.disconnectedAt);
    assert.equal(row.disconnectedBy, "merchant");
  });

  // ── 11. Duplicate protection ──────────────────────────────────────────────
  it("second POST for same providerSlug upserts — no duplicate rows", async () => {
    await makeRequest(server, "POST", BASE, tokenA, { providerSlug: "amazon_pay" });
    await makeRequest(server, "POST", BASE, tokenA, { providerSlug: "amazon_pay" });

    const rows = await db
      .select()
      .from(merchantProviderEnrollmentsTable)
      .where(
        and(
          eq(merchantProviderEnrollmentsTable.merchantId, merchantIdA),
          eq(merchantProviderEnrollmentsTable.providerSlug, "amazon_pay"),
        ),
      );
    assert.equal(rows.length, 1, `Expected 1 row, got ${rows.length}`);
  });

  // ── 12. 404 on credential submit without enrollment ───────────────────────
  it("PUT /:slug/credentials returns 404 when no enrollment record exists", async () => {
    const r = await makeRequest(
      server, "PUT", `${BASE}/bharatpe/credentials`, tokenB,
      { apiKey: "some-key" },
    );
    assert.equal(r.status, 404, JSON.stringify(r.body));
  });

  // ── 13. 404 on disconnect without enrollment ──────────────────────────────
  it("DELETE /:slug returns 404 when no enrollment exists", async () => {
    const r = await makeRequest(server, "DELETE", `${BASE}/bharatpe`, tokenB);
    assert.equal(r.status, 404, JSON.stringify(r.body));
  });
});
