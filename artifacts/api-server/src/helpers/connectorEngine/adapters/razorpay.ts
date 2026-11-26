/**
 * Razorpay — OPTIONAL API Read-Only Connector
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  ADAPTER KIND: api_key_connector                                        │
 * │  This is NOT the credential-first portal connector.                     │
 * │  This adapter requires a Razorpay API Key ID + Key Secret — programmatic│
 * │  keys that merchants generate from their Razorpay Dashboard, not their  │
 * │  dashboard login credentials (email + password + OTP).                  │
 * │                                                                         │
 * │  It is kept as an OPTIONAL, separately labelled data-access path.       │
 * │  It must never be presented as a substitute for the credential-first    │
 * │  portal connector, and must never be merged into the portal session     │
 * │  connector path.                                                         │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * CONNECTION METHOD: Razorpay API Key + Secret (merchant-generated)
 *   Merchants supply their own Razorpay API Key ID and Key Secret from their
 *   Razorpay Dashboard (Settings → API Keys). These are programmatic read-only
 *   keys, NOT the merchant's portal login credentials.
 *
 * AUTHENTICATION FLOW:
 *   1. Merchant retrieves Key ID (rzp_live_... / rzp_test_...) and Key Secret
 *      from their Razorpay Dashboard → Settings → API Keys.
 *   2. Merchant pastes both into RasoKart's optional API connector form.
 *   3. Server encrypts both server-side (AES-256-GCM, never logged or returned).
 *   4. Adapter validates by calling GET /v1/payments?count=1 with Basic auth.
 *   5. CONNECTED is set ONLY on HTTP 200. All other responses → FAILED.
 *
 * CREDENTIAL-VALIDATION LEASE (not a provider session):
 *   - The encrypted blob stores the API keys for repeated use.
 *   - The 90-day advisory expiry triggers re-validation; it does NOT represent
 *     a real Razorpay session — API keys do not expire unless the merchant
 *     rotates them. The label "session" is intentionally avoided here because
 *     there is no server-side session on Razorpay's side.
 *   - Reconnect re-validates the stored keys via the same live API call.
 *
 * FAIL-CLOSED RULES (strict):
 *   - Only HTTP 200 from Razorpay → ok: true → CONNECTED.
 *   - HTTP 400 (bad request) → FAILED. Never infer "authenticated".
 *   - HTTP 401 (invalid credentials) → FAILED.
 *   - HTTP 403 (forbidden / insufficient permissions) → FAILED.
 *   - HTTP 429 (rate limited) → FAILED.
 *   - HTTP 5xx (provider error) → FAILED.
 *   - Timeout or network error → FAILED.
 *   - Any response other than 200 → FAILED.
 *   - Decryption failure → EXPIRED (never CONNECTED).
 *
 * DATA ACCESS (READ-ONLY):
 *   - Fetches payment transactions via GET /v1/payments (no mutations).
 *   - No payments, refunds, payouts, settlements, or profile changes.
 *
 * HOW TO GET API KEYS: https://dashboard.razorpay.com/app/keys
 */

import type {
  ProviderAdapter,
  LoginMethod,
  InitiateParams,
  InitiateResult,
  SubmitStepParams,
  SubmitStepResult,
  ValidateResult,
  DiscoveryResult,
  FetchTransactionsParams,
  FetchTransactionsResult,
  NormalizedTransaction,
  PortalTxStatus,
  HealthCheckResult,
} from "../types";
import { decryptSecret } from "../../cryptoUtils";
import {
  encryptSessionPayload,
  decryptSessionToken,
  makeSessionPayload,
} from "../sessionCrypto";

// ── Constants ─────────────────────────────────────────────────────────────────

const RAZORPAY_API_BASE = "https://api.razorpay.com/v1";
const SESSION_EXPIRY_DAYS = 90;
const FETCH_TIMEOUT_MS = 15_000;
const HELP_URL = "https://dashboard.razorpay.com/app/keys";

// ── Auth helper ───────────────────────────────────────────────────────────────

function basicAuth(keyId: string, keySecret: string): string {
  return "Basic " + Buffer.from(`${keyId}:${keySecret}`).toString("base64");
}

// ── Credential validation ─────────────────────────────────────────────────────

interface CredTestResult {
  ok: boolean;
  reason?: string;
}

async function testCredentials(keyId: string, keySecret: string): Promise<CredTestResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${RAZORPAY_API_BASE}/payments?count=1`, {
      method: "GET",
      headers: {
        Authorization: basicAuth(keyId, keySecret),
        Accept: "application/json",
        "User-Agent": "RasoKart-Connector/1.0",
      },
      signal: controller.signal,
    });
    clearTimeout(timer);
    // FAIL-CLOSED: only HTTP 200 is an authorized successful response.
    // Every other status code — including 400 and 403 — must never produce CONNECTED.
    //
    // 200 = credentials accepted, request successful → ONLY valid → CONNECTED
    // 400 = request rejected (bad format / key restricted) → FAILED
    // 401 = invalid credentials → FAILED
    // 403 = key exists but has insufficient permissions → FAILED
    // 429 = rate-limited → FAILED (do not infer credential validity)
    // 5xx = provider-side error → FAILED
    if (res.status === 200) {
      return { ok: true };
    }
    if (res.status === 400) {
      return { ok: false, reason: "Razorpay rejected the request (HTTP 400). Your API key may be IP-restricted or misconfigured. Check your Razorpay Dashboard." };
    }
    if (res.status === 401) {
      return { ok: false, reason: "Invalid API Key ID or Key Secret (HTTP 401). Double-check both values on your Razorpay Dashboard under Settings → API Keys." };
    }
    if (res.status === 403) {
      return { ok: false, reason: "API key has insufficient permissions (HTTP 403). Ensure the key has read access to payments on your Razorpay Dashboard." };
    }
    if (res.status === 429) {
      return { ok: false, reason: "Razorpay rate limit reached (HTTP 429). Wait a moment and try again." };
    }
    if (res.status >= 500) {
      return { ok: false, reason: `Razorpay service error (HTTP ${res.status}). Please try again in a few minutes.` };
    }
    return { ok: false, reason: `Unexpected response from Razorpay (HTTP ${res.status}). Connection refused for safety.` };
  } catch (err: any) {
    clearTimeout(timer);
    if (err.name === "AbortError") {
      return { ok: false, reason: "Connection to Razorpay timed out. Please check your network and try again." };
    }
    return { ok: false, reason: `Could not reach Razorpay API: ${err.message ?? "unknown error"}.` };
  }
}

// ── Test-only export ──────────────────────────────────────────────────────────
// Allows white-box regression tests to call testCredentials() directly.
// The export is tree-shaken away in production builds (esbuild drops it when
// nothing outside the test file imports it, and test files are excluded).
/** @internal Do not import this outside of test files. */
export const TEST_ONLY_testCredentials = testCredentials;

// ── Transaction status normalisation ──────────────────────────────────────────

function normalizeStatus(raw: string): PortalTxStatus {
  switch (raw) {
    case "captured":  return "SUCCESS";
    case "failed":    return "FAILED";
    case "refunded":  return "REVERSED";
    case "created":
    case "authorized": return "PENDING";
    default:          return "UNKNOWN";
  }
}

// ── Session helper ────────────────────────────────────────────────────────────

interface RazorpayAdapterData {
  keyId: string;
  keySecret: string;
  mode: "live" | "test";
  validatedAt: string;
}

function decryptAdapterData(encryptedSessionToken: string): { ok: true; data: RazorpayAdapterData } | { ok: false; reason: string } {
  const result = decryptSessionToken(encryptedSessionToken);
  if (!result.ok) return { ok: false, reason: result.reason };
  const d = result.payload.adapterData as Partial<RazorpayAdapterData>;
  if (!d.keyId || !d.keySecret) {
    return { ok: false, reason: "session_data_missing" };
  }
  return { ok: true, data: d as RazorpayAdapterData };
}

// ── Adapter ───────────────────────────────────────────────────────────────────

const SUPPORTED_LOGIN_METHODS: LoginMethod[] = [
  {
    key: "api_key",
    label: "API Key",
    identifierLabel: "API Key ID",
    identifierType: "mid",
    requiresOtp: false,
    requiresPassword: true,
    mayRequireCaptcha: false,
  },
];

export const razorpayAdapter: ProviderAdapter = {
  slug: "razorpay",
  displayName: "Razorpay API Read-Only Connector",
  adapterKind: "api_key_connector",
  category: "gateway",
  supportedLoginMethods: SUPPORTED_LOGIN_METHODS,

  // ── initiateSession ─────────────────────────────────────────────────────────
  // Accepts: encryptedIdentifier = AES-encrypted Key ID
  //          encryptedPassword   = AES-encrypted Key Secret
  // Both are encrypted server-side before this method is called.
  // Raw values are decrypted locally, used for validation, then discarded from
  // local scope. Only the encrypted session blob is persisted.

  async initiateSession(params: InitiateParams): Promise<InitiateResult> {
    // ── Decrypt Key ID ────────────────────────────────────────────────────────
    if (!params.encryptedIdentifier) {
      return {
        status: "FAILED",
        failReason: "MISSING_IDENTIFIER",
        failDetail: "API Key ID is required.",
        helpUrl: HELP_URL,
      };
    }
    const idResult = decryptSecret(params.encryptedIdentifier);
    if (!idResult.ok) {
      return {
        status: "FAILED",
        failReason: "DECRYPTION_FAILED",
        failDetail: "Could not decrypt API Key ID. Please retry.",
      };
    }
    const keyId = idResult.value.trim();

    // ── Decrypt Key Secret ────────────────────────────────────────────────────
    if (!params.encryptedPassword) {
      return {
        status: "AWAITING_PASSWORD",
        nextStep: "ENTER_PASSWORD",
        nextStepPrompt: "API Key Secret is required to complete connection.",
      };
    }
    const pwdResult = decryptSecret(params.encryptedPassword);
    if (!pwdResult.ok) {
      return {
        status: "FAILED",
        failReason: "DECRYPTION_FAILED",
        failDetail: "Could not decrypt API Key Secret. Please retry.",
      };
    }
    const keySecret = pwdResult.value.trim();

    // ── Format validation (cheap, no network) ────────────────────────────────
    if (!keyId.startsWith("rzp_live_") && !keyId.startsWith("rzp_test_")) {
      return {
        status: "FAILED",
        failReason: "INVALID_KEY_FORMAT",
        failDetail: "API Key ID must start with rzp_live_ or rzp_test_. Copy it from your Razorpay Dashboard.",
        helpUrl: HELP_URL,
      };
    }
    if (keySecret.length < 16) {
      return {
        status: "FAILED",
        failReason: "INVALID_KEY_FORMAT",
        failDetail: "API Key Secret appears invalid (too short). Copy it directly from your Razorpay Dashboard.",
        helpUrl: HELP_URL,
      };
    }

    // ── Live credential validation (network call) ─────────────────────────────
    const test = await testCredentials(keyId, keySecret);
    if (!test.ok) {
      return {
        status: "FAILED",
        failReason: "CREDENTIAL_VALIDATION_FAILED",
        failDetail: test.reason,
        helpUrl: HELP_URL,
      };
    }

    // ── Build encrypted session token ─────────────────────────────────────────
    const mode: "live" | "test" = keyId.startsWith("rzp_live_") ? "live" : "test";
    const expiresAt = new Date(Date.now() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
    // NOTE: keyId and keySecret are stored inside the AES-256-GCM encrypted
    // session blob. They are not written anywhere in plaintext form.
    const payload = makeSessionPayload(
      "razorpay",
      0, // connectionId — merchant portal sessions are not linked to platform_connections
      { keyId, keySecret, mode, validatedAt: new Date().toISOString() } satisfies RazorpayAdapterData,
      { expiresAt },
    );

    const encResult = encryptSessionPayload(payload);
    if (!encResult.ok) {
      return {
        status: "FAILED",
        failReason: "SESSION_CREATE_FAILED",
        failDetail: "Failed to create session. Please try again.",
      };
    }

    return {
      status: "CONNECTED",
      encryptedSessionToken: encResult.token,
      nextStep: "COMPLETE",
    };
  },

  // ── submitStep ──────────────────────────────────────────────────────────────
  // api_key method completes in initiateSession — no separate OTP/CAPTCHA step.

  async submitStep(_params: SubmitStepParams): Promise<SubmitStepResult> {
    return {
      status: "FAILED",
      failReason: "NO_STEP_REQUIRED",
      failDetail: "Razorpay API Key authentication completes at the initial connect step. No further credential input is required.",
    };
  },

  // ── validateSession ─────────────────────────────────────────────────────────

  async validateSession(encryptedSessionToken: string): Promise<ValidateResult> {
    const dec = decryptAdapterData(encryptedSessionToken);
    if (!dec.ok) return { valid: false, reason: dec.reason };
    const test = await testCredentials(dec.data.keyId, dec.data.keySecret);
    if (!test.ok) return { valid: false, reason: test.reason };
    return { valid: true };
  },

  // ── discoverEntities ────────────────────────────────────────────────────────

  async discoverEntities(encryptedSessionToken: string): Promise<DiscoveryResult> {
    const dec = decryptAdapterData(encryptedSessionToken);
    if (!dec.ok) return { entities: [] };
    return {
      entities: [
        {
          entityType: "merchant",
          providerEntityId: dec.data.keyId.slice(0, 16) + "…", // safe prefix only
          providerEntityName: `Razorpay ${dec.data.mode === "live" ? "Live" : "Test"} Account`,
          isPrimary: true,
          metadata: { mode: dec.data.mode },
        },
      ],
    };
  },

  // ── fetchTransactions ───────────────────────────────────────────────────────
  // GET /v1/payments — read-only. Strict date-range. No mutations.
  // Razorpay amounts are in the smallest currency unit (paise for INR).

  async fetchTransactions(params: FetchTransactionsParams): Promise<FetchTransactionsResult> {
    const dec = decryptAdapterData(params.encryptedSessionToken);
    if (!dec.ok) return { transactions: [], hasMore: false };

    const count = Math.min(params.pageSize ?? 100, 100);
    const skip  = ((params.page ?? 1) - 1) * count;
    const from  = Math.floor(params.from.getTime() / 1000);
    const to    = Math.floor(params.to.getTime() / 1000);

    const url = `${RAZORPAY_API_BASE}/payments?from=${from}&to=${to}&count=${count}&skip=${skip}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS * 2);

    try {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: basicAuth(dec.data.keyId, dec.data.keySecret),
          Accept: "application/json",
          "User-Agent": "RasoKart-Connector/1.0",
        },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) return { transactions: [], hasMore: false };

      const body = (await res.json()) as { items?: any[]; count?: number };
      const items: any[] = body.items ?? [];
      const hasMore = typeof body.count === "number" && body.count === count;

      const transactions: NormalizedTransaction[] = items.map((p: any) => ({
        providerTxId:      String(p.id),
        utr:               p.acquirer_data?.upi_transaction_id ?? undefined,
        rrn:               p.acquirer_data?.rrn ?? undefined,
        amount:            Number(p.amount),
        currency:          String(p.currency ?? "INR"),
        status:            normalizeStatus(String(p.status ?? "")),
        providerStatus:    String(p.status ?? ""),
        txTimestamp:       typeof p.created_at === "number"
                             ? new Date(p.created_at * 1000)
                             : undefined,
        // Safe subset of raw payload — no PII beyond amounts and IDs
        rawPayload: {
          id:          p.id,
          status:      p.status,
          method:      p.method,
          amount:      p.amount,
          currency:    p.currency,
          order_id:    p.order_id ?? null,
          captured:    p.captured ?? false,
          description: typeof p.description === "string" ? p.description : null,
        },
      }));

      return { transactions, hasMore };
    } catch {
      clearTimeout(timer);
      return { transactions: [], hasMore: false };
    }
  },

  // ── healthCheck ─────────────────────────────────────────────────────────────

  async healthCheck(encryptedSessionToken?: string): Promise<HealthCheckResult> {
    if (!encryptedSessionToken) {
      // No session yet — adapter is operational but not connected.
      return { healthy: true, status: "PENDING" };
    }
    const dec = decryptAdapterData(encryptedSessionToken);
    if (!dec.ok) {
      return { healthy: false, status: "EXPIRED", reason: dec.reason };
    }
    const test = await testCredentials(dec.data.keyId, dec.data.keySecret);
    return test.ok
      ? { healthy: true,  status: "CONNECTED" }
      : { healthy: false, status: "EXPIRED",   reason: test.reason };
  },

  // ── reconnect ───────────────────────────────────────────────────────────────
  // Re-validates the stored API credentials and issues a fresh session token
  // with an updated 90-day expiry — without asking the merchant for credentials
  // again. Returns CONNECTED on success, or FAILED + REQUIRES_FULL_REAUTH if
  // the stored credentials are no longer valid (key deleted/rotated on Razorpay).

  async reconnect(encryptedSessionToken: string): Promise<InitiateResult> {
    const dec = decryptAdapterData(encryptedSessionToken);
    if (!dec.ok) {
      return {
        status: "FAILED",
        failReason: "REQUIRES_FULL_REAUTH",
        failDetail:
          "Session could not be decrypted — it may have been invalidated. " +
          "Please re-enter your Razorpay API credentials to reconnect.",
        helpUrl: HELP_URL,
      };
    }

    const test = await testCredentials(dec.data.keyId, dec.data.keySecret);
    if (!test.ok) {
      return {
        status: "FAILED",
        failReason: "REQUIRES_FULL_REAUTH",
        failDetail:
          (test.reason ?? "Stored API credentials are no longer valid.") +
          " Please re-enter your Razorpay API credentials to reconnect.",
        helpUrl: HELP_URL,
      };
    }

    // Credentials still valid — re-issue a fresh session token with updated expiry.
    const expiresAt = new Date(Date.now() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
    const payload = makeSessionPayload(
      "razorpay",
      0,
      {
        ...dec.data,
        validatedAt: new Date().toISOString(),
      } satisfies RazorpayAdapterData,
      { expiresAt },
    );

    const encResult = encryptSessionPayload(payload);
    if (!encResult.ok) {
      return {
        status: "FAILED",
        failReason: "SESSION_CREATE_FAILED",
        failDetail: "Failed to refresh session token. Please try again.",
      };
    }

    return {
      status: "CONNECTED",
      encryptedSessionToken: encResult.token,
      nextStep: "COMPLETE",
    };
  },

  // ── logout ──────────────────────────────────────────────────────────────────
  // API keys have no server-side session to invalidate. The encrypted session
  // token is cleared from the DB by the disconnect route. If the merchant wants
  // to fully revoke access they must rotate the key on the Razorpay Dashboard.

  async logout(_encryptedSessionToken: string): Promise<void> {
    // No-op: API keys don't have server-side sessions.
  },
};
