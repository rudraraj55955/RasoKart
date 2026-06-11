import { db, usersTable, merchantsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { sendMail } from "./mailer";

const APP_DOMAIN = process.env["APP_DOMAIN"] ?? "https://rasokart.com";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function buildWebhookFailureAlertHtml(opts: {
  businessName: string;
  webhookUrl: string;
  consecutiveFailures: number;
  threshold: number;
  deliveryLogLink: string;
}): string {
  const { businessName, webhookUrl, consecutiveFailures, threshold, deliveryLogLink } = opts;
  const shortUrl = webhookUrl.length > 60 ? webhookUrl.slice(0, 57) + "…" : webhookUrl;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Webhook Alert — RasoKart</title>
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
                  <td align="right">
                    <span style="display:inline-block;background:#7f1d1d;color:#fca5a5;font-size:11px;font-weight:700;padding:4px 10px;border-radius:999px;letter-spacing:0.5px;text-transform:uppercase;">Webhook Alert</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px;">
              <h1 style="margin:0 0 8px;font-size:22px;font-weight:600;color:#f1f1f1;">
                Webhook Failures Detected
              </h1>
              <p style="margin:0 0 28px;font-size:14px;color:#9ca3af;line-height:1.6;">
                Hi <strong style="color:#e5e7eb;">${escapeHtml(businessName)}</strong>, your webhook endpoint has failed
                <strong style="color:#fca5a5;">${consecutiveFailures} consecutive ${consecutiveFailures === 1 ? "time" : "times"}</strong>,
                which has reached your configured alert threshold of <strong style="color:#e5e7eb;">${threshold}</strong>.
              </p>

              <!-- Alert box -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                <tr>
                  <td style="background:#1c1010;border:1px solid #7f1d1d;border-radius:8px;padding:20px 24px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding-bottom:12px;border-bottom:1px solid #3f1515;">
                          <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#f87171;text-transform:uppercase;letter-spacing:0.06em;">Webhook Endpoint</p>
                          <p style="margin:0;font-size:13px;color:#e5e7eb;font-family:monospace;word-break:break-all;">${escapeHtml(shortUrl)}</p>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding-top:12px;">
                          <table width="100%" cellpadding="0" cellspacing="0">
                            <tr>
                              <td width="50%">
                                <p style="margin:0 0 2px;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">Consecutive Failures</p>
                                <p style="margin:0;font-size:20px;font-weight:700;color:#f87171;">${consecutiveFailures}</p>
                              </td>
                              <td width="50%">
                                <p style="margin:0 0 2px;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">Alert Threshold</p>
                                <p style="margin:0;font-size:20px;font-weight:700;color:#e5e7eb;">${threshold}</p>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- What to do -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                <tr>
                  <td style="background:#111;border-left:3px solid #f97316;border-radius:6px;padding:16px 20px;">
                    <p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#f97316;text-transform:uppercase;letter-spacing:0.05em;">What to check</p>
                    <ul style="margin:0;padding:0 0 0 18px;color:#d1d5db;font-size:13px;line-height:1.8;">
                      <li>Your endpoint is publicly reachable and returning a <strong style="color:#fff;">2xx status code</strong></li>
                      <li>Any recent deployments or firewall rule changes</li>
                      <li>SSL certificate validity if you're on HTTPS</li>
                      <li>Response time — requests timeout after <strong style="color:#fff;">10 seconds</strong></li>
                    </ul>
                  </td>
                </tr>
              </table>

              <!-- CTA -->
              <table cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                <tr>
                  <td style="background:#7c3aed;border-radius:6px;padding:12px 28px;">
                    <a href="${deliveryLogLink}" style="color:#fff;font-size:14px;font-weight:600;text-decoration:none;">
                      View Delivery Log →
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0;font-size:13px;color:#9ca3af;line-height:1.6;">
                You can adjust or disable this alert from your
                <a href="${APP_DOMAIN}/merchant/webhooks" style="color:#f97316;text-decoration:none;">webhook settings page</a>.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 40px;border-top:1px solid #2a2a2a;background:#111;">
              <p style="margin:0;font-size:12px;color:#6b7280;line-height:1.6;">
                This alert was sent because your webhook failure count reached the threshold you configured in RasoKart.
                To stop receiving these alerts, disable them on the
                <a href="${APP_DOMAIN}/merchant/webhooks" style="color:#f97316;text-decoration:none;">webhook settings page</a>.
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

export async function sendWebhookFailureAlertEmail(opts: {
  merchantId: number;
  webhookUrl: string;
  consecutiveFailures: number;
  threshold: number;
}): Promise<void> {
  try {
    const [user] = await db
      .select({ email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.merchantId, opts.merchantId))
      .limit(1);

    if (!user) {
      logger.warn({ merchantId: opts.merchantId }, "No user found for merchant — skipping webhook failure alert email");
      return;
    }

    const [merchant] = await db
      .select({ businessName: merchantsTable.businessName })
      .from(merchantsTable)
      .where(eq(merchantsTable.id, opts.merchantId))
      .limit(1);

    const businessName = merchant?.businessName ?? "Merchant";
    const deliveryLogLink = `${APP_DOMAIN}/merchant/webhooks`;

    const html = buildWebhookFailureAlertHtml({
      businessName,
      webhookUrl: opts.webhookUrl,
      consecutiveFailures: opts.consecutiveFailures,
      threshold: opts.threshold,
      deliveryLogLink,
    });

    const subject = `[RasoKart] ⚠️ Webhook Alert — ${opts.consecutiveFailures} consecutive ${opts.consecutiveFailures === 1 ? "failure" : "failures"} on your endpoint`;

    const sent = await sendMail({ to: user.email, subject, html });
    if (sent) {
      logger.info(
        { merchantId: opts.merchantId, consecutiveFailures: opts.consecutiveFailures, threshold: opts.threshold },
        "Webhook failure alert email sent to merchant"
      );
    }
  } catch (err) {
    logger.error({ err, merchantId: opts.merchantId }, "Failed to send webhook failure alert email");
  }
}
