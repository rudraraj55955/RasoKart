import { Router } from "express";
import { readFileSync } from "fs";
import { spawn, execSync } from "child_process";
import { logger } from "../lib/logger";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { db, systemSettingsTable, auditLogsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

const router = Router();
router.use(requireAuth);
router.use(requireAdmin);

const STATUS_FILE = new URL("../../../.github-sync-status.json", import.meta.url).pathname;
const HISTORY_FILE = new URL("../../../.github-sync-history.json", import.meta.url).pathname;
const LOG_DIR = new URL("../../../.github-sync-logs/", import.meta.url).pathname;
const REPO_ROOT = new URL("../../../", import.meta.url).pathname;

const GITHUB_SYNC_KEYS = ["github_sync_enabled", "github_sync_schedule"] as const;
const REMOTE_NAME = "github";
const GITHUB_REPO = process.env["GITHUB_REPO"] ?? "rudraraj55955/RPAY";

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

    res.json({ enabled, schedule });
  } catch (err) {
    next(err);
  }
});

// PUT /api/github-sync/config
router.put("/config", async (req, res, next) => {
  try {
    const user = (req as any).user;
    const { enabled, schedule } = req.body as { enabled?: boolean; schedule?: string };

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

    const now = new Date();
    const upserts: Array<{ key: string; value: string }> = [];

    if (enabled !== undefined) {
      upserts.push({ key: "github_sync_enabled", value: enabled ? "true" : "false" });
    }
    if (schedule !== undefined) {
      upserts.push({ key: "github_sync_schedule", value: schedule.trim() || "0 2 * * *" });
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

    res.json({ enabled: finalEnabled, schedule: finalSchedule });
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

// POST /api/github-sync/run
router.post("/run", async (req, res, next) => {
  try {
    const user = (req as any).user;

    if (syncRunInProgress) {
      res.status(409).json({ error: "A GitHub sync run is already in progress" });
      return;
    }

    syncRunInProgress = true;

    const child = spawn("pnpm", ["--filter", "@workspace/scripts", "run", "github-sync"], {
      cwd: REPO_ROOT,
      env: { ...process.env, GITHUB_SYNC_FORCE: "true" },
      stdio: "ignore",
      detached: true,
    });
    child.unref();

    child.on("exit", (code) => {
      syncRunInProgress = false;
      logger.info({ code }, "Manually-triggered GitHub sync run finished");
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
        details: null,
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
