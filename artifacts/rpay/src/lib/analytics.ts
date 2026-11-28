export type AnalyticsData = Record<string, string | number | boolean>;

export type ProviderConnectionMethod =
  | "api_key"
  | "otp"
  | "mpin"
  | "password"
  | "session_reconnect";

export const PROVIDER_SUCCESS_ANALYTICS_EVENTS = {
  connection: "provider_connection_succeeded",
  test: "provider_test_succeeded",
} as const;

export const PROVIDER_SUCCESS_SMOKE_MARKER = {
  is_smoke_test: true,
} as const;

export function providerSuccessAnalyticsData(
  provider: string,
  method: ProviderConnectionMethod,
): AnalyticsData {
  return {
    provider,
    method,
    outcome: "success",
  };
}

declare global {
  interface Window {
    umami?: {
      track(name: string, data?: AnalyticsData): void;
    };
  }
}

export function trackEvent(name: string, data?: AnalyticsData): void {
  if (typeof window === "undefined") return;

  try {
    window.umami?.track(name, data);
  } catch {
    // Analytics must never interrupt a user action.
  }
}

export function trackProviderConnectionSucceeded(
  provider: string,
  method: ProviderConnectionMethod,
): void {
  trackEvent(
    PROVIDER_SUCCESS_ANALYTICS_EVENTS.connection,
    providerSuccessAnalyticsData(provider, method),
  );
}

export function trackProviderTestSucceeded(
  provider: string,
  method: ProviderConnectionMethod,
): void {
  trackEvent(
    PROVIDER_SUCCESS_ANALYTICS_EVENTS.test,
    providerSuccessAnalyticsData(provider, method),
  );
}