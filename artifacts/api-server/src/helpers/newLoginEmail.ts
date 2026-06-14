import { logger } from "../lib/logger";
import { maskIp } from "./apiKeyEmail";
import { maybeQueueOrSendEmail } from "./quietHours";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

export async function sendNewLoginAlertEmail(opts: {
  userId: number;
  to: string;
  businessName: string;
  loginIp: string;
  loginAt: Date;
  trustToken: string;
}): Promise<void> {
  const { userId, to, businessName, loginIp, loginAt, trustToken } = opts;

  const formattedDate = loginAt.toUTCString();
  const maskedIp = maskIp(loginIp);
  const appUrl = process.env["APP_URL"] ?? "https://rasokart.com";
  const securityUrl = `${appUrl}/merchant/security`;
  const trustUrl = `${appUrl}/api/auth/trust-ip?token=${encodeURIComponent(trustToken)}`;

  const detailRows = [
    { label: "IP address", value: escapeHtml(maskedIp) },
    { label: "Date &amp; time", value: escapeHtml(formattedDate) },
  ]
    .map(
      d => `
      <tr>
        <td style="padding:4px 0;font-size:13px;color:#9ca3af;width:120px;">${d.label}</td>
        <td style="padding:4px 0;font-size:13px;color:#e5e7eb;">${d.value}</td>
      </tr>`,
    )
    .join("");

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>New Login Detected — RasoKart</title>
</head>
<body style="margin:0;padding:0;background:#0f0f0f;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f0f;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#1a1a1a;border-radius:12px;overflow:hidden;border:1px solid #2a2a2a;">

          <!-- Header -->
          <tr>
            <td style="background:#111;padding:32px 40px;border-bottom:1px solid #2a2a2a;">
              <span style="font-size:22px;font-weight:700;color:#fff;letter-spacing:-0.5px;">Raso<span style="color:#f97316;">Kart</span></span>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px;">
              <h1 style="margin:0 0 8px;font-size:22px;font-weight:600;color:#f1f1f1;">
                New Login from a Different IP
              </h1>
              <p style="margin:0 0 24px;font-size:14px;color:#9ca3af;line-height:1.6;">
                A successful login to your RasoKart account was detected from a new IP address.
              </p>

              <p style="margin:0 0 24px;font-size:15px;color:#d1d5db;line-height:1.6;">
                Dear <strong style="color:#fff;">${escapeHtml(businessName)}</strong>,
              </p>

              <p style="margin:0 0 24px;font-size:15px;color:#d1d5db;line-height:1.6;">
                If this was you, no action is needed. If you do not recognise this login, secure your account immediately by changing your password and contacting support.
              </p>

              <!-- Details box -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                <tr>
                  <td style="background:#111;border-left:3px solid #f97316;border-radius:6px;padding:16px 20px;">
                    <p style="margin:0 0 10px;font-size:12px;font-weight:600;color:#f97316;text-transform:uppercase;letter-spacing:0.05em;">Login Details</p>
                    <table width="100%" cellpadding="0" cellspacing="0">
                      ${detailRows}
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Action buttons -->
              <table cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
                <tr>
                  <td style="background:#22c55e;border-radius:6px;padding:12px 24px;">
                    <a href="${trustUrl}" style="color:#fff;font-size:14px;font-weight:600;text-decoration:none;">
                      ✓ This Was Me — Trust This IP
                    </a>
                  </td>
                </tr>
              </table>

              <table cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
                <tr>
                  <td style="background:#f97316;border-radius:6px;padding:12px 24px;">
                    <a href="${securityUrl}" style="color:#fff;font-size:14px;font-weight:600;text-decoration:none;">
                      View Security Activity
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 16px;font-size:13px;color:#6b7280;line-height:1.6;">
                Clicking "Trust This IP" will stop future login alerts from this IP address. You can manage trusted IPs from your security settings at any time.
              </p>

              <p style="margin:0;font-size:14px;color:#9ca3af;line-height:1.6;">
                If you did not perform this login, please contact <a href="mailto:support@rasokart.com" style="color:#f97316;text-decoration:none;">support@rasokart.com</a> immediately and change your password.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 40px;border-top:1px solid #2a2a2a;background:#111;">
              <p style="margin:0;font-size:12px;color:#6b7280;line-height:1.6;">
                This is an automated security alert from RasoKart. Please do not reply directly to this email.
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

  const sent = await maybeQueueOrSendEmail({
    userId,
    to,
    subject: "Security Alert: New Login Detected — RasoKart",
    html,
  });

  if (!sent) {
    logger.warn({ to, businessName }, "New login alert email could not be sent (SMTP not configured or failed)");
  }
}
