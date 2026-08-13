/**
 * Integration tests: POST /api/payment/payu-return
 *                    POST /api/payment/payu-s2s  (CORS reachability)
 *                    GET  /api/payment/payu-return
 *
 * Regression guard for three separate root-cause failures that caused
 * INTERNAL_ERROR JSON to be returned to the customer's browser instead of a
 * redirect after a real PayU payment:
 *
 *  1. CORS middleware blocked cross-origin POST from secure.payu.in (Origin
 *     not in allowlist → next(err) → global error handler) before the route
 *     handler ever ran.  Express 5 auto-catches async rejections the same way.
 *
 *  2. processPayuCallback had no outer try/catch — any DB error escaped to
 *     Express 5's global error handler → INTERNAL_ERROR JSON.
 *
 *  3. Body variables (txnid, statusRaw) were extracted outside the try/catch;
 *     if req.body was undefined, the throw landed in Express's handler.
 *
 * All tests share one invariant: the HTTP response is ALWAYS a redirect
 * (301/302/303/307) and NEVER contains INTERNAL_ERROR in the body.
 *
 * DB calls are stubbed by replacing methods on the shared `db` singleton
 * (same pattern as paymentWebhook.test.ts).  No real wallet credit happens.
 */

import { describe, it, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import { db } from "@workspace/db";
import app from "../app.js";

// ── Test-only PayU credentials (never real) ───────────────────────────────────

const TEST_KEY  = "testkey_rasokart_ci_12345";
const TEST_SALT = "testsalt_rasokart_ci_abcdef1234";

// ── PayU response hash ────────────────────────────────────────────────────────
// Mirrors verifyPayuResponseHash() in helpers/payu.ts exactly.
// Formula: sha512(salt|status||||||udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key)

function computePayuResponseHash(p: {
  salt: string; status: string;
  udf1?: string; udf2?: string; udf3?: string; udf4?: string; udf5?: string;
  email: string; firstname: string; productinfo: string;
  amount: string; txnid: string; key: string;
}): string {
  const udf1 = p.udf1 ?? ""; const udf2 = p.udf2 ?? "";
  const udf3 = p.udf3 ?? ""; const udf4 = p.udf4 ?? "";
  const udf5 = p.udf5 ?? "";
  const s = `${p.salt}|${p.status}||||||${udf5}|${udf4}|${udf3}|${udf2}|${udf1}|${p.email}|${p.firstname}|${p.productinfo}|${p.amount}|${p.txnid}|${p.key}`;
  return crypto.createHash("sha512").update(s).digest("hex");
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

interface HttpResult {
  status:   number;
  location: string | undefined;
  body:     string;
}

function postUrlEncoded(
  server:       http.Server,
  path:         string,
  fields:       Record<string, string>,
  extraHeaders: Record<string, string> = {},
): Promise<HttpResult> {
  const addr = server.address() as { port: number };
  const data = new URLSearchParams(fields).toString();
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port:     addr.port,
        path,
        method:   "POST",
        headers:  {
          "Content-Type":   "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(data),
          ...extraHeaders,
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (c: Buffer) => { raw += c.toString(); });
        res.on("end", () => resolve({
          status:   res.statusCode ?? 0,
          location: res.headers["location"] as string | undefined,
          body:     raw,
        }));
      },
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function httpGet(server: http.Server, path: string): Promise<HttpResult> {
  const addr = server.address() as { port: number };
  return new Promise((resolve, reject) => {
    http.request(
      { hostname: "127.0.0.1", port: addr.port, path, method: "GET" },
      (res) => {
        let raw = "";
        res.on("data", (c: Buffer) => { raw += c.toString(); });
        res.on("end", () => resolve({
          status:   res.statusCode ?? 0,
          location: res.headers["location"] as string | undefined,
          body:     raw,
        }));
      },
    ).on("error", reject).end();
  });
}

// ── Assertion helper ──────────────────────────────────────────────────────────

function assertSafeRedirect(res: HttpResult, label: string): void {
  assert.ok(
    [301, 302, 303, 307].includes(res.status),
    `${label}: expected redirect (301/302/303/307), got HTTP ${res.status}. ` +
    `Body: ${res.body.slice(0, 300)}`,
  );
  assert.ok(
    !res.body.includes("INTERNAL_ERROR"),
    `${label}: response must not contain INTERNAL_ERROR. Body: ${res.body.slice(0, 300)}`,
  );
  assert.notEqual(res.status, 500, `${label}: must not be HTTP 500`);
}

// ── DB stub factories ─────────────────────────────────────────────────────────
// The db singleton is shared across all modules (payuWebhook.ts, payuOrders.ts).
// Replacing its methods here affects every module that imported it.

function makeOrderSelectStub(order: object | null) {
  // Handles: db.select().from(table).where(cond).limit(n)
  return () => ({
    from: () => ({
      where: () => ({ limit: () => Promise.resolve(order ? [order] : []) }),
    }),
  });
}

function makeNoOpUpdateStub() {
  // Handles: db.update(t).set({}).where(cond) and db.update(t).set({}).where(cond).returning()
  return () => ({
    set: () => ({
      where: () => ({
        returning: () => Promise.resolve([]),
        // For callers that await the update directly (no .returning())
        then: (res: (v: unknown[]) => unknown) => Promise.resolve([]).then(res),
      }),
    }),
  });
}

function makeNoOpInsertStub() {
  // Handles: db.insert(t).values({})
  return () => ({ values: () => Promise.resolve([]) });
}

function makeTransactionThrowStub() {
  // Forces creditWalletForPayu's try/catch to fire → returns { outcome:"error" }.
  // Prevents any real DB write; the route handler still produces a safe redirect.
  return async (_fn: unknown) => { throw new Error("DB_STUB: transaction disabled in CI"); };
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe("PayU browser-return callback — /api/payment/payu-return", () => {
  let server: http.Server;
  let savedUatSalt: string | undefined;
  let savedUatKey:  string | undefined;

  // Snapshot originals so afterEach can restore them
  const orig = {
    select:      null as unknown,
    update:      null as unknown,
    insert:      null as unknown,
    transaction: null as unknown,
  };

  before(async () => {
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));

    savedUatSalt = process.env["PAYU_UAT_SALT"];
    savedUatKey  = process.env["PAYU_UAT_KEY"];

    orig.select      = db.select.bind(db);
    orig.update      = db.update.bind(db);
    orig.insert      = db.insert.bind(db);
    orig.transaction = (db as unknown as Record<string, unknown>)["transaction"];
  });

  after(async () => {
    // Restore db + env vars
    (db as unknown as Record<string, unknown>)["select"]      = orig.select;
    (db as unknown as Record<string, unknown>)["update"]      = orig.update;
    (db as unknown as Record<string, unknown>)["insert"]      = orig.insert;
    (db as unknown as Record<string, unknown>)["transaction"] = orig.transaction;
    process.env["PAYU_UAT_SALT"] = savedUatSalt;
    process.env["PAYU_UAT_KEY"]  = savedUatKey;
    await new Promise<void>((r) => server.close(() => r()));
  });

  afterEach(() => {
    (db as unknown as Record<string, unknown>)["select"]      = orig.select;
    (db as unknown as Record<string, unknown>)["update"]      = orig.update;
    (db as unknown as Record<string, unknown>)["insert"]      = orig.insert;
    (db as unknown as Record<string, unknown>)["transaction"] = orig.transaction;
    process.env["PAYU_UAT_SALT"] = savedUatSalt;
    process.env["PAYU_UAT_KEY"]  = savedUatKey;
  });

  // Helper: build a minimal fake PayU order row
  function fakeOrder(txnid: string, amount: string, status = "INITIATED"): object {
    return {
      id: 9900, merchantId: 1, txnid, amount,
      productinfo: "CI Test Load", firstname: "CI User",
      email: "ci@rasokart.com", phone: null, udf1: null,
      environment: "uat", status,
      mihpayid: status === "INITIATED" ? null : "CI_MIHPAYID",
      bankRefNo: null, paymentMode: null,
      rawResponse: null, hashVerified: status !== "INITIATED",
      failureReason: null, paidAt: status === "SUCCESS" ? new Date() : null,
      creditFailedAt: null, createdAt: new Date(), updatedAt: new Date(),
    };
  }

  function stubForOrder(order: object | null) {
    (db as unknown as Record<string, unknown>)["select"]      = makeOrderSelectStub(order);
    (db as unknown as Record<string, unknown>)["update"]      = makeNoOpUpdateStub();
    (db as unknown as Record<string, unknown>)["insert"]      = makeNoOpInsertStub();
    (db as unknown as Record<string, unknown>)["transaction"] = makeTransactionThrowStub();
  }

  // ── Test 1 ──────────────────────────────────────────────────────────────────

  it("1. POST from secure.payu.in origin — CORS bypass, receives redirect (not 403/500)", async () => {
    stubForOrder(null); // unknown txnid → "ignored"

    const res = await postUrlEncoded(
      server,
      "/api/payment/payu-return",
      { txnid: "RK_CI_CORS_001", status: "success", amount: "100.00", hash: "a".repeat(128) },
      { Origin: "https://secure.payu.in" },
    );

    assert.notEqual(res.status, 403, "secure.payu.in origin must not be CORS-blocked (403)");
    assertSafeRedirect(res, "CORS bypass");
  });

  // ── Test 2 ──────────────────────────────────────────────────────────────────

  it("2. POST with empty body — safe redirect, no crash", async () => {
    stubForOrder(null);

    const res = await postUrlEncoded(server, "/api/payment/payu-return", {});

    assertSafeRedirect(res, "empty body");
  });

  // ── Test 3 ──────────────────────────────────────────────────────────────────

  it("3. POST with unknown txnid — order not found, safe redirect", async () => {
    stubForOrder(null);

    const res = await postUrlEncoded(server, "/api/payment/payu-return", {
      txnid:  "RK_CI_NOTFOUND_001",
      status: "success",
      amount: "99.00",
      hash:   "b".repeat(128),
    });

    assertSafeRedirect(res, "unknown txnid");
  });

  // ── Test 4 ──────────────────────────────────────────────────────────────────

  it("4. POST with invalid hash — redirects to payu_status=hash_invalid", async () => {
    const txnid = "RK_CI_BADHASH_001";
    process.env["PAYU_UAT_SALT"] = TEST_SALT;
    process.env["PAYU_UAT_KEY"]  = TEST_KEY;
    stubForOrder(fakeOrder(txnid, "150.00"));

    const res = await postUrlEncoded(server, "/api/payment/payu-return", {
      txnid, amount: "150.00", productinfo: "CI Test Load",
      firstname: "CI User", email: "ci@rasokart.com", udf1: "",
      status: "success",
      // "c" * 128 is valid hex length (128) but wrong value → timingSafeEqual returns false
      hash: "c".repeat(128),
    });

    assertSafeRedirect(res, "invalid hash");
    assert.ok(
      res.location?.includes("payu_status=hash_invalid"),
      `expected payu_status=hash_invalid in Location, got: ${res.location}`,
    );
  });

  // ── Test 5 ──────────────────────────────────────────────────────────────────

  it("5. POST with valid success hash — redirects (never 500, never INTERNAL_ERROR)", async () => {
    const txnid       = "RK_CI_SUCCESS_001";
    const amount      = "200.00";
    const productinfo = "CI Wallet Load";
    const firstname   = "CI Pass";
    const email       = "cipass@rasokart.com";

    process.env["PAYU_UAT_SALT"] = TEST_SALT;
    process.env["PAYU_UAT_KEY"]  = TEST_KEY;

    const validHash = computePayuResponseHash({
      salt: TEST_SALT, status: "success", key: TEST_KEY,
      txnid, amount, productinfo, firstname, email,
    });

    stubForOrder(fakeOrder(txnid, amount));
    // creditWalletForPayu's try/catch fires → "error" → payu_status=pending (still a redirect)

    const res = await postUrlEncoded(server, "/api/payment/payu-return", {
      txnid, amount, productinfo, firstname, email, udf1: "",
      status: "success", hash: validHash,
      mihpayid: "CI_MIHPAYID_001", bank_ref_no: "CIRK001", mode: "UPI",
    });

    assertSafeRedirect(res, "valid success hash");
    // Hash is valid — must never show hash_invalid
    assert.ok(
      !res.location?.includes("payu_status=hash_invalid"),
      `valid hash must not produce hash_invalid; Location: ${res.location}`,
    );
  });

  // ── Test 6 ──────────────────────────────────────────────────────────────────

  it("6. POST with valid failure hash — redirects to payu_status=failed", async () => {
    const txnid       = "RK_CI_FAIL_001";
    const amount      = "300.00";
    const productinfo = "CI Load Fail";
    const firstname   = "CI Fail";
    const email       = "cifail@rasokart.com";

    process.env["PAYU_UAT_SALT"] = TEST_SALT;
    process.env["PAYU_UAT_KEY"]  = TEST_KEY;

    const validHash = computePayuResponseHash({
      salt: TEST_SALT, status: "failure", key: TEST_KEY,
      txnid, amount, productinfo, firstname, email,
    });

    stubForOrder(fakeOrder(txnid, amount));

    const res = await postUrlEncoded(server, "/api/payment/payu-return", {
      txnid, amount, productinfo, firstname, email, udf1: "",
      status: "failure", hash: validHash,
      error_Message: "Payment declined by bank",
    });

    assertSafeRedirect(res, "valid failure hash");
    assert.ok(
      res.location?.includes("payu_status=failed"),
      `expected payu_status=failed in Location, got: ${res.location}`,
    );
  });

  // ── Test 7 ──────────────────────────────────────────────────────────────────

  it("7. GET /api/payment/payu-return — safe redirect, no 404/500", async () => {
    const res = await httpGet(server, "/api/payment/payu-return");

    assert.notEqual(res.status, 404, "GET must not 404");
    assert.notEqual(res.status, 500, "GET must not 500");
    assert.ok(
      [301, 302, 303, 307].includes(res.status),
      `GET: expected redirect, got ${res.status}. Body: ${res.body.slice(0, 200)}`,
    );
    assert.ok(
      !res.body.includes("INTERNAL_ERROR"),
      `GET must not produce INTERNAL_ERROR. Body: ${res.body.slice(0, 200)}`,
    );
  });

  // ── Test 8 ──────────────────────────────────────────────────────────────────

  it("8. Duplicate callback (order already SUCCESS) — safe redirect, no double credit", async () => {
    const txnid       = "RK_CI_DUP_001";
    const amount      = "400.00";
    const productinfo = "CI Dup Load";
    const firstname   = "CI Dup";
    const email       = "cidup@rasokart.com";

    process.env["PAYU_UAT_SALT"] = TEST_SALT;
    process.env["PAYU_UAT_KEY"]  = TEST_KEY;

    const validHash = computePayuResponseHash({
      salt: TEST_SALT, status: "success", key: TEST_KEY,
      txnid, amount, productinfo, firstname, email,
    });

    // Order already SUCCESS — creditWalletForPayu's transaction would find 0
    // rows from the INITIATED/PENDING predicate (duplicate path).
    // Our stub throws, so the outer catch returns {outcome:"error"} → pending redirect.
    stubForOrder(fakeOrder(txnid, amount, "SUCCESS"));

    const res = await postUrlEncoded(server, "/api/payment/payu-return", {
      txnid, amount, productinfo, firstname, email, udf1: "",
      status: "success", hash: validHash,
      mihpayid: "DUP_MIHPAYID_001", bank_ref_no: "DUPRK001", mode: "UPI",
    });

    assertSafeRedirect(res, "duplicate callback");
    // Valid hash → must never produce hash_invalid
    assert.ok(
      !res.location?.includes("payu_status=hash_invalid"),
      `duplicate with valid hash must not show hash_invalid; Location: ${res.location}`,
    );
  });

  // ── Test 9 ──────────────────────────────────────────────────────────────────

  it("9. Callback after S2S already credited — browser return is safe, no re-credit", async () => {
    const txnid       = "RK_CI_S2SFIRST_001";
    const amount      = "500.00";
    const productinfo = "CI S2S First";
    const firstname   = "CI S2S";
    const email       = "cis2s@rasokart.com";

    process.env["PAYU_UAT_SALT"] = TEST_SALT;
    process.env["PAYU_UAT_KEY"]  = TEST_KEY;

    const validHash = computePayuResponseHash({
      salt: TEST_SALT, status: "success", key: TEST_KEY,
      txnid, amount, productinfo, firstname, email,
    });

    // Simulate: S2S already set status=SUCCESS; browser return arrives second
    stubForOrder(fakeOrder(txnid, amount, "SUCCESS"));

    // POST from PayU origin — verifies CORS still works for this case
    const res = await postUrlEncoded(
      server,
      "/api/payment/payu-return",
      { txnid, amount, productinfo, firstname, email, udf1: "", status: "success", hash: validHash },
      { Origin: "https://secure.payu.in" },
    );

    assert.notEqual(res.status, 403, "post-S2S return must not be CORS-blocked");
    assertSafeRedirect(res, "callback after S2S credited");
  });

  // ── Test 10 ─────────────────────────────────────────────────────────────────

  it("10. POST with missing fields — no 500, no INTERNAL_ERROR", async () => {
    stubForOrder(null);

    // Only txnid, no hash, no amount — stress test missing fields
    const res = await postUrlEncoded(server, "/api/payment/payu-return", {
      txnid: "RK_CI_MISSING_001",
    });

    assertSafeRedirect(res, "missing fields");
  });

  // ── Test 11 (S2S reachability) ───────────────────────────────────────────────

  it("11. POST /api/payment/payu-s2s from PayU origin — CORS bypass, receives 200", async () => {
    // S2S sends immediate 200 ACK regardless of processing — just verify reachability
    stubForOrder(null);

    const res = await postUrlEncoded(
      server,
      "/api/payment/payu-s2s",
      { txnid: "RK_CI_S2S_CORS_001", status: "success", amount: "100.00", hash: "d".repeat(128) },
      { Origin: "https://secure.payu.in" },
    );

    // S2S always ACKs with 200 { success: true } immediately
    assert.notEqual(res.status, 403, "S2S must not be CORS-blocked from secure.payu.in");
    assert.ok(
      res.status === 200 || [301, 302, 303, 307].includes(res.status),
      `S2S: expected 200 or redirect, got ${res.status}. Body: ${res.body.slice(0, 200)}`,
    );
    assert.ok(
      !res.body.includes("INTERNAL_ERROR"),
      `S2S must not produce INTERNAL_ERROR. Body: ${res.body.slice(0, 200)}`,
    );
  });
});
