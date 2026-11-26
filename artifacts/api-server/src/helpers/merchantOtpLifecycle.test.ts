import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MERCHANT_LOGIN_MAX_RESENDS,
  MERCHANT_LOGIN_OTP_EXPIRY_MS,
  MERCHANT_LOGIN_RESEND_LOCK_MS,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_MS,
} from "./otp";

const here = dirname(fileURLToPath(import.meta.url));
const authSourcePath = resolve(here, "../routes/auth.ts");
const schemaSourcePath = resolve(here, "../../../../lib/db/src/schema/merchantAuthOtps.ts");
const loginSourcePath = resolve(here, "../../../../artifacts/rpay/src/pages/payout-merchant/login.tsx");

describe("merchant login OTP policy", async () => {
  const [authSource, schemaSource, loginSource] = await Promise.all([
    readFile(authSourcePath, "utf8"),
    readFile(schemaSourcePath, "utf8"),
    readFile(loginSourcePath, "utf8"),
  ]);

  it("keeps the exact payout portal limits", () => {
    assert.equal(MERCHANT_LOGIN_OTP_EXPIRY_MS, 5 * 60 * 1000);
    assert.equal(OTP_MAX_ATTEMPTS, 5);
    assert.equal(OTP_RESEND_COOLDOWN_MS, 60 * 1000);
    assert.equal(MERCHANT_LOGIN_MAX_RESENDS, 3);
    assert.equal(MERCHANT_LOGIN_RESEND_LOCK_MS, 15 * 60 * 1000);
  });

  it("stores verification attempts and resend count independently", () => {
    assert.match(schemaSource, /attempts: integer\("attempts"\)/);
    assert.match(schemaSource, /resendCount: integer\("resend_count"\)/);
    assert.match(authSource, /set\(\{ attempts: sql`\$\{merchantAuthOtpsTable\.attempts\} \+ 1` \}\)/);
    assert.match(authSource, /const resendCount = mode === "resend"/);
  });

  it("uses a transaction lock, invalidates previous codes, and commits only after delivery", () => {
    assert.match(authSource, /pg_advisory_xact_lock/);
    assert.match(authSource, /set\(\{ consumedAt: new Date\(\) \}\)/);
    assert.match(authSource, /throw new OtpDeliveryError\(\)/);
    assert.match(authSource, /captureDevOtp\(identifierHash, "LOGIN", otp\)/);
  });

  it("does not put plaintext OTPs into logs or email failure responses", () => {
    assert.doesNotMatch(authSource, /req\.log\.(?:info|warn)\(\{[^}]*\botp\s*:/is);
    assert.doesNotMatch(authSource, /OTP_DELIVERY_FAILURE_MESSAGE.*otp/i);
  });

  it("serializes the payout login UI and cancels on identifier changes", () => {
    assert.match(loginSource, /sendInFlightRef/);
    assert.match(loginSource, /auth\/merchant\/otp\/cancel/);
    assert.match(loginSource, /if \(!r\.ok\)/);
    assert.match(loginSource, /disabled=\{requestOtp\.isPending\}/);
  });
});