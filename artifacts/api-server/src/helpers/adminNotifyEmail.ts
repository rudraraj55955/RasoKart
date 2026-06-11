import { db, usersTable, webhookFailureAlertLogsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { sendMail } from "./mailer";

const APP_DOMAIN = process.env["APP_DOMAIN"] ?? "https://rasokart.com";

function formatAmount(val: string | number | null | undefined): string {
  const n = Number(val ?? 0);
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function getAdminEmails(preference: "planExpiryAlertEmails" | "settlementStateEmails" | "webhookFailureEmails"): Promise<string[]> {
  const admins = await db
    .select({ email: usersTable.email })
    .from(usersTable)
    .where(and(
      eq(usersTable.role, "admin"),
      eq(usersTable.isActive, true),
      eq(usersTable[preference], true),
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
      { merchantId: opts.merchantId, totalAdmins: recipients.length, sent, failed },
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
