/**
 * Integration tests: /api/system-config/cashfree-stuck-order-alert endpoints
 * and cashfreeStuckOrderScheduler config pickup.
 *
 * Covers:
 *   GET  /api/system-config/cashfree-stuck-order-alert  — returns defaults or stored values
 *   PUT  /api/system-config/cashfree-stuck-order-alert  — persists threshold/staleMinutes/cooldownHours
 *   Boundary validation — threshold < 1, staleMinutes < 5, cooldownHours > 168 all return 400
 *   Scheduler pickup — runStuckCashfreeOrderScan reads config from DB and counts matching orders
 *
 * Uses a real database throughout. The after() hook restores config to the
 * values that existed before the suite ran, so subsequent tests are unaffected.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { eq, and, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  merchantsTable,
  cashfreePaymentOrdersTable,
  systemConfigTable,
  SYSTEM_CONFIG_KEYS,
  SYSTEM_CONFIG_DEFAULTS,
  PAYIN_ORDER_STATUS,
} from "@workspace/db";
import { generateToken } from "../middlewares/auth";
import app from "../app";
import { runStuckCashfreeOrderScan } from "../helpers/cashfreeStuckOrderScheduler";

// ── HTTP helpers ─────────────────────────────────────────────────────────────

type HttpResult = { status: number; body: Record<string, unknown> };

function httpRequest(
  server: http.Server,
  method: string,
  path: string,
  token: string,
  body?: Record<string, unknown>,
): Promise<HttpResult> {
  const addr = server.address() as { port: number };
  const payload = body !== undefined ? JSON.stringify(body) : undefined;
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: addr.port,
        path,
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(payload
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload),
              }
            : {}),
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
    if (payload) req.end(payload);
    else req.end();
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Read stored config value from DB directly (returns null when absent). */
async function readConfigValue(key: string): Promise<string | null> {
  const [row] = await db
    .select({ value: systemConfigTable.value })
    .from(systemConfigTable)
    .where(eq(systemConfigTable.key, key))
    .limit(1);
  return row?.value ?? null;
}

// ── Suite ────────────────────────────────────────────────────────────────────

describe(
  "cashfree-stuck-order-alert config endpoints + scheduler pickup (real DB)",
  () => {
    let server: http.Server;
    let token: string;

    // Values that were in DB before the suite ran — restored in after()
    let originalThreshold: string | null;
    let originalStaleMinutes: string | null;
    let originalCooldownHours: string | null;

    // Seeded order IDs and merchant IDs to clean up
    const insertedOrderIds: number[] = [];
    const insertedMerchantIds: number[] = [];

    before(async () => {
      // Start an in-process server on a random port
      server = http.createServer(app);
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );

      // Get an admin token
      const [admin] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.email, "admin@rasokart.com"))
        .limit(1);
      assert.ok(
        admin,
        "admin@rasokart.com must exist in the seeded DB for this test",
      );
      token = generateToken({ userId: admin!.id, role: "admin" });

      // Snapshot current config so we can restore it
      originalThreshold     = await readConfigValue(SYSTEM_CONFIG_KEYS.CASHFREE_STUCK_ORDER_ALERT_THRESHOLD);
      originalStaleMinutes  = await readConfigValue(SYSTEM_CONFIG_KEYS.CASHFREE_STUCK_ORDER_STALE_MINUTES);
      originalCooldownHours = await readConfigValue(SYSTEM_CONFIG_KEYS.CASHFREE_STUCK_ORDER_ALERT_COOLDOWN_HOURS);
    });

    after(async () => {
      // Restore each config key to its pre-test state
      for (const [key, original, defaultVal] of [
        [
          SYSTEM_CONFIG_KEYS.CASHFREE_STUCK_ORDER_ALERT_THRESHOLD,
          originalThreshold,
          SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.CASHFREE_STUCK_ORDER_ALERT_THRESHOLD],
        ],
        [
          SYSTEM_CONFIG_KEYS.CASHFREE_STUCK_ORDER_STALE_MINUTES,
          originalStaleMinutes,
          SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.CASHFREE_STUCK_ORDER_STALE_MINUTES],
        ],
        [
          SYSTEM_CONFIG_KEYS.CASHFREE_STUCK_ORDER_ALERT_COOLDOWN_HOURS,
          originalCooldownHours,
          SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.CASHFREE_STUCK_ORDER_ALERT_COOLDOWN_HOURS],
        ],
      ] as Array<[string, string | null, string]>) {
        const restoreValue = original ?? defaultVal;
        await db
          .insert(systemConfigTable)
          .values({ key, value: restoreValue })
          .onConflictDoUpdate({
            target: systemConfigTable.key,
            set: { value: restoreValue, updatedAt: sql`now()` },
          });
      }

      // Remove seeded test orders first (FK dependency on merchants)
      if (insertedOrderIds.length > 0) {
        for (const id of insertedOrderIds) {
          await db
            .delete(cashfreePaymentOrdersTable)
            .where(eq(cashfreePaymentOrdersTable.id, id));
        }
      }

      // Remove seeded test merchants
      if (insertedMerchantIds.length > 0) {
        for (const id of insertedMerchantIds) {
          await db
            .delete(merchantsTable)
            .where(eq(merchantsTable.id, id));
        }
      }

      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    // ── GET — returns defaults or stored values ────────────────────────────

    describe("GET /api/system-config/cashfree-stuck-order-alert", () => {
      it("returns HTTP 200 with numeric threshold, staleMinutes, and cooldownHours", async () => {
        const res = await httpRequest(
          server,
          "GET",
          "/api/system-config/cashfree-stuck-order-alert",
          token,
        );
        assert.equal(
          res.status,
          200,
          `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`,
        );
        assert.equal(typeof res.body["threshold"], "number", "threshold must be a number");
        assert.equal(typeof res.body["staleMinutes"], "number", "staleMinutes must be a number");
        assert.equal(typeof res.body["cooldownHours"], "number", "cooldownHours must be a number");
      });

      it("returns the system defaults when no custom values are stored", async () => {
        // Delete the three keys to force defaults
        for (const key of [
          SYSTEM_CONFIG_KEYS.CASHFREE_STUCK_ORDER_ALERT_THRESHOLD,
          SYSTEM_CONFIG_KEYS.CASHFREE_STUCK_ORDER_STALE_MINUTES,
          SYSTEM_CONFIG_KEYS.CASHFREE_STUCK_ORDER_ALERT_COOLDOWN_HOURS,
        ]) {
          await db
            .delete(systemConfigTable)
            .where(eq(systemConfigTable.key, key));
        }

        const res = await httpRequest(
          server,
          "GET",
          "/api/system-config/cashfree-stuck-order-alert",
          token,
        );
        assert.equal(res.status, 200);
        assert.equal(
          res.body["threshold"],
          parseInt(SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.CASHFREE_STUCK_ORDER_ALERT_THRESHOLD]),
          "threshold should default to system default when not stored",
        );
        assert.equal(
          res.body["staleMinutes"],
          parseInt(SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.CASHFREE_STUCK_ORDER_STALE_MINUTES]),
          "staleMinutes should default to system default when not stored",
        );
        assert.equal(
          res.body["cooldownHours"],
          parseInt(SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.CASHFREE_STUCK_ORDER_ALERT_COOLDOWN_HOURS]),
          "cooldownHours should default to system default when not stored",
        );
      });
    });

    // ── PUT — persists and GET reads back ─────────────────────────────────

    describe("PUT /api/system-config/cashfree-stuck-order-alert", () => {
      it("saves custom threshold/staleMinutes/cooldownHours and GET reads them back", async () => {
        const customThreshold     = 7;
        const customStaleMinutes  = 30;
        const customCooldownHours = 6;

        const putRes = await httpRequest(
          server,
          "PUT",
          "/api/system-config/cashfree-stuck-order-alert",
          token,
          {
            threshold:     customThreshold,
            staleMinutes:  customStaleMinutes,
            cooldownHours: customCooldownHours,
          },
        );
        assert.equal(
          putRes.status,
          200,
          `PUT failed: ${JSON.stringify(putRes.body)}`,
        );
        assert.equal(putRes.body["threshold"],     customThreshold,     "PUT response threshold");
        assert.equal(putRes.body["staleMinutes"],  customStaleMinutes,  "PUT response staleMinutes");
        assert.equal(putRes.body["cooldownHours"], customCooldownHours, "PUT response cooldownHours");

        // GET must reflect the new values
        const getRes = await httpRequest(
          server,
          "GET",
          "/api/system-config/cashfree-stuck-order-alert",
          token,
        );
        assert.equal(getRes.status, 200);
        assert.equal(getRes.body["threshold"],     customThreshold,     "GET threshold after PUT");
        assert.equal(getRes.body["staleMinutes"],  customStaleMinutes,  "GET staleMinutes after PUT");
        assert.equal(getRes.body["cooldownHours"], customCooldownHours, "GET cooldownHours after PUT");
      });

      it("values are persisted in the DB, not just echoed by the response", async () => {
        const putRes = await httpRequest(
          server,
          "PUT",
          "/api/system-config/cashfree-stuck-order-alert",
          token,
          { threshold: 12, staleMinutes: 45, cooldownHours: 8 },
        );
        assert.equal(putRes.status, 200);

        // Read directly from DB to confirm persistence
        const storedThreshold     = await readConfigValue(SYSTEM_CONFIG_KEYS.CASHFREE_STUCK_ORDER_ALERT_THRESHOLD);
        const storedStaleMinutes  = await readConfigValue(SYSTEM_CONFIG_KEYS.CASHFREE_STUCK_ORDER_STALE_MINUTES);
        const storedCooldownHours = await readConfigValue(SYSTEM_CONFIG_KEYS.CASHFREE_STUCK_ORDER_ALERT_COOLDOWN_HOURS);

        assert.equal(storedThreshold,     "12", "threshold persisted in system_config");
        assert.equal(storedStaleMinutes,  "45", "staleMinutes persisted in system_config");
        assert.equal(storedCooldownHours, "8",  "cooldownHours persisted in system_config");
      });
    });

    // ── Boundary validation ───────────────────────────────────────────────

    describe("PUT boundary validation", () => {
      // Valid base payload
      const valid = { threshold: 5, staleMinutes: 15, cooldownHours: 4 };

      it("rejects threshold < 1 with 400", async () => {
        const res = await httpRequest(
          server,
          "PUT",
          "/api/system-config/cashfree-stuck-order-alert",
          token,
          { ...valid, threshold: 0 },
        );
        assert.equal(res.status, 400, `Expected 400 for threshold=0, got ${res.status}`);
        assert.ok(
          typeof res.body["error"] === "string",
          "400 response must include an error message",
        );
      });

      it("rejects threshold = 0 (non-positive integer) with 400", async () => {
        const res = await httpRequest(
          server,
          "PUT",
          "/api/system-config/cashfree-stuck-order-alert",
          token,
          { ...valid, threshold: -1 },
        );
        assert.equal(res.status, 400);
      });

      it("rejects staleMinutes < 5 with 400", async () => {
        const res = await httpRequest(
          server,
          "PUT",
          "/api/system-config/cashfree-stuck-order-alert",
          token,
          { ...valid, staleMinutes: 4 },
        );
        assert.equal(res.status, 400, `Expected 400 for staleMinutes=4, got ${res.status}`);
        assert.ok(typeof res.body["error"] === "string");
      });

      it("rejects staleMinutes = 0 with 400", async () => {
        const res = await httpRequest(
          server,
          "PUT",
          "/api/system-config/cashfree-stuck-order-alert",
          token,
          { ...valid, staleMinutes: 0 },
        );
        assert.equal(res.status, 400);
      });

      it("rejects cooldownHours > 168 with 400", async () => {
        const res = await httpRequest(
          server,
          "PUT",
          "/api/system-config/cashfree-stuck-order-alert",
          token,
          { ...valid, cooldownHours: 169 },
        );
        assert.equal(res.status, 400, `Expected 400 for cooldownHours=169, got ${res.status}`);
        assert.ok(typeof res.body["error"] === "string");
      });

      it("rejects non-integer threshold with 400", async () => {
        const res = await httpRequest(
          server,
          "PUT",
          "/api/system-config/cashfree-stuck-order-alert",
          token,
          { ...valid, threshold: 3.5 },
        );
        assert.equal(res.status, 400);
      });

      it("rejects missing threshold with 400", async () => {
        const { threshold: _omit, ...withoutThreshold } = valid;
        const res = await httpRequest(
          server,
          "PUT",
          "/api/system-config/cashfree-stuck-order-alert",
          token,
          withoutThreshold as Record<string, unknown>,
        );
        assert.equal(res.status, 400);
      });

      it("accepts boundary values threshold=1, staleMinutes=5, cooldownHours=168 with 200", async () => {
        const res = await httpRequest(
          server,
          "PUT",
          "/api/system-config/cashfree-stuck-order-alert",
          token,
          { threshold: 1, staleMinutes: 5, cooldownHours: 168 },
        );
        assert.equal(
          res.status,
          200,
          `Expected 200 for boundary-valid values, got ${res.status}: ${JSON.stringify(res.body)}`,
        );
      });
    });

    // ── Scheduler pickup ──────────────────────────────────────────────────

    describe("runStuckCashfreeOrderScan picks up saved config", () => {
      it(
        "uses the threshold and staleMinutes saved via PUT, not hard-coded defaults",
        async () => {
          const customThreshold    = 10000; // very high — ensures alertSent stays false (no email)
          const customStaleMinutes = 60;

          // Persist custom config
          const putRes = await httpRequest(
            server,
            "PUT",
            "/api/system-config/cashfree-stuck-order-alert",
            token,
            {
              threshold:     customThreshold,
              staleMinutes:  customStaleMinutes,
              cooldownHours: 4,
            },
          );
          assert.equal(
            putRes.status,
            200,
            `PUT failed before scheduler test: ${JSON.stringify(putRes.body)}`,
          );

          // Run the scheduler
          const result = await runStuckCashfreeOrderScan();

          // The returned staleMinutes and threshold must reflect what we saved
          assert.equal(
            result.staleMinutes,
            customStaleMinutes,
            `Scheduler read staleMinutes=${result.staleMinutes} but expected ${customStaleMinutes} from saved config`,
          );
          assert.equal(
            result.threshold,
            customThreshold,
            `Scheduler read threshold=${result.threshold} but expected ${customThreshold} from saved config`,
          );
          // With threshold=10000 the alert must never fire
          assert.equal(
            result.alertSent,
            false,
            "alertSent must be false when stuckCount < 10000 threshold",
          );
        },
      );

      it(
        "counts a seeded CREATED order older than staleMinutes for a production merchant",
        async () => {
          // Save threshold=10000 to avoid sending emails, staleMinutes=90 to catch a 95-min-old order
          await httpRequest(
            server,
            "PUT",
            "/api/system-config/cashfree-stuck-order-alert",
            token,
            {
              threshold:     10000,
              staleMinutes:  90,
              cooldownHours: 4,
            },
          );

          // Insert a temporary production merchant (the seeded DB only has demo merchants)
          const testEmail = `stuck-test-merchant-${Date.now()}@test.invalid`;
          const [testMerchant] = await db
            .insert(merchantsTable)
            .values({
              businessName: "Stuck Order Test Merchant",
              contactName:  "Test",
              email:        testEmail,
              phone:        "9999999999",
              environment:  "production",
            } as any)
            .returning({ id: merchantsTable.id });
          assert.ok(testMerchant?.id, "Test production merchant must be inserted");
          insertedMerchantIds.push(testMerchant!.id);

          // Seed a CREATED order that is 95 minutes old (beyond the 90-min stale window)
          const staleCreatedAt = new Date(Date.now() - 95 * 60 * 1000);
          const uniqueId = `TEST_STUCK_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

          const [inserted] = await db
            .insert(cashfreePaymentOrdersTable)
            .values({
              merchantId:      testMerchant!.id,
              cashfreeOrderId: uniqueId,
              amount:          "1.00",
              currency:        "INR",
              status:          PAYIN_ORDER_STATUS.CREATED,
              createdAt:       staleCreatedAt,
            } as any)
            .returning({ id: cashfreePaymentOrdersTable.id });

          assert.ok(inserted?.id, "Seeded order must have an ID");
          insertedOrderIds.push(inserted!.id);

          // Run the scan — staleMinutes=90, so the 95-min-old order must be counted
          const resultWith = await runStuckCashfreeOrderScan();

          assert.ok(
            resultWith.stuckCount >= 1,
            `Expected stuckCount >= 1 with staleMinutes=90 and a 95-min-old CREATED order, got ${resultWith.stuckCount}`,
          );
          assert.equal(resultWith.staleMinutes, 90, "Scanner must use the saved staleMinutes=90");

          // Now save staleMinutes=120 (wider than 95 min) — the same order must NOT be counted
          await httpRequest(
            server,
            "PUT",
            "/api/system-config/cashfree-stuck-order-alert",
            token,
            {
              threshold:     10000,
              staleMinutes:  120,
              cooldownHours: 4,
            },
          );

          const resultWithout = await runStuckCashfreeOrderScan();

          // The seeded order is only 95 min old; the window is now 120 min → not stale yet.
          // We can't assert stuckCount === 0 because other stuck orders may exist in the DB,
          // but we CAN assert the scanner used the new staleMinutes value.
          assert.equal(
            resultWithout.staleMinutes,
            120,
            "Scanner must pick up the updated staleMinutes=120 on the next run",
          );
        },
      );

      it("excludes wallet-load orders (cashfreeOrderId LIKE 'WLOAD_%') from the stuck count", async () => {
        // Save config that would catch any order older than 5 min
        await httpRequest(
          server,
          "PUT",
          "/api/system-config/cashfree-stuck-order-alert",
          token,
          { threshold: 10000, staleMinutes: 5, cooldownHours: 4 },
        );

        // Insert a temporary production merchant (seeded DB only has demo merchants)
        const testEmail = `wload-test-merchant-${Date.now()}@test.invalid`;
        const [prodMerchant] = await db
          .insert(merchantsTable)
          .values({
            businessName: "WLOAD Test Merchant",
            contactName:  "Test",
            email:        testEmail,
            phone:        "8888888888",
            environment:  "production",
          } as any)
          .returning({ id: merchantsTable.id });
        assert.ok(prodMerchant, "At least one production merchant must exist");
        insertedMerchantIds.push(prodMerchant!.id);

        // Seed a WLOAD order that is 10 minutes old (clearly stale)
        const staleCreatedAt = new Date(Date.now() - 10 * 60 * 1000);
        const wloadId = `WLOAD_TEST_STUCK_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        const [inserted] = await db
          .insert(cashfreePaymentOrdersTable)
          .values({
            merchantId:     prodMerchant!.id,
            cashfreeOrderId: wloadId,
            amount:          "1.00",
            currency:        "INR",
            status:          PAYIN_ORDER_STATUS.CREATED,
            createdAt:       staleCreatedAt,
          } as any)
          .returning({ id: cashfreePaymentOrdersTable.id });

        assert.ok(inserted?.id, "Seeded WLOAD order must have an ID");
        insertedOrderIds.push(inserted!.id);

        // The WLOAD order must be excluded from the count
        // Record the count before and after inserting the wallet order
        const resultBefore = await runStuckCashfreeOrderScan();

        // Delete the WLOAD order and run again to get the baseline
        await db
          .delete(cashfreePaymentOrdersTable)
          .where(eq(cashfreePaymentOrdersTable.id, inserted!.id));
        insertedOrderIds.splice(insertedOrderIds.indexOf(inserted!.id), 1);

        const resultAfter = await runStuckCashfreeOrderScan();

        // The WLOAD order must not have increased the count
        assert.equal(
          resultBefore.stuckCount,
          resultAfter.stuckCount,
          `WLOAD_ order must be excluded from stuck count (before=${resultBefore.stuckCount}, after=${resultAfter.stuckCount})`,
        );
      });
    });
  },
);
