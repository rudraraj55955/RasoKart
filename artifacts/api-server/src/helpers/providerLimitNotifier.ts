/**
 * Shared provider-limit notification + email logic.
 *
 * Used by:
 *  - GET /api/connections (immediate check on dashboard load)
 *  - providerLimitScheduler (hourly background scan for all merchants)
 *
 * Deduplication is enforced at the DB level via the partial unique index
 * `notifications_provider_limit_dedup_idx`, so calling these functions
 * from multiple paths concurrently is safe — the first writer wins and
 * subsequent calls are no-ops.
 */

import { db, notificationsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { sendProviderLimitEmail } from "./providerLimitEmail";
import { logger } from "../lib/logger";

/**
 * Creates provider_limit_warning / provider_limit_reached notifications
 * when usage crosses 80% or 100% of the monthly limit.
 *
 * Both thresholds are evaluated independently so that jumping straight
 * from <80% to >=100% fires both notifications.
 *
 * When a notification row is newly inserted (i.e. first crossing this
 * month), an email alert is sent to the merchant and `emailSentAt` is
 * recorded in the notification metadata.
 */
export async function maybeNotifyProviderLimit(
  userId: number,
  provider: string,
  monthlyUsed: number,
  monthlyLimit: number,
  merchantEmail: string,
  merchantName: string,
): Promise<void> {
  if (monthlyLimit <= 0) return;
  const pct = monthlyUsed / monthlyLimit;
  if (pct < 0.8) return;

  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const usedFmt = Math.round(monthlyUsed).toLocaleString("en-IN");
  const limitFmt = Math.round(monthlyLimit).toLocaleString("en-IN");
  const pctStr = Math.round(pct * 100);

  const candidates: Array<{
    type: "provider_limit_warning" | "provider_limit_reached";
    title: string;
    body: string;
  }> = [];

  if (pct >= 0.8) {
    candidates.push({
      type: "provider_limit_warning",
      title: `${provider} limit at ${pctStr}%`,
      body: `You have used ₹${usedFmt} of your ₹${limitFmt} monthly limit for ${provider}. Consider upgrading your plan or reducing usage.`,
    });
  }

  if (pct >= 1) {
    candidates.push({
      type: "provider_limit_reached",
      title: `${provider} monthly limit reached`,
      body: `You have used ₹${usedFmt} of your ₹${limitFmt} monthly limit for ${provider}. New payments via this provider may be rejected until next month.`,
    });
  }

  for (const entry of candidates) {
    // .returning() tells us whether the row was newly inserted this month
    // (first crossing) vs. a no-op conflict (already notified this month).
    const inserted = await db
      .insert(notificationsTable)
      .values({
        userId,
        type: entry.type,
        title: entry.title,
        body: entry.body,
        metadata: { provider, monthKey },
        isRead: false,
      })
      .onConflictDoNothing()
      .returning({ id: notificationsTable.id });

    if (inserted.length > 0 && merchantEmail) {
      // First crossing this month — send email alert
      const sent = await sendProviderLimitEmail({
        to: merchantEmail,
        merchantName,
        provider,
        type: entry.type,
        monthlyUsed,
        monthlyLimit,
        pctStr,
      });

      if (sent) {
        // Record emailSentAt so admins can verify the alert was delivered
        await db
          .update(notificationsTable)
          .set({ metadata: { provider, monthKey, emailSentAt: new Date().toISOString() } })
          .where(eq(notificationsTable.id, inserted[0]!.id));
      }
    }
  }
}

/**
 * Creates a `provider_limit_reset` notification when the calendar month
 * rolls over and the merchant had a provider_limit_reached notification
 * last month for the same provider. Fires at most once per provider per
 * month (partial unique index `notifications_provider_limit_reset_dedup_idx`).
 */
export async function maybeNotifyProviderLimitReset(
  userId: number,
  provider: string,
  monthlyLimit: number,
): Promise<void> {
  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthKey = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, "0")}`;

  const [prior] = await db
    .select({ id: notificationsTable.id })
    .from(notificationsTable)
    .where(
      and(
        eq(notificationsTable.userId, userId),
        eq(notificationsTable.type, "provider_limit_reached"),
        sql`${notificationsTable.metadata}->>'provider' = ${provider}`,
        sql`${notificationsTable.metadata}->>'monthKey' = ${lastMonthKey}`,
      )
    )
    .limit(1);

  if (!prior) return;

  const limitFmt = Math.round(monthlyLimit).toLocaleString("en-IN");

  await db
    .insert(notificationsTable)
    .values({
      userId,
      type: "provider_limit_reset",
      title: `${provider} monthly limit has reset`,
      body: `Your monthly limit for ${provider} has reset to ₹${limitFmt}. Payments via this provider are now available again for the new month.`,
      metadata: { provider, currentMonthKey, lastMonthKey },
      isRead: false,
    })
    .onConflictDoNothing();

  logger.info({ userId, provider }, "Provider limit reset notification created");
}
