#!/usr/bin/env tsx
/**
 * seed-test-otp.ts
 *
 * Test-only helper: inserts a row into merchant_auth_otps with a known bcrypt
 * hash so Playwright tests can verify full OTP / Forgot Password flows without
 * a real email or SMS provider configured.
 *
 * The verify and password-reset endpoints always look up the LATEST row for an
 * identifier+purpose (ORDER BY created_at DESC LIMIT 1), so inserting a new
 * row here becomes the authoritative row the endpoint will check against.
 *
 * Usage:
 *   tsx src/seed-test-otp.ts <identifier> <plainOtp> <purpose> [--backdate[=<seconds>]]
 *
 *   identifier          Email or mobile number (same string passed to the API)
 *   plainOtp            Plain-text 6-digit code the test will enter in the UI/API
 *   purpose             LOGIN | PASSWORD_RESET
 *   --backdate          Backdates created_at by 120 s (default when no value given)
 *                       so the 60-second resend cooldown has already elapsed.
 *   --backdate=<secs>   Backdates created_at by <secs> seconds.  When secs > 600
 *                       the resulting expiresAt (= createdAt + 10 min) falls in
 *                       the past, producing a genuinely expired OTP row.
 *
 * Requires:
 *   DATABASE_URL   — Postgres connection string
 *   SESSION_SECRET — HMAC key (must match the running API server; falls back
 *                    to the same default the server uses if unset)
 */

import bcrypt from "bcryptjs";
import crypto from "crypto";
import { db, merchantAuthOtpsTable } from "@workspace/db";

const OTP_EXPIRY_MS = 10 * 60 * 1_000; // 10 minutes (matches server)
const HMAC_SECRET =
  process.env["SESSION_SECRET"] ?? "rasokart-secret-key-change-in-production";

function hashIdentifier(identifier: string): string {
  return crypto
    .createHmac("sha256", HMAC_SECRET)
    .update(identifier.trim().toLowerCase())
    .digest("hex");
}

const [, , identifier, plainOtp, purpose = "LOGIN", ...flags] = process.argv;

if (!identifier || !plainOtp) {
  process.stderr.write(
    "Usage: tsx src/seed-test-otp.ts <identifier> <plainOtp> <purpose> [--backdate[=<seconds>]]\n",
  );
  process.exit(1);
}

if (purpose !== "LOGIN" && purpose !== "PASSWORD_RESET") {
  process.stderr.write(
    `Unknown purpose "${purpose}". Expected LOGIN or PASSWORD_RESET.\n`,
  );
  process.exit(1);
}

// Parse --backdate or --backdate=<seconds>
// --backdate alone defaults to 120 s (past the 60-second resend cooldown).
// --backdate=700 (>600 s) makes expiresAt fall in the past → expired OTP.
let backdateSeconds = 0;
for (const flag of flags) {
  if (flag === "--backdate") {
    backdateSeconds = 120;
  } else if (flag.startsWith("--backdate=")) {
    const raw = flag.slice("--backdate=".length);
    const parsed = parseInt(raw, 10);
    if (isNaN(parsed) || parsed <= 0) {
      process.stderr.write(`Invalid --backdate value: "${raw}". Must be a positive integer.\n`);
      process.exit(1);
    }
    backdateSeconds = parsed;
  }
}

const identifierHash = hashIdentifier(identifier);
const otpHash = await bcrypt.hash(plainOtp, 10);

const now = new Date();
const createdAt = backdateSeconds > 0 ? new Date(now.getTime() - backdateSeconds * 1_000) : now;
// expiresAt is relative to createdAt so that a large enough backdate produces
// a genuinely expired row (expiresAt < now when backdateSeconds > 600).
const expiresAt = new Date(createdAt.getTime() + OTP_EXPIRY_MS);

await db.insert(merchantAuthOtpsTable).values({
  merchantId: null,
  identifierHash,
  otpHash,
  purpose: purpose as "LOGIN" | "PASSWORD_RESET",
  expiresAt,
  attempts: 0,
  resendCount: 0,
  ipHash: null,
  createdAt,
});

const backdateNote = backdateSeconds > 0 ? ` (backdated ${backdateSeconds}s, expiresAt=${expiresAt.toISOString()})` : "";
console.log(
  `[seed-test-otp] Inserted ${purpose} OTP for ${identifier}${backdateNote}`,
);
