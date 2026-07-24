import cron, { type ScheduledTask } from "node-cron";
import { db, systemConfigTable, systemSettingsTable, SYSTEM_CONFIG_KEYS, SYSTEM_CONFIG_DEFAULTS } from "@workspace/db";
import { inArray, eq } from "drizzle-orm";
import { runReconciliation, notifyAdminsOfReconciliationFailure } from "./reconcileEngine";
import { notifyAdminsOfUnmatchedItems, retryFailedReconEmails } from "./reconcileEmail";
import { logger } from "../lib/logger";

export type ReconciliationScheduleMode = "daily" | "weekly" | "off";

let scheduledTask: ScheduledTask | null = null;

export interface ReconConfig {
  hour: number;
  minute: number;
  lookbackDays: number;
  enabled: boolean;
}

export async function loadReconConfig(): Promise<ReconConfig> {
  const keys = [
    SYSTEM_CONFIG_KEYS.RECONCILIATION_HOUR,
    SYSTEM_CONFIG_KEYS.RECONCILIATION_MINUTE,
    SYSTEM_CONFIG_KEYS.RECONCILIATION_LOOKBACK_DAYS,
    SYSTEM_CONFIG_KEYS.RECONCILIATION_ENABLED,
  ];

  const rows = await db
    .select()
    .from(systemConfigTable)
    .where(inArray(systemConfigTable.key, keys));

  const map = new Map(rows.map((r) => [r.key, r.value]));

  const hour = parseInt(
    map.get(SYSTEM_CONFIG_KEYS.RECONCILIATION_HOUR) ??
      SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.RECONCILIATION_HOUR]
  );
  const minute = parseInt(
    map.get(SYSTEM_CONFIG_KEYS.RECONCILIATION_MINUTE) ??
      SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.RECONCILIATION_MINUTE]
  );
  const lookbackDays = parseInt(
    map.get(SYSTEM_CONFIG_KEYS.RECONCILIATION_LOOKBACK_DAYS) ??
      SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.RECONCILIATION_LOOKBACK_DAYS]
  );
  const enabledRaw =
    map.get(SYSTEM_CONFIG_KEYS.RECONCILIATION_ENABLED) ??
    SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.RECONCILIATION_ENABLED];
  const enabled = enabledRaw !== "false";

  return {
    hour: isNaN(hour) ? 0 : Math.max(0, Math.min(23, hour)),
    minute: isNaN(minute) ? 0 : Math.max(0, Math.min(59, minute)),
    lookbackDays: isNaN(lookbackDays) ? 1 : Math.max(1, Math.min(90, lookbackDays)),
    enabled,
  };
}

function buildCronExpr(hour: number, minute: number): string {
  return `${minute} ${hour} * * *`;
}

async function loadScheduleMode(): Promise<ReconciliationScheduleMode> {
  const rows = await db
    .select()
    .from(systemSettingsTable)
    .where(eq(systemSettingsTable.key, "reconciliation_schedule"));
  const raw = rows[0]?.value;
  if (raw === "weekly" || raw === "off") return raw;
  return "daily";
}

async function runAutoReconciliation(): Promise<void> {
  const config = await loadReconConfig();
  const { lookbackDays, enabled } = config;

  if (!enabled) {
    logger.info("Scheduled auto-reconciliation is disabled — skipping run");
    return;
  }

  const scheduleMode = await loadScheduleMode();

  if (scheduleMode === "off") {
    logger.info("Reconciliation schedule set to 'off' — skipping run");
    return;
  }

  const today = new Date();

  // Weekly mode: only run on Mondays (getDay() === 1)
  if (scheduleMode === "weekly") {
    if (today.getDay() !== 1) {
      logger.info(
        { dayOfWeek: today.getDay() },
        "Reconciliation schedule set to 'weekly' — skipping non-Monday run"
      );
      return;
    }
  }

  // Daily mode: look back `lookbackDays` days
  // Weekly mode: look back 7 days to cover the full past week
  const effectiveLookback = scheduleMode === "weekly" ? 7 : lookbackDays;

  const fromDate = new Date(today);
  fromDate.setDate(fromDate.getDate() - effectiveLookback);

  const dateTo = new Date(today);
  dateTo.setDate(dateTo.getDate() - 1);

  const dateFrom = fromDate.toISOString().slice(0, 10);
  const dateToStr = dateTo.toISOString().slice(0, 10);

  logger.info({ dateFrom, dateTo: dateToStr, lookbackDays }, "Starting scheduled auto-reconciliation");

  let runId: number | undefined;
  try {
    const result = await runReconciliation({
      dateFrom,
      dateTo: dateToStr,
      merchantId: null,
      createdBy: null,
      triggeredBy: "auto",
    });
    runId = result.id;
    logger.info(
      {
        runId: result.id,
        totalMatched: result.totalMatched,
        totalUnmatched: result.totalUnmatched,
        matchedAmount: result.matchedAmount,
        unmatchedAmount: result.unmatchedAmount,
      },
      "Scheduled auto-reconciliation complete"
    );

    if ((result.totalUnmatched ?? 0) > 0) {
      notifyAdminsOfUnmatchedItems(result.id).catch(err => {
        logger.error({ err, runId: result.id }, "Unexpected error sending unmatched-items admin alert");
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error({ err }, "Scheduled auto-reconciliation failed");
    await notifyAdminsOfReconciliationFailure(runId ?? 0, message);
  }

  // Retry any failed reconciliation report emails whose back-off window has elapsed
  retryFailedReconEmails().catch(retryErr => {
    logger.error({ err: retryErr }, "Unexpected error during reconciliation email retry batch");
  });
}

export function scheduleReconciliation(cronExpr: string): void {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
  }

  scheduledTask = cron.schedule(cronExpr, runAutoReconciliation);
  logger.info({ cronExpr }, "Reconciliation scheduler registered");
}

export function getNextRunTime(): Date | null {
  if (!scheduledTask) return null;
  try {
    return scheduledTask.getNextRun();
  } catch {
    return null;
  }
}

export async function initReconciliationScheduler(): Promise<void> {
  const config = await loadReconConfig();
  const cronExpr = buildCronExpr(config.hour, config.minute);
  scheduleReconciliation(cronExpr);
  logger.info(
    { hour: config.hour, minute: config.minute, lookbackDays: config.lookbackDays, cronExpr },
    "Reconciliation scheduler initialized from DB config"
  );
}

export async function rescheduleFromDb(): Promise<ReconConfig> {
  const config = await loadReconConfig();
  const cronExpr = buildCronExpr(config.hour, config.minute);
  scheduleReconciliation(cronExpr);
  return config;
}
