/**
 * pinelabs-one-password-double-tap-guard.spec.ts
 *
 * Regression guard: fast double-taps on the "Continue with Password" button in
 * PineLabsOnePortalCard must not fire two POST requests to
 * /api/merchant/portal-sessions/pinelabs_one/submit-step.
 *
 * The password path previously used only a React `submitting` state flag.
 * This task adds a `submittingPasswordRef = useRef(false)` guard that is
 * checked synchronously — before React re-renders — making the handler truly
 * non-reentrant on fast double-taps.
 *
 * Strategy
 * ────────
 * 1. Intercept the initiate endpoint and return AWAITING_PASSWORD so the UI
 *    transitions to the password-entry step without hitting the real adapter.
 * 2. Intercept submit-step with a ~2-second artificial delay.  During that
 *    window the button shows "Connecting…" and is `disabled`.
 * 3. Click "Continue with Password", then immediately click again with
 *    `force: true` to bypass Playwright's built-in actionability checks
 *    (simulating a tap that arrives before React re-renders).  A third attempt
 *    via Enter on the password input confirms the keyboard path is also guarded.
 * 4. Assert exactly ONE submit-step request was received.
 *
 * All network calls are fully mocked — no real Pine Labs ONE portal or
 * Playwright adapter run is involved.
 */

import { test, expect, type Page, type Route } from "@playwright/test";
import { readCachedMerchantToken } from "./token-cache";

const LS_TOKEN_KEY = "rasokart_token";

// ── fake API responses ────────────────────────────────────────────────────────

/** Providers list containing pinelabs_one so the portal card renders. */
const FAKE_PROVIDERS = {
  data: [
    {
      id: 920,
      slug: "pinelabs_one",
      name: "Pine Labs ONE",
      category: "pos",
      description: "Pine Labs ONE POS/QR merchant connector",
      status: "live",
    },
  ],
};

/**
 * Initiate result — adapter returns AWAITING_PASSWORD so the UI transitions
 * to the password-entry step (not the OTP step).
 */
const FAKE_INITIATE_AWAITING_PASSWORD = {
  status:   "AWAITING_PASSWORD",
  message:  "Enter your Pine Labs ONE account password below.",
  nextStep: "ENTER_PASSWORD",
  helpUrl:  null,
};

/** A generic in-flight submit-step response (returned after the delay). */
const FAKE_SUBMIT_RESULT = {
  status:  "FAILED",
  message: "Invalid password — test sentinel response.",
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
  // initial "identifier" step (no existing session).
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

  // Initiate endpoint — returns AWAITING_PASSWORD to drive the password step.
  await page.route(
    "**/api/merchant/portal-sessions/pinelabs_one/initiate",
    async (route: Route) => {
      counters.initiate += 1;
      await route.fulfill({
        status:      200,
        contentType: "application/json",
        body:        JSON.stringify(FAKE_INITIATE_AWAITING_PASSWORD),
      });
    },
  );

  // Submit-step endpoint — delayed so the second tap lands while in-flight.
  await page.route(
    "**/api/merchant/portal-sessions/pinelabs_one/submit-step",
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
  "Continue with Password button is disabled while password submission is in-flight",
  async ({ page }) => {
    const counters = { initiate: 0, submitStep: 0 };
    const DELAY = 2_000;
    await mockRoutes(page, counters, DELAY);
    await goToConnect(page, merchantToken);

    // Locate the Pine Labs ONE card
    await expect(
      page.locator("text=Pine Labs ONE").first(),
    ).toBeVisible({ timeout: 15_000 });

    // Enter an identifier (email or mobile) and send the initiate request
    const identifierInput = page.getByPlaceholder(
      /email.*mobile|mobile.*email|pine labs/i,
    ).first();
    await expect(identifierInput).toBeVisible();
    await identifierInput.fill("merchant@example.com");
    await page.getByRole("button", { name: /Connect Pine Labs ONE/i }).click();

    // The card must transition to the password step
    await expect(
      page.getByText(/Pine Labs ONE Account Password/i).first(),
    ).toBeVisible({ timeout: 10_000 });
    expect(counters.initiate).toBe(1);

    // Fill a password so the button becomes enabled
    const passwordInput = page.getByPlaceholder("Your Pine Labs ONE password");
    await expect(passwordInput).toBeVisible();
    await passwordInput.fill("S3cr3tPass!");

    // Two locators: one for the idle state, one for the in-flight state
    const connectBtnReady    = page.getByRole("button", { name: /Continue with Password/i });
    const connectBtnInFlight = page.getByRole("button", { name: /Connecting…/i });

    // Sanity: button must be enabled before the first click
    await expect(connectBtnReady).toBeEnabled({ timeout: 4_000 });

    // First click — starts the submission
    await connectBtnReady.click();

    // While the delayed response is pending the button must switch to
    // "Connecting…" and be disabled
    await expect(connectBtnInFlight).toBeVisible({ timeout: 2_000 });
    await expect(connectBtnInFlight).toBeDisabled({ timeout: 2_000 });

    // After the response lands the button reverts to its idle label
    await expect(connectBtnReady).toBeEnabled({
      timeout: DELAY + 4_000,
    });
    await expect(connectBtnInFlight).not.toBeVisible({ timeout: 2_000 });

    // Exactly one request must have been sent
    expect(counters.submitStep).toBe(1);
  },
);

test(
  "Fast double-tap and Enter while password is in-flight send only one submit-step request",
  async ({ page }) => {
    const counters = { initiate: 0, submitStep: 0 };
    // 2-second delay keeps the request in-flight while we fire the extra taps.
    const DELAY = 2_000;
    await mockRoutes(page, counters, DELAY);
    await goToConnect(page, merchantToken);

    await expect(
      page.locator("text=Pine Labs ONE").first(),
    ).toBeVisible({ timeout: 15_000 });

    // Enter identifier and initiate
    const identifierInput = page.getByPlaceholder(
      /email.*mobile|mobile.*email|pine labs/i,
    ).first();
    await identifierInput.fill("merchant@example.com");
    await page.getByRole("button", { name: /Connect Pine Labs ONE/i }).click();
    await expect(
      page.getByText(/Pine Labs ONE Account Password/i).first(),
    ).toBeVisible({ timeout: 10_000 });

    // Fill a password so the button is enabled and the guard doesn't exit early
    const passwordInput = page.getByPlaceholder("Your Pine Labs ONE password");
    await passwordInput.fill("S3cr3tPass!");

    const connectBtnReady    = page.getByRole("button", { name: /Continue with Password/i });
    const connectBtnInFlight = page.getByRole("button", { name: /Connecting…/i });

    await expect(connectBtnReady).toBeEnabled({ timeout: 4_000 });

    // ── Tap 1: normal click — starts the first (and only) submit-step call ───
    await connectBtnReady.click();

    // Confirm in-flight state before the extra taps
    await expect(connectBtnInFlight).toBeVisible({ timeout: 2_000 });

    // ── Tap 2: force-click the disabled in-flight button ────────────────────
    // `force: true` bypasses Playwright's actionability checks, simulating a
    // second DOM click that would reach the handler if the ref guard were absent.
    await connectBtnInFlight.click({ force: true });

    // ── Tap 3 & 4: keyboard Enter while in-flight ────────────────────────────
    await passwordInput.press("Enter");
    await passwordInput.press("Enter");

    // Wait for the delayed response to resolve
    await page.waitForTimeout(DELAY + 1_000);

    // The ref guard must have blocked taps 2–4: only ONE request sent.
    expect(counters.submitStep).toBe(1);
  },
);
