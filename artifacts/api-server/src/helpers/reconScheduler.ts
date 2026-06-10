import cron, { type ScheduledTask } from "node-cron";
import { db, systemConfigTable, SYSTEM_CONFIG_KEYS, SYSTEM_CONFIG_DEFAULTS } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { runReconciliation, notifyAdminsOfReconciliationFailure } from "./reconcileEngine";
import { logger } from "../lib/logger";

let scheduledTask: ScheduledTask | null = null;

export interface ReconConfig {
  hour: number;
  minute: number;
  lookbackDays: number;
}

export async function loadReconConfig(): Promise<ReconConfig> {
  const keys = [
    SYSTEM_CONFIG_KEYS.RECONCILIATION_HOUR,
    SYSTEM_CONFIG_KEYS.RECONCILIATION_MINUTE,
    SYSTEM_CONFIG_KEYS.RECONCILIATION_LOOKBACK_DAYS,
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

  return {
    hour: isNaN(hour) ? 0 : Math.max(0, Math.min(23, hour)),
    minute: isNaN(minute) ? 0 : Math.max(0, Math.min(59, minute)),
    lookbackDays: isNaN(lookbackDays) ? 1 : Math.max(1, Math.min(90, lookbackDays)),
  };
}

function buildCronExpr(hour: number, minute: number): string {
  return `${minute} ${hour} * * *`;
}

async function runAutoReconciliation(): Promise<void> {
  const config = await loadReconConfig();
  const { lookbackDays } = config;

  const today = new Date();
  const fromDate = new Date(today);
  fromDate.setDate(fromDate.getDate() - lookbackDays);

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
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error({ err }, "Scheduled auto-reconciliation failed");
    await notifyAdminsOfReconciliationFailure(runId ?? 0, message);
  }
}

export function scheduleReconciliation(cronExpr: string): void {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
  }

  scheduledTask = cron.schedule(cronExpr, runAutoReconciliation);
  logger.info({ cronExpr }, "Reconciliation scheduler registered");
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
