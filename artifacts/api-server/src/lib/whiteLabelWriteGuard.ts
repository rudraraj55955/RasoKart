import type { Request, Response, NextFunction } from "express";
import { requireWhiteLabelFinanceAccess } from "./whiteLabelFinanceGuard";
import { verifyWhiteLabelMerchantOwnership } from "./whiteLabelTenantGuard";

/** Apply only on NEW tenant-scoped finance write routes, after auth/tenant middleware.
 * Never apply this middleware to legacy global payment routes without a migration plan.
 */
export function requireWhiteLabelMerchantWriteAccess(req: Request, res: Response, next: NextFunction): void {
  const tenantId = res.locals.whiteLabelTenantId;
  const merchantId = Number(req.params.merchantId);
  if (!Number.isSafeInteger(tenantId) || tenantId <= 0 ||
      !Number.isSafeInteger(merchantId) || merchantId <= 0) {
    res.status(403).json({ error: "Merchant write access denied" });
    return;
  }
  void verifyWhiteLabelMerchantOwnership(tenantId, merchantId).then(allowed => {
    if (!allowed) {
      res.status(403).json({ error: "Merchant write access denied" });
      return;
    }
    next();
  }).catch(err => {
    (req as any).log?.error?.({ err }, "white_label_merchant_write_guard_failed");
    res.status(503).json({ error: "Merchant authorization unavailable" });
  });
}
export const requireWhiteLabelFinanceWriteRole = requireWhiteLabelFinanceAccess("write");
