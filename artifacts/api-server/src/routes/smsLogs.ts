import { Router } from "express";
import { db, smsSendLogsTable } from "@workspace/db";
import { desc, count, and, gte, lte, eq } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";

const router = Router();
router.use(requireAuth, requireAdmin);

// GET /api/admin/sms-logs
router.get("/", async (req, res, next) => {
  try {
    const {
      page = "1",
      limit = "50",
      status,
      provider,
      dateFrom,
      dateTo,
    } = req.query as Record<string, string>;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(200, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    const conditions: any[] = [];
    if (status) conditions.push(eq(smsSendLogsTable.status, status));
    if (provider) conditions.push(eq(smsSendLogsTable.providerUsed, provider));
    if (dateFrom) conditions.push(gte(smsSendLogsTable.createdAt, new Date(dateFrom)));
    if (dateTo) conditions.push(lte(smsSendLogsTable.createdAt, new Date(dateTo)));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, [{ total }]] = await Promise.all([
      db.select({
        id: smsSendLogsTable.id,
        mobileLast4: smsSendLogsTable.mobileLast4,
        otpPurpose: smsSendLogsTable.otpPurpose,
        providerUsed: smsSendLogsTable.providerUsed,
        status: smsSendLogsTable.status,
        fallbackAttempted: smsSendLogsTable.fallbackAttempted,
        fallbackProviderUsed: smsSendLogsTable.fallbackProviderUsed,
        providerMsgId: smsSendLogsTable.providerMsgId,
        errorReason: smsSendLogsTable.errorReason,
        merchantId: smsSendLogsTable.merchantId,
        createdAt: smsSendLogsTable.createdAt,
      }).from(smsSendLogsTable)
        .where(where)
        .orderBy(desc(smsSendLogsTable.createdAt))
        .limit(limitNum)
        .offset(offset),
      db.select({ total: count() }).from(smsSendLogsTable).where(where),
    ]);

    res.json({
      logs: rows.map((r) => ({
        ...r,
        mobileMasked: r.mobileLast4 ? `****${r.mobileLast4}` : "****",
        mobileLast4: undefined,
      })),
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    });
  } catch (err) { next(err); }
});

export default router;
