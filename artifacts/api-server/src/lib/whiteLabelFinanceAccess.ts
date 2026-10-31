/** Tenant financial capabilities. Platform Super Admin requires an explicit
 * audited global flow; tenant credentials must never imply platform privileges.
 */
export type TenantFinanceRole = "owner" | "admin" | "finance" | "support" | "auditor";
export type TenantFinanceAction = "read" | "write";
export function canUseTenantFinance(role: TenantFinanceRole, action: TenantFinanceAction): boolean {
  if (action === "read") return ["owner", "admin", "finance", "auditor"].includes(role);
  return ["owner", "finance"].includes(role);
}
