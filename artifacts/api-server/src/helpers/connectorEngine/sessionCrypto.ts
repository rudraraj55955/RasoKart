/**
 * Session token encryption for the Connector Engine.
 *
 * Uses AES-256-GCM with the same key material and format as the rest of
 * the platform (cryptoUtils.ts). Session tokens encrypt the adapter's
 * opaque session blob (cookies, bearer tokens, metadata JSON).
 *
 * Wire format (same as platform credentials):
 *   enc:v1:<ivHex>:<authTagHex>:<ciphertextHex>
 *
 * SECURITY:
 *   - Tokens are decrypted exclusively server-side inside adapter methods
 *   - The plaintext is NEVER returned to the frontend or logged
 *   - If decryption fails, the session is treated as expired/invalid
 *   - For additional assurance, rotate SESSION_SECRET periodically;
 *     existing sessions will become invalid (operators reconnect)
 */

import { encryptSecret, decryptSecret } from "../cryptoUtils";

export type SessionEncryptResult =
  | { ok: true; token: string }
  | { ok: false; reason: string };

export type SessionDecryptResult =
  | { ok: true; payload: SessionPayload }
  | { ok: false; reason: string };

/**
 * The decrypted payload stored inside an encrypted session token.
 * Adapter-specific data lives in `adapterData`.
 */
export interface SessionPayload {
  /** Provider slug this session belongs to */
  slug: string;
  /** Platform connection ID */
  connectionId: number;
  /** Adapter-specific opaque data (cookies, bearer token, etc.) */
  adapterData: Record<string, unknown>;
  /** ISO timestamp when this session was created */
  createdAt: string;
  /** ISO timestamp when this session expires (provider-specific) */
  expiresAt?: string;
}

/**
 * Encrypt a session payload into a storable token.
 * Returns { ok: true, token } on success.
 */
export function encryptSessionPayload(payload: SessionPayload): SessionEncryptResult {
  try {
    const json = JSON.stringify(payload);
    const token = encryptSecret(json);
    return { ok: true, token };
  } catch (err: any) {
    return { ok: false, reason: `encrypt_failed: ${err?.message ?? "unknown"}` };
  }
}

/**
 * Decrypt and parse a session token.
 * Returns { ok: false } if the token is malformed, tampered, or uses
 * a rotated key. Callers must treat this as session expiry.
 */
export function decryptSessionToken(token: string): SessionDecryptResult {
  if (!token || !token.startsWith("enc:v1:")) {
    return { ok: false, reason: "invalid_token_format" };
  }
  const result = decryptSecret(token);
  if (!result.ok) {
    return { ok: false, reason: result.reason ?? "decrypt_failed" };
  }
  try {
    const payload = JSON.parse(result.value) as SessionPayload;
    if (!payload.slug || typeof payload.connectionId !== "number") {
      return { ok: false, reason: "invalid_payload_shape" };
    }
    // Check expiry if present
    if (payload.expiresAt && new Date(payload.expiresAt) < new Date()) {
      return { ok: false, reason: "session_expired" };
    }
    return { ok: true, payload };
  } catch {
    return { ok: false, reason: "json_parse_failed" };
  }
}

/**
 * Build a fresh SessionPayload for a new successful session.
 */
export function makeSessionPayload(
  slug: string,
  connectionId: number,
  adapterData: Record<string, unknown>,
  options?: { expiresAt?: Date },
): SessionPayload {
  return {
    slug,
    connectionId,
    adapterData,
    createdAt: new Date().toISOString(),
    expiresAt: options?.expiresAt?.toISOString(),
  };
}
