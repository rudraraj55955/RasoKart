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

    // ── db.transaction mock (withProviderPayinLock) ────────────────────────
    // After the EKQR path was changed to use withProviderPayinLock (which
    // calls db.transaction), tests that reach the advisory-lock insert step
    // need a transaction mock to avoid hitting the real Postgres.
    //
    // This mock simulates the provider-lock transaction with safe defaults:
    //   - tx.execute: no-op (simulates pg_advisory_xact_lock)
    //   - tx.select (1st cashfreePaymentOrders call): returns 0 for the global
    //     per-merchant re-check (getMerchantDailyActiveTotal)
    //   - tx.select (2nd cashfreePaymentOrders call): returns `ekqrDailyTotal`
    //     for the provider-wide re-check (getProviderDailyActiveTotal) — same
    //     value the pre-check returned, so the re-check cannot disagree
    //   - tx.insert: simulated no-op
    (db as any).transaction = async (fn: (tx: unknown) => unknown) => {
      let txCfCallCount = 0;
      const mockTx = {
        execute: async () => ({ rows: [] }),
        select: (_fields?: unknown) => ({
          from: (table: unknown) => ({
            where: (_cond: unknown) => {
              if (table === cashfreePaymentOrdersTable) {
                txCfCallCount++;
                if (txCfCallCount === 1) {
                  // getMerchantDailyActiveTotal: per-merchant global re-check
                  return chainable([{ total: "0" }]);
                }
                // getProviderDailyActiveTotal: provider-wide re-check
                return chainable([{ total: String(ekqrDailyTotal) }]);
              }
              return chainable([]);
            },
          }),
        }),
        insert: (_table: unknown) => ({
          values: (_vals: unknown) => ({
            onConflictDoNothing: async () => {},
            onConflictDoUpdate: async () => {},
          }),
        }),
      };
      return fn(mockTx);
    };
  }

  const originalSelect = (db as any).select.bind(db);
  const originalInsert = (db as any).insert.bind(db);
  const originalUpdate = (db as any).update?.bind(db);
  const originalExecute = (db as any).execute?.bind(db);
  const originalTransaction = (db as any).transaction?.bind(db);

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
    if (originalTransaction) (db as any).transaction = originalTransaction;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    (db as any).select = originalSelect;
    (db as any).insert = originalInsert;
    if (originalUpdate) (db as any).update = originalUpdate;
    if (originalExecute) (db as any).execute = originalExecute;
    if (originalTransaction) (db as any).transaction = originalTransaction;
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
    "accepts depositAmount exactly equal to the EKQR minimum (boundary — must not be rejected)",
    async () => {
      // The enforcement is `depositAmount < ugCfg.minAmount` (strict less-than),
      // so depositAmount === minAmount must pass the range guard.
      installDbMock(0, { minAmount: 100, maxAmount: 50000, dailyLimit: 200000 });

      const originalFetch = global.fetch;
      global.fetch = async () =>
        ({
          text: async () =>
            JSON.stringify({
              status: true,
              msg: "Order created",
              payment_url: "https://api.ekqr.in/pay/boundary-min-payin",
            }),
        }) as Response;

      try {
        const { status, body } = await post(
          server,
          "/api/merchant/payin/orders",
          { amount: 100, customerPhone: "9876543210", customerName: "Boundary Min" },
          token,
        );

        assert.notEqual(
          status,
          422,
          `depositAmount exactly at EKQR min must not be rejected with 422 (got ${status}: ${JSON.stringify(body)})`,
        );
        // 200 (success) or 500 (DB insert or other downstream issue in test env)
        // are both acceptable evidence that the amount-range guard passed.
        assert.ok(
          status === 200 || status === 500,
          `Expected 200 or 500 for boundary-min amount but got ${status}: ${JSON.stringify(body)}`,
        );
      } finally {
        global.fetch = originalFetch;
      }
    },
  );

  it(
    "accepts depositAmount exactly equal to the EKQR maximum (boundary — must not be rejected)",
    async () => {
      // The enforcement is `depositAmount > ugCfg.maxAmount` (strict greater-than),
      // so depositAmount === maxAmount must pass the range guard.
      installDbMock(0, { minAmount: 100, maxAmount: 50000, dailyLimit: 200000 });

      const originalFetch = global.fetch;
      global.fetch = async () =>
        ({
          text: async () =>
            JSON.stringify({
              status: true,
              msg: "Order created",
              payment_url: "https://api.ekqr.in/pay/boundary-max-payin",
            }),
        }) as Response;

      try {
        const { status, body } = await post(
          server,
          "/api/merchant/payin/orders",
          { amount: 50000, customerPhone: "9876543210", customerName: "Boundary Max" },
          token,
        );

        assert.notEqual(
          status,
          422,
          `depositAmount exactly at EKQR max must not be rejected with 422 (got ${status}: ${JSON.stringify(body)})`,
        );
        assert.ok(
          status === 200 || status === 500,
          `Expected 200 or 500 for boundary-max amount but got ${status}: ${JSON.stringify(body)}`,
        );
      } finally {
        global.fetch = originalFetch;
      }
    },
  );

  it(
    "cross-merchant provider cap: both merchants are blocked when their combined EKQR usage already exceeds the cap",
    async () => {
      // ── Scenario ──────────────────────────────────────────────────────────
      // Provider EKQR daily cap : 200 000
      // Merchant A (merchantId=77) already active : 150 000 via EKQR today
      // Merchant B (merchantId=78) already active : 100 000 via EKQR today
      // Combined usage          : 250 000  — exceeds the 200 000 cap
      //
      // Under the FIXED cross-merchant model the route calls:
      //   getProviderDailyActiveTotal(db, startOfDay, 'upigateway')
      // which does NOT filter by merchantId, returning the combined total:
      //   Provider total : 250 000 + 500 = 250 500 > 200 000 → 422 for both A and B
      //
      // The DB mock below is QUERY-AWARE: it reads the merchantId Param
      // from the Drizzle WHERE condition and sums only matching rows from
      // the seeded dataset.  Because the new cross-merchant query omits the
      // merchantId predicate, extractParams finds no numeric param and the mock
      // returns the COMBINED total (250 000) for both requests → both get 422.

      // ── Shared in-memory dataset ──────────────────────────────────────────
      // Each row represents an active EKQR order already recorded today.
      const SEEDED_ORDERS = [
        { merchantId: 77, amount: 150_000, status: "PAID", providerKey: "upigateway" },
        { merchantId: 78, amount: 100_000, status: "PAID", providerKey: "upigateway" },
      ];

      /**
       * Extracts all scalar Param values from a Drizzle SQL condition tree.
       * Drizzle builds WHERE clauses as nested SQL objects whose `queryChunks`
       * array contains StringChunk, Column, and Param nodes.  Recursing into
       * queryChunks and `value` arrays surfaces the bound parameter values so
       * the mock can filter the in-memory dataset the same way the DB would.
       */
      function extractParams(chunk: unknown): unknown[] {
        if (chunk == null || typeof chunk !== "object") return [];
        const c = chunk as Record<string, unknown>;
        const results: unknown[] = [];
        if (c["constructor"] != null && (c["constructor"] as { name?: string }).name === "Param") {
          results.push(c["value"]);
        }
        if (Array.isArray(c["queryChunks"])) {
          for (const sub of c["queryChunks"]) results.push(...extractParams(sub));
        }
        if (Array.isArray(c["value"])) {
          for (const sub of c["value"]) results.push(...extractParams(sub));
        }
        return results;
      }

      /**
       * Simulate SUM(amount) for a WHERE condition against SEEDED_ORDERS.
       *
       * Rules:
       *   - If a numeric param is present  → filter by merchantId (per-merchant query)
       *   - If a non-status string param is present → filter by providerKey
       *
       * This makes the mock sensitive to the query's predicate scope:
       *   per-merchant query   → numeric param 77 or 78 → returns 150 000 or 100 000
       *   provider-wide query  → no numeric param       → returns 250 000
       */
      function computeTotal(cond: unknown): string {
        const params = extractParams(cond);
        const merchantIdParam = params.find((p) => typeof p === "number") as number | undefined;
        // Status values are "CREATED", "PENDING", "PAID" — filter those out to find providerKey
        const STATUS_VALUES = new Set(["CREATED", "PENDING", "PAID"]);
        const providerKeyParam = params.find(
          (p) => typeof p === "string" && !STATUS_VALUES.has(p as string),
        ) as string | undefined;

        const total = SEEDED_ORDERS.filter((r) => {
          if (merchantIdParam !== undefined && r.merchantId !== merchantIdParam) return false;
          if (providerKeyParam !== undefined && r.providerKey !== providerKeyParam) return false;
          return true;
        }).reduce((sum, r) => sum + r.amount, 0);

        return String(total);
      }

      // ── Merchant B identity ───────────────────────────────────────────────
      const MERCHANT_USER_B = {
        id: 202,
        merchantId: 78,
        role: "merchant" as const,
        email: "ekqr-test-merchant-b@rasokart.test",
        isActive: true,
        passwordUpdatedAt: null,
        isSuperAdmin: false,
      };
      const tokenB = generateToken({ userId: MERCHANT_USER_B.id, role: "merchant" });

      /**
       * Install a query-aware DB mock for a given authenticated merchant user.
       * cashfreePaymentOrdersTable SELECT queries forward the WHERE condition to
       * computeTotal(), which is sensitive to whether merchantId is in the predicate.
       * With the cross-merchant fix, the EKQR pre-check omits merchantId, so
       * computeTotal returns the combined 250 000 total → both requests get 422.
       */
      function installSharedQuotaMock(user: typeof MERCHANT_USER | typeof MERCHANT_USER_B) {
        let sysConfigCall = 0;
        (db as any).select = (_fields?: unknown) => ({
          from: (table: unknown) => ({
            where: (cond: unknown) => {
              if (table === usersTable) return chainable([user]);
              if (table === cashfreePaymentOrdersTable) {
                return chainable([{ total: computeTotal(cond) }]);
              }
              if (table === systemConfigTable) {
                sysConfigCall++;
                if (sysConfigCall === 1) return chainable(payinConfigRows());
                return chainable(upigatewayConfigRows({ dailyLimit: 200_000 }));
              }
              if (table === routingConfigsTable) return chainable([ROUTING_CONFIG]);
              if (table === routingRulesTable) return chainable([ROUTING_RULE]);
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
          set: (_vals: unknown) => ({ where: async () => {} }),
        });
      }

      // ── Merchant A request ────────────────────────────────────────────────
      // Global check      : per-merchant PAID total for 77 = 150 000 < 5 000 000 → passes
      // EKQR pre-check    : cross-merchant provider total = 250 000 + 500 > 200 000 → 422
      installSharedQuotaMock(MERCHANT_USER);
      const savedFetchA = global.fetch;
      global.fetch = async () =>
        ({
          text: async () =>
            JSON.stringify({
              status: true,
              msg: "Order created",
              payment_url: "https://api.ekqr.in/pay/merchant-a-shared-quota",
            }),
        }) as Response;

      let resultA: { status: number; body: Record<string, unknown> };
      try {
        resultA = await post(
          server,
          "/api/merchant/payin/orders",
          { amount: 500, customerPhone: "9876543210", customerName: "Merchant A" },
          token,
        );
      } finally {
        global.fetch = savedFetchA;
      }

      // ── Reset, then Merchant B request ────────────────────────────────────
      (db as any).select = originalSelect;
      (db as any).insert = originalInsert;
      if (originalUpdate) (db as any).update = originalUpdate;
      if (originalExecute) (db as any).execute = originalExecute;
      resetPayinSchemaGuardCacheForTests();

      // Global check      : per-merchant PAID total for 78 = 100 000 < 5 000 000 → passes
      // EKQR pre-check    : cross-merchant provider total = 250 000 + 500 > 200 000 → 422
      installSharedQuotaMock(MERCHANT_USER_B);
      const savedFetchB = global.fetch;
      global.fetch = async () =>
        ({
          text: async () =>
            JSON.stringify({
              status: true,
              msg: "Order created",
              payment_url: "https://api.ekqr.in/pay/merchant-b-shared-quota",
            }),
        }) as Response;

      let resultB: { status: number; body: Record<string, unknown> };
      try {
        resultB = await post(
          server,
          "/api/merchant/payin/orders",
          { amount: 500, customerPhone: "9876543210", customerName: "Merchant B" },
          tokenB,
        );
      } finally {
        global.fetch = savedFetchB;
      }

      // ── Assertions ────────────────────────────────────────────────────────
      // The combined EKQR usage across both merchants exceeds the daily cap.
      const combinedEkqrUsage = SEEDED_ORDERS
        .filter((r) => r.providerKey === "upigateway")
        .reduce((s, r) => s + r.amount, 0);
      assert.ok(
        combinedEkqrUsage > 200_000,
        `Test premise: combined EKQR usage (${combinedEkqrUsage}) must exceed the daily cap (200 000)`,
      );

      // Cross-merchant model → provider total = 250 000 + 500 > 200 000 → both blocked
      assert.equal(
        resultA.status,
        422,
        `Merchant A must be blocked (422) because the cross-merchant provider total ` +
          `(${combinedEkqrUsage}) already exceeds the cap ` +
          `(got ${resultA.status}: ${JSON.stringify(resultA.body)})`,
      );
      assert.ok(
        typeof (resultA.body as Record<string, unknown>)["error"] === "string",
        `Merchant A response must include an error message (got ${JSON.stringify(resultA.body)})`,
      );

      assert.equal(
        resultB.status,
        422,
        `Merchant B must be blocked (422) because the cross-merchant provider total ` +
          `(${combinedEkqrUsage}) already exceeds the cap ` +
          `(got ${resultB.status}: ${JSON.stringify(resultB.body)})`,
      );
      assert.ok(
        typeof (resultB.body as Record<string, unknown>)["error"] === "string",
        `Merchant B response must include an error message (got ${JSON.stringify(resultB.body)})`,
      );
    },
  );

  it(
    "cross-merchant provider cap: exactly one of two sequential orders succeeds when combined usage would exceed the cap",
    async () => {
      // ── Scenario ──────────────────────────────────────────────────────────
      // Provider EKQR daily cap : 100 000
      // Merchant A (merchantId=77) : 0 existing EKQR usage, deposits 60 000
      // Merchant B (merchantId=78) : 0 existing EKQR usage, deposits 60 000
      // Each individually within cap (60 000 < 100 000).
      // Combined: 120 000 > 100 000.
      //
      // Expected: first request (A) succeeds → its CREATED row becomes visible →
      // second request (B) reads provider total = 60 000, adds 60 000 = 120 000
      // which exceeds the cap → B is blocked with 422.
      //
      // The mock is STATEFUL: the insert step in A's advisory-lock transaction
      // pushes into `committedProviderOrders`, and all subsequent
      // cashfreePaymentOrdersTable SELECTs (including B's pre-check) read from
      // that same array — simulating the committed-row visibility that Postgres
      // guarantees after A's transaction commits.

      // ── Shared mutable state ──────────────────────────────────────────────
      const committedProviderOrders: { merchantId: number; amount: number }[] = [];
      const providerTotal = () =>
        committedProviderOrders.reduce((s, r) => s + r.amount, 0);

      // ── Merchant B identity ───────────────────────────────────────────────
      const MERCHANT_USER_B_SEQ = {
        id: 203,
        merchantId: 78,
        role: "merchant" as const,
        email: "ekqr-seq-merchant-b@rasokart.test",
        isActive: true,
        passwordUpdatedAt: null,
        isSuperAdmin: false,
      };
      const tokenBSeq = generateToken({ userId: MERCHANT_USER_B_SEQ.id, role: "merchant" });

      /**
       * Build a stateful DB mock for the given merchant user.
       *
       * All cashfreePaymentOrdersTable SELECTs return the current providerTotal()
       * (cross-merchant, no merchantId filter) so the pre-check and the
       * advisory-lock re-check both see committed CREATED rows from other merchants.
       *
       * db.transaction is mocked so the advisory-lock insert actually pushes
       * into committedProviderOrders, making the state change visible to the
       * next sequential request's pre-check.
       */
      function buildStatefulMock(user: typeof MERCHANT_USER | typeof MERCHANT_USER_B_SEQ) {
        let sysConfigCall = 0;

        (db as any).execute = async () => ({ rows: [] });

        (db as any).select = (_fields?: unknown) => ({
          from: (table: unknown) => ({
            where: (_cond: unknown) => {
              if (table === usersTable) return chainable([user]);
              if (table === cashfreePaymentOrdersTable) {
                // Always return the cross-merchant running total
                return chainable([{ total: String(providerTotal()) }]);
              }
              if (table === systemConfigTable) {
                sysConfigCall++;
                if (sysConfigCall === 1) return chainable(payinConfigRows());
                return chainable(upigatewayConfigRows({ dailyLimit: 100_000, maxAmount: 100_000 }));
              }
              if (table === routingConfigsTable) return chainable([ROUTING_CONFIG]);
              if (table === routingRulesTable) return chainable([ROUTING_RULE]);
              return chainable([]);
            },
          }),
        });

        (db as any).insert = (_table: unknown) => ({
          values: (_vals: unknown) => ({
            returning: async () => [{ id: 999 }],
            onConflictDoNothing: async () => {},
            onConflictDoUpdate: async () => {},
          }),
          catch: () => {},
        });

        (db as any).update = (_table: unknown) => ({
          set: (_vals: unknown) => ({ where: async () => {} }),
        });

        // Mock db.transaction: simulate the advisory-lock transaction without a
        // real DB connection.  The tx object exposes select/insert/execute so the
        // lock helper and getProviderDailyActiveTotal both work correctly, and
        // the insert step updates committedProviderOrders so B's pre-check sees it.
        (db as any).transaction = async (fn: (tx: unknown) => unknown) => {
          let txOrderCallCount = 0;
          const mockTx = {
            execute: async () => ({ rows: [] }), // pg_advisory_xact_lock no-op
            select: (_fields?: unknown) => ({
              from: (table: unknown) => ({
                where: (_cond: unknown) => {
                  if (table === cashfreePaymentOrdersTable) {
                    txOrderCallCount++;
                    if (txOrderCallCount === 1) {
                      // getMerchantDailyActiveTotal: global per-merchant re-check
                      // Return 0 — only EKQR provider cap is under test here
                      return chainable([{ total: "0" }]);
                    }
                    // getProviderDailyActiveTotal: cross-merchant provider re-check
                    return chainable([{ total: String(providerTotal()) }]);
                  }
                  return chainable([]);
                },
              }),
            }),
            insert: (_table: unknown) => ({
              values: (vals: Record<string, unknown>) => ({
                onConflictDoNothing: async () => {
                  // Simulate committed insert — makes the order visible to B's pre-check
                  const amount = Number(vals["amount"]);
                  const merchantId = Number(vals["merchantId"]);
                  if (!isNaN(amount) && !isNaN(merchantId)) {
                    committedProviderOrders.push({ merchantId, amount });
                  }
                },
                onConflictDoUpdate: async () => {},
              }),
            }),
          };
          return fn(mockTx);
        };
      }

      const originalTransaction = (db as any).transaction?.bind(db);

      try {
        // ── Merchant A: deposits 60 000 ───────────────────────────────────
        // Pre-check: provider total = 0, 0 + 60 000 < 100 000 → passes
        // Advisory-lock re-check: provider total = 0 + 60 000 < 100 000 → passes
        // Insert: committedProviderOrders → [{ merchantId:77, amount:60000 }]
        buildStatefulMock(MERCHANT_USER);

        const savedFetchA = global.fetch;
        global.fetch = async () =>
          ({
            text: async () =>
              JSON.stringify({
                status: true,
                msg: "Order created",
                payment_url: "https://api.ekqr.in/pay/seq-merchant-a",
              }),
          }) as Response;

        let resultA: { status: number; body: Record<string, unknown> };
        try {
          resultA = await post(
            server,
            "/api/merchant/payin/orders",
            { amount: 60_000, customerPhone: "9876543210", customerName: "Merchant A Seq" },
            token,
          );
        } finally {
          global.fetch = savedFetchA;
        }

        // ── Reset schema guard cache, then Merchant B ─────────────────────
        resetPayinSchemaGuardCacheForTests();

        // ── Merchant B: deposits 60 000 ───────────────────────────────────
        // Pre-check: provider total = 60 000 (A's committed CREATED row),
        //            60 000 + 60 000 = 120 000 > 100 000 → 422
        buildStatefulMock(MERCHANT_USER_B_SEQ);

        const savedFetchB = global.fetch;
        global.fetch = async () =>
          ({
            text: async () =>
              JSON.stringify({
                status: true,
                msg: "Order created",
                payment_url: "https://api.ekqr.in/pay/seq-merchant-b",
              }),
          }) as Response;

        let resultB: { status: number; body: Record<string, unknown> };
        try {
          resultB = await post(
            server,
            "/api/merchant/payin/orders",
            { amount: 60_000, customerPhone: "9876543210", customerName: "Merchant B Seq" },
            tokenBSeq,
          );
        } finally {
          global.fetch = savedFetchB;
        }

        // ── Assertions ───────────────────────────────────────────────────
        assert.equal(
          resultA.status,
          200,
          `Merchant A (first mover, 0/100 000 used) must succeed ` +
            `(got ${resultA.status}: ${JSON.stringify(resultA.body)})`,
        );
        assert.ok(
          typeof (resultA.body as Record<string, unknown>)["publicOrderId"] === "string",
          `Merchant A response must include publicOrderId (got ${JSON.stringify(resultA.body)})`,
        );

        assert.equal(
          resultB.status,
          422,
          `Merchant B must be blocked (422) because A's committed CREATED row pushes ` +
            `the cross-merchant provider total (${providerTotal()}) over the 100 000 cap ` +
            `(got ${resultB.status}: ${JSON.stringify(resultB.body)})`,
        );
        assert.ok(
          typeof (resultB.body as Record<string, unknown>)["error"] === "string",
          `Merchant B response must include an error message (got ${JSON.stringify(resultB.body)})`,
        );
        assert.match(
          (resultB.body as Record<string, unknown>)["error"] as string,
          /daily/i,
          "Merchant B error message must mention the daily limit",
        );
      } finally {
        // Restore db.transaction so other tests are not affected
        if (originalTransaction) {
          (db as any).transaction = originalTransaction;
        } else {
          delete (db as any).transaction;
        }
      }
    },
  );

  it(
    "cross-merchant provider cap: provider lock blocks the second order even when both merchants passed the pre-check with stale reads",
    async () => {
      // ── Scenario (concurrent race simulation) ─────────────────────────────
      // This test exercises the critical failure mode that the per-merchant lock
      // alone could NOT prevent:
      //
      //   Provider EKQR cap : 100 000
      //   Merchant A (id=77): deposits 60 000 — within cap alone
      //   Merchant B (id=79): deposits 60 000 — within cap alone
      //   Combined          : 120 000 — exceeds the 100 000 cap
      //
      // Race scenario (simulated):
      //   1. Both A and B read the pre-check before either commits → both see
      //      provider total = 0 (stale) → both pass the pre-check.
      //   2. Both receive a payment URL from the EKQR API.
      //   3. Both call withProviderPayinLock("upigateway").  Because the lock
      //      key is derived from the providerKey (not merchantId), BOTH merchants
      //      contend for the SAME pg_advisory_xact_lock key — serialized by PG.
      //   4. A's transaction runs first: re-check sees 0 → passes → CREATED
      //      row committed (liveProviderTotal = 60 000).
      //   5. B's transaction runs after A commits: re-check sees 60 000 →
      //      60 000 + 60 000 > 100 000 → provider_limit_exceeded → 422.
      //
      // Lock-key proof in this test:
      //   The mock captures the pg_advisory_xact_lock parameters from each
      //   transaction's tx.execute call and asserts that A and B used the
      //   SAME (namespace, key) pair — i.e. the lock is keyed on providerKey,
      //   not merchantId.  In real Postgres this same-key guarantee is what
      //   forces serialization; this test verifies the implementation
      //   (withProviderPayinLock) produces it.

      // ── Shared mutable state ──────────────────────────────────────────────
      const committedProviderOrders: { merchantId: number; amount: number }[] = [];
      const liveProviderTotal = () => committedProviderOrders.reduce((s, r) => s + r.amount, 0);

      // Advisory-lock call log: captures (namespace, lockKey) pairs from each
      // transaction's pg_advisory_xact_lock execute call.
      const lockCallLog: Array<{ params: unknown[] }> = [];

      /** Extracts scalar Param values from a Drizzle SQL object's chunk tree. */
      function extractSqlParams(sqlExpr: unknown): unknown[] {
        if (sqlExpr == null || typeof sqlExpr !== "object") return [];
        const obj = sqlExpr as Record<string, unknown>;
        const results: unknown[] = [];
        if (obj["constructor"] != null && (obj["constructor"] as { name?: string }).name === "Param") {
          results.push(obj["value"]);
        }
        if (Array.isArray(obj["queryChunks"])) {
          for (const sub of obj["queryChunks"]) results.push(...extractSqlParams(sub));
        }
        if (Array.isArray(obj["value"])) {
          for (const sub of obj["value"]) results.push(...extractSqlParams(sub));
        }
        return results;
      }

      // ── Merchant B identity ───────────────────────────────────────────────
      const MERCHANT_USER_B_RACE = {
        id: 204,
        merchantId: 79,
        role: "merchant" as const,
        email: "ekqr-race-merchant-b@rasokart.test",
        isActive: true,
        passwordUpdatedAt: null,
        isSuperAdmin: false,
      };
      const tokenBRace = generateToken({ userId: MERCHANT_USER_B_RACE.id, role: "merchant" });

      /**
       * Build a race-aware DB mock for the given merchant user.
       *
       * Pre-check (db.select): always returns 0 for cashfreePaymentOrders —
       * simulating both A and B reading the provider total simultaneously before
       * either commits (stale reads that both pass the pre-check).
       *
       * Transaction (db.transaction / withProviderPayinLock):
       *   - tx.execute: captures pg_advisory_xact_lock params into lockCallLog
       *   - tx.select (1st call): returns 0 for global merchant re-check
       *   - tx.select (2nd call): returns LIVE committedProviderOrders sum —
       *     reflects A's committed CREATED row for B's serialized re-check
       *   - tx.insert: pushes into committedProviderOrders on success
       */
      function buildRaceMock(user: typeof MERCHANT_USER | typeof MERCHANT_USER_B_RACE) {
        let sysConfigCall = 0;

        (db as any).execute = async () => ({ rows: [] });

        (db as any).select = (_fields?: unknown) => ({
          from: (table: unknown) => ({
            where: (_cond: unknown) => {
              if (table === usersTable) return chainable([user]);
              if (table === cashfreePaymentOrdersTable) {
                // Fixed at 0 — stale pre-check snapshot (both A and B pass)
                return chainable([{ total: "0" }]);
              }
              if (table === systemConfigTable) {
                sysConfigCall++;
                if (sysConfigCall === 1) return chainable(payinConfigRows());
                return chainable(upigatewayConfigRows({ dailyLimit: 100_000, maxAmount: 100_000 }));
              }
              if (table === routingConfigsTable) return chainable([ROUTING_CONFIG]);
              if (table === routingRulesTable) return chainable([ROUTING_RULE]);
              return chainable([]);
            },
          }),
        });

        (db as any).insert = (_table: unknown) => ({
          values: (_vals: unknown) => ({
            returning: async () => [{ id: 999 }],
            onConflictDoNothing: async () => {},
            onConflictDoUpdate: async () => {},
          }),
          catch: () => {},
        });

        (db as any).update = (_table: unknown) => ({
          set: (_vals: unknown) => ({ where: async () => {} }),
        });

        // withProviderPayinLock calls db.transaction.  This mock simulates the
        // serialized transaction behavior:
        //   - Captures pg_advisory_xact_lock SQL params for lock-key verification
        //   - Re-checks read the LIVE committedProviderOrders so the second
        //     serialized transaction sees the first's committed CREATED row
        (db as any).transaction = async (fn: (tx: unknown) => unknown) => {
          let txCfCallCount = 0;
          const mockTx = {
            execute: async (sqlExpr: unknown) => {
              // Capture advisory-lock params: (namespace, lockKey)
              const params = extractSqlParams(sqlExpr);
              lockCallLog.push({ params });
              return { rows: [] };
            },
            select: (_fields?: unknown) => ({
              from: (table: unknown) => ({
                where: (_cond: unknown) => {
                  if (table === cashfreePaymentOrdersTable) {
                    txCfCallCount++;
                    if (txCfCallCount === 1) {
                      // getMerchantDailyActiveTotal: per-merchant global re-check
                      return chainable([{ total: "0" }]);
                    }
                    // getProviderDailyActiveTotal: LIVE total — reflects A's
                    // committed CREATED row when B's serialized transaction runs
                    return chainable([{ total: String(liveProviderTotal()) }]);
                  }
                  return chainable([]);
                },
              }),
            }),
            insert: (_table: unknown) => ({
              values: (vals: Record<string, unknown>) => ({
                onConflictDoNothing: async () => {
                  // Simulate commit: makes CREATED row visible to subsequent reads
                  const amount = Number(vals["amount"]);
                  const mid = Number(vals["merchantId"]);
                  if (!isNaN(amount) && !isNaN(mid)) {
                    committedProviderOrders.push({ merchantId: mid, amount });
                  }
                },
                onConflictDoUpdate: async () => {},
              }),
            }),
          };
          return fn(mockTx);
        };
      }

      // ── Merchant A: pre-check sees 0 (stale), gets URL, lock re-check sees 0 ──
      buildRaceMock(MERCHANT_USER);
      const savedFetchA2 = global.fetch;
      global.fetch = async () =>
        ({
          text: async () =>
            JSON.stringify({
              status: true,
              msg: "Order created",
              payment_url: "https://api.ekqr.in/pay/race-merchant-a",
            }),
        }) as Response;

      let resultA: { status: number; body: Record<string, unknown> };
      try {
        resultA = await post(
          server,
          "/api/merchant/payin/orders",
          { amount: 60_000, customerPhone: "9876543210", customerName: "Merchant A Race" },
          token,
        );
      } finally {
        global.fetch = savedFetchA2;
      }

      // A's transaction committed → lockCallLog has 1 entry, liveTotal = 60 000
      assert.equal(
        liveProviderTotal(),
        60_000,
        `After A's request, committed provider total must be 60 000 (got ${liveProviderTotal()})`,
      );

      // ── Reset schema guard cache, install B's mock ─────────────────────────
      resetPayinSchemaGuardCacheForTests();
      buildRaceMock(MERCHANT_USER_B_RACE);

      // ── Merchant B: pre-check also sees 0 (stale), gets URL ───────────────
      // Provider-lock re-check runs AFTER A commits → sees 60 000 → blocked.
      const savedFetchB2 = global.fetch;
      global.fetch = async () =>
        ({
          text: async () =>
            JSON.stringify({
              status: true,
              msg: "Order created",
              payment_url: "https://api.ekqr.in/pay/race-merchant-b",
            }),
        }) as Response;

      let resultB: { status: number; body: Record<string, unknown> };
      try {
        resultB = await post(
          server,
          "/api/merchant/payin/orders",
          { amount: 60_000, customerPhone: "9876543210", customerName: "Merchant B Race" },
          tokenBRace,
        );
      } finally {
        global.fetch = savedFetchB2;
      }

      // ── Assertions ─────────────────────────────────────────────────────────

      // 1. Merchant A (first to commit) succeeds.
      assert.equal(
        resultA.status,
        200,
        `Merchant A (first to commit) must succeed ` +
          `(got ${resultA.status}: ${JSON.stringify(resultA.body)})`,
      );
      assert.ok(
        typeof (resultA.body as Record<string, unknown>)["publicOrderId"] === "string",
        `Merchant A response must include publicOrderId (got ${JSON.stringify(resultA.body)})`,
      );

      // 2. Merchant B (second) is blocked — pre-check was stale (0), but the
      //    provider-lock re-check saw A's 60 000 CREATED row → 422.
      assert.equal(
        resultB.status,
        422,
        `Merchant B (lost the lock race) must be blocked with 422 — ` +
          `the provider lock re-check saw A's 60 000 CREATED row ` +
          `(got ${resultB.status}: ${JSON.stringify(resultB.body)})`,
      );
      assert.ok(
        typeof (resultB.body as Record<string, unknown>)["error"] === "string",
        `Merchant B response must include an error message (got ${JSON.stringify(resultB.body)})`,
      );
      assert.match(
        (resultB.body as Record<string, unknown>)["error"] as string,
        /daily/i,
        "Merchant B error message must mention the daily limit",
      );

      // 3. Exactly one CREATED row committed — cap not exceeded.
      assert.equal(
        committedProviderOrders.length,
        1,
        `Exactly one CREATED row must be committed (got ${committedProviderOrders.length})`,
      );
      assert.equal(
        liveProviderTotal(),
        60_000,
        `Provider total must remain 60 000 after both requests (got ${liveProviderTotal()})`,
      );

      // 4. Lock-key proof: both A and B called pg_advisory_xact_lock with the
      //    SAME (namespace, lockKey) pair.
      //
      //    withProviderPayinLock derives the lockKey from providerKey ("upigateway")
      //    via djb2 hash — NOT from merchantId (77 vs 79).  If the implementation
      //    used a merchant-scoped key, A and B would produce different lock keys
      //    and never block each other in real Postgres.
      //
      //    This assertion proves the implementation is provider-scoped: both
      //    transactions tried to acquire the EXACT same advisory lock, which is
      //    what guarantees serialization in production.
      assert.equal(
        lockCallLog.length,
        2,
        `Both A and B must have called pg_advisory_xact_lock (got ${lockCallLog.length} lock call(s))`,
      );
      assert.deepEqual(
        lockCallLog[0]!.params,
        lockCallLog[1]!.params,
        `A (merchantId=77) and B (merchantId=79) must contend for the SAME advisory lock. ` +
          `A's params: ${JSON.stringify(lockCallLog[0]!.params)}, ` +
          `B's params: ${JSON.stringify(lockCallLog[1]!.params)}. ` +
          `If the params differed the lock would be merchant-scoped and the cross-merchant race would remain open.`,
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
