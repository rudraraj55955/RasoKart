export type CashfreePayoutEnv = "test" | "live";

/**
 * Cashfree Payout V2 base URLs.
 * Both test and production use the same domain; environment is determined
 * by which set of credentials you supply.
 */
const PAYOUT_BASE_URLS: Record<CashfreePayoutEnv, string> = {
  test: "https://payout-api.cashfree.com/payout/v2",
  live: "https://payout-api.cashfree.com/payout/v2",
};

/**
 * V1 Authorize endpoint — used for credential verification only.
 * Returns a short-lived token; we use the response code to validate creds.
 * Same URL for both test and live (credentials determine the environment).
 */
const PAYOUT_AUTHORIZE_URL = "https://payout-api.cashfree.com/payout/v1/authorize";

type PayoutCreateInput = {
  referenceId?: string;
  transferId?: string;
  beneficiaryName?: string;
  accountNumber?: string;
  ifsc?: string;
  upiId?: string;
  amount: number;
  remark?: string;
};

export function normalizeCashfreePayoutStatus(status?: string | null): "PENDING" | "SUCCESS" | "FAILED" {
  const s = String(status ?? "").trim().toUpperCase();
  if (["SUCCESS", "COMPLETED", "PROCESSED", "TRANSFER_SUCCESS", "ACKNOWLEDGED", "RECEIVED"].includes(s)) return "SUCCESS";
  if (["PENDING", "PROCESSING", "IN_PROGRESS", "QUEUED", "APPROVAL_PENDING", "VALIDATION_PENDING"].includes(s)) return "PENDING";
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

async function createBeneficiaryIfNeeded(
  clientId: string,
  clientSecret: string,
  env: CashfreePayoutEnv,
  beneficiaryId: string,
  input: PayoutCreateInput
) {
  const baseUrl = PAYOUT_BASE_URLS[env] ?? PAYOUT_BASE_URLS.test;
  const isUpi = Boolean(input.upiId?.trim());

  const body: any = {
    beneficiary_id: beneficiaryId,
    beneficiary_name: cleanName(input.beneficiaryName),
    beneficiary_instrument_details: isUpi
      ? { vpa: input.upiId?.trim() }
      : { bank_account_number: input.accountNumber?.trim(), bank_ifsc: input.ifsc?.trim() },
    beneficiary_contact_details: {
      beneficiary_email: "test@rasokart.com",
      beneficiary_phone: "9999999999",
      beneficiary_country_code: "+91",
      beneficiary_address: "RasoKart",
      beneficiary_city: "Jaipur",
      beneficiary_state: "Rajasthan",
      beneficiary_postal_code: "302001"
    }
  };

  const res = await fetch(`${baseUrl}/beneficiary`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-version": "2024-01-01",
      "x-client-id": clientId,
      "x-client-secret": clientSecret,
    },
    body: JSON.stringify(body),
  });

  const out = await readJson(res);

  if (out.httpStatus === 201 || out.httpStatus === 200 || out.httpStatus === 409) {
    return { ok: true, raw: out.raw, parsed: out.parsed, httpStatus: out.httpStatus };
  }

  return {
    ok: false,
    raw: out.raw,
    parsed: {
      ...out.parsed,
      status: "ERROR",
      message: out.parsed?.message ?? "Cashfree beneficiary create failed",
    },
    httpStatus: out.httpStatus,
  };
}

export async function cashfreePayoutCreateTransfer(
  clientId: string,
  clientSecret: string,
  env: CashfreePayoutEnv,
  input: PayoutCreateInput
): Promise<{ raw: string; parsed: any; httpStatus: number }> {
  const baseUrl = PAYOUT_BASE_URLS[env] ?? PAYOUT_BASE_URLS.test;

  const isUpi = Boolean(input.upiId?.trim());
  const beneficiarySeed = isUpi
    ? input.upiId!.trim()
    : `${input.accountNumber ?? ""}_${input.ifsc ?? ""}`;

  const beneficiaryId = cleanId(`BENE_${beneficiarySeed}`, 50);

  const bene = await createBeneficiaryIfNeeded(clientId, clientSecret, env, beneficiaryId, input);
  if (!bene.ok) {
    return { raw: bene.raw, parsed: flattenV2Response(bene.parsed), httpStatus: bene.httpStatus };
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
    beneficiary_details: {
      beneficiary_id: beneficiaryId,
    },
  };

  const res = await fetch(`${baseUrl}/transfers`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-version": "2024-01-01",
      "x-client-id": clientId,
      "x-client-secret": clientSecret,
    },
    body: JSON.stringify(body),
  });

  const { raw, parsed, httpStatus } = await readJson(res);
  return { raw, parsed: flattenV2Response(parsed), httpStatus };
}

export async function cashfreePayoutGetTransferStatus(
  clientId: string,
  clientSecret: string,
  env: CashfreePayoutEnv,
  referenceId: string
) {
  const baseUrl = PAYOUT_BASE_URLS[env] ?? PAYOUT_BASE_URLS.test;
  const url = new URL(`${baseUrl}/transfers`);
  url.searchParams.set("transfer_id", referenceId);

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "x-api-version": "2024-01-01",
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
  /** HTTP status from the provider — logged server-side only, never sent raw to client */
  _httpStatus?: number;
  /** Low-level fetch error code — logged server-side only */
  _fetchError?: string;
  /** Provider status string — logged server-side only */
  _providerStatus?: string;
  /** Whether a token was present in the response — logged server-side only */
  _hasToken?: boolean;
};

/**
 * Verify Cashfree Payout credentials by calling the V1 Authorize endpoint.
 *
 * Endpoint:  POST https://payout-api.cashfree.com/payout/v1/authorize
 * Headers:   X-Client-Id: <clientId>
 *            X-Client-Secret: <clientSecret>
 *            Content-Type: application/json
 *
 * V1 response examples:
 *   200  { status: "SUCCESS", subCode: "200", message: "Token generated", data: { token } }
 *   401  { status: "ERROR",   subCode: "401", message: "Invalid ClientId" }
 *   401  { status: "ERROR",   subCode: "401", message: "Invalid ClientSecret" }
 *   403  { status: "ERROR",   subCode: "403", message: "IP address not whitelisted" }
 *
 * Success is detected by:
 *   1. HTTP 200-299 range, OR
 *   2. parsed.status === "SUCCESS" (in case of redirect/proxy that changes HTTP code), OR
 *   3. parsed.data.token is present (token means Cashfree auth passed)
 */
export async function testPayoutConnection(
  rawClientId: string,
  rawClientSecret: string,
  env: CashfreePayoutEnv
): Promise<TestPayoutConnectionResult> {
  // Always trim whitespace — a stray space breaks auth silently
  const clientId = (rawClientId ?? "").trim();
  const clientSecret = (rawClientSecret ?? "").trim();

  if (!clientId || !clientSecret) {
    return {
      ok: false,
      message: "Client ID and Secret must both be set before testing",
      safeReason: "invalid_client_id",
      _httpStatus: 0,
    };
  }

  let httpStatus = 0;
  let parsed: any = {};
  let fetchError: string | undefined;

  try {
    const res = await fetch(PAYOUT_AUTHORIZE_URL, {
      method: "POST",
      headers: {
        "X-Client-Id": clientId,
        "X-Client-Secret": clientSecret,
        "Content-Type": "application/json",
      },
      body: "{}",
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
      _httpStatus: 0,
      _fetchError: fetchError,
    };
  }

  // ── Classify response ──────────────────────────────────────────────────────

  const providerStatus = String(parsed?.status ?? "").toUpperCase();
  const hasToken = !!(parsed?.data?.token || parsed?.token);
  const msgLower = String(parsed?.message ?? parsed?.error ?? parsed?.msg ?? "").toLowerCase();
  const subCode = String(parsed?.subCode ?? parsed?.sub_code ?? parsed?.statusCode ?? "").trim();

  // Success: HTTP 2xx OR provider explicitly says SUCCESS OR token is present
  const isSuccess =
    (httpStatus >= 200 && httpStatus < 300) ||
    providerStatus === "SUCCESS" ||
    hasToken;

  if (isSuccess) {
    return {
      ok: true,
      message: "Credentials verified — payout gateway is reachable and authenticated",
      _httpStatus: httpStatus,
      _providerStatus: providerStatus,
      _hasToken: hasToken,
    };
  }

  // Effective status: use subCode as fallback when HTTP code is unexpected (redirect, proxy)
  const effectiveStatus = httpStatus || (subCode ? parseInt(subCode, 10) : 0);

  if (effectiveStatus === 403 || providerStatus === "FORBIDDEN") {
    const isIp = msgLower.includes("ip") || msgLower.includes("whitelist") || msgLower.includes("not allowed");
    return {
      ok: false,
      message: isIp
        ? "IP address is not whitelisted — add the server IP in Cashfree Payout dashboard → Settings → Whitelisted IPs"
        : "Access forbidden — check IP whitelist in Cashfree Payout dashboard",
      safeReason: "ip_not_whitelisted",
      _httpStatus: httpStatus,
    };
  }

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
        _httpStatus: httpStatus,
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
        _httpStatus: httpStatus,
      };
    }
    // Generic 401 / ERROR with no message match — most likely bad credentials
    return {
      ok: false,
      message: "Invalid credentials — verify the Cashfree Payout Client ID and Secret",
      safeReason: "invalid_client_id",
      _httpStatus: httpStatus,
    };
  }

  if (effectiveStatus === 400) {
    const isWrongEnv =
      msgLower.includes("environment") ||
      msgLower.includes("not enabled") ||
      msgLower.includes("test mode") ||
      msgLower.includes("production") ||
      msgLower.includes("sandbox");
    return {
      ok: false,
      message: isWrongEnv
        ? "Wrong environment — ensure the Environment toggle (Test/Live) matches your credentials"
        : "Bad request — verify the credentials and environment setting",
      safeReason: isWrongEnv ? "wrong_environment" : "unknown",
      _httpStatus: httpStatus,
    };
  }

  if (effectiveStatus >= 500) {
    return {
      ok: false,
      message: "Cashfree Payout service is currently unavailable — try again in a few minutes",
      safeReason: "provider_unreachable",
      _httpStatus: httpStatus,
    };
  }

  return {
    ok: false,
    message: "Credential check failed — verify Client ID, Secret, and environment",
    safeReason: "unknown",
    _httpStatus: httpStatus,
  };
}
