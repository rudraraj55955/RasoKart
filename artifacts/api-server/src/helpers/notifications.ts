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
  | "reconciliation_email_failure";

export interface CreateNotificationInput {
  userId: number;
  type: NotificationType;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
}

export async function createNotification(input: CreateNotificationInput) {
  const [row] = await db.insert(notificationsTable).values({
    userId: input.userId,
    type: input.type,
    title: input.title,
    body: input.body,
    metadata: input.metadata ?? null,
  }).returning();
  return row;
}

export async function createBulkNotifications(inputs: CreateNotificationInput[]) {
  if (inputs.length === 0) return [];
  return db.insert(notificationsTable).values(inputs.map(i => ({
    userId: i.userId,
    type: i.type,
    title: i.title,
    body: i.body,
    metadata: i.metadata ?? null,
  }))).returning();
}
