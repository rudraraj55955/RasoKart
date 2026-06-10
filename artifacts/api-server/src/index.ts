import app from "./app";
import { logger } from "./lib/logger";
import { pool } from "@workspace/db";
import { seed } from "./seed";
import cron from "node-cron";
import { runReconciliation, notifyAdminsOfReconciliationFailure } from "./helpers/reconcileEngine";
import { processPendingRetries } from "./helpers/callbackRetry";

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
  // Runs every minute to process pending callback retries
  cron.schedule("* * * * *", async () => {
    try {
      await processPendingRetries();
    } catch (err) {
      logger.error({ err }, "Callback retry worker failed");
    }
  });

  logger.info("Callback retry worker registered (runs every minute)");
}

function scheduleNightlyReconciliation() {
  // Runs every day at midnight (00:00) server time
  cron.schedule("0 0 * * *", async () => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const dateFrom = yesterday.toISOString().slice(0, 10);
    const dateTo = yesterday.toISOString().slice(0, 10);

    logger.info({ dateFrom, dateTo }, "Starting nightly auto-reconciliation");

    let runId: number | undefined;
    try {
      const result = await runReconciliation({
        dateFrom,
        dateTo,
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
        "Nightly auto-reconciliation complete"
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      logger.error({ err }, "Nightly auto-reconciliation failed");
      await notifyAdminsOfReconciliationFailure(runId ?? 0, message);
    }
  });

  logger.info("Nightly reconciliation scheduler registered (runs at 00:00 daily)");
}

async function main() {
  // DB health check — fail fast rather than serve a zombie
  try {
    await pool.query("SELECT 1");
    logger.info("Database connection verified");
  } catch (err) {
    logger.error({ err }, "Database health check failed — cannot start server");
    process.exit(1);
  }

  // Idempotent seed — guard: fatal if it fails so the server never boots
  // without baseline admin credentials and demo data
  try {
    await seed();
    logger.info("Database seed complete");
  } catch (err) {
    logger.error({ err }, "Seed failed — cannot start server without baseline data");
    process.exit(1);
  }

  scheduleNightlyReconciliation();
  scheduleCallbackRetryWorker();

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port }, "Server listening");
  });
}

main();
