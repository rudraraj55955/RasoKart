import { logger } from "../lib/logger";

const MSG91_EMAIL_OTP_ENDPOINT = "https://control.msg91.com/api/v5/email/otp";
const VERIFIED_SENDER_DOMAIN = "notify.rasokart.com";
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
  templateIdSet: boolean;
  templateIdSource: "env" | "not-set";
  fromEmail: string;
  fromEmailSet: boolean;
  fromEmailSource: "env" | "not-set";
  fromName: string;
  fromNameSource: "env" | "default";
  senderDomain: string;
  domainSource: "env" | "default";
  fromAddress: string;
}

export function getEmailOtpConfig(): EmailOtpConfig {
  const authKey = process.env["MSG91_AUTH_KEY"];
  const templateId = process.env["MSG91_EMAIL_TEMPLATE_ID"] || null;
  const fromEmail = process.env["MSG91_FROM_EMAIL"] || null;
  const fromName = process.env["MSG91_FROM_NAME"] || DEFAULT_FROM_NAME;
  const domain = process.env["MSG91_EMAIL_DOMAIN"] || VERIFIED_SENDER_DOMAIN;
  return {
    authKeySet: !!authKey,
    authKeyMasked: authKey ? "••••••••••••••••" : null,
    templateId: templateId ?? "(not set — add MSG91_EMAIL_TEMPLATE_ID to .env)",
    templateIdSet: !!templateId,
    templateIdSource: templateId ? "env" : "not-set",
    fromEmail: fromEmail ?? "(not set — add MSG91_FROM_EMAIL to .env)",
    fromEmailSet: !!fromEmail,
    fromEmailSource: fromEmail ? "env" : "not-set",
    fromName,
    fromNameSource: process.env["MSG91_FROM_NAME"] ? "env" : "default",
    senderDomain: domain,
    domainSource: process.env["MSG91_EMAIL_DOMAIN"] ? "env" : "default",
    fromAddress: fromEmail ? `${fromName} <${fromEmail}>` : `${fromName} <(not configured)>`,
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

  const templateId = process.env["MSG91_EMAIL_TEMPLATE_ID"] || null;
  if (!templateId) {
    logger.error("MSG91_EMAIL_TEMPLATE_ID not set — refusing to send without an approved template ID");
    return {
      sent: false,
      errorReason: "MSG91_EMAIL_TEMPLATE_ID not configured. Set it to the exact approved template ID from MSG91 → Email → Templates.",
    };
  }

  const fromEmail = process.env["MSG91_FROM_EMAIL"] || null;
  if (!fromEmail) {
    logger.error("MSG91_FROM_EMAIL not set — refusing to send without a verified sender address");
    return {
      sent: false,
      errorReason: "MSG91_FROM_EMAIL not configured. Set it to the verified sender email for notify.rasokart.com in MSG91.",
    };
  }

  const fromName = process.env["MSG91_FROM_NAME"] || DEFAULT_FROM_NAME;
  const domain = process.env["MSG91_EMAIL_DOMAIN"] || VERIFIED_SENDER_DOMAIN;
  const fromAddress = `${fromName} <${fromEmail}>`;

  const body: Record<string, unknown> = {
    template_id: templateId,
    domain,
    from: fromAddress,
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
      { status: resp.status, body: data, templateId, senderDomain: domain },
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
      { msg, templateId, senderDomain: domain },
      "MSG91 email OTP error response",
    );
    return {
      sent: false,
      errorReason: msg ?? "MSG91 returned error type",
      statusCode: resp.status,
      providerResponse: data,
    };
  }

  logger.info({ to: opts.to, templateId }, "MSG91 email OTP sent successfully");
  return { sent: true, statusCode: resp.status, providerResponse: data };
}
