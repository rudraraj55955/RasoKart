import { db, otpSmsSettingsTable, smsSendLogsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { safeDecrypt } from "./encryptionHelper";
import { sendViaProvider, type SmsSendOptions } from "./smsProviders";
import { hashIdentifier } from "./otp";

export interface SmsOtpResult {
  sent: boolean;
  provider: string | null;
  fallbackUsed: boolean;
}

/** Load the singleton OTP SMS settings row (id=1). Returns null if not configured. */
export async function loadOtpSmsSettings() {
  const [row] = await db.select().from(otpSmsSettingsTable).where(eq(otpSmsSettingsTable.id, 1)).limit(1);
  return row ?? null;
}

export async function sendOtpSms(opts: {
  mobile: string;
  otp: string;
  purpose: "LOGIN" | "PASSWORD_RESET" | "KYC_MOBILE";
  merchantId: number | null;
}): Promise<SmsOtpResult> {
  const { mobile, otp, purpose, merchantId } = opts;
  const settings = await loadOtpSmsSettings();

  if (!settings || !settings.otpLoginEnabled) {
    logger.info({ reason: "sms_disabled_or_unconfigured" }, "sendOtpSms_skipped");
    return { sent: false, provider: null, fallbackUsed: false };
  }

  const apiKey = safeDecrypt(settings.apiKeyEncrypted, settings.apiKeyIv, settings.apiKeyTag);
  if (!apiKey) {
    logger.warn({ provider: settings.provider }, "sendOtpSms_no_api_key");
    return { sent: false, provider: settings.provider, fallbackUsed: false };
  }

  const templateText = purpose === "KYC_MOBILE"
    ? "Your RasoKart KYC mobile verification OTP is ##OTP##. Valid for 5 minutes. Do not share."
    : (settings.otpTemplateText ?? "Your login OTP is ##OTP##. Valid for 5 minutes. Do not share.");
  const mobileHash = hashIdentifier(mobile);
  const mobileLast4 = mobile.replace(/\D/g, "").slice(-4) || null;

  const primaryOpts: SmsSendOptions = {
    mobile,
    otp,
    templateText,
    senderId: settings.senderId ?? null,
    apiKey,
    dltTemplateId: settings.dltTemplateId ?? null,
    dltEntityId: settings.dltEntityId ?? null,
    destinationCountry: settings.destinationCountry ?? "IN",
  };

  const primaryResult = await sendViaProvider(settings.provider, primaryOpts);

  if (primaryResult.ok) {
    await db.insert(smsSendLogsTable).values({
      mobileHash,
      mobileLast4,
      otpPurpose: purpose,
      providerUsed: settings.provider,
      status: "success",
      fallbackAttempted: false,
      providerMsgId: primaryResult.msgId,
      merchantId,
    }).catch((err: unknown) => logger.warn({ err }, "sms_log_insert_error"));
    return { sent: true, provider: settings.provider, fallbackUsed: false };
  }

  logger.warn({ provider: settings.provider, error: primaryResult.errorReason }, "sms_primary_failed");

  if (settings.smsFallbackEnabled && settings.fallbackProvider) {
    const fbApiKey = safeDecrypt(settings.fallbackApiKeyEncrypted, settings.fallbackApiKeyIv, settings.fallbackApiKeyTag);
    if (fbApiKey) {
      const fallbackOpts: SmsSendOptions = {
        mobile,
        otp,
        templateText,
        senderId: settings.fallbackSenderId ?? null,
        apiKey: fbApiKey,
        dltTemplateId: settings.fallbackDltTemplateId ?? null,
        dltEntityId: null,
        destinationCountry: settings.destinationCountry ?? "IN",
      };
      const fallbackResult = await sendViaProvider(settings.fallbackProvider, fallbackOpts);

      await db.insert(smsSendLogsTable).values({
        mobileHash,
        mobileLast4,
        otpPurpose: purpose,
        providerUsed: settings.provider,
        status: fallbackResult.ok ? "fallback_success" : "fallback_failed",
        fallbackAttempted: true,
        fallbackProviderUsed: settings.fallbackProvider,
        providerMsgId: fallbackResult.msgId,
        errorReason: fallbackResult.ok ? null : (fallbackResult.errorReason ?? primaryResult.errorReason),
        merchantId,
      }).catch((err: unknown) => logger.warn({ err }, "sms_log_insert_error"));

      if (fallbackResult.ok) {
        return { sent: true, provider: settings.fallbackProvider, fallbackUsed: true };
      }
      logger.warn({ provider: settings.fallbackProvider, error: fallbackResult.errorReason }, "sms_fallback_failed");
    }
  }

  await db.insert(smsSendLogsTable).values({
    mobileHash,
    mobileLast4,
    otpPurpose: purpose,
    providerUsed: settings.provider,
    status: "failed",
    fallbackAttempted: settings.smsFallbackEnabled && !!settings.fallbackProvider,
    errorReason: primaryResult.errorReason,
    merchantId,
  }).catch((err: unknown) => logger.warn({ err }, "sms_log_insert_error"));

  return { sent: false, provider: settings.provider, fallbackUsed: false };
}
