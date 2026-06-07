import { Router } from "express";
import { db, webhooksTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";

const router = Router();
router.use(requireAuth);

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
