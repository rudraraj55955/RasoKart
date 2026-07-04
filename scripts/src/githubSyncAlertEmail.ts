import { db, usersTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { getSmtpConfigFromEnv, sendMailWithConfig } from "@workspace/mailer";

function buildEscalationHtml(opts: {
  repo: string;
  streak: number;
  lastErrorMessage?: string;
}): string {
  const { repo, streak, lastErrorMessage } = opts;
  const timestamp = new Date().toISOString();
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; background: #0f0f0f; color: #e5e5e5; margin: 0; padding: 24px;">
  <div style="max-width: 600px; margin: 0 auto; background: #1a1a1a; border-radius: 8px; overflow: hidden; border: 1px solid #2a2a2a;">
    <div style="background: #7f1d1d; padding: 20px 24px;">
      <h1 style="margin: 0; font-size: 20px; color: #fff; letter-spacing: 0.5px;">RasoKart — GitHub Sync Repeatedly Failing</h1>
      <p style="margin: 4px 0 0; color: #fca5a5; font-size: 13px;">Automated repository sync has failed ${streak} times in a row</p>
    </div>
    <div style="padding: 24px;">
      <p style="margin: 0 0 16px; color: #f87171; font-size: 14px; font-weight: 600;">
        &#x1F534; GitHub sync for <strong>${repo}</strong> has now failed <strong>${streak} consecutive times</strong>.
      </p>
      <p style="margin: 0 0 20px; color: #a1a1aa; font-size: 13px;">
        This crosses the alert threshold used on the admin dashboard banner. Repository changes are not being pushed to GitHub. Please check the repository configuration and credentials as soon as possible.
      </p>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px; width: 40%;">Repository</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; font-weight: 600;">${repo}</td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Consecutive Failures</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; color: #f87171; font-weight: 600;">${streak}</td>
        </tr>
        ${lastErrorMessage ? `
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px; vertical-align: top;">Last Error</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 12px; color: #d1d5db; font-family: monospace; word-break: break-all;">${lastErrorMessage}</td>
        </tr>` : ""}
        <tr>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Timestamp</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px;">${timestamp}</td>
        </tr>
      </table>

      <p style="margin: 0; color: #71717a; font-size: 12px;">
        Check the GITHUB_TOKEN secret in the Replit environment and verify the repository permissions. You will not be re-notified for every subsequent failure in this streak.
      </p>
    </div>
    <div style="padding: 14px 24px; background: #111; border-top: 1px solid #2a2a2a;">
      <p style="margin: 0; color: #52525b; font-size: 11px;">
        This alert was sent automatically by the RasoKart GitHub sync script. To stop receiving these emails, update your notification preferences in Admin Settings.
      </p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Sends an escalated "repeated failure" email to admins who have opted in.
 * Callers are responsible for deciding *when* to call this (e.g. only when the
 * consecutive-failure streak first crosses the threshold, or on a re-notify
 * cadence) so admins are not spammed on every single failure.
 */
export async function notifyAdminsOfGithubSyncFailing(opts: {
  repo: string;
  streak: number;
  lastErrorMessage?: string;
}): Promise<void> {
  try {
    const admins = await db
      .select({ email: usersTable.email })
      .from(usersTable)
      .where(
        and(
          eq(usersTable.role, "admin"),
          eq(usersTable.isActive, true),
          eq(usersTable.githubSyncFailureAlertEmails, true),
        ),
      );

    if (admins.length === 0) {
      console.log("GITHUB_SYNC: No admins opted in to repeated-failure alert emails — skipping escalation");
      return;
    }

    const cfg = getSmtpConfigFromEnv();
    if (!cfg) {
      console.warn(
        "GITHUB_SYNC: SMTP not configured (SMTP_HOST, SMTP_USER, SMTP_PASS required) — skipping escalation email",
      );
      return;
    }

    const html = buildEscalationHtml(opts);
    const subject = `[RasoKart] 🔴 GitHub Sync Failing Repeatedly — ${opts.streak} failures in a row`;

    const results = await Promise.allSettled(
      admins.map(a => sendMailWithConfig(cfg, { to: a.email, subject, html })),
    );

    const sent = results.filter(r => r.status === "fulfilled" && r.value).length;
    const failed = results.length - sent;
    console.log(
      `GITHUB_SYNC: Repeated-failure escalation email dispatched — ${sent} sent, ${failed} failed, streak=${opts.streak}`,
    );
  } catch (err) {
    console.error("GITHUB_SYNC: Failed to send repeated-failure escalation emails:", err);
  }
}
