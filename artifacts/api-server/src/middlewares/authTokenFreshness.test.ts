import assert from "node:assert/strict";
import { test } from "node:test";
import { isTokenInvalidatedByPasswordUpdate } from "./authTokenFreshness";

test("accepts a freshly issued token in the same second as a password reset", () => {
  const issuedAt = 1_800_000_000;
  const passwordUpdatedAt = new Date(issuedAt * 1000 + 900);

  assert.equal(
    isTokenInvalidatedByPasswordUpdate(issuedAt, passwordUpdatedAt),
    false,
  );
});

test("rejects tokens issued before the password-update second", () => {
  const issuedAt = 1_800_000_000;
  const passwordUpdatedAt = new Date((issuedAt + 1) * 1000 + 1);

  assert.equal(
    isTokenInvalidatedByPasswordUpdate(issuedAt, passwordUpdatedAt),
    true,
  );
});

test("accepts tokens issued after the password-update second", () => {
  const issuedAt = 1_800_000_002;
  const passwordUpdatedAt = new Date(1_800_000_001 * 1000 + 900);

  assert.equal(
    isTokenInvalidatedByPasswordUpdate(issuedAt, passwordUpdatedAt),
    false,
  );
});

test("does not invalidate a token when either timestamp is unavailable", () => {
  assert.equal(isTokenInvalidatedByPasswordUpdate(undefined, new Date()), false);
  assert.equal(isTokenInvalidatedByPasswordUpdate(1_800_000_000, null), false);
});
