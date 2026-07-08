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

function buildDivergenceHtml(opts: {
  repo: string;
  remoteAheadBy: number;
  divergeAction: string;
}): string {
  const { repo, remoteAheadBy, divergeAction } = opts;
  const timestamp = new Date().toISOString();
  const skipped = divergeAction === "alert_only";
  const actionDescription = skipped
    ? "The scheduled push was <strong>skipped</strong> to protect the remote commits. Review and resolve the divergence manually before the next sync."
    : "The scheduled push <strong>proceeded</strong> (force-push), overwriting those remote commits. This was intentional per your sync settings.";
  const headerBg = skipped ? "#78350f" : "#7f1d1d";
  const headerSubColor = skipped ? "#fde68a" : "#fca5a5";
  const badgeColor = skipped ? "#d97706" : "#ef4444";

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; background: #0f0f0f; color: #e5e5e5; margin: 0; padding: 24px;">
  <div style="max-width: 600px; margin: 0 auto; background: #1a1a1a; border-radius: 8px; overflow: hidden; border: 1px solid #2a2a2a;">
    <div style="background: ${headerBg}; padding: 20px 24px;">
      <h1 style="margin: 0; font-size: 20px; color: #fff; letter-spacing: 0.5px;">RasoKart — GitHub Remote Has Diverged</h1>
      <p style="margin: 4px 0 0; color: ${headerSubColor}; font-size: 13px;">The remote branch has commits that are not present locally</p>
    </div>
    <div style="padding: 24px;">
      <p style="margin: 0 0 16px; color: ${badgeColor}; font-size: 14px; font-weight: 600;">
        &#x26A0;&#xFE0F; Remote <strong>${repo}</strong> is ahead by <strong>${remoteAheadBy} commit${remoteAheadBy === 1 ? "" : "s"}</strong> that would be overwritten by a force-push.
      </p>
      <p style="margin: 0 0 20px; color: #a1a1aa; font-size: 13px;">
        Someone pushed directly to GitHub between scheduled sync runs. ${actionDescription}
      </p>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px; width: 40%;">Repository</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; font-weight: 600;">${repo}</td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Remote commits at risk</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; color: ${badgeColor}; font-weight: 600;">${remoteAheadBy}</td>
        </tr>
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Action taken</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; font-weight: 600;">${skipped ? "Push skipped — alert only" : "Force-pushed (push + alert)"}</td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Detected at</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px;">${timestamp}</td>
        </tr>
      </table>

      <p style="margin: 0; color: #71717a; font-size: 12px;">
        To change how the scheduled sync handles diverged history, update the <strong>On diverged remote</strong> setting in Admin Settings → GitHub Sync.
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
 * Sends a divergence warning email to admins who have opted in to GitHub sync failure alerts.
 * Called by the scheduled sync script when the remote branch has commits ahead of local HEAD.
 */
export async function notifyAdminsOfGithubSyncDiverged(opts: {
  repo: string;
  remoteAheadBy: number;
  divergeAction: string;
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
      console.log("GITHUB_SYNC: No admins opted in to sync alert emails — skipping divergence alert");
      return;
    }

    const cfg = getSmtpConfigFromEnv();
    if (!cfg) {
      console.warn(
        "GITHUB_SYNC: SMTP not configured (SMTP_HOST, SMTP_USER, SMTP_PASS required) — skipping divergence alert email",
      );
      return;
    }

    const html = buildDivergenceHtml(opts);
    const subject = opts.divergeAction === "alert_only"
      ? `[RasoKart] ⚠ GitHub Sync Skipped — Remote has ${opts.remoteAheadBy} diverged commit${opts.remoteAheadBy === 1 ? "" : "s"}`
      : `[RasoKart] ⚠ GitHub Sync — Force-pushed over ${opts.remoteAheadBy} remote commit${opts.remoteAheadBy === 1 ? "" : "s"}`;

    const results = await Promise.allSettled(
      admins.map(a => sendMailWithConfig(cfg, { to: a.email, subject, html })),
    );

    const sent = results.filter(r => r.status === "fulfilled" && r.value).length;
    const failed = results.length - sent;
    console.log(
      `GITHUB_SYNC: Divergence alert email dispatched — ${sent} sent, ${failed} failed, remoteAheadBy=${opts.remoteAheadBy}, action=${opts.divergeAction}`,
    );
  } catch (err) {
    console.error("GITHUB_SYNC: Failed to send divergence alert emails:", err);
  }
}

function buildRecoveryHtml(opts: { repo: string; priorStreak: number }): string {
  const { repo, priorStreak } = opts;
  const timestamp = new Date().toISOString();
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; background: #0f0f0f; color: #e5e5e5; margin: 0; padding: 24px;">
  <div style="max-width: 600px; margin: 0 auto; background: #1a1a1a; border-radius: 8px; overflow: hidden; border: 1px solid #2a2a2a;">
    <div style="background: #14532d; padding: 20px 24px;">
      <h1 style="margin: 0; font-size: 20px; color: #fff; letter-spacing: 0.5px;">RasoKart — GitHub Sync Recovered</h1>
      <p style="margin: 4px 0 0; color: #86efac; font-size: 13px;">Automated repository sync is healthy again</p>
    </div>
    <div style="padding: 24px;">
      <p style="margin: 0 0 16px; color: #4ade80; font-size: 14px; font-weight: 600;">
        &#x2705; GitHub sync for <strong>${repo}</strong> succeeded, ending a streak of <strong>${priorStreak} consecutive failures</strong>.
      </p>
      <p style="margin: 0 0 20px; color: #a1a1aa; font-size: 13px;">
        The incident that triggered the repeated-failure alert has been resolved. Repository changes are pushing to GitHub normally again.
      </p>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px; width: 40%;">Repository</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; font-weight: 600;">${repo}</td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Failures Before Recovery</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; color: #4ade80; font-weight: 600;">${priorStreak}</td>
        </tr>
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Recovered At</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px;">${timestamp}</td>
        </tr>
      </table>

      <p style="margin: 0; color: #71717a; font-size: 12px;">
        No action is needed. You will only receive this email after a streak that previously crossed the alert threshold.
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
 * Sends a "sync recovered" email to admins who have opted in, once a sync
 * succeeds after a failure streak that had previously crossed the escalation
 * threshold. Callers are responsible for only calling this when the prior
 * streak (before the successful run) crossed FAILURE_ESCALATION_THRESHOLD —
 * isolated single-failure incidents that never escalated should not trigger this.
 */
export async function notifyAdminsOfGithubSyncRecovered(opts: {
  repo: string;
  priorStreak: number;
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
      console.log("GITHUB_SYNC: No admins opted in to repeated-failure alert emails — skipping recovery email");
      return;
    }

    const cfg = getSmtpConfigFromEnv();
    if (!cfg) {
      console.warn(
        "GITHUB_SYNC: SMTP not configured (SMTP_HOST, SMTP_USER, SMTP_PASS required) — skipping recovery email",
      );
      return;
    }

    const html = buildRecoveryHtml(opts);
    const subject = `[RasoKart] ✅ GitHub Sync Recovered — after ${opts.priorStreak} consecutive failures`;

    const results = await Promise.allSettled(
      admins.map(a => sendMailWithConfig(cfg, { to: a.email, subject, html })),
    );

    const sent = results.filter(r => r.status === "fulfilled" && r.value).length;
    const failed = results.length - sent;
    console.log(
      `GITHUB_SYNC: Recovery email dispatched — ${sent} sent, ${failed} failed, priorStreak=${opts.priorStreak}`,
    );
  } catch (err) {
    console.error("GITHUB_SYNC: Failed to send recovery emails:", err);
  }
}
