import { Router } from "express";
import { db, credentialEventsTable } from "@workspace/db";
import { eq, and, gte, lte, desc, count } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";

const router = Router();
router.use(requireAuth);

// GET /api/security/events
router.get("/events", async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (user.role !== "merchant" || !user.merchantId) {
      res.status(403).json({ error: "Merchant access only" });
      return;
    }

    const { page = "1", limit = "50", dateFrom, dateTo, eventType } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(200, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    const conditions: any[] = [eq(credentialEventsTable.merchantId, user.merchantId)];

    if (eventType && eventType !== "all") {
      conditions.push(eq(credentialEventsTable.eventType, eventType));
    }
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    if (dateFrom && dateRe.test(dateFrom)) {
      const [y, m, d] = dateFrom.split("-").map(Number);
      const from = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
      if (!isNaN(from.getTime())) conditions.push(gte(credentialEventsTable.createdAt, from));
    }
    if (dateTo && dateRe.test(dateTo)) {
      const [y, m, d] = dateTo.split("-").map(Number);
      const to = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));
      if (!isNaN(to.getTime())) conditions.push(lte(credentialEventsTable.createdAt, to));
    }

    const where = and(...conditions);

    const [{ total }] = await db
      .select({ total: count() })
      .from(credentialEventsTable)
      .where(where);

    const rows = await db
      .select()
      .from(credentialEventsTable)
      .where(where)
      .orderBy(desc(credentialEventsTable.createdAt))
      .limit(limitNum)
      .offset(offset);

    res.json({
      data: rows.map(r => ({
        id: r.id,
        eventType: r.eventType,
        actorEmail: r.actorEmail,
        keyPrefix: r.keyPrefix,
        ipAddress: r.ipAddress,
        occurredAt: r.createdAt.toISOString(),
      })),
      total: Number(total),
      page: pageNum,
      limit: limitNum,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
