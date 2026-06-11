import app from "./app";
import { logger } from "./lib/logger";
import { pool } from "@workspace/db";
import { seed } from "./seed";
import cron from "node-cron";
import { processPendingRetries } from "./helpers/callbackRetry";
import { initReconciliationScheduler } from "./helpers/reconScheduler";
import { initAuditReportScheduler } from "./helpers/auditReportScheduler";
import { startProviderLimitAlertScheduler, runProviderLimitAlertScan } from "./helpers/providerLimitScheduler";
import { initQrCleanupScheduler, runQrCleanup } from "./helpers/qrCleanupScheduler";
import { initVaCleanupScheduler, runVaCleanup } from "./helpers/vaCleanupScheduler";
import { initPlanExpiryScheduler } from "./helpers/planExpiryScheduler";
import { initPlanRenewalScheduler } from "./helpers/planRenewalScheduler";
import { initNonceCleanupScheduler, pruneExpiredNonces } from "./helpers/nonceCleanupScheduler";
import { initWebhookSecretScheduler } from "./helpers/webhookSecretScheduler";
import { initStorageCleanupSchedulerFromDb } from "./helpers/storageCleanupScheduler";
import { seedLastAlertSentAt } from "./helpers/signatureFailureAlert";
import { initSignatureAlertLogCleanupScheduler, pruneOldAlertLogs } from "./helpers/signatureAlertLogCleanupScheduler";

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
  // Startup sweep: prune any expired QR codes that accumulated while the server
  // was down, before the first scheduled run (nightly at 02:00) fires.
  runQrCleanup().catch((err) => {
    logger.warn({ err }, "Startup QR cleanup sweep failed");
  });
  initVaCleanupScheduler();
  // Startup sweep: prune any closed virtual accounts past their retention window
  // that accumulated while the server was down, before the first scheduled run
  // (nightly at 02:30) fires.
  runVaCleanup().catch((err) => {
    logger.warn({ err }, "Startup VA cleanup sweep failed");
  });
  initPlanExpiryScheduler();
  initPlanRenewalScheduler();
  initNonceCleanupScheduler();
  // Startup sweep: prune any expired nonces that accumulated while the server
  // was down, before the first scheduled run fires (interval controlled by
  // NONCE_CLEANUP_INTERVAL_HOURS, default 6 — see nonceCleanupScheduler.ts).
  pruneExpiredNonces().catch((err) => {
    logger.warn({ err }, "Startup nonce cleanup sweep failed");
  });
  initSignatureAlertLogCleanupScheduler();
  // Startup sweep: prune any alert log rows that aged out while the server
  // was down, before the first nightly run (03:00) fires.
  pruneOldAlertLogs().catch((err) => {
    logger.warn({ err }, "Startup alert log cleanup sweep failed");
  });
  initWebhookSecretScheduler().catch((err) => {
    logger.warn({ err }, "Webhook secret scheduler init failed");
  });
  await initStorageCleanupSchedulerFromDb();
  scheduleCallbackRetryWorker();

  // Seed in-memory rate-limit for signature failure alerts from DB so a
  // server restart doesn't reset the cooldown window.
  seedLastAlertSentAt().catch((err) => {
    logger.warn({ err }, "Startup signature failure alert seed failed");
  });

  // Startup sweep: immediately scan all active connections so merchants receive
  // provider_limit_reset (and warning/reached) notifications even when the server
  // was down at the start of the month. The dedup indexes make this idempotent.
  runProviderLimitAlertScan().catch((err) => {
    logger.warn({ err }, "Startup provider limit sweep failed");
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
