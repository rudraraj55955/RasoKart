/**
 * JWT `iat` is measured in whole seconds while PostgreSQL timestamps retain
 * milliseconds. Compare both at the token's precision so a session issued in
 * the same second as a password reset is not rejected as older.
 *
 * This intentionally permits the bounded one-second tolerance approved for
 * password-reset/login flow; tokens from earlier seconds remain invalidated.
 */
export function isTokenInvalidatedByPasswordUpdate(
  issuedAtSeconds: number | undefined,
  passwordUpdatedAt: Date | null | undefined,
): boolean {
  if (issuedAtSeconds == null || passwordUpdatedAt == null) return false;
  return issuedAtSeconds < Math.floor(passwordUpdatedAt.getTime() / 1000);
}
