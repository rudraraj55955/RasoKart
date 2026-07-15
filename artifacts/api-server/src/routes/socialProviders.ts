/**
 * Super Admin routes for managing social provider on/off toggles.
 *
 * GET  /api/auth/social-providers         — public list of enabled providers
 * GET  /api/auth/social-providers/admin   — full list with enabled flag (admin only)
 * PUT  /api/auth/social-providers/:provider — toggle a provider (super admin only)
 */

import { Router } from "express";
import { db, socialProviderSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { logger } from "../lib/logger";

const router = Router();

const KNOWN_PROVIDERS = ["google", "apple", "microsoft", "facebook"] as const;
type Provider = (typeof KNOWN_PROVIDERS)[number];

// GET /api/auth/social-providers — public, returns only enabled providers
router.get("/", async (req, res, next) => {
  try {
    const rows = await db
      .select({ provider: socialProviderSettingsTable.provider, enabled: socialProviderSettingsTable.enabled })
      .from(socialProviderSettingsTable);

    const enabled = rows
      .filter(r => r.enabled)
      .map(r => r.provider);

    res.json({ providers: enabled });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/social-providers/admin — full list with status (admin only)
router.get("/admin", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const rows = await db
      .select()
      .from(socialProviderSettingsTable)
      .orderBy(socialProviderSettingsTable.provider);

    // Fill in any providers missing from the table
    const existing = new Map(rows.map(r => [r.provider, r]));
    const result = KNOWN_PROVIDERS.map(p => ({
      provider: p,
      enabled: existing.get(p)?.enabled ?? false,
      updatedAt: existing.get(p)?.updatedAt ?? null,
      updatedByEmail: existing.get(p)?.updatedByEmail ?? null,
    }));

    res.json({ providers: result });
  } catch (err) {
    next(err);
  }
});

// PUT /api/auth/social-providers/:provider — super admin only
router.put("/:provider", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const admin = (req as any).user;
    if (!admin?.isSuperAdmin) {
      res.status(403).json({ error: "Super Admin access required." });
      return;
    }

    const provider = req.params["provider"] as string;
    if (!(KNOWN_PROVIDERS as readonly string[]).includes(provider)) {
      res.status(400).json({ error: `Unknown provider. Must be one of: ${KNOWN_PROVIDERS.join(", ")}` });
      return;
    }

    const { enabled } = req.body as { enabled?: unknown };
    if (typeof enabled !== "boolean") {
      res.status(400).json({ error: "enabled (boolean) is required" });
      return;
    }

    await db
      .insert(socialProviderSettingsTable)
      .values({
        provider: provider as Provider,
        enabled,
        updatedByEmail: admin.email,
      })
      .onConflictDoUpdate({
        target: socialProviderSettingsTable.provider,
        set: {
          enabled,
          updatedAt: new Date(),
          updatedByEmail: admin.email,
        },
      });

    req.log.info({ provider, enabled, adminEmail: admin.email }, "social_provider_toggled");

    res.json({ provider, enabled });
  } catch (err) {
    next(err);
  }
});

export default router;
