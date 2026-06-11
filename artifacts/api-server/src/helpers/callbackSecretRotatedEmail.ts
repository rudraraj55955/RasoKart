import { sendMail } from "./mailer";
import { logger } from "../lib/logger";

const APP_DOMAIN = process.env["APP_DOMAIN"] ?? "https://rasokart.com";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function maskIp(ip: string): string {
  if (!ip) return "unknown";
  const ipv4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (ipv4) {
    return `${ipv4[1]}.${ipv4[2]}.x.x`;
  }
  const ipv6 = ip.match(/^([0-9a-fA-F:]+)$/);
  if (ipv6) {
    const parts = ip.split(":");
    if (parts.length >= 3) {
      return `${parts[0]}:${parts[1]}:****`;
    }
  }
  return "unknown";
}

export async function sendCallbackSecretRotatedEmail(opts: {
  to: string;
  businessName: string;
  rotatedAt: Date;
  ipAddress: string;
}): Promise<void> {
  const { to, businessName, rotatedAt, ipAddress } = opts;

  const formattedDate = rotatedAt.toUTCString();
  const maskedIp = maskIp(ipAddress);
  const securityPageUrl = `${APP_DOMAIN}/merchant/security`;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Callback Secret Rotated — RasoKart</title>
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

          <!-- Banner -->
          <tr>
            <td style="background:#1c1917;padding:20px 40px;border-bottom:1px solid #2a2a2a;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <span style="display:inline-block;background:#f97316;color:#000;font-size:11px;font-weight:700;letter-spacing:0.08em;padding:3px 8px;border-radius:4px;text-transform:uppercase;">Security Alert</span>
                    <h1 style="margin:8px 0 4px;font-size:20px;font-weight:600;color:#fff;">Callback Signing Secret Rotated</h1>
                    <p style="margin:0;font-size:13px;color:#9ca3af;">Your webhook signing secret has been changed</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:36px 40px;">
              <p style="margin:0 0 24px;font-size:15px;color:#d1d5db;line-height:1.6;">
                Dear <strong style="color:#fff;">${escapeHtml(businessName)}</strong>,
              </p>

              <p style="margin:0 0 24px;font-size:15px;color:#d1d5db;line-height:1.6;">
                Your callback signing secret was <strong style="color:#f97316;">successfully rotated</strong>.
                Any webhook receivers that use signature verification must be updated with the new secret.
              </p>

              <!-- Details box -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                <tr>
                  <td style="background:#111;border-left:3px solid #f97316;border-radius:6px;padding:16px 20px;">
                    <p style="margin:0 0 10px;font-size:12px;font-weight:600;color:#f97316;text-transform:uppercase;letter-spacing:0.05em;">Rotation Details</p>
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:4px 0;font-size:13px;color:#9ca3af;width:110px;">Date &amp; time</td>
                        <td style="padding:4px 0;font-size:13px;color:#e5e7eb;">${escapeHtml(formattedDate)}</td>
                      </tr>
                      <tr>
                        <td style="padding:4px 0;font-size:13px;color:#9ca3af;">IP address</td>
                        <td style="padding:4px 0;font-size:13px;color:#e5e7eb;">${escapeHtml(maskedIp)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 24px;font-size:15px;color:#d1d5db;line-height:1.6;">
                If you initiated this rotation, no further action is needed — just update the secret in your webhook receiver.
              </p>

              <p style="margin:0 0 28px;font-size:15px;color:#d1d5db;line-height:1.6;">
                If you <strong style="color:#f87171;">did not</strong> perform this rotation, your account may be compromised.
                Please review your active sessions and contact support immediately.
              </p>

              <!-- CTA button -->
              <table cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
                <tr>
                  <td style="background:#f97316;border-radius:6px;padding:12px 24px;">
                    <a href="${securityPageUrl}" style="color:#fff;font-size:14px;font-weight:600;text-decoration:none;">
                      Review Security Settings
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0;font-size:14px;color:#9ca3af;line-height:1.6;">
                For immediate assistance, contact
                <a href="mailto:support@rasokart.com" style="color:#f97316;text-decoration:none;">support@rasokart.com</a>.
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

  const sent = await sendMail({
    to,
    subject: "Security Alert: Your Callback Signing Secret Has Been Rotated — RasoKart",
    html,
  });

  if (!sent) {
    logger.warn({ to, businessName }, "Callback secret rotated email could not be sent (SMTP not configured or failed)");
  }
}
