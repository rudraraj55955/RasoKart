import { logger } from "../lib/logger";
import { db, secureIdSettingsTable, verificationLogsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { safeDecrypt, encryptValue } from "./encryptionHelper";

export interface SecureIdConfig {
  mode: string;
  clientId: string;
  clientSecret: string;
  apiVersion: string;
}

export interface DataAvailabilityResult {
  available: boolean;
  profile?: Record<string, unknown>;
}

export interface SessionResult {
  sessionId: string;
  authorizationUrl: string;
  expiresAt: Date;
}

export interface UserDataResult {
  fullName?: string;
  dob?: string;
  gender?: string;
  email?: string;
  mobile?: string;
  panNumber?: string;
  panMasked?: string;
  aadhaarLast4?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  pincode?: string;
  businessName?: string;
}

export interface VerifyResult {
  status: "VERIFIED" | "FAILED" | "MISMATCH" | "SKIPPED";
  requestId?: string;
  rawResponse?: Record<string, unknown>;
  error?: string;
}

export async function loadSecureIdConfig(): Promise<SecureIdConfig | null> {
  const [row] = await db.select().from(secureIdSettingsTable).where(eq(secureIdSettingsTable.id, 1)).limit(1);
  if (!row) return null;
  const clientId = safeDecrypt(row.clientIdEncrypted, row.clientIdIv, row.clientIdTag);
  const clientSecret = safeDecrypt(row.clientSecretEncrypted, row.clientSecretIv, row.clientSecretTag);
  if (!clientId || !clientSecret) return null;
  return { mode: row.mode, clientId, clientSecret, apiVersion: row.apiVersion };
}

function baseUrl(mode: string): string {
  return mode === "live" ? "https://api.cashfree.com" : "https://sandbox.cashfree.com";
}

function authHeaders(cfg: SecureIdConfig): Record<string, string> {
  return {
    "x-client-id": cfg.clientId,
    "x-client-secret": cfg.clientSecret,
    "x-api-version": cfg.apiVersion,
    "Content-Type": "application/json",
    "Accept": "application/json",
  };
}

export async function checkDataAvailability(
  cfg: SecureIdConfig,
  mobile: string,
): Promise<DataAvailabilityResult> {
  try {
    const resp = await fetch(`${baseUrl(cfg.mode)}/verification/v1/secure-id/data-availability`, {
      method: "POST",
      headers: authHeaders(cfg),
      body: JSON.stringify({ mobile }),
      signal: AbortSignal.timeout(10_000),
    });
    const raw = await resp.json().catch(() => ({})) as Record<string, any>;
    if (!resp.ok) {
      logger.warn({ status: resp.status }, "secureid_data_availability_failed");
      return { available: false };
    }
    return { available: !!(raw as any)?.data_available, profile: (raw as any)?.profile };
  } catch (err: any) {
    logger.warn({ err: err?.message }, "secureid_data_availability_exception");
    return { available: false };
  }
}

export async function createSecureIdSession(
  cfg: SecureIdConfig,
  mobile: string,
  state: string,
): Promise<SessionResult | null> {
  try {
    const resp = await fetch(`${baseUrl(cfg.mode)}/verification/v1/secure-id/sessions`, {
      method: "POST",
      headers: authHeaders(cfg),
      body: JSON.stringify({ mobile, state }),
      signal: AbortSignal.timeout(10_000),
    });
    const raw = await resp.json().catch(() => null) as Record<string, any> | null;
    if (!resp.ok || !raw?.session_id) {
      logger.warn({ status: resp.status }, "secureid_create_session_failed");
      return null;
    }
    return {
      sessionId: raw.session_id,
      authorizationUrl: raw.authorization_url ?? "",
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    };
  } catch (err: any) {
    logger.warn({ err: err?.message }, "secureid_create_session_exception");
    return null;
  }
}

export async function exchangeAuthCode(
  cfg: SecureIdConfig,
  authCode: string,
  sessionId: string,
): Promise<string | null> {
  try {
    const resp = await fetch(`${baseUrl(cfg.mode)}/verification/v1/secure-id/token`, {
      method: "POST",
      headers: authHeaders(cfg),
      body: JSON.stringify({ grant_type: "authorization_code", code: authCode, session_id: sessionId }),
      signal: AbortSignal.timeout(10_000),
    });
    const raw = await resp.json().catch(() => null) as Record<string, any> | null;
    if (!resp.ok || !raw?.access_token) {
      logger.warn({ status: resp.status }, "secureid_token_exchange_failed");
      return null;
    }
    return raw.access_token;
  } catch (err: any) {
    logger.warn({ err: err?.message }, "secureid_token_exchange_exception");
    return null;
  }
}

export async function fetchUserData(
  cfg: SecureIdConfig,
  accessToken: string,
): Promise<UserDataResult> {
  try {
    const resp = await fetch(`${baseUrl(cfg.mode)}/verification/v1/secure-id/user`, {
      method: "GET",
      headers: { ...authHeaders(cfg), Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    const raw = await resp.json().catch(() => null) as Record<string, any> | null;
    if (!resp.ok || !raw) {
      logger.warn({ status: resp.status }, "secureid_fetch_user_failed");
      return {};
    }
    const p = (raw.profile ?? raw.data?.profile ?? raw) as Record<string, any>;
    const pan = (raw.pan ?? raw.data?.pan) as Record<string, any> | undefined;
    const aadhaar = (raw.aadhaar ?? raw.data?.aadhaar) as Record<string, any> | undefined;
    const panRaw: string | undefined = pan?.pan_number ?? p?.pan;
    const aadhaarRaw: string | undefined = aadhaar?.masked_aadhaar ?? p?.aadhaar;
    return {
      fullName: p.name ?? p.full_name,
      dob: p.dob ?? p.date_of_birth,
      gender: p.gender,
      email: p.email,
      mobile: p.mobile,
      panNumber: panRaw,
      panMasked: panRaw ? `${panRaw.slice(0, 2)}${"*".repeat(panRaw.length - 4)}${panRaw.slice(-2)}` : undefined,
      aadhaarLast4: aadhaarRaw ? aadhaarRaw.replace(/\D/g, "").slice(-4) : undefined,
      addressLine1: p.address?.line1 ?? p.address_line1,
      addressLine2: p.address?.line2 ?? p.address_line2,
      city: p.address?.city ?? p.city,
      state: p.address?.state ?? p.state,
      pincode: p.address?.pincode ?? p.pincode,
      businessName: raw.business?.name ?? raw["company_name"],
    };
  } catch (err: any) {
    logger.warn({ err: err?.message }, "secureid_fetch_user_exception");
    return {};
  }
}

export async function verifyPan(
  cfg: SecureIdConfig,
  pan: string,
  name: string,
  merchantId: number,
  sessionId: number | null,
): Promise<VerifyResult> {
  try {
    const resp = await fetch(`${baseUrl(cfg.mode)}/verification/v1/pan`, {
      method: "POST",
      headers: authHeaders(cfg),
      body: JSON.stringify({ pan, name }),
      signal: AbortSignal.timeout(10_000),
    });
    const raw = await resp.json().catch(() => ({})) as Record<string, any>;
    const status: VerifyResult["status"] = resp.ok && (raw as any)?.status === "VALID" ? "VERIFIED" : resp.ok && (raw as any)?.name_match === false ? "MISMATCH" : "FAILED";
    await logVerification(merchantId, sessionId, "PAN", status, (raw as any)?.request_id, raw, null);
    return { status, requestId: (raw as any)?.request_id, rawResponse: raw };
  } catch (err: any) {
    await logVerification(merchantId, sessionId, "PAN", "FAILED", null, null, err?.message);
    return { status: "FAILED", error: "PAN verification request failed" };
  }
}

export async function verifyGst(
  cfg: SecureIdConfig,
  gstin: string,
  merchantId: number,
  sessionId: number | null,
): Promise<VerifyResult> {
  try {
    const resp = await fetch(`${baseUrl(cfg.mode)}/verification/v1/gst`, {
      method: "POST",
      headers: authHeaders(cfg),
      body: JSON.stringify({ gst: gstin }),
      signal: AbortSignal.timeout(10_000),
    });
    const raw = await resp.json().catch(() => ({})) as Record<string, any>;
    const status: VerifyResult["status"] = resp.ok && (raw as any)?.status === "VALID" ? "VERIFIED" : "FAILED";
    await logVerification(merchantId, sessionId, "GST", status, (raw as any)?.request_id, raw, null);
    return { status, requestId: (raw as any)?.request_id, rawResponse: raw };
  } catch (err: any) {
    await logVerification(merchantId, sessionId, "GST", "FAILED", null, null, err?.message);
    return { status: "FAILED", error: "GST verification request failed" };
  }
}

export async function verifyCin(
  cfg: SecureIdConfig,
  cin: string,
  merchantId: number,
  sessionId: number | null,
): Promise<VerifyResult> {
  try {
    const resp = await fetch(`${baseUrl(cfg.mode)}/verification/v1/company/cin`, {
      method: "POST",
      headers: authHeaders(cfg),
      body: JSON.stringify({ cin }),
      signal: AbortSignal.timeout(10_000),
    });
    const raw = await resp.json().catch(() => ({})) as Record<string, any>;
    const status: VerifyResult["status"] = resp.ok && (raw as any)?.status === "VALID" ? "VERIFIED" : "FAILED";
    await logVerification(merchantId, sessionId, "CIN", status, (raw as any)?.request_id, raw, null);
    return { status, requestId: (raw as any)?.request_id, rawResponse: raw };
  } catch (err: any) {
    await logVerification(merchantId, sessionId, "CIN", "FAILED", null, null, err?.message);
    return { status: "FAILED", error: "CIN verification request failed" };
  }
}

export async function verifyBankAccount(
  cfg: SecureIdConfig,
  accountNumber: string,
  ifsc: string,
  merchantId: number,
  sessionId: number | null,
): Promise<VerifyResult> {
  try {
    const resp = await fetch(`${baseUrl(cfg.mode)}/verification/v1/bank-account`, {
      method: "POST",
      headers: authHeaders(cfg),
      body: JSON.stringify({ account_number: accountNumber, ifsc }),
      signal: AbortSignal.timeout(10_000),
    });
    const raw = await resp.json().catch(() => ({})) as Record<string, any>;
    const status: VerifyResult["status"] = resp.ok && ((raw as any)?.status === "VALID" || (raw as any)?.account_exists === true) ? "VERIFIED" : "FAILED";
    await logVerification(merchantId, sessionId, "BANK", status, (raw as any)?.request_id, raw, null);
    return { status, requestId: (raw as any)?.request_id, rawResponse: raw };
  } catch (err: any) {
    await logVerification(merchantId, sessionId, "BANK", "FAILED", null, null, err?.message);
    return { status: "FAILED", error: "Bank account verification request failed" };
  }
}

async function logVerification(
  merchantId: number,
  sessionId: number | null,
  type: string,
  status: string,
  requestId: string | null | undefined,
  rawResponse: unknown,
  errorMsg: string | null | undefined,
) {
  try {
    const rawJson = rawResponse ? JSON.stringify(rawResponse).slice(0, 4000) : null;
    let rawEnc: { encrypted: string; iv: string; tag: string } | null = null;
    let errEnc: { encrypted: string; iv: string; tag: string } | null = null;
    if (rawJson) rawEnc = encryptValue(rawJson);
    if (errorMsg) errEnc = encryptValue(errorMsg.slice(0, 500));
    await db.insert(verificationLogsTable).values({
      merchantId,
      onboardingSessionId: sessionId,
      verificationType: type,
      status,
      requestId: requestId ?? null,
      rawResponseEncrypted: rawEnc?.encrypted ?? null,
      rawResponseIv: rawEnc?.iv ?? null,
      rawResponseTag: rawEnc?.tag ?? null,
      errorEncrypted: errEnc?.encrypted ?? null,
      errorIv: errEnc?.iv ?? null,
      errorTag: errEnc?.tag ?? null,
    });
  } catch (err: unknown) {
    logger.warn({ err }, "verification_log_insert_error");
  }
}
