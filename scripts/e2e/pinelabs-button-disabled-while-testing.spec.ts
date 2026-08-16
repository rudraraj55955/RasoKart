/**
 * pinelabs-button-disabled-while-testing.spec.ts
 *
 * Regression guard: the "Test Credentials" button in PineLabsPanel must be
 * disabled (and show a spinner) while a credential probe is in-flight, and
 * must be re-enabled once the response lands.
 *
 * This prevents double-clicks from firing two concurrent
 * POST /api/admin/pinelabs/test-credentials calls and showing overlapping
 * result banners.
 *
 * Strategy
 * ────────
 * We intercept POST /api/admin/pinelabs/test-credentials with a route handler
 * that holds the response for ~2 s before resolving.  During that window the
 * button's label changes from "Test Credentials" to "Testing…", so we use
 * two separate role locators:
 *
 *   • `testBtnReady`    — getByRole("button", { name: /^test credentials$/i })
 *                         used BEFORE the click and AFTER the response lands.
 *   • `testBtnInFlight` — getByRole("button", { name: /testing…/i })
 *                         used WHILE the probe is pending to assert disabled.
 *
 * All network calls are mocked so the test is hermetic.
 *
 *   • GET  /api/provider-integrations/integrations → fake pinelabs row with
 *     all three credentials present (activates the Test Credentials section).
 *   • POST /api/admin/pinelabs/test-credentials   → delayed fake result.
 */

import { test, expect, type Page, type Route } from "@playwright/test";
import { readCachedAdminToken } from "./token-cache";

const LS_TOKEN_KEY = "rasokart_token";

// ── fake API responses ────────────────────────────────────────────────────────

const FAKE_PINELABS_INTEGRATION = {
  id:                100,
  providerKey:       "pinelabs",
  displayNamePublic: "Pine Labs",
  isEnabled:         false,
  isCustom:          false,
  environment:       "test",
  apiKeySet:         true,
  apiKeyMasked:      "PL-****-FAKE",
  apiSecretSet:      true,
  clientIdSet:       true,
  clientIdMasked:    "MID-****-FAKE",
  webhookUrl:        null,
  notes:             null,
  productType:       null,
};

const FAKE_INTEGRATIONS_LIST = [FAKE_PINELABS_INTEGRATION];

const FAKE_TEST_RESULT = {
  pass:    false,
  message: "Auth failed — check credentials",
  detail:  "Pine Labs UAT returned 401 Unauthorized. Verify your Merchant ID and Access Code.",
};

// ── helpers ───────────────────────────────────────────────────────────────────

async function goToPineLabsConfig(page: Page, adminToken: string): Promise<void> {
  await page.goto("/admin");
  await page.evaluate(
    ([key, tok]) => { localStorage.setItem(key, tok); },
    [LS_TOKEN_KEY, adminToken],
  );
  await page.goto("/admin/payment-gateways");
  await page.waitForLoadState("networkidle");
}

/** Wire the integrations-list GET to return our fake row. */
async function mockIntegrationsRoute(page: Page): Promise<void> {
  await page.route("**/api/provider-integrations/integrations", async (route: Route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status:      200,
        contentType: "application/json",
        body:        JSON.stringify(FAKE_INTEGRATIONS_LIST),
      });
    } else {
      await route.continue();
    }
  });
}

// ── token ─────────────────────────────────────────────────────────────────────

let adminToken: string;

test.beforeAll(() => {
  adminToken = readCachedAdminToken();
});

// ── suite ─────────────────────────────────────────────────────────────────────

test.describe("Pine Labs — Test Credentials button disabled while in-flight", () => {

  test("button is disabled while the credential probe is pending and re-enabled after", async ({ page }) => {
    // ── 1. Mock the integrations list ───────────────────────────────────────
    await mockIntegrationsRoute(page);

    // ── 2. Mock the test-credentials endpoint with a 2-second delay ─────────
    // The delay gives Playwright time to assert the disabled state before the
    // response lands.
    const PROBE_DELAY_MS = 2_000;

    await page.route("**/api/admin/pinelabs/test-credentials", async (route: Route) => {
      await new Promise<void>(resolve => setTimeout(resolve, PROBE_DELAY_MS));
      await route.fulfill({
        status:      200,
        contentType: "application/json",
        body:        JSON.stringify(FAKE_TEST_RESULT),
      });
    });

    // ── 3. Navigate to the Pine Labs Configure tab ───────────────────────────
    await goToPineLabsConfig(page, adminToken);
    await page.getByRole("tab", { name: /^configure$/i }).click();
    await page.waitForLoadState("networkidle");
    await page.getByRole("tab", { name: /pine labs/i }).click();
    await expect(page.getByText("Pine Labs Plural Gateway")).toBeVisible({ timeout: 8_000 });

    // ── 4. Confirm the Test Credentials section is rendered ──────────────────
    // The section only renders when clientIdSet && apiKeySet && apiSecretSet.
    await expect(page.getByText("Test Credentials").first()).toBeVisible({ timeout: 6_000 });

    // Two locators for the same button: one for each label state.
    // The component swaps "Test Credentials" → "Testing…" while the probe runs.
    const testBtnReady    = page.getByRole("button", { name: /^test credentials$/i });
    const testBtnInFlight = page.getByRole("button", { name: /testing…/i });

    // Sanity: ready-state button must be enabled before we click
    await expect(testBtnReady).toBeEnabled({ timeout: 4_000 });

    // ── 5. Click the button ──────────────────────────────────────────────────
    await testBtnReady.click();

    // ── 6. While the probe is in-flight the button must be disabled ──────────
    // The component sets testing:true synchronously before the fetch resolves,
    // replacing the label with "Testing…".
    await expect(testBtnInFlight).toBeVisible({ timeout: 2_000 });
    await expect(testBtnInFlight).toBeDisabled({ timeout: 2_000 });

    // ── 7. After the response lands the button reverts to its ready label ────
    // Allow up to PROBE_DELAY_MS + a generous React-render buffer.
    await expect(testBtnReady).toBeEnabled({ timeout: PROBE_DELAY_MS + 4_000 });
    // The in-flight variant must no longer be visible
    await expect(testBtnInFlight).not.toBeVisible({ timeout: 2_000 });

    // ── 8. The result banner must now be visible ─────────────────────────────
    const resultBanner = page.locator("div.rounded-md.border.p-3", {
      hasText: FAKE_TEST_RESULT.message,
    }).first();
    await expect(resultBanner).toBeVisible({ timeout: 4_000 });
  });

  test("button cannot be clicked a second time while first probe is still pending", async ({ page }) => {
    // Complementary guard: even if something bypassed the Playwright `isDisabled`
    // check, clicking a disabled button must not fire a second request.
    await mockIntegrationsRoute(page);

    let requestCount = 0;
    const PROBE_DELAY_MS = 2_000;

    await page.route("**/api/admin/pinelabs/test-credentials", async (route: Route) => {
      requestCount += 1;
      await new Promise<void>(resolve => setTimeout(resolve, PROBE_DELAY_MS));
      await route.fulfill({
        status:      200,
        contentType: "application/json",
        body:        JSON.stringify(FAKE_TEST_RESULT),
      });
    });

    await goToPineLabsConfig(page, adminToken);
    await page.getByRole("tab", { name: /^configure$/i }).click();
    await page.waitForLoadState("networkidle");
    await page.getByRole("tab", { name: /pine labs/i }).click();
    await expect(page.getByText("Pine Labs Plural Gateway")).toBeVisible({ timeout: 8_000 });

    const testBtnReady    = page.getByRole("button", { name: /^test credentials$/i });
    const testBtnInFlight = page.getByRole("button", { name: /testing…/i });

    await expect(testBtnReady).toBeEnabled({ timeout: 4_000 });

    // First click — starts the probe
    await testBtnReady.click();

    // Button must now show in-flight label and be disabled
    await expect(testBtnInFlight).toBeVisible({ timeout: 2_000 });
    await expect(testBtnInFlight).toBeDisabled({ timeout: 2_000 });

    // Attempt a second click on the disabled in-flight button.
    // `force: true` bypasses Playwright's actionability checks so we can
    // verify the route handler is NOT invoked a second time.
    await testBtnInFlight.click({ force: true });

    // Wait for the first probe to complete and the button to revert
    await expect(testBtnReady).toBeEnabled({ timeout: PROBE_DELAY_MS + 4_000 });

    // Exactly one request must have been fired despite the two click() calls
    expect(requestCount).toBe(1);
  });

});
