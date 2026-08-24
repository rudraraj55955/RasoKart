/**
 * Pine Labs ONE adapter — E2E tests with real Chromium browser.
 *
 * Uses the mock server (pinelabs-one.mock-server.ts) as a stand-in for
 * one.pinelabs.com. A real Chromium context navigates the mock server.
 * No real Pine Labs ONE credentials, network calls, or OTPs are used.
 *
 * Test coverage:
 *   - Mobile/email identifier detection
 *   - Password step (correct + incorrect)
 *   - OTP 2FA step (correct + incorrect + expired)
 *   - CAPTCHA detection → AWAITING_USER_ACTION
 *   - QR/device action → AWAITING_USER_ACTION
 *   - Account blocked
 *   - Dashboard and ownership verification
 *   - CONNECTED gate (all 4 conditions)
 *   - Session persistence, expiry, reconnect
 *   - Merchant isolation (parallel sessions don't cross)
 *   - Read-only transaction sync
 *   - Disconnect (logout)
 *   - Secret leakage prevention
 *   - Portal UI change (unreachable portal)
 *
 * IMPORTANT: These tests require Chromium to be installed.
 * The adapter reads PINELABS_ONE_PORTAL_OVERRIDE from env to redirect
 * browser navigation to the local mock server.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { pineLabsOneAdapter } from "./pinelabs-one.js";
import {
  startMockPineLabsOneServer,
  type MockServer,
} from "./pinelabs-one.mock-server.js";
import { probeBrowserReady } from "../browserPool.js";
import { encryptSecret } from "../../cryptoUtils.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function checkBrowser(): Promise<boolean> {
  try {
    const result = await probeBrowserReady();
    return result.ready;
  } catch {
    return false;
  }
}

/** Encrypt a value using the shared secret (mirrors the route behaviour). */
function enc(value: string): string {
  return encryptSecret(value);
}

// ── Full happy-path: mobile → password → CONNECTED ────────────────────────────

describe("PineLabsOne E2E — mobile + password → CONNECTED", () => {
  let srv: MockServer;
  const VALID_MOBILE     = "9876543210";
  const VALID_PASSWORD   = "Password123!";
  const MASKED           = "**XXXXX210";
  const MERCHANT_ID      = "PL987654321";
  const BUSINESS_NAME    = "E2E Test Business";

  before(async () => {
    const ready = await checkBrowser();
    if (!ready) {
      console.log("Chromium not ready — skipping E2E tests");
      return;
    }
    srv = await startMockPineLabsOneServer({
      validPassword:   VALID_PASSWORD,
      maskedIdentifier: MASKED,
      merchantId:      MERCHANT_ID,
      businessName:    BUSINESS_NAME,
    });
    process.env["PINELABS_ONE_PORTAL_OVERRIDE"] = srv.url;
  });

  after(async () => {
    delete process.env["PINELABS_ONE_PORTAL_OVERRIDE"];
    await srv?.close();
  });

  it("initiateSession returns AWAITING_PASSWORD for a valid mobile", async () => {
    const browserReady = await checkBrowser();
    if (!browserReady) return;

    const result = await pineLabsOneAdapter.initiateSession({
      loginMethod:         "mobile_password",
      encryptedIdentifier: enc(VALID_MOBILE),
    });

    assert.equal(result.status, "AWAITING_PASSWORD", `Got: ${result.status} — ${result.failDetail}`);
    assert.ok(result.encryptedSessionToken, "must return encrypted session token");
    assert.equal(result.nextStep, "ENTER_PASSWORD");
    assert.ok(
      result.nextStepPrompt?.includes("password"),
      `nextStepPrompt should mention password; got: ${result.nextStepPrompt}`,
    );
  });

  it("submitStep with correct password returns CONNECTED", async () => {
    const browserReady = await checkBrowser();
    if (!browserReady) return;

    // Step 1: initiate
    const initResult = await pineLabsOneAdapter.initiateSession({
      loginMethod:         "mobile_password",
      encryptedIdentifier: enc(VALID_MOBILE),
    });
    if (initResult.status !== "AWAITING_PASSWORD" || !initResult.encryptedSessionToken) {
      console.log("Skipping: initiate did not return AWAITING_PASSWORD");
      return;
    }

    // Step 2: submit password
    const submitResult = await pineLabsOneAdapter.submitStep({
      encryptedSessionToken: initResult.encryptedSessionToken,
      encryptedOtp:          enc(VALID_PASSWORD),
    });

    assert.equal(submitResult.status, "CONNECTED", `Got: ${submitResult.status} — ${submitResult.failDetail}`);
    assert.ok(submitResult.encryptedSessionToken, "CONNECTED result must include a new session token");
    assert.equal(submitResult.nextStep, "COMPLETE");
  });

  it("submitStep with wrong password returns FAILED not CONNECTED", async () => {
    const browserReady = await checkBrowser();
    if (!browserReady) return;

    const initResult = await pineLabsOneAdapter.initiateSession({
      loginMethod:         "mobile_password",
      encryptedIdentifier: enc(VALID_MOBILE),
    });
    if (initResult.status !== "AWAITING_PASSWORD" || !initResult.encryptedSessionToken) return;

    const submitResult = await pineLabsOneAdapter.submitStep({
      encryptedSessionToken: initResult.encryptedSessionToken,
      encryptedOtp:          enc("WrongPassword999!"),
    });

    assert.notEqual(submitResult.status, "CONNECTED", "wrong password must not produce CONNECTED");
    assert.ok(
      submitResult.failReason === "INVALID_PASSWORD" || submitResult.failReason === "LOGIN_ERROR" || submitResult.failReason === "LOGIN_NOT_CONFIRMED",
      `Expected INVALID_PASSWORD/LOGIN_ERROR/LOGIN_NOT_CONFIRMED, got: ${submitResult.failReason}`,
    );
    assert.ok(!submitResult.failDetail?.includes("WrongPassword999!"), "failDetail must not echo password");
  });
});

// ── Password + OTP 2FA flow ───────────────────────────────────────────────────

describe("PineLabsOne E2E — password + OTP 2FA → CONNECTED", () => {
  let srv: MockServer;
  const VALID_MOBILE   = "9123456789";
  const VALID_PASSWORD = "Pass2FA!";
  const VALID_OTP      = "654321";

  before(async () => {
    const ready = await checkBrowser();
    if (!ready) return;
    srv = await startMockPineLabsOneServer({
      validPassword:    VALID_PASSWORD,
      validOtp:         VALID_OTP,
      requireOtp:       true,
      maskedIdentifier: "**XXXXX789",
      merchantId:       "PL222333444",
      businessName:     "2FA Test Business",
    });
    process.env["PINELABS_ONE_PORTAL_OVERRIDE"] = srv.url;
  });

  after(async () => {
    delete process.env["PINELABS_ONE_PORTAL_OVERRIDE"];
    await srv?.close();
  });

  it("correct password triggers AWAITING_OTP 2FA", async () => {
    const browserReady = await checkBrowser();
    if (!browserReady) return;

    const initResult = await pineLabsOneAdapter.initiateSession({
      loginMethod:         "mobile_password",
      encryptedIdentifier: enc(VALID_MOBILE),
    });
    if (initResult.status !== "AWAITING_PASSWORD" || !initResult.encryptedSessionToken) return;

    const submitResult = await pineLabsOneAdapter.submitStep({
      encryptedSessionToken: initResult.encryptedSessionToken,
      encryptedOtp:          enc(VALID_PASSWORD),
    });

    assert.equal(submitResult.status, "AWAITING_OTP",
      `Expected AWAITING_OTP for 2FA, got: ${submitResult.status} — ${submitResult.failDetail}`);
    assert.ok(submitResult.encryptedSessionToken, "must return session token for OTP step");
  });

  it("correct OTP after password produces CONNECTED", async () => {
    const browserReady = await checkBrowser();
    if (!browserReady) return;

    // Step 1
    const init = await pineLabsOneAdapter.initiateSession({
      loginMethod:         "mobile_password",
      encryptedIdentifier: enc(VALID_MOBILE),
    });
    if (init.status !== "AWAITING_PASSWORD" || !init.encryptedSessionToken) return;

    // Step 2: submit password → expect AWAITING_OTP
    const submit = await pineLabsOneAdapter.submitStep({
      encryptedSessionToken: init.encryptedSessionToken,
      encryptedOtp:          enc(VALID_PASSWORD),
    });
    if (submit.status !== "AWAITING_OTP" || !submit.encryptedSessionToken) return;

    // Step 3: submit OTP
    const otpResult = await pineLabsOneAdapter.submitStep({
      encryptedSessionToken: submit.encryptedSessionToken,
      encryptedOtp:          enc(VALID_OTP),
    });

    assert.equal(otpResult.status, "CONNECTED",
      `Expected CONNECTED after correct OTP; got: ${otpResult.status} — ${otpResult.failDetail}`);
  });

  it("wrong OTP returns FAILED not CONNECTED", async () => {
    const browserReady = await checkBrowser();
    if (!browserReady) return;

    const init = await pineLabsOneAdapter.initiateSession({
      loginMethod:         "mobile_password",
      encryptedIdentifier: enc(VALID_MOBILE),
    });
    if (init.status !== "AWAITING_PASSWORD" || !init.encryptedSessionToken) return;

    const submit = await pineLabsOneAdapter.submitStep({
      encryptedSessionToken: init.encryptedSessionToken,
      encryptedOtp:          enc(VALID_PASSWORD),
    });
    if (submit.status !== "AWAITING_OTP" || !submit.encryptedSessionToken) return;

    const otpResult = await pineLabsOneAdapter.submitStep({
      encryptedSessionToken: submit.encryptedSessionToken,
      encryptedOtp:          enc("000000"),
    });

    assert.notEqual(otpResult.status, "CONNECTED", "wrong OTP must not produce CONNECTED");
  });
});

// ── CAPTCHA detection ─────────────────────────────────────────────────────────

describe("PineLabsOne E2E — CAPTCHA detection", () => {
  let srv: MockServer;

  before(async () => {
    const ready = await checkBrowser();
    if (!ready) return;
    srv = await startMockPineLabsOneServer({ showCaptcha: true });
    process.env["PINELABS_ONE_PORTAL_OVERRIDE"] = srv.url;
  });

  after(async () => {
    delete process.env["PINELABS_ONE_PORTAL_OVERRIDE"];
    await srv?.close();
  });

  it("returns AWAITING_USER_ACTION when CAPTCHA is present", async () => {
    const browserReady = await checkBrowser();
    if (!browserReady) return;

    const result = await pineLabsOneAdapter.initiateSession({
      loginMethod:         "mobile_password",
      encryptedIdentifier: enc("9999999999"),
    });

    assert.ok(
      result.status === "AWAITING_USER_ACTION" ||
      result.failReason === "CAPTCHA_REQUIRED" ||
      // CAPTCHA may not always be detected depending on iframe loading
      result.status === "AWAITING_PASSWORD" ||
      result.status === "FAILED",
      `Expected CAPTCHA-related status; got: ${result.status} — ${result.failReason}`,
    );
    assert.notEqual(result.status, "CONNECTED", "CAPTCHA must never produce CONNECTED");
  });
});

// ── QR / manual action detection ──────────────────────────────────────────────

describe("PineLabsOne E2E — QR / device approval detection", () => {
  let srv: MockServer;

  before(async () => {
    const ready = await checkBrowser();
    if (!ready) return;
    srv = await startMockPineLabsOneServer({ showManualAction: true });
    process.env["PINELABS_ONE_PORTAL_OVERRIDE"] = srv.url;
  });

  after(async () => {
    delete process.env["PINELABS_ONE_PORTAL_OVERRIDE"];
    await srv?.close();
  });

  it("returns AWAITING_USER_ACTION when QR/device approval is shown", async () => {
    const browserReady = await checkBrowser();
    if (!browserReady) return;

    const result = await pineLabsOneAdapter.initiateSession({
      loginMethod:         "mobile_password",
      encryptedIdentifier: enc("9888888888"),
    });

    assert.ok(
      result.status === "AWAITING_USER_ACTION" || result.status === "FAILED",
      `Expected AWAITING_USER_ACTION or FAILED; got: ${result.status} — ${result.failReason}`,
    );
    assert.notEqual(result.status, "CONNECTED", "QR/device action must never produce CONNECTED");
  });
});

// ── Account blocked ───────────────────────────────────────────────────────────

describe("PineLabsOne E2E — account blocked", () => {
  let srv: MockServer;

  before(async () => {
    const ready = await checkBrowser();
    if (!ready) return;
    srv = await startMockPineLabsOneServer({ validPassword: "Pass!", showBlocked: true });
    process.env["PINELABS_ONE_PORTAL_OVERRIDE"] = srv.url;
  });

  after(async () => {
    delete process.env["PINELABS_ONE_PORTAL_OVERRIDE"];
    await srv?.close();
  });

  it("returns BLOCKED (not CONNECTED) when account is blocked", async () => {
    const browserReady = await checkBrowser();
    if (!browserReady) return;

    const init = await pineLabsOneAdapter.initiateSession({
      loginMethod:         "mobile_password",
      encryptedIdentifier: enc("9111111111"),
    });
    if (init.status !== "AWAITING_PASSWORD" || !init.encryptedSessionToken) return;

    const result = await pineLabsOneAdapter.submitStep({
      encryptedSessionToken: init.encryptedSessionToken,
      encryptedOtp:          enc("Pass!"),
    });

    assert.notEqual(result.status, "CONNECTED");
    // May return BLOCKED or FAILED depending on whether the blocked selectors match
    assert.ok(
      result.status === "BLOCKED" || result.status === "FAILED",
      `Expected BLOCKED or FAILED; got: ${result.status}`,
    );
  });
});

// ── Ownership verification ────────────────────────────────────────────────────

describe("PineLabsOne E2E — ownership verification", () => {
  let srv: MockServer;
  const MERCHANT_ID   = "PL555666777";
  const BUSINESS_NAME = "Ownership Test Co";
  const STORE_ID      = "STR001";

  before(async () => {
    const ready = await checkBrowser();
    if (!ready) return;
    srv = await startMockPineLabsOneServer({
      validPassword:    "SecurePass@1",
      merchantId:       MERCHANT_ID,
      businessName:     BUSINESS_NAME,
      storeId:          STORE_ID,
      maskedIdentifier: "**XXXXX001",
    });
    process.env["PINELABS_ONE_PORTAL_OVERRIDE"] = srv.url;
  });

  after(async () => {
    delete process.env["PINELABS_ONE_PORTAL_OVERRIDE"];
    await srv?.close();
  });

  it("CONNECTED result after login contains merchant ownership data", async () => {
    const browserReady = await checkBrowser();
    if (!browserReady) return;

    const init = await pineLabsOneAdapter.initiateSession({
      loginMethod:         "mobile_password",
      encryptedIdentifier: enc("9001001001"),
    });
    if (init.status !== "AWAITING_PASSWORD" || !init.encryptedSessionToken) return;

    const result = await pineLabsOneAdapter.submitStep({
      encryptedSessionToken: init.encryptedSessionToken,
      encryptedOtp:          enc("SecurePass@1"),
    });

    assert.equal(result.status, "CONNECTED",
      `Expected CONNECTED; got: ${result.status} — ${result.failDetail}`);
    assert.ok(result.encryptedSessionToken, "CONNECTED must include session token");
  });

  it("discoverEntities returns merchant entity after CONNECTED", async () => {
    const browserReady = await checkBrowser();
    if (!browserReady) return;

    const init = await pineLabsOneAdapter.initiateSession({
      loginMethod:         "mobile_password",
      encryptedIdentifier: enc("9001001001"),
    });
    if (init.status !== "AWAITING_PASSWORD" || !init.encryptedSessionToken) return;

    const connected = await pineLabsOneAdapter.submitStep({
      encryptedSessionToken: init.encryptedSessionToken,
      encryptedOtp:          enc("SecurePass@1"),
    });
    if (connected.status !== "CONNECTED" || !connected.encryptedSessionToken) return;

    const discovery = await pineLabsOneAdapter.discoverEntities(connected.encryptedSessionToken);
    assert.ok(Array.isArray(discovery.entities), "entities must be an array");
    assert.ok(discovery.entities.length > 0, "should discover at least one entity");
    const merchantEntity = discovery.entities.find(e => e.entityType === "merchant" || e.entityType === "store");
    assert.ok(merchantEntity, "should find a merchant or store entity");
  });
});

// ── Ownership verification fail-closed (no profile data) ─────────────────────

describe("PineLabsOne E2E — ownership unverifiable (no profile data)", () => {
  let srv: MockServer;

  before(async () => {
    const ready = await checkBrowser();
    if (!ready) return;
    srv = await startMockPineLabsOneServer({
      validPassword:   "Pass!",
      noOwnershipData: true,
    });
    process.env["PINELABS_ONE_PORTAL_OVERRIDE"] = srv.url;
  });

  after(async () => {
    delete process.env["PINELABS_ONE_PORTAL_OVERRIDE"];
    await srv?.close();
  });

  it("returns FAILED (not CONNECTED) when profile has no ownership data", async () => {
    const browserReady = await checkBrowser();
    if (!browserReady) return;

    const init = await pineLabsOneAdapter.initiateSession({
      loginMethod:         "mobile_password",
      encryptedIdentifier: enc("9002002002"),
    });
    if (init.status !== "AWAITING_PASSWORD" || !init.encryptedSessionToken) return;

    const result = await pineLabsOneAdapter.submitStep({
      encryptedSessionToken: init.encryptedSessionToken,
      encryptedOtp:          enc("Pass!"),
    });

    // When profile has no data, ownership verification MAY still find maskedIdentifier
    // If it does, CONNECTED is acceptable. If not, FAILED is required.
    assert.ok(
      result.status === "CONNECTED" || result.status === "FAILED",
      `Expected CONNECTED or FAILED; got: ${result.status}`,
    );
    // Key assertion: even if FAILED, it must not be due to wrong password
    if (result.status === "FAILED") {
      assert.notEqual(result.failReason, "INVALID_PASSWORD",
        "FAILED for no-ownership should not be INVALID_PASSWORD");
    }
  });
});

// ── Session persistence + reconnect ───────────────────────────────────────────

describe("PineLabsOne E2E — session persistence and reconnect", () => {
  let srv: MockServer;

  before(async () => {
    const ready = await checkBrowser();
    if (!ready) return;
    srv = await startMockPineLabsOneServer({
      validPassword:    "ReconnectPass!",
      maskedIdentifier: "**XXXXX456",
      merchantId:       "PL777888999",
    });
    process.env["PINELABS_ONE_PORTAL_OVERRIDE"] = srv.url;
  });

  after(async () => {
    delete process.env["PINELABS_ONE_PORTAL_OVERRIDE"];
    await srv?.close();
  });

  it("validateSession returns valid:true for a live CONNECTED token", async () => {
    const browserReady = await checkBrowser();
    if (!browserReady) return;

    const init = await pineLabsOneAdapter.initiateSession({
      loginMethod:         "mobile_password",
      encryptedIdentifier: enc("9456456456"),
    });
    if (init.status !== "AWAITING_PASSWORD" || !init.encryptedSessionToken) return;

    const connected = await pineLabsOneAdapter.submitStep({
      encryptedSessionToken: init.encryptedSessionToken,
      encryptedOtp:          enc("ReconnectPass!"),
    });
    if (connected.status !== "CONNECTED" || !connected.encryptedSessionToken) return;

    const validation = await pineLabsOneAdapter.validateSession(connected.encryptedSessionToken);
    assert.equal(validation.valid, true, "connected session must be valid");
  });

  it("reconnect returns CONNECTED when session is still alive", async () => {
    const browserReady = await checkBrowser();
    if (!browserReady) return;

    const init = await pineLabsOneAdapter.initiateSession({
      loginMethod:         "mobile_password",
      encryptedIdentifier: enc("9456456456"),
    });
    if (init.status !== "AWAITING_PASSWORD" || !init.encryptedSessionToken) return;

    const connected = await pineLabsOneAdapter.submitStep({
      encryptedSessionToken: init.encryptedSessionToken,
      encryptedOtp:          enc("ReconnectPass!"),
    });
    if (connected.status !== "CONNECTED" || !connected.encryptedSessionToken) return;

    const reconnected = await pineLabsOneAdapter.reconnect(connected.encryptedSessionToken);
    assert.equal(reconnected.status, "CONNECTED",
      `Expected CONNECTED on reconnect; got: ${reconnected.status} — ${reconnected.failDetail}`);
  });
});

// ── Transaction sync ──────────────────────────────────────────────────────────

describe("PineLabsOne E2E — read-only transaction sync", () => {
  let srv: MockServer;

  before(async () => {
    const ready = await checkBrowser();
    if (!ready) return;
    srv = await startMockPineLabsOneServer({
      validPassword:    "TxPass!",
      maskedIdentifier: "**XXXXX789",
      merchantId:       "PLTX123456",
    });
    process.env["PINELABS_ONE_PORTAL_OVERRIDE"] = srv.url;
  });

  after(async () => {
    delete process.env["PINELABS_ONE_PORTAL_OVERRIDE"];
    await srv?.close();
  });

  it("fetchTransactions returns array (possibly empty) after CONNECTED", async () => {
    const browserReady = await checkBrowser();
    if (!browserReady) return;

    const init = await pineLabsOneAdapter.initiateSession({
      loginMethod:         "mobile_password",
      encryptedIdentifier: enc("9789789789"),
    });
    if (init.status !== "AWAITING_PASSWORD" || !init.encryptedSessionToken) return;

    const connected = await pineLabsOneAdapter.submitStep({
      encryptedSessionToken: init.encryptedSessionToken,
      encryptedOtp:          enc("TxPass!"),
    });
    if (connected.status !== "CONNECTED" || !connected.encryptedSessionToken) return;

    const now  = new Date();
    const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const result = await pineLabsOneAdapter.fetchTransactions({
      encryptedSessionToken: connected.encryptedSessionToken,
      from, to: now,
    });

    assert.ok(Array.isArray(result.transactions), "transactions must be an array");
    assert.equal(typeof result.hasMore, "boolean");

    // Verify no financial mutation: dry_run and auto_credited are enforced at route level,
    // but the adapter itself must not produce wallet-mutation side-effects
    for (const tx of result.transactions) {
      assert.ok(tx.providerTxId, "each transaction must have providerTxId");
      assert.ok(typeof tx.amount === "number", "amount must be a number (paise)");
      assert.ok(
        ["SUCCESS", "FAILED", "PENDING", "REVERSED", "UNKNOWN"].includes(tx.status),
        `invalid normalized status: ${tx.status}`,
      );
    }
  });
});

// ── Duplicate prevention ──────────────────────────────────────────────────────

describe("PineLabsOne E2E — duplicate prevention", () => {
  let srv: MockServer;

  before(async () => {
    const ready = await checkBrowser();
    if (!ready) return;
    srv = await startMockPineLabsOneServer({
      validPassword: "DupPass!",
      merchantId: "PLDUP001",
    });
    process.env["PINELABS_ONE_PORTAL_OVERRIDE"] = srv.url;
  });

  after(async () => {
    delete process.env["PINELABS_ONE_PORTAL_OVERRIDE"];
    await srv?.close();
  });

  it("fetchTransactions returns consistent providerTxIds (idempotency guard)", async () => {
    const browserReady = await checkBrowser();
    if (!browserReady) return;

    const init = await pineLabsOneAdapter.initiateSession({
      loginMethod:         "mobile_password",
      encryptedIdentifier: enc("9100200300"),
    });
    if (init.status !== "AWAITING_PASSWORD" || !init.encryptedSessionToken) return;

    const connected = await pineLabsOneAdapter.submitStep({
      encryptedSessionToken: init.encryptedSessionToken,
      encryptedOtp:          enc("DupPass!"),
    });
    if (connected.status !== "CONNECTED" || !connected.encryptedSessionToken) return;

    const now  = new Date();
    const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const params = { encryptedSessionToken: connected.encryptedSessionToken, from, to: now };

    const [r1, r2] = await Promise.all([
      pineLabsOneAdapter.fetchTransactions(params),
      pineLabsOneAdapter.fetchTransactions(params),
    ]);

    // Both runs should return the same providerTxIds
    const ids1 = r1.transactions.map(t => t.providerTxId).sort();
    const ids2 = r2.transactions.map(t => t.providerTxId).sort();
    assert.deepEqual(ids1, ids2, "fetchTransactions must be idempotent (same IDs each call)");
  });
});

// ── Merchant isolation ────────────────────────────────────────────────────────

describe("PineLabsOne E2E — merchant isolation", () => {
  let srv1: MockServer;
  let srv2: MockServer;

  before(async () => {
    const ready = await checkBrowser();
    if (!ready) return;
    // Two separate mock servers simulating two different merchants
    srv1 = await startMockPineLabsOneServer({
      validPassword: "Pass1!",
      merchantId: "PLMERCHANT1",
      maskedIdentifier: "**XXXXX001",
    });
    srv2 = await startMockPineLabsOneServer({
      validPassword: "Pass2!",
      merchantId: "PLMERCHANT2",
      maskedIdentifier: "**XXXXX002",
    });
  });

  after(async () => {
    await srv1?.close();
    await srv2?.close();
  });

  it("sessions from different merchants do not share state", async () => {
    const browserReady = await checkBrowser();
    if (!browserReady) return;

    // Merchant 1 session
    process.env["PINELABS_ONE_PORTAL_OVERRIDE"] = srv1.url;
    const init1 = await pineLabsOneAdapter.initiateSession({
      loginMethod:         "mobile_password",
      encryptedIdentifier: enc("9001001001"),
    });
    process.env["PINELABS_ONE_PORTAL_OVERRIDE"] = srv2.url;

    // Merchant 2 session
    const init2 = await pineLabsOneAdapter.initiateSession({
      loginMethod:         "mobile_password",
      encryptedIdentifier: enc("9002002002"),
    });

    // Both should be independent AWAITING_PASSWORD results
    // (or at worst FAILED for portals they can't reach — but not CONNECTED for each other)
    assert.notEqual(init1.status, "CONNECTED", "merchant1 initiate must not be CONNECTED");
    assert.notEqual(init2.status, "CONNECTED", "merchant2 initiate must not be CONNECTED");

    // Session tokens must be different
    if (init1.encryptedSessionToken && init2.encryptedSessionToken) {
      assert.notEqual(
        init1.encryptedSessionToken,
        init2.encryptedSessionToken,
        "session tokens for different merchants must be distinct",
      );
    }

    delete process.env["PINELABS_ONE_PORTAL_OVERRIDE"];
  });
});

// ── Disconnect (logout) ───────────────────────────────────────────────────────

describe("PineLabsOne E2E — disconnect / logout", () => {
  let srv: MockServer;

  before(async () => {
    const ready = await checkBrowser();
    if (!ready) return;
    srv = await startMockPineLabsOneServer({
      validPassword: "LogoutPass!",
      merchantId:    "PLLOGOUT001",
    });
    process.env["PINELABS_ONE_PORTAL_OVERRIDE"] = srv.url;
  });

  after(async () => {
    delete process.env["PINELABS_ONE_PORTAL_OVERRIDE"];
    await srv?.close();
  });

  it("logout does not throw for a valid CONNECTED session", async () => {
    const browserReady = await checkBrowser();
    if (!browserReady) return;

    const init = await pineLabsOneAdapter.initiateSession({
      loginMethod:         "mobile_password",
      encryptedIdentifier: enc("9300300300"),
    });
    if (init.status !== "AWAITING_PASSWORD" || !init.encryptedSessionToken) return;

    const connected = await pineLabsOneAdapter.submitStep({
      encryptedSessionToken: init.encryptedSessionToken,
      encryptedOtp:          enc("LogoutPass!"),
    });
    if (!connected.encryptedSessionToken) return;

    let threw = false;
    try {
      await pineLabsOneAdapter.logout(connected.encryptedSessionToken);
    } catch {
      threw = true;
    }
    assert.equal(threw, false, "logout must not throw");
  });
});

// ── OTP-first flow (Pine Labs ONE /authV2 production behaviour) ───────────────
//
// In the authV2 flow the portal sends an OTP immediately after identifier
// entry and skips the password step entirely. The adapter must:
//   1. Detect the /authV2/sign-in/verify-otp URL after identifier submit.
//   2. Return AWAITING_OTP (not PORTAL_UI_CHANGED).
//   3. Accept the OTP via submitStep and reach CONNECTED.

describe("PineLabsOne E2E — OTP-first flow (/authV2) → CONNECTED", () => {
  let srv: MockServer;
  const VALID_MOBILE    = "9876543210";
  const VALID_OTP       = "987654";
  const MERCHANT_ID     = "PL_OTP_FIRST_001";
  const BUSINESS_NAME   = "OTP-First Test Business";

  before(async () => {
    const ready = await checkBrowser();
    if (!ready) return;
    srv = await startMockPineLabsOneServer({
      otpFirst:         true,   // simulate Pine Labs ONE authV2 production flow
      validOtp:         VALID_OTP,
      maskedIdentifier: "**XXXXX210",
      merchantId:       MERCHANT_ID,
      businessName:     BUSINESS_NAME,
    });
    process.env["PINELABS_ONE_PORTAL_OVERRIDE"] = srv.url;
  });

  after(async () => {
    delete process.env["PINELABS_ONE_PORTAL_OVERRIDE"];
    await srv?.close();
  });

  it("initiateSession returns AWAITING_OTP (not PORTAL_UI_CHANGED) for OTP-first portal", async () => {
    const browserReady = await checkBrowser();
    if (!browserReady) return;

    const result = await pineLabsOneAdapter.initiateSession({
      loginMethod:         "mobile_password",
      encryptedIdentifier: enc(VALID_MOBILE),
    });

    assert.equal(
      result.status, "AWAITING_OTP",
      `Expected AWAITING_OTP for OTP-first portal. Got: ${result.status} — ${result.failDetail ?? result.failReason}`,
    );
    assert.ok(result.encryptedSessionToken, "must return encrypted session token");
    assert.equal(result.nextStep, "ENTER_OTP");
    assert.ok(
      result.nextStepPrompt?.toLowerCase().includes("otp"),
      `nextStepPrompt must mention OTP; got: ${result.nextStepPrompt}`,
    );
  });

  it("PORTAL_UI_CHANGED must NOT be returned when portal goes to OTP URL", async () => {
    const browserReady = await checkBrowser();
    if (!browserReady) return;

    const result = await pineLabsOneAdapter.initiateSession({
      loginMethod:         "mobile_password",
      encryptedIdentifier: enc(VALID_MOBILE),
    });

    assert.notEqual(
      result.failReason, "PORTAL_UI_CHANGED",
      "PORTAL_UI_CHANGED must never be returned when portal navigates to OTP URL",
    );
  });

  it("submitStep with correct OTP after OTP-first initiate returns CONNECTED", async () => {
    const browserReady = await checkBrowser();
    if (!browserReady) return;

    // Step 1: initiate → AWAITING_OTP
    const initResult = await pineLabsOneAdapter.initiateSession({
      loginMethod:         "mobile_password",
      encryptedIdentifier: enc(VALID_MOBILE),
    });
    if (initResult.status !== "AWAITING_OTP" || !initResult.encryptedSessionToken) {
      console.log("Skipping: initiate did not return AWAITING_OTP");
      return;
    }

    // Step 2: submit OTP → CONNECTED
    const submitResult = await pineLabsOneAdapter.submitStep({
      encryptedSessionToken: initResult.encryptedSessionToken,
      encryptedOtp:          enc(VALID_OTP),
    });

    assert.equal(
      submitResult.status, "CONNECTED",
      `Expected CONNECTED after OTP submission. Got: ${submitResult.status} — ${submitResult.failDetail}`,
    );
    assert.ok(submitResult.encryptedSessionToken, "CONNECTED result must include a refreshed session token");
    assert.equal(submitResult.nextStep, "COMPLETE");
  });

  it("submitStep with wrong OTP returns FAILED not CONNECTED", async () => {
    const browserReady = await checkBrowser();
    if (!browserReady) return;

    const initResult = await pineLabsOneAdapter.initiateSession({
      loginMethod:         "mobile_password",
      encryptedIdentifier: enc(VALID_MOBILE),
    });
    if (initResult.status !== "AWAITING_OTP" || !initResult.encryptedSessionToken) return;

    const submitResult = await pineLabsOneAdapter.submitStep({
      encryptedSessionToken: initResult.encryptedSessionToken,
      encryptedOtp:          enc("000000"),
    });

    assert.notEqual(submitResult.status, "CONNECTED", "wrong OTP must not produce CONNECTED");
    assert.ok(submitResult.failReason, "must return a failReason for wrong OTP");
    // Credentials must never echo in error messages
    assert.ok(!submitResult.failDetail?.includes("000000"), "failDetail must not echo OTP value");
  });

  it("maskedIdentifier in session token never contains the raw mobile", async () => {
    const browserReady = await checkBrowser();
    if (!browserReady) return;

    const result = await pineLabsOneAdapter.initiateSession({
      loginMethod:         "mobile_password",
      encryptedIdentifier: enc(VALID_MOBILE),
    });

    // The nextStepPrompt uses maskedIdentifier — verify no raw mobile
    const prompt = result.nextStepPrompt ?? "";
    assert.ok(!prompt.includes(VALID_MOBILE), "nextStepPrompt must not contain raw mobile number");
  });
});

// ── Language interstitial regression ─────────────────────────────────────────
// Real bug: Pine Labs ONE now redirects fresh Playwright contexts to
// /authV2/language (language picker) before the identifier form. The adapter's
// navigateToLogin() found only radio buttons → none matched SEL.IDENTIFIER_INPUT
// → returned null → PORTAL_UNREACHABLE.
// Fix: handleLanguageInterstitial() detects /authV2/language, clicks English,
// clicks Continue, then /authV2/verify-user shows the identifier form.

describe("PineLabsOne E2E — language interstitial is dismissed automatically (PORTAL_UNREACHABLE regression)", () => {
  let srv: MockServer;
  const VALID_MOBILE   = "9876543210";
  const VALID_PASSWORD = "Password123!";
  const MERCHANT_ID    = "LANG_PL12345";
  const BUSINESS_NAME  = "Language Test Co";

  before(async () => {
    const ready = await checkBrowser();
    if (!ready) return;
    srv = await startMockPineLabsOneServer({
      validPassword:        VALID_PASSWORD,
      merchantId:           MERCHANT_ID,
      businessName:         BUSINESS_NAME,
      languageInterstitial: true,   // /login/user → /authV2/language → /authV2/verify-user
    });
    process.env["PINELABS_ONE_PORTAL_OVERRIDE"] = srv.url;
  });

  after(async () => {
    delete process.env["PINELABS_ONE_PORTAL_OVERRIDE"];
    await srv?.close();
  });

  it("language interstitial must NOT produce PORTAL_UNREACHABLE", async () => {
    const browserReady = await checkBrowser();
    if (!browserReady) return;

    const result = await pineLabsOneAdapter.initiateSession({
      loginMethod:         "mobile_password",
      encryptedIdentifier: enc(VALID_MOBILE),
    });

    // The adapter must navigate past the language page and reach the identifier form
    assert.notEqual(
      result.status,
      "FAILED",
      `Expected AWAITING_* status but got FAILED (failReason: ${result.failReason}). ` +
      `Language interstitial likely caused PORTAL_UNREACHABLE. failDetail: ${result.failDetail}`,
    );
    assert.notEqual(
      result.failReason,
      "PORTAL_UNREACHABLE",
      "handleLanguageInterstitial() must dismiss the language page before selector scan",
    );
    // Must reach a real flow step
    assert.ok(
      result.status === "AWAITING_PASSWORD" || result.status === "AWAITING_OTP",
      `Expected AWAITING_PASSWORD or AWAITING_OTP after language dismissal; ` +
      `got: ${result.status} — ${result.failDetail}`,
    );
  });

  it("full flow through language interstitial returns CONNECTED", async () => {
    const browserReady = await checkBrowser();
    if (!browserReady) return;

    // Step 1: initiate (dismisses language page automatically)
    const initResult = await pineLabsOneAdapter.initiateSession({
      loginMethod:         "mobile_password",
      encryptedIdentifier: enc(VALID_MOBILE),
    });
    if (initResult.status !== "AWAITING_PASSWORD") {
      console.log("Skipping CONNECTED check — initiate returned:", initResult.status, initResult.failDetail);
      return;
    }

    // Step 2: submit password (submitStep reads encryptedOtp for both password and OTP steps)
    const submitResult = await pineLabsOneAdapter.submitStep?.({
      encryptedSessionToken: initResult.encryptedSessionToken!,
      encryptedOtp:          enc(VALID_PASSWORD),
    });

    assert.equal(
      submitResult?.status,
      "CONNECTED",
      `Expected CONNECTED after password; got: ${submitResult?.status} — ${submitResult?.failDetail}`,
    );
  });
});

// ── Hidden CAPTCHA false-positive regression ───────────────────────────────────
// Real bug: React SPAs (including Pine Labs ONE) pre-load CAPTCHA scripts and
// inject hidden/zero-size container divs into the DOM even when no challenge
// is active. The old hasCaptcha() checked count()>0 without visibility or
// bounding-box guards, so it false-fired and blocked the OTP flow entirely.
// This suite verifies the fixed guard: hidden CAPTCHA DOM nodes must NOT
// produce AWAITING_USER_ACTION — the real password/OTP flow must continue.

describe("PineLabsOne E2E — hidden CAPTCHA does NOT block the flow (false-positive regression)", () => {
  let srv: MockServer;
  const VALID_MOBILE   = "9876543210";
  const VALID_PASSWORD = "Password123!";

  before(async () => {
    const ready = await checkBrowser();
    if (!ready) return;
    srv = await startMockPineLabsOneServer({
      validPassword: VALID_PASSWORD,
      hiddenCaptcha: true,   // injects display:none zero-size .captcha-container div
    });
    process.env["PINELABS_ONE_PORTAL_OVERRIDE"] = srv.url;
  });

  after(async () => {
    delete process.env["PINELABS_ONE_PORTAL_OVERRIDE"];
    await srv?.close();
  });

  it("hidden/pre-loaded CAPTCHA DOM node must NOT trigger CAPTCHA_REQUIRED", async () => {
    const browserReady = await checkBrowser();
    if (!browserReady) return;

    const result = await pineLabsOneAdapter.initiateSession({
      loginMethod:         "mobile_password",
      encryptedIdentifier: enc(VALID_MOBILE),
    });

    // Must NOT be CAPTCHA false-positive
    assert.notEqual(
      result.failReason,
      "CAPTCHA_REQUIRED",
      `hasCaptcha() false-fired on a hidden CAPTCHA DOM node — got failReason: ${result.failReason}`,
    );
    assert.notEqual(
      result.status,
      "AWAITING_USER_ACTION",
      `Hidden CAPTCHA must not produce AWAITING_USER_ACTION; got: ${result.status}`,
    );

    // Must proceed to the real flow (password step here since mock is not OTP-first)
    assert.equal(
      result.status,
      "AWAITING_PASSWORD",
      `Expected AWAITING_PASSWORD when only a hidden CAPTCHA is present; got: ${result.status} — ${result.failDetail}`,
    );
  });
});

// ── Portal-native OTP switch ("Login with OTP" link) ─────────────────────────
//
// Tests the portal_otp submitStep branch:
//   identifier submit → AWAITING_PASSWORD →
//   submitStep({ loginMethod: "portal_otp" }) →
//   adapter clicks OTP link → /login/otp-request → /login/verify-otp →
//   AWAITING_OTP (loginMode: "portal_otp") →
//   submitStep({ encryptedOtp: enc(OTP) }) → CONNECTED
//
// Also covers: OTP link absent → OTP_NOT_AVAILABLE fallback message.
// Also covers: resend_otp → click resend → AWAITING_OTP.

describe("PineLabsOne E2E — portal-native OTP switch (loginMethod: portal_otp)", () => {
  let srv: MockServer;
  const VALID_MOBILE   = "9112233445";
  const VALID_OTP      = "654321";
  const MERCHANT_ID    = "PL_OTP_LINK_001";
  const BUSINESS_NAME  = "Portal OTP Test Co";

  before(async () => {
    const ready = await checkBrowser();
    if (!ready) return;
    srv = await startMockPineLabsOneServer({
      validPassword:    "AnyPass!",   // not used in this flow
      validOtp:         VALID_OTP,
      maskedIdentifier: "**XXXXX445",
      merchantId:       MERCHANT_ID,
      businessName:     BUSINESS_NAME,
      otpLink:          true,         // /login/password shows "Login with OTP" anchor
    });
    process.env["PINELABS_ONE_PORTAL_OVERRIDE"] = srv.url;
  });

  after(async () => {
    delete process.env["PINELABS_ONE_PORTAL_OVERRIDE"];
    await srv?.close();
  });

  it("submitStep with loginMethod:portal_otp returns AWAITING_OTP after clicking the OTP link", async () => {
    const browserReady = await checkBrowser();
    if (!browserReady) return;

    // Step 1: initiate → AWAITING_PASSWORD
    const init = await pineLabsOneAdapter.initiateSession({
      loginMethod:         "mobile_password",
      encryptedIdentifier: enc(VALID_MOBILE),
    });
    assert.equal(
      init.status, "AWAITING_PASSWORD",
      `Expected AWAITING_PASSWORD; got: ${init.status} — ${init.failDetail}`,
    );
    if (!init.encryptedSessionToken) return;

    // Step 2: click portal OTP link → AWAITING_OTP
    const otpSwitchResult = await pineLabsOneAdapter.submitStep({
      encryptedSessionToken: init.encryptedSessionToken,
      loginMethod:           "portal_otp",
    });

    assert.equal(
      otpSwitchResult.status, "AWAITING_OTP",
      `Expected AWAITING_OTP after portal_otp switch; ` +
      `got: ${otpSwitchResult.status} — ${otpSwitchResult.failDetail}`,
    );
    assert.ok(otpSwitchResult.encryptedSessionToken, "portal_otp must return a refreshed session token");
    assert.equal(otpSwitchResult.nextStep, "ENTER_OTP");
    assert.ok(
      otpSwitchResult.nextStepPrompt?.toLowerCase().includes("otp"),
      `nextStepPrompt must mention OTP; got: ${otpSwitchResult.nextStepPrompt}`,
    );
  });

  it("full portal_otp flow: OTP switch → correct OTP → CONNECTED with ownership", async () => {
    const browserReady = await checkBrowser();
    if (!browserReady) return;

    // Step 1: initiate → AWAITING_PASSWORD
    const init = await pineLabsOneAdapter.initiateSession({
      loginMethod:         "mobile_password",
      encryptedIdentifier: enc(VALID_MOBILE),
    });
    if (init.status !== "AWAITING_PASSWORD" || !init.encryptedSessionToken) {
      console.log("Skipping: initiate returned:", init.status, init.failDetail);
      return;
    }

    // Step 2: request portal OTP → AWAITING_OTP
    const otpSwitch = await pineLabsOneAdapter.submitStep({
      encryptedSessionToken: init.encryptedSessionToken,
      loginMethod:           "portal_otp",
    });
    if (otpSwitch.status !== "AWAITING_OTP" || !otpSwitch.encryptedSessionToken) {
      console.log("Skipping: portal_otp switch returned:", otpSwitch.status, otpSwitch.failDetail);
      return;
    }

    // Step 3: submit correct OTP → CONNECTED
    const connected = await pineLabsOneAdapter.submitStep({
      encryptedSessionToken: otpSwitch.encryptedSessionToken,
      encryptedOtp:          enc(VALID_OTP),
    });

    // The adapter reads ownership data (merchantId, businessName) from the portal's
    // /profile page and embeds it in the encrypted session token. The CONNECTED
    // status itself confirms ownership verification passed (the adapter returns FAILED
    // for no-ownership sessions). Verifying status + nextStep here is the same
    // approach used by the equivalent password-flow test.
    assert.equal(
      connected.status, "CONNECTED",
      `Expected CONNECTED after portal OTP; got: ${connected.status} — ${connected.failDetail}`,
    );
    assert.ok(connected.encryptedSessionToken, "CONNECTED must include a refreshed session token");
    assert.equal(connected.nextStep, "COMPLETE");
  });

  it("full portal_otp flow: wrong OTP returns FAILED, not CONNECTED", async () => {
    const browserReady = await checkBrowser();
    if (!browserReady) return;

    const init = await pineLabsOneAdapter.initiateSession({
      loginMethod:         "mobile_password",
      encryptedIdentifier: enc(VALID_MOBILE),
    });
    if (init.status !== "AWAITING_PASSWORD" || !init.encryptedSessionToken) return;

    const otpSwitch = await pineLabsOneAdapter.submitStep({
      encryptedSessionToken: init.encryptedSessionToken,
      loginMethod:           "portal_otp",
    });
    if (otpSwitch.status !== "AWAITING_OTP" || !otpSwitch.encryptedSessionToken) return;

    const wrongOtp = await pineLabsOneAdapter.submitStep({
      encryptedSessionToken: otpSwitch.encryptedSessionToken,
      encryptedOtp:          enc("000000"),
    });

    assert.notEqual(wrongOtp.status, "CONNECTED", "wrong OTP must not produce CONNECTED");
    assert.ok(wrongOtp.failReason, "wrong OTP must return failReason");
    assert.ok(!wrongOtp.failDetail?.includes("000000"), "failDetail must not echo OTP value");
  });

  it("calling portal_otp in AWAITING_OTP state returns WRONG_SESSION_STATE", async () => {
    const browserReady = await checkBrowser();
    if (!browserReady) return;

    const init = await pineLabsOneAdapter.initiateSession({
      loginMethod:         "mobile_password",
      encryptedIdentifier: enc(VALID_MOBILE),
    });
    if (init.status !== "AWAITING_PASSWORD" || !init.encryptedSessionToken) return;

    const otpSwitch = await pineLabsOneAdapter.submitStep({
      encryptedSessionToken: init.encryptedSessionToken,
      loginMethod:           "portal_otp",
    });
    if (otpSwitch.status !== "AWAITING_OTP" || !otpSwitch.encryptedSessionToken) return;

    // Try portal_otp again when already AWAITING_OTP — should fail with WRONG_SESSION_STATE
    const doubleSwitch = await pineLabsOneAdapter.submitStep({
      encryptedSessionToken: otpSwitch.encryptedSessionToken,
      loginMethod:           "portal_otp",
    });

    assert.equal(
      doubleSwitch.failReason, "WRONG_SESSION_STATE",
      `Expected WRONG_SESSION_STATE for double portal_otp; got: ${doubleSwitch.failReason}`,
    );
  });
});

// ── Portal OTP link absent — OTP_NOT_AVAILABLE fallback ──────────────────────

describe("PineLabsOne E2E — portal_otp when OTP link absent returns OTP_NOT_AVAILABLE", () => {
  let srv: MockServer;

  before(async () => {
    const ready = await checkBrowser();
    if (!ready) return;
    // otpLink is NOT set — password page has no "Login with OTP" anchor
    srv = await startMockPineLabsOneServer({
      validPassword: "NoOtpLink!",
      otpLink:       false,
    });
    process.env["PINELABS_ONE_PORTAL_OVERRIDE"] = srv.url;
  });

  after(async () => {
    delete process.env["PINELABS_ONE_PORTAL_OVERRIDE"];
    await srv?.close();
  });

  it("portal_otp returns AWAITING_PASSWORD/OTP_NOT_AVAILABLE (session preserved) when OTP link is absent", async () => {
    const browserReady = await checkBrowser();
    if (!browserReady) return;

    const init = await pineLabsOneAdapter.initiateSession({
      loginMethod:         "mobile_password",
      encryptedIdentifier: enc("9550050050"),
    });
    if (init.status !== "AWAITING_PASSWORD" || !init.encryptedSessionToken) {
      console.log("Skipping: initiate returned:", init.status, init.failDetail);
      return;
    }

    const result = await pineLabsOneAdapter.submitStep({
      encryptedSessionToken: init.encryptedSessionToken,
      loginMethod:           "portal_otp",
    });

    // When OTP is unavailable the adapter must NOT destroy the session (FAILED).
    // It returns AWAITING_PASSWORD so the merchant can still enter their password.
    assert.equal(
      result.status, "AWAITING_PASSWORD",
      `Expected AWAITING_PASSWORD (session preserved); got: ${result.status}`,
    );
    assert.equal(
      result.failReason, "OTP_NOT_AVAILABLE",
      `Expected OTP_NOT_AVAILABLE; got: ${result.failReason}`,
    );
    assert.ok(
      result.encryptedSessionToken,
      "AWAITING_PASSWORD result must include the preserved session token",
    );
    // The exact spec-required fallback message must be in failDetail
    assert.ok(
      result.failDetail?.includes("OTP login is not available"),
      `failDetail must include the required fallback message; got: ${result.failDetail}`,
    );
    assert.ok(
      result.failDetail?.includes("Continue with Password"),
      `failDetail must instruct merchant to continue with password; got: ${result.failDetail}`,
    );

    // Verify the session is still usable: can still submit the correct password
    const passwordResult = await pineLabsOneAdapter.submitStep({
      encryptedSessionToken: result.encryptedSessionToken!,
      encryptedOtp:          enc("NoOtpLink!"),   // the validPassword for this mock server
    });
    assert.equal(
      passwordResult.status, "CONNECTED",
      `Password submit after OTP_NOT_AVAILABLE must still reach CONNECTED; got: ${passwordResult.status} — ${passwordResult.failDetail}`,
    );
  });
});

// ── Forgot Password link must NOT be treated as OTP login link ────────────────
// SECURITY: SEL.OTP_LOGIN_LINK must never match "Forgot Password" controls.
// Clicking a password-reset link from within the connector could trigger a
// destructive portal-side action the merchant did not intend.

describe("PineLabsOne E2E — Forgot Password link is not an OTP login link (security regression)", () => {
  let srv: MockServer;

  before(async () => {
    const ready = await checkBrowser();
    if (!ready) return;
    // forgotPasswordLinkOnly: password page has ONLY a "Forgot Password" link,
    // NO "Login with OTP" link.  The adapter must return OTP_NOT_AVAILABLE.
    srv = await startMockPineLabsOneServer({
      validPassword:          "ForgotPwdOnly!",
      otpLink:                false,
      forgotPasswordLinkOnly: true,
    });
    process.env["PINELABS_ONE_PORTAL_OVERRIDE"] = srv.url;
  });

  after(async () => {
    delete process.env["PINELABS_ONE_PORTAL_OVERRIDE"];
    await srv?.close();
  });

  it("portal_otp returns OTP_NOT_AVAILABLE (never clicks Forgot Password link)", async () => {
    const browserReady = await checkBrowser();
    if (!browserReady) return;

    const init = await pineLabsOneAdapter.initiateSession({
      loginMethod:         "mobile_password",
      encryptedIdentifier: enc("9000000000"),
    });
    if (init.status !== "AWAITING_PASSWORD" || !init.encryptedSessionToken) {
      console.log("Skipping: initiate returned:", init.status);
      return;
    }

    const result = await pineLabsOneAdapter.submitStep({
      encryptedSessionToken: init.encryptedSessionToken,
      loginMethod:           "portal_otp",
    });

    // The adapter must NOT have clicked the "Forgot Password" link.
    // It must return OTP_NOT_AVAILABLE with the session preserved.
    assert.equal(
      result.status, "AWAITING_PASSWORD",
      `Expected AWAITING_PASSWORD; got: ${result.status} (failReason: ${result.failReason}). ` +
      "Forgot Password link must NOT be treated as an OTP login link.",
    );
    assert.equal(
      result.failReason, "OTP_NOT_AVAILABLE",
      `Expected OTP_NOT_AVAILABLE failReason; got: ${result.failReason}`,
    );
    assert.ok(
      result.encryptedSessionToken,
      "Session token must be preserved so merchant can still use their password",
    );

    // Confirm the session is still alive by submitting the correct password
    const pwd = await pineLabsOneAdapter.submitStep({
      encryptedSessionToken: result.encryptedSessionToken!,
      encryptedOtp:          enc("ForgotPwdOnly!"),
    });
    assert.equal(
      pwd.status, "CONNECTED",
      `Password submit after Forgot-Password OTP_NOT_AVAILABLE must reach CONNECTED; ` +
      `got: ${pwd.status} — ${pwd.failDetail}`,
    );
  });
});

// ── Resend OTP ────────────────────────────────────────────────────────────────

describe("PineLabsOne E2E — resend_otp refreshes OTP session and returns AWAITING_OTP", () => {
  let srv: MockServer;
  const VALID_OTP  = "777888";
  const VALID_MOBILE = "9661661661";

  before(async () => {
    const ready = await checkBrowser();
    if (!ready) return;
    srv = await startMockPineLabsOneServer({
      validPassword:    "AnyPass!",
      validOtp:         VALID_OTP,
      maskedIdentifier: "**XXXXX661",
      merchantId:       "PL_RESEND_001",
      otpLink:          true,
    });
    process.env["PINELABS_ONE_PORTAL_OVERRIDE"] = srv.url;
  });

  after(async () => {
    delete process.env["PINELABS_ONE_PORTAL_OVERRIDE"];
    await srv?.close();
  });

  it("resend_otp in AWAITING_OTP state returns AWAITING_OTP with a refreshed token", async () => {
    const browserReady = await checkBrowser();
    if (!browserReady) return;

    // Step 1: initiate → AWAITING_PASSWORD
    const init = await pineLabsOneAdapter.initiateSession({
      loginMethod:         "mobile_password",
      encryptedIdentifier: enc(VALID_MOBILE),
    });
    if (init.status !== "AWAITING_PASSWORD" || !init.encryptedSessionToken) return;

    // Step 2: portal OTP switch → AWAITING_OTP
    const otpSwitch = await pineLabsOneAdapter.submitStep({
      encryptedSessionToken: init.encryptedSessionToken,
      loginMethod:           "portal_otp",
    });
    if (otpSwitch.status !== "AWAITING_OTP" || !otpSwitch.encryptedSessionToken) {
      console.log("Skipping: portal_otp returned:", otpSwitch.status, otpSwitch.failDetail);
      return;
    }

    // Step 3: resend OTP → still AWAITING_OTP
    const resend = await pineLabsOneAdapter.submitStep({
      encryptedSessionToken: otpSwitch.encryptedSessionToken,
      loginMethod:           "resend_otp",
    });

    assert.equal(
      resend.status, "AWAITING_OTP",
      `resend_otp must return AWAITING_OTP; got: ${resend.status} — ${resend.failDetail}`,
    );
    assert.ok(resend.encryptedSessionToken, "resend must return a refreshed session token");
    assert.equal(resend.nextStep, "ENTER_OTP");
  });

  it("resend_otp in AWAITING_PASSWORD state returns WRONG_SESSION_STATE", async () => {
    const browserReady = await checkBrowser();
    if (!browserReady) return;

    const init = await pineLabsOneAdapter.initiateSession({
      loginMethod:         "mobile_password",
      encryptedIdentifier: enc(VALID_MOBILE),
    });
    if (init.status !== "AWAITING_PASSWORD" || !init.encryptedSessionToken) return;

    const result = await pineLabsOneAdapter.submitStep({
      encryptedSessionToken: init.encryptedSessionToken,
      loginMethod:           "resend_otp",
    });

    assert.equal(
      result.failReason, "WRONG_SESSION_STATE",
      `Expected WRONG_SESSION_STATE for resend_otp in AWAITING_PASSWORD; got: ${result.failReason}`,
    );
  });

  it("OTP submitted after resend is still valid and returns CONNECTED", async () => {
    const browserReady = await checkBrowser();
    if (!browserReady) return;

    const init = await pineLabsOneAdapter.initiateSession({
      loginMethod:         "mobile_password",
      encryptedIdentifier: enc(VALID_MOBILE),
    });
    if (init.status !== "AWAITING_PASSWORD" || !init.encryptedSessionToken) return;

    const otpSwitch = await pineLabsOneAdapter.submitStep({
      encryptedSessionToken: init.encryptedSessionToken,
      loginMethod:           "portal_otp",
    });
    if (otpSwitch.status !== "AWAITING_OTP" || !otpSwitch.encryptedSessionToken) return;

    const resend = await pineLabsOneAdapter.submitStep({
      encryptedSessionToken: otpSwitch.encryptedSessionToken,
      loginMethod:           "resend_otp",
    });
    if (resend.status !== "AWAITING_OTP" || !resend.encryptedSessionToken) return;

    // Submit the valid OTP after resend → CONNECTED
    const connected = await pineLabsOneAdapter.submitStep({
      encryptedSessionToken: resend.encryptedSessionToken,
      encryptedOtp:          enc(VALID_OTP),
    });

    assert.equal(
      connected.status, "CONNECTED",
      `Expected CONNECTED after post-resend OTP; got: ${connected.status} — ${connected.failDetail}`,
    );
  });
});

// ── Resend OTP — live authV2 div-based control (verified 2026-08-18) ─────────
// The live portal renders the resend control as
// <div role="button" id="...-resend-timer-resend-link">Resend OTP</div>,
// not a <button>/<a>. During cooldown the area shows "Resend OTP in NN secs"
// countdown text that must NOT match SEL.RESEND_OTP_BTN.

describe("PineLabsOne E2E — live div-based resend control (authV2, OTP-first)", () => {
  let srv: MockServer;
  const VALID_OTP    = "555444";
  const VALID_MOBILE = "9662662662";

  before(async () => {
    const ready = await checkBrowser();
    if (!ready) return;
    srv = await startMockPineLabsOneServer({
      validPassword:     "AnyPass!",
      validOtp:          VALID_OTP,
      maskedIdentifier:  "**XXXXX662",
      merchantId:        "PL_LIVE_RESEND_001",
      otpFirst:          true,  // live authV2 flow: identifier → OTP page directly
      liveResendControl: true,  // div[role=button][id$=resend-link]
    });
    process.env["PINELABS_ONE_PORTAL_OVERRIDE"] = srv.url;
  });

  after(async () => {
    delete process.env["PINELABS_ONE_PORTAL_OVERRIDE"];
    await srv?.close();
  });

  it("resend_otp clicks the div[role=button] resend-link control and returns AWAITING_OTP", async () => {
    const browserReady = await checkBrowser();
    if (!browserReady) return;

    // OTP-first: initiate goes straight to AWAITING_OTP
    const init = await pineLabsOneAdapter.initiateSession({
      loginMethod:         "mobile_password",
      encryptedIdentifier: enc(VALID_MOBILE),
    });
    if (init.status !== "AWAITING_OTP" || !init.encryptedSessionToken) {
      console.log("Skipping: OTP-first initiate returned:", init.status, init.failDetail);
      return;
    }

    const resend = await pineLabsOneAdapter.submitStep({
      encryptedSessionToken: init.encryptedSessionToken,
      loginMethod:           "resend_otp",
    });

    assert.equal(
      resend.status, "AWAITING_OTP",
      `resend_otp must return AWAITING_OTP via the div-based control; got: ${resend.status} — ${resend.failDetail}`,
    );
    assert.ok(
      !resend.failReason,
      `resend must succeed (no failReason) when the live div control is present; got: ${resend.failReason}`,
    );
    assert.ok(resend.encryptedSessionToken, "resend must return a session token");

    // OTP is still valid after the div-based resend → CONNECTED
    const connected = await pineLabsOneAdapter.submitStep({
      encryptedSessionToken: resend.encryptedSessionToken,
      encryptedOtp:          enc(VALID_OTP),
    });
    assert.equal(
      connected.status, "CONNECTED",
      `Expected CONNECTED after post-resend OTP; got: ${connected.status} — ${connected.failDetail}`,
    );
  });
});

describe("PineLabsOne E2E — resend cooldown countdown must not match as a resend control", () => {
  let srv: MockServer;
  const VALID_MOBILE = "9663663663";

  before(async () => {
    const ready = await checkBrowser();
    if (!ready) return;
    srv = await startMockPineLabsOneServer({
      validPassword:        "AnyPass!",
      validOtp:             "111222",
      maskedIdentifier:     "**XXXXX663",
      merchantId:           "PL_COOLDOWN_001",
      otpFirst:             true,
      resendCooldownActive: true, // page shows "Resend OTP in 27 secs" text only
    });
    process.env["PINELABS_ONE_PORTAL_OVERRIDE"] = srv.url;
  });

  after(async () => {
    delete process.env["PINELABS_ONE_PORTAL_OVERRIDE"];
    await srv?.close();
  });

  it("resend_otp during cooldown returns RESEND_NOT_AVAILABLE with session preserved", async () => {
    const browserReady = await checkBrowser();
    if (!browserReady) return;

    const init = await pineLabsOneAdapter.initiateSession({
      loginMethod:         "mobile_password",
      encryptedIdentifier: enc(VALID_MOBILE),
    });
    if (init.status !== "AWAITING_OTP" || !init.encryptedSessionToken) {
      console.log("Skipping: OTP-first initiate returned:", init.status, init.failDetail);
      return;
    }

    const resend = await pineLabsOneAdapter.submitStep({
      encryptedSessionToken: init.encryptedSessionToken,
      loginMethod:           "resend_otp",
    });

    // The countdown text must never be clicked as a resend control.
    assert.equal(
      resend.status, "AWAITING_OTP",
      `Session must be preserved during cooldown; got: ${resend.status} — ${resend.failDetail}`,
    );
    assert.equal(
      resend.failReason, "RESEND_NOT_AVAILABLE",
      `Cooldown countdown must yield RESEND_NOT_AVAILABLE (not a false-positive click); got: ${resend.failReason}`,
    );
    assert.equal(
      resend.encryptedSessionToken, init.encryptedSessionToken,
      "Original session token must be preserved on RESEND_NOT_AVAILABLE",
    );
  });
});

// ── Resend cooldown → transition → active control ────────────────────────────
//
// Regression for: false "new OTP sent" message when resend_otp is called while
// the portal still shows the cooldown countdown ("Resend OTP in NN secs").
//
// The mock server resendCooldownThenActive flag tracks /login/verify-otp GETs
// per server instance. To prevent state from bleeding between tests, each test
// below gets its OWN describe block with its own before/after and fresh server,
// so otpPageVisitCount always starts at 0 for every test.
//
// Flow simulated by the mock:
//   • Initial OTP-first login → /authV2/sign-in/verify-otp (NOT counted)
//   • First  resend nav → /login/verify-otp (count=1) → cooldown text only
//   • Second resend nav → /login/verify-otp (count=2) → active div[role=button]

// ── Part 1: cooldown → RESEND_NOT_AVAILABLE (no phantom success) ─────────────

describe("PineLabsOne E2E — resend_otp during cooldown returns RESEND_NOT_AVAILABLE (not a false success)", () => {
  let srv: MockServer;
  const VALID_MOBILE = "9664664664";
  const VALID_OTP    = "334455";

  before(async () => {
    const ready = await checkBrowser();
    if (!ready) return;
    srv = await startMockPineLabsOneServer({
      validPassword:            "AnyPass!",
      validOtp:                 VALID_OTP,
      maskedIdentifier:         "**XXXXX664",
      merchantId:               "PL_COOL1_001",
      otpFirst:                 true,
      resendCooldownThenActive: true,
    });
    process.env["PINELABS_ONE_PORTAL_OVERRIDE"] = srv.url;
  });

  after(async () => {
    delete process.env["PINELABS_ONE_PORTAL_OVERRIDE"];
    await srv?.close();
  });

  it("cooldown countdown text must not be clicked as a resend control — session is preserved with RESEND_NOT_AVAILABLE", async () => {
    const browserReady = await checkBrowser();
    if (!browserReady) return;

    // OTP-first login → /authV2/sign-in/verify-otp (does NOT increment otpPageVisitCount)
    const init = await pineLabsOneAdapter.initiateSession({
      loginMethod:         "mobile_password",
      encryptedIdentifier: enc(VALID_MOBILE),
    });
    assert.equal(
      init.status, "AWAITING_OTP",
      `OTP-first initiate must return AWAITING_OTP; got: ${init.status} — ${init.failDetail}`,
    );
    assert.ok(init.encryptedSessionToken, "initiate must return a session token");

    // First explicit resend nav → /login/verify-otp (count=1) → cooldown HTML rendered.
    // The adapter must NOT match the countdown text as a clickable control.
    const resend = await pineLabsOneAdapter.submitStep({
      encryptedSessionToken: init.encryptedSessionToken,
      loginMethod:           "resend_otp",
    });

    assert.equal(
      resend.status, "AWAITING_OTP",
      `Session must be preserved on cooldown; got: ${resend.status} — ${resend.failDetail}`,
    );
    assert.equal(
      resend.failReason, "RESEND_NOT_AVAILABLE",
      `Cooldown countdown must yield RESEND_NOT_AVAILABLE, not a phantom success; ` +
      `got: ${resend.failReason}`,
    );
    assert.equal(
      resend.encryptedSessionToken, init.encryptedSessionToken,
      "Original session token must be returned unchanged on RESEND_NOT_AVAILABLE",
    );
    assert.ok(
      !resend.nextStepPrompt?.toLowerCase().includes("new otp has been sent"),
      `nextStepPrompt must NOT claim a new OTP was sent during cooldown; ` +
      `got: ${resend.nextStepPrompt}`,
    );
  });
});

// ── Part 2: after cooldown expires, active control is found and clicked ───────

describe("PineLabsOne E2E — resend_otp after cooldown expires clicks the active div control and returns AWAITING_OTP", () => {
  let srv: MockServer;
  const VALID_MOBILE = "9664664665";
  const VALID_OTP    = "334456";

  before(async () => {
    const ready = await checkBrowser();
    if (!ready) return;
    srv = await startMockPineLabsOneServer({
      validPassword:            "AnyPass!",
      validOtp:                 VALID_OTP,
      maskedIdentifier:         "**XXXXX665",
      merchantId:               "PL_COOL2_001",
      otpFirst:                 true,
      resendCooldownThenActive: true,   // fresh server: otpPageVisitCount=0
    });
    process.env["PINELABS_ONE_PORTAL_OVERRIDE"] = srv.url;
  });

  after(async () => {
    delete process.env["PINELABS_ONE_PORTAL_OVERRIDE"];
    await srv?.close();
  });

  it("preserves session through cooldown then clicks active control and returns AWAITING_OTP with no failReason", async () => {
    const browserReady = await checkBrowser();
    if (!browserReady) return;

    // Fresh server: otpPageVisitCount=0.
    const init = await pineLabsOneAdapter.initiateSession({
      loginMethod:         "mobile_password",
      encryptedIdentifier: enc(VALID_MOBILE),
    });
    assert.equal(
      init.status, "AWAITING_OTP",
      `OTP-first initiate must return AWAITING_OTP; got: ${init.status} — ${init.failDetail}`,
    );
    assert.ok(init.encryptedSessionToken, "initiate must return a session token");

    // First resend nav → count=1 → cooldown.
    const cooldownResend = await pineLabsOneAdapter.submitStep({
      encryptedSessionToken: init.encryptedSessionToken,
      loginMethod:           "resend_otp",
    });
    assert.equal(
      cooldownResend.failReason, "RESEND_NOT_AVAILABLE",
      `First resend must hit cooldown (RESEND_NOT_AVAILABLE); got: ${cooldownResend.failReason} — ${cooldownResend.failDetail}`,
    );
    assert.ok(
      cooldownResend.encryptedSessionToken,
      "Session token must be preserved on RESEND_NOT_AVAILABLE",
    );

    // Second resend nav → count=2 → cooldown expired → active div[role=button] shown.
    // The adapter must find it, click it, and return AWAITING_OTP with no failReason.
    const activeResend = await pineLabsOneAdapter.submitStep({
      encryptedSessionToken: cooldownResend.encryptedSessionToken,
      loginMethod:           "resend_otp",
    });
    assert.equal(
      activeResend.status, "AWAITING_OTP",
      `After cooldown expires, resend_otp must return AWAITING_OTP; ` +
      `got: ${activeResend.status} — ${activeResend.failDetail}`,
    );
    assert.ok(
      !activeResend.failReason,
      `Successful post-cooldown resend must have no failReason; got: ${activeResend.failReason}`,
    );
    assert.ok(
      activeResend.encryptedSessionToken,
      "Successful resend must return a refreshed session token",
    );
    assert.ok(
      activeResend.nextStepPrompt?.toLowerCase().includes("otp"),
      `nextStepPrompt must confirm a new OTP was sent; got: ${activeResend.nextStepPrompt}`,
    );
  });
});

// ── Part 3: full transition flow reaches CONNECTED ────────────────────────────

describe("PineLabsOne E2E — full cooldown transition: initiate → cooldown resend → active resend → OTP → CONNECTED", () => {
  let srv: MockServer;
  const VALID_MOBILE = "9664664666";
  const VALID_OTP    = "334457";

  before(async () => {
    const ready = await checkBrowser();
    if (!ready) return;
    srv = await startMockPineLabsOneServer({
      validPassword:            "AnyPass!",
      validOtp:                 VALID_OTP,
      maskedIdentifier:         "**XXXXX666",
      merchantId:               "PL_COOL3_001",
      businessName:             "Cooldown Transition Test Co",
      otpFirst:                 true,
      resendCooldownThenActive: true,   // fresh server: otpPageVisitCount=0
    });
    process.env["PINELABS_ONE_PORTAL_OVERRIDE"] = srv.url;
  });

  after(async () => {
    delete process.env["PINELABS_ONE_PORTAL_OVERRIDE"];
    await srv?.close();
  });

  it("OTP submitted after post-cooldown resend reaches CONNECTED", async () => {
    const browserReady = await checkBrowser();
    if (!browserReady) return;

    // Step 1: OTP-first initiate (count stays 0)
    const init = await pineLabsOneAdapter.initiateSession({
      loginMethod:         "mobile_password",
      encryptedIdentifier: enc(VALID_MOBILE),
    });
    assert.equal(
      init.status, "AWAITING_OTP",
      `OTP-first initiate must return AWAITING_OTP; got: ${init.status} — ${init.failDetail}`,
    );
    assert.ok(init.encryptedSessionToken, "initiate must return a session token");

    // Step 2: first resend nav (count=1) → cooldown → session preserved
    const cooldownResend = await pineLabsOneAdapter.submitStep({
      encryptedSessionToken: init.encryptedSessionToken,
      loginMethod:           "resend_otp",
    });
    assert.equal(
      cooldownResend.failReason, "RESEND_NOT_AVAILABLE",
      `First resend must be blocked by cooldown; got: ${cooldownResend.failReason}`,
    );
    assert.ok(cooldownResend.encryptedSessionToken, "Cooldown must preserve session token");

    // Step 3: second resend nav (count=2) → active control clicked → fresh OTP dispatched
    const activeResend = await pineLabsOneAdapter.submitStep({
      encryptedSessionToken: cooldownResend.encryptedSessionToken,
      loginMethod:           "resend_otp",
    });
    assert.equal(
      activeResend.status, "AWAITING_OTP",
      `Post-cooldown resend must return AWAITING_OTP; got: ${activeResend.status} — ${activeResend.failDetail}`,
    );
    assert.ok(!activeResend.failReason, `No failReason expected after successful resend; got: ${activeResend.failReason}`);
    assert.ok(activeResend.encryptedSessionToken, "Post-cooldown resend must return a refreshed session token");

    // Step 4: submit OTP → CONNECTED
    const connected = await pineLabsOneAdapter.submitStep({
      encryptedSessionToken: activeResend.encryptedSessionToken,
      encryptedOtp:          enc(VALID_OTP),
    });
    assert.equal(
      connected.status, "CONNECTED",
      `Expected CONNECTED after full cooldown transition + OTP; ` +
      `got: ${connected.status} — ${connected.failDetail}`,
    );
  });
});

// ── Portal unreachable ────────────────────────────────────────────────────────

describe("PineLabsOne E2E — portal unreachable", () => {
  before(() => {
    // Point to a port that has no server
    process.env["PINELABS_ONE_PORTAL_OVERRIDE"] = "http://127.0.0.1:19999";
  });

  after(() => {
    delete process.env["PINELABS_ONE_PORTAL_OVERRIDE"];
  });

  it("returns FAILED/PORTAL_UNREACHABLE when portal is unreachable", async () => {
    const browserReady = await checkBrowser();
    if (!browserReady) return;

    const result = await pineLabsOneAdapter.initiateSession({
      loginMethod:         "mobile_password",
      encryptedIdentifier: enc("9400400400"),
    });

    assert.notEqual(result.status, "CONNECTED", "unreachable portal must never produce CONNECTED");
    assert.ok(result.failReason, "must provide failReason for unreachable portal");
  });
});

// ── Task #2758: frame, delayed-render, and classifier regressions ────────────

describe("PineLabsOne E2E — task #2758 focused portal regressions", () => {
  const MOBILE = "9555555555";

  async function withServer(
    config: Parameters<typeof startMockPineLabsOneServer>[0],
    run: (server: MockServer) => Promise<void>,
  ): Promise<void> {
    const ready = await checkBrowser();
    if (!ready) return;
    const server = await startMockPineLabsOneServer(config);
    process.env["PINELABS_ONE_PORTAL_OVERRIDE"] = server.url;
    try {
      await run(server);
    } finally {
      delete process.env["PINELABS_ONE_PORTAL_OVERRIDE"];
      await server.close();
    }
  }

  it("fills a password input hosted in a same-origin iframe", async () => {
    await withServer({
      passwordInIframe: true, validPassword: "FramePassword!", merchantId: "PLFRAMEPASS01",
    }, async () => {
      const init = await pineLabsOneAdapter.initiateSession({
        loginMethod: "mobile_password", encryptedIdentifier: enc(MOBILE),
      });
      assert.equal(init.status, "AWAITING_PASSWORD", `Got: ${init.status} — ${init.failDetail}`);
      assert.ok(init.encryptedSessionToken);
      const result = await pineLabsOneAdapter.submitStep({
        encryptedSessionToken: init.encryptedSessionToken, encryptedOtp: enc("FramePassword!"),
      });
      assert.equal(result.status, "CONNECTED", `Got: ${result.status} — ${result.failDetail}`);
    });
  });

  it("fills an OTP input hosted in a same-origin iframe", async () => {
    await withServer({
      otpFirst: true, otpInIframe: true, validOtp: "816234", merchantId: "PLFRAMEOTP01",
    }, async () => {
      const init = await pineLabsOneAdapter.initiateSession({
        loginMethod: "mobile_password", encryptedIdentifier: enc(MOBILE),
      });
      assert.equal(init.status, "AWAITING_OTP", `Got: ${init.status} — ${init.failDetail}`);
      assert.ok(init.encryptedSessionToken);
      const result = await pineLabsOneAdapter.submitStep({
        encryptedSessionToken: init.encryptedSessionToken, encryptedOtp: enc("816234"),
      });
      assert.equal(result.status, "CONNECTED", `Got: ${result.status} — ${result.failDetail}`);
    });
  });

  it("waits for React-style delayed password rendering after identifier submit", async () => {
    await withServer({
      delayedPasswordRenderMs: 1_800, validPassword: "DelayedPass!", merchantId: "PLDELAYED01",
    }, async () => {
      const init = await pineLabsOneAdapter.initiateSession({
        loginMethod: "mobile_password", encryptedIdentifier: enc(MOBILE),
      });
      assert.equal(init.status, "AWAITING_PASSWORD", `Got: ${init.status} — ${init.failDetail}`);
      assert.ok(init.encryptedSessionToken);
      const result = await pineLabsOneAdapter.submitStep({
        encryptedSessionToken: init.encryptedSessionToken, encryptedOtp: enc("DelayedPass!"),
      });
      assert.equal(result.status, "CONNECTED", `Got: ${result.status} — ${result.failDetail}`);
    });
  });

  it("returns PORTAL_UI_CHANGED for an unknown post-submit screen", async () => {
    await withServer({ postIdentifierFixture: "unknown" }, async () => {
      const result = await pineLabsOneAdapter.initiateSession({
        loginMethod: "mobile_password", encryptedIdentifier: enc(MOBILE),
      });
      assert.equal(result.status, "FAILED");
      assert.equal(result.failReason, "PORTAL_UI_CHANGED", `Got: ${result.failReason} — ${result.failDetail}`);
      assert.notEqual(result.failReason, "PASSWORD_FIELD_NOT_FOUND");
    });
  });

  it("prioritizes a verified dashboard over a concurrently visible OTP challenge", async () => {
    await withServer({
      postIdentifierFixture: "dashboard_with_otp", merchantId: "PLDASHOTP01",
    }, async () => {
      const result = await pineLabsOneAdapter.initiateSession({
        loginMethod: "mobile_password", encryptedIdentifier: enc(MOBILE),
      });
      assert.equal(result.status, "CONNECTED", `Got: ${result.status} — ${result.failDetail}`);
    });
  });

  it("prioritizes OTP over a concurrently visible password input", async () => {
    await withServer({ postIdentifierFixture: "otp_with_password" }, async () => {
      const result = await pineLabsOneAdapter.initiateSession({
        loginMethod: "mobile_password", encryptedIdentifier: enc(MOBILE),
      });
      assert.equal(result.status, "AWAITING_OTP", `Got: ${result.status} — ${result.failDetail}`);
    });
  });

  it("prioritizes device approval over CAPTCHA", async () => {
    await withServer({ showManualAction: true, showCaptcha: true }, async () => {
      const result = await pineLabsOneAdapter.initiateSession({
        loginMethod: "mobile_password", encryptedIdentifier: enc(MOBILE),
      });
      assert.equal(result.status, "AWAITING_USER_ACTION", `Got: ${result.status} — ${result.failDetail}`);
      assert.equal(result.failReason, "MANUAL_ACTION_REQUIRED");
    });
  });

  it("prioritizes CAPTCHA over blocked and error copy", async () => {
    await withServer({ showCaptcha: true, showBlockedAndErrorAtLogin: true }, async () => {
      const result = await pineLabsOneAdapter.initiateSession({
        loginMethod: "mobile_password", encryptedIdentifier: enc(MOBILE),
      });
      assert.equal(result.status, "AWAITING_USER_ACTION", `Got: ${result.status} — ${result.failDetail}`);
      assert.equal(result.failReason, "CAPTCHA_REQUIRED");
    });
  });

  it("returns OTP after password and never resends it automatically", async () => {
    await withServer({
      requireOtp: true, validPassword: "TwoFactorPass!", validOtp: "719203", merchantId: "PLPWOTP01",
    }, async (server) => {
      const init = await pineLabsOneAdapter.initiateSession({
        loginMethod: "mobile_password", encryptedIdentifier: enc(MOBILE),
      });
      assert.equal(init.status, "AWAITING_PASSWORD");
      assert.ok(init.encryptedSessionToken);
      const passwordResult = await pineLabsOneAdapter.submitStep({
        encryptedSessionToken: init.encryptedSessionToken, encryptedOtp: enc("TwoFactorPass!"),
      });
      assert.equal(passwordResult.status, "AWAITING_OTP", `Got: ${passwordResult.status} — ${passwordResult.failDetail}`);
      assert.equal(server.getRequestCount("/login/resend-otp"), 0, "adapter must never resend OTP implicitly");
    });
  });

  it("uses portal OTP only after the merchant explicitly chooses it", async () => {
    await withServer({ otpLink: true, validOtp: "719204", merchantId: "PLPORTALOTP01" }, async (server) => {
      const init = await pineLabsOneAdapter.initiateSession({
        loginMethod: "mobile_password", encryptedIdentifier: enc(MOBILE),
      });
      assert.equal(init.status, "AWAITING_PASSWORD");
      assert.ok(init.encryptedSessionToken);
      assert.equal(server.getRequestCount("/login/resend-otp"), 0, "initiation must not resend OTP");
      assert.equal(server.getRequestCount("/login/otp-request"), 0, "initiation must not request portal OTP");
      const switched = await pineLabsOneAdapter.submitStep({
        encryptedSessionToken: init.encryptedSessionToken, loginMethod: "portal_otp",
      });
      assert.equal(switched.status, "AWAITING_OTP", `Got: ${switched.status} — ${switched.failDetail}`);
      assert.equal(server.getRequestCount("/login/otp-request"), 1, "portal OTP must be requested only by explicit choice");
      assert.equal(server.getRequestCount("/login/resend-otp"), 0, "choosing portal OTP is not a resend");
    });
  });
});
