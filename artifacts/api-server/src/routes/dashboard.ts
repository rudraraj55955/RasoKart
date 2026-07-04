import { Router } from "express";
import { readFileSync } from "fs";
import { db, transactionsTable, merchantsTable, callbackLogsTable, qrCodesTable, virtualAccountsTable, reconciliationRunsTable, settlementsTable, merchantPlansTable, providersTable } from "@workspace/db";
import { eq, sql, and, gte, count, countDistinct, inArray, lte, isNotNull } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";

const router = Router();
router.use(requireAuth);

const GITHUB_SYNC_HISTORY_FILE = new URL("../../../.github-sync-history.json", import.meta.url).pathname;
const GITHUB_SYNC_FAILURE_THRESHOLD = 3;

interface GithubSyncHistoryEntry {
  status: "success" | "failure";
  syncedAt: string;
  repo: string;
  errorMessage?: string;
}

function countConsecutiveGithubSyncFailures(): { count: number; lastErrorMessage?: string } {
  try {
    const raw = readFileSync(GITHUB_SYNC_HISTORY_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return { count: 0 };

    let streak = 0;
    let lastErrorMessage: string | undefined;
    for (const entry of parsed as GithubSyncHistoryEntry[]) {
      if (entry?.status !== "failure") break;
      streak++;
      if (streak === 1) lastErrorMessage = entry.errorMessage;
    }
    return { count: streak, lastErrorMessage };
  } catch {
    return { count: 0 };
  }
}

// GET /api/dashboard/stats
router.get("/stats", async (req, res, next) => {
  try {
    const user = (req as any).user;
    const isAdmin = user.role === "admin";
    const whereClause = isAdmin ? undefined : eq(transactionsTable.merchantId, user.merchantId!);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [depositStats] = await db
      .select({ total: sql<number>`COALESCE(SUM(CAST(${transactionsTable.amount} AS DECIMAL)), 0)` })
      .from(transactionsTable)
      .where(whereClause
        ? and(eq(transactionsTable.type, "deposit"), whereClause)
        : eq(transactionsTable.type, "deposit"));

    const [withdrawalStats] = await db
      .select({ total: sql<number>`COALESCE(SUM(CAST(${transactionsTable.amount} AS DECIMAL)), 0)` })
      .from(transactionsTable)
      .where(whereClause
        ? and(eq(transactionsTable.type, "withdrawal"), whereClause)
        : eq(transactionsTable.type, "withdrawal"));

    const [pendingCount] = await db.select({ count: count() }).from(transactionsTable)
      .where(whereClause
        ? and(eq(transactionsTable.status, "pending"), whereClause)
        : eq(transactionsTable.status, "pending"));

    const [successCount] = await db.select({ count: count() }).from(transactionsTable)
      .where(whereClause
        ? and(eq(transactionsTable.status, "success"), whereClause)
        : eq(transactionsTable.status, "success"));

    const [failedCount] = await db.select({ count: count() }).from(transactionsTable)
      .where(whereClause
        ? and(eq(transactionsTable.status, "failed"), whereClause)
        : eq(transactionsTable.status, "failed"));

    // Today's deposits
    const todayDepositWhere = whereClause
      ? and(eq(transactionsTable.type, "deposit"), eq(transactionsTable.status, "success"), whereClause, gte(transactionsTable.createdAt, todayStart))
      : and(eq(transactionsTable.type, "deposit"), eq(transactionsTable.status, "success"), gte(transactionsTable.createdAt, todayStart));

    const [todayDepositStats] = await db
      .select({
        cnt: count(),
        total: sql<number>`COALESCE(SUM(CAST(${transactionsTable.amount} AS DECIMAL)), 0)`,
      })
      .from(transactionsTable)
      .where(todayDepositWhere);

    // QR and VA counts
    let qrCount = 0;
    let vaCount = 0;
    if (!isAdmin && user.merchantId) {
      const [qr] = await db.select({ count: count() }).from(qrCodesTable)
        .where(and(eq(qrCodesTable.merchantId, user.merchantId), eq(qrCodesTable.status, "active")));
      const [va] = await db.select({ count: count() }).from(virtualAccountsTable)
        .where(and(eq(virtualAccountsTable.merchantId, user.merchantId), eq(virtualAccountsTable.status, "active")));
      qrCount = qr.count;
      vaCount = va.count;
    } else if (isAdmin) {
      const [qr] = await db.select({ count: count() }).from(qrCodesTable).where(eq(qrCodesTable.status, "active"));
      const [va] = await db.select({ count: count() }).from(virtualAccountsTable).where(eq(virtualAccountsTable.status, "active"));
      qrCount = qr.count;
      vaCount = va.count;
    }

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

    let pendingSettlementAmount: number | undefined;
    if (!isAdmin && user.merchantId) {
      const [psRow] = await db
        .select({ total: sql<number>`COALESCE(SUM(CAST(${settlementsTable.amount} AS DECIMAL)), 0)` })
        .from(settlementsTable)
        .where(and(
          eq(settlementsTable.merchantId, user.merchantId),
          inArray(settlementsTable.status, ["pending", "processing"]),
        ));
      pendingSettlementAmount = Number(psRow?.total ?? 0);
    }

    res.json({
      totalDeposits,
      totalWithdrawals,
      pendingTransactions: pendingCount.count,
      successTransactions: successCount.count,
      failedTransactions: failedCount.count,
      totalMerchants,
      pendingMerchants,
      totalBalance: totalDeposits - totalWithdrawals,
      todayDeposits: todayDepositStats?.cnt ?? 0,
      todayDepositAmount: Number(todayDepositStats?.total ?? 0),
      qrCount,
      vaCount,
      ...(pendingSettlementAmount !== undefined ? { pendingSettlementAmount } : {}),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/dashboard/chart
router.get("/chart", async (req, res, next) => {
  try {
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
  } catch (err) {
    next(err);
  }
});

// GET /api/dashboard/providers — transaction volume breakdown by provider (admin only)
router.get("/providers", async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (user.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }

    const rows = await db
      .select({
        provider: transactionsTable.provider,
        total: sql<number>`COALESCE(SUM(CAST(${transactionsTable.amount} AS DECIMAL)), 0)`,
        txCount: count(),
        successCount: sql<number>`SUM(CASE WHEN ${transactionsTable.status} = 'success' THEN 1 ELSE 0 END)`,
        failedCount: sql<number>`SUM(CASE WHEN ${transactionsTable.status} = 'failed' THEN 1 ELSE 0 END)`,
      })
      .from(transactionsTable)
      .where(and(eq(transactionsTable.type, "deposit"), sql`${transactionsTable.provider} IS NOT NULL`))
      .groupBy(transactionsTable.provider);

    // Build a provider name map from the providers catalogue
    const providerRows = await db.select({ slug: providersTable.slug, name: providersTable.name }).from(providersTable);
    const providerNameMap: Record<string, string> = {};
    for (const p of providerRows) {
      providerNameMap[p.slug] = p.name;
    }

    const data = rows
      .map((r) => ({
        provider: r.provider ?? "unknown",
        providerName: providerNameMap[r.provider ?? ""] ?? (r.provider ? r.provider.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "Unknown"),
        totalVolume: Number(r.total),
        txCount: r.txCount,
        successCount: Number(r.successCount),
        failedCount: Number(r.failedCount),
      }))
      .sort((a, b) => b.totalVolume - a.totalVolume);

    res.json({ data });
  } catch (err) {
    next(err);
  }
});

// GET /api/dashboard/merchants — top merchant volume breakdown (admin only)
router.get("/merchants", async (req, res, next) => {
  try {
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
  } catch (err) {
    next(err);
  }
});

// GET /api/dashboard/notifications — admin notifications
router.get("/notifications", async (req, res, next) => {
  try {
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

    const now = new Date();
    const threeDaysLater = new Date(now.getTime() + 3 * 86400000);
    const overdueRenewals = await db
      .select({ count: count() })
      .from(merchantPlansTable)
      .where(and(isNotNull(merchantPlansTable.scheduledRenewalAt), lte(merchantPlansTable.scheduledRenewalAt, now), eq(merchantPlansTable.status, "active")));
    if (overdueRenewals[0].count > 0) {
      notifications.push({
        id: "overdue-renewals",
        type: "overdue_renewals",
        message: `${overdueRenewals[0].count} merchant plan${overdueRenewals[0].count > 1 ? "s" : ""} overdue for scheduled renewal`,
        severity: "error",
        link: "/admin/merchants",
        createdAt: new Date().toISOString(),
      });
    }

    const upcomingRenewals = await db
      .select({ count: count() })
      .from(merchantPlansTable)
      .where(and(isNotNull(merchantPlansTable.scheduledRenewalAt), gte(merchantPlansTable.scheduledRenewalAt, now), lte(merchantPlansTable.scheduledRenewalAt, threeDaysLater), eq(merchantPlansTable.status, "active")));
    if (upcomingRenewals[0].count > 0) {
      notifications.push({
        id: "upcoming-renewals",
        type: "upcoming_renewals",
        message: `${upcomingRenewals[0].count} merchant plan${upcomingRenewals[0].count > 1 ? "s" : ""} scheduled for renewal in the next 3 days`,
        severity: "info",
        link: "/admin/merchants",
        createdAt: new Date().toISOString(),
      });
    }

    const githubSyncFailures = countConsecutiveGithubSyncFailures();
    if (githubSyncFailures.count >= GITHUB_SYNC_FAILURE_THRESHOLD) {
      notifications.push({
        id: "github-sync-failing",
        type: "github_sync_failing",
        message: `GitHub sync has failed ${githubSyncFailures.count} times in a row${githubSyncFailures.lastErrorMessage ? ` — ${githubSyncFailures.lastErrorMessage}` : ""}`,
        severity: "error",
        link: "/admin/settings#github-sync",
        createdAt: new Date().toISOString(),
      });
    }

    res.json({ data: notifications, total: notifications.length });
  } catch (err) {
    next(err);
  }
});

// GET /api/dashboard/risk — risk monitoring metrics (admin only)
router.get("/risk", async (req, res, next) => {
  try {
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
  } catch (err) {
    next(err);
  }
});

// GET /api/dashboard/recon-summary — latest reconciliation run summary (admin only)
router.get("/recon-summary", async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (user.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }

    const [run] = await db
      .select()
      .from(reconciliationRunsTable)
      .where(eq(reconciliationRunsTable.status, "complete"))
      .orderBy(sql`${reconciliationRunsTable.runAt} DESC`)
      .limit(1);

    if (!run) {
      res.json(null);
      return;
    }

    res.json({
      runId: run.id,
      dateFrom: run.dateFrom,
      dateTo: run.dateTo,
      runAt: run.runAt ? run.runAt.toISOString() : run.createdAt.toISOString(),
      totalMatched: run.totalMatched,
      totalUnmatched: run.totalUnmatched,
      totalDeposits: run.totalDeposits,
      totalSettlements: run.totalSettlements,
      matchedAmount: Number(run.matchedAmount),
      unmatchedAmount: Number(run.unmatchedAmount),
      triggeredBy: run.triggeredBy,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/dashboard/webhook-health — admin only
router.get("/webhook-health", requireAdmin, async (req, res, next) => {
  try {
    const windowHours = 24;
    const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);

    const [failedRow] = await db
      .select({ failedCount: count() })
      .from(callbackLogsTable)
      .where(and(
        eq(callbackLogsTable.status, "failed"),
        gte(callbackLogsTable.createdAt, since),
      ));

    const [merchantRow] = await db
      .select({ affectedMerchants: countDistinct(callbackLogsTable.merchantId) })
      .from(callbackLogsTable)
      .where(and(
        eq(callbackLogsTable.status, "failed"),
        gte(callbackLogsTable.createdAt, since),
      ));

    res.json({
      failedCount: failedRow?.failedCount ?? 0,
      affectedMerchants: merchantRow?.affectedMerchants ?? 0,
      windowHours,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
