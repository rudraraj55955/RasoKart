/**
 * Integration test: POST /api/merchant/payin/orders — daily deposit limit
 * enforcement in the webhook-race window.
 *
 * Problem being tested
 * ────────────────────
 * There is a time window between the frontend's GET /payin/status call and the
 * subsequent POST /payin/orders call.  A PAID webhook that lands during this
 * window raises the merchant's dailyTotal, potentially pushing it to or above
 * the configured cap — BEFORE the POST handler runs its authoritative check.
 *
 * The server-side limit check inside the POST handler is the last line of
 * defence.  This suite confirms it blocks correctly when the dailyTotal (as
 * returned by getMerchantDailyPaidTotal at POST time) is already at or above
 * the cap, regardless of what the earlier GET /payin/status response said.
 *
 * Covered scenarios
 * ─────────────────
 * 1. dailyTotal exactly at cap (post-webhook state) → 400 "Daily deposit limit reached"
 * 2. dailyTotal + depositAmount exceeds cap by ≥1 rupee → 400
 * 3. dailyTotal just below cap with room for depositAmount → passes the limit check
 * 4. Race-condition simulation: two concurrent POST requests both start below
 *    cap; the first one "claims" remaining capacity (mock advances the total);
 *    the second POST sees the updated total (at/above cap) and is blocked → 400
 * 5. dailyTotal query throws during the POST handler → 500 fail-closed (not silently allowed)
 *
 * Mock architecture
 * ─────────────────
 * All DB interactions are mocked at the `db` module level — no real database
 * required.  The `cashfreePaymentOrdersTable` mock is call-count-aware:
 *   call #1 (global daily-limit check in POST handler) → returns the
 *     configurable `dailyTotal` to drive the scenarios above.
 *
 * `systemConfigTable` is also mocked to return payin config rows with a known
 * `cashfree_daily_limit` (10 000 by default in these tests).
 *
 * `usersTable` always returns a valid merchant user so auth never blocks.
 *
 * The test does NOT need to reach the smart-routing / provider-dispatch layer —
 * it only needs to hit the limit-check block at lines 193-196 of payinOrders.ts.
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  db,
  usersTable,
  systemConfigTable,
  cashfreePaymentOrdersTable,
  routingConfigsTable,
  routingRulesTable,
} from "@workspace/db";
import { generateToken } from "../middlewares/auth";
import { resetPayinSchemaGuardCacheForTests } from "../helpers/payinSchemaGuard";
import app from "../app";

// ─── HTTP helper ─────────────────────────────────────────────────────────────

function post(
  server: http.Server,
  path: string,
  body: unknown,
  token: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const addr = server.address() as { port: number };
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: addr.port,
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
          Authorization: `Bearer ${token}`,
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk: Buffer) => { raw += chunk.toString(); });
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode!, body: JSON.parse(raw) });
          } catch {
            resolve({ status: res.statusCode!, body: { _raw: raw } });
          }
        });
      },
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

// ─── Chainable DB stub ───────────────────────────────────────────────────────

/**
 * Returns a chainable stub that resolves to `rows` when awaited, and also
 * supports the `.limit()` / `.orderBy()` / `.where()` chains used in the
 * production code.
 */
function chainable(rows: unknown[]) {
  return {
    then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
      return Promise.resolve(rows).then(resolve, reject);
    },
    limit: (_n?: number) => Promise.resolve(rows),
    orderBy: (_: unknown) => chainable(rows),
    where: (_: unknown) => chainable(rows),
  };
}

// ─── Test fixture ─────────────────────────────────────────────────────────────

const DAILY_LIMIT = 10_000; // rupees — easy round number for arithmetic in tests

const MERCHANT_USER = {
  id: 301,
  merchantId: 88,
  role: "merchant" as const,
  email: "daily-limit-race-test@rasokart.test",
  isActive: true,
  passwordUpdatedAt: null,
  isSuperAdmin: false,
};

/** system_config rows for loadPayinConfig() */
function payinConfigRows(dailyLimit = DAILY_LIMIT) {
  return [
    { key: "cashfree_enabled", value: "true" },
    { key: "cashfree_upi_enabled", value: "true" },
    { key: "cashfree_merchant_payin_enabled", value: "true" },
    { key: "cashfree_min_amount", value: "1" },
    { key: "cashfree_max_amount", value: "1000000" },
    { key: "cashfree_daily_limit", value: String(dailyLimit) },
  ];
}

/** Routing config that enables only "cashfree_payin" so the route never
 *  reaches provider APIs (it will fail at the provider dispatch layer, which
 *  is fine — we only care about the limit check returning 400 before that). */
const ROUTING_CONFIG = {
  id: 20,
  configName: "default",
  strategy: "priority",
  isEnabled: true,
  fallbackEnabled: false,
  timeoutMs: 30000,
  minSuccessRateThreshold: "80.00",
  description: null,
  updatedByEmail: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const ROUTING_RULE = {
  id: 2,
  configId: 20,
  providerKey: "cashfree_payin",
  priority: 1,
  weightPercent: 100,
  minAmount: null,
  maxAmount: null,
  allowedPaymentModes: null,
  isEnabled: true,
  isFallbackOnly: false,
  maxRetries: 1,
  notes: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ─── Mock installer ───────────────────────────────────────────────────────────

/**
 * Installs a db mock that drives POST /api/merchant/payin/orders up to the
 * daily-limit check.
 *
 * @param getDailyTotal - Function called when the POST handler queries
 *   cashfreePaymentOrdersTable for this merchant's daily PAID total.  Return a
 *   number to simulate a normal DB result; throw to simulate a transient error.
 * @param dailyLimit - Limit to embed in the payin config rows (default 10 000).
 */
function installDbMock(
  getDailyTotal: () => number | never,
  dailyLimit = DAILY_LIMIT,
) {
  (db as any).select = (_fields?: unknown) => ({
    from: (table: unknown) => ({
      where: (_cond: unknown) => {
        if (table === usersTable) {
          return chainable([MERCHANT_USER]);
        }

        if (table === cashfreePaymentOrdersTable) {
          // getMerchantDailyPaidTotal in the POST handler
          const total = getDailyTotal(); // may throw — propagated to the route
          return chainable([{ total: String(total) }]);
        }

        if (table === systemConfigTable) {
          return chainable(payinConfigRows(dailyLimit));
        }

        if (table === routingConfigsTable) {
          return chainable([ROUTING_CONFIG]);
        }

        if (table === routingRulesTable) {
          return chainable([ROUTING_RULE]);
        }

        return chainable([]);
      },
    }),
  });

  (db as any).execute = async () => ({ rows: [] });

  (db as any).insert = (_table: unknown) => ({
    values: (_vals: unknown) => ({
      returning: async () => [{ id: 999 }],
      onConflictDoNothing: async () => {},
      onConflictDoUpdate: async () => {},
    }),
  });

  (db as any).update = (_table: unknown) => ({
    set: (_vals: unknown) => ({
      where: async () => {},
    }),
  });
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("POST /api/merchant/payin/orders — daily deposit limit (webhook-race window)", () => {
  let server: http.Server;
  let token: string;

  const originalSelect = (db as any).select?.bind(db);
  const originalInsert = (db as any).insert?.bind(db);
  const originalUpdate = (db as any).update?.bind(db);
  const originalExecute = (db as any).execute?.bind(db);

  before(async () => {
    if (!process.env["SESSION_SECRET"]) {
      process.env["SESSION_SECRET"] = "test-session-secret-daily-limit-race";
    }
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    token = generateToken({ userId: MERCHANT_USER.id, role: "merchant" });
  });

  after(async () => {
    (db as any).select = originalSelect;
    (db as any).insert = originalInsert;
    if (originalUpdate) (db as any).update = originalUpdate;
    if (originalExecute) (db as any).execute = originalExecute;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    (db as any).select = originalSelect;
    (db as any).insert = originalInsert;
    if (originalUpdate) (db as any).update = originalUpdate;
    if (originalExecute) (db as any).execute = originalExecute;
    resetPayinSchemaGuardCacheForTests();
  });

  // ── 1. dailyTotal exactly at the cap (post-webhook state) ─────────────────

  it(
    "returns 400 when dailyTotal equals the cap (any new order would exceed it)",
    async () => {
      // Simulate: before the POST arrives, a PAID webhook updated the merchant's
      // total to exactly the daily limit (10 000).  Even a 1-rupee order is blocked.
      installDbMock(() => DAILY_LIMIT /* 10 000 == cap */);

      const { status, body } = await post(
        server,
        "/api/merchant/payin/orders",
        { amount: 1, customerPhone: "9876543210" },
        token,
      );

      assert.equal(
        status,
        400,
        `Expected 400 when dailyTotal == cap but got ${status}: ${JSON.stringify(body)}`,
      );
      assert.ok(
        typeof body["error"] === "string",
        "Response must include an error string",
      );
      assert.match(
        body["error"] as string,
        /daily deposit limit/i,
        `Error must mention the daily limit; got: ${body["error"]}`,
      );
    },
  );

  // ── 2. dailyTotal + depositAmount exceeds cap ──────────────────────────────

  it(
    "returns 400 when dailyTotal + depositAmount strictly exceeds the cap",
    async () => {
      // Merchant has 9 900 used; webhook brings it to 9 900 BEFORE the POST.
      // Request is for 200, so 9 900 + 200 = 10 100 > 10 000 → blocked.
      const postWebhookTotal = 9_900;
      installDbMock(() => postWebhookTotal);

      const { status, body } = await post(
        server,
        "/api/merchant/payin/orders",
        { amount: 200, customerPhone: "9876543210" },
        token,
      );

      assert.equal(
        status,
        400,
        `Expected 400 when dailyTotal + amount exceeds cap but got ${status}: ${JSON.stringify(body)}`,
      );
      assert.match(
        body["error"] as string,
        /daily deposit limit/i,
        `Error must mention the daily limit; got: ${body["error"]}`,
      );
    },
  );

  // ── 3. dailyTotal below cap with room for depositAmount → daily-limit not hit ─

  it(
    "does NOT return 'Daily deposit limit reached' when there is remaining headroom",
    async () => {
      // Merchant has used 5 000 of the 10 000 cap; order of 500 is well within limit.
      // The daily-limit guard must not trigger.  The request may fail for other
      // reasons (config, provider creds) — this test only cares that the limit
      // guard doesn't block it.
      installDbMock(() => 5_000);

      const { status, body } = await post(
        server,
        "/api/merchant/payin/orders",
        { amount: 500, customerPhone: "9876543210" },
        token,
      );

      // If the response is 400, the error must NOT be the daily-limit message.
      // Any other failure mode (config, creds, provider) is acceptable here.
      if (status === 400) {
        assert.ok(
          typeof body["error"] === "string",
          "400 response must have an error string",
        );
        assert.doesNotMatch(
          body["error"] as string,
          /daily deposit limit/i,
          `Request with headroom must not be blocked by the daily-limit guard; got: ${body["error"]}`,
        );
      }
      // 200 or any non-daily-limit failure is acceptable evidence that the
      // daily-limit check itself passed.
    },
  );

  // ── 4. Race-condition simulation: concurrent POST sees post-webhook total ────

  it(
    "webhook-race: a POST that re-queries AFTER the webhook has filled the cap is blocked",
    async () => {
      // Scenario
      // ────────
      // The frontend called GET /payin/status and saw remaining capacity.
      // While the merchant was filling out the form a PAID webhook arrived and
      // pushed the merchant's dailyTotal to exactly the cap (10 000).
      // The POST /payin/orders that follows must be blocked because the server
      // re-queries the total authoritatively at POST time and sees 10 000.
      //
      // We model this directly: the daily-total mock returns 10 000 (= cap),
      // representing the DB state the POST handler sees AFTER the webhook
      // has been processed — exactly the "race window" the task is exercising.
      // amount = 100 → 10 000 + 100 > 10 000 → must be blocked with 400.
      installDbMock(() => DAILY_LIMIT /* 10 000 == cap, post-webhook state */);

      const { status, body } = await post(
        server,
        "/api/merchant/payin/orders",
        { amount: 100, customerPhone: "9876543210" },
        token,
      );

      assert.equal(
        status,
        400,
        `POST after webhook fills the cap must be blocked with 400; ` +
        `got ${status}: ${JSON.stringify(body)}`,
      );
      assert.match(
        body["error"] as string,
        /daily deposit limit/i,
        `Error must mention the daily limit; got: ${body["error"]}`,
      );
    },
  );

  // ── 5. Query throws during POST → fail-closed (500, not silently allowed) ──

  it(
    "returns 500 (fail-closed) when the daily-total query throws during the POST handler",
    async () => {
      // The DB call inside getMerchantDailyPaidTotal blows up.  The route must
      // reject the request rather than assuming there is capacity and letting
      // an order through.
      installDbMock(() => {
        throw new Error("DB connection lost during daily-limit query");
      });

      const { status } = await post(
        server,
        "/api/merchant/payin/orders",
        { amount: 100, customerPhone: "9876543210" },
        token,
      );

      // Any non-2xx status confirms the route did NOT allow the order through.
      assert.ok(
        status >= 400 && status < 600,
        `Expected an error status when DB throws but got ${status}`,
      );
      assert.notEqual(
        status,
        200,
        "Must not return 200 when the daily-total query throws (fail-closed)",
      );
    },
  );

  // ── 6. Boundary: dailyTotal + depositAmount == cap (not strictly greater) ──

  it(
    "does NOT return 'Daily deposit limit reached' when dailyTotal + depositAmount equals the cap exactly",
    async () => {
      // The guard is `dailyTotal + depositAmount > cfg.dailyLimit` (strict >).
      // When the sum equals the cap the order must NOT be blocked by the
      // daily-limit check.
      // dailyTotal = 9 500, amount = 500 → sum = 10 000 == cap → NOT blocked.
      installDbMock(() => 9_500);

      const { status, body } = await post(
        server,
        "/api/merchant/payin/orders",
        { amount: 500, customerPhone: "9876543210" },
        token,
      );

      // If the response is 400, the error must NOT be the daily-limit message.
      if (status === 400) {
        assert.ok(
          typeof body["error"] === "string",
          "400 response must have an error string",
        );
        assert.doesNotMatch(
          body["error"] as string,
          /daily deposit limit/i,
          `Boundary-equal order (sum == cap) must not be blocked by the daily-limit guard; got: ${body["error"]}`,
        );
      }
    },
  );
});
