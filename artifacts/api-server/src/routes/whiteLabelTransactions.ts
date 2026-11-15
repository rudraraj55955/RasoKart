import { Router } from "express";
import { db, transactionsTable, whiteLabelMerchantAssignmentsTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requireWhiteLabelTenantAccess } from "../lib/whiteLabelTenantGuard";
import { requireWhiteLabelFinanceAccess } from "../lib/whiteLabelFinanceGuard";

const router = Router({ mergeParams: true });
router.use(requireAuth, requireWhiteLabelTenantAccess, requireWhiteLabelFinanceAccess("read"));

/**
 * New tenant-scoped read-only transaction endpoint.
 * Merchant assignment is enforced by an INNER JOIN in the SQL query, not by a
 * caller-provided merchant ID alone. Existing payment handlers are untouched.
 */
router.get("/:merchantId", async (req, res) => {
  const tenantId = res.locals.whiteLabelTenantId as number;
  const merchantId = Number(req.params.merchantId);
  if (!Number.isSafeInteger(merchantId) || merchantId < 1) {
    res.status(400).json({ error: "Invalid merchant id" });
    return;
  }
  const limitRaw = req.query.limit;
  const limit = limitRaw === undefined ? 50 : Number(limitRaw);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    res.status(400).json({ error: "Limit must be between 1 and 100" });
    return;
  }
  try {
    const transactions = await db.select({
      id: transactionsTable.id,
      merchantId: transactionsTable.merchantId,
      type: transactionsTable.type,
      status: transactionsTable.status,
      amount: transactionsTable.amount,
      currency: transactionsTable.currency,
      provider: transactionsTable.provider,
      createdAt: transactionsTable.createdAt,
    })
      .from(transactionsTable)
      .innerJoin(whiteLabelMerchantAssignmentsTable,
        eq(transactionsTable.merchantId, whiteLabelMerchantAssignmentsTable.merchantId))
      .where(and(
        eq(whiteLabelMerchantAssignmentsTable.tenantId, tenantId),
        eq(whiteLabelMerchantAssignmentsTable.merchantId, merchantId),
      ))
      .orderBy(desc(transactionsTable.createdAt), desc(transactionsTable.id))
      .limit(limit);
    res.json({ data: transactions });
  } catch (err) {
    req.log.error({ err }, "white_label_transactions_read_failed");
    res.status(503).json({ error: "Tenant transaction data unavailable" });
  }
});
export default router;
