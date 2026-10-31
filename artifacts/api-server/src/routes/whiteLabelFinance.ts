import { Router } from "express";
import { db, settlementsTable, walletLedgerTable, whiteLabelMerchantAssignmentsTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requireWhiteLabelTenantAccess } from "../lib/whiteLabelTenantGuard";

const router = Router({ mergeParams: true });
router.use(requireAuth, requireWhiteLabelTenantAccess);

function idAndLimit(req: { params: Record<string, any>; query: Record<string, any> }) {
  const merchantId = Number(req.params.merchantId);
  const limit = req.query.limit === undefined ? 50 : Number(req.query.limit);
  return Number.isSafeInteger(merchantId) && merchantId > 0 &&
    Number.isSafeInteger(limit) && limit >= 1 && limit <= 100 ? { merchantId, limit } : null;
}

router.get("/:merchantId/settlements", async (req, res) => {
  const args = idAndLimit(req);
  if (!args) { res.status(400).json({ error: "Invalid merchant id or limit" }); return; }
  try {
    const data = await db.select({
      id: settlementsTable.id, merchantId: settlementsTable.merchantId,
      amount: settlementsTable.amount, currency: settlementsTable.currency,
      status: settlementsTable.status, createdAt: settlementsTable.createdAt,
    }).from(settlementsTable)
      .innerJoin(whiteLabelMerchantAssignmentsTable,
        eq(settlementsTable.merchantId, whiteLabelMerchantAssignmentsTable.merchantId))
      .where(and(eq(whiteLabelMerchantAssignmentsTable.tenantId, res.locals.whiteLabelTenantId as number),
        eq(whiteLabelMerchantAssignmentsTable.merchantId, args.merchantId)))
      .orderBy(desc(settlementsTable.createdAt), desc(settlementsTable.id)).limit(args.limit);
    res.json({ data });
  } catch (err) { req.log.error({ err }, "wl_settlements_failed"); res.status(503).json({ error: "Tenant settlements unavailable" }); }
});

router.get("/:merchantId/ledger", async (req, res) => {
  const args = idAndLimit(req);
  if (!args) { res.status(400).json({ error: "Invalid merchant id or limit" }); return; }
  try {
    const data = await db.select({
      id: walletLedgerTable.id, merchantId: walletLedgerTable.merchantId,
      txnType: walletLedgerTable.txnType, bucket: walletLedgerTable.bucket,
      amount: walletLedgerTable.amount, createdAt: walletLedgerTable.createdAt,
    }).from(walletLedgerTable)
      .innerJoin(whiteLabelMerchantAssignmentsTable,
        eq(walletLedgerTable.merchantId, whiteLabelMerchantAssignmentsTable.merchantId))
      .where(and(eq(whiteLabelMerchantAssignmentsTable.tenantId, res.locals.whiteLabelTenantId as number),
        eq(whiteLabelMerchantAssignmentsTable.merchantId, args.merchantId)))
      .orderBy(desc(walletLedgerTable.createdAt), desc(walletLedgerTable.id)).limit(args.limit);
    res.json({ data });
  } catch (err) { req.log.error({ err }, "wl_ledger_failed"); res.status(503).json({ error: "Tenant ledger unavailable" }); }
});
export default router;
