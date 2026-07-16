import { logger } from "../lib/logger";

const MSG91_EMAIL_OTP_ENDPOINT = "https://control.msg91.com/api/v5/email/otp";
const DEFAULT_TEMPLATE_ID = "global_otp";
const DEFAULT_FROM_EMAIL = "no-reply@notify.rasokart.com";
const DEFAULT_FROM_NAME = "RasoKart";
const OTP_EXPIRY_MINUTES = 10;

export interface EmailOtpResult {
  sent: boolean;
  errorReason?: string;
  statusCode?: number;
  providerResponse?: unknown;
}

export interface EmailOtpConfig {
  authKeySet: boolean;
  authKeyMasked: string | null;
  templateId: string;
  templateIdSource: "env" | "default";
  fromEmail: string;
  fromEmailSource: "env" | "default";
  fromName: string;
  fromNameSource: "env" | "default";
  senderDomain: string;
  fromAddress: string;
}

export function getEmailOtpConfig(): EmailOtpConfig {
  const authKey = process.env["MSG91_AUTH_KEY"];
  const templateId = process.env["MSG91_EMAIL_TEMPLATE_ID"] || DEFAULT_TEMPLATE_ID;
  const fromEmail = process.env["MSG91_FROM_EMAIL"] || DEFAULT_FROM_EMAIL;
  const fromName = process.env["MSG91_FROM_NAME"] || DEFAULT_FROM_NAME;
  const atIndex = fromEmail.indexOf("@");
  const senderDomain = atIndex !== -1 ? fromEmail.slice(atIndex + 1) : DEFAULT_FROM_EMAIL.split("@")[1]!;
  return {
    authKeySet: !!authKey,
    authKeyMasked: authKey ? "••••••••••••••••" : null,
    templateId,
    templateIdSource: process.env["MSG91_EMAIL_TEMPLATE_ID"] ? "env" : "default",
    fromEmail,
    fromEmailSource: process.env["MSG91_FROM_EMAIL"] ? "env" : "default",
    fromName,
    fromNameSource: process.env["MSG91_FROM_NAME"] ? "env" : "default",
    senderDomain,
    fromAddress: `${fromName} <${fromEmail}>`,
  };
}

export async function sendMsg91EmailOtp(opts: {
  to: string;
  toName: string;
  otp: string;
}): Promise<EmailOtpResult> {
  const authKey = process.env["MSG91_AUTH_KEY"];
  if (!authKey) {
    logger.warn("MSG91_AUTH_KEY not configured; MSG91 email OTP unavailable");
    return { sent: false, errorReason: "MSG91_AUTH_KEY environment variable not set on server" };
  }

  const cfg = getEmailOtpConfig();

  const body: Record<string, unknown> = {
    template_id: cfg.templateId,
    domain: cfg.senderDomain,
    from: cfg.fromAddress,
    to: [{ name: opts.toName || opts.to.split("@")[0], email: opts.to }],
    OTP: opts.otp,
    OTP_EXPIRY: OTP_EXPIRY_MINUTES,
    variables: { otp: opts.otp },
  };

  let resp: Response;
  try {
    resp = await fetch(MSG91_EMAIL_OTP_ENDPOINT, {
      method: "POST",
      headers: {
        "authkey": authKey,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (err: unknown) {
    logger.warn({ err }, "MSG91 email OTP network error");
    return { sent: false, errorReason: "Network error reaching MSG91 API" };
  }

  let data: unknown;
  try { data = await resp.json(); } catch { data = null; }

  if (!resp.ok) {
    const errMsg = (data as Record<string, unknown> | null)?.["message"] as string | undefined;
    logger.warn(
      { status: resp.status, body: data, templateId: cfg.templateId, senderDomain: cfg.senderDomain },
      "MSG91 email OTP non-ok response",
    );
    return {
      sent: false,
      errorReason: errMsg ?? `HTTP ${resp.status}`,
      statusCode: resp.status,
      providerResponse: data,
    };
  }

  const type = (data as Record<string, unknown> | null)?.["type"];
  if (type === "error") {
    const msg = (data as Record<string, unknown>)?.["message"] as string | undefined;
    logger.warn(
      { msg, templateId: cfg.templateId, senderDomain: cfg.senderDomain },
      "MSG91 email OTP error response",
    );
    return {
      sent: false,
      errorReason: msg ?? "MSG91 returned error type",
      statusCode: resp.status,
      providerResponse: data,
    };
  }

  logger.info({ to: opts.to, templateId: cfg.templateId }, "MSG91 email OTP sent successfully");
  return { sent: true, statusCode: resp.status, providerResponse: data };
}
