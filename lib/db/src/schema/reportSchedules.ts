import { pgTable, serial, integer, text, boolean, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const reportSchedulesTable = pgTable("report_schedules", {
  id: serial("id").primaryKey(),
  merchantId: integer("merchant_id").notNull(),
  frequency: text("frequency").notNull(), // weekly | monthly
  format: text("format").notNull().default("xlsx"), // xlsx | pdf
  isActive: boolean("is_active").notNull().default(true),
  dayOfWeek: integer("day_of_week"), // 0=Sun, 1=Mon, ..., 6=Sat — null means rolling 7-day cadence
  dayOfMonth: integer("day_of_month"), // 1–28 — null means rolling 30-day cadence
  lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("report_schedules_merchant_unique_idx").on(table.merchantId),
]);

export const insertReportScheduleSchema = createInsertSchema(reportSchedulesTable)
  .omit({ id: true, createdAt: true, updatedAt: true, lastSentAt: true });
export type InsertReportSchedule = z.infer<typeof insertReportScheduleSchema>;
export type ReportSchedule = typeof reportSchedulesTable.$inferSelect;
