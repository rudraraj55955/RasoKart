/**
 * Rate-limited in-app admin alert for payout webhooks received with no
 * signing secret configured.
 *
 * ## Cooldown enforcement — two layers
 *
 * 1. **In-process fast path** (`lastAlertSentAt`): avoids a DB round-trip when
 *    the same process already fired the alert within this UTC hour.  The slot is
 *    claimed synchronously — before the first `await` — so concurrent requests
 *    in the same Node.js event-loop process cannot both pass the gate and both
 *    send an alert.
 *
 * 2. **Durable DB dedup** (unique index on `notifications`): even if the fast
 *    path is bypassed — process restart, multiple instances — the unique index
 *    `notifications_payout_no_secret_dedup_idx` on `(user_id, type, dedupeKey)`
 *    (where `dedupeKey` is the current UTC-hour prefix "YYYY-MM-DDTHH") silently
 *    drops duplicate inserts via `onConflictDoNothing`.  The first instance to
 *    insert wins; all others are safely no-ops.
 *
 * ## Recipient scope
 * All active users with role `admin`, `payout_admin`, or `payout_super_admin`
 * receive the alert.  Platform admins can escalate; payout admins can remediate.
 */
import { db, usersTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { logger } from "../lib/logger";
import { createBulkNotifications, type NotificationType } from "./notifications";

const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour (matches the UTC-hour dedupeKey window)

/** Roles that should receive payout-misconfiguration alerts. */
const PAYOUT_ALERT_ROLES = ["admin", "payout_admin", "payout_super_admin"] as const;

/** Timestamp of the most recent successfully dispatched alert (in-process fast path). */
let lastAlertSentAt: Date | null = null;

export function resetPayoutNoSecretAlertRateLimit(): void {
  lastAlertSentAt = null;
  logger.info("Payout-webhook no-secret alert rate-limit reset");
}

/**
 * Fires a rate-limited in-app notification to all active platform-admin and
 * payout-admin users when a payout webhook arrives but no Cashfree Payout
 * signing secret is configured.
 *
 * @param webhookCount  Number of no-secret webhook hits (typically 1 per call).
 * @param env           Human-readable environment label ("LIVE" or "SANDBOX").
 */
export async function maybeAlertPayoutWebhookNoSecret(
  webhookCount: number,
  env: string,
): Promise<void> {
  // ── In-process rate-limit check (fast path) ────────────────────────────────
  if (lastAlertSentAt != null && Date.now() - lastAlertSentAt.getTime() < COOLDOWN_MS) {
    logger.debug(
      { lastAlertSentAt, cooldownMs: COOLDOWN_MS },
      "payout_webhook_no_secret_alert — suppressed within cooldown (in-process)",
    );
    return;
  }

  // ── Claim the slot atomically (before first await) ─────────────────────────
  // No other concurrent call in this process can both see the old value AND
  // reach this point — everything between the check above and this assignment
  // is synchronous (single JS event-loop turn).  If the alert subsequently
  // fails the slot is released in the catch block so a later call can retry.
  lastAlertSentAt = new Date();

  // dedupeKey = current UTC hour, e.g. "2026-08-14T17".
  // The DB unique index enforces at-most-one notification per (user, type, hour)
  // across all processes and restarts.
  const dedupeKey = new Date().toISOString().slice(0, 13);

  try {
    const recipients = await db
      .select({ id: usersTable.id, role: usersTable.role })
      .from(usersTable)
      .where(
        and(
          inArray(usersTable.role, [...PAYOUT_ALERT_ROLES]),
          eq(usersTable.isActive, true),
        )
      );

    if (recipients.length === 0) {
      logger.warn("payout_webhook_no_secret_alert — no eligible admin/payout-admin users to notify");
      return;
    }

    const type: NotificationType = "payout_webhook_no_secret";
    const title = "Payout Webhook Secret Not Configured";
    const body =
      `${webhookCount} payout webhook${webhookCount === 1 ? "" : "s"} ` +
      `received on the ${env} environment but no Cashfree Payout signing secret ` +
      `is configured. Payouts will not complete until a secret is set in ` +
      `Admin → Settings → Cashfree Payout.`;

    // skipPrefCheck: mandatory misconfiguration alert — not subject to per-user preferences.
    // onConflictDoNothing: DB unique index (notifications_payout_no_secret_dedup_idx)
    //   silently drops duplicate inserts for the same user+type+dedupeKey,
    //   providing durable cross-instance deduplication within the UTC hour.
    await createBulkNotifications(
      recipients.map((r) => ({
        userId: r.id,
        type,
        title,
        body,
        metadata: { webhookCount, env, dedupeKey } as Record<string, unknown>,
      })),
      { skipPrefCheck: true, onConflictDoNothing: true },
    );

    logger.info(
      { recipientCount: recipients.length, webhookCount, env, dedupeKey },
      "payout_webhook_no_secret_alert — notifications sent",
    );
  } catch (err) {
    // Release the in-process slot so a subsequent webhook request can retry.
    // A failed attempt must never be treated as a successful dispatch.
    lastAlertSentAt = null;
    logger.error({ err }, "payout_webhook_no_secret_alert — failed; slot released for retry");
  }
}
