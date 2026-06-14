import { logger } from "../lib/logger";
import { maybeQueueOrSendEmail } from "./quietHours";

export async function sendApiKeyGeneratedEmail(opts: {
  userId: number;
  to: string;
  businessName: string;
  keyPrefix: string;
  generatedAt: Date;
  ipAddress: string;
}): Promise<void> {
  const { userId, to, businessName, keyPrefix, generatedAt, ipAddress } = opts;

  const formattedDate = generatedAt.toUTCString();
  const maskedIp = maskIp(ipAddress);
  const apiKeysUrl = `${process.env["APP_URL"] ?? "https://rasokart.com"}/merchant/api-keys`;

  const html = buildEmailHtml({
    title: "New API Key Generated",
    subtitle: "A new API key was created for your RasoKart account.",
    businessName,
    accentColor: "#22c55e",
    detailsLabel: "Key Generation Details",
    details: [
      { label: "Key prefix", value: escapeHtml(keyPrefix) },
      { label: "Date &amp; time", value: escapeHtml(formattedDate) },
      { label: "IP address", value: escapeHtml(maskedIp) },
    ],
    bodyText:
      "If you generated this key, no action is needed. If you did not request this key, revoke it immediately from your API Keys settings.",
    ctaHref: apiKeysUrl,
    ctaLabel: "Manage API Keys",
    footerWarning: "If you did not generate this key, please contact <a href=\"mailto:support@rasokart.com\" style=\"color:#f97316;text-decoration:none;\">support@rasokart.com</a> immediately.",
  });

  const sent = await maybeQueueOrSendEmail({
    userId,
    to,
    subject: "Security Alert: New API Key Generated — RasoKart",
    html,
  });

  if (!sent) {
    logger.warn({ to, businessName }, "API key generated email could not be sent (SMTP not configured or failed)");
  }
}

export async function sendApiKeyRevokedEmail(opts: {
  userId: number;
  to: string;
  businessName: string;
  keyPrefix: string;
  revokedAt: Date;
  ipAddress: string;
}): Promise<void> {
  const { userId, to, businessName, keyPrefix, revokedAt, ipAddress } = opts;

  const formattedDate = revokedAt.toUTCString();
  const maskedIp = maskIp(ipAddress);
  const apiKeysUrl = `${process.env["APP_URL"] ?? "https://rasokart.com"}/merchant/api-keys`;

  const html = buildEmailHtml({
    title: "API Key Revoked",
    subtitle: "An API key on your RasoKart account has been revoked.",
    businessName,
    accentColor: "#ef4444",
    detailsLabel: "Revocation Details",
    details: [
      { label: "Key prefix", value: escapeHtml(keyPrefix) },
      { label: "Date &amp; time", value: escapeHtml(formattedDate) },
      { label: "IP address", value: escapeHtml(maskedIp) },
    ],
    bodyText:
      "The key listed above has been permanently deactivated and can no longer be used to authenticate API requests. If you did not revoke this key, please review your account security immediately.",
    ctaHref: apiKeysUrl,
    ctaLabel: "View API Keys",
    footerWarning: "If you did not revoke this key, please contact <a href=\"mailto:support@rasokart.com\" style=\"color:#f97316;text-decoration:none;\">support@rasokart.com</a> immediately.",
  });

  const sent = await maybeQueueOrSendEmail({
    userId,
    to,
    subject: "Security Alert: API Key Revoked — RasoKart",
    html,
  });

  if (!sent) {
    logger.warn({ to, businessName }, "API key revoked email could not be sent (SMTP not configured or failed)");
  }
}

export function maskIp(ip: string): string {
  if (!ip) return "Unknown";
  const v4 = ip.match(/^(\d{1,3}\.\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (v4) return `${v4[1]}.*.* `;
  const v6 = ip.match(/^([0-9a-fA-F]{1,4}:[0-9a-fA-F]{1,4}):/);
  if (v6) return `${v6[1]}:****:…`;
  return ip.slice(0, Math.ceil(ip.length / 2)) + "***";
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

interface EmailOpts {
  title: string;
  subtitle: string;
  businessName: string;
  accentColor: string;
  detailsLabel: string;
  details: Array<{ label: string; value: string }>;
  bodyText: string;
  ctaHref: string;
  ctaLabel: string;
  footerWarning: string;
}

function buildEmailHtml(opts: EmailOpts): string {
  const { title, subtitle, businessName, accentColor, detailsLabel, details, bodyText, ctaHref, ctaLabel, footerWarning } = opts;

  const detailRows = details
    .map(
      d => `
      <tr>
        <td style="padding:4px 0;font-size:13px;color:#9ca3af;width:120px;">${d.label}</td>
        <td style="padding:4px 0;font-size:13px;color:#e5e7eb;">${d.value}</td>
      </tr>`,
    )
    .join("");

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
                ${escapeHtml(title)}
              </h1>
              <p style="margin:0 0 24px;font-size:14px;color:#9ca3af;line-height:1.6;">
                ${escapeHtml(subtitle)}
              </p>

              <p style="margin:0 0 24px;font-size:15px;color:#d1d5db;line-height:1.6;">
                Dear <strong style="color:#fff;">${escapeHtml(businessName)}</strong>,
              </p>

              <p style="margin:0 0 24px;font-size:15px;color:#d1d5db;line-height:1.6;">
                ${escapeHtml(bodyText)}
              </p>

              <!-- Details box -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                <tr>
                  <td style="background:#111;border-left:3px solid ${accentColor};border-radius:6px;padding:16px 20px;">
                    <p style="margin:0 0 10px;font-size:12px;font-weight:600;color:${accentColor};text-transform:uppercase;letter-spacing:0.05em;">${escapeHtml(detailsLabel)}</p>
                    <table width="100%" cellpadding="0" cellspacing="0">
                      ${detailRows}
                    </table>
                  </td>
                </tr>
              </table>

              <table cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
                <tr>
                  <td style="background:#f97316;border-radius:6px;padding:12px 24px;">
                    <a href="${ctaHref}" style="color:#fff;font-size:14px;font-weight:600;text-decoration:none;">
                      ${escapeHtml(ctaLabel)}
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0;font-size:14px;color:#9ca3af;line-height:1.6;">
                ${footerWarning}
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
}
