import { pgTable, text, serial, integer, timestamp, boolean } from "drizzle-orm/pg-core";

export const quietHoursQueueTable = pgTable("quiet_hours_queue", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  to: text("to").notNull(),
  subject: text("subject").notNull(),
  html: text("html").notNull(),
  deliverAfter: timestamp("deliver_after", { withTimezone: true }).notNull(),
  flushed: boolean("flushed").notNull().default(false),
  flushedAt: timestamp("flushed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type QuietHoursQueueEntry = typeof quietHoursQueueTable.$inferSelect;
