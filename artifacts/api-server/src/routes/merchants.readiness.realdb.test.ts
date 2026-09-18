/**
 * Real-DB authorization and tenant-isolation coverage for the canonical
 * merchant readiness endpoint. This suite is intentionally named .realdb so
 * it is only run when the project database fixture is available.
 */
import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import http from "node:http";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import app from "../app";
import { generateToken } from "../middlewares/auth";

type Result = { status: number; body: Record<string, any> };

function get(server: http.Server, path: string, token: string): Promise<Result> {
  const address = server.address() as { port: number };
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: "127.0.0.1", port: address.port, path, method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    }, response => {
      let raw = "";
      response.on("data", chunk => { raw += chunk.toString(); });
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body: JSON.parse(raw) }));
    });
    request.on("error", reject);
    request.end();
  });
}

let server: http.Server;
let merchantToken: string;
let secondMerchantToken: string | null = null;
let adminToken: string;

before(async () => {
  server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const merchants = await db.select({ id: usersTable.id, merchantId: usersTable.merchantId })
    .from(usersTable).where(eq(usersTable.role, "merchant")).limit(2);
  if (!merchants[0]?.merchantId) throw new Error("Real DB fixture has no merchant user");
  merchantToken = generateToken({ userId: merchants[0].id, role: "merchant" });
  if (merchants[1]?.merchantId) secondMerchantToken = generateToken({ userId: merchants[1].id, role: "merchant" });
  const [admin] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.role, "admin")).limit(1);
  if (!admin) throw new Error("Real DB fixture has no admin user");
  adminToken = generateToken({ userId: admin.id, role: "admin" });
});

after(() => server.close());

test("readiness requires merchant authorization", async () => {
  const unauthenticated = await get(server, "/api/merchants/me/readiness", "");
  assert.equal(unauthenticated.status, 401);
  const admin = await get(server, "/api/merchants/me/readiness", adminToken);
  assert.equal(admin.status, 403);
});

test("readiness is tenant-scoped to the token, ignoring merchant query switching", async () => {
  const baseline = await get(server, "/api/merchants/me/readiness", merchantToken);
  const first = await get(server, "/api/merchants/me/readiness?merchantId=999999", merchantToken);
  assert.equal(baseline.status, 200);
  assert.equal(first.status, 200);
  const { checkedAt: baselineCheckedAt, ...baselineGoLive } = baseline.body.goLive;
  const { checkedAt: switchedCheckedAt, ...switchedGoLive } = first.body.goLive;
  assert.equal(typeof baselineCheckedAt, "string");
  assert.equal(typeof switchedCheckedAt, "string");
  assert.deepEqual({ ...first.body, goLive: switchedGoLive }, { ...baseline.body, goLive: baselineGoLive });
  assert.equal("merchant" in first.body, false);
  if (secondMerchantToken) {
    const second = await get(server, "/api/merchants/me/readiness?merchantId=1", secondMerchantToken);
    assert.equal(second.status, 200);
    assert.equal("merchant" in second.body, false);
  }
});

test("readiness response does not leak secrets, API keys, or UTRs", async () => {
  const result = await get(server, "/api/merchants/me/readiness", merchantToken);
  assert.equal(result.status, 200);
  assert.deepEqual(Object.keys(result.body.apiKey).sort(), ["active", "count", "lastUsedAt"].sort());
  assert.equal("secretKey" in result.body.apiKey, false);
  assert.equal("key" in result.body.apiKey, false);
  assert.equal("utr" in result.body, false);
  assert.equal("callbackSecret" in result.body, false);
});

test("expired plan remains visibly expired in the real readiness response", async () => {
  const result = await get(server, "/api/merchants/me/readiness", merchantToken);
  assert.equal(result.status, 200);
  assert.equal(typeof result.body.plan.isExpired, "boolean");
  if (result.body.plan.isExpired) {
    assert.ok(result.body.goLive.blockers.includes("plan_expired"));
    assert.equal(result.body.collection.live, false);
  }
});

test("merchant dashboard metrics expose current-period payout fields and complete chart series", async () => {
  const stats = await get(server, "/api/dashboard/stats", merchantToken);
  assert.equal(stats.status, 200);
  assert.equal(typeof stats.body.todayPayouts, "number");
  assert.equal(typeof stats.body.todayPayoutAmount, "number");
  assert.equal(typeof stats.body.availableBalance, "number");

  const chart = await get(server, "/api/dashboard/chart", merchantToken);
  assert.equal(chart.status, 200);
  assert.ok(Array.isArray(chart.body));
  assert.equal(chart.body.length, 30);
  for (const point of chart.body) {
    assert.deepEqual(
      Object.keys(point).sort(),
      ["date", "deposits", "withdrawals", "failed", "refunded"].sort(),
    );
  }
});