import { test } from "node:test";
import assert from "node:assert/strict";
import { canAccessTenant, canAccessTenantMerchant } from "./whiteLabelAccess";
const memberships = [
  { userId: 1, tenantId: 10, role: "admin" as const, status: "active" as const },
  { userId: 2, tenantId: 20, role: "owner" as const, status: "active" as const },
  { userId: 3, tenantId: 10, role: "auditor" as const, status: "suspended" as const },
];
const assignments = [{ merchantId: 101, tenantId: 10 }, { merchantId: 202, tenantId: 20 }];
test("membership grants only exact tenant", () => {
  assert.equal(canAccessTenant(1, 10, memberships), true);
  assert.equal(canAccessTenant(1, 20, memberships), false);
  assert.equal(canAccessTenant(3, 10, memberships), false);
});
test("merchant access requires membership and verified tenant assignment", () => {
  assert.equal(canAccessTenantMerchant(1, 10, 101, memberships, assignments), true);
  assert.equal(canAccessTenantMerchant(1, 10, 202, memberships, assignments), false);
  assert.equal(canAccessTenantMerchant(2, 20, 101, memberships, assignments), false);
  assert.equal(canAccessTenantMerchant(1, 10, 999, memberships, assignments), false);
});
test("bad or conflicting IDs fail closed", () => {
  assert.equal(canAccessTenant(0, 10, memberships), false);
  assert.equal(canAccessTenantMerchant(1, 10, 101, memberships, [...assignments, {merchantId: 101, tenantId: 20}]), false);
});
