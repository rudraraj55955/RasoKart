/**
 * MSG91 Transactional Email API helper.
 *
 * Credentials come from environment variables only — never from DB or
 * frontend. Caller must ensure the OTP value is NEVER logged.
 *
 * Required env vars:
 *   MSG91_EMAIL_AUTH_KEY   — MSG91 auth key
 *   MSG91_EMAIL_TEMPLATE_OTP_ID  — approved MSG91 email template ID for OTP
 *   MSG91_EMAIL_SENDER     — from address, e.g. "RasoKart <no-reply@notify.rasokart.com>"
 *
 * If any var is missing the function returns { sent: false, reason: "unconfigured" }
 * so the caller can fall back to the SMTP mailer.
 */

import { logger } from "../lib/logger";

interface Msg91EmailResult {
  sent: boolean;
  reason?: string;
}

function getConfig(): { authKey: string; templateId: string; sender: string } | null {
  const authKey = process.env["MSG91_EMAIL_AUTH_KEY"] ?? "";
  const templateId = process.env["MSG91_EMAIL_TEMPLATE_OTP_ID"] ?? "";
  const sender = process.env["MSG91_EMAIL_SENDER"] ?? "RasoKart <no-reply@notify.rasokart.com>";
  if (!authKey || !templateId) return null;
  return { authKey, templateId, sender };
}

/**
 * Send a 6-digit OTP via MSG91 email template.
 * Template variables used: {{otp}}, {{purpose_label}}
 */
export async function sendOtpViaMSG91Email(opts: {
  to: string;
  otp: string;
  purpose: "LOGIN" | "PASSWORD_RESET" | "ADMIN_LOGIN";
}): Promise<Msg91EmailResult> {
  const { to, otp, purpose } = opts;

  const config = getConfig();
  if (!config) {
    return { sent: false, reason: "unconfigured" };
  }

  const purposeLabel =
    purpose === "PASSWORD_RESET" ? "Password Reset"
    : purpose === "ADMIN_LOGIN" ? "Admin Login"
    : "Login";

  const payload = {
    template_id: config.templateId,
    sender: config.sender,
    to: [
      {
        email: to,
        variables: {
          otp,
          purpose_label: purposeLabel,
          expiry_minutes: "5",
        },
      },
    ],
  };

  try {
    const resp = await fetch("https://control.msg91.com/api/v5/email/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "authkey": config.authKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      logger.warn({ status: resp.status, to, purpose }, "msg91_email_otp_error");
      return { sent: false, reason: `http_${resp.status}` };
    }

    return { sent: true };
  } catch (err: unknown) {
    logger.warn({ err, to, purpose }, "msg91_email_otp_exception");
    return { sent: false, reason: "network_error" };
  }
}

/** Returns true if MSG91 email is configured. */
export function isMSG91EmailConfigured(): boolean {
  return !!(process.env["MSG91_EMAIL_AUTH_KEY"] && process.env["MSG91_EMAIL_TEMPLATE_OTP_ID"]);
}
