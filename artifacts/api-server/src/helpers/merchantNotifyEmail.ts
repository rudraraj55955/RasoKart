import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { sendMail } from "./mailer";
import { logger } from "../lib/logger";

const APP_DOMAIN = process.env["APP_DOMAIN"] ?? "https://rasokart.com";

function formatAmount(val: string | number | null | undefined): string {
  const n = Number(val ?? 0);
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ---------------------------------------------------------------------------
// Settlement state-change email → merchant
// ---------------------------------------------------------------------------

function buildMerchantSettlementStateHtml(opts: {
  settlementId: number;
  businessName: string;
  newStatus: string;
  amount: string | number;
  referenceNumber: string | null;
  adminRemark: string | null;
}): string {
  const { settlementId, businessName, newStatus, amount, referenceNumber, adminRemark } = opts;
  const settlementsLink = `${APP_DOMAIN}/merchant/settlements`;

  const statusColors: Record<string, string> = {
    approved: "#4ade80",
    rejected: "#f87171",
    processing: "#60a5fa",
    completed: "#4ade80",
    paid: "#4ade80",
    pending: "#facc15",
    cancelled: "#a1a1aa",
  };
  const statusColor = statusColors[newStatus.toLowerCase()] ?? "#a1a1aa";
  const statusLabel = newStatus.charAt(0).toUpperCase() + newStatus.slice(1);

  const headerColors: Record<string, string> = {
    approved: "#14532d",
    paid: "#14532d",
    completed: "#14532d",
    rejected: "#7f1d1d",
    processing: "#1e3a5f",
    pending: "#78350f",
    cancelled: "#27272a",
  };
  const headerBg = headerColors[newStatus.toLowerCase()] ?? "#1a1a1a";

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; background: #0f0f0f; color: #e5e5e5; margin: 0; padding: 24px;">
  <div style="max-width: 600px; margin: 0 auto; background: #1a1a1a; border-radius: 8px; overflow: hidden; border: 1px solid #2a2a2a;">
    <div style="background: ${headerBg}; padding: 20px 24px;">
      <h1 style="margin: 0; font-size: 20px; color: #fff; letter-spacing: 0.5px;">RasoKart — Settlement Update</h1>
      <p style="margin: 4px 0 0; color: #bfdbfe; font-size: 13px;">Your settlement request #${settlementId} has been updated</p>
    </div>
    <div style="padding: 24px;">
      <p style="margin: 0 0 16px; color: #e5e5e5; font-size: 15px;">
        Dear <strong>${businessName}</strong>,
      </p>
      <p style="margin: 0 0 20px; color: #d1d5db; font-size: 14px; line-height: 1.6;">
        Your settlement request has been updated to <strong style="color: ${statusColor};">${statusLabel}</strong>.
      </p>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px; width: 40%;">Settlement ID</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; font-weight: 600;">#${settlementId}</td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Amount</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; font-weight: 600;">${formatAmount(amount)}</td>
        </tr>
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">New Status</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; color: ${statusColor}; font-weight: 600;">${statusLabel}</td>
        </tr>
        ${referenceNumber ? `
        <tr>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Reference</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px;">${referenceNumber}</td>
        </tr>` : ""}
        ${adminRemark ? `
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Admin Note</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; color: #d1d5db;">${adminRemark}</td>
        </tr>` : ""}
      </table>

      <div style="text-align: center; margin-bottom: 20px;">
        <a href="${settlementsLink}"
           style="display: inline-block; background: #7c3aed; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-size: 14px; font-weight: 600; letter-spacing: 0.3px;">
          View My Settlements
        </a>
      </div>

      <p style="margin: 0; color: #71717a; font-size: 12px;">
        If the link above doesn't work, copy this URL into your browser:<br>
        <span style="color: #818cf8;">${settlementsLink}</span>
      </p>
    </div>
    <div style="padding: 14px 24px; background: #111; border-top: 1px solid #2a2a2a;">
      <p style="margin: 0; color: #52525b; font-size: 11px;">
        This notification was sent by RasoKart because your settlement request changed state.
        To stop receiving these emails, update your notification preferences in your merchant portal.
        For support, contact <a href="mailto:support@rasokart.com" style="color: #818cf8; text-decoration: none;">support@rasokart.com</a>.
      </p>
    </div>
  </div>
</body>
</html>`.trim();
}

export async function notifyMerchantOfSettlementStateChange(opts: {
  merchantId: number;
  merchantEmail: string;
  businessName: string;
  settlementId: number;
  newStatus: string;
  amount: string | number;
  referenceNumber: string | null;
  adminRemark: string | null;
}): Promise<void> {
  try {
    const [user] = await db
      .select({ settlementStateChangedEmails: usersTable.settlementStateChangedEmails })
      .from(usersTable)
      .where(eq(usersTable.merchantId, opts.merchantId))
      .limit(1);

    if (!user) {
      logger.info({ merchantId: opts.merchantId }, "No user found for merchant — skipping settlement state email");
      return;
    }

    if (!user.settlementStateChangedEmails) {
      logger.info({ merchantId: opts.merchantId }, "Merchant opted out of settlement state change emails — skipping");
      return;
    }

    const statusLabel = opts.newStatus.charAt(0).toUpperCase() + opts.newStatus.slice(1);
    const subject = `[RasoKart] Settlement #${opts.settlementId} — Status updated to ${statusLabel}`;
    const html = buildMerchantSettlementStateHtml(opts);

    const sent = await sendMail({ to: opts.merchantEmail, subject, html });
    if (!sent) {
      logger.warn({ merchantId: opts.merchantId, settlementId: opts.settlementId }, "Merchant settlement state change email could not be sent (SMTP not configured or failed)");
    }
  } catch (err) {
    logger.error({ err, merchantId: opts.merchantId, settlementId: opts.settlementId }, "Failed to send merchant settlement state change email");
  }
}
