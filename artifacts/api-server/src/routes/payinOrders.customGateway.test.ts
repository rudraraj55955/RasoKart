/**
 * Route-level tests: POST /api/merchant/payin/orders — custom gateway provider cap boundary
 *
 * ## What this test documents
 *
 * The custom gateway advisory-lock block in payinOrders.ts uses
 * `withMerchantPayinLock` (a per-merchant Postgres advisory lock keyed on
 * merchantId). This correctly serializes concurrent requests from the SAME
 * merchant. However, two requests from DIFFERENT merchants acquire different
 * lock keys and never block each other.
 *
 * Concretely: the advisory-lock body calls only
 *   getMerchantDailyActiveTotal(tx, merchantId, startOfDay)
 * which filters by merchantId. There is NO corresponding call to
 *   getProviderDailyActiveTotal(tx, providerStartOfDay, providerKey)
 * which would check the combined cross-merchant usage for this provider.
 *
 * The `provider_integrations` schema already has a `dailyLimit` column that
 * an admin can set per-provider, but the custom-gateway dispatch path in
 * payinOrders.ts never reads or enforces it. If a custom gateway receives a
 * provider-level cap and an admin stores it there, the two-merchant race gap
 * that was fixed for EKQR/UPIGateway would also exist for that custom provider.
 *
 * ## This test confirms the current behavior (gap documented, not yet fixed)
 *
 * Test scenario:
 *   - Custom gateway "my_custom_gw" with dailyLimit=100 000 in provider_integrations
 *   - Merchant A (merchantId=77): 60 000 already active today via this provider
 *   - Merchant B (merchantId=88): 60 000 already active today via this provider
 *   - Combined usage: 120 000 — exceeds the provider's 100 000 dailyLimit
 *   - Each merchant's individual usage: 60 000 < global per-merchant cap (5 000 000)
 *
 * Expected outcome (current code, gap not yet fixed):
 *   - Both Merchant A and Merchant B receive 200 (order created) because the
 *     route only checks getMerchantDailyActiveTotal (per-merchant, ignores B's
 *     contribution to the shared quota).
 *
 * If the cross-merchant cap check is ever added for custom gateways (mirroring
 * the EKQR path), this test should be updated to assert 422 for the second
 * merchant's request instead.
 *
 * @see payinOrders.ekqrLimits.test.ts — EKQR path, which HAS the cross-merchant
 *   check (getProviderDailyActiveTotal + withProviderPayinLock).
 * @see payinAdvisoryLock.ts — getProviderDailyActiveTotal helper.
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
  merchantsTable,
  providerIntegrationsTable,
} from "@workspace/db";
import { generateToken } from "../middlewares/auth";
import { encryptSecret } from "../helpers/cryptoUtils";
import { resetPayinSchemaGuardCacheForTests } from "../helpers/payinSchemaGuard";
import app from "../app";

// ── HTTP helper ─────────────────────────────────────────────────────────────

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

// ── Chainable DB stub ────────────────────────────────────────────────────────

/**
 * Returns a chainable result stub that resolves to `rows` regardless of
 * whether the caller awaits the chain directly (.where() / .from()) or
 * calls .limit() / .orderBy() first.
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

// ── Test suite ───────────────────────────────────────────────────────────────

describe(
  "POST /api/merchant/payin/orders — custom gateway cross-merchant provider cap (gap documented)",
  () => {
    let server: http.Server;

    // Merchant A
    const MERCHANT_A = {
      id: 301,
      merchantId: 77,
      role: "merchant" as const,
      email: "custom-gw-merchant-a@rasokart.test",
      isActive: true,
      passwordUpdatedAt: null,
      isSuperAdmin: false,
    };

    // Merchant B (different merchant, same custom gateway)
    const MERCHANT_B = {
      id: 302,
      merchantId: 88,
      role: "merchant" as const,
      email: "custom-gw-merchant-b@rasokart.test",
      isActive: true,
      passwordUpdatedAt: null,
      isSuperAdmin: false,
    };

    let tokenA: string;
    let tokenB: string;

    // Custom gateway provider key and integration row.
    // `dailyLimit` is stored in provider_integrations but the route never
    // reads it for cross-merchant enforcement — that is the gap this test
    // documents.
    const CUSTOM_PROVIDER_KEY = "my_custom_gw";
    const CUSTOM_PROVIDER_DAILY_LIMIT = 100_000;
    let encryptedApiKey: string;

    const ROUTING_CONFIG = {
      id: 20,
      configName: "custom-gw-test-config",
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
      id: 5,
      configId: 20,
      providerKey: CUSTOM_PROVIDER_KEY,
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

    /** Global Cashfree payin config — limits set wide so they never block. */
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

    /** Integration row for the custom gateway. dailyLimit is set but not enforced cross-merchant. */
    function integrationRow() {
      return {
        id: 9,
        providerKey: CUSTOM_PROVIDER_KEY,
        providerNameInternal: "My Custom GW",
        displayNamePublic: "My Custom Gateway",
        environment: "test",
        isEnabled: true,
        productType: "payin",
        webhookUrl: "https://my-custom-gw.example.com",
        notes: null,
        isCustom: true,
        apiKeyEncrypted: encryptedApiKey,
        apiSecretEncrypted: encryptSecret("custom_gw_secret"),
        webhookSecretEncrypted: null,
        apiBaseUrl: null,
        clientIdEncrypted: null,
        clientSecretEncrypted: null,
        minAmount: "1",
        maxAmount: "1000000",
        dailyLimit: String(CUSTOM_PROVIDER_DAILY_LIMIT),
        supportsDynamicQr: false,
        supportsStaticQr: false,
        supportsPaymentLinks: true,
        supportsWebhooks: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        updatedByEmail: null,
        collectionType: "api_gateway",
        ownUpiId: null,
        ownQrImageUrl: null,
        ownAccountHolder: null,
      };
    }

    /**
     * Installs a DB mock for a given merchant user.
     *
     * `merchantDailyActiveTotal` — how many rupees this merchant already has
     * active today via the custom gateway.  Returned for all
     * cashfreePaymentOrdersTable SELECT calls (both the outer PAID-only global
     * check and the inner CREATED+PENDING+PAID re-check inside the advisory
     * lock).  Setting this below the 5 000 000 global cap ensures the
     * per-merchant checks always pass.
     *
     * The mock intentionally does NOT return a combined cross-merchant total —
     * mirroring what the production code actually does:  the custom gateway
     * path only issues per-merchant queries, so the mock only needs to answer
     * per-merchant queries.  A provider-wide total is never requested.
     */
    function installDbMock(
      user: typeof MERCHANT_A | typeof MERCHANT_B,
      merchantDailyActiveTotal: number,
    ) {
      (db as any).select = (_fields?: unknown) => ({
        from: (table: unknown) => ({
          where: (_cond: unknown) => {
            if (table === usersTable) {
              return chainable([user]);
            }
            if (table === merchantsTable) {
              // Timezone lookup for per-day window calculation
              return chainable([{ timezone: null }]);
            }
            if (table === systemConfigTable) {
              // loadPayinConfig — only called once for the custom gateway path
              // (no loadUpigatewayConfig equivalent)
              return chainable(payinConfigRows());
            }
            if (table === cashfreePaymentOrdersTable) {
              // getMerchantDailyPaidTotal (outer, PAID-only global check) and
              // getMerchantDailyActiveTotal (inner lock re-check) both return
              // the same per-merchant total — the code never calls a cross-
              // merchant variant, so one value covers both.
              return chainable([{ total: String(merchantDailyActiveTotal) }]);
            }
            if (table === routingConfigsTable) {
              return chainable([ROUTING_CONFIG]);
            }
            if (table === routingRulesTable) {
              return chainable([ROUTING_RULE]);
            }
            if (table === providerIntegrationsTable) {
              // The route reads the integration row to get credentials and
              // webhookUrl.  dailyLimit is present in the row but the route
              // never reads it to enforce a cross-merchant cap.
              return chainable([integrationRow()]);
            }
            if (table === routingLogsTable) {
              return chainable([{ id: 999 }]);
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

      // ── db.transaction mock (withMerchantPayinLock) ──────────────────────
      // withMerchantPayinLock calls db.transaction → this mock simulates the
      // per-merchant advisory lock transaction without hitting Postgres.
      //
      // Crucially: the tx.select mock only handles cashfreePaymentOrdersTable
      // queries (getMerchantDailyActiveTotal = per-merchant re-check).
      // There is NO mock for getProviderDailyActiveTotal because the custom
      // gateway path never calls it — that is exactly the gap under test.
      (db as any).transaction = async (fn: (tx: unknown) => unknown) => {
        const mockTx = {
          execute: async () => ({ rows: [] }), // pg_advisory_xact_lock no-op
          select: (_fields?: unknown) => ({
            from: (table: unknown) => ({
              where: (_cond: unknown) => {
                if (table === cashfreePaymentOrdersTable) {
                  // getMerchantDailyActiveTotal: per-merchant re-check only.
                  // Returns the same per-merchant total — still well under the
                  // global 5 000 000 cap — so the per-merchant guard passes.
                  return chainable([{ total: String(merchantDailyActiveTotal) }]);
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
          update: (_table: unknown) => ({
            set: (_vals: unknown) => ({ where: async () => {} }),
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
        process.env["SESSION_SECRET"] = "test-session-secret-custom-gw-tests";
      }
      encryptedApiKey = encryptSecret("custom_gw_api_key_test_12345");

      server = http.createServer(app);
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      tokenA = generateToken({ userId: MERCHANT_A.id, role: "merchant" });
      tokenB = generateToken({ userId: MERCHANT_B.id, role: "merchant" });
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

    /**
     * Mock fetch for the custom gateway API call.
     * Returns a successful order creation response with a payment URL.
     */
    function withMockedCustomGwFetch<T>(fn: () => Promise<T>): Promise<T> {
      const savedFetch = global.fetch;
      global.fetch = async (_url: unknown, _init?: unknown) => {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              order_id: `CUSTOM_GW_ORDER_${Date.now()}`,
              payment_url: "https://my-custom-gw.example.com/pay/test-session",
              status: "created",
            }),
        } as Response;
      };
      return fn().finally(() => { global.fetch = savedFetch; });
    }

    it(
      "cross-merchant provider cap gap: both merchants succeed even when their combined usage " +
      "exceeds the custom gateway's dailyLimit (documents absence of cross-merchant check)",
      async () => {
        // ── Scenario ────────────────────────────────────────────────────────
        // Provider "my_custom_gw" daily limit in provider_integrations: 100 000
        //
        // Merchant A (merchantId=77): 60 000 already active today via this provider
        // Merchant B (merchantId=88): 60 000 already active today via this provider
        // Combined active usage: 120 000 — exceeds the 100 000 dailyLimit field
        //
        // Current code path for custom gateways (payinOrders.ts ~line 509):
        //   withMerchantPayinLock(merchantId, async (tx) => {
        //     const activeTotal = await getMerchantDailyActiveTotal(tx, merchantId, startOfDay);
        //     if (activeTotal + depositAmount > cfg.dailyLimit) { ... }
        //     // ← NO getProviderDailyActiveTotal call here
        //   });
        //
        // Because the lock is per-merchant and the re-check is per-merchant,
        // both A and B independently see only their own slice of 60 000, which
        // is comfortably below the global 5 000 000 Cashfree cap → both pass.
        // The custom gateway's 100 000 dailyLimit in provider_integrations is
        // never read by this code path → both orders are created successfully.
        //
        // This test asserts the CURRENT behavior (both succeed) so any future
        // refactor that inadvertently starts enforcing or breaks the check is
        // immediately visible. If cross-merchant enforcement is intentionally
        // added for custom gateways, update the assertions to 422 for the
        // second request (mirroring the EKQR test).

        const MERCHANT_A_ACTIVE_TODAY = 60_000;
        const MERCHANT_B_ACTIVE_TODAY = 60_000;
        const DEPOSIT_AMOUNT = 500;

        // ── Test premise verification ────────────────────────────────────
        const combinedUsage = MERCHANT_A_ACTIVE_TODAY + MERCHANT_B_ACTIVE_TODAY;
        assert.ok(
          combinedUsage > CUSTOM_PROVIDER_DAILY_LIMIT,
          `Test premise: combined usage (${combinedUsage}) must exceed provider dailyLimit ` +
          `(${CUSTOM_PROVIDER_DAILY_LIMIT}) to expose the cross-merchant gap`,
        );
        assert.ok(
          MERCHANT_A_ACTIVE_TODAY < 5_000_000,
          "Test premise: Merchant A's individual usage must be below the global 5 000 000 cap",
        );
        assert.ok(
          MERCHANT_B_ACTIVE_TODAY < 5_000_000,
          "Test premise: Merchant B's individual usage must be below the global 5 000 000 cap",
        );

        // ── Merchant A request ──────────────────────────────────────────
        // Per-merchant check for A: 60 000 + 500 = 60 500 < 5 000 000 → passes
        // No cross-merchant check → order created (200)
        installDbMock(MERCHANT_A, MERCHANT_A_ACTIVE_TODAY);

        const resultA = await withMockedCustomGwFetch(() =>
          post(
            server,
            "/api/merchant/payin/orders",
            { amount: DEPOSIT_AMOUNT, customerPhone: "9876543210", customerName: "Merchant A" },
            tokenA,
          ),
        );

        // ── Reset, then Merchant B request ──────────────────────────────
        (db as any).select = originalSelect;
        (db as any).insert = originalInsert;
        if (originalUpdate) (db as any).update = originalUpdate;
        if (originalExecute) (db as any).execute = originalExecute;
        if (originalTransaction) (db as any).transaction = originalTransaction;
        resetPayinSchemaGuardCacheForTests();

        // Per-merchant check for B: 60 000 + 500 = 60 500 < 5 000 000 → passes
        // No cross-merchant check → order created (200)
        // Combined across A + B: (60 000 + 500) + (60 000 + 500) = 121 000 > 100 000
        // but the code never computes this combined total for custom gateways.
        installDbMock(MERCHANT_B, MERCHANT_B_ACTIVE_TODAY);

        const resultB = await withMockedCustomGwFetch(() =>
          post(
            server,
            "/api/merchant/payin/orders",
            { amount: DEPOSIT_AMOUNT, customerPhone: "9876543210", customerName: "Merchant B" },
            tokenB,
          ),
        );

        // ── Assertions ──────────────────────────────────────────────────
        // CURRENT BEHAVIOR (gap not yet fixed): both succeed.
        // The custom gateway path uses withMerchantPayinLock (per-merchant)
        // and checks only getMerchantDailyActiveTotal (per-merchant).
        // Neither merchant's request reads the other's committed CREATED rows
        // for this provider, so the provider-scoped 100 000 dailyLimit is
        // effectively unenforced across merchants.
        //
        // If this assertion fails (e.g. 422 instead of 200), it means a
        // cross-merchant check has been added for custom gateways — update
        // the test accordingly and document the new behavior.

        assert.equal(
          resultA.status,
          200,
          `Merchant A must succeed (200) because the custom-gateway path has no ` +
          `cross-merchant provider cap check (got ${resultA.status}: ${JSON.stringify(resultA.body)})`,
        );
        assert.ok(
          typeof (resultA.body as Record<string, unknown>)["publicOrderId"] === "string" ||
          typeof (resultA.body as Record<string, unknown>)["paymentToken"] === "string",
          `Merchant A response must include publicOrderId or paymentToken ` +
          `(got ${JSON.stringify(resultA.body)})`,
        );

        assert.equal(
          resultB.status,
          200,
          `Merchant B must also succeed (200) — the per-merchant check passes for each ` +
          `merchant independently (60 000 < 5 000 000 global cap); the combined ` +
          `${combinedUsage} > ${CUSTOM_PROVIDER_DAILY_LIMIT} provider cap is never ` +
          `checked cross-merchant (got ${resultB.status}: ${JSON.stringify(resultB.body)})`,
        );
        assert.ok(
          typeof (resultB.body as Record<string, unknown>)["publicOrderId"] === "string" ||
          typeof (resultB.body as Record<string, unknown>)["paymentToken"] === "string",
          `Merchant B response must include publicOrderId or paymentToken ` +
          `(got ${JSON.stringify(resultB.body)})`,
        );
      },
    );

    it(
      "single merchant: per-merchant daily limit is still enforced for custom gateways",
      async () => {
        // Sanity check: the existing per-merchant cap enforcement still works.
        // Global daily limit: 5 000 000; merchant already has 4 999 800 active.
        // Deposit of 500 would push to 5 000 300 > 5 000 000 → 400.
        const merchantActiveTotal = 4_999_800;

        installDbMock(MERCHANT_A, merchantActiveTotal);

        const savedFetch = global.fetch;
        global.fetch = async () =>
          ({
            text: async () =>
              JSON.stringify({
                order_id: "CUSTOM_GW_BLOCKED_ORDER",
                payment_url: "https://my-custom-gw.example.com/pay/blocked",
              }),
          }) as Response;

        let result: { status: number; body: Record<string, unknown> };
        try {
          result = await post(
            server,
            "/api/merchant/payin/orders",
            { amount: 500, customerPhone: "9876543210", customerName: "Near-Limit Merchant" },
            tokenA,
          );
        } finally {
          global.fetch = savedFetch;
        }

        assert.equal(
          result.status,
          400,
          `Per-merchant daily limit must still be enforced for custom gateways ` +
          `(got ${result.status}: ${JSON.stringify(result.body)})`,
        );
        assert.ok(
          typeof (result.body as Record<string, unknown>)["error"] === "string",
          "Response must include an error message",
        );
        assert.match(
          (result.body as Record<string, unknown>)["error"] as string,
          /daily/i,
          "Error message must mention the daily limit",
        );
      },
    );
  },
);
