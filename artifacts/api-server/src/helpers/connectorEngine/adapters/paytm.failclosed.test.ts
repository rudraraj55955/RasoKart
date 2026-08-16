/**
 * Paytm Business adapter — structural integrity and fail-closed tests.
 *
 * These tests verify:
 *   1. Structural properties (adapterKind, loginMethods, interface completeness)
 *   2. Fail-closed behaviour: CONNECTED is NEVER returned for invalid inputs
 *   3. No exceptions thrown for invalid/empty tokens
 *
 * These tests do NOT launch a real browser — they verify the adapter's
 * pre-flight validation logic before any browser call is attempted.
 *
 * Real browser automation is exercised via manual e2e testing against the
 * live Paytm Business portal.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { paytmMerchantAdapter } from "./paytm.js";

// ── Structural integrity ───────────────────────────────────────────────────────

describe("Paytm adapter — structure", () => {
  it("has slug 'paytm_merchant'", () => {
    assert.equal(paytmMerchantAdapter.slug, "paytm_merchant");
  });

  it("has adapterKind 'portal_session_connector'", () => {
    assert.equal(paytmMerchantAdapter.adapterKind, "portal_session_connector");
  });

  it("is NOT labelled as api_key_connector", () => {
    assert.notEqual(paytmMerchantAdapter.adapterKind, "api_key_connector");
  });

  it("declares at least one login method", () => {
    assert.ok(paytmMerchantAdapter.supportedLoginMethods.length > 0,
      "supportedLoginMethods must not be empty for a portal_session_connector");
  });

  it("declares mobile_otp login method", () => {
    const m = paytmMerchantAdapter.supportedLoginMethods.find(x => x.key === "mobile_otp");
    assert.ok(m, "mobile_otp login method not found");
    assert.equal(m.identifierType, "mobile");
    assert.equal(m.requiresOtp, true);
    assert.equal(m.requiresPassword, false);
  });

  it("exposes all required interface methods", () => {
    const required = [
      "initiateSession", "submitStep", "validateSession",
      "discoverEntities", "fetchTransactions", "healthCheck",
      "reconnect", "logout",
    ];
    for (const method of required) {
      assert.ok(
        typeof (paytmMerchantAdapter as any)[method] === "function",
        `Missing method: ${method}`,
      );
    }
  });
});

// ── Fail-closed: initiateSession ──────────────────────────────────────────────

describe("Paytm adapter — initiateSession fail-closed", () => {
  it("returns FAILED (not CONNECTED) when identifier is empty", async () => {
    const result = await paytmMerchantAdapter.initiateSession({
      loginMethod: "mobile_otp",
      encryptedIdentifier: "",
    });
    assert.notEqual(result.status, "CONNECTED", "must not fabricate CONNECTED for empty identifier");
    assert.ok(result.failReason, "must provide failReason");
  });

  it("returns FAILED for unsupported login method", async () => {
    const result = await paytmMerchantAdapter.initiateSession({
      loginMethod: "email_password",
      encryptedIdentifier: "enc:v1:abc:def:ghi",
    });
    assert.equal(result.status, "FAILED");
    assert.equal(result.failReason, "UNSUPPORTED_LOGIN_METHOD");
  });

  it("returns FAILED when encrypted identifier is invalid (not enc:v1:)", async () => {
    const result = await paytmMerchantAdapter.initiateSession({
      loginMethod: "mobile_otp",
      encryptedIdentifier: "not-encrypted-data",
    });
    // "not-encrypted-data" decrypts as plain-text (backward compat path)
    // and then fails the length check < 10
    assert.notEqual(result.status, "CONNECTED");
  });
});

// ── Fail-closed: submitStep ───────────────────────────────────────────────────

describe("Paytm adapter — submitStep fail-closed", () => {
  it("returns FAILED for totally invalid session token", async () => {
    const result = await paytmMerchantAdapter.submitStep({
      encryptedSessionToken: "not-a-real-token",
    });
    assert.notEqual(result.status, "CONNECTED", "must not fabricate CONNECTED for invalid token");
    assert.ok(result.failReason, "must provide failReason");
  });

  it("returns FAILED when encryptedOtp is missing", async () => {
    const result = await paytmMerchantAdapter.submitStep({
      encryptedSessionToken: "enc:v1:aabbcc:ddeeff:112233",
      // encryptedOtp intentionally absent
    });
    assert.notEqual(result.status, "CONNECTED");
  });

  it("returns FAILED for a valid-format but wrong-key token", async () => {
    const result = await paytmMerchantAdapter.submitStep({
      encryptedSessionToken: "enc:v1:000000000000000000000000:00000000000000000000000000000000:0000000000000000",
      encryptedOtp: "enc:v1:000000000000000000000000:00000000000000000000000000000000:0000000000000000",
    });
    assert.notEqual(result.status, "CONNECTED", "wrong-key token must not produce CONNECTED");
  });
});

// ── Fail-closed: validateSession ─────────────────────────────────────────────

describe("Paytm adapter — validateSession fail-closed", () => {
  it("returns valid:false for invalid token", async () => {
    const result = await paytmMerchantAdapter.validateSession("not-a-real-token");
    assert.equal(result.valid, false);
    assert.ok(result.reason, "must provide reason");
  });

  it("returns valid:false for wrong-key enc token", async () => {
    const result = await paytmMerchantAdapter.validateSession(
      "enc:v1:000000000000000000000000:00000000000000000000000000000000:0000000000000000",
    );
    assert.equal(result.valid, false);
  });
});

// ── Fail-closed: discoverEntities ─────────────────────────────────────────────

describe("Paytm adapter — discoverEntities fail-closed", () => {
  it("returns empty entities for invalid token", async () => {
    const result = await paytmMerchantAdapter.discoverEntities("not-a-real-token");
    assert.ok(Array.isArray(result.entities));
    assert.equal(result.entities.length, 0);
  });
});

// ── Fail-closed: fetchTransactions ────────────────────────────────────────────

describe("Paytm adapter — fetchTransactions fail-closed", () => {
  it("returns empty transactions for invalid token", async () => {
    const result = await paytmMerchantAdapter.fetchTransactions({
      encryptedSessionToken: "not-a-real-token",
      from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      to:   new Date(),
    });
    assert.ok(Array.isArray(result.transactions));
    assert.equal(result.transactions.length, 0);
    assert.equal(result.hasMore, false);
  });
});

// ── Fail-closed: reconnect ────────────────────────────────────────────────────

describe("Paytm adapter — reconnect fail-closed", () => {
  it("never returns CONNECTED for invalid token", async () => {
    const result = await paytmMerchantAdapter.reconnect("not-a-real-token");
    assert.notEqual(
      result.status, "CONNECTED",
      "reconnect must never fabricate CONNECTED for an invalid token",
    );
    assert.ok(result.failReason, "must provide failReason");
  });

  it("returns AWAITING_OTP or FAILED (not CONNECTED) for wrong-key token", async () => {
    const result = await paytmMerchantAdapter.reconnect(
      "enc:v1:000000000000000000000000:00000000000000000000000000000000:0000000000000000",
    );
    assert.notEqual(result.status, "CONNECTED");
  });
});

// ── Fail-closed: logout (must not throw) ─────────────────────────────────────

describe("Paytm adapter — logout", () => {
  it("does not throw for invalid token", async () => {
    await assert.doesNotReject(() =>
      paytmMerchantAdapter.logout("not-a-real-token"),
    );
  });

  it("does not throw for empty string token", async () => {
    await assert.doesNotReject(() =>
      paytmMerchantAdapter.logout(""),
    );
  });
});

// ── healthCheck ───────────────────────────────────────────────────────────────

describe("Paytm adapter — healthCheck", () => {
  it("returns a well-formed result (does not throw)", async () => {
    // healthCheck launches a browser — this may pass or fail depending on
    // network access. The important invariant is it never throws.
    let result: any;
    await assert.doesNotReject(async () => {
      result = await paytmMerchantAdapter.healthCheck();
    });
    assert.ok(typeof result.healthy === "boolean", "healthy must be boolean");
    assert.ok(typeof result.status === "string",   "status must be string");
  });
});
