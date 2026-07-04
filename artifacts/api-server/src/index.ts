import app from "./app";
import { logger } from "./lib/logger";
import { pool } from "@workspace/db";
import { seed } from "./seed";
import cron from "node-cron";
import { processPendingRetries } from "./helpers/callbackRetry";
import { initReconciliationScheduler } from "./helpers/reconScheduler";
import { initAuditReportScheduler } from "./helpers/auditReportScheduler";
import { startProviderLimitAlertScheduler, runProviderLimitAlertScan } from "./helpers/providerLimitScheduler";
import { initQrCleanupScheduler } from "./helpers/qrCleanupScheduler";
import { initVaCleanupScheduler } from "./helpers/vaCleanupScheduler";
import { initPlanExpiryScheduler } from "./helpers/planExpiryScheduler";
import { initPlanRenewalScheduler } from "./helpers/planRenewalScheduler";
import { initRateLimitCleanupScheduler } from "./helpers/rateLimitCleanupScheduler";
import { initTestEmailRetentionScheduler } from "./helpers/testEmailRetentionScheduler";
import { initAuditReportRetentionScheduler } from "./helpers/auditReportRetentionScheduler";
import { initDormantMerchantScheduler, runDormantMerchantScan } from "./helpers/dormantMerchantScheduler";
import { initEkqrSyncScheduler } from "./helpers/ekqrSyncScheduler";
import { initMerchantReportScheduler } from "./helpers/merchantReportScheduler";
import { initOverdueReportScheduler, runOverdueReportScan } from "./helpers/overdueReportScheduler";
import { initDeliveryHealthDigestScheduler } from "./helpers/reportDeliveryHealthEmail";
import { initDeliverySuccessRateAlertScheduler, runDeliverySuccessRateAlertScan } from "./helpers/deliverySuccessRateAlertScheduler";
import { flushAllReadyQuietHoursQueues } from "./helpers/quietHours";
import { db, systemConfigTable, SYSTEM_CONFIG_KEYS, SYSTEM_CONFIG_DEFAULTS } from "@workspace/db";
import { eq } from "drizzle-orm";
import { initNotifReminderScheduler, runNotifReminderScan } from "./helpers/notifReminderScheduler";
import { initSnoozeCleanupScheduler, runSnoozeCleanup } from "./helpers/snoozeCleanupScheduler";
import { initPayoutStuckCleanupScheduler, runStuckPayoutCleanup } from "./helpers/payoutStuckCleanupScheduler";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

function scheduleCallbackRetryWorker() {
  cron.schedule("* * * * *", async () => {
    try {
      await processPendingRetries();
    } catch (err) {
      logger.error({ err }, "Callback retry worker failed");
    }
  });

  logger.info("Callback retry worker registered (runs every minute)");
}

async function getQuietHoursFlushIntervalMs(): Promise<number> {
  try {
    const [row] = await db
      .select({ value: systemConfigTable.value })
      .from(systemConfigTable)
      .where(eq(systemConfigTable.key, SYSTEM_CONFIG_KEYS.QUIET_HOURS_FLUSH_INTERVAL_SECONDS))
      .limit(1);
    const seconds = parseInt(
      row?.value ?? SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.QUIET_HOURS_FLUSH_INTERVAL_SECONDS]
    );
    return Math.max(10, seconds) * 1000;
  } catch {
    const fallbackMs = parseInt(process.env["QUIET_HOURS_FLUSH_INTERVAL_MS"] ?? "60000", 10);
    return fallbackMs;
  }
}

function initQuietHoursFlushScheduler() {
  const envFallbackMs = parseInt(process.env["QUIET_HOURS_FLUSH_INTERVAL_MS"] ?? "60000", 10);

  async function tick() {
    try {
      logger.info("Quiet hours flush: scanning for ready queues");
      const { usersProcessed, totalFlushed } = await flushAllReadyQuietHoursQueues();
      if (usersProcessed > 0) {
        logger.info({ usersProcessed, totalFlushed }, "Quiet hours flush complete");
      }
    } catch (err) {
      logger.error({ err }, "Quiet hours flush sweep failed");
    }
    const intervalMs = await getQuietHoursFlushIntervalMs();
    setTimeout(tick, intervalMs);
  }

  getQuietHoursFlushIntervalMs()
    .then((intervalMs) => {
      logger.info({ intervalMs }, "Quiet hours flush scheduler registered");
      setTimeout(tick, intervalMs);
    })
    .catch(() => {
      logger.info({ intervalMs: envFallbackMs }, "Quiet hours flush scheduler registered (env fallback)");
      setTimeout(tick, envFallbackMs);
    });
}

async function main() {
  try {
    await pool.query("SELECT 1");
    logger.info("Database connection verified");
  } catch (err) {
    logger.error({ err }, "Database health check failed — cannot start server");
    process.exit(1);
  }

  try {
    await seed();
    logger.info("Database seed complete");
  } catch (err) {
    logger.error({ err }, "Seed failed — cannot start server without baseline data");
    process.exit(1);
  }

  await initReconciliationScheduler();
  initAuditReportScheduler();
  startProviderLimitAlertScheduler();
  initQrCleanupScheduler();
  initVaCleanupScheduler();
  initPlanExpiryScheduler();
  initPlanRenewalScheduler();
  initRateLimitCleanupScheduler();
  initTestEmailRetentionScheduler();
  initAuditReportRetentionScheduler();
  initDormantMerchantScheduler();
  initEkqrSyncScheduler();
  initMerchantReportScheduler();
  initOverdueReportScheduler();
  initDeliveryHealthDigestScheduler();
  initDeliverySuccessRateAlertScheduler();
  initNotifReminderScheduler();
  initSnoozeCleanupScheduler();
  initPayoutStuckCleanupScheduler();
  scheduleCallbackRetryWorker();
  initQuietHoursFlushScheduler();

  // Startup sweep: immediately scan all active connections so merchants receive
  // provider_limit_reset (and warning/reached) notifications even when the server
  // was down at the start of the month. The dedup indexes make this idempotent.
  runProviderLimitAlertScan().catch((err) => {
    logger.warn({ err }, "Startup provider limit sweep failed");
  });

  // Startup sweep: scan for newly dormant merchants so admins are alerted even
  // when the server was down at the scheduled run time. Dedup keys make this safe.
  runDormantMerchantScan().catch((err) => {
    logger.warn({ err }, "Startup dormant merchant sweep failed");
  });

  // Startup sweep: scan for overdue scheduled reports so admins are alerted even
  // when the server was down at the daily run time. Dedup keys make this safe.
  runOverdueReportScan().catch((err) => {
    logger.warn({ err }, "Startup overdue report sweep failed");
  });

  // Startup sweep: check delivery success rates so admins are alerted even when
  // the server was down at the scheduled run time. Dedup keys make this safe.
  runDeliverySuccessRateAlertScan().catch((err) => {
    logger.warn({ err }, "Startup delivery success-rate alert sweep failed");
  });

  // Startup sweep: send notif reminder emails to merchants who have had
  // notifications disabled for ≥30 days and haven't received a reminder yet.
  // notif_reminder_sent_at guards against duplicate sends within 30 days.
  runNotifReminderScan().catch((err) => {
    logger.warn({ err }, "Startup notif reminder sweep failed");
  });

  // Startup sweep: clear any snooze timestamps that expired while the server
  // was down so they don't linger until the next nightly run.
  runSnoozeCleanup().catch((err) => {
    logger.warn({ err }, "Startup snooze cleanup sweep failed");
  });

  // Startup sweep: clean up payouts stuck INITIATED/PENDING past the
  // threshold (e.g. server crashed mid-transfer) so locked wallet balances
  // don't stay stuck until the next scheduled run.
  runStuckPayoutCleanup().catch((err) => {
    logger.warn({ err }, "Startup stuck payout cleanup sweep failed");
  });

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port }, "Server listening");
  });
}

main();
