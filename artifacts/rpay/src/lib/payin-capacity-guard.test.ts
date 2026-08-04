/**
 * Unit tests for the client-side daily capacity guard used in handleCashfreePay.
 *
 * Three invariants exercised:
 *   1. Amount exactly equal to remaining capacity → allowed.
 *   2. Amount one rupee over remaining capacity → blocked with the correct toast message.
 *   3. Guard skipped (fail-open) when dailyLimit or dailyLimitUsed is absent / null.
 *
 * Run:
 *   cd artifacts/rpay && node --import tsx/esm --test src/lib/payin-capacity-guard.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkDailyCapacity } from "./payin-capacity-guard.ts";

// ─────────────────────────────────────────────────────────────────────────────
// 1. Threshold boundary — exact fit must be allowed
// ─────────────────────────────────────────────────────────────────────────────
describe("checkDailyCapacity — amount equals remaining", () => {
  it("allows submission when depositAmt === remaining (dailyLimit − dailyLimitUsed)", () => {
    const result = checkDailyCapacity(500, { dailyLimit: 10_000, dailyLimitUsed: 9_500 });
    assert.equal(result.blocked, false);
  });

  it("allows submission when dailyLimitUsed is 0 and amount equals dailyLimit", () => {
    const result = checkDailyCapacity(10_000, { dailyLimit: 10_000, dailyLimitUsed: 0 });
    assert.equal(result.blocked, false);
  });

  it("allows submission when remaining capacity is very small and amount matches it exactly", () => {
    const result = checkDailyCapacity(1, { dailyLimit: 5_000, dailyLimitUsed: 4_999 });
    assert.equal(result.blocked, false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. One rupee over — must be blocked with the correct message
// ─────────────────────────────────────────────────────────────────────────────
describe("checkDailyCapacity — amount one rupee over remaining", () => {
  it("blocks when depositAmt is exactly 1 rupee more than remaining", () => {
    const result = checkDailyCapacity(501, { dailyLimit: 10_000, dailyLimitUsed: 9_500 });
    assert.equal(result.blocked, true);
  });

  it("returns the correct toast message mentioning the remaining capacity", () => {
    const status = { dailyLimit: 10_000, dailyLimitUsed: 9_500 };
    const result = checkDailyCapacity(501, status);
    assert.equal(result.blocked, true);
    if (result.blocked) {
      // remaining = 10_000 − 9_500 = 500
      assert.ok(
        result.message.includes("500"),
        `Expected message to mention remaining ₹500, got: "${result.message}"`,
      );
      assert.ok(
        result.message.toLowerCase().includes("daily"),
        `Expected message to mention "daily", got: "${result.message}"`,
      );
      assert.ok(
        result.message.toLowerCase().includes("capacity"),
        `Expected message to mention "capacity", got: "${result.message}"`,
      );
    }
  });

  it("blocks when the remaining capacity is 0 and any positive amount is entered", () => {
    const result = checkDailyCapacity(1, { dailyLimit: 10_000, dailyLimitUsed: 10_000 });
    assert.equal(result.blocked, true);
  });

  it("blocks when deposit amount far exceeds the daily limit", () => {
    const result = checkDailyCapacity(50_000, { dailyLimit: 10_000, dailyLimitUsed: 0 });
    assert.equal(result.blocked, true);
    if (result.blocked) {
      assert.ok(result.message.includes("10,000") || result.message.includes("10000"));
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Fail-open — guard is skipped when fields are absent / null / undefined
// ─────────────────────────────────────────────────────────────────────────────
describe("checkDailyCapacity — fields absent → guard skipped", () => {
  it("skips the guard when status is null", () => {
    const result = checkDailyCapacity(99_999, null);
    assert.equal(result.blocked, false);
  });

  it("skips the guard when status is undefined", () => {
    const result = checkDailyCapacity(99_999, undefined);
    assert.equal(result.blocked, false);
  });

  it("skips the guard when dailyLimit is null", () => {
    const result = checkDailyCapacity(99_999, { dailyLimit: null, dailyLimitUsed: 0 });
    assert.equal(result.blocked, false);
  });

  it("skips the guard when dailyLimitUsed is null", () => {
    const result = checkDailyCapacity(99_999, { dailyLimit: 10_000, dailyLimitUsed: null });
    assert.equal(result.blocked, false);
  });

  it("skips the guard when dailyLimit is absent from the status object", () => {
    const result = checkDailyCapacity(99_999, { dailyLimitUsed: 0 });
    assert.equal(result.blocked, false);
  });

  it("skips the guard when dailyLimitUsed is absent from the status object", () => {
    const result = checkDailyCapacity(99_999, { dailyLimit: 10_000 });
    assert.equal(result.blocked, false);
  });

  it("skips the guard when the status object is empty", () => {
    const result = checkDailyCapacity(99_999, {});
    assert.equal(result.blocked, false);
  });
});
