import { Router } from "express";
import { db, transactionsTable, merchantsTable, callbackLogsTable } from "@workspace/db";
import { eq, sql, and, gte, count, sum } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";

const router = Router();

router.use(requireAuth);

// GET /api/dashboard/stats
router.get("/stats", async (req, res) => {
  const user = (req as any).user;
  const isAdmin = user.role === "admin";

  const whereClause = isAdmin ? undefined : eq(transactionsTable.merchantId, user.merchantId!);

  const [depositStats] = await db
    .select({ total: sql<number>`COALESCE(SUM(CAST(${transactionsTable.amount} AS DECIMAL)), 0)` })
    .from(transactionsTable)
    .where(whereClause ? and(eq(transactionsTable.type, "deposit"), whereClause) : eq(transactionsTable.type, "deposit"));

  const [withdrawalStats] = await db
    .select({ total: sql<number>`COALESCE(SUM(CAST(${transactionsTable.amount} AS DECIMAL)), 0)` })
    .from(transactionsTable)
    .where(whereClause ? and(eq(transactionsTable.type, "withdrawal"), whereClause) : eq(transactionsTable.type, "withdrawal"));

  const [pendingCount] = await db.select({ count: count() }).from(transactionsTable)
    .where(whereClause ? and(eq(transactionsTable.status, "pending"), whereClause) : eq(transactionsTable.status, "pending"));

  const [successCount] = await db.select({ count: count() }).from(transactionsTable)
    .where(whereClause ? and(eq(transactionsTable.status, "success"), whereClause) : eq(transactionsTable.status, "success"));

  const [failedCount] = await db.select({ count: count() }).from(transactionsTable)
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

  res.json(Object.entries(dateMap).map(([date, vals]) => ({ date, ...vals })));
});

// GET /api/dashboard/merchants — top merchant volume breakdown
router.get("/merchants", async (req, res) => {
  const user = (req as any).user;
  if (user.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }

  const rows = await db
    .select({
      merchantId: transactionsTable.merchantId,
      merchantName: merchantsTable.businessName,
      type: transactionsTable.type,
      total: sql<number>`COALESCE(SUM(CAST(${transactionsTable.amount} AS DECIMAL)), 0)`,
      txCount: count(),
    })
    .from(transactionsTable)
    .leftJoin(merchantsTable, eq(transactionsTable.merchantId, merchantsTable.id))
    .groupBy(transactionsTable.merchantId, merchantsTable.businessName, transactionsTable.type);

  const merchantMap: Record<number, { merchantId: number; merchantName: string; totalDeposits: number; totalWithdrawals: number; txCount: number }> = {};
  for (const row of rows) {
    if (!merchantMap[row.merchantId]) {
      merchantMap[row.merchantId] = {
        merchantId: row.merchantId,
        merchantName: row.merchantName ?? `Merchant #${row.merchantId}`,
        totalDeposits: 0,
        totalWithdrawals: 0,
        txCount: 0,
      };
    }
    merchantMap[row.merchantId].txCount += row.txCount;
    if (row.type === "deposit") merchantMap[row.merchantId].totalDeposits = Number(row.total);
    if (row.type === "withdrawal") merchantMap[row.merchantId].totalWithdrawals = Number(row.total);
  }

  const data = Object.values(merchantMap)
    .sort((a, b) => (b.totalDeposits + b.totalWithdrawals) - (a.totalDeposits + a.totalWithdrawals))
    .slice(0, 10);

  res.json({ data });
});

// GET /api/dashboard/notifications — admin notifications derived from platform state
router.get("/notifications", async (req, res) => {
  const user = (req as any).user;
  if (user.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }

  const notifications: any[] = [];

  const [pm] = await db.select({ count: count() }).from(merchantsTable).where(eq(merchantsTable.status, "pending"));
  if (pm.count > 0) {
    notifications.push({
      id: "pending-merchants",
      type: "pending_merchants",
      message: `${pm.count} merchant${pm.count > 1 ? "s" : ""} awaiting approval`,
      severity: "warning",
      link: "/admin/merchants",
      createdAt: new Date().toISOString(),
    });
  }

  const [pt] = await db.select({ count: count() }).from(transactionsTable).where(eq(transactionsTable.status, "pending"));
  if (pt.count > 0) {
    notifications.push({
      id: "pending-txns",
      type: "pending_transactions",
      message: `${pt.count} transaction${pt.count > 1 ? "s" : ""} pending processing`,
      severity: pt.count > 10 ? "error" : "info",
      link: "/admin/transactions",
      createdAt: new Date().toISOString(),
    });
  }

  const [fc] = await db.select({ count: count() }).from(callbackLogsTable).where(eq(callbackLogsTable.status, "failed"));
  if (fc.count > 0) {
    notifications.push({
      id: "failed-callbacks",
      type: "failed_callbacks",
      message: `${fc.count} webhook callback${fc.count > 1 ? "s" : ""} failed delivery`,
      severity: "error",
      link: "/admin/webhook-logs",
      createdAt: new Date().toISOString(),
    });
  }

  res.json({ data: notifications, total: notifications.length });
});

// GET /api/dashboard/risk — risk monitoring metrics
router.get("/risk", async (req, res) => {
  const user = (req as any).user;
  if (user.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }

  const HIGH_VALUE_THRESHOLD = 100000;

  const [hv] = await db
    .select({ count: count() })
    .from(transactionsTable)
    .where(sql`CAST(${transactionsTable.amount} AS DECIMAL) > ${HIGH_VALUE_THRESHOLD}`);

  const [total] = await db.select({ count: count() }).from(transactionsTable);
  const [failed] = await db.select({ count: count() }).from(transactionsTable).where(eq(transactionsTable.status, "failed"));

  const failedRatePercent = total.count > 0 ? Math.round((failed.count / total.count) * 1000) / 10 : 0;

  const merchantStats = await db
    .select({
      merchantId: transactionsTable.merchantId,
      merchantName: merchantsTable.businessName,
      failedCount: sql<number>`SUM(CASE WHEN ${transactionsTable.status} = 'failed' THEN 1 ELSE 0 END)`,
      totalCount: count(),
    })
    .from(transactionsTable)
    .leftJoin(merchantsTable, eq(transactionsTable.merchantId, merchantsTable.id))
    .groupBy(transactionsTable.merchantId, merchantsTable.businessName);

  const topFailingMerchants = merchantStats
    .map(m => ({
      merchantId: m.merchantId,
      merchantName: m.merchantName ?? `Merchant #${m.merchantId}`,
      failedCount: Number(m.failedCount),
      failedRate: m.totalCount > 0 ? Math.round((Number(m.failedCount) / m.totalCount) * 1000) / 10 : 0,
    }))
    .filter(m => m.failedCount > 0)
    .sort((a, b) => b.failedRate - a.failedRate)
    .slice(0, 5);

  res.json({
    highValueCount: hv.count,
    failedRatePercent,
    suspiciousCount: hv.count + (failedRatePercent > 20 ? Math.floor(failed.count * 0.1) : 0),
    topFailingMerchants,
  });
});

export default router;
