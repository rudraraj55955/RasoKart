/**
 * Pine Labs ONE adapter — structural integrity and fail-closed tests.
 *
 * Verifies:
 *   1. Structural properties (slug, adapterKind, loginMethods, interface completeness)
 *   2. Fail-closed: CONNECTED is NEVER returned for invalid inputs
 *   3. No exceptions thrown for invalid/empty tokens
 *   4. Secret-leakage prevention: errors never contain raw credentials
 *
 * These tests do NOT launch a real browser — they verify the adapter's
 * pre-flight validation logic before any browser call is attempted.
 *
 * Real browser automation is exercised in pinelabs-one.e2e.test.ts via the
 * mock server.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pineLabsOneAdapter } from "./pinelabs-one.js";

// ── Structural integrity ───────────────────────────────────────────────────────

describe("PineLabsOne adapter — structure", () => {
  it("has slug 'pinelabs_one'", () => {
    assert.equal(pineLabsOneAdapter.slug, "pinelabs_one");
  });

  it("has adapterKind 'portal_session_connector'", () => {
    assert.equal(pineLabsOneAdapter.adapterKind, "portal_session_connector");
  });

  it("is NOT labelled as api_key_connector", () => {
    assert.notEqual(pineLabsOneAdapter.adapterKind, "api_key_connector");
  });

  it("has category 'pos'", () => {
    assert.equal(pineLabsOneAdapter.category, "pos");
  });

  it("declares at least one login method", () => {
    assert.ok(
      pineLabsOneAdapter.supportedLoginMethods.length > 0,
      "supportedLoginMethods must not be empty for a portal_session_connector",
    );
  });

  it("declares mobile_password login method with correct fields", () => {
    const m = pineLabsOneAdapter.supportedLoginMethods.find(x => x.key === "mobile_password");
    assert.ok(m, "mobile_password login method not found");
    assert.equal(m.requiresPassword, true);
    assert.ok(
      m.identifierType === "mobile" || m.identifierType === "username",
      `identifierType should be 'mobile' or 'username', got '${m.identifierType}'`,
    );
  });

  it("exposes all required interface methods", () => {
    const required = [
      "initiateSession", "submitStep", "validateSession",
      "discoverEntities", "fetchTransactions", "healthCheck",
      "reconnect", "logout",
    ];
    for (const method of required) {
      assert.ok(
        typeof (pineLabsOneAdapter as any)[method] === "function",
        `Missing method: ${method}`,
      );
    }
  });

  it("supportedLoginMethods are NOT empty (adapter is not fail-closed stub)", () => {
    assert.ok(
      pineLabsOneAdapter.supportedLoginMethods.length > 0,
      "Pine Labs ONE adapter was the fail-closed stub; the real adapter must have login methods",
    );
  });
});

// ── Fail-closed: initiateSession ──────────────────────────────────────────────

describe("PineLabsOne adapter — initiateSession fail-closed", () => {
  it("returns FAILED (not CONNECTED) when identifier is empty", async () => {
    const result = await pineLabsOneAdapter.initiateSession({
      loginMethod: "mobile_password",
      encryptedIdentifier: "",
    });
    assert.notEqual(result.status, "CONNECTED", "must not fabricate CONNECTED for empty identifier");
    assert.ok(result.failReason, "must provide failReason");
  });

  it("returns FAILED for unsupported login method", async () => {
    const result = await pineLabsOneAdapter.initiateSession({
      loginMethod: "mobile_otp",
      encryptedIdentifier: "enc:v1:abc:def:ghi",
    });
    assert.equal(result.status, "FAILED");
    assert.equal(result.failReason, "UNSUPPORTED_LOGIN_METHOD");
  });

  it("returns FAILED when encrypted identifier is not valid", async () => {
    const result = await pineLabsOneAdapter.initiateSession({
      loginMethod: "mobile_password",
      encryptedIdentifier: "not-encrypted-data",
    });
    // "not-encrypted-data" decrypts as plain-text but fails validation (too short)
    assert.notEqual(result.status, "CONNECTED");
  });

  it("returns FAILED for a too-short identifier plaintext", async () => {
    const result = await pineLabsOneAdapter.initiateSession({
      loginMethod: "mobile_password",
      encryptedIdentifier: "ab",  // decrypts as "ab" — too short
    });
    assert.notEqual(result.status, "CONNECTED");
  });
});

// ── Fail-closed: submitStep ───────────────────────────────────────────────────

describe("PineLabsOne adapter — submitStep fail-closed", () => {
  it("returns FAILED for totally invalid session token", async () => {
    const result = await pineLabsOneAdapter.submitStep({
      encryptedSessionToken: "not-a-real-token",
    });
    assert.notEqual(result.status, "CONNECTED", "must not fabricate CONNECTED for invalid token");
    assert.ok(result.failReason, "must provide failReason");
  });

  it("returns FAILED when encryptedOtp is missing", async () => {
    const result = await pineLabsOneAdapter.submitStep({
      encryptedSessionToken: "enc:v1:aabbcc:ddeeff:112233",
    });
    assert.notEqual(result.status, "CONNECTED");
  });

  it("returns FAILED for a valid-format but wrong-key token", async () => {
    const result = await pineLabsOneAdapter.submitStep({
      encryptedSessionToken: "enc:v1:000000000000000000000000:00000000000000000000000000000000:0000000000000000",
      encryptedOtp:          "enc:v1:000000000000000000000000:00000000000000000000000000000000:0000000000000000",
    });
    assert.notEqual(result.status, "CONNECTED", "wrong-key token must not produce CONNECTED");
  });
});

// ── Fail-closed: validateSession ─────────────────────────────────────────────

describe("PineLabsOne adapter — validateSession fail-closed", () => {
  it("returns valid:false for invalid token", async () => {
    const result = await pineLabsOneAdapter.validateSession("not-a-real-token");
    assert.equal(result.valid, false);
    assert.ok(result.reason, "must provide reason");
  });

  it("returns valid:false for wrong-key enc token", async () => {
    const result = await pineLabsOneAdapter.validateSession(
      "enc:v1:000000000000000000000000:00000000000000000000000000000000:0000000000000000",
    );
    assert.equal(result.valid, false);
  });
});

// ── Fail-closed: discoverEntities ─────────────────────────────────────────────

describe("PineLabsOne adapter — discoverEntities fail-closed", () => {
  it("returns empty entities for invalid token", async () => {
    const result = await pineLabsOneAdapter.discoverEntities("not-a-real-token");
    assert.ok(Array.isArray(result.entities));
    assert.equal(result.entities.length, 0);
  });

  it("returns empty entities for wrong-key enc token", async () => {
    const result = await pineLabsOneAdapter.discoverEntities(
      "enc:v1:000000000000000000000000:00000000000000000000000000000000:0000000000000000",
    );
    assert.ok(Array.isArray(result.entities));
    assert.equal(result.entities.length, 0);
  });
});

// ── Fail-closed: fetchTransactions ────────────────────────────────────────────

describe("PineLabsOne adapter — fetchTransactions fail-closed", () => {
  it("returns empty transactions for invalid token", async () => {
    const result = await pineLabsOneAdapter.fetchTransactions({
      encryptedSessionToken: "not-a-real-token",
      from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      to:   new Date(),
    });
    assert.ok(Array.isArray(result.transactions));
    assert.equal(result.transactions.length, 0);
    assert.equal(result.hasMore, false);
  });

  it("returns empty transactions for wrong-key enc token", async () => {
    const result = await pineLabsOneAdapter.fetchTransactions({
      encryptedSessionToken: "enc:v1:000000000000000000000000:00000000000000000000000000000000:0000000000000000",
      from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      to:   new Date(),
    });
    assert.ok(Array.isArray(result.transactions));
    assert.equal(result.transactions.length, 0);
    assert.equal(result.hasMore, false);
  });
});

// ── Fail-closed: healthCheck ──────────────────────────────────────────────────

describe("PineLabsOne adapter — healthCheck fail-closed", () => {
  it("does not throw for undefined token", async () => {
    // healthCheck should gracefully handle a browser launch attempt;
    // in the test environment without override it will try the live portal
    // and return healthy:false if unreachable — but MUST NOT throw.
    let threw = false;
    try {
      await Promise.race([
        pineLabsOneAdapter.healthCheck(undefined),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 30_000)),
      ]);
    } catch {
      threw = true;
    }
    assert.equal(threw, false, "healthCheck must never throw");
  });
});

// ── Fail-closed: reconnect ────────────────────────────────────────────────────

describe("PineLabsOne adapter — reconnect fail-closed", () => {
  it("returns non-CONNECTED for invalid token", async () => {
    const result = await pineLabsOneAdapter.reconnect("not-a-real-token");
    assert.notEqual(result.status, "CONNECTED");
    assert.ok(result.failReason, "must provide failReason");
  });

  it("returns non-CONNECTED for wrong-key enc token", async () => {
    const result = await pineLabsOneAdapter.reconnect(
      "enc:v1:000000000000000000000000:00000000000000000000000000000000:0000000000000000",
    );
    assert.notEqual(result.status, "CONNECTED");
  });
});

// ── Fail-closed: logout ───────────────────────────────────────────────────────

describe("PineLabsOne adapter — logout fail-closed", () => {
  it("does not throw for invalid token", async () => {
    let threw = false;
    try {
      await pineLabsOneAdapter.logout("not-a-real-token");
    } catch {
      threw = true;
    }
    assert.equal(threw, false, "logout must never throw");
  });
});

// ── Secret-leakage prevention ─────────────────────────────────────────────────

describe("PineLabsOne adapter — secret leakage prevention", () => {
  it("failDetail for empty identifier does not echo the raw input", async () => {
    const sensitiveInput = "MySuperSecretPassword";
    const result = await pineLabsOneAdapter.initiateSession({
      loginMethod: "mobile_password",
      encryptedIdentifier: sensitiveInput,
    });
    const detail = result.failDetail ?? "";
    assert.ok(
      !detail.includes(sensitiveInput),
      `failDetail must not contain the raw sensitive input. Got: ${detail}`,
    );
  });

  it("submitStep failDetail for invalid token does not echo raw token", async () => {
    const fakeToken = "very_secret_token_12345";
    const result = await pineLabsOneAdapter.submitStep({
      encryptedSessionToken: fakeToken,
      encryptedOtp: "raw_otp_value",
    });
    const detail = result.failDetail ?? "";
    assert.ok(!detail.includes(fakeToken), "failDetail must not echo session token");
    assert.ok(!detail.includes("raw_otp_value"), "failDetail must not echo OTP value");
  });
});

// ── Merchant isolation ────────────────────────────────────────────────────────

describe("PineLabsOne adapter — tenant isolation", () => {
  it("two independent initiateSession calls do not share state", async () => {
    // Both calls fail at pre-flight (no browser launched) — just verify isolation
    const [r1, r2] = await Promise.all([
      pineLabsOneAdapter.initiateSession({ loginMethod: "mobile_password", encryptedIdentifier: "" }),
      pineLabsOneAdapter.initiateSession({ loginMethod: "mobile_password", encryptedIdentifier: "" }),
    ]);
    assert.notEqual(r1.status, "CONNECTED");
    assert.notEqual(r2.status, "CONNECTED");
    // Both must fail independently — neither should produce a session token
    assert.ok(!r1.encryptedSessionToken, "no session token for failed initiate");
    assert.ok(!r2.encryptedSessionToken, "no session token for failed initiate");
  });
});
