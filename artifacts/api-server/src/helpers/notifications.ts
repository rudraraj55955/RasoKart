import { db, notificationsTable } from "@workspace/db";

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
  | "report_schedule_auto_paused_admin"
  | "report_manual_send"
  | "merchant_dormant"
  | "kyc_approved"
  | "kyc_rejected"
  | "kyc_status_updated";

export interface CreateNotificationInput {
  userId: number;
  type: NotificationType;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
}

export async function createNotification(input: CreateNotificationInput, opts?: { onConflictDoNothing?: boolean }) {
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

export async function createBulkNotifications(inputs: CreateNotificationInput[], opts?: { onConflictDoNothing?: boolean }) {
  if (inputs.length === 0) return [];
  const query = db.insert(notificationsTable).values(inputs.map(i => ({
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
