/** Fail-closed ownership checks for staged tenant-aware routes.
 * This is NOT a replacement for checking the database and permissions on every request.
 */
export type TenantMembership = {
  tenantId: number;
  userId: number;
  role: "owner" | "admin" | "finance" | "support" | "auditor";
  status: "active" | "invited" | "suspended";
};
export type MerchantAssignment = { merchantId: number; tenantId: number };

export function canAccessTenant(
  userId: number,
  tenantId: number,
  memberships: readonly TenantMembership[],
): boolean {
  if (!Number.isSafeInteger(userId) || userId <= 0 || !Number.isSafeInteger(tenantId) || tenantId <= 0) return false;
  return memberships.some(m => m.userId === userId && m.tenantId === tenantId && m.status === "active");
}

export function canAccessTenantMerchant(
  userId: number,
  tenantId: number,
  merchantId: number,
  memberships: readonly TenantMembership[],
  assignments: readonly MerchantAssignment[],
): boolean {
  if (!Number.isSafeInteger(merchantId) || merchantId <= 0) return false;
  if (!canAccessTenant(userId, tenantId, memberships)) return false;
  const matches = assignments.filter(a => a.merchantId === merchantId);
  return matches.length === 1 && matches[0]!.tenantId === tenantId;
}
