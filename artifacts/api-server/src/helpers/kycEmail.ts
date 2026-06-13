import { sendMail } from "./mailer";
import { logger } from "../lib/logger";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function emailShell(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title} — RasoKart</title>
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
              ${body}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 40px;border-top:1px solid #2a2a2a;background:#111;">
              <p style="margin:0;font-size:12px;color:#6b7280;line-height:1.6;">
                This is an automated message from RasoKart. Please do not reply directly to this email.
                For support, contact <a href="mailto:support@rasokart.com" style="color:#f97316;text-decoration:none;">support@rasokart.com</a>.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();
}

export async function sendKycDocApprovedEmail(opts: {
  to: string;
  businessName: string;
  docLabel: string;
}): Promise<void> {
  const { to, businessName, docLabel } = opts;

  const body = `
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:600;color:#f1f1f1;">KYC Document Approved</h1>
    <p style="margin:0 0 24px;font-size:14px;color:#9ca3af;line-height:1.6;">
      Your verification document has been reviewed.
    </p>

    <p style="margin:0 0 24px;font-size:15px;color:#d1d5db;line-height:1.6;">
      Dear <strong style="color:#fff;">${escapeHtml(businessName)}</strong>,
    </p>

    <p style="margin:0 0 24px;font-size:15px;color:#d1d5db;line-height:1.6;">
      Great news! Your <strong style="color:#fff;">${escapeHtml(docLabel)}</strong> document has been
      <strong style="color:#22c55e;">approved</strong> by our verification team.
    </p>

    <!-- Status badge -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
      <tr>
        <td style="background:#111;border-left:3px solid #22c55e;border-radius:6px;padding:16px 20px;">
          <p style="margin:0 0 4px;font-size:12px;font-weight:600;color:#22c55e;text-transform:uppercase;letter-spacing:0.05em;">Document</p>
          <p style="margin:0;font-size:14px;color:#e5e7eb;">${escapeHtml(docLabel)}</p>
        </td>
      </tr>
    </table>

    <p style="margin:0 0 28px;font-size:15px;color:#d1d5db;line-height:1.6;">
      Once all required documents are approved, your account will be fully verified and
      ready to process payments. Log in to your merchant dashboard to check your verification status.
    </p>

    <table cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
      <tr>
        <td style="background:#f97316;border-radius:6px;padding:12px 24px;">
          <a href="https://rasokart.com/merchant/kyc" style="color:#fff;font-size:14px;font-weight:600;text-decoration:none;">
            View KYC Status
          </a>
        </td>
      </tr>
    </table>

    <p style="margin:0;font-size:14px;color:#9ca3af;line-height:1.6;">
      Thank you for completing your verification with RasoKart.
    </p>
  `;

  const html = emailShell("KYC Document Approved", body);

  const sent = await sendMail({
    to,
    subject: `KYC Document Approved — ${docLabel}`,
    html,
  });

  if (!sent) {
    logger.warn({ to, businessName, docLabel }, "KYC approved email could not be sent (SMTP not configured or failed)");
  }
}

export async function sendKycDocRejectedEmail(opts: {
  to: string;
  businessName: string;
  docLabel: string;
  reason?: string;
}): Promise<void> {
  const { to, businessName, docLabel, reason } = opts;

  const reasonBox = reason
    ? `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
      <tr>
        <td style="background:#111;border-left:3px solid #f97316;border-radius:6px;padding:16px 20px;">
          <p style="margin:0 0 6px;font-size:12px;font-weight:600;color:#f97316;text-transform:uppercase;letter-spacing:0.05em;">Reason for Rejection</p>
          <p style="margin:0;font-size:14px;color:#e5e7eb;line-height:1.6;">${escapeHtml(reason)}</p>
        </td>
      </tr>
    </table>`
    : `<p style="margin:0 0 28px;font-size:15px;color:#d1d5db;line-height:1.6;">
        Please ensure the document is clear, valid, and matches your business details, then resubmit.
       </p>`;

  const body = `
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:600;color:#f1f1f1;">KYC Document Rejected</h1>
    <p style="margin:0 0 24px;font-size:14px;color:#9ca3af;line-height:1.6;">
      Action required on your verification document.
    </p>

    <p style="margin:0 0 24px;font-size:15px;color:#d1d5db;line-height:1.6;">
      Dear <strong style="color:#fff;">${escapeHtml(businessName)}</strong>,
    </p>

    <p style="margin:0 0 24px;font-size:15px;color:#d1d5db;line-height:1.6;">
      Unfortunately, your <strong style="color:#fff;">${escapeHtml(docLabel)}</strong> document could not be
      <span style="color:#ef4444;">approved</span> at this time.
    </p>

    ${reasonBox}

    <p style="margin:0 0 28px;font-size:15px;color:#d1d5db;line-height:1.6;">
      You can delete the rejected document and resubmit a corrected version from your merchant dashboard.
      If you need assistance, please contact our support team.
    </p>

    <table cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
      <tr>
        <td style="background:#f97316;border-radius:6px;padding:12px 24px;">
          <a href="https://rasokart.com/merchant/kyc" style="color:#fff;font-size:14px;font-weight:600;text-decoration:none;">
            Resubmit Document
          </a>
        </td>
      </tr>
    </table>

    <table cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
      <tr>
        <td style="padding:12px 24px;">
          <a href="mailto:support@rasokart.com" style="color:#f97316;font-size:14px;font-weight:600;text-decoration:none;">
            Contact Support
          </a>
        </td>
      </tr>
    </table>

    <p style="margin:0;font-size:14px;color:#9ca3af;line-height:1.6;">
      We appreciate your patience and look forward to getting your account verified.
    </p>
  `;

  const html = emailShell("KYC Document Rejected", body);

  const sent = await sendMail({
    to,
    subject: `Action Required: KYC Document Rejected — ${docLabel}`,
    html,
  });

  if (!sent) {
    logger.warn({ to, businessName, docLabel }, "KYC rejected email could not be sent (SMTP not configured or failed)");
  }
}

export async function sendKycFullyVerifiedEmail(opts: {
  to: string;
  businessName: string;
}): Promise<void> {
  const { to, businessName } = opts;

  const body = `
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:600;color:#f1f1f1;">
      🎉 Account Fully Verified
    </h1>
    <p style="margin:0 0 24px;font-size:14px;color:#9ca3af;line-height:1.6;">
      Congratulations — your KYC verification is complete.
    </p>

    <p style="margin:0 0 24px;font-size:15px;color:#d1d5db;line-height:1.6;">
      Dear <strong style="color:#fff;">${escapeHtml(businessName)}</strong>,
    </p>

    <p style="margin:0 0 24px;font-size:15px;color:#d1d5db;line-height:1.6;">
      All of your KYC documents have been reviewed and approved. Your RasoKart merchant account is now
      <strong style="color:#22c55e;">fully verified</strong> and ready to accept payments.
    </p>

    <!-- What's unlocked box -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
      <tr>
        <td style="background:#111;border-left:3px solid #22c55e;border-radius:6px;padding:16px 20px;">
          <p style="margin:0 0 10px;font-size:12px;font-weight:600;color:#22c55e;text-transform:uppercase;letter-spacing:0.05em;">What's Unlocked</p>
          <ul style="margin:0;padding:0 0 0 18px;font-size:14px;color:#e5e7eb;line-height:1.8;">
            <li>Accept payments via QR codes and virtual accounts</li>
            <li>Create and share payment links</li>
            <li>Request settlements and withdrawals</li>
            <li>Access full transaction history and reports</li>
          </ul>
        </td>
      </tr>
    </table>

    <p style="margin:0 0 28px;font-size:15px;color:#d1d5db;line-height:1.6;">
      Log in to your merchant dashboard to start using all available features.
    </p>

    <table cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
      <tr>
        <td style="background:#f97316;border-radius:6px;padding:12px 24px;">
          <a href="https://rasokart.com/merchant/dashboard" style="color:#fff;font-size:14px;font-weight:600;text-decoration:none;">
            Go to Dashboard
          </a>
        </td>
      </tr>
    </table>

    <p style="margin:0;font-size:14px;color:#9ca3af;line-height:1.6;">
      Thank you for completing your KYC verification with RasoKart. We're excited to have you on board.
    </p>
  `;

  const html = emailShell("Account Fully Verified", body);

  const sent = await sendMail({
    to,
    subject: "Your RasoKart Account is Now Fully Verified",
    html,
  });

  if (!sent) {
    logger.warn({ to, businessName }, "KYC fully-verified email could not be sent (SMTP not configured or failed)");
  }
}
