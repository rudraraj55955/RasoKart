import { logger } from "../lib/logger";

export interface SmsSendOptions {
  mobile: string;
  otp: string;
  templateText: string;
  senderId: string | null;
  apiKey: string;
  dltTemplateId: string | null;
  dltEntityId: string | null;
}

export interface SmsSendResult {
  ok: boolean;
  msgId: string | null;
  errorReason: string | null;
}

function buildMessage(templateText: string, otp: string): string {
  return templateText.replace(/\{otp\}/gi, otp);
}

function sanitizeProviderResponse(raw: unknown): string | null {
  if (!raw) return null;
  try {
    const str = typeof raw === "string" ? raw : JSON.stringify(raw);
    return str.slice(0, 200).replace(/[\r\n]/g, " ");
  } catch {
    return null;
  }
}

export async function sendViaMSG91(opts: SmsSendOptions): Promise<SmsSendResult> {
  const { mobile, otp, senderId, apiKey, dltTemplateId } = opts;
  const normalMobile = mobile.replace(/\D/g, "");
  const body: Record<string, string> = {
    mobile: normalMobile,
    otp,
  };
  if (senderId) body["sender"] = senderId;
  if (dltTemplateId) body["template_id"] = dltTemplateId;

  try {
    const resp = await fetch("https://api.msg91.com/api/v5/otp", {
      method: "POST",
      headers: {
        "authkey": apiKey,
        "content-type": "application/json",
        "accept": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const raw = await resp.json().catch(() => null);
    if (!resp.ok) {
      logger.warn({ status: resp.status, provider: "msg91" }, "sms_provider_error");
      return { ok: false, msgId: null, errorReason: sanitizeProviderResponse(raw) ?? `HTTP ${resp.status}` };
    }
    const msgId = (raw as any)?.request_id ?? null;
    return { ok: true, msgId: typeof msgId === "string" ? msgId.slice(0, 64) : null, errorReason: null };
  } catch (err: any) {
    logger.warn({ err: err?.message, provider: "msg91" }, "sms_provider_exception");
    return { ok: false, msgId: null, errorReason: "MSG91 request failed" };
  }
}

export async function sendVia2Factor(opts: SmsSendOptions): Promise<SmsSendResult> {
  const { mobile, otp, apiKey, dltTemplateId } = opts;
  const normalMobile = mobile.replace(/\D/g, "");
  const templateName = dltTemplateId ?? "AUTOGEN";
  const url = `https://2factor.in/API/V1/${encodeURIComponent(apiKey)}/SMS/${encodeURIComponent(normalMobile)}/${encodeURIComponent(otp)}/${encodeURIComponent(templateName)}`;

  try {
    const resp = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(10_000),
    });
    const raw = await resp.json().catch(() => null);
    if (!resp.ok || (raw as any)?.Status !== "Success") {
      logger.warn({ status: resp.status, provider: "2factor" }, "sms_provider_error");
      return { ok: false, msgId: null, errorReason: sanitizeProviderResponse(raw) ?? `HTTP ${resp.status}` };
    }
    const details = (raw as any)?.Details;
    return { ok: true, msgId: typeof details === "string" ? details.slice(0, 64) : null, errorReason: null };
  } catch (err: any) {
    logger.warn({ err: err?.message, provider: "2factor" }, "sms_provider_exception");
    return { ok: false, msgId: null, errorReason: "2Factor request failed" };
  }
}

export async function sendViaTwilio(opts: SmsSendOptions): Promise<SmsSendResult> {
  const { mobile, otp, senderId, apiKey, templateText } = opts;
  const [accountSid, authToken] = apiKey.split(":");
  if (!accountSid || !authToken) {
    return { ok: false, msgId: null, errorReason: "Twilio API key must be formatted as accountSid:authToken" };
  }
  const normalMobile = mobile.startsWith("+") ? mobile : `+${mobile.replace(/\D/g, "")}`;
  const fromNumber = senderId ? (senderId.startsWith("+") ? senderId : `+${senderId.replace(/\D/g, "")}`) : null;
  if (!fromNumber) {
    return { ok: false, msgId: null, errorReason: "Twilio requires sender_id (from number)" };
  }

  const params = new URLSearchParams({
    From: fromNumber,
    To: normalMobile,
    Body: buildMessage(templateText, otp),
  });

  try {
    const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
      },
      body: params.toString(),
      signal: AbortSignal.timeout(10_000),
    });
    const raw = await resp.json().catch(() => null);
    if (!resp.ok) {
      logger.warn({ status: resp.status, provider: "twilio" }, "sms_provider_error");
      return { ok: false, msgId: null, errorReason: sanitizeProviderResponse((raw as any)?.message) ?? `HTTP ${resp.status}` };
    }
    const sid = (raw as any)?.sid;
    return { ok: true, msgId: typeof sid === "string" ? sid.slice(0, 64) : null, errorReason: null };
  } catch (err: any) {
    logger.warn({ err: err?.message, provider: "twilio" }, "sms_provider_exception");
    return { ok: false, msgId: null, errorReason: "Twilio request failed" };
  }
}

export async function sendViaProvider(
  provider: string,
  opts: SmsSendOptions,
): Promise<SmsSendResult> {
  switch (provider) {
    case "msg91": return sendViaMSG91(opts);
    case "2factor": return sendVia2Factor(opts);
    case "twilio": return sendViaTwilio(opts);
    default:
      return { ok: false, msgId: null, errorReason: `Unknown SMS provider: ${provider}` };
  }
}
