import { Router } from "express";
import { db, auditLogsTable } from "@workspace/db";
import { eq, ilike, and, count, sql, or, gte } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";

const router = Router();
router.use(requireAuth);

function ensureAdmin(req: any, res: any): boolean {
  if ((req as any).user.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return false;
  }
  return true;
}

router.get("/stats", async (req, res) => {
  if (!ensureAdmin(req, res)) return;

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [{ total }] = await db
    .select({ total: count() })
    .from(auditLogsTable)
    .where(
      and(
        eq(auditLogsTable.action, "csv_export"),
        gte(auditLogsTable.createdAt, thirtyDaysAgo),
      ),
    );

  res.json({ csvExportsLast30Days: total });
});

router.get("/", async (req, res) => {
  if (!ensureAdmin(req, res)) return;

  const { page = "1", limit = "20", action, search } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions: any[] = [];
  if (action && action !== "all") conditions.push(eq(auditLogsTable.action, action));
  if (search) {
    conditions.push(
      or(
        ilike(auditLogsTable.adminEmail, `%${search}%`),
        ilike(auditLogsTable.action, `%${search}%`),
        ilike(auditLogsTable.targetType, `%${search}%`),
      )!
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [{ total }] = await db.select({ total: count() }).from(auditLogsTable).where(where);

  const rows = await db
    .select()
    .from(auditLogsTable)
    .where(where)
    .limit(limitNum)
    .offset(offset)
    .orderBy(sql`${auditLogsTable.createdAt} DESC`);

  res.json({
    data: rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() })),
    total,
    page: pageNum,
    limit: limitNum,
  });
});

router.post("/", async (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const user = (req as any).user;
  const { action, targetType, targetId, details } = req.body;

  if (!action || !targetType) {
    res.status(400).json({ error: "action and targetType are required" });
    return;
  }

  const [log] = await db.insert(auditLogsTable).values({
    adminId: user.id,
    adminEmail: user.email,
    action,
    targetType,
    targetId: targetId ?? null,
    details: details ?? null,
    ipAddress: req.ip ?? null,
  }).returning();

  res.status(201).json({ ...log, createdAt: log.createdAt.toISOString() });
});

export default router;
