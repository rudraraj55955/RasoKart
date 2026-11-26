/**
 * Integration tests — Admin Cashfree Payin Reconciliation routes
 *
 * Covers:
 *   RECON-1  GET stuck-orders — report mode never writes to the DB
 *   RECON-2  GET stuck-orders — returns only non-PAID orders in window
 *   RECON-3  GET stuck-orders — includes webhook log evidence counts
 *   RECON-4  POST backfill   — credits an eligible order; audit log written
 *   RECON-5  POST backfill   — already-PAID order returns "duplicate" (no double-credit)
 *   RECON-6  POST backfill   — missing order returns "not_found"
 *   RECON-7  GET/POST        — 401 without auth token
 *   RECON-8  POST backfill   — 400 when cashfreeOrderIds is missing or empty
 *
 * Run:
 *   cd artifacts/api-server
 *   node --import tsx/esm --test \
 *     src/routes/adminCashfreePayinRecon.test.ts
 */

import { describe, it, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  db,
  usersTable,
  cashfreePaymentOrdersTable,
  cashfreePaymentLogsTable,
  merchantWalletsTable,
  walletLedgerTable,
  transactionsTable,
  auditLogsTable,
  PAYIN_ORDER_STATUS,
} from "@workspace/db";
import app from "../app.js";
import { generateToken } from "../middlewares/auth.js";

process.env["SESSION_SECRET"] ??= "rk_ci_cf_payin_recon_test_secret_s32";

// ── Auth helpers ──────────────────────────────────────────────────────────────

const SA_USER_ID = 9300;

const SA_USER_ROW = {
  id:              SA_USER_ID,
  email:           "sa-recon-test@ci.test",
  role:            "admin",
  isActive:        true,
  merchantId:      null,
  passwordUpdatedAt: null,
  isSuperAdmin:    true,  // bypasses requirePermission for SA-only routes
  isSuperAdmin2:   true,
  isPayoutAdmin:   false,
};

function saAuthHeader(): Record<string, string> {
  const token = generateToken({ userId: SA_USER_ID, role: "admin" });
  return { Authorization: `Bearer ${token}` };
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

interface HttpResult {
  status: number;
  body: string;
  json<T = unknown>(): T;
}

function doRequest(
  server: http.Server,
  method: string,
  path: string,
  bodyObj: object | null,
  extraHeaders: Record<string, string> = {},
): Promise<HttpResult> {
  const addr = server.address() as { port: number };
  const data = bodyObj != null ? JSON.stringify(bodyObj) : "";
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: addr.port,
        path,
        method,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
          ...extraHeaders,
        },
      },
      (res) => {
        let body = "";
        res.on("data", (c: Buffer) => { body += c; });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body, json<T>() { return JSON.parse(body) as T; } }));
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

function get(srv: http.Server, path: string, headers: Record<string, string> = {}) {
  return doRequest(srv, "GET", path, null, headers);
}
function post(srv: http.Server, path: string, body: object | null, headers: Record<string, string> = {}) {
  return doRequest(srv, "POST", path, body, headers);
}

// ── Stub DB rows ──────────────────────────────────────────────────────────────

const STUCK_ORDER_ID   = "CF_STUCK_RECON_001";
const PAID_ORDER_ID    = "CF_PAID_RECON_002";
const MISSING_ORDER_ID = "CF_MISSING_RECON_999";

const NOW = new Date();
const WINDOW_START = new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
const WINDOW_END   = new Date(NOW.getTime() + 60 * 1000);               // 1 minute in future

const STUCK_ORDER_ROW = {
  id:              1001,
  merchantId:      42,
  cashfreeOrderId: STUCK_ORDER_ID,
  publicOrderId:   "PO_RECON_001",
  amount:          "500.00",
  currency:        "INR",
  status:          PAYIN_ORDER_STATUS.CREATED,
  utr:             null,
  paidAt:          null,
  createdAt:       new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000),  // 3 days ago
  paymentMethod:   null,
  paymentSessionId: null,
  failureReason:   null,
  rawPayload:      null,
  providerStatus:  null,
  customerEmail:   null,
  customerPhone:   null,
  providerKey:     "cashfree",
  updatedAt:       new Date(),
};

const PAID_ORDER_ROW = {
  ...STUCK_ORDER_ROW,
  id:              1002,
  cashfreeOrderId: PAID_ORDER_ID,
  publicOrderId:   "PO_RECON_002",
  status:          PAYIN_ORDER_STATUS.PAID,
};

const WALLET_ROW = {
  id:               1,
  merchantId:       42,
  availableBalance: "1000.00",
  pendingBalance:   "200.00",
  totalCollection:  "1200.00",
  updatedAt:        new Date(),
};

// ── DB mock ───────────────────────────────────────────────────────────────────
//
// Tracks writes so tests can assert insert was / was not called.

interface DbWriteLog {
  type: "insert" | "update";
  table: string;
  values?: unknown;
}

let dbWriteLog: DbWriteLog[] = [];

function tableName(tbl: unknown): string {
  // Drizzle table objects carry a [Symbol] name; fall back to constructor name.
  if (tbl === usersTable)                   return "users";
  if (tbl === cashfreePaymentOrdersTable)   return "cashfree_payment_orders";
  if (tbl === cashfreePaymentLogsTable)     return "cashfree_payment_logs";
  if (tbl === merchantWalletsTable)         return "merchant_wallets";
  if (tbl === walletLedgerTable)            return "wallet_ledger";
  if (tbl === transactionsTable)            return "transactions";
  if (tbl === auditLogsTable)              return "audit_logs";
  return "unknown";
}

/** Fluent chain that also supports .limit() / .orderBy() / .offset() */
function rows<T>(data: T[]): any {
  const p: any = Promise.resolve(data);
  p.limit    = (n: number) => Promise.resolve(data.slice(0, n));
  p.for      = (_lock: string) => Promise.resolve(data.slice(0, 1));
  p.orderBy  = (..._: unknown[]) => {
    const p2: any = Promise.resolve(data);
    p2.limit  = (n: number) => Promise.resolve(data.slice(0, n));
    p2.offset = () => Promise.resolve([]);
    return p2;
  };
  p.offset = () => Promise.resolve([]);
  return p;
}

function installDbMock(opts: {
  stuckOrderExists: boolean;
  paidOrderExists: boolean;
  walletExists: boolean;
}) {
  (db as any).select = (_cols?: unknown) => {
    let _tbl: unknown = null;
    const chain: any = {
      from(tbl: unknown) {
        _tbl = tbl;
        return chain;
      },
      leftJoin(..._args: unknown[]) { return chain; },
      where(_cond: unknown) {
        if (_tbl === usersTable) return rows([SA_USER_ROW]);
        if (_tbl === cashfreePaymentOrdersTable) {
          const r: unknown[] = [];
          if (opts.stuckOrderExists) r.push(STUCK_ORDER_ROW);
          if (opts.paidOrderExists)  r.push(PAID_ORDER_ROW);
          return rows(r);
        }
        if (_tbl === cashfreePaymentLogsTable)  return rows([]);
        if (_tbl === merchantWalletsTable && opts.walletExists) return rows([WALLET_ROW]);
        return rows([]);
      },
      limit(n: number) {
        if (_tbl === usersTable) return Promise.resolve([SA_USER_ROW].slice(0, n));
        return Promise.resolve([]);
      },
      orderBy(..._: unknown[]) { return rows([]); },
    };
    return chain;
  };

  // transaction() — simulate the per-order DB transaction used in backfillOrder
  (db as any).transaction = async (fn: (tx: any) => Promise<unknown>) => {
    // Build a mini-tx that mirrors the backfill logic:
    //   update → returning 1 row (credit wins) unless the order is already PAID.
    let updateCalled = false;
    const tx: any = {
      update: (tbl: unknown) => {
        updateCalled = true;
        dbWriteLog.push({ type: "update", table: tableName(tbl) });
        return {
          set: () => ({
            where: () => ({
              returning: () => Promise.resolve(
                // Only the stuck order succeeds the atomic gate
                opts.stuckOrderExists ? [{ id: 1001 }] : [],
              ),
            }),
          }),
        };
      },
      insert: (tbl: unknown) => {
        dbWriteLog.push({ type: "insert", table: tableName(tbl) });
        const r: any = Promise.resolve([]);
        r.onConflictDoNothing = () => Promise.resolve([]);
        r.onConflictDoUpdate  = () => Promise.resolve([]);
        return { values: (_v: unknown) => r };
      },
      select: (_cols?: unknown) => {
        let _tbl2: unknown = null;
        const c: any = {
          from(tbl: unknown) { _tbl2 = tbl; return c; },
          where(_: unknown) {
            if (_tbl2 === merchantWalletsTable) return { for: () => Promise.resolve([WALLET_ROW]) };
            return rows([]);
          },
        };
        return c;
      },
    };
    return fn(tx);
  };

  (db as any).insert = (tbl: unknown) => {
    dbWriteLog.push({ type: "insert", table: tableName(tbl) });
    const r: any = Promise.resolve([]);
    r.onConflictDoNothing = () => Promise.resolve([]);
    r.onConflictDoUpdate  = () => Promise.resolve([]);
    return { values: (_v: unknown) => r };
  };

  (db as any).update = (tbl: unknown) => ({
    set: () => ({
      where: () => ({
        returning: () => {
          dbWriteLog.push({ type: "update", table: tableName(tbl) });
          return Promise.resolve([]);
        },
      }),
    }),
  });
}

function restoreDbMock() {
  (db as any).select      = undefined;
  (db as any).insert      = undefined;
  (db as any).update      = undefined;
  (db as any).transaction = undefined;
}

// ── Test server ───────────────────────────────────────────────────────────────

let server: http.Server;

before(async () => {
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
});

after(async () => {
  await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
});

afterEach(() => {
  restoreDbMock();
  dbWriteLog = [];
});

// ── Tests ─────────────────────────────────────────────────────────────────────

const BASE = "/api/admin/cashfree-payin-recon";
const WINDOW_PARAMS = `?since=${WINDOW_START.toISOString()}&until=${WINDOW_END.toISOString()}`;

describe("RECON — Cashfree Payin Reconciliation admin API", () => {

  it("RECON-1: GET stuck-orders — report mode performs zero DB writes", async () => {
    installDbMock({ stuckOrderExists: true, paidOrderExists: false, walletExists: false });

    const resp = await get(server, `${BASE}/stuck-orders${WINDOW_PARAMS}`, saAuthHeader());
    assert.equal(resp.status, 200, `Expected 200; got ${resp.status}. Body: ${resp.body}`);

    const writes = dbWriteLog.filter(w => w.type === "insert" || w.type === "update");
    assert.equal(writes.length, 0, `Report must make ZERO DB writes; found: ${JSON.stringify(writes)}`);
  });

  it("RECON-2: GET stuck-orders — returns only non-PAID orders with correct fields", async () => {
    installDbMock({ stuckOrderExists: true, paidOrderExists: false, walletExists: false });

    const resp = await get(server, `${BASE}/stuck-orders${WINDOW_PARAMS}`, saAuthHeader());
    assert.equal(resp.status, 200);

    const data = resp.json<{ total: number; grandTotal: number; orders: any[] }>();
    assert.equal(data.total, 1, "Should return 1 stuck order");
    assert.ok(data.grandTotal > 0, "grandTotal must be positive");

    const order = data.orders[0]!;
    assert.equal(order.cashfreeOrderId, STUCK_ORDER_ID);
    assert.notEqual(order.status, PAYIN_ORDER_STATUS.PAID, "PAID orders must be excluded from report");
    assert.ok("webhookLogCount" in order, "Order must include webhookLogCount");
    assert.ok("amount" in order, "Order must include amount");
  });

  it("RECON-3: GET stuck-orders — includes webhook log evidence counts (zero when no logs)", async () => {
    installDbMock({ stuckOrderExists: true, paidOrderExists: false, walletExists: false });

    const resp = await get(server, `${BASE}/stuck-orders${WINDOW_PARAMS}`, saAuthHeader());
    assert.equal(resp.status, 200);

    const data = resp.json<{ orders: any[] }>();
    const order = data.orders[0]!;
    assert.equal(typeof order.webhookLogCount, "number", "webhookLogCount must be a number");
    assert.ok(Array.isArray(order.webhookLogResults), "webhookLogResults must be an array");
  });

  it("RECON-4: POST backfill — credits eligible order and writes audit log", async () => {
    installDbMock({ stuckOrderExists: true, paidOrderExists: false, walletExists: true });

    const resp = await post(
      server,
      `${BASE}/backfill`,
      { cashfreeOrderIds: [STUCK_ORDER_ID] },
      { ...saAuthHeader(), "Content-Type": "application/json" },
    );
    assert.equal(resp.status, 200, `Expected 200; got ${resp.status}. Body: ${resp.body}`);

    const data = resp.json<{ results: any[]; summary: any }>();
    assert.equal(data.results.length, 1);

    const result = data.results[0]!;
    assert.equal(result.cashfreeOrderId, STUCK_ORDER_ID);
    assert.equal(result.outcome, "credited", `Expected outcome=credited; got ${result.outcome}. Detail: ${result.detail}`);
    assert.ok(result.detail.includes("₹"), `Detail should include amount; got: ${result.detail}`);

    assert.equal(data.summary.credited, 1);
    assert.equal(data.summary.errors, 0);
    assert.equal(data.summary.duplicate, 0);

    // Audit log must have been inserted (awaited, not fire-and-forget)
    const auditInserts = dbWriteLog.filter(w => w.type === "insert" && w.table === "audit_logs");
    assert.equal(auditInserts.length, 1, "Exactly one audit_logs insert must be recorded per backfilled order");
  });

  it("RECON-5: POST backfill — already-PAID order returns outcome=duplicate (no double-credit)", async () => {
    // Simulate the DB returning a PAID status on lookup (transaction gate returns 0 rows)
    installDbMock({ stuckOrderExists: false, paidOrderExists: true, walletExists: false });

    // Override select to return the PAID order for single-row lookups in backfillOrder
    const originalSelect = (db as any).select;
    (db as any).select = (_cols?: unknown) => {
      let _tbl: unknown = null;
      const chain: any = {
        from(tbl: unknown) { _tbl = tbl; return chain; },
        leftJoin(..._: unknown[]) { return chain; },
        where(_: unknown) {
          if (_tbl === usersTable)                 return rows([SA_USER_ROW]);
          if (_tbl === cashfreePaymentOrdersTable) return rows([PAID_ORDER_ROW]);
          return rows([]);
        },
        limit(n: number) {
          if (_tbl === usersTable) return Promise.resolve([SA_USER_ROW].slice(0, n));
          if (_tbl === cashfreePaymentOrdersTable) return Promise.resolve([PAID_ORDER_ROW].slice(0, n));
          return Promise.resolve([]);
        },
        orderBy(..._: unknown[]) { return rows([]); },
      };
      return chain;
    };

    const resp = await post(
      server,
      `${BASE}/backfill`,
      { cashfreeOrderIds: [PAID_ORDER_ID] },
      { ...saAuthHeader(), "Content-Type": "application/json" },
    );
    assert.equal(resp.status, 200);

    const data = resp.json<{ results: any[]; summary: any }>();
    const result = data.results[0]!;
    assert.equal(result.outcome, "duplicate", `Expected duplicate; got ${result.outcome}`);
    assert.equal(data.summary.duplicate, 1);
    assert.equal(data.summary.credited, 0);

    // No wallet or ledger writes should occur for an already-PAID order
    const walletWrites = dbWriteLog.filter(w => w.table === "merchant_wallets" || w.table === "wallet_ledger");
    assert.equal(walletWrites.length, 0, "No wallet/ledger writes for already-PAID order");
  });

  it("RECON-6: POST backfill — missing order returns outcome=not_found", async () => {
    installDbMock({ stuckOrderExists: false, paidOrderExists: false, walletExists: false });

    const resp = await post(
      server,
      `${BASE}/backfill`,
      { cashfreeOrderIds: [MISSING_ORDER_ID] },
      { ...saAuthHeader(), "Content-Type": "application/json" },
    );
    assert.equal(resp.status, 200);

    const data = resp.json<{ results: any[]; summary: any }>();
    const result = data.results[0]!;
    assert.equal(result.outcome, "not_found", `Expected not_found; got ${result.outcome}`);
    assert.equal(data.summary.notFound, 1);
  });

  it("RECON-7: GET and POST — 401 without auth token", async () => {
    const getResp  = await get(server, `${BASE}/stuck-orders${WINDOW_PARAMS}`);
    const postResp = await post(server, `${BASE}/backfill`, { cashfreeOrderIds: [STUCK_ORDER_ID] });

    assert.ok(
      getResp.status === 401 || getResp.status === 403,
      `GET without auth must return 401/403; got ${getResp.status}`,
    );
    assert.ok(
      postResp.status === 401 || postResp.status === 403,
      `POST without auth must return 401/403; got ${postResp.status}`,
    );
  });

  it("RECON-8: POST backfill — 400 when cashfreeOrderIds is missing or empty array", async () => {
    installDbMock({ stuckOrderExists: false, paidOrderExists: false, walletExists: false });

    const missingResp = await post(
      server,
      `${BASE}/backfill`,
      {},
      { ...saAuthHeader(), "Content-Type": "application/json" },
    );
    assert.equal(missingResp.status, 400, `Missing cashfreeOrderIds must return 400; got ${missingResp.status}`);

    const emptyResp = await post(
      server,
      `${BASE}/backfill`,
      { cashfreeOrderIds: [] },
      { ...saAuthHeader(), "Content-Type": "application/json" },
    );
    assert.equal(emptyResp.status, 400, `Empty cashfreeOrderIds must return 400; got ${emptyResp.status}`);
  });
});
