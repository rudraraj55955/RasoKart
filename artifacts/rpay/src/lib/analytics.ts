export type AnalyticsData = Record<string, string | number | boolean>;

export type ProviderConnectionMethod =
  | "api_key"
  | "otp"
  | "mpin"
  | "password"
  | "session_reconnect";
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
  trackEvent("provider_connection_succeeded", {
    provider,
    method,
    outcome: "success",
  });
}

export function trackProviderTestSucceeded(
  provider: string,
  method: ProviderConnectionMethod,
): void {
  trackEvent("provider_test_succeeded", {
    provider,
    method,
    outcome: "success",
  });
}