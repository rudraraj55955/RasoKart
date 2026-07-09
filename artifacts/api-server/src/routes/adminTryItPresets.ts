import { Router } from "express";
import { db, adminTryItPresetsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";

const router = Router();
router.use(requireAuth);
router.use(requireAdmin);

// Keep these in sync with the client-side constants in
// artifacts/rpay/src/pages/admin/api-docs.tsx — the client enforces the
// same caps before saving so users get instant feedback, but the server is
// the source of truth and rejects anything over the limit regardless.
const MAX_TOTAL_PRESETS = 100;
const MAX_PRESETS_PER_ENDPOINT = 20;

function getUserId(req: any): number | null {
  return req.user?.id ?? null;
}

// GET /api/admin/tryit-presets
router.get("/", async (req, res, next) => {
  try {
    const userId = getUserId(req);
    if (userId == null) {
      res.status(403).json({ error: "Not an admin account" });
      return;
    }
    const [row] = await db
      .select()
      .from(adminTryItPresetsTable)
      .where(eq(adminTryItPresetsTable.userId, userId))
      .limit(1);
    const presets = row?.presets ?? {};
    res.json({ data: presets });
  } catch (err) {
    next(err);
  }
});

// PUT /api/admin/tryit-presets
router.put("/", async (req, res, next) => {
  try {
    const userId = getUserId(req);
    if (userId == null) {
      res.status(403).json({ error: "Not an admin account" });
      return;
    }
    const { presets } = req.body;
    if (!presets || typeof presets !== "object" || Array.isArray(presets)) {
      res.status(400).json({ error: "presets must be an object" });
      return;
    }

    let totalCount = 0;
    for (const [key, value] of Object.entries(presets as Record<string, unknown>)) {
      if (!Array.isArray(value)) {
        res.status(400).json({ error: `presets["${key}"] must be an array` });
        return;
      }
      if (value.length > MAX_PRESETS_PER_ENDPOINT) {
        res.status(400).json({
          error: `Too many saved presets for "${key}" (${value.length}/${MAX_PRESETS_PER_ENDPOINT}). Delete some unused presets for this endpoint before saving more.`,
          code: "PRESET_ENDPOINT_CAP_EXCEEDED",
        });
        return;
      }
      totalCount += value.length;
    }
    if (totalCount > MAX_TOTAL_PRESETS) {
      res.status(400).json({
        error: `Too many saved presets overall (${totalCount}/${MAX_TOTAL_PRESETS}). Delete some unused presets before saving more.`,
        code: "PRESET_TOTAL_CAP_EXCEEDED",
      });
      return;
    }

    const [upserted] = await db
      .insert(adminTryItPresetsTable)
      .values({ userId, presets, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: adminTryItPresetsTable.userId,
        set: { presets, updatedAt: new Date() },
      })
      .returning();
    res.json({ data: upserted!.presets });
  } catch (err) {
    next(err);
  }
});

export default router;
