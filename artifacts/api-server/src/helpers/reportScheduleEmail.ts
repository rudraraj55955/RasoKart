import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { sendMail } from "./mailer";
import { logger } from "../lib/logger";

const APP_DOMAIN = process.env["APP_DOMAIN"] ?? "https://rasokart.com";

export function buildReportScheduleUpdatedHtml(opts: {
  businessName: string;
  nextRunAt: string | null;
  formattedDate: string | null;
}): string {
  const { businessName, nextRunAt, formattedDate } = opts;
  const scheduleLink = `${APP_DOMAIN}/merchant/reports`;

  const isCleared = nextRunAt === null;

  const headerBg = isCleared ? "#1e3a5f" : "#1a3a2a";
  const headerSubtitle = isCleared
    ? "Your report schedule has been reverted to its normal cadence"
    : "Your next report delivery date has been updated";
  const bodyMessage = isCleared
    ? "An admin has reverted your report schedule next run date to its normal cadence."
    : `An admin has updated your report schedule. Your next report will be sent on <strong style="color:#4ade80;">${formattedDate} IST</strong>.`;

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; background: #0f0f0f; color: #e5e5e5; margin: 0; padding: 24px;">
  <div style="max-width: 600px; margin: 0 auto; background: #1a1a1a; border-radius: 8px; overflow: hidden; border: 1px solid #2a2a2a;">
    <div style="background: ${headerBg}; padding: 20px 24px;">
      <h1 style="margin: 0; font-size: 20px; color: #fff; letter-spacing: 0.5px;">RasoKart — Report Schedule Updated</h1>
      <p style="margin: 4px 0 0; color: #bfdbfe; font-size: 13px;">${headerSubtitle}</p>
    </div>
    <div style="padding: 24px;">
      <p style="margin: 0 0 16px; color: #e5e5e5; font-size: 15px;">
        Dear <strong>${businessName}</strong>,
      </p>
      <p style="margin: 0 0 20px; color: #d1d5db; font-size: 14px; line-height: 1.6;">
        ${bodyMessage}
      </p>

      ${!isCleared ? `
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px; width: 50%;">Next Report Date</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; color: #4ade80; font-weight: 600;">${formattedDate} IST</td>
        </tr>
      </table>` : `
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px; width: 50%;">Next Report Date</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; color: #a1a1aa;">Automatically calculated from your schedule</td>
        </tr>
      </table>`}

      <p style="margin: 0 0 20px; color: #a1a1aa; font-size: 13px; line-height: 1.6;">
        You can view and manage your report schedule settings from your merchant dashboard.
      </p>

      <div style="text-align: center; margin-bottom: 20px;">
        <a href="${scheduleLink}"
           style="display: inline-block; background: #7c3aed; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-size: 14px; font-weight: 600; letter-spacing: 0.3px;">
          View Report Schedule
        </a>
      </div>

      <p style="margin: 0; color: #71717a; font-size: 12px;">
        If the link above doesn't work, copy this URL into your browser:<br>
        <span style="color: #818cf8;">${scheduleLink}</span>
      </p>
    </div>
    <div style="padding: 14px 24px; background: #111; border-top: 1px solid #2a2a2a;">
      <p style="margin: 0; color: #52525b; font-size: 11px;">
        This notification was sent by RasoKart because an admin updated your report schedule settings.
        For support, contact <a href="mailto:support@rasokart.com" style="color: #818cf8; text-decoration: none;">support@rasokart.com</a>.
      </p>
    </div>
  </div>
</body>
</html>`.trim();
}

function buildReportScheduleAutoPausedMerchantHtml(opts: {
  businessName: string;
  frequency: string;
  consecutiveFailures: number;
  autoPauseAfterFailures: number;
}): string {
  const { businessName, frequency, consecutiveFailures, autoPauseAfterFailures } = opts;
  const freqLabel = frequency.charAt(0).toUpperCase() + frequency.slice(1);
  const reportsLink = `${APP_DOMAIN}/merchant/reports`;

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; background: #0f0f0f; color: #e5e5e5; margin: 0; padding: 24px;">
  <div style="max-width: 620px; margin: 0 auto; background: #1a1a1a; border-radius: 8px; overflow: hidden; border: 1px solid #2a2a2a;">
    <div style="background: #7c2d12; padding: 20px 24px;">
      <h1 style="margin: 0; font-size: 20px; color: #fff; letter-spacing: 0.5px;">RasoKart — Scheduled Report Paused</h1>
      <p style="margin: 4px 0 0; color: #fed7aa; font-size: 13px;">Your ${freqLabel.toLowerCase()} report schedule has been automatically paused</p>
    </div>
    <div style="padding: 24px;">
      <p style="margin: 0 0 16px; color: #e5e5e5; font-size: 15px;">
        Dear <strong>${businessName}</strong>,
      </p>
      <p style="margin: 0 0 20px; color: #d1d5db; font-size: 14px; line-height: 1.6;">
        Your <strong>${freqLabel.toLowerCase()} transaction report schedule</strong> has been automatically paused after
        <strong style="color: #f87171;">${consecutiveFailures} consecutive delivery failure${consecutiveFailures !== 1 ? "s" : ""}</strong>
        (threshold: ${autoPauseAfterFailures}).
      </p>
      <p style="margin: 0 0 20px; color: #d1d5db; font-size: 14px; line-height: 1.6;">
        This is typically caused by an email configuration issue on the platform. Your platform administrator has been notified and will investigate.
        Once the issue is resolved, you can re-enable your report schedule from your Reports page.
      </p>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px; width: 50%;">Report Frequency</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; font-weight: 600;">${freqLabel}</td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Consecutive Failures</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; color: #f87171; font-weight: 600;">${consecutiveFailures} of ${autoPauseAfterFailures}</td>
        </tr>
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Schedule Status</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; color: #fb923c; font-weight: 600;">Auto-Paused</td>
        </tr>
      </table>

      <div style="text-align: center; margin-bottom: 20px;">
        <a href="${reportsLink}"
           style="display: inline-block; background: #7c3aed; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-size: 14px; font-weight: 600; letter-spacing: 0.3px;">
          Go to My Reports Page
        </a>
      </div>

      <p style="margin: 0; color: #71717a; font-size: 12px;">
        If the link above doesn't work, copy this URL into your browser:<br>
        <span style="color: #818cf8;">${reportsLink}</span>
      </p>
    </div>
    <div style="padding: 14px 24px; background: #111; border-top: 1px solid #2a2a2a;">
      <p style="margin: 0; color: #52525b; font-size: 11px;">
        This notification was sent by RasoKart because your scheduled report delivery was automatically paused.
        For support, contact <a href="mailto:support@rasokart.com" style="color: #818cf8; text-decoration: none;">support@rasokart.com</a>.
      </p>
    </div>
  </div>
</body>
</html>`;
}

export async function sendReportScheduleAutoPausedMerchantEmail(opts: {
  to: string;
  businessName: string;
  frequency: string;
  consecutiveFailures: number;
  autoPauseAfterFailures: number;
}): Promise<boolean> {
  const { to, businessName, frequency, consecutiveFailures, autoPauseAfterFailures } = opts;
  const freqLabel = frequency.charAt(0).toUpperCase() + frequency.slice(1);
  const subject = `[RasoKart] Your ${freqLabel} Report Schedule Has Been Paused`;
  const html = buildReportScheduleAutoPausedMerchantHtml({ businessName, frequency, consecutiveFailures, autoPauseAfterFailures });

  const sent = await sendMail({ to, subject, html });
  if (!sent) {
    logger.warn({ to, businessName }, "Report schedule auto-pause merchant email could not be sent (SMTP not configured or failed)");
  }
  return sent;
}

export async function sendReportScheduleUpdatedEmail(opts: {
  merchantId: number;
  to: string;
  businessName: string;
  nextRunAt: string | null;
}): Promise<void> {
  const { merchantId, to, businessName, nextRunAt } = opts;

  try {
    const [user] = await db
      .select({ reportScheduleChangedEmails: usersTable.reportScheduleChangedEmails })
      .from(usersTable)
      .where(eq(usersTable.merchantId, merchantId))
      .limit(1);

    if (!user) {
      logger.info({ merchantId }, "No user found for merchant — skipping report schedule email");
      return;
    }

    if (!user.reportScheduleChangedEmails) {
      logger.info({ merchantId }, "Merchant opted out of report schedule changed emails — skipping");
      return;
    }
  } catch (err) {
    logger.error({ err, merchantId }, "Failed to check merchant report schedule email preference — skipping");
    return;
  }

  const formattedDate = nextRunAt
    ? new Date(nextRunAt).toLocaleString("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Kolkata",
      })
    : null;

  const subject = nextRunAt === null
    ? "[RasoKart] Your report schedule has been reverted to normal cadence"
    : `[RasoKart] Your next report is scheduled for ${formattedDate} IST`;

  const html = buildReportScheduleUpdatedHtml({ businessName, nextRunAt, formattedDate });

  const sent = await sendMail({ to, subject, html });
  if (!sent) {
    logger.warn({ to, businessName, merchantId }, "Report schedule update email could not be sent (SMTP not configured or failed)");
  }
}
