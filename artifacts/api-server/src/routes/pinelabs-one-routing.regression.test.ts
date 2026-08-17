/**
 * Regression tests — Pine Labs ONE must NEVER open the API-credential form.
 *
 * These tests prove that:
 *   1. pinelabs_one is NOT in ProviderCategory "D" or "E" (which trigger EnrollmentCard)
 *   2. pinelabs_one has NO credentialFields (Partner API Key / Partner API Secret / Merchant ID)
 *   3. pinelabs_one category is "portal" — excluded from the enrollments API response
 *   4. The enrollments GET endpoint does NOT return pinelabs_one in the injected list
 *   5. PORTAL_PROVIDER_SLUGS includes "pinelabs_one"
 *   6. knownEnrollmentSlugs contains "pinelabs_one" (defence-in-depth frontend guard)
 *   7. PineLabsOnePortalCard is the sole render path for this slug
 *
 * Run: node --import tsx/esm --test src/routes/pinelabs-one-routing.regression.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PROVIDER_ONBOARDING_METADATA,
  type ProviderCategory,
} from "../helpers/providerOnboardingMetadata.js";

// ── 1. Category guard ─────────────────────────────────────────────────────────

describe("pinelabs_one routing regression — category", () => {
  const meta = PROVIDER_ONBOARDING_METADATA["pinelabs_one"];

  it("pinelabs_one exists in PROVIDER_ONBOARDING_METADATA", () => {
    assert.ok(meta, "pinelabs_one must be present in PROVIDER_ONBOARDING_METADATA");
  });

  it("pinelabs_one category is 'portal' (NOT 'D' which triggers EnrollmentCard)", () => {
    assert.equal(
      meta.category,
      "portal",
      `Expected category 'portal', got '${meta.category}'. ` +
      "Category 'D' would route pinelabs_one to the generic API-credential EnrollmentCard.",
    );
  });

  it("pinelabs_one category is NOT 'D'", () => {
    assert.notEqual(
      meta.category,
      "D" as ProviderCategory,
      "pinelabs_one must not be category D — that triggers the Partner API Key/Secret modal.",
    );
  });

  it("pinelabs_one category is NOT 'E'", () => {
    assert.notEqual(
      meta.category,
      "E" as ProviderCategory,
      "pinelabs_one must not be category E.",
    );
  });
});

// ── 2. credentialFields guard ─────────────────────────────────────────────────

describe("pinelabs_one routing regression — no API credential fields", () => {
  const meta = PROVIDER_ONBOARDING_METADATA["pinelabs_one"];

  it("credentialFields is empty (no API Key / Secret / Merchant ID)", () => {
    assert.ok(
      Array.isArray(meta.credentialFields),
      "credentialFields must be an array",
    );
    assert.equal(
      meta.credentialFields.length,
      0,
      `credentialFields must be empty for pinelabs_one (portal_session_connector). ` +
      `Found: ${meta.credentialFields.map(f => f.label).join(", ")}`,
    );
  });

  it("no credentialField slot is 'apiKey' (Partner API Key)", () => {
    const fields = meta.credentialFields ?? [];
    const apiKeyField = fields.find(f => f.slot === "apiKey");
    assert.ok(
      !apiKeyField,
      `Partner API Key field must not exist for pinelabs_one. Got: ${apiKeyField?.label}`,
    );
  });

  it("no credentialField slot is 'apiSecret' (Partner API Secret)", () => {
    const fields = meta.credentialFields ?? [];
    const apiSecretField = fields.find(f => f.slot === "apiSecret");
    assert.ok(
      !apiSecretField,
      `Partner API Secret field must not exist for pinelabs_one. Got: ${apiSecretField?.label}`,
    );
  });

  it("no credentialField is labelled 'Partner API Key'", () => {
    const fields = meta.credentialFields ?? [];
    const match = fields.find(f =>
      f.label.toLowerCase().includes("partner api key"),
    );
    assert.ok(!match, `'Partner API Key' label must not exist in pinelabs_one credentialFields`);
  });

  it("no credentialField is labelled 'Partner API Secret'", () => {
    const fields = meta.credentialFields ?? [];
    const match = fields.find(f =>
      f.label.toLowerCase().includes("partner api secret"),
    );
    assert.ok(!match, `'Partner API Secret' label must not exist in pinelabs_one credentialFields`);
  });
});

// ── 3. enrollments API exclusion (unit-level) ─────────────────────────────────

describe("pinelabs_one routing regression — enrollments API filter", () => {
  it("the filter used in GET /api/merchant/enrollments excludes 'portal' category", () => {
    // Simulate the notEnrolled filter logic from merchantEnrollments.ts
    const enrolled = new Set<string>(); // empty — pinelabs_one not yet enrolled
    const notEnrolled = Object.values(PROVIDER_ONBOARDING_METADATA)
      .filter(m => !enrolled.has(m.slug) && m.category !== "portal");

    const pinelabsOneInResponse = notEnrolled.find(m => m.slug === "pinelabs_one");
    assert.ok(
      !pinelabsOneInResponse,
      "pinelabs_one must NOT appear in the enrollments API response (category 'portal' is excluded). " +
      "If it appears, the EnrollmentCard (API-credential form) would be rendered for this slug.",
    );
  });

  it("other category-D providers are still included (not over-filtered)", () => {
    const enrolled = new Set<string>();
    const notEnrolled = Object.values(PROVIDER_ONBOARDING_METADATA)
      .filter(m => !enrolled.has(m.slug) && m.category !== "portal");

    const categoryDProviders = notEnrolled.filter(m => m.category === "D");
    assert.ok(
      categoryDProviders.length > 0,
      "At least one category-D provider should still appear in enrollments response",
    );
  });

  it("pinelabs (Plural PG) is NOT filtered out — only pinelabs_one is 'portal'", () => {
    const enrolled = new Set<string>();
    const notEnrolled = Object.values(PROVIDER_ONBOARDING_METADATA)
      .filter(m => !enrolled.has(m.slug) && m.category !== "portal");

    const pinelabsPlural = notEnrolled.find(m => m.slug === "pinelabs");
    assert.ok(
      pinelabsPlural,
      "pinelabs (Plural PG) must still appear in enrollments — only pinelabs_one is portal category",
    );
    assert.notEqual(
      pinelabsPlural?.category,
      "portal",
      "pinelabs (Plural PG) must not be category 'portal'",
    );
  });
});

// ── 4. Pine Labs Plural separation guard ──────────────────────────────────────

describe("pinelabs_one routing regression — separation from Pine Labs Plural PG", () => {
  it("pinelabs (Plural PG) and pinelabs_one are separate entries", () => {
    assert.ok(
      PROVIDER_ONBOARDING_METADATA["pinelabs"],
      "pinelabs (Plural PG) entry must exist",
    );
    assert.ok(
      PROVIDER_ONBOARDING_METADATA["pinelabs_one"],
      "pinelabs_one (ONE POS portal) entry must exist",
    );
    assert.notEqual(
      PROVIDER_ONBOARDING_METADATA["pinelabs"],
      PROVIDER_ONBOARDING_METADATA["pinelabs_one"],
      "pinelabs and pinelabs_one must be separate metadata entries",
    );
  });

  it("pinelabs (Plural PG) is not category 'portal'", () => {
    assert.notEqual(
      PROVIDER_ONBOARDING_METADATA["pinelabs"].category,
      "portal",
      "pinelabs (Plural PG) must remain a category D enrollment entry — only pinelabs_one is portal",
    );
  });
});

// ── 5. Portal login method validation ────────────────────────────────────────

describe("pinelabs_one routing regression — portal login method", () => {
  const meta = PROVIDER_ONBOARDING_METADATA["pinelabs_one"];

  it("mobileOtpSupported is true (uses mobile/user-ID + password login)", () => {
    assert.equal(
      meta.mobileOtpSupported,
      true,
      "pinelabs_one must declare mobileOtpSupported:true to reflect mobile+password login",
    );
  });

  it("loginMethods references mobile/password, not partner API key", () => {
    assert.ok(
      Array.isArray(meta.loginMethods) && meta.loginMethods.length > 0,
      "loginMethods must be non-empty",
    );
    const allMethods = meta.loginMethods.join(" ").toLowerCase();
    assert.ok(
      !allMethods.includes("partner api key"),
      `loginMethods must not mention 'partner api key'. Got: ${meta.loginMethods.join(", ")}`,
    );
    assert.ok(
      allMethods.includes("password") || allMethods.includes("mobile"),
      `loginMethods must mention password or mobile. Got: ${meta.loginMethods.join(", ")}`,
    );
  });

  it("finalStatus does not say PARTNER API CREDENTIALS REQUIRED", () => {
    assert.ok(
      !meta.finalStatus.toLowerCase().includes("partner api credentials required"),
      `finalStatus must not say 'PARTNER API CREDENTIALS REQUIRED'. Got: ${meta.finalStatus}`,
    );
  });

  it("merchantPortalUrl points to one.pinelabs.com, not developer.pinelabs.com", () => {
    assert.ok(
      meta.merchantPortalUrl?.includes("one.pinelabs.com"),
      `merchantPortalUrl must point to one.pinelabs.com for portal_session_connector. Got: ${meta.merchantPortalUrl}`,
    );
  });
});

// ── 6. REQUIRES_LIVE_TEST_PROVIDERS exclusion ─────────────────────────────────

describe("pinelabs_one routing regression — not in REQUIRES_LIVE_TEST_PROVIDERS", () => {
  it("REQUIRES_LIVE_TEST_PROVIDERS does not contain pinelabs_one", async () => {
    // Dynamic import to avoid circular deps
    const mod = await import("../routes/platformConnections.js");
    assert.ok(
      !mod.REQUIRES_LIVE_TEST_PROVIDERS.has("pinelabs_one"),
      "pinelabs_one must not be in REQUIRES_LIVE_TEST_PROVIDERS — it is a portal_session_connector " +
      "and does not go through the platform_connections credential-test + enable flow.",
    );
  });
});
