import { pgTable, serial, integer, boolean, text, timestamp } from "drizzle-orm/pg-core";
import { reportSchedulesTable } from "./reportSchedules";

export const reportDeliveryLogsTable = pgTable("report_delivery_logs", {
  id: serial("id").primaryKey(),
  scheduleId: integer("schedule_id")
    .notNull()
    .references(() => reportSchedulesTable.id, { onDelete: "cascade" }),
  merchantId: integer("merchant_id").notNull(),
  attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
  success: boolean("success").notNull(),
  failureReason: text("failure_reason"),
  isAutoPause: boolean("is_auto_pause").notNull().default(false),
  frequency: text("frequency"),
  format: text("format"),
  outcome: text("outcome"),
  triggeredBy: text("triggered_by"),
  triggeredByEmail: text("triggered_by_email"),
  performedByAdminId: integer("performed_by_admin_id"),
  performedByAdminEmail: text("performed_by_admin_email"),
});

export type ReportDeliveryLog = typeof reportDeliveryLogsTable.$inferSelect;
