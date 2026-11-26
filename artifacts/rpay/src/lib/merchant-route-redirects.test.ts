import assert from "node:assert/strict";
import test from "node:test";
import { CANONICAL_LOGIN_ROUTE, LEGACY_MERCHANT_REDIRECTS } from "./merchant-route-redirects";

test("retired merchant routes redirect to their authorized replacement", () => {
  assert.deepEqual(LEGACY_MERCHANT_REDIRECTS, {
    "/merchant/withdrawals": "/merchant/payouts",
  });
});

test("distinct onboarding and KYC workflows are not retired", () => {
  assert.equal("/merchant/onboarding" in LEGACY_MERCHANT_REDIRECTS, false);
  assert.equal("/merchant/auto-kyc" in LEGACY_MERCHANT_REDIRECTS, false);
});

test("the generic login entry resolves to the canonical merchant login", () => {
  assert.equal(CANONICAL_LOGIN_ROUTE, "/merchant/login");
});