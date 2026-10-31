import { Router } from "express";
import { requireAuth } from "../middlewares/auth";
import { requireWhiteLabelTenantAccess } from "../lib/whiteLabelTenantGuard";
import { requireWhiteLabelFinanceWriteRole, requireWhiteLabelMerchantWriteAccess } from "../lib/whiteLabelWriteGuard";

/**
 * POST is intentionally authorization-only: it does NOT create payouts,
 * adjust balances, or call a provider. Production write operations remain disabled
 * until the idempotency, audit, transaction and release controls are verified.
 */
const router = Router({ mergeParams: true });
router.post("/:merchantId/preflight",
  requireAuth,
  requireWhiteLabelTenantAccess,
  requireWhiteLabelFinanceWriteRole,
  requireWhiteLabelMerchantWriteAccess,
  (req, res) => {
    res.json({
      authorized: true,
      operationEnabled: false,
      merchantId: Number(req.params.merchantId),
      tenantId: res.locals.whiteLabelTenantId,
      message: "Access verified. Financial mutations are not enabled.",
    });
  },
);
export default router;
