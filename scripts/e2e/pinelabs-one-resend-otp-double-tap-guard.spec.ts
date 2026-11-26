/**
 * pinelabs-one-resend-otp-double-tap-guard.spec.ts
 *
 * Regression guard: fast double-taps on the "Resend OTP" button in
 * PineLabsOnePortalCard must not fire two POST requests to
 * /api/merchant/portal-sessions/pinelabs_one/submit-step with
 * { loginMethod: "resend_otp" }.
 *
 * The resend handler previously used only a React `resending` state flag.
 * `resendingRef = useRef(false)` was added to make the guard synchronous —
 * the ref is checked and set before React schedules any state updates, so
 * a second click that arrives in the same render frame is still blocked.
 *
 * Strategy
 * ────────
 * 1. Install a fake browser clock (`page.clock.install()`) before navigation
 *    so we can fast-forward the 60-second resend cooldown without real waiting.
 * 2. Intercept the initiate endpoint (returns AWAITING_OTP → sets otpSource
 *    to "otp_first", which makes the Resend button visible).
 * 3. Intercept submit-step (resend_otp) with a ~2-second artificial delay
 *    in the Node.js route handler (unaffected by the browser's fake clock).
 * 4. Navigate, enter the identifier, click Connect to drive the initiate call
 *    and reach the OTP step with the 60-second cooldown active.
 * 5. Tick the fake clock 60 seconds to expire the cooldown and enable Resend.
 * 6. For the double-tap test: use `page.evaluate` to dispatch two synchronous
 *    MouseEvent clicks on the Resend button in the same JS task, before React
 *    can re-render between them.  This is the true same-render-frame race that
 *    the ref guard is designed to close.
 * 7. Assert exactly ONE submit-step request with loginMethod:"resend_otp".
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
      id: 921,
      slug: "pinelabs_one",
      name: "Pine Labs ONE",
      category: "pos",
      description: "Pine Labs ONE POS/QR merchant connector",
      status: "live",
    },
  ],
};

/**
 * Initiate result — adapter returns AWAITING_OTP (OTP-first flow, the
 * default on the live one.pinelabs.com authV2 portal).
 * This is the path that sets otpSource="otp_first", making the Resend
 * button visible, and also sets resendCooldown to 60 seconds.
 */
const FAKE_INITIATE_AWAITING_OTP = {
  status:   "AWAITING_OTP",
  message:  "OTP sent to your registered mobile or email.",
  nextStep: "ENTER_OTP",
  helpUrl:  null,
};

/** A generic resend result returned after the artificial delay. */
const FAKE_RESEND_RESULT = {
  status:  "AWAITING_OTP",
  message: "OTP resent — test sentinel response.",
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
 * `counters.resendStep` is incremented for every POST that carries
 * loginMethod:"resend_otp" so the test can assert it stayed at 1.
 */
async function mockRoutes(
  page: Page,
  counters: { initiate: number; resendStep: number },
  resendDelayMs = 0,
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

  // Portal sessions list — empty so the card starts at the identifier step.
  await page.route("**/api/merchant/portal-sessions", async (route: Route) => {
    await route.fulfill({
      status:      200,
      contentType: "application/json",
      body:        JSON.stringify({ sessions: [] }),
    });
  });

  // Enrollments list — prevents a 401 noise error.
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

  // Initiate endpoint — returns AWAITING_OTP to set otpSource="otp_first"
  // and transition the card to the OTP step (which also starts resendCooldown=60).
  await page.route(
    "**/api/merchant/portal-sessions/pinelabs_one/initiate",
    async (route: Route) => {
      counters.initiate += 1;
      await route.fulfill({
        status:      200,
        contentType: "application/json",
        body:        JSON.stringify(FAKE_INITIATE_AWAITING_OTP),
      });
    },
  );

  // Submit-step endpoint — count resend_otp calls separately; apply an
  // artificial Node.js-side delay (unaffected by the browser's fake clock)
  // so the second tap lands while the first request is still in-flight.
  await page.route(
    "**/api/merchant/portal-sessions/pinelabs_one/submit-step",
    async (route: Route) => {
      const body = route.request().postDataJSON();
      if (body?.loginMethod === "resend_otp") {
        counters.resendStep += 1;
      }
      if (resendDelayMs > 0) {
        await new Promise<void>(r => setTimeout(r, resendDelayMs));
      }
      await route.fulfill({
        status:      200,
        contentType: "application/json",
        body:        JSON.stringify(FAKE_RESEND_RESULT),
      });
    },
  );
}

/**
 * Drive the card to the OTP step with the resend cooldown active, then
 * fast-forward the fake browser clock to expire the cooldown and enable
 * the Resend button.
 */
async function reachOtpStepAndEnableResend(page: Page): Promise<void> {
  // Locate the Pine Labs ONE card
  await expect(
    page.locator("text=Pine Labs ONE").first(),
  ).toBeVisible({ timeout: 15_000 });

  // Enter an identifier and trigger the OTP-first initiate flow.
  const identifierInput = page.getByPlaceholder(
    /email.*mobile|mobile.*email|pine labs/i,
  ).first();
  await expect(identifierInput).toBeVisible();
  await identifierInput.fill("merchant@example.com");
  await page.getByRole("button", { name: /Connect Pine Labs ONE/i }).click();

  // The card must transition to the OTP-entry step.
  // The OTP input indicates we're on the right step.
  await expect(
    page.locator("input[placeholder*='OTP'], input[placeholder*='otp'], input[type='text'][maxlength]").first(),
  ).toBeVisible({ timeout: 10_000 });

  // At this point resendCooldown = 60.  Tick the fake browser clock forward
  // 60 seconds to expire it.  The Node.js route-handler delay is unaffected
  // because it uses its own (real) process-level setTimeout.
  await page.clock.tick(60_000);

  // The Resend OTP button should now be enabled.
  const resendBtn = page.getByRole("button", { name: "Resend OTP" }).first();
  await expect(resendBtn).toBeEnabled({ timeout: 5_000 });
}

// ── token ─────────────────────────────────────────────────────────────────────

let merchantToken: string;

test.beforeAll(() => {
  merchantToken = readCachedMerchantToken();
});

// ── tests ─────────────────────────────────────────────────────────────────────

test(
  "Resend OTP button is disabled while resend is in-flight",
  async ({ page }) => {
    // Install fake clock BEFORE navigation so every browser timer is fake.
    await page.clock.install();

    const counters = { initiate: 0, resendStep: 0 };
    const DELAY = 2_000;
    await mockRoutes(page, counters, DELAY);
    await goToConnect(page, merchantToken);

    await reachOtpStepAndEnableResend(page);
    expect(counters.initiate).toBe(1);

    const resendBtn = page.getByRole("button", { name: "Resend OTP" }).first();

    // Click — starts the first (and only) resend request.
    await resendBtn.click();

    // The button must immediately become disabled via React state.
    await expect(resendBtn).toBeDisabled({ timeout: 2_000 });

    // Wait for the Node.js-side delayed response to resolve.
    // Use real wall-clock time — page.waitForTimeout waits real ms even with
    // a fake browser clock installed.
    await page.waitForTimeout(DELAY + 1_000);

    // Exactly one resend request must have been sent.
    expect(counters.resendStep).toBe(1);
  },
);

test(
  "Synchronous double-tap on Resend OTP in the same render frame sends only one submit-step request",
  async ({ page }) => {
    // Install fake clock BEFORE navigation so every browser timer is fake.
    await page.clock.install();

    const counters = { initiate: 0, resendStep: 0 };
    // 2-second delay keeps the resend in-flight while we fire the extra tap.
    const DELAY = 2_000;
    await mockRoutes(page, counters, DELAY);
    await goToConnect(page, merchantToken);

    await reachOtpStepAndEnableResend(page);

    // ── Synchronous double-tap via page.evaluate ───────────────────────────
    // Both MouseEvent dispatches run in the same JS task (same synchronous
    // execution context), before React can schedule any state update between
    // them.  This is the true same-render-frame race condition:
    //
    //   click 1 → resendingRef.current (false) → set true, fire fetch
    //   click 2 → resendingRef.current (true)  → return early  ✓
    //
    // A state-only guard would NOT block click 2 here because `setResending`
    // is asynchronous and React hasn't re-rendered yet.
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      const resendBtn = btns.find(b => b.textContent?.trim() === "Resend OTP");
      if (!resendBtn) throw new Error("Resend OTP button not found in DOM");
      // Two synchronous clicks in the same JS task — the key scenario.
      resendBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      resendBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    // Wait for the Node.js-side delayed response to resolve.
    await page.waitForTimeout(DELAY + 1_000);

    // The ref guard must have blocked the second dispatch: only ONE request.
    expect(counters.resendStep).toBe(1);
  },
);
