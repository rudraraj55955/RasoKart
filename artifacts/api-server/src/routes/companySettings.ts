import { Router } from "express";
import { db, companySettingsTable, auditLogsTable, usersTable, COMPANY_SETTINGS_DEFAULTS } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, requireAdmin, requireSuperAdmin } from "../middlewares/auth";

const router = Router();

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^[0-9]{10,15}$/;

async function getOrCreateSettings() {
  const [existing] = await db.select().from(companySettingsTable).orderBy(companySettingsTable.id).limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(companySettingsTable)
    .values({
      companyName: COMPANY_SETTINGS_DEFAULTS.companyName,
      supportPhone: COMPANY_SETTINGS_DEFAULTS.supportPhone,
    })
    .returning();
  return created;
}

async function getUpdatedByEmail(updatedBy: number | null): Promise<string | null> {
  if (!updatedBy) return null;
  const [u] = await db.select({ email: usersTable.email }).from(usersTable).where(eq(usersTable.id, updatedBy)).limit(1);
  return u?.email ?? null;
}

// Public — no auth. Only publicly-safe fields.
router.get("/public/company-settings", async (req, res) => {
  try {
    const settings = await getOrCreateSettings();
    res.json({
      companyName: settings.companyName,
      supportPhone: settings.supportPhone,
      supportEmail: settings.supportEmail,
      whatsappPhone: settings.whatsappPhone,
      companyAddress: settings.companyAddress,
      footerText: settings.footerText,
      grievanceOfficerName: settings.grievanceOfficerName,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to load public company settings");
    res.status(500).json({ error: "Failed to load company settings" });
  }
});

// Admin + Super Admin — full read (normal admin gets read-only view on the frontend).
router.get("/admin/company-settings", requireAuth, requireAdmin, async (req, res) => {
  try {
    const settings = await getOrCreateSettings();
    const updatedByEmail = await getUpdatedByEmail(settings.updatedBy);
    res.json({
      id: settings.id,
      companyName: settings.companyName,
      supportPhone: settings.supportPhone,
      supportEmail: settings.supportEmail,
      whatsappPhone: settings.whatsappPhone,
      companyAddress: settings.companyAddress,
      footerText: settings.footerText,
      grievanceOfficerName: settings.grievanceOfficerName,
      updatedBy: settings.updatedBy,
      updatedByEmail,
      createdAt: settings.createdAt.toISOString(),
      updatedAt: settings.updatedAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to load admin company settings");
    res.status(500).json({ error: "Failed to load company settings" });
  }
});

// Super Admin only — update.
router.patch("/admin/company-settings", requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const user = (req as any).user;
    const { companyName, supportPhone, supportEmail, whatsappPhone, companyAddress, footerText, grievanceOfficerName } = req.body ?? {};

    if (typeof companyName !== "string" || companyName.trim().length === 0) {
      res.status(400).json({ error: "Company name is required" });
      return;
    }
    if (typeof supportPhone !== "string" || !PHONE_REGEX.test(supportPhone.trim())) {
      res.status(400).json({ error: "Support phone is required and must be 10-15 digits" });
      return;
    }
    if (supportEmail != null && supportEmail !== "" && !EMAIL_REGEX.test(supportEmail)) {
      res.status(400).json({ error: "Support email is not a valid email address" });
      return;
    }

    const existing = await getOrCreateSettings();

    const nextValues = {
      companyName: companyName.trim(),
      supportPhone: supportPhone.trim(),
      supportEmail: supportEmail ? supportEmail.trim() : null,
      whatsappPhone: whatsappPhone ? String(whatsappPhone).trim() : null,
      companyAddress: companyAddress ? String(companyAddress).trim() : null,
      footerText: footerText ? String(footerText).trim() : null,
      grievanceOfficerName: grievanceOfficerName ? String(grievanceOfficerName).trim() : null,
    };

    const changedFields = (Object.keys(nextValues) as (keyof typeof nextValues)[]).filter(
      (key) => (existing as any)[key] !== nextValues[key]
    );

    const [updated] = await db
      .update(companySettingsTable)
      .set({ ...nextValues, updatedBy: user.id })
      .where(eq(companySettingsTable.id, existing.id))
      .returning();

    if (changedFields.length > 0) {
      await db.insert(auditLogsTable).values({
        adminId: user.id,
        adminEmail: user.email,
        action: "company_settings_updated",
        targetType: "company_settings",
        targetId: updated.id,
        details: JSON.stringify({ actorSuperAdminId: user.id, changedFields }),
        ipAddress: (req as any).ip ?? null,
      });
    }

    req.log.info({ changedFields }, "Company settings updated");

    res.json({
      id: updated.id,
      companyName: updated.companyName,
      supportPhone: updated.supportPhone,
      supportEmail: updated.supportEmail,
      whatsappPhone: updated.whatsappPhone,
      companyAddress: updated.companyAddress,
      footerText: updated.footerText,
      grievanceOfficerName: updated.grievanceOfficerName,
      updatedBy: updated.updatedBy,
      updatedByEmail: user.email,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to update company settings");
    res.status(500).json({ error: "Failed to update company settings" });
  }
});

export default router;
