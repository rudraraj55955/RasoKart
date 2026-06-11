import { Router } from "express";
import { db, merchantFilterPresetsTable, merchantsTable } from "@workspace/db";
import { eq, and, asc } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";

const router = Router();
router.use(requireAuth);

function mapPreset(row: typeof merchantFilterPresetsTable.$inferSelect) {
  return {
    id: row.id,
    merchantId: row.merchantId,
    name: row.name,
    presetType: row.presetType,
    payload: row.payload,
    createdAt: row.createdAt.toISOString(),
  };
}

// GET /api/merchant/filter-presets
router.get("/", async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (!user.merchantId) {
      res.status(403).json({ error: "Merchant account required" });
      return;
    }
    const rows = await db.select().from(merchantFilterPresetsTable)
      .where(eq(merchantFilterPresetsTable.merchantId, user.merchantId))
      .orderBy(asc(merchantFilterPresetsTable.createdAt));
    res.json({ data: rows.map(mapPreset) });
  } catch (err) {
    next(err);
  }
});

// POST /api/merchant/filter-presets
router.post("/", async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (!user.merchantId) {
      res.status(403).json({ error: "Merchant account required" });
      return;
    }
    const { name, presetType, payload } = req.body;
    if (!name?.trim()) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    const validTypes = ["combined", "smart", "date"];
    if (!presetType || !validTypes.includes(presetType)) {
      res.status(400).json({ error: "presetType must be one of: combined, smart, date" });
      return;
    }
    if (!payload || typeof payload !== "object") {
      res.status(400).json({ error: "payload is required and must be an object" });
      return;
    }

    const existing = await db.select({ id: merchantFilterPresetsTable.id })
      .from(merchantFilterPresetsTable)
      .where(and(
        eq(merchantFilterPresetsTable.merchantId, user.merchantId),
        eq(merchantFilterPresetsTable.name, name.trim()),
        eq(merchantFilterPresetsTable.presetType, presetType),
      ))
      .limit(1);

    if (existing.length > 0) {
      res.status(409).json({ error: "A preset with this name already exists" });
      return;
    }

    const [inserted] = await db.insert(merchantFilterPresetsTable).values({
      merchantId: user.merchantId,
      name: name.trim(),
      presetType,
      payload,
    }).returning();

    res.status(201).json(mapPreset(inserted!));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/merchant/filter-presets/:id
router.delete("/:id", async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (!user.merchantId) {
      res.status(403).json({ error: "Merchant account required" });
      return;
    }
    const id = parseInt(req.params['id'] as string);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const deleted = await db.delete(merchantFilterPresetsTable)
      .where(and(
        eq(merchantFilterPresetsTable.id, id),
        eq(merchantFilterPresetsTable.merchantId, user.merchantId),
      ))
      .returning({ id: merchantFilterPresetsTable.id });

    if (deleted.length === 0) {
      res.status(404).json({ error: "Filter preset not found" });
      return;
    }

    res.json({ message: "Filter preset deleted" });
  } catch (err) {
    next(err);
  }
});

export default router;
