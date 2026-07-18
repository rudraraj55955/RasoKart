/**
 * kpi-navigation.spec.ts
 *
 * Verifies that KPI dashboard cards are clickable and navigate to the correct
 * destination with URL-persisted filters and visible filter chips.
 * Roles covered: Admin, Merchant, Payout Admin.
 *
 * Tests:
 *   - Card click → correct destination URL
 *   - Filter chip visible immediately after click (no reload required)
 *   - Refresh persistence: direct URL navigation → chip or filtered Select visible
 *   - Clear-filter reset: clicking chip removes the filter param from URL
 */

import { test, expect, type Page } from "@playwright/test";
import {
  readCachedAdminToken,
  readCachedMerchantToken,
} from "./token-cache";

const BASE = "http://localhost:80";
const LS_TOKEN_KEY = "rasokart_token";

async function injectToken(page: Page, token: string): Promise<void> {
  await page.addInitScript(
    ({ key, value }: { key: string; value: string }) => {
      window.localStorage.setItem(key, value);
    },
    { key: LS_TOKEN_KEY, value: token },
  );
}

// ── Admin KPI cards ──────────────────────────────────────────────────────────

test.describe("Admin KPI navigation", () => {
  let adminToken: string;

  test.beforeAll(() => {
    adminToken = readCachedAdminToken();
  });

  test("Total Deposits card navigates to /admin/deposits", async ({ page }) => {
    await injectToken(page, adminToken);
    await page.goto(`${BASE}/admin/dashboard`);
    // KpiCard/StatCard renders as an <a> with the kpi-routes href
    const card = page.locator('a[href="/admin/deposits"]').first();
    await expect(card).toBeVisible({ timeout: 8000 });
    await card.click();
    await expect(page).toHaveURL(/\/admin\/deposits$/, { timeout: 8000 });
  });

  test("Pending Actions card navigates to /admin/transactions?status=pending", async ({ page }) => {
    await injectToken(page, adminToken);
    await page.goto(`${BASE}/admin/dashboard`);
    const card = page.locator('a[href*="/admin/transactions"][href*="status=pending"]').first();
    await expect(card).toBeVisible({ timeout: 8000 });
    await card.click();
    await expect(page).toHaveURL(/\/admin\/transactions.*status=pending/, { timeout: 8000 });
    // useUrlFilters reflects the URL param into the Status Select immediately — no chip button here,
    // so assert the URL param is present (deep-link persisted).
    expect(new URL(page.url()).searchParams.get("status")).toBe("pending");
  });

  // ── Refresh persistence ────────────────────────────────────────────────────

  test("admin/deposits: filter chip appears on direct URL navigation (refresh persistence)", async ({ page }) => {
    await injectToken(page, adminToken);
    // Navigate directly to a filtered URL — simulates a page refresh or shared link
    await page.goto(`${BASE}/admin/deposits?status=pending`);
    // useUrlFilters reads the URL immediately via wouter useSearch() — chip should render
    // The chip is a <button> whose text content is "Status: pending" (+ X icon)
    const chip = page.getByRole("button", { name: /status:\s*pending/i });
    await expect(chip).toBeVisible({ timeout: 10000 });
    // URL must still carry the param
    expect(new URL(page.url()).searchParams.get("status")).toBe("pending");
  });

  // ── Clear-filter reset ─────────────────────────────────────────────────────

  test("admin/deposits: clicking chip button clears the status filter from the URL", async ({ page }) => {
    await injectToken(page, adminToken);
    await page.goto(`${BASE}/admin/deposits?status=pending`);
    // The chip is a <button> with visible text "Status: pending"
    const chip = page.getByRole("button", { name: /status:\s*pending/i });
    await expect(chip).toBeVisible({ timeout: 10000 });
    // Clicking the chip clears the filter (the button itself is the clear target)
    await chip.click();
    // URL param must be gone
    await expect(page).not.toHaveURL(/status=pending/, { timeout: 5000 });
    expect(new URL(page.url()).searchParams.get("status")).toBeNull();
    // Chip must no longer be rendered
    await expect(chip).not.toBeVisible({ timeout: 3000 });
  });

  // ── admin/transactions URL persistence ────────────────────────────────────

  test("admin/transactions: direct URL navigation with status param reflects in filter Select", async ({ page }) => {
    await injectToken(page, adminToken);
    await page.goto(`${BASE}/admin/transactions?status=pending`);
    // URL param must still be present
    expect(new URL(page.url()).searchParams.get("status")).toBe("pending");
    // useUrlFilters feeds the reactive `status` into the Select's value prop.
    // The SelectTrigger renders as a listbox button showing the selected option label.
    const statusSelect = page.locator('[aria-haspopup="listbox"]').filter({ hasText: /^Pending$/i }).first();
    await expect(statusSelect).toBeVisible({ timeout: 10000 });
  });
});

// ── Merchant KPI cards ───────────────────────────────────────────────────────

test.describe("Merchant KPI navigation", () => {
  let merchantToken: string;

  test.beforeAll(() => {
    merchantToken = readCachedMerchantToken();
  });

  test("Today's Deposits card navigates to /merchant/transactions with date filter", async ({ page }) => {
    await injectToken(page, merchantToken);
    await page.goto(`${BASE}/merchant/dashboard`);
    const card = page.locator('a[href*="/merchant/transactions"][href*="from="]').first();
    await expect(card).toBeVisible({ timeout: 8000 });
    await card.click();
    await expect(page).toHaveURL(/\/merchant\/transactions.*from=/, { timeout: 8000 });
    // Ensure the `from` date param is actually present (not an empty string)
    expect(new URL(page.url()).searchParams.get("from")).toBeTruthy();
  });

  test("Active QR Codes card navigates to /merchant/qr-codes", async ({ page }) => {
    await injectToken(page, merchantToken);
    await page.goto(`${BASE}/merchant/dashboard`);
    const card = page.locator('a[href="/merchant/qr-codes"]').first();
    await expect(card).toBeVisible({ timeout: 8000 });
    await card.click();
    await expect(page).toHaveURL(/\/merchant\/qr-codes/, { timeout: 8000 });
  });
});

// ── Payout Admin KPI cards ───────────────────────────────────────────────────

test.describe("Payout Admin KPI navigation", () => {
  let adminToken: string;

  test.beforeAll(() => {
    adminToken = readCachedAdminToken();
  });

  test("Pending Approval KPI card navigates and shows filter chip", async ({ page }) => {
    await injectToken(page, adminToken);
    await page.goto(`${BASE}/payout-admin/dashboard`);
    const card = page.locator('a[href*="/payout-admin/payouts"][href*="status=PENDING_ADMIN_APPROVAL"]').first();
    await expect(card).toBeVisible({ timeout: 8000 });
    await card.click();
    await expect(page).toHaveURL(/status=PENDING_ADMIN_APPROVAL/, { timeout: 8000 });
    // payout-admin/payouts renders a chip button with the human label from LOCAL_STATUS_BADGE
    const chip = page.getByRole("button", { name: /pending approval/i });
    await expect(chip).toBeVisible({ timeout: 8000 });
  });

  // ── Refresh persistence ────────────────────────────────────────────────────

  test("payout-admin/payouts: filter chip appears on direct URL navigation (refresh persistence)", async ({ page }) => {
    await injectToken(page, adminToken);
    // Navigate directly — simulates shared link or page refresh
    await page.goto(`${BASE}/payout-admin/payouts?status=PENDING_ADMIN_APPROVAL`);
    // Chip button with "Pending Approval" label must render immediately from URL
    const chip = page.getByRole("button", { name: /pending approval/i });
    await expect(chip).toBeVisible({ timeout: 10000 });
    expect(new URL(page.url()).searchParams.get("status")).toBe("PENDING_ADMIN_APPROVAL");
  });

  // ── Clear-filter reset ─────────────────────────────────────────────────────

  test("payout-admin/payouts: clicking chip button clears the status filter", async ({ page }) => {
    await injectToken(page, adminToken);
    await page.goto(`${BASE}/payout-admin/payouts?status=PENDING_ADMIN_APPROVAL`);
    const chip = page.getByRole("button", { name: /pending approval/i });
    await expect(chip).toBeVisible({ timeout: 10000 });
    await chip.click();
    // URL param must be cleared
    await expect(page).not.toHaveURL(/status=PENDING_ADMIN_APPROVAL/, { timeout: 5000 });
    expect(new URL(page.url()).searchParams.get("status")).toBeNull();
    // Chip must disappear
    await expect(chip).not.toBeVisible({ timeout: 3000 });
  });
});
