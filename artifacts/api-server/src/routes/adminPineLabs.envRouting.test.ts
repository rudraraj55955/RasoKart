/**
 * adminPineLabs.envRouting.test.ts
 *
 * Confirms that the route's env-selection logic correctly maps
 * `provider_integrations.environment` values to the Pine Labs
 * UAT or live endpoint URLs.
 *
 * Coverage chain:
 *   row.environment  ──→  selectPineLabsEnv()  ──→  verifyPineLabsUatCredentials(env)
 *                                                         │
 *                                                   mock fetchFn captures URL
 *                                                         │
 *                                               assert correct Pine Labs hostname
 *
 * This test is fully hermetic:
 *   - No DB reads or writes (selectPineLabsEnv is a pure function).
 *   - No network calls (verifyPineLabsUatCredentials uses injected mockFetch).
 *   - No credential storage side-effects.
 *
 * The URL routing for the helper itself (env → URL) is also covered
 * independently in helpers/pineLabsVerify.test.ts; these tests confirm
 * the ROUTE's env-selection logic drives the correct env value.
 *
 * Run:
 *   cd artifacts/api-server && node --import tsx/esm --test \
 *     src/routes/adminPineLabs.envRouting.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { selectPineLabsEnv } from "./adminPineLabs.js";
import { verifyPineLabsUatCredentials } from "../helpers/pineLabsVerify.js";

// ── URL constants (mirrors the unexported consts in pineLabsVerify.ts) ────────
const PINE_LABS_UAT_URL  = "https://uat.pinepg.in/api/v2/inquiry";
const PINE_LABS_LIVE_URL = "https://api.pinepg.in/api/v2/inquiry";

// Dummy credential values — never real credentials.
const MID         = "TEST_MID_000";
const ACCESS_CODE = "TEST_ACCESS_CODE";
const SECRET_KEY  = "TEST_SECRET_KEY";

/** Build a mock fetch that captures the URL it is called with and returns
 *  a synthetic Pine Labs "order not found" (code 227) response. */
function makeMockFetch(capturedUrls: string[]): typeof globalThis.fetch {
  return async (url: string | URL | Request, _init?: RequestInit) => {
    capturedUrls.push(typeof url === "string" ? url : url.toString());
    return new Response(
      JSON.stringify({ ppc_ResponseCode: "227", ppc_ResponseMessage: "Order not found" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
}

// ── selectPineLabsEnv: pure env-selection logic ───────────────────────────────

describe("selectPineLabsEnv — route env-selection logic", () => {

  it('PL-ENV-SEL-1: returns "live" when row.environment is "live"', () => {
    assert.equal(selectPineLabsEnv("live"), "live");
  });

  it('PL-ENV-SEL-2: returns "uat" when row.environment is "test"', () => {
    assert.equal(selectPineLabsEnv("test"), "uat");
  });

  it('PL-ENV-SEL-3: returns "uat" when row.environment is null', () => {
    assert.equal(selectPineLabsEnv(null), "uat");
  });

  it('PL-ENV-SEL-4: returns "uat" when row.environment is undefined', () => {
    assert.equal(selectPineLabsEnv(undefined), "uat");
  });

  it('PL-ENV-SEL-5: returns "uat" for any other string (e.g. "sandbox")', () => {
    assert.equal(selectPineLabsEnv("sandbox"), "uat");
  });

  it('PL-ENV-SEL-6: comparison is exact — "LIVE" (uppercase) returns "uat" (safe default)', () => {
    assert.equal(selectPineLabsEnv("LIVE"), "uat");
  });

});

// ── End-to-end chain: row.environment → selectPineLabsEnv → URL ──────────────
//
// These tests exercise the FULL chain: the same mapping used by the route
// handler is fed into verifyPineLabsUatCredentials (via injected mock fetch).
// The captured outbound URL proves the correct Pine Labs endpoint is targeted.

describe("row.environment → selectPineLabsEnv → outbound URL (full chain)", () => {

  it("PL-ENV-CHAIN-1: row.environment='live' routes probe to api.pinepg.in (Live endpoint)", async () => {
    const capturedUrls: string[] = [];
    const env = selectPineLabsEnv("live");       // same call the route makes
    const result = await verifyPineLabsUatCredentials(
      MID, ACCESS_CODE, SECRET_KEY, env,
      makeMockFetch(capturedUrls),
    );

    assert.equal(capturedUrls.length, 1, "mock fetch must be called exactly once");
    assert.equal(
      capturedUrls[0],
      PINE_LABS_LIVE_URL,
      `live environment must route to ${PINE_LABS_LIVE_URL}; got ${capturedUrls[0]}`,
    );
    assert.equal(result.environment, "live", "result.environment must echo 'live'");
  });

  it("PL-ENV-CHAIN-2: row.environment='test' routes probe to uat.pinepg.in (UAT endpoint)", async () => {
    const capturedUrls: string[] = [];
    const env = selectPineLabsEnv("test");       // same call the route makes
    const result = await verifyPineLabsUatCredentials(
      MID, ACCESS_CODE, SECRET_KEY, env,
      makeMockFetch(capturedUrls),
    );

    assert.equal(capturedUrls.length, 1, "mock fetch must be called exactly once");
    assert.equal(
      capturedUrls[0],
      PINE_LABS_UAT_URL,
      `test environment must route to ${PINE_LABS_UAT_URL}; got ${capturedUrls[0]}`,
    );
    assert.equal(result.environment, "uat", "result.environment must echo 'uat'");
  });

  it("PL-ENV-CHAIN-3: row.environment=null routes probe to uat.pinepg.in (safe UAT default)", async () => {
    const capturedUrls: string[] = [];
    const env = selectPineLabsEnv(null);
    await verifyPineLabsUatCredentials(
      MID, ACCESS_CODE, SECRET_KEY, env,
      makeMockFetch(capturedUrls),
    );

    assert.equal(capturedUrls[0], PINE_LABS_UAT_URL,
      "null environment must safely default to UAT endpoint");
  });

});
