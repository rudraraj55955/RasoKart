import { Router } from "express";
import { db, callbackLogsTable } from "@workspace/db";
import { eq, and, count, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";

const router = Router();
router.use(requireAuth);

// GET /api/callbacks
router.get("/", async (req, res) => {
  const user = (req as any).user;
  const { status, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  if (user.role !== "admin") conditions.push(eq(callbackLogsTable.merchantId, user.merchantId!));
  if (status && status !== "all") conditions.push(eq(callbackLogsTable.status, status));

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [{ total }] = await db.select({ total: count() }).from(callbackLogsTable).where(where);
  const data = await db.select().from(callbackLogsTable).where(where).limit(limitNum).offset(offset).orderBy(sql`${callbackLogsTable.createdAt} DESC`);

  res.json({ data, total, page: pageNum, limit: limitNum });
});

export default router;
