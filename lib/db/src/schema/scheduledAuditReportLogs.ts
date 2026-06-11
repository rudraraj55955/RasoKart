import { pgTable, serial, integer, boolean, text, timestamp } from "drizzle-orm/pg-core";
import { scheduledAuditReportsTable } from "./scheduledAuditReports";

export const scheduledAuditReportLogsTable = pgTable("scheduled_audit_report_logs", {
  id: serial("id").primaryKey(),
  scheduleId: integer("schedule_id")
    .notNull()
    .references(() => scheduledAuditReportsTable.id, { onDelete: "cascade" }),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  rowCount: integer("row_count").notNull().default(0),
  success: boolean("success").notNull(),
  errorMessage: text("error_message"),
  isRetry: boolean("is_retry").notNull().default(false),
});

export type ScheduledAuditReportLog = typeof scheduledAuditReportLogsTable.$inferSelect;
