import { Router } from "express";
import { db, systemSettingsTable, auditLogsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { sendMail } from "../helpers/mailer";

const router = Router();
router.use(requireAuth);
router.use(requireAdmin);

const ALLOWED_KEYS = ["finance_report_email", "reconciliation_schedule"] as const;
type SettingKey = (typeof ALLOWED_KEYS)[number];

const RECONCILIATION_SCHEDULE_VALUES = ["daily", "weekly", "off"] as const;
type ReconciliationSchedule = (typeof RECONCILIATION_SCHEDULE_VALUES)[number];

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

// GET /api/settings/smtp-status
router.get("/smtp-status", (_req, res) => {
  const configured = Boolean(
    process.env["SMTP_HOST"] &&
    process.env["SMTP_USER"] &&
    process.env["SMTP_PASS"]
  );
  res.json({ configured });
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
      res.status(502).json({ error: "SMTP is not configured or failed to send — check SMTP_HOST, SMTP_USER, SMTP_PASS" });
      return;
    }

    await writeAuditLog({ recipients, success: true });
    res.json({ ok: true, to: email });
  } catch (err) {
    next(err);
  }
});

export default router;
