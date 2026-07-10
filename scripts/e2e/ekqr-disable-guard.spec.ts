/**
 * ekqr-disable-guard.spec.ts
 *
 * E2e tests for the EkqrConfigPanel (UPI gateway) disable-guard behaviour.
 *
 * The guard wraps EkqrConfigPanel.handleSave() via useDisableGatewayGuard +
 * computeWillDisable(). The "Disable Anyway" AlertDialog must only appear when
 * the gateway transitions from enabled → disabled. It must NEVER open when:
 *   a) re-enabling a previously-disabled gateway (disable → enable), or
 *   b) saving other field changes while the gateway is already disabled
 *      (disable → disable, e.g. toggling Mode between Test and Live).
 *
 * Navigation path to EkqrConfigPanel:
 *   /admin/payment-gateways → inner "ekqr" tab → inner "qr-codes" sub-tab
 */

import { test, expect, type Page } from "@playwright/test";

const ADMIN_EMAIL = "admin@rasokart.com";
const ADMIN_PASSWORD = "Admin@123456";
const EKQR_API = "http://localhost:80/api/system-config/ekqr";

async function getAdminToken(): Promise<string> {
  const res = await fetch("http://localhost:80/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  const data = (await res.json()) as { token: string };
  return data.token;
}

async function setEkqrEnabled(token: string, enabled: boolean, env = "test"): Promise<void> {
  await fetch(EKQR_API, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ enabled, env }),
  });
}

async function getEkqrState(token: string): Promise<{ enabled: boolean; env: string }> {
  const res = await fetch(EKQR_API, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return (await res.json()) as { enabled: boolean; env: string };
}

/** Log in via the admin UI and land on the admin dashboard. */
async function loginAsAdmin(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel(/email/i).fill(ADMIN_EMAIL);
  await page.getByLabel(/password/i).fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/admin\/(?!login)/, { timeout: 10_000 });
}

/**
 * Navigate to the EkqrConfigPanel on the payment-gateways page.
 * The panel lives behind three nested tab layers:
 *   outer: "Configure" tab → provider: "ekqr" tab → inner: "QR Codes" (qr-codes) sub-tab
 */
async function openEkqrPanel(page: Page) {
  await page.goto("/admin/payment-gateways");

  // Outer page tabs — "Configure" reveals the per-provider tab list
  const configureTab = page.getByRole("tab", { name: /^configure$/i });
  await configureTab.click();

  // Provider tabs — find the "ekqr" tab trigger (contains "UPI" or "ekqr")
  const ekqrTab = page
    .getByRole("tab")
    .filter({ hasText: /ekqr|upi/i })
    .first();
  await ekqrTab.click();

  // Inner sub-tabs — "QR Codes" sub-tab renders EkqrConfigPanel
  const qrCodesTab = page
    .getByRole("tab")
    .filter({ hasText: /qr.?codes?/i })
    .first();
  await qrCodesTab.click();

  // Wait for the panel to settle (Enable Gateway switch must be visible)
  await page.getByText("Enable Gateway").waitFor({ state: "visible", timeout: 8_000 });
}

/** Dismiss the disable dialog with "Disable Anyway" if it somehow appeared. */
async function dialogVisible(page: Page): Promise<boolean> {
  return page.getByRole("alertdialog").isVisible();
}

// ── Test state snapshots ──────────────────────────────────────────────────────

// NOTE: All three tests below are skipped. The EkqrConfigPanel Enable/Save flow
// this file was written against has since been superseded by the consolidated
// /admin/upi-gateways page — the panel now renders a disabled "Save Changes"
// button and a redirect link ("This gateway is now managed from the
// consolidated UPI Gateways page"). This is pre-existing app drift, unrelated
// to and predating the fullyParallel/global-setup changes in this file (the
// `test.describe.configure({ mode: "serial" })` below still correctly fixes
// the beforeAll/afterAll-per-worker race for whenever this suite is
// rewritten against the new UPI Gateways UI).

test.describe.configure({ mode: "serial" });

let token: string;
let originalState: { enabled: boolean; env: string };

test.beforeAll(async () => {
  token = await getAdminToken();
  originalState = await getEkqrState(token);
  // Ensure gateway is disabled before the test suite runs
  await setEkqrEnabled(token, false, originalState.env);
});

test.afterAll(async () => {
  // Restore original state
  await setEkqrEnabled(token, originalState.enabled, originalState.env);
});

// ── Scenario 1: Re-enable a disabled gateway → dialog must NOT appear ─────────

test.skip("re-enabling a disabled UPI gateway does not show the Disable dialog", async ({ page }) => {
  await loginAsAdmin(page);
  await openEkqrPanel(page);

  // Confirm the switch is currently OFF (gateway is disabled on server)
  const enableSwitch = page.locator("div").filter({ hasText: /^Enable Gateway/ }).last().getByRole("switch");
  await expect(enableSwitch).toBeChecked({ checked: false });

  // Toggle enable ON (disable → enable transition)
  await enableSwitch.click();
  await expect(enableSwitch).toBeChecked({ checked: true });

  // Click Save Changes
  const saveButton = page.getByRole("button", { name: /save changes/i });
  await saveButton.click();

  // Wait briefly for any dialog to appear
  await page.waitForTimeout(1_000);

  // Assert: the "Disable Anyway" AlertDialog must NOT have appeared
  const dialogShown = await dialogVisible(page);
  expect(dialogShown, "The Disable dialog must not appear when re-enabling a gateway").toBe(false);

  // Assert: success toast or panel update confirms the save completed
  // (The dialog not appearing AND no error state is the success signal)
  const errorToast = page.getByText(/error|failed/i).first();
  const hasError = await errorToast.isVisible().catch(() => false);
  expect(hasError, "No error toast expected after re-enabling").toBe(false);

  // Reset via API for the next test
  await setEkqrEnabled(token, false, originalState.env);
});

// ── Scenario 2: Save other settings while already disabled → dialog must NOT appear

test.skip("saving other settings on an already-disabled gateway does not show the Disable dialog", async ({ page }) => {
  await loginAsAdmin(page);
  await openEkqrPanel(page);

  // Confirm the switch is OFF
  const enableSwitch = page.locator("div").filter({ hasText: /^Enable Gateway/ }).last().getByRole("switch");
  await expect(enableSwitch).toBeChecked({ checked: false });

  // Change the Mode dropdown (Test ↔ Live) without touching the enable switch
  // This makes the Save button active via the `unchanged` predicate
  const modeSelect = page.locator('[role="combobox"]').filter({ hasText: /sandbox|test|live/i }).first();
  await modeSelect.click();
  // Pick the option that's NOT currently selected
  const currentEnv = originalState.env;
  const altOption = currentEnv === "test"
    ? page.getByRole("option", { name: /live.*production/i })
    : page.getByRole("option", { name: /sandbox.*test/i });
  await altOption.click();

  // Click Save Changes
  const saveButton = page.getByRole("button", { name: /save changes/i });
  await saveButton.click();

  // Wait briefly for any dialog to appear
  await page.waitForTimeout(1_000);

  // Assert: the "Disable Anyway" AlertDialog must NOT have appeared
  const dialogShown = await dialogVisible(page);
  expect(dialogShown, "The Disable dialog must not appear when saving fields on an already-disabled gateway").toBe(false);

  // Restore env via API
  await setEkqrEnabled(token, false, originalState.env);
});

// ── Positive control: Disabling an active gateway → dialog MUST appear ────────

test.skip("disabling an active UPI gateway correctly shows the Disable dialog (positive control)", async ({ page }) => {
  // Enable the gateway first via API
  await setEkqrEnabled(token, true, originalState.env);

  await loginAsAdmin(page);
  await openEkqrPanel(page);

  // Confirm the switch is ON
  const enableSwitch = page.locator("div").filter({ hasText: /^Enable Gateway/ }).last().getByRole("switch");
  await expect(enableSwitch).toBeChecked({ checked: true });

  // Toggle disable OFF (enable → disable transition)
  await enableSwitch.click();
  await expect(enableSwitch).toBeChecked({ checked: false });

  // Click Save Changes
  const saveButton = page.getByRole("button", { name: /save changes/i });
  await saveButton.click();

  // Assert: the "Disable Anyway" AlertDialog MUST appear for the genuine disable case
  await expect(page.getByRole("alertdialog")).toBeVisible({ timeout: 3_000 });
  await expect(page.getByRole("button", { name: /disable anyway/i })).toBeVisible();

  // Click Disable Anyway to confirm and restore to disabled
  await page.getByRole("button", { name: /disable anyway/i }).click();
  await page.waitForTimeout(500);
});
