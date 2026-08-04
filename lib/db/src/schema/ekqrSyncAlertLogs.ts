import { pgTable, serial, integer, boolean, jsonb, timestamp } from "drizzle-orm/pg-core";

export const ekqrSyncAlertLogsTable = pgTable("ekqr_sync_alert_logs", {
  id: serial("id").primaryKey(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  stuckCount: integer("stuck_count").notNull(),
  threshold: integer("threshold").notNull(),
  staleMinutes: integer("stale_minutes").notNull(),
  cooldownHours: integer("cooldown_hours"),
  suppressed: boolean("suppressed").notNull().default(false),
  recipientCount: integer("recipient_count").notNull().default(0),
  recipientEmails: jsonb("recipient_emails").$type<string[]>().notNull().default([]),
});

export type EkqrSyncAlertLog = typeof ekqrSyncAlertLogsTable.$inferSelect;
