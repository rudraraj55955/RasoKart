/**
 * Connector Engine — Coverage and Safety Invariant Tests
 *
 * Verifies:
 *   1. All registered adapters implement the ProviderAdapter interface
 *   2. Pine Labs ONE is correctly fail-closed on all methods
 *   3. The engine correctly handles missing adapters (BLOCKED)
 *   4. Session crypto round-trips correctly
 *   5. No adapter returns CONNECTED, MONITORING, or AUTO_DEPOSIT without auth
 *   6. The engine never throws — all errors return safe status objects
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ── Imports ────────────────────────────────────────────────────────────────────
import { pineLabsOneAdapter } from "./adapters/pinelabs-one.js";
import { getAdapter, getRegisteredSlugs, isPortalProvider } from "./adapters/registry.js";
import { ConnectorEngine } from "./engine.js";
import {
  encryptSessionPayload,
  decryptSessionToken,
  makeSessionPayload,
} from "./sessionCrypto.js";
import type { ProviderAdapter } from "./types.js";

const engine = new ConnectorEngine();

// ── 1. Adapter interface compliance ───────────────────────────────────────────
describe("Adapter interface compliance", () => {
  const REQUIRED_METHODS: Array<keyof ProviderAdapter> = [
    "initiateSession",
    "submitStep",
    "validateSession",
    "discoverEntities",
    "fetchTransactions",
    "healthCheck",
    "logout",
  ];

  for (const slug of getRegisteredSlugs()) {
    it(`${slug}: adapter has all required interface methods`, () => {
      const adapter = getAdapter(slug);
      assert.ok(adapter, `No adapter found for slug "${slug}"`);
      for (const method of REQUIRED_METHODS) {
        assert.equal(
          typeof (adapter as any)[method],
          "function",
          `${slug}: missing method "${method}"`,
        );
      }
      assert.ok(adapter.slug, `${slug}: slug property must be set`);
      assert.ok(adapter.displayName, `${slug}: displayName must be set`);
      assert.ok(
        ["pos", "gateway", "bank", "upi"].includes(adapter.category),
        `${slug}: category must be one of pos|gateway|bank|upi`,
      );
      assert.ok(Array.isArray(adapter.supportedLoginMethods), `${slug}: supportedLoginMethods must be array`);
    });
  }
});

// ── 2. Pine Labs ONE fail-closed invariants ────────────────────────────────────
describe("Pine Labs ONE: fail-closed on every method", () => {
  const BLOCKED_STATUSES = ["PARTNER_API_REQUIRED", "BLOCKED", "FAILED", "EXPIRED"] as const;

  it("initiateSession returns PARTNER_API_REQUIRED", async () => {
    const result = await pineLabsOneAdapter.initiateSession({
      loginMethod: "mobile_otp",
      encryptedIdentifier: "enc:v1:aaa:bbb:ccc",
    });
    assert.ok(BLOCKED_STATUSES.includes(result.status as any),
      `Expected blocked status, got "${result.status}"`);
    assert.equal(result.status, "PARTNER_API_REQUIRED");
    assert.ok(result.failReason, "Must include failReason");
    assert.ok(result.failDetail, "Must include failDetail");
    assert.ok(result.helpUrl?.includes("developer.pinelabs.com"), "helpUrl must reference developer.pinelabs.com");
    assert.equal(result.encryptedSessionToken, undefined, "Must NOT produce a session token");
  });

  it("initiateSession: missing credentials still returns PARTNER_API_REQUIRED (not an error throw)", async () => {
    const result = await pineLabsOneAdapter.initiateSession({
      loginMethod: "mobile_otp",
      encryptedIdentifier: "",
    });
    assert.equal(result.status, "PARTNER_API_REQUIRED");
  });

  it("submitStep returns PARTNER_API_REQUIRED", async () => {
    const result = await pineLabsOneAdapter.submitStep({
      encryptedSessionToken: "enc:v1:aaa:bbb:ccc",
      encryptedOtp: "enc:v1:ddd:eee:fff",
    });
    assert.ok(BLOCKED_STATUSES.includes(result.status as any));
    assert.equal(result.encryptedSessionToken, undefined, "Must NOT produce a session token from blocked step");
  });

  it("validateSession returns valid=false", async () => {
    const result = await pineLabsOneAdapter.validateSession("enc:v1:aaa:bbb:ccc");
    assert.equal(result.valid, false);
    assert.ok(result.reason, "Must include reason");
  });

  it("discoverEntities returns empty entities (no data without API)", async () => {
    const result = await pineLabsOneAdapter.discoverEntities("enc:v1:aaa:bbb:ccc");
    assert.deepEqual(result.entities, [], "discoverEntities must return empty array (fail-closed)");
  });

  it("fetchTransactions returns empty list (no data without API)", async () => {
    const result = await pineLabsOneAdapter.fetchTransactions({
      encryptedSessionToken: "enc:v1:aaa:bbb:ccc",
      from: new Date("2026-01-01"),
      to:   new Date("2026-01-31"),
    });
    assert.deepEqual(result.transactions, [], "Must return empty transaction list");
    assert.equal(result.hasMore, false);
  });

  it("healthCheck returns healthy=false with PARTNER_API_REQUIRED status", async () => {
    const result = await pineLabsOneAdapter.healthCheck();
    assert.equal(result.healthy, false, "healthCheck must return healthy=false");
    assert.equal(result.status, "PARTNER_API_REQUIRED");
    assert.ok(result.detail?.includes("developer.pinelabs.com"));
  });

  it("logout resolves without throwing (no session to clear)", async () => {
    await assert.doesNotReject(
      () => pineLabsOneAdapter.logout("enc:v1:aaa:bbb:ccc"),
      "logout must not throw when there is no session",
    );
  });

  it("supportedLoginMethods is empty (no automation path)", () => {
    assert.deepEqual(pineLabsOneAdapter.supportedLoginMethods, [],
      "Pine Labs ONE must have no supported login methods until official API is granted");
  });
});

// ── 3. Engine handles unregistered slugs as BLOCKED ───────────────────────────
describe("ConnectorEngine: unregistered slug handling", () => {
  it("initiateSession for unknown slug returns BLOCKED", async () => {
    const result = await engine.initiateSession("nonexistent_provider_xyz", 999, {
      loginMethod: "mobile_otp",
      encryptedIdentifier: "test",
    });
    assert.equal(result.status, "BLOCKED");
    assert.ok(result.failReason?.includes("NO_ADAPTER_REGISTERED"));
  });

  it("validateSession for unknown slug returns valid=false", async () => {
    const result = await engine.validateSession("nonexistent_xyz", 999, "enc:v1:aaa:bbb:ccc");
    assert.equal(result.valid, false);
  });

  it("healthCheck for unknown slug returns healthy=false", async () => {
    const result = await engine.healthCheck("nonexistent_xyz", 999);
    assert.equal(result.healthy, false);
    assert.equal(result.status, "BLOCKED");
  });

  it("fetchTransactions for unknown slug returns empty (no throw)", async () => {
    const result = await engine.fetchTransactions("nonexistent_xyz", 999, "enc:v1:aaa:bbb:ccc", {
      from: new Date("2026-01-01"),
      to:   new Date("2026-01-31"),
    });
    assert.deepEqual(result.transactions, []);
    assert.equal(result.hasMore, false);
  });

  it("logout for unknown slug resolves without throwing", async () => {
    await assert.doesNotReject(
      () => engine.logout("nonexistent_xyz", 999, "enc:v1:aaa:bbb:ccc"),
    );
  });
});

// ── 4. Session crypto round-trip ──────────────────────────────────────────────
describe("Session crypto: encrypt/decrypt round-trip", () => {
  it("encrypts and decrypts a valid payload", () => {
    const payload = makeSessionPayload("pinelabs_one", 42, { foo: "bar" });
    const enc = encryptSessionPayload(payload);
    assert.equal(enc.ok, true, "encrypt must succeed");
    if (!enc.ok) return;

    assert.ok(enc.token.startsWith("enc:v1:"), "token must use enc:v1 prefix");

    const dec = decryptSessionToken(enc.token);
    assert.equal(dec.ok, true, "decrypt must succeed");
    if (!dec.ok) return;

    assert.equal(dec.payload.slug, "pinelabs_one");
    assert.equal(dec.payload.connectionId, 42);
    assert.deepEqual(dec.payload.adapterData, { foo: "bar" });
  });

  it("rejects an invalid token format", () => {
    const result = decryptSessionToken("not-a-valid-token");
    assert.equal(result.ok, false);
    assert.equal(result.reason, "invalid_token_format");
  });

  it("rejects an expired token", () => {
    const payload = makeSessionPayload("pinelabs_one", 1, {}, {
      expiresAt: new Date(Date.now() - 1000), // 1 second ago
    });
    const enc = encryptSessionPayload(payload);
    assert.equal(enc.ok, true);
    if (!enc.ok) return;

    const dec = decryptSessionToken(enc.token);
    assert.equal(dec.ok, false);
    assert.equal(dec.reason, "session_expired");
  });

  it("rejects an empty token", () => {
    assert.equal(decryptSessionToken("").ok, false);
  });
});

// ── 5. Adapter registry completeness ──────────────────────────────────────────
describe("Adapter registry", () => {
  it("isPortalProvider returns true for registered slugs", () => {
    for (const slug of getRegisteredSlugs()) {
      assert.equal(isPortalProvider(slug), true, `${slug} must be in registry`);
    }
  });

  it("isPortalProvider returns false for non-registered slug", () => {
    assert.equal(isPortalProvider("not_registered_xyz"), false);
  });

  it("getAdapter returns null for non-registered slug", () => {
    assert.equal(getAdapter("not_registered_xyz"), null);
  });

  it("pinelabs_one is in the registry", () => {
    assert.equal(isPortalProvider("pinelabs_one"), true);
    assert.ok(getAdapter("pinelabs_one"));
  });

  // No adapter returns CONNECTED or MONITORING without a real session
  it("no adapter in registry returns CONNECTED on fresh initiateSession", async () => {
    for (const slug of getRegisteredSlugs()) {
      const adapter = getAdapter(slug)!;
      const result = await adapter.initiateSession({
        loginMethod: "mobile_otp",
        encryptedIdentifier: "enc:v1:aaa:bbb:ccc",
      });
      assert.notEqual(result.status, "CONNECTED",
        `${slug}: initiateSession must not return CONNECTED without a verified session`);
      assert.notEqual(result.status, "MONITORING",
        `${slug}: initiateSession must not return MONITORING without active data fetch`);
    }
  });
});
