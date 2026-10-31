import { test } from "node:test";
import assert from "node:assert/strict";
import { canUseTenantFinance } from "./whiteLabelFinanceAccess";

test("support cannot access tenant financial details", () => {
  assert.equal(canUseTenantFinance("support", "read"), false);
  assert.equal(canUseTenantFinance("support", "write"), false);
});
test("auditor is strictly read-only", () => {
  assert.equal(canUseTenantFinance("auditor", "read"), true);
  assert.equal(canUseTenantFinance("auditor", "write"), false);
});
test("write scope is restricted to owner and finance", () => {
  assert.equal(canUseTenantFinance("admin", "write"), false);
  assert.equal(canUseTenantFinance("owner", "write"), true);
  assert.equal(canUseTenantFinance("finance", "write"), true);
});
