import { logger } from "../lib/logger";

export type CashfreePayoutEnv = "test" | "live";

/**
 * Admin-configurable overrides for the Cashfree Payouts V2 base URL and API
 * version (`system_config` table, surfaced in Admin → Payout Gateway
 * Settings). Both are optional — when unset/blank, callers fall back to the
 * hardcoded defaults for the selected environment.
 */
export type PayoutProviderConfig = {
  baseUrl?: string | null;
  apiVersion?: string | null;
};

const DEFAULT_API_VERSION = "2024-01-01";

/**
 * Cashfree Payouts V2 Standard Transfer base URLs (environment-specific).
 * - test/sandbox: https://sandbox.cashfree.com/payout
 * - live:         https://api.cashfree.com/payout
 *
 * IMPORTANT: do NOT append "/v2" to the path — the "v2" contract is selected
 * via the `x-api-version: 2024-01-01` header, not a URL segment. Calling
 * ".../payout/v2/..." hits a legacy route that expects a Bearer token and
 * returns "Token is not valid" even with correct x-client-id/x-client-secret.
 *
 * Used for all Standard Transfer operations: beneficiary creation, transfer
 * creation, transfer status. No Bearer token, no /payout/v1/authorize call.
 */
const PAYOUT_BASE_URLS: Record<CashfreePayoutEnv, string> = {
  test: "https://sandbox.cashfree.com/payout",
  live: "https://api.cashfree.com/payout",
};

/**
 * Cashfree Payout V1 Authorize URLs — used ONLY for credential verification
 * (Admin → Payout Gateway → Test Credentials).
 * - live:         https://payout-api.cashfree.com/payout/v1/authorize
 * - test/sandbox: https://payout-gamma.cashfree.com/payout/v1/authorize
 */
const PAYOUT_AUTHORIZE_URLS: Record<CashfreePayoutEnv, string> = {
  test: "https://payout-gamma.cashfree.com/payout/v1/authorize",
  live: "https://payout-api.cashfree.com/payout/v1/authorize",
};

/**
 * Resolve the V2 Standard Transfer base URL for the given environment,
 * honoring an admin-configured override (`CASHFREE_PAYOUT_BASE_URL` system
 * config) when one is present, falling back to the hardcoded default
 * otherwise. Trims whitespace and any trailing slash so downstream
 * concatenation in `buildPayoutEndpoint` never produces a doubled or
 * malformed path.
 */
export function resolvePayoutBaseUrl(env: CashfreePayoutEnv, configuredBaseUrl?: string | null): string {
  const configured = (configuredBaseUrl ?? "").trim();
  const base = configured || PAYOUT_BASE_URLS[env] || PAYOUT_BASE_URLS.test;
  return base.replace(/\/+$/, "");
}

/** Resolve the `x-api-version` header value, honoring an admin override. */
export function resolveApiVersion(configuredApiVersion?: string | null): string {
  const configured = (configuredApiVersion ?? "").trim();
  return configured || DEFAULT_API_VERSION;
}

/**
 * The ONLY place a Cashfree Payouts V2 request URL is assembled. Every call
 * site (create beneficiary, get beneficiary, create transfer, transfer
 * status) MUST go through this function so `baseUrl` + `path` can never be
 * malformed, doubled, or drift from what is actually sent on the wire.
 *
 * - Normalizes `baseUrl` to have no trailing slash and `path` to have
 *   exactly one leading slash.
 * - Defensively collapses an accidental doubled path segment (e.g. a
 *   misconfigured baseUrl already ending in "/beneficiary" plus a path of
 *   "/beneficiary" would otherwise produce ".../beneficiary/beneficiary").
 * - Never appends a beneficiary/transfer id as a path segment — V2 lookups
 *   are query-param based (`?beneficiary_id=...`), added by the caller via
 *   `URL.searchParams` on the returned string.
 */
export function buildPayoutEndpoint(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.trim().replace(/\/+$/, "");
  const normalizedPath = `/${path.trim().replace(/^\/+/, "")}`;

  if (normalizedPath !== "/" && normalizedBase.endsWith(normalizedPath)) {
    return normalizedBase;
  }

  return `${normalizedBase}${normalizedPath}`;
}

/**
 * Logs the exact method + endpoint path about to be called, BEFORE the
 * provider request is made. Sanitized — never includes the client secret,
 * full account number, or query-string values (which may carry account
 * numbers/IFSC on GET lookups).
 */
function logEndpointPathBuilt(method: "GET" | "POST", endpointPath: string) {
  logger.info({ method, endpointPath: endpointPath.split("?")[0] }, "cashfree_endpoint_path_built");
}

type PayoutCreateInput = {
  referenceId?: string;
  transferId?: string;
  beneficiaryName?: string;
  accountNumber?: string;
  ifsc?: string;
  upiId?: string;
  amount: number;
  remark?: string;
  /**
   * A beneficiary_id already confirmed to exist on Cashfree's side (e.g.
   * resolved via `cashfreePayoutEnsureBeneficiary` and persisted in
   * `payout_beneficiaries`). When provided, the transfer call uses it
   * directly instead of trying to create/verify a beneficiary inline.
   */
  beneficiaryId?: string;
  /**
   * Real merchant contact details. Cashfree's live environment validates
   * beneficiary contact info more strictly than sandbox — sending a
   * hardcoded placeholder email/phone can cause create to be silently
   * rejected. Falls back to a safe placeholder only if genuinely absent.
   */
  beneficiaryEmail?: string;
  beneficiaryPhone?: string;
};

/**
 * Map a Cashfree Standard Transfer `status` to our internal transfer status.
 *
 * IMPORTANT: "RECEIVED" / "ACKNOWLEDGED" mean Cashfree has accepted the
 * transfer request for processing — NOT that funds were disbursed. These
 * must map to PENDING, never SUCCESS, or a payout could be marked settled
 * before money actually moves.
 *   SUCCESS            -> SUCCESS
 *   PENDING/RECEIVED/PROCESSING/ACKNOWLEDGED -> PENDING
 *   FAILED/REJECTED/anything else            -> FAILED
 */
export function normalizeCashfreePayoutStatus(status?: string | null): "PENDING" | "SUCCESS" | "FAILED" {
  const s = String(status ?? "").trim().toUpperCase();
  if (["SUCCESS", "COMPLETED", "PROCESSED", "TRANSFER_SUCCESS"].includes(s)) return "SUCCESS";
  if (["PENDING", "PROCESSING", "IN_PROGRESS", "QUEUED", "APPROVAL_PENDING", "VALIDATION_PENDING", "RECEIVED", "ACKNOWLEDGED"].includes(s)) return "PENDING";
  return "FAILED";
}

export function isPayoutCredentialError(parsed: any, httpStatus?: number): boolean {
  if (httpStatus === 401 || httpStatus === 403) return true;
  const msg = String(parsed?.message ?? parsed?.error ?? "").toLowerCase();
  const code = String(parsed?.code ?? parsed?.status ?? "").toLowerCase();
  return (
    code.includes("authentication_failed") ||
    code.includes("unauthorized") ||
    msg.includes("invalid clientid") ||
    msg.includes("invalid client id") ||
    msg.includes("client secret") ||
    msg.includes("invalid credentials") ||
    msg.includes("invalid client")
  );
}

async function readJson(res: any) {
  const raw = await res.text();
  let parsed: any = {};
  try { parsed = raw ? JSON.parse(raw) : {}; } catch { parsed = { status: "ERROR", message: raw }; }
  return { raw, parsed, httpStatus: res.status as number };
}

function cleanId(v: string, max = 40) {
  return v.replace(/[^A-Za-z0-9_]/g, "_").slice(0, max);
}

function cleanName(v?: string) {
  return (v || "Test User").replace(/[^A-Za-z ]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "Test User";
}

function flattenV2Response(parsed: any) {
  return {
    ...parsed,
    status: parsed?.status,
    subCode: parsed?.status_code ?? parsed?.code ?? parsed?.subCode,
    message: parsed?.status_description ?? parsed?.message,
    transferId: parsed?.cf_transfer_id ?? parsed?.transfer_id,
    referenceId: parsed?.cf_transfer_id ?? parsed?.transfer_id,
    utr: parsed?.transfer_utr ?? parsed?.utr,
  };
}

function isBeneficiaryAlreadyExists(parsed: any, httpStatus: number): boolean {
  const code = String(parsed?.code ?? parsed?.subCode ?? parsed?.status_code ?? "").toUpperCase();
  const msg = String(parsed?.message ?? parsed?.status_description ?? "").toLowerCase();
  return (
    httpStatus === 409 ||
    code.includes("BENEFICIARY_ALREADY_EXISTS") ||
    code.includes("BENEFICIARY_CREATION_FAILED_ALREADY_EXISTS") ||
    msg.includes("already exist")
  );
}

export function isBeneficiaryNotFound(parsed: any, httpStatus: number): boolean {
  const code = String(parsed?.code ?? parsed?.subCode ?? parsed?.status_code ?? "").toLowerCase();
  const msg = String(parsed?.message ?? parsed?.status_description ?? "").toLowerCase();
  return httpStatus === 404 || code.includes("beneficiary_not_found") || msg.includes("does not exist");
}

/**
 * A 404 on the CREATE beneficiary call is never a legitimate provider
 * response — "not found" only makes sense for a lookup (GET). If create
 * returns 404 it means the request hit the wrong route (wrong base URL,
 * doubled/malformed path, or a legacy V1 endpoint) or the payload was
 * rejected in a way the gateway surfaces as a generic 404, NOT that the
 * beneficiary itself is missing. Distinguishing this from a normal
 * beneficiary_not_found (which is expected/handled on GET/transfer calls)
 * lets callers log and report it as an endpoint/payload problem instead of
 * silently retrying the same broken call.
 */
function isLikelyEndpointOrPayloadIssue(httpStatus: number): boolean {
  return httpStatus === 404;
}

async function cashfreePayoutCreateBeneficiary(
  clientId: string,
  clientSecret: string,
  env: CashfreePayoutEnv,
  beneficiaryId: string,
  input: PayoutCreateInput,
  providerConfig?: PayoutProviderConfig
) {
  const baseUrl = resolvePayoutBaseUrl(env, providerConfig?.baseUrl);
  const apiVersion = resolveApiVersion(providerConfig?.apiVersion);
  const isUpi = Boolean(input.upiId?.trim());

  // Cashfree validates contact details more strictly in live mode — a
  // hardcoded placeholder email/phone can be silently rejected there even
  // though sandbox accepts it. Use the real merchant contact when supplied,
  // falling back to a safe placeholder only if genuinely absent.
  const email = (input.beneficiaryEmail?.trim()) || "test@rasokart.com";
  const phoneDigits = (input.beneficiaryPhone ?? "").replace(/\D/g, "").slice(-10);
  const phone = phoneDigits.length === 10 ? phoneDigits : "9999999999";

  const body: any = {
    beneficiary_id: beneficiaryId,
    beneficiary_name: cleanName(input.beneficiaryName),
    beneficiary_instrument_details: isUpi
      ? { vpa: input.upiId?.trim() }
      : { bank_account_number: input.accountNumber?.trim(), bank_ifsc: input.ifsc?.trim() },
    beneficiary_contact_details: {
      beneficiary_email: email,
      beneficiary_phone: phone,
      beneficiary_country_code: "+91",
      beneficiary_address: "RasoKart",
      beneficiary_city: "Jaipur",
      beneficiary_state: "Rajasthan",
      beneficiary_postal_code: "302001"
    }
  };

  const endpointUrl = buildPayoutEndpoint(baseUrl, "/beneficiary");
  logEndpointPathBuilt("POST", endpointUrl.replace(baseUrl, ""));

  const res = await fetch(endpointUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-version": apiVersion,
      "x-client-id": clientId,
      "x-client-secret": clientSecret,
    },
    body: JSON.stringify(body),
  });

  const result = await readJson(res);
  return { ...result, endpointPath: endpointUrl.replace(baseUrl, "") };
}

/**
 * GET /payout/beneficiary — Cashfree V2 Get Beneficiary.
 *
 * IMPORTANT: per the official V2 contract this is a QUERY-PARAM lookup, NOT
 * a path-segment lookup — `GET {baseUrl}/beneficiary?beneficiary_id=...` (or
 * `?bank_account_number=...&bank_ifsc=...`). Calling
 * `{baseUrl}/beneficiary/{id}` (a path segment) does not match Cashfree's
 * documented route and can return an unexpected/empty response instead of a
 * real 200 or 404 — masking the true verification result. Always look up by
 * `beneficiary_id`; the bank_account_number/bank_ifsc pair is available as a
 * fallback identifier when no id is supplied.
 */
export async function cashfreePayoutGetBeneficiary(
  clientId: string,
  clientSecret: string,
  env: CashfreePayoutEnv,
  beneficiaryId: string,
  fallback?: { bankAccountNumber?: string; bankIfsc?: string },
  providerConfig?: PayoutProviderConfig
) {
  const baseUrl = resolvePayoutBaseUrl(env, providerConfig?.baseUrl);
  const apiVersion = resolveApiVersion(providerConfig?.apiVersion);
  const url = new URL(buildPayoutEndpoint(baseUrl, "/beneficiary"));
  if (beneficiaryId) {
    url.searchParams.set("beneficiary_id", beneficiaryId);
  } else if (fallback?.bankAccountNumber && fallback?.bankIfsc) {
    url.searchParams.set("bank_account_number", fallback.bankAccountNumber);
    url.searchParams.set("bank_ifsc", fallback.bankIfsc);
  }

  logEndpointPathBuilt("GET", url.toString().replace(baseUrl, ""));

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "x-api-version": apiVersion,
      "x-client-id": clientId,
      "x-client-secret": clientSecret,
    },
  });

  return await readJson(res);
}

export type VerifyV2CredentialsResult = {
  ok: boolean;
  message: string;
  httpStatus: number;
  subCode?: string;
};

/**
 * Verify Cashfree Payout credentials directly against the V2 Standard
 * Transfer surface (not the legacy V1 /authorize endpoint), per the
 * requirement that live payout credentials must be checked against the
 * actual API that beneficiary registration and transfers use.
 *
 * Does a GET on a beneficiary id that is extremely unlikely to exist. A
 * 404 "BENEFICIARY_NOT_FOUND" (or 200, in the unlikely case it exists)
 * means the client id/secret pair authenticated successfully — Cashfree
 * only returns that after passing auth. A 401/403 means the credentials
 * themselves are invalid or unauthorized. This never creates or mutates
 * anything on the provider side.
 */
export async function verifyPayoutCredentialsV2(
  rawClientId: string,
  rawClientSecret: string,
  env: CashfreePayoutEnv
): Promise<VerifyV2CredentialsResult> {
  const clientId = (rawClientId ?? "").trim();
  const clientSecret = (rawClientSecret ?? "").trim();

  if (!clientId || !clientSecret) {
    return { ok: false, message: "Client ID and Secret must both be set", httpStatus: 0 };
  }

  const probeId = `CREDCHECK_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    const { parsed, httpStatus } = await cashfreePayoutGetBeneficiary(clientId, clientSecret, env, probeId);

    if (httpStatus === 401 || httpStatus === 403) {
      return {
        ok: false,
        message: "V2 credential check failed — invalid client id/secret for Standard Transfers",
        httpStatus,
        subCode: String(parsed?.code ?? parsed?.subCode ?? parsed?.status_code ?? ""),
      };
    }

    // 404 (probe beneficiary genuinely not found) or 200 both prove the
    // request was authenticated by the provider.
    if (httpStatus === 404 || httpStatus === 200) {
      return { ok: true, message: "V2 credentials verified", httpStatus, subCode: String(parsed?.code ?? "") };
    }

    return {
      ok: false,
      message: "V2 credential check returned an unexpected response",
      httpStatus,
      subCode: String(parsed?.code ?? parsed?.subCode ?? parsed?.status_code ?? ""),
    };
  } catch (err: any) {
    return { ok: false, message: "Could not reach Cashfree Payouts V2 endpoint", httpStatus: 0 };
  }
}

export type EnsureBeneficiaryResult = {
  ok: boolean;
  beneficiaryId: string;
  httpStatus: number;
  subCode?: string;
  message?: string;
  /** Which stage failed — only meaningful when ok=false. Lets callers log/report precisely. */
  stage?: "create" | "verify";
  /** The exact path (e.g. "/beneficiary") that was called for the failing stage — safe to log. */
  endpointPath?: string;
  /**
   * True when a CREATE-stage failure returned httpStatus 404 — a signal that
   * is never a legitimate provider response for create and instead points
   * at a wrong route/base URL or a rejected payload, not a genuinely missing
   * beneficiary. Only meaningful when `stage === "create"`.
   */
  likelyEndpointOrPayloadIssue?: boolean;
};

export type VerifyBeneficiaryResult = {
  ok: boolean;
  httpStatus: number;
  subCode?: string;
  attempts: number;
};

/**
 * Confirm a beneficiary is actually retrievable via GET before it is trusted
 * for a transfer. A 200/201 (or already-exists) response on create does NOT
 * guarantee the record has propagated on Cashfree's side yet — retrying a
 * transfer immediately after "successful" registration can still 404 with
 * beneficiary_not_found. Retries with a short backoff, never mutates
 * anything, and never creates a second beneficiary.
 */
export async function cashfreePayoutVerifyBeneficiaryWithRetry(
  clientId: string,
  clientSecret: string,
  env: CashfreePayoutEnv,
  beneficiaryId: string,
  attempts = 3,
  delayMs = 600,
  providerConfig?: PayoutProviderConfig
): Promise<VerifyBeneficiaryResult> {
  let lastHttpStatus = 0;
  let lastSubCode: string | undefined;

  for (let i = 0; i < attempts; i++) {
    const fetched = await cashfreePayoutGetBeneficiary(clientId, clientSecret, env, beneficiaryId, undefined, providerConfig);

    // A 200 status alone is not sufficient proof. Cashfree's GET beneficiary
    // response must actually echo back the same beneficiary_id (and must not
    // itself be an error payload with an empty/mismatched body) — otherwise a
    // malformed or unexpectedly-shaped 200 could be trusted as "verified"
    // when the beneficiary was never really created on the provider side.
    const echoedId = String(fetched.parsed?.beneficiary_id ?? "").trim();
    const bodyLooksValid = echoedId.length > 0 && echoedId === beneficiaryId;
    // The V2 response also carries `beneficiary_status` (VERIFIED / PENDING /
    // INVALID / UNVERIFIED). A 200 with a matching id but INVALID status
    // means Cashfree has the record but rejected the bank/UPI details — that
    // must NOT be trusted as usable for a transfer.
    const beneficiaryStatus = String(fetched.parsed?.beneficiary_status ?? "").toUpperCase();
    const statusUsable = beneficiaryStatus !== "INVALID";

    if (fetched.httpStatus === 200 && bodyLooksValid && statusUsable) {
      return { ok: true, httpStatus: fetched.httpStatus, attempts: i + 1 };
    }

    lastHttpStatus = fetched.httpStatus;
    lastSubCode = fetched.httpStatus === 200 && bodyLooksValid && !statusUsable
      ? `beneficiary_status_${beneficiaryStatus.toLowerCase() || "invalid"}`
      : fetched.httpStatus === 200 && !bodyLooksValid
      ? "verify_response_id_mismatch"
      : String(fetched.parsed?.code ?? fetched.parsed?.subCode ?? fetched.parsed?.status_code ?? "");
    if (i < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs * (i + 1)));
    }
  }
  return { ok: false, httpStatus: lastHttpStatus, subCode: lastSubCode, attempts };
}

/**
 * Ensure a Cashfree Payouts V2 beneficiary exists for the given deterministic
 * `beneficiaryId`, following the required flow:
 *   1. Try to create it.
 *   2. Whether created fresh or already-existing, NEVER trust the create
 *      response alone — verify the record is actually retrievable via GET
 *      (with short retry/backoff for provider propagation delay) before
 *      returning ok:true.
 *   3. Only a confirmed, verified beneficiary is treated as `ok: true`.
 *
 * This never assumes a beneficiary exists just because we previously computed
 * the same deterministic ID, and never assumes a 200 create response means
 * the beneficiary is immediately usable for a transfer — both assumptions
 * caused "beneficiary_not_found" on transfer/retry in the past.
 */
export async function cashfreePayoutEnsureBeneficiary(
  clientId: string,
  clientSecret: string,
  env: CashfreePayoutEnv,
  beneficiaryId: string,
  input: PayoutCreateInput,
  providerConfig?: PayoutProviderConfig
): Promise<EnsureBeneficiaryResult> {
  try {
    const created = await cashfreePayoutCreateBeneficiary(clientId, clientSecret, env, beneficiaryId, input, providerConfig);

    const createdOk = created.httpStatus === 200 || created.httpStatus === 201;
    const alreadyExists = !createdOk && isBeneficiaryAlreadyExists(created.parsed, created.httpStatus);

    if (!createdOk && !alreadyExists) {
      return {
        ok: false,
        beneficiaryId,
        httpStatus: created.httpStatus,
        subCode: String(created.parsed?.code ?? created.parsed?.subCode ?? created.parsed?.status_code ?? ""),
        message: created.parsed?.message ?? created.parsed?.status_description ?? "Cashfree beneficiary create failed",
        stage: "create",
        endpointPath: created.endpointPath,
        likelyEndpointOrPayloadIssue: isLikelyEndpointOrPayloadIssue(created.httpStatus),
      };
    }

    // Created fresh, or already existed — either way, verify it is actually
    // retrievable (with retry/backoff for propagation delay) before trusting
    // it for a transfer.
    const verified = await cashfreePayoutVerifyBeneficiaryWithRetry(clientId, clientSecret, env, beneficiaryId, 3, 600, providerConfig);
    if (!verified.ok) {
      return {
        ok: false,
        beneficiaryId,
        httpStatus: verified.httpStatus,
        subCode: verified.subCode,
        message: "Could not verify beneficiary registration",
        stage: "verify",
      };
    }

    return { ok: true, beneficiaryId, httpStatus: created.httpStatus || verified.httpStatus };
  } catch (err: any) {
    // Network/connection error reaching Cashfree — never let this bubble up
    // as an unhandled exception in the route handler.
    return {
      ok: false,
      beneficiaryId,
      httpStatus: 0,
      message: err?.message ?? "Could not reach payout provider",
      stage: "create",
    };
  }
}

export async function cashfreePayoutCreateTransfer(
  rawClientId: string,
  rawClientSecret: string,
  env: CashfreePayoutEnv,
  input: PayoutCreateInput,
  providerConfig?: PayoutProviderConfig
): Promise<{ raw: string; parsed: any; httpStatus: number }> {
  // Trim whitespace — a stray space silently breaks auth on the transfer call too
  const clientId = (rawClientId ?? "").trim();
  const clientSecret = (rawClientSecret ?? "").trim();
  const baseUrl = resolvePayoutBaseUrl(env, providerConfig?.baseUrl);
  const apiVersion = resolveApiVersion(providerConfig?.apiVersion);

  const isUpi = Boolean(input.upiId?.trim());

  let beneficiaryId = input.beneficiaryId?.trim();
  if (!beneficiaryId) {
    // Backward-compatible path (no pre-resolved beneficiary_id supplied):
    // derive a deterministic ID and ensure it exists inline.
    const beneficiarySeed = isUpi
      ? input.upiId!.trim()
      : `${input.accountNumber ?? ""}_${input.ifsc ?? ""}`;
    beneficiaryId = cleanId(`BENE_${beneficiarySeed}`, 50);
    const ensured = await cashfreePayoutEnsureBeneficiary(clientId, clientSecret, env, beneficiaryId, input, providerConfig);
    if (!ensured.ok) {
      return {
        raw: "",
        parsed: flattenV2Response({
          status: "ERROR",
          status_code: ensured.subCode,
          message: ensured.message,
        }),
        httpStatus: ensured.httpStatus,
      };
    }
  }

  const transferId = cleanId(
    input.transferId ?? input.referenceId ?? `RKPAY_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  );

  const body: any = {
    transfer_id: transferId,
    transfer_amount: Number(input.amount),
    transfer_currency: "INR",
    transfer_mode: isUpi ? "upi" : "banktransfer",
    transfer_remarks: (input.remark ?? "RasoKart payout").replace(/[^A-Za-z0-9 ]/g, " ").slice(0, 70),
    beneficiary_details: isUpi
      ? { beneficiary_id: beneficiaryId }
      : {
          beneficiary_id: beneficiaryId,
          bank_account_number: input.accountNumber?.trim(),
          bank_ifsc: input.ifsc?.trim(),
        },
  };

  const endpointUrl = buildPayoutEndpoint(baseUrl, "/transfers");
  logEndpointPathBuilt("POST", endpointUrl.replace(baseUrl, ""));

  const res = await fetch(endpointUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-version": apiVersion,
      "x-client-id": clientId,
      "x-client-secret": clientSecret,
    },
    body: JSON.stringify(body),
  });

  const { raw, parsed, httpStatus } = await readJson(res);
  return { raw, parsed: flattenV2Response(parsed), httpStatus };
}

export async function cashfreePayoutGetTransferStatus(
  rawClientId: string,
  rawClientSecret: string,
  env: CashfreePayoutEnv,
  referenceId: string,
  providerConfig?: PayoutProviderConfig
) {
  // Trim whitespace — a stray space silently breaks auth on the status call too
  const clientId = (rawClientId ?? "").trim();
  const clientSecret = (rawClientSecret ?? "").trim();
  const baseUrl = resolvePayoutBaseUrl(env, providerConfig?.baseUrl);
  const apiVersion = resolveApiVersion(providerConfig?.apiVersion);
  const url = new URL(buildPayoutEndpoint(baseUrl, "/transfers"));
  url.searchParams.set("transfer_id", referenceId);

  logEndpointPathBuilt("GET", url.toString().replace(baseUrl, ""));

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "x-api-version": apiVersion,
      "x-client-id": clientId,
      "x-client-secret": clientSecret,
    },
  });

  const { raw, parsed, httpStatus } = await readJson(res);
  return { raw, parsed: flattenV2Response(parsed), httpStatus };
}

export type PayoutSafeReason =
  | "invalid_client_id"
  | "invalid_client_secret"
  | "ip_not_whitelisted"
  | "provider_unreachable"
  | "decrypt_failed"
  | "wrong_environment"
  | "unknown";

export type TestPayoutConnectionResult = {
  ok: boolean;
  message: string;
  safeReason?: PayoutSafeReason;
  /** Authorize URL that was called — safe to log server-side, never sent raw to client */
  url?: string;
  /** HTTP status from the provider — safe to log server-side, never sent raw to client */
  httpStatus?: number;
  /** Low-level fetch error code — logged server-side only */
  fetchError?: string;
  /** Provider status string (e.g. "SUCCESS", "ERROR") — safe to log server-side */
  providerStatus?: string;
  /** Whether a token was present in the response — logged server-side only, token itself is NEVER stored here */
  hasToken?: boolean;
  /** Provider subCode (e.g. "200", "401") — safe to log server-side */
  subCode?: string;
  /** Raw provider message (e.g. "Invalid ClientSecret") — safe to log server-side, never contains secrets */
  providerMessage?: string;
  /** Last 4 characters of the Client ID — safe to log for identification without exposing the full ID */
  clientIdLast4?: string;
  /** Length of the (trimmed) Client Secret — safe to log to confirm a non-empty/non-truncated value without exposing it */
  secretLength?: number;
};

/**
 * Verify Cashfree Payout credentials via the V1 Authorize endpoint.
 *
 * This endpoint is used ONLY for the Admin → Payout Gateway → Test Credentials
 * check. Actual transfers/beneficiaries still use the V2 API — this call has
 * no effect on those, it just confirms the Client ID / Secret pair is valid.
 *
 * Endpoint:
 *   live  → https://payout-api.cashfree.com/payout/v1/authorize
 *   test  → https://payout-gamma.cashfree.com/payout/v1/authorize
 *
 * Headers (uppercase — V1 style, matches confirmed-working VPS curl test):
 *   X-Client-Id: <clientId>
 *   X-Client-Secret: <clientSecret>
 *   Content-Type: application/json
 *
 * V1 response examples:
 *   200  { status: "SUCCESS", subCode: "200", message: "Token generated", data: { token } }
 *   401  { status: "ERROR",   subCode: "401", message: "Invalid ClientId" }
 *   401  { status: "ERROR",   subCode: "401", message: "Invalid ClientSecret" }
 *   403  { status: "ERROR",   subCode: "403", message: "IP address not whitelisted" }
 *
 * Success: status === "SUCCESS" OR subCode === "200" (matches confirmed provider behavior).
 */
export async function testPayoutConnection(
  rawClientId: string,
  rawClientSecret: string,
  env: CashfreePayoutEnv
): Promise<TestPayoutConnectionResult> {
  // Trim whitespace — a stray space silently breaks auth
  const clientId = (rawClientId ?? "").trim();
  const clientSecret = (rawClientSecret ?? "").trim();
  const clientIdLast4 = clientId.length >= 4 ? clientId.slice(-4) : clientId;
  const secretLength = clientSecret.length;

  if (!clientId || !clientSecret) {
    return {
      ok: false,
      message: "Client ID and Secret must both be set before testing",
      safeReason: "invalid_client_id",
      httpStatus: 0,
      clientIdLast4,
      secretLength,
    };
  }

  const authorizeUrl = PAYOUT_AUTHORIZE_URLS[env] ?? PAYOUT_AUTHORIZE_URLS.test;

  let httpStatus = 0;
  let parsed: any = {};
  let fetchError: string | undefined;

  try {
    const res = await fetch(authorizeUrl, {
      method: "POST",
      headers: {
        "X-Client-Id": clientId,
        "X-Client-Secret": clientSecret,
        "Content-Type": "application/json",
      },
      redirect: "follow",
    });

    const result = await readJson(res);
    httpStatus = result.httpStatus;
    parsed = result.parsed;
  } catch (err: any) {
    fetchError = err?.code ?? err?.message ?? String(err);
    const isNetworkError =
      err?.code === "ECONNREFUSED" ||
      err?.code === "ENOTFOUND" ||
      err?.code === "ETIMEDOUT" ||
      err?.code === "ECONNRESET" ||
      String(err?.message ?? "").toLowerCase().includes("fetch failed");
    return {
      ok: false,
      message: isNetworkError
        ? "Could not reach Cashfree Payout servers — check server network or firewall"
        : "Unexpected error contacting payout provider",
      safeReason: "provider_unreachable",
      httpStatus: 0,
      fetchError,
      url: authorizeUrl,
      clientIdLast4,
      secretLength,
    };
  }

  // ── Classify provider response ──────────────────────────────────────────────

  const providerStatus = String(parsed?.status ?? "").toUpperCase();
  const hasToken = !!(parsed?.data?.token || parsed?.token);
  // Raw provider message — safe to log, never contains the secret/token itself
  const providerMessage = String(
    parsed?.message ?? parsed?.error ?? parsed?.msg ?? parsed?.status_description ?? ""
  ).trim();
  const msgLower = providerMessage.toLowerCase();
  const subCode = String(
    parsed?.subCode ?? parsed?.sub_code ?? parsed?.status_code ?? parsed?.statusCode ?? ""
  ).trim();

  // ── SUCCESS ─────────────────────────────────────────────────────────────────
  // Per confirmed provider behavior, any of these indicates success:
  //   status === "SUCCESS", subCode/sub_code === "200",
  //   message contains "Token generated", or HTTP 2xx
  const messageHasTokenGenerated = msgLower.includes("token generated");
  const isSuccess =
    providerStatus === "SUCCESS" ||
    subCode === "200" ||
    messageHasTokenGenerated ||
    (httpStatus >= 200 && httpStatus < 300);

  if (isSuccess) {
    return {
      ok: true,
      message: "Credentials verified",
      httpStatus,
      providerStatus,
      hasToken,
      subCode,
      providerMessage,
      url: authorizeUrl,
      clientIdLast4,
      secretLength,
    };
  }

  // ── FAILURE — classify by HTTP status + provider message ────────────────────

  // Use provider subCode as fallback when HTTP code is altered by a proxy/redirect
  const effectiveStatus = httpStatus || (subCode ? parseInt(subCode, 10) : 0);

  // 403 — IP not whitelisted
  if (effectiveStatus === 403 || providerStatus === "FORBIDDEN") {
    const isIp =
      msgLower.includes("ip") ||
      msgLower.includes("whitelist") ||
      msgLower.includes("not allowed");
    return {
      ok: false,
      message: isIp
        ? "IP address is not whitelisted — add the server IP in Cashfree Payout dashboard → Settings → Whitelisted IPs"
        : "Access forbidden — check IP whitelist in Cashfree Payout dashboard",
      safeReason: "ip_not_whitelisted",
      httpStatus,
      providerStatus,
      subCode,
      providerMessage,
      url: authorizeUrl,
      clientIdLast4,
      secretLength,
    };
  }

  // 400 — bad request (often "payout service not enabled" or wrong env)
  if (effectiveStatus === 400) {
    const isNotEnabled =
      msgLower.includes("not enabled") ||
      (msgLower.includes("payout") && msgLower.includes("enabled"));
    const isWrongEnv =
      msgLower.includes("environment") ||
      msgLower.includes("test mode") ||
      msgLower.includes("production") ||
      msgLower.includes("sandbox");
    if (isNotEnabled) {
      return {
        ok: false,
        message: "Payout service is not enabled on this account — contact Cashfree to activate payouts",
        safeReason: "wrong_environment",
        httpStatus,
        providerStatus,
        subCode,
        providerMessage,
        url: authorizeUrl,
        clientIdLast4,
        secretLength,
      };
    }
    return {
      ok: false,
      message: isWrongEnv
        ? "Wrong environment — ensure the Environment toggle (Test/Live) matches your credentials"
        : "Bad request — verify credentials and environment setting",
      safeReason: isWrongEnv ? "wrong_environment" : "unknown",
      httpStatus,
      providerStatus,
      subCode,
      providerMessage,
      url: authorizeUrl,
      clientIdLast4,
      secretLength,
    };
  }

  // 401 / ERROR — invalid credentials
  if (
    effectiveStatus === 401 ||
    subCode === "401" ||
    providerStatus === "ERROR" ||
    providerStatus === "UNAUTHORIZED"
  ) {
    if (
      msgLower.includes("clientsecret") ||
      msgLower.includes("client secret") ||
      msgLower.includes("invalid secret") ||
      msgLower.includes("secret")
    ) {
      return {
        ok: false,
        message: "Client Secret is invalid — re-enter the Cashfree Payout Client Secret",
        safeReason: "invalid_client_secret",
        httpStatus,
        providerStatus,
        subCode,
        providerMessage,
        url: authorizeUrl,
        clientIdLast4,
        secretLength,
      };
    }
    if (
      msgLower.includes("clientid") ||
      msgLower.includes("client id") ||
      msgLower.includes("invalid clientid") ||
      msgLower.includes("invalid client")
    ) {
      return {
        ok: false,
        message: "Client ID is invalid — re-enter the Cashfree Payout Client ID",
        safeReason: "invalid_client_id",
        httpStatus,
        providerStatus,
        subCode,
        providerMessage,
        url: authorizeUrl,
        clientIdLast4,
        secretLength,
      };
    }
    // Generic 401 / ERROR — most likely bad credentials
    return {
      ok: false,
      message: "Invalid credentials — verify the Cashfree Payout Client ID and Secret",
      safeReason: "invalid_client_id",
      httpStatus,
      providerStatus,
      subCode,
      providerMessage,
      url: authorizeUrl,
      clientIdLast4,
      secretLength,
    };
  }

  // 5xx — provider down
  if (effectiveStatus >= 500) {
    return {
      ok: false,
      message: "Cashfree Payout service is currently unavailable — try again in a few minutes",
      safeReason: "provider_unreachable",
      httpStatus,
      providerStatus,
      subCode,
      providerMessage,
      url: authorizeUrl,
      clientIdLast4,
      secretLength,
    };
  }

  // Catch-all
  return {
    ok: false,
    message: "Credential check failed — verify Client ID, Secret, and environment",
    safeReason: "unknown",
    httpStatus,
    providerStatus,
    subCode,
    providerMessage,
    url: authorizeUrl,
    clientIdLast4,
    secretLength,
  };
}
