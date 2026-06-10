import { Router } from "express";
import { db, reconciliationRunsTable, reconciliationItemsTable, transactionsTable, settlementsTable, merchantsTable, auditLogsTable } from "@workspace/db";
import { eq, and, gte, lte, inArray, sql, count, or, isNull, isNotNull } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { runReconciliation } from "../helpers/reconcileEngine";

const router = Router();
router.use(requireAuth);
router.use(requireAdmin);

function mapRun(r: typeof reconciliationRunsTable.$inferSelect) {
  return {
    ...r,
    matchedAmount: Number(r.matchedAmount),
    unmatchedAmount: Number(r.unmatchedAmount),
  };
}

// POST /api/reconciliation/run
router.post("/run", async (req, res, next) => {
  try {
    const { dateFrom, dateTo, merchantId } = req.body;
    const user = (req as any).user;

    if (!dateFrom || !dateTo) {
      res.status(400).json({ error: "dateFrom and dateTo are required (YYYY-MM-DD)" });
      return;
    }

    const fromDate = new Date(dateFrom + "T00:00:00.000Z");
    const toDate = new Date(dateTo + "T23:59:59.999Z");

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime()) || fromDate > toDate) {
      res.status(400).json({ error: "Invalid date range" });
      return;
    }

    const parsedMerchantId = merchantId ? parseInt(merchantId) : null;

    const updated = await runReconciliation({
      dateFrom,
      dateTo,
      merchantId: parsedMerchantId,
      createdBy: user.id,
      triggeredBy: "manual",
    });

    res.status(201).json(mapRun(updated));
  } catch (err) {
    next(err);
  }
});

// GET /api/reconciliation/runs
router.get("/runs", async (req, res, next) => {
  try {
    const { page = "1", limit = "20", merchantId } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    const conditions = [];
    if (merchantId) conditions.push(eq(reconciliationRunsTable.merchantId, parseInt(merchantId)));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [{ total }] = await db.select({ total: count() }).from(reconciliationRunsTable).where(where);

    const rows = await db
      .select({
        run: reconciliationRunsTable,
        merchantName: merchantsTable.businessName,
      })
      .from(reconciliationRunsTable)
      .leftJoin(merchantsTable, eq(reconciliationRunsTable.merchantId, merchantsTable.id))
      .where(where)
      .orderBy(sql`${reconciliationRunsTable.createdAt} DESC`)
      .limit(limitNum)
      .offset(offset);

    res.json({
      data: rows.map(r => ({ ...mapRun(r.run), merchantName: r.merchantName ?? null })),
      total,
      page: pageNum,
      limit: limitNum,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/reconciliation/runs/:id/items
router.get("/runs/:id/items", async (req, res, next) => {
  try {
    const runId = parseInt(req.params['id'] as string);
    const { page = "1", limit = "50", status, merchantId } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(200, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    const [run] = await db.select().from(reconciliationRunsTable).where(eq(reconciliationRunsTable.id, runId)).limit(1);
    if (!run) { res.status(404).json({ error: "Run not found" }); return; }

    const conditions = [eq(reconciliationItemsTable.runId, runId)];
    if (status && status !== "all") conditions.push(eq(reconciliationItemsTable.status, status));
    if (merchantId) conditions.push(eq(reconciliationItemsTable.merchantId, parseInt(merchantId)));

    const where = and(...conditions);

    const [{ total }] = await db.select({ total: count() }).from(reconciliationItemsTable).where(where);

    const items = await db
      .select({
        item: reconciliationItemsTable,
        txUtr: transactionsTable.utr,
        txAmount: transactionsTable.amount,
        txCreatedAt: transactionsTable.createdAt,
        merchantName: merchantsTable.businessName,
      })
      .from(reconciliationItemsTable)
      .leftJoin(transactionsTable, eq(reconciliationItemsTable.transactionId, transactionsTable.id))
      .leftJoin(merchantsTable, eq(reconciliationItemsTable.merchantId, merchantsTable.id))
      .where(where)
      .orderBy(sql`${reconciliationItemsTable.status} ASC, ${reconciliationItemsTable.id} ASC`)
      .limit(limitNum)
      .offset(offset);

    const settlementIds = items
      .map(i => i.item.settlementId)
      .filter((id): id is number => id !== null);

    const settlements = settlementIds.length > 0
      ? await db.select({ id: settlementsTable.id, referenceNumber: settlementsTable.referenceNumber, amount: settlementsTable.requestedAmount, status: settlementsTable.status })
          .from(settlementsTable)
          .where(inArray(settlementsTable.id, settlementIds))
      : [];

    const settlementMap = new Map(settlements.map(s => [s.id, s]));

    res.json({
      run: mapRun(run),
      data: items.map(({ item, txUtr, txAmount, txCreatedAt, merchantName }) => ({
        ...item,
        amount: Number(item.amount),
        merchantName: merchantName ?? null,
        transaction: item.transactionId ? { id: item.transactionId, utr: txUtr, amount: Number(txAmount), createdAt: txCreatedAt } : null,
        settlement: item.settlementId ? (settlementMap.get(item.settlementId) ?? null) : null,
      })),
      total,
      page: pageNum,
      limit: limitNum,
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/reconciliation/items/:id/resolve
router.patch("/items/:id/resolve", async (req, res, next) => {
  try {
    const itemId = parseInt(req.params['id'] as string);
    const user = (req as any).user;
    const { resolutionType, linkedTransactionId, linkedSettlementId, resolutionNotes } = req.body;

    if (!resolutionType || !["linked_transaction", "linked_settlement", "excluded"].includes(resolutionType)) {
      res.status(400).json({ error: "resolutionType must be linked_transaction, linked_settlement, or excluded" });
      return;
    }

    if (resolutionType === "linked_transaction" && !linkedTransactionId) {
      res.status(400).json({ error: "linkedTransactionId is required for linked_transaction resolution" });
      return;
    }

    if (resolutionType === "linked_settlement" && !linkedSettlementId) {
      res.status(400).json({ error: "linkedSettlementId is required for linked_settlement resolution" });
      return;
    }

    const [item] = await db.select().from(reconciliationItemsTable).where(eq(reconciliationItemsTable.id, itemId)).limit(1);
    if (!item) { res.status(404).json({ error: "Item not found" }); return; }

    if (item.status === "matched") {
      res.status(400).json({ error: "Cannot resolve an already matched item" });
      return;
    }

    const updateValues: Partial<typeof reconciliationItemsTable.$inferInsert> = {
      status: "resolved",
      resolvedAt: new Date(),
      resolvedBy: user.id,
      resolvedByEmail: user.email,
      resolutionType,
      resolutionNotes: resolutionNotes ?? null,
    };

    if (resolutionType === "linked_transaction" && linkedTransactionId) {
      updateValues.transactionId = parseInt(linkedTransactionId);
    }
    if (resolutionType === "linked_settlement" && linkedSettlementId) {
      updateValues.settlementId = parseInt(linkedSettlementId);
    }

    const [updated] = await db
      .update(reconciliationItemsTable)
      .set(updateValues)
      .where(eq(reconciliationItemsTable.id, itemId))
      .returning();

    await db.insert(auditLogsTable).values({
      adminId: user.id,
      adminEmail: user.email,
      action: "reconciliation_item_resolved",
      targetType: "reconciliation_item",
      targetId: itemId,
      details: JSON.stringify({
        runId: item.runId,
        resolutionType,
        linkedTransactionId: linkedTransactionId ?? null,
        linkedSettlementId: linkedSettlementId ?? null,
        resolutionNotes: resolutionNotes ?? null,
        previousStatus: item.status,
      }),
      ipAddress: (req as any).ip ?? null,
    });

    res.json({ ...updated, amount: Number(updated.amount) });
  } catch (err) {
    next(err);
  }
});

export default router;
