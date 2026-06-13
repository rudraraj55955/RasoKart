/**
 * Merchant-facing module status endpoint.
 * Returns which of the 15 platform modules are enabled for the calling merchant.
 * Considers: global enabled state AND any per-merchant override.
 *
 * GET /api/merchant/module-status → { [moduleName]: boolean }
 */
import { Router } from "express";
import { db, moduleControlsTable, moduleVisibilityTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { MODULE_NAMES } from "./moduleControl";

const router = Router();

router.get("/module-status", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const merchantId: number | null | undefined = user?.merchantId;

    // Fetch all global module settings
    const globalRows = await db.select({
      moduleName: moduleControlsTable.moduleName,
      enabled:    moduleControlsTable.enabled,
    }).from(moduleControlsTable);
    const globalMap = new Map(globalRows.map(r => [r.moduleName, r.enabled]));

    // Fetch merchant-specific overrides
    const overrides = merchantId != null
      ? await db.select({
          moduleName: moduleVisibilityTable.moduleName,
          enabled:    moduleVisibilityTable.enabled,
        }).from(moduleVisibilityTable).where(
          and(
            eq(moduleVisibilityTable.entityType, "merchant"),
            eq(moduleVisibilityTable.entityId, merchantId),
          )
        )
      : [];
    const overrideMap = new Map(overrides.map(r => [r.moduleName, r.enabled]));

    // Build status: override takes precedence over global; global defaults to true if not set
    const status: Record<string, boolean> = {};
    for (const name of MODULE_NAMES) {
      const globalEnabled   = globalMap.get(name) ?? true;
      const overrideEnabled = overrideMap.get(name);
      status[name] = overrideEnabled !== undefined ? overrideEnabled : globalEnabled;
    }

    res.json(status);
  } catch (err) { next(err); }
});

export default router;
