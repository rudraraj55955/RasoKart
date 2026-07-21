import cron from "node-cron";
import { readFileSync, readdirSync, unlinkSync } from "fs";
import { fileURLToPath } from "url";
import { logger } from "../lib/logger";
import { and, eq } from "drizzle-orm";
import { db, notificationsTable, systemSettingsTable, usersTable } from "@workspace/db";

const LAST_CLEANUP_SETTING_KEY = "github_sync_last_cleanup";
export const FAILURE_STREAK_SETTING_KEY = "github_sync_cleanup_failure_streak";
export const CLEANUP_ALERT_SNOOZE_KEY = "github_sync_cleanup_alert_snoozed_until";
export const CLEANUP_FAILURE_THRESHOLD_KEY = "github_sync_cleanup_failure_threshold";

/**
 * Default number of consecutive scheduled nightly runs that must report errors > 0
 * before admins are notified. Can be overridden via system_config
 * (key: github_sync_cleanup_failure_threshold).
 */
export const DEFAULT_CLEANUP_FAILURE_THRESHOLD = 3;

const HISTORY_FILE = fileURLToPath(
  new URL("../../../../.github-sync-history.json", import.meta.url),
);
const LOG_DIR = fileURLToPath(
  new URL("../../../../.github-sync-logs/", import.meta.url),
);

interface GithubSyncHistoryEntry {
  id: string;
  hasLog?: boolean;
}

interface FailureStreak {
  count: number;
  lastFailedDate: string;
}

async function persistLastCleanupResult(result: { deleted: number; errors: number; ranAt: string }): Promise<void> {
  try {
    await db
      .insert(systemSettingsTable)
      .values({ key: LAST_CLEANUP_SETTING_KEY, value: JSON.stringify(result), updatedAt: new Date() })
      .onConflictDoUpdate({
        target: systemSettingsTable.key,
        set: { value: JSON.stringify(result), updatedAt: new Date() },
      });
  } catch (err) {
    logger.error({ err }, "Failed to persist last GitHub sync log cleanup result");
  }
}

export async function getLastGithubSyncLogCleanupResult(): Promise<{ deleted: number; errors: number; ranAt: string } | null> {
  try {
    const [row] = await db
      .select()
      .from(systemSettingsTable)
      .where(eq(systemSettingsTable.key, LAST_CLEANUP_SETTING_KEY))
      .limit(1);

    if (!row?.value) {
      return null;
    }

    const parsed = JSON.parse(row.value);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.deleted === "number" &&
      typeof parsed.errors === "number" &&
      typeof parsed.ranAt === "string"
    ) {
      return parsed as { deleted: number; errors: number; ranAt: string };
    }
    return null;
  } catch (err) {
    logger.error({ err }, "Failed to read last GitHub sync log cleanup result");
    return null;
  }
}

export async function getCleanupFailureThreshold(): Promise<number> {
  try {
    const [row] = await db
      .select()
      .from(systemSettingsTable)
      .where(eq(systemSettingsTable.key, CLEANUP_FAILURE_THRESHOLD_KEY))
      .limit(1);
    if (!row?.value) return DEFAULT_CLEANUP_FAILURE_THRESHOLD;
    const parsed = parseInt(row.value, 10);
    return Number.isFinite(parsed) && parsed >= 1 ? parsed : DEFAULT_CLEANUP_FAILURE_THRESHOLD;
  } catch (err) {
    logger.error({ err }, "Failed to read GitHub sync cleanup failure threshold");
    return DEFAULT_CLEANUP_FAILURE_THRESHOLD;
  }
}

export async function readFailureStreak(): Promise<FailureStreak> {
  try {
    const [row] = await db
      .select()
      .from(systemSettingsTable)
      .where(eq(systemSettingsTable.key, FAILURE_STREAK_SETTING_KEY))
      .limit(1);

    if (!row?.value) {
      return { count: 0, lastFailedDate: "" };
    }

    const parsed = JSON.parse(row.value);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.count === "number" &&
      typeof parsed.lastFailedDate === "string"
    ) {
      return parsed as FailureStreak;
    }
    return { count: 0, lastFailedDate: "" };
  } catch (err) {
    logger.error({ err }, "Failed to read GitHub sync cleanup failure streak");
    return { count: 0, lastFailedDate: "" };
  }
}

async function persistFailureStreak(streak: FailureStreak): Promise<void> {
  try {
    await db
      .insert(systemSettingsTable)
      .values({ key: FAILURE_STREAK_SETTING_KEY, value: JSON.stringify(streak), updatedAt: new Date() })
      .onConflictDoUpdate({
        target: systemSettingsTable.key,
        set: { value: JSON.stringify(streak), updatedAt: new Date() },
      });
  } catch (err) {
    logger.error({ err }, "Failed to persist GitHub sync cleanup failure streak");
  }
}

async function isCleanupAlertSnoozed(): Promise<boolean> {
  try {
    const [row] = await db
      .select()
      .from(systemSettingsTable)
      .where(eq(systemSettingsTable.key, CLEANUP_ALERT_SNOOZE_KEY))
      .limit(1);
    if (!row?.value) return false;
    return new Date(row.value) > new Date();
  } catch (err) {
    logger.error({ err }, "Failed to read GitHub sync cleanup alert snooze setting");
    return false;
  }
}

async function notifyAdminsOfRepeatedCleanupFailure(streak: FailureStreak, errors: number): Promise<void> {
  try {
    const adminUsers = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(eq(usersTable.role, "admin"), eq(usersTable.isActive, true)));

    if (adminUsers.length === 0) {
      logger.warn("Cleanup failure alert: no active admin users — skipping notifications");
      return;
    }

    const dedupeKey = `cleanup_failure_repeated_${streak.lastFailedDate}`;
    const appDomain = process.env["APP_DOMAIN"] ?? "https://rasokart.com";

    const rows = adminUsers.map(u => ({
      userId: u.id,
      type: "cleanup_failure_repeated" as const,
      title: "Log Cleanup Failing Repeatedly",
      body: `The nightly GitHub sync log cleanup has reported file-deletion errors for ${streak.count} consecutive night${streak.count === 1 ? "" : "s"} (${errors} error${errors === 1 ? "" : "s"} tonight). This may indicate a filesystem permission issue. Check the server logs and the Settings → GitHub Sync panel for details.`,
      metadata: {
        consecutiveFailures: streak.count,
        errorsTonight: errors,
        lastFailedDate: streak.lastFailedDate,
        dedupeKey,
        settingsUrl: `${appDomain}/admin/settings`,
      },
    }));

    const inserted = await db
      .insert(notificationsTable)
      .values(rows)
      .onConflictDoNothing()
      .returning({ id: notificationsTable.id });

    if (inserted.length > 0) {
      logger.warn(
        { consecutiveFailures: streak.count, errorsTonight: errors, adminCount: adminUsers.length },
        "Admin notification sent: log cleanup has been failing repeatedly",
      );
    }
  } catch (err) {
    logger.error({ err }, "Failed to send admin notification for repeated cleanup failures");
  }
}

export async function runGithubSyncLogCleanup(opts?: { source?: "scheduled" | "manual" }): Promise<{ deleted: number; errors: number }> {
  let history: GithubSyncHistoryEntry[] = [];
  try {
    const raw = readFileSync(HISTORY_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      history = parsed as GithubSyncHistoryEntry[];
    }
  } catch {
    // No history file yet — all log files are orphans
  }

  const knownIds = new Set(history.map((e) => e.id).filter(Boolean));

  let files: string[] = [];
  try {
    files = readdirSync(LOG_DIR).filter((f) => f.endsWith(".log"));
  } catch {
    // Log directory doesn't exist yet — nothing to clean up
    const result = { deleted: 0, errors: 0 };
    await persistLastCleanupResult({ ...result, ranAt: new Date().toISOString() });
    return result;
  }

  let deleted = 0;
  let errors = 0;

  for (const file of files) {
    const id = file.replace(/\.log$/, "");
    if (!knownIds.has(id)) {
      try {
        unlinkSync(`${LOG_DIR}${file}`);
        deleted++;
      } catch (err) {
        errors++;
        logger.warn({ err, file }, "Failed to delete orphaned GitHub sync log file");
      }
    }
  }

  if (deleted > 0 || errors > 0) {
    logger.info({ deleted, errors }, "GitHub sync log cleanup complete");
  }

  await persistLastCleanupResult({ deleted, errors, ranAt: new Date().toISOString() });

  // Streak tracking and admin alerts are only meaningful for the scheduled
  // nightly run.  Manual triggers (admin button, startup sweep) can fail for
  // transient reasons and should not advance the "N consecutive nights"
  // counter that drives the alert.
  if (opts?.source === "scheduled") {
    const todayDate = new Date().toISOString().slice(0, 10);
    const streak = await readFailureStreak();
    const threshold = await getCleanupFailureThreshold();

    if (errors > 0) {
      // Only count each calendar day once (guards against the cron firing twice
      // in edge cases or a restart overlapping with the scheduled window).
      const newCount = streak.lastFailedDate === todayDate ? streak.count : streak.count + 1;
      const updatedStreak: FailureStreak = { count: newCount, lastFailedDate: todayDate };
      await persistFailureStreak(updatedStreak);

      if (newCount >= threshold) {
        const snoozed = await isCleanupAlertSnoozed();
        if (snoozed) {
          logger.info(
            { consecutiveFailures: newCount, errorsTonight: errors },
            "GitHub sync cleanup failure alert suppressed — admin has snoozed it",
          );
        } else {
          await notifyAdminsOfRepeatedCleanupFailure(updatedStreak, errors);
        }
      }
    } else if (streak.count > 0) {
      // Clean scheduled run — reset the streak.
      await persistFailureStreak({ count: 0, lastFailedDate: "" });
      logger.info({ previousStreak: streak.count }, "GitHub sync log cleanup failure streak reset");
    }
  }

  return { deleted, errors };
}

export function initGithubSyncLogCleanupScheduler(): void {
  cron.schedule("0 3 * * *", () => {
    runGithubSyncLogCleanup({ source: "scheduled" }).catch((err) => {
      logger.error({ err }, "GitHub sync log cleanup scheduler failed");
    });
  });

  logger.info("GitHub sync log cleanup scheduler registered (runs nightly at 03:00)");
}
