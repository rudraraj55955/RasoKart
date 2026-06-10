import { Router } from "express";
import { db, systemConfigTable, SYSTEM_CONFIG_KEYS, SYSTEM_CONFIG_DEFAULTS, auditLogsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { rescheduleFromDb } from "../helpers/reconScheduler";
import { sql } from "drizzle-orm";

const router = Router();
router.use(requireAuth, requireAdmin);

async function getReconConfig() {
  const keys = [
    SYSTEM_CONFIG_KEYS.RECONCILIATION_HOUR,
    SYSTEM_CONFIG_KEYS.RECONCILIATION_MINUTE,
    SYSTEM_CONFIG_KEYS.RECONCILIATION_LOOKBACK_DAYS,
  ];

  const rows = await db
    .select()
    .from(systemConfigTable)
    .where(inArray(systemConfigTable.key, keys));

  const map = new Map(rows.map((r) => [r.key, r.value]));

  return {
    hour: parseInt(
      map.get(SYSTEM_CONFIG_KEYS.RECONCILIATION_HOUR) ??
        SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.RECONCILIATION_HOUR]
    ),
    minute: parseInt(
      map.get(SYSTEM_CONFIG_KEYS.RECONCILIATION_MINUTE) ??
        SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.RECONCILIATION_MINUTE]
    ),
    lookbackDays: parseInt(
      map.get(SYSTEM_CONFIG_KEYS.RECONCILIATION_LOOKBACK_DAYS) ??
        SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.RECONCILIATION_LOOKBACK_DAYS]
    ),
  };
}

// GET /api/system-config/reconciliation
router.get("/reconciliation", async (req, res, next) => {
  try {
    const config = await getReconConfig();
    res.json(config);
  } catch (err) {
    next(err);
  }
});

// PUT /api/system-config/reconciliation
router.put("/reconciliation", async (req, res, next) => {
  try {
    const user = (req as any).user;
    const { hour, minute, lookbackDays } = req.body;

    if (
      typeof hour !== "number" ||
      typeof minute !== "number" ||
      typeof lookbackDays !== "number"
    ) {
      res.status(400).json({ error: "hour, minute, and lookbackDays must be numbers" });
      return;
    }

    if (hour < 0 || hour > 23) {
      res.status(400).json({ error: "hour must be between 0 and 23" });
      return;
    }

    if (minute < 0 || minute > 59) {
      res.status(400).json({ error: "minute must be between 0 and 59" });
      return;
    }

    if (lookbackDays < 1 || lookbackDays > 90) {
      res.status(400).json({ error: "lookbackDays must be between 1 and 90" });
      return;
    }

    const entries = [
      { key: SYSTEM_CONFIG_KEYS.RECONCILIATION_HOUR, value: String(hour), updatedByEmail: user.email },
      { key: SYSTEM_CONFIG_KEYS.RECONCILIATION_MINUTE, value: String(minute), updatedByEmail: user.email },
      { key: SYSTEM_CONFIG_KEYS.RECONCILIATION_LOOKBACK_DAYS, value: String(lookbackDays), updatedByEmail: user.email },
    ];

    for (const entry of entries) {
      await db
        .insert(systemConfigTable)
        .values(entry)
        .onConflictDoUpdate({
          target: systemConfigTable.key,
          set: { value: entry.value, updatedByEmail: entry.updatedByEmail, updatedAt: sql`now()` },
        });
    }

    await rescheduleFromDb();

    await db.insert(auditLogsTable).values({
      adminId: user.id,
      adminEmail: user.email,
      action: "system_config_updated",
      targetType: "system_config",
      targetId: null,
      details: JSON.stringify({ section: "reconciliation", hour, minute, lookbackDays }),
      ipAddress: (req as any).ip ?? null,
    });

    req.log.info({ hour, minute, lookbackDays }, "Reconciliation schedule config updated");

    res.json({ hour, minute, lookbackDays });
  } catch (err) {
    next(err);
  }
});

export default router;
