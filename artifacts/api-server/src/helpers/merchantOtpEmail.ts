import { logger } from "../lib/logger";
import { sendMail } from "./mailer";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function buildOtpEmailHtml(opts: { title: string; subtitle: string; otp: string; expiryMinutes: number }): string {
  const { title, subtitle, otp, expiryMinutes } = opts;
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)} — RasoKart</title>
</head>
<body style="margin:0;padding:0;background:#0f0f0f;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f0f;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#1a1a1a;border-radius:12px;overflow:hidden;border:1px solid #2a2a2a;">
          <tr>
            <td style="background:#111;padding:32px 40px;border-bottom:1px solid #2a2a2a;">
              <span style="font-size:22px;font-weight:700;color:#fff;letter-spacing:-0.5px;">Raso<span style="color:#f97316;">Kart</span></span>
            </td>
          </tr>
          <tr>
            <td style="padding:40px;">
              <h1 style="margin:0 0 8px;font-size:22px;font-weight:600;color:#f1f1f1;">${escapeHtml(title)}</h1>
              <p style="margin:0 0 24px;font-size:14px;color:#9ca3af;line-height:1.6;">${escapeHtml(subtitle)}</p>
              <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr>
                  <td style="background:#111;border-left:3px solid #f97316;border-radius:6px;padding:20px 28px;">
                    <span style="font-size:32px;font-weight:700;letter-spacing:8px;color:#f97316;">${escapeHtml(otp)}</span>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 16px;font-size:14px;color:#9ca3af;line-height:1.6;">
                This code expires in ${expiryMinutes} minutes. Do not share it with anyone — RasoKart staff will never ask for this code.
              </p>
              <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.6;">
                If you did not request this code, you can safely ignore this email.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 40px;border-top:1px solid #2a2a2a;background:#111;">
              <p style="margin:0;font-size:12px;color:#6b7280;line-height:1.6;">
                This is an automated message from RasoKart. Please do not reply directly to this email.
                For support, contact <a href="mailto:support@rasokart.com" style="color:#f97316;text-decoration:none;">support@rasokart.com</a>.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

export async function sendMerchantOtpEmail(opts: {
  to: string;
  otp: string;
  purpose: "LOGIN" | "PASSWORD_RESET" | "KYC_EMAIL";
}): Promise<boolean> {
  const { to, otp, purpose } = opts;
  const isReset = purpose === "PASSWORD_RESET";
  const isKycEmail = purpose === "KYC_EMAIL";

  const title = isReset ? "Password Reset Code" : isKycEmail ? "Email Verification Code" : "Your RasoKart Login Code";
  const subtitle = isReset
    ? "Use this code to verify your identity and reset your password."
    : isKycEmail
      ? "Use this code to verify your email address as part of KYC verification."
      : "Use this code to sign in to your RasoKart merchant account.";
  const subject = isReset ? "Your RasoKart Password Reset Code" : isKycEmail ? "Your RasoKart Email Verification Code" : "Your RasoKart Login Code";

  const html = buildOtpEmailHtml({
    title,
    subtitle,
    otp,
    expiryMinutes: 5,
  });

  const sent = await sendMail({
    to,
    subject,
    html,
  }).catch((err: unknown) => {
    logger.warn({ err }, "Failed to send merchant OTP email");
    return false;
  });

  return sent;
}
