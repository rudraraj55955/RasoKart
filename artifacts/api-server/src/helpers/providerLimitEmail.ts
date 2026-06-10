import { sendMail } from "./mailer";
import { logger } from "../lib/logger";

function appDomain(): string {
  return process.env["APP_DOMAIN"] ?? "https://rasokart.com";
}

function buildWarningHtml(
  merchantName: string,
  provider: string,
  usedFmt: string,
  limitFmt: string,
  pctStr: number,
): string {
  const dashboardUrl = `${appDomain()}/merchant/dashboard`;
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; background: #0f0f0f; color: #e5e5e5; margin: 0; padding: 24px;">
  <div style="max-width: 600px; margin: 0 auto; background: #1a1a1a; border-radius: 8px; overflow: hidden; border: 1px solid #2a2a2a;">
    <div style="background: #b45309; padding: 20px 24px;">
      <h1 style="margin: 0; font-size: 20px; color: #fff; letter-spacing: 0.5px;">RasoKart — Provider Limit Warning</h1>
      <p style="margin: 4px 0 0; color: #fde68a; font-size: 13px;">${provider} · ${pctStr}% of monthly limit used</p>
    </div>
    <div style="padding: 24px;">
      <p style="margin: 0 0 16px; color: #fbbf24; font-size: 14px; font-weight: 600;">
        ⚠️ You are approaching your monthly limit for ${provider}.
      </p>
      <p style="margin: 0 0 20px; color: #a1a1aa; font-size: 14px;">
        Hello ${merchantName}, your <strong style="color: #e5e5e5;">${provider}</strong> provider has used
        <strong style="color: #e5e5e5;">₹${usedFmt}</strong> out of your
        <strong style="color: #e5e5e5;">₹${limitFmt}</strong> monthly limit (${pctStr}%).
      </p>
      <p style="margin: 0 0 20px; color: #a1a1aa; font-size: 13px;">
        If this limit is fully reached, new payments via ${provider} may be rejected for the remainder of the month.
        Consider upgrading your plan or managing incoming transactions to stay within your limit.
      </p>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px; width: 50%;">Provider</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; font-weight: 600;">${provider}</td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Used This Month</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; color: #fbbf24; font-weight: 600;">₹${usedFmt} (${pctStr}%)</td>
        </tr>
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Monthly Limit</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px;">₹${limitFmt}</td>
        </tr>
      </table>

      <div style="text-align: center; margin-bottom: 20px;">
        <a href="${dashboardUrl}"
           style="display: inline-block; background: #7c3aed; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-size: 14px; font-weight: 600; letter-spacing: 0.3px;">
          View Dashboard
        </a>
      </div>
    </div>
    <div style="padding: 14px 24px; background: #111; border-top: 1px solid #2a2a2a;">
      <p style="margin: 0; color: #52525b; font-size: 11px;">
        This alert was sent because your ${provider} usage crossed 80% of your monthly limit.
        You will receive one more alert if the limit is fully reached.
      </p>
    </div>
  </div>
</body>
</html>`;
}

function buildReachedHtml(
  merchantName: string,
  provider: string,
  usedFmt: string,
  limitFmt: string,
): string {
  const dashboardUrl = `${appDomain()}/merchant/dashboard`;
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; background: #0f0f0f; color: #e5e5e5; margin: 0; padding: 24px;">
  <div style="max-width: 600px; margin: 0 auto; background: #1a1a1a; border-radius: 8px; overflow: hidden; border: 1px solid #2a2a2a;">
    <div style="background: #991b1b; padding: 20px 24px;">
      <h1 style="margin: 0; font-size: 20px; color: #fff; letter-spacing: 0.5px;">RasoKart — Provider Limit Reached</h1>
      <p style="margin: 4px 0 0; color: #fecaca; font-size: 13px;">${provider} · Monthly limit fully reached</p>
    </div>
    <div style="padding: 24px;">
      <p style="margin: 0 0 16px; color: #f87171; font-size: 14px; font-weight: 600;">
        🚫 Your monthly limit for ${provider} has been reached.
      </p>
      <p style="margin: 0 0 20px; color: #a1a1aa; font-size: 14px;">
        Hello ${merchantName}, your <strong style="color: #e5e5e5;">${provider}</strong> provider has used
        <strong style="color: #e5e5e5;">₹${usedFmt}</strong> — the full <strong style="color: #e5e5e5;">₹${limitFmt}</strong> monthly limit.
      </p>
      <p style="margin: 0 0 20px; color: #a1a1aa; font-size: 13px;">
        New payments via ${provider} may be rejected until the limit resets at the start of next month.
        Please contact your account manager or upgrade your plan if you require a higher monthly limit.
      </p>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px; width: 50%;">Provider</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; font-weight: 600;">${provider}</td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Used This Month</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; color: #f87171; font-weight: 600;">₹${usedFmt} (100%)</td>
        </tr>
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Monthly Limit</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px;">₹${limitFmt}</td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Limit Resets</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px;">1st of next month</td>
        </tr>
      </table>

      <div style="text-align: center; margin-bottom: 20px;">
        <a href="${dashboardUrl}"
           style="display: inline-block; background: #7c3aed; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-size: 14px; font-weight: 600; letter-spacing: 0.3px;">
          View Dashboard
        </a>
      </div>
    </div>
    <div style="padding: 14px 24px; background: #111; border-top: 1px solid #2a2a2a;">
      <p style="margin: 0; color: #52525b; font-size: 11px;">
        This alert was sent because your ${provider} monthly limit has been reached.
        You will receive a reset notification when the limit clears at the start of next month.
      </p>
    </div>
  </div>
</body>
</html>`;
}

export interface ProviderLimitEmailOpts {
  to: string;
  merchantName: string;
  provider: string;
  type: "provider_limit_warning" | "provider_limit_reached";
  monthlyUsed: number;
  monthlyLimit: number;
  pctStr: number;
}

export async function sendProviderLimitEmail(opts: ProviderLimitEmailOpts): Promise<boolean> {
  const usedFmt = Math.round(opts.monthlyUsed).toLocaleString("en-IN");
  const limitFmt = Math.round(opts.monthlyLimit).toLocaleString("en-IN");

  const { subject, html } =
    opts.type === "provider_limit_warning"
      ? {
          subject: `[RasoKart] ⚠️ ${opts.provider} limit at ${opts.pctStr}% — Action needed`,
          html: buildWarningHtml(opts.merchantName, opts.provider, usedFmt, limitFmt, opts.pctStr),
        }
      : {
          subject: `[RasoKart] 🚫 ${opts.provider} monthly limit reached`,
          html: buildReachedHtml(opts.merchantName, opts.provider, usedFmt, limitFmt),
        };

  const sent = await sendMail({ to: opts.to, subject, html });

  if (sent) {
    logger.info(
      { to: opts.to, provider: opts.provider, type: opts.type },
      "Provider limit alert email sent"
    );
  }

  return sent;
}
