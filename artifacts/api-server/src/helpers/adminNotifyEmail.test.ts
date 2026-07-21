import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildPlanExpiryHtml,
  buildSettlementStateHtml,
  buildWebhookFailureHtml,
  buildReportScheduleAutoPausedHtml,
  buildReportScheduleResumedHtml,
  buildStuckEkqrHtml,
  buildCredentialRotationHtml,
} from "./adminNotifyEmail";

const TEST_BANNER_TEXT = "THIS IS A TEST";
const TEST_BANNER_STYLE = "background: #78350f; border: 2px solid #f59e0b";

function assertBannerPresent(html: string, label: string): void {
  assert.ok(html.includes(TEST_BANNER_TEXT), `${label}: expected banner text to be present`);
  assert.ok(html.includes(TEST_BANNER_STYLE), `${label}: expected amber banner style to be present`);
}

function assertBannerAbsent(html: string, label: string): void {
  assert.equal(html.includes(TEST_BANNER_TEXT), false, `${label}: expected banner text to be absent`);
  assert.equal(html.includes(TEST_BANNER_STYLE), false, `${label}: expected amber banner style to be absent`);
}

// ---------------------------------------------------------------------------
// buildPlanExpiryHtml
// ---------------------------------------------------------------------------

describe("buildPlanExpiryHtml", () => {
  const base = {
    merchantName: "Acme Corp",
    planName: "Gold",
    merchantId: 42,
    daysUntilExpiry: 5,
    expiresAt: "2026-08-01",
  };

  it("includes the amber TEST banner div when isTest is true", () => {
    assertBannerPresent(buildPlanExpiryHtml({ ...base, isTest: true }), "isTest:true");
  });

  it("omits the TEST banner when isTest is false", () => {
    assertBannerAbsent(buildPlanExpiryHtml({ ...base, isTest: false }), "isTest:false");
  });

  it("omits the TEST banner when isTest is omitted", () => {
    assertBannerAbsent(buildPlanExpiryHtml(base), "isTest omitted");
  });
});

// ---------------------------------------------------------------------------
// buildSettlementStateHtml
// ---------------------------------------------------------------------------

describe("buildSettlementStateHtml", () => {
  const base = {
    settlementId: 101,
    merchantName: "Demo Merchant",
    referenceNumber: "REF001",
    newStatus: "approved",
    amount: 5000,
    note: null,
  };

  it("includes the amber TEST banner div when isTest is true", () => {
    assertBannerPresent(buildSettlementStateHtml({ ...base, isTest: true }), "isTest:true");
  });

  it("omits the TEST banner when isTest is false", () => {
    assertBannerAbsent(buildSettlementStateHtml({ ...base, isTest: false }), "isTest:false");
  });

  it("omits the TEST banner when isTest is omitted", () => {
    assertBannerAbsent(buildSettlementStateHtml(base), "isTest omitted");
  });
});

// ---------------------------------------------------------------------------
// buildWebhookFailureHtml
// ---------------------------------------------------------------------------

describe("buildWebhookFailureHtml", () => {
  const base = {
    merchantId: 7,
    url: "https://merchant.example.com/webhook",
    attempts: 5,
    qrCodeId: null,
  };

  it("includes the amber TEST banner div when isTest is true", () => {
    assertBannerPresent(buildWebhookFailureHtml({ ...base, isTest: true }), "isTest:true");
  });

  it("omits the TEST banner when isTest is false", () => {
    assertBannerAbsent(buildWebhookFailureHtml({ ...base, isTest: false }), "isTest:false");
  });

  it("omits the TEST banner when isTest is omitted", () => {
    assertBannerAbsent(buildWebhookFailureHtml(base), "isTest omitted");
  });
});

// ---------------------------------------------------------------------------
// buildReportScheduleAutoPausedHtml
// ---------------------------------------------------------------------------

describe("buildReportScheduleAutoPausedHtml", () => {
  const base = {
    merchantName: "Acme Corp",
    merchantId: 42,
    frequency: "daily",
    consecutiveFailures: 3,
    autoPauseAfterFailures: 3,
  };

  it("includes the amber TEST banner div when isTest is true", () => {
    assertBannerPresent(buildReportScheduleAutoPausedHtml({ ...base, isTest: true }), "isTest:true");
  });

  it("omits the TEST banner when isTest is false", () => {
    assertBannerAbsent(buildReportScheduleAutoPausedHtml({ ...base, isTest: false }), "isTest:false");
  });

  it("omits the TEST banner when isTest is omitted", () => {
    assertBannerAbsent(buildReportScheduleAutoPausedHtml(base), "isTest omitted");
  });
});

// ---------------------------------------------------------------------------
// buildReportScheduleResumedHtml
// ---------------------------------------------------------------------------

describe("buildReportScheduleResumedHtml", () => {
  const base = {
    merchantName: "Acme Corp",
    merchantId: 42,
    frequency: "weekly",
    previousFailures: 2,
  };

  it("includes the amber TEST banner div when isTest is true", () => {
    assertBannerPresent(buildReportScheduleResumedHtml({ ...base, isTest: true }), "isTest:true");
  });

  it("omits the TEST banner when isTest is false", () => {
    assertBannerAbsent(buildReportScheduleResumedHtml({ ...base, isTest: false }), "isTest:false");
  });

  it("omits the TEST banner when isTest is omitted", () => {
    assertBannerAbsent(buildReportScheduleResumedHtml(base), "isTest omitted");
  });
});

// ---------------------------------------------------------------------------
// buildStuckEkqrHtml
// ---------------------------------------------------------------------------

describe("buildStuckEkqrHtml", () => {
  const base = {
    stuck: 4,
    threshold: 3,
    staleMinutes: 30,
  };

  it("includes the amber TEST banner div when isTest is true", () => {
    assertBannerPresent(buildStuckEkqrHtml({ ...base, isTest: true }), "isTest:true");
  });

  it("omits the TEST banner when isTest is false", () => {
    assertBannerAbsent(buildStuckEkqrHtml({ ...base, isTest: false }), "isTest:false");
  });

  it("omits the TEST banner when isTest is omitted", () => {
    assertBannerAbsent(buildStuckEkqrHtml(base), "isTest omitted");
  });
});

// ---------------------------------------------------------------------------
// buildCredentialRotationHtml
// ---------------------------------------------------------------------------

describe("buildCredentialRotationHtml", () => {
  const base = {
    gateway: "cashfree",
    changedFields: ["clientId", "clientSecret"],
    actorEmail: "admin@rasokart.com",
    timestamp: "2026-07-21T10:00:00.000Z",
  };

  it("includes the amber TEST banner div when isTest is true", () => {
    assertBannerPresent(buildCredentialRotationHtml({ ...base, isTest: true }), "isTest:true");
  });

  it("omits the TEST banner when isTest is false", () => {
    assertBannerAbsent(buildCredentialRotationHtml({ ...base, isTest: false }), "isTest:false");
  });

  it("omits the TEST banner when isTest is omitted", () => {
    assertBannerAbsent(buildCredentialRotationHtml(base), "isTest omitted");
  });
});
