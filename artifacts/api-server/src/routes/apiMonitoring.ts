import { Router } from "express";
import { db, callbackLogsTable, merchantsTable, apiKeysTable } from "@workspace/db";
import { and, eq, count, not, notInArray, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";

const router = Router();
router.use(requireAuth);

/**
 * Seed/demo merchant IDs — must stay in sync with dashboard.ts DEMO_MERCHANT_IDS.
 * Their callback logs are real DB rows but represent demo/test activity, not live
 * merchant traffic. They are counted separately so the admin can distinguish.
 */
const DEMO_MERCHANT_IDS = [1, 2, 3, 80];

router.get("/", async (req, res) => {
  const user = (req as any).user;
  if (user.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  // Live traffic = non-test, non-demo-merchant deliveries.
  // This is the authoritative production health metric.
  const liveConditions = [
    eq(callbackLogsTable.isTest, false),
    notInArray(callbackLogsTable.merchantId, DEMO_MERCHANT_IDS),
  ];

  const [
    [totalRow],
    [successRow],
    [failedRow],
    [testRow],
    [totalKeys],
    [activeKeys],
  ] = await Promise.all([
    db.select({ total: count() }).from(callbackLogsTable).where(and(...liveConditions)),
    db.select({ total: count() }).from(callbackLogsTable).where(and(...liveConditions, eq(callbackLogsTable.status, "success"))),
    db.select({ total: count() }).from(callbackLogsTable).where(and(...liveConditions, eq(callbackLogsTable.status, "failed"))),
    // Test deliveries (isTest=true) counted separately — not mixed into live stats.
    db.select({ total: count() }).from(callbackLogsTable).where(eq(callbackLogsTable.isTest, true)),
    db.select({ total: count() }).from(apiKeysTable),
    db.select({ total: count() }).from(apiKeysTable).where(eq(apiKeysTable.isActive, true)),
  ]);

  const totalRequests = totalRow!.total;
  const successRequests = successRow!.total;
  const failedRequests = failedRow!.total;
  const testRequests = testRow!.total;
  const successRate = totalRequests > 0 ? Math.round((successRequests / totalRequests) * 1000) / 10 : 0;

  // Recent errors: live traffic only (exclude test + demo merchant rows).
  const recentErrors = await db
    .select({
      url: callbackLogsTable.url,
      status: callbackLogsTable.status,
      httpStatus: callbackLogsTable.httpStatus,
      createdAt: callbackLogsTable.createdAt,
      merchantName: merchantsTable.businessName,
    })
    .from(callbackLogsTable)
    .leftJoin(merchantsTable, eq(callbackLogsTable.merchantId, merchantsTable.id))
    .where(and(eq(callbackLogsTable.status, "failed"), ...liveConditions))
    .orderBy(sql`${callbackLogsTable.createdAt} DESC`)
    .limit(10);

  res.json({
    totalRequests,
    successRequests,
    failedRequests,
    testRequests,
    successRate,
    totalApiKeys: totalKeys!.total,
    activeApiKeys: activeKeys!.total,
    recentErrors: recentErrors.map(e => ({
      url: e.url,
      status: e.status,
      httpStatus: e.httpStatus,
      merchantName: e.merchantName ?? null,
      createdAt: e.createdAt.toISOString(),
    })),
    // Metadata: inform consumers about the data scope.
    _scope: "live_traffic_only",
    _excludes: "isTest=true deliveries and demo-merchant IDs [1,2,3,80]",
  });
});

export default router;
