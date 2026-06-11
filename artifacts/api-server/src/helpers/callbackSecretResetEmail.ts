import { sendMail } from "./mailer";
import { logger } from "../lib/logger";

export async function sendCallbackSecretResetEmail(opts: {
  to: string;
  businessName: string;
  adminEmail: string;
  resetAt: Date;
}): Promise<void> {
  const { to, businessName, adminEmail, resetAt } = opts;

  const formattedDate = resetAt.toUTCString();
  const webhookSettingsUrl = `${process.env["APP_URL"] ?? "https://rasokart.com"}/merchant/callbacks`;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Callback Signing Secret Reset — RasoKart</title>
</head>
<body style="margin:0;padding:0;background:#0f0f0f;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f0f;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#1a1a1a;border-radius:12px;overflow:hidden;border:1px solid #2a2a2a;">

          <!-- Header -->
          <tr>
            <td style="background:#111;padding:32px 40px;border-bottom:1px solid #2a2a2a;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <span style="font-size:22px;font-weight:700;color:#fff;letter-spacing:-0.5px;">Raso<span style="color:#f97316;">Kart</span></span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px;">
              <h1 style="margin:0 0 8px;font-size:22px;font-weight:600;color:#f1f1f1;">
                Callback Signing Secret Reset
              </h1>
              <p style="margin:0 0 24px;font-size:14px;color:#9ca3af;line-height:1.6;">
                Action required — your webhook signature verification needs to be restored.
              </p>

              <p style="margin:0 0 24px;font-size:15px;color:#d1d5db;line-height:1.6;">
                Dear <strong style="color:#fff;">${escapeHtml(businessName)}</strong>,
              </p>

              <p style="margin:0 0 24px;font-size:15px;color:#d1d5db;line-height:1.6;">
                Your callback signing secret has been <strong style="color:#f97316;">force-reset</strong> by a RasoKart administrator.
                Any webhooks that rely on signature verification will no longer pass until you generate a new secret.
              </p>

              <!-- Details box -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                <tr>
                  <td style="background:#111;border-left:3px solid #f97316;border-radius:6px;padding:16px 20px;">
                    <p style="margin:0 0 10px;font-size:12px;font-weight:600;color:#f97316;text-transform:uppercase;letter-spacing:0.05em;">Reset Details</p>
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:4px 0;font-size:13px;color:#9ca3af;width:100px;">Reset by</td>
                        <td style="padding:4px 0;font-size:13px;color:#e5e7eb;">${escapeHtml(adminEmail)}</td>
                      </tr>
                      <tr>
                        <td style="padding:4px 0;font-size:13px;color:#9ca3af;">Date &amp; time</td>
                        <td style="padding:4px 0;font-size:13px;color:#e5e7eb;">${escapeHtml(formattedDate)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 24px;font-size:15px;color:#d1d5db;line-height:1.6;">
                To restore signature verification, visit your webhook settings and generate a new signing secret.
              </p>

              <table cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
                <tr>
                  <td style="background:#f97316;border-radius:6px;padding:12px 24px;">
                    <a href="${webhookSettingsUrl}" style="color:#fff;font-size:14px;font-weight:600;text-decoration:none;">
                      Go to Webhook Settings
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0;font-size:14px;color:#9ca3af;line-height:1.6;">
                If you did not expect this change or have any concerns, please contact
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
    subject: "Security Alert: Your Callback Signing Secret Has Been Reset — RasoKart",
    html,
  });

  if (!sent) {
    logger.warn({ to, businessName }, "Callback secret reset email could not be sent (SMTP not configured or failed)");
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}
