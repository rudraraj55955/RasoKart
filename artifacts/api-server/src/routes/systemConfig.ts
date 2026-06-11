import { Router } from "express";
import { db, systemConfigTable, SYSTEM_CONFIG_KEYS, SYSTEM_CONFIG_DEFAULTS, auditLogsTable, signatureFailureAlertLogsTable } from "@workspace/db";
import { inArray, desc, count } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { rescheduleFromDb, getNextRunTime } from "../helpers/reconScheduler";
import { loadQrCleanupRetentionDays } from "../helpers/qrCleanupScheduler";
import { loadVaCleanupRetentionDays } from "../helpers/vaCleanupScheduler";
import { loadTestEmailRetentionDays, runTestEmailRetentionCleanup } from "../helpers/testEmailRetentionScheduler";
import { loadAuditReportLogRetentionDays } from "../helpers/auditReportRetentionScheduler";
import { resetAlertRateLimit } from "../helpers/signatureFailureAlert";
import { sql } from "drizzle-orm";

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
  res.json({ nextRunAt: nextRun ? nextRun.toISOString() : null, serverTimezone });
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

// GET /api/system-config/va-cleanup
router.get("/va-cleanup", async (req, res, next) => {
  try {
    const retentionDays = await loadVaCleanupRetentionDays();
    res.json({ retentionDays });
  } catch (err) {
    next(err);
  }
});

// PUT /api/system-config/va-cleanup
router.put("/va-cleanup", async (req, res, next) => {
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
        key: SYSTEM_CONFIG_KEYS.VA_CLEANUP_RETENTION_DAYS,
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
      details: JSON.stringify({ section: "va_cleanup", retentionDays }),
      ipAddress: (req as any).ip ?? null,
    });

    req.log.info({ retentionDays }, "VA cleanup retention config updated");

    res.json({ retentionDays });
  } catch (err) {
    next(err);
  }
});

// GET /api/system-config/signature-failure-alert
router.get("/signature-failure-alert", async (req, res, next) => {
  try {
    const keys = [
      SYSTEM_CONFIG_KEYS.SIGNATURE_FAILURE_ALERT_THRESHOLD,
      SYSTEM_CONFIG_KEYS.SIGNATURE_FAILURE_ALERT_COOLDOWN_HOURS,
    ];

    const rows = await db
      .select()
      .from(systemConfigTable)
      .where(inArray(systemConfigTable.key, keys));

    const map = new Map(rows.map((r) => [r.key, r.value]));

    res.json({
      threshold: parseInt(
        map.get(SYSTEM_CONFIG_KEYS.SIGNATURE_FAILURE_ALERT_THRESHOLD) ??
          SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.SIGNATURE_FAILURE_ALERT_THRESHOLD]
      ),
      cooldownHours: parseInt(
        map.get(SYSTEM_CONFIG_KEYS.SIGNATURE_FAILURE_ALERT_COOLDOWN_HOURS) ??
          SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.SIGNATURE_FAILURE_ALERT_COOLDOWN_HOURS]
      ),
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/system-config/signature-failure-alert
router.put("/signature-failure-alert", async (req, res, next) => {
  try {
    const user = (req as any).user;
    const { threshold, cooldownHours } = req.body;

    if (typeof threshold !== "number" || !Number.isInteger(threshold)) {
      res.status(400).json({ error: "threshold must be an integer" });
      return;
    }

    if (threshold < 1 || threshold > 10000) {
      res.status(400).json({ error: "threshold must be between 1 and 10000" });
      return;
    }

    if (typeof cooldownHours !== "number" || !Number.isInteger(cooldownHours)) {
      res.status(400).json({ error: "cooldownHours must be an integer" });
      return;
    }

    if (cooldownHours < 1 || cooldownHours > 168) {
      res.status(400).json({ error: "cooldownHours must be between 1 and 168" });
      return;
    }

    const entries = [
      { key: SYSTEM_CONFIG_KEYS.SIGNATURE_FAILURE_ALERT_THRESHOLD, value: String(threshold), updatedByEmail: user.email },
      { key: SYSTEM_CONFIG_KEYS.SIGNATURE_FAILURE_ALERT_COOLDOWN_HOURS, value: String(cooldownHours), updatedByEmail: user.email },
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

    resetAlertRateLimit();

    await db.insert(auditLogsTable).values({
      adminId: user.id,
      adminEmail: user.email,
      action: "system_config_updated",
      targetType: "system_config",
      targetId: null,
      details: JSON.stringify({ section: "signature_failure_alert", threshold, cooldownHours }),
      ipAddress: (req as any).ip ?? null,
    });

    req.log.info({ threshold, cooldownHours }, "Signature failure alert config updated — rate-limit reset");

    res.json({ threshold, cooldownHours });
  } catch (err) {
    next(err);
  }
});

// GET /api/system-config/test-email-retention
router.get("/test-email-retention", async (req, res, next) => {
  try {
    const retentionDays = await loadTestEmailRetentionDays();
    res.json({ retentionDays });
  } catch (err) {
    next(err);
  }
});

// PUT /api/system-config/test-email-retention
router.put("/test-email-retention", async (req, res, next) => {
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
        key: SYSTEM_CONFIG_KEYS.TEST_EMAIL_HISTORY_RETENTION_DAYS,
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
      details: JSON.stringify({ section: "test_email_retention", retentionDays }),
      ipAddress: (req as any).ip ?? null,
    });

    req.log.info({ retentionDays }, "Test email history retention config updated");

    res.json({ retentionDays });
  } catch (err) {
    next(err);
  }
});

// POST /api/system-config/test-email-retention/run
router.post("/test-email-retention/run", async (req, res, next) => {
  try {
    const { deleted } = await runTestEmailRetentionCleanup();
    req.log.info({ deleted }, "Test email history retention cleanup triggered manually");
    res.json({ deleted });
  } catch (err) {
    next(err);
  }
});

// GET /api/system-config/webhook-retries
router.get("/webhook-retries", async (req, res, next) => {
  try {
    const keys = [
      SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_DELAY_1,
      SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_DELAY_2,
      SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_DELAY_3,
    ];

    const rows = await db
      .select()
      .from(systemConfigTable)
      .where(inArray(systemConfigTable.key, keys));

    const map = new Map(rows.map((r) => [r.key, r.value]));

    res.json({
      delay1: parseInt(map.get(SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_DELAY_1) ?? SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_DELAY_1]),
      delay2: parseInt(map.get(SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_DELAY_2) ?? SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_DELAY_2]),
      delay3: parseInt(map.get(SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_DELAY_3) ?? SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_DELAY_3]),
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/system-config/webhook-retries
router.put("/webhook-retries", async (req, res, next) => {
  try {
    const user = (req as any).user;
    const { delay1, delay2, delay3 } = req.body;

    if (
      typeof delay1 !== "number" ||
      typeof delay2 !== "number" ||
      typeof delay3 !== "number"
    ) {
      res.status(400).json({ error: "delay1, delay2, and delay3 must be numbers" });
      return;
    }

    if (!Number.isInteger(delay1) || !Number.isInteger(delay2) || !Number.isInteger(delay3)) {
      res.status(400).json({ error: "delay1, delay2, and delay3 must be integers" });
      return;
    }

    if (delay1 < 0 || delay2 < 0 || delay3 < 0) {
      res.status(400).json({ error: "delay values must be non-negative" });
      return;
    }

    if (delay1 > delay2) {
      res.status(400).json({ error: "delay1 must be less than or equal to delay2 (non-decreasing backoff order)" });
      return;
    }

    if (delay2 > delay3) {
      res.status(400).json({ error: "delay2 must be less than or equal to delay3 (non-decreasing backoff order)" });
      return;
    }

    const entries = [
      { key: SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_DELAY_1, value: String(delay1), updatedByEmail: user.email },
      { key: SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_DELAY_2, value: String(delay2), updatedByEmail: user.email },
      { key: SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_DELAY_3, value: String(delay3), updatedByEmail: user.email },
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
      details: JSON.stringify({ section: "webhook_retries", delay1, delay2, delay3 }),
      ipAddress: (req as any).ip ?? null,
    });

    req.log.info({ delay1, delay2, delay3 }, "Webhook retry delays config updated");

    res.json({ delay1, delay2, delay3 });
  } catch (err) {
    next(err);
  }
});

// GET /api/system-config/signature-failure-alert-history
router.get("/signature-failure-alert-history", async (req, res, next) => {
  try {
    const limit = Math.min(parseInt((req.query['limit'] as string) || "50") || 50, 200);

    const [rows, [{ total }]] = await Promise.all([
      db
        .select()
        .from(signatureFailureAlertLogsTable)
        .orderBy(desc(signatureFailureAlertLogsTable.sentAt))
        .limit(limit),
      db.select({ total: count() }).from(signatureFailureAlertLogsTable),
    ]);

    res.json({ data: rows, total });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/system-config/signature-failure-alert-history
router.delete("/signature-failure-alert-history", async (req, res, next) => {
  try {
    const user = (req as any).user;

    await db.delete(signatureFailureAlertLogsTable);

    await db.insert(auditLogsTable).values({
      adminId: user.id,
      adminEmail: user.email,
      action: "system_config_updated",
      targetType: "system_config",
      targetId: null,
      details: JSON.stringify({ section: "signature_failure_alert_history", action: "cleared" }),
      ipAddress: (req as any).ip ?? null,
    });

    req.log.info("Signature failure alert history cleared");

    res.json({ cleared: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/system-config/audit-report-retention
router.get("/audit-report-retention", async (req, res, next) => {
  try {
    const retentionDays = await loadAuditReportLogRetentionDays();
    res.json({ retentionDays });
  } catch (err) {
    next(err);
  }
});

// PUT /api/system-config/audit-report-retention
router.put("/audit-report-retention", async (req, res, next) => {
  try {
    const user = (req as any).user;
    const { retentionDays } = req.body;

    if (typeof retentionDays !== "number" || !Number.isInteger(retentionDays)) {
      res.status(400).json({ error: "retentionDays must be an integer" });
      return;
    }

    if (retentionDays < 0 || retentionDays > 3650) {
      res.status(400).json({ error: "retentionDays must be between 0 and 3650 (0 = disabled)" });
      return;
    }

    await db
      .insert(systemConfigTable)
      .values({
        key: SYSTEM_CONFIG_KEYS.AUDIT_REPORT_LOG_RETENTION_DAYS,
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
      details: JSON.stringify({ section: "audit_report_log_retention", retentionDays }),
      ipAddress: (req as any).ip ?? null,
    });

    req.log.info({ retentionDays }, "Audit report log retention config updated");

    res.json({ retentionDays });
  } catch (err) {
    next(err);
  }
});

export default router;
