/**
 * merchant-signup-flow.spec.ts
 *
 * E2e regression suite for the three-stage merchant signup flow at /merchant/apply.
 *
 * The OTP stage uses a single native <input type="tel" autocomplete="one-time-code"
 * inputmode="numeric" maxlength="6"> controlled by plain React useState (NOT
 * React Hook Form). Because it is an uncontrolled-style plain input, Playwright's
 * standard fill() sets the value and fires the React onChange correctly.
 *
 * Hybrid approach:
 *   - UI navigation for the email stage and all assertions
 *   - otpInput(page).fill(digits) for OTP entry (works on the single-input design)
 *   - GET /api/dev/otp (dev-only) to retrieve the real plaintext OTP without
 *     email inbox access
 *   - Direct API fetch to verify the probe-response contract for the
 *     invalid-OTP and valid-OTP cases
 *
 * Tests covered:
 *   1. Email form submits and transitions to the OTP stage (single OTP input visible)
 *   2. Verify button stays disabled until all 6 digits are entered
 *   3. Invalid OTP returns the correct 400 error and shows an error toast
 *   4. Valid OTP (probe pattern) advances from the OTP stage to the registration form
 *
 * Each test uses a distinct email address to avoid the 60-second OTP resend
 * cooldown interfering between tests (workers: 1, so tests run serially).
 */

import { test, expect, type Page } from "@playwright/test";

const BASE = "http://localhost:80";
const API  = `${BASE}/api`;

const TEST_EMAILS = {
  stageTransition: "e2e-signup-stage@example.com",
  buttonDisabled:  "e2e-signup-disabled@example.com",
  invalidOtp:      "e2e-signup-invalid-otp@example.com",
  validOtp:        "e2e-signup-valid-otp@example.com",
} as const;

// ── API helpers ───────────────────────────────────────────────────────────────

/** Age the latest OTP row so the 60-second resend cooldown is bypassed.
 *  Ignores 404 — if no row exists yet the first UI send will work anyway. */
async function resetOtpCooldown(email: string): Promise<void> {
  await fetch(`${API}/dev/otp/reset-cooldown`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, purpose: "SIGNUP_VERIFY" }),
  });
}

/** Consume and return the plaintext OTP that the server captured in-memory
 *  when it generated the code.  Retries to tolerate the brief lag between
 *  the UI's fetch completing and the dev store being written. */
async function getDevOtp(email: string, retries = 8): Promise<string> {
  for (let i = 0; i < retries; i++) {
    const res = await fetch(
      `${API}/dev/otp?email=${encodeURIComponent(email)}&purpose=SIGNUP_VERIFY`,
    );
    if (res.ok) {
      const data = (await res.json()) as { otp: string };
      return data.otp;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No dev OTP found for ${email} after ${retries} retries`);
}

// ── UI helpers ────────────────────────────────────────────────────────────────

async function goToApply(page: Page): Promise<void> {
  await page.goto("/merchant/apply");
  await page.waitForLoadState("networkidle");
}

/** The single OTP input on the verification stage. */
function otpInput(page: Page) {
  return page.locator('input[autocomplete="one-time-code"]');
}

function verifyButton(page: Page) {
  return page.getByRole("button", { name: /verify email/i });
}

/**
 * Fill the email form and click submit, causing the UI to POST to
 * /api/auth/signup/send-email-otp and transition to the OTP stage.
 *
 * The server always returns 200 (safe message) regardless of whether the
 * email is already registered, so the UI reliably transitions to the OTP
 * stage as long as there is no 429.
 */
async function submitEmailForm(page: Page, email: string): Promise<void> {
  const field = page.locator('input[type="email"]');
  await expect(field).toBeVisible({ timeout: 5_000 });
  await field.fill(email);
  await page.getByRole("button", { name: /send verification code/i }).click();
  // Wait for the OTP stage — single OTP input must appear
  await expect(otpInput(page)).toBeVisible({ timeout: 10_000 });
}

/**
 * Fill the OTP value into the single native input.
 *
 * The OTP stage uses plain React useState (not RHF), so Playwright's fill()
 * sets the value and fires onChange correctly — no hook injection needed.
 */
async function setOtpValue(page: Page, digits: string): Promise<void> {
  const input = otpInput(page);
  await expect(input).toBeVisible({ timeout: 5_000 });
  await input.fill(digits);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test("email form transitions to the OTP stage", async ({ page }) => {
  await resetOtpCooldown(TEST_EMAILS.stageTransition);
  await goToApply(page);

  // ── Email stage ──
  await expect(
    page.getByRole("button", { name: /send verification code/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /apply for rasokart/i }),
  ).toBeVisible();

  // ── Submit → OTP stage ──
  await submitEmailForm(page, TEST_EMAILS.stageTransition);

  // ── OTP stage must be visible ──
  // The OTP stage renders a single <input autocomplete="one-time-code"> —
  // asserting its presence confirms the stage transition and that the input
  // was not silently replaced or removed.
  const otp = otpInput(page);
  await expect(otp).toBeVisible();
  await expect(otp).toHaveAttribute("inputmode", "numeric");
  await expect(otp).toHaveAttribute("maxlength", "6");
  await expect(otp).toHaveAttribute("autocomplete", "one-time-code");

  // Navigation controls and the verified address must be visible.
  await expect(verifyButton(page)).toBeVisible();
  await expect(page.getByRole("button", { name: /change email/i })).toBeVisible();
  await expect(page.getByText(TEST_EMAILS.stageTransition)).toBeVisible();
});

test("verify button stays disabled until all 6 digits are entered", async ({ page }) => {
  await resetOtpCooldown(TEST_EMAILS.buttonDisabled);
  await goToApply(page);
  await submitEmailForm(page, TEST_EMAILS.buttonDisabled);

  const btn = verifyButton(page);

  // Initially disabled (field is empty).
  await expect(btn).toBeDisabled();

  // Still disabled with only 3 digits.
  await setOtpValue(page, "123");
  await expect(btn).toBeDisabled();

  // Enabled once all 6 digits are present.
  await setOtpValue(page, "123456");
  await expect(btn).toBeEnabled({ timeout: 3_000 });
});

test("invalid OTP returns the correct error and shows an error toast", async ({ page }) => {
  await resetOtpCooldown(TEST_EMAILS.invalidOtp);
  await goToApply(page);
  await submitEmailForm(page, TEST_EMAILS.invalidOtp);

  // Inject a wrong 6-digit code so the button enables.
  await setOtpValue(page, "000000");
  await expect(verifyButton(page)).toBeEnabled({ timeout: 3_000 });

  // Submit and capture the /auth/register probe response.
  const [response] = await Promise.all([
    page.waitForResponse(
      (res) =>
        /\/auth\/register/.test(res.url()) && res.request().method() === "POST",
    ),
    verifyButton(page).click(),
  ]);

  // Server must return 400 with a verification-code error.
  expect(response.status()).toBe(400);
  const body = (await response.json()) as { error?: string };
  expect(body.error?.toLowerCase()).toMatch(/verification code|incorrect/);

  // The error must surface as a visible Sonner error toast.
  await expect(
    page.locator('[data-sonner-toast][data-type="error"]').first(),
  ).toBeVisible({ timeout: 10_000 });

  // OTP stage must remain — no navigation away on a wrong code.
  await expect(otpInput(page)).toBeVisible();
  await expect(verifyButton(page)).toBeVisible();
});

test("valid OTP (probe) advances to the registration form", async ({ page }) => {
  await resetOtpCooldown(TEST_EMAILS.validOtp);
  await goToApply(page);

  // Submit the email form; the server captures the OTP in the dev store.
  await submitEmailForm(page, TEST_EMAILS.validOtp);

  // Retrieve the plaintext OTP without email inbox access.
  const otp = await getDevOtp(TEST_EMAILS.validOtp);
  expect(otp).toMatch(/^\d{6}$/);

  // Inject the real OTP and verify the button enables.
  await setOtpValue(page, otp);
  await expect(verifyButton(page)).toBeEnabled({ timeout: 3_000 });

  // Submit.
  // The probe sends { password: "__probe__", phone: "__probe__", … } with the
  // valid OTP. The server validates the OTP (passes), then rejects the phone
  // ("__probe__" contains no digits → 400 "Phone number must contain at least
  // one digit"). Because the error text does not contain "verification code",
  // the client treats it as "OTP accepted" and advances to the registration
  // stage without consuming the OTP row.
  await verifyButton(page).click();

  // Registration form must appear.
  await expect(
    page.getByText(/email verified/i),
    "email-verified banner must appear after a valid OTP",
  ).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('input[placeholder*="Acme"]')).toBeVisible();
  await expect(page.locator('input[type="password"]')).toBeVisible();
  await expect(
    page.getByRole("button", { name: /submit application/i }),
  ).toBeVisible();
});
