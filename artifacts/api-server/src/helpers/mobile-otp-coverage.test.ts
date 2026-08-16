/**
 * Mobile+OTP and Email+OTP Coverage Test
 *
 * Enforcement rules:
 *
 * 1. mobileOtpSupported must be EXPLICITLY false (not absent/undefined) for
 *    every Category D provider.  An absent field silently defaults to false in
 *    toPublicOnboardingInfo(), but that means a developer could add a new
 *    Category D provider and forget to set the field — a future regression
 *    would only surface when a merchant hits the broken "Enter Mobile Number"
 *    form at runtime.  Explicit false is required so the intent is documented
 *    in the source and this test catches any accidental omission.
 *
 * 2. No Category D provider may have mobileOtpSupported: true without a real
 *    backend route.  None of the current providers (PhonePe, Paytm, BharatPe,
 *    Amazon Pay, MobiKwik, Pine Labs) expose an official third-party merchant
 *    authentication API.  Setting true without a route causes the merchant UI
 *    to show a live "Connect with Mobile Number" form that silently fails.
 *
 * 3. If emailOtpLoginAvailable is true for any provider, emailOtpNote must be
 *    a non-null, non-empty string.  The UI uses the note to explain the exact
 *    behaviour to the merchant; an absent note leaves the modal blank.
 *
 * Run:
 *   cd artifacts/api-server && node --import tsx/esm --test src/helpers/mobile-otp-coverage.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  PROVIDER_ONBOARDING_METADATA,
} from "./providerOnboardingMetadata.ts";

// ── helpers ───────────────────────────────────────────────────────────────────

type ProviderEntry = (typeof PROVIDER_ONBOARDING_METADATA)[keyof typeof PROVIDER_ONBOARDING_METADATA];

function allProviders(): ProviderEntry[] {
  return Object.values(PROVIDER_ONBOARDING_METADATA) as ProviderEntry[];
}

function categoryDProviders(): ProviderEntry[] {
  return allProviders().filter((p) => p.category === "D");
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("Mobile+OTP and Email+OTP coverage — PROVIDER_ONBOARDING_METADATA integrity", () => {

  describe("Category D: mobileOtpSupported must be explicitly false", () => {
    for (const provider of categoryDProviders()) {
      it(`${provider.slug}: mobileOtpSupported is explicitly false (not absent/undefined)`, () => {
        assert.ok(
          "mobileOtpSupported" in provider,
          `Provider "${provider.slug}" (Category D) is missing the mobileOtpSupported field.\n` +
            `You must add  mobileOtpSupported: false  to its entry in providerOnboardingMetadata.ts.\n` +
            `An absent field silently defaults to false at runtime but hides the intent from reviewers.`,
        );
        assert.strictEqual(
          (provider as { mobileOtpSupported?: boolean }).mobileOtpSupported,
          false,
          `Provider "${provider.slug}" (Category D) has mobileOtpSupported set to a value other than false.\n` +
            `Setting mobileOtpSupported: true without a real backend initiate-OTP + verify-OTP + session-token\n` +
            `API route causes the merchant UI to show a live "Connect with Mobile Number" form that silently fails.\n\n` +
            `Only set mobileOtpSupported: true when the provider's official developer docs explicitly describe\n` +
            `a merchant authentication API approved for use by third-party platforms AND a matching backend\n` +
            `route exists in this codebase.`,
        );
      });
    }
  });

  describe("All providers: no mobileOtpSupported: true allowed anywhere (current state)", () => {
    it("no provider has mobileOtpSupported set to true", () => {
      const offenders = allProviders().filter(
        (p) => (p as { mobileOtpSupported?: boolean }).mobileOtpSupported === true,
      );

      assert.deepStrictEqual(
        offenders.map((p) => p.slug),
        [],
        `The following providers have mobileOtpSupported: true but no backend OTP route exists:\n` +
          offenders.map((p) => `  • ${p.slug} (Category ${p.category})`).join("\n") +
          `\n\nThis causes merchants to see a broken "Enter Mobile Number" form.\n` +
          `Either:\n` +
          `  A) Implement the real initiate-OTP and verify-OTP backend routes, or\n` +
          `  B) Set mobileOtpSupported: false until the API contract is confirmed.`,
      );
    });
  });

  describe("emailOtpLoginAvailable: true requires a non-empty emailOtpNote", () => {
    const emailOtpProviders = allProviders().filter(
      (p) => (p as { emailOtpLoginAvailable?: boolean }).emailOtpLoginAvailable === true,
    );

    if (emailOtpProviders.length === 0) {
      it("(no providers currently have emailOtpLoginAvailable: true — nothing to check)", () => {
        // Vacuously pass; presence of this it() ensures the describe block is not empty.
        assert.ok(true);
      });
    }

    for (const provider of emailOtpProviders) {
      it(`${provider.slug}: emailOtpNote is non-null and non-empty when emailOtpLoginAvailable is true`, () => {
        const note = (provider as { emailOtpNote?: string | null }).emailOtpNote;
        assert.ok(
          note !== null && note !== undefined && note.trim().length > 0,
          `Provider "${provider.slug}" has emailOtpLoginAvailable: true but emailOtpNote is absent or empty.\n` +
            `The merchant UI uses emailOtpNote to explain email+OTP behaviour in the connection modal.\n` +
            `Add a clear note — e.g. what email address the merchant should use, or whether OTP-less\n` +
            `session connection is supported.`,
        );
      });
    }
  });

  describe("Completeness: every entry in PROVIDER_ONBOARDING_METADATA has slug and category", () => {
    for (const provider of allProviders()) {
      it(`${provider.slug ?? "(missing slug)"}: has slug and category fields`, () => {
        assert.ok(
          typeof provider.slug === "string" && provider.slug.length > 0,
          `A provider entry is missing the slug field. Check providerOnboardingMetadata.ts.`,
        );
        assert.ok(
          provider.category === "A" || provider.category === "D" || provider.category === "E",
          `Provider "${provider.slug}" has an unexpected category value: "${provider.category}".\n` +
            `Valid values are: "A", "D", "E".`,
        );
      });
    }
  });
});
