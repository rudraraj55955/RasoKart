/**
 * smoke-tests.spec.ts
 *
 * Critical path smoke tests that run in CI on every push.
 * Covers:
 *   - Public routes respond (login pages, root redirect)
 *   - Admin login flow and dashboard load
 *   - Merchant login flow and dashboard load
 *   - No duplicate header on mobile admin pages
 *   - No duplicate header on mobile merchant pages
 *   - API health endpoints (/api/healthz, /api/healthz/deep)
 *   - Authenticated API endpoints return 401 when token is absent
 *   - No uncaught JS errors on key pages
 */

import { test, expect, type Page } from "@playwright/test";
import { readCachedAdminToken, readCachedMerchantToken } from "./token-cache";

const BASE = "http://localhost:80";
const API = `${BASE}/api`;
const LS_TOKEN_KEY = "rasokart_token";

async function injectToken(page: Page, token: string): Promise<void> {
  await page.addInitScript(
    ({ key, value }: { key: string; value: string }) => {
      window.localStorage.setItem(key, value);
    },
    { key: LS_TOKEN_KEY, value: token },
  );
}

// ── API health ─────────────────────────────────────────────────────────────

test("GET /api/healthz returns 200", async ({ request }) => {
  const res = await request.get(`${API}/healthz`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body).toMatchObject({ status: "ok" });
});

test("GET /api/healthz/deep returns 200 with all checks passing", async ({ request }) => {
  const res = await request.get(`${API}/healthz/deep`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body).toMatchObject({ status: "ok", demo_credentials: true });
});

// ── Unauthenticated protection ─────────────────────────────────────────────

test("GET /api/auth/me returns 401 when no token", async ({ request }) => {
  const res = await request.get(`${API}/auth/me`);
  expect(res.status()).toBe(401);
});

test("GET /api/admin/merchants returns 401 when no token", async ({ request }) => {
  const res = await request.get(`${API}/admin/merchants`);
  expect(res.status()).toBe(401);
});

// ── Admin login page ───────────────────────────────────────────────────────

test("Admin login page loads without JS errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.goto(`${BASE}/admin/login`);
  await expect(page.locator("input[type='email'], input[name='email']").first()).toBeVisible();
  await expect(page.locator("button[type='submit'], button:has-text('Sign in')").first()).toBeVisible();
  expect(errors).toHaveLength(0);
});

test("Merchant login page loads without JS errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.goto(`${BASE}/merchant/login`);
  await expect(page.locator("input[type='email'], input[name='email']").first()).toBeVisible();
  expect(errors).toHaveLength(0);
});

// ── Admin authenticated routes ─────────────────────────────────────────────

test("Admin dashboard loads after auth", async ({ page }) => {
  const token = readCachedAdminToken();
  await injectToken(page, token);
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.goto(`${BASE}/admin/dashboard`);
  await page.waitForURL(`${BASE}/admin/dashboard`, { timeout: 15_000 });
  // Should not redirect to login
  expect(page.url()).toContain("/admin/dashboard");
  // Sidebar or mobile header should be present
  await expect(
    page.locator('[data-sidebar="sidebar"], header').first(),
  ).toBeVisible({ timeout: 10_000 });
  expect(errors).toHaveLength(0);
});

test("Admin /auth/me returns correct role", async ({ request }) => {
  const token = readCachedAdminToken();
  const res = await request.get(`${API}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body).toMatchObject({ role: "admin" });
  expect(body.email).toBe("admin@rasokart.com");
});

test("Admin merchants list returns array", async ({ request }) => {
  const token = readCachedAdminToken();
  const res = await request.get(`${API}/admin/merchants`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body)).toBe(true);
});

// ── Merchant authenticated routes ──────────────────────────────────────────

test("Merchant dashboard loads after auth", async ({ page }) => {
  const token = readCachedMerchantToken();
  await injectToken(page, token);
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.goto(`${BASE}/merchant/dashboard`);
  await page.waitForURL(`${BASE}/merchant/dashboard`, { timeout: 15_000 });
  expect(page.url()).toContain("/merchant/dashboard");
  await expect(
    page.locator('[data-sidebar="sidebar"], header').first(),
  ).toBeVisible({ timeout: 10_000 });
  expect(errors).toHaveLength(0);
});

test("Merchant /auth/me returns correct role", async ({ request }) => {
  const token = readCachedMerchantToken();
  const res = await request.get(`${API}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body).toMatchObject({ role: "merchant" });
});

// ── Mobile: no duplicate Admin Console header ──────────────────────────────

test("Admin dashboard – no duplicate portal label on mobile", async ({ browser }) => {
  const token = readCachedAdminToken();
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await ctx.newPage();
  await page.addInitScript(
    ({ key, value }: { key: string; value: string }) => {
      window.localStorage.setItem(key, value);
    },
    { key: LS_TOKEN_KEY, value: token },
  );
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto(`${BASE}/admin/dashboard`);
  await page.waitForURL(`${BASE}/admin/dashboard`, { timeout: 15_000 });

  // With sidebar closed, count visible elements containing "Admin Console"
  const portalLabelLocator = page.locator("text=Admin Console");
  const count = await portalLabelLocator.count();
  // Only the MobileHeader should be showing "Admin Console" on mobile (sidebar is closed Sheet)
  // The SidebarHeader is hidden via `hidden md:flex` so should not be visible
  const visibleCount = await portalLabelLocator.evaluateAll((els: Element[]) =>
    els.filter((el) => {
      const rect = (el as HTMLElement).getBoundingClientRect();
      const style = window.getComputedStyle(el as HTMLElement);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0"
      );
    }).length,
  );
  expect(visibleCount).toBeLessThanOrEqual(1);

  await ctx.close();
  expect(errors).toHaveLength(0);
});

test("Merchant dashboard – no duplicate portal label on mobile", async ({ browser }) => {
  const token = readCachedMerchantToken();
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await ctx.newPage();
  await page.addInitScript(
    ({ key, value }: { key: string; value: string }) => {
      window.localStorage.setItem(key, value);
    },
    { key: LS_TOKEN_KEY, value: token },
  );
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto(`${BASE}/merchant/dashboard`);
  await page.waitForURL(`${BASE}/merchant/dashboard`, { timeout: 15_000 });

  const portalLabelLocator = page.locator("text=Merchant Portal");
  const visibleCount = await portalLabelLocator.evaluateAll((els: Element[]) =>
    els.filter((el) => {
      const rect = (el as HTMLElement).getBoundingClientRect();
      const style = window.getComputedStyle(el as HTMLElement);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0"
      );
    }).length,
  );
  expect(visibleCount).toBeLessThanOrEqual(1);

  await ctx.close();
  expect(errors).toHaveLength(0);
});

// ── Cross-role access control ──────────────────────────────────────────────

test("Merchant token cannot access admin merchant list", async ({ request }) => {
  const token = readCachedMerchantToken();
  const res = await request.get(`${API}/admin/merchants`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect([401, 403]).toContain(res.status());
});

test("Admin plans list returns at least 5 plans", async ({ request }) => {
  const token = readCachedAdminToken();
  const res = await request.get(`${API}/plans`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body)).toBe(true);
  expect(body.length).toBeGreaterThanOrEqual(5);
});
