import { logger } from "../lib/logger";
import { db, merchantKycSettingsTable, kycVerificationLogsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { safeDecrypt, encryptValue } from "./encryptionHelper";

export interface AutoKycConfig {
  mode: string;
  clientId: string;
  clientSecret: string;
  baseUrl: string;
  minNameMatchScore: number;
  autoApproveEnabled: boolean;
  duplicateCheckEnabled: boolean;
  dailyVerificationLimit: number;
  perMerchantAttemptLimit: number;
  panApiEnabled: boolean;
  aadhaarApiEnabled: boolean;
}

export const DEFAULT_MIN_NAME_MATCH_SCORE = 80;

export async function loadAutoKycConfig(): Promise<AutoKycConfig | null> {
  const [row] = await db.select().from(merchantKycSettingsTable).where(eq(merchantKycSettingsTable.id, 1)).limit(1);
  if (!row) return null;
  const clientId = safeDecrypt(row.clientIdEncrypted, row.clientIdIv, row.clientIdTag);
  const clientSecret = safeDecrypt(row.clientSecretEncrypted, row.clientSecretIv, row.clientSecretTag);
  if (!clientId || !clientSecret) return null;
  return {
    mode: row.mode,
    clientId,
    clientSecret,
    baseUrl: row.baseUrl || (row.mode === "live" ? "https://api.cashfree.com" : "https://sandbox.cashfree.com"),
    minNameMatchScore: row.minNameMatchScore,
    autoApproveEnabled: row.autoApproveEnabled,
    duplicateCheckEnabled: row.duplicateCheckEnabled,
    dailyVerificationLimit: row.dailyVerificationLimit,
    perMerchantAttemptLimit: row.perMerchantAttemptLimit,
    panApiEnabled: row.panApiEnabled,
    aadhaarApiEnabled: row.aadhaarApiEnabled,
  };
}

function authHeaders(cfg: AutoKycConfig): Record<string, string> {
  return {
    "x-client-id": cfg.clientId,
    "x-client-secret": cfg.clientSecret,
    "Content-Type": "application/json",
    "Accept": "application/json",
  };
}

export function maskPan(pan: string): string {
  if (pan.length < 6) return "••••••";
  return `${pan.slice(0, 2)}${"*".repeat(pan.length - 4)}${pan.slice(-2)}`;
}

export function maskAadhaarToLast4(aadhaar: string): string {
  const digits = aadhaar.replace(/\D/g, "");
  return digits.slice(-4);
}

/**
 * Normalized Levenshtein-distance based similarity score (0-100).
 * Names are uppercased and stripped of extra whitespace/punctuation before comparing,
 * so minor formatting differences (middle initials aside) don't tank the score.
 */
export function computeNameMatchScore(nameA: string, nameB: string): number {
  const normalize = (s: string) => s.toUpperCase().replace(/[^A-Z\s]/g, "").replace(/\s+/g, " ").trim();
  const a = normalize(nameA);
  const b = normalize(nameB);
  if (!a || !b) return 0;
  if (a === b) return 100;

  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i]![0] = i;
  for (let j = 0; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + cost,
      );
    }
  }
  const distance = dp[a.length]![b.length]!;
  const maxLen = Math.max(a.length, b.length);
  const similarity = maxLen === 0 ? 100 : Math.round((1 - distance / maxLen) * 100);
  return Math.max(0, Math.min(100, similarity));
}

export interface PanVerifyResult {
  ok: boolean;
  status: "VERIFIED" | "INVALID" | "PROVIDER_ERROR";
  panType?: string;
  registeredName?: string;
  requestId?: string;
}

/**
 * Verifies PAN via the Cashfree Secure ID PAN API (not PAN Lite / PAN 360).
 * Passing the merchant's registered name lets the provider return a name-match
 * signal alongside the raw registered name, which we still cross-check locally
 * via computeNameMatchScore() for the final auto-approval decision.
 */
export async function verifyPanAuto(
  cfg: AutoKycConfig,
  pan: string,
  merchantId: number,
  name?: string,
): Promise<PanVerifyResult> {
  const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
  if (!panRegex.test(pan.toUpperCase())) {
    await logKyc(merchantId, "PAN", "FAILED", maskPan(pan), null, null, "invalid_format");
    return { ok: false, status: "INVALID" };
  }
  try {
    const resp = await fetch(`${cfg.baseUrl}/verification/v1/secure-id/pan`, {
      method: "POST",
      headers: authHeaders(cfg),
      body: JSON.stringify({ pan: pan.toUpperCase(), name }),
      signal: AbortSignal.timeout(10_000),
    });
    const raw = (await resp.json().catch(() => ({}))) as Record<string, any>;
    const requestId: string | undefined = raw?.request_id;
    if (!resp.ok) {
      await logKyc(merchantId, "PAN", "PROVIDER_ERROR", maskPan(pan), requestId ?? null, `http_${resp.status}`, null);
      return { ok: false, status: "PROVIDER_ERROR", requestId };
    }
    const valid = raw?.status === "VALID";
    if (!valid) {
      await logKyc(merchantId, "PAN", "FAILED", maskPan(pan), requestId ?? null, "provider_invalid", null);
      return { ok: false, status: "INVALID", requestId };
    }
    await logKyc(merchantId, "PAN", "VERIFIED", maskPan(pan), requestId ?? null, "verified", null);
    return {
      ok: true,
      status: "VERIFIED",
      panType: raw?.pan_type ?? "PERSONAL",
      registeredName: raw?.registered_name ?? raw?.name,
      requestId,
    };
  } catch (err: any) {
    logger.warn({ err: err?.message, merchantId }, "auto_kyc_pan_verify_exception");
    await logKyc(merchantId, "PAN", "PROVIDER_ERROR", maskPan(pan), null, "timeout_or_network", null);
    return { ok: false, status: "PROVIDER_ERROR" };
  }
}

export interface AadhaarSessionStartResult {
  ok: boolean;
  sessionId?: string;
  authorizationUrl?: string;
  mode?: string;
}

/**
 * Starts a Cashfree Secure ID DigiLocker session for Aadhaar verification.
 * This is the DigiLocker-based flow (merchant consents via DigiLocker login),
 * NOT Offline Aadhaar OTP and NOT Aadhaar Masking — those are intentionally
 * unused for merchant auto-KYC.
 */
export async function startAadhaarDigilockerSession(
  cfg: AutoKycConfig,
  merchantId: number,
  mobile: string,
): Promise<AadhaarSessionStartResult> {
  try {
    const resp = await fetch(`${cfg.baseUrl}/verification/v1/secure-id/sessions`, {
      method: "POST",
      headers: authHeaders(cfg),
      body: JSON.stringify({ mobile, state: `merchant_kyc:${merchantId}` }),
      signal: AbortSignal.timeout(10_000),
    });
    const raw = (await resp.json().catch(() => ({}))) as Record<string, any>;
    if (!resp.ok || !raw?.session_id) {
      await logKyc(merchantId, "AADHAAR", "PROVIDER_ERROR", null, raw?.session_id ?? null, `http_${resp.status}`, null);
      return { ok: false };
    }
    await logKyc(merchantId, "AADHAAR", "DIGILOCKER_SESSION_CREATED", null, String(raw.session_id), "session_created", null);
    return { ok: true, sessionId: String(raw.session_id), authorizationUrl: raw.authorization_url, mode: cfg.mode };
  } catch (err: any) {
    logger.warn({ err: err?.message, merchantId }, "auto_kyc_aadhaar_digilocker_start_exception");
    await logKyc(merchantId, "AADHAAR", "PROVIDER_ERROR", null, null, "timeout_or_network", null);
    return { ok: false };
  }
}

export interface AadhaarStatusResult {
  ok: boolean;
  status: "VERIFIED" | "PENDING" | "FAILED" | "CANCELLED" | "PROVIDER_ERROR";
  name?: string;
  last4?: string;
  requestId?: string;
}

/**
 * Completes the Cashfree Secure ID DigiLocker Aadhaar flow: exchanges the SDK's
 * auth_code for an access token, then fetches the DigiLocker-verified profile
 * (name + masked Aadhaar) via the Secure ID user endpoint.
 */
export async function completeAadhaarDigilockerSession(
  cfg: AutoKycConfig,
  sessionId: string,
  authCode: string,
  merchantId: number,
): Promise<AadhaarStatusResult> {
  if (!authCode || authCode.trim().length === 0) {
    await logKyc(merchantId, "AADHAAR", "CANCELLED", null, sessionId, "consent_cancelled", null);
    return { ok: false, status: "CANCELLED" };
  }
  try {
    const tokenResp = await fetch(`${cfg.baseUrl}/verification/v1/secure-id/token`, {
      method: "POST",
      headers: authHeaders(cfg),
      body: JSON.stringify({ grant_type: "authorization_code", code: authCode, session_id: sessionId }),
      signal: AbortSignal.timeout(10_000),
    });
    const tokenRaw = (await tokenResp.json().catch(() => ({}))) as Record<string, any>;
    if (!tokenResp.ok || !tokenRaw?.access_token) {
      await logKyc(merchantId, "AADHAAR", "PROVIDER_ERROR", null, sessionId, `http_${tokenResp.status}`, null);
      return { ok: false, status: "PROVIDER_ERROR" };
    }

    const userResp = await fetch(`${cfg.baseUrl}/verification/v1/secure-id/user`, {
      method: "GET",
      headers: { ...authHeaders(cfg), Authorization: `Bearer ${tokenRaw.access_token}` },
      signal: AbortSignal.timeout(10_000),
    });
    const raw = (await userResp.json().catch(() => ({}))) as Record<string, any>;
    if (!userResp.ok) {
      await logKyc(merchantId, "AADHAAR", "PROVIDER_ERROR", null, sessionId, `http_${userResp.status}`, null);
      return { ok: false, status: "PROVIDER_ERROR" };
    }

    const p = (raw.profile ?? raw.data?.profile ?? raw) as Record<string, any>;
    const aadhaar = (raw.aadhaar ?? raw.data?.aadhaar) as Record<string, any> | undefined;
    const name: string | undefined = p?.name ?? p?.full_name;
    const aadhaarRaw: string | undefined = aadhaar?.masked_aadhaar ?? p?.aadhaar;
    const last4: string | undefined = aadhaarRaw ? aadhaarRaw.toString().replace(/\D/g, "").slice(-4) : undefined;

    if (!name || !last4) {
      await logKyc(merchantId, "AADHAAR", "FAILED", null, sessionId, "digilocker_incomplete", null);
      return { ok: false, status: "FAILED" };
    }

    await logKyc(merchantId, "AADHAAR", "VERIFIED", `••••${last4}`, sessionId, "verified", null);
    return { ok: true, status: "VERIFIED", name, last4, requestId: sessionId };
  } catch (err: any) {
    logger.warn({ err: err?.message, merchantId }, "auto_kyc_aadhaar_digilocker_complete_exception");
    await logKyc(merchantId, "AADHAAR", "PROVIDER_ERROR", null, sessionId, "timeout_or_network", null);
    return { ok: false, status: "PROVIDER_ERROR" };
  }
}

export async function testAutoKycConnection(cfg: AutoKycConfig): Promise<{ ok: boolean; message: string }> {
  try {
    const resp = await fetch(`${cfg.baseUrl}/verification/v1/secure-id/pan`, {
      method: "POST",
      headers: authHeaders(cfg),
      body: JSON.stringify({ pan: "ABCDE1234F" }),
      signal: AbortSignal.timeout(8000),
    });
    if (resp.status === 401 || resp.status === 403) {
      return { ok: false, message: "Credentials rejected by provider. Check Client ID / Secret." };
    }
    return { ok: true, message: "Provider reachable and credentials accepted." };
  } catch (err: any) {
    return { ok: false, message: "Could not reach provider (network/timeout)." };
  }
}

export async function logKyc(
  merchantId: number,
  verificationType: "PAN" | "AADHAAR",
  status: string,
  requestMasked: string | null,
  providerReferenceId: string | null,
  responseMasked: string | null,
  errorReason: string | null,
) {
  try {
    let refEnc: { encrypted: string; iv: string; tag: string } | null = null;
    if (providerReferenceId) refEnc = encryptValue(providerReferenceId);
    await db.insert(kycVerificationLogsTable).values({
      merchantId,
      verificationType,
      status,
      requestMasked,
      responseMasked,
      providerReferenceIdEncrypted: refEnc?.encrypted ?? null,
      providerReferenceIdIv: refEnc?.iv ?? null,
      providerReferenceIdTag: refEnc?.tag ?? null,
      errorReason,
    });
  } catch (err: unknown) {
    logger.warn({ err }, "kyc_verification_log_insert_error");
  }
}
