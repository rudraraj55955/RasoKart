import cron from "node-cron";
import { logger } from "../lib/logger";
import { checkWebhookSecretRotation } from "./webhookSecretChecker";

const DEFAULT_CRON = "0 9 * * *";

async function runWebhookSecretCheck(): Promise<void> {
  logger.info("Webhook secret rotation check starting");
  const { merchantsScanned, reminderCount, overdueCount, notificationsSent, emailsSent } =
    await checkWebhookSecretRotation();
  logger.info(
    { merchantsScanned, reminderCount, overdueCount, notificationsSent, emailsSent },
    "Webhook secret rotation check complete",
  );
}

export function initWebhookSecretScheduler(): void {
  const rawExpr = process.env["WEBHOOK_SECRET_CHECK_CRON"] ?? DEFAULT_CRON;
  const cronExpr = cron.validate(rawExpr) ? rawExpr : DEFAULT_CRON;

  if (rawExpr !== cronExpr) {
    logger.error(
      { providedExpr: rawExpr, fallback: cronExpr },
      "WEBHOOK_SECRET_CHECK_CRON is invalid — falling back to default schedule",
    );
  }

  // Wrap in a try/catch for the recurring schedule so errors don't kill the process
  cron.schedule(cronExpr, async () => {
    try {
      await runWebhookSecretCheck();
    } catch (err) {
      logger.error({ err }, "Webhook secret rotation scheduler check failed");
    }
  });

  logger.info(
    { cronExpr },
    "Webhook secret rotation alert scheduler initialized",
  );

  // Startup sweep: catch any merchants whose secrets aged while the server was down.
  // Deduplication in checkWebhookSecretRotation() makes this safe to run on every boot.
  // runWebhookSecretCheck() throws on error, so the .catch() below is reachable.
  runWebhookSecretCheck().catch((err) => {
    logger.warn({ err }, "Startup webhook secret rotation sweep failed");
  });
}
