import { test } from "node:test";
import assert from "node:assert/strict";
import { canUseTenantFinance } from "./whiteLabelFinanceAccess";
import { canAccessTenantMerchant } from "./whiteLabelAccess";

test("finance write requires a privileged role AND exact tenant merchant ownership", () => {
  const memberships = [
    { userId: 7, tenantId: 21, role: "finance" as const, status: "active" as const },
    { userId: 8, tenantId: 22, role: "owner" as const, status: "active" as const },
  ];
  const assignments = [{ merchantId: 90, tenantId: 21 }, { merchantId: 91, tenantId: 22 }];
  const eligible = (userId: number, tenantId: number, merchantId: number, role: "finance" | "owner" | "support") =>
    canUseTenantFinance(role, "write") &&
    canAccessTenantMerchant(userId, tenantId, merchantId, memberships, assignments);
  assert.equal(eligible(7, 21, 90, "finance"), true);
  assert.equal(eligible(7, 21, 91, "finance"), false);
  assert.equal(eligible(8, 22, 90, "owner"), false);
  assert.equal(eligible(7, 21, 90, "support"), false);
});
