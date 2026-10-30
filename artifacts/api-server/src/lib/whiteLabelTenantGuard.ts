import type { Request, Response, NextFunction } from "express";
import { db, whiteLabelMembershipsTable, whiteLabelMerchantAssignmentsTable, whiteLabelTenantsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

/** Authorization for NEW explicitly tenant-scoped endpoints. No global routes are changed. */
export function requireWhiteLabelTenantAccess(req: Request, res: Response, next: NextFunction) {
  void (async () => {
    const user = (req as any).user;
    const tenantId = Number(req.params.tenantId);
    if (!user || !Number.isSafeInteger(tenantId) || tenantId < 1) {
      res.status(403).json({ error: "Tenant access denied" }); return;
    }
    const [tenant] = await db.select({ id: whiteLabelTenantsTable.id, status: whiteLabelTenantsTable.status })
      .from(whiteLabelTenantsTable).where(eq(whiteLabelTenantsTable.id, tenantId)).limit(1);
    if (!tenant || tenant.status !== "active") { res.status(403).json({ error: "Tenant inactive or inaccessible" }); return; }
    if (!user.isSuperAdmin) {
      const [membership] = await db.select({ id: whiteLabelMembershipsTable.id })
        .from(whiteLabelMembershipsTable)
        .where(and(eq(whiteLabelMembershipsTable.tenantId, tenantId),
          eq(whiteLabelMembershipsTable.userId, user.id),
          eq(whiteLabelMembershipsTable.status, "active"))).limit(1);
      if (!membership) { res.status(403).json({ error: "Tenant access denied" }); return; }
    }
    res.locals.whiteLabelTenantId = tenantId;
    next();
  })().catch(err => {
    (req as any).log?.error?.({ err }, "white_label_tenant_guard_failed");
    res.status(503).json({ error: "Tenant authorization unavailable" });
  });
}

export async function verifyWhiteLabelMerchantOwnership(tenantId: number, merchantId: number): Promise<boolean> {
  if (!Number.isSafeInteger(tenantId) || tenantId < 1 || !Number.isSafeInteger(merchantId) || merchantId < 1) return false;
  const [assignment] = await db.select({ merchantId: whiteLabelMerchantAssignmentsTable.merchantId })
    .from(whiteLabelMerchantAssignmentsTable)
    .where(and(eq(whiteLabelMerchantAssignmentsTable.tenantId, tenantId),
      eq(whiteLabelMerchantAssignmentsTable.merchantId, merchantId))).limit(1);
  return Boolean(assignment);
}
