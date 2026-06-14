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
  scheduleCallbackRetryWorker();

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

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port }, "Server listening");
  });
}

main();
