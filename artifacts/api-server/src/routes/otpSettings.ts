import { Router } from "express";
import { db, otpSmsSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, requireAdmin, requireSuperAdmin } from "../middlewares/auth";
import { encryptValue, safeDecrypt } from "../helpers/encryptionHelper";

const router = Router();
router.use(requireAuth, requireAdmin);

const MASKED_KEY = "••••••••••••••••";

function maskKey(encrypted: string | null | undefined): string | null {
  return encrypted ? MASKED_KEY : null;
}

function buildSafeSettings(row: any) {
  return {
    id: row.id,
    provider: row.provider,
    apiKeySet: !!row.apiKeyEncrypted,
    apiKeyMasked: maskKey(row.apiKeyEncrypted),
    senderId: row.senderId,
    dltEntityId: row.dltEntityId,
    dltTemplateId: row.dltTemplateId,
    otpTemplateText: row.otpTemplateText,
    otpExpirySeconds: row.otpExpirySeconds,
    maxResendCount: row.maxResendCount,
    maxVerifyAttempts: row.maxVerifyAttempts,
    otpLoginEnabled: row.otpLoginEnabled,
    smsFallbackEnabled: row.smsFallbackEnabled,
    fallbackProvider: row.fallbackProvider,
    fallbackApiKeySet: !!row.fallbackApiKeyEncrypted,
    fallbackApiKeyMasked: maskKey(row.fallbackApiKeyEncrypted),
    fallbackSenderId: row.fallbackSenderId,
    fallbackDltTemplateId: row.fallbackDltTemplateId,
    updatedByEmail: row.updatedByEmail,
    updatedAt: row.updatedAt,
  };
}

// GET /api/admin/otp-settings — admin+ can view (key is masked)
router.get("/", async (req, res, next) => {
  try {
    const [row] = await db.select().from(otpSmsSettingsTable).where(eq(otpSmsSettingsTable.id, 1)).limit(1);
    if (!row) {
      res.json(buildSafeSettings({
        id: 1,
        provider: "msg91",
        apiKeyEncrypted: null,
        senderId: null,
        dltEntityId: null,
        dltTemplateId: null,
        otpTemplateText: "Your login code is {otp}. Valid for 5 minutes. Do not share.",
        otpExpirySeconds: 300,
        maxResendCount: 3,
        maxVerifyAttempts: 5,
        otpLoginEnabled: false,
        smsFallbackEnabled: false,
        fallbackProvider: null,
        fallbackApiKeyEncrypted: null,
        fallbackSenderId: null,
        fallbackDltTemplateId: null,
        updatedByEmail: null,
        updatedAt: null,
      }));
      return;
    }
    res.json(buildSafeSettings(row));
  } catch (err) { next(err); }
});

// PUT /api/admin/otp-settings — super admin only
router.put("/", requireSuperAdmin, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const {
      provider,
      apiKey,
      senderId,
      dltEntityId,
      dltTemplateId,
      otpTemplateText,
      otpExpirySeconds,
      maxResendCount,
      maxVerifyAttempts,
      otpLoginEnabled,
      smsFallbackEnabled,
      fallbackProvider,
      fallbackApiKey,
      fallbackSenderId,
      fallbackDltTemplateId,
    } = req.body as Record<string, unknown>;

    const [existing] = await db.select().from(otpSmsSettingsTable).where(eq(otpSmsSettingsTable.id, 1)).limit(1);

    const update: Record<string, unknown> = {
      updatedByEmail: user.email,
    };

    if (provider !== undefined) update["provider"] = String(provider);
    if (senderId !== undefined) update["senderId"] = senderId ? String(senderId) : null;
    if (dltEntityId !== undefined) update["dltEntityId"] = dltEntityId ? String(dltEntityId) : null;
    if (dltTemplateId !== undefined) update["dltTemplateId"] = dltTemplateId ? String(dltTemplateId) : null;
    if (otpTemplateText !== undefined) update["otpTemplateText"] = String(otpTemplateText);
    if (otpExpirySeconds !== undefined) update["otpExpirySeconds"] = Number(otpExpirySeconds) || 300;
    if (maxResendCount !== undefined) update["maxResendCount"] = Number(maxResendCount) || 3;
    if (maxVerifyAttempts !== undefined) update["maxVerifyAttempts"] = Number(maxVerifyAttempts) || 5;
    if (otpLoginEnabled !== undefined) update["otpLoginEnabled"] = Boolean(otpLoginEnabled);
    if (smsFallbackEnabled !== undefined) update["smsFallbackEnabled"] = Boolean(smsFallbackEnabled);
    if (fallbackProvider !== undefined) update["fallbackProvider"] = fallbackProvider ? String(fallbackProvider) : null;
    if (fallbackSenderId !== undefined) update["fallbackSenderId"] = fallbackSenderId ? String(fallbackSenderId) : null;
    if (fallbackDltTemplateId !== undefined) update["fallbackDltTemplateId"] = fallbackDltTemplateId ? String(fallbackDltTemplateId) : null;

    if (apiKey && typeof apiKey === "string" && apiKey !== MASKED_KEY) {
      const enc = encryptValue(apiKey.trim());
      update["apiKeyEncrypted"] = enc.encrypted;
      update["apiKeyIv"] = enc.iv;
      update["apiKeyTag"] = enc.tag;
    } else if (!existing) {
      update["apiKeyEncrypted"] = null;
      update["apiKeyIv"] = null;
      update["apiKeyTag"] = null;
    }

    if (fallbackApiKey && typeof fallbackApiKey === "string" && fallbackApiKey !== MASKED_KEY) {
      const enc = encryptValue(fallbackApiKey.trim());
      update["fallbackApiKeyEncrypted"] = enc.encrypted;
      update["fallbackApiKeyIv"] = enc.iv;
      update["fallbackApiKeyTag"] = enc.tag;
    } else if (!existing) {
      update["fallbackApiKeyEncrypted"] = null;
      update["fallbackApiKeyIv"] = null;
      update["fallbackApiKeyTag"] = null;
    }

    let row: any;
    if (existing) {
      const [updated] = await db
        .update(otpSmsSettingsTable)
        .set(update as any)
        .where(eq(otpSmsSettingsTable.id, 1))
        .returning();
      row = updated;
    } else {
      const [inserted] = await db
        .insert(otpSmsSettingsTable)
        .values({ id: 1, ...update } as any)
        .returning();
      row = inserted;
    }

    req.log.info({ provider: row.provider, updatedBy: user.email }, "otp_sms_settings_updated");
    res.json(buildSafeSettings(row));
  } catch (err) { next(err); }
});

// POST /api/admin/otp-settings/test — super admin: test the current SMS config
router.post("/test", requireSuperAdmin, async (req, res, next) => {
  try {
    const { mobile } = req.body as { mobile?: string };
    if (!mobile || typeof mobile !== "string") {
      res.status(400).json({ error: "mobile is required" }); return;
    }
    const normalMobile = mobile.replace(/\D/g, "");
    if (normalMobile.length < 10) {
      res.status(400).json({ error: "Enter a valid mobile number (min 10 digits)" }); return;
    }

    const { sendOtpSms } = await import("../helpers/sendOtpSms");
    const result = await sendOtpSms({ mobile: normalMobile, otp: "123456", purpose: "LOGIN", merchantId: null });

    req.log.info({ result, mobile: `****${normalMobile.slice(-4)}` }, "otp_sms_test_sent");
    res.json({
      ok: result.sent,
      provider: result.provider,
      fallbackUsed: result.fallbackUsed,
      message: result.sent
        ? `Test OTP sent successfully via ${result.provider}${result.fallbackUsed ? " (fallback)" : ""}`
        : "Failed to send test OTP. Check your provider configuration and API key.",
    });
  } catch (err) { next(err); }
});

export default router;
