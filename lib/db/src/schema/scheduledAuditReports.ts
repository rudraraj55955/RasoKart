import { pgTable, serial, text, timestamp, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const scheduledAuditReportsTable = pgTable("scheduled_audit_reports", {
  id: serial("id").primaryKey(),
  frequency: text("frequency").notNull(), // daily | weekly | monthly
  recipientEmail: text("recipient_email").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  maxRetryAttempts: integer("max_retry_attempts").notNull().default(3),
  retryBackoffMinutes: integer("retry_backoff_minutes").notNull().default(60),
  lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
  failureAcknowledgedAt: timestamp("failure_acknowledged_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertScheduledAuditReportSchema = createInsertSchema(scheduledAuditReportsTable)
  .omit({ id: true, createdAt: true, updatedAt: true, lastSentAt: true });
export type InsertScheduledAuditReport = z.infer<typeof insertScheduledAuditReportSchema>;
export type ScheduledAuditReport = typeof scheduledAuditReportsTable.$inferSelect;
