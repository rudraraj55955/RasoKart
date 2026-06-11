import cron from "node-cron";
import { logger } from "../lib/logger";
import { checkWebhookSecretRotation } from "./webhookSecretChecker";

async function runWebhookSecretCheck(): Promise<void> {
  try {
    const { reminderCount, overdueCount, notificationsSent } = await checkWebhookSecretRotation();
    logger.info(
      { reminderCount, overdueCount, notificationsSent },
      "Webhook secret rotation check complete",
    );
  } catch (err) {
    logger.error({ err }, "Webhook secret rotation scheduler check failed");
  }
}

export function initWebhookSecretScheduler(): void {
  // Run daily at 09:00 server time (staggered from plan expiry at 08:00)
  cron.schedule("0 9 * * *", runWebhookSecretCheck);
  logger.info("Webhook secret rotation alert scheduler initialized (daily at 09:00)");
}
