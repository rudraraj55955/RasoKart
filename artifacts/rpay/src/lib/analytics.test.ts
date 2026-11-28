import assert from "node:assert/strict";
import test from "node:test";
import {
  PROVIDER_SUCCESS_ANALYTICS_EVENTS,
  PROVIDER_SUCCESS_SMOKE_MARKER,
  providerSuccessAnalyticsData,
  trackEvent,
  trackProviderConnectionSucceeded,
  trackProviderTestSucceeded,
} from "./analytics";

test("trackEvent forwards safe event data to Umami", () => {
  const calls: unknown[][] = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { umami: { track: (...args: unknown[]) => calls.push(args) } },
  });

  trackEvent("merchant_api_key_created", { has_label: true });

  assert.deepEqual(calls, [["merchant_api_key_created", { has_label: true }]]);
  Reflect.deleteProperty(globalThis, "window");
});

test("trackEvent does not throw when the tracker is unavailable", () => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {},
  });

  assert.doesNotThrow(() => trackEvent("merchant_quick_action_clicked"));
  Reflect.deleteProperty(globalThis, "window");
});

test("trackEvent contains tracker failures", () => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      umami: {
        track: () => {
          throw new Error("tracker unavailable");
        },
      },
    },
  });

  assert.doesNotThrow(() => trackEvent("merchant_webhook_saved"));
  Reflect.deleteProperty(globalThis, "window");
});

test("provider setup helpers send only coarse provider, method, and outcome properties", () => {
  const calls: unknown[][] = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { umami: { track: (...args: unknown[]) => calls.push(args) } },
  });

  trackProviderConnectionSucceeded("pinelabs_one", "otp");
  trackProviderTestSucceeded("razorpay", "api_key");

  assert.deepEqual(calls, [
    [
      "provider_connection_succeeded",
      { provider: "pinelabs_one", method: "otp", outcome: "success" },
    ],
    [
      "provider_test_succeeded",
      { provider: "razorpay", method: "api_key", outcome: "success" },
    ],
  ]);
  Reflect.deleteProperty(globalThis, "window");
});

test("exports provider analytics contract used by production analytics smoke tests", () => {
  assert.deepEqual(PROVIDER_SUCCESS_ANALYTICS_EVENTS, {
    connection: "provider_connection_succeeded",
    test: "provider_test_succeeded",
  });
  assert.deepEqual(PROVIDER_SUCCESS_SMOKE_MARKER, { is_smoke_test: true });
  assert.deepEqual(providerSuccessAnalyticsData("razorpay", "api_key"), {
    provider: "razorpay",
    method: "api_key",
    outcome: "success",
  });
});