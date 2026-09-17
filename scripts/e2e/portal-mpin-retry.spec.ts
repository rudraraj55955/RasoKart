import { test, expect, type Page, type Route } from "@playwright/test";
import { readCachedMerchantToken } from "./token-cache";

const LS_TOKEN_KEY = "rasokart_token";

const FAKE_PROVIDERS = {
  data: [
    {
      id: 927,
      slug: "pinelabs_one",
      name: "Pine Labs ONE",
      category: "pos",
      description: "Pine Labs ONE merchant connector",
      status: "live",
    },
  ],
};

const FAKE_AWAITING_MPIN_SESSION = {
  id: 928,
  merchantId: 1,
  providerSlug: "pinelabs_one",
  status: "AWAITING_MPIN",
  lastErrorCode: null,
  lastStatusMessage: "Enter your MPIN",
  connectedAt: null,
  updatedAt: "2026-09-02T00:00:00.000Z",
  attemptsRemaining: 3,
  resendCount: 0,
  resendsRemaining: 3,
  resendAvailableAt: null,
  otpExpiresAt: null,
};

async function goToConnect(page: Page, merchantToken: string): Promise<void> {
  await page.goto("/merchant");
  await page.evaluate(
    ([key, token]) => localStorage.setItem(key, token),
    [LS_TOKEN_KEY, merchantToken],
  );
  await page.goto("/merchant/connect");
  await page.waitForLoadState("networkidle");
}

async function mockRoutes(
  page: Page,
  submittedMpins: string[],
): Promise<void> {
  await page.route("**/api/providers*", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(FAKE_PROVIDERS),
    });
  });

  await page.route("**/api/merchant/portal-sessions", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ sessions: [FAKE_AWAITING_MPIN_SESSION] }),
    });
  });

  await page.route("**/api/merchant/enrollments*", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });

  await page.route(
    "**/api/merchant/portal-sessions/pinelabs_one/submit-step",
    async (route: Route) => {
      const body = route.request().postDataJSON() as { otp?: string };
      submittedMpins.push(body.otp ?? "");
      const invalid = submittedMpins.length === 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(invalid
          ? {
              status: "AWAITING_MPIN",
              errorCode: "INVALID_MPIN",
              message: "That MPIN was not accepted. Check it and try again.",
              nextStep: null,
            }
          : {
              status: "CONNECTED",
              errorCode: null,
              message: "Connected.",
              nextStep: "COMPLETE",
            }),
      });
    },
  );
}

let merchantToken: string;

test.beforeAll(() => {
  merchantToken = readCachedMerchantToken();
});

test("merchant can correct an invalid MPIN without restarting", async ({ page }) => {
  const submittedMpins: string[] = [];
  await mockRoutes(page, submittedMpins);
  await goToConnect(page, merchantToken);

  const mpinInput = page.getByLabel("Pine Labs ONE MPIN");
  await expect(mpinInput).toBeVisible({ timeout: 15_000 });
  await mpinInput.fill("1234");
  await page.getByRole("button", { name: "Verify MPIN" }).click();

  await expect(
    page.getByRole("main").getByText("That MPIN was not accepted. Check it and try again."),
  ).toBeVisible();
  await expect(mpinInput).toBeVisible();
  await expect(mpinInput).toHaveValue("");

  await mpinInput.fill("2468");
  await page.getByRole("button", { name: "Verify MPIN" }).click();

  await expect(page.getByText("Account Connected", { exact: true })).toBeVisible();
  expect(submittedMpins).toEqual(["1234", "2468"]);
});