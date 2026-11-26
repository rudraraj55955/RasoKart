/**
 * pinelabs-stale-result-clear.spec.ts
 *
 * Regression guard for the Pine Labs test-result clearing behaviour.
 *
 * The PineLabsPanel component keeps test-credential results in local React
 * state (`testResult`).  When the admin saves new credentials the mutation's
 * `onSuccess` callback calls `setTestResult(null)`, which should immediately
 * hide the result banner so the admin isn't misled by a stale pass/fail from
 * a previous test run.
 *
 * This suite verifies that end-to-end flow:
 *
 *   1. Navigate to the Pine Labs configure tab.
 *   2. Click "Test Credentials" — the result banner appears.
 *   3. Submit new credentials via "Save Pine Labs Settings".
 *   4. Assert the result banner is gone immediately after the successful save.
 *
 * All network calls are intercepted with page.route() so the test is
 * hermetic: it does not depend on real Pine Labs UAT credentials being
 * configured in the dev DB.
 *
 *   • GET /api/provider-integrations/integrations → fake pinelabs row with
 *     all three credentials present (so the "Test Credentials" section is
 *     rendered by the component).
 *   • POST /api/admin/pinelabs/test-credentials → fake failure result.
 *   • GET  /api/provider-integrations/integrations (re-fetch after save) →
 *     same fake row.
 *   • PUT /api/provider-integrations/integrations/pinelabs → 200 success.
 */

import { test, expect, type Page, type Route } from "@playwright/test";
import { readCachedAdminToken } from "./token-cache";

const BASE          = "http://localhost:80";
const LS_TOKEN_KEY  = "rasokart_token";

// ── fake API responses ────────────────────────────────────────────────────────

/** A minimal ProviderIntegration row for pinelabs with all three creds set. */
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

/** A collection response that the list endpoint returns. */
const FAKE_INTEGRATIONS_LIST = [FAKE_PINELABS_INTEGRATION];

/** The test-credentials endpoint returns a failure result (both pass and fail
 *  result in a banner being rendered; we use fail here to avoid implying the
 *  fake creds somehow passed a real probe). */
const FAKE_TEST_RESULT = {
  pass:    false,
  message: "Auth failed — check credentials",
  detail:  "Pine Labs UAT returned 401 Unauthorized. Verify your Merchant ID and Access Code.",
};

/** A successful save response from PUT /api/provider-integrations/integrations/pinelabs. */
const FAKE_SAVE_RESPONSE = { ...FAKE_PINELABS_INTEGRATION };

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Inject the admin JWT into localStorage, then navigate to the
 * payment-gateways page so the Pine Labs Configure tab is reachable.
 *
 * Same two-step pattern as settings-persistence.spec.ts: a same-origin page
 * first to establish the localStorage context, then the real destination.
 */
async function goToPineLabsConfig(page: Page, adminToken: string): Promise<void> {
  await page.goto("/admin");
  await page.evaluate(
    ([key, tok]) => { localStorage.setItem(key, tok); },
    [LS_TOKEN_KEY, adminToken],
  );
  await page.goto("/admin/payment-gateways");
  await page.waitForLoadState("networkidle");
}

/**
 * Register all route intercepts for this test.
 *
 * Because the component re-fetches the integration list both on mount and
 * after a successful save, we route ALL requests matching the list URL to
 * the same fake response.
 */
async function mockPineLabsRoutes(page: Page): Promise<void> {
  // List of all provider integrations — hit on component mount and after save.
  await page.route("**/api/provider-integrations/integrations", async (route: Route) => {
    const method = route.request().method();
    if (method === "GET") {
      await route.fulfill({
        status:      200,
        contentType: "application/json",
        body:        JSON.stringify(FAKE_INTEGRATIONS_LIST),
      });
    } else {
      // Pass through any non-GET (shouldn't happen for this path)
      await route.continue();
    }
  });

  // Credential test probe
  await page.route("**/api/admin/pinelabs/test-credentials", async (route: Route) => {
    await route.fulfill({
      status:      200,
      contentType: "application/json",
      body:        JSON.stringify(FAKE_TEST_RESULT),
    });
  });

  // Save (PUT) for pinelabs
  await page.route("**/api/provider-integrations/integrations/pinelabs", async (route: Route) => {
    if (route.request().method() === "PUT") {
      await route.fulfill({
        status:      200,
        contentType: "application/json",
        body:        JSON.stringify(FAKE_SAVE_RESPONSE),
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

test.describe("Pine Labs — test-result banner clears after save", () => {

  test("test result banner disappears immediately after saving new credentials", async ({ page }) => {
    // ── 1. Wire up all API mocks before navigating ──────────────────────────
    await mockPineLabsRoutes(page);

    // ── 2. Navigate to the payment-gateways page ────────────────────────────
    await goToPineLabsConfig(page, adminToken);

    // ── 3. Open the "Configure" tab ─────────────────────────────────────────
    await page.getByRole("tab", { name: /^configure$/i }).click();
    await page.waitForLoadState("networkidle");

    // ── 4. Open the "Pine Labs" sub-tab ─────────────────────────────────────
    await page.getByRole("tab", { name: /pine labs/i }).click();
    // Wait for the panel to finish rendering (the list query must resolve)
    await expect(page.getByText("Pine Labs Plural Gateway")).toBeVisible({ timeout: 8_000 });

    // ── 5. The "Test Credentials" section must be present ───────────────────
    // It only renders when clientIdSet && apiKeySet && apiSecretSet are all
    // true — which our mock guarantees.
    const testSection = page.getByText("Test Credentials").first();
    await expect(testSection).toBeVisible({ timeout: 6_000 });

    // ── 6. Click "Test Credentials" and wait for the result banner ──────────
    await page.getByRole("button", { name: /^test credentials$/i }).click();

    // The banner is a bordered div inside the Pine Labs panel.  Scope the
    // locator to avoid the sonner toast that also shows the message string.
    // The banner renders as a <div class="rounded-md border p-3 ..."> that
    // contains a <p> with the message text.
    const resultBanner = page.locator("div.rounded-md.border.p-3", {
      hasText: FAKE_TEST_RESULT.message,
    }).first();
    await expect(resultBanner).toBeVisible({ timeout: 8_000 });

    // Sanity — the detail text should also be visible inside the same banner
    await expect(resultBanner.getByText(FAKE_TEST_RESULT.detail)).toBeVisible({ timeout: 4_000 });

    // ── 7. Fill in a new Merchant ID so the save body is non-empty ──────────
    // The Merchant ID field is a plain <Input> with placeholder "Enter Merchant ID…"
    const midInput = page.getByPlaceholder(/enter merchant id/i);
    await midInput.fill("MID-NEW-TEST-99");

    // ── 8. Click "Save Pine Labs Settings" ──────────────────────────────────
    const saveBtn = page.getByRole("button", { name: /save pine labs settings/i });
    await saveBtn.click();

    // Wait for the success toast that the component fires in onSuccess
    await expect(page.getByText(/pine labs settings saved/i)).toBeVisible({ timeout: 8_000 });

    // ── 9. Assert the test result banner is gone ─────────────────────────────
    // setTestResult(null) is called synchronously in onSuccess, so the banner
    // should already be hidden by the time the toast appears.
    await expect(resultBanner).not.toBeVisible({ timeout: 4_000 });
    await expect(page.getByText(FAKE_TEST_RESULT.detail)).not.toBeVisible();
  });

  test("test result banner also clears when a passing result was shown", async ({ page }) => {
    // Same flow but with a PASS result — verifies clearing works in both
    // outcome directions (regression guard against only clearing on failure).
    const PASS_RESULT = {
      pass:    true,
      message: "Credentials verified — Pine Labs UAT responded successfully",
      detail:  "Inquiry probe completed. No payment was triggered.",
    };

    // Override the test-credentials route to return pass:true this time
    await page.route("**/api/admin/pinelabs/test-credentials", async (route: Route) => {
      await route.fulfill({
        status:      200,
        contentType: "application/json",
        body:        JSON.stringify(PASS_RESULT),
      });
    });
    // Keep the other routes mocked
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
    await page.route("**/api/provider-integrations/integrations/pinelabs", async (route: Route) => {
      if (route.request().method() === "PUT") {
        await route.fulfill({
          status:      200,
          contentType: "application/json",
          body:        JSON.stringify(FAKE_SAVE_RESPONSE),
        });
      } else {
        await route.continue();
      }
    });

    await goToPineLabsConfig(page, adminToken);
    await page.getByRole("tab", { name: /^configure$/i }).click();
    await page.getByRole("tab", { name: /pine labs/i }).click();
    await expect(page.getByText("Pine Labs Plural Gateway")).toBeVisible({ timeout: 8_000 });

    await page.getByRole("button", { name: /^test credentials$/i }).click();

    const resultBanner = page.locator("div.rounded-md.border.p-3", {
      hasText: PASS_RESULT.message,
    }).first();
    await expect(resultBanner).toBeVisible({ timeout: 8_000 });

    // Save — no new credential value needed; empty body is still a valid save
    const saveBtn = page.getByRole("button", { name: /save pine labs settings/i });
    await saveBtn.click();

    await expect(page.getByText(/pine labs settings saved/i)).toBeVisible({ timeout: 8_000 });

    // Banner must be gone after save
    await expect(resultBanner).not.toBeVisible({ timeout: 4_000 });
  });

});
