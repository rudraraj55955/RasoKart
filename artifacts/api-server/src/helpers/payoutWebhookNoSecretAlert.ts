/**
 * Rate-limited in-app admin alert for payout webhooks received with no
 * signing secret configured.
 *
 * At most one notification per hour (in-process rate limit). The alert is
 * mandatory — it bypasses per-user in-app preference checks — because a
 * missing secret silently drops all payout completions.
 */
import { db, usersTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { createBulkNotifications, type NotificationType } from "./notifications";

const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

let lastAlertSentAt: Date | null = null;

export function resetPayoutNoSecretAlertRateLimit(): void {
  lastAlertSentAt = null;
  logger.info("Payout-webhook no-secret alert rate-limit reset");
}

/**
 * Fires a rate-limited in-app notification to all active admins when a payout
 * webhook arrives but no Cashfree Payout signing secret is configured.
 *
 * @param webhookCount  Number of no-secret webhook hits since the last alert
 *                      (typically 1 per call-site invocation).
 * @param env           Human-readable environment label ("LIVE" or "SANDBOX").
 */
export async function maybeAlertPayoutWebhookNoSecret(
  webhookCount: number,
  env: string,
): Promise<void> {
  try {
    if (lastAlertSentAt != null && Date.now() - lastAlertSentAt.getTime() < COOLDOWN_MS) {
      logger.debug(
        { lastAlertSentAt, cooldownMs: COOLDOWN_MS },
        "payout_webhook_no_secret_alert — suppressed within cooldown",
      );
      return;
    }

    const admins = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(eq(usersTable.role, "admin"), eq(usersTable.isActive, true)));

    if (admins.length === 0) {
      logger.warn("payout_webhook_no_secret_alert — no active admins to notify");
      return;
    }

    const type: NotificationType = "payout_webhook_no_secret";
    const title = "Payout Webhook Secret Not Configured";
    const body =
      `${webhookCount} payout webhook${webhookCount === 1 ? "" : "s"} ` +
      `received on the ${env} environment but no Cashfree Payout signing secret ` +
      `is configured. Payouts will not complete until a secret is set in ` +
      `Admin → Settings → Cashfree Payout.`;

    await createBulkNotifications(
      admins.map((a) => ({
        userId: a.id,
        type,
        title,
        body,
        metadata: { webhookCount, env } as Record<string, unknown>,
      })),
      { skipPrefCheck: true },
    );

    lastAlertSentAt = new Date();
    logger.info(
      { adminCount: admins.length, webhookCount, env },
      "payout_webhook_no_secret_alert — notifications sent",
    );
  } catch (err) {
    logger.error({ err }, "payout_webhook_no_secret_alert — failed to send notifications");
  }
}
