import bcrypt from "bcryptjs";
import crypto from "crypto";

const OTP_LENGTH = 6;
const HMAC_SECRET = process.env["SESSION_SECRET"] || "rasokart-secret-key-change-in-production";

export const OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds

export function generateOtp(): string {
  const n = crypto.randomInt(0, 10 ** OTP_LENGTH);
  return n.toString().padStart(OTP_LENGTH, "0");
}

export async function hashOtp(otp: string): Promise<string> {
  return bcrypt.hash(otp, 10);
}

export async function verifyOtpHash(otp: string, hash: string): Promise<boolean> {
  return bcrypt.compare(otp, hash);
}

export function normalizeIdentifier(identifier: string): string {
  return identifier.trim().toLowerCase();
}

export function isEmailIdentifier(identifier: string): boolean {
  return identifier.includes("@");
}

/** Deterministic (lookup-able) hash for an identifier or IP — never stores the raw value. */
export function hashIdentifier(identifier: string): string {
  return crypto.createHmac("sha256", HMAC_SECRET).update(normalizeIdentifier(identifier)).digest("hex");
}

export function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  return crypto.createHmac("sha256", HMAC_SECRET).update(ip).digest("hex");
}

/** Masks an email or phone number for display after an OTP has been sent. */
export function maskIdentifier(identifier: string): string {
  const trimmed = identifier.trim();
  if (trimmed.includes("@")) {
    const [local = "", domain = ""] = trimmed.split("@");
    if (local.length <= 2) {
      return `${local[0] ?? "*"}*@${domain}`;
    }
    const masked = local[0] + "*".repeat(local.length - 2) + local[local.length - 1];
    return `${masked}@${domain}`;
  }
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length <= 4) return "*".repeat(digits.length);
  return "*".repeat(digits.length - 4) + digits.slice(-4);
}

export function validatePasswordStrength(password: string): string | null {
  if (typeof password !== "string" || password.length < 8) {
    return "Password must be at least 8 characters long.";
  }
  if (!/[0-9]/.test(password)) {
    return "Password must contain at least 1 number.";
  }
  if (!/[a-zA-Z]/.test(password)) {
    return "Password must contain at least 1 letter.";
  }
  return null;
}
