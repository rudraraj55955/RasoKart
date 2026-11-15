import type { Request, Response, NextFunction } from "express";
import { db, whiteLabelMembershipsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { canUseTenantFinance, type TenantFinanceAction, type TenantFinanceRole } from "./whiteLabelFinanceAccess";

/** Must run AFTER requireAuth and requireWhiteLabelTenantAccess. */
export function requireWhiteLabelFinanceAccess(action: TenantFinanceAction) {
  return (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      const user = (req as any).user;
      const tenantId = res.locals.whiteLabelTenantId;
      if (!user || !Number.isSafeInteger(tenantId) || tenantId < 1) {
        res.status(403).json({ error: "Financial access denied" }); return;
      }
      // No automatic global-superadmin bypass for financial resources.
      const [membership] = await db.select({
        role: whiteLabelMembershipsTable.role,
      }).from(whiteLabelMembershipsTable).where(and(
        eq(whiteLabelMembershipsTable.userId, user.id),
        eq(whiteLabelMembershipsTable.tenantId, tenantId),
        eq(whiteLabelMembershipsTable.status, "active"),
      )).limit(1);
      if (!membership || !canUseTenantFinance(membership.role as TenantFinanceRole, action)) {
        res.status(403).json({ error: "Financial access denied" }); return;
      }
      next();
    })().catch(err => {
      (req as any).log?.error?.({ err }, "white_label_finance_guard_failed");
      res.status(503).json({ error: "Financial authorization unavailable" });
    });
  };
}
