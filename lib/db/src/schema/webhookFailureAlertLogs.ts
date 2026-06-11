import { pgTable, serial, integer, text, jsonb, timestamp } from "drizzle-orm/pg-core";

export const webhookFailureAlertLogsTable = pgTable("webhook_failure_alert_logs", {
  id: serial("id").primaryKey(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  merchantId: integer("merchant_id").notNull(),
  failedUrl: text("failed_url").notNull(),
  attemptCount: integer("attempt_count").notNull(),
  recipientCount: integer("recipient_count").notNull().default(0),
  recipientEmails: jsonb("recipient_emails").$type<string[]>().notNull().default([]),
});

export type WebhookFailureAlertLog = typeof webhookFailureAlertLogsTable.$inferSelect;
