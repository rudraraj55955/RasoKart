/**
 * Pine Labs ONE — Connector Engine Adapter (FAIL-CLOSED)
 *
 * Pine Labs ONE (one.pinelabs.com) is a POS/QR merchant account portal.
 *
 * PHASE 4 AUDIT RESULT (2026-08-16):
 *   Pine Labs ONE does NOT provide a public third-party API for programmatic
 *   access to merchant accounts. The portal uses mobile/email OTP login, but
 *   there is no official API for third-party platforms to initiate OTP or
 *   acquire a session token on the merchant's behalf.
 *
 * FAIL-CLOSED RULE:
 *   All adapter methods return PARTNER_API_REQUIRED.
 *   No credentials are stored. No session is created. No request is sent
 *   to one.pinelabs.com. The engine reports the exact reason and blocks any
 *   Connected/Monitoring/Auto-Deposit status until a real API is available.
 *
 * HOW TO ACTIVATE:
 *   Apply for official Pine Labs ONE partner/enterprise API access at:
 *   https://developer.pinelabs.com
 *
 *   Once a partner API key and endpoint are available, replace this file
 *   with a real adapter that:
 *     1. Calls the official partner API endpoint
 *     2. Implements the ProviderAdapter interface fully
 *     3. Returns CONNECTED only after a verified authenticated response
 *   No other code changes are required (the engine dispatches by slug).
 *
 * DO NOT:
 *   - Automate login to one.pinelabs.com
 *   - Store or replay browser cookies
 *   - Bypass OTP, CAPTCHA, or device-binding controls
 *   - Return CONNECTED without a verified authenticated session
 */

import type {
  ProviderAdapter,
  InitiateResult,
  SubmitStepResult,
  ValidateResult,
  DiscoveryResult,
  FetchTransactionsResult,
  HealthCheckResult,
} from "../types";

// Note: reconnect is also PARTNER_API_REQUIRED because no session can be
// created without a partner API — there is nothing to reconnect to.

const PARTNER_API_MESSAGE =
  "Official Pine Labs ONE partner/enterprise API access required";

const PARTNER_API_DETAIL =
  "Pine Labs ONE (one.pinelabs.com) does not provide a public API for " +
  "third-party platform integration. Automating portal login via OTP or " +
  "browser sessions is not an authorised integration method. To enable " +
  "this connector, apply for official Pine Labs ONE partner/enterprise API " +
  "access at developer.pinelabs.com or contact Pine Labs enterprise sales. " +
  "This connector will activate automatically once the partner API is " +
  "configured — no code changes are required at that point.";

const HELP_URL = "https://developer.pinelabs.com";

export const pineLabsOneAdapter: ProviderAdapter = {
  slug: "pinelabs_one",
  displayName: "Pine Labs ONE",
  category: "pos",

  // No supported login methods until official partner API is granted.
  supportedLoginMethods: [],

  async initiateSession(_params): Promise<InitiateResult> {
    return {
      status: "PARTNER_API_REQUIRED",
      failReason: "PARTNER_API_REQUIRED",
      failDetail: PARTNER_API_DETAIL,
      helpUrl: HELP_URL,
    };
  },

  async submitStep(_params): Promise<SubmitStepResult> {
    return {
      status: "PARTNER_API_REQUIRED",
      failReason: "PARTNER_API_REQUIRED",
      failDetail: PARTNER_API_DETAIL,
    };
  },

  async validateSession(_token): Promise<ValidateResult> {
    // No session can exist without a partner API, so always invalid.
    return { valid: false, reason: "PARTNER_API_REQUIRED" };
  },

  async discoverEntities(_token): Promise<DiscoveryResult> {
    // Discovery is impossible without an authenticated session.
    return { entities: [] };
  },

  async fetchTransactions(_params): Promise<FetchTransactionsResult> {
    // No data access without a partner API.
    return { transactions: [], hasMore: false };
  },

  async healthCheck(_token): Promise<HealthCheckResult> {
    // Engine health check: adapter is operational but the provider
    // does not expose a public API endpoint to ping.
    return {
      healthy: false,
      status: "PARTNER_API_REQUIRED",
      reason: "PARTNER_API_REQUIRED",
      detail: PARTNER_API_MESSAGE + ". Apply at " + HELP_URL,
    };
  },

  async reconnect(_token): Promise<InitiateResult> {
    return {
      status: "PARTNER_API_REQUIRED",
      failReason: "PARTNER_API_REQUIRED",
      failDetail: PARTNER_API_DETAIL,
      helpUrl: HELP_URL,
    };
  },

  async logout(_token): Promise<void> {
    // No session to invalidate.
  },
};

/** Re-export the message constants for use in route responses and UI. */
export { PARTNER_API_MESSAGE, PARTNER_API_DETAIL, HELP_URL };
