/**
 * Razorpay — Connector Engine Adapter (API Key Authentication)
 *
 * CONNECTION METHOD: Razorpay API Key + Secret
 *   Merchants supply their own Razorpay API Key ID and Key Secret from their
 *   Razorpay Dashboard (Settings → API Keys). These are their merchant-level
 *   credentials, NOT RasoKart's gateway credentials.
 *
 * AUTHENTICATION FLOW:
 *   1. Merchant enters Key ID (rzp_live_... / rzp_test_...) and Key Secret in RasoKart UI.
 *   2. Server encrypts both server-side (AES-256-GCM, never logged or returned).
 *   3. Adapter validates credentials via a lightweight Razorpay API call (no CAPTCHA).
 *   4. On success: encrypted session token is stored; status becomes CONNECTED.
 *   5. Session remains valid until the merchant revokes the API key on Razorpay.
 *
 * SESSION SECURITY:
 *   - Key ID and Key Secret are stored only inside the AES-256-GCM encrypted session blob.
 *   - The blob is stored in merchant_portal_sessions.encrypted_session (server-only).
 *   - Raw credentials are never returned to the frontend, logged, or written to disk.
 *   - Session expiry: 90 days (advisory; API keys don't expire unless rotated).
 *
 * DATA ACCESS (READ-ONLY):
 *   - Fetches payment transactions via GET /v1/payments (no mutations).
 *   - No payments, refunds, payouts, settlements, or profile changes.
 *   - Respects Razorpay API rate limits; does NOT bypass any security controls.
 *
 * FAIL-CLOSED GUARANTEE:
 *   - Invalid credentials → FAILED (never CONNECTED without verified auth).
 *   - Razorpay unreachable → FAILED (never fabricated CONNECTED state).
 *   - Decryption failure → session treated as EXPIRED.
 *
 * GET API KEYS: https://dashboard.razorpay.com/app/keys
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
    // 200 = valid credentials, has data
    // 400 = valid credentials, bad query params (still authenticated)
    // 403 = valid credentials, insufficient permissions for this endpoint
    // 401 = invalid credentials
    // 429 = rate limited (credentials format may be valid — do not infer invalid)
    if (res.status === 401) {
      return { ok: false, reason: "Invalid API Key ID or Key Secret. Double-check your credentials on the Razorpay dashboard." };
    }
    if (res.status === 429) {
      return { ok: false, reason: "Razorpay rate limit reached. Please wait a moment and try again." };
    }
    if (res.status === 200 || res.status === 400 || res.status === 403) {
      return { ok: true };
    }
    return { ok: false, reason: `Unexpected response from Razorpay (HTTP ${res.status}). Please try again.` };
  } catch (err: any) {
    clearTimeout(timer);
    if (err.name === "AbortError") {
      return { ok: false, reason: "Connection to Razorpay timed out. Please check your network and try again." };
    }
    return { ok: false, reason: `Could not reach Razorpay API: ${err.message ?? "unknown error"}.` };
  }
}

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
  displayName: "Razorpay",
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

  // ── logout ──────────────────────────────────────────────────────────────────
  // API keys have no server-side session to invalidate. The encrypted session
  // token is cleared from the DB by the disconnect route. If the merchant wants
  // to fully revoke access they must rotate the key on the Razorpay Dashboard.

  async logout(_encryptedSessionToken: string): Promise<void> {
    // No-op: API keys don't have server-side sessions.
  },
};
