import { pgTable, text, serial, integer, boolean, timestamp, jsonb, index } from "drizzle-orm/pg-core";

export const notificationsTable = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  type: text("type").notNull(),
  // settlement_approved | settlement_rejected | settlement_paid
  // plan_expiring | plan_expired | limit_exceeded | system_notice
  title: text("title").notNull(),
  body: text("body").notNull(),
  metadata: jsonb("metadata"),
  isRead: boolean("is_read").notNull().default(false),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("notifications_user_idx").on(table.userId, table.isRead, table.createdAt),
]);

export type Notification = typeof notificationsTable.$inferSelect;
