import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";

export const signatureFailureAlertLogsTable = pgTable("signature_failure_alert_logs", {
  id: serial("id").primaryKey(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  failureCount: integer("failure_count").notNull(),
  affectedMerchantCount: integer("affected_merchant_count").notNull(),
  recipientCount: integer("recipient_count").notNull(),
  recipientEmails: text("recipient_emails").notNull(),
  affectedMerchants: text("affected_merchants").notNull(),
  windowHours: integer("window_hours").notNull(),
  threshold: integer("threshold").notNull(),
});

export type SignatureFailureAlertLog = typeof signatureFailureAlertLogsTable.$inferSelect;
