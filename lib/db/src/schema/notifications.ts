import { pgTable, text, serial, integer, boolean, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const notificationsTable = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  type: text("type").notNull(),
  // settlement_approved | settlement_rejected | settlement_paid
  // plan_expiring | plan_expired | limit_exceeded | system_notice
  // provider_limit_warning | provider_limit_reached | provider_limit_reset
  title: text("title").notNull(),
  body: text("body").notNull(),
  metadata: jsonb("metadata"),
  isRead: boolean("is_read").notNull().default(false),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("notifications_user_idx").on(table.userId, table.isRead, table.createdAt),
  // Dedup index: at most one provider_limit_warning and one provider_limit_reached
  // per user, per provider, per billing month (monthKey = "YYYY-MM").
  // onConflictDoNothing() in maybeNotifyProviderLimit() relies on this.
  // NOTE: all columns expressed as sql`` to prevent Drizzle misassigning
  // operator classes (int4_ops/text_ops) when mixing column refs with SQL exprs.
  uniqueIndex("notifications_provider_limit_dedup_idx")
    .on(
      sql`"user_id"`,
      sql`"type"`,
      sql`((metadata->>'provider'))`,
      sql`((metadata->>'monthKey'))`,
    )
    .where(sql`type IN ('provider_limit_warning', 'provider_limit_reached')`),
  // Dedup index: at most one provider_limit_reset per user, per provider, per
  // current billing month (currentMonthKey = "YYYY-MM").
  // onConflictDoNothing() in maybeNotifyProviderLimitReset() relies on this.
  uniqueIndex("notifications_provider_limit_reset_dedup_idx")
    .on(
      sql`"user_id"`,
      sql`"type"`,
      sql`((metadata->>'provider'))`,
      sql`((metadata->>'currentMonthKey'))`,
    )
    .where(sql`type = 'provider_limit_reset'`),
]);

export type Notification = typeof notificationsTable.$inferSelect;
