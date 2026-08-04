/**
 * Route-level tests: POST /api/qr-codes — EKQR amount and daily-limit enforcement
 *
 * Covers five requirements that guard the EkQR QR code creation path:
 *
 * 1. parsedAmount below EKQR minAmount → 400 (provider-level floor)
 * 2. parsedAmount above EKQR maxAmount → 400 (provider-level ceiling)
 * 3. parsedAmount exactly at EKQR minAmount → accepted (exact boundary — not below)
 * 4. parsedAmount exactly at EKQR maxAmount → accepted (exact boundary — not above)
 * 5. ekqrDailyTotal + parsedAmount > ekqrDailyLimit → 400 (daily cap exhausted)
 *
 * These tests guard the enforcement block in qrCodes.ts (lines ~359-398) against
 * future refactors that could silently remove the checks, allowing over-limit
 * amounts to reach the EKQR API and fail with a confusing provider-level error.
 *
 * Error-message contract (what the frontend displays):
 *   - Amount out of range: "Amount must be between ₹{min} and ₹{max}"
 *   - Daily cap hit:       "Daily deposit limit reached for this payment method.
 *                           Please try again tomorrow or contact support."
 *
 * Mock architecture:
 *   db.select() dispatches are keyed by the `from(table)` argument so each
 *   upstream table returns the right fixture data. The qrPaymentEventsTable daily
 *   query uses .innerJoin(qrCodesTable,...) — the chainable() helper propagates
 *   the fixture data through every chain step (.leftJoin, .innerJoin, .where,
 *   .limit, .orderBy) so the termination pattern doesn't matter.
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  db,
  usersTable,
  systemConfigTable,
  merchantConnectionsTable,
  merchantsTable,
  qrCodesTable,
  qrPaymentEventsTable,
} from "@workspace/db";
// These tables are accessed via helper modules imported by qrCodes.ts
import { merchantPlansTable, plansTable } from "@workspace/db";
import { generateToken } from "../middlewares/auth";
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

// ─── Chainable DB result stub ─────────────────────────────────────────────────
//
// Supports every termination pattern used in the QR code creation path:
//   await db.select().from(t).where(cond)           → .where() is the terminus
//   await db.select().from(t).where(cond).limit(n)  → .limit() is the terminus
//   await db.select().from(t).leftJoin(...).where(...).limit(n)
//   await db.select().from(t).innerJoin(...).where(...)
//
function chainable(rows: unknown[]) {
  const self: {
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => unknown;
    limit: (n?: number) => Promise<unknown[]>;
    orderBy: (col: unknown) => typeof self;
    where: (cond: unknown) => typeof self;
    leftJoin: (table: unknown, cond: unknown) => typeof self;
    innerJoin: (table: unknown, cond: unknown) => typeof self;
  } = {
    then(resolve, reject) {
      return Promise.resolve(rows).then(resolve, reject);
    },
    limit: (_n?: number) => Promise.resolve(rows),
    orderBy: (_col: unknown) => chainable(rows),
    where: (_cond: unknown) => chainable(rows),
    leftJoin: (_t: unknown, _c: unknown) => chainable(rows),
    innerJoin: (_t: unknown, _c: unknown) => chainable(rows),
  };
  return self;
}

// ─── Test fixtures ────────────────────────────────────────────────────────────

const MERCHANT_USER = {
  id: 301,
  merchantId: 88,
  role: "merchant" as const,
  email: "qr-ekqr-test@rasokart.test",
  isActive: true,
  passwordUpdatedAt: null,
  isSuperAdmin: false,
};

// A plan with very high limits so checkPlanLimit always passes.
const PLAN_FIXTURE = {
  id: 1,
  name: "Gold",
  dynamicQrLimit: 10000,
  staticQrLimit: 10000,
  virtualAccountLimit: 100,
  paymentLinkLimit: 100,
  payoutLimit: 100,
  dailyTransactionLimit: 100000,
  monthlyTransactionLimit: 1000000,
  apiAccess: true,
  webhookAccess: true,
};

const MERCHANT_PLAN_FIXTURE = {
  id: 1,
  merchantId: MERCHANT_USER.merchantId,
  planId: 1,
  expiresAt: null,
  assignedAt: new Date("2025-01-01"),
  renewedAt: null,
};

const EKQR_CONNECTION_FIXTURE = {
  id: 10,
  merchantId: MERCHANT_USER.merchantId,
  provider: "ekqr",
  isActive: true,
  credentials: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

/** System-config rows returned by the EKQR config query. */
function ekqrConfigRows(opts: {
  minAmount?: number;
  maxAmount?: number;
  dailyLimit?: number;
} = {}) {
  return [
    { key: "ekqr_enabled", value: "true" },
    { key: "ekqr_api_key", value: "test-ekqr-api-key-not-encrypted" },
    { key: "ekqr_min_amount", value: String(opts.minAmount ?? 100) },
    { key: "ekqr_max_amount", value: String(opts.maxAmount ?? 50000) },
    { key: "ekqr_daily_limit", value: String(opts.dailyLimit ?? 200000) },
  ];
}

// ─── DB mock installer ────────────────────────────────────────────────────────

/**
 * Replaces db.select / db.insert / db.update / db.execute with stubs that
 * feed fixture data to each table the POST /api/qr-codes handler queries.
 *
 * @param ekqrDailyTotal  EKQR daily volume already accumulated (simulates a
 *                        near-full cap when set close to dailyLimit).
 * @param configOpts      EKQR min / max / dailyLimit to surface via system_config.
 */
function installDbMock(
  ekqrDailyTotal: number,
  configOpts: { minAmount?: number; maxAmount?: number; dailyLimit?: number } = {},
) {
  (db as any).select = (_fields?: unknown) => ({
    from: (table: unknown) => {
      // Auth middleware — requireAuth queries usersTable
      if (table === usersTable) return chainable([MERCHANT_USER]);

      // checkPlanLimit → getPlanForMerchant (from merchantPlansTable leftJoin plansTable)
      if (table === merchantPlansTable) {
        return chainable([{ plan: PLAN_FIXTURE, mp: MERCHANT_PLAN_FIXTURE }]);
      }

      // checkPlanLimit → count of existing QR codes for this merchant
      if (table === qrCodesTable) {
        return chainable([{ total: 0, n: 0 }]);
      }

      // Active provider connections for this merchant
      if (table === merchantConnectionsTable) {
        return chainable([EKQR_CONNECTION_FIXTURE]);
      }

      // Merchant business name + timezone (null = UTC/server default)
      if (table === merchantsTable) {
        return chainable([{ businessName: "Test EKQR Merchant", timezone: null }]);
      }

      // EKQR system config (EKQR_ENABLED, EKQR_API_KEY, min/max/daily)
      if (table === systemConfigTable) {
        return chainable(ekqrConfigRows(configOpts));
      }

      // Daily limit query: db.select({total}).from(qrPaymentEventsTable)
      //   .innerJoin(qrCodesTable, ...).where(...)
      // The innerJoin target is qrCodesTable but the from() target is qrPaymentEventsTable.
      if (table === qrPaymentEventsTable) {
        return chainable([{ total: String(ekqrDailyTotal) }]);
      }

      return chainable([]);
    },
  });

  (db as any).execute = async () => ({ rows: [] });

  (db as any).insert = (_table: unknown) => ({
    values: (_vals: unknown) => ({
      returning: async () => [{
        id: 999,
        merchantId: MERCHANT_USER.merchantId,
        type: "dynamic",
        label: null,
        payload: "",
        amount: null,
        orderId: null,
        callbackUrl: null,
        merchantReference: null,
        expiresAt: null,
        status: "active",
        ekqrOrderId: null,
        ekqrPaymentUrl: null,
        providerKey: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }],
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

  (db as any).delete = (_table: unknown) => ({
    where: async () => {},
    catch: () => {},
  });
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("POST /api/qr-codes — EKQR amount and daily-limit enforcement", () => {
  let server: http.Server;
  let token: string;

  const originalSelect = (db as any).select?.bind(db);
  const originalInsert = (db as any).insert?.bind(db);
  const originalUpdate = (db as any).update?.bind(db);
  const originalExecute = (db as any).execute?.bind(db);
  const originalDelete = (db as any).delete?.bind(db);

  before(async () => {
    if (!process.env["SESSION_SECRET"]) {
      process.env["SESSION_SECRET"] = "test-session-secret-for-qr-ekqr-limit-tests";
    }
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    token = generateToken({ userId: MERCHANT_USER.id, role: "merchant" });
  });

  after(async () => {
    if (originalSelect) (db as any).select = originalSelect;
    if (originalInsert) (db as any).insert = originalInsert;
    if (originalUpdate) (db as any).update = originalUpdate;
    if (originalExecute) (db as any).execute = originalExecute;
    if (originalDelete) (db as any).delete = originalDelete;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    if (originalSelect) (db as any).select = originalSelect;
    if (originalInsert) (db as any).insert = originalInsert;
    if (originalUpdate) (db as any).update = originalUpdate;
    if (originalExecute) (db as any).execute = originalExecute;
    if (originalDelete) (db as any).delete = originalDelete;
  });

  // ── 1. Amount below minimum ───────────────────────────────────────────────

  it("returns 400 when amount is below the EKQR minimum", async () => {
    installDbMock(0, { minAmount: 100, maxAmount: 50000, dailyLimit: 200000 });

    const { status, body } = await post(
      server,
      "/api/qr-codes",
      { type: "dynamic", amount: "50" },
      token,
    );

    assert.equal(
      status,
      400,
      `Expected 400 for amount below EKQR min but got ${status}: ${JSON.stringify(body)}`,
    );
    assert.ok(
      typeof body["error"] === "string",
      "Response must include an error string",
    );
    assert.match(
      body["error"] as string,
      /₹100/,
      "Error must mention the EKQR minimum (₹100)",
    );
    assert.match(
      body["error"] as string,
      /₹50000/,
      "Error must mention the EKQR maximum (₹50000)",
    );
  });

  // ── 2. Amount above maximum ───────────────────────────────────────────────

  it("returns 400 when amount is above the EKQR maximum", async () => {
    installDbMock(0, { minAmount: 100, maxAmount: 50000, dailyLimit: 200000 });

    const { status, body } = await post(
      server,
      "/api/qr-codes",
      { type: "dynamic", amount: "75000" },
      token,
    );

    assert.equal(
      status,
      400,
      `Expected 400 for amount above EKQR max but got ${status}: ${JSON.stringify(body)}`,
    );
    assert.ok(
      typeof body["error"] === "string",
      "Response must include an error string",
    );
    assert.match(
      body["error"] as string,
      /₹50000/,
      "Error must mention the EKQR maximum (₹50000)",
    );
  });

  // ── 3. Amount exactly at minimum boundary ────────────────────────────────

  it("accepts amount exactly equal to the EKQR minimum (boundary — not rejected)", async () => {
    // ekqrMinAmount = 100; sending exactly 100 must NOT trigger the range error.
    // The mock stubs fetch so the EKQR API call returns a valid order.
    installDbMock(0, { minAmount: 100, maxAmount: 50000, dailyLimit: 200000 });

    const originalFetch = global.fetch;
    global.fetch = async () =>
      ({
        text: async () =>
          JSON.stringify({
            status: true,
            msg: "Order created",
            payment_url: "https://api.ekqr.in/pay/boundary-min-order",
          }),
      }) as Response;

    try {
      const { status, body } = await post(
        server,
        "/api/qr-codes",
        { type: "dynamic", amount: "100" },
        token,
      );

      assert.notEqual(
        status,
        400,
        `Amount exactly at EKQR min must not be rejected with 400 (got ${status}: ${JSON.stringify(body)})`,
      );
      // A 201 (created) or 502 (EKQR API failure in test env) are both acceptable
      // evidence that the route passed the amount-range guard.
      assert.ok(
        status === 201 || status === 502,
        `Expected 201 or 502 for boundary-min amount but got ${status}: ${JSON.stringify(body)}`,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  // ── 4. Amount exactly at maximum boundary ────────────────────────────────

  it("accepts amount exactly equal to the EKQR maximum (boundary — not rejected)", async () => {
    // ekqrMaxAmount = 50000; sending exactly 50000 must NOT trigger the range error.
    installDbMock(0, { minAmount: 100, maxAmount: 50000, dailyLimit: 200000 });

    const originalFetch = global.fetch;
    global.fetch = async () =>
      ({
        text: async () =>
          JSON.stringify({
            status: true,
            msg: "Order created",
            payment_url: "https://api.ekqr.in/pay/boundary-max-order",
          }),
      }) as Response;

    try {
      const { status, body } = await post(
        server,
        "/api/qr-codes",
        { type: "dynamic", amount: "50000" },
        token,
      );

      assert.notEqual(
        status,
        400,
        `Amount exactly at EKQR max must not be rejected with 400 (got ${status}: ${JSON.stringify(body)})`,
      );
      assert.ok(
        status === 201 || status === 502,
        `Expected 201 or 502 for boundary-max amount but got ${status}: ${JSON.stringify(body)}`,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  // ── 5. Daily limit exhausted ──────────────────────────────────────────────

  it("returns 400 when ekqrDailyTotal + amount would exceed the EKQR daily cap", async () => {
    // Daily limit = 200 000; set today's total to 199 700 so adding 500 tips it over.
    installDbMock(199_700, { minAmount: 100, maxAmount: 50000, dailyLimit: 200000 });

    const { status, body } = await post(
      server,
      "/api/qr-codes",
      { type: "dynamic", amount: "500" },
      token,
    );

    assert.equal(
      status,
      400,
      `Expected 400 when EKQR daily cap is exceeded but got ${status}: ${JSON.stringify(body)}`,
    );
    assert.ok(
      typeof body["error"] === "string",
      "Response must include an error string",
    );
    assert.match(
      body["error"] as string,
      /daily/i,
      "Error must mention the daily limit",
    );
    assert.match(
      body["error"] as string,
      /try again tomorrow/i,
      "Error must tell the merchant to try again tomorrow",
    );
  });

  // ── 6. Non-UTC timezone — daily-limit cutoff uses the merchant's local midnight ──

  it("uses the merchant's local timezone for the EKQR daily-limit window (IST midnight ≠ UTC midnight)", async () => {
    // This test proves that the EKQR daily-limit cutoff in POST /api/qr-codes is computed
    // from the merchant's preferred timezone rather than from `new Date().setHours(0,0,0,0)`
    // (server/UTC midnight).
    //
    // If the cutoff were always UTC midnight, an IST merchant (UTC+5:30) who made EKQR
    // payments between 18:30 UTC yesterday and 00:00 UTC today would see those payments
    // excluded from today's UTC window — effectively resetting 5.5h early.  With the
    // timezone-aware cutoff, those payments are counted in the IST "today" window
    // (which starts at 18:30 UTC yesterday).
    //
    // We verify the fix by capturing the `receivedAt` GTE cutoff passed to the DB query
    // and asserting it matches the CURRENT IST midnight, not the current UTC midnight.
    // Both values are computed dynamically so the test doesn't rely on a hardcoded date.
    const capturedCutoffs: number[] = [];

    // Compute expected cutoffs relative to "now" so the test isn't date-sensitive.
    // IST midnight = start of local day in Asia/Kolkata; UTC midnight = start of UTC day.
    const now = new Date();
    function startOfDayMs(tz: string): number {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: tz,
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
        hour12: false,
      }).formatToParts(now);
      const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? 0);
      // Iterate to find the UTC ms for zone midnight (same approach as getStartOfDayInTimezone)
      const today = { year: get("year"), month: get("month"), day: get("day") };
      let utcMs = Date.UTC(today.year, today.month - 1, today.day);
      for (let i = 0; i < 3; i++) {
        const cp = new Intl.DateTimeFormat("en-CA", {
          timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
          hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
        }).formatToParts(new Date(utcMs));
        const cg = (t: string) => Number(cp.find(p => p.type === t)?.value ?? 0);
        const errorMs = Date.UTC(cg("year"), cg("month")-1, cg("day"), cg("hour"), cg("minute"), cg("second"))
                       - Date.UTC(today.year, today.month-1, today.day, 0, 0, 0);
        if (errorMs === 0) break;
        utcMs -= errorMs;
      }
      return utcMs;
    }
    const istMidnightMs = startOfDayMs("Asia/Kolkata");
    const utcMidnightMs = startOfDayMs("UTC");
    // IST midnight and UTC midnight must differ (5h30m apart) — sanity check
    assert.ok(istMidnightMs !== utcMidnightMs, "IST midnight and UTC midnight must differ by 5.5h");

    // Install a mock that:
    // a) returns the merchant WITH timezone = "Asia/Kolkata" (IST)
    // b) captures any Date values threaded into WHERE clauses
    (db as any).select = (_fields?: unknown) => ({
      from: (table: unknown) => {
        if (table === usersTable) return chainable([MERCHANT_USER]);
        if (table === merchantPlansTable) return chainable([{ plan: PLAN_FIXTURE, mp: MERCHANT_PLAN_FIXTURE }]);
        if (table === qrCodesTable) return chainable([{ total: 0, n: 0 }]);
        if (table === merchantConnectionsTable) return chainable([EKQR_CONNECTION_FIXTURE]);
        if (table === merchantsTable) return chainable([{ businessName: "IST Merchant", timezone: "Asia/Kolkata" }]);
        if (table === systemConfigTable) return chainable(ekqrConfigRows());
        if (table === qrPaymentEventsTable) {
          // Chainable that captures any Date passed to .where()
          return {
            innerJoin: () => ({
              where: async (clause: any) => {
                function collectDates(node: any, seen = new Set<any>()): void {
                  if (!node || typeof node !== "object" || seen.has(node)) return;
                  seen.add(node);
                  if (node instanceof Date) { capturedCutoffs.push(node.getTime()); return; }
                  if ("value" in node && node.value instanceof Date) { capturedCutoffs.push(node.value.getTime()); return; }
                  for (const v of Object.values(node)) collectDates(v, seen);
                }
                collectDates(clause);
                return [{ total: "0" }]; // no prior volume → won't be blocked by cap
              },
            }),
          };
        }
        return chainable([]);
      },
    });
    (db as any).execute = async () => ({ rows: [] });
    (db as any).insert = (_table: unknown) => ({
      values: (_vals: unknown) => ({
        returning: async () => [{
          id: 999, merchantId: MERCHANT_USER.merchantId, type: "dynamic",
          label: null, payload: "", amount: null, orderId: null,
          callbackUrl: null, merchantReference: null, expiresAt: null,
          status: "active", ekqrOrderId: null, ekqrPaymentUrl: null,
          providerKey: null, createdAt: new Date(), updatedAt: new Date(),
        }],
        onConflictDoNothing: async () => {},
        onConflictDoUpdate: async () => {},
      }),
      catch: () => {},
    });
    (db as any).update = (_table: unknown) => ({
      set: (_vals: unknown) => ({ where: async () => {} }),
    });
    (db as any).delete = (_table: unknown) => ({
      where: async () => {},
      catch: () => {},
    });

    // Stub fetch so the EKQR API call succeeds
    const originalFetch = global.fetch;
    global.fetch = async () =>
      ({ text: async () => JSON.stringify({ status: true, msg: "Order created", payment_url: "https://api.ekqr.in/pay/tz-test" }) }) as Response;

    try {
      await post(server, "/api/qr-codes", { type: "dynamic", amount: "500" }, token);
    } finally {
      global.fetch = originalFetch;
    }

    // The daily-limit WHERE clause must reference IST midnight, not UTC midnight.
    assert.ok(
      capturedCutoffs.includes(istMidnightMs),
      `EKQR daily-limit cutoff must be IST midnight (${new Date(istMidnightMs).toISOString()}) ` +
      `when merchant timezone is Asia/Kolkata. Captured: ${capturedCutoffs.map(t => new Date(t).toISOString())}`,
    );
    assert.ok(
      !capturedCutoffs.includes(utcMidnightMs),
      `EKQR daily-limit cutoff must NOT be UTC midnight (${new Date(utcMidnightMs).toISOString()}) for an IST merchant`,
    );
  });

  // ── 7. Valid amount — proceeds to dispatch ────────────────────────────────

  it("passes through to EKQR dispatch when amount is inside the range and daily headroom exists", async () => {
    // amount 500, min 100, max 50000, daily total 0, daily limit 200000 — should pass all checks
    installDbMock(0, { minAmount: 100, maxAmount: 50000, dailyLimit: 200000 });

    const originalFetch = global.fetch;
    global.fetch = async () =>
      ({
        text: async () =>
          JSON.stringify({
            status: true,
            msg: "Order created",
            payment_url: "https://api.ekqr.in/pay/valid-order-xyz",
          }),
      }) as Response;

    try {
      const { status, body } = await post(
        server,
        "/api/qr-codes",
        { type: "dynamic", amount: "500" },
        token,
      );

      assert.equal(
        status,
        201,
        `Expected 201 for valid EKQR amount but got ${status}: ${JSON.stringify(body)}`,
      );
      assert.ok(
        typeof body["id"] === "number",
        "Response must include the QR code id",
      );
      assert.equal(
        body["provider"],
        "ekqr",
        "Response must confirm the ekqr provider was used",
      );
    } finally {
      global.fetch = originalFetch;
    }
  });
});
