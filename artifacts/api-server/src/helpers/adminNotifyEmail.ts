import { db, usersTable, webhookFailureAlertLogsTable, systemConfigTable, SYSTEM_CONFIG_KEYS, SYSTEM_CONFIG_DEFAULTS } from "@workspace/db";
import { and, eq, gt, gte, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { sendMail } from "./mailer";

const APP_DOMAIN = process.env["APP_DOMAIN"] ?? "https://rasokart.com";

function formatAmount(val: string | number | null | undefined): string {
  const n = Number(val ?? 0);
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function getAdminEmails(preference: "planExpiryAlertEmails" | "settlementStateEmails" | "webhookFailureEmails" | "ekqrSyncAlertEmails" | "reportFailureAlertEmails"): Promise<string[]> {
  const admins = await db
    .select({ email: usersTable.email })
    .from(usersTable)
    .where(and(
      eq(usersTable.role, "admin"),
      eq(usersTable.isActive, true),
      eq((usersTable as any)[preference], true),
    ));
  return admins.map(a => a.email);
}

// Credential rotation alerts are high-risk security notifications — unlike the other
// alert types above, there is no opt-out preference. Every active admin is notified.
async function getAllActiveAdminEmails(): Promise<string[]> {
  const admins = await db
    .select({ email: usersTable.email })
    .from(usersTable)
    .where(and(
      eq(usersTable.role, "admin"),
      eq(usersTable.isActive, true),
    ));
  return admins.map(a => a.email);
}

// ---------------------------------------------------------------------------
// Plan expiry alert emails
// ---------------------------------------------------------------------------

function buildPlanExpiryHtml(opts: {
  merchantName: string;
  planName: string;
  merchantId: number;
  daysUntilExpiry: number;
  expiresAt: string;
}): string {
  const { merchantName, planName, merchantId, daysUntilExpiry, expiresAt } = opts;
  const merchantLink = `${APP_DOMAIN}/admin/merchants/${merchantId}`;
  const urgencyColor = daysUntilExpiry <= 3 ? "#f87171" : daysUntilExpiry <= 7 ? "#fb923c" : "#facc15";

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; background: #0f0f0f; color: #e5e5e5; margin: 0; padding: 24px;">
  <div style="max-width: 600px; margin: 0 auto; background: #1a1a1a; border-radius: 8px; overflow: hidden; border: 1px solid #2a2a2a;">
    <div style="background: #78350f; padding: 20px 24px;">
      <h1 style="margin: 0; font-size: 20px; color: #fff; letter-spacing: 0.5px;">RasoKart — Plan Expiry Alert</h1>
      <p style="margin: 4px 0 0; color: #fde68a; font-size: 13px;">Merchant subscription expiring soon</p>
    </div>
    <div style="padding: 24px;">
      <p style="margin: 0 0 16px; color: ${urgencyColor}; font-size: 14px; font-weight: 600;">
        ⚠️ ${merchantName}'s ${planName} plan expires in <strong>${daysUntilExpiry} day${daysUntilExpiry === 1 ? "" : "s"}</strong>.
      </p>
      <p style="margin: 0 0 20px; color: #a1a1aa; font-size: 13px;">
        Please review the merchant's account and ensure their plan is renewed or updated before expiry to avoid service interruption.
      </p>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px; width: 50%;">Merchant</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; font-weight: 600;">${merchantName}</td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Current Plan</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px;">${planName}</td>
        </tr>
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Expires At</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; color: ${urgencyColor}; font-weight: 600;">${expiresAt}</td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Days Remaining</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; color: ${urgencyColor}; font-weight: 600;">${daysUntilExpiry} day${daysUntilExpiry === 1 ? "" : "s"}</td>
        </tr>
      </table>

      <div style="text-align: center; margin-bottom: 20px;">
        <a href="${merchantLink}"
           style="display: inline-block; background: #7c3aed; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-size: 14px; font-weight: 600; letter-spacing: 0.3px;">
          View Merchant in Admin Portal
        </a>
      </div>

      <p style="margin: 0; color: #71717a; font-size: 12px;">
        If the link above doesn't work, copy this URL into your browser:<br>
        <span style="color: #818cf8;">${merchantLink}</span>
      </p>
    </div>
    <div style="padding: 14px 24px; background: #111; border-top: 1px solid #2a2a2a;">
      <p style="margin: 0; color: #52525b; font-size: 11px;">
        This alert was sent by RasoKart. To stop receiving plan expiry alerts, update your notification preferences in Admin Settings.
      </p>
    </div>
  </div>
</body>
</html>`;
}

export async function notifyAdminsOfPlanExpiry(opts: {
  merchantId: number;
  merchantName: string;
  planName: string;
  daysUntilExpiry: number;
  expiresAt: string;
}): Promise<void> {
  try {
    const recipients = await getAdminEmails("planExpiryAlertEmails");

    if (recipients.length === 0) {
      logger.info({ merchantId: opts.merchantId }, "No admins opted in to plan expiry alert emails — skipping");
      return;
    }

    const html = buildPlanExpiryHtml(opts);
    const subject = `[RasoKart] ⚠️ Plan Expiry Alert — ${opts.merchantName} (${opts.daysUntilExpiry}d remaining)`;

    const results = await Promise.allSettled(
      recipients.map(email => sendMail({ to: email, subject, html }))
    );

    const sent = results.filter(r => r.status === "fulfilled" && r.value).length;
    const failed = results.length - sent;

    logger.info(
      { merchantId: opts.merchantId, totalAdmins: recipients.length, sent, failed },
      "Admin plan expiry alert emails dispatched"
    );
  } catch (err) {
    logger.error({ err, merchantId: opts.merchantId }, "Failed to send admin plan expiry alert emails");
  }
}

// ---------------------------------------------------------------------------
// Settlement state-change emails
// ---------------------------------------------------------------------------

function buildSettlementStateHtml(opts: {
  settlementId: number;
  merchantName: string;
  referenceNumber: string | null;
  newStatus: string;
  amount: string | number;
  note: string | null;
}): string {
  const { settlementId, merchantName, referenceNumber, newStatus, amount, note } = opts;
  const settlementLink = `${APP_DOMAIN}/admin/settlements/${settlementId}`;

  const statusColors: Record<string, string> = {
    approved: "#4ade80",
    rejected: "#f87171",
    processing: "#60a5fa",
    completed: "#4ade80",
    pending: "#facc15",
  };
  const statusColor = statusColors[newStatus.toLowerCase()] ?? "#a1a1aa";

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; background: #0f0f0f; color: #e5e5e5; margin: 0; padding: 24px;">
  <div style="max-width: 600px; margin: 0 auto; background: #1a1a1a; border-radius: 8px; overflow: hidden; border: 1px solid #2a2a2a;">
    <div style="background: #1e3a5f; padding: 20px 24px;">
      <h1 style="margin: 0; font-size: 20px; color: #fff; letter-spacing: 0.5px;">RasoKart — Settlement State Change</h1>
      <p style="margin: 4px 0 0; color: #bfdbfe; font-size: 13px;">Settlement #${settlementId}${referenceNumber ? ` · Ref: ${referenceNumber}` : ""}</p>
    </div>
    <div style="padding: 24px;">
      <p style="margin: 0 0 20px; color: #a1a1aa; font-size: 14px;">
        A settlement request has changed state. Here are the details:
      </p>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px; width: 50%;">Settlement ID</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; font-weight: 600;">#${settlementId}</td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Merchant</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px;">${merchantName}</td>
        </tr>
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Amount</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; font-weight: 600;">${formatAmount(amount)}</td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">New Status</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; color: ${statusColor}; font-weight: 600; text-transform: capitalize;">${newStatus}</td>
        </tr>
        ${referenceNumber ? `
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Reference</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px;">${referenceNumber}</td>
        </tr>` : ""}
        ${note ? `
        <tr${referenceNumber ? "" : ' style="background: #111;"'}>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Note</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; color: #d1d5db;">${note}</td>
        </tr>` : ""}
      </table>

      <div style="text-align: center; margin-bottom: 20px;">
        <a href="${settlementLink}"
           style="display: inline-block; background: #7c3aed; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-size: 14px; font-weight: 600; letter-spacing: 0.3px;">
          View Settlement in Admin Portal
        </a>
      </div>

      <p style="margin: 0; color: #71717a; font-size: 12px;">
        If the link above doesn't work, copy this URL into your browser:<br>
        <span style="color: #818cf8;">${settlementLink}</span>
      </p>
    </div>
    <div style="padding: 14px 24px; background: #111; border-top: 1px solid #2a2a2a;">
      <p style="margin: 0; color: #52525b; font-size: 11px;">
        This alert was sent by RasoKart. To stop receiving settlement state change emails, update your notification preferences in Admin Settings.
      </p>
    </div>
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Webhook permanent failure emails
// ---------------------------------------------------------------------------

function buildWebhookFailureHtml(opts: {
  merchantId: number;
  url: string;
  attempts: number;
  qrCodeId: number | null;
}): string {
  const { merchantId, url, attempts, qrCodeId } = opts;
  const merchantLink = `${APP_DOMAIN}/admin/merchants/${merchantId}`;
  const qrLabel = qrCodeId != null ? ` (QR Code #${qrCodeId})` : "";

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; background: #0f0f0f; color: #e5e5e5; margin: 0; padding: 24px;">
  <div style="max-width: 600px; margin: 0 auto; background: #1a1a1a; border-radius: 8px; overflow: hidden; border: 1px solid #2a2a2a;">
    <div style="background: #7f1d1d; padding: 20px 24px;">
      <h1 style="margin: 0; font-size: 20px; color: #fff; letter-spacing: 0.5px;">RasoKart — Webhook Permanently Failed</h1>
      <p style="margin: 4px 0 0; color: #fca5a5; font-size: 13px;">All retry attempts exhausted — merchant action required</p>
    </div>
    <div style="padding: 24px;">
      <p style="margin: 0 0 16px; color: #f87171; font-size: 14px; font-weight: 600;">
        🔴 Merchant #${merchantId} webhook permanently failed after ${attempts} attempt${attempts !== 1 ? "s" : ""}${qrLabel}.
      </p>
      <p style="margin: 0 0 20px; color: #a1a1aa; font-size: 13px;">
        All retry attempts have been exhausted. Consider reaching out to the merchant to investigate their webhook endpoint.
      </p>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px; width: 40%;">Merchant ID</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; font-weight: 600;">#${merchantId}</td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Failed URL</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; word-break: break-all; color: #93c5fd;">${url}</td>
        </tr>
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Total Attempts</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; color: #f87171; font-weight: 600;">${attempts}</td>
        </tr>
        ${qrCodeId != null ? `
        <tr>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">QR Code</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px;">#${qrCodeId}</td>
        </tr>` : ""}
      </table>

      <div style="text-align: center; margin-bottom: 20px;">
        <a href="${merchantLink}"
           style="display: inline-block; background: #7c3aed; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-size: 14px; font-weight: 600; letter-spacing: 0.3px;">
          View Merchant in Admin Portal
        </a>
      </div>

      <p style="margin: 0; color: #71717a; font-size: 12px;">
        If the link above doesn't work, copy this URL into your browser:<br>
        <span style="color: #818cf8;">${merchantLink}</span>
      </p>
    </div>
    <div style="padding: 14px 24px; background: #111; border-top: 1px solid #2a2a2a;">
      <p style="margin: 0; color: #52525b; font-size: 11px;">
        This alert was sent by RasoKart. To stop receiving webhook failure emails, update your notification preferences in Admin Settings.
      </p>
    </div>
  </div>
</body>
</html>`;
}

async function getWebhookFailureCooldownHours(): Promise<number> {
  try {
    const rows = await db
      .select()
      .from(systemConfigTable)
      .where(eq(systemConfigTable.key, SYSTEM_CONFIG_KEYS.WEBHOOK_FAILURE_ALERT_COOLDOWN_HOURS));
    const raw = rows[0]?.value ?? SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.WEBHOOK_FAILURE_ALERT_COOLDOWN_HOURS];
    return Math.max(1, parseInt(raw) || 1);
  } catch {
    return 1;
  }
}

export async function notifyAdminsOfWebhookFailureEmail(opts: {
  merchantId: number;
  url: string;
  attempts: number;
  qrCodeId: number | null;
}): Promise<void> {
  try {
    const recipients = await getAdminEmails("webhookFailureEmails");

    if (recipients.length === 0) {
      logger.info({ merchantId: opts.merchantId }, "No admins opted in to webhook failure emails — skipping");
      return;
    }

    const cooldownHours = await getWebhookFailureCooldownHours();
    const cooldownCutoff = new Date(Date.now() - cooldownHours * 60 * 60 * 1000);

    const recentAlerts = await db
      .select({ id: webhookFailureAlertLogsTable.id, sentAt: webhookFailureAlertLogsTable.sentAt })
      .from(webhookFailureAlertLogsTable)
      .where(
        and(
          eq(webhookFailureAlertLogsTable.merchantId, opts.merchantId),
          gte(webhookFailureAlertLogsTable.sentAt, cooldownCutoff),
          gt(webhookFailureAlertLogsTable.recipientCount, 0)
        )
      )
      .limit(1);

    if (recentAlerts.length > 0) {
      logger.info(
        { merchantId: opts.merchantId, cooldownHours, lastAlertAt: recentAlerts[0]!.sentAt },
        "Webhook failure alert email suppressed — within cooldown window"
      );
      return;
    }

    const html = buildWebhookFailureHtml(opts);
    const subject = `[RasoKart] 🔴 Webhook Permanently Failed — Merchant #${opts.merchantId}`;

    const results = await Promise.allSettled(
      recipients.map(email => sendMail({ to: email, subject, html }))
    );

    const sent = results.filter(r => r.status === "fulfilled" && r.value).length;
    const failed = results.length - sent;

    await db.insert(webhookFailureAlertLogsTable).values({
      merchantId: opts.merchantId,
      failedUrl: opts.url,
      attemptCount: opts.attempts,
      recipientCount: sent,
      recipientEmails: recipients,
    });

    logger.info(
      { merchantId: opts.merchantId, totalAdmins: recipients.length, sent, failed, cooldownHours },
      "Admin webhook failure emails dispatched"
    );
  } catch (err) {
    logger.error({ err, merchantId: opts.merchantId }, "Failed to send admin webhook failure emails");
  }
}

export async function notifyAdminsOfSettlementStateChange(opts: {
  settlementId: number;
  merchantName: string;
  referenceNumber: string | null;
  newStatus: string;
  amount: string | number;
  note: string | null;
}): Promise<void> {
  try {
    const recipients = await getAdminEmails("settlementStateEmails");

    if (recipients.length === 0) {
      logger.info({ settlementId: opts.settlementId }, "No admins opted in to settlement state emails — skipping");
      return;
    }

    const html = buildSettlementStateHtml(opts);
    const subject = `[RasoKart] Settlement #${opts.settlementId} — Status changed to ${opts.newStatus} (${opts.merchantName})`;

    const results = await Promise.allSettled(
      recipients.map(email => sendMail({ to: email, subject, html }))
    );

    const sent = results.filter(r => r.status === "fulfilled" && r.value).length;
    const failed = results.length - sent;

    logger.info(
      { settlementId: opts.settlementId, totalAdmins: recipients.length, sent, failed },
      "Admin settlement state change emails dispatched"
    );
  } catch (err) {
    logger.error({ err, settlementId: opts.settlementId }, "Failed to send admin settlement state change emails");
  }
}

// ---------------------------------------------------------------------------
// Report schedule auto-pause emails
// ---------------------------------------------------------------------------

function buildReportScheduleAutoPausedHtml(opts: {
  merchantName: string;
  merchantId: number;
  frequency: string;
  consecutiveFailures: number;
  autoPauseAfterFailures: number;
}): string {
  const { merchantName, merchantId, frequency, consecutiveFailures, autoPauseAfterFailures } = opts;
  const freqLabel = frequency.charAt(0).toUpperCase() + frequency.slice(1);
  const reportsLink = `${APP_DOMAIN}/admin/reports?merchantId=${merchantId}`;
  const smtpSettingsLink = `${APP_DOMAIN}/admin/settings`;

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; background: #0f0f0f; color: #e5e5e5; margin: 0; padding: 24px;">
  <div style="max-width: 600px; margin: 0 auto; background: #1a1a1a; border-radius: 8px; overflow: hidden; border: 1px solid #2a2a2a;">
    <div style="background: #7c2d12; padding: 20px 24px;">
      <h1 style="margin: 0; font-size: 20px; color: #fff; letter-spacing: 0.5px;">RasoKart — Report Schedule Auto-Paused</h1>
      <p style="margin: 4px 0 0; color: #fed7aa; font-size: 13px;">Repeated delivery failures triggered an automatic pause</p>
    </div>
    <div style="padding: 24px;">
      <p style="margin: 0 0 16px; color: #fb923c; font-size: 14px; font-weight: 600;">
        ⚠️ ${merchantName}'s ${freqLabel.toLowerCase()} report schedule has been automatically paused after ${consecutiveFailures} consecutive delivery failures.
      </p>
      <p style="margin: 0 0 20px; color: #a1a1aa; font-size: 13px;">
        This typically indicates an SMTP misconfiguration on the platform. Please review the SMTP settings and re-enable the schedule from the merchant's Reports page.
      </p>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px; width: 50%;">Merchant</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; font-weight: 600;">${merchantName}</td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Report Frequency</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px;">${freqLabel}</td>
        </tr>
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Consecutive Failures</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; color: #f87171; font-weight: 600;">${consecutiveFailures} of ${autoPauseAfterFailures}</td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Status</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; color: #fb923c; font-weight: 600;">Auto-Paused</td>
        </tr>
      </table>

      <div style="text-align: center; margin-bottom: 16px;">
        <a href="${reportsLink}"
           style="display: inline-block; background: #7c3aed; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-size: 14px; font-weight: 600; letter-spacing: 0.3px;">
          View Merchant Reports
        </a>
      </div>

      <p style="margin: 0 0 16px; color: #71717a; font-size: 12px; text-align: center;">
        Or check <a href="${smtpSettingsLink}" style="color: #818cf8;">SMTP Settings</a> to resolve the delivery issue.
      </p>

      <p style="margin: 0; color: #71717a; font-size: 12px;">
        If the link above doesn't work, copy this URL into your browser:<br>
        <span style="color: #818cf8;">${reportsLink}</span>
      </p>
    </div>
    <div style="padding: 14px 24px; background: #111; border-top: 1px solid #2a2a2a;">
      <p style="margin: 0; color: #52525b; font-size: 11px;">
        This alert was sent by RasoKart. To stop receiving report schedule failure emails, update your notification preferences in Admin Settings.
      </p>
    </div>
  </div>
</body>
</html>`;
}

export async function notifyAdminsOfReportScheduleAutoPaused(opts: {
  merchantId: number;
  merchantName: string;
  frequency: string;
  consecutiveFailures: number;
  autoPauseAfterFailures: number;
}): Promise<void> {
  try {
    const recipients = await getAdminEmails("reportFailureAlertEmails");

    if (recipients.length === 0) {
      logger.info({ merchantId: opts.merchantId }, "No admins opted in to report schedule failure emails — skipping");
      return;
    }

    const html = buildReportScheduleAutoPausedHtml(opts);
    const freqLabel = opts.frequency.charAt(0).toUpperCase() + opts.frequency.slice(1);
    const subject = `[RasoKart] ⚠️ Report Schedule Auto-Paused — ${opts.merchantName} (${freqLabel})`;

    const results = await Promise.allSettled(
      recipients.map(email => sendMail({ to: email, subject, html }))
    );

    const sent = results.filter(r => r.status === "fulfilled" && r.value).length;
    const failed = results.length - sent;

    logger.info(
      { merchantId: opts.merchantId, totalAdmins: recipients.length, sent, failed },
      "Admin report schedule auto-pause emails dispatched"
    );
  } catch (err) {
    logger.error({ err, merchantId: opts.merchantId }, "Failed to send admin report schedule auto-pause emails");
  }
}

// ---------------------------------------------------------------------------
// Report schedule resumed emails
// ---------------------------------------------------------------------------

function buildReportScheduleResumedHtml(opts: {
  merchantName: string;
  merchantId: number;
  frequency: string;
  previousFailures: number;
}): string {
  const { merchantName, merchantId, frequency, previousFailures } = opts;
  const freqLabel = frequency.charAt(0).toUpperCase() + frequency.slice(1);
  const reportsLink = `${APP_DOMAIN}/admin/reports?merchantId=${merchantId}`;

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; background: #0f0f0f; color: #e5e5e5; margin: 0; padding: 24px;">
  <div style="max-width: 600px; margin: 0 auto; background: #1a1a1a; border-radius: 8px; overflow: hidden; border: 1px solid #2a2a2a;">
    <div style="background: #14532d; padding: 20px 24px;">
      <h1 style="margin: 0; font-size: 20px; color: #fff; letter-spacing: 0.5px;">RasoKart — Report Schedule Resumed</h1>
      <p style="margin: 4px 0 0; color: #bbf7d0; font-size: 13px;">Delivery is working again after previous failures</p>
    </div>
    <div style="padding: 24px;">
      <p style="margin: 0 0 16px; color: #4ade80; font-size: 14px; font-weight: 600;">
        ✅ ${merchantName}'s ${freqLabel.toLowerCase()} report schedule has delivered successfully and resumed normal operation.
      </p>
      <p style="margin: 0 0 20px; color: #a1a1aa; font-size: 13px;">
        The schedule had accumulated ${previousFailures} consecutive failure${previousFailures === 1 ? "" : "s"} before this successful delivery. No further action is needed.
      </p>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px; width: 50%;">Merchant</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; font-weight: 600;">${merchantName}</td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Report Frequency</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px;">${freqLabel}</td>
        </tr>
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Prior Failures Cleared</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; color: #4ade80; font-weight: 600;">${previousFailures}</td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Status</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; color: #4ade80; font-weight: 600;">Active</td>
        </tr>
      </table>

      <div style="text-align: center; margin-bottom: 20px;">
        <a href="${reportsLink}"
           style="display: inline-block; background: #7c3aed; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-size: 14px; font-weight: 600; letter-spacing: 0.3px;">
          View Merchant Reports
        </a>
      </div>

      <p style="margin: 0; color: #71717a; font-size: 12px;">
        If the link above doesn't work, copy this URL into your browser:<br>
        <span style="color: #818cf8;">${reportsLink}</span>
      </p>
    </div>
    <div style="padding: 14px 24px; background: #111; border-top: 1px solid #2a2a2a;">
      <p style="margin: 0; color: #52525b; font-size: 11px;">
        This alert was sent by RasoKart. To stop receiving report schedule emails, update your notification preferences in Admin Settings.
      </p>
    </div>
  </div>
</body>
</html>`;
}

export async function notifyAdminsOfReportScheduleResumed(opts: {
  merchantId: number;
  merchantName: string;
  frequency: string;
  previousFailures: number;
}): Promise<void> {
  try {
    const recipients = await getAdminEmails("reportFailureAlertEmails");

    if (recipients.length === 0) {
      logger.info({ merchantId: opts.merchantId }, "No admins opted in to report schedule failure emails — skipping resumed notification");
      return;
    }

    const html = buildReportScheduleResumedHtml(opts);
    const freqLabel = opts.frequency.charAt(0).toUpperCase() + opts.frequency.slice(1);
    const subject = `[RasoKart] ✅ Report Schedule Resumed — ${opts.merchantName} (${freqLabel})`;

    const results = await Promise.allSettled(
      recipients.map(email => sendMail({ to: email, subject, html }))
    );

    const sent = results.filter(r => r.status === "fulfilled" && r.value).length;
    const failed = results.length - sent;

    logger.info(
      { merchantId: opts.merchantId, totalAdmins: recipients.length, sent, failed },
      "Admin report schedule resumed emails dispatched"
    );
  } catch (err) {
    logger.error({ err, merchantId: opts.merchantId }, "Failed to send admin report schedule resumed emails");
  }
}

// ---------------------------------------------------------------------------
// Stuck EKQR QR code alert emails
// ---------------------------------------------------------------------------

function buildStuckEkqrHtml(opts: {
  stuck: number;
  threshold: number;
  staleMinutes: number;
}): string {
  const { stuck, threshold, staleMinutes } = opts;
  const adminLink = `${APP_DOMAIN}/admin/qr-codes`;

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; background: #0f0f0f; color: #e5e5e5; margin: 0; padding: 24px;">
  <div style="max-width: 600px; margin: 0 auto; background: #1a1a1a; border-radius: 8px; overflow: hidden; border: 1px solid #2a2a2a;">
    <div style="background: #7f1d1d; padding: 20px 24px;">
      <h1 style="margin: 0; font-size: 20px; color: #fff; letter-spacing: 0.5px;">RasoKart — Stuck EKQR QR Codes</h1>
      <p style="margin: 4px 0 0; color: #fca5a5; font-size: 13px;">Auto-retry threshold exceeded — admin review required</p>
    </div>
    <div style="padding: 24px;">
      <p style="margin: 0 0 16px; color: #f87171; font-size: 14px; font-weight: 600;">
        🔴 ${stuck} EKQR QR code${stuck !== 1 ? "s are" : " is"} stuck in an active state after automatic retry.
      </p>
      <p style="margin: 0 0 20px; color: #a1a1aa; font-size: 13px;">
        The auto-sync job polls EKQR every 5 minutes but these QR codes have not received a payment confirmation
        after more than ${staleMinutes} minutes. This may indicate a provider connectivity issue or merchant payment
        abandonment. Please review the affected QR codes in the admin portal.
      </p>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px; width: 50%;">Stuck QR Codes</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; color: #f87171; font-weight: 600;">${stuck}</td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Alert Threshold</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px;">${threshold}+ stuck codes</td>
        </tr>
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Stale After</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px;">${staleMinutes} minutes without payment confirmation</td>
        </tr>
      </table>

      <div style="text-align: center; margin-bottom: 20px;">
        <a href="${adminLink}"
           style="display: inline-block; background: #7c3aed; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-size: 14px; font-weight: 600; letter-spacing: 0.3px;">
          Review QR Codes in Admin Portal
        </a>
      </div>

      <p style="margin: 0; color: #71717a; font-size: 12px;">
        If the link above doesn't work, copy this URL into your browser:<br>
        <span style="color: #818cf8;">${adminLink}</span>
      </p>
    </div>
    <div style="padding: 14px 24px; background: #111; border-top: 1px solid #2a2a2a;">
      <p style="margin: 0; color: #52525b; font-size: 11px;">
        This alert was sent by RasoKart's EKQR auto-sync job. To stop receiving these alerts,
        update your notification preferences in Admin Settings.
      </p>
    </div>
  </div>
</body>
</html>`;
}

const EKQR_SYNC_ALERT_LAST_SENT_KEY = "ekqr_sync_alert_last_sent_at";

export async function notifyAdminsOfStuckEkqrQrCodes(opts: {
  stuck: number;
  threshold: number;
  staleMinutes: number;
  cooldownHours: number;
}): Promise<void> {
  try {
    const recipients = await getAdminEmails("ekqrSyncAlertEmails");

    if (recipients.length === 0) {
      logger.info("No admins opted in to EKQR sync alert emails — skipping");
      return;
    }

    // Cooldown check — avoid spamming during prolonged outages
    const cooldownCutoff = new Date(Date.now() - opts.cooldownHours * 60 * 60 * 1000);
    const [lastSentRow] = await db
      .select({ value: systemConfigTable.value })
      .from(systemConfigTable)
      .where(eq(systemConfigTable.key, EKQR_SYNC_ALERT_LAST_SENT_KEY))
      .limit(1);

    if (lastSentRow?.value) {
      const lastSentAt = new Date(lastSentRow.value);
      if (lastSentAt > cooldownCutoff) {
        logger.info(
          { cooldownHours: opts.cooldownHours, lastSentAt: lastSentRow.value },
          "EKQR stuck QR alert suppressed — within cooldown window"
        );
        return;
      }
    }

    const html = buildStuckEkqrHtml(opts);
    const subject = `[RasoKart] 🔴 ${opts.stuck} EKQR QR Code${opts.stuck !== 1 ? "s" : ""} Stuck — Auto-retry Threshold Exceeded`;

    const results = await Promise.allSettled(
      recipients.map(email => sendMail({ to: email, subject, html }))
    );

    const sent = results.filter(r => r.status === "fulfilled" && r.value).length;
    const failed = results.length - sent;

    // Record last sent time so cooldown works correctly
    if (sent > 0) {
      const now = new Date().toISOString();
      await db
        .insert(systemConfigTable)
        .values({ key: EKQR_SYNC_ALERT_LAST_SENT_KEY, value: now })
        .onConflictDoUpdate({
          target: systemConfigTable.key,
          set: { value: now, updatedAt: sql`now()` },
        });
    }

    logger.info(
      { stuck: opts.stuck, threshold: opts.threshold, totalAdmins: recipients.length, sent, failed },
      "Admin stuck EKQR QR alert emails dispatched"
    );
  } catch (err) {
    logger.error({ err }, "Failed to send admin stuck EKQR QR alert emails");
  }
}

// ---------------------------------------------------------------------------
// Payment gateway credential rotation alerts
// ---------------------------------------------------------------------------

const GATEWAY_LABELS: Record<string, string> = {
  cashfree: "Cashfree Payin",
  "cashfree-payout": "Cashfree Payout",
  ekqr: "EKQR",
};

export function buildCredentialRotationHtml(opts: {
  gateway: string;
  changedFields: string[];
  actorEmail: string;
  timestamp: string;
}): string {
  const { gateway, changedFields, actorEmail, timestamp } = opts;
  const gatewayLabel = GATEWAY_LABELS[gateway] ?? gateway;
  const settingsLink = `${APP_DOMAIN}/admin/payment-gateways`;

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; background: #0f0f0f; color: #e5e5e5; margin: 0; padding: 24px;">
  <div style="max-width: 600px; margin: 0 auto; background: #1a1a1a; border-radius: 8px; overflow: hidden; border: 1px solid #2a2a2a;">
    <div style="background: #7f1d1d; padding: 20px 24px;">
      <h1 style="margin: 0; font-size: 20px; color: #fff; letter-spacing: 0.5px;">RasoKart — Gateway Credentials Changed</h1>
      <p style="margin: 4px 0 0; color: #fca5a5; font-size: 13px;">${gatewayLabel} credentials were rotated</p>
    </div>
    <div style="padding: 24px;">
      <p style="margin: 0 0 16px; color: #f87171; font-size: 14px; font-weight: 600;">
        🔐 Credentials for the <strong>${gatewayLabel}</strong> payment gateway were changed. If this wasn't expected, investigate immediately.
      </p>
      <p style="margin: 0 0 20px; color: #a1a1aa; font-size: 13px;">
        For security, the new values are never included in this email. Review the change in the admin portal and confirm it was authorized.
      </p>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px; width: 40%;">Gateway</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; font-weight: 600;">${gatewayLabel}</td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Fields Changed</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; color: #f87171; font-weight: 600;">${changedFields.join(", ")}</td>
        </tr>
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Changed By</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px;">${actorEmail}</td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Timestamp</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px;">${timestamp}</td>
        </tr>
      </table>

      <div style="text-align: center; margin-bottom: 20px;">
        <a href="${settingsLink}"
           style="display: inline-block; background: #7c3aed; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-size: 14px; font-weight: 600; letter-spacing: 0.3px;">
          Review Payment Gateway Settings
        </a>
      </div>

      <p style="margin: 0; color: #71717a; font-size: 12px;">
        If the link above doesn't work, copy this URL into your browser:<br>
        <span style="color: #818cf8;">${settingsLink}</span>
      </p>
    </div>
    <div style="padding: 14px 24px; background: #111; border-top: 1px solid #2a2a2a;">
      <p style="margin: 0; color: #52525b; font-size: 11px;">
        This is a mandatory security alert sent to all admins whenever gateway credentials are rotated. It cannot be disabled.
      </p>
    </div>
  </div>
</body>
</html>`;
}

// Optional additional distribution list for credential rotation alerts (e.g. a
// dedicated security team inbox). This is purely additive — it can never replace
// or suppress the mandatory "all active admins" recipient list above.
async function getCredentialRotationExtraRecipients(): Promise<string[]> {
  try {
    const rows = await db
      .select()
      .from(systemConfigTable)
      .where(eq(systemConfigTable.key, SYSTEM_CONFIG_KEYS.CREDENTIAL_ROTATION_EXTRA_RECIPIENTS));
    const raw = rows[0]?.value ?? SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.CREDENTIAL_ROTATION_EXTRA_RECIPIENTS];
    if (!raw) return [];
    return raw
      .split(",")
      .map(e => e.trim().toLowerCase())
      .filter(e => e.length > 0);
  } catch {
    return [];
  }
}

export type CredentialRotationAlertResult = {
  attempted: number;
  sent: number;
  failed: number;
};

export async function notifyAdminsOfCredentialRotation(opts: {
  gateway: string;
  changedFields: string[];
  actorEmail: string;
}): Promise<CredentialRotationAlertResult> {
  try {
    if (opts.changedFields.length === 0) return { attempted: 0, sent: 0, failed: 0 };

    const adminEmails = await getAllActiveAdminEmails();

    if (adminEmails.length === 0) {
      logger.info({ gateway: opts.gateway }, "No active admins found — skipping credential rotation alert");
      return { attempted: 0, sent: 0, failed: 0 };
    }

    const extraRecipients = await getCredentialRotationExtraRecipients();
    const recipients = Array.from(new Set([...adminEmails.map(e => e.toLowerCase()), ...extraRecipients]));

    const timestamp = new Date().toISOString();
    const html = buildCredentialRotationHtml({ ...opts, timestamp });
    const gatewayLabel = GATEWAY_LABELS[opts.gateway] ?? opts.gateway;
    const subject = `[RasoKart] 🔐 ${gatewayLabel} credentials changed — action may be required`;

    const results = await Promise.allSettled(
      recipients.map(email => sendMail({ to: email, subject, html }))
    );

    const sent = results.filter(r => r.status === "fulfilled" && r.value).length;
    const failed = results.length - sent;

    logger.info(
      { gateway: opts.gateway, changedFields: opts.changedFields, actorEmail: opts.actorEmail, attempted: recipients.length, sent, failed },
      "Admin credential rotation alert emails dispatched"
    );

    return { attempted: recipients.length, sent, failed };
  } catch (err) {
    logger.error({ err, gateway: opts.gateway }, "Failed to send admin credential rotation alert emails");
    return { attempted: 0, sent: 0, failed: 0 };
  }
}
