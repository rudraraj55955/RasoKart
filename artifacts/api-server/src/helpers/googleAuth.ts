/**
 * Google Identity Services — backend token verification.
 *
 * Uses google-auth-library (already a dependency) to verify Google ID tokens.
 * Never trusts any payload from the frontend beyond the raw ID token string.
 *
 * Required env var:
 *   GOOGLE_CLIENT_ID  — OAuth 2.0 Client ID from Google Cloud Console
 */

import { OAuth2Client } from "google-auth-library";
import { logger } from "../lib/logger";

export interface GoogleTokenPayload {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  picture?: string;
}

let _client: OAuth2Client | null = null;

function getClient(): OAuth2Client | null {
  const clientId = process.env["GOOGLE_CLIENT_ID"];
  if (!clientId) return null;
  if (!_client) _client = new OAuth2Client(clientId);
  return _client;
}

export function isGoogleConfigured(): boolean {
  return !!process.env["GOOGLE_CLIENT_ID"];
}

export function getGoogleClientId(): string | null {
  return process.env["GOOGLE_CLIENT_ID"] ?? null;
}

/**
 * Verify a Google ID token (credential from google.accounts.id.initialize).
 * Returns the verified payload or null on any failure.
 */
export async function verifyGoogleIdToken(
  idToken: string,
): Promise<GoogleTokenPayload | null> {
  const client = getClient();
  if (!client) {
    logger.warn("google_client_id_not_configured");
    return null;
  }

  try {
    const ticket = await client.verifyIdToken({
      idToken,
      audience: process.env["GOOGLE_CLIENT_ID"]!,
    });
    const p = ticket.getPayload();
    if (!p) return null;

    if (!p.email || !p.email_verified) {
      logger.warn({ sub: p.sub }, "google_token_email_unverified");
      return null;
    }

    return {
      sub: p.sub!,
      email: p.email.toLowerCase().trim(),
      email_verified: Boolean(p.email_verified),
      name: p.name,
      picture: p.picture,
    };
  } catch (err: unknown) {
    logger.warn({ err }, "google_id_token_verify_failed");
    return null;
  }
}
