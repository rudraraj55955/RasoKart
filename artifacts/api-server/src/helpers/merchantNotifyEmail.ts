import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { maybeQueueOrSendEmail } from "./quietHours";

// ---------------------------------------------------------------------------
// Plan change notification emails → merchant
// (actual sending; HTML builders are defined further below)
// ---------------------------------------------------------------------------

export async function notifyMerchantOfPlanChange(opts: {
  merchantId: number;
  merchantEmail: string;
  businessName: string;
  planName: string;
  action: "assigned" | "upgraded" | "downgraded" | "suspended" | "reinstated";
  previousPlanName?: string | null;
  expiresAt?: string | null;
  notes?: string | null;
}): Promise<void> {
  try {
    const [user] = await db
      .select({ id: usersTable.id, planChangeEmails: usersTable.planChangeEmails })
      .from(usersTable)
      .where(eq(usersTable.merchantId, opts.merchantId))
      .limit(1);

    if (!user) {
      logger.info({ merchantId: opts.merchantId }, "No user found for merchant — skipping plan change email");
      return;
    }

    if (!user.planChangeEmails) {
      logger.info({ merchantId: opts.merchantId }, "Merchant opted out of plan change emails — skipping");
      return;
    }

    let subject: string;
    let html: string;

    if (opts.action === "assigned") {
      subject = `[RasoKart] Your plan has been assigned — ${opts.planName}`;
      html = buildPlanAssignedHtml({
        businessName: opts.businessName,
        planName: opts.planName,
        expiresAt: opts.expiresAt ?? null,
        notes: opts.notes ?? null,
      });
    } else if (opts.action === "upgraded") {
      subject = `[RasoKart] Your plan has been upgraded to ${opts.planName}`;
      html = buildPlanUpgradedHtml({
        businessName: opts.businessName,
        planName: opts.planName,
        previousPlanName: opts.previousPlanName ?? null,
        expiresAt: opts.expiresAt ?? null,
        notes: opts.notes ?? null,
      });
    } else if (opts.action === "downgraded") {
      subject = `[RasoKart] Your plan has been changed to ${opts.planName}`;
      html = buildPlanDowngradedHtml({
        businessName: opts.businessName,
        planName: opts.planName,
        previousPlanName: opts.previousPlanName ?? null,
        expiresAt: opts.expiresAt ?? null,
        notes: opts.notes ?? null,
      });
    } else if (opts.action === "suspended") {
      subject = `[RasoKart] Your plan has been suspended — ${opts.planName}`;
      html = buildPlanSuspendedHtml({
        businessName: opts.businessName,
        planName: opts.planName,
        notes: opts.notes ?? null,
      });
    } else {
      subject = `[RasoKart] Your plan has been reinstated — ${opts.planName}`;
      html = buildPlanReinstatedHtml({
        businessName: opts.businessName,
        planName: opts.planName,
        notes: opts.notes ?? null,
      });
    }

    const sent = await maybeQueueOrSendEmail({ userId: user.id, to: opts.merchantEmail, subject, html });
    if (!sent) {
      logger.warn({ merchantId: opts.merchantId, action: opts.action }, "Plan change email could not be sent (SMTP not configured or failed)");
    }
  } catch (err) {
    logger.error({ err, merchantId: opts.merchantId, action: opts.action }, "Failed to send plan change email");
  }
}

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
      .select({ id: usersTable.id, settlementStateChangedEmails: usersTable.settlementStateChangedEmails })
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

    const sent = await maybeQueueOrSendEmail({ userId: user.id, to: opts.merchantEmail, subject, html });
    if (!sent) {
      logger.warn({ merchantId: opts.merchantId, settlementId: opts.settlementId }, "Merchant settlement state change email could not be sent (SMTP not configured or failed)");
    }
  } catch (err) {
    logger.error({ err, merchantId: opts.merchantId, settlementId: opts.settlementId }, "Failed to send merchant settlement state change email");
  }
}

// ---------------------------------------------------------------------------
// Plan change notification emails → merchant
// ---------------------------------------------------------------------------

export function buildPlanAssignedHtml(opts: {
  businessName: string;
  planName: string;
  expiresAt: string | null;
  notes: string | null;
}): string {
  const { businessName, planName, expiresAt, notes } = opts;
  const dashboardLink = `${APP_DOMAIN}/merchant/dashboard`;
  const expiryLine = expiresAt
    ? new Date(expiresAt).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })
    : null;

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; background: #0f0f0f; color: #e5e5e5; margin: 0; padding: 24px;">
  <div style="max-width: 600px; margin: 0 auto; background: #1a1a1a; border-radius: 8px; overflow: hidden; border: 1px solid #2a2a2a;">
    <div style="background: #14532d; padding: 20px 24px;">
      <h1 style="margin: 0; font-size: 20px; color: #fff; letter-spacing: 0.5px;">RasoKart — Plan Assigned</h1>
      <p style="margin: 4px 0 0; color: #86efac; font-size: 13px;">Your subscription plan has been set up</p>
    </div>
    <div style="padding: 24px;">
      <p style="margin: 0 0 16px; color: #e5e5e5; font-size: 15px;">
        Dear <strong>${businessName}</strong>,
      </p>
      <p style="margin: 0 0 20px; color: #d1d5db; font-size: 14px; line-height: 1.6;">
        Your account has been assigned the <strong style="color: #4ade80;">${planName}</strong> plan. You now have access to all features included in this plan.
      </p>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px; width: 40%;">Plan</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; font-weight: 600; color: #4ade80;">${planName}</td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Status</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; font-weight: 600; color: #4ade80;">Active</td>
        </tr>
        ${expiryLine ? `
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Valid Until</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; font-weight: 600;">${expiryLine}</td>
        </tr>` : `
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Valid Until</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; color: #71717a;">No expiry date</td>
        </tr>`}
        ${notes ? `
        <tr>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Note</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; color: #d1d5db;">${notes}</td>
        </tr>` : ""}
      </table>

      <div style="text-align: center; margin-bottom: 20px;">
        <a href="${dashboardLink}"
           style="display: inline-block; background: #7c3aed; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-size: 14px; font-weight: 600; letter-spacing: 0.3px;">
          Go to My Dashboard
        </a>
      </div>

      <p style="margin: 0; color: #71717a; font-size: 12px;">
        If the link above doesn't work, copy this URL into your browser:<br>
        <span style="color: #818cf8;">${dashboardLink}</span>
      </p>
    </div>
    <div style="padding: 14px 24px; background: #111; border-top: 1px solid #2a2a2a;">
      <p style="margin: 0; color: #52525b; font-size: 11px;">
        This notification was sent by RasoKart because your subscription plan was updated.
        For support, contact <a href="mailto:support@rasokart.com" style="color: #818cf8; text-decoration: none;">support@rasokart.com</a>.
      </p>
    </div>
  </div>
</body>
</html>`.trim();
}

export function buildPlanUpgradedHtml(opts: {
  businessName: string;
  planName: string;
  previousPlanName: string | null;
  expiresAt: string | null;
  notes: string | null;
}): string {
  const { businessName, planName, previousPlanName, expiresAt, notes } = opts;
  const dashboardLink = `${APP_DOMAIN}/merchant/dashboard`;
  const expiryLine = expiresAt
    ? new Date(expiresAt).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })
    : null;

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; background: #0f0f0f; color: #e5e5e5; margin: 0; padding: 24px;">
  <div style="max-width: 600px; margin: 0 auto; background: #1a1a1a; border-radius: 8px; overflow: hidden; border: 1px solid #2a2a2a;">
    <div style="background: #1e3a5f; padding: 20px 24px;">
      <h1 style="margin: 0; font-size: 20px; color: #fff; letter-spacing: 0.5px;">RasoKart — Plan Upgraded</h1>
      <p style="margin: 4px 0 0; color: #bfdbfe; font-size: 13px;">Your subscription has moved to a higher tier</p>
    </div>
    <div style="padding: 24px;">
      <p style="margin: 0 0 16px; color: #e5e5e5; font-size: 15px;">
        Dear <strong>${businessName}</strong>,
      </p>
      <p style="margin: 0 0 20px; color: #d1d5db; font-size: 14px; line-height: 1.6;">
        Great news — your account has been upgraded to the <strong style="color: #60a5fa;">${planName}</strong> plan.
        You now have access to all the additional features and higher limits that come with this tier.
      </p>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        ${previousPlanName ? `
        <tr>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px; width: 40%;">Previous Plan</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; color: #71717a;">${previousPlanName}</td>
        </tr>` : ""}
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px; width: 40%;">New Plan</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; font-weight: 600; color: #60a5fa;">${planName}</td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Status</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; font-weight: 600; color: #4ade80;">Active</td>
        </tr>
        ${expiryLine ? `
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Valid Until</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; font-weight: 600;">${expiryLine}</td>
        </tr>` : `
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Valid Until</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; color: #71717a;">No expiry date</td>
        </tr>`}
        ${notes ? `
        <tr>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Note</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; color: #d1d5db;">${notes}</td>
        </tr>` : ""}
      </table>

      <div style="background: #0f1f3d; border: 1px solid #1e3a5f; border-radius: 6px; padding: 16px; margin-bottom: 24px;">
        <p style="margin: 0 0 8px; font-size: 13px; font-weight: 600; color: #93c5fd;">What's new with your upgrade</p>
        <ul style="margin: 0; padding-left: 18px; color: #a1a1aa; font-size: 13px; line-height: 1.8;">
          <li>Higher transaction limits and volume capacity</li>
          <li>Access to additional payment channels and providers</li>
          <li>Expanded API access and webhook delivery</li>
          <li>Priority support and faster settlement processing</li>
        </ul>
      </div>

      <div style="text-align: center; margin-bottom: 20px;">
        <a href="${dashboardLink}"
           style="display: inline-block; background: #7c3aed; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-size: 14px; font-weight: 600; letter-spacing: 0.3px;">
          Go to My Dashboard
        </a>
      </div>

      <p style="margin: 0; color: #71717a; font-size: 12px;">
        If the link above doesn't work, copy this URL into your browser:<br>
        <span style="color: #818cf8;">${dashboardLink}</span>
      </p>
    </div>
    <div style="padding: 14px 24px; background: #111; border-top: 1px solid #2a2a2a;">
      <p style="margin: 0; color: #52525b; font-size: 11px;">
        This notification was sent by RasoKart because your subscription plan was upgraded.
        For support, contact <a href="mailto:support@rasokart.com" style="color: #818cf8; text-decoration: none;">support@rasokart.com</a>.
      </p>
    </div>
  </div>
</body>
</html>`.trim();
}

export function buildPlanDowngradedHtml(opts: {
  businessName: string;
  planName: string;
  previousPlanName: string | null;
  expiresAt: string | null;
  notes: string | null;
}): string {
  const { businessName, planName, previousPlanName, expiresAt, notes } = opts;
  const dashboardLink = `${APP_DOMAIN}/merchant/dashboard`;
  const supportLink = `mailto:support@rasokart.com`;
  const expiryLine = expiresAt
    ? new Date(expiresAt).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })
    : null;

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; background: #0f0f0f; color: #e5e5e5; margin: 0; padding: 24px;">
  <div style="max-width: 600px; margin: 0 auto; background: #1a1a1a; border-radius: 8px; overflow: hidden; border: 1px solid #2a2a2a;">
    <div style="background: #3b1f0a; padding: 20px 24px;">
      <h1 style="margin: 0; font-size: 20px; color: #fff; letter-spacing: 0.5px;">RasoKart — Plan Changed</h1>
      <p style="margin: 4px 0 0; color: #fdba74; font-size: 13px;">Your subscription has moved to a lower tier</p>
    </div>
    <div style="padding: 24px;">
      <p style="margin: 0 0 16px; color: #e5e5e5; font-size: 15px;">
        Dear <strong>${businessName}</strong>,
      </p>
      <p style="margin: 0 0 20px; color: #d1d5db; font-size: 14px; line-height: 1.6;">
        Your account has been moved to the <strong style="color: #fb923c;">${planName}</strong> plan.
        Some features from your previous plan may no longer be available — please review the details below.
      </p>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        ${previousPlanName ? `
        <tr>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px; width: 40%;">Previous Plan</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; color: #71717a;">${previousPlanName}</td>
        </tr>` : ""}
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px; width: 40%;">New Plan</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; font-weight: 600; color: #fb923c;">${planName}</td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Status</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; font-weight: 600; color: #4ade80;">Active</td>
        </tr>
        ${expiryLine ? `
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Valid Until</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; font-weight: 600;">${expiryLine}</td>
        </tr>` : `
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Valid Until</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; color: #71717a;">No expiry date</td>
        </tr>`}
        ${notes ? `
        <tr>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Reason</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; color: #d1d5db;">${notes}</td>
        </tr>` : ""}
      </table>

      <div style="background: #1c1917; border: 1px solid #2a2a2a; border-radius: 6px; padding: 16px; margin-bottom: 24px;">
        <p style="margin: 0 0 8px; font-size: 13px; font-weight: 600; color: #fdba74;">What this means for your account</p>
        <ul style="margin: 0; padding-left: 18px; color: #a1a1aa; font-size: 13px; line-height: 1.8;">
          <li>Your account remains active and your data is preserved</li>
          <li>Transaction and volume limits reflect the new plan tier</li>
          <li>Some advanced features may be restricted or unavailable</li>
          <li>Contact support if you wish to upgrade again at any time</li>
        </ul>
      </div>

      <div style="text-align: center; margin-bottom: 20px;">
        <a href="${dashboardLink}"
           style="display: inline-block; background: #7c3aed; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-size: 14px; font-weight: 600; letter-spacing: 0.3px;">
          Go to My Dashboard
        </a>
      </div>

      <p style="margin: 0; color: #71717a; font-size: 12px;">
        Questions about this change? Contact us at<br>
        <a href="${supportLink}" style="color: #818cf8; text-decoration: none;">support@rasokart.com</a>
      </p>
    </div>
    <div style="padding: 14px 24px; background: #111; border-top: 1px solid #2a2a2a;">
      <p style="margin: 0; color: #52525b; font-size: 11px;">
        This notification was sent by RasoKart because your subscription plan was changed.
        For support, contact <a href="mailto:support@rasokart.com" style="color: #818cf8; text-decoration: none;">support@rasokart.com</a>.
      </p>
    </div>
  </div>
</body>
</html>`.trim();
}

export function buildPlanSuspendedHtml(opts: {
  businessName: string;
  planName: string;
  notes: string | null;
}): string {
  const { businessName, planName, notes } = opts;
  const supportLink = `mailto:support@rasokart.com`;

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; background: #0f0f0f; color: #e5e5e5; margin: 0; padding: 24px;">
  <div style="max-width: 600px; margin: 0 auto; background: #1a1a1a; border-radius: 8px; overflow: hidden; border: 1px solid #2a2a2a;">
    <div style="background: #78350f; padding: 20px 24px;">
      <h1 style="margin: 0; font-size: 20px; color: #fff; letter-spacing: 0.5px;">RasoKart — Plan Suspended</h1>
      <p style="margin: 4px 0 0; color: #fde68a; font-size: 13px;">Your subscription plan has been temporarily suspended</p>
    </div>
    <div style="padding: 24px;">
      <p style="margin: 0 0 16px; color: #e5e5e5; font-size: 15px;">
        Dear <strong>${businessName}</strong>,
      </p>
      <p style="margin: 0 0 20px; color: #d1d5db; font-size: 14px; line-height: 1.6;">
        Your <strong>${planName}</strong> plan has been temporarily suspended. Access to plan features is restricted until your plan is reinstated.
      </p>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px; width: 40%;">Plan</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; font-weight: 600;">${planName}</td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Status</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; font-weight: 600; color: #fb923c;">Suspended</td>
        </tr>
        ${notes ? `
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Reason</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; color: #d1d5db;">${notes}</td>
        </tr>` : ""}
      </table>

      <div style="background: #1c1917; border: 1px solid #2a2a2a; border-radius: 6px; padding: 16px; margin-bottom: 24px;">
        <p style="margin: 0 0 8px; font-size: 13px; font-weight: 600; color: #fde68a;">What this means for your account</p>
        <ul style="margin: 0; padding-left: 18px; color: #a1a1aa; font-size: 13px; line-height: 1.8;">
          <li>API access and webhook deliveries are paused</li>
          <li>New QR code and virtual account creation is disabled</li>
          <li>Existing deposits continue to be recorded</li>
          <li>Your account data is preserved</li>
        </ul>
      </div>

      <div style="text-align: center; margin-bottom: 20px;">
        <a href="${supportLink}"
           style="display: inline-block; background: #7c3aed; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-size: 14px; font-weight: 600; letter-spacing: 0.3px;">
          Contact Support
        </a>
      </div>

      <p style="margin: 0; color: #71717a; font-size: 12px;">
        If you believe this was done in error, please reach out to us at<br>
        <a href="${supportLink}" style="color: #818cf8; text-decoration: none;">support@rasokart.com</a>
      </p>
    </div>
    <div style="padding: 14px 24px; background: #111; border-top: 1px solid #2a2a2a;">
      <p style="margin: 0; color: #52525b; font-size: 11px;">
        This notification was sent by RasoKart because your subscription plan status changed.
        For support, contact <a href="mailto:support@rasokart.com" style="color: #818cf8; text-decoration: none;">support@rasokart.com</a>.
      </p>
    </div>
  </div>
</body>
</html>`.trim();
}

export function buildPlanReinstatedHtml(opts: {
  businessName: string;
  planName: string;
  notes: string | null;
}): string {
  const { businessName, planName, notes } = opts;
  const dashboardLink = `${APP_DOMAIN}/merchant/dashboard`;

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; background: #0f0f0f; color: #e5e5e5; margin: 0; padding: 24px;">
  <div style="max-width: 600px; margin: 0 auto; background: #1a1a1a; border-radius: 8px; overflow: hidden; border: 1px solid #2a2a2a;">
    <div style="background: #14532d; padding: 20px 24px;">
      <h1 style="margin: 0; font-size: 20px; color: #fff; letter-spacing: 0.5px;">RasoKart — Plan Reinstated</h1>
      <p style="margin: 4px 0 0; color: #86efac; font-size: 13px;">Your subscription plan has been restored</p>
    </div>
    <div style="padding: 24px;">
      <p style="margin: 0 0 16px; color: #e5e5e5; font-size: 15px;">
        Dear <strong>${businessName}</strong>,
      </p>
      <p style="margin: 0 0 20px; color: #d1d5db; font-size: 14px; line-height: 1.6;">
        Good news — your <strong style="color: #4ade80;">${planName}</strong> plan has been reinstated and is now fully active. All features have been restored to your account.
      </p>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px; width: 40%;">Plan</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; font-weight: 600; color: #4ade80;">${planName}</td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Status</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; font-weight: 600; color: #4ade80;">Active</td>
        </tr>
        ${notes ? `
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Note</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; color: #d1d5db;">${notes}</td>
        </tr>` : ""}
      </table>

      <div style="text-align: center; margin-bottom: 20px;">
        <a href="${dashboardLink}"
           style="display: inline-block; background: #7c3aed; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-size: 14px; font-weight: 600; letter-spacing: 0.3px;">
          Go to My Dashboard
        </a>
      </div>

      <p style="margin: 0; color: #71717a; font-size: 12px;">
        If the link above doesn't work, copy this URL into your browser:<br>
        <span style="color: #818cf8;">${dashboardLink}</span>
      </p>
    </div>
    <div style="padding: 14px 24px; background: #111; border-top: 1px solid #2a2a2a;">
      <p style="margin: 0; color: #52525b; font-size: 11px;">
        This notification was sent by RasoKart because your subscription plan status changed.
        For support, contact <a href="mailto:support@rasokart.com" style="color: #818cf8; text-decoration: none;">support@rasokart.com</a>.
      </p>
    </div>
  </div>
</body>
</html>`.trim();
}
