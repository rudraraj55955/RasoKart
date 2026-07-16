import { logger } from "../lib/logger";

const MSG91_EMAIL_ENDPOINT = "https://control.msg91.com/api/v5/email/send";
const VERIFIED_SENDER_DOMAIN = "notify.rasokart.com";
const DEFAULT_FROM_NAME = "RasoKart";
const OTP_EXPIRY_MINUTES = 10;

function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at === -1) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.length <= 2) return `${local[0] ?? ""}***@${domain}`;
  return `${local[0]}${"*".repeat(Math.min(local.length - 2, 5))}${local[local.length - 1]}@${domain}`;
}

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

  // POST /api/v5/email/send
  // - `from` must be an object {name, email}, not a string
  // - per-recipient `variables` must be nested inside the `to` array item
  // - template variables confirmed from global_otp template: otp, purpose_label, expiry_minutes
  // - `domain` is not a field on /email/send (removed)
  // - top-level OTP / OTP_EXPIRY fields do not exist on /email/send (removed)
  const body = {
    template_id: templateId,
    from: {
      name: fromName,
      email: fromEmail,
    },
    to: [
      {
        name: opts.toName || opts.to.split("@")[0],
        email: opts.to,
        variables: {
          otp: opts.otp,
          purpose_label: "Login",
          expiry_minutes: String(OTP_EXPIRY_MINUTES),
        },
      },
    ],
  };

  // Safe diagnostic: log endpoint + non-sensitive request fields only
  logger.info(
    {
      endpoint: MSG91_EMAIL_ENDPOINT,
      template_id: templateId,
      from_email: fromEmail,
      from_name: fromName,
      to_masked: maskEmail(opts.to),
    },
    "MSG91 email OTP request dispatched",
  );

  let resp: Response;
  try {
    resp = await fetch(MSG91_EMAIL_ENDPOINT, {
      method: "POST",
      headers: {
        "authkey": authKey,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err: unknown) {
    logger.warn({ err }, "MSG91 email OTP network error");
    return { sent: false, errorReason: "Network error reaching MSG91 API" };
  }

  let data: unknown;
  try { data = await resp.json(); } catch { data = null; }

  const requestId = (data as Record<string, unknown> | null)?.["request_id"] as string | undefined;

  if (!resp.ok) {
    const errMsg = (data as Record<string, unknown> | null)?.["message"] as string | undefined;
    // Safe log: status code, request_id from MSG91, masked recipient — no auth key, no OTP
    logger.warn(
      {
        httpStatus: resp.status,
        requestId: requestId ?? null,
        toMasked: maskEmail(opts.to),
        templateId,
        msg91ErrorMessage: errMsg ?? null,
        msg91ResponseType: (data as Record<string, unknown> | null)?.["type"] ?? null,
      },
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
      {
        httpStatus: resp.status,
        requestId: requestId ?? null,
        toMasked: maskEmail(opts.to),
        templateId,
        msg91ErrorMessage: msg ?? null,
      },
      "MSG91 email OTP error response",
    );
    return {
      sent: false,
      errorReason: msg ?? "MSG91 returned error type",
      statusCode: resp.status,
      providerResponse: data,
    };
  }

  logger.info(
    { toMasked: maskEmail(opts.to), templateId, httpStatus: resp.status, requestId: requestId ?? null },
    "MSG91 email OTP sent successfully",
  );
  return { sent: true, statusCode: resp.status, providerResponse: data };
}
