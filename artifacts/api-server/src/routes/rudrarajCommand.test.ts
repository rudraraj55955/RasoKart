import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  verifyHmac,
  isAllowedControlUrl,
  isAllowedCallbackUrl,
  SUPPORTED_COMMANDS,
} from "./rudrarajCommand";

describe("rudrarajCommand security helpers", () => {
  it("verifyHmac accepts matching sha256 signature and rejects missing/mismatched signatures", () => {
    const secret = "test-webhook-secret";
    const body = Buffer.from(JSON.stringify({ command: "health-check" }));
    const sig = `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;

    assert.equal(verifyHmac(body, sig, secret), true);
    assert.equal(verifyHmac(body, undefined, secret), false);
    assert.equal(verifyHmac(body, "", secret), false);
    assert.equal(verifyHmac(body, "sha256=deadbeef", secret), false);
  });

  it("isAllowedControlUrl enforces HTTPS in production and allows local HTTP only outside production", () => {
    assert.equal(isAllowedControlUrl("https://control.rudraraj.example", "production"), true);
    assert.equal(isAllowedControlUrl("http://control.rudraraj.example", "production"), false);
    assert.equal(isAllowedControlUrl("http://localhost:4000", "production"), false);
    assert.equal(isAllowedControlUrl("http://localhost:4000", "development"), true);
    assert.equal(isAllowedControlUrl("http://127.0.0.1:4000", "development"), true);
    assert.equal(isAllowedControlUrl("not-a-url", "development"), false);
  });

  it("isAllowedCallbackUrl restricts callbacks strictly to the configured control origin", () => {
    const controlUrl = "https://control.rudraraj.example";
    assert.equal(
      isAllowedCallbackUrl("https://control.rudraraj.example/api/tasks/complete", controlUrl, "production"),
      true,
    );
    assert.equal(
      isAllowedCallbackUrl("https://evil.example/api/tasks/complete", controlUrl, "production"),
      false,
    );
    assert.equal(
      isAllowedCallbackUrl("https://169.254.169.254/latest/meta-data", controlUrl, "production"),
      false,
    );
    assert.equal(
      isAllowedCallbackUrl("https://control.rudraraj.example/api/tasks/complete", undefined, "production"),
      false,
    );
    assert.equal(
      isAllowedCallbackUrl("http://control.rudraraj.example/api/tasks/complete", "http://control.rudraraj.example", "production"),
      false,
    );
  });

  it("SUPPORTED_COMMANDS contains only explicit safe inspection commands", () => {
    assert.equal(SUPPORTED_COMMANDS.has("health-check"), true);
    assert.equal(SUPPORTED_COMMANDS.has("status"), true);
    assert.equal(SUPPORTED_COMMANDS.has("rm -rf /"), false);
    assert.equal(SUPPORTED_COMMANDS.has("deploy"), false);
  });
});
