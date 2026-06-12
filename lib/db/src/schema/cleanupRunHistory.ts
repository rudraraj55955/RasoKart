import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";

export const cleanupRunHistoryTable = pgTable("cleanup_run_history", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(),
  trigger: text("trigger").notNull().default("scheduled"),
  ranAt: timestamp("ran_at", { withTimezone: true }).notNull().defaultNow(),
  expired: integer("expired"),
  closed: integer("closed"),
  deleted: integer("deleted").notNull().default(0),
  retentionDays: integer("retention_days").notNull().default(0),
  triggeredBy: text("triggered_by").notNull().default("scheduled"),
});

export type CleanupRunHistory = typeof cleanupRunHistoryTable.$inferSelect;
