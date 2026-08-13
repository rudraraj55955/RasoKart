/**
 * Integration tests: POST /api/callbacks — callback signing pipeline
 *
 * Covers:
 *  1. No secret configured → request passes through (backward-compat, no 401)
 *  2. Encrypted secret in DB → HMAC verified with decrypted plaintext
 *  3. Valid HMAC + timestamp → passes signature check
 *  4. Missing X-Timestamp when secret configured → 401
 *  5. Stale X-Timestamp (outside ±300 s window) → 401
 *  6. Missing X-Signature when secret configured → 401
 *  7. Invalid (wrong) X-Signature → 401
 *  8. Missing X-Api-Key entirely → 401 from requireApiKey (before any sig check)
 *  9. Valid HMAC + optional X-Nonce → passes (nonce accepted the first time)
 * 10. Decrypt of encryptSecret() is transparent — unit assertion
 *
 * DB calls are stubbed by replacing methods on the shared `db` singleton.
 * No real DB writes occur; no payments are touched.
 *
 * Run:
 *   node --import tsx/esm --test \
 *     artifacts/api-server/src/routes/callbacks.signing.test.ts
 */

import { describe, it, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import { db } from "@workspace/db";
import app from "../app.js";
import { encryptSecret, decryptSecret } from "../helpers/cryptoUtils.js";

// ── Test SESSION_SECRET (only for this test file) ────────────────────────────
// Must be set BEFORE importing app so cryptoUtils.getKey() works.
// We set it early — app.ts is already imported above but that's fine because
// cryptoUtils only reads SESSION_SECRET at call-time, not at import-time.
const TEST_SESSION_SECRET = "rk_ci_callbacks_signing_test_session_secret_32b";
process.env["SESSION_SECRET"] ??= TEST_SESSION_SECRET;

// ── Test constants ────────────────────────────────────────────────────────────
const CI_API_KEY      = "rk_ci_apikey_callbacks_test_12345";
const CI_PLAIN_SECRET = "ci_plain_callback_secret_abcdef0123456789_ci_plain";
const CI_MERCHANT_ID  = 9901;
const CI_API_KEY_ID   = 1;

// Pre-compute the encrypted form (stored in DB)
const CI_ENCRYPTED_SECRET = encryptSecret(CI_PLAIN_SECRET);

// ── HMAC helper (mirrors verifyHmacSignature in callbackAuth.ts) ─────────────
function computeHmac(secret: string, body: string): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(Buffer.from(body)).digest("hex");
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────
interface HttpResult {
  status:  number;
  body:    string;
  headers: Record<string, string | string[] | undefined>;
}

function postJson(
  server:       http.Server,
  path:         string,
  bodyObj:      object,
  extraHeaders: Record<string, string> = {},
): Promise<HttpResult> {
  const addr = server.address() as { port: number };
  const data = JSON.stringify(bodyObj);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port:     addr.port,
        path,
        method:   "POST",
        headers:  {
          "Content-Type":   "application/json",
          "Content-Length": Buffer.byteLength(data),
          ...extraHeaders,
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (c: Buffer) => { raw += c.toString(); });
        res.on("end", () => resolve({
          status:  res.statusCode ?? 0,
          body:    raw,
          headers: res.headers as Record<string, string | string[] | undefined>,
        }));
      },
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

// ── DB stub builders ──────────────────────────────────────────────────────────
// Each stub call returns a chainable builder that resolves to the given rows.

function selectReturning(rows: object[]) {
  return () => ({
    from:   () => ({
      where:  () => ({ limit: () => Promise.resolve(rows) }),
      // for selects without .where()
      limit:  () => Promise.resolve(rows),
    }),
  });
}

/**
 * Sequential select stub: each invocation pops from `queue` in order.
 *
 * Queue entries:
 *  [0]  requireApiKey     — apiKeysTable row
 *  [1]  verifyCallbackSig — merchantsTable row
 *  [2]  route handler     — qrCodesTable   (empty → 404, fine for sig tests)
 */
function makeSeqSelectStub(queue: (object | null)[]) {
  let idx = 0;
  return () => {
    const row = queue[idx++] ?? null;
    const rows = row ? [row] : [];
    return {
      from:  () => ({
        where: () => ({ limit: () => Promise.resolve(rows) }),
        limit: () => Promise.resolve(rows),
      }),
    };
  };
}

function noOpUpdate() {
  return () => ({
    set: () => ({
      where: () => ({
        returning: () => Promise.resolve([]),
        then: (r: (v: unknown[]) => unknown) => Promise.resolve([]).then(r),
      }),
    }),
  });
}

/** No-op insert stub — handles .values().catch(), .values().onConflictDoNothing(), .values().returning() */
function noOpInsert() {
  const resolved = Promise.resolve([] as unknown[]);
  const valuesReturn = {
    onConflictDoNothing: () => resolved,
    returning:           () => resolved,
    catch:               (_fn: unknown) => resolved,
    then:                (r: (v: unknown[]) => unknown) => resolved.then(r),
  };
  return () => ({
    values:              () => valuesReturn,
    onConflictDoNothing: () => resolved,
  });
}

// ── Fake rows ─────────────────────────────────────────────────────────────────

const FAKE_API_KEY_ROW = {
  id:          CI_API_KEY_ID,
  merchantId:  CI_MERCHANT_ID,
  apiKey:      CI_API_KEY,
  isActive:    true,
  revokedAt:   null,
  lastUsedAt:  null,
};

/** Merchant row with an encrypted callback secret */
function merchantWithSecret(overrides: Partial<{ callbackSecret: string | null; callbackTimestampWindowSeconds: number | null }> = {}) {
  return {
    callbackSecret:                  CI_ENCRYPTED_SECRET,
    callbackTimestampWindowSeconds:  null,
    ...overrides,
  };
}

/** Merchant row with NO secret configured */
const MERCHANT_NO_SECRET = { callbackSecret: null, callbackTimestampWindowSeconds: null };

// ── Test suite ────────────────────────────────────────────────────────────────

describe("Callback signing pipeline — POST /api/callbacks", () => {
  let server: http.Server;

  const orig = {
    select: null as unknown,
    update: null as unknown,
    insert: null as unknown,
    delete: null as unknown,
  };

  before(async () => {
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));

    orig.select = (db as any).select;
    orig.update = (db as any).update;
    orig.insert = (db as any).insert;
    orig.delete = (db as any).delete;
  });

  after(async () => {
    (db as any).select = orig.select;
    (db as any).update = orig.update;
    (db as any).insert = orig.insert;
    (db as any).delete = orig.delete;
    await new Promise<void>((r) => server.close(() => r()));
  });

  afterEach(() => {
    (db as any).select = orig.select;
    (db as any).update = orig.update;
    (db as any).insert = orig.insert;
    (db as any).delete = orig.delete;
  });

  function stubCallbacks(merchantRow: object) {
    (db as any).select = makeSeqSelectStub([
      FAKE_API_KEY_ROW,   // requireApiKey
      merchantRow,        // verifyCallbackSignature
      null,               // route: qrCodesTable (no QR → 404, fine)
    ]);
    (db as any).update = noOpUpdate();
    (db as any).insert = noOpInsert();
    (db as any).delete = noOpInsert(); // shape-compatible no-op
  }

  const BODY = { orderId: "rk_ci_signing_test_001" };
  const BODY_STR = JSON.stringify(BODY);

  // ── Test 1 ──────────────────────────────────────────────────────────────────
  it("1. No secret configured — passes through without 401 (opt-in enforcement)", async () => {
    stubCallbacks(MERCHANT_NO_SECRET);
    const res = await postJson(server, "/api/callbacks", BODY, {
      "X-Api-Key": CI_API_KEY,
    });
    // Route will 404 (no matching QR) but must NOT be 401 from signature check
    assert.notEqual(res.status, 401, `Expected no 401, got ${res.status}. Body: ${res.body.slice(0, 200)}`);
    assert.ok(!res.body.includes("INTERNAL_ERROR"), `Must not contain INTERNAL_ERROR. Body: ${res.body.slice(0, 200)}`);
  });

  // ── Test 2 ──────────────────────────────────────────────────────────────────
  it("2. Secret configured, missing X-Api-Key — 401 from requireApiKey", async () => {
    // No db stub needed — requireApiKey 401s before any select fires
    const res = await postJson(server, "/api/callbacks", BODY);
    assert.equal(res.status, 401);
    const parsed = JSON.parse(res.body) as { error: string };
    assert.ok(parsed.error?.includes("X-Api-Key"), `Unexpected error: ${parsed.error}`);
  });

  // ── Test 3 ──────────────────────────────────────────────────────────────────
  it("3. Secret configured, missing X-Timestamp — 401 from verifyCallbackSignature", async () => {
    stubCallbacks(merchantWithSecret());
    const res = await postJson(server, "/api/callbacks", BODY, {
      "X-Api-Key":   CI_API_KEY,
      "X-Signature": computeHmac(CI_PLAIN_SECRET, BODY_STR),
      // X-Timestamp intentionally omitted
    });
    assert.equal(res.status, 401);
    const parsed = JSON.parse(res.body) as { error: string };
    assert.ok(parsed.error?.includes("X-Timestamp"), `Unexpected error: ${parsed.error}`);
  });

  // ── Test 4 ──────────────────────────────────────────────────────────────────
  it("4. Secret configured, stale X-Timestamp (1 hour ago) — 401 from verifyCallbackSignature", async () => {
    stubCallbacks(merchantWithSecret());
    const staleTs = Math.floor(Date.now() / 1000) - 3601; // 1 hour + 1 second ago
    const res = await postJson(server, "/api/callbacks", BODY, {
      "X-Api-Key":   CI_API_KEY,
      "X-Timestamp": String(staleTs),
      "X-Signature": computeHmac(CI_PLAIN_SECRET, BODY_STR),
    });
    assert.equal(res.status, 401);
    const parsed = JSON.parse(res.body) as { error: string };
    assert.ok(
      parsed.error?.includes("outside the allowed window") || parsed.error?.includes("X-Timestamp"),
      `Unexpected error: ${parsed.error}`,
    );
  });

  // ── Test 5 ──────────────────────────────────────────────────────────────────
  it("5. Secret configured, missing X-Signature — 401 from verifyCallbackSignature", async () => {
    stubCallbacks(merchantWithSecret());
    const ts = Math.floor(Date.now() / 1000);
    const res = await postJson(server, "/api/callbacks", BODY, {
      "X-Api-Key":   CI_API_KEY,
      "X-Timestamp": String(ts),
      // X-Signature intentionally omitted
    });
    assert.equal(res.status, 401);
    const parsed = JSON.parse(res.body) as { error: string };
    assert.ok(parsed.error?.includes("X-Signature"), `Unexpected error: ${parsed.error}`);
  });

  // ── Test 6 ──────────────────────────────────────────────────────────────────
  it("6. Secret configured, wrong X-Signature — 401 from verifyCallbackSignature", async () => {
    stubCallbacks(merchantWithSecret());
    const ts = Math.floor(Date.now() / 1000);
    const res = await postJson(server, "/api/callbacks", BODY, {
      "X-Api-Key":   CI_API_KEY,
      "X-Timestamp": String(ts),
      "X-Signature": "sha256=" + "f".repeat(64), // wrong signature
    });
    assert.equal(res.status, 401);
    const parsed = JSON.parse(res.body) as { error: string };
    assert.ok(
      parsed.error?.includes("Invalid X-Signature") || parsed.error?.includes("X-Signature"),
      `Unexpected error: ${parsed.error}`,
    );
  });

  // ── Test 7 ──────────────────────────────────────────────────────────────────
  it("7. Encrypted secret in DB, valid HMAC with plaintext — passes sig check, reaches route (not 401)", async () => {
    stubCallbacks(merchantWithSecret());
    const ts = Math.floor(Date.now() / 1000);
    // HMAC uses plaintext secret — verifyCallbackSignature must decrypt CI_ENCRYPTED_SECRET first
    const sig = computeHmac(CI_PLAIN_SECRET, BODY_STR);
    const res = await postJson(server, "/api/callbacks", BODY, {
      "X-Api-Key":   CI_API_KEY,
      "X-Timestamp": String(ts),
      "X-Signature": sig,
    });
    // Route returns 404 (no matching QR) — signature was accepted, so NOT 401
    assert.notEqual(res.status, 401, `Signature should have passed. Got ${res.status}. Body: ${res.body.slice(0, 300)}`);
    assert.ok(!res.body.includes("INTERNAL_ERROR"), `Must not contain INTERNAL_ERROR. Body: ${res.body.slice(0, 200)}`);
  });

  // ── Test 8 ──────────────────────────────────────────────────────────────────
  it("8. Valid HMAC + bare hex format (no 'sha256=' prefix) — also accepted", async () => {
    stubCallbacks(merchantWithSecret());
    const ts = Math.floor(Date.now() / 1000);
    // Bare hex (no sha256= prefix) must also be accepted per verifyHmacSignature()
    const bareHex = crypto.createHmac("sha256", CI_PLAIN_SECRET).update(Buffer.from(BODY_STR)).digest("hex");
    const res = await postJson(server, "/api/callbacks", BODY, {
      "X-Api-Key":   CI_API_KEY,
      "X-Timestamp": String(ts),
      "X-Signature": bareHex,
    });
    assert.notEqual(res.status, 401, `Bare hex sig should be accepted. Got ${res.status}. Body: ${res.body.slice(0, 200)}`);
  });

  // ── Test 9 ──────────────────────────────────────────────────────────────────
  it("9. Valid HMAC + X-Nonce — accepted on first use (nonce not yet seen)", async () => {
    // Extend stub sequence to also handle nonce DB insert
    (db as any).select = makeSeqSelectStub([
      FAKE_API_KEY_ROW,
      merchantWithSecret(),
      null, // nonce isNonceSeen check → not seen
      null, // qrCodesTable
    ]);
    (db as any).update = noOpUpdate();
    (db as any).insert = noOpInsert();
    (db as any).delete = noOpInsert();

    const ts    = Math.floor(Date.now() / 1000);
    const nonce = crypto.randomBytes(16).toString("hex");
    const sig   = computeHmac(CI_PLAIN_SECRET, BODY_STR);
    const res   = await postJson(server, "/api/callbacks", BODY, {
      "X-Api-Key":   CI_API_KEY,
      "X-Timestamp": String(ts),
      "X-Signature": sig,
      "X-Nonce":     nonce,
    });
    assert.notEqual(res.status, 401, `First nonce use should be accepted. Got ${res.status}. Body: ${res.body.slice(0, 200)}`);
  });

  // ── Test 10 ─────────────────────────────────────────────────────────────────
  it("10. encryptSecret / decryptSecret round-trip — cryptographic unit assertion", () => {
    const plain     = "test_secret_" + crypto.randomBytes(8).toString("hex");
    const encrypted = encryptSecret(plain);

    // Encrypted form must differ from the plain form and carry the prefix
    assert.ok(encrypted.startsWith("enc:v1:"),  "encrypted value must start with enc:v1:");
    assert.notEqual(encrypted, plain,            "encrypted value must differ from plaintext");

    // Decrypt must return the original secret
    const result = decryptSecret(encrypted);
    assert.ok(result.ok, `decryptSecret returned ok:false — detail: ${!result.ok ? result.detail : ""}`);
    if (result.ok) {
      assert.equal(result.value, plain, "decrypted value must equal the original plaintext");
    }

    // Plain-text passthrough (backward-compat): a value without the enc:v1: prefix
    // must be returned as-is so old un-encrypted secrets continue to work.
    const legacyResult = decryptSecret("plain_legacy_secret");
    assert.ok(legacyResult.ok,                            "plain-text passthrough must succeed");
    if (legacyResult.ok) {
      assert.equal(legacyResult.value, "plain_legacy_secret", "plain-text passthrough must preserve value");
    }
  });
});
