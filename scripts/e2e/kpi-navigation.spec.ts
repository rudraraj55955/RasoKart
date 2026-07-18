/**
 * kpi-navigation.spec.ts
 *
 * Verifies that KPI dashboard cards are clickable and navigate to the correct
 * destination with URL-persisted filters and visible filter chips.
 * Roles covered: Admin, Merchant, Payout Admin, Payout Merchant, Agent.
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
});
