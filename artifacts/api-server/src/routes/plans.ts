import { Router } from "express";
import { db, plansTable, merchantPlansTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";

const router = Router();
router.use(requireAuth);

// GET /api/plans/me — current merchant's assigned plan
router.get("/me", async (req, res) => {
  const user = (req as any).user;
  if (!user.merchantId) { res.status(404).json({ error: "No plan assigned" }); return; }

  const rows = await db
    .select({ mp: merchantPlansTable, plan: plansTable })
    .from(merchantPlansTable)
    .leftJoin(plansTable, eq(merchantPlansTable.planId, plansTable.id))
    .where(eq(merchantPlansTable.merchantId, user.merchantId))
    .limit(1);

  if (rows.length === 0 || !rows[0].plan) { res.status(404).json({ error: "No plan assigned" }); return; }
  const { mp, plan } = rows[0];
  res.json({
    id: mp.id,
    merchantId: mp.merchantId,
    planId: mp.planId,
    planName: plan!.name,
    description: plan!.description ?? null,
    pricing: plan!.pricing,
    features: plan!.features,
    assignedAt: mp.assignedAt,
  });
});

// GET /api/plans  (any authenticated user)
router.get("/", async (_req, res) => {
  const rows = await db.select().from(plansTable).orderBy(plansTable.id);
  res.json(rows);
});

// POST /api/plans (admin only)
router.post("/", requireAdmin, async (req, res) => {
  const { name, description, pricing, features } = req.body;
  if (!name || !pricing || !features) { res.status(400).json({ error: "name, pricing, features required" }); return; }
  const [row] = await db.insert(plansTable).values({ name, description: description ?? null, pricing, features }).returning();
  res.status(201).json(row);
});

// PUT /api/plans/:id (admin only)
router.put("/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params['id'] as string);
  const { name, description, pricing, features } = req.body;
  const update: Record<string, unknown> = {};
  if (name !== undefined) update.name = name;
  if (description !== undefined) update.description = description;
  if (pricing !== undefined) update.pricing = pricing;
  if (features !== undefined) update.features = features;
  const [row] = await db.update(plansTable).set(update).where(eq(plansTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Plan not found" }); return; }
  res.json(row);
});

// DELETE /api/plans/:id (admin only)
router.delete("/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params['id'] as string);
  await db.delete(merchantPlansTable).where(eq(merchantPlansTable.planId, id));
  await db.delete(plansTable).where(eq(plansTable.id, id));
  res.json({ message: "Plan deleted" });
});

export default router;
