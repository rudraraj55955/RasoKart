import { db, notificationsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export type NotificationType =
  | "settlement_approved"
  | "settlement_rejected"
  | "settlement_paid"
  | "plan_expiring"
  | "plan_expired"
  | "limit_exceeded"
  | "system_notice"
  | "webhook_failure"
  | "reconciliation_email_failure"
  | "scheduled_report_failure"
  | "scheduled_report_retry_success"
  | "scheduled_report_auto_paused"
  | "scheduled_report_overdue"
  | "report_schedule_deleted"
  | "report_schedule_next_run_updated"
  | "report_schedule_reenabled"
  | "report_schedule_reenabled_by_merchant"
  | "report_schedule_auto_paused_admin"
  | "report_schedule_failures_reset"
  | "report_manual_send"
  | "merchant_dormant"
  | "kyc_approved"
  | "kyc_rejected"
  | "kyc_status_updated"
  | "report_delivery_low_success_rate"
  | "preference_change_unknown_device"
  | "gateway_failover_exhausted"
  | "gateway_recovered"
  | "cleanup_failure_repeated";

type InAppPrefField = keyof Pick<
  typeof usersTable.$inferSelect,
  | "reconciliationAlertNotifs"
  | "planExpiryAlertNotifs"
  | "settlementStateNotifs"
  | "signatureFailureAlertNotifs"
  | "webhookFailureNotifs"
  | "ekqrSyncAlertNotifs"
  | "reportFailureAlertNotifs"
  | "weeklyDeliveryDigestNotifs"
  | "apiKeyGeneratedNotifs"
  | "apiKeyRevokedNotifs"
  | "loginAlertNotifs"
  | "reportScheduleChangedNotifs"
  | "settlementStateChangedNotifs"
  | "planChangeNotifs"
>;

const NOTIF_TYPE_TO_PREF: Partial<Record<NotificationType, InAppPrefField>> = {
  settlement_approved: "settlementStateChangedNotifs",
  settlement_rejected: "settlementStateChangedNotifs",
  settlement_paid: "settlementStateChangedNotifs",
  plan_expiring: "planExpiryAlertNotifs",
  plan_expired: "planExpiryAlertNotifs",
  webhook_failure: "webhookFailureNotifs",
  reconciliation_email_failure: "reconciliationAlertNotifs",
  scheduled_report_failure: "reportFailureAlertNotifs",
  scheduled_report_retry_success: "reportFailureAlertNotifs",
  scheduled_report_auto_paused: "reportFailureAlertNotifs",
  scheduled_report_overdue: "reportFailureAlertNotifs",
  report_schedule_deleted: "reportScheduleChangedNotifs",
  report_schedule_next_run_updated: "reportScheduleChangedNotifs",
  report_schedule_reenabled: "reportScheduleChangedNotifs",
  report_schedule_reenabled_by_merchant: "reportScheduleChangedNotifs",
  report_schedule_auto_paused_admin: "reportScheduleChangedNotifs",
  report_schedule_failures_reset: "reportScheduleChangedNotifs",
  report_manual_send: "reportScheduleChangedNotifs",
  report_delivery_low_success_rate: "weeklyDeliveryDigestNotifs",
  preference_change_unknown_device: "loginAlertNotifs",
};

export interface CreateNotificationInput {
  userId: number;
  type: NotificationType;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
}

async function isInAppPrefEnabled(userId: number, type: NotificationType): Promise<boolean> {
  const prefField = NOTIF_TYPE_TO_PREF[type];
  if (!prefField) return true;

  const [row] = await db
    .select({ pref: usersTable[prefField] })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (!row) return true;
  return row.pref !== false;
}

export async function createNotification(input: CreateNotificationInput, opts?: { onConflictDoNothing?: boolean; skipPrefCheck?: boolean }) {
  if (!opts?.skipPrefCheck) {
    const enabled = await isInAppPrefEnabled(input.userId, input.type);
    if (!enabled) return undefined;
  }

  const query = db.insert(notificationsTable).values({
    userId: input.userId,
    type: input.type,
    title: input.title,
    body: input.body,
    metadata: input.metadata ?? null,
  });
  if (opts?.onConflictDoNothing) {
    const [row] = await query.onConflictDoNothing().returning();
    return row;
  }
  const [row] = await query.returning();
  return row;
}

export async function createBulkNotifications(inputs: CreateNotificationInput[], opts?: { onConflictDoNothing?: boolean; skipPrefCheck?: boolean }) {
  if (inputs.length === 0) return [];

  let filtered = inputs;
  if (!opts?.skipPrefCheck) {
    const results = await Promise.all(
      inputs.map(async (input) => {
        const enabled = await isInAppPrefEnabled(input.userId, input.type);
        return enabled ? input : null;
      })
    );
    filtered = results.filter((i): i is CreateNotificationInput => i !== null);
    if (filtered.length === 0) return [];
  }

  const query = db.insert(notificationsTable).values(filtered.map(i => ({
    userId: i.userId,
    type: i.type,
    title: i.title,
    body: i.body,
    metadata: i.metadata ?? null,
  })));
  if (opts?.onConflictDoNothing) {
    return query.onConflictDoNothing().returning();
  }
  return query.returning();
}
