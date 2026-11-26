import { describe, it } from "node:test";
import * as assert from "node:assert";
import { mapServerReadiness, ServerReadiness } from "./readiness-logic";

function getBaseServerData(): ServerReadiness {
  return {
    account: { status: "approved", profileComplete: true },
    contact: { emailVerified: true, mobileVerified: true, complete: true },
    kyc: { status: "approved", documents: [] },
    plan: { assigned: true, status: "active", planId: 1, planName: "Silver", expiresAt: null, isExpired: false, apiAccess: false, webhookAccess: false, providerAccess: true },
    provider: { configured: true, active: true, connectionStatus: "active", lastTestResult: "pass", lastTestedAt: new Date().toISOString(), capabilityPayin: true },
    apiKey: { active: false, count: 0, lastUsedAt: null },
    callback: { configured: false, verificationStatus: "not_configured", lastVerifiedAt: null, required: false, apiKeyRequired: false },
    collection: { enabled: true, live: true, state: "live", historicalDeposits: { count: 0, totalAmount: "0" } },
    testPayment: { supported: true, status: "successful", lastStatus: "success", lastAt: new Date().toISOString() },
    goLive: { eligible: true, blockers: [], nextStep: null, checkedAt: new Date().toISOString() }
  };
}

describe("Merchant Readiness Logic", () => {
  it("shows KYC submit as priority when no documents submitted", () => {
    const data = getBaseServerData();
    data.kyc.status = "not_started";
    data.collection.live = false;
    data.goLive.eligible = false;
    data.goLive.nextStep = "kyc_not_submitted";
    
    const readiness = mapServerReadiness(data);
    assert.strictEqual(readiness.isReady, false);
    assert.strictEqual(readiness.priorityAction?.id, "kyc_submit");
  });

  it("shows KYC rejected as priority over pending", () => {
    const data = getBaseServerData();
    data.kyc.status = "rejected";
    data.collection.live = false;
    data.goLive.eligible = false;
    data.goLive.nextStep = "kyc_not_approved";
    const readiness = mapServerReadiness(data);
    assert.strictEqual(readiness.priorityAction?.id, "kyc_rejected");
  });

  it("shows missing plan as priority when KYC is approved", () => {
    const data = getBaseServerData();
    data.plan.assigned = false;
    data.plan.status = null;
    data.collection.live = false;
    data.goLive.eligible = false;
    data.goLive.nextStep = "plan_not_active";
    const readiness = mapServerReadiness(data);
    assert.strictEqual(readiness.priorityAction?.id, "plan_missing");
  });

  it("shows provider missing as priority when plan is active", () => {
    const data = getBaseServerData();
    data.provider.active = false;
    data.collection.live = false;
    data.goLive.eligible = false;
    data.goLive.nextStep = "provider_not_connected_or_tested";
    const readiness = mapServerReadiness(data);
    assert.strictEqual(readiness.priorityAction?.id, "provider_missing");
  });
  
  it("marks as configured-inactive when provider is configured but plan is missing", () => {
    const data = getBaseServerData();
    data.plan.assigned = false;
    data.plan.status = null;
    data.provider.configured = true;
    data.provider.active = false;
    data.collection.live = false;
    const readiness = mapServerReadiness(data);
    
    const providerStep = readiness.steps.find(s => s.id === "provider");
    assert.strictEqual(providerStep?.statusText, "Configured — inactive");
    assert.strictEqual(providerStep?.isCompleted, false);
  });

  it("marks as fully live when all required steps are completed", () => {
    const data = getBaseServerData();
    const readiness = mapServerReadiness(data);
    assert.strictEqual(readiness.isReady, true);
    assert.strictEqual(readiness.priorityAction, null);
  });
  
  it("shows expired plan as priority", () => {
      const data = getBaseServerData();
      data.plan.isExpired = true;
      data.collection.live = false;
      data.goLive.eligible = false;
      data.goLive.nextStep = "plan_expired";
      const readiness = mapServerReadiness(data);
      assert.strictEqual(readiness.priorityAction?.id, "plan_expired");
  });
  
  it("checks provider before API/callback when both are required but provider is not active", () => {
      const data = getBaseServerData();
      data.plan.apiAccess = true;
      data.callback.required = true;
      data.provider.active = false;
      data.collection.live = false;
      data.goLive.eligible = false;
      data.goLive.nextStep = "provider_not_connected_or_tested";
      const readiness = mapServerReadiness(data);
      assert.strictEqual(readiness.priorityAction?.id, "provider_missing");
  });
  
  it("handles unsupported test payment gracefully", () => {
      const data = getBaseServerData();
      data.testPayment.supported = false;
      data.testPayment.status = "unsupported";
      data.goLive.eligible = false;
      data.goLive.nextStep = "test_payment_evidence_unsupported";
      data.collection.live = false;
      const readiness = mapServerReadiness(data);
      const testPaymentStep = readiness.steps.find(s => s.id === "test_payment");
      assert.strictEqual(testPaymentStep?.isCompleted, false);
      assert.match(testPaymentStep?.statusText ?? "", /not assumed complete/);
      assert.strictEqual(readiness.priorityAction?.id, "test_payment_unsupported");
      assert.strictEqual(readiness.isReady, false);
  });

  it("shows API key before callback when both are required", () => {
    const data = getBaseServerData();
    data.plan.apiAccess = true;
    data.callback = { ...data.callback, required: true, apiKeyRequired: true };
    data.apiKey.active = false;
    data.goLive.eligible = false;
    data.goLive.nextStep = "api_key_missing";
    data.collection.live = false;
    const readiness = mapServerReadiness(data);
    assert.strictEqual(readiness.priorityAction?.id, "api_key_missing");
    assert.deepStrictEqual(
      readiness.steps.filter(step => ["provider", "api_key", "callback", "test_payment"].includes(step.id)).map(step => step.id),
      ["provider", "api_key", "callback", "test_payment"],
    );
  });
});
