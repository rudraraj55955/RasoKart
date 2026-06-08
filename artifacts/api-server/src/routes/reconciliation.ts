import { Router } from "express";
import { db, reconciliationRunsTable, reconciliationItemsTable, transactionsTable, settlementsTable, merchantsTable } from "@workspace/db";
import { eq, and, gte, lte, inArray, sql, count, sum } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";

const router = Router();
router.use(requireAuth);
router.use(requireAdmin);

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

    // Create run record in "running" state
    const [run] = await db.insert(reconciliationRunsTable).values({
      merchantId: parsedMerchantId,
      dateFrom,
      dateTo,
      status: "running",
      createdBy: user.id,
    }).returning();

    // Perform reconciliation asynchronously (but we await it since Express handles timing)
    try {
      // (a) Fetch all success deposit transactions in the date range
      const txConditions = [
        eq(transactionsTable.type, "deposit"),
        eq(transactionsTable.status, "success"),
        gte(transactionsTable.createdAt, fromDate),
        lte(transactionsTable.createdAt, toDate),
      ];
      if (parsedMerchantId) txConditions.push(eq(transactionsTable.merchantId, parsedMerchantId));

      const deposits = await db
        .select({
          tx: transactionsTable,
          merchantName: merchantsTable.businessName,
        })
        .from(transactionsTable)
        .leftJoin(merchantsTable, eq(transactionsTable.merchantId, merchantsTable.id))
        .where(and(...txConditions));

      // (b) Fetch all approved/paid settlements overlapping the period
      const sConditions = [
        sql`${settlementsTable.status} IN ('approved', 'paid')`,
        gte(settlementsTable.createdAt, fromDate),
        lte(settlementsTable.createdAt, toDate),
      ];
      if (parsedMerchantId) sConditions.push(eq(settlementsTable.merchantId, parsedMerchantId));

      const settlements = await db
        .select({ s: settlementsTable })
        .from(settlementsTable)
        .where(and(...sConditions));

      // (c) Match: for each settlement find a deposit with same merchantId + matching amount
      // Use greedy 1:1 matching — each deposit/settlement can only be matched once
      const usedDepositIds = new Set<number>();
      const usedSettlementIds = new Set<number>();

      const items: {
        runId: number;
        transactionId: number | null;
        settlementId: number | null;
        merchantId: number;
        status: string;
        amount: string;
        matchedAt: Date | null;
        notes: string | null;
      }[] = [];

      for (const { s } of settlements) {
        if (usedSettlementIds.has(s.id)) continue;
        const settlementAmt = Number(s.requestedAmount ?? s.amount);

        // Find a matching deposit: same merchant, same amount (within ±0.01 tolerance)
        const match = deposits.find(({ tx }) =>
          !usedDepositIds.has(tx.id) &&
          tx.merchantId === s.merchantId &&
          Math.abs(Number(tx.amount) - settlementAmt) < 0.01
        );

        if (match) {
          usedDepositIds.add(match.tx.id);
          usedSettlementIds.add(s.id);
          const now = new Date();
          items.push({
            runId: run.id,
            transactionId: match.tx.id,
            settlementId: s.id,
            merchantId: s.merchantId,
            status: "matched",
            amount: settlementAmt.toFixed(2),
            matchedAt: now,
            notes: `Deposit UTR: ${match.tx.utr}`,
          });
        }
      }

      // (d) Unmatched deposits
      for (const { tx } of deposits) {
        if (usedDepositIds.has(tx.id)) continue;
        items.push({
          runId: run.id,
          transactionId: tx.id,
          settlementId: null,
          merchantId: tx.merchantId,
          status: "unmatched_deposit",
          amount: Number(tx.amount).toFixed(2),
          matchedAt: null,
          notes: `No matching settlement found for UTR: ${tx.utr}`,
        });
      }

      // Unmatched settlements
      for (const { s } of settlements) {
        if (usedSettlementIds.has(s.id)) continue;
        items.push({
          runId: run.id,
          transactionId: null,
          settlementId: s.id,
          merchantId: s.merchantId,
          status: "unmatched_settlement",
          amount: Number(s.requestedAmount ?? s.amount).toFixed(2),
          matchedAt: null,
          notes: `No matching deposit found for settlement #${s.id}`,
        });
      }

      // (e) Write items
      if (items.length > 0) {
        await db.insert(reconciliationItemsTable).values(items);
      }

      // Calculate summary stats
      const matched = items.filter(i => i.status === "matched");
      const unmatchedDeposits = items.filter(i => i.status === "unmatched_deposit");
      const unmatchedSettlements = items.filter(i => i.status === "unmatched_settlement");
      const totalUnmatched = unmatchedDeposits.length + unmatchedSettlements.length;
      const matchedAmount = matched.reduce((s, i) => s + Number(i.amount), 0);
      const unmatchedAmount = [...unmatchedDeposits, ...unmatchedSettlements].reduce((s, i) => s + Number(i.amount), 0);

      // Update run with summary
      const [updated] = await db.update(reconciliationRunsTable)
        .set({
          status: "complete",
          totalDeposits: deposits.length,
          totalSettlements: settlements.length,
          totalMatched: matched.length,
          totalUnmatched,
          matchedAmount: matchedAmount.toFixed(2),
          unmatchedAmount: unmatchedAmount.toFixed(2),
        })
        .where(eq(reconciliationRunsTable.id, run.id))
        .returning();

      res.status(201).json(mapRun(updated));
    } catch (err) {
      // Mark run as failed on error
      await db.update(reconciliationRunsTable)
        .set({ status: "failed", notes: err instanceof Error ? err.message : "Unknown error" })
        .where(eq(reconciliationRunsTable.id, run.id));
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

function mapRun(r: typeof reconciliationRunsTable.$inferSelect) {
  return {
    ...r,
    matchedAmount: Number(r.matchedAmount),
    unmatchedAmount: Number(r.unmatchedAmount),
  };
}

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
    const runId = parseInt(req.params.id as string);
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

    // Fetch settlement refs for items that have settlementId
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

export default router;
