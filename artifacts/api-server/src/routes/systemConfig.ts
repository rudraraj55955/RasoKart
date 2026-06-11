import { Router } from "express";
import { db, systemConfigTable, SYSTEM_CONFIG_KEYS, SYSTEM_CONFIG_DEFAULTS, auditLogsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { rescheduleFromDb, getNextRunTime } from "../helpers/reconScheduler";
import { loadQrCleanupRetentionDays } from "../helpers/qrCleanupScheduler";
import { loadStorageCleanupConfig, rescheduleStorageCleanupFromDb } from "../helpers/storageCleanupScheduler";
import { sql } from "drizzle-orm";

async function getSignatureFailureAlertConfig() {
  const keys = [
    SYSTEM_CONFIG_KEYS.SIGNATURE_FAILURE_ALERT_THRESHOLD,
    SYSTEM_CONFIG_KEYS.SIGNATURE_FAILURE_ALERT_WINDOW_HOURS,
    SYSTEM_CONFIG_KEYS.SIGNATURE_FAILURE_ALERT_RATE_LIMIT_HOURS,
  ];

  const rows = await db
    .select()
    .from(systemConfigTable)
    .where(inArray(systemConfigTable.key, keys));

  const map = new Map(rows.map(r => [r.key, r.value]));

  const threshold = parseInt(
    map.get(SYSTEM_CONFIG_KEYS.SIGNATURE_FAILURE_ALERT_THRESHOLD) ??
    SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.SIGNATURE_FAILURE_ALERT_THRESHOLD]
  );
  const windowHours = parseFloat(
    map.get(SYSTEM_CONFIG_KEYS.SIGNATURE_FAILURE_ALERT_WINDOW_HOURS) ??
    SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.SIGNATURE_FAILURE_ALERT_WINDOW_HOURS]
  );
  const rateLimitHours = parseFloat(
    map.get(SYSTEM_CONFIG_KEYS.SIGNATURE_FAILURE_ALERT_RATE_LIMIT_HOURS) ??
    SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.SIGNATURE_FAILURE_ALERT_RATE_LIMIT_HOURS]
  );

  return { threshold, windowHours, rateLimitHours };
}

const router = Router();
router.use(requireAuth, requireAdmin);

async function getReconConfig() {
  const keys = [
    SYSTEM_CONFIG_KEYS.RECONCILIATION_HOUR,
    SYSTEM_CONFIG_KEYS.RECONCILIATION_MINUTE,
    SYSTEM_CONFIG_KEYS.RECONCILIATION_LOOKBACK_DAYS,
    SYSTEM_CONFIG_KEYS.RECONCILIATION_ENABLED,
  ];

  const rows = await db
    .select()
    .from(systemConfigTable)
    .where(inArray(systemConfigTable.key, keys));

  const map = new Map(rows.map((r) => [r.key, r.value]));

  const enabledRaw =
    map.get(SYSTEM_CONFIG_KEYS.RECONCILIATION_ENABLED) ??
    SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.RECONCILIATION_ENABLED];

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
    enabled: enabledRaw !== "false",
  };
}

// GET /api/system-config/reconciliation/next-run
router.get("/reconciliation/next-run", (req, res) => {
  const nextRun = getNextRunTime();
  const serverTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const serverTime = new Intl.DateTimeFormat("en-GB", {
    timeZone: serverTimezone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date());
  res.json({ nextRunAt: nextRun ? nextRun.toISOString() : null, serverTimezone, serverTime });
});

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
    const { hour, minute, lookbackDays, enabled } = req.body;

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

    if (enabled !== undefined && typeof enabled !== "boolean") {
      res.status(400).json({ error: "enabled must be a boolean" });
      return;
    }

    const enabledValue = enabled !== undefined ? enabled : true;

    const entries = [
      { key: SYSTEM_CONFIG_KEYS.RECONCILIATION_HOUR, value: String(hour), updatedByEmail: user.email },
      { key: SYSTEM_CONFIG_KEYS.RECONCILIATION_MINUTE, value: String(minute), updatedByEmail: user.email },
      { key: SYSTEM_CONFIG_KEYS.RECONCILIATION_LOOKBACK_DAYS, value: String(lookbackDays), updatedByEmail: user.email },
      { key: SYSTEM_CONFIG_KEYS.RECONCILIATION_ENABLED, value: String(enabledValue), updatedByEmail: user.email },
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
      details: JSON.stringify({ section: "reconciliation", hour, minute, lookbackDays, enabled: enabledValue }),
      ipAddress: (req as any).ip ?? null,
    });

    req.log.info({ hour, minute, lookbackDays, enabled: enabledValue }, "Reconciliation schedule config updated");

    res.json({ hour, minute, lookbackDays, enabled: enabledValue });
  } catch (err) {
    next(err);
  }
});

// Helper: load presets from DB
async function loadLookbackPresets(): Promise<Array<{ name: string; days: number }>> {
  const rows = await db
    .select()
    .from(systemConfigTable)
    .where(inArray(systemConfigTable.key, [SYSTEM_CONFIG_KEYS.RECONCILIATION_LOOKBACK_PRESETS]));
  const raw = rows[0]?.value;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {}
  return [];
}

// Helper: save presets to DB
async function saveLookbackPresets(
  presets: Array<{ name: string; days: number }>,
  updatedByEmail: string
): Promise<void> {
  await db
    .insert(systemConfigTable)
    .values({
      key: SYSTEM_CONFIG_KEYS.RECONCILIATION_LOOKBACK_PRESETS,
      value: JSON.stringify(presets),
      updatedByEmail,
    })
    .onConflictDoUpdate({
      target: systemConfigTable.key,
      set: {
        value: JSON.stringify(presets),
        updatedByEmail,
        updatedAt: sql`now()`,
      },
    });
}

// GET /api/system-config/reconciliation/lookback-presets
router.get("/reconciliation/lookback-presets", async (req, res, next) => {
  try {
    const presets = await loadLookbackPresets();
    res.json(presets);
  } catch (err) {
    next(err);
  }
});

// POST /api/system-config/reconciliation/lookback-presets
router.post("/reconciliation/lookback-presets", async (req, res, next) => {
  try {
    const user = (req as any).user;
    const { name, days } = req.body;

    if (typeof name !== "string" || name.trim().length === 0) {
      res.status(400).json({ error: "name must be a non-empty string" });
      return;
    }
    if (name.trim().length > 50) {
      res.status(400).json({ error: "name must be 50 characters or fewer" });
      return;
    }
    if (typeof days !== "number" || !Number.isInteger(days)) {
      res.status(400).json({ error: "days must be an integer" });
      return;
    }
    if (days < 1 || days > 90) {
      res.status(400).json({ error: "days must be between 1 and 90" });
      return;
    }

    const existing = await loadLookbackPresets();
    const updated = existing.filter((p) => p.days !== days);
    updated.push({ name: name.trim(), days });
    updated.sort((a, b) => a.days - b.days);

    await saveLookbackPresets(updated, user.email);

    await db.insert(auditLogsTable).values({
      adminId: user.id,
      adminEmail: user.email,
      action: "system_config_updated",
      targetType: "system_config",
      targetId: null,
      details: JSON.stringify({ section: "reconciliation_lookback_presets", action: "add", name: name.trim(), days }),
      ipAddress: (req as any).ip ?? null,
    });

    req.log.info({ name, days }, "Lookback preset added");
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/system-config/reconciliation/lookback-presets/:days
router.delete("/reconciliation/lookback-presets/:days", async (req, res, next) => {
  try {
    const user = (req as any).user;
    const days = parseInt(req.params['days'] as string);

    if (isNaN(days)) {
      res.status(400).json({ error: "days must be a number" });
      return;
    }

    const existing = await loadLookbackPresets();
    const idx = existing.findIndex((p) => p.days === days);
    if (idx === -1) {
      res.status(404).json({ error: `No preset with days=${days} found` });
      return;
    }

    const updated = existing.filter((p) => p.days !== days);
    await saveLookbackPresets(updated, user.email);

    await db.insert(auditLogsTable).values({
      adminId: user.id,
      adminEmail: user.email,
      action: "system_config_updated",
      targetType: "system_config",
      targetId: null,
      details: JSON.stringify({ section: "reconciliation_lookback_presets", action: "delete", days }),
      ipAddress: (req as any).ip ?? null,
    });

    req.log.info({ days }, "Lookback preset deleted");
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// GET /api/system-config/qr-cleanup
router.get("/qr-cleanup", async (req, res, next) => {
  try {
    const retentionDays = await loadQrCleanupRetentionDays();
    res.json({ retentionDays });
  } catch (err) {
    next(err);
  }
});

// PUT /api/system-config/qr-cleanup
router.put("/qr-cleanup", async (req, res, next) => {
  try {
    const user = (req as any).user;
    const { retentionDays } = req.body;

    if (typeof retentionDays !== "number" || !Number.isInteger(retentionDays)) {
      res.status(400).json({ error: "retentionDays must be an integer" });
      return;
    }

    if (retentionDays < 0 || retentionDays > 365) {
      res.status(400).json({ error: "retentionDays must be between 0 and 365 (0 = disabled)" });
      return;
    }

    await db
      .insert(systemConfigTable)
      .values({
        key: SYSTEM_CONFIG_KEYS.QR_CLEANUP_RETENTION_DAYS,
        value: String(retentionDays),
        updatedByEmail: user.email,
      })
      .onConflictDoUpdate({
        target: systemConfigTable.key,
        set: {
          value: String(retentionDays),
          updatedByEmail: user.email,
          updatedAt: sql`now()`,
        },
      });

    await db.insert(auditLogsTable).values({
      adminId: user.id,
      adminEmail: user.email,
      action: "system_config_updated",
      targetType: "system_config",
      targetId: null,
      details: JSON.stringify({ section: "qr_cleanup", retentionDays }),
      ipAddress: (req as any).ip ?? null,
    });

    req.log.info({ retentionDays }, "QR cleanup retention config updated");

    res.json({ retentionDays });
  } catch (err) {
    next(err);
  }
});

// GET /api/system-config/signature-failure-alert
router.get("/signature-failure-alert", async (req, res, next) => {
  try {
    const config = await getSignatureFailureAlertConfig();
    res.json(config);
  } catch (err) {
    next(err);
  }
});

// PUT /api/system-config/signature-failure-alert
router.put("/signature-failure-alert", async (req, res, next) => {
  try {
    const user = (req as any).user;
    const { threshold, windowHours, rateLimitHours } = req.body;

    if (typeof threshold !== "number" || !Number.isInteger(threshold)) {
      res.status(400).json({ error: "threshold must be an integer" });
      return;
    }
    if (threshold < 1 || threshold > 10000) {
      res.status(400).json({ error: "threshold must be between 1 and 10000" });
      return;
    }

    if (typeof windowHours !== "number") {
      res.status(400).json({ error: "windowHours must be a number" });
      return;
    }
    if (windowHours < 0.25 || windowHours > 72) {
      res.status(400).json({ error: "windowHours must be between 0.25 and 72" });
      return;
    }

    if (typeof rateLimitHours !== "number") {
      res.status(400).json({ error: "rateLimitHours must be a number" });
      return;
    }
    if (rateLimitHours < 0.25 || rateLimitHours > 72) {
      res.status(400).json({ error: "rateLimitHours must be between 0.25 and 72" });
      return;
    }

    const entries = [
      { key: SYSTEM_CONFIG_KEYS.SIGNATURE_FAILURE_ALERT_THRESHOLD, value: String(threshold), updatedByEmail: user.email },
      { key: SYSTEM_CONFIG_KEYS.SIGNATURE_FAILURE_ALERT_WINDOW_HOURS, value: String(windowHours), updatedByEmail: user.email },
      { key: SYSTEM_CONFIG_KEYS.SIGNATURE_FAILURE_ALERT_RATE_LIMIT_HOURS, value: String(rateLimitHours), updatedByEmail: user.email },
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

    await db.insert(auditLogsTable).values({
      adminId: user.id,
      adminEmail: user.email,
      action: "system_config_updated",
      targetType: "system_config",
      targetId: null,
      details: JSON.stringify({ section: "signature_failure_alert", threshold, windowHours, rateLimitHours }),
      ipAddress: (req as any).ip ?? null,
    });

    req.log.info({ threshold, windowHours, rateLimitHours }, "Signature failure alert config updated");

    res.json({ threshold, windowHours, rateLimitHours });
  } catch (err) {
    next(err);
  }
});

// GET /api/system-config/storage-cleanup
router.get("/storage-cleanup", async (req, res, next) => {
  try {
    const config = await loadStorageCleanupConfig();
    res.json(config);
  } catch (err) {
    next(err);
  }
});

// PUT /api/system-config/storage-cleanup
router.put("/storage-cleanup", async (req, res, next) => {
  try {
    const user = (req as any).user;
    const { enabled, hour } = req.body;

    if (typeof hour !== "number" || !Number.isInteger(hour)) {
      res.status(400).json({ error: "hour must be an integer" });
      return;
    }

    if (hour < 0 || hour > 23) {
      res.status(400).json({ error: "hour must be between 0 and 23" });
      return;
    }

    if (enabled !== undefined && typeof enabled !== "boolean") {
      res.status(400).json({ error: "enabled must be a boolean" });
      return;
    }

    const enabledValue = enabled !== undefined ? enabled : true;

    const entries = [
      { key: SYSTEM_CONFIG_KEYS.STORAGE_CLEANUP_ENABLED, value: String(enabledValue), updatedByEmail: user.email },
      { key: SYSTEM_CONFIG_KEYS.STORAGE_CLEANUP_HOUR, value: String(hour), updatedByEmail: user.email },
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

    await rescheduleStorageCleanupFromDb();

    await db.insert(auditLogsTable).values({
      adminId: user.id,
      adminEmail: user.email,
      action: "system_config_updated",
      targetType: "system_config",
      targetId: null,
      details: JSON.stringify({ section: "storage_cleanup", enabled: enabledValue, hour }),
      ipAddress: (req as any).ip ?? null,
    });

    req.log.info({ enabled: enabledValue, hour }, "Storage cleanup schedule config updated");

    res.json({ enabled: enabledValue, hour });
  } catch (err) {
    next(err);
  }
});

export default router;
