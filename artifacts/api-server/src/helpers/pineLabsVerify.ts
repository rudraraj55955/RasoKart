/**
 * Pine Labs Plural credential verifier — HTTP layer only.
 *
 * Makes a lightweight inquiry call to the Pine Labs Plural UAT API using the
 * supplied Merchant ID, Access Code, and Secret Key.
 *
 * Pass / fail criteria are STRICT (fail-closed):
 *   - Pass:  HTTP 200 AND ppc_ResponseCode is in PASS_CODES (documented
 *            "order not found" / "authenticated" responses where the API
 *            confirmed it understood the request but had no matching order).
 *   - Fail:  Everything else — auth-error codes, unexpected codes, missing
 *            ppc_ResponseCode, non-200 HTTP, timeout, or network error.
 *
 * Security contract:
 *   - Provider response text is NEVER reflected into the returned `detail`.
 *   - Credential values are NEVER included in any return value.
 *   - Zero financial mutations — inquiry only, no amount charged.
 *
 * The function accepts an optional `fetchFn` parameter so tests can inject a
 * deterministic mock without network access.
 */

import { createHmac } from "node:crypto";

/**
 * Pine Labs Plural (PinePG) UAT inquiry endpoint.
 * Auth: HMAC-SHA256 signed params (sorted key=value pairs, Secret Key as key).
 *
 * The UAT hostname is uat.pinepg.in (not uat.pinelabs.com which does not resolve).
 */
const PINE_LABS_UAT_URL = "https://uat.pinepg.in/api/v2/inquiry";
const PINE_LABS_TIMEOUT_MS = 12_000;

/**
 * ppc_ResponseCodes that Pine Labs Plural returns when authentication
 * succeeded but the test order reference was not found.
 * These are the ONLY codes that indicate valid credentials.
 *
 * Sourced from Pine Labs Plural API documentation:
 *   - "227": No such order / Order not found
 *   - "228": Order completed (if a real order happened to match — safe to pass)
 *   - "1":   Success (authentication + order found — credentials are valid)
 */
const PASS_CODES = new Set(["1", "227", "228"]);

/**
 * ppc_ResponseCodes that Pine Labs Plural returns for authentication failures.
 *
 * Sourced from Pine Labs Plural API documentation:
 *   - "234": Invalid hash / hash mismatch (wrong Secret Key)
 *   - "235": Invalid Access Code
 *   - "236": Invalid Merchant ID
 *   - "300": Authentication failed
 *   - "301": Transaction not permitted (inactive / unrecognised merchant)
 */
const AUTH_FAIL_CODES = new Set(["234", "235", "236", "300", "301"]);

/**
 * Fallback: message substrings that also indicate an auth failure, for
 * providers that return a descriptive message without a numeric code.
 */
const AUTH_FAIL_KEYWORDS = [
  "invalid merchant",
  "invalid access",
  "invalid hash",
  "hash mismatch",
  "authentication failed",
  "unauthorized",
  "invalid credentials",
  "access code",
  "merchant not found",
];

export type PineLabsVerifyResult =
  | { pass: true;  message: string; detail: string }
  | { pass: false; message: string; detail: string };

/**
 * Verify Pine Labs credentials against the UAT inquiry endpoint.
 *
 * @param mid         Merchant ID (MID) — plain text, not a secret.
 * @param accessCode  Access Code — already decrypted, plain text.
 * @param secretKey   Secret Key — already decrypted, used only for HMAC, never returned.
 * @param fetchFn     Inject a mock for unit tests; defaults to globalThis.fetch.
 */
export async function verifyPineLabsUatCredentials(
  mid: string,
  accessCode: string,
  secretKey: string,
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
): Promise<PineLabsVerifyResult> {
  // ── Build signed request ──────────────────────────────────────────────────
  // Pine Labs Plural signature: sort params alphabetically, join as
  // "key1=val1&key2=val2", then HMAC-SHA256 with Secret Key (uppercase hex).
  // ppc_RequestHashKey itself is excluded from the hash input.

  const params: Record<string, string> = {
    ppc_Amount:             "100",   // smallest representable amount (₹1 in paise)
    ppc_MerchantAccessCode: accessCode,
    ppc_MerchantID:         mid,
    ppc_MerchantOrderNo:    "RASOKART_CRED_TEST",
    ppc_TransactionType:    "3",    // 3 = inquiry
  };

  const hashInput = Object.keys(params)
    .sort()
    .map(k => `${k}=${params[k]}`)
    .join("&");

  const hashKey = createHmac("sha256", secretKey)
    .update(hashInput)
    .digest("hex")
    .toUpperCase();

  const requestBody = JSON.stringify({ ...params, ppc_RequestHashKey: hashKey });

  // ── Make HTTP call ────────────────────────────────────────────────────────
  let response: Response;
  try {
    response = await fetchFn(PINE_LABS_UAT_URL, {
      method:  "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body:    requestBody,
      signal:  AbortSignal.timeout(PINE_LABS_TIMEOUT_MS),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isTimeout =
      msg.includes("timeout") || msg.includes("ETIMEDOUT") ||
      msg.includes("AbortError") || (err instanceof Error && err.name === "AbortError") ||
      msg.includes("abort");
    if (isTimeout) {
      return {
        pass: false,
        message: "Pine Labs UAT API did not respond in time",
        detail:
          "The Pine Labs UAT environment did not respond within 12 seconds. " +
          "Credentials could not be verified automatically — activate manually after reviewing the submitted values.",
      };
    }
    return {
      pass: false,
      message: "Could not reach Pine Labs UAT API",
      detail:
        "A network error prevented the credential test from completing. " +
        "Credentials could not be verified automatically — activate manually after reviewing the submitted values.",
    };
  }

  // ── HTTP-level failures ───────────────────────────────────────────────────
  if (response.status === 401 || response.status === 403) {
    return {
      pass: false,
      message: "Pine Labs rejected the credentials",
      detail:
        `HTTP ${response.status} from Pine Labs UAT — authentication was rejected. ` +
        "Verify the Merchant ID, Access Code, and Secret Key in the Pine Labs merchant portal.",
    };
  }
  if (response.status >= 400 && response.status < 500) {
    return {
      pass: false,
      message: "Pine Labs UAT returned a client error",
      detail:
        `HTTP ${response.status} from the Pine Labs UAT inquiry endpoint. ` +
        "The submitted Merchant ID or Access Code may be incorrect.",
    };
  }
  if (response.status >= 500) {
    return {
      pass: false,
      message: "Pine Labs UAT is temporarily unavailable",
      detail:
        `HTTP ${response.status} from Pine Labs UAT — the server is currently unavailable. ` +
        "Credentials could not be verified — try again shortly or activate manually.",
    };
  }

  // ── HTTP 200 — strict response body check (fail-closed) ──────────────────
  // We require ppc_ResponseCode to be present; without it this is not a valid
  // Pine Labs Plural API response (wrong endpoint, gateway page, etc.) → fail.

  let json: Record<string, unknown> = {};
  try {
    json = await response.json() as Record<string, unknown>;
  } catch {
    // Non-JSON body on HTTP 200 → not a Pine Labs Plural response → fail closed
    return {
      pass: false,
      message: "Unexpected response from Pine Labs UAT",
      detail:
        "The Pine Labs UAT inquiry endpoint returned an unrecognised response format. " +
        "Credentials could not be verified — activate manually after reviewing the submitted values.",
    };
  }

  const responseCode = String(json["ppc_ResponseCode"] ?? "").trim();

  if (!responseCode) {
    // ppc_ResponseCode absent → not a Pine Labs Plural response → fail closed
    return {
      pass: false,
      message: "Unexpected response from Pine Labs UAT",
      detail:
        "The Pine Labs UAT inquiry endpoint returned an unrecognised response format " +
        "(missing ppc_ResponseCode). Credentials could not be verified — activate manually.",
    };
  }

  // Check for auth failures by response code first (primary signal)
  if (AUTH_FAIL_CODES.has(responseCode)) {
    // Map known codes to a human-readable, provider-agnostic explanation.
    // We do NOT echo the raw provider message (untrusted; may contain request data).
    const explanation =
      responseCode === "234"
        ? "The Secret Key was rejected (hash mismatch). Check the Secret Key in the Pine Labs merchant portal."
        : responseCode === "235"
        ? "The Access Code was rejected. Check the Access Code in the Pine Labs merchant portal."
        : responseCode === "236"
        ? "The Merchant ID was not recognised. Check the Merchant ID in the Pine Labs merchant portal."
        : "Authentication was rejected by Pine Labs UAT. Check the Merchant ID, Access Code, and Secret Key.";
    return {
      pass: false,
      message: "Pine Labs rejected the credentials",
      detail: explanation,
    };
  }

  // Fallback: check the response message for auth-error keywords (secondary signal)
  const rawMsg = String(json["ppc_ResponseMessage"] ?? "").toLowerCase();
  const isKeywordAuthError = AUTH_FAIL_KEYWORDS.some(kw => rawMsg.includes(kw));
  if (isKeywordAuthError) {
    return {
      pass: false,
      message: "Pine Labs rejected the credentials",
      detail:
        "The Pine Labs UAT API indicated an authentication failure. " +
        "Verify the Merchant ID, Access Code, and Secret Key in the Pine Labs merchant portal.",
    };
  }

  // ppc_ResponseCode is present but neither in PASS_CODES nor in AUTH_FAIL_CODES → fail closed.
  // We do not assume an unknown code means success.
  if (!PASS_CODES.has(responseCode)) {
    return {
      pass: false,
      message: "Unexpected response code from Pine Labs UAT",
      detail:
        `Pine Labs UAT returned an unrecognised response code (${responseCode}). ` +
        "Credentials could not be conclusively verified — activate manually after reviewing the submitted values.",
    };
  }

  // ppc_ResponseCode is in PASS_CODES: Pine Labs accepted the authentication.
  // (The test order RASOKART_CRED_TEST will not exist — "order not found" is expected.)
  return {
    pass: true,
    message: "Pine Labs credentials verified against UAT API",
    detail:
      "The Pine Labs UAT inquiry endpoint accepted the Merchant ID, Access Code, and Secret Key. " +
      `(Response code: ${responseCode} — authentication confirmed, test order not found as expected.)`,
  };
}
