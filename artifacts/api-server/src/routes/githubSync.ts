import { Router } from "express";
import { readFileSync } from "fs";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { db, systemSettingsTable, auditLogsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

const router = Router();
router.use(requireAuth);
router.use(requireAdmin);

const STATUS_FILE = new URL("../../../.github-sync-status.json", import.meta.url).pathname;

const GITHUB_SYNC_KEYS = ["github_sync_enabled", "github_sync_schedule"] as const;

// GET /api/github-sync/config
router.get("/config", async (req, res, next) => {
  try {
    const rows = await db
      .select()
      .from(systemSettingsTable)
      .where(inArray(systemSettingsTable.key, [...GITHUB_SYNC_KEYS]));

    const map = Object.fromEntries(rows.map(r => [r.key, r.value]));

    const rawEnabled = map["github_sync_enabled"];
    const enabled = rawEnabled === null || rawEnabled === undefined ? true : rawEnabled === "true";
    const schedule = map["github_sync_schedule"] ?? "0 2 * * *";

    res.json({ enabled, schedule });
  } catch (err) {
    next(err);
  }
});

// PUT /api/github-sync/config
router.put("/config", async (req, res, next) => {
  try {
    const user = (req as any).user;
    const { enabled, schedule } = req.body as { enabled?: boolean; schedule?: string };

    if (enabled !== undefined && typeof enabled !== "boolean") {
      res.status(400).json({ error: "enabled must be a boolean" });
      return;
    }

    if (schedule !== undefined) {
      if (typeof schedule !== "string") {
        res.status(400).json({ error: "schedule must be a string" });
        return;
      }
      const trimmed = schedule.trim();
      if (trimmed.length > 0) {
        const parts = trimmed.split(/\s+/);
        if (parts.length !== 5) {
          res.status(400).json({ error: "schedule must be a valid 5-part cron expression (e.g. \"0 2 * * *\")" });
          return;
        }
      }
    }

    const now = new Date();
    const upserts: Array<{ key: string; value: string }> = [];

    if (enabled !== undefined) {
      upserts.push({ key: "github_sync_enabled", value: enabled ? "true" : "false" });
    }
    if (schedule !== undefined) {
      upserts.push({ key: "github_sync_schedule", value: schedule.trim() || "0 2 * * *" });
    }

    for (const { key, value } of upserts) {
      await db
        .insert(systemSettingsTable)
        .values({ key, value, updatedBy: user.id, updatedAt: now })
        .onConflictDoUpdate({
          target: systemSettingsTable.key,
          set: { value, updatedBy: user.id, updatedAt: now },
        });
    }

    try {
      await db.insert(auditLogsTable).values({
        adminId: user.id,
        adminEmail: user.email,
        action: "setting_updated",
        targetType: "system_config",
        targetId: null,
        details: JSON.stringify({ keys: upserts.map(u => u.key), changes: Object.fromEntries(upserts.map(u => [u.key, u.value])) }),
        ipAddress: req.ip ?? null,
      });
    } catch (auditErr) {
      req.log.error({ err: auditErr }, "Failed to write audit log for github_sync config update");
    }

    const rows = await db
      .select()
      .from(systemSettingsTable)
      .where(inArray(systemSettingsTable.key, [...GITHUB_SYNC_KEYS]));

    const map = Object.fromEntries(rows.map(r => [r.key, r.value]));
    const rawEnabled = map["github_sync_enabled"];
    const finalEnabled = rawEnabled === null || rawEnabled === undefined ? true : rawEnabled === "true";
    const finalSchedule = map["github_sync_schedule"] ?? "0 2 * * *";

    res.json({ enabled: finalEnabled, schedule: finalSchedule });
  } catch (err) {
    next(err);
  }
});

// GET /api/github-sync/status
router.get("/status", (req, res, next) => {
  try {
    let payload: Record<string, string>;
    try {
      const raw = readFileSync(STATUS_FILE, "utf-8");
      payload = JSON.parse(raw) as Record<string, string>;
    } catch {
      payload = { status: "never" };
    }
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

export default router;
