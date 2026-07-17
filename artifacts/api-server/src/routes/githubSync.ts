import { Router } from "express";
import { readFileSync } from "fs";
import { spawn, execSync } from "child_process";
import { logger } from "../lib/logger";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { db, systemSettingsTable, auditLogsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { runGithubSyncLogCleanup, getLastGithubSyncLogCleanupResult } from "../helpers/githubSyncLogCleanupScheduler";

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
] as const;
const REMOTE_NAME = "github";
const GITHUB_REPO = process.env["GITHUB_REPO"] ?? "rudraraj55955/RPAY";
const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_RENOTIFY_INTERVAL = 10;
const DEFAULT_DIVERGE_ACTION = "alert_only";

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

    res.json({ enabled, schedule, failureThreshold, renotifyInterval, divergeAction });
  } catch (err) {
    next(err);
  }
});

// PUT /api/github-sync/config
router.put("/config", async (req, res, next) => {
  try {
    const user = (req as any).user;
    const { enabled, schedule, failureThreshold, renotifyInterval, divergeAction } = req.body as {
      enabled?: boolean;
      schedule?: string;
      failureThreshold?: number;
      renotifyInterval?: number;
      divergeAction?: string;
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

    res.json({
      enabled: finalEnabled,
      schedule: finalSchedule,
      failureThreshold: finalFailureThreshold,
      renotifyInterval: finalRenotifyInterval,
      divergeAction: finalDivergeAction,
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
      res.json({ checked: true, diverged: false, repo: GITHUB_REPO, reason: "Remote branch does not exist yet — this will be the first push" });
      return;
    }

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
    const result = await getLastGithubSyncLogCleanupResult();
    if (!result) {
      res.json({ hasRun: false });
      return;
    }
    res.json({ hasRun: true, deleted: result.deleted, errors: result.errors, ranAt: result.ranAt });
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
