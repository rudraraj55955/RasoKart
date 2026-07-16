import { Router } from "express";
import { db, otpSmsSettingsTable, merchantAuthOtpsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth, requireAdmin, requireSuperAdmin } from "../middlewares/auth";
import { encryptValue, safeDecrypt } from "../helpers/encryptionHelper";
import { generateOtp, hashOtp, verifyOtpHash, hashIdentifier } from "../helpers/otp";
import { sendViaProvider, type SmsSendOptions } from "../helpers/smsProviders";

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
    destinationCountry: row.destinationCountry ?? "IN",
    otpTemplateText: row.otpTemplateText,
    otpExpirySeconds: row.otpExpirySeconds,
    maxResendCount: row.maxResendCount,
    maxVerifyAttempts: row.maxVerifyAttempts,
    otpLoginEnabled: row.otpLoginEnabled,
    testVerified: !!row.testVerifiedAt,
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

const DEFAULT_SETTINGS = {
  id: 1,
  provider: "msg91",
  apiKeyEncrypted: null,
  senderId: null,
  dltEntityId: null,
  dltTemplateId: null,
  destinationCountry: "IN",
  otpTemplateText: "Your login OTP is ##OTP##. Valid for 10 minutes. Do not share.",
  otpExpirySeconds: 600,
  maxResendCount: 3,
  maxVerifyAttempts: 5,
  otpLoginEnabled: false,
  testVerifiedAt: null,
  smsFallbackEnabled: false,
  fallbackProvider: null,
  fallbackApiKeyEncrypted: null,
  fallbackSenderId: null,
  fallbackDltTemplateId: null,
  updatedByEmail: null,
  updatedAt: null,
};

// GET /api/admin/otp-settings — admin+ can view (key is masked)
router.get("/", async (req, res, next) => {
  try {
    const [row] = await db.select().from(otpSmsSettingsTable).where(eq(otpSmsSettingsTable.id, 1)).limit(1);
    res.json(buildSafeSettings(row ?? DEFAULT_SETTINGS));
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
      destinationCountry,
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

    const finalProvider = provider !== undefined ? String(provider) : (existing?.provider ?? "msg91");
    const finalDestinationCountry = destinationCountry !== undefined ? String(destinationCountry) : (existing?.destinationCountry ?? "IN");
    const finalSenderId = senderId !== undefined ? (senderId ? String(senderId).trim() : null) : (existing?.senderId ?? null);
    const finalDltEntityId = dltEntityId !== undefined ? (dltEntityId ? String(dltEntityId).trim() : null) : (existing?.dltEntityId ?? null);
    const finalDltTemplateId = dltTemplateId !== undefined ? (dltTemplateId ? String(dltTemplateId).trim() : null) : (existing?.dltTemplateId ?? null);
    const finalTemplateText = otpTemplateText !== undefined
      ? String(otpTemplateText).trim()
      : (existing?.otpTemplateText ?? "Your login OTP is ##OTP##. Valid for 10 minutes. Do not share.");
    const finalOtpLoginEnabled = otpLoginEnabled !== undefined ? Boolean(otpLoginEnabled) : (existing?.otpLoginEnabled ?? false);

    // ── India mandatory fields ───────────────────────────────────────────────
    if (finalDestinationCountry === "IN" && finalProvider === "msg91") {
      if (!finalSenderId) {
        res.status(400).json({ error: "Sender ID is required when destination country is India (MSG91)." }); return;
      }
      if (!finalDltEntityId) {
        res.status(400).json({ error: "DLT Entity ID is required when destination country is India (MSG91)." }); return;
      }
      if (!finalDltTemplateId) {
        res.status(400).json({ error: "DLT Template ID is required when destination country is India (MSG91)." }); return;
      }
    }

    // ── ##OTP## placeholder required for MSG91 ───────────────────────────────
    if (finalProvider === "msg91" && finalTemplateText && !finalTemplateText.includes("##OTP##")) {
      res.status(400).json({ error: "MSG91 message template must contain ##OTP## as the OTP placeholder." }); return;
    }

    // ── testVerified gate ────────────────────────────────────────────────────
    if (finalOtpLoginEnabled && !existing?.testVerifiedAt) {
      res.status(400).json({ error: "A successful test OTP must be verified before enabling SMS OTP Login." }); return;
    }

    const update: Record<string, unknown> = { updatedByEmail: user.email };

    if (provider !== undefined) update["provider"] = finalProvider;
    if (destinationCountry !== undefined) update["destinationCountry"] = finalDestinationCountry;
    if (senderId !== undefined) update["senderId"] = finalSenderId;
    if (dltEntityId !== undefined) update["dltEntityId"] = finalDltEntityId;
    if (dltTemplateId !== undefined) update["dltTemplateId"] = finalDltTemplateId;
    if (otpTemplateText !== undefined) update["otpTemplateText"] = finalTemplateText;
    if (otpExpirySeconds !== undefined) update["otpExpirySeconds"] = Number(otpExpirySeconds) || 300;
    if (maxResendCount !== undefined) update["maxResendCount"] = Number(maxResendCount) || 3;
    if (maxVerifyAttempts !== undefined) update["maxVerifyAttempts"] = Number(maxVerifyAttempts) || 5;
    if (otpLoginEnabled !== undefined) update["otpLoginEnabled"] = finalOtpLoginEnabled;
    if (smsFallbackEnabled !== undefined) update["smsFallbackEnabled"] = Boolean(smsFallbackEnabled);
    if (fallbackProvider !== undefined) update["fallbackProvider"] = fallbackProvider ? String(fallbackProvider) : null;
    if (fallbackSenderId !== undefined) update["fallbackSenderId"] = fallbackSenderId ? String(fallbackSenderId).trim() : null;
    if (fallbackDltTemplateId !== undefined) update["fallbackDltTemplateId"] = fallbackDltTemplateId ? String(fallbackDltTemplateId).trim() : null;

    if (apiKey && typeof apiKey === "string" && apiKey !== MASKED_KEY) {
      const enc = encryptValue(apiKey.trim());
      update["apiKeyEncrypted"] = enc.encrypted;
      update["apiKeyIv"] = enc.iv;
      update["apiKeyTag"] = enc.tag;
      // New key requires re-verification
      update["testVerifiedAt"] = null;
      update["otpLoginEnabled"] = false;
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

// POST /api/admin/otp-settings/test — super admin: send a real test OTP
router.post("/test", requireSuperAdmin, async (req, res, next) => {
  try {
    const { mobile } = req.body as { mobile?: string };
    if (!mobile || typeof mobile !== "string") {
      res.status(400).json({ error: "mobile is required" }); return;
    }
    const rawDigits = mobile.replace(/\D/g, "");
    if (rawDigits.length < 10) {
      res.status(400).json({ error: "Enter a valid mobile number (min 10 digits)" }); return;
    }

    const [settings] = await db.select().from(otpSmsSettingsTable).where(eq(otpSmsSettingsTable.id, 1)).limit(1);
    if (!settings) {
      res.status(400).json({ error: "OTP settings not configured. Save your settings first." }); return;
    }
    const apiKey = safeDecrypt(settings.apiKeyEncrypted, settings.apiKeyIv, settings.apiKeyTag);
    if (!apiKey) {
      res.status(400).json({ error: "MSG91 AuthKey is not set. Save it first." }); return;
    }

    const otp = generateOtp();
    const otpHash = await hashOtp(otp);
    const identifierHash = hashIdentifier(rawDigits);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10-minute test window

    // Remove any prior unconsumed SMS_TEST OTPs for this mobile
    await db.delete(merchantAuthOtpsTable).where(
      and(
        eq(merchantAuthOtpsTable.identifierHash, identifierHash),
        eq(merchantAuthOtpsTable.purpose, "SMS_TEST"),
      )
    );

    await db.insert(merchantAuthOtpsTable).values({
      merchantId: null,
      identifierHash,
      otpHash,
      purpose: "SMS_TEST",
      expiresAt,
      attempts: 0,
      resendCount: 0,
      ipHash: null,
    });

    const templateText = settings.otpTemplateText ?? "Your login OTP is ##OTP##. Valid for 5 minutes. Do not share.";
    const smsOpts: SmsSendOptions = {
      mobile: rawDigits,
      otp,
      templateText,
      senderId: settings.senderId ?? null,
      apiKey,
      dltTemplateId: settings.dltTemplateId ?? null,
      dltEntityId: settings.dltEntityId ?? null,
      destinationCountry: settings.destinationCountry ?? "IN",
    };

    const result = await sendViaProvider(settings.provider, smsOpts);

    req.log.info(
      { ok: result.ok, provider: settings.provider, mobile: `****${rawDigits.slice(-4)}` },
      "otp_sms_test_sent",
    );

    if (!result.ok) {
      res.status(502).json({
        ok: false,
        message: `SMS delivery failed: ${result.errorReason ?? "unknown error"}. Check your provider config and AuthKey.`,
      });
      return;
    }

    res.json({
      ok: true,
      provider: settings.provider,
      message: "Test OTP sent. Enter the code you received to complete verification.",
    });
  } catch (err) { next(err); }
});

// POST /api/admin/otp-settings/test/verify — super admin: verify the test OTP
router.post("/test/verify", requireSuperAdmin, async (req, res, next) => {
  try {
    const { mobile, code } = req.body as { mobile?: string; code?: string };
    if (!mobile || !code || typeof mobile !== "string" || typeof code !== "string") {
      res.status(400).json({ error: "mobile and code are required" }); return;
    }
    const rawDigits = mobile.replace(/\D/g, "");
    const identifierHash = hashIdentifier(rawDigits);

    const [otpRow] = await db
      .select()
      .from(merchantAuthOtpsTable)
      .where(and(
        eq(merchantAuthOtpsTable.identifierHash, identifierHash),
        eq(merchantAuthOtpsTable.purpose, "SMS_TEST"),
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
      await db.update(merchantAuthOtpsTable).set({ attempts: otpRow.attempts + 1 }).where(eq(merchantAuthOtpsTable.id, otpRow.id));
      res.status(400).json({ error: "Incorrect code. Please try again." }); return;
    }

    await db.update(merchantAuthOtpsTable).set({ consumedAt: new Date() }).where(eq(merchantAuthOtpsTable.id, otpRow.id));
    await db.update(otpSmsSettingsTable).set({ testVerifiedAt: new Date() } as any).where(eq(otpSmsSettingsTable.id, 1));

    req.log.info({ mobile: `****${rawDigits.slice(-4)}` }, "otp_sms_test_verified");
    res.json({ ok: true, testVerified: true, message: "Test OTP verified. You may now enable SMS OTP Login." });
  } catch (err) { next(err); }
});

export default router;
