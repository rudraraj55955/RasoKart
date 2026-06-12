import { Router } from "express";
import { db, savedFiltersTable } from "@workspace/db";
import { eq, and, inArray, isNotNull } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";

const router = Router();
router.use(requireAuth);

function mapFilter(row: typeof savedFiltersTable.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    rawInput: row.rawInput,
    filterData: row.filterData,
    context: row.context,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
  };
}

function getMerchantId(req: any): number | null {
  const user = req.user;
  return user?.merchantId ?? null;
}

// GET /api/merchant/saved-filters?context=<ctx>
router.get("/", async (req, res, next) => {
  try {
    const merchantId = getMerchantId(req);
    if (merchantId == null) {
      res.status(403).json({ error: "Not a merchant account" });
      return;
    }
    const context = (req.query["context"] as string) ?? "";
    const rows = await db.select().from(savedFiltersTable)
      .where(and(
        eq(savedFiltersTable.merchantId, merchantId),
        eq(savedFiltersTable.context, context),
      ))
      .orderBy(savedFiltersTable.sortOrder, savedFiltersTable.createdAt);
    res.json({ data: rows.map(mapFilter) });
  } catch (err) {
    next(err);
  }
});

// POST /api/merchant/saved-filters
router.post("/", async (req, res, next) => {
  try {
    const merchantId = getMerchantId(req);
    if (merchantId == null) {
      res.status(403).json({ error: "Not a merchant account" });
      return;
    }
    const user = (req as any).user;
    const { name, rawInput, filterData, context } = req.body;
    if (!name?.trim()) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    if (!rawInput?.trim()) {
      res.status(400).json({ error: "rawInput is required" });
      return;
    }
    if (!filterData || typeof filterData !== "object") {
      res.status(400).json({ error: "filterData is required" });
      return;
    }
    const ctx = context ?? "";

    const existing = await db.select({ id: savedFiltersTable.id })
      .from(savedFiltersTable)
      .where(and(
        eq(savedFiltersTable.merchantId, merchantId),
        eq(savedFiltersTable.context, ctx),
        eq(savedFiltersTable.name, name.trim()),
      ))
      .limit(1);

    if (existing.length > 0) {
      res.status(409).json({ error: "A filter with this name already exists" });
      return;
    }

    const maxOrderRow = await db.select({ sortOrder: savedFiltersTable.sortOrder })
      .from(savedFiltersTable)
      .where(and(
        eq(savedFiltersTable.merchantId, merchantId),
        eq(savedFiltersTable.context, ctx),
      ))
      .orderBy(savedFiltersTable.sortOrder)
      .limit(1000);

    const maxOrder = maxOrderRow.length > 0
      ? Math.max(...maxOrderRow.map(r => r.sortOrder))
      : -1;

    const [inserted] = await db.insert(savedFiltersTable).values({
      userId: user.id,
      merchantId,
      name: name.trim(),
      rawInput: rawInput.trim(),
      filterData,
      context: ctx,
      sortOrder: maxOrder + 1,
    }).returning();

    res.status(201).json(mapFilter(inserted!));
  } catch (err) {
    next(err);
  }
});

// PUT /api/merchant/saved-filters/reorder — must be registered before /:id
router.put("/reorder", async (req, res, next) => {
  try {
    const merchantId = getMerchantId(req);
    if (merchantId == null) {
      res.status(403).json({ error: "Not a merchant account" });
      return;
    }
    const { ids, context } = req.body;
    if (!Array.isArray(ids) || ids.some((x: unknown) => typeof x !== "number")) {
      res.status(400).json({ error: "ids must be an array of integers" });
      return;
    }
    const ctx = context ?? "";

    const owned = await db.select({ id: savedFiltersTable.id })
      .from(savedFiltersTable)
      .where(and(
        eq(savedFiltersTable.merchantId, merchantId),
        eq(savedFiltersTable.context, ctx),
        inArray(savedFiltersTable.id, ids as number[]),
      ));
    const ownedIds = new Set(owned.map(r => r.id));
    const safeIds = (ids as number[]).filter(id => ownedIds.has(id));

    for (let i = 0; i < safeIds.length; i++) {
      await db.update(savedFiltersTable)
        .set({ sortOrder: i })
        .where(eq(savedFiltersTable.id, safeIds[i]!));
    }

    res.json({ message: "Reordered" });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/merchant/saved-filters/:id — rename
router.patch("/:id", async (req, res, next) => {
  try {
    const merchantId = getMerchantId(req);
    if (merchantId == null) {
      res.status(403).json({ error: "Not a merchant account" });
      return;
    }
    const id = parseInt(req.params['id'] as string);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const { name } = req.body;
    if (!name?.trim()) {
      res.status(400).json({ error: "name is required" });
      return;
    }

    const [row] = await db.select()
      .from(savedFiltersTable)
      .where(and(eq(savedFiltersTable.id, id), eq(savedFiltersTable.merchantId, merchantId)))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: "Saved filter not found" });
      return;
    }

    const duplicate = await db.select({ id: savedFiltersTable.id })
      .from(savedFiltersTable)
      .where(and(
        eq(savedFiltersTable.merchantId, merchantId),
        eq(savedFiltersTable.context, row.context),
        eq(savedFiltersTable.name, name.trim()),
      ))
      .limit(1);

    if (duplicate.length > 0 && duplicate[0]!.id !== id) {
      res.status(409).json({ error: "A filter with this name already exists" });
      return;
    }

    const [updated] = await db.update(savedFiltersTable)
      .set({ name: name.trim() })
      .where(eq(savedFiltersTable.id, id))
      .returning();

    res.json(mapFilter(updated!));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/merchant/saved-filters/:id
router.delete("/:id", async (req, res, next) => {
  try {
    const merchantId = getMerchantId(req);
    if (merchantId == null) {
      res.status(403).json({ error: "Not a merchant account" });
      return;
    }
    const id = parseInt(req.params['id'] as string);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const deleted = await db.delete(savedFiltersTable)
      .where(and(eq(savedFiltersTable.id, id), eq(savedFiltersTable.merchantId, merchantId)))
      .returning({ id: savedFiltersTable.id });

    if (deleted.length === 0) {
      res.status(404).json({ error: "Saved filter not found" });
      return;
    }

    res.json({ message: "Saved filter deleted" });
  } catch (err) {
    next(err);
  }
});

export default router;
