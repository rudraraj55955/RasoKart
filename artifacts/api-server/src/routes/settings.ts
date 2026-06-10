import { Router } from "express";
import { db, systemSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { sendMail } from "../helpers/mailer";

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

// POST /api/settings/test-email
router.post("/test-email", async (req, res, next) => {
  try {
    const rows = await db
      .select()
      .from(systemSettingsTable)
      .where(eq(systemSettingsTable.key, "finance_report_email"));

    const email = rows[0]?.value ?? null;

    if (!email) {
      res.status(400).json({ error: "No finance report email configured" });
      return;
    }

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
      res.status(502).json({ error: "SMTP is not configured or failed to send — check SMTP_HOST, SMTP_USER, SMTP_PASS" });
      return;
    }

    res.json({ ok: true, to: email });
  } catch (err) {
    next(err);
  }
});

export default router;
