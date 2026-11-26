import { expect, test } from "@playwright/test";

const BASE = process.env["APP_BASE_URL"] ?? "http://localhost:80";

async function slotValues(locator: import("@playwright/test").Locator) {
  return locator.evaluateAll((elements) =>
    elements.map((element) => (element as HTMLInputElement).value),
  );
}

test.use({
  viewport: { width: 412, height: 915 },
  hasTouch: true,
  isMobile: true,
  userAgent:
    "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
});

async function showAdminResetOtp(page: import("@playwright/test").Page) {
  await page.route("**/api/auth/admin/password/forgot", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        message:
          "If this admin account exists, a password reset code has been sent.",
      }),
    });
  });
  await page.goto(`${BASE}/admin/login`);
  await page.getByRole("tab", { name: "Forgot Password", exact: true }).click();
  await page.getByLabel("Admin email").fill("nonexistent@example.invalid");
  await page.getByRole("button", { name: "Send reset code" }).click();

  const touchTarget = page.locator("[data-admin-reset-otp-touch-target]");
  const input = page.locator('input[autocomplete="one-time-code"]');
  const slots = touchTarget.locator("[data-otp-slot]");
  await expect(touchTarget).toBeVisible({ timeout: 10_000 });
  await expect(input).toBeVisible();
  await expect(slots).toHaveCount(6);
  return { touchTarget, input, slots };
}

test("Android Admin reset OTP accepts tap, digits, Backspace, paste, and autofill attributes", async ({
  page,
}) => {
  const { input, slots } = await showAdminResetOtp(page);

  await slots.nth(0).tap();
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute("inputmode", "numeric");
  await expect(input).toHaveAttribute("autocomplete", "one-time-code");
  await expect(input).toHaveAttribute("pattern", "[0-9]*");
  await expect(input).toHaveAttribute("maxlength", "6");

  await page.keyboard.type("123");
  await expect(slots.nth(0)).toHaveValue("1");
  await expect(slots.nth(1)).toHaveValue("2");
  await expect(slots.nth(2)).toHaveValue("3");
  await expect(slots.nth(3)).toBeFocused();

  await page.keyboard.press("Backspace");
  await expect(slots.nth(2)).toHaveValue("");
  await expect(slots.nth(2)).toBeFocused();

  await input.evaluate((element: HTMLInputElement) => {
    const transfer = new DataTransfer();
    transfer.setData("text/plain", "98 76-54");
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: transfer,
      }),
    );
  });
  await expect.poll(() => slotValues(slots)).toEqual(["9", "8", "7", "6", "5", "4"]);
});

test("Admin reset form submits the six-digit OTP entered through the native field", async ({
  page,
}) => {
  await page.route("**/api/auth/admin/password/reset", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ message: "Password reset successfully" }),
    });
  });
  const { slots } = await showAdminResetOtp(page);
  await slots.nth(0).tap();
  await page.keyboard.type("381967");
  await expect.poll(() => slotValues(slots)).toEqual(["3", "8", "1", "9", "6", "7"]);
  await page.locator('input[name="newPassword"]').fill("FocusedReset@8811");
  await page.locator('input[name="confirmPassword"]').fill("FocusedReset@8811");

  const requestPromise = page.waitForRequest(
    (request) =>
      request.url().includes("/api/auth/admin/password/reset") &&
      request.method() === "POST",
  );
  await page.getByRole("button", { name: "Reset password" }).click();
  const request = await requestPromise;
  expect(request.postDataJSON()).toMatchObject({
    otp: "381967",
    newPassword: "FocusedReset@8811",
  });
  await expect(
    page.getByText("Password reset successfully", { exact: true }),
  ).toBeVisible();
});