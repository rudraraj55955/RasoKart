/**
 * Unit tests for the client-side daily capacity guard used in handleCashfreePay.
 *
 * Four invariants exercised:
 *   1. Amount exactly equal to remaining capacity → allowed.
 *   2. Amount one rupee over remaining capacity → blocked with the correct toast message.
 *   3. Guard skipped (fail-open) when dailyLimit or dailyLimitUsed is absent / null.
 *   4. After a payment completes, the refetched status (dailyLimitUsed += paid amount)
 *      causes the remaining capacity to drop by exactly the paid amount.
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

// ─────────────────────────────────────────────────────────────────────────────
// 4. Post-payment capacity drop — remaining shrinks by exactly the paid amount
//
//    This validates the contract that the deposits page relies on: after a
//    payment is confirmed PAID the /payin/status query is invalidated and the
//    server returns an updated dailyLimitUsed.  The guard (and the capacity
//    warning in the form) must reflect the new, lower remaining headroom.
// ─────────────────────────────────────────────────────────────────────────────
describe("checkDailyCapacity — remaining drops by paid amount after refetch", () => {
  it("remaining decreases by the paid amount when dailyLimitUsed is updated", () => {
    const dailyLimit = 10_000;
    const initialUsed = 3_000;
    const paidAmount = 2_500;

    // Before payment: remaining = 7_000
    const before = checkDailyCapacity(1, { dailyLimit, dailyLimitUsed: initialUsed });
    assert.equal(before.blocked, false);

    // After server refetch: dailyLimitUsed increases by the paid amount
    const updatedUsed = initialUsed + paidAmount;
    const remainingAfter = dailyLimit - updatedUsed;
    assert.equal(remainingAfter, 4_500, "remaining should be 4_500 after a 2_500 payment");

    // A deposit that was within the old headroom but exceeds the new headroom
    // should now be blocked.
    const wouldHavePassed = checkDailyCapacity(6_000, { dailyLimit, dailyLimitUsed: initialUsed });
    assert.equal(wouldHavePassed.blocked, false, "6_000 fits in the original 7_000 headroom");

    const nowBlocked = checkDailyCapacity(6_000, { dailyLimit, dailyLimitUsed: updatedUsed });
    assert.equal(nowBlocked.blocked, true, "6_000 exceeds the updated 4_500 headroom");
    if (nowBlocked.blocked) {
      assert.ok(
        nowBlocked.message.includes("4,500") || nowBlocked.message.includes("4500"),
        `Expected message to mention new remaining ₹4,500, got: "${nowBlocked.message}"`,
      );
    }
  });

  it("a deposit exactly equal to the new remaining is still allowed post-payment", () => {
    const dailyLimit = 5_000;
    const paidAmount = 1_000;
    const updatedUsed = 2_000; // was 1_000 before payment

    // remaining = 5_000 − 2_000 = 3_000
    const result = checkDailyCapacity(3_000, { dailyLimit, dailyLimitUsed: updatedUsed });
    assert.equal(result.blocked, false);
  });

  it("a deposit one rupee over the new remaining is blocked post-payment", () => {
    const dailyLimit = 5_000;
    const updatedUsed = 2_000; // remaining = 3_000

    const result = checkDailyCapacity(3_001, { dailyLimit, dailyLimitUsed: updatedUsed });
    assert.equal(result.blocked, true);
    if (result.blocked) {
      assert.ok(
        result.message.includes("3,000") || result.message.includes("3000"),
        `Expected message to mention ₹3,000, got: "${result.message}"`,
      );
    }
  });

  it("multiple sequential payments accumulate correctly", () => {
    const dailyLimit = 10_000;
    let used = 0;

    const payments = [1_000, 2_500, 500];
    for (const amt of payments) {
      used += amt;
    }
    // Total used = 4_000; remaining = 6_000
    assert.equal(dailyLimit - used, 6_000);

    const result = checkDailyCapacity(6_001, { dailyLimit, dailyLimitUsed: used });
    assert.equal(result.blocked, true, "6_001 exceeds remaining 6_000 after three payments");

    const exactFit = checkDailyCapacity(6_000, { dailyLimit, dailyLimitUsed: used });
    assert.equal(exactFit.blocked, false, "6_000 exactly fits remaining 6_000");
  });
});
