import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../pages/merchant/connect.tsx", import.meta.url),
  "utf8",
);

function functionBody(name: string, nextName: string): string {
  const start = source.indexOf(`async function ${name}()`);
  const end = source.indexOf(`async function ${nextName}()`, start + 1);
  assert.notEqual(start, -1, `${name} must exist`);
  assert.notEqual(end, -1, `${nextName} must follow ${name}`);
  return source.slice(start, end);
}

test("pending-review credential submissions are not tracked as connected", () => {
  const body = functionBody(
    "handleSubmitCredentials",
    "handleNewAccountContinue",
  );

  assert.doesNotMatch(body, /trackProviderConnectionSucceeded/);
  assert.match(body, /under review/);
});

test("confirmed portal connection paths track their coarse completion method", () => {
  const expectedCalls = [
    `trackProviderConnectionSucceeded("razorpay", "api_key")`,
    `trackProviderConnectionSucceeded("paytm_merchant", "otp")`,
    `trackProviderConnectionSucceeded("paytm_merchant", "mpin")`,
    `trackProviderConnectionSucceeded("paytm_merchant", "password")`,
    `trackProviderConnectionSucceeded("paytm_merchant", "session_reconnect")`,
    `trackProviderConnectionSucceeded("pinelabs_one", "otp")`,
    `trackProviderConnectionSucceeded("pinelabs_one", "mpin")`,
    `trackProviderConnectionSucceeded("pinelabs_one", "password")`,
    `trackProviderConnectionSucceeded("pinelabs_one", "session_reconnect")`,
  ];

  for (const call of expectedCalls) {
    assert.ok(source.includes(call), `missing analytics call: ${call}`);
  }
  assert.match(
    source,
    /if \(result\.status === "CONNECTED"\) \{\s*trackProviderTestSucceeded\("razorpay", "api_key"\);\s*trackProviderConnectionSucceeded\("razorpay", "api_key"\);/,
  );
});