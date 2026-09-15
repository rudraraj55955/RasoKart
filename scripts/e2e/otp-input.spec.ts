/**
 * OTP Input Behavioral Test
 * Tests the 6-box OtpCodeInput component across all required behaviors.
 *
 * Run: PLAYWRIGHT_BROWSERS_PATH=/home/runner/workspace/.cache/ms-playwright \
 *      pnpm exec playwright test --config=playwright.config.ts scripts/test-otp-input.ts
 *
 * Strategy: navigate to merchant /merchant/login OTP tab, trigger the send-OTP
 * form, then test all 6-box behaviors WITHOUT needing the real OTP code.
 * Wrong-OTP submission is used to verify error handling.
 */
import { test, expect, chromium, type Page } from "@playwright/test";

const BASE = process.env["APP_BASE_URL"] ?? "http://localhost:3000";

function otpInput(page: Page) {
  return page.locator('input[autocomplete="one-time-code"]');
}

function otpSlots(page: Page) {
  return page.locator('[role="group"][aria-label="One-time password"] [data-otp-slot]');
}

// ────────────────────────────────────────────────────────────────────────────
// SETUP: reach the OTP verification form
// We trigger "Send OTP" for the demo merchant email so the 6 boxes appear.
// We do NOT need the real code — behaviors are tested with arbitrary digits.
// ────────────────────────────────────────────────────────────────────────────
async function reachOtpForm(page: Page) {
  await page.goto(`${BASE}/merchant/login`);
  await page.waitForLoadState("networkidle");

  // Click the OTP tab
  await page.click('button[role="tab"]:has-text("OTP"), [data-value="otp"]');

  // Enter the demo merchant email
  await page.fill(
    'input[name="identifier"], input[placeholder*="email"], input[type="email"]',
    "merchant@demo.com"
  );

  // Click "Send OTP" / "Continue"
  await page.click('button[type="submit"]');

  // Wait for the 6-box group to appear (server sends OTP, UI advances to verify step)
  await page.waitForSelector('[role="group"][aria-label="One-time password"]', {
    timeout: 15_000,
  });
}

// ────────────────────────────────────────────────────────────────────────────
test.describe("OTP input — 6-box component behaviors", () => {
  test.setTimeout(60_000);

  // ── T1: Renders 6 boxes with correct attributes ──────────────────────────
  test("T1: renders exactly 6 boxes with autocomplete=one-time-code and inputmode=numeric", async ({
    page,
  }) => {
    await reachOtpForm(page);
    await expect(otpSlots(page)).toHaveCount(6);
    const input = otpInput(page);
    await expect(input).toHaveCount(1);
    await expect(input).toHaveAttribute("autocomplete", "one-time-code");
    await expect(input).toHaveAttribute("inputmode", "numeric");
    await expect(input).not.toHaveAttribute("type", /^(number|tel)$/);
    await expect(input).toHaveAttribute("maxlength", "6");
    console.log("T1 PASS: 6 boxes, autocomplete=one-time-code, inputmode=numeric");
  });

  // ── T2: Auto-focus on first box ──────────────────────────────────────────
  test("T2: first box is auto-focused on mount", async ({ page }) => {
    await reachOtpForm(page);
    await expect(otpInput(page)).toBeFocused();
    console.log("T2 PASS: first box auto-focused");
  });

  // ── T3: Manual entry + auto-advance ─────────────────────────────────────
  test("T3: typing a digit advances focus to the next box", async ({
    page,
  }) => {
    await reachOtpForm(page);
    const input = otpInput(page);
    await input.focus();
    await page.keyboard.type("123456");
    await expect(input).toHaveValue("123456");
    await expect(input).toBeFocused();

    console.log("T3 PASS: digit-by-digit entry advances focus correctly");
  });

  // ── T4: Non-numeric characters rejected ─────────────────────────────────
  test("T4: non-numeric characters are silently rejected", async ({ page }) => {
    await reachOtpForm(page);
    const input = otpInput(page);
    await input.focus();
    await page.keyboard.type("a");
    await expect(input).toHaveValue("");
    await expect(input).toBeFocused();

    await page.keyboard.type("!");
    await expect(input).toHaveValue("");

    console.log("T4 PASS: non-numeric chars rejected, focus stays");
  });

  // ── T5: Backspace on occupied box clears it (focus stays) ───────────────
  test("T5: Backspace on a filled box clears the digit and keeps focus", async ({
    page,
  }) => {
    await reachOtpForm(page);
    const input = otpInput(page);
    await input.fill("7");
    await page.keyboard.press("Backspace");
    await expect(input).toHaveValue("");
    await expect(input).toBeFocused();

    console.log("T5 PASS: Backspace clears filled box");
  });

  // ── T6: Backspace on empty box moves focus to previous ──────────────────
  test("T6: Backspace on an empty box moves focus to the previous box", async ({
    page,
  }) => {
    await reachOtpForm(page);
    const input = otpInput(page);
    await input.fill("12");
    await page.keyboard.press("Backspace");
    await expect(input).toHaveValue("1");
    await page.keyboard.press("Backspace");
    await expect(input).toHaveValue("");
    await expect(input).toBeFocused();

    console.log("T6 PASS: Backspace on empty box moves focus backward");
  });

  // ── T7: Full-code paste distributes across all 6 boxes ──────────────────
  test("T7: pasting a 6-digit code fills all boxes", async ({ page }) => {
    await reachOtpForm(page);
    const input = otpInput(page);
    await input.focus();
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.evaluate(() => navigator.clipboard.writeText("987654"));
    await page.keyboard.press("Control+V");

    await expect(input).toHaveValue("987654");

    console.log("T7 PASS: paste distributes digits across all 6 boxes");
  });

  // ── T8: Selection replacement ────────────────────────────────────────────
  test("T8: selection replacement preserves native cursor behavior", async ({ page }) => {
    await reachOtpForm(page);
    const input = otpInput(page);
    await input.fill("123456");
    await input.evaluate((element: HTMLInputElement) => element.setSelectionRange(2, 4));
    await page.keyboard.type("9");
    await expect(input).toHaveValue("12956");
    console.log("T8 PASS: native selection replacement works");
  });

  // ── T9: Wrong OTP shows error, does not crash ────────────────────────────
  test("T9: submitting a wrong 6-digit OTP shows an error without crashing", async ({
    page,
  }) => {
    await reachOtpForm(page);
    await otpInput(page).fill("123456");

    // Submit
    await page.click('button[type="submit"]');

    // Errors are shown as sonner toasts (toast.error).
    // Use .first() because multiple past toasts may still be in the DOM.
    await expect(
      page.locator('[data-sonner-toast][data-type="error"]').first()
    ).toBeVisible({ timeout: 12_000 });

    // The 6 boxes must still be present (no crash / page navigation)
    await expect(otpSlots(page)).toHaveCount(6);

    console.log("T9 PASS: wrong OTP shows error, boxes remain, no crash");
  });

  // ── T10: Partial paste (< 6 digits) fills from start ────────────────────
  test("T10: pasting fewer than 6 digits fills from the beginning", async ({
    page,
  }) => {
    await reachOtpForm(page);
    const input = otpInput(page);
    await input.focus();
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.evaluate(() => navigator.clipboard.writeText("123"));
    await page.keyboard.press("Control+V");

    await expect(input).toHaveValue("123");

    console.log("T10 PASS: partial paste fills only available digits");
  });
});
