/**
 * Integration test: concurrent payin order submissions — double-spend prevention
 *
 * Verifies that two simultaneous POST /api/merchant/payin/orders requests
 * that together would exceed the merchant's daily cap are serialized at the
 * database layer (pg_advisory_xact_lock) so exactly ONE succeeds and the
 * other is rejected with a 400 "daily limit" error.
 *
 * ## Race being tested
 *
 * Without the advisory lock, both requests read a PAID daily total of 0,
 * both see 0 + 300 ≤ 500, both call the Cashfree provider API, and both
 * insert CREATED rows — effectively doubling the allowed amount.
 *
 * With the lock:
 *   1. Both pre-checks pass (PAID total = 0).
 *   2. Both receive mock Cashfree order responses.
 *   3. Inside withMerchantPayinLock the second caller blocks until the first
 *      transaction commits.
 *   4. The second caller re-reads CREATED+PENDING+PAID (now = 300 from the
 *      first's insert) and rejects because 300 + 300 = 600 > 500.
 *
 * ## Setup strategy
 *
 * • Uses a dedicated merchant (id=9990) and user (id=99900) that are inserted
 *   fresh in `before()` and cleaned up in `after()`.
 * • System-config rows for the Cashfree payin config are upserted with a
 *   tight daily limit (500) and restored after the test.
 * • Any routing configs are temporarily disabled so requests fall through to
 *   the Cashfree path (no external routing rules to configure).
 * • global.fetch is mocked to return a deterministic Cashfree order response
 *   with a unique order-id per call so the UNIQUE constraint on
 *   cashfree_order_id is never violated by the successful insert.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { eq, inArray, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  merchantsTable,
  systemConfigTable,
  cashfreePaymentOrdersTable,
  routingConfigsTable,
  SYSTEM_CONFIG_KEYS,
} from "@workspace/db";
import { generateToken } from "../middlewares/auth";
import { encryptSecret } from "../helpers/cryptoUtils";
import { resetPayinSchemaGuardCacheForTests } from "../helpers/payinSchemaGuard";
import app from "../app";

// ── Helpers ──────────────────────────────────────────────────────────────────

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
          try { resolve({ status: res.statusCode!, body: JSON.parse(raw) }); }
          catch { resolve({ status: res.statusCode!, body: { _raw: raw } }); }
        });
      },
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TEST_MERCHANT_ID = 9990;
const TEST_USER_ID = 99900;
const DAILY_LIMIT = 500;
const ORDER_AMOUNT = 300; // two of these exceed the 500 cap

// System-config keys that will be upserted for the test
const TEST_CONFIG_KEYS = [
  SYSTEM_CONFIG_KEYS.CASHFREE_ENABLED,
  SYSTEM_CONFIG_KEYS.CASHFREE_UPI_ENABLED,
  SYSTEM_CONFIG_KEYS.CASHFREE_MERCHANT_PAYIN_ENABLED,
  SYSTEM_CONFIG_KEYS.CASHFREE_MIN_AMOUNT,
  SYSTEM_CONFIG_KEYS.CASHFREE_MAX_AMOUNT,
  SYSTEM_CONFIG_KEYS.CASHFREE_DAILY_LIMIT,
  SYSTEM_CONFIG_KEYS.CASHFREE_CLIENT_ID,
  SYSTEM_CONFIG_KEYS.CASHFREE_CLIENT_SECRET,
  SYSTEM_CONFIG_KEYS.CASHFREE_ENV,
];

// ── Suite ─────────────────────────────────────────────────────────────────────

describe(
  "POST /api/merchant/payin/orders — concurrent double-spend prevention (real DB)",
  { concurrency: false },
  () => {
    let server: http.Server;
    let token: string;

    // Saved system-config values to restore after the test
    const savedConfig: Record<string, string | null> = {};

    // Routing config IDs that were temporarily disabled
    let disabledRoutingIds: number[] = [];

    // Counter for unique mock Cashfree order IDs
    let fetchCallCount = 0;
    const originalFetch = global.fetch;

    before(async () => {
      if (!process.env["SESSION_SECRET"]) {
        process.env["SESSION_SECRET"] = "test-session-secret-for-race-test";
      }

      // ── 1. Insert test merchant + user ──────────────────────────────────────
      // Use ON CONFLICT DO NOTHING so re-runs are safe. Must supply all NOT NULL
      // columns that have no server-side default (businessName, contactName, etc.)
      await db.execute(sql`
        INSERT INTO merchants (
          id, business_name, contact_name, email, phone,
          status, verification_status, created_at, updated_at
        )
        VALUES (
          ${TEST_MERCHANT_ID},
          'Race Test Merchant',
          'Tester',
          'race-test-merchant@rasokart.test',
          '9876543210',
          'approved',
          'approved',
          NOW(),
          NOW()
        )
        ON CONFLICT (id) DO NOTHING
      `);
      // users.name is NOT NULL; password_hash is nullable.
      const testUserEmail = `race-test-user-${TEST_USER_ID}@rasokart.test`;
      await db.execute(sql`
        INSERT INTO users (id, merchant_id, email, name, role, is_active, created_at, updated_at)
        VALUES (
          ${TEST_USER_ID},
          ${TEST_MERCHANT_ID},
          ${testUserEmail},
          'Race Tester',
          'merchant',
          true,
          NOW(),
          NOW()
        )
        ON CONFLICT (id) DO NOTHING
      `);

      // ── 2. Save existing system-config values ───────────────────────────────
      const existingRows = await db
        .select({ key: systemConfigTable.key, value: systemConfigTable.value })
        .from(systemConfigTable)
        .where(inArray(systemConfigTable.key, TEST_CONFIG_KEYS));
      const existingMap = new Map(existingRows.map((r) => [r.key, r.value]));
      for (const key of TEST_CONFIG_KEYS) {
        savedConfig[key] = existingMap.get(key) ?? null;
      }

      // ── 3. Upsert test config (tight daily limit of 500) ────────────────────
      const encryptedSecret = encryptSecret("test_cashfree_secret_for_race_test");
      const testConfigValues: Record<string, string> = {
        [SYSTEM_CONFIG_KEYS.CASHFREE_ENABLED]: "true",
        [SYSTEM_CONFIG_KEYS.CASHFREE_UPI_ENABLED]: "true",
        [SYSTEM_CONFIG_KEYS.CASHFREE_MERCHANT_PAYIN_ENABLED]: "true",
        [SYSTEM_CONFIG_KEYS.CASHFREE_MIN_AMOUNT]: "1",
        [SYSTEM_CONFIG_KEYS.CASHFREE_MAX_AMOUNT]: "100000",
        [SYSTEM_CONFIG_KEYS.CASHFREE_DAILY_LIMIT]: String(DAILY_LIMIT),
        [SYSTEM_CONFIG_KEYS.CASHFREE_CLIENT_ID]: "test_race_client_id",
        [SYSTEM_CONFIG_KEYS.CASHFREE_CLIENT_SECRET]: encryptedSecret,
        [SYSTEM_CONFIG_KEYS.CASHFREE_ENV]: "test",
      };
      for (const [key, value] of Object.entries(testConfigValues)) {
        await db.execute(sql`
          INSERT INTO system_config (key, value, updated_at)
          VALUES (${key}, ${value}, NOW())
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
        `);
      }

      // ── 4. Disable all routing configs so requests fall through to Cashfree ──
      // If any routing config is active, selectProvider will route away from
      // Cashfree and the test would need to set up provider integrations too.
      const activeConfigs = await db
        .select({ id: routingConfigsTable.id })
        .from(routingConfigsTable)
        .where(eq(routingConfigsTable.isEnabled, true));
      disabledRoutingIds = activeConfigs.map((r) => r.id);
      if (disabledRoutingIds.length > 0) {
        await db.execute(sql`
          UPDATE routing_configs SET is_enabled = false
          WHERE id = ANY(${disabledRoutingIds})
        `);
      }

      // ── 5. Mock global.fetch for Cashfree API calls ──────────────────────────
      // Returns a unique cf_order_id per call so the UNIQUE constraint on
      // cashfree_order_id is never a source of conflict between the two requests.
      fetchCallCount = 0;
      global.fetch = async (url: string | URL | Request, _init?: RequestInit): Promise<Response> => {
        fetchCallCount++;
        const orderId = `RACE_TEST_CF_ORDER_${TEST_MERCHANT_ID}_${fetchCallCount}_${Date.now()}`;
        const responseBody = JSON.stringify({
          cf_order_id: orderId,
          order_id: orderId,
          order_status: "ACTIVE",
          payment_session_id: `sess_${orderId}`,
          order_amount: ORDER_AMOUNT,
          order_currency: "INR",
        });
        return new Response(responseBody, {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      };

      // ── 6. Start HTTP server ─────────────────────────────────────────────────
      resetPayinSchemaGuardCacheForTests();
      server = http.createServer(app);
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      token = generateToken({ userId: TEST_USER_ID, role: "merchant" });
    });

    after(async () => {
      // Restore global.fetch
      global.fetch = originalFetch;

      // Stop server
      await new Promise<void>((resolve) => server.close(() => resolve()));

      // Restore routing configs
      if (disabledRoutingIds.length > 0) {
        await db.execute(sql`
          UPDATE routing_configs SET is_enabled = true
          WHERE id = ANY(${disabledRoutingIds})
        `);
      }

      // Restore system-config values
      for (const [key, originalValue] of Object.entries(savedConfig)) {
        if (originalValue === null) {
          await db.execute(sql`DELETE FROM system_config WHERE key = ${key}`);
        } else {
          await db.execute(sql`
            UPDATE system_config SET value = ${originalValue}, updated_at = NOW()
            WHERE key = ${key}
          `);
        }
      }

      // Clean up test payin orders
      await db
        .delete(cashfreePaymentOrdersTable)
        .where(eq(cashfreePaymentOrdersTable.merchantId, TEST_MERCHANT_ID));

      // Clean up test user and merchant
      await db.execute(sql`DELETE FROM users WHERE id = ${TEST_USER_ID}`);
      await db.execute(sql`DELETE FROM merchants WHERE id = ${TEST_MERCHANT_ID}`);
    });

    it(
      "exactly one of two simultaneous requests succeeds when together they exceed the daily cap",
      async () => {
        // Fire both requests concurrently — neither has any payin orders yet
        // so both pass the PAID-only pre-check (0 + 300 ≤ 500). The advisory
        // lock inside withMerchantPayinLock serializes the definitive
        // CREATED+PENDING+PAID re-check + insert, ensuring only one succeeds.
        const [r1, r2] = await Promise.all([
          post(
            server,
            "/api/merchant/payin/orders",
            { amount: ORDER_AMOUNT, customerPhone: "9876543210", customerName: "Race Tester A" },
            token,
          ),
          post(
            server,
            "/api/merchant/payin/orders",
            { amount: ORDER_AMOUNT, customerPhone: "9876543210", customerName: "Race Tester B" },
            token,
          ),
        ]);

        const statuses = [r1.status, r2.status].sort();

        // Exactly one 200 (order created) and one 400 (daily limit exceeded).
        assert.deepEqual(
          statuses,
          [200, 400],
          `Expected exactly one 200 and one 400, got [${r1.status}, ${r2.status}].\n` +
          `Response A: ${JSON.stringify(r1.body)}\n` +
          `Response B: ${JSON.stringify(r2.body)}`,
        );

        // The 200 response must include a publicOrderId.
        const successResponse = r1.status === 200 ? r1.body : r2.body;
        assert.ok(
          typeof successResponse["publicOrderId"] === "string" ||
          typeof successResponse["paymentToken"] === "string",
          `Successful response must include publicOrderId or paymentToken: ${JSON.stringify(successResponse)}`,
        );

        // The 400 response must mention the daily limit.
        const rejectResponse = r1.status === 400 ? r1.body : r2.body;
        assert.ok(
          typeof rejectResponse["error"] === "string",
          `Rejected response must include error string: ${JSON.stringify(rejectResponse)}`,
        );
        assert.match(
          rejectResponse["error"] as string,
          /daily/i,
          `Rejected response error must mention 'daily': ${JSON.stringify(rejectResponse)}`,
        );

        // Confirm only one CREATED order row was inserted for this merchant.
        const rows = await db
          .select({ id: cashfreePaymentOrdersTable.id })
          .from(cashfreePaymentOrdersTable)
          .where(eq(cashfreePaymentOrdersTable.merchantId, TEST_MERCHANT_ID));

        assert.equal(
          rows.length,
          1,
          `Expected exactly 1 order row in the DB, found ${rows.length}`,
        );
      },
    );
  },
);
