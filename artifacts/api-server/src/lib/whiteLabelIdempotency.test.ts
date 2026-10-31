import { test } from "node:test";
import assert from "node:assert/strict";
import { validFinanceIdempotencyKey, financeOperationScope } from "./whiteLabelIdempotency";
const key = "request_test_123456789";
test("rejects missing or malformed idempotency keys", () => {
  for (const bad of [null, "", "short", "contains spaces and /", "x".repeat(129)]) {
    assert.equal(validFinanceIdempotencyKey(bad), false);
  }
  assert.equal(validFinanceIdempotencyKey(key), true);
});
test("operation scope separates tenants and merchants", () => {
  const a = financeOperationScope(1, 2, "wallet_adjustment", key);
  assert.ok(a);
  assert.notEqual(a, financeOperationScope(2, 2, "wallet_adjustment", key));
  assert.notEqual(a, financeOperationScope(1, 3, "wallet_adjustment", key));
  assert.equal(financeOperationScope(0, 2, "wallet_adjustment", key), null);
});
