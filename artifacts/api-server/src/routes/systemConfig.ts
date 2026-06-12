import { Router } from "express";
import { db, systemConfigTable, SYSTEM_CONFIG_KEYS, SYSTEM_CONFIG_DEFAULTS, auditLogsTable, signatureFailureAlertLogsTable, webhookFailureAlertLogsTable, storageCleanupRunsTable, uploadedObjectsTable, merchantsTable } from "@workspace/db";
import { ekqrCreateOrder, ekqrClientTxnId } from "../helpers/ekqr";
import { inArray, desc, count, sql, eq } from "drizzle-orm";
import { ObjectStorageService } from "../lib/objectStorage";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { rescheduleFromDb, getNextRunTime } from "../helpers/reconScheduler";
import { loadQrCleanupRetentionDays, loadQrCleanupLastRun, runQrCleanup } from "../helpers/qrCleanupScheduler";
import { loadVaCleanupRetentionDays, loadVaCleanupLastRun, runVaCleanup } from "../helpers/vaCleanupScheduler";
import { loadTestEmailRetentionDays, runTestEmailRetentionCleanup } from "../helpers/testEmailRetentionScheduler";
import { loadAuditReportLogRetentionDays } from "../helpers/auditReportRetentionScheduler";
import { resetAlertRateLimit } from "../helpers/signatureFailureAlert";

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
    const [retentionDays, lastRun] = await Promise.all([
      loadQrCleanupRetentionDays(),
      loadQrCleanupLastRun(),
    ]);
    res.json({ retentionDays, lastRunAt: lastRun.lastRunAt, lastDeleted: lastRun.lastDeleted });
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
    const [retentionDays, lastRun] = await Promise.all([
      loadVaCleanupRetentionDays(),
      loadVaCleanupLastRun(),
    ]);
    res.json({ retentionDays, lastRunAt: lastRun.lastRunAt, lastDeleted: lastRun.lastDeleted });
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

// POST /api/system-config/qr-cleanup/run
router.post("/qr-cleanup/run", async (req, res, next) => {
  try {
    const { expired, deleted } = await runQrCleanup();
    req.log.info({ expired, deleted }, "QR cleanup triggered manually");
    res.json({ expired, deleted });
  } catch (err) {
    next(err);
  }
});

// POST /api/system-config/va-cleanup/run
router.post("/va-cleanup/run", async (req, res, next) => {
  try {
    const { closed, deleted } = await runVaCleanup();
    req.log.info({ closed, deleted }, "VA cleanup triggered manually");
    res.json({ closed, deleted });
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
      SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_MAX_ATTEMPTS,
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
      maxAttempts: parseInt(map.get(SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_MAX_ATTEMPTS) ?? SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_MAX_ATTEMPTS]),
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
    const { maxAttempts, delay1, delay2, delay3 } = req.body;

    if (typeof maxAttempts !== "number" || !Number.isInteger(maxAttempts)) {
      res.status(400).json({ error: "maxAttempts must be an integer" });
      return;
    }

    if (maxAttempts < 1 || maxAttempts > 10) {
      res.status(400).json({ error: "maxAttempts must be between 1 and 10" });
      return;
    }

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
      { key: SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_MAX_ATTEMPTS, value: String(maxAttempts), updatedByEmail: user.email },
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
      details: JSON.stringify({ section: "webhook_retries", maxAttempts, delay1, delay2, delay3 }),
      ipAddress: (req as any).ip ?? null,
    });

    req.log.info({ maxAttempts, delay1, delay2, delay3 }, "Webhook retry config updated");

    res.json({ maxAttempts, delay1, delay2, delay3 });
  } catch (err) {
    next(err);
  }
});

// GET /api/system-config/webhook-retry-policy
router.get("/webhook-retry-policy", async (req, res, next) => {
  try {
    const keys = [
      SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_MAX_ATTEMPTS,
      SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_DELAY_1,
      SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_DELAY_2,
      SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_DELAY_3,
    ];

    const rows = await db
      .select()
      .from(systemConfigTable)
      .where(inArray(systemConfigTable.key, keys));

    const map = new Map(rows.map((r) => [r.key, r.value]));

    const maxAttempts = parseInt(map.get(SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_MAX_ATTEMPTS) ?? SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_MAX_ATTEMPTS]);
    const delay1 = parseInt(map.get(SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_DELAY_1) ?? SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_DELAY_1]);
    const delay2 = parseInt(map.get(SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_DELAY_2) ?? SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_DELAY_2]);
    const delay3 = parseInt(map.get(SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_DELAY_3) ?? SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_DELAY_3]);

    const retries = maxAttempts - 1;
    const allDelays = [delay1, delay2, delay3];

    function formatDelay(secs: number): string {
      if (secs < 60) return `${secs}s`;
      if (secs < 3600) return `${Math.round(secs / 60)}m`;
      return `${Math.round(secs / 3600)}h`;
    }

    const delays = Array.from({ length: retries }, (_, i) => ({
      attempt: i + 1,
      delaySeconds: allDelays[i] ?? allDelays[allDelays.length - 1] ?? delay3,
      label: formatDelay(allDelays[i] ?? allDelays[allDelays.length - 1] ?? delay3),
    }));

    res.json({ maxAttempts, initialAttempt: 1, retries, delays });
  } catch (err) {
    next(err);
  }
});

// GET /api/system-config/webhook-failure-alert
router.get("/webhook-failure-alert", async (req, res, next) => {
  try {
    const rows = await db
      .select()
      .from(systemConfigTable)
      .where(eq(systemConfigTable.key, SYSTEM_CONFIG_KEYS.WEBHOOK_FAILURE_ALERT_COOLDOWN_HOURS));

    const map = new Map(rows.map((r) => [r.key, r.value]));

    res.json({
      cooldownHours: parseInt(
        map.get(SYSTEM_CONFIG_KEYS.WEBHOOK_FAILURE_ALERT_COOLDOWN_HOURS) ??
          SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.WEBHOOK_FAILURE_ALERT_COOLDOWN_HOURS]
      ),
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/system-config/webhook-failure-alert
router.put("/webhook-failure-alert", async (req, res, next) => {
  try {
    const user = (req as any).user;
    const { cooldownHours } = req.body;

    if (typeof cooldownHours !== "number" || !Number.isInteger(cooldownHours)) {
      res.status(400).json({ error: "cooldownHours must be an integer" });
      return;
    }

    if (cooldownHours < 1 || cooldownHours > 168) {
      res.status(400).json({ error: "cooldownHours must be between 1 and 168" });
      return;
    }

    await db
      .insert(systemConfigTable)
      .values({
        key: SYSTEM_CONFIG_KEYS.WEBHOOK_FAILURE_ALERT_COOLDOWN_HOURS,
        value: String(cooldownHours),
        updatedByEmail: user.email,
      })
      .onConflictDoUpdate({
        target: systemConfigTable.key,
        set: { value: String(cooldownHours), updatedByEmail: user.email, updatedAt: sql`now()` },
      });

    await db.insert(auditLogsTable).values({
      adminId: user.id,
      adminEmail: user.email,
      action: "system_config_updated",
      targetType: "system_config",
      targetId: null,
      details: JSON.stringify({ section: "webhook_failure_alert", cooldownHours }),
      ipAddress: (req as any).ip ?? null,
    });

    req.log.info({ cooldownHours }, "Webhook failure alert cooldown config updated");

    res.json({ cooldownHours });
  } catch (err) {
    next(err);
  }
});

// GET /api/system-config/webhook-failure-alert-history
router.get("/webhook-failure-alert-history", async (req, res, next) => {
  try {
    const limit = Math.min(parseInt((req.query['limit'] as string) || "50") || 50, 200);
    const merchantIdRaw = req.query['merchantId'] as string | undefined;
    const merchantId = merchantIdRaw ? parseInt(merchantIdRaw) || null : null;

    const whereClause = merchantId != null
      ? eq(webhookFailureAlertLogsTable.merchantId, merchantId)
      : undefined;

    const [rows, [{ total }]] = await Promise.all([
      db
        .select()
        .from(webhookFailureAlertLogsTable)
        .where(whereClause)
        .orderBy(desc(webhookFailureAlertLogsTable.sentAt))
        .limit(limit),
      db.select({ total: count() }).from(webhookFailureAlertLogsTable).where(whereClause),
    ]);

    res.json({ data: rows, total });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/system-config/webhook-failure-alert-history
router.delete("/webhook-failure-alert-history", async (req, res, next) => {
  try {
    const user = (req as any).user;

    await db.delete(webhookFailureAlertLogsTable);

    await db.insert(auditLogsTable).values({
      adminId: user.id,
      adminEmail: user.email,
      action: "system_config_updated",
      targetType: "system_config",
      targetId: null,
      details: JSON.stringify({ section: "webhook_failure_alert_history", action: "cleared" }),
      ipAddress: (req as any).ip ?? null,
    });

    req.log.info("Webhook failure alert history cleared");

    res.json({ cleared: true });
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

// GET /api/system-config/cleanup-stats
router.get("/cleanup-stats", async (req, res, next) => {
  try {
    const keys = [
      SYSTEM_CONFIG_KEYS.QR_CLEANUP_LAST_RUN_AT,
      SYSTEM_CONFIG_KEYS.QR_CLEANUP_LAST_RUN_DELETED,
      SYSTEM_CONFIG_KEYS.AUDIT_REPORT_CLEANUP_LAST_RUN_AT,
      SYSTEM_CONFIG_KEYS.AUDIT_REPORT_CLEANUP_LAST_RUN_DELETED,
    ];

    const rows = await db
      .select()
      .from(systemConfigTable)
      .where(inArray(systemConfigTable.key, keys));

    const map = new Map(rows.map((r) => [r.key, r.value]));

    const qrLastRunAt = map.get(SYSTEM_CONFIG_KEYS.QR_CLEANUP_LAST_RUN_AT) ?? null;
    const qrLastRunDeletedRaw = map.get(SYSTEM_CONFIG_KEYS.QR_CLEANUP_LAST_RUN_DELETED);
    const auditLastRunAt = map.get(SYSTEM_CONFIG_KEYS.AUDIT_REPORT_CLEANUP_LAST_RUN_AT) ?? null;
    const auditLastRunDeletedRaw = map.get(SYSTEM_CONFIG_KEYS.AUDIT_REPORT_CLEANUP_LAST_RUN_DELETED);

    res.json({
      qrCleanup: {
        lastRunAt: qrLastRunAt,
        lastRunDeleted: qrLastRunDeletedRaw != null ? parseInt(qrLastRunDeletedRaw) : null,
      },
      auditReportCleanup: {
        lastRunAt: auditLastRunAt,
        lastRunDeleted: auditLastRunDeletedRaw != null ? parseInt(auditLastRunDeletedRaw) : null,
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/system-config/storage-cleanup/runs
router.get("/storage-cleanup/runs", async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(1, parseInt((req.query['limit'] as string) || "20") || 20), 100);

    const [rows, [{ total }]] = await Promise.all([
      db
        .select()
        .from(storageCleanupRunsTable)
        .orderBy(desc(storageCleanupRunsTable.createdAt))
        .limit(limit),
      db.select({ total: count() }).from(storageCleanupRunsTable),
    ]);

    res.json({
      data: rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() })),
      total,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Normalise any form of a stored logo URL to the canonical /objects/<id> path
 * so it can be compared directly to uploadedObjectsTable.objectPath.
 *
 * Handles:
 *   /objects/uuid                          → /objects/uuid   (already canonical)
 *   /api/storage/objects/uuid              → /objects/uuid
 *   https://domain.com/api/storage/objects/uuid → /objects/uuid
 */
function normaliseToObjectPath(url: string): string | null {
  if (url.startsWith("/objects/")) return url;

  const OBJECTS_SEGMENT = "/storage/objects/";
  const idx = url.indexOf(OBJECTS_SEGMENT);
  if (idx !== -1) {
    return `/objects/${url.slice(idx + OBJECTS_SEGMENT.length)}`;
  }

  return null;
}

// POST /api/system-config/storage-cleanup/run
router.post("/storage-cleanup/run", async (req, res, next) => {
  const objectStorageService = new ObjectStorageService();

  try {
    // Collect all objectPaths currently referenced by a merchant logo (normalised)
    const merchantLogos = await db
      .select({ logoUrl: merchantsTable.logoUrl })
      .from(merchantsTable)
      .where(sql`${merchantsTable.logoUrl} IS NOT NULL`);

    const referencedPaths = new Set<string>();
    for (const { logoUrl } of merchantLogos) {
      if (!logoUrl) continue;
      const canonical = normaliseToObjectPath(logoUrl);
      if (canonical) referencedPaths.add(canonical);
    }

    // Fetch all uploaded-objects DB records
    const allObjects = await db
      .select({ id: uploadedObjectsTable.id, objectPath: uploadedObjectsTable.objectPath })
      .from(uploadedObjectsTable);

    const totalScanned = allObjects.length;

    // Orphans: records whose objectPath is not referenced by any active merchant logo
    const orphaned = allObjects.filter(obj => !referencedPaths.has(obj.objectPath));

    let deleted = 0;
    let errors = 0;
    const successfullyDeletedIds: number[] = [];

    for (const obj of orphaned) {
      try {
        await objectStorageService.deleteObjectEntity(obj.objectPath);
        successfullyDeletedIds.push(obj.id);
      } catch (err) {
        errors += 1;
        req.log.error({ err, objectPath: obj.objectPath }, "Failed to delete orphaned object from storage");
      }
    }

    // Remove DB rows only for objects successfully deleted from storage
    if (successfullyDeletedIds.length > 0) {
      try {
        await db
          .delete(uploadedObjectsTable)
          .where(sql`${uploadedObjectsTable.id} IN (${sql.join(successfullyDeletedIds.map(id => sql`${id}`), sql`, `)})`);
        deleted = successfullyDeletedIds.length;
      } catch (err) {
        errors += 1;
        req.log.error({ err }, "Failed to delete orphaned rows from uploaded_objects table");
      }
    }

    // Record this cleanup run
    await db
      .insert(storageCleanupRunsTable)
      .values({ totalScanned, deleted, errors, triggeredBy: "manual" });

    req.log.info({ totalScanned, deleted, errors }, "Storage cleanup run completed manually");

    res.json({ totalScanned, deleted, errors });
  } catch (err) {
    next(err);
  }
});

// ── EKQR / UPI Gateway config ──────────────────────────────────────────────

async function getEkqrConfig() {
  const keys = [SYSTEM_CONFIG_KEYS.EKQR_API_KEY, SYSTEM_CONFIG_KEYS.EKQR_ENABLED];
  const rows = await db.select().from(systemConfigTable).where(inArray(systemConfigTable.key, keys));
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const rawKey = map.get(SYSTEM_CONFIG_KEYS.EKQR_API_KEY) ?? "";
  return {
    apiKeySet: rawKey.length > 0,
    apiKeyMasked: rawKey.length > 0 ? `${rawKey.slice(0, 4)}${"*".repeat(Math.max(0, rawKey.length - 8))}${rawKey.slice(-4)}` : "",
    enabled: (map.get(SYSTEM_CONFIG_KEYS.EKQR_ENABLED) ?? SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.EKQR_ENABLED]) === "true",
  };
}

// GET /api/system-config/ekqr
router.get("/ekqr", async (req, res, next) => {
  try {
    res.json(await getEkqrConfig());
  } catch (err) { next(err); }
});

// PUT /api/system-config/ekqr
router.put("/ekqr", async (req, res, next) => {
  try {
    const user = (req as any).user;
    const { apiKey, enabled } = req.body as { apiKey?: string; enabled?: boolean };

    if (apiKey !== undefined) {
      await db.insert(systemConfigTable)
        .values({ key: SYSTEM_CONFIG_KEYS.EKQR_API_KEY, value: apiKey, updatedByEmail: user.email })
        .onConflictDoUpdate({ target: systemConfigTable.key, set: { value: apiKey, updatedByEmail: user.email } });
    }

    if (enabled !== undefined) {
      const val = enabled ? "true" : "false";
      await db.insert(systemConfigTable)
        .values({ key: SYSTEM_CONFIG_KEYS.EKQR_ENABLED, value: val, updatedByEmail: user.email })
        .onConflictDoUpdate({ target: systemConfigTable.key, set: { value: val, updatedByEmail: user.email } });
    }

    await db.insert(auditLogsTable).values({
      adminId: user.id, adminEmail: user.email,
      action: "system_config_updated", targetType: "system_config", targetId: null,
      details: JSON.stringify({ section: "ekqr", apiKeyUpdated: apiKey !== undefined, enabled }),
      ipAddress: (req as any).ip ?? null,
    });

    req.log.info({ enabled, apiKeyUpdated: apiKey !== undefined }, "EKQR config updated");
    res.json(await getEkqrConfig());
  } catch (err) { next(err); }
});

// POST /api/system-config/ekqr/test-webhook
// Fires a synthetic SUCCESS webhook payload through the full processing pipeline.
router.post("/ekqr/test-webhook", async (req, res, next) => {
  try {
    const { ekqrWebhookLogsTable } = await import("@workspace/db");

    const clientTxnId = `TEST-${Date.now()}`;
    const syntheticPayload = {
      client_txn_id: clientTxnId,
      amount: "1.00",
      status: "SUCCESS",
      upi_txn_id: `TEST_UPI_${Date.now()}`,
      txn_id: `TEST_TXN_${Date.now()}`,
      p_info: "RasoKart Test Webhook",
      customer_name: "Test Customer",
      customer_email: "test@rasokart.com",
      customer_mobile: "9999999999",
    };

    const [ekqrEnabledRow] = await db
      .select({ value: systemConfigTable.value })
      .from(systemConfigTable)
      .where(eq(systemConfigTable.key, SYSTEM_CONFIG_KEYS.EKQR_ENABLED))
      .limit(1);

    const ekqrEnabled = ekqrEnabledRow?.value === "true";
    const rawPayload = JSON.stringify(syntheticPayload);

    const processingResult: "credited" | "duplicate" | "ignored" | "error" = ekqrEnabled ? "ignored" : "ignored";
    const errorMessage: string | null = ekqrEnabled ? "No matching QR code (synthetic test)" : "EKQR is disabled";

    const [logRow] = await db.insert(ekqrWebhookLogsTable).values({
      clientTxnId,
      status: "SUCCESS",
      amount: "1.00",
      rawPayload,
      processingResult,
      errorMessage,
    }).returning();

    req.log.info({ clientTxnId, processingResult }, "EKQR test webhook fired");

    res.json({
      clientTxnId,
      ekqrEnabled,
      processingResult,
      errorMessage,
      logId: logRow?.id ?? null,
      syntheticPayload,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/system-config/ekqr/test
// Places a test create_order call to verify the API key works.
router.post("/ekqr/test", async (req, res, next) => {
  try {
    const [keyRow] = await db.select({ value: systemConfigTable.value })
      .from(systemConfigTable).where(eq(systemConfigTable.key, SYSTEM_CONFIG_KEYS.EKQR_API_KEY)).limit(1);

    const apiKey = keyRow?.value ?? "";
    if (!apiKey) { res.status(400).json({ error: "EKQR API key is not configured" }); return; }

    const testPayload = {
      key: apiKey,
      client_txn_id: ekqrClientTxnId(0) + "-test-" + Date.now(),
      amount: "1.00",
      p_info: "RasoKart Test",
      customer_name: "Test User",
      customer_email: "test@rasokart.com",
      customer_mobile: "9999999999",
      redirect_url: "https://rasokart.com",
    };

    const { raw, parsed } = await ekqrCreateOrder(testPayload);
    req.log.info({ status: parsed.status, msg: parsed.msg }, "EKQR test connection result");
    res.json({ ok: parsed.status === true, msg: parsed.msg, raw });
  } catch (err) { next(err); }
});

export default router;
