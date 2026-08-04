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
    "documents per-merchant contract: each merchant is evaluated against only their own EKQR slice, not the combined pool",
    async () => {
      // ── Scenario ──────────────────────────────────────────────────────────
      // Provider EKQR daily cap : 200 000
      // Merchant A (merchantId=77) already paid : 150 000 via EKQR today
      // Merchant B (merchantId=78) already paid : 100 000 via EKQR today
      // Combined usage          : 250 000  — exceeds the 200 000 cap
      //
      // Under the CURRENT per-merchant model the route calls:
      //   getMerchantDailyPaidTotal(merchantId, startOfDay, 'upigateway')
      // which filters by merchantId:
      //   A's slice  : 150 000 + 500 = 150 500 < 200 000 → 200 OK
      //   B's slice  : 100 000 + 500 = 100 500 < 200 000 → 200 OK
      //
      // The DB mock below is QUERY-AWARE: it reads the merchantId Param
      // from the Drizzle WHERE condition and sums only matching rows from
      // the seeded dataset.  If the implementation is ever changed to a
      // provider-scoped aggregate (removing the merchantId filter), the mock
      // will return the COMBINED total (250 000) for both requests, exceeding
      // the cap → 422 → the test fails → the contract change is visible.

      // ── Shared in-memory dataset ──────────────────────────────────────────
      // Each row represents a PAID EKQR order already recorded today.
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
       * Rules that mirror the production getMerchantDailyPaidTotal query:
       *   - Always filters status = 'PAID' (all seeded rows are PAID, so no-op)
       *   - If a numeric param is present  → filter by merchantId
       *   - If a non-'PAID' string param is present → filter by providerKey
       *
       * This makes the mock sensitive to the query's predicate scope:
       *   per-merchant query  → numeric param 77 or 78 → returns 150 000 or 100 000
       *   provider-wide query → no numeric param      → returns 250 000
       */
      function computeTotal(cond: unknown): string {
        const params = extractParams(cond);
        const merchantIdParam = params.find((p) => typeof p === "number") as number | undefined;
        const providerKeyParam = params.find(
          (p) => typeof p === "string" && p !== "PAID",
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
       * computeTotal(), which filters SEEDED_ORDERS by the predicates present
       * in that condition — making the mock sensitive to merchantId scope.
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
      // Global check : seeded total for merchant 77 = 150 000 < 5 000 000 cap → passes
      // EKQR check   : seeded EKQR total for merchant 77 = 150 000 + 500 = 150 500 < 200 000 → passes
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

      // Global check : seeded total for merchant 78 = 100 000 < 5 000 000 cap → passes
      // EKQR check   : seeded EKQR total for merchant 78 = 100 000 + 500 = 100 500 < 200 000 → passes
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

      // Per-merchant model → A's slice is within cap → full dispatch → 200 OK
      assert.equal(
        resultA.status,
        200,
        `Merchant A (150 000/200 000 used) must be accepted under the per-merchant ` +
          `model even though combined EKQR usage (${combinedEkqrUsage}) exceeds the cap ` +
          `(got ${resultA.status}: ${JSON.stringify(resultA.body)})`,
      );
      assert.ok(
        typeof (resultA.body as Record<string, unknown>)["publicOrderId"] === "string",
        `Merchant A response must include publicOrderId (got ${JSON.stringify(resultA.body)})`,
      );

      // Per-merchant model → B's slice is within cap → full dispatch → 200 OK
      assert.equal(
        resultB.status,
        200,
        `Merchant B (100 000/200 000 used) must be accepted under the per-merchant ` +
          `model even though combined EKQR usage (${combinedEkqrUsage}) exceeds the cap ` +
          `(got ${resultB.status}: ${JSON.stringify(resultB.body)})`,
      );
      assert.ok(
        typeof (resultB.body as Record<string, unknown>)["publicOrderId"] === "string",
        `Merchant B response must include publicOrderId (got ${JSON.stringify(resultB.body)})`,
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
