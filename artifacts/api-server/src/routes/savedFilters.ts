import { Router } from "express";
import { db, savedFiltersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";

const router = Router();
router.use(requireAuth, requireAdmin);

function mapFilter(row: typeof savedFiltersTable.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    rawInput: row.rawInput,
    filterData: row.filterData,
    createdAt: row.createdAt.toISOString(),
  };
}

// GET /api/saved-filters
router.get("/", async (req, res, next) => {
  try {
    const user = (req as any).user;
    const rows = await db.select().from(savedFiltersTable)
      .where(eq(savedFiltersTable.userId, user.id))
      .orderBy(savedFiltersTable.createdAt);
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

    const [inserted] = await db.insert(savedFiltersTable).values({
      userId: user.id,
      name: name.trim(),
      rawInput: rawInput.trim(),
      filterData,
    }).returning();

    res.status(201).json(mapFilter(inserted!));
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
