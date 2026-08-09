/**
 * Unit tests — EKQR API key encryption / decryption round-trip.
 *
 * Why this file exists:
 *   The EKQR API key is encrypted with AES-256-GCM before storage
 *   (PUT /api/system-config/ekqr → encryptSecret) and decrypted at every read
 *   site (QR creation, webhook handler, sync scheduler). A regression in the
 *   encrypt-on-save / decrypt-on-read cycle would silently block all QR
 *   payments with no obvious error. These tests catch that before it hits
 *   production.
 *
 * Coverage:
 *   1. encryptSecret never stores the plain-text key — stored value must start
 *      with "enc:v1:" so the intent is unambiguous in the DB.
 *   2. decryptSecret(encryptSecret(plain)) recovers the original key exactly.
 *   3. Multiple encrypt calls with the same input produce different ciphertexts
 *      (random IV) but all decrypt back to the same plain value.
 *   4. Backward-compat: a raw (pre-encryption) value stored in the DB is
 *      returned as-is with ok:true — old keys keep working until re-saved.
 *   5. Empty string stored in the DB is returned as empty string (ok:true).
 *   6. A tampered/corrupted enc:v1: blob returns ok:false (decrypt_failed),
 *      not a thrown exception — callers that check .ok safely fall back.
 *   7. The consume-pattern used in qrCodes.ts, ekqrSyncScheduler.ts, and
 *      paymentWebhook.ts: `stored ? decryptSecret(stored) : {ok:true, value:""}`
 *      yields the correct plain-text key for all three DB value shapes
 *      (encrypted, plain-text legacy, empty/missing).
 *   8. SESSION_SECRET change: a value encrypted under one secret fails to
 *      decrypt under a different secret (ok:false), not a crash.
 *
 * Run:
 *   cd artifacts/api-server && node --import tsx/esm --test \
 *     src/helpers/cryptoUtils.ekqr.test.ts
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

// We import the functions under test after setting SESSION_SECRET so getKey()
// can derive a deterministic key. The env var is restored after the suite.
const ORIGINAL_SESSION_SECRET = process.env["SESSION_SECRET"];
const TEST_SECRET = "test-session-secret-for-ekqr-crypto-unit-tests";
process.env["SESSION_SECRET"] = TEST_SECRET;

// Dynamic import after env is set — avoids the module being evaluated before
// SESSION_SECRET exists. (tsx/ESM evaluates top-level imports synchronously.)
import { encryptSecret, decryptSecret } from "./cryptoUtils";

// ── Restore env after the suite ──────────────────────────────────────────────
after(() => {
  if (ORIGINAL_SESSION_SECRET === undefined) {
    delete process.env["SESSION_SECRET"];
  } else {
    process.env["SESSION_SECRET"] = ORIGINAL_SESSION_SECRET;
  }
});

// ── Helper: the exact consume-pattern used in production code ────────────────
// Mirrors the snippet in qrCodes.ts and ekqrSyncScheduler.ts:
//   const apiKeyResult = storedKey ? decryptSecret(storedKey) : { ok: true, value: "" };
//   const ekqrApiKey = apiKeyResult.ok ? apiKeyResult.value : "";
function resolveApiKey(storedKey: string | undefined | null): string {
  const result = storedKey ? decryptSecret(storedKey) : { ok: true as const, value: "" };
  return result.ok ? result.value : "";
}

// ── Test suite ───────────────────────────────────────────────────────────────

describe("encryptSecret — storage format", () => {
  it("encrypted value starts with enc:v1: prefix", () => {
    const encrypted = encryptSecret("my-ekqr-api-key");
    assert.ok(
      encrypted.startsWith("enc:v1:"),
      `Expected enc:v1: prefix, got: ${encrypted.slice(0, 20)}`,
    );
  });

  it("encrypted value is NOT equal to the plain-text key", () => {
    const plain = "super-secret-ekqr-key-12345";
    const encrypted = encryptSecret(plain);
    assert.notEqual(encrypted, plain, "Stored blob must not be the plain key");
  });

  it("encrypted format has exactly 4 colon-separated segments (enc:v1:iv:tag:ciphertext)", () => {
    const encrypted = encryptSecret("test-key");
    // Expected: "enc:v1:<ivHex>:<tagHex>:<ciphertextHex>" → 5 parts when split on ":"
    // (enc)(v1)(ivHex)(tagHex)(ciphertextHex)
    const parts = encrypted.split(":");
    assert.equal(parts.length, 5, `Expected 5 colon-separated parts, got ${parts.length}: ${encrypted}`);
    assert.equal(parts[0], "enc");
    assert.equal(parts[1], "v1");
    // iv, tag, ciphertext must be non-empty hex strings
    assert.ok(parts[2]!.length > 0, "IV hex must be non-empty");
    assert.ok(parts[3]!.length > 0, "Auth-tag hex must be non-empty");
    assert.ok(parts[4]!.length > 0, "Ciphertext hex must be non-empty");
  });

  it("two encrypt calls on the same input produce different ciphertexts (random IV)", () => {
    const plain = "same-key-different-iv";
    const a = encryptSecret(plain);
    const b = encryptSecret(plain);
    assert.notEqual(a, b, "Random IV must produce distinct blobs on each encrypt call");
  });
});

describe("decryptSecret — round-trip", () => {
  it("decryptSecret(encryptSecret(plain)) recovers the original key exactly", () => {
    const plain = "ekqr-live-key-abc123";
    const encrypted = encryptSecret(plain);
    const result = decryptSecret(encrypted);
    assert.ok(result.ok, `Expected ok:true, got: ${JSON.stringify(result)}`);
    assert.equal(result.value, plain);
  });

  it("round-trip works for a key with special characters and numbers", () => {
    const plain = "EKQRKey_2026!@#$%^&*()";
    const encrypted = encryptSecret(plain);
    const result = decryptSecret(encrypted);
    assert.ok(result.ok);
    assert.equal(result.value, plain);
  });

  it("multiple independent encrypt-decrypt round-trips all succeed", () => {
    const keys = [
      "short",
      "a".repeat(64),
      "unicode-\u00e9\u00e0\u00fc",
      "1234567890abcdef",
    ];
    for (const plain of keys) {
      const encrypted = encryptSecret(plain);
      const result = decryptSecret(encrypted);
      assert.ok(result.ok, `Round-trip failed for key "${plain}": ${JSON.stringify(result)}`);
      assert.equal(result.value, plain);
    }
  });
});

describe("decryptSecret — backward-compat (plain-text legacy values)", () => {
  it("plain-text value (no enc:v1: prefix) is returned as-is with ok:true", () => {
    const legacy = "plaintext-ekqr-key-stored-before-encryption";
    const result = decryptSecret(legacy);
    assert.ok(result.ok);
    assert.equal(result.value, legacy);
  });

  it("empty string returns ok:true with empty value", () => {
    const result = decryptSecret("");
    assert.ok(result.ok);
    assert.equal(result.value, "");
  });

  it("a key that happens to look like a path but has no enc:v1: prefix is returned raw", () => {
    const plain = "enc:NOT_v1:some_old_format";
    const result = decryptSecret(plain);
    assert.ok(result.ok);
    assert.equal(result.value, plain);
  });
});

describe("decryptSecret — tampered / corrupted enc:v1: blobs", () => {
  it("a truncated enc:v1: blob returns ok:false, not a thrown exception", () => {
    const result = decryptSecret("enc:v1:truncated");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "decrypt_failed");
  });

  it("enc:v1: blob with bad hex returns ok:false", () => {
    const result = decryptSecret("enc:v1:ZZZZZZ:YYYYYY:XXXXXX");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "decrypt_failed");
  });

  it("enc:v1: blob with correct format but wrong auth-tag (tampered ciphertext) returns ok:false", () => {
    // Encrypt a real value, then flip one byte in the ciphertext to simulate
    // tampering — AES-GCM auth-tag check must reject this.
    const encrypted = encryptSecret("original-key");
    const parts = encrypted.split(":");
    // parts = ["enc", "v1", ivHex, tagHex, ciphertextHex]
    const ciphertextHex = parts[4]!;
    // Flip the first byte of the ciphertext
    const firstByte = parseInt(ciphertextHex.slice(0, 2), 16);
    const tamperedByte = ((firstByte + 1) % 256).toString(16).padStart(2, "0");
    const tampered = [parts[0], parts[1], parts[2], parts[3], tamperedByte + ciphertextHex.slice(2)].join(":");
    const result = decryptSecret(tampered);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "decrypt_failed");
  });
});

describe("decryptSecret — wrong SESSION_SECRET (key rotation breakage)", () => {
  it("value encrypted under one secret fails gracefully under a different secret", () => {
    // Encrypt with current test secret
    const encrypted = encryptSecret("key-encrypted-under-old-secret");

    // Temporarily swap to a different secret
    process.env["SESSION_SECRET"] = "completely-different-secret-simulating-rotation";
    try {
      const result = decryptSecret(encrypted);
      // Must not throw — result must be ok:false, not a crash
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.reason, "decrypt_failed");
    } finally {
      // Always restore the test secret so later tests work
      process.env["SESSION_SECRET"] = TEST_SECRET;
    }
  });
});

describe("production consume-pattern (qrCodes.ts / ekqrSyncScheduler.ts / paymentWebhook.ts)", () => {
  it("encrypted API key stored in DB resolves to the original plain-text key", () => {
    const plain = "live-ekqr-api-key-from-admin";
    // Simulate what PUT /api/system-config/ekqr stores:
    const storedInDb = encryptSecret(plain);

    // Simulate what qrCodes.ts / ekqrSyncScheduler.ts read and resolve:
    const resolved = resolveApiKey(storedInDb);
    assert.equal(resolved, plain);
  });

  it("legacy plain-text API key stored in DB resolves to its value unchanged", () => {
    const legacy = "legacy-ekqr-key-no-encryption";
    const resolved = resolveApiKey(legacy);
    assert.equal(resolved, legacy);
  });

  it("empty stored key (key never set) resolves to empty string", () => {
    assert.equal(resolveApiKey(""), "");
    assert.equal(resolveApiKey(null), "");
    assert.equal(resolveApiKey(undefined), "");
  });

  it("corrupted enc:v1: blob stored in DB resolves to empty string (not a crash)", () => {
    // A partial encrypt or bit-flip in the DB — must degrade gracefully so the
    // caller sees "no API key" and skips EKQR rather than crashing the server.
    const resolved = resolveApiKey("enc:v1:badhex:badhex:badhex");
    assert.equal(resolved, "");
  });

  it("the apiKey guard (if !ekqrApiKey) correctly blocks when decryption fails", () => {
    // This mirrors the guard in qrCodes.ts:
    //   if (ekqrEnabled && ekqrApiKey) { ... use EKQR ... }
    // A failed decrypt must result in an empty apiKey, so the block is skipped.
    const resolved = resolveApiKey("enc:v1:dead:beef:cafe");
    assert.equal(resolved, "", "Failed decrypt must yield empty string so EKQR path is skipped");
  });
});
