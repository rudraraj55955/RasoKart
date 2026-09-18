import assert from "node:assert/strict";
import test from "node:test";
import { calculateMerchantReadiness, selectReadyProvider, type MerchantReadinessInput } from "./merchantReadiness";

const base = (): MerchantReadinessInput => ({
  now: new Date("2025-01-01T00:00:00Z"),
  merchant: { id: 1, businessName: "Acme", contactName: "Owner", phone: "9999999999", status: "approved", verificationStatus: "approved", forceApproved: false, payinServiceEnabled: true, collectionServiceEnabled: true, callbackSecretConfigured: true },
  contact: { emailVerified: true, mobileVerified: true },
  kycDocuments: [{ docType: "pan", status: "approved" }],
  kycVerificationStatus: "APPROVED",
  requiredKycDocTypes: ["pan", "gst", "bank_details", "business_proof"],
  plan: { assigned: true, status: "active", planId: 1, planName: "Enterprise", expiresAt: new Date("2025-12-31"), apiAccess: true, webhookAccess: true, providerAccess: true },
  provider: { configured: true, active: true, connectionStatus: "active", lastTestResult: "pass", lastTestedAt: new Date("2024-12-31"), capabilityPayin: true },
  apiKey: { active: true, count: 1, lastUsedAt: null },
  callback: { configured: true, verified: true, lastVerifiedAt: new Date("2024-12-31") },
  historicalDeposits: { count: 0, totalAmount: "0" },
  testPayment: { supported: true, successful: true, lastStatus: "success", lastAt: new Date("2024-12-31") },
});

test("expired plan is blocked and never exposes usable API access", () => {
  const result = calculateMerchantReadiness({ ...base(), plan: { ...base().plan!, expiresAt: new Date("2024-01-01") } });
  assert.equal(result.plan.isExpired, true);
  assert.equal(result.plan.apiAccess, false);
  assert.ok(result.goLive.blockers.includes("plan_expired"));
});

test("pending KYC is the actionable blocker", () => {
  const input = base();
  input.kycDocuments = [{ docType: "pan", status: "pending" }];
  input.kycVerificationStatus = "PENDING";
  const result = calculateMerchantReadiness(input);
  assert.equal(result.kyc.status, "pending");
  assert.equal(result.goLive.nextStep, "kyc_not_approved");
});

test("provider must be active, tested, and payin-capable", () => {
  const result = calculateMerchantReadiness({ ...base(), provider: { ...base().provider!, active: false, connectionStatus: "pending", lastTestResult: "untested" } });
  assert.equal(result.provider.active, false);
  assert.ok(result.goLive.blockers.includes("provider_not_connected_or_tested"));
});

test("configured but unverified callback remains incomplete", () => {
  const result = calculateMerchantReadiness({ ...base(), callback: { configured: true, verified: false, lastVerifiedAt: null } });
  assert.equal(result.callback.verificationStatus, "unverified");
  assert.ok(result.goLive.blockers.includes("callback_not_verified"));
});

test("API access requires an active API key after provider readiness", () => {
  const input = base();
  input.apiKey = { active: false, count: 0, lastUsedAt: null };
  const result = calculateMerchantReadiness(input);
  assert.ok(result.goLive.blockers.includes("api_key_missing"));
  assert.equal(result.goLive.nextStep, "api_key_missing");
});

test("provider selection keeps a valid older connection when a newer one is inactive", () => {
  const selected = selectReadyProvider([
    { configured: true, active: false, connectionStatus: "suspended", lastTestResult: "pass", lastTestedAt: new Date("2025-01-01"), capabilityPayin: true, updatedAt: new Date("2025-01-02") },
    { configured: true, active: true, connectionStatus: "active", lastTestResult: "pass", lastTestedAt: new Date("2024-12-31"), capabilityPayin: true, updatedAt: new Date("2024-12-31") },
  ]);
  assert.equal(selected?.active, true);
  assert.equal(selected?.connectionStatus, "active");
});

test("unsupported test-payment evidence prevents live collection and go-live", () => {
  const result = calculateMerchantReadiness({ ...base(), testPayment: { supported: false, successful: false, lastStatus: null, lastAt: null } });
  assert.equal(result.collection.live, false);
  assert.equal(result.goLive.eligible, false);
  assert.ok(result.goLive.blockers.includes("test_payment_evidence_unsupported"));
});

test("historical deposits are labelled while current collection is paused", () => {
  const result = calculateMerchantReadiness({ ...base(), provider: null, historicalDeposits: { count: 4, totalAmount: "1200.00" } });
  assert.equal(result.collection.state, "paused_historical_only");
  assert.deepEqual(result.collection.historicalDeposits, { count: 4, totalAmount: "1200.00" });
});

test("fully live merchant is eligible", () => {
  const result = calculateMerchantReadiness(base());
  assert.equal(result.goLive.eligible, true);
  assert.deepEqual(result.goLive.blockers, []);
});

test("mixed state preserves exact setup priority", () => {
  const input = base();
  input.contact = { emailVerified: false, mobileVerified: false };
  input.kycDocuments = [];
  input.kycVerificationStatus = null;
  const result = calculateMerchantReadiness(input);
  assert.equal(result.goLive.nextStep, "kyc_not_submitted");
  assert.equal(result.goLive.eligible, false);
});

test("KYC approval precedes contact, plan, provider, API key, callback, and test payment", () => {
  const input = base();
  input.contact = { emailVerified: false, mobileVerified: false };
  input.kycDocuments = [{ docType: "pan", status: "pending" }];
  input.kycVerificationStatus = "PENDING";
  input.plan = null;
  const result = calculateMerchantReadiness(input);
  assert.equal(result.goLive.nextStep, "kyc_not_approved");
});

test("partial approved documents do not imply KYC approval", () => {
  const input = base();
  input.kycVerificationStatus = null;
  input.kycDocuments = [{ docType: "pan", status: "approved" }];
  const result = calculateMerchantReadiness(input);
  assert.equal(result.kyc.status, "pending");
  assert.equal(result.goLive.nextStep, "kyc_not_approved");
});

test("audited force approval is accepted without inferring missing documents", () => {
  const input = base();
  input.kycVerificationStatus = null;
  input.kycDocuments = [];
  input.merchant.forceApproved = true;
  assert.equal(calculateMerchantReadiness(input).kyc.status, "approved");
});

test("audited force approval overrides stale rejected and pending document history", () => {
  const input = base();
  input.kycVerificationStatus = null;
  input.kycDocuments = [
    { docType: "pan", status: "rejected" },
    { docType: "gst", status: "pending" },
  ];
  input.merchant.forceApproved = true;
  assert.equal(calculateMerchantReadiness(input).kyc.status, "approved");
});

test("authoritative auto-KYC approval overrides stale rejected document history", () => {
  const input = base();
  input.kycDocuments = [{ docType: "pan", status: "rejected" }];
  input.kycVerificationStatus = "APPROVED";
  assert.equal(calculateMerchantReadiness(input).kyc.status, "approved");
});

test("complete required approved documents override stale rejected duplicates", () => {
  const input = base();
  input.kycVerificationStatus = null;
  input.kycDocuments = [
    { docType: "pan", status: "rejected" },
    { docType: "pan", status: "approved" },
    { docType: "gst", status: "approved" },
    { docType: "bank_details", status: "approved" },
    { docType: "business_proof", status: "approved" },
  ];
  assert.equal(calculateMerchantReadiness(input).kyc.status, "approved");
});