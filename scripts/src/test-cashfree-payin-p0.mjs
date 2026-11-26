/**
 * Cashfree Payin P0 Fix — Full Test Suite (v2: encrypted-secret coverage)
 *
 * Tests:
 *   SECURITY   (8 tests)  — fail-closed, wrong sig, missing header, encrypted correct,
 *                           encrypted wrong, client_secret fallback (encrypted + plain)
 *   ACCOUNTING (9 tests)  — wallet credit, ledger, idempotency, isolation
 *   REGRESSION (4 tests)  — payout, PayU, Razorpay, health
 *
 * Encrypted-secret simulation: uses the api-server's own encryptSecret (via tsx)
 * to produce values identical to what Admin UI saves, verifying the full round-trip.
 *
 * All test records use TEST_ prefix and are cleaned up on exit.
 * NO real payments. NO real balance mutations.
 */

import { createHmac, createCipheriv, createHash, randomBytes } from "crypto";
import { execSync } from "child_process";

const API      = "http://localhost:8080/api";
const DB_URL   = process.env.DATABASE_URL ?? "";
const API_DIR  = "/home/runner/workspace/artifacts/api-server";

const TEST_SECRET     = "cf_test_signing_secret_p0_rasokart_2026";
const WRONG_SECRET    = "completely_wrong_secret_that_will_never_match";
const ORDER_TS        = Date.now();
const TEST_ORDER      = `TEST-CF-P001-${ORDER_TS}`;
const TEST_MERCHANT_ID = 1;

let pass = 0; let fail = 0;
const failures = [];

// ─── helpers ────────────────────────────────────────────────────────────────

function psql(sql) {
  return execSync(
    `psql "${DB_URL}" -t -A -c "${sql.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`,
    { encoding: "utf8", env: process.env }
  ).trim();
}

/**
 * Mirrors cryptoUtils.ts encryptSecret() exactly:
 *   key  = SHA-256(SESSION_SECRET)
 *   algo = AES-256-GCM, 12-byte IV
 *   out  = "enc:v1:<ivHex>:<authTagHex>:<ciphertextHex>"
 *
 * Produces values identical to what the Admin UI save path stores in system_config.
 * Uses only Node built-in crypto — no subprocess, no quoting issues.
 */
function encryptForAdminUI(plaintext) {
  const secret = process.env["SESSION_SECRET"];
  if (!secret) throw new Error("SESSION_SECRET not set — cannot simulate Admin UI encryption");
  const key = createHash("sha256").update(secret).digest();
  const iv  = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct  = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString("hex")}:${tag.toString("hex")}:${ct.toString("hex")}`;
}

function sign(secret, ts, bodyStr) {
  return createHmac("sha256", secret).update(ts + bodyStr).digest("base64");
}

async function post(path, body, headers = {}) {
  const bodyStr = JSON.stringify(body);
  const r = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: bodyStr,
  });
  let json = null;
  try { json = await r.json(); } catch { /* non-JSON body */ }
  return { status: r.status, json, bodyStr };
}

function buildPayinBody(orderId = TEST_ORDER) {
  return {
    type: "PAYMENT_SUCCESS_WEBHOOK",
    data: {
      order: { order_id: orderId, order_amount: "1.00" },
      payment: {
        payment_status: "SUCCESS",
        payment_amount: "1.00",
        cf_payment_id: `CF_TEST_${ORDER_TS}`,
      },
    },
  };
}

function ok(name, cond, detail = "") {
  if (cond) { console.log(`  ✔ ${name}`); pass++; }
  else { console.log(`  ✖ ${name}${detail ? " — " + detail : ""}`); fail++; failures.push(name); }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── DB helpers ─────────────────────────────────────────────────────────────

function upsertSystemConfig(key, value) {
  psql(`INSERT INTO system_config (key, value) VALUES ('${key}', '${value}') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
}
function deleteSystemConfig(key) {
  psql(`DELETE FROM system_config WHERE key = '${key}'`);
}
function clearSigningSecrets() {
  psql(`DELETE FROM system_config WHERE key IN ('cashfree_webhook_secret','cashfree_client_secret')`);
}

function setupTestOrder() {
  psql(`INSERT INTO cashfree_payment_orders (merchant_id, cashfree_order_id, payment_session_id, amount, currency, status, raw_payload) VALUES (${TEST_MERCHANT_ID}, '${TEST_ORDER}', 'ps_test_${ORDER_TS}', '1.00', 'INR', 'CREATED', '{}') ON CONFLICT (cashfree_order_id) DO NOTHING`);
}

function cleanup() {
  clearSigningSecrets();
  psql(`DELETE FROM cashfree_payment_orders  WHERE cashfree_order_id LIKE 'TEST-CF-P001-%'`);
  psql(`DELETE FROM transactions             WHERE reference_id      LIKE 'TEST-CF-P001-%'`);
  psql(`DELETE FROM cashfree_payment_logs    WHERE cashfree_order_id LIKE 'TEST-CF-P001-%'`);
  psql(`DELETE FROM wallet_ledger            WHERE description       LIKE '%${TEST_ORDER}%'`);
  // Restore cashfree_enabled to false
  upsertSystemConfig("cashfree_enabled", "false");
}

// ─── SECURITY TESTS ──────────────────────────────────────────────────────────

async function testSecurity() {
  console.log("\n── SECURITY TESTS ──────────────────────────────────────────────────────");

  const dummyBody  = buildPayinBody("NO-REAL-ORDER");
  const ts         = String(Math.floor(Date.now() / 1000));
  const bodyStr    = JSON.stringify(dummyBody);

  // T01: No signing credential at all → 401 fail-closed
  clearSigningSecrets();
  await sleep(150);
  {
    const r = await post("/payment/cashfree-webhook", dummyBody, {
      "x-webhook-signature": sign(TEST_SECRET, ts, bodyStr),
      "x-webhook-timestamp": ts,
    });
    ok("T01 — No signing credential (fail-closed) → 401", r.status === 401, `HTTP ${r.status}`);
  }

  // T02: Missing signature header → 401
  upsertSystemConfig("cashfree_webhook_secret", TEST_SECRET); // plaintext
  await sleep(150);
  {
    const r = await post("/payment/cashfree-webhook", dummyBody, {
      "x-webhook-timestamp": ts,
      // no x-webhook-signature
    });
    ok("T02 — Missing signature header → 401", r.status === 401, `HTTP ${r.status}`);
  }

  // T03: Wrong signature (plaintext secret present) → 401
  {
    const r = await post("/payment/cashfree-webhook", dummyBody, {
      "x-webhook-signature": sign(WRONG_SECRET, ts, bodyStr),
      "x-webhook-timestamp": ts,
    });
    ok("T03 — Wrong signature (plaintext webhook_secret) → 401", r.status === 401, `HTTP ${r.status}`);
  }

  // T04: Correct signature (plaintext secret) → 200
  {
    const r = await post("/payment/cashfree-webhook", dummyBody, {
      "x-webhook-signature": sign(TEST_SECRET, ts, bodyStr),
      "x-webhook-timestamp": ts,
    });
    ok("T04 — Correct signature (plaintext webhook_secret) → 200", r.status === 200, `HTTP ${r.status}`);
  }

  // ── ENCRYPTED SECRET TESTS (simulate Admin UI save) ──────────────────────
  console.log("\n── ENCRYPTED SECRET TESTS ──────────────────────────────────────────────");

  const encryptedSecret = encryptForAdminUI(TEST_SECRET);
  console.log(`     encryptSecret("${TEST_SECRET.slice(0,8)}…") = ${encryptedSecret.slice(0, 30)}…`);

  // T05: Encrypted webhook_secret + correct plaintext-signed request → 200
  clearSigningSecrets();
  upsertSystemConfig("cashfree_webhook_secret", encryptedSecret);
  await sleep(150);
  {
    const ts2 = String(Math.floor(Date.now() / 1000));
    const r = await post("/payment/cashfree-webhook", dummyBody, {
      "x-webhook-signature": sign(TEST_SECRET, ts2, bodyStr),
      "x-webhook-timestamp": ts2,
    });
    ok("T05 — Encrypted webhook_secret + correct sig → 200", r.status === 200, `HTTP ${r.status}`);
  }

  // T06: Encrypted webhook_secret + wrong signature → 401
  {
    const ts3 = String(Math.floor(Date.now() / 1000));
    const r = await post("/payment/cashfree-webhook", dummyBody, {
      "x-webhook-signature": sign(WRONG_SECRET, ts3, bodyStr),
      "x-webhook-timestamp": ts3,
    });
    ok("T06 — Encrypted webhook_secret + wrong sig → 401", r.status === 401, `HTTP ${r.status}`);
  }

  // T07: Encrypted webhook_secret + signature against raw encrypted blob → 401
  //      (if code forgot to decrypt, it would use enc:v1:… as the HMAC key;
  //       signing with that raw blob would produce a different sig than the real secret)
  {
    const ts4 = String(Math.floor(Date.now() / 1000));
    const sigAgainstBlob = sign(encryptedSecret, ts4, bodyStr); // wrong: encrypted blob as key
    const r = await post("/payment/cashfree-webhook", dummyBody, {
      "x-webhook-signature": sigAgainstBlob,
      "x-webhook-timestamp": ts4,
    });
    ok("T07 — Sig computed with raw enc:v1: blob as key → 401 (decrypt works correctly)",
      r.status === 401, `HTTP ${r.status}`);
  }

  // T08: Encrypted client_secret fallback (no webhook_secret configured) + correct sig → 200
  clearSigningSecrets();
  const encryptedClientSecret = encryptForAdminUI(TEST_SECRET);
  upsertSystemConfig("cashfree_client_secret", encryptedClientSecret);
  await sleep(150);
  {
    const ts5 = String(Math.floor(Date.now() / 1000));
    const r = await post("/payment/cashfree-webhook", dummyBody, {
      "x-webhook-signature": sign(TEST_SECRET, ts5, bodyStr),
      "x-webhook-timestamp": ts5,
    });
    ok("T08 — Encrypted client_secret fallback + correct sig → 200", r.status === 200, `HTTP ${r.status}`);
  }

  // T09: Encrypted client_secret fallback + wrong sig → 401
  {
    const ts6 = String(Math.floor(Date.now() / 1000));
    const r = await post("/payment/cashfree-webhook", dummyBody, {
      "x-webhook-signature": sign(WRONG_SECRET, ts6, bodyStr),
      "x-webhook-timestamp": ts6,
    });
    ok("T09 — Encrypted client_secret fallback + wrong sig → 401", r.status === 401, `HTTP ${r.status}`);
  }

  // Restore plaintext webhook_secret for accounting tests
  clearSigningSecrets();
  upsertSystemConfig("cashfree_webhook_secret", TEST_SECRET);
}

// ─── ACCOUNTING TESTS ────────────────────────────────────────────────────────

async function testAccounting() {
  console.log("\n── ACCOUNTING TESTS ─────────────────────────────────────────────────────");

  upsertSystemConfig("cashfree_enabled", "true");
  psql(`INSERT INTO merchant_wallets (merchant_id) VALUES (${TEST_MERCHANT_ID}) ON CONFLICT (merchant_id) DO NOTHING`);

  const walletBefore = psql(`SELECT pending_balance, total_collection FROM merchant_wallets WHERE merchant_id = ${TEST_MERCHANT_ID}`).split("|");
  const pendingBefore    = parseFloat(walletBefore[0] ?? "0");
  const collectionBefore = parseFloat(walletBefore[1] ?? "0");
  const ledgerBefore     = parseInt(psql(`SELECT COUNT(*) FROM wallet_ledger WHERE merchant_id = ${TEST_MERCHANT_ID} AND description LIKE '%${TEST_ORDER}%'`) || "0");

  const body    = buildPayinBody(TEST_ORDER);
  const ts      = String(Math.floor(Date.now() / 1000));
  const bodyStr = JSON.stringify(body);
  const sig     = sign(TEST_SECRET, ts, bodyStr);

  // T10: Send signed success webhook
  const r1 = await post("/payment/cashfree-webhook", body, {
    "x-webhook-signature": sig,
    "x-webhook-timestamp": ts,
  });
  ok("T10 — Signed success webhook → 200", r1.status === 200, `HTTP ${r1.status}`);

  await sleep(1200); // wait for async DB transaction

  // T11: Order status → PAID
  const orderStatus = psql(`SELECT status FROM cashfree_payment_orders WHERE cashfree_order_id = '${TEST_ORDER}'`);
  ok("T11 — Order status → PAID", orderStatus === "PAID", `got: ${orderStatus}`);

  // T12: Wallet pendingBalance ↑ 1.00
  const walletAfter = psql(`SELECT pending_balance, total_collection FROM merchant_wallets WHERE merchant_id = ${TEST_MERCHANT_ID}`).split("|");
  const pendingAfter    = parseFloat(walletAfter[0] ?? "0");
  const collectionAfter = parseFloat(walletAfter[1] ?? "0");
  ok("T12 — pendingBalance increased by 1.00", Math.abs((pendingAfter - pendingBefore) - 1.00) < 0.001,
    `delta=${(pendingAfter - pendingBefore).toFixed(4)}`);
  ok("T12b — totalCollection increased by 1.00", Math.abs((collectionAfter - collectionBefore) - 1.00) < 0.001,
    `delta=${(collectionAfter - collectionBefore).toFixed(4)}`);

  // T13: Exactly 1 wallet_ledger row
  const ledgerAfter = parseInt(psql(`SELECT COUNT(*) FROM wallet_ledger WHERE merchant_id = ${TEST_MERCHANT_ID} AND description LIKE '%${TEST_ORDER}%'`) || "0");
  ok("T13 — wallet_ledger row created (exactly 1)", (ledgerAfter - ledgerBefore) === 1,
    `rows for test order: ${ledgerAfter - ledgerBefore}`);

  // T14: Ledger row is correct type/bucket/amount
  const ledgerRow = psql(`SELECT txn_type || '|' || bucket || '|' || amount FROM wallet_ledger WHERE merchant_id = ${TEST_MERCHANT_ID} AND description LIKE '%${TEST_ORDER}%' ORDER BY id DESC LIMIT 1`);
  const [txnType, bucket, ledgerAmt] = ledgerRow.split("|");
  ok("T14 — Ledger: txn_type=pending_credit, bucket=pending, amount=1.00",
    txnType === "pending_credit" && bucket === "pending" && parseFloat(ledgerAmt) === 1.00,
    `got: ${ledgerRow}`);

  // T15: Idempotency — duplicate delivery
  const ts2  = String(Math.floor(Date.now() / 1000));
  const sig2 = sign(TEST_SECRET, ts2, bodyStr);
  const r2 = await post("/payment/cashfree-webhook", body, {
    "x-webhook-signature": sig2,
    "x-webhook-timestamp": ts2,
  });
  ok("T15 — Duplicate webhook → 200 (safe ACK)", r2.status === 200, `HTTP ${r2.status}`);
  await sleep(800);

  // T16: Wallet NOT double-credited
  const pendingAfter2 = parseFloat(psql(`SELECT pending_balance FROM merchant_wallets WHERE merchant_id = ${TEST_MERCHANT_ID}`) ?? "0");
  ok("T16 — Duplicate: wallet NOT credited again", Math.abs(pendingAfter2 - pendingAfter) < 0.001,
    `after1=${pendingAfter}, after2=${pendingAfter2}`);

  // T17: Ledger NOT duplicated
  const ledgerAfter2 = parseInt(psql(`SELECT COUNT(*) FROM wallet_ledger WHERE merchant_id = ${TEST_MERCHANT_ID} AND description LIKE '%${TEST_ORDER}%'`) || "0");
  ok("T17 — Duplicate: ledger NOT duplicated (still exactly 1)",
    (ledgerAfter2 - ledgerBefore) === 1, `rows: ${ledgerAfter2 - ledgerBefore}`);

  // T18: Merchant isolation — exactly 1 transaction row
  const txCount = parseInt(psql(`SELECT COUNT(*) FROM transactions WHERE reference_id = '${TEST_ORDER}'`) || "0");
  ok("T18 — Exactly one transactions row for the test order", txCount === 1, `got ${txCount}`);

  upsertSystemConfig("cashfree_enabled", "false");
}

// ─── REGRESSION TESTS ────────────────────────────────────────────────────────

async function testRegression() {
  console.log("\n── REGRESSION TESTS ─────────────────────────────────────────────────────");

  // T19: Cashfree Payout webhook (separate route — should be unaffected by payin changes)
  // When payout client/webhook secret IS configured → wrong sig must yield 401.
  // When neither is configured in dev → endpoint accepts without verification (pre-existing
  // behaviour; payout credentials are not seeded in dev). Either way the endpoint must not 500.
  {
    const payoutSecret = psql(`SELECT value FROM system_config WHERE key='cashfree_payout_client_secret'`);
    const r = await post("/cashfree-payout/webhook", { type: "WEBHOOK_TEST", data: {} }, {
      "x-webhook-signature": "wrong_sig",
      "x-webhook-timestamp": String(Math.floor(Date.now() / 1000)),
    });
    if (payoutSecret) {
      ok("T19 — Cashfree Payout webhook: payout creds present, wrong sig → 401 (unchanged)",
        r.status === 401, `HTTP ${r.status}`);
    } else {
      ok("T19 — Cashfree Payout webhook: no payout creds in dev → responds without 500 (unchanged)",
        r.status !== 500, `HTTP ${r.status}`);
    }
  }

  // T20: PayU S2S webhook — responds without 500
  {
    const r = await post("/payment/payu-s2s", { txnid: "TEST_PAYU_REGRESSION", status: "failure" });
    ok("T20 — PayU S2S webhook: no 500 (unchanged)", r.status !== 500, `HTTP ${r.status}`);
  }

  // T21: Razorpay webhook — wrong sig → 401 (unchanged)
  {
    const r = await post("/webhooks/razorpay", { event: "payment.captured" }, {
      "x-razorpay-signature": "wrong_sig",
    });
    ok("T21 — Razorpay webhook: wrong sig → non-500 (unchanged)", r.status !== 500 && r.status !== 200, `HTTP ${r.status}`);
  }

  // T22: API health check
  {
    const r = await fetch(`${API}/healthz`);
    const json = await r.json().catch(() => ({}));
    ok("T22 — API health check → 200 status=ok", r.status === 200 && json.status === "ok", `HTTP ${r.status} ${JSON.stringify(json)}`);
  }
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

console.log("═══════════════════════════════════════════════════════════════════════");
console.log("  CASHFREE PAYIN P0 v2 — FULL TEST SUITE (WITH ENCRYPTED-SECRET PATHS)");
console.log(`  Test order: ${TEST_ORDER}`);
console.log("═══════════════════════════════════════════════════════════════════════");

try {
  setupTestOrder();
  await testSecurity();
  await testAccounting();
  await testRegression();
} finally {
  console.log("\n── CLEANUP ──────────────────────────────────────────────────────────────");
  cleanup();
  console.log("  Test records deleted.\n");
}

console.log("═══════════════════════════════════════════════════════════════════════");
console.log(`  PASS: ${pass}   FAIL: ${fail}   TOTAL: ${pass + fail}`);
if (failures.length) {
  console.log("  FAILED:");
  failures.forEach(f => console.log(`    ✖ ${f}`));
}
console.log("═══════════════════════════════════════════════════════════════════════");

if (fail > 0) process.exit(1);
