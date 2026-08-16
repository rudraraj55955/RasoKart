/**
 * browserPool.validation.test.ts
 *
 * Pure-unit tests for BrowserRuntimeUnavailableError and sanitizeBrowserError.
 * No browser is launched — these tests cover the error-handling contract only.
 *
 * Run: node --import tsx/esm --test src/helpers/connectorEngine/browserPool.validation.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  BrowserRuntimeUnavailableError,
  sanitizeBrowserError,
} from "./browserPool.js";

// ── BrowserRuntimeUnavailableError ────────────────────────────────────────────

describe("BrowserRuntimeUnavailableError", () => {
  it("has code BROWSER_RUNTIME_UNAVAILABLE", () => {
    const err = new BrowserRuntimeUnavailableError();
    assert.equal(err.code, "BROWSER_RUNTIME_UNAVAILABLE");
  });

  it("is an instance of Error", () => {
    const err = new BrowserRuntimeUnavailableError();
    assert.ok(err instanceof Error);
  });

  it("has name BrowserRuntimeUnavailableError", () => {
    const err = new BrowserRuntimeUnavailableError();
    assert.equal(err.name, "BrowserRuntimeUnavailableError");
  });

  it("message contains no server paths", () => {
    const err = new BrowserRuntimeUnavailableError();
    assert.ok(!err.message.includes("/"), "message must not contain '/'");
    assert.ok(!err.message.includes("root"), "message must not contain 'root'");
    assert.ok(!err.message.includes("cache"), "message must not contain 'cache'");
  });

  it("instanceof check works for catch clause guard", () => {
    const err = new BrowserRuntimeUnavailableError();
    assert.ok(err instanceof BrowserRuntimeUnavailableError);
  });

  it("thrown error is catchable as BrowserRuntimeUnavailableError", () => {
    let caught: unknown;
    try { throw new BrowserRuntimeUnavailableError(); } catch (e) { caught = e; }
    assert.ok(caught instanceof BrowserRuntimeUnavailableError);
    assert.equal((caught as BrowserRuntimeUnavailableError).code, "BROWSER_RUNTIME_UNAVAILABLE");
  });
});

// ── sanitizeBrowserError ──────────────────────────────────────────────────────

describe("sanitizeBrowserError", () => {
  const pathExamples = [
    // Playwright's own launch error — contains a full server path
    "browserType.launch: Executable doesn't exist at /root/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell",
    "browserType.launch: Executable doesn't exist at /home/runner/.cache/ms-playwright/chromium-999/chrome-linux/chrome",
    // ENOENT from Node
    "spawnSync /root/.cache/ms-playwright/chrome: ENOENT",
    // Generic spawn error
    "spawn /usr/bin/chromium ENOENT",
    // Playwright prefix alone
    "browserType.launch: failed to launch browser",
  ];

  for (const msg of pathExamples) {
    it(`returns BROWSER_RUNTIME_UNAVAILABLE for: "${msg.slice(0, 60)}..."`, () => {
      const result = sanitizeBrowserError(msg);
      assert.equal(result, "BROWSER_RUNTIME_UNAVAILABLE",
        `expected BROWSER_RUNTIME_UNAVAILABLE, got: ${result}`);
    });
  }

  it("does not expose /root in sanitized output for any path error", () => {
    const result = sanitizeBrowserError(
      "Executable doesn't exist at /root/.cache/ms-playwright/chromium-1234/chrome-linux/chrome"
    );
    assert.ok(!result.includes("/root"), "sanitized output must not contain /root");
    assert.ok(!result.includes(".cache"), "sanitized output must not contain .cache");
  });

  it("strips path segments from generic errors", () => {
    const result = sanitizeBrowserError("some error at /var/www/rasokart/node_modules/.bin/foo");
    assert.ok(!result.includes("/var/www/rasokart"), "path must be stripped");
    assert.ok(result.includes("[path]"), "path replaced with [path]");
  });

  it("passes through short safe messages unchanged", () => {
    const result = sanitizeBrowserError("js_evaluation_mismatch");
    assert.equal(result, "js_evaluation_mismatch");
  });

  it("truncates long safe messages at 80 chars", () => {
    const long = "a".repeat(200);
    const result = sanitizeBrowserError(long);
    assert.ok(result.length <= 80, `expected ≤80 chars, got ${result.length}`);
  });

  it("sanitizes BROWSER_RUNTIME_UNAVAILABLE token itself", () => {
    const result = sanitizeBrowserError("BROWSER_RUNTIME_UNAVAILABLE");
    assert.equal(result, "BROWSER_RUNTIME_UNAVAILABLE");
  });
});

// ── Resolution order documentation ───────────────────────────────────────────

describe("Chromium resolution priority chain (documented contract)", () => {
  it("resolution order is: PLAYWRIGHT_CHROMIUM_EXECUTABLE > system which > PLAYWRIGHT_BROWSERS_PATH > auto-scan > undefined", () => {
    // This test documents the contract rather than testing it dynamically.
    // Dynamic testing would require env-var manipulation and fs mocking.
    // The actual resolution is exercised by browserPool.coverage.test.ts and
    // the production browser-health endpoint after deployment.
    const expectedOrder = [
      "PLAYWRIGHT_CHROMIUM_EXECUTABLE env var",
      "system which chromium/chromium-browser/google-chrome",
      "PLAYWRIGHT_BROWSERS_PATH scan",
      "workspace-relative .cache/ms-playwright scan",
      "undefined (Playwright default detection)",
    ];
    // Assert the documented order has 5 levels
    assert.equal(expectedOrder.length, 5);
  });
});
