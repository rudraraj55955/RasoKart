import { db, merchantsTable, usersTable, notificationsTable } from "@workspace/db";
import { eq, and, isNotNull, lt, sql } from "drizzle-orm";
import { createBulkNotifications } from "./notifications";
import { sendWebhookSecretRotationEmail } from "./webhookSecretRotationEmail";

const REMINDER_DAYS = 75;
const OVERDUE_DAYS = 90;

/**
 * Scans all merchants whose callback secret is 75+ days old and creates
 * in-app notifications:
 *  - 75–89 days old  → webhook_secret_rotation_reminder  (dedupe: once per calendar week)
 *  - 90+ days old    → webhook_secret_rotation_overdue   (dedupe: once per calendar day)
 *
 * Safe to call repeatedly — deduplication keys prevent spam.
 */
export async function checkWebhookSecretRotation(): Promise<{
  merchantsScanned: number;
  reminderCount: number;
  overdueCount: number;
  notificationsSent: number;
  emailsSent: number;
}> {
  const now = new Date();
  const reminderThreshold = new Date(now.getTime() - REMINDER_DAYS * 24 * 60 * 60 * 1000);
  const overdueThreshold  = new Date(now.getTime() - OVERDUE_DAYS  * 24 * 60 * 60 * 1000);

  // Fetch merchants whose secret was last rotated before the 75-day threshold
  const stale = await db
    .select({
      merchantId: merchantsTable.id,
      businessName: merchantsTable.businessName,
      email: merchantsTable.email,
      callbackSecretUpdatedAt: merchantsTable.callbackSecretUpdatedAt,
      userId: usersTable.id,
    })
    .from(merchantsTable)
    .innerJoin(usersTable, eq(usersTable.merchantId, merchantsTable.id))
    .where(
      and(
        isNotNull(merchantsTable.callbackSecret),
        isNotNull(merchantsTable.callbackSecretUpdatedAt),
        lt(merchantsTable.callbackSecretUpdatedAt, reminderThreshold),
        eq(usersTable.isActive, true),
      ),
    );

  if (stale.length === 0) {
    return { merchantsScanned: 0, reminderCount: 0, overdueCount: 0, notificationsSent: 0, emailsSent: 0 };
  }

  const todayStr  = now.toISOString().slice(0, 10);           // YYYY-MM-DD
  const weekStart = getISOWeekStart(now).toISOString().slice(0, 10); // week bucket

  const toInsert: Parameters<typeof createBulkNotifications>[0] = [];
  const pendingEmails: Array<{ to: string; businessName: string; daysSince: number; isOverdue: boolean }> = [];
  let reminderCount = 0;
  let overdueCount  = 0;

  for (const row of stale) {
    if (!row.userId || !row.callbackSecretUpdatedAt) continue;

    const isOverdue = row.callbackSecretUpdatedAt < overdueThreshold;

    if (isOverdue) {
      // Dedupe: at most one overdue notification per user per calendar day
      const dedupeKey = `webhook_secret_overdue_${todayStr}`;
      const [existing] = await db
        .select({ id: notificationsTable.id })
        .from(notificationsTable)
        .where(
          and(
            eq(notificationsTable.userId, row.userId),
            eq(notificationsTable.type, "webhook_secret_rotation_overdue"),
            sql`${notificationsTable.metadata}->>'dedupeKey' = ${dedupeKey}`,
          ),
        )
        .limit(1);
      if (existing) continue;

      overdueCount++;
      const daysSince = Math.floor((now.getTime() - row.callbackSecretUpdatedAt.getTime()) / (24 * 60 * 60 * 1000));
      toInsert.push({
        userId: row.userId,
        type: "webhook_secret_rotation_overdue",
        title: "Callback Secret Overdue for Rotation",
        body: `Your callback secret is ${daysSince} days old and is overdue for rotation. Please rotate it now to maintain webhook security. Go to Settings → Webhook to update.`,
        metadata: {
          dedupeKey,
          merchantId: row.merchantId,
          daysSince,
          lastRotatedAt: row.callbackSecretUpdatedAt.toISOString(),
          actionUrl: "/merchant/webhook",
        },
      });
      pendingEmails.push({ to: row.email, businessName: row.businessName, daysSince, isOverdue: true });
    } else {
      // Reminder tier (75–89 days): dedupe once per ISO week
      const dedupeKey = `webhook_secret_reminder_${weekStart}`;
      const [existing] = await db
        .select({ id: notificationsTable.id })
        .from(notificationsTable)
        .where(
          and(
            eq(notificationsTable.userId, row.userId),
            eq(notificationsTable.type, "webhook_secret_rotation_reminder"),
            sql`${notificationsTable.metadata}->>'dedupeKey' = ${dedupeKey}`,
          ),
        )
        .limit(1);
      if (existing) continue;

      reminderCount++;
      const daysSince = Math.floor((now.getTime() - row.callbackSecretUpdatedAt.getTime()) / (24 * 60 * 60 * 1000));
      toInsert.push({
        userId: row.userId,
        type: "webhook_secret_rotation_reminder",
        title: "Callback Secret Rotation Recommended",
        body: `Your callback secret is ${daysSince} days old. We recommend rotating it every 90 days to keep your webhook integrations secure. Go to Settings → Webhook to rotate.`,
        metadata: {
          dedupeKey,
          merchantId: row.merchantId,
          daysSince,
          lastRotatedAt: row.callbackSecretUpdatedAt.toISOString(),
          actionUrl: "/merchant/webhook",
        },
      });
      pendingEmails.push({ to: row.email, businessName: row.businessName, daysSince, isOverdue: false });
    }
  }

  if (toInsert.length > 0) {
    await createBulkNotifications(toInsert);
  }

  // Send emails — fire-and-forget with allSettled so one failure doesn't block others
  let emailsSent = 0;
  if (pendingEmails.length > 0) {
    const emailResults = await Promise.allSettled(
      pendingEmails.map(e => sendWebhookSecretRotationEmail(e)),
    );
    emailsSent = emailResults.filter(r => r.status === "fulfilled" && r.value === true).length;
  }

  return {
    merchantsScanned: stale.length,
    reminderCount,
    overdueCount,
    notificationsSent: toInsert.length,
    emailsSent,
  };
}

/**
 * When a merchant successfully rotates their secret, mark any unread
 * rotation reminders/overdue notifications as read so they don't linger
 * in the notification centre.
 */
export async function dismissSecretRotationNotifications(userId: number): Promise<void> {
  await db
    .update(notificationsTable)
    .set({ isRead: true, readAt: new Date() })
    .where(
      and(
        eq(notificationsTable.userId, userId),
        eq(notificationsTable.isRead, false),
        sql`${notificationsTable.type} IN ('webhook_secret_rotation_reminder', 'webhook_secret_rotation_overdue')`,
      ),
    );
}

function getISOWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getUTCDay();
  const diff = (day === 0 ? -6 : 1 - day); // Monday as week start
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}
