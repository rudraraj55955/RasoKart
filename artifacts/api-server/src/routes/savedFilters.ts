import { Router } from "express";
import { db, savedFiltersTable } from "@workspace/db";
import { eq, and, asc, sql } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";

const router = Router();
router.use(requireAuth, requireAdmin);

function mapFilter(row: typeof savedFiltersTable.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    rawInput: row.rawInput,
    filterData: row.filterData,
    sortOrder: row.sortOrder ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

// GET /api/saved-filters
router.get("/", async (req, res, next) => {
  try {
    const user = (req as any).user;
    const rows = await db.select().from(savedFiltersTable)
      .where(eq(savedFiltersTable.userId, user.id))
      .orderBy(
        sql`${savedFiltersTable.sortOrder} ASC NULLS LAST`,
        asc(savedFiltersTable.createdAt),
      );
    res.json({ data: rows.map(mapFilter) });
  } catch (err) {
    next(err);
  }
});

// POST /api/saved-filters
router.post("/", async (req, res, next) => {
  try {
    const user = (req as any).user;
    const { name, rawInput, filterData } = req.body;
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

    const existing = await db.select({ id: savedFiltersTable.id })
      .from(savedFiltersTable)
      .where(and(
        eq(savedFiltersTable.userId, user.id),
        eq(savedFiltersTable.name, name.trim()),
      ))
      .limit(1);

    if (existing.length > 0) {
      res.status(409).json({ error: "A filter with this name already exists" });
      return;
    }

    const maxOrderRows = await db
      .select({ maxOrder: sql<number>`COALESCE(MAX(${savedFiltersTable.sortOrder}), -1)` })
      .from(savedFiltersTable)
      .where(eq(savedFiltersTable.userId, user.id));

    const nextOrder = (maxOrderRows[0]?.maxOrder ?? -1) + 1;

    const [inserted] = await db.insert(savedFiltersTable).values({
      userId: user.id,
      name: name.trim(),
      rawInput: rawInput.trim(),
      filterData,
      sortOrder: nextOrder,
    }).returning();

    res.status(201).json(mapFilter(inserted!));
  } catch (err) {
    next(err);
  }
});

// PUT /api/saved-filters/reorder
router.put("/reorder", async (req, res, next) => {
  try {
    const user = (req as any).user;
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.some((id) => typeof id !== "number" || !Number.isInteger(id))) {
      res.status(400).json({ error: "ids must be an array of integers" });
      return;
    }

    const owned = await db.select({ id: savedFiltersTable.id })
      .from(savedFiltersTable)
      .where(eq(savedFiltersTable.userId, user.id));

    const ownedSet = new Set(owned.map((r) => r.id));
    for (const id of ids) {
      if (!ownedSet.has(id)) {
        res.status(400).json({ error: `Filter id ${id} not found or not owned by you` });
        return;
      }
    }

    await Promise.all(
      ids.map((id, index) =>
        db.update(savedFiltersTable)
          .set({ sortOrder: index })
          .where(and(eq(savedFiltersTable.id, id), eq(savedFiltersTable.userId, user.id)))
      )
    );

    res.json({ message: "Filters reordered" });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/saved-filters/:id — rename
router.patch("/:id", async (req, res, next) => {
  try {
    const user = (req as any).user;
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
    if (name.trim().length > 40) {
      res.status(400).json({ error: "name must be 40 characters or fewer" });
      return;
    }

    const duplicate = await db.select({ id: savedFiltersTable.id })
      .from(savedFiltersTable)
      .where(and(
        eq(savedFiltersTable.userId, user.id),
        eq(savedFiltersTable.name, name.trim()),
      ))
      .limit(1);

    if (duplicate.length > 0 && duplicate[0]!.id !== id) {
      res.status(409).json({ error: "A filter with this name already exists" });
      return;
    }

    const [updated] = await db.update(savedFiltersTable)
      .set({ name: name.trim() })
      .where(and(eq(savedFiltersTable.id, id), eq(savedFiltersTable.userId, user.id)))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Saved filter not found" });
      return;
    }

    res.json(mapFilter(updated));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/saved-filters/:id
router.delete("/:id", async (req, res, next) => {
  try {
    const user = (req as any).user;
    const id = parseInt(req.params['id'] as string);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const deleted = await db.delete(savedFiltersTable)
      .where(and(eq(savedFiltersTable.id, id), eq(savedFiltersTable.userId, user.id)))
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
