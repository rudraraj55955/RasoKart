/**
 * paytm-otp-double-tap-guard.spec.ts
 *
 * Regression guard: fast double-taps on the "Verify OTP" button in
 * PaytmMerchantPortalCard must not fire two POST requests to
 * /api/merchant/portal-sessions/paytm_merchant/submit-step.
 *
 * The guard is a ref-based synchronous check (`submittingOtpRef`) in
 * handleSubmitOtp that short-circuits before React re-renders, making
 * the handler truly non-reentrant even on rapid successive calls.
 *
 * Strategy
 * ────────
 * 1. Intercept the initiate endpoint and return AWAITING_OTP so the UI
 *    transitions to the OTP entry step without hitting the real adapter.
 * 2. Intercept submit-step with a ~2-second artificial delay.  During
 *    that window the button shows "Verifying…" and is `disabled`, but
 *    the ref guard fires synchronously BEFORE React sets `disabled`,
 *    protecting against cases where the second click lands before the
 *    first re-render.
 * 3. Click "Verify OTP", then immediately click again with `force: true`
 *    to bypass Playwright's built-in actionability checks.  A third
 *    attempt via Enter confirms the keyboard path is also guarded.
 * 4. Assert exactly ONE submit-step request was received.
 *
 * All network calls are fully mocked — no real Paytm portal or
 * Playwright adapter run is involved.
 */

import { test, expect, type Page, type Route } from "@playwright/test";
import { readCachedMerchantToken } from "./token-cache";

const LS_TOKEN_KEY = "rasokart_token";

// ── fake API responses ────────────────────────────────────────────────────────

/** Providers list containing paytm_merchant so the portal card renders. */
const FAKE_PROVIDERS = {
  data: [
    {
      id: 901,
      slug: "paytm_merchant",
      name: "Paytm Business",
      category: "upi",
      description: "Paytm Business portal connector",
      status: "live",
    },
  ],
};

/** Initiate result — adapter returns AWAITING_OTP directly for mobile login. */
const FAKE_INITIATE_AWAITING_OTP = {
  status:   "AWAITING_OTP",
  message:  "OTP sent to your Paytm-registered mobile.",
  nextStep: "ENTER_OTP",
  helpUrl:  null,
};

/** A generic in-flight submit-step response (returned after the delay). */
const FAKE_SUBMIT_RESULT = {
  status:  "FAILED",
  message: "Invalid OTP — test sentinel response.",
};

// ── helpers ───────────────────────────────────────────────────────────────────

async function goToConnect(page: Page, merchantToken: string): Promise<void> {
  await page.goto("/merchant");
  await page.evaluate(
    ([key, tok]) => { localStorage.setItem(key, tok); },
    [LS_TOKEN_KEY, merchantToken],
  );
  await page.goto("/merchant/connect");
  await page.waitForLoadState("networkidle");
}

/**
 * Wire all portal-session routes.
 * `counters.submitStep` is incremented for every POST that reaches the
 * handler, so the test can assert it stayed at 1 after double-tapping.
 */
async function mockRoutes(
  page: Page,
  counters: { initiate: number; submitStep: number },
  submitStepDelayMs = 0,
): Promise<void> {
  // Providers list
  await page.route("**/api/providers*", async (route: Route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status:      200,
        contentType: "application/json",
        body:        JSON.stringify(FAKE_PROVIDERS),
      });
    } else {
      await route.continue();
    }
  });

  // Portal sessions list — return an empty list so the card starts at the
  // initial "mobile" step (no existing session).
  await page.route("**/api/merchant/portal-sessions", async (route: Route) => {
    await route.fulfill({
      status:      200,
      contentType: "application/json",
      body:        JSON.stringify({ sessions: [] }),
    });
  });

  // Enrollments list — not relevant but prevents a 401 noise error.
  await page.route("**/api/merchant/enrollments*", async (route: Route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status:      200,
        contentType: "application/json",
        body:        JSON.stringify([]),
      });
    } else {
      await route.continue();
    }
  });

  // Initiate endpoint
  await page.route(
    "**/api/merchant/portal-sessions/paytm_merchant/initiate",
    async (route: Route) => {
      counters.initiate += 1;
      await route.fulfill({
        status:      200,
        contentType: "application/json",
        body:        JSON.stringify(FAKE_INITIATE_AWAITING_OTP),
      });
    },
  );

  // Submit-step endpoint — delayed so the second tap lands while in-flight.
  await page.route(
    "**/api/merchant/portal-sessions/paytm_merchant/submit-step",
    async (route: Route) => {
      counters.submitStep += 1;
      if (submitStepDelayMs > 0) {
        await new Promise<void>(r => setTimeout(r, submitStepDelayMs));
      }
      await route.fulfill({
        status:      200,
        contentType: "application/json",
        body:        JSON.stringify(FAKE_SUBMIT_RESULT),
      });
    },
  );
}

// ── token ─────────────────────────────────────────────────────────────────────

let merchantToken: string;

test.beforeAll(() => {
  merchantToken = readCachedMerchantToken();
});

// ── tests ─────────────────────────────────────────────────────────────────────

test(
  "Verify OTP button is disabled while submission is in-flight",
  async ({ page }) => {
    const counters = { initiate: 0, submitStep: 0 };
    const DELAY = 2_000;
    await mockRoutes(page, counters, DELAY);
    await goToConnect(page, merchantToken);

    // Locate the Paytm card
    await expect(
      page.locator("text=Paytm Business Merchant Connector").first(),
    ).toBeVisible({ timeout: 15_000 });

    // Enter a mobile number and send the initiate request
    const mobileInput = page.getByPlaceholder(
      "Mobile or email registered with Paytm Business",
    );
    await expect(mobileInput).toBeVisible();
    await mobileInput.fill("9876543210");
    await page.getByRole("button", { name: /Connect Paytm Business/ }).click();

    // The card must transition to the OTP step
    await expect(
      page.getByText("OTP Sent").first(),
    ).toBeVisible({ timeout: 10_000 });
    expect(counters.initiate).toBe(1);

    // Fill a valid-length OTP so the button becomes enabled
    const otpInput = page.getByPlaceholder("••••••");
    await otpInput.fill("123456");

    // Two locators: one for the idle state, one for the in-flight state
    const verifyBtnReady    = page.getByRole("button", { name: /^Verify OTP$/i });
    const verifyBtnInFlight = page.getByRole("button", { name: /Verifying…/i });

    // Sanity: button must be enabled before the first click
    await expect(verifyBtnReady).toBeEnabled({ timeout: 4_000 });

    // First click — starts the submission
    await verifyBtnReady.click();

    // While the delayed response is pending the button must switch to
    // "Verifying…" and be disabled
    await expect(verifyBtnInFlight).toBeVisible({ timeout: 2_000 });
    await expect(verifyBtnInFlight).toBeDisabled({ timeout: 2_000 });

    // After the response lands the button reverts to its idle label
    await expect(verifyBtnReady).toBeEnabled({
      timeout: DELAY + 4_000,
    });
    await expect(verifyBtnInFlight).not.toBeVisible({ timeout: 2_000 });

    // Exactly one request must have been sent
    expect(counters.submitStep).toBe(1);
  },
);

test(
  "Fast double-tap and Enter presses while in-flight send only one submit-step request",
  async ({ page }) => {
    const counters = { initiate: 0, submitStep: 0 };
    // 2-second delay keeps the request in-flight while we fire the extra taps.
    const DELAY = 2_000;
    await mockRoutes(page, counters, DELAY);
    await goToConnect(page, merchantToken);

    await expect(
      page.locator("text=Paytm Business Merchant Connector").first(),
    ).toBeVisible({ timeout: 15_000 });

    // Enter mobile and initiate
    const mobileInput = page.getByPlaceholder(
      "Mobile or email registered with Paytm Business",
    );
    await mobileInput.fill("9876543210");
    await page.getByRole("button", { name: /Connect Paytm Business/ }).click();
    await expect(
      page.getByText("OTP Sent").first(),
    ).toBeVisible({ timeout: 10_000 });

    // Fill a valid-length OTP so the guard doesn't exit early on length
    const otpInput = page.getByPlaceholder("••••••");
    await otpInput.fill("123456");

    const verifyBtnReady    = page.getByRole("button", { name: /^Verify OTP$/i });
    const verifyBtnInFlight = page.getByRole("button", { name: /Verifying…/i });

    await expect(verifyBtnReady).toBeEnabled({ timeout: 4_000 });

    // ── Tap 1: normal click — starts the first (and only) submit-step call ───
    await verifyBtnReady.click();

    // Confirm in-flight state before the extra taps
    await expect(verifyBtnInFlight).toBeVisible({ timeout: 2_000 });

    // ── Tap 2: force-click the disabled in-flight button ────────────────────
    // `force: true` bypasses Playwright's actionability checks, simulating a
    // second DOM click that would reach the handler if the ref guard were absent.
    await verifyBtnInFlight.click({ force: true });

    // ── Tap 3 & 4: keyboard Enter while in-flight ────────────────────────────
    await otpInput.press("Enter");
    await otpInput.press("Enter");

    // Wait for the delayed response to resolve
    await page.waitForTimeout(DELAY + 1_000);

    // The ref guard must have blocked taps 2–4: only ONE request sent.
    expect(counters.submitStep).toBe(1);
  },
);
