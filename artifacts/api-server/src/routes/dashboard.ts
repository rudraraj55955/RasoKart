import { Router } from "express";
import { db, transactionsTable, merchantsTable } from "@workspace/db";
import { eq, sql, and, gte, lte, count, sum } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";

const router = Router();

router.use(requireAuth);

// GET /api/dashboard/stats
router.get("/stats", async (req, res) => {
  const user = (req as any).user;
  const isAdmin = user.role === "admin";

  const whereClause = isAdmin ? undefined : eq(transactionsTable.merchantId, user.merchantId!);

  const [depositStats] = await db
    .select({
      total: sql<number>`COALESCE(SUM(CAST(${transactionsTable.amount} AS DECIMAL)), 0)`,
    })
    .from(transactionsTable)
    .where(whereClause ? and(eq(transactionsTable.type, "deposit"), whereClause) : eq(transactionsTable.type, "deposit"));

  const [withdrawalStats] = await db
    .select({
      total: sql<number>`COALESCE(SUM(CAST(${transactionsTable.amount} AS DECIMAL)), 0)`,
    })
    .from(transactionsTable)
    .where(whereClause ? and(eq(transactionsTable.type, "withdrawal"), whereClause) : eq(transactionsTable.type, "withdrawal"));

  const [pendingCount] = await db
    .select({ count: count() })
    .from(transactionsTable)
    .where(whereClause ? and(eq(transactionsTable.status, "pending"), whereClause) : eq(transactionsTable.status, "pending"));

  const [successCount] = await db
    .select({ count: count() })
    .from(transactionsTable)
    .where(whereClause ? and(eq(transactionsTable.status, "success"), whereClause) : eq(transactionsTable.status, "success"));

  const [failedCount] = await db
    .select({ count: count() })
    .from(transactionsTable)
    .where(whereClause ? and(eq(transactionsTable.status, "failed"), whereClause) : eq(transactionsTable.status, "failed"));

  let totalMerchants = 0;
  let pendingMerchants = 0;

  if (isAdmin) {
    const [tm] = await db.select({ count: count() }).from(merchantsTable);
    const [pm] = await db.select({ count: count() }).from(merchantsTable).where(eq(merchantsTable.status, "pending"));
    totalMerchants = tm.count;
    pendingMerchants = pm.count;
  }

  const totalDeposits = Number(depositStats?.total ?? 0);
  const totalWithdrawals = Number(withdrawalStats?.total ?? 0);

  res.json({
    totalDeposits,
    totalWithdrawals,
    pendingTransactions: pendingCount.count,
    successTransactions: successCount.count,
    failedTransactions: failedCount.count,
    totalMerchants,
    pendingMerchants,
    totalBalance: totalDeposits - totalWithdrawals,
  });
});

// GET /api/dashboard/chart
router.get("/chart", async (req, res) => {
  const user = (req as any).user;
  const isAdmin = user.role === "admin";

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const whereClause = isAdmin
    ? gte(transactionsTable.createdAt, thirtyDaysAgo)
    : and(gte(transactionsTable.createdAt, thirtyDaysAgo), eq(transactionsTable.merchantId, user.merchantId!));

  const rows = await db
    .select({
      date: sql<string>`TO_CHAR(${transactionsTable.createdAt}, 'YYYY-MM-DD')`,
      type: transactionsTable.type,
      total: sql<number>`COALESCE(SUM(CAST(${transactionsTable.amount} AS DECIMAL)), 0)`,
    })
    .from(transactionsTable)
    .where(whereClause)
    .groupBy(sql`TO_CHAR(${transactionsTable.createdAt}, 'YYYY-MM-DD')`, transactionsTable.type)
    .orderBy(sql`TO_CHAR(${transactionsTable.createdAt}, 'YYYY-MM-DD')`);

  // Build last 30 days map
  const dateMap: Record<string, { deposits: number; withdrawals: number }> = {};
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    dateMap[key] = { deposits: 0, withdrawals: 0 };
  }

  for (const row of rows) {
    if (dateMap[row.date]) {
      if (row.type === "deposit") dateMap[row.date].deposits = Number(row.total);
      if (row.type === "withdrawal") dateMap[row.date].withdrawals = Number(row.total);
    }
  }

  const chart = Object.entries(dateMap).map(([date, vals]) => ({ date, ...vals }));
  res.json(chart);
});

export default router;
