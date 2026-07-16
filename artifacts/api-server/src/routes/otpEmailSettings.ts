import { Router } from "express";
import { db, otpEmailSettingsTable, merchantAuthOtpsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth, requireAdmin, requireSuperAdmin } from "../middlewares/auth";
import { generateOtp, hashOtp, verifyOtpHash, hashIdentifier, OTP_EXPIRY_MS, OTP_RESEND_COOLDOWN_MS } from "../helpers/otp";
import { getEmailOtpConfig, sendMsg91EmailOtp } from "../helpers/sendMsg91EmailOtp";

const router = Router();
router.use(requireAuth, requireAdmin);

function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at === -1) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.length <= 2) return `${local[0] ?? ""}***@${domain}`;
  return `${local[0]}${"*".repeat(Math.min(local.length - 2, 5))}${local[local.length - 1]}@${domain}`;
}

function buildResponse(row: {
  otpExpirySeconds: number;
  otpLoginEnabled: boolean;
  testVerifiedAt: Date | null;
  updatedByEmail: string | null;
  updatedAt: Date | null;
}) {
  const cfg = getEmailOtpConfig();
  return {
    ...cfg,
    otpExpirySeconds: row.otpExpirySeconds,
    resendCooldownSeconds: Math.round(OTP_RESEND_COOLDOWN_MS / 1000),
    otpLoginEnabled: row.otpLoginEnabled,
    testVerified: !!row.testVerifiedAt,
    testVerifiedAt: row.testVerifiedAt ?? null,
    updatedByEmail: row.updatedByEmail ?? null,
    updatedAt: row.updatedAt ?? null,
  };
}

const DEFAULT_ROW = {
  otpExpirySeconds: 600,
  otpLoginEnabled: false,
  testVerifiedAt: null as Date | null,
  updatedByEmail: null as string | null,
  updatedAt: null as Date | null,
};

// GET /api/admin/otp-email-settings
router.get("/", async (req, res, next) => {
  try {
    const [row] = await db
      .select()
      .from(otpEmailSettingsTable)
      .where(eq(otpEmailSettingsTable.id, 1))
      .limit(1);
    res.json(buildResponse(row ?? DEFAULT_ROW));
  } catch (err) { next(err); }
});

// PUT /api/admin/otp-email-settings — super admin only
router.put("/", requireSuperAdmin, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const { otpLoginEnabled, otpExpirySeconds } = req.body as Record<string, unknown>;

    const [existing] = await db
      .select()
      .from(otpEmailSettingsTable)
      .where(eq(otpEmailSettingsTable.id, 1))
      .limit(1);

    const finalOtpLoginEnabled = otpLoginEnabled !== undefined
      ? Boolean(otpLoginEnabled)
      : (existing?.otpLoginEnabled ?? false);
    const finalOtpExpirySeconds = otpExpirySeconds !== undefined
      ? (Number(otpExpirySeconds) || 600)
      : (existing?.otpExpirySeconds ?? 600);

    if (finalOtpLoginEnabled && !existing?.testVerifiedAt) {
      res.status(400).json({ error: "A successful test Email OTP must be verified before enabling Email OTP Login." });
      return;
    }

    const cfg = getEmailOtpConfig();
    if (finalOtpLoginEnabled && !cfg.authKeySet) {
      res.status(400).json({ error: "MSG91_AUTH_KEY is not set on the server. Add it to /var/www/rasokart/.env and restart PM2." });
      return;
    }

    const update = {
      otpLoginEnabled: finalOtpLoginEnabled,
      otpExpirySeconds: finalOtpExpirySeconds,
      updatedByEmail: user.email,
    };

    let row: typeof existing;
    if (existing) {
      const [updated] = await db
        .update(otpEmailSettingsTable)
        .set(update)
        .where(eq(otpEmailSettingsTable.id, 1))
        .returning();
      row = updated;
    } else {
      const [inserted] = await db
        .insert(otpEmailSettingsTable)
        .values({ id: 1, ...update })
        .returning();
      row = inserted;
    }

    req.log.info({ otpLoginEnabled: row?.otpLoginEnabled, updatedBy: user.email }, "otp_email_settings_updated");
    res.json(buildResponse(row ?? DEFAULT_ROW));
  } catch (err) { next(err); }
});

// POST /api/admin/otp-email-settings/test — super admin: send test email OTP
router.post("/test", requireSuperAdmin, async (req, res, next) => {
  try {
    const { email } = req.body as { email?: string };
    if (!email || typeof email !== "string") {
      res.status(400).json({ error: "email is required" }); return;
    }
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail.includes("@") || cleanEmail.length < 5) {
      res.status(400).json({ error: "Enter a valid email address" }); return;
    }

    const cfg = getEmailOtpConfig();
    if (!cfg.authKeySet) {
      res.status(400).json({
        ok: false,
        errorReason: "MSG91_AUTH_KEY environment variable not set on server",
        msg91StatusCode: null,
        msg91Response: null,
        message: "MSG91_AUTH_KEY is not configured. Add it to /var/www/rasokart/.env and restart PM2 with --update-env.",
      }); return;
    }

    const otp = generateOtp();
    const otpHash = await hashOtp(otp);
    const identifierHash = hashIdentifier(cleanEmail);
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS);

    await db.delete(merchantAuthOtpsTable).where(
      and(
        eq(merchantAuthOtpsTable.identifierHash, identifierHash),
        eq(merchantAuthOtpsTable.purpose, "EMAIL_TEST"),
      )
    );

    await db.insert(merchantAuthOtpsTable).values({
      merchantId: null,
      identifierHash,
      otpHash,
      purpose: "EMAIL_TEST",
      expiresAt,
      attempts: 0,
      resendCount: 0,
      ipHash: null,
    });

    const result = await sendMsg91EmailOtp({
      to: cleanEmail,
      toName: cleanEmail.split("@")[0] ?? cleanEmail,
      otp,
    });

    const recipientMasked = maskEmail(cleanEmail);

    req.log.info(
      { ok: result.sent, recipient: recipientMasked, templateId: cfg.templateId, senderDomain: cfg.senderDomain },
      "otp_email_test_sent",
    );

    if (!result.sent) {
      await db.delete(merchantAuthOtpsTable).where(
        and(
          eq(merchantAuthOtpsTable.identifierHash, identifierHash),
          eq(merchantAuthOtpsTable.purpose, "EMAIL_TEST"),
        )
      ).catch(() => {});

      res.status(502).json({
        ok: false,
        provider: "MSG91 Email API",
        recipientMasked,
        templateId: cfg.templateId,
        fromEmail: cfg.fromEmail,
        senderDomain: cfg.senderDomain,
        msg91StatusCode: result.statusCode ?? null,
        msg91Response: result.providerResponse ?? null,
        errorReason: result.errorReason ?? "Unknown error",
        message: `Email delivery failed: ${result.errorReason ?? "Unknown error"}. Check MSG91 → Logs → Failed Requests for details.`,
      });
      return;
    }

    res.json({
      ok: true,
      provider: "MSG91 Email API",
      recipientMasked,
      templateId: cfg.templateId,
      fromEmail: cfg.fromEmail,
      senderDomain: cfg.senderDomain,
      msg91StatusCode: result.statusCode ?? null,
      msg91Response: result.providerResponse ?? null,
      message: "Test OTP sent via MSG91. Enter the code from your inbox to verify delivery.",
    });
  } catch (err) { next(err); }
});

// POST /api/admin/otp-email-settings/test/verify — super admin: verify test email OTP
router.post("/test/verify", requireSuperAdmin, async (req, res, next) => {
  try {
    const { email, code } = req.body as { email?: string; code?: string };
    if (!email || !code || typeof email !== "string" || typeof code !== "string") {
      res.status(400).json({ error: "email and code are required" }); return;
    }
    const cleanEmail = email.trim().toLowerCase();
    const identifierHash = hashIdentifier(cleanEmail);

    const [otpRow] = await db
      .select()
      .from(merchantAuthOtpsTable)
      .where(and(
        eq(merchantAuthOtpsTable.identifierHash, identifierHash),
        eq(merchantAuthOtpsTable.purpose, "EMAIL_TEST"),
      ))
      .orderBy(desc(merchantAuthOtpsTable.createdAt))
      .limit(1);

    if (!otpRow || otpRow.consumedAt || otpRow.expiresAt.getTime() < Date.now()) {
      res.status(400).json({ error: "Test code expired or not found. Send a new test OTP first." }); return;
    }
    if (otpRow.attempts >= 5) {
      res.status(429).json({ error: "Too many incorrect attempts. Send a new test OTP." }); return;
    }

    const valid = await verifyOtpHash(code.trim(), otpRow.otpHash);
    if (!valid) {
      await db.update(merchantAuthOtpsTable)
        .set({ attempts: otpRow.attempts + 1 })
        .where(eq(merchantAuthOtpsTable.id, otpRow.id));
      res.status(400).json({ error: "Incorrect code. Please try again." }); return;
    }

    await db.update(merchantAuthOtpsTable)
      .set({ consumedAt: new Date() })
      .where(eq(merchantAuthOtpsTable.id, otpRow.id));

    const [existing] = await db
      .select()
      .from(otpEmailSettingsTable)
      .where(eq(otpEmailSettingsTable.id, 1))
      .limit(1);

    if (existing) {
      await db.update(otpEmailSettingsTable)
        .set({ testVerifiedAt: new Date() })
        .where(eq(otpEmailSettingsTable.id, 1));
    } else {
      await db.insert(otpEmailSettingsTable).values({ id: 1, testVerifiedAt: new Date() });
    }

    req.log.info({ recipient: maskEmail(cleanEmail) }, "otp_email_test_verified");
    res.json({ ok: true, testVerified: true, message: "Email OTP verified. You may now enable Email OTP Login." });
  } catch (err) { next(err); }
});

export default router;
