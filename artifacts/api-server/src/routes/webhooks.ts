import { Router } from "express";
import { db, webhooksTable, callbackLogsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";

const router = Router();
router.use(requireAuth);

// GET /api/webhooks/logs — recent delivery logs for the merchant
router.get("/logs", async (req, res) => {
  const user = (req as any).user;
  const merchantId = user.role === "merchant" ? user.merchantId! : undefined;
  if (!merchantId) {
    res.status(403).json({ error: "Merchants only" });
    return;
  }

  const limitNum = Math.min(50, Math.max(1, parseInt((req.query['limit'] as string) || "10")));

  const data = await db
    .select()
    .from(callbackLogsTable)
    .where(eq(callbackLogsTable.merchantId, merchantId))
    .orderBy(sql`${callbackLogsTable.createdAt} DESC`)
    .limit(limitNum);

  res.json({ data, total: data.length, page: 1, limit: limitNum });
});

// GET /api/webhooks
router.get("/", async (req, res) => {
  const user = (req as any).user;
  const merchantId = user.role === "merchant" ? user.merchantId! : undefined;
  if (!merchantId) {
    res.status(403).json({ error: "Merchants only" });
    return;
  }
  const [webhook] = await db.select().from(webhooksTable).where(eq(webhooksTable.merchantId, merchantId)).limit(1);
  if (!webhook) {
    res.json({ id: 0, merchantId, url: "", isActive: false, events: [], secret: null, createdAt: new Date().toISOString() });
    return;
  }
  res.json(webhook);
});

// PUT /api/webhooks
router.put("/", async (req, res) => {
  const user = (req as any).user;
  const merchantId = user.role === "merchant" ? user.merchantId! : undefined;
  if (!merchantId) {
    res.status(403).json({ error: "Merchants only" });
    return;
  }
  const { url, isActive, events, secret } = req.body;
  if (!url || !Array.isArray(events)) {
    res.status(400).json({ error: "url and events required" });
    return;
  }
  // Upsert
  const existing = await db.select().from(webhooksTable).where(eq(webhooksTable.merchantId, merchantId)).limit(1);
  let webhook;
  if (existing.length > 0) {
    [webhook] = await db
      .update(webhooksTable)
      .set({ url, isActive: isActive ?? true, events, secret: secret ?? null })
      .where(eq(webhooksTable.merchantId, merchantId))
      .returning();
  } else {
    [webhook] = await db
      .insert(webhooksTable)
      .values({ merchantId, url, isActive: isActive ?? true, events, secret: secret ?? null })
      .returning();
  }
  res.json(webhook);
});

export default router;
