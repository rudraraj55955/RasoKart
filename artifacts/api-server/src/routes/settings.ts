import { Router } from "express";
import { db, systemSettingsTable, auditLogsTable, reconciliationRunsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { sendMail, getSmtpConfig } from "../helpers/mailer";
import { buildEmailHtml, buildUnmatchedAlertHtml, buildSampleCsv } from "../helpers/reconcileEmail";
import { buildCredentialRotationHtml, notifyAdminsOfCredentialRotation } from "../helpers/adminNotifyEmail";

const router = Router();
router.use(requireAuth);
router.use(requireAdmin);

const ALLOWED_KEYS = ["finance_report_email", "reconciliation_schedule"] as const;
type SettingKey = (typeof ALLOWED_KEYS)[number];

const RECONCILIATION_SCHEDULE_VALUES = ["daily", "weekly", "off"] as const;
type ReconciliationSchedule = (typeof RECONCILIATION_SCHEDULE_VALUES)[number];

const SMTP_KEYS = ["smtp_host", "smtp_port", "smtp_user", "smtp_pass", "smtp_from"] as const;

const REPORT_DELIVERY_MAX_ATTEMPTS_DEFAULT = 3;
const REPORT_DELIVERY_BACKOFF_BASE_MS_DEFAULT = 1000;
const REPORT_DELIVERY_KEYS = ["report_delivery_max_attempts", "report_delivery_backoff_base_ms"] as const;

// GET /api/settings
router.get("/", async (req, res, next) => {
  try {
    const rows = await db
      .select()
      .from(systemSettingsTable);

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

// GET /api/settings/smtp — returns config without exposing password value
// NOTE: must be registered before the generic PUT /:key to avoid wildcard collision
router.get("/smtp", async (req, res, next) => {
  try {
    const rows = await db
      .select()
      .from(systemSettingsTable)
      .where(inArray(systemSettingsTable.key, [...SMTP_KEYS]));

    const dbMap = Object.fromEntries(rows.map(r => [r.key, r.value]));

    const host = dbMap["smtp_host"] ?? process.env["SMTP_HOST"] ?? null;
    const port = dbMap["smtp_port"] ?? process.env["SMTP_PORT"] ?? null;
    const user = dbMap["smtp_user"] ?? process.env["SMTP_USER"] ?? null;
    const from = dbMap["smtp_from"] ?? process.env["SMTP_FROM"] ?? null;
    const passConfigured = Boolean(dbMap["smtp_pass"] ?? process.env["SMTP_PASS"]);

    res.json({ host, port, user, from, passConfigured });
  } catch (err) {
    next(err);
  }
});

// PUT /api/settings/smtp — saves SMTP config fields; omit/blank password to keep existing
// NOTE: must be registered before the generic PUT /:key to avoid wildcard collision
router.put("/smtp", async (req, res, next) => {
  try {
    const user = (req as any).user;
    const { host, port, smtpUser, from, pass } = req.body as {
      host?: string;
      port?: string | number;
      smtpUser?: string;
      from?: string;
      pass?: string;
    };

    if (host !== undefined && host !== null && typeof host !== "string") {
      res.status(400).json({ error: "host must be a string" });
      return;
    }
    if (port !== undefined && port !== null) {
      const p = parseInt(String(port), 10);
      if (isNaN(p) || p < 1 || p > 65535) {
        res.status(400).json({ error: "port must be a number between 1 and 65535" });
        return;
      }
    }
    if (from !== undefined && from !== null && from !== "") {
      const emailRegex = /^.+@.+\..+$/;
      const bare = (from as string).replace(/^.*<(.+)>$/, "$1").trim();
      if (!emailRegex.test(bare)) {
        res.status(400).json({ error: "from address must contain a valid email" });
        return;
      }
    }

    const now = new Date();
    const upserts: Array<{ key: string; value: string | null }> = [];

    upserts.push({ key: "smtp_host", value: host?.trim() || null });
    upserts.push({ key: "smtp_port", value: port !== undefined && port !== null && port !== "" ? String(port) : null });
    upserts.push({ key: "smtp_user", value: (smtpUser as string)?.trim() || null });
    upserts.push({ key: "smtp_from", value: (from as string)?.trim() || null });

    if (pass !== undefined && pass !== null && (pass as string).trim() !== "") {
      upserts.push({ key: "smtp_pass", value: (pass as string).trim() });
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

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/settings/report-delivery-retries — returns current retry config with fallback to defaults
router.get("/report-delivery-retries", async (_req, res, next) => {
  try {
    const rows = await db
      .select()
      .from(systemSettingsTable)
      .where(inArray(systemSettingsTable.key, [...REPORT_DELIVERY_KEYS]));

    const dbMap = Object.fromEntries(rows.map(r => [r.key, r.value]));

    const maxAttempts = dbMap["report_delivery_max_attempts"] != null
      ? parseInt(dbMap["report_delivery_max_attempts"] as string, 10)
      : REPORT_DELIVERY_MAX_ATTEMPTS_DEFAULT;
    const backoffBaseMs = dbMap["report_delivery_backoff_base_ms"] != null
      ? parseInt(dbMap["report_delivery_backoff_base_ms"] as string, 10)
      : REPORT_DELIVERY_BACKOFF_BASE_MS_DEFAULT;

    res.json({
      maxAttempts: isNaN(maxAttempts) ? REPORT_DELIVERY_MAX_ATTEMPTS_DEFAULT : maxAttempts,
      backoffBaseMs: isNaN(backoffBaseMs) ? REPORT_DELIVERY_BACKOFF_BASE_MS_DEFAULT : backoffBaseMs,
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/settings/report-delivery-retries — saves report delivery retry config
router.put("/report-delivery-retries", async (req, res, next) => {
  try {
    const user = (req as any).user;
    const { maxAttempts, backoffBaseMs } = req.body as { maxAttempts?: unknown; backoffBaseMs?: unknown };

    if (maxAttempts === undefined || maxAttempts === null) {
      res.status(400).json({ error: "maxAttempts is required" });
      return;
    }
    const parsedMax = parseInt(String(maxAttempts), 10);
    if (isNaN(parsedMax) || parsedMax < 1 || parsedMax > 10) {
      res.status(400).json({ error: "maxAttempts must be between 1 and 10" });
      return;
    }

    if (backoffBaseMs === undefined || backoffBaseMs === null) {
      res.status(400).json({ error: "backoffBaseMs is required" });
      return;
    }
    const parsedBackoff = parseInt(String(backoffBaseMs), 10);
    if (isNaN(parsedBackoff) || parsedBackoff < 100 || parsedBackoff > 60000) {
      res.status(400).json({ error: "backoffBaseMs must be between 100 and 60000" });
      return;
    }

    const now = new Date();
    const upserts = [
      { key: "report_delivery_max_attempts", value: String(parsedMax) },
      { key: "report_delivery_backoff_base_ms", value: String(parsedBackoff) },
    ];

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
        details: JSON.stringify({ key: "report_delivery_retries", maxAttempts: parsedMax, backoffBaseMs: parsedBackoff }),
        ipAddress: req.ip ?? null,
      });
    } catch (auditErr) {
      req.log.error({ err: auditErr }, "Failed to write audit log for report_delivery_retries update");
    }

    res.json({ maxAttempts: parsedMax, backoffBaseMs: parsedBackoff });
  } catch (err) {
    next(err);
  }
});

// GET /api/settings/smtp-status — checks both DB config and env vars
router.get("/smtp-status", async (_req, res, next) => {
  try {
    const cfg = await getSmtpConfig();
    res.json({ configured: cfg !== null });
  } catch (err) {
    next(err);
  }
});

// GET /api/settings/finance_report_email/preview
router.get("/finance_report_email/preview", (_req, res) => {
  const today = new Date();
  const dateFrom = new Date(today);
  dateFrom.setDate(today.getDate() - 7);

  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  const sampleRun: typeof reconciliationRunsTable.$inferSelect = {
    id: 42,
    merchantId: null,
    dateFrom: fmt(dateFrom),
    dateTo: fmt(today),
    runAt: today,
    totalDeposits: 18,
    totalMatched: 15,
    totalUnmatched: 3,
    totalSettlements: 16,
    matchedAmount: "245820.00",
    unmatchedAmount: "18500.00",
    status: "completed",
    completedAt: today,
    createdBy: null,
    triggeredBy: "auto",
    notes: null,
    createdAt: today,
  };

  const html = buildEmailHtml(sampleRun);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

// GET /api/settings/reconciliation_alert_email/preview
router.get("/reconciliation_alert_email/preview", (_req, res) => {
  const today = new Date();
  const dateFrom = new Date(today);
  dateFrom.setDate(today.getDate() - 1);

  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  const sampleRun: typeof reconciliationRunsTable.$inferSelect = {
    id: 7,
    merchantId: null,
    dateFrom: fmt(dateFrom),
    dateTo: fmt(today),
    runAt: today,
    totalDeposits: 24,
    totalMatched: 19,
    totalUnmatched: 5,
    totalSettlements: 22,
    matchedAmount: "312400.00",
    unmatchedAmount: "47250.00",
    status: "completed",
    completedAt: today,
    createdBy: null,
    triggeredBy: "auto",
    notes: null,
    createdAt: today,
  };

  const html = buildUnmatchedAlertHtml(sampleRun);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

// POST /api/settings/finance_report_email/send-sample
router.post("/finance_report_email/send-sample", async (req, res, next) => {
  const user = (req as any).user;
  try {
    const overrideTo: string | undefined =
      typeof req.body?.to === "string" && req.body.to.trim() ? req.body.to.trim() : undefined;

    let recipientRaw: string | null = overrideTo ?? null;

    if (!recipientRaw) {
      const rows = await db
        .select()
        .from(systemSettingsTable)
        .where(eq(systemSettingsTable.key, "finance_report_email"));
      recipientRaw = rows[0]?.value ?? null;
    }

    if (!recipientRaw) {
      res.status(400).json({ error: "No recipient address — enter one below or save a finance report email first" });
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (overrideTo && !emailRegex.test(overrideTo)) {
      res.status(400).json({ error: "Invalid email address" });
      return;
    }

    const recipients = recipientRaw.split(",").map(e => e.trim()).filter(e => e.length > 0);
    if (recipients.length === 0) {
      res.status(400).json({ error: "No valid recipient addresses configured" });
      return;
    }

    const today = new Date();
    const dateFrom = new Date(today);
    dateFrom.setDate(today.getDate() - 7);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    const sampleRun: typeof reconciliationRunsTable.$inferSelect = {
      id: 42,
      merchantId: null,
      dateFrom: fmt(dateFrom),
      dateTo: fmt(today),
      runAt: today,
      totalDeposits: 18,
      totalMatched: 15,
      totalUnmatched: 3,
      totalSettlements: 16,
      matchedAmount: "258320.00",
      unmatchedAmount: "23750.00",
      status: "completed",
      completedAt: today,
      createdBy: null,
      triggeredBy: "auto",
      notes: null,
      createdAt: today,
    };

    const html = buildEmailHtml(sampleRun);
    const csv = buildSampleCsv();
    const filename = `sample-reconciliation-report-${fmt(today)}.csv`;
    const subject = `[RasoKart] Sample Finance Report — ${fmt(dateFrom)} to ${fmt(today)} (preview)`;

    const [primaryRecipient, ...ccRecipients] = recipients;

    const sent = await sendMail({
      to: primaryRecipient,
      ...(ccRecipients.length > 0 ? { cc: ccRecipients.join(", ") } : {}),
      subject,
      html,
      attachments: [{ filename, content: csv, contentType: "text/csv" }],
    });

    if (!sent) {
      res.status(502).json({ error: "SMTP is not configured or failed to send — check your SMTP settings" });
      return;
    }

    try {
      await db.insert(auditLogsTable).values({
        adminId: user.id,
        adminEmail: user.email,
        action: "sample_report_email_sent",
        targetType: "system_config",
        targetId: null,
        details: JSON.stringify({ recipients, overrideUsed: Boolean(overrideTo) }),
        ipAddress: req.ip ?? null,
      });
    } catch (auditErr) {
      req.log.error({ err: auditErr }, "Failed to write audit log for sample_report_email_sent");
    }

    res.json({ ok: true, to: recipients.join(", ") });
  } catch (err) {
    next(err);
  }
});

// POST /api/settings/test-email
router.post("/test-email", async (req, res, next) => {
  const user = (req as any).user;

  async function writeAuditLog(details: { recipients: string[]; success: boolean; error?: string }) {
    try {
      await db.insert(auditLogsTable).values({
        adminId: user.id,
        adminEmail: user.email,
        action: "test_email_sent",
        targetType: "system_config",
        targetId: null,
        details: JSON.stringify(details),
        ipAddress: req.ip ?? null,
      });
    } catch (auditErr) {
      req.log.error({ err: auditErr }, "Failed to write audit log for test_email_sent");
    }
  }

  try {
    const overrideTo: string | undefined = typeof req.body?.to === "string" && req.body.to.trim() ? req.body.to.trim() : undefined;

    let email: string | null = overrideTo ?? null;

    if (!email) {
      const rows = await db
        .select()
        .from(systemSettingsTable)
        .where(eq(systemSettingsTable.key, "finance_report_email"));
      email = rows[0]?.value ?? null;
    }

    if (!email) {
      await writeAuditLog({ recipients: [], success: false, error: "no_recipient" });
      res.status(400).json({ error: "No recipient address — enter one in the 'Send to' field or save a finance report email first" });
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (overrideTo && !emailRegex.test(overrideTo)) {
      await writeAuditLog({ recipients: [overrideTo], success: false, error: "invalid_email" });
      res.status(400).json({ error: "Invalid email address in 'Send to' field" });
      return;
    }

    const recipients = email.split(",").map(e => e.trim()).filter(e => e.length > 0);

    const sent = await sendMail({
      to: email,
      subject: "RasoKart — SMTP test email",
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
          <h2 style="margin:0 0 8px">SMTP configuration test</h2>
          <p style="color:#555;margin:0 0 16px">
            This is a test email sent from your RasoKart admin settings page.
            If you received this, your SMTP configuration is working correctly.
          </p>
          <p style="color:#888;font-size:13px;margin:0">
            Sent at ${new Date().toISOString()} — no action required.
          </p>
        </div>
      `,
    });

    if (!sent) {
      await writeAuditLog({ recipients, success: false, error: "smtp_send_failed" });
      res.status(502).json({ error: "SMTP is not configured or failed to send — check your SMTP settings" });
      return;
    }

    await writeAuditLog({ recipients, success: true });
    res.json({ ok: true, to: email });
  } catch (err) {
    next(err);
  }
});

// GET /api/settings/credential-rotation-alert/preview — HTML template preview (no email sent)
router.get("/credential-rotation-alert/preview", (_req, res) => {
  const html = buildCredentialRotationHtml({
    gateway: "cashfree",
    changedFields: ["Client ID", "Client Secret"],
    actorEmail: "admin@rasokart.com",
    timestamp: new Date().toISOString(),
  });
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

// POST /api/settings/credential-rotation-alert/send-sample
// Fires the real notifyAdminsOfCredentialRotation function with synthetic data so the full
// production path is exercised: real recipient expansion (all active admins + configured extras),
// real HTML build, and the same sendMail call as a live rotation event.
router.post("/credential-rotation-alert/send-sample", async (req, res, next) => {
  const user = (req as any).user;
  try {
    const gatewayKey: string =
      typeof req.body?.gateway === "string" && req.body.gateway.trim() ? req.body.gateway.trim() : "cashfree";

    const VALID_GATEWAYS = ["cashfree", "cashfree-payout", "ekqr"] as const;
    const resolvedGateway = VALID_GATEWAYS.includes(gatewayKey as any) ? gatewayKey : "cashfree";

    // Check SMTP config upfront so we can return a clear 502 rather than a silent no-op.
    const cfg = await getSmtpConfig();
    if (!cfg) {
      res.status(502).json({ error: "SMTP is not configured — save valid SMTP credentials first" });
      return;
    }

    // Call the real production function. This exercises:
    //   1. Real recipient expansion — all active admins + any configured extra recipients
    //   2. Real buildCredentialRotationHtml call with the same arguments shape as a live rotation
    //   3. Real sendMail invocation through the identical production code path
    // The only difference from a real rotation is the synthetic changed-fields list.
    const stats = await notifyAdminsOfCredentialRotation({
      gateway: resolvedGateway,
      changedFields: ["Client ID (TEST — no real credential was changed)", "Client Secret (TEST)"],
      actorEmail: user.email,
    });

    try {
      await db.insert(auditLogsTable).values({
        adminId: user.id,
        adminEmail: user.email,
        action: "test_email_sent",
        targetType: "system_config",
        targetId: null,
        details: JSON.stringify({ type: "credential_rotation_alert", gateway: resolvedGateway, ...stats }),
        ipAddress: req.ip ?? null,
      });
    } catch (auditErr) {
      req.log.error({ err: auditErr }, "Failed to write audit log for credential rotation alert test email");
    }

    if (stats.sent === 0) {
      res.status(502).json({
        error: stats.attempted === 0
          ? "No active admin recipients found — ensure at least one admin account is active"
          : `Delivery failed — ${stats.failed} of ${stats.attempted} recipient${stats.attempted !== 1 ? "s" : ""} could not be reached. Check SMTP credentials and server logs.`,
        stats,
      });
      return;
    }

    res.json({ ok: true, gateway: resolvedGateway, stats });
  } catch (err) {
    next(err);
  }
});

// PUT /api/settings/:key — generic key/value upsert for non-SMTP settings
// NOTE: registered last so specific routes above take precedence
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
      if (typeof value !== "string") {
        res.status(400).json({ error: "Invalid email address" });
        return;
      }
      const addresses = value.split(",").map(e => e.trim()).filter(e => e.length > 0);
      if (addresses.length === 0 || addresses.some(addr => !emailRegex.test(addr))) {
        res.status(400).json({ error: "One or more email addresses are invalid" });
        return;
      }
    }

    if (key === "reconciliation_schedule") {
      if (value !== null && value !== "" && !RECONCILIATION_SCHEDULE_VALUES.includes(value as ReconciliationSchedule)) {
        res.status(400).json({ error: `reconciliation_schedule must be one of: ${RECONCILIATION_SCHEDULE_VALUES.join(", ")}` });
        return;
      }
    }

    const normalized = (value === null || value === "") ? null : String(value).trim();

    // Fetch old value before upsert so we can record what changed
    const existing = await db
      .select()
      .from(systemSettingsTable)
      .where(eq(systemSettingsTable.key, key));
    const oldValue = existing[0]?.value ?? null;

    await db
      .insert(systemSettingsTable)
      .values({ key, value: normalized, updatedBy: user.id, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: systemSettingsTable.key,
        set: { value: normalized, updatedBy: user.id, updatedAt: new Date() },
      });

    // Write audit log after successful save
    try {
      await db.insert(auditLogsTable).values({
        adminId: user.id,
        adminEmail: user.email,
        action: "setting_updated",
        targetType: "system_config",
        targetId: null,
        details: JSON.stringify({ key, oldValue, newValue: normalized }),
        ipAddress: req.ip ?? null,
      });
    } catch (auditErr) {
      req.log.error({ err: auditErr }, "Failed to write audit log for setting_updated");
    }

    res.json({ key, value: normalized });
  } catch (err) {
    next(err);
  }
});

export default router;
