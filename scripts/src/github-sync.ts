import { execSync } from "child_process";
import { writeFileSync, readFileSync } from "fs";
import { sendAdminAlert } from "./mailer.js";
import { notifyAdminsOfGithubSyncFailing } from "./githubSyncAlertEmail.js";
import { db, systemSettingsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

const GITHUB_REPO =
  process.env["GITHUB_REPO"] ?? "rudraraj55955/RPAY";
const REMOTE_NAME = "github";
const STATUS_FILE = new URL("../../.github-sync-status.json", import.meta.url).pathname;
const HISTORY_FILE = new URL("../../.github-sync-history.json", import.meta.url).pathname;
const HISTORY_MAX = 50;

// Mirrors the dashboard's GITHUB_SYNC_FAILURE_THRESHOLD (artifacts/api-server/src/routes/dashboard.ts)
// so the escalation email fires at the same point the admin dashboard banner appears.
const FAILURE_ESCALATION_THRESHOLD = 3;
// Once escalated, don't re-notify on every subsequent failure — only every N failures beyond the threshold.
const FAILURE_ESCALATION_RENOTIFY_INTERVAL = 10;

interface GithubSyncHistoryEntry {
  status: "success" | "failure";
  syncedAt: string;
  repo: string;
  errorMessage?: string;
}

function countConsecutiveFailures(): number {
  try {
    const raw = readFileSync(HISTORY_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return 0;

    let streak = 0;
    for (const entry of parsed as GithubSyncHistoryEntry[]) {
      if (entry?.status !== "failure") break;
      streak++;
    }
    return streak;
  } catch {
    return 0;
  }
}

function run(cmd: string, opts: { stdio?: "pipe" | "inherit" } = {}) {
  return execSync(cmd, { stdio: opts.stdio ?? "pipe" });
}

function resetRemote() {
  try {
    run(
      `git remote set-url ${REMOTE_NAME} https://github.com/${GITHUB_REPO}.git`,
    );
  } catch {
  }
}

/**
 * Match a single cron field value against the given integer.
 * Handles: *, n, n-m (range), *\/n (step), comma-lists.
 */
function matchCronField(field: string, value: number): boolean {
  if (field === "*") return true;

  // comma list — match any element
  if (field.includes(",")) {
    return field.split(",").some((f) => matchCronField(f.trim(), value));
  }

  // step: */n or base/n
  if (field.includes("/")) {
    const [base, stepStr] = field.split("/");
    const step = parseInt(stepStr, 10);
    if (isNaN(step) || step <= 0) return false;
    if (base === "*" || base === "") return value % step === 0;
    const start = parseInt(base, 10);
    if (isNaN(start)) return false;
    return value >= start && (value - start) % step === 0;
  }

  // range: n-m
  if (field.includes("-")) {
    const [s, e] = field.split("-").map(Number);
    if (isNaN(s) || isNaN(e)) return false;
    return value >= s && value <= e;
  }

  // exact number
  const num = parseInt(field, 10);
  return !isNaN(num) && num === value;
}

/**
 * Returns true when the given Date's UTC time matches the 5-part cron expression.
 * Fields: minute hour day-of-month month day-of-week (0=Sun).
 */
function cronMatchesNow(expression: string, now: Date = new Date()): boolean {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const [minP, hrP, domP, monP, dowP] = parts;
  return (
    matchCronField(minP, now.getUTCMinutes()) &&
    matchCronField(hrP, now.getUTCHours()) &&
    matchCronField(domP, now.getUTCDate()) &&
    matchCronField(monP, now.getUTCMonth() + 1) &&
    matchCronField(dowP, now.getUTCDay())
  );
}

function buildFailureHtml(reason: string, detail: string): string {
  const timestamp = new Date().toISOString();
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; background: #0f0f0f; color: #e5e5e5; margin: 0; padding: 24px;">
  <div style="max-width: 600px; margin: 0 auto; background: #1a1a1a; border-radius: 8px; overflow: hidden; border: 1px solid #2a2a2a;">
    <div style="background: #7f1d1d; padding: 20px 24px;">
      <h1 style="margin: 0; font-size: 20px; color: #fff; letter-spacing: 0.5px;">RasoKart — GitHub Sync Failed</h1>
      <p style="margin: 4px 0 0; color: #fca5a5; font-size: 13px;">Automated repository sync encountered an error</p>
    </div>
    <div style="padding: 24px;">
      <p style="margin: 0 0 16px; color: #f87171; font-size: 14px; font-weight: 600;">
        &#x26A0;&#xFE0F; GitHub sync failed for <strong>${GITHUB_REPO}</strong>
      </p>
      <p style="margin: 0 0 20px; color: #a1a1aa; font-size: 13px;">
        The automated push to GitHub did not complete. Please check the repository configuration and credentials.
      </p>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px; width: 40%;">Repository</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; font-weight: 600;">${GITHUB_REPO}</td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Reason</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; color: #f87171; font-weight: 600;">${reason}</td>
        </tr>
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px; vertical-align: top;">Error Detail</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 12px; color: #d1d5db; font-family: monospace; word-break: break-all;">${detail}</td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Timestamp</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px;">${timestamp}</td>
        </tr>
      </table>

      <p style="margin: 0; color: #71717a; font-size: 12px;">
        Check the GITHUB_TOKEN secret in the Replit environment and verify the repository permissions.
      </p>
    </div>
    <div style="padding: 14px 24px; background: #111; border-top: 1px solid #2a2a2a;">
      <p style="margin: 0; color: #52525b; font-size: 11px;">
        This alert was sent automatically by the RasoKart GitHub sync script.
      </p>
    </div>
  </div>
</body>
</html>`;
}

function writeStatus(status: "success" | "failure", errorMessage?: string) {
  const syncedAt = new Date().toISOString();
  const payload: Record<string, string> = {
    status,
    syncedAt,
    repo: GITHUB_REPO,
  };
  if (errorMessage) {
    payload["errorMessage"] = errorMessage;
  }
  try {
    writeFileSync(STATUS_FILE, JSON.stringify(payload, null, 2), "utf-8");
  } catch {
  }
  appendHistory({ status, syncedAt, repo: GITHUB_REPO, errorMessage });
}

function appendHistory(entry: { status: "success" | "failure"; syncedAt: string; repo: string; errorMessage?: string }) {
  try {
    let history: typeof entry[] = [];
    try {
      const raw = readFileSync(HISTORY_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) history = parsed;
    } catch {
    }
    history.unshift(entry);
    if (history.length > HISTORY_MAX) history = history.slice(0, HISTORY_MAX);
    writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), "utf-8");
  } catch {
  }
}

async function readSyncConfig(): Promise<{ enabled: boolean; schedule: string }> {
  try {
    const rows = await db
      .select()
      .from(systemSettingsTable)
      .where(inArray(systemSettingsTable.key, ["github_sync_enabled", "github_sync_schedule"]));
    const map = Object.fromEntries(rows.map(r => [r.key, r.value]));
    const rawEnabled = map["github_sync_enabled"];
    const enabled = rawEnabled === null || rawEnabled === undefined ? true : rawEnabled === "true";
    const schedule = map["github_sync_schedule"] ?? "0 2 * * *";
    return { enabled, schedule };
  } catch (err) {
    console.warn("GITHUB_SYNC: Could not read sync config from DB — assuming enabled, default schedule:", err);
    return { enabled: true, schedule: "0 2 * * *" };
  }
}

async function main() {
  // GITHUB_SYNC_FORCE=true bypasses schedule and enabled checks (for manual or test runs)
  const force = process.env["GITHUB_SYNC_FORCE"] === "true";

  const config = await readSyncConfig();

  if (!force && !config.enabled) {
    console.log("GITHUB_SYNC: Sync is disabled in admin settings — skipping. Set GITHUB_SYNC_FORCE=true to override.");
    return;
  }

  if (!force && !cronMatchesNow(config.schedule)) {
    console.log(
      `GITHUB_SYNC: Current time does not match schedule "${config.schedule}" — skipping. Set GITHUB_SYNC_FORCE=true to run immediately.`,
    );
    return;
  }

  if (force) {
    console.log("GITHUB_SYNC: Force flag set — bypassing schedule and enabled checks.");
  } else {
    console.log(`GITHUB_SYNC: Schedule "${config.schedule}" matched — proceeding with sync.`);
  }

  const token = process.env["GITHUB_TOKEN"];

  if (!token) {
    const reason = "Missing GITHUB_TOKEN";
    const detail = "The GITHUB_TOKEN secret is not set in the environment. The sync was skipped.";
    console.warn(`GITHUB_SYNC: Skipping — ${reason}`);
    await sendAdminAlert({
      subject: `[RasoKart] ⚠ GitHub Sync Failed — ${reason}`,
      html: buildFailureHtml(reason, detail),
    });
    return;
  }

  const remoteUrl = `https://x-access-token:${token}@github.com/${GITHUB_REPO}.git`;

  try {
    run(`git remote get-url ${REMOTE_NAME}`);
    run(`git remote set-url ${REMOTE_NAME} ${remoteUrl}`);
  } catch {
    run(`git remote add ${REMOTE_NAME} ${remoteUrl}`);
  }

  try {
    console.log(`GITHUB_SYNC: Pushing to ${GITHUB_REPO}...`);
    try {
      run(`git fetch ${REMOTE_NAME} main`, { stdio: "inherit" });
    } catch {
    }
    run(`git push ${REMOTE_NAME} HEAD:main --force`, { stdio: "inherit" });
    console.log("GITHUB_SYNC: Sync complete.");
    writeStatus("success");
  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? err.message.replace(token, "<REDACTED>")
        : String(err).replace(token, "<REDACTED>");
    writeStatus("failure", message);
    const pushError = new Error(`Push failed — ${message}`);

    await sendAdminAlert({
      subject: `[RasoKart] ⚠ GitHub Sync Failed — Push error`,
      html: buildFailureHtml("Push failed", message),
    });

    const streak = countConsecutiveFailures();
    const crossedThreshold = streak === FAILURE_ESCALATION_THRESHOLD;
    const onRenotifyCadence =
      streak > FAILURE_ESCALATION_THRESHOLD &&
      (streak - FAILURE_ESCALATION_THRESHOLD) % FAILURE_ESCALATION_RENOTIFY_INTERVAL === 0;
    if (crossedThreshold || onRenotifyCadence) {
      await notifyAdminsOfGithubSyncFailing({
        repo: GITHUB_REPO,
        streak,
        lastErrorMessage: message,
      });
    }

    throw pushError;
  } finally {
    resetRemote();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`GITHUB_SYNC: ${message}`);
    process.exit(1);
  });
