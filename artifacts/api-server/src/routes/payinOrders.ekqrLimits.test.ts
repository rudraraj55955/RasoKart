/**
 * Route-level tests: POST /api/merchant/payin/orders — EKQR transaction limit enforcement
 *
 * Covers four requirements that guard the EKQR/UPIGateway payin path:
 *
 * 1. depositAmount below EKQR minAmount → 422 (provider-level amount floor)
 * 2. depositAmount above EKQR maxAmount → 422 (provider-level amount ceiling)
 * 3. ekqrDailyTotal + depositAmount > ekqrDailyLimit → 422 (provider-scoped daily cap)
 * 4. Amount inside EKQR range with daily headroom → dispatch attempted (200)
 *
 * These tests protect against a future refactor silently removing the EKQR
 * limit checks, which would let over-limit orders reach the EKQR API and
 * fail with a confusing provider-level error rather than a clear 422.
 *
 * Mock architecture — cashfreePaymentOrdersTable is queried twice per request:
 *   1st call (global daily check, pre-routing) — always returns 0 so the
 *     global cap never blocks; only the EKQR-specific checks are under test here.
 *   2nd call (EKQR-specific daily check, inside UPIGATEWAY branch) — returns
 *     the configurable `ekqrDailyTotal` so we can simulate a provider-scoped
 *     near-full day.
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
  routingLogsTable,
} from "@workspace/db";
import { generateToken } from "../middlewares/auth";
import { encryptSecret } from "../helpers/cryptoUtils";
import { resetPayinSchemaGuardCacheForTests } from "../helpers/payinSchemaGuard";
import app from "../app";

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

/**
 * Returns a chainable DB result stub that is:
 * - Directly awaitable (resolves to `rows`)
 * - Has .limit() that also resolves to `rows`
 * - Has .orderBy() that returns another chainable
 *
 * This matches the two query-termination patterns in the codebase:
 *   await db.select().from(t).where(cond)        → awaits .where()
 *   await db.select().from(t).where(cond).limit(n) → awaits .limit()
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

describe("POST /api/merchant/payin/orders — EKQR transaction limit enforcement", () => {
  let server: http.Server;
  let token: string;
  let encryptedApiKey: string;

  const MERCHANT_USER = {
    id: 201,
    merchantId: 77,
    role: "merchant" as const,
    email: "ekqr-test-merchant@rasokart.test",
    isActive: true,
    passwordUpdatedAt: null,
    isSuperAdmin: false,
  };

  const ROUTING_CONFIG = {
    id: 10,
    configName: "default",
    strategy: "priority",
    isEnabled: true,
    fallbackEnabled: true,
    timeoutMs: 30000,
    minSuccessRateThreshold: "80.00",
    description: null,
    updatedByEmail: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const ROUTING_RULE = {
    id: 1,
    configId: 10,
    providerKey: "upigateway",
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

  /** Rows returned by loadPayinConfig() — global limits set wide so they never block */
  function payinConfigRows() {
    return [
      { key: "cashfree_enabled", value: "true" },
      { key: "cashfree_upi_enabled", value: "true" },
      { key: "cashfree_merchant_payin_enabled", value: "true" },
      { key: "cashfree_min_amount", value: "1" },
      { key: "cashfree_max_amount", value: "1000000" },
      { key: "cashfree_daily_limit", value: "5000000" },
    ];
  }

  /**
   * Rows returned by loadUpigatewayConfig() — EKQR-specific limits under test.
   * `dailyLimit` is the UPIGATEWAY-specific daily cap independent of the
   * global Cashfree limit above.
   */
  function upigatewayConfigRows(opts: {
    minAmount?: number;
    maxAmount?: number;
    dailyLimit?: number;
  } = {}) {
    return [
      { key: "upigateway_payin_enabled", value: "true" },
      { key: "upigateway_api_key", value: encryptedApiKey },
      { key: "upigateway_min_amount", value: String(opts.minAmount ?? 100) },
      { key: "upigateway_max_amount", value: String(opts.maxAmount ?? 50000) },
      { key: "upigateway_daily_limit", value: String(opts.dailyLimit ?? 200000) },
      { key: "upigateway_env", value: "test" },
      { key: "upigateway_merchant_access", value: "false" },
    ];
  }

  /**
   * Installs the full db mock needed to drive the payin order creation route
   * up to (and including) the EKQR limit checks.
   *
   * cashfreePaymentOrdersTable is queried twice per request:
   *   call #1 — pre-routing global daily check (always returns 0 so the global
   *              cap never trips; the EKQR-specific checks are what we test).
   *   call #2 — EKQR-scoped daily check inside the UPIGATEWAY branch (returns
   *              the configurable `ekqrDailyTotal` to simulate a near-full day).
   *
   * systemConfigTable is also queried twice:
   *   call #1 — loadPayinConfig (Cashfree keys)
   *   call #2 — loadUpigatewayConfig (UPIGATEWAY/EKQR keys)
   *
   * @param ekqrDailyTotal  - EKQR-specific daily total already processed today.
   * @param ugConfigOpts    - EKQR min/max/dailyLimit to use in the UPI config rows.
   */
  function installDbMock(
    ekqrDailyTotal: number,
    ugConfigOpts: { minAmount?: number; maxAmount?: number; dailyLimit?: number } = {},
  ) {
    let sysConfigCallCount = 0;
    let cfOrderCallCount = 0;

    (db as any).select = (_fields?: unknown) => ({
      from: (table: unknown) => ({
        where: (_cond: unknown) => {
          if (table === usersTable) {
            return chainable([MERCHANT_USER]);
          }
          if (table === cashfreePaymentOrdersTable) {
            cfOrderCallCount++;
            if (cfOrderCallCount === 1) {
              // Global daily check — return 0 so global cap never blocks
              return chainable([{ total: "0" }]);
            }
            // EKQR-scoped daily check — return configured total
            return chainable([{ total: String(ekqrDailyTotal) }]);
          }
          if (table === systemConfigTable) {
            sysConfigCallCount++;
            if (sysConfigCallCount === 1) {
              return chainable(payinConfigRows());
            }
            return chainable(upigatewayConfigRows(ugConfigOpts));
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
      catch: () => {},
    });

    (db as any).update = (_table: unknown) => ({
      set: (_vals: unknown) => ({
        where: async () => {},
      }),
    });
  }

  const originalSelect = (db as any).select.bind(db);
  const originalInsert = (db as any).insert.bind(db);
  const originalUpdate = (db as any).update?.bind(db);
  const originalExecute = (db as any).execute?.bind(db);

  before(async () => {
    if (!process.env["SESSION_SECRET"]) {
      process.env["SESSION_SECRET"] = "test-session-secret-for-ekqr-limit-tests";
    }
    encryptedApiKey = encryptSecret("upigateway_test_api_key_12345");

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

  it(
    "returns 422 when depositAmount is below the EKQR minAmount",
    async () => {
      installDbMock(0, { minAmount: 100, maxAmount: 50000, dailyLimit: 200000 });

      const { status, body } = await post(
        server,
        "/api/merchant/payin/orders",
        { amount: 50, customerPhone: "9876543210" },
        token,
      );

      assert.equal(
        status,
        422,
        `Expected 422 for amount below EKQR min but got ${status}: ${JSON.stringify(body)}`,
      );
      assert.ok(
        typeof body["error"] === "string",
        "Response must include an error string",
      );
      assert.match(
        body["error"] as string,
        /₹100/,
        "Error message must mention the EKQR minimum (₹100)",
      );
    },
  );

  it(
    "returns 422 when depositAmount is above the EKQR maxAmount",
    async () => {
      installDbMock(0, { minAmount: 100, maxAmount: 50000, dailyLimit: 200000 });

      const { status, body } = await post(
        server,
        "/api/merchant/payin/orders",
        { amount: 75000, customerPhone: "9876543210" },
        token,
      );

      assert.equal(
        status,
        422,
        `Expected 422 for amount above EKQR max but got ${status}: ${JSON.stringify(body)}`,
      );
      assert.ok(
        typeof body["error"] === "string",
        "Response must include an error string",
      );
      assert.match(
        body["error"] as string,
        /₹50000/,
        "Error message must mention the EKQR maximum (₹50000)",
      );
    },
  );

  it(
    "returns 422 when ekqrDailyTotal + depositAmount would exceed the EKQR provider daily limit",
    async () => {
      // EKQR daily limit is 200 000; put the EKQR-specific daily total at
      // 199 700 so adding 500 would push it over.  The global daily cap
      // (5 000 000 set in payinConfigRows) stays untouched — the global
      // check passes; only the provider-scoped check trips.
      installDbMock(199_700, { minAmount: 100, maxAmount: 50000, dailyLimit: 200000 });

      const { status, body } = await post(
        server,
        "/api/merchant/payin/orders",
        { amount: 500, customerPhone: "9876543210" },
        token,
      );

      assert.equal(
        status,
        422,
        `Expected 422 when EKQR daily limit is exceeded but got ${status}: ${JSON.stringify(body)}`,
      );
      assert.ok(
        typeof body["error"] === "string",
        "Response must include an error string",
      );
      assert.match(
        body["error"] as string,
        /daily/i,
        "Error message must mention the daily limit",
      );
    },
  );

  it(
    "returns 422 (fail-closed) when the EKQR provider-scoped daily total query throws",
    async () => {
      // Install the standard mock first, then override the 2nd
      // cashfreePaymentOrdersTable call to throw so the route cannot determine
      // whether headroom exists.  The expected behavior is fail-closed: reject
      // with 422 rather than silently passing an order through.
      installDbMock(0, { minAmount: 100, maxAmount: 50000, dailyLimit: 200000 });

      let cfOrderCallCount = 0;
      const mockAfterSetup = (db as any).select.bind(db);
      (db as any).select = (_fields?: unknown) => ({
        from: (table: unknown) => ({
          where: (_cond: unknown) => {
            if (table === cashfreePaymentOrdersTable) {
              cfOrderCallCount++;
              if (cfOrderCallCount === 1) {
                return chainable([{ total: "0" }]);
              }
              // 2nd call (EKQR-scoped) — simulate a DB transient error
              return {
                then(_resolve: unknown, reject: (e: unknown) => unknown) {
                  return Promise.reject(new Error("DB connection lost")).then(undefined, reject);
                },
                limit: () => Promise.reject(new Error("DB connection lost")),
                orderBy: () => ({ then(_r: unknown, rej: (e: unknown) => unknown) { return Promise.reject(new Error("DB connection lost")).then(undefined, rej); }, limit: () => Promise.reject(new Error("DB connection lost")), orderBy: () => ({}) }),
                where: () => ({ then(_r: unknown, rej: (e: unknown) => unknown) { return Promise.reject(new Error("DB connection lost")).then(undefined, rej); }, limit: () => Promise.reject(new Error("DB connection lost")), orderBy: () => ({}) }),
              };
            }
            // Delegate other tables to the existing mock
            return mockAfterSetup(_fields).from(table).where(_cond);
          },
        }),
      });

      const { status, body } = await post(
        server,
        "/api/merchant/payin/orders",
        { amount: 500, customerPhone: "9876543210" },
        token,
      );

      assert.equal(
        status,
        422,
        `Expected 422 (fail-closed) when daily total query throws but got ${status}: ${JSON.stringify(body)}`,
      );
      assert.ok(
        typeof body["error"] === "string",
        "Response must include an error string",
      );
    },
  );

  it(
    "passes through to dispatch when depositAmount is inside the EKQR range with daily headroom",
    async () => {
      // ekqrDailyTotal = 0, dailyLimit = 200 000, amount = 500 → well within cap
      installDbMock(0, { minAmount: 100, maxAmount: 50000, dailyLimit: 200000 });

      const originalFetch = global.fetch;
      global.fetch = async () =>
        ({
          text: async () =>
            JSON.stringify({
              status: true,
              msg: "Order created",
              payment_url: "https://api.ekqr.in/pay/test-order-abc123",
            }),
        }) as Response;

      try {
        const { status, body } = await post(
          server,
          "/api/merchant/payin/orders",
          { amount: 500, customerPhone: "9876543210", customerName: "Test Customer" },
          token,
        );

        assert.equal(
          status,
          200,
          `Expected 200 for valid EKQR amount but got ${status}: ${JSON.stringify(body)}`,
        );
        assert.ok(
          typeof body["publicOrderId"] === "string",
          "Response must include publicOrderId",
        );
        assert.ok(
          typeof body["checkoutUrl"] === "string" || body["paymentToken"] != null,
          "Response must include a checkout URL or payment token",
        );
        assert.equal(
          body["status"],
          "CREATED",
          "Response status must be CREATED",
        );
      } finally {
        global.fetch = originalFetch;
      }
    },
  );
});
