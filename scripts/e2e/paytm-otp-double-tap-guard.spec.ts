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
 * 3. Instrument the browser's fetch boundary so the first submit synchronously
 *    dispatches a second click while handleSubmitOtp is still re-entrant,
 *    before React can process the loading-state update.
 * 4. Assert exactly ONE submit-step request was received. This proves the
 *    synchronous ref—not the asynchronous React loading state—blocks the
 *    second tap.
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

    // The provider display name can be configured, so anchor the card on its
    // stable Paytm-specific identifier input instead of a marketing label.
    const mobileInput = page.getByPlaceholder(
      "Mobile or email registered with Paytm Business",
    );
    await expect(mobileInput).toBeVisible({ timeout: 15_000 });
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

    // OTPs are wiped after every submission attempt, so the idle button returns
    // disabled until the merchant enters a fresh code.
    await expect(otpInput).toHaveValue("", {
      timeout: DELAY + 4_000,
    });
    await expect(verifyBtnReady).toBeDisabled();
    await expect(verifyBtnInFlight).not.toBeVisible({ timeout: 2_000 });

    // Exactly one request must have been sent
    expect(counters.submitStep).toBe(1);
  },
);

test(
  "Re-entrant double-tap on Verify OTP sends only one submit-step request",
  async ({ page }) => {
    const counters = { initiate: 0, submitStep: 0 };
    // The delayed response keeps the first request in flight while the
    // re-entrant second click is dispatched at the fetch boundary below.
    const DELAY = 2_000;
    // Install before navigation so the app module uses the instrumented request
    // boundary. It stays inert until the OTP form has been prepared.
    await page.addInitScript(() => {
      const testWindow = window as Window & {
        __paytmOtpReentrantEnabled?: boolean;
        __paytmOtpReentrantDispatch?: number;
      };
      testWindow.__paytmOtpReentrantEnabled = false;
      testWindow.__paytmOtpReentrantDispatch = 0;
      const originalFetch = window.fetch.bind(window);

      window.fetch = (input, init) => {
        const url = typeof input === "string"
          ? input
          : input instanceof Request
            ? input.url
            : String(input);
        if (
          testWindow.__paytmOtpReentrantEnabled &&
          url.includes("/api/merchant/portal-sessions/paytm_merchant/submit-step") &&
          testWindow.__paytmOtpReentrantDispatch === 0
        ) {
          const button = Array.from(document.querySelectorAll("button")).find(
            candidate => candidate.textContent?.trim() === "Verify OTP",
          );
          if (!button) throw new Error("Verify OTP button not found in DOM");
          testWindow.__paytmOtpReentrantDispatch = 1;
          button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        }
        return originalFetch(input, init);
      };
    });
    await mockRoutes(page, counters, DELAY);
    await goToConnect(page, merchantToken);

    const mobileInput = page.getByPlaceholder(
      "Mobile or email registered with Paytm Business",
    );
    await expect(mobileInput).toBeVisible({ timeout: 15_000 });
    await mobileInput.fill("9876543210");
    await page.getByRole("button", { name: /Connect Paytm Business/ }).click();
    await expect(
      page.getByText("OTP Sent").first(),
    ).toBeVisible({ timeout: 10_000 });

    // Fill a valid-length OTP so the guard doesn't exit early on length
    const otpInput = page.getByPlaceholder("••••••");
    await otpInput.fill("123456");

    const verifyBtnReady = page.getByRole("button", { name: /^Verify OTP$/i });
    await expect(verifyBtnReady).toBeEnabled({ timeout: 4_000 });

    // Enable the pre-navigation fetch hook so the second click is dispatched
    // from inside the first submit's request boundary. This nests the second
    // React activation while handleSubmitOtp is still executing:
    //
    //   first click → submittingOtpRef=false → set true → fetch()
    //     └─ second click → submittingOtpRef=true → return early
    //
    // Unlike two sequential dispatchEvent calls, this is a genuinely
    // re-entrant activation that a state-only guard cannot reliably block.
    await page.evaluate(() => {
      const testWindow = window as Window & {
        __paytmOtpReentrantEnabled?: boolean;
        __paytmOtpReentrantDispatch?: number;
      };
      testWindow.__paytmOtpReentrantDispatch = 0;
      testWindow.__paytmOtpReentrantEnabled = true;
    });
    await verifyBtnReady.click();

    // Wait for the delayed response to resolve
    await page.waitForTimeout(DELAY + 1_000);

    expect(
      await page.evaluate(() => (window as Window & {
        __paytmOtpReentrantDispatch?: number;
      }).__paytmOtpReentrantDispatch),
    ).toBe(1);
    // The ref guard must have blocked the re-entrant second tap.
    expect(counters.submitStep).toBe(1);
  },
);
