import { Router } from "express";
import { db, merchantConnectionsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";

const router = Router();
router.use(requireAuth);

function formatConn(c: typeof merchantConnectionsTable.$inferSelect) {
  return { ...c, monthlyLimit: Number(c.monthlyLimit) };
}

// GET /api/connections
router.get("/", async (req, res) => {
  const user = (req as any).user;
  const merchantId: number = user.role === "admin" ? (req.query.merchantId ? parseInt(req.query.merchantId as string) : 0) : user.merchantId!;
  if (!merchantId) { res.json([]); return; }
  const rows = await db.select().from(merchantConnectionsTable).where(eq(merchantConnectionsTable.merchantId, merchantId));
  res.json(rows.map(formatConn));
});

// POST /api/connections  (upsert by provider)
router.post("/", async (req, res) => {
  const user = (req as any).user;
  const merchantId: number = user.merchantId!;
  const { provider, credentials, monthlyLimit = 0, isActive = true } = req.body;
  if (!provider) { res.status(400).json({ error: "Provider required" }); return; }

  const existing = await db.select().from(merchantConnectionsTable)
    .where(and(eq(merchantConnectionsTable.merchantId, merchantId), eq(merchantConnectionsTable.provider, provider)))
    .limit(1);

  let result;
  if (existing.length > 0) {
    [result] = await db.update(merchantConnectionsTable)
      .set({ credentials: credentials ?? null, monthlyLimit: String(monthlyLimit), isActive: !!isActive })
      .where(and(eq(merchantConnectionsTable.merchantId, merchantId), eq(merchantConnectionsTable.provider, provider)))
      .returning();
  } else {
    [result] = await db.insert(merchantConnectionsTable)
      .values({ merchantId, provider, credentials: credentials ?? null, monthlyLimit: String(monthlyLimit), isActive: !!isActive })
      .returning();
  }
  res.json(formatConn(result));
});

// PUT /api/connections/:id
router.put("/:id", async (req, res) => {
  const user = (req as any).user;
  const merchantId: number = user.merchantId!;
  const id = parseInt(req.params.id);
  const { provider, credentials, monthlyLimit, isActive } = req.body;

  const update: Record<string, unknown> = {};
  if (provider !== undefined) update.provider = provider;
  if (credentials !== undefined) update.credentials = credentials;
  if (monthlyLimit !== undefined) update.monthlyLimit = String(monthlyLimit);
  if (isActive !== undefined) update.isActive = !!isActive;

  const [result] = await db.update(merchantConnectionsTable)
    .set(update)
    .where(and(eq(merchantConnectionsTable.id, id), eq(merchantConnectionsTable.merchantId, merchantId)))
    .returning();

  if (!result) { res.status(404).json({ error: "Connection not found" }); return; }
  res.json(formatConn(result));
});

// DELETE /api/connections/:id
router.delete("/:id", async (req, res) => {
  const user = (req as any).user;
  const merchantId: number = user.merchantId!;
  const id = parseInt(req.params.id);
  await db.delete(merchantConnectionsTable)
    .where(and(eq(merchantConnectionsTable.id, id), eq(merchantConnectionsTable.merchantId, merchantId)));
  res.json({ message: "Connection deleted" });
});

export default router;
