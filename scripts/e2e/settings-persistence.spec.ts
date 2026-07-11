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
import { readCachedAdminToken } from "./token-cache";

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

/**
 * Select all content in the input, then type the new value character-by-
 * character using Playwright's keyboard API.
 *
 * Why not `locator.fill()`?  `fill()` sets the DOM value directly without
 * firing the individual key-event sequence (keydown → keypress → input →
 * keyup) that React 19's synthetic event system hooks into.  For
 * `type="number"` controlled inputs this can leave React's state at the old
 * value even though the DOM shows the new one, so the subsequent `mutate()`
 * call captures the stale closure and writes the wrong value to the DB.
 *
 * `page.keyboard.type()` fires real key events for each character, which
 * React processes through its input-event listener and correctly calls the
 * `onChange` handler so the state updates before the Save button is clicked.
 *
 * We finish with a `toHaveValue` assertion (auto-waits up to 3 s) to confirm
 * React has settled on the new value before we proceed.
 */
async function fillNumeric(page: Page, id: string, value: number): Promise<void> {
  const input = page.locator(`#${id}`);
  await input.click({ clickCount: 3 });
  await page.keyboard.type(String(value));
  await expect(input).toHaveValue(String(value), { timeout: 3_000 });
}

/**
 * Click a Save button and wait for its underlying PUT request to actually
 * complete (200) before continuing — not just for the success toast to
 * render. Under `fullyParallel` load, four chromium workers hitting the API
 * concurrently can make a toast render-and-fade faster than a slow test
 * runner polls for it, or a reload can race a still-in-flight save. Anchoring
 * on the network response instead of the toast text removes that timing
 * flakiness while still asserting the toast as a UI-behavior check.
 */
async function saveAndConfirm(
  page: Page,
  saveButton: ReturnType<typeof cardSave>,
  putUrlPattern: RegExp,
  toastRegex: RegExp,
): Promise<void> {
  const [response] = await Promise.all([
    page.waitForResponse((res) => putUrlPattern.test(res.url()) && res.request().method() === "PUT"),
    saveButton.click(),
  ]);
  if (!response.ok()) {
    throw new Error(`Save PUT to ${response.url()} failed with ${response.status()}`);
  }
  await expect(page.getByText(toastRegex)).toBeVisible({ timeout: 10_000 });
}

// ── Token ───────────────────────────────────────────────────────────────────
//
// Original-value snapshot/restore lives in global-setup.ts / global-teardown.ts
// instead of a per-file beforeAll/afterAll. With `fullyParallel: true`,
// `beforeAll`/`afterAll` declared in a spec file run once *per worker process*
// that executes tests from that file — not once for the whole file. A worker
// that finishes its share of this file's tests early would fire `afterAll`
// and overwrite a setting that a *different* worker is still mid-test on,
// corrupting that still-running test's expected value. globalSetup/
// globalTeardown are each guaranteed to run exactly once for the whole
// `playwright test` invocation regardless of worker count, so they're the
// only safe place for a shared "capture once / restore once" step.

let token: string;

test.beforeAll(() => {
  // Read the token cached once by global-setup.ts instead of calling
  // /auth/login again here — with fullyParallel workers, every worker runs
  // its own copy of this beforeAll, and repeated logins would exhaust the
  // DB-backed login rate limiter (10 attempts / 15 min per IP).
  token = readCachedAdminToken();
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

  await saveAndConfirm(page, cardSave(page, "smtp-host"), /\/settings\/smtp$/, /smtp settings saved/i);

  await page.reload();
  await page.waitForLoadState("networkidle");

  await expect(page.locator("#smtp-host")).toHaveValue(canary, { timeout: 8_000 });
});

test("QR cleanup retention days persists after page reload", async ({ page }) => {
  const baseline = 30;
  const canary = 47;
  await apiPut(token, "/system-config/qr-cleanup", { retentionDays: baseline });

  await goToSettings(page, token);

  // Wait for React Query to hydrate the field (any non-empty value).
  // We do not assert the exact baseline here because a concurrent
  // globalTeardown from the simultaneously-running merchant test suite can
  // race and restore the DB to its own snapshot value between our apiPut and
  // the page fetch.  The persistence assertion (after save+reload) is
  // authoritative — the pre-save check is only a readiness gate.
  await expect(page.locator("#retention-days")).toBeVisible({ timeout: 8_000 });
  await expect(page.locator("#retention-days")).not.toHaveValue("", { timeout: 8_000 });

  await fillNumeric(page, "retention-days", canary);
  await saveAndConfirm(page, cardSave(page, "retention-days"), /\/system-config\/qr-cleanup$/, /qr cleanup retention saved/i);

  await page.reload();
  await page.waitForLoadState("networkidle");

  await expect(page.locator("#retention-days")).toHaveValue(String(canary), { timeout: 8_000 });
});

test("VA cleanup retention days persists after page reload", async ({ page }) => {
  const baseline = 30;
  const canary = 52;
  await apiPut(token, "/system-config/va-cleanup", { retentionDays: baseline });

  await goToSettings(page, token);

  // Same readiness-gate pattern as QR cleanup — avoid brittle exact-baseline
  // assertion that races against concurrent globalTeardown restores.
  await expect(page.locator("#va-retention-days")).toBeVisible({ timeout: 8_000 });
  await expect(page.locator("#va-retention-days")).not.toHaveValue("", { timeout: 8_000 });

  await fillNumeric(page, "va-retention-days", canary);
  await saveAndConfirm(page, cardSave(page, "va-retention-days"), /\/system-config\/va-cleanup$/, /va cleanup retention saved/i);

  await page.reload();
  await page.waitForLoadState("networkidle");

  await expect(page.locator("#va-retention-days")).toHaveValue(String(canary), { timeout: 8_000 });
});

// The two webhook-retry tests below both read-modify-write the same
// `/system-config/webhook-retries` endpoint (it's a single row covering
// maxAttempts + all three delays). Running them concurrently under
// `fullyParallel: true` would race: one test's baseline PUT could stomp the
// other's canary value mid-assertion. `test.describe.serial` keeps this pair
// running in-order (and in the same worker) while still letting Playwright
// parallelize the rest of the suite across workers.
test.describe.serial("webhook retry schedule (shared endpoint)", () => {
  test("Webhook retry max attempts persists after page reload", async ({ page }) => {
    await apiPut(token, "/system-config/webhook-retries", { maxAttempts: 4, delay1: 300, delay2: 900, delay3: 3600 });

    await goToSettings(page, token);

    await expect(page.locator("#retry-max-attempts")).toHaveValue("4", { timeout: 8_000 });

    const canary = 3;
    await fillNumeric(page, "retry-max-attempts", canary);
    await saveAndConfirm(page, cardSave(page, "retry-max-attempts"), /\/system-config\/webhook-retries$/, /webhook retry schedule saved/i);

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
    await saveAndConfirm(page, cardSave(page, "retry-delay-1"), /\/system-config\/webhook-retries$/, /webhook retry schedule saved/i);

    await page.reload();
    await page.waitForLoadState("networkidle");

    await expect(page.locator("#retry-delay-1")).toHaveValue(String(canary), { timeout: 8_000 });
  });
});

test("Report delivery retry max attempts persists after page reload", async ({ page }) => {
  await apiPut(token, "/settings/report-delivery-retries", { maxAttempts: 3, backoffBaseMs: 1000 });

  await goToSettings(page, token);

  await expect(page.locator("#report-retry-max")).toHaveValue("3", { timeout: 8_000 });

  const canary = 2;
  await fillNumeric(page, "report-retry-max", canary);
  await saveAndConfirm(page, cardSave(page, "report-retry-max"), /\/settings\/report-delivery-retries$/, /report delivery retry settings saved/i);

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
  await saveAndConfirm(page, cardSave(page, "qh-flush-interval"), /\/system-config\/quiet-hours-flush$/, /quiet hours flush interval saved/i);

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
  await saveAndConfirm(page, cardSave(page, "finance-email"), /\/settings\/finance_report_email$/, /finance report email saved/i);

  await page.reload();
  await page.waitForLoadState("networkidle");

  await expect(page.locator("#finance-email")).toHaveValue(canary, { timeout: 8_000 });
});
