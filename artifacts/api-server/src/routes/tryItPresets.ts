import { Router } from "express";
import { db, merchantTryItPresetsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";

const router = Router();
router.use(requireAuth);

function getMerchantId(req: any): number | null {
  return req.user?.merchantId ?? null;
}

// GET /api/merchant/tryit-presets
router.get("/", async (req, res, next) => {
  try {
    const merchantId = getMerchantId(req);
    if (merchantId == null) {
      res.status(403).json({ error: "Not a merchant account" });
      return;
    }
    const [row] = await db
      .select()
      .from(merchantTryItPresetsTable)
      .where(eq(merchantTryItPresetsTable.merchantId, merchantId))
      .limit(1);
    const presets = row?.presets ?? {};
    res.json({ data: presets });
  } catch (err) {
    next(err);
  }
});

// PUT /api/merchant/tryit-presets
router.put("/", async (req, res, next) => {
  try {
    const merchantId = getMerchantId(req);
    if (merchantId == null) {
      res.status(403).json({ error: "Not a merchant account" });
      return;
    }
    const { presets } = req.body;
    if (!presets || typeof presets !== "object" || Array.isArray(presets)) {
      res.status(400).json({ error: "presets must be an object" });
      return;
    }
    const [upserted] = await db
      .insert(merchantTryItPresetsTable)
      .values({ merchantId, presets, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: merchantTryItPresetsTable.merchantId,
        set: { presets, updatedAt: new Date() },
      })
      .returning();
    res.json({ data: upserted!.presets });
  } catch (err) {
    next(err);
  }
});

export default router;
