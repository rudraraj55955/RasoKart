/**
 * merchant-settings-persistence.spec.ts
 *
 * E2e regression suite guarding the merchant-portal settings pages against
 * the same reload-persistence bug class covered by settings-persistence.spec.ts
 * on the admin side (React Query v5 `query: { onSuccess }` no-op + broken
 * useEffect hydration silently reverting values to useState defaults on reload).
 *
 * Each test follows the same flow:
 *   1. Reset the setting to a known baseline value via direct API call
 *   2. Navigate to the merchant settings page with a merchant JWT token already
 *      in localStorage (skips the login page and its rate-limited endpoint)
 *   3. Wait for the input/control to hydrate from the API
 *   4. Enter/toggle a canary value
 *   5. Save and wait for the success toast
 *   6. Do a full page.reload() (clears React state, forces fresh API fetch)
 *   7. Assert the control still shows the saved canary value — not the
 *      useState default
 *
 * Uses merchant2@demo.com (Gold plan) so plan-gated pages like the webhook
 * config screen are fully accessible.
 *
 * Settings covered:
 *   - Webhook URL (webhook.tsx — useEffect keyed on the `config` query object)
 *   - Security notification preference: API key generated email alert
 *     (security.tsx — Switch checked directly from `me`, no local draft state)
 *   - Quiet hours start time (security.tsx — local draft state hydrated via
 *     useEffect keyed on `me?.email`, the closest merchant-side analog of the
 *     admin bug class)
 *   - Merchant profile business name (profile.tsx — local draft state guarded
 *     by an `editing` flag)
 */

import { test, expect, type Page } from "@playwright/test";
import { readCachedMerchantToken } from "./token-cache";

const BASE = "http://localhost:80";
const API = `${BASE}/api`;

/** localStorage key used by the RasoKart frontend to store the JWT. */
const LS_TOKEN_KEY = "rasokart_token";

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function apiGet(token: string, path: string): Promise<any> {
  const res = await fetch(`${API}${path}`, { headers: authHeaders(token) });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
}

async function apiPut(token: string, path: string, body: object): Promise<void> {
  const res = await fetch(`${API}${path}`, {
    method: "PUT",
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`PUT ${path} → ${res.status}: ${txt}`);
  }
}

async function apiPatch(token: string, path: string, body: object): Promise<void> {
  const res = await fetch(`${API}${path}`, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`PATCH ${path} → ${res.status}: ${txt}`);
  }
}

// ── UI helpers ────────────────────────────────────────────────────────────────

/**
 * Inject the merchant JWT into localStorage and navigate directly to the
 * given merchant page — skipping the login form entirely to avoid hitting
 * the rate-limited login endpoint on every test.
 *
 * The two-step goto mirrors the admin spec: any same-origin page first to
 * establish a browser context for localStorage, then the real destination.
 */
async function goToMerchantPage(page: Page, token: string, path: string): Promise<void> {
  await page.goto("/merchant/login");
  await page.evaluate(
    ([key, tok]) => { localStorage.setItem(key, tok); },
    [LS_TOKEN_KEY, token],
  );
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

// ── Token ───────────────────────────────────────────────────────────────────
//
// Original-value snapshot/restore lives in global-setup.ts / global-teardown.ts
// instead of a per-file beforeAll/afterAll — see the equivalent comment in
// settings-persistence.spec.ts for why: under `fullyParallel: true`,
// beforeAll/afterAll declared in a spec file run once *per worker process*
// handling that file, not once for the whole file, so a per-file afterAll
// restoring shared merchant state could clobber a value another worker's
// test is still asserting on mid-run.

let token: string;

test.beforeAll(() => {
  // Read the token cached once by global-setup.ts instead of calling
  // /auth/login again here — with fullyParallel workers, every worker runs
  // its own copy of this beforeAll, and repeated logins would exhaust the
  // DB-backed login rate limiter (10 attempts / 15 min per IP).
  token = readCachedMerchantToken();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

test("Webhook URL persists after page reload", async ({ page }) => {
  const baseline = "https://baseline.seed-check.example.com/webhook";
  await apiPut(token, "/webhooks", {
    url: baseline,
    isActive: true,
    events: ["payment.success"],
    secret: null,
    // Explicitly pass 0 so the server never applies its default (which can
    // exceed the global cap when a concurrent settings test has temporarily
    // lowered maxAttempts, causing a spurious 422).
    maxRetries: 0,
  });

  await goToMerchantPage(page, token, "/merchant/webhook");

  await expect(page.locator("#webhook-url")).toHaveValue(baseline, { timeout: 8_000 });

  const canary = "https://canary.reload-check.example.com/webhook";
  await page.locator("#webhook-url").fill(canary);

  await page.getByRole("button", { name: /save configuration/i }).click();
  await expect(page.getByText(/webhook configuration saved/i)).toBeVisible({ timeout: 6_000 });

  await page.reload();
  await page.waitForLoadState("networkidle");

  await expect(page.locator("#webhook-url")).toHaveValue(canary, { timeout: 8_000 });
});

test("API key generated email preference persists after page reload", async ({ page }) => {
  await apiPut(token, "/auth/preferences", { apiKeyGeneratedEmails: true });

  await goToMerchantPage(page, token, "/merchant/security");

  const toggle = page.locator("#api-key-generated-email-switch");
  await expect(toggle).toHaveAttribute("data-state", "checked", { timeout: 8_000 });

  const [prefResponse] = await Promise.all([
    page.waitForResponse((res) => /\/auth\/preferences$/.test(res.url()) && res.request().method() === "PUT"),
    toggle.click(),
  ]);
  if (!prefResponse.ok()) {
    throw new Error(`PUT /auth/preferences failed with ${prefResponse.status()}`);
  }
  await expect(page.getByText(/notification preferences saved/i)).toBeVisible({ timeout: 10_000 });
  await expect(toggle).toHaveAttribute("data-state", "unchecked");

  await page.reload();
  await page.waitForLoadState("networkidle");

  await expect(page.locator("#api-key-generated-email-switch")).toHaveAttribute("data-state", "unchecked", { timeout: 8_000 });
});

test("Quiet hours start time persists after page reload", async ({ page }) => {
  await apiPut(token, "/auth/preferences", {
    quietHoursStart: "22:00",
    quietHoursEnd: "07:00",
    quietHoursTimezone: "Asia/Kolkata",
  });

  await goToMerchantPage(page, token, "/merchant/security");

  await expect(page.locator("#qh-start")).toHaveValue("22:00", { timeout: 8_000 });

  const canary = "23:15";
  await page.locator("#qh-start").fill(canary);

  await page.getByRole("button", { name: /save quiet hours/i }).click();
  await expect(page.getByText(/notification preferences saved/i)).toBeVisible({ timeout: 6_000 });

  await page.reload();
  await page.waitForLoadState("networkidle");

  await expect(page.locator("#qh-start")).toHaveValue(canary, { timeout: 8_000 });
});

test("Merchant profile business name persists after page reload", async ({ page }) => {
  const baseline = "Baseline Business Seed";
  await apiPatch(token, "/merchants/me", { businessName: baseline });

  await goToMerchantPage(page, token, "/merchant/profile");

  await page.getByRole("button", { name: /edit profile/i }).click();
  await expect(page.locator("#business-name")).toHaveValue(baseline, { timeout: 8_000 });

  const canary = "Canary Reload Check Ltd";
  await page.locator("#business-name").fill(canary);

  await page.getByRole("button", { name: /save changes/i }).click();
  await expect(page.getByText(/profile updated successfully/i)).toBeVisible({ timeout: 6_000 });

  await page.reload();
  await page.waitForLoadState("networkidle");

  await expect(page.locator("#business-name").or(page.getByText(canary))).toBeVisible({ timeout: 8_000 });

  // Confirm the read-only view (not just an unsaved edit box) reflects the canary.
  await expect(page.getByText(canary)).toBeVisible();
});
