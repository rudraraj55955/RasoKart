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

// Helper: return all OTP slot locators in order
function otpSlots(page: Page) {
  return page.locator('[role="group"][aria-label="One-time password"] input');
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
    const slots = otpSlots(page);
    await expect(slots).toHaveCount(6);

    for (let i = 0; i < 6; i++) {
      const slot = slots.nth(i);
      await expect(slot).toHaveAttribute("autocomplete", "one-time-code");
      await expect(slot).toHaveAttribute("inputmode", "numeric");
      await expect(slot).toHaveAttribute("type", "text");
    }
    console.log("T1 PASS: 6 boxes, autocomplete=one-time-code, inputmode=numeric");
  });

  // ── T2: Auto-focus on first box ──────────────────────────────────────────
  test("T2: first box is auto-focused on mount", async ({ page }) => {
    await reachOtpForm(page);
    const slots = otpSlots(page);
    // autoFocus should put cursor on slot 0
    await expect(slots.nth(0)).toBeFocused();
    console.log("T2 PASS: first box auto-focused");
  });

  // ── T3: Manual entry + auto-advance ─────────────────────────────────────
  test("T3: typing a digit advances focus to the next box", async ({
    page,
  }) => {
    await reachOtpForm(page);
    const slots = otpSlots(page);

    // Type digit into slot 0; focus should move to slot 1
    await slots.nth(0).focus();
    await page.keyboard.type("1");
    await expect(slots.nth(0)).toHaveValue("1");
    await expect(slots.nth(1)).toBeFocused();

    // Type into slot 1 → slot 2
    await page.keyboard.type("2");
    await expect(slots.nth(1)).toHaveValue("2");
    await expect(slots.nth(2)).toBeFocused();

    // Type digits 3-6 in sequence; slot 5 should have "6" and stay focused
    await page.keyboard.type("3");
    await page.keyboard.type("4");
    await page.keyboard.type("5");
    await page.keyboard.type("6");
    await expect(slots.nth(5)).toHaveValue("6");
    await expect(slots.nth(5)).toBeFocused();

    console.log("T3 PASS: digit-by-digit entry advances focus correctly");
  });

  // ── T4: Non-numeric characters rejected ─────────────────────────────────
  test("T4: non-numeric characters are silently rejected", async ({ page }) => {
    await reachOtpForm(page);
    const slots = otpSlots(page);

    await slots.nth(0).focus();
    await page.keyboard.type("a");
    await expect(slots.nth(0)).toHaveValue("");
    await expect(slots.nth(0)).toBeFocused(); // focus must NOT advance

    await page.keyboard.type("!");
    await expect(slots.nth(0)).toHaveValue("");

    console.log("T4 PASS: non-numeric chars rejected, focus stays");
  });

  // ── T5: Backspace on occupied box clears it (focus stays) ───────────────
  test("T5: Backspace on a filled box clears the digit and keeps focus", async ({
    page,
  }) => {
    await reachOtpForm(page);
    const slots = otpSlots(page);

    await slots.nth(0).focus();
    await page.keyboard.type("7");
    await expect(slots.nth(0)).toHaveValue("7");
    // Focus has moved to slot 1; go back to slot 0
    await slots.nth(0).focus();
    await page.keyboard.press("Backspace");
    await expect(slots.nth(0)).toHaveValue("");
    await expect(slots.nth(0)).toBeFocused();

    console.log("T5 PASS: Backspace clears filled box");
  });

  // ── T6: Backspace on empty box moves focus to previous ──────────────────
  test("T6: Backspace on an empty box moves focus to the previous box", async ({
    page,
  }) => {
    await reachOtpForm(page);
    const slots = otpSlots(page);

    // Fill slots 0 and 1
    await slots.nth(0).focus();
    await page.keyboard.type("1");
    await page.keyboard.type("2");
    // Focus is now on slot 2 (empty)
    await expect(slots.nth(2)).toBeFocused();

    // Backspace on empty slot 2 → should clear slot 1 and move to slot 1
    await page.keyboard.press("Backspace");
    await expect(slots.nth(1)).toHaveValue("");
    await expect(slots.nth(1)).toBeFocused();

    console.log("T6 PASS: Backspace on empty box moves focus backward");
  });

  // ── T7: Full-code paste distributes across all 6 boxes ──────────────────
  test("T7: pasting a 6-digit code fills all boxes", async ({ page }) => {
    await reachOtpForm(page);
    const slots = otpSlots(page);

    await slots.nth(0).focus();
    // Simulate paste via clipboard API
    await page.evaluate(() => {
      // Write to clipboard
      Object.defineProperty(navigator, "clipboard", {
        value: {
          writeText: () => Promise.resolve(),
          readText: () => Promise.resolve("987654"),
        },
        configurable: true,
      });
    });

    // Use Playwright's keyboard-based paste simulation
    await page.evaluate(() => {
      const el = document.querySelector(
        '[role="group"][aria-label="One-time password"] input'
      ) as HTMLInputElement;
      el?.focus();
      const dt = new DataTransfer();
      dt.setData("text/plain", "987654");
      el?.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
    });

    // All 6 boxes should be filled
    await expect(slots.nth(0)).toHaveValue("9");
    await expect(slots.nth(1)).toHaveValue("8");
    await expect(slots.nth(2)).toHaveValue("7");
    await expect(slots.nth(3)).toHaveValue("6");
    await expect(slots.nth(4)).toHaveValue("5");
    await expect(slots.nth(5)).toHaveValue("4");

    console.log("T7 PASS: paste distributes digits across all 6 boxes");
  });

  // ── T8: Arrow key navigation ─────────────────────────────────────────────
  test("T8: ArrowLeft/ArrowRight navigate between boxes", async ({ page }) => {
    await reachOtpForm(page);
    const slots = otpSlots(page);

    await slots.nth(2).focus();
    await page.keyboard.press("ArrowLeft");
    await expect(slots.nth(1)).toBeFocused();

    await page.keyboard.press("ArrowRight");
    await expect(slots.nth(2)).toBeFocused();

    console.log("T8 PASS: ArrowLeft/ArrowRight navigate boxes");
  });

  // ── T9: Wrong OTP shows error, does not crash ────────────────────────────
  test("T9: submitting a wrong 6-digit OTP shows an error without crashing", async ({
    page,
  }) => {
    await reachOtpForm(page);
    const slots = otpSlots(page);

    // Fill all boxes with an obviously wrong code
    await slots.nth(0).focus();
    await page.keyboard.type("1");
    await page.keyboard.type("2");
    await page.keyboard.type("3");
    await page.keyboard.type("4");
    await page.keyboard.type("5");
    await page.keyboard.type("6");

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
    const slots = otpSlots(page);

    await slots.nth(0).focus();
    await page.evaluate(() => {
      const el = document.querySelector(
        '[role="group"][aria-label="One-time password"] input'
      ) as HTMLInputElement;
      el?.focus();
      const dt = new DataTransfer();
      dt.setData("text/plain", "123");
      el?.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
    });

    await expect(slots.nth(0)).toHaveValue("1");
    await expect(slots.nth(1)).toHaveValue("2");
    await expect(slots.nth(2)).toHaveValue("3");
    await expect(slots.nth(3)).toHaveValue("");
    await expect(slots.nth(4)).toHaveValue("");
    await expect(slots.nth(5)).toHaveValue("");

    console.log("T10 PASS: partial paste fills only available digits");
  });
});
