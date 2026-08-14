import { db, usersTable, webhookFailureAlertLogsTable, ekqrSyncAlertLogsTable, systemConfigTable, SYSTEM_CONFIG_KEYS, SYSTEM_CONFIG_DEFAULTS } from "@workspace/db";
import { createBulkNotifications } from "./notifications";
import { and, eq, gt, gte, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { sendMail } from "./mailer";

const APP_DOMAIN = process.env["APP_DOMAIN"] ?? "https://rasokart.com";

function formatAmount(val: string | number | null | undefined): string {
  const n = Number(val ?? 0);
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export async function getAdminEmails(preference: "planExpiryAlertEmails" | "settlementStateEmails" | "webhookFailureEmails" | "ekqrSyncAlertEmails" | "ekqrCapAlertEmails" | "reportFailureAlertEmails"): Promise<string[]> {
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

export function buildPlanExpiryHtml(opts: {
  merchantName: string;
  planName: string;
  merchantId: number;
  daysUntilExpiry: number;
  expiresAt: string;
  isTest?: boolean;
}): string {
  const { merchantName, planName, merchantId, daysUntilExpiry, expiresAt, isTest } = opts;
  const merchantLink = `${APP_DOMAIN}/admin/merchants/${merchantId}`;
  const urgencyColor = daysUntilExpiry <= 3 ? "#f87171" : daysUntilExpiry <= 7 ? "#fb923c" : "#facc15";

  const testBanner = isTest ? `
    <div style="background: #78350f; border: 2px solid #f59e0b; border-radius: 6px; padding: 14px 18px; margin-bottom: 20px; text-align: center;">
      <p style="margin: 0; color: #fde68a; font-size: 15px; font-weight: 700; letter-spacing: 0.3px;">
        ⚠️ THIS IS A TEST — no real event occurred
      </p>
      <p style="margin: 6px 0 0; color: #fbbf24; font-size: 12px;">
        This email was sent manually from Admin Settings to verify delivery. It does not indicate any real plan expiry.
      </p>
    </div>` : "";

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
      ${testBanner}
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

export function buildSettlementStateHtml(opts: {
  settlementId: number;
  merchantName: string;
  referenceNumber: string | null;
  newStatus: string;
  amount: string | number;
  note: string | null;
  isTest?: boolean;
}): string {
  const { settlementId, merchantName, referenceNumber, newStatus, amount, note, isTest } = opts;
  const settlementLink = `${APP_DOMAIN}/admin/settlements/${settlementId}`;

  const statusColors: Record<string, string> = {
    approved: "#4ade80",
    rejected: "#f87171",
    processing: "#60a5fa",
    completed: "#4ade80",
    pending: "#facc15",
  };
  const statusColor = statusColors[newStatus.toLowerCase()] ?? "#a1a1aa";

  const testBanner = isTest ? `
    <div style="background: #78350f; border: 2px solid #f59e0b; border-radius: 6px; padding: 14px 18px; margin-bottom: 20px; text-align: center;">
      <p style="margin: 0; color: #fde68a; font-size: 15px; font-weight: 700; letter-spacing: 0.3px;">
        ⚠️ THIS IS A TEST — no real event occurred
      </p>
      <p style="margin: 6px 0 0; color: #fbbf24; font-size: 12px;">
        This email was sent manually from Admin Settings to verify delivery. It does not indicate any real settlement state change.
      </p>
    </div>` : "";

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
      ${testBanner}
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

export function buildWebhookFailureHtml(opts: {
  merchantId: number;
  url: string;
  attempts: number;
  qrCodeId: number | null;
  isTest?: boolean;
}): string {
  const { merchantId, url, attempts, qrCodeId, isTest } = opts;
  const merchantLink = `${APP_DOMAIN}/admin/merchants/${merchantId}`;
  const qrLabel = qrCodeId != null ? ` (QR Code #${qrCodeId})` : "";

  const testBanner = isTest ? `
    <div style="background: #78350f; border: 2px solid #f59e0b; border-radius: 6px; padding: 14px 18px; margin-bottom: 20px; text-align: center;">
      <p style="margin: 0; color: #fde68a; font-size: 15px; font-weight: 700; letter-spacing: 0.3px;">
        ⚠️ THIS IS A TEST — no real event occurred
      </p>
      <p style="margin: 6px 0 0; color: #fbbf24; font-size: 12px;">
        This email was sent manually from Admin Settings to verify delivery. It does not indicate any real webhook failure.
      </p>
    </div>` : "";

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
      ${testBanner}
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
      cooldownHours,
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

export function buildReportScheduleAutoPausedHtml(opts: {
  merchantName: string;
  merchantId: number;
  frequency: string;
  consecutiveFailures: number;
  autoPauseAfterFailures: number;
  isTest?: boolean;
}): string {
  const { merchantName, merchantId, frequency, consecutiveFailures, autoPauseAfterFailures, isTest } = opts;
  const freqLabel = frequency.charAt(0).toUpperCase() + frequency.slice(1);
  const reportsLink = `${APP_DOMAIN}/admin/reports?merchantId=${merchantId}`;
  const smtpSettingsLink = `${APP_DOMAIN}/admin/settings`;

  const testBanner = isTest ? `
    <div style="background: #78350f; border: 2px solid #f59e0b; border-radius: 6px; padding: 14px 18px; margin-bottom: 20px; text-align: center;">
      <p style="margin: 0; color: #fde68a; font-size: 15px; font-weight: 700; letter-spacing: 0.3px;">
        ⚠️ THIS IS A TEST — no real event occurred
      </p>
      <p style="margin: 6px 0 0; color: #fbbf24; font-size: 12px;">
        This email was sent manually from Admin Settings to verify delivery. It does not indicate any real report schedule pause.
      </p>
    </div>` : "";

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
      ${testBanner}
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

export function buildReportScheduleResumedHtml(opts: {
  merchantName: string;
  merchantId: number;
  frequency: string;
  previousFailures: number;
  isTest?: boolean;
}): string {
  const { merchantName, merchantId, frequency, previousFailures, isTest } = opts;
  const freqLabel = frequency.charAt(0).toUpperCase() + frequency.slice(1);
  const reportsLink = `${APP_DOMAIN}/admin/reports?merchantId=${merchantId}`;

  const testBanner = isTest ? `
    <div style="background: #78350f; border: 2px solid #f59e0b; border-radius: 6px; padding: 14px 18px; margin-bottom: 20px; text-align: center;">
      <p style="margin: 0; color: #fde68a; font-size: 15px; font-weight: 700; letter-spacing: 0.3px;">
        ⚠️ THIS IS A TEST — no real event occurred
      </p>
      <p style="margin: 6px 0 0; color: #fbbf24; font-size: 12px;">
        This email was sent manually from Admin Settings to verify delivery. It does not indicate any real report schedule resumption.
      </p>
    </div>` : "";

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
      ${testBanner}
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

export function buildStuckEkqrHtml(opts: {
  stuck: number;
  threshold: number;
  staleMinutes: number;
  isTest?: boolean;
}): string {
  const { stuck, threshold, staleMinutes, isTest } = opts;
  const adminLink = `${APP_DOMAIN}/admin/qr-codes`;

  const testBanner = isTest ? `
    <div style="background: #78350f; border: 2px solid #f59e0b; border-radius: 6px; padding: 14px 18px; margin-bottom: 20px; text-align: center;">
      <p style="margin: 0; color: #fde68a; font-size: 15px; font-weight: 700; letter-spacing: 0.3px;">
        ⚠️ THIS IS A TEST — no real event occurred
      </p>
      <p style="margin: 6px 0 0; color: #fbbf24; font-size: 12px;">
        This email was sent manually from Admin Settings to verify delivery. It does not indicate any real stuck EKQR QR codes.
      </p>
    </div>` : "";

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
      ${testBanner}
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

export async function notifyAdminsOfStuckEkqrQrCodes(
  opts: {
    stuck: number;
    threshold: number;
    staleMinutes: number;
    cooldownHours: number;
  },
  // Injected in tests to intercept outbound mail without real SMTP.
  _sendMail: typeof sendMail = sendMail,
): Promise<void> {
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
        // Log the suppression so admins can see it in the history table
        await db.insert(ekqrSyncAlertLogsTable).values({
          stuckCount: opts.stuck,
          threshold: opts.threshold,
          staleMinutes: opts.staleMinutes,
          cooldownHours: opts.cooldownHours,
          suppressed: true,
          recipientCount: 0,
          recipientEmails: [],
        });
        return;
      }
    }

    const html = buildStuckEkqrHtml(opts);
    const subject = `[RasoKart] 🔴 ${opts.stuck} EKQR QR Code${opts.stuck !== 1 ? "s" : ""} Stuck — Auto-retry Threshold Exceeded`;

    const results = await Promise.allSettled(
      recipients.map(email => _sendMail({ to: email, subject, html }))
    );

    const sent = results.filter(r => r.status === "fulfilled" && r.value).length;
    const failed = results.length - sent;
    const sentRecipients = recipients.filter((_, i) => results[i]?.status === "fulfilled" && (results[i] as PromiseFulfilledResult<boolean>).value);

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

    // Log this send event so admins can review history
    await db.insert(ekqrSyncAlertLogsTable).values({
      stuckCount: opts.stuck,
      threshold: opts.threshold,
      staleMinutes: opts.staleMinutes,
      cooldownHours: opts.cooldownHours,
      suppressed: false,
      recipientCount: sent,
      recipientEmails: sentRecipients,
    });

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
  isTest?: boolean;
}): string {
  const { gateway, changedFields, actorEmail, timestamp, isTest } = opts;
  const gatewayLabel = GATEWAY_LABELS[gateway] ?? gateway;
  const settingsLink = `${APP_DOMAIN}/admin/payment-gateways`;

  const testBanner = isTest ? `
    <div style="background: #78350f; border: 2px solid #f59e0b; border-radius: 6px; padding: 14px 18px; margin-bottom: 20px; text-align: center;">
      <p style="margin: 0; color: #fde68a; font-size: 15px; font-weight: 700; letter-spacing: 0.3px;">
        ⚠️ THIS IS A TEST — no credentials were changed
      </p>
      <p style="margin: 6px 0 0; color: #fbbf24; font-size: 12px;">
        This email was sent manually from Admin Settings to verify delivery. It does not indicate any real credential rotation event.
      </p>
    </div>` : "";

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
      ${testBanner}
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

export function buildCredentialRotationText(opts: {
  gateway: string;
  changedFields: string[];
  actorEmail: string;
  timestamp: string;
  isTest?: boolean;
}): string {
  const { gateway, changedFields, actorEmail, timestamp, isTest } = opts;
  const gatewayLabel = GATEWAY_LABELS[gateway] ?? gateway;
  const settingsLink = `${APP_DOMAIN}/admin/payment-gateways`;

  const testBanner = isTest
    ? `[TEST] THIS IS A TEST — no credentials were changed\nThis email was sent manually from Admin Settings to verify delivery. It does not indicate any real credential rotation event.\n\n`
    : "";

  return `${testBanner}RasoKart — Gateway Credentials Changed
${gatewayLabel} credentials were rotated

Credentials for the ${gatewayLabel} payment gateway were changed. If this wasn't expected, investigate immediately.

For security, the new values are never included in this email. Review the change in the admin portal and confirm it was authorized.

Gateway:        ${gatewayLabel}
Fields Changed: ${changedFields.join(", ")}
Changed By:     ${actorEmail}
Timestamp:      ${timestamp}

Review Payment Gateway Settings:
${settingsLink}

This is a mandatory security alert sent to all admins whenever gateway credentials are rotated. It cannot be disabled.`;
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
  sentEmails: string[];
  failedEmails: string[];
};

// ---------------------------------------------------------------------------
// EKQR / UPIGateway daily cap full alert emails
// ---------------------------------------------------------------------------

export function buildEkqrCapFullHtml(opts: {
  todayTotal: number;
  dailyLimit: number;
  resetsAt: string;
}): string {
  const { todayTotal, dailyLimit, resetsAt } = opts;
  const gatewayLink = `${APP_DOMAIN}/admin/payment-gateways`;
  const resetsAtFormatted = new Date(resetsAt).toUTCString();

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; background: #0f0f0f; color: #e5e5e5; margin: 0; padding: 24px;">
  <div style="max-width: 600px; margin: 0 auto; background: #1a1a1a; border-radius: 8px; overflow: hidden; border: 1px solid #2a2a2a;">
    <div style="background: #7c1d1d; padding: 20px 24px;">
      <h1 style="margin: 0; font-size: 20px; color: #fff; letter-spacing: 0.5px;">RasoKart — EKQR Daily Cap Reached</h1>
      <p style="margin: 4px 0 0; color: #fca5a5; font-size: 13px;">UPIGateway provider daily limit is full — new orders are being rejected</p>
    </div>
    <div style="padding: 24px;">
      <p style="margin: 0 0 16px; color: #f87171; font-size: 14px; font-weight: 600;">
        🔴 The EKQR / UPIGateway daily cap has been reached. All new merchant deposit requests via this provider are currently returning errors.
      </p>
      <p style="margin: 0 0 20px; color: #a1a1aa; font-size: 13px;">
        Consider raising the daily cap in Payment Gateway settings or informing affected merchants. The cap resets automatically at UTC midnight.
      </p>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px; width: 50%;">Today's Total</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; font-weight: 600; color: #f87171;">${formatAmount(todayTotal)}</td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Daily Cap</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; font-weight: 600;">${formatAmount(dailyLimit)}</td>
        </tr>
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Resets At</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; color: #60a5fa;">${resetsAtFormatted}</td>
        </tr>
      </table>

      <div style="text-align: center; margin-bottom: 20px;">
        <a href="${gatewayLink}"
           style="display: inline-block; background: #7c3aed; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-size: 14px; font-weight: 600; letter-spacing: 0.3px;">
          Open Payment Gateway Settings
        </a>
      </div>

      <p style="margin: 0; color: #71717a; font-size: 12px;">
        If the link above doesn't work, copy this URL into your browser:<br>
        <span style="color: #818cf8;">${gatewayLink}</span>
      </p>
    </div>
    <div style="padding: 14px 24px; background: #111; border-top: 1px solid #2a2a2a;">
      <p style="margin: 0; color: #52525b; font-size: 11px;">
        This is a one-per-day automated alert sent by RasoKart when the EKQR daily cap is reached.
      </p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Sends a one-per-UTC-day alert when the EKQR / UPIGateway provider daily cap
 * is full, via two independent delivery channels:
 *   • Email  — admins who have opted in via ekqrCapAlertEmails preference
 *   • In-app — admins who have opted in via ekqrCapAlertNotifs preference
 *
 * Deduplication: atomically claims today's alert slot via an INSERT … ON
 * CONFLICT DO UPDATE … WHERE value IS DISTINCT FROM … RETURNING in
 * system_config.  This is race-safe: concurrent callers are serialised at the
 * PostgreSQL index level, and exactly one wins the claim.  The claim covers
 * both channels — only the first caller per UTC day dispatches anything.
 *
 * Transient-failure safety: if the claim is won but all email sends fail,
 * the claim is released (conditional UPDATE) so the next cap-exceeded request
 * on the same day can retry.
 *
 * Fire-and-forget safe: all errors are caught and logged; the caller should
 * call this without awaiting or with .catch() to avoid blocking the request.
 */
export async function notifyAdminsOfEkqrCapFull(
  opts: {
    todayTotal: number;
    dailyLimit: number;
    resetsAt: string;
  },
  // Injected in tests to intercept outbound mail without real SMTP.
  _sendMail: typeof sendMail = sendMail,
): Promise<void> {
  try {
    const todayUtcDate = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"

    // ── Atomic dedup: one alert per UTC calendar day ───────────────────────
    // INSERT … ON CONFLICT DO UPDATE … WHERE value IS DISTINCT FROM today …
    // RETURNING is atomic at the PostgreSQL index level.
    //
    // ┌─────────────────────────────────────────────────────────────────────┐
    // │ Scenario                  │ INSERT outcome  │ RETURNING rows        │
    // │ Row absent (fresh DB)     │ INSERT wins     │ 1 row  → claim = true │
    // │ Row exists, old date      │ conflict→UPDATE │ 1 row  → claim = true │
    // │ Row exists, today already │ conflict, WHERE │ 0 rows → claim = false│
    // │                           │ false → no-op   │                       │
    // └─────────────────────────────────────────────────────────────────────┘
    // Concurrent first-callers: PG serialises at the index — exactly one
    // INSERT wins; the other sees a conflict and follows the WHERE-false path,
    // getting 0 rows back and skipping.
    const claimRows = await db.execute(
      sql`INSERT INTO system_config (key, value)
          VALUES (${SYSTEM_CONFIG_KEYS.UPIGATEWAY_CAP_ALERT_LAST_SENT_DATE}, ${todayUtcDate})
          ON CONFLICT (key) DO UPDATE
            SET value = EXCLUDED.value
            WHERE system_config.value IS DISTINCT FROM EXCLUDED.value
          RETURNING value`
    );
    // drizzle node-postgres db.execute returns the full pg QueryResult whose
    // returned rows are in result.rows (not at the top level of the object).
    const claimed = ((claimRows as any).rows?.length ?? 0) > 0;

    if (!claimed) {
      logger.info({ todayUtcDate }, "EKQR cap alert suppressed — already sent today");
      return;
    }

    // ── Email channel ─────────────────────────────────────────────────────────
    // "No opted-in recipients" is a configuration state, not a transient failure;
    // the daily claim is kept so the function doesn't retry on every cap-exceeded
    // request when nobody has opted in.  Only a complete transient send failure
    // (recipients exist but every SMTP call fails) releases the claim, allowing
    // the next same-day request to retry delivery.
    try {
      const recipients = await getAdminEmails("ekqrCapAlertEmails");
      if (recipients.length > 0) {
        const html = buildEkqrCapFullHtml(opts);
        const subject = `[RasoKart] 🔴 EKQR Daily Cap Reached — ${formatAmount(opts.todayTotal)} of ${formatAmount(opts.dailyLimit)} used`;
        const results = await Promise.allSettled(
          recipients.map(email => _sendMail({ to: email, subject, html }))
        );
        const emailSent = results.filter(r => r.status === "fulfilled" && r.value).length;
        const emailFailed = results.length - emailSent;
        if (emailSent > 0) {
          logger.info(
            { todayTotal: opts.todayTotal, dailyLimit: opts.dailyLimit, totalAdmins: recipients.length, sent: emailSent, failed: emailFailed },
            "Admin EKQR cap full alert emails dispatched"
          );
        } else {
          // All sends failed (transient) — release claim so next request can retry.
          logger.warn(
            { todayTotal: opts.todayTotal, dailyLimit: opts.dailyLimit, totalAdmins: recipients.length, failed: emailFailed },
            "EKQR cap alert: all email sends failed — releasing dedup claim so next request can retry"
          );
          try {
            await db
              .update(systemConfigTable)
              .set({ value: "" })
              .where(
                and(
                  eq(systemConfigTable.key, SYSTEM_CONFIG_KEYS.UPIGATEWAY_CAP_ALERT_LAST_SENT_DATE),
                  eq(systemConfigTable.value, todayUtcDate),
                )
              );
          } catch {
            // Best-effort; failure to release means next retry waits until tomorrow.
          }
        }
      } else {
        logger.info("No admins opted in to EKQR cap alert emails — skipping email");
      }
    } catch (emailErr) {
      logger.error({ emailErr }, "Failed to send EKQR cap full alert emails");
    }

    // ── In-app notifications — independent of email; fired to all opted-in admins
    try {
      const adminRows = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(and(eq(usersTable.role, "admin"), eq(usersTable.isActive, true), eq(usersTable.ekqrCapAlertNotifs, true)));
      if (adminRows.length > 0) {
        const resetsDate = new Date(opts.resetsAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
        await createBulkNotifications(
          adminRows.map(r => ({
            userId: r.id,
            type: "ekqr_daily_cap_full" as const,
            title: "EKQR Daily Cap Reached",
            body: `The EKQR / UPIGateway daily cap of ₹${opts.dailyLimit.toLocaleString()} has been reached (₹${opts.todayTotal.toLocaleString()} used). New merchant deposits via this provider are being rejected until the cap resets on ${resetsDate}.`,
            metadata: { todayTotal: opts.todayTotal, dailyLimit: opts.dailyLimit, resetsAt: opts.resetsAt },
          })),
          { skipPrefCheck: true }, // already filtered by ekqrCapAlertNotifs above
        );
      } else {
        logger.info("No admins opted in to EKQR cap alert in-app notifications — skipping");
      }
    } catch (inAppErr) {
      logger.error({ inAppErr }, "Failed to send EKQR cap full in-app notifications");
    }
  } catch (err) {
    logger.error({ err }, "Failed to dispatch EKQR cap full alert");
  }
}

export async function notifyAdminsOfCredentialRotation(opts: {
  gateway: string;
  changedFields: string[];
  actorEmail: string;
  isTest?: boolean;
}): Promise<CredentialRotationAlertResult> {
  try {
    if (opts.changedFields.length === 0) return { attempted: 0, sent: 0, failed: 0, sentEmails: [], failedEmails: [] };

    const adminEmails = await getAllActiveAdminEmails();

    if (adminEmails.length === 0) {
      logger.info({ gateway: opts.gateway }, "No active admins found — skipping credential rotation alert");
      return { attempted: 0, sent: 0, failed: 0, sentEmails: [], failedEmails: [] };
    }

    const extraRecipients = await getCredentialRotationExtraRecipients();
    const recipients = Array.from(new Set([...adminEmails.map(e => e.toLowerCase()), ...extraRecipients]));

    const timestamp = new Date().toISOString();
    const html = buildCredentialRotationHtml({ ...opts, timestamp, isTest: opts.isTest });
    const gatewayLabel = GATEWAY_LABELS[opts.gateway] ?? opts.gateway;
    const subject = `[RasoKart] 🔐 ${gatewayLabel} credentials changed — action may be required${opts.isTest ? " (TEST)" : ""}`;

    const results = await Promise.allSettled(
      recipients.map(email => sendMail({ to: email, subject, html }))
    );

    const sentEmails: string[] = [];
    const failedEmails: string[] = [];
    results.forEach((r, i) => {
      if (r.status === "fulfilled" && r.value) {
        sentEmails.push(recipients[i]!);
      } else {
        failedEmails.push(recipients[i]!);
      }
    });
    const sent = sentEmails.length;
    const failed = failedEmails.length;

    logger.info(
      { gateway: opts.gateway, changedFields: opts.changedFields, actorEmail: opts.actorEmail, attempted: recipients.length, sent, failed },
      "Admin credential rotation alert emails dispatched"
    );

    return { attempted: recipients.length, sent, failed, sentEmails, failedEmails };
  } catch (err) {
    logger.error({ err, gateway: opts.gateway }, "Failed to send admin credential rotation alert emails");
    return { attempted: 0, sent: 0, failed: 0, sentEmails: [], failedEmails: [] };
  }
}

// ---------------------------------------------------------------------------
// PayU credit-failure alert
// Fired when creditWalletForPayu() returns "error" after hash verification passes.
// This is a critical financial event — no opt-out; all active admins are notified.
// ---------------------------------------------------------------------------

function buildPayuCreditFailureHtml(opts: {
  txnid: string;
  merchantId: number | null;
  amount: string | null;
  source: string;
}): string {
  const { txnid, merchantId, amount, source } = opts;
  const adminLink = `${APP_DOMAIN}/admin/payu-orders`;
  const amountDisplay = amount ? formatAmount(amount) : "unknown";

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; background: #0f0f0f; color: #e5e5e5; margin: 0; padding: 24px;">
  <div style="max-width: 600px; margin: 0 auto; background: #1a1a1a; border-radius: 8px; overflow: hidden; border: 1px solid #2a2a2a;">
    <div style="background: #7f1d1d; padding: 20px 24px;">
      <h1 style="margin: 0; font-size: 20px; color: #fff; letter-spacing: 0.5px;">⚠️ RasoKart — PayU Credit Failure</h1>
      <p style="margin: 4px 0 0; color: #fca5a5; font-size: 13px;">Payment confirmed by PayU but wallet credit failed — manual reconciliation required</p>
    </div>
    <div style="padding: 24px;">
      <p style="margin: 0 0 16px; color: #f87171; font-size: 14px; font-weight: 600;">
        A PayU payment was confirmed and hash-verified, but the merchant wallet credit transaction failed.
        The merchant's customer was charged but the merchant's RasoKart balance was NOT updated.
      </p>
      <p style="margin: 0 0 20px; color: #a1a1aa; font-size: 13px;">
        The order has been flagged as <strong style="color: #fbbf24;">CREDIT_FAILED</strong> in the database.
        Please review the order and credit the wallet manually from the admin PayU orders page.
      </p>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px; width: 40%;">Transaction ID</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; font-family: monospace; color: #e5e5e5;">${txnid}</td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Merchant ID</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px;">${merchantId ?? "unknown"}</td>
        </tr>
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Amount</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; color: #f87171; font-weight: 600;">${amountDisplay}</td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Source</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px;">${source}</td>
        </tr>
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Order Status</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; color: #fbbf24; font-weight: 600;">CREDIT_FAILED</td>
        </tr>
      </table>

      <div style="text-align: center; margin-bottom: 20px;">
        <a href="${adminLink}"
           style="display: inline-block; background: #7c3aed; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-size: 14px; font-weight: 600; letter-spacing: 0.3px;">
          Review PayU Orders in Admin Portal
        </a>
      </div>

      <p style="margin: 0; color: #71717a; font-size: 12px;">
        If the link above doesn't work, copy this URL into your browser:<br>
        <span style="color: #818cf8;">${adminLink}</span>
      </p>
    </div>
    <div style="padding: 14px 24px; background: #111; border-top: 1px solid #2a2a2a;">
      <p style="margin: 0; color: #52525b; font-size: 11px;">
        This alert was sent by RasoKart's PayU webhook processor. All active admins receive this alert regardless of notification preferences.
      </p>
    </div>
  </div>
</body>
</html>`;
}

export async function notifyAdminsOfPayuCreditFailure(opts: {
  txnid: string;
  merchantId: number | null;
  amount: string | null;
  source: string;
}): Promise<void> {
  try {
    // Critical financial alert — no opt-out, send to all active admins
    const recipients = await getAllActiveAdminEmails();
    if (recipients.length === 0) {
      logger.warn({ txnid: opts.txnid }, "payu_credit_failure_no_admin_recipients");
      return;
    }

    const subject = `⚠️ PayU Credit Failure — ${opts.txnid} needs manual reconciliation`;
    const html    = buildPayuCreditFailureHtml(opts);

    const results = await Promise.allSettled(
      recipients.map(email => sendMail({ to: email, subject, html })),
    );

    const sent   = results.filter(r => r.status === "fulfilled").length;
    const failed = results.filter(r => r.status === "rejected").length;
    logger.info({ txnid: opts.txnid, attempted: recipients.length, sent, failed }, "payu_credit_failure_alerts_sent");

    // In-app notifications — skip preference check (critical alert)
    const admins = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(eq(usersTable.role, "admin"), eq(usersTable.isActive, true)));

    if (admins.length > 0) {
      await createBulkNotifications(
        admins.map(a => ({
          userId:   a.id,
          type:     "payu_credit_failed" as const,
          title:    "PayU Credit Failure",
          body:     `Payment ${opts.txnid} confirmed by PayU but wallet credit failed. Amount: ${opts.amount ? formatAmount(opts.amount) : "unknown"}. Manual reconciliation required.`,
          metadata: { txnid: opts.txnid, merchantId: opts.merchantId, amount: opts.amount, source: opts.source },
        })),
        { skipPrefCheck: true },
      );
    }
  } catch (err) {
    logger.error({ err, txnid: opts.txnid }, "Failed to send PayU credit failure alerts");
  }
}

// ── Cashfree stuck payin order alert ─────────────────────────────────────────
// Payment-integrity alert: every active admin is notified (no opt-out),
// matching the pattern used for credential rotation alerts.

const CASHFREE_STUCK_ORDER_ALERT_LAST_SENT_KEY = SYSTEM_CONFIG_KEYS.CASHFREE_STUCK_ORDER_ALERT_LAST_SENT_AT;

function buildStuckCashfreeOrderHtml(opts: {
  stuck: number;
  threshold: number;
  staleMinutes: number;
}): string {
  const dashboardUrl = `${APP_DOMAIN}/admin/deposits?tab=upi`;
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="font-family:sans-serif;background:#f9f9f9;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;padding:24px;border:1px solid #e5e7eb;">
    <h2 style="color:#dc2626;margin-top:0;">🔴 Cashfree Stuck Orders Alert</h2>
    <p style="color:#374151;">
      <strong>${opts.stuck}</strong> Cashfree payin order${opts.stuck !== 1 ? "s are" : " is"} stuck in a
      non-PAID status for more than <strong>${opts.staleMinutes} minute${opts.staleMinutes !== 1 ? "s" : ""}</strong>
      (threshold: ${opts.threshold}).
    </p>
    <p style="color:#6b7280;font-size:14px;">
      These orders may indicate a webhook delivery failure or a decryption/signature issue.
      Check the Cashfree payin orders table and webhook logs immediately.
    </p>
    <a href="${dashboardUrl}"
       style="display:inline-block;background:#dc2626;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold;margin-top:8px;">
      View Payin Orders →
    </a>
    <p style="margin-top:24px;color:#9ca3af;font-size:12px;">
      This alert was sent by RasoKart because the stuck order count exceeded the configured threshold.
      To adjust the threshold or cooldown, update the system config keys
      <code>cashfree_stuck_order_alert_threshold</code> and <code>cashfree_stuck_order_alert_cooldown_hours</code>.
    </p>
  </div>
</body>
</html>`;
}

/**
 * Notify every active admin when the count of stuck Cashfree payin orders
 * crosses the configured threshold. Respects cooldown to avoid alert storms.
 *
 * "Stuck" = status ≠ PAID and older than staleMinutes minutes.
 * Uses getAllActiveAdminEmails() — no opt-out, same as credential rotation alerts.
 */
export async function notifyAdminsOfStuckCashfreeOrders(
  opts: {
    stuck: number;
    threshold: number;
    staleMinutes: number;
    cooldownHours: number;
  },
  _sendMail: typeof sendMail = sendMail,
): Promise<void> {
  try {
    const recipients = await getAllActiveAdminEmails();
    if (recipients.length === 0) {
      logger.info("No active admin emails found for stuck Cashfree order alert — skipping");
      return;
    }

    // Cooldown check — avoid spamming during prolonged outages
    const cooldownCutoff = new Date(Date.now() - opts.cooldownHours * 60 * 60 * 1000);
    const [lastSentRow] = await db
      .select({ value: systemConfigTable.value })
      .from(systemConfigTable)
      .where(eq(systemConfigTable.key, CASHFREE_STUCK_ORDER_ALERT_LAST_SENT_KEY))
      .limit(1);

    if (lastSentRow?.value) {
      const lastSentAt = new Date(lastSentRow.value);
      if (lastSentAt > cooldownCutoff) {
        logger.info(
          { cooldownHours: opts.cooldownHours, lastSentAt: lastSentRow.value },
          "Cashfree stuck order alert suppressed — within cooldown window",
        );
        return;
      }
    }

    const html = buildStuckCashfreeOrderHtml(opts);
    const subject = `[RasoKart] 🔴 ${opts.stuck} Cashfree Payin Order${opts.stuck !== 1 ? "s" : ""} Stuck — Action Required`;

    const results = await Promise.allSettled(
      recipients.map(email => _sendMail({ to: email, subject, html })),
    );

    const sent = results.filter(r => r.status === "fulfilled" && (r as PromiseFulfilledResult<boolean>).value).length;

    if (sent > 0) {
      const now = new Date().toISOString();
      await db
        .insert(systemConfigTable)
        .values({ key: CASHFREE_STUCK_ORDER_ALERT_LAST_SENT_KEY, value: now })
        .onConflictDoUpdate({
          target: systemConfigTable.key,
          set: { value: now, updatedAt: sql`now()` },
        });
    }

    logger.info(
      { stuck: opts.stuck, threshold: opts.threshold, totalAdmins: recipients.length, sent },
      "Admin stuck Cashfree order alert emails dispatched",
    );
  } catch (err) {
    logger.error({ err }, "Failed to send admin stuck Cashfree order alert emails");
  }
}
