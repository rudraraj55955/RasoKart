import { pgTable, serial, integer, jsonb, timestamp } from "drizzle-orm/pg-core";

export const signatureFailureAlertLogsTable = pgTable("signature_failure_alert_logs", {
  id: serial("id").primaryKey(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  failureCount: integer("failure_count").notNull(),
  affectedMerchantCount: integer("affected_merchant_count").notNull().default(0),
  recipientCount: integer("recipient_count").notNull().default(0),
  recipientEmails: jsonb("recipient_emails").$type<string[]>().notNull().default([]),
  affectedMerchants: jsonb("affected_merchants")
    .$type<{ name: string; count: number }[]>()
    .notNull()
    .default([]),
  windowHours: integer("window_hours").notNull(),
  threshold: integer("threshold").notNull(),
  cooldownHours: integer("cooldown_hours").notNull().default(1),
});

export type SignatureFailureAlertLog = typeof signatureFailureAlertLogsTable.$inferSelect;
