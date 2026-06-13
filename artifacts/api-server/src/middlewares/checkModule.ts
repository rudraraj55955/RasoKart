import { db, moduleControlsTable, moduleVisibilityTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import type { Request, Response, NextFunction } from "express";

const DISABLED_MESSAGE =
  "This service is currently not enabled for your account. Please contact RasoKart support.";

/**
 * requireModule(moduleName) — Express middleware factory.
 *
 * Checks if the given module is enabled globally AND for the calling merchant.
 * Admin users bypass all module restrictions.
 * If no DB record exists for a module, it is treated as enabled (fail-open default).
 */
export function requireModule(moduleName: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = (req as any).user as { role?: string; merchantId?: number | null } | undefined;

      // Admins bypass all module restrictions
      if (user?.role === "admin") { next(); return; }

      // 1. Check global module state
      const [globalRow] = await db
        .select({ enabled: moduleControlsTable.enabled })
        .from(moduleControlsTable)
        .where(eq(moduleControlsTable.moduleName, moduleName))
        .limit(1);

      if (globalRow && !globalRow.enabled) {
        res.status(403).json({ error: DISABLED_MESSAGE });
        return;
      }

      // 2. Check per-merchant override (if merchant user)
      if (user?.merchantId) {
        const [overrideRow] = await db
          .select({ enabled: moduleVisibilityTable.enabled })
          .from(moduleVisibilityTable)
          .where(
            and(
              eq(moduleVisibilityTable.moduleName, moduleName),
              eq(moduleVisibilityTable.entityType, "merchant"),
              eq(moduleVisibilityTable.entityId, user.merchantId)
            )
          )
          .limit(1);

        if (overrideRow && !overrideRow.enabled) {
          res.status(403).json({ error: DISABLED_MESSAGE });
          return;
        }
      }

      next();
    } catch {
      // Fail-open: if module check errors, don't block the request
      next();
    }
  };
}
