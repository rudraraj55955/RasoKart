import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const routePath = resolve(here, "../../../routes/merchantPortalSessions.ts");
const schemaPath = resolve(here, "../../../../../../lib/db/src/schema/merchantPortalSessions.ts");

describe("Pine Labs portal-session lifecycle policy", async () => {
  const [routeSource, schemaSource] = await Promise.all([
    readFile(routePath, "utf8"),
    readFile(schemaPath, "utf8"),
  ]);

  it("requires credentials and credential-free actions to match the session state", () => {
    assert.match(routeSource, /session\.status === "AWAITING_OTP" && \(!otp \|\| password\)/);
    assert.match(routeSource, /session\.status === "AWAITING_PASSWORD" && \(!password \|\| otp\)/);
    assert.match(routeSource, /isResend && session\.status !== "AWAITING_OTP"/);
    assert.match(routeSource, /isPortalOtpSwitch && session\.status !== "AWAITING_PASSWORD"/);
  });

  it("keeps OTP verification and resend enforcement independent", () => {
    assert.match(routeSource, /otpVerificationFailureCount: sql`[^`]+ \+ 1`/);
    assert.match(routeSource, /otpResendCount: sql`[^`]+ \+ 1`/);
    assert.match(routeSource, /MAX_OTP_ATTEMPTS = 3/);
    assert.match(routeSource, /MAX_OTP_RESENDS = 3/);
    assert.match(routeSource, /OTP_RESEND_COOLDOWN_MS = 60 \* 1000/);
    assert.match(routeSource, /OTP_SESSION_MAX_AGE_MS = 10 \* 60 \* 1000/);
  });

  it("uses a database lease and compare-and-set final write", () => {
    assert.match(schemaSource, /processingLeaseId: text\("processing_lease_id"\)/);
    assert.match(schemaSource, /processingLeaseExpiresAt: timestamp\("processing_lease_expires_at"/);
    assert.match(routeSource, /processingLeaseId: leaseId/);
    assert.match(routeSource, /eq\(merchantPortalSessionsTable\.processingLeaseId, leaseId\)/);
    assert.match(routeSource, /if \(!committed\)/);
  });

  it("releases the lease and restores lifecycle counters after browser infrastructure failure", () => {
    assert.match(routeSource, /err instanceof BrowserRuntimeUnavailableError/);
    assert.match(routeSource, /reservedLifecycle\.otpVerificationFailureCount/);
    assert.match(routeSource, /reservedLifecycle\.otpResendCount/);
    assert.match(routeSource, /processingLeaseId: null/);
    assert.match(routeSource, /eq\(merchantPortalSessionsTable\.processingLeaseId, reservedLeaseId\)/);
  });

  it("clears the terminal session token and preserves retries below the limit", () => {
    assert.match(routeSource, /encryptedSession: hitMaxAttempts\s*\?\s*null/);
    assert.match(routeSource, /recoverableOtpFailure/);
    assert.match(routeSource, /persistedStatus = hitMaxAttempts/);
  });

  it("never exposes lease internals or changes the dry-run transaction invariant", () => {
    assert.match(routeSource, /processingLeaseId: _leaseId/);
    assert.match(routeSource, /processingLeaseExpiresAt: _leaseExpiry/);
    assert.match(routeSource, /dryRun:\s+true/);
    assert.match(routeSource, /autoCredited:\s+false/);
  });
});