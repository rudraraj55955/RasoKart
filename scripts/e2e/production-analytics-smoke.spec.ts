import {
  expect,
  test,
  type APIRequestContext,
  type Page,
  type Response,
} from "@playwright/test";
import {
  PROVIDER_SUCCESS_ANALYTICS_EVENTS,
  PROVIDER_SUCCESS_SMOKE_MARKER,
  providerSuccessAnalyticsData,
  type AnalyticsData,
} from "../../artifacts/rpay/src/lib/analytics";

const BOT_REJECTION_MARKER = { beep: "boop" };
const SMOKE_PROVIDER = "razorpay";
const SMOKE_METHOD = "api_key";

const ALLOWED_EVENT_NAMES = new Set<string>(Object.values(PROVIDER_SUCCESS_ANALYTICS_EVENTS));
const UMAMI_CLOUD_API_BASE_URL = "https://api.umami.is/v1";
const DASHBOARD_VERIFICATION_TIMEOUT_MS = 40_000;
const DASHBOARD_POLL_INTERVAL_MS = 5_000;

type SafeEvent = {
  name: string;
  data: AnalyticsData;
};

type UmamiEventDataRow = {
  eventName?: unknown;
  propertyName?: unknown;
  propertyValue?: unknown;
};

type EventQueryFilters = {
  segment?: string;
};

function isUmamiCollectionResponse(response: Response): boolean {
  return response.request().method() === "POST"
    && new URL(response.url()).pathname.endsWith("/api/send");
}

export function assertSessionBearingAcceptance(body: unknown): string {
  expect(body, "Umami must return a JSON object").toBeTruthy();
  expect(typeof body).toBe("object");
  expect(body).not.toMatchObject(BOT_REJECTION_MARKER);

  const sessionId = (body as { sessionId?: unknown }).sessionId;
  expect(
    typeof sessionId === "string" && sessionId.trim().length > 0,
    "Umami acceptance response must contain a non-empty sessionId",
  ).toBe(true);
  return sessionId as string;
}

test("acceptance validator rejects Umami's HTTP-200 bot marker", () => {
  expect(() => assertSessionBearingAcceptance(BOT_REJECTION_MARKER)).toThrow();
});

test("acceptance validator requires a session payload", () => {
  expect(() => assertSessionBearingAcceptance({})).toThrow();
  expect(assertSessionBearingAcceptance({ sessionId: "session-id" })).toBe("session-id");
});

async function sendAndVerify(page: Page, event: SafeEvent): Promise<void> {
  expect(ALLOWED_EVENT_NAMES.has(event.name), "analytics smoke event name must be allowlisted").toBe(true);
  const responsePromise = page.waitForResponse(isUmamiCollectionResponse, { timeout: 15_000 });
  await page.evaluate(
    async ({ name, data }) => {
      if (!window.umami) throw new Error("Umami tracker did not load");
      await window.umami.track(name, data);
    },
    event,
  );

  const response = await responsePromise;
  expect(response.status(), `${event.name} collection status`).toBe(200);
  const body: unknown = await response.json();
  assertSessionBearingAcceptance(body);

  // Deliberately log only the fixed event contract. Never include response
  // payloads, headers, URLs, cookies, credentials, or request bodies.
  console.log(JSON.stringify({
    accepted: event.name,
    properties: {
      provider: event.data["provider"],
      method: event.data["method"],
    },
  }));
}

function hasExpectedProperties(rows: UmamiEventDataRow[], event: SafeEvent): boolean {
  return Object.entries(event.data).every(([propertyName, propertyValue]) =>
    rows.some((row) =>
      row.eventName === event.name
      && row.propertyName === propertyName
      && row.propertyValue === String(propertyValue),
    ),
  );
}

async function readTrackerWebsiteId(page: Page): Promise<string> {
  const websiteId = await page
    .locator('script[src*="umami"][data-website-id]')
    .getAttribute("data-website-id");
  expect(websiteId, "Production must declare an Umami website ID").toBeTruthy();
  return websiteId as string;
}

async function queryEventProperties(
  request: APIRequestContext,
  apiKey: string,
  websiteId: string,
  event: SafeEvent,
  startAt: number,
  endAt: number,
  timeout: number,
  filters: EventQueryFilters = {},
): Promise<UmamiEventDataRow[]> {
  const response = await request.get(
    `${UMAMI_CLOUD_API_BASE_URL}/websites/${encodeURIComponent(websiteId)}/event-data/events`,
    {
      headers: {
        Accept: "application/json",
        "x-umami-api-key": apiKey,
      },
      params: {
        startAt,
        endAt,
        event: event.name,
        eventType: 2,
        ...filters,
      },
      timeout,
    },
  );

  if (!response.ok()) {
    throw new Error(`Umami dashboard query failed with status ${response.status()}`);
  }

  const body: unknown = await response.json();
  if (!Array.isArray(body)) {
    throw new Error("Umami dashboard query returned an unexpected response shape");
  }
  return body as UmamiEventDataRow[];
}

export function assertReportExcludesSmokeEvents(
  rows: UmamiEventDataRow[],
  eventName: string,
): void {
  const includesSmokeEvents = rows.some((row) =>
    row.eventName === eventName
    && row.propertyName === "is_smoke_test"
    && row.propertyValue === "true");

  expect(
    includesSmokeEvents,
    `Provider success report includes ${eventName} events marked is_smoke_test=true. `
      + "Restore the smoke-event exclusion in the Umami business dashboard segment.",
  ).toBe(false);
}

async function verifyEventsInDashboard(
  request: APIRequestContext,
  apiKey: string,
  websiteId: string,
  events: SafeEvent[],
  startAt: number,
): Promise<void> {
  const deadline = Date.now() + DASHBOARD_VERIFICATION_TIMEOUT_MS;
  const pending = new Map(events.map((event) => [event.name, event]));

  while (pending.size > 0 && Date.now() < deadline) {
    const endAt = Date.now();
    for (const [eventName, event] of pending) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) break;
      const rows = await queryEventProperties(
        request,
        apiKey,
        websiteId,
        event,
        startAt,
        endAt,
        Math.min(10_000, remainingMs),
      );
      if (hasExpectedProperties(rows, event)) pending.delete(eventName);
    }

    if (pending.size > 0) {
      const remainingMs = deadline - Date.now();
      if (remainingMs > 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(DASHBOARD_POLL_INTERVAL_MS, remainingMs)));
      }
    }
  }

  expect(
    [...pending.keys()],
    "Both accepted provider events and their approved properties must become queryable",
  ).toEqual([]);
  console.log(JSON.stringify({
    dashboardVerified: events.map(({ name, data }) => ({ name, properties: data })),
  }));
}

test("dashboard property matcher requires every approved property", () => {
  const event: SafeEvent = {
    name: PROVIDER_SUCCESS_ANALYTICS_EVENTS.test,
    data: {
      ...providerSuccessAnalyticsData(SMOKE_PROVIDER, SMOKE_METHOD),
      ...PROVIDER_SUCCESS_SMOKE_MARKER,
    },
  };
  const completeRows = Object.entries(event.data).map(([propertyName, propertyValue]) => ({
    eventName: event.name,
    propertyName,
    propertyValue: String(propertyValue),
  }));

  expect(hasExpectedProperties(completeRows, event)).toBe(true);
  expect(hasExpectedProperties(completeRows.slice(1), event)).toBe(false);
  expect(hasExpectedProperties(
    completeRows.map((row) =>
      row.propertyName === "outcome" ? { ...row, propertyValue: "failure" } : row),
    event,
  )).toBe(false);
});

test("provider report guard rejects marked smoke events", () => {
  expect(() => assertReportExcludesSmokeEvents([
    {
      eventName: PROVIDER_SUCCESS_ANALYTICS_EVENTS.test,
      propertyName: "is_smoke_test",
      propertyValue: "true",
    },
  ], PROVIDER_SUCCESS_ANALYTICS_EVENTS.test)).toThrow(
    /Provider success report includes provider_test_succeeded events marked is_smoke_test=true/,
  );

  expect(() => assertReportExcludesSmokeEvents([
    {
      eventName: PROVIDER_SUCCESS_ANALYTICS_EVENTS.test,
      propertyName: "outcome",
      propertyValue: "success",
    },
  ], PROVIDER_SUCCESS_ANALYTICS_EVENTS.test)).not.toThrow();
});

async function openProductionWithTracker(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", {
      configurable: true,
      get: () => false,
    });
  });
  await page.goto("/");
  await page.waitForFunction(() => typeof window.umami?.track === "function");
}

function providerSmokeEvents(): SafeEvent[] {
  const data = {
    ...providerSuccessAnalyticsData(SMOKE_PROVIDER, SMOKE_METHOD),
    ...PROVIDER_SUCCESS_SMOKE_MARKER,
  };
  return [
    { name: PROVIDER_SUCCESS_ANALYTICS_EVENTS.test, data },
    { name: PROVIDER_SUCCESS_ANALYTICS_EVENTS.connection, data },
  ];
}

test.describe.serial("production provider analytics", () => {
  test("accepts both provider success events with a browser session", async ({ page }) => {
    await openProductionWithTracker(page);

    for (const event of providerSmokeEvents()) {
      await sendAndVerify(page, event);
    }
  });

  test("automated dashboard verification excludes smoke events from provider reports", async ({
    page,
    request,
  }) => {
    const apiKey = process.env["UMAMI_API_KEY"];
    const providerReportSegmentId = process.env["UMAMI_PROVIDER_REPORT_SEGMENT_ID"];
    expect(
      apiKey,
      "UMAMI_API_KEY is required to verify the provider reports; the audit cannot be skipped",
    ).toBeTruthy();
    expect(
      providerReportSegmentId,
      "UMAMI_PROVIDER_REPORT_SEGMENT_ID must identify the saved business-dashboard segment",
    ).toBeTruthy();

    await openProductionWithTracker(page);
    const websiteId = await readTrackerWebsiteId(page);
    const events = providerSmokeEvents();
    const startAt = Date.now() - 1_000;

    for (const event of events) {
      await sendAndVerify(page, event);
    }

    await verifyEventsInDashboard(
      request,
      apiKey as string,
      websiteId,
      events,
      startAt,
    );

    for (const event of events) {
      const rows = await queryEventProperties(
        request,
        apiKey as string,
        websiteId,
        event,
        startAt,
        Date.now(),
        10_000,
        { segment: providerReportSegmentId as string },
      );
      assertReportExcludesSmokeEvents(rows, event.name);
    }

    console.log(JSON.stringify({
      providerReportsVerified: events.map(({ name }) => name),
      smokeEventsExcluded: true,
    }));
  });
});
