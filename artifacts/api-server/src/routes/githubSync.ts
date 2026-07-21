import { Router } from "express";
import { readFileSync, writeFileSync } from "fs";
import { spawn, execSync } from "child_process";
import { logger } from "../lib/logger";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { db, systemSettingsTable, auditLogsTable, usersTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { runGithubSyncLogCleanup, getLastGithubSyncLogCleanupResult, CLEANUP_ALERT_SNOOZE_KEY, readFailureStreak, getCleanupFailureThreshold, CLEANUP_FAILURE_THRESHOLD_KEY } from "../helpers/githubSyncLogCleanupScheduler";
import { sendMail } from "../helpers/mailer";

const router = Router();
router.use(requireAuth);
router.use(requireAdmin);

const STATUS_FILE = new URL("../../../.github-sync-status.json", import.meta.url).pathname;
const HISTORY_FILE = new URL("../../../.github-sync-history.json", import.meta.url).pathname;
const LOG_DIR = new URL("../../../.github-sync-logs/", import.meta.url).pathname;
const REPO_ROOT = new URL("../../../", import.meta.url).pathname;

const GITHUB_SYNC_KEYS = [
  "github_sync_enabled",
  "github_sync_schedule",
  "github_sync_failure_threshold",
  "github_sync_renotify_interval",
  "github_sync_diverge_action",
  "github_sync_cleanup_failure_threshold",
] as const;
const REMOTE_NAME = "github";
const GITHUB_REPO = process.env["GITHUB_REPO"] ?? "rudraraj55955/RPAY";
const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_RENOTIFY_INTERVAL = 10;
const DEFAULT_DIVERGE_ACTION = "alert_only";

const DIVERGENCE_STATE_FILE = new URL("../../../.github-sync-divergence-state.json", import.meta.url).pathname;

interface DivergenceState {
  diverged: boolean;
  consecutivePollsDiverged: number;
  firstDetectedAt: string | null;
  lastEmailSentPollCount: number;
}

let divergenceCheckInFlight = false;

function readDivergenceState(): DivergenceState {
  try {
    const raw = readFileSync(DIVERGENCE_STATE_FILE, "utf-8");
    return JSON.parse(raw) as DivergenceState;
  } catch {
    return { diverged: false, consecutivePollsDiverged: 0, firstDetectedAt: null, lastEmailSentPollCount: 0 };
  }
}

function writeDivergenceState(state: DivergenceState): void {
  try {
    writeFileSync(DIVERGENCE_STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
  } catch (err) {
    logger.warn({ err }, "GITHUB_SYNC: Could not write divergence state file — divergence emails may repeat until the file is writable");
  }
}

function buildDivergenceAlertHtml(opts: { repo: string; remoteAheadBy: number; firstDetectedAt: string }): string {
  const { repo, remoteAheadBy, firstDetectedAt } = opts;
  const timestamp = new Date().toISOString();
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; background: #0f0f0f; color: #e5e5e5; margin: 0; padding: 24px;">
  <div style="max-width: 600px; margin: 0 auto; background: #1a1a1a; border-radius: 8px; overflow: hidden; border: 1px solid #2a2a2a;">
    <div style="background: #78350f; padding: 20px 24px;">
      <h1 style="margin: 0; font-size: 20px; color: #fff; letter-spacing: 0.5px;">RasoKart — GitHub Remote Has Diverged</h1>
      <p style="margin: 4px 0 0; color: #fde68a; font-size: 13px;">The remote branch has commits that are not present locally</p>
    </div>
    <div style="padding: 24px;">
      <p style="margin: 0 0 16px; color: #d97706; font-size: 14px; font-weight: 600;">
        &#x26A0;&#xFE0F; Remote <strong>${repo}</strong> is ahead by <strong>${remoteAheadBy} commit${remoteAheadBy === 1 ? "" : "s"}</strong> that would be overwritten by the next scheduled push.
      </p>
      <p style="margin: 0 0 20px; color: #a1a1aa; font-size: 13px;">
        Someone pushed directly to GitHub between scheduled sync runs. No action has been taken yet — this alert is sent the moment divergence is first detected by the admin dashboard poll. Review and resolve the divergence before the next scheduled sync.
      </p>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px; width: 40%;">Repository</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; font-weight: 600;">${repo}</td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Remote commits ahead</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; color: #d97706; font-weight: 600;">${remoteAheadBy}</td>
        </tr>
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">First detected</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px;">${firstDetectedAt}</td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Alert sent at</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px;">${timestamp}</td>
        </tr>
      </table>

      <p style="margin: 0; color: #71717a; font-size: 12px;">
        To change how the scheduled sync handles diverged history, update the <strong>On diverged remote</strong> setting in Admin Settings → GitHub Sync.
      </p>
    </div>
    <div style="padding: 14px 24px; background: #111; border-top: 1px solid #2a2a2a;">
      <p style="margin: 0; color: #52525b; font-size: 11px;">
        This alert was sent automatically by RasoKart when the admin dashboard detected remote divergence. To stop receiving these emails, update your notification preferences in Admin Settings.
      </p>
    </div>
  </div>
</body>
</html>`;
}

function buildDivergenceResolvedHtml(opts: { repo: string; priorPollCount: number; firstDetectedAt: string }): string {
  const { repo, priorPollCount, firstDetectedAt } = opts;
  const timestamp = new Date().toISOString();
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; background: #0f0f0f; color: #e5e5e5; margin: 0; padding: 24px;">
  <div style="max-width: 600px; margin: 0 auto; background: #1a1a1a; border-radius: 8px; overflow: hidden; border: 1px solid #2a2a2a;">
    <div style="background: #14532d; padding: 20px 24px;">
      <h1 style="margin: 0; font-size: 20px; color: #fff; letter-spacing: 0.5px;">RasoKart — GitHub Remote Divergence Resolved</h1>
      <p style="margin: 4px 0 0; color: #86efac; font-size: 13px;">The remote branch is no longer ahead of local HEAD</p>
    </div>
    <div style="padding: 24px;">
      <p style="margin: 0 0 16px; color: #4ade80; font-size: 14px; font-weight: 600;">
        &#x2705; Remote <strong>${repo}</strong> is back in sync — the divergence that triggered the earlier alert has been resolved.
      </p>
      <p style="margin: 0 0 20px; color: #a1a1aa; font-size: 13px;">
        The remote branch no longer has commits ahead of local HEAD. Scheduled syncs will proceed normally.
      </p>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px; width: 40%;">Repository</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; font-weight: 600;">${repo}</td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Diverged for (polls)</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; color: #4ade80; font-weight: 600;">${priorPollCount}</td>
        </tr>
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">First Detected At</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px;">${firstDetectedAt}</td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Resolved At</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px;">${timestamp}</td>
        </tr>
      </table>

      <p style="margin: 0; color: #71717a; font-size: 12px;">
        No action is needed. You will only receive this email after a divergence that previously triggered an alert.
      </p>
    </div>
    <div style="padding: 14px 24px; background: #111; border-top: 1px solid #2a2a2a;">
      <p style="margin: 0; color: #52525b; font-size: 11px;">
        This alert was sent automatically by RasoKart when the admin dashboard detected that remote divergence was resolved. To stop receiving these emails, update your notification preferences in Admin Settings.
      </p>
    </div>
  </div>
</body>
</html>`;
}

async function maybeNotifyDivergenceTransition(opts: {
  nowDiverged: boolean;
  remoteAheadBy: number;
  repo: string;
}): Promise<void> {
  if (divergenceCheckInFlight) {
    logger.debug("GITHUB_SYNC: Divergence check already in flight — skipping concurrent check to prevent duplicate alerts");
    return;
  }
  divergenceCheckInFlight = true;
  try {
    await _maybeNotifyDivergenceTransitionImpl(opts);
  } finally {
    divergenceCheckInFlight = false;
  }
}

async function _maybeNotifyDivergenceTransitionImpl(opts: {
  nowDiverged: boolean;
  remoteAheadBy: number;
  repo: string;
}): Promise<void> {
  const { nowDiverged, remoteAheadBy, repo } = opts;
  const state = readDivergenceState();

  if (!nowDiverged) {
    if (state.diverged) {
      writeDivergenceState({ diverged: false, consecutivePollsDiverged: 0, firstDetectedAt: null, lastEmailSentPollCount: 0 });
      if (state.lastEmailSentPollCount > 0) {
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
            logger.info("GITHUB_SYNC: No admins opted in to sync alert emails — skipping divergence resolved email");
          } else {
            const subject = `[RasoKart] ✅ GitHub Remote Divergence Resolved — ${repo}`;
            const html = buildDivergenceResolvedHtml({
              repo,
              priorPollCount: state.consecutivePollsDiverged,
              firstDetectedAt: state.firstDetectedAt ?? new Date().toISOString(),
            });

            const results = await Promise.allSettled(
              admins.map(a => sendMail({ to: a.email, subject, html })),
            );

            const sent = results.filter(r => r.status === "fulfilled" && r.value).length;
            const failed = results.length - sent;
            logger.info(
              { sent, failed, priorPollCount: state.consecutivePollsDiverged },
              "GITHUB_SYNC: Divergence resolved email dispatched",
            );
          }
        } catch (err) {
          logger.error({ err }, "GITHUB_SYNC: Failed to send divergence resolved emails");
        }
      }
    }
    return;
  }

  const now = new Date().toISOString();
  const consecutivePollsDiverged = state.diverged ? state.consecutivePollsDiverged + 1 : 1;
  const firstDetectedAt = state.diverged ? (state.firstDetectedAt ?? now) : now;

  let renotifyInterval = DEFAULT_RENOTIFY_INTERVAL;
  try {
    const rows = await db
      .select()
      .from(systemSettingsTable)
      .where(inArray(systemSettingsTable.key, ["github_sync_renotify_interval"]));
    const raw = rows[0]?.value;
    const parsed = parseInt(raw ?? "", 10);
    if (Number.isFinite(parsed) && parsed > 0) renotifyInterval = parsed;
  } catch {
  }

  const isFirstDetection = consecutivePollsDiverged === 1;
  const onRenotifyCadence =
    consecutivePollsDiverged > 1 &&
    (consecutivePollsDiverged - state.lastEmailSentPollCount) % renotifyInterval === 0;

  const newState: DivergenceState = {
    diverged: true,
    consecutivePollsDiverged,
    firstDetectedAt,
    lastEmailSentPollCount: isFirstDetection || onRenotifyCadence ? consecutivePollsDiverged : state.lastEmailSentPollCount,
  };
  writeDivergenceState(newState);

  if (!isFirstDetection && !onRenotifyCadence) return;

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
      logger.info("GITHUB_SYNC: No admins opted in to sync alert emails — skipping divergence transition alert");
      return;
    }

    const subject = `[RasoKart] ⚠ GitHub Remote Diverged — ${remoteAheadBy} commit${remoteAheadBy === 1 ? "" : "s"} ahead on ${repo}`;
    const html = buildDivergenceAlertHtml({ repo, remoteAheadBy, firstDetectedAt });

    const results = await Promise.allSettled(
      admins.map(a => sendMail({ to: a.email, subject, html })),
    );

    const sent = results.filter(r => r.status === "fulfilled" && r.value).length;
    const failed = results.length - sent;
    logger.info(
      { sent, failed, remoteAheadBy, consecutivePollsDiverged },
      "GITHUB_SYNC: Divergence transition alert email dispatched",
    );
  } catch (err) {
    logger.error({ err }, "GITHUB_SYNC: Failed to send divergence transition alert emails");
  }
}

let syncRunInProgress = false;

function resetRemote() {
  try {
    execSync(`git remote set-url ${REMOTE_NAME} https://github.com/${GITHUB_REPO}.git`, {
      cwd: REPO_ROOT,
      stdio: "pipe",
    });
  } catch {
  }
}

// GET /api/github-sync/config
router.get("/config", async (req, res, next) => {
  try {
    const rows = await db
      .select()
      .from(systemSettingsTable)
      .where(inArray(systemSettingsTable.key, [...GITHUB_SYNC_KEYS]));

    const map = Object.fromEntries(rows.map(r => [r.key, r.value]));

    const rawEnabled = map["github_sync_enabled"];
    const enabled = rawEnabled === null || rawEnabled === undefined ? true : rawEnabled === "true";
    const schedule = map["github_sync_schedule"] ?? "0 2 * * *";
    const failureThreshold = parseInt(map["github_sync_failure_threshold"] ?? "", 10) || DEFAULT_FAILURE_THRESHOLD;
    const renotifyInterval = parseInt(map["github_sync_renotify_interval"] ?? "", 10) || DEFAULT_RENOTIFY_INTERVAL;
    const rawDivergeAction = map["github_sync_diverge_action"];
    const divergeAction = rawDivergeAction === "alert_and_push" ? "alert_and_push" : DEFAULT_DIVERGE_ACTION;
    const cleanupFailureThreshold = parseInt(map["github_sync_cleanup_failure_threshold"] ?? "", 10) || 3;

    res.json({ enabled, schedule, failureThreshold, renotifyInterval, divergeAction, cleanupFailureThreshold });
  } catch (err) {
    next(err);
  }
});

// PUT /api/github-sync/config
router.put("/config", async (req, res, next) => {
  try {
    const user = (req as any).user;
    const { enabled, schedule, failureThreshold, renotifyInterval, divergeAction, cleanupFailureThreshold } = req.body as {
      enabled?: boolean;
      schedule?: string;
      failureThreshold?: number;
      renotifyInterval?: number;
      divergeAction?: string;
      cleanupFailureThreshold?: number;
    };

    if (enabled !== undefined && typeof enabled !== "boolean") {
      res.status(400).json({ error: "enabled must be a boolean" });
      return;
    }

    if (schedule !== undefined) {
      if (typeof schedule !== "string") {
        res.status(400).json({ error: "schedule must be a string" });
        return;
      }
      const trimmed = schedule.trim();
      if (trimmed.length > 0) {
        const parts = trimmed.split(/\s+/);
        if (parts.length !== 5) {
          res.status(400).json({ error: "schedule must be a valid 5-part cron expression (e.g. \"0 2 * * *\")" });
          return;
        }
      }
    }

    if (failureThreshold !== undefined) {
      if (typeof failureThreshold !== "number" || !Number.isInteger(failureThreshold) || failureThreshold < 1) {
        res.status(400).json({ error: "failureThreshold must be a positive integer" });
        return;
      }
    }

    if (renotifyInterval !== undefined) {
      if (typeof renotifyInterval !== "number" || !Number.isInteger(renotifyInterval) || renotifyInterval < 1) {
        res.status(400).json({ error: "renotifyInterval must be a positive integer" });
        return;
      }
    }

    if (divergeAction !== undefined && divergeAction !== "alert_only" && divergeAction !== "alert_and_push") {
      res.status(400).json({ error: "divergeAction must be \"alert_only\" or \"alert_and_push\"" });
      return;
    }

    if (cleanupFailureThreshold !== undefined) {
      if (typeof cleanupFailureThreshold !== "number" || !Number.isInteger(cleanupFailureThreshold) || cleanupFailureThreshold < 1) {
        res.status(400).json({ error: "cleanupFailureThreshold must be a positive integer" });
        return;
      }
    }

    const now = new Date();
    const upserts: Array<{ key: string; value: string }> = [];

    if (enabled !== undefined) {
      upserts.push({ key: "github_sync_enabled", value: enabled ? "true" : "false" });
    }
    if (schedule !== undefined) {
      upserts.push({ key: "github_sync_schedule", value: schedule.trim() || "0 2 * * *" });
    }
    if (failureThreshold !== undefined) {
      upserts.push({ key: "github_sync_failure_threshold", value: String(failureThreshold) });
    }
    if (renotifyInterval !== undefined) {
      upserts.push({ key: "github_sync_renotify_interval", value: String(renotifyInterval) });
    }
    if (divergeAction !== undefined) {
      upserts.push({ key: "github_sync_diverge_action", value: divergeAction });
    }
    if (cleanupFailureThreshold !== undefined) {
      upserts.push({ key: CLEANUP_FAILURE_THRESHOLD_KEY, value: String(cleanupFailureThreshold) });
    }

    for (const { key, value } of upserts) {
      await db
        .insert(systemSettingsTable)
        .values({ key, value, updatedBy: user.id, updatedAt: now })
        .onConflictDoUpdate({
          target: systemSettingsTable.key,
          set: { value, updatedBy: user.id, updatedAt: now },
        });
    }

    try {
      await db.insert(auditLogsTable).values({
        adminId: user.id,
        adminEmail: user.email,
        action: "setting_updated",
        targetType: "system_config",
        targetId: null,
        details: JSON.stringify({ keys: upserts.map(u => u.key), changes: Object.fromEntries(upserts.map(u => [u.key, u.value])) }),
        ipAddress: req.ip ?? null,
      });
    } catch (auditErr) {
      req.log.error({ err: auditErr }, "Failed to write audit log for github_sync config update");
    }

    const rows = await db
      .select()
      .from(systemSettingsTable)
      .where(inArray(systemSettingsTable.key, [...GITHUB_SYNC_KEYS]));

    const map = Object.fromEntries(rows.map(r => [r.key, r.value]));
    const rawEnabled = map["github_sync_enabled"];
    const finalEnabled = rawEnabled === null || rawEnabled === undefined ? true : rawEnabled === "true";
    const finalSchedule = map["github_sync_schedule"] ?? "0 2 * * *";
    const finalFailureThreshold = parseInt(map["github_sync_failure_threshold"] ?? "", 10) || DEFAULT_FAILURE_THRESHOLD;
    const finalRenotifyInterval = parseInt(map["github_sync_renotify_interval"] ?? "", 10) || DEFAULT_RENOTIFY_INTERVAL;
    const rawFinalDivergeAction = map["github_sync_diverge_action"];
    const finalDivergeAction = rawFinalDivergeAction === "alert_and_push" ? "alert_and_push" : DEFAULT_DIVERGE_ACTION;
    const finalCleanupFailureThreshold = parseInt(map["github_sync_cleanup_failure_threshold"] ?? "", 10) || 3;

    res.json({
      enabled: finalEnabled,
      schedule: finalSchedule,
      failureThreshold: finalFailureThreshold,
      renotifyInterval: finalRenotifyInterval,
      divergeAction: finalDivergeAction,
      cleanupFailureThreshold: finalCleanupFailureThreshold,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/github-sync/status
router.get("/status", (req, res, next) => {
  try {
    let payload: Record<string, string>;
    try {
      const raw = readFileSync(STATUS_FILE, "utf-8");
      payload = JSON.parse(raw) as Record<string, string>;
    } catch {
      payload = { status: "never" };
    }
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

// GET /api/github-sync/history
router.get("/history", (req, res, next) => {
  try {
    let entries: Array<Record<string, string>> = [];
    try {
      const raw = readFileSync(HISTORY_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        entries = parsed.slice(0, 10);
      }
    } catch {
    }
    res.json({ entries });
  } catch (err) {
    next(err);
  }
});

// GET /api/github-sync/history/:id/log
router.get("/history/:id/log", (req, res, next) => {
  try {
    const id = req.params["id"] as string;

    if (!/^[a-zA-Z0-9-]+$/.test(id)) {
      res.status(400).json({ error: "Invalid history entry id" });
      return;
    }

    try {
      const log = readFileSync(`${LOG_DIR}${id}.log`, "utf-8");
      res.json({ log });
    } catch {
      res.status(404).json({ error: "No log available for this sync run" });
    }
  } catch (err) {
    next(err);
  }
});

// GET /api/github-sync/divergence
router.get("/divergence", (req, res) => {
  const token = process.env["GITHUB_TOKEN"];

  if (!token) {
    res.json({ checked: false, diverged: false, reason: "GITHUB_TOKEN is not set in the environment" });
    return;
  }

  const remoteUrl = `https://x-access-token:${token}@github.com/${GITHUB_REPO}.git`;

  try {
    try {
      execSync(`git remote get-url ${REMOTE_NAME}`, { cwd: REPO_ROOT, stdio: "pipe" });
      execSync(`git remote set-url ${REMOTE_NAME} ${remoteUrl}`, { cwd: REPO_ROOT, stdio: "pipe" });
    } catch {
      execSync(`git remote add ${REMOTE_NAME} ${remoteUrl}`, { cwd: REPO_ROOT, stdio: "pipe" });
    }

    try {
      execSync(`git fetch ${REMOTE_NAME} main`, { cwd: REPO_ROOT, stdio: "pipe" });
    } catch (fetchErr: unknown) {
      const message = fetchErr instanceof Error ? fetchErr.message.replace(token, "<REDACTED>") : String(fetchErr);
      req.log.warn({ err: message }, "GitHub sync divergence check: fetch failed");
      res.json({ checked: false, diverged: false, repo: GITHUB_REPO, reason: "Could not reach the remote repository to check for divergence" });
      return;
    }

    let remoteAheadBy = 0;
    try {
      const out = execSync(`git rev-list --count HEAD..${REMOTE_NAME}/main`, { cwd: REPO_ROOT, stdio: "pipe" }).toString().trim();
      remoteAheadBy = parseInt(out, 10) || 0;
    } catch {
      maybeNotifyDivergenceTransition({ nowDiverged: false, remoteAheadBy: 0, repo: GITHUB_REPO }).catch(
        (err: unknown) => req.log.error({ err }, "GITHUB_SYNC: divergence state reset failed"),
      );
      res.json({ checked: true, diverged: false, repo: GITHUB_REPO, reason: "Remote branch does not exist yet — this will be the first push" });
      return;
    }

    maybeNotifyDivergenceTransition({ nowDiverged: remoteAheadBy > 0, remoteAheadBy, repo: GITHUB_REPO }).catch(
      (err: unknown) => req.log.error({ err }, "GITHUB_SYNC: divergence transition notification failed"),
    );

    res.json({
      checked: true,
      diverged: remoteAheadBy > 0,
      remoteAheadBy,
      repo: GITHUB_REPO,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message.replace(token, "<REDACTED>") : String(err);
    req.log.warn({ err: message }, "GitHub sync divergence check failed");
    res.json({ checked: false, diverged: false, repo: GITHUB_REPO, reason: "Divergence check failed" });
  } finally {
    resetRemote();
  }
});

// GET /api/github-sync/cleanup-logs/last
router.get("/cleanup-logs/last", async (req, res, next) => {
  try {
    const [result, streak, threshold] = await Promise.all([
      getLastGithubSyncLogCleanupResult(),
      readFailureStreak(),
      getCleanupFailureThreshold(),
    ]);
    if (!result) {
      res.json({ hasRun: false, failureStreak: streak.count, failureThreshold: threshold });
      return;
    }
    res.json({ hasRun: true, deleted: result.deleted, errors: result.errors, ranAt: result.ranAt, failureStreak: streak.count, failureThreshold: threshold });
  } catch (err) {
    next(err);
  }
});

// GET /api/github-sync/cleanup-alert-snooze
router.get("/cleanup-alert-snooze", async (req, res, next) => {
  try {
    const [row] = await db
      .select()
      .from(systemSettingsTable)
      .where(eq(systemSettingsTable.key, CLEANUP_ALERT_SNOOZE_KEY))
      .limit(1);
    const snoozedUntil = row?.value ?? null;
    const active = snoozedUntil != null && new Date(snoozedUntil) > new Date();
    res.json({ snoozedUntil: active ? snoozedUntil : null, active });
  } catch (err) {
    next(err);
  }
});

// POST /api/github-sync/cleanup-alert-snooze
router.post("/cleanup-alert-snooze", async (req, res, next) => {
  try {
    const user = (req as any).user;
    const days = typeof req.body?.days === "number" ? req.body.days : 0;

    let snoozedUntil: string | null = null;
    if (days > 0 && days <= 365) {
      const until = new Date();
      until.setDate(until.getDate() + days);
      snoozedUntil = until.toISOString();
    }

    if (snoozedUntil != null) {
      await db
        .insert(systemSettingsTable)
        .values({ key: CLEANUP_ALERT_SNOOZE_KEY, value: snoozedUntil, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: systemSettingsTable.key,
          set: { value: snoozedUntil, updatedAt: new Date() },
        });
    } else {
      await db.delete(systemSettingsTable).where(eq(systemSettingsTable.key, CLEANUP_ALERT_SNOOZE_KEY));
    }

    try {
      await db.insert(auditLogsTable).values({
        adminId: user.id,
        adminEmail: user.email,
        action: snoozedUntil ? "github_sync_cleanup_alert_snoozed" : "github_sync_cleanup_alert_unsnoozed",
        targetType: "system_config",
        targetId: null,
        details: snoozedUntil ? JSON.stringify({ snoozedUntil, days }) : null,
        ipAddress: req.ip ?? null,
      });
    } catch (auditErr) {
      req.log.error({ err: auditErr }, "Failed to write audit log for cleanup alert snooze");
    }

    const active = snoozedUntil != null;
    res.json({ snoozedUntil, active });
  } catch (err) {
    next(err);
  }
});

// POST /api/github-sync/cleanup-logs
router.post("/cleanup-logs", async (req, res, next) => {
  try {
    const user = (req as any).user;
    const result = await runGithubSyncLogCleanup({ source: "manual" });

    try {
      await db.insert(auditLogsTable).values({
        adminId: user.id,
        adminEmail: user.email,
        action: "github_sync_log_cleanup_triggered",
        targetType: "system_config",
        targetId: null,
        details: JSON.stringify(result),
        ipAddress: req.ip ?? null,
      });
    } catch (auditErr) {
      req.log.error({ err: auditErr }, "Failed to write audit log for github_sync log cleanup");
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/github-sync/run
router.post("/run", async (req, res, next) => {
  try {
    const user = (req as any).user;
    const retryOf = typeof req.body?.retryOf === "string" && req.body.retryOf.trim() ? req.body.retryOf.trim() : undefined;

    if (syncRunInProgress) {
      res.status(409).json({ error: "A GitHub sync run is already in progress" });
      return;
    }

    syncRunInProgress = true;

    const spawnEnv: NodeJS.ProcessEnv = { ...process.env, GITHUB_SYNC_FORCE: "true" };
    if (retryOf) {
      spawnEnv["GITHUB_SYNC_RETRY_OF"] = retryOf;
    }

    const child = spawn("pnpm", ["--filter", "@workspace/scripts", "run", "github-sync"], {
      cwd: REPO_ROOT,
      env: spawnEnv,
      stdio: "ignore",
      detached: true,
    });
    child.unref();

    child.on("exit", (code) => {
      syncRunInProgress = false;
      logger.info({ code, retryOf }, "Manually-triggered GitHub sync run finished");
    });

    child.on("error", (err) => {
      syncRunInProgress = false;
      logger.error({ err }, "Failed to spawn manually-triggered GitHub sync run");
    });

    try {
      await db.insert(auditLogsTable).values({
        adminId: user.id,
        adminEmail: user.email,
        action: "github_sync_triggered",
        targetType: "system_config",
        targetId: null,
        details: retryOf ? JSON.stringify({ retryOf }) : null,
        ipAddress: req.ip ?? null,
      });
    } catch (auditErr) {
      req.log.error({ err: auditErr }, "Failed to write audit log for github_sync manual trigger");
    }

    res.status(202).json({ status: "running" });
  } catch (err) {
    syncRunInProgress = false;
    next(err);
  }
});

export default router;
