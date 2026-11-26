/**
 * Pine Labs ONE connection-test safety guard
 *
 * Verifies that valid-format partner credentials NEVER return pass:true from
 * runProviderTest("pinelabs_one"). This ensures the platform-connections test
 * route cannot auto-promote a pinelabs_one connection to "active" status until
 * a real live partner API test is wired in (Task #2726 / developer.pinelabs.com).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runProviderTest } from "./connectionTest.js";

describe("runProviderTest — pinelabs_one safety invariant", () => {
  it("returns pass:false when credentials are absent", async () => {
    const result = await runProviderTest("pinelabs_one", null);
    assert.equal(result.pass, false, "empty credentials must not pass");
  });

  it("returns pass:false when credentials are empty JSON", async () => {
    const result = await runProviderTest("pinelabs_one", "{}");
    assert.equal(result.pass, false, "empty JSON must not pass");
  });

  it("returns pass:false even with well-formed partner_api_key + partner_api_secret", async () => {
    const creds = JSON.stringify({
      partner_api_key: "plone_live_partner_key_abc123",
      partner_api_secret: "plone_live_partner_secret_xyz987",
    });
    const result = await runProviderTest("pinelabs_one", creds);
    // Must NEVER return pass:true — doing so would allow the platform-connections
    // test route to promote the connection to "active" without a real network test.
    assert.equal(
      result.pass,
      false,
      "valid-format credentials must NOT return pass:true (format check only — live API not yet wired)"
    );
    assert.ok(result.message.length > 0, "must include a descriptive message");
    assert.ok(
      result.detail && result.detail.includes("developer.pinelabs.com"),
      "detail must reference developer.pinelabs.com so the admin knows where to get partner docs"
    );
  });

  it("returns pass:false with alternative api_key/api_secret field names", async () => {
    const creds = JSON.stringify({
      api_key: "plone_key",
      api_secret: "plone_secret",
    });
    const result = await runProviderTest("pinelabs_one", creds);
    assert.equal(result.pass, false, "alternative field names must also not pass");
  });

  it("returns pass:false for invalid JSON credentials", async () => {
    const result = await runProviderTest("pinelabs_one", "not-valid-json");
    assert.equal(result.pass, false, "invalid JSON must return pass:false");
  });
});
