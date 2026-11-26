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
 * 2. Wrap `window.fetch` before the page loads. At the submit-step fetch
 *    boundary, synchronously activate the password button again before the
 *    first request leaves the browser or React can render its disabled state.
 * 3. Intercept submit-step with a ~2-second artificial delay. During that
 *    window the button still shows "Connecting…" and is `disabled`; Enter
 *    attempts are also guarded.
 * 4. Assert the re-entrant activation occurs exactly once and exactly ONE
 *    submit-step request was received.
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

/**
 * Make a second DOM activation in the exact same JavaScript turn as the first
 * password submit-step fetch. This deliberately happens before `fetch` sends
 * the request and before React can commit the loading/disabled UI, which is
 * the timing window a state-only in-flight guard would miss.
 */
async function installSubmitStepReentrancy(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    let reentrancyUsed = false;

    window.fetch = (...args) => {
      const [input] = args;
      const url = input instanceof Request ? input.url : String(input);

      if (
        !reentrancyUsed &&
        url.includes("/api/merchant/portal-sessions/pinelabs_one/submit-step")
      ) {
        reentrancyUsed = true;
        const passwordButton = Array.from(document.querySelectorAll("button"))
          .find(button => button.textContent?.includes("Continue with Password"));

        if (passwordButton instanceof HTMLButtonElement) {
          (window as Window & {
            __pineLabsPasswordReentrantActivations?: number;
          }).__pineLabsPasswordReentrantActivations =
            ((window as Window & {
              __pineLabsPasswordReentrantActivations?: number;
            }).__pineLabsPasswordReentrantActivations ?? 0) + 1;
          passwordButton.click();
        }
      }

      return originalFetch(...args);
    };
  });
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

    // After the response lands the button reverts to its idle label, but stays
    // disabled because the one-use password has been cleared.
    await expect(connectBtnReady).toBeVisible({
      timeout: DELAY + 4_000,
    });
    await expect(connectBtnReady).toBeDisabled();
    await expect(connectBtnInFlight).not.toBeVisible({ timeout: 2_000 });
    await expect(passwordInput).toHaveValue("");

    // Exactly one request must have been sent
    expect(counters.submitStep).toBe(1);
  },
);

test(
  "Fast double-tap and Enter while password is in-flight send only one submit-step request",
  async ({ page }) => {
    const counters = { initiate: 0, submitStep: 0 };
    // 2-second delay keeps the request in-flight while we exercise loading and
    // keyboard feedback after the re-entrant activation.
    const DELAY = 2_000;
    await installSubmitStepReentrancy(page);
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

    // ── Tap 1: normal click ──────────────────────────────────────────────────
    // The fetch wrapper synchronously activates this button one more time at
    // the submit-step request boundary, before React can render it disabled.
    await connectBtnReady.click();

    // The nested activation must have happened exactly once.
    await expect.poll(async () => page.evaluate(() => (
      (window as Window & {
        __pineLabsPasswordReentrantActivations?: number;
      }).__pineLabsPasswordReentrantActivations ?? 0
    ))).toBe(1);

    // Confirm existing loading feedback still renders after the boundary race.
    await expect(connectBtnInFlight).toBeVisible({ timeout: 2_000 });
    await expect(connectBtnInFlight).toBeDisabled({ timeout: 2_000 });

    // Keyboard submits after the loading state appears remain guarded too.
    await passwordInput.press("Enter");
    await passwordInput.press("Enter");

    // Wait for the delayed response to resolve
    await page.waitForTimeout(DELAY + 1_000);

    // The ref guard must have blocked the same-frame nested click and Enter:
    // only ONE request reached the mocked API, and the password was cleared.
    expect(counters.submitStep).toBe(1);
    await expect(passwordInput).toHaveValue("");
  },
);
