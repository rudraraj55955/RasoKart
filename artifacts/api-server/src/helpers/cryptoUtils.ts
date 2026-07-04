/**
 * AES-256-GCM encryption helpers for sensitive config values (e.g. provider secrets).
 *
 * Stored format:  enc:v1:<ivHex>:<authTagHex>:<ciphertextHex>
 *
 * The encryption key is derived from SESSION_SECRET via SHA-256, so no
 * extra environment variable is needed. If SESSION_SECRET changes, any
 * previously-encrypted values will fail to decrypt (return ok:false).
 *
 * SESSION_SECRET is required — there is no hardcoded fallback key, since a
 * known default would make any stored provider secret trivially decryptable.
 *
 * Plain-text values (stored before encryption was introduced) are detected
 * automatically: if the stored string does NOT start with "enc:v1:", it is
 * returned as-is so old credentials continue to work until re-saved.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const ALGO = "aes-256-gcm";
const PREFIX = "enc:v1:";

function getKey(): Buffer {
  const secret = process.env["SESSION_SECRET"];
  if (!secret) {
    throw new Error("SESSION_SECRET must be set to encrypt/decrypt stored provider secrets");
  }
  return createHash("sha256").update(secret).digest();
}

/**
 * Encrypt a plain-text secret. Returns a `enc:v1:…` string.
 */
export function encryptSecret(plain: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("hex")}:${tag.toString("hex")}:${ciphertext.toString("hex")}`;
}

export type DecryptResult =
  | { ok: true; value: string }
  | { ok: false; reason: "decrypt_failed"; detail: string };

/**
 * Decrypt a value stored by `encryptSecret`.
 *
 * - If the value does NOT start with `enc:v1:` → treat as plain text (backward compat).
 * - If it starts with `enc:v1:` but fails → `{ ok: false, reason: "decrypt_failed" }`.
 */
export function decryptSecret(stored: string): DecryptResult {
  if (!stored) return { ok: true, value: "" };

  if (!stored.startsWith(PREFIX)) {
    return { ok: true, value: stored };
  }

  try {
    const body = stored.slice(PREFIX.length);
    const parts = body.split(":");
    if (parts.length !== 3) throw new Error("invalid format");
    const [ivHex, tagHex, ciphertextHex] = parts as [string, string, string];
    const key = getKey();
    const iv = Buffer.from(ivHex, "hex");
    const tag = Buffer.from(tagHex, "hex");
    const ciphertext = Buffer.from(ciphertextHex, "hex");
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return { ok: true, value: plain.toString("utf8") };
  } catch (err: any) {
    return { ok: false, reason: "decrypt_failed", detail: err?.message ?? "unknown" };
  }
}
