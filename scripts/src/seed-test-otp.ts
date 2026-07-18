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
 *   tsx src/seed-test-otp.ts <identifier> <plainOtp> <purpose> [--backdate]
 *
 *   identifier  Email or mobile number (same string passed to the API)
 *   plainOtp    Plain-text 6-digit code the test will enter in the UI/API
 *   purpose     LOGIN | PASSWORD_RESET
 *   --backdate  Sets created_at to now-120s so the 60-second resend cooldown
 *               window has already elapsed (used in the resend-invalidation
 *               test)
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
    "Usage: tsx src/seed-test-otp.ts <identifier> <plainOtp> <purpose> [--backdate]\n",
  );
  process.exit(1);
}

if (purpose !== "LOGIN" && purpose !== "PASSWORD_RESET") {
  process.stderr.write(
    `Unknown purpose "${purpose}". Expected LOGIN or PASSWORD_RESET.\n`,
  );
  process.exit(1);
}

const backdate = flags.includes("--backdate");

const identifierHash = hashIdentifier(identifier);
const otpHash = await bcrypt.hash(plainOtp, 10);

const now = new Date();
const createdAt = backdate ? new Date(now.getTime() - 120_000) : now;
const expiresAt = new Date(now.getTime() + OTP_EXPIRY_MS);

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

console.log(
  `[seed-test-otp] Inserted ${purpose} OTP for ${identifier}${backdate ? " (backdated 120s)" : ""}`,
);
