import { Router } from "express";
import { db, callbackLogsTable, merchantsTable, apiKeysTable } from "@workspace/db";
import { eq, count, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const user = (req as any).user;
  if (user.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const [totalRow] = await db.select({ total: count() }).from(callbackLogsTable);
  const [successRow] = await db.select({ total: count() }).from(callbackLogsTable).where(eq(callbackLogsTable.status, "success"));
  const [failedRow] = await db.select({ total: count() }).from(callbackLogsTable).where(eq(callbackLogsTable.status, "failed"));
  const [totalKeys] = await db.select({ total: count() }).from(apiKeysTable);
  const [activeKeys] = await db.select({ total: count() }).from(apiKeysTable).where(eq(apiKeysTable.isActive, true));

  const totalRequests = totalRow.total;
  const successRequests = successRow.total;
  const failedRequests = failedRow.total;
  const successRate = totalRequests > 0 ? Math.round((successRequests / totalRequests) * 1000) / 10 : 0;

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
    .where(eq(callbackLogsTable.status, "failed"))
    .orderBy(sql`${callbackLogsTable.createdAt} DESC`)
    .limit(10);

  res.json({
    totalRequests,
    successRequests,
    failedRequests,
    successRate,
    totalApiKeys: totalKeys.total,
    activeApiKeys: activeKeys.total,
    recentErrors: recentErrors.map(e => ({
      url: e.url,
      status: e.status,
      httpStatus: e.httpStatus,
      merchantName: e.merchantName ?? null,
      createdAt: e.createdAt.toISOString(),
    })),
  });
});

export default router;
