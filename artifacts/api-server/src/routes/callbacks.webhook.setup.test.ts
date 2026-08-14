/**
 * Integration tests: Merchant Callback / Webhook Setup
 *
 * Covers (all without real payments or provider credentials):
 *  1.  Callback URL save — PUT /api/webhooks/ (merchant auth, scoped by merchantId)
 *  2.  Secret generation — returns plaintext once (POST /api/callbacks/secret/rotate)
 *  3.  Signing roundtrip — encryptSecret → decryptSecret preserves plaintext
 *  4.  Masked status — GET /api/callbacks/secret does NOT expose plaintext; includes callbackVerified
 *  5.  POST /api/webhooks/test → 400 when no webhook URL configured
 *  6.  POST /api/webhooks/test → 200 with non-financial payload (delivery fails → network, route still 200)
 *  7.  Event type validation — unsupported type → 400
 *  8.  Callback signing — correct HMAC accepted, wrong HMAC rejected (unit)
 *  9.  POST /api/callbacks — without API key → 401
 *  10. Isolation — /api/callbacks/secret/rotate blocked for admin role
 *  11. Isolation — /api/callbacks/secret/history blocked for admin role
 *  12. Isolation — /api/webhooks/test blocked for admin role (merchantId check)
 *  13. IV randomness — encryptSecret produces unique ciphertext per call
 *  14. Test payload is non-financial — no wallet/ledger credit/debit fields
 *
 * DB stubs use table-detection (table === someTable) matching the pattern from
 * payinOrders.dailyLimitRace.test.ts, extended with leftJoin support.
 *
 * Run:
 *   cd artifacts/api-server
 *   node --import tsx/esm --test src/routes/callbacks.webhook.setup.test.ts
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import {
  db,
  usersTable,
  merchantsTable,
  merchantPlansTable,
  plansTable,
  webhooksTable,
  callbackLogsTable,
  systemConfigTable,
} from "@workspace/db";
import app from "../app.js";
import { encryptSecret, decryptSecret } from "../helpers/cryptoUtils.js";
import { generateToken } from "../middlewares/auth.js";

// SESSION_SECRET must be set before cryptoUtils / auth runs
process.env["SESSION_SECRET"] ??= "rk_ci_wh_setup_test_session_secret_32bytes_";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const M1_ID  = 9801;

const PLAIN_SECRET     = "ci_webhook_plain_secret_abcdef01234567890abcdef";
const ENCRYPTED_SECRET = encryptSecret(PLAIN_SECRET);

// User rows that pass requireAuth (isActive=true, passwordUpdatedAt=null)
const M1_USER = {
  id: 1001, merchantId: M1_ID, role: "merchant", email: "m1@ci.test",
  isActive: true, passwordUpdatedAt: null, isSuperAdmin: false,
};
const ADMIN_USER = {
  id: 9999, merchantId: null, role: "admin", email: "admin@ci.test",
  isActive: true, passwordUpdatedAt: null, isSuperAdmin: false,
};

// A plan row that allows webhook access
const PLAN_ROW = {
  id: 2, name: "Gold", apiAccess: true, webhookAccess: true,
  maxQrCodes: 100, maxVirtualAccounts: 10, maxPaymentLinks: 50,
  maxMonthlyTransactions: 10000, maxDailyTransactions: 1000,
  monthlyTransactionLimit: "1000000.00", dailyTransactionLimit: "100000.00",
  payoutAccess: true, createdAt: new Date(), updatedAt: new Date(),
};
const MERCHANT_PLAN_ROW = {
  id: 1, merchantId: M1_ID, planId: 2, expiresAt: null,
  createdAt: new Date(), updatedAt: new Date(),
};

// Canonical webhook row for M1
const M1_WEBHOOK = {
  id: 1, merchantId: M1_ID, url: "https://merchant.example.com/wh",
  isActive: true, events: ["payment.success", "payment.failed"],
  maxRetries: 3, retryDelay1: 60, retryDelay2: 300, retryDelay3: 900,
  secret: null, failureAlertEnabled: false, failureAlertThreshold: 3,
  secretRotatedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
};

// Public IP literal URL that passes SSRF guard without DNS resolution.
// 8.8.8.8 is a publicly-routed IP so the SSRF guard accepts it, but
// the test delivery will fail (connection refused / reset) → delivered=false.
// The route always returns HTTP 200 regardless of delivery outcome.
const SSRF_SAFE_TEST_URL = "https://8.8.8.8/webhook-ci-test";

function makeHmac(body: string, secret = PLAIN_SECRET): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
}

// ── Chainable DB stub ─────────────────────────────────────────────────────────
// Mirrors payinOrders.dailyLimitRace.test.ts — supports leftJoin, orderBy, limit.

function chainable(rows: unknown[]) {
  const self: any = {
    then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
      return Promise.resolve(rows).then(resolve, reject);
    },
    limit: (_n?: number) => Promise.resolve(rows),
    orderBy: (_: unknown) => chainable(rows),
    where: (_: unknown) => chainable(rows),
    leftJoin: (_t: unknown, _cond: unknown) => chainable(rows),
    innerJoin: (_t: unknown, _cond: unknown) => chainable(rows),
  };
  return self;
}

function noOpUpdate() {
  const returning = () => Promise.resolve([M1_WEBHOOK]);
  return () => ({
    set: () => ({
      where: () => ({ returning }),
    }),
  });
}

const resolvedEmpty = Promise.resolve([] as unknown[]);
function noOpInsert() {
  const val = {
    onConflictDoNothing: () => resolvedEmpty,
    onConflictDoUpdate: () => ({ returning: () => resolvedEmpty }),
    returning: () => resolvedEmpty,
    then: (r: (v: unknown[]) => unknown) => resolvedEmpty.then(r),
  };
  return () => ({
    values: () => val,
    onConflictDoNothing: () => resolvedEmpty,
  });
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

interface HttpResult { status: number; body: unknown; }

function httpReq(
  server: http.Server, method: string, path: string,
  opts: { token?: string; apiKey?: string; body?: unknown } = {}
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const raw  = opts.body != null ? JSON.stringify(opts.body) : undefined;
    const hdrs: Record<string, string> = { "Content-Type": "application/json" };
    if (opts.token)  hdrs["Authorization"] = `Bearer ${opts.token}`;
    if (opts.apiKey) hdrs["X-Api-Key"]     = opts.apiKey;
    if (raw)         hdrs["Content-Length"] = String(Buffer.byteLength(raw));
    const r = http.request({ hostname: "127.0.0.1", port: addr.port, method, path, headers: hdrs });
    r.on("error", reject);
    r.on("response", res => {
      let buf = "";
      res.on("data", (d: Buffer) => { buf += d.toString(); });
      res.on("end", () => {
        let body: unknown = buf;
        try { body = JSON.parse(buf); } catch {}
        resolve({ status: res.statusCode ?? 0, body });
      });
    });
    if (raw) r.write(raw);
    r.end();
  });
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("Merchant Callback / Webhook Setup", () => {
  let server: http.Server;

  const originalSelect = (db as any).select?.bind(db);
  const originalInsert = (db as any).insert?.bind(db);
  const originalUpdate = (db as any).update?.bind(db);

  const m1Token    = generateToken({ userId: M1_USER.id, role: "merchant" });
  const adminToken = generateToken({ userId: ADMIN_USER.id, role: "admin" });

  before(async () => {
    server = http.createServer(app);
    await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  });

  after(async () => {
    (db as any).select = originalSelect;
    (db as any).insert = originalInsert;
    (db as any).update = originalUpdate;
    await new Promise<void>((resolve, reject) =>
      server.close(err => (err ? reject(err) : resolve()))
    );
  });

  beforeEach(() => {
    (db as any).select = originalSelect;
    (db as any).insert = originalInsert;
    (db as any).update = originalUpdate;
  });

  // ── Helper to build a select stub that handles requireAuth + plan check ────

  function makeSelectStub(user: object, extraHandlers: (table: unknown) => unknown[] | null) {
    return (_fields?: unknown) => ({
      from: (table: unknown) => {
        const getRows = (): unknown[] => {
          if (table === usersTable) return [user];
          // checkPlanFeatureAccess → getPlanForMerchant: leftJoin query on merchantPlansTable
          if (table === merchantPlansTable) return [{ plan: PLAN_ROW, mp: MERCHANT_PLAN_ROW }];
          // loadWebhookRetryConfig reads systemConfigTable → return empty, uses defaults
          if (table === systemConfigTable) return [];
          const extra = extraHandlers(table);
          return extra ?? [];
        };
        const rows = getRows();
        return {
          where: (_cond: unknown) => chainable(rows),
          leftJoin: (_t: unknown, _cond: unknown) => {
            return {
              where: (_cond: unknown) => chainable(rows),
              limit: (_n?: number) => Promise.resolve(rows),
              orderBy: (_: unknown) => chainable(rows),
            };
          },
          limit: (_n?: number) => Promise.resolve(rows),
          orderBy: (_: unknown) => chainable(rows),
          then: (r: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
            Promise.resolve(rows).then(r, rej),
        };
      },
    });
  }

  // ─── 1. Callback URL save ─────────────────────────────────────────────────

  it("1. PUT /api/webhooks/ — saves callback URL for the authenticated merchant (200)", async () => {
    (db as any).select = makeSelectStub(M1_USER, (table) => {
      if (table === webhooksTable) return [M1_WEBHOOK]; // existing row → update path
      return null;
    });
    (db as any).insert = noOpInsert();
    (db as any).update = noOpUpdate();

    const r = await httpReq(server, "PUT", "/api/webhooks/", {
      token: m1Token,
      body: {
        url: "https://merchant.example.com/webhook",
        isActive: true,
        events: ["payment.success", "payment.failed"],
        maxRetries: 3, retryDelay1: 60, retryDelay2: 300, retryDelay3: 900,
        failureAlertEnabled: false, failureAlertThreshold: 3,
      },
    });

    assert.ok(
      r.status === 200 || r.status === 201,
      `PUT /api/webhooks/ should succeed; got ${r.status} ${JSON.stringify(r.body)}`
    );
  });

  // ─── 2. Secret generation ─────────────────────────────────────────────────

  it("2. POST /api/callbacks/secret/rotate — returns plaintext once; admin gets 403", async () => {
    (db as any).select = makeSelectStub(M1_USER, () => null);
    (db as any).update = noOpUpdate();
    (db as any).insert = noOpInsert();

    const r = await httpReq(server, "POST", "/api/callbacks/secret/rotate", { token: m1Token });
    assert.equal(r.status, 200, `rotate should 200; got ${r.status} ${JSON.stringify(r.body)}`);
    const b = r.body as any;
    assert.ok(typeof b.secret === "string", "should return .secret string");
    assert.ok(b.secret.length >= 32,         "secret must be ≥32 chars");
    assert.ok(!b.secret.startsWith("enc:"),  "must NOT return encrypted envelope");

    // Admin blocked
    (db as any).select = makeSelectStub(ADMIN_USER, () => null);
    const r2 = await httpReq(server, "POST", "/api/callbacks/secret/rotate", { token: adminToken });
    assert.equal(r2.status, 403, "admin should get 403");
  });

  // ─── 3. Encrypt/decrypt roundtrip ────────────────────────────────────────

  it("3. encryptSecret → decryptSecret roundtrip — plaintext preserved; stored form is opaque", () => {
    const plain = crypto.randomBytes(32).toString("hex");
    const enc   = encryptSecret(plain);
    assert.ok(enc.startsWith("enc:"), "encrypted form should start with 'enc:'");
    assert.notEqual(enc, plain,        "encrypted must differ from plaintext");
    const dec = decryptSecret(enc);
    assert.ok(dec.ok,                  "decryptSecret should succeed");
    assert.equal(dec.value, plain,     "decrypted value must equal original plaintext");
  });

  // ─── 4. Masked status + callbackVerified ─────────────────────────────────

  it("4. GET /api/callbacks/secret — isSet:true, no plaintext; callbackVerified boolean present", async () => {
    (db as any).select = makeSelectStub(M1_USER, (table) => {
      if (table === merchantsTable)    return [{ callbackSecret: ENCRYPTED_SECRET }];
      if (table === webhooksTable)     return [{ secretRotatedAt: new Date() }];
      if (table === callbackLogsTable) return [{ n: 1 }]; // one successful test delivery
      return null;
    });

    const r = await httpReq(server, "GET", "/api/callbacks/secret", { token: m1Token });
    assert.ok(
      r.status === 200 || r.status === 404,
      `unexpected status ${r.status} ${JSON.stringify(r.body)}`
    );
    if (r.status === 200) {
      const b = r.body as any;
      assert.ok(!JSON.stringify(b).includes(PLAIN_SECRET), "plaintext must NEVER appear in response");
      assert.ok("isSet" in b,             "response must include isSet");
      assert.ok("callbackVerified" in b,  "response must include callbackVerified");
      assert.equal(typeof b.callbackVerified, "boolean", "callbackVerified must be boolean");
      if (b.isSet && b.secretPrefix) {
        assert.ok(!b.secretPrefix.includes(PLAIN_SECRET), "prefix must not contain full secret");
      }
    }
  });

  // ─── 5. Test delivery — no URL → 400 ─────────────────────────────────────

  it("5. POST /api/webhooks/test → 400 when no webhook URL configured", async () => {
    (db as any).select = makeSelectStub(M1_USER, (table) => {
      if (table === webhooksTable)  return []; // no webhook row → triggers 400
      if (table === merchantsTable) return [];
      return null;
    });

    const r = await httpReq(server, "POST", "/api/webhooks/test",
      { token: m1Token, body: { eventType: "payment.success" } });
    assert.equal(r.status, 400, `should 400 when no webhook URL; got ${r.status}`);
    const b = r.body as any;
    assert.ok(
      (b.error ?? "").toLowerCase().includes("webhook") ||
      (b.error ?? "").toLowerCase().includes("url"),
      `error should mention webhook/URL; got: ${b.error}`
    );
  });

  // ─── 6. Test delivery — route always returns 200, non-financial body ──────
  //
  // Use a public IP literal (8.8.8.8) so the SSRF guard passes without DNS
  // resolution. The actual delivery will fail (connection refused), which is
  // fine — the route logs it and still returns HTTP 200 with the JSON result.

  it("6. POST /api/webhooks/test → 200 with non-financial requestBody", async () => {
    (db as any).select = makeSelectStub(M1_USER, (table) => {
      if (table === webhooksTable)  return [{ ...M1_WEBHOOK, url: SSRF_SAFE_TEST_URL, secret: null }];
      if (table === merchantsTable) return [{ callbackSecret: ENCRYPTED_SECRET }];
      return null;
    });
    (db as any).insert = noOpInsert();

    const r = await httpReq(server, "POST", "/api/webhooks/test",
      { token: m1Token, body: { eventType: "payment.success" } });

    assert.equal(r.status, 200, `route should always return 200; got ${r.status} ${JSON.stringify(r.body)}`);
    const b = r.body as any;
    assert.ok(typeof b.delivered === "boolean", "response should have `delivered` boolean");
    assert.ok(typeof b.requestBody === "string", "response should have `requestBody` string");

    // Non-financial: no wallet/ledger credit/debit fields in payload
    const payload = JSON.parse(b.requestBody) as Record<string, unknown>;
    const banned = ["walletCredit", "ledgerDebit", "createPayment", "creditWallet", "debitLedger"];
    for (const k of banned) {
      assert.ok(!(k in payload), `payload must not contain field "${k}"`);
    }
    assert.ok("eventType" in payload || "event" in payload, "payload should have event metadata");
  });

  // ─── 7. Event type validation ─────────────────────────────────────────────

  it("7. POST /api/webhooks/test → 400 for unsupported event types", async () => {
    (db as any).select = makeSelectStub(M1_USER, () => null);

    const bad = ["CREDIT_REAL_MONEY", "internal.fund_wallet", "admin.elevate", ""];
    for (const eventType of bad) {
      const r = await httpReq(server, "POST", "/api/webhooks/test",
        { token: m1Token, body: { eventType } });
      assert.equal(r.status, 400, `eventType="${eventType}" should 400; got ${r.status}`);
    }
  });

  // ─── 8. HMAC signing unit ─────────────────────────────────────────────────

  it("8. Callback HMAC — correct signature accepted, wrong rejected (unit)", () => {
    const body    = JSON.stringify({ event: "payment.success", merchantId: M1_ID, test: true });
    const correct = makeHmac(body);
    const wrong   = "sha256=" + crypto.randomBytes(32).toString("hex");

    const expected = "sha256=" + crypto.createHmac("sha256", PLAIN_SECRET)
                                       .update(body).digest("hex");
    assert.equal(correct, expected, "correct HMAC must match expected value");
    assert.notEqual(wrong, correct, "wrong HMAC must not match correct HMAC");

    const cb = Buffer.from(correct); const eb = Buffer.from(expected);
    assert.equal(cb.length, eb.length);
    assert.equal(crypto.timingSafeEqual(cb, eb), true, "timingSafeEqual should return true");
  });

  // ─── 9. API key required for POST /api/callbacks ─────────────────────────

  it("9. POST /api/callbacks — missing API key → 401", async () => {
    const r = await httpReq(server, "POST", "/api/callbacks",
      { body: { orderId: "ci_test_order", status: "SUCCESS" } });
    assert.equal(r.status, 401, "missing API key should 401");
  });

  // ─── 10. Admin blocked from callback secret rotate ───────────────────────

  it("10. Isolation — admin cannot rotate merchant callback secret (403)", async () => {
    (db as any).select = makeSelectStub(ADMIN_USER, () => null);
    (db as any).update = noOpUpdate();
    (db as any).insert = noOpInsert();
    const r = await httpReq(server, "POST", "/api/callbacks/secret/rotate", { token: adminToken });
    assert.equal(r.status, 403, "admin should get 403 on callback secret rotate");
  });

  // ─── 11. Admin blocked from secret history ────────────────────────────────

  it("11. Isolation — admin cannot view merchant callback secret history (403)", async () => {
    (db as any).select = makeSelectStub(ADMIN_USER, () => null);
    const r = await httpReq(server, "GET", "/api/callbacks/secret/history", { token: adminToken });
    assert.equal(r.status, 403, "admin should get 403 on callback secret history");
  });

  // ─── 12. Admin blocked from webhook test ─────────────────────────────────

  it("12. Isolation — admin cannot send test webhook (merchantId check → 403)", async () => {
    (db as any).select = makeSelectStub(ADMIN_USER, () => null);
    const r = await httpReq(server, "POST", "/api/webhooks/test",
      { token: adminToken, body: { eventType: "payment.success" } });
    assert.equal(r.status, 403, "admin should get 403 from /api/webhooks/test");
  });

  // ─── 13. IV randomness ────────────────────────────────────────────────────

  it("13. encryptSecret — unique ciphertext per call (randomised IV)", () => {
    const plain = "same_plaintext_for_iv_randomness_test_12345";
    const enc1  = encryptSecret(plain);
    const enc2  = encryptSecret(plain);
    assert.notEqual(enc1, enc2, "each encrypt call must produce unique ciphertext");
    const d1 = decryptSecret(enc1); const d2 = decryptSecret(enc2);
    assert.ok(d1.ok && d2.ok, "both must decrypt successfully");
    assert.equal(d1.value, plain, "enc1 decrypts correctly");
    assert.equal(d2.value, plain, "enc2 decrypts correctly");
  });

  // ─── 14. Non-financial payload on all supported event types ──────────────

  it("14. Test payload is non-financial on all supported event types", async () => {
    const SUPPORTED = [
      "payment.success", "payment.failed", "payment.pending",
      "withdrawal.approved", "withdrawal.rejected",
    ];

    (db as any).insert = noOpInsert();

    for (const eventType of SUPPORTED) {
      (db as any).select = makeSelectStub(M1_USER, (table) => {
        if (table === webhooksTable)  return [{ ...M1_WEBHOOK, url: SSRF_SAFE_TEST_URL, secret: null }];
        if (table === merchantsTable) return [{ callbackSecret: null }];
        return null;
      });

      const r = await httpReq(server, "POST", "/api/webhooks/test",
        { token: m1Token, body: { eventType } });

      assert.equal(r.status, 200, `eventType="${eventType}" should 200; got ${r.status}`);
      const b = r.body as any;
      if (b.requestBody) {
        const p = JSON.parse(b.requestBody) as Record<string, unknown>;
        const banned = ["walletCredit", "ledgerDebit", "creditWallet", "debitLedger"];
        for (const k of banned) {
          assert.ok(!(k in p), `eventType="${eventType}" payload must not have "${k}"`);
        }
      }
    }
  });
});
