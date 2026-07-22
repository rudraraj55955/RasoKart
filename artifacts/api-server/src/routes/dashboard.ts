import { Router } from "express";
import { readFileSync } from "fs";
import { db, transactionsTable, merchantsTable, callbackLogsTable, qrCodesTable, virtualAccountsTable, reconciliationRunsTable, settlementsTable, merchantPlansTable, providersTable, systemSettingsTable } from "@workspace/db";
import { eq, sql, and, gte, count, countDistinct, inArray, notInArray, ne, lte, isNotNull } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";

const router = Router();
router.use(requireAuth);

/** Known seed/demo merchant IDs — excluded from all production-facing admin KPIs and charts.
 *  Cleared automatically in the UI once a real merchant is onboarded (totalMerchants > 0).
 *  When adding a new permanent seed merchant, append its ID here. */
// Subquery helpers — prefer merchants.environment column over hardcoded IDs so
// newly classified merchants are automatically included/excluded.
const getProdMerchantIds = () =>
  db.select({ id: merchantsTable.id }).from(merchantsTable).where(eq(merchantsTable.environment, "production"));

const GITHUB_SYNC_HISTORY_FILE = new URL("../../../.github-sync-history.json", import.meta.url).pathname;
const DEFAULT_GITHUB_SYNC_FAILURE_THRESHOLD = 3;

async function getGithubSyncFailureThreshold(): Promise<number> {
  try {
    const [row] = await db
      .select()
      .from(systemSettingsTable)
      .where(eq(systemSettingsTable.key, "github_sync_failure_threshold"));
    const parsed = parseInt(row?.value ?? "", 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_GITHUB_SYNC_FAILURE_THRESHOLD;
  } catch {
    return DEFAULT_GITHUB_SYNC_FAILURE_THRESHOLD;
  }
}

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
    // Environment filter: admin can switch between production/demo/all via ?env= param.
    // Default is 'production' so KPIs always reflect verified production data.
    const envParam = isAdmin ? ((req.query as Record<string, string>).env ?? "production") : null;
    const prodIds = getProdMerchantIds();
    const merchantFilter = isAdmin
      ? (envParam === "production"
          ? inArray(transactionsTable.merchantId, prodIds)
          : envParam === "demo"
            ? notInArray(transactionsTable.merchantId, prodIds)
            : undefined)
      : eq(transactionsTable.merchantId, user.merchantId!);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [depositStats] = await db
      .select({ total: sql<number>`COALESCE(SUM(CAST(${transactionsTable.amount} AS DECIMAL)), 0)` })
      .from(transactionsTable)
      .where(and(eq(transactionsTable.type, "deposit"), merchantFilter));

    const [withdrawalStats] = await db
      .select({ total: sql<number>`COALESCE(SUM(CAST(${transactionsTable.amount} AS DECIMAL)), 0)` })
      .from(transactionsTable)
      .where(and(eq(transactionsTable.type, "withdrawal"), merchantFilter));

    const [pendingCount] = await db.select({ count: count() }).from(transactionsTable)
      .where(and(eq(transactionsTable.status, "pending"), merchantFilter));

    const [successCount] = await db.select({ count: count() }).from(transactionsTable)
      .where(and(eq(transactionsTable.status, "success"), merchantFilter));

    const [failedCount] = await db.select({ count: count() }).from(transactionsTable)
      .where(and(eq(transactionsTable.status, "failed"), merchantFilter));

    // Today's deposits
    const [todayDepositStats] = await db
      .select({
        cnt: count(),
        total: sql<number>`COALESCE(SUM(CAST(${transactionsTable.amount} AS DECIMAL)), 0)`,
      })
      .from(transactionsTable)
      .where(and(eq(transactionsTable.type, "deposit"), eq(transactionsTable.status, "success"), merchantFilter, gte(transactionsTable.createdAt, todayStart)));

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
      const qrEnvCond = envParam === "production" ? inArray(qrCodesTable.merchantId, prodIds)
        : envParam === "demo" ? notInArray(qrCodesTable.merchantId, prodIds) : undefined;
      const vaEnvCond = envParam === "production" ? inArray(virtualAccountsTable.merchantId, prodIds)
        : envParam === "demo" ? notInArray(virtualAccountsTable.merchantId, prodIds) : undefined;
      const [qr] = await db.select({ count: count() }).from(qrCodesTable)
        .where(and(eq(qrCodesTable.status, "active"), qrEnvCond));
      const [va] = await db.select({ count: count() }).from(virtualAccountsTable)
        .where(and(eq(virtualAccountsTable.status, "active"), vaEnvCond));
      qrCount = qr.count;
      vaCount = va.count;
    }

    // Merchant counts filtered by environment param.
    // totalMerchants = 0 in production mode means no real merchants have onboarded yet.
    let totalMerchants = 0;
    let pendingMerchants = 0;
    if (isAdmin) {
      const envMerchCond = envParam === "production"
        ? eq(merchantsTable.environment, "production")
        : envParam === "demo" ? ne(merchantsTable.environment, "production") : undefined;
      const [tm] = await db.select({ count: count() }).from(merchantsTable).where(envMerchCond);
      const [pm] = await db.select({ count: count() }).from(merchantsTable)
        .where(and(eq(merchantsTable.status, "pending"), envMerchCond));
      totalMerchants = tm.count;
      pendingMerchants = pm.count;
    }

    // demoDataOnly: true only in non-production environments when no real merchants exist yet
    // or admin explicitly requested demo view. In production (NODE_ENV=production), always
    // return false — show real data and proper empty states rather than a "Demo" banner.
    const isProductionEnv = process.env["NODE_ENV"] === "production";
    const demoDataOnly = !isProductionEnv && isAdmin && (envParam === "demo" || (envParam === "production" && totalMerchants === 0));

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
      demoDataOnly,
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

    const chartFilter = isAdmin
      ? and(gte(transactionsTable.createdAt, thirtyDaysAgo), inArray(transactionsTable.merchantId, getProdMerchantIds()))
      : and(gte(transactionsTable.createdAt, thirtyDaysAgo), eq(transactionsTable.merchantId, user.merchantId!));

    const rows = await db
      .select({
        date: sql<string>`TO_CHAR(${transactionsTable.createdAt}, 'YYYY-MM-DD')`,
        type: transactionsTable.type,
        total: sql<number>`COALESCE(SUM(CAST(${transactionsTable.amount} AS DECIMAL)), 0)`,
      })
      .from(transactionsTable)
      .where(chartFilter)
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
      .where(and(
        eq(transactionsTable.type, "deposit"),
        sql`${transactionsTable.provider} IS NOT NULL`,
        inArray(transactionsTable.merchantId, getProdMerchantIds()),
      ))
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
      .where(inArray(transactionsTable.merchantId, getProdMerchantIds()))
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

    // Only show notification for pending real (non-demo) merchants
    const [pm] = await db.select({ count: count() }).from(merchantsTable)
      .where(and(eq(merchantsTable.status, "pending"), eq(merchantsTable.environment, "production")));
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

    // Only count pending transactions from real (non-demo) merchants
    const [pt] = await db.select({ count: count() }).from(transactionsTable)
      .where(and(eq(transactionsTable.status, "pending"), inArray(transactionsTable.merchantId, getProdMerchantIds())));
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

    // Use the same 24-hour window as the webhook-health card so counts stay consistent.
    // Exclude demo merchants so demo seed webhook failures don't pollute admin alerts.
    const callbackSince = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [fc] = await db.select({ count: count() }).from(callbackLogsTable)
      .where(and(
        eq(callbackLogsTable.status, "failed"),
        gte(callbackLogsTable.createdAt, callbackSince),
        inArray(callbackLogsTable.merchantId, getProdMerchantIds()),
      ));
    if (fc.count > 0) {
      notifications.push({
        id: "failed-callbacks",
        type: "failed_callbacks",
        message: `${fc.count} webhook callback${fc.count > 1 ? "s" : ""} failed delivery in the last 24h`,
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

    const githubSyncFailureThreshold = await getGithubSyncFailureThreshold();
    const githubSyncFailures = countConsecutiveGithubSyncFailures();
    if (githubSyncFailures.count >= githubSyncFailureThreshold) {
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

    // All risk metrics exclude demo/seed merchants for accurate production monitoring
    const [hv] = await db
      .select({ count: count() })
      .from(transactionsTable)
      .where(and(
        sql`CAST(${transactionsTable.amount} AS DECIMAL) > ${HIGH_VALUE_THRESHOLD}`,
        inArray(transactionsTable.merchantId, getProdMerchantIds()),
      ));

    const [total] = await db.select({ count: count() }).from(transactionsTable)
      .where(inArray(transactionsTable.merchantId, getProdMerchantIds()));
    const [failed] = await db.select({ count: count() }).from(transactionsTable)
      .where(and(eq(transactionsTable.status, "failed"), inArray(transactionsTable.merchantId, getProdMerchantIds())));

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
      .where(inArray(transactionsTable.merchantId, getProdMerchantIds()))
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
// Respects the same demo/production environment split as the main dashboard stats.
router.get("/recon-summary", async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (user.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }

    // Determine environment: production mode unless no real merchants exist yet
    const [tmRow] = await db
      .select({ count: count() })
      .from(merchantsTable)
      .where(eq(merchantsTable.environment, "production"));
    const totalProdMerchants = Number(tmRow?.count ?? 0);
    const demoDataOnly = totalProdMerchants === 0;
    const environment: "demo" | "production" = demoDataOnly ? "demo" : "production";

    const prodReconIds = getProdMerchantIds();
    // In demo mode show runs from demo merchants; in production show only production runs
    const envFilter = demoDataOnly
      ? notInArray(reconciliationRunsTable.merchantId, prodReconIds)
      : inArray(reconciliationRunsTable.merchantId, prodReconIds);

    const [run] = await db
      .select()
      .from(reconciliationRunsTable)
      .where(and(eq(reconciliationRunsTable.status, "complete"), envFilter))
      .orderBy(sql`${reconciliationRunsTable.runAt} DESC`)
      .limit(1);

    if (!run) {
      res.json({ demoDataOnly, environment });
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
      status: run.status,
      merchantId: run.merchantId,
      demoDataOnly,
      environment,
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

    // Exclude demo/seed merchants from webhook health metrics
    const [failedRow] = await db
      .select({ failedCount: count() })
      .from(callbackLogsTable)
      .where(and(
        eq(callbackLogsTable.status, "failed"),
        gte(callbackLogsTable.createdAt, since),
        inArray(callbackLogsTable.merchantId, getProdMerchantIds()),
      ));

    const [merchantRow] = await db
      .select({ affectedMerchants: countDistinct(callbackLogsTable.merchantId) })
      .from(callbackLogsTable)
      .where(and(
        eq(callbackLogsTable.status, "failed"),
        gte(callbackLogsTable.createdAt, since),
        inArray(callbackLogsTable.merchantId, getProdMerchantIds()),
      ));

    // All-time total unresolved failed webhook deliveries for production merchants
    const [totalUnresolvedRow] = await db
      .select({ totalFailed: count() })
      .from(callbackLogsTable)
      .where(and(
        eq(callbackLogsTable.status, "failed"),
        inArray(callbackLogsTable.merchantId, getProdMerchantIds()),
      ));

    res.json({
      failedCount: failedRow?.failedCount ?? 0,
      affectedMerchants: merchantRow?.affectedMerchants ?? 0,
      windowHours,
      totalUnresolvedFailed: totalUnresolvedRow?.totalFailed ?? 0,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
