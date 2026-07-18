/**
 * kpi-navigation.spec.ts
 *
 * Verifies that KPI dashboard cards are clickable and navigate to the correct
 * destination with URL-persisted filters and visible filter chips.
 * Roles covered: Admin, Merchant, Payout Admin.
 *
 * Also verifies:
 *   - Refresh persistence: direct navigation to a filtered URL shows the chip.
 *   - Clear-filter reset: clicking the chip X removes the filter from the URL.
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
    const card = page.locator('a[href="/admin/deposits"]').first();
    await expect(card).toBeVisible({ timeout: 8000 });
    await card.click();
    await expect(page).toHaveURL(/\/admin\/deposits/, { timeout: 8000 });
  });

  test("Pending Actions card navigates to /admin/transactions with status=pending chip", async ({ page }) => {
    await injectToken(page, adminToken);
    await page.goto(`${BASE}/admin/dashboard`);
    const card = page.locator('a[href*="/admin/transactions"][href*="status=pending"]').first();
    await expect(card).toBeVisible({ timeout: 8000 });
    await card.click();
    await expect(page).toHaveURL(/status=pending/, { timeout: 8000 });
    await expect(page.getByText(/status.*pending/i)).toBeVisible({ timeout: 5000 });
  });

  test("Total Transactions card navigates to /admin/transactions", async ({ page }) => {
    await injectToken(page, adminToken);
    await page.goto(`${BASE}/admin/dashboard`);
    const card = page.locator('a[href="/admin/transactions"]').first();
    await expect(card).toBeVisible({ timeout: 8000 });
    await card.click();
    await expect(page).toHaveURL(/\/admin\/transactions/, { timeout: 8000 });
  });

  // ── Refresh persistence ────────────────────────────────────────────────────

  test("filter chip appears when navigating directly to filtered URL (refresh persistence)", async ({ page }) => {
    await injectToken(page, adminToken);
    await page.goto(`${BASE}/admin/transactions?status=pending`);
    // The filter chip should be rendered from the URL param — no click required
    await expect(page.getByText(/status.*pending/i)).toBeVisible({ timeout: 10000 });
    expect(page.url()).toContain("status=pending");
  });

  // ── Clear-filter reset ─────────────────────────────────────────────────────

  test("clicking chip X clears the status filter from the URL", async ({ page }) => {
    await injectToken(page, adminToken);
    await page.goto(`${BASE}/admin/transactions?status=pending`);
    // Wait for the chip to appear
    const chip = page.locator("button").filter({ hasText: /pending/i }).first();
    await expect(chip).toBeVisible({ timeout: 10000 });
    // Click the X inside the chip (the button itself is the chip with the X icon)
    await chip.click();
    // URL should no longer contain the status filter
    await expect(page).not.toHaveURL(/status=pending/, { timeout: 5000 });
    // Chip should be gone
    await expect(chip).not.toBeVisible({ timeout: 3000 });
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

  test("Pending Approval card navigates to /payout-admin/payouts with status chip", async ({ page }) => {
    await injectToken(page, adminToken);
    await page.goto(`${BASE}/payout-admin/dashboard`);
    const card = page.locator('a[href*="/payout-admin/payouts"][href*="status=PENDING_ADMIN_APPROVAL"]').first();
    await expect(card).toBeVisible({ timeout: 8000 });
    await card.click();
    await expect(page).toHaveURL(/status=PENDING_ADMIN_APPROVAL/, { timeout: 8000 });
    await expect(page.getByText(/Pending Approval/i)).toBeVisible({ timeout: 5000 });
  });

  // ── Refresh persistence ────────────────────────────────────────────────────

  test("payout-admin filter chip appears on direct URL navigation (refresh persistence)", async ({ page }) => {
    await injectToken(page, adminToken);
    await page.goto(`${BASE}/payout-admin/payouts?status=PENDING_ADMIN_APPROVAL`);
    await expect(page.getByText(/Pending Approval/i)).toBeVisible({ timeout: 10000 });
    expect(page.url()).toContain("status=PENDING_ADMIN_APPROVAL");
  });
});
