/**
 * Connect-page routing isolation tests
 *
 * Proves that:
 *   1. `paytm_merchant` is registered as a portal_session_connector and is
 *      reachable via the portal-sessions flow.
 *   2. `paytm` (legacy) has NO portal adapter — it is enrollment-only and
 *      cannot reach the portal-session flow.
 *   3. The two slugs can never route to each other.
 *   4. `paytm` enrollment metadata explicitly marks mobile OTP as unsupported,
 *      ensuring the enrollment dialog's Mobile+OTP option is hidden for it.
 *
 * These are pure unit tests — no database, no HTTP, no browser.
 * Run with: node --import tsx/esm --test src/helpers/connectorEngine/adapters/connect.routing.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { getAdapter, isPortalProvider, getRegisteredSlugs } from "./registry.js";
import { PROVIDER_ONBOARDING_METADATA } from "../../providerOnboardingMetadata.js";

// ── 1. paytm_merchant — portal_session_connector ──────────────────────────────

describe("paytm_merchant routing — portal session connector", () => {
  it("is registered in the adapter registry", () => {
    const adapter = getAdapter("paytm_merchant");
    assert.ok(adapter !== null, "paytm_merchant adapter must exist");
  });

  it("has adapterKind portal_session_connector", () => {
    const adapter = getAdapter("paytm_merchant")!;
    assert.equal(adapter.adapterKind, "portal_session_connector",
      "paytm_merchant must be a portal_session_connector, not api_key_connector");
  });

  it("has slug paytm_merchant", () => {
    const adapter = getAdapter("paytm_merchant")!;
    assert.equal(adapter.slug, "paytm_merchant");
  });

  it("isPortalProvider returns true for paytm_merchant", () => {
    assert.equal(isPortalProvider("paytm_merchant"), true,
      "isPortalProvider(paytm_merchant) must be true for the portal-sessions routes to accept it");
  });

  it("supports mobile_otp login method", () => {
    const adapter = getAdapter("paytm_merchant")!;
    // supportedLoginMethods is an array of objects with a `key` property
    const hasOtp = adapter.supportedLoginMethods.some(
      (m: { key: string }) => m.key === "mobile_otp",
    );
    assert.ok(hasOtp,
      "paytm_merchant adapter must declare a login method with key='mobile_otp'",
    );
  });

  it("exposes all required interface methods", () => {
    const adapter = getAdapter("paytm_merchant")!;
    for (const method of ["initiateSession", "submitStep", "validateSession", "fetchTransactions", "logout"] as const) {
      assert.equal(typeof adapter[method], "function",
        `paytm_merchant adapter must expose ${method}()`);
    }
  });

  it("is in the registered slugs list", () => {
    const slugs = getRegisteredSlugs();
    assert.ok(slugs.includes("paytm_merchant"),
      `paytm_merchant must be in getRegisteredSlugs(); got: [${slugs.join(", ")}]`);
  });
});

// ── 2. paytm (legacy) — enrollment-only, NOT a portal connector ───────────────

describe("paytm routing — enrollment-only, no portal adapter", () => {
  it("getAdapter returns null for paytm (no portal session adapter)", () => {
    const adapter = getAdapter("paytm");
    assert.equal(adapter, null,
      "paytm must NOT have a portal session adapter — it is enrollment-only; " +
      "paytm_merchant is the portal connector");
  });

  it("isPortalProvider returns false for paytm", () => {
    assert.equal(isPortalProvider("paytm"), false,
      "isPortalProvider(paytm) must be false — the portal-sessions route must " +
      "return 404 for any request targeting the paytm slug");
  });

  it("paytm is not in the registered portal slugs", () => {
    const slugs = getRegisteredSlugs();
    assert.ok(!slugs.includes("paytm"),
      `paytm must NOT be in getRegisteredSlugs(); got: [${slugs.join(", ")}]`);
  });
});

// ── 3. Routing isolation — the two slugs can never swap paths ─────────────────

describe("Slug routing isolation — paytm vs paytm_merchant", () => {
  it("paytm_merchant is a portal provider and paytm is not — mutually exclusive", () => {
    assert.equal(isPortalProvider("paytm_merchant"), true);
    assert.equal(isPortalProvider("paytm"), false);
  });

  it("paytm has a portal adapter: false; paytm_merchant has one: true — no mix-up possible", () => {
    assert.equal(getAdapter("paytm"), null);
    assert.notEqual(getAdapter("paytm_merchant"), null);
  });

  it("portal adapter for paytm_merchant cannot be confused with paytm", () => {
    const adapter = getAdapter("paytm_merchant")!;
    assert.notEqual(adapter.slug, "paytm",
      "paytm_merchant adapter must identify itself as paytm_merchant, not paytm");
  });
});

// ── 4. Enrollment metadata — paytm mobileOtpSupported:false ──────────────────

describe("paytm enrollment metadata — mobile OTP must be marked unsupported", () => {
  it("paytm enrollment metadata exists", () => {
    const meta = PROVIDER_ONBOARDING_METADATA["paytm"];
    assert.ok(meta !== undefined, "paytm must have onboarding metadata");
  });

  it("paytm mobileOtpSupported is false (portal connector handles it)", () => {
    const meta = PROVIDER_ONBOARDING_METADATA["paytm"]!;
    assert.equal(meta.mobileOtpSupported, false,
      "paytm enrollment must NOT claim mobile OTP support — " +
      "the paytm_merchant portal_session_connector handles Mobile+OTP. " +
      "If this is true, the enrollment dialog will show a Mobile+OTP option " +
      "that leads merchants into the wrong flow.");
  });

  it("paytm_merchant does NOT have enrollment metadata (portal connector, not Category D)", () => {
    const meta = PROVIDER_ONBOARDING_METADATA["paytm_merchant"];
    assert.equal(meta, undefined,
      "paytm_merchant must NOT appear in enrollment metadata — " +
      "it is a portal_session_connector, not a Category D self-service enrollment");
  });

  it("paytm category is D (enrollment path)", () => {
    const meta = PROVIDER_ONBOARDING_METADATA["paytm"]!;
    assert.equal(meta.category, "D",
      "paytm must be Category D (enrollment) — the portal connector " +
      "paytm_merchant does not have enrollment onboarding");
  });
});
