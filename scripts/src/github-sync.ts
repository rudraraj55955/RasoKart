import { execSync } from "child_process";
import { writeFileSync, readFileSync, mkdirSync, unlinkSync } from "fs";
import { randomUUID } from "crypto";
import { sendAdminAlert } from "./mailer.js";
import { notifyAdminsOfGithubSyncFailing, notifyAdminsOfGithubSyncRecovered, notifyAdminsOfGithubSyncDiverged } from "./githubSyncAlertEmail.js";
import { db, systemSettingsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

const GITHUB_REPO =
  process.env["GITHUB_REPO"] ?? "rudraraj55955/RPAY";
const REMOTE_NAME = "github";
const STATUS_FILE = new URL("../../.github-sync-status.json", import.meta.url).pathname;
const HISTORY_FILE = new URL("../../.github-sync-history.json", import.meta.url).pathname;
const LOG_DIR = new URL("../../.github-sync-logs/", import.meta.url).pathname;
const HISTORY_MAX = 50;

// Defaults used when the admin has not configured github_sync_failure_threshold /
// github_sync_renotify_interval in systemSettingsTable. These are read from the DB in
// readSyncConfig() so the escalation email fires at the same point as the admin dashboard banner.
const DEFAULT_FAILURE_ESCALATION_THRESHOLD = 3;
const DEFAULT_FAILURE_ESCALATION_RENOTIFY_INTERVAL = 10;

interface GithubSyncHistoryEntry {
  id: string;
  status: "success" | "failure";
  syncedAt: string;
  repo: string;
  errorMessage?: string;
  hasLog?: boolean;
  retryOf?: string;
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

function ensureLogDir() {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
  } catch {
  }
}

function writeLogFile(id: string, content: string): boolean {
  try {
    ensureLogDir();
    writeFileSync(`${LOG_DIR}${id}.log`, content, "utf-8");
    return true;
  } catch {
    return false;
  }
}

function writeStatus(status: "success" | "failure", id: string, logLines: string[], errorMessage?: string, retryOf?: string) {
  const syncedAt = new Date().toISOString();
  const payload: Record<string, string> = {
    id,
    status,
    syncedAt,
    repo: GITHUB_REPO,
  };
  if (errorMessage) {
    payload["errorMessage"] = errorMessage;
  }
  if (retryOf) {
    payload["retryOf"] = retryOf;
  }
  try {
    writeFileSync(STATUS_FILE, JSON.stringify(payload, null, 2), "utf-8");
  } catch {
  }
  const hasLog = logLines.length > 0 && writeLogFile(id, logLines.join("\n"));
  appendHistory({ id, status, syncedAt, repo: GITHUB_REPO, errorMessage, hasLog, retryOf });
}

function appendHistory(entry: GithubSyncHistoryEntry) {
  try {
    let history: typeof entry[] = [];
    try {
      const raw = readFileSync(HISTORY_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) history = parsed;
    } catch {
    }
    history.unshift(entry);
    let removed: typeof entry[] = [];
    if (history.length > HISTORY_MAX) {
      removed = history.slice(HISTORY_MAX);
      history = history.slice(0, HISTORY_MAX);
    }
    writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), "utf-8");
    for (const old of removed) {
      if (old.hasLog && old.id) {
        try {
          unlinkSync(`${LOG_DIR}${old.id}.log`);
        } catch {
        }
      }
    }
  } catch {
  }
}

async function readSyncConfig(): Promise<{
  enabled: boolean;
  schedule: string;
  failureThreshold: number;
  renotifyInterval: number;
  divergeAction: "alert_only" | "alert_and_push";
}> {
  try {
    const rows = await db
      .select()
      .from(systemSettingsTable)
      .where(
        inArray(systemSettingsTable.key, [
          "github_sync_enabled",
          "github_sync_schedule",
          "github_sync_failure_threshold",
          "github_sync_renotify_interval",
          "github_sync_diverge_action",
        ]),
      );
    const map = Object.fromEntries(rows.map(r => [r.key, r.value]));
    const rawEnabled = map["github_sync_enabled"];
    const enabled = rawEnabled === null || rawEnabled === undefined ? true : rawEnabled === "true";
    const schedule = map["github_sync_schedule"] ?? "0 2 * * *";
    const parsedThreshold = parseInt(map["github_sync_failure_threshold"] ?? "", 10);
    const failureThreshold = Number.isFinite(parsedThreshold) && parsedThreshold > 0 ? parsedThreshold : DEFAULT_FAILURE_ESCALATION_THRESHOLD;
    const parsedInterval = parseInt(map["github_sync_renotify_interval"] ?? "", 10);
    const renotifyInterval = Number.isFinite(parsedInterval) && parsedInterval > 0 ? parsedInterval : DEFAULT_FAILURE_ESCALATION_RENOTIFY_INTERVAL;
    const rawDivergeAction = map["github_sync_diverge_action"];
    const divergeAction: "alert_only" | "alert_and_push" = rawDivergeAction === "alert_and_push" ? "alert_and_push" : "alert_only";
    return { enabled, schedule, failureThreshold, renotifyInterval, divergeAction };
  } catch (err) {
    console.warn("GITHUB_SYNC: Could not read sync config from DB — assuming enabled, default schedule and thresholds:", err);
    return {
      enabled: true,
      schedule: "0 2 * * *",
      failureThreshold: DEFAULT_FAILURE_ESCALATION_THRESHOLD,
      renotifyInterval: DEFAULT_FAILURE_ESCALATION_RENOTIFY_INTERVAL,
      divergeAction: "alert_only",
    };
  }
}

async function main() {
  // GITHUB_SYNC_FORCE=true bypasses schedule and enabled checks (for manual or test runs)
  const force = process.env["GITHUB_SYNC_FORCE"] === "true";
  // GITHUB_SYNC_RETRY_OF=<id> tags this run as a retry of a specific failed run
  const retryOf = process.env["GITHUB_SYNC_RETRY_OF"] ?? undefined;

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

  const runId = randomUUID();
  const logLines: string[] = [];
  const redact = (text: string) => text.split(token).join("<REDACTED>");
  const log = (line: string) => {
    console.log(line);
    logLines.push(redact(line));
  };
  const runCaptured = (cmd: string) => {
    try {
      const out = execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] }).toString();
      if (out.trim()) {
        console.log(out);
        logLines.push(redact(out.trimEnd()));
      }
      return out;
    } catch (err: unknown) {
      const stdout = (err as { stdout?: Buffer })?.stdout?.toString() ?? "";
      const stderr = (err as { stderr?: Buffer })?.stderr?.toString() ?? "";
      if (stdout.trim()) logLines.push(redact(stdout.trimEnd()));
      if (stderr.trim()) logLines.push(redact(stderr.trimEnd()));
      throw err;
    }
  };

  try {
    log(`GITHUB_SYNC: Pushing to ${GITHUB_REPO}...`);

    // Divergence check — run fetch first, then count remote-only commits
    let fetchSucceeded = false;
    try {
      runCaptured(`git fetch ${REMOTE_NAME} main`);
      fetchSucceeded = true;
    } catch (fetchErr: unknown) {
      const fetchMessage = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      logLines.push(redact(`git fetch warning: ${fetchMessage}`));
    }

    if (fetchSucceeded) {
      let remoteAheadBy = 0;
      try {
        const out = execSync(`git rev-list --count HEAD..${REMOTE_NAME}/main`, { stdio: "pipe" }).toString().trim();
        remoteAheadBy = parseInt(out, 10) || 0;
      } catch {
        // Remote branch doesn't exist yet — first push, no divergence possible
        remoteAheadBy = 0;
      }

      if (remoteAheadBy > 0) {
        log(`GITHUB_SYNC: Remote is ahead by ${remoteAheadBy} commit(s) — history would be overwritten. divergeAction=${config.divergeAction}`);

        // Always send the alert email regardless of divergeAction
        await notifyAdminsOfGithubSyncDiverged({
          repo: GITHUB_REPO,
          remoteAheadBy,
          divergeAction: config.divergeAction,
        });

        if (config.divergeAction === "alert_only") {
          // Skip the push — record as a successful (skipped) run so it doesn't count as a failure
          log("GITHUB_SYNC: Push skipped to protect remote history. Admins have been alerted.");
          writeStatus("success", runId, logLines, undefined, retryOf);
          return;
        }

        // divergeAction === "alert_and_push" — proceed with force-push after alerting
        log("GITHUB_SYNC: Proceeding with force-push per divergeAction=alert_and_push setting.");
      }
    }

    runCaptured(`git push ${REMOTE_NAME} HEAD:main --force`);
    log("GITHUB_SYNC: Sync complete.");

    // Capture the failure streak that preceded this success BEFORE writeStatus
    // appends the new "success" entry (which would reset countConsecutiveFailures to 0).
    const priorStreak = countConsecutiveFailures();
    writeStatus("success", runId, logLines, undefined, retryOf);

    if (priorStreak >= config.failureThreshold) {
      await notifyAdminsOfGithubSyncRecovered({
        repo: GITHUB_REPO,
        priorStreak,
      });
    }
  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? err.message.replace(token, "<REDACTED>")
        : String(err).replace(token, "<REDACTED>");
    writeStatus("failure", runId, logLines, message, retryOf);
    const pushError = new Error(`Push failed — ${message}`);

    await sendAdminAlert({
      subject: `[RasoKart] ⚠ GitHub Sync Failed — Push error`,
      html: buildFailureHtml("Push failed", message),
    });

    const streak = countConsecutiveFailures();
    const crossedThreshold = streak === config.failureThreshold;
    const onRenotifyCadence =
      streak > config.failureThreshold &&
      (streak - config.failureThreshold) % config.renotifyInterval === 0;
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
