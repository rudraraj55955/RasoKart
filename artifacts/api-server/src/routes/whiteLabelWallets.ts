import { Router } from "express";
import { db, merchantWalletsTable, merchantsTable, whiteLabelMerchantAssignmentsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requireWhiteLabelTenantAccess } from "../lib/whiteLabelTenantGuard";

const router = Router({ mergeParams: true });
router.use(requireAuth, requireWhiteLabelTenantAccess);

// Read-only, explicitly scoped by active tenant membership and merchant assignment.
// Do not create wallets or mutate ledger balances on a GET request.
router.get("/:merchantId", async (req, res) => {
  const tenantId = res.locals.whiteLabelTenantId as number;
  const merchantId = Number(req.params.merchantId);
  if (!Number.isSafeInteger(merchantId) || merchantId < 1) {
    res.status(400).json({ error: "Invalid merchant id" }); return;
  }
  try {
    const [result] = await db.select({
      merchantId: merchantsTable.id,
      businessName: merchantsTable.businessName,
      availableBalance: merchantWalletsTable.availableBalance,
      pendingBalance: merchantWalletsTable.pendingBalance,
      holdBalance: merchantWalletsTable.holdBalance,
    })
      .from(whiteLabelMerchantAssignmentsTable)
      .innerJoin(merchantsTable, eq(whiteLabelMerchantAssignmentsTable.merchantId, merchantsTable.id))
      .leftJoin(merchantWalletsTable, eq(merchantWalletsTable.merchantId, merchantsTable.id))
      .where(and(eq(whiteLabelMerchantAssignmentsTable.tenantId, tenantId),
        eq(whiteLabelMerchantAssignmentsTable.merchantId, merchantId)))
      .limit(1);
    if (!result) { res.status(404).json({ error: "Merchant not found in this company" }); return; }
    res.json({ data: result });
  } catch (err) {
    req.log.error({ err }, "white_label_wallet_read_failed");
    res.status(503).json({ error: "Tenant wallet unavailable" });
  }
});
export default router;
