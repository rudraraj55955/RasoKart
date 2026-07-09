/**
 * settings-persistence.spec.ts
 *
 * E2e regression suite for the admin settings page reload-persistence bug class.
 *
 * Each test follows the same flow:
 *   1. Reset the setting to a known baseline value via direct API call
 *   2. Navigate to /admin/settings with an admin JWT token already in localStorage
 *      (avoids the login page entirely and skips 9 sequential login-endpoint hits
 *      that would otherwise trigger the DB-backed rate limiter)
 *   3. Wait for the input to hydrate from the API (confirming React Query loaded)
 *   4. Enter a canary value in the input
 *   5. Click the card's Save button and wait for the success toast
 *   6. Do a full page.reload() (clears React state, forces fresh API fetch)
 *   7. Assert the input shows the saved canary value — not the useState default
 *
 * This permanently guards against the silent-reset bug where values reverted to
 * useState defaults on reload because the React Query v5 `query: { onSuccess }`
 * callback was a no-op and the useEffect hydration was broken.
 *
 * Settings covered:
 *   - SMTP host
 *   - QR cleanup retention days
 *   - VA cleanup retention days
 *   - Webhook retry max attempts
 *   - Webhook retry delay 1
 *   - Report delivery retry max attempts
 *   - Quiet hours flush interval
 *   - Audit log retention (API-set / UI-verified — avoids Radix Select interaction)
 *   - Finance report email
 *
 * Excluded: storage cleanup schedule — the backend only exposes run/runs sub-routes
 * for this card, not a standalone config GET/PUT endpoint, so reload-persistence
 * cannot be verified for it here.
 */

import { test, expect, type Page } from "@playwright/test";

const BASE = "http://localhost:80";
const API = `${BASE}/api`;
const ADMIN_EMAIL = "admin@rasokart.com";
const ADMIN_PASSWORD = "Admin@123456";

/** localStorage key used by the RasoKart frontend to store the JWT. */
const LS_TOKEN_KEY = "rasokart_token";

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function getAdminToken(): Promise<string> {
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  if (!res.ok) throw new Error(`Admin login failed: ${res.status}`);
  const data = (await res.json()) as { token: string };
  return data.token;
}

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

// ── UI helpers ────────────────────────────────────────────────────────────────

/**
 * Inject the admin JWT into localStorage and navigate directly to the settings
 * page — skipping the login form entirely.  This avoids hitting the login
 * endpoint on every test which would otherwise trigger the rate limiter.
 *
 * The two-step goto is intentional:
 *   Step 1 – navigate to the root path to get a same-origin browser context so
 *             localStorage.setItem can run.  (Navigating directly to /admin/settings
 *             without a token triggers a wouter client-side redirect to /admin which
 *             changes the URL, so a subsequent page.reload() lands on the wrong page.)
 *   Step 2 – navigate to /admin/settings now that the token is in localStorage.
 */
async function goToSettings(page: Page, adminToken: string): Promise<void> {
  // Step 1: any same-origin page to establish localStorage context
  await page.goto("/admin");
  await page.evaluate(
    ([key, tok]) => { localStorage.setItem(key, tok); },
    [LS_TOKEN_KEY, adminToken],
  );
  // Step 2: now navigate to settings — the token is already in localStorage
  await page.goto("/admin/settings");
  await page.waitForLoadState("networkidle");
}

/**
 * Find the Save button inside the same Card section that contains the given
 * input id.  Uses xpath to walk up to the nearest Card-like ancestor (a div
 * whose class contains "border-border"), then scopes the button search to that
 * subtree.
 *
 * We use `.last()` (not `.first()`) because Playwright returns ancestor nodes
 * in document order (outermost first).  For inputs that live inside a nested
 * section div (e.g. the report-delivery-retry section is embedded inside the
 * SMTP card), the *outermost* ancestor is the wrong card and its first Save
 * button belongs to a different form.  `.last()` gives us the innermost
 * (closest) matching ancestor, which always contains exactly the right button.
 */
function cardSave(page: Page, inputId: string) {
  return page
    .locator(`#${inputId}`)
    .locator("xpath=ancestor::div[contains(@class,'border-border')]")
    .last()
    .getByRole("button", { name: /^save$/i })
    .first();
}

/** Triple-click to select all content, then fill with the new value. */
async function fillNumeric(page: Page, id: string, value: number): Promise<void> {
  const input = page.locator(`#${id}`);
  await input.click({ clickCount: 3 });
  await input.fill(String(value));
}

// ── Saved originals (restored in afterAll) ────────────────────────────────────

let token: string;

type Originals = {
  smtp: { host: string | null; port: string | null; user: string | null; from: string | null };
  qrRetention: number;
  vaRetention: number;
  webhookRetry: { maxAttempts: number; delay1: number; delay2: number; delay3: number };
  reportRetry: { maxAttempts: number; backoffBaseMs: number };
  quietHoursFlush: number;
  auditLogRetention: number;
  financeEmail: string | null;
};

let originals: Originals;

test.beforeAll(async () => {
  token = await getAdminToken();

  const [smtp, qrCleanup, vaCleanup, webhookRetry, reportRetry, quietHoursFlush, auditLogRetention, settings] =
    await Promise.all([
      apiGet(token, "/settings/smtp"),
      apiGet(token, "/system-config/qr-cleanup"),
      apiGet(token, "/system-config/va-cleanup"),
      apiGet(token, "/system-config/webhook-retries"),
      apiGet(token, "/settings/report-delivery-retries"),
      apiGet(token, "/system-config/quiet-hours-flush"),
      apiGet(token, "/system-config/audit-report-retention"),
      apiGet(token, "/settings"),
    ]);

  originals = {
    smtp: {
      host: smtp.host ?? null,
      port: smtp.port ?? null,
      user: smtp.user ?? null,
      from: smtp.from ?? null,
    },
    qrRetention: qrCleanup.retentionDays ?? 30,
    vaRetention: vaCleanup.retentionDays ?? 30,
    webhookRetry: {
      maxAttempts: webhookRetry.maxAttempts ?? 4,
      delay1: webhookRetry.delay1 ?? 300,
      delay2: webhookRetry.delay2 ?? 900,
      delay3: webhookRetry.delay3 ?? 3600,
    },
    reportRetry: {
      maxAttempts: reportRetry.maxAttempts ?? 3,
      backoffBaseMs: reportRetry.backoffBaseMs ?? 1000,
    },
    quietHoursFlush: quietHoursFlush.intervalSeconds ?? 60,
    auditLogRetention: auditLogRetention.retentionDays ?? 90,
    financeEmail: settings.finance_report_email ?? null,
  };
});

test.afterAll(async () => {
  if (!originals) return;
  await Promise.all([
    apiPut(token, "/settings/smtp", {
      host: originals.smtp.host,
      port: originals.smtp.port,
      smtpUser: originals.smtp.user,
      from: originals.smtp.from,
    }),
    apiPut(token, "/system-config/qr-cleanup", { retentionDays: originals.qrRetention }),
    apiPut(token, "/system-config/va-cleanup", { retentionDays: originals.vaRetention }),
    apiPut(token, "/system-config/webhook-retries", originals.webhookRetry),
    apiPut(token, "/settings/report-delivery-retries", originals.reportRetry),
    apiPut(token, "/system-config/quiet-hours-flush", { intervalSeconds: originals.quietHoursFlush }),
    apiPut(token, "/system-config/audit-report-retention", { retentionDays: originals.auditLogRetention }),
    apiPut(token, "/settings/finance_report_email", { value: originals.financeEmail }),
  ]);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

test("SMTP host persists after page reload", async ({ page }) => {
  await apiPut(token, "/settings/smtp", {
    host: "smtp.seed-baseline.example.com",
    port: "587",
    smtpUser: null,
    from: null,
  });

  await goToSettings(page, token);

  await expect(page.locator("#smtp-host")).toHaveValue("smtp.seed-baseline.example.com", { timeout: 8_000 });

  const canary = "smtp.canary-reload-check.example.com";
  await page.locator("#smtp-host").fill(canary);

  await cardSave(page, "smtp-host").click();
  await expect(page.getByText(/smtp settings saved/i)).toBeVisible({ timeout: 6_000 });

  await page.reload();
  await page.waitForLoadState("networkidle");

  await expect(page.locator("#smtp-host")).toHaveValue(canary, { timeout: 8_000 });
});

test("QR cleanup retention days persists after page reload", async ({ page }) => {
  const baseline = 30;
  const canary = 47;
  await apiPut(token, "/system-config/qr-cleanup", { retentionDays: baseline });

  await goToSettings(page, token);

  await expect(page.locator("#retention-days")).toHaveValue(String(baseline), { timeout: 8_000 });

  await fillNumeric(page, "retention-days", canary);
  await cardSave(page, "retention-days").click();
  await expect(page.getByText(/qr cleanup retention saved/i)).toBeVisible({ timeout: 6_000 });

  await page.reload();
  await page.waitForLoadState("networkidle");

  await expect(page.locator("#retention-days")).toHaveValue(String(canary), { timeout: 8_000 });
});

test("VA cleanup retention days persists after page reload", async ({ page }) => {
  const baseline = 30;
  const canary = 52;
  await apiPut(token, "/system-config/va-cleanup", { retentionDays: baseline });

  await goToSettings(page, token);

  await expect(page.locator("#va-retention-days")).toHaveValue(String(baseline), { timeout: 8_000 });

  await fillNumeric(page, "va-retention-days", canary);
  await cardSave(page, "va-retention-days").click();
  await expect(page.getByText(/va cleanup retention saved/i)).toBeVisible({ timeout: 6_000 });

  await page.reload();
  await page.waitForLoadState("networkidle");

  await expect(page.locator("#va-retention-days")).toHaveValue(String(canary), { timeout: 8_000 });
});

test("Webhook retry max attempts persists after page reload", async ({ page }) => {
  await apiPut(token, "/system-config/webhook-retries", { maxAttempts: 4, delay1: 300, delay2: 900, delay3: 3600 });

  await goToSettings(page, token);

  await expect(page.locator("#retry-max-attempts")).toHaveValue("4", { timeout: 8_000 });

  const canary = 3;
  await fillNumeric(page, "retry-max-attempts", canary);
  await cardSave(page, "retry-max-attempts").click();
  await expect(page.getByText(/webhook retry schedule saved/i)).toBeVisible({ timeout: 6_000 });

  await page.reload();
  await page.waitForLoadState("networkidle");

  await expect(page.locator("#retry-max-attempts")).toHaveValue(String(canary), { timeout: 8_000 });
});

test("Webhook retry delay 1 persists after page reload", async ({ page }) => {
  await apiPut(token, "/system-config/webhook-retries", { maxAttempts: 4, delay1: 300, delay2: 900, delay3: 3600 });

  await goToSettings(page, token);

  await expect(page.locator("#retry-delay-1")).toHaveValue("300", { timeout: 8_000 });

  const canary = 180;
  await fillNumeric(page, "retry-delay-1", canary);
  await cardSave(page, "retry-delay-1").click();
  await expect(page.getByText(/webhook retry schedule saved/i)).toBeVisible({ timeout: 6_000 });

  await page.reload();
  await page.waitForLoadState("networkidle");

  await expect(page.locator("#retry-delay-1")).toHaveValue(String(canary), { timeout: 8_000 });
});

test("Report delivery retry max attempts persists after page reload", async ({ page }) => {
  await apiPut(token, "/settings/report-delivery-retries", { maxAttempts: 3, backoffBaseMs: 1000 });

  await goToSettings(page, token);

  await expect(page.locator("#report-retry-max")).toHaveValue("3", { timeout: 8_000 });

  const canary = 2;
  await fillNumeric(page, "report-retry-max", canary);
  await cardSave(page, "report-retry-max").click();
  await expect(page.getByText(/report delivery retry settings saved/i)).toBeVisible({ timeout: 6_000 });

  await page.reload();
  await page.waitForLoadState("networkidle");

  await expect(page.locator("#report-retry-max")).toHaveValue(String(canary), { timeout: 8_000 });
});

test("Quiet hours flush interval persists after page reload", async ({ page }) => {
  await apiPut(token, "/system-config/quiet-hours-flush", { intervalSeconds: 60 });

  await goToSettings(page, token);

  await expect(page.locator("#qh-flush-interval")).toHaveValue("60", { timeout: 8_000 });

  const canary = 90;
  await fillNumeric(page, "qh-flush-interval", canary);
  await cardSave(page, "qh-flush-interval").click();
  await expect(page.getByText(/quiet hours flush interval saved/i)).toBeVisible({ timeout: 6_000 });

  await page.reload();
  await page.waitForLoadState("networkidle");

  await expect(page.locator("#qh-flush-interval")).toHaveValue(String(canary), { timeout: 8_000 });
});

/**
 * Audit log retention uses a Radix Select dropdown.  Interacting with Radix
 * Select in Playwright is known to be flaky.  Instead: set the canary directly
 * via the API and then verify that the UI SelectTrigger renders the correct
 * label text after a full reload — which still exercises the useEffect
 * hydration path that the silent-reset bug broke.
 */
test("Audit log retention persists after page reload (API-set, UI-verified)", async ({ page }) => {
  await apiPut(token, "/system-config/audit-report-retention", { retentionDays: 90 });

  await goToSettings(page, token);

  // Confirm baseline shows 90 days
  await expect(page.locator("#audit-log-retention")).toContainText("90 days", { timeout: 8_000 });

  // Set canary via API and reload to verify hydration
  await apiPut(token, "/system-config/audit-report-retention", { retentionDays: 60 });
  await page.reload();
  await page.waitForLoadState("networkidle");

  await expect(page.locator("#audit-log-retention")).toContainText("60 days", { timeout: 8_000 });
});

test("Finance report email persists after page reload", async ({ page }) => {
  await apiPut(token, "/settings/finance_report_email", { value: null });

  await goToSettings(page, token);

  await expect(page.locator("#finance-email")).toHaveValue("", { timeout: 8_000 });

  const canary = "canary-reload-check@example.com";
  await page.locator("#finance-email").fill(canary);
  await cardSave(page, "finance-email").click();
  await expect(page.getByText(/finance report email saved/i)).toBeVisible({ timeout: 6_000 });

  await page.reload();
  await page.waitForLoadState("networkidle");

  await expect(page.locator("#finance-email")).toHaveValue(canary, { timeout: 8_000 });
});
