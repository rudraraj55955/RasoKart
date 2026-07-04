import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  buildPayoutEndpoint,
  resolvePayoutBaseUrl,
  cashfreePayoutEnsureBeneficiary,
  type PayoutProviderConfig,
} from "./cashfreePayout";

describe("buildPayoutEndpoint", () => {
  it("joins baseUrl + path with exactly one slash", () => {
    assert.equal(
      buildPayoutEndpoint("https://api.cashfree.com/payout", "/beneficiary"),
      "https://api.cashfree.com/payout/beneficiary"
    );
  });

  it("does not double up a path already ending in the target segment", () => {
    assert.equal(
      buildPayoutEndpoint("https://api.cashfree.com/payout/beneficiary", "/beneficiary"),
      "https://api.cashfree.com/payout/beneficiary"
    );
  });

  it("trims trailing slashes on baseUrl and normalizes leading slash on path", () => {
    assert.equal(
      buildPayoutEndpoint("https://api.cashfree.com/payout/", "beneficiary"),
      "https://api.cashfree.com/payout/beneficiary"
    );
  });

  it("never appends /v2 — v2 is selected via header only", () => {
    const base = resolvePayoutBaseUrl("live");
    assert.equal(base.includes("/v2"), false);
    const endpoint = buildPayoutEndpoint(base, "/beneficiary");
    assert.equal(endpoint.includes("/v2"), false);
  });
});

describe("cashfreePayoutEnsureBeneficiary — create call target", () => {
  const originalFetch = global.fetch;
  let calls: Array<{ url: string; method: string }>;

  beforeEach(() => {
    calls = [];
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("hits exactly POST {baseUrl}/beneficiary for the create call, never a doubled/malformed path", async () => {
    const providerConfig: PayoutProviderConfig = {
      baseUrl: "https://api.cashfree.com/payout",
      apiVersion: "2024-01-01",
    };

    global.fetch = (async (input: any, init: any) => {
      const url = typeof input === "string" ? input : input.url;
      calls.push({ url, method: init?.method ?? "GET" });

      if (init?.method === "POST") {
        return new Response(
          JSON.stringify({ beneficiary_id: "BEN_TEST_1", beneficiary_status: "VERIFIED" }),
          { status: 200 }
        );
      }
      // GET verify call
      return new Response(
        JSON.stringify({ beneficiary_id: "BEN_TEST_1", beneficiary_status: "VERIFIED" }),
        { status: 200 }
      );
    }) as typeof fetch;

    const result = await cashfreePayoutEnsureBeneficiary(
      "test-client-id",
      "test-client-secret",
      "live",
      "BEN_TEST_1",
      {
        beneficiaryName: "Test Merchant",
        accountNumber: "1234567890",
        ifsc: "HDFC0001234",
        amount: 100,
      },
      providerConfig
    );

    const postCalls = calls.filter((c) => c.method === "POST");
    assert.equal(postCalls.length, 1, "expected exactly one POST create call");
    assert.equal(
      postCalls[0]!.url,
      "https://api.cashfree.com/payout/beneficiary",
      "create call must hit exactly POST {baseUrl}/beneficiary"
    );
    assert.equal(result.ok, true);
  });

  it("flags a CREATE-stage 404 as likelyEndpointOrPayloadIssue, and never as a normal beneficiary_not_found", async () => {
    const providerConfig: PayoutProviderConfig = {
      baseUrl: "https://api.cashfree.com/payout",
      apiVersion: "2024-01-01",
    };

    global.fetch = (async (input: any, init: any) => {
      const url = typeof input === "string" ? input : input.url;
      calls.push({ url, method: init?.method ?? "GET" });
      return new Response(
        JSON.stringify({ subCode: "beneficiary_not_found", message: "does not exist" }),
        { status: 404 }
      );
    }) as typeof fetch;

    const result = await cashfreePayoutEnsureBeneficiary(
      "test-client-id",
      "test-client-secret",
      "live",
      "BEN_TEST_2",
      {
        beneficiaryName: "Test Merchant",
        accountNumber: "1234567890",
        ifsc: "HDFC0001234",
        amount: 100,
      },
      providerConfig
    );

    assert.equal(result.ok, false);
    assert.equal(result.stage, "create");
    assert.equal(result.likelyEndpointOrPayloadIssue, true);
    assert.equal(result.endpointPath, "/beneficiary");

    const postCalls = calls.filter((c) => c.method === "POST");
    assert.equal(postCalls.length, 1);
    assert.equal(postCalls[0]!.url, "https://api.cashfree.com/payout/beneficiary");
  });
});
