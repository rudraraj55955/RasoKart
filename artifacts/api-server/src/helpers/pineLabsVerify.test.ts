/**
 * Deterministic unit tests for verifyPineLabsUatCredentials.
 *
 * All HTTP calls are mocked — no network access, no DB dependency.
 * Covers every branch of the fail-closed pass/fail contract.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { verifyPineLabsUatCredentials } from "./pineLabsVerify";

// ── Mock helpers ──────────────────────────────────────────────────────────────

/** Build a mock fetch that returns a fixed HTTP response. */
function mockFetch(status: number, body: unknown): typeof globalThis.fetch {
  return async (_url: string | URL | Request, _init?: RequestInit) => {
    const bodyStr = typeof body === "string" ? body : JSON.stringify(body);
    return new Response(bodyStr, {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
}

/** Mock fetch that throws a network error (e.g. DNS failure). */
function networkErrorFetch(message = "fetch failed"): typeof globalThis.fetch {
  return async () => { throw new TypeError(message); };
}

/** Mock fetch that throws an AbortError (timeout). */
function timeoutFetch(): typeof globalThis.fetch {
  return async () => {
    const err = new DOMException("The operation was aborted.", "AbortError");
    throw err;
  };
}

// Valid (dummy) credential values — never real credentials.
const MID         = "123456";
const ACCESS_CODE = "ABCD-ACCESS-CODE-VALID";
const SECRET_KEY  = "ABCD-SECRET-KEY-VALID-XYZ";

// ── Request-contract helpers ──────────────────────────────────────────────────

import { createHmac } from "node:crypto";

/** Compute the expected Pine Labs HMAC for the given params (excluding ppc_RequestHashKey). */
function expectedHmac(params: Record<string, string>, secretKey: string): string {
  const input = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join("&");
  return createHmac("sha256", secretKey).update(input).digest("hex").toUpperCase();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("verifyPineLabsUatCredentials — mocked contract tests", () => {

  // ── 0. Request contract: URL, method, body encoding, HMAC signing ──────────

  it("sends POST to the live endpoint (api.pinepg.in) when env='live'", async () => {
    let capturedUrl: string | undefined;
    const captureFetch: typeof globalThis.fetch = async (url, _init) => {
      capturedUrl = typeof url === "string" ? url : url.toString();
      return new Response(JSON.stringify({ ppc_ResponseCode: "227", ppc_ResponseMessage: "NO SUCH ORDER" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const result = await verifyPineLabsUatCredentials(MID, ACCESS_CODE, SECRET_KEY, "live", captureFetch);
    assert.equal(
      capturedUrl,
      "https://api.pinepg.in/api/v2/inquiry",
      `expected api.pinepg.in live endpoint, got: ${capturedUrl}`,
    );
    assert.equal(result.pass, true);
    assert.ok(result.environment === "live", "result.environment must be 'live'");
    assert.match(result.message, /live/i);
  });

  it("sends POST to the UAT endpoint (uat.pinepg.in) when env='uat'", async () => {
    let capturedUrl: string | undefined;
    const captureFetch: typeof globalThis.fetch = async (url, _init) => {
      capturedUrl = typeof url === "string" ? url : url.toString();
      return new Response(JSON.stringify({ ppc_ResponseCode: "227", ppc_ResponseMessage: "NO SUCH ORDER" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const result = await verifyPineLabsUatCredentials(MID, ACCESS_CODE, SECRET_KEY, "uat", captureFetch);
    assert.equal(
      capturedUrl,
      "https://uat.pinepg.in/api/v2/inquiry",
      `expected uat.pinepg.in endpoint, got: ${capturedUrl}`,
    );
    assert.equal(result.pass, true);
    assert.ok(result.environment === "uat", "result.environment must be 'uat'");
  });

  it("sends POST to the correct UAT endpoint with signed ppc_ params", async () => {
    let capturedUrl: string | undefined;
    let capturedMethod: string | undefined;
    let capturedBody: Record<string, unknown> = {};

    const captureFetch: typeof globalThis.fetch = async (url, init) => {
      capturedUrl    = typeof url === "string" ? url : url.toString();
      capturedMethod = init?.method;
      try { capturedBody = JSON.parse(init?.body as string ?? "{}"); } catch { /* ignore */ }
      // Return a valid Pine Labs response so the function reaches the URL assertion
      return new Response(JSON.stringify({ ppc_ResponseCode: "227", ppc_ResponseMessage: "NO SUCH ORDER" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    await verifyPineLabsUatCredentials(MID, ACCESS_CODE, SECRET_KEY, "uat", captureFetch);

    // ── URL ──
    assert.equal(
      capturedUrl,
      "https://uat.pinepg.in/api/v2/inquiry",
      `expected uat.pinepg.in endpoint, got: ${capturedUrl}`,
    );

    // ── Method ──
    assert.equal(capturedMethod, "POST", "expected POST request");

    // ── Required body params ──
    assert.equal(String(capturedBody["ppc_MerchantID"]), MID);
    assert.equal(String(capturedBody["ppc_MerchantAccessCode"]), ACCESS_CODE);
    assert.equal(String(capturedBody["ppc_TransactionType"]), "3", "transaction type 3 = inquiry");
    assert.ok(capturedBody["ppc_MerchantOrderNo"], "ppc_MerchantOrderNo must be present");
    assert.ok(capturedBody["ppc_Amount"], "ppc_Amount must be present");
    assert.ok(capturedBody["ppc_RequestHashKey"], "ppc_RequestHashKey must be present");

    // ── HMAC: computed from alphabetically sorted params excluding hash key ──
    const { ppc_RequestHashKey, ...signedParams } = capturedBody as Record<string, string>;
    const expected = expectedHmac(signedParams, SECRET_KEY);
    assert.equal(
      String(ppc_RequestHashKey),
      expected,
      `HMAC mismatch — signing contract is wrong; got ${ppc_RequestHashKey}, expected ${expected}`,
    );
  });

  // ── 1. Pass: documented "order not found" response (code 227) ──────────────

  it("returns pass:true when Pine Labs returns code 227 (order not found — credentials accepted)", async () => {
    const result = await verifyPineLabsUatCredentials(
      MID, ACCESS_CODE, SECRET_KEY, "uat",
      mockFetch(200, { ppc_ResponseCode: "227", ppc_ResponseMessage: "NO SUCH ORDER" }),
    );
    assert.equal(result.pass, true, `expected pass:true, got: ${JSON.stringify(result)}`);
    assert.ok(result.message.length > 0);
    assert.ok(result.detail.length > 0);
  });

  it("returns pass:true when Pine Labs returns code 1 (success)", async () => {
    const result = await verifyPineLabsUatCredentials(
      MID, ACCESS_CODE, SECRET_KEY, "uat",
      mockFetch(200, { ppc_ResponseCode: "1", ppc_ResponseMessage: "SUCCESS" }),
    );
    assert.equal(result.pass, true);
  });

  it("returns pass:true when Pine Labs returns code 228 (order completed)", async () => {
    const result = await verifyPineLabsUatCredentials(
      MID, ACCESS_CODE, SECRET_KEY, "uat",
      mockFetch(200, { ppc_ResponseCode: "228", ppc_ResponseMessage: "DUPLICATE ORDER" }),
    );
    assert.equal(result.pass, true);
  });

  // ── 2. Fail: documented auth-error response codes ─────────────────────────

  it("returns pass:false for code 234 (invalid hash / wrong Secret Key)", async () => {
    const result = await verifyPineLabsUatCredentials(
      MID, ACCESS_CODE, SECRET_KEY, "uat",
      mockFetch(200, { ppc_ResponseCode: "234", ppc_ResponseMessage: "INVALID HASH" }),
    );
    assert.equal(result.pass, false);
    assert.match(result.message, /rejected/i);
    assert.match(result.detail, /secret key/i);
  });

  it("returns pass:false for code 235 (invalid Access Code)", async () => {
    const result = await verifyPineLabsUatCredentials(
      MID, ACCESS_CODE, SECRET_KEY, "uat",
      mockFetch(200, { ppc_ResponseCode: "235", ppc_ResponseMessage: "INVALID ACCESS CODE" }),
    );
    assert.equal(result.pass, false);
    assert.match(result.detail, /access code/i);
  });

  it("returns pass:false for code 236 (invalid Merchant ID)", async () => {
    const result = await verifyPineLabsUatCredentials(
      MID, ACCESS_CODE, SECRET_KEY, "uat",
      mockFetch(200, { ppc_ResponseCode: "236", ppc_ResponseMessage: "INVALID MERCHANT" }),
    );
    assert.equal(result.pass, false);
    assert.match(result.detail, /merchant id/i);
  });

  it("returns pass:false for code 300 (authentication failed)", async () => {
    const result = await verifyPineLabsUatCredentials(
      MID, ACCESS_CODE, SECRET_KEY, "uat",
      mockFetch(200, { ppc_ResponseCode: "300", ppc_ResponseMessage: "AUTH FAILED" }),
    );
    assert.equal(result.pass, false);
  });

  it("returns pass:false for code 301 (transaction not permitted)", async () => {
    const result = await verifyPineLabsUatCredentials(
      MID, ACCESS_CODE, SECRET_KEY, "uat",
      mockFetch(200, { ppc_ResponseCode: "301", ppc_ResponseMessage: "NOT PERMITTED" }),
    );
    assert.equal(result.pass, false);
  });

  // ── 3. Fail-closed: unknown HTTP 200 payloads ─────────────────────────────

  it("returns pass:false for HTTP 200 with an unrecognised response code (fail-closed)", async () => {
    const result = await verifyPineLabsUatCredentials(
      MID, ACCESS_CODE, SECRET_KEY, "uat",
      mockFetch(200, { ppc_ResponseCode: "999", ppc_ResponseMessage: "SOME UNKNOWN STATUS" }),
    );
    assert.equal(result.pass, false, `unknown code 999 must not silently pass: ${JSON.stringify(result)}`);
    assert.match(result.detail, /unrecognised response code/i);
  });

  it("returns pass:false for HTTP 200 with missing ppc_ResponseCode (wrong endpoint / gateway page)", async () => {
    const result = await verifyPineLabsUatCredentials(
      MID, ACCESS_CODE, SECRET_KEY, "uat",
      mockFetch(200, { message: "OK", status: "success" }),
    );
    assert.equal(result.pass, false, `missing ppc_ResponseCode must not pass: ${JSON.stringify(result)}`);
    assert.match(result.detail, /unrecognised response format|missing ppc_ResponseCode/i);
  });

  it("returns pass:false for HTTP 200 with an empty JSON body {}", async () => {
    const result = await verifyPineLabsUatCredentials(
      MID, ACCESS_CODE, SECRET_KEY, "uat",
      mockFetch(200, {}),
    );
    assert.equal(result.pass, false);
  });

  it("returns pass:false for HTTP 200 with a non-JSON body", async () => {
    const fetch = async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response("<html>Gateway Error</html>", { status: 200 });
    const result = await verifyPineLabsUatCredentials(MID, ACCESS_CODE, SECRET_KEY, "uat", fetch as any);
    assert.equal(result.pass, false);
    assert.match(result.detail, /unrecognised response format/i);
  });

  // ── 4. Fail: non-200 HTTP responses ──────────────────────────────────────

  it("returns pass:false for HTTP 401", async () => {
    const result = await verifyPineLabsUatCredentials(
      MID, ACCESS_CODE, SECRET_KEY, "uat", mockFetch(401, {}),
    );
    assert.equal(result.pass, false);
    assert.match(result.detail, /401/);
  });

  it("returns pass:false for HTTP 403", async () => {
    const result = await verifyPineLabsUatCredentials(
      MID, ACCESS_CODE, SECRET_KEY, "uat", mockFetch(403, {}),
    );
    assert.equal(result.pass, false);
    assert.match(result.detail, /403/);
  });

  it("returns pass:false for HTTP 400", async () => {
    const result = await verifyPineLabsUatCredentials(
      MID, ACCESS_CODE, SECRET_KEY, "uat", mockFetch(400, {}),
    );
    assert.equal(result.pass, false);
    assert.match(result.detail, /400/);
  });

  it("returns pass:false for HTTP 500", async () => {
    const result = await verifyPineLabsUatCredentials(
      MID, ACCESS_CODE, SECRET_KEY, "uat", mockFetch(500, {}),
    );
    assert.equal(result.pass, false);
    assert.match(result.detail, /500/);
  });

  it("returns pass:false for HTTP 503", async () => {
    const result = await verifyPineLabsUatCredentials(
      MID, ACCESS_CODE, SECRET_KEY, "uat", mockFetch(503, {}),
    );
    assert.equal(result.pass, false);
  });

  // ── 5. Fail: network / timeout ────────────────────────────────────────────

  it("returns pass:false on a network error (e.g. DNS failure)", async () => {
    const result = await verifyPineLabsUatCredentials(
      MID, ACCESS_CODE, SECRET_KEY, "uat", networkErrorFetch("fetch failed"),
    );
    assert.equal(result.pass, false);
    assert.match(result.message, /could not reach/i);
  });

  it("returns pass:false on a timeout (AbortError)", async () => {
    const result = await verifyPineLabsUatCredentials(
      MID, ACCESS_CODE, SECRET_KEY, "uat", timeoutFetch(),
    );
    assert.equal(result.pass, false);
    assert.match(result.message, /did not respond in time/i);
  });

  // ── 6. Security: credential values never appear in any result field ────────

  it("never includes the Access Code value in any result field", async () => {
    // Test against a pass response
    const passResult = await verifyPineLabsUatCredentials(
      MID, ACCESS_CODE, SECRET_KEY, "uat",
      mockFetch(200, { ppc_ResponseCode: "227", ppc_ResponseMessage: "NO SUCH ORDER" }),
    );
    assert.ok(!passResult.message.includes(ACCESS_CODE), "message must not contain Access Code");
    assert.ok(!passResult.detail.includes(ACCESS_CODE), "detail must not contain Access Code");

    // Test against a fail response
    const failResult = await verifyPineLabsUatCredentials(
      MID, ACCESS_CODE, SECRET_KEY, "uat",
      mockFetch(200, { ppc_ResponseCode: "235", ppc_ResponseMessage: "INVALID ACCESS CODE" }),
    );
    assert.ok(!failResult.message.includes(ACCESS_CODE), "message must not contain Access Code");
    assert.ok(!failResult.detail.includes(ACCESS_CODE), "detail must not contain Access Code");
  });

  it("never includes the Secret Key value in any result field", async () => {
    const result = await verifyPineLabsUatCredentials(
      MID, ACCESS_CODE, SECRET_KEY, "uat",
      mockFetch(200, { ppc_ResponseCode: "234", ppc_ResponseMessage: "INVALID HASH" }),
    );
    assert.ok(!result.message.includes(SECRET_KEY), "message must not contain Secret Key");
    assert.ok(!result.detail.includes(SECRET_KEY), "detail must not contain Secret Key");
  });

  it("never reflects raw provider response text into detail", async () => {
    // Provider returns a message with content that should not be echoed
    const sensitiveMsg = "Error: MerchantSecret=abc123 is incorrect at line 42";
    const result = await verifyPineLabsUatCredentials(
      MID, ACCESS_CODE, SECRET_KEY, "uat",
      mockFetch(200, { ppc_ResponseCode: "234", ppc_ResponseMessage: sensitiveMsg }),
    );
    assert.ok(
      !result.detail.includes(sensitiveMsg),
      `provider response text must not be reflected into detail; got: ${result.detail}`,
    );
  });

  // ── 7. Auth-failure keyword fallback ──────────────────────────────────────

  it("returns pass:false when ppc_ResponseMessage contains an auth keyword (fallback signal)", async () => {
    // Use an unrecognised code but an auth keyword in the message
    const result = await verifyPineLabsUatCredentials(
      MID, ACCESS_CODE, SECRET_KEY, "uat",
      mockFetch(200, { ppc_ResponseCode: "999", ppc_ResponseMessage: "INVALID MERCHANT ACCESS CODE" }),
    );
    assert.equal(result.pass, false);
    // Must NOT reflect the raw message
    assert.ok(!result.detail.includes("INVALID MERCHANT ACCESS CODE"));
  });
});
