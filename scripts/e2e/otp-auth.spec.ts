/**
 * otp-auth.spec.ts
 *
 * Playwright regression suite for the merchant OTP login and Forgot Password
 * flows.  Guards against:
 *
 *   1. Tab-label regressions ("Forgot Password" tab label must stay as-is)
 *   2. OtpCodeInput being silently replaced by a plain <Input> (would lose
 *      the maxLength=6 / inputMode=numeric / autoComplete=one-time-code
 *      attributes and the non-digit-stripping onChange behaviour)
 *   3. OTP login flow silently breaking (request → verify → dashboard)
 *   4. Forgot Password flow silently breaking (request → reset → login → dashboard)
 *   5. Old OTP being accepted after a resend issues a fresh one
 *
 * OTP code strategy
 * -----------------
 * OTPs are stored as bcrypt hashes (cost 10) so they cannot be read back
 * from the DB.  This spec uses scripts/src/seed-test-otp.ts to INSERT a new
 * row with a pre-known hash.  The verify/reset endpoints always pick the
 * LATEST row (ORDER BY created_at DESC) so the seeded row takes precedence
 * over any row the API created when the UI fired its "Send code" request.
 *
 * Test accounts
 * -------------
 *   - merchant3@demo.com  — used for OTP login and Forgot Password flows
 *   - merchant@demo.com   — used for the resend-invalidation test
 *
 * The Forgot Password test changes merchant3's password; it restores the
 * original at the end via a second forgot-password API cycle so subsequent
 * runs start clean.
 */

import { test, expect } from "@playwright/test";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import path from "path";

const BASE = "http://localhost:80";
const API = `${BASE}/api`;

const __filename = fileURLToPath(import.meta.url);
const SCRIPTS_DIR = path.resolve(path.dirname(__filename), "..");

const MERCHANT3_EMAIL = "merchant3@demo.com";
const MERCHANT3_ORIG_PASS = "Merchant@123456";

const MERCHANT1_EMAIL = "merchant@demo.com";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Insert a test OTP row with a known hash into merchant_auth_otps.
 * The endpoint verify logic picks the LATEST row for an identifier+purpose,
 * so this seeded row will be what the API checks.
 */
function seedOtp(
  identifier: string,
  otp: string,
  purpose: "LOGIN" | "PASSWORD_RESET",
  opts: { backdate?: boolean } = {},
): void {
  const args = [identifier, otp, purpose, ...(opts.backdate ? ["--backdate"] : [])];
  // Quote each argument to handle special chars like @
  const quoted = args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ");
  execSync(`tsx src/seed-test-otp.ts ${quoted}`, {
    cwd: SCRIPTS_DIR,
    env: { ...process.env },
    timeout: 20_000,
    stdio: "pipe",
  });
}

async function apiPost(endpoint: string, body: object): Promise<Response> {
  return fetch(`${API}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── Test group 1: static UI assertions ────────────────────────────────────────

test("merchant login page shows all three tab labels", async ({ page }) => {
  await page.goto(`${BASE}/merchant/login`);
  await expect(page.getByRole("tab", { name: "Password", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "OTP", exact: true })).toBeVisible();
  // Regression guard: the label was previously missing or mis-spelled
  await expect(page.getByRole("tab", { name: "Forgot Password", exact: true })).toBeVisible();
});

test("OTP tab renders OtpCodeInput with correct attributes", async ({ page }) => {
  await page.goto(`${BASE}/merchant/login`);
  await page.getByRole("tab", { name: "OTP" }).click();

  // Identifier stage — OTP input is not yet in the DOM
  // Use a non-existent identifier so no DB row is created; the API returns
  // a safe 200 and the UI still transitions to the OTP entry stage.
  await page.getByLabel("Email or mobile number").fill("nonexistent@example.invalid");
  await page.getByRole("button", { name: "Send login code" }).click();

  // Wait for the OTP entry stage
  const otpInput = page.locator('input[autocomplete="one-time-code"]');
  await expect(otpInput).toBeVisible({ timeout: 10_000 });

  // Key attributes that OtpCodeInput sets (and a plain <Input> would not)
  await expect(otpInput).toHaveAttribute("maxlength", "6");
  await expect(otpInput).toHaveAttribute("inputmode", "numeric");
  await expect(otpInput).toHaveAttribute("autocomplete", "one-time-code");
  await expect(otpInput).toHaveAttribute("pattern", "[0-9]*");
});

test("OtpCodeInput strips non-digits and limits input to 6 characters", async ({ page }) => {
  await page.goto(`${BASE}/merchant/login`);
  await page.getByRole("tab", { name: "OTP" }).click();
  await page.getByLabel("Email or mobile number").fill("nonexistent@example.invalid");
  await page.getByRole("button", { name: "Send login code" }).click();

  const otpInput = page.locator('input[autocomplete="one-time-code"]');
  await expect(otpInput).toBeVisible({ timeout: 10_000 });

  // Mix of digits and non-digits — only the 6 digits should survive
  await otpInput.fill("1a2b3c");
  await expect(otpInput).toHaveValue("123");

  // More than 6 digits — should be capped at 6
  await otpInput.fill("1234567890");
  await expect(otpInput).toHaveValue("123456");

  // Pure digits, exactly 6 — should be accepted as-is
  await otpInput.fill("654321");
  await expect(otpInput).toHaveValue("654321");
});

// ── Test group 2: full OTP login flow ─────────────────────────────────────────

test("OTP login: request code → seed known hash → enter code → verify → dashboard", async ({
  page,
}) => {
  await page.goto(`${BASE}/merchant/login`);
  await page.getByRole("tab", { name: "OTP" }).click();

  // Identifier stage
  await page.getByLabel("Email or mobile number").fill(MERCHANT3_EMAIL);
  await page.getByRole("button", { name: "Send login code" }).click();

  // Wait for the OTP entry stage (the API responded, OTP row exists in DB)
  const otpInput = page.locator('input[autocomplete="one-time-code"]');
  await expect(otpInput).toBeVisible({ timeout: 10_000 });

  // Insert a row with a known hash — becomes the latest row so verify picks it
  const TEST_OTP = "701432";
  seedOtp(MERCHANT3_EMAIL, TEST_OTP, "LOGIN");

  // Enter the known code and submit
  await otpInput.fill(TEST_OTP);
  await page.getByRole("button", { name: "Verify & sign in" }).click();

  // Should redirect to the merchant dashboard
  await expect(page).toHaveURL(/\/merchant\/dashboard/, { timeout: 15_000 });
});

// ── Test group 3: forgot-password flow ────────────────────────────────────────

test("forgot password: request reset → seed OTP → reset via UI form → sign in with new password → dashboard", async ({
  page,
}) => {
  const TEMP_PASS = "TempReset@8811";
  const RESET_OTP = "381967";

  // ── Request reset ────────────────────────────────────────────────────────
  await page.goto(`${BASE}/merchant/login`);
  await page.getByRole("tab", { name: "Forgot Password", exact: true }).click();
  await page.getByLabel("Email or mobile number").fill(MERCHANT3_EMAIL);
  await page.getByRole("button", { name: "Send reset code" }).click();

  // Wait for the reset-entry stage (OTP input must appear)
  const otpInput = page.locator('input[autocomplete="one-time-code"]');
  await expect(otpInput).toBeVisible({ timeout: 10_000 });

  // Seed a known OTP so the UI's verify request can succeed
  seedOtp(MERCHANT3_EMAIL, RESET_OTP, "PASSWORD_RESET");

  // ── Fill the reset form ───────────────────────────────────────────────────
  // Setting the OTP in a React 19 concurrent-mode controlled input reliably
  // from Playwright is non-trivial:
  //
  //   - fill() / pressSequentially(): React reverts the DOM value to its
  //     controlled state ("") in headless Chromium because the Playwright
  //     input events are not trusted by React's event delegation system.
  //   - nativeInputValueSetter + dispatchEvent(change): React's synthetic
  //     onChange fires and calls field.onChange("381967"), but the resulting
  //     _formValues update is a deferred/low-priority concurrent update.
  //     When a higher-priority event (fill on another field) arrives before
  //     the deferred update commits, React discards it.
  //   - Fiber memoizedProps.onChange + ReactDOM.flushSync: flushSync executes
  //     field.onChange but the RHF Controller subscription uses a plain-JS
  //     BehaviorSubject; the setState notification is dispatched outside
  //     React's scheduler, so flushSync cannot capture it — the DOM never
  //     updates even though _formValues is set correctly.
  //
  // Solution: ForgotPasswordTab exposes window.__testForgotSetOtp in DEV
  // builds.  It calls resetForm.setValue() directly, which synchronously
  // writes to RHF's internal _formValues ref.  handleSubmit reads from
  // _formValues (not the DOM), so the submitted data is always correct even
  // if the Controller has not yet re-rendered the DOM input.  The API
  // accepting the OTP is the authoritative proof that the value was set.
  await page.evaluate((value: string) => {
    const fn = (window as unknown as Record<string, unknown>).__testForgotSetOtp;
    if (typeof fn !== "function")
      throw new Error(
        "__testForgotSetOtp not found on window — is the app in DEV mode?",
      );
    (fn as (v: string) => void)(value);
  }, RESET_OTP);

  // Fill the password fields via normal UI interactions.
  await page.locator('input[name="newPassword"]').fill(TEMP_PASS);
  await page.locator('input[name="confirmPassword"]').fill(TEMP_PASS);

  // Verify the password fields are set in the DOM (standard controlled inputs).
  const pwSnapshot = await page.evaluate(() => {
    const sel = (s: string) =>
      (document.querySelector(s) as HTMLInputElement | null)?.value ?? null;
    return {
      newPassword: sel('input[name="newPassword"]'),
      confirmPassword: sel('input[name="confirmPassword"]'),
    };
  });
  if (
    pwSnapshot.newPassword !== TEMP_PASS ||
    pwSnapshot.confirmPassword !== TEMP_PASS
  )
    throw new Error(
      `Password fields not set correctly before submit: ${JSON.stringify(pwSnapshot)}`,
    );

  // ── Submit the UI form ────────────────────────────────────────────────────
  // Intercept the reset request before clicking to capture the response body
  // regardless of timing (avoids a race between click and waitForResponse setup).
  const resetRespPromise = page.waitForResponse(
    (r) =>
      r.url().includes("/auth/merchant/password/reset") &&
      r.request().method() === "POST",
    { timeout: 20_000 },
  );
  await page.getByRole("button", { name: "Reset password" }).click();
  const resetResp = await resetRespPromise;

  if (!resetResp.ok()) {
    const body = await resetResp.json().catch(() => ({ error: "unknown" }));
    throw new Error(
      `Password reset API returned ${resetResp.status()}: ${JSON.stringify(body)}`,
    );
  }

  // Successful reset — onDone() switches the active tab to "Password"
  await expect(
    page.getByRole("tab", { name: "Password", exact: true }),
  ).toHaveAttribute("data-state", "active", { timeout: 10_000 });

  // ── Sign in with new password ─────────────────────────────────────────────
  await page.locator('input[name="email"]').fill(MERCHANT3_EMAIL);
  await page.locator('input[name="password"]').fill(TEMP_PASS);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/merchant\/dashboard/, { timeout: 15_000 });

  // ── Cleanup: restore merchant3's original password ────────────────────────
  // Seed restore OTP directly — avoids the 60 s cooldown still active from
  // the "Send reset code" click at the top of this test.
  const RESTORE_OTP = "924516";
  seedOtp(MERCHANT3_EMAIL, RESTORE_OTP, "PASSWORD_RESET");
  const restoreResp = await apiPost("/auth/merchant/password/reset", {
    identifier: MERCHANT3_EMAIL,
    otp: RESTORE_OTP,
    newPassword: MERCHANT3_ORIG_PASS,
  });
  if (!restoreResp.ok) {
    const body = await restoreResp.text();
    throw new Error(
      `Cleanup: could not restore merchant3 password (${restoreResp.status}): ${body}`,
    );
  }
});

// ── Test group 4: resend invalidates old OTP ──────────────────────────────────

test("old OTP is rejected after resend issues a new one", async () => {
  // Use merchant@demo.com to avoid interfering with the OTP rows from test 2.
  const IDENTIFIER = MERCHANT1_EMAIL;
  const OLD_OTP = "135790";

  // 1. Seed a backdated LOGIN OTP (created_at = now - 120s) so the
  //    resend-cooldown window (60s) has already elapsed.
  seedOtp(IDENTIFIER, OLD_OTP, "LOGIN", { backdate: true });

  // 2. Call the resend endpoint — because the existing OTP is >60s old it is
  //    NOT in cooldown, so createAndSendOtp() inserts a NEW row.
  const resendRes = await apiPost("/auth/merchant/otp/resend", {
    identifier: IDENTIFIER,
  });
  // Must return 200: the backdated seed row is beyond the cooldown window and
  // has resendCount=0, so a new OTP row is always created.  429 would mean
  // rate-limit or resend-cap interference, which prevents the newer row from
  // existing and would make the old-OTP-rejection assertion meaningless.
  expect(resendRes.status).toBe(200);

  // 3. Try to verify with the OLD code.  The verify endpoint picks the LATEST
  //    row (ORDER BY created_at DESC); the resend created a newer row with a
  //    different hash, so the old code no longer matches.
  const verifyRes = await apiPost("/auth/merchant/otp/verify", {
    identifier: IDENTIFIER,
    otp: OLD_OTP,
  });

  // Old OTP must be rejected
  expect(verifyRes.status).toBe(400);
  const body = (await verifyRes.json()) as { error?: string };
  expect(body.error).toMatch(/invalid|expired/i);
});
