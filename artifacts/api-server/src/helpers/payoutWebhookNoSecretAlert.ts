/**
 * Rate-limited in-app admin alert for payout webhooks received with no
 * signing secret configured.
 *
 * At most one notification per hour (in-process rate limit).  The cooldown
 * slot is claimed synchronously — before the first `await` — so concurrent
 * webhook requests in the same Node.js event-loop process can never both
 * observe `lastAlertSentAt === null` and both fire an alert.
 *
 * On failure the slot is released so a later call can retry; a failed
 * attempt is never treated as a successful alert.
 */
import { db, usersTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { createBulkNotifications, type NotificationType } from "./notifications";

const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

/** Timestamp of the most recent successfully dispatched alert. */
let lastAlertSentAt: Date | null = null;

export function resetPayoutNoSecretAlertRateLimit(): void {
  lastAlertSentAt = null;
  logger.info("Payout-webhook no-secret alert rate-limit reset");
}

/**
 * Fires a rate-limited in-app notification to all active admins when a payout
 * webhook arrives but no Cashfree Payout signing secret is configured.
 *
 * ## Concurrency safety
 * `lastAlertSentAt` is set **before** the first `await`.  Because Node.js is
 * single-threaded, no two concurrent calls can both see a `null` (or expired)
 * `lastAlertSentAt` and proceed past that point simultaneously — only the
 * first caller to reach the assignment wins the slot.  If the alert operation
 * subsequently fails, the slot is released so a later request can retry.
 *
 * @param webhookCount  Number of no-secret webhook hits (typically 1 per call).
 * @param env           Human-readable environment label ("LIVE" or "SANDBOX").
 */
export async function maybeAlertPayoutWebhookNoSecret(
  webhookCount: number,
  env: string,
): Promise<void> {
  // ── Rate-limit check ───────────────────────────────────────────────────────
  if (lastAlertSentAt != null && Date.now() - lastAlertSentAt.getTime() < COOLDOWN_MS) {
    logger.debug(
      { lastAlertSentAt, cooldownMs: COOLDOWN_MS },
      "payout_webhook_no_secret_alert — suppressed within cooldown",
    );
    return;
  }

  // ── Claim the slot atomically (before first await) ─────────────────────────
  // Any concurrent call that starts between now and the next await will see
  // lastAlertSentAt != null and exit via the cooldown check above.
  // If this call ultimately fails, we release the slot in the catch block.
  lastAlertSentAt = new Date();

  try {
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

    logger.info(
      { adminCount: admins.length, webhookCount, env },
      "payout_webhook_no_secret_alert — notifications sent",
    );
  } catch (err) {
    // Release the slot so a subsequent webhook request can retry the alert.
    // A failed attempt must never be treated as a successful dispatch.
    lastAlertSentAt = null;
    logger.error({ err }, "payout_webhook_no_secret_alert — failed; slot released for retry");
  }
}
