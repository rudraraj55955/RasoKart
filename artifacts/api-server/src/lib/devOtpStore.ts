/**
 * Dev-only in-memory OTP capture store.
 *
 * When NODE_ENV !== "production", every call to generateOtp() in auth.ts stores
 * the plaintext OTP here (keyed by identifierHash + purpose) so that automated
 * tests can retrieve it without email inbox access.
 *
 * All functions are unconditional no-ops in production — the map is never
 * populated and the GET /api/dev/otp endpoint is never mounted.
 *
 * Security posture:
 *  • The map stores identifierHash (HMAC of email), not the raw email.
 *  • Only the LATEST OTP per identifier+purpose is retained; it is deleted on
 *    first read (consume semantics).
 *  • The companion route (/api/dev/*) applies a second NODE_ENV guard so the
 *    data cannot be read even if this module is somehow imported in production.
 */

const _store = new Map<string, string>();

/** Called right after generateOtp() at every OTP send site. No-op in production. */
export function captureDevOtp(
  identifierHash: string,
  purpose: string,
  otp: string
): void {
  if (process.env["NODE_ENV"] === "production") return;
  _store.set(`${identifierHash}:${purpose}`, otp);
}

/**
 * Returns and deletes the captured OTP (consume-once semantics).
 * Returns null if not captured or if in production.
 */
export function consumeDevOtp(
  identifierHash: string,
  purpose: string
): string | null {
  if (process.env["NODE_ENV"] === "production") return null;
  const key = `${identifierHash}:${purpose}`;
  const otp = _store.get(key) ?? null;
  if (otp !== null) _store.delete(key);
  return otp;
}
