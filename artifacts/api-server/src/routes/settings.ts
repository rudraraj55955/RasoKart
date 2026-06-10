import { Router } from "express";
import { db, systemSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";

const router = Router();
router.use(requireAuth);
router.use(requireAdmin);

const ALLOWED_KEYS = ["finance_report_email"] as const;
type SettingKey = (typeof ALLOWED_KEYS)[number];

// GET /api/settings
router.get("/", async (req, res, next) => {
  try {
    const rows = await db
      .select()
      .from(systemSettingsTable)
      .where(eq(systemSettingsTable.key, "finance_report_email"));

    const result: Record<string, string | null> = {};
    for (const key of ALLOWED_KEYS) {
      const row = rows.find(r => r.key === key);
      result[key] = row?.value ?? null;
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// PUT /api/settings/:key
router.put("/:key", async (req, res, next) => {
  try {
    const key = req.params['key'] as string;
    const user = (req as any).user;

    if (!ALLOWED_KEYS.includes(key as SettingKey)) {
      res.status(400).json({ error: `Unknown setting key: ${key}` });
      return;
    }

    const { value } = req.body;

    if (key === "finance_report_email" && value !== null && value !== "") {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (typeof value !== "string" || !emailRegex.test(value)) {
        res.status(400).json({ error: "Invalid email address" });
        return;
      }
    }

    const normalized = (value === null || value === "") ? null : String(value).trim();

    await db
      .insert(systemSettingsTable)
      .values({ key, value: normalized, updatedBy: user.id, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: systemSettingsTable.key,
        set: { value: normalized, updatedBy: user.id, updatedAt: new Date() },
      });

    res.json({ key, value: normalized });
  } catch (err) {
    next(err);
  }
});

export default router;
