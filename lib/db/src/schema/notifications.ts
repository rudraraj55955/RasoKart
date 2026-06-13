import { pgTable, text, serial, integer, boolean, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const notificationsTable = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  type: text("type").notNull(),
  // settlement_approved | settlement_rejected | settlement_paid
  // plan_expiring | plan_expired | limit_exceeded | system_notice
  // provider_limit_warning | provider_limit_reached | provider_limit_reset
  // scheduled_report_retry_success | merchant_dormant
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
  // Dedup index: at most one merchant_dormant alert per admin user per dormancy
  // event (keyed by dedupeKey = "merchant_dormant_<merchantId>_<thresholdDate>").
  // onConflictDoNothing() in runDormantMerchantScan() relies on this.
  uniqueIndex("notifications_merchant_dormant_dedup_idx")
    .on(
      sql`"user_id"`,
      sql`"type"`,
      sql`((metadata->>'dedupeKey'))`,
    )
    .where(sql`type = 'merchant_dormant'`),
  // Dedup index: at most one scheduled_report_overdue alert per admin user per
  // overdue event (keyed by dedupeKey = "report_overdue_<kind>_<scheduleId>_<YYYY-MM-DD>").
  // onConflictDoNothing() in runOverdueReportScan() relies on this.
  uniqueIndex("notifications_report_overdue_dedup_idx")
    .on(
      sql`"user_id"`,
      sql`"type"`,
      sql`((metadata->>'dedupeKey'))`,
    )
    .where(sql`type = 'scheduled_report_overdue'`),
  // Dedup index: at most one report_schedule_auto_paused_admin alert per admin user
  // per schedule auto-pause event (keyed by scheduleId in metadata).
  // If the scheduler fires twice in a short window, the second insert is silently
  // dropped by onConflictDoNothing() in handleReportFailure().
  uniqueIndex("notifications_report_auto_paused_admin_dedup_idx")
    .on(
      sql`"user_id"`,
      sql`"type"`,
      sql`((metadata->>'scheduleId'))`,
    )
    .where(sql`type = 'report_schedule_auto_paused_admin' AND is_read = false`),
  // Dedup index: at most one scheduled_report_failure alert per merchant user per
  // schedule per consecutive-failure count. Prevents duplicate "attempt N of M"
  // alerts if the scheduler fires twice before the counter increments.
  // onConflictDoNothing() in handleReportFailure() relies on this.
  uniqueIndex("notifications_scheduled_report_failure_dedup_idx")
    .on(
      sql`"user_id"`,
      sql`"type"`,
      sql`((metadata->>'scheduleId'))`,
      sql`((metadata->>'consecutiveFailures'))`,
    )
    .where(sql`type = 'scheduled_report_failure'`),
  // Dedup index: at most one scheduled_report_auto_paused alert per merchant user
  // per schedule auto-pause event (keyed by scheduleId in metadata).
  // onConflictDoNothing() in handleReportFailure() relies on this.
  uniqueIndex("notifications_scheduled_report_auto_paused_dedup_idx")
    .on(
      sql`"user_id"`,
      sql`"type"`,
      sql`((metadata->>'scheduleId'))`,
    )
    .where(sql`type = 'scheduled_report_auto_paused'`),
]);

export type Notification = typeof notificationsTable.$inferSelect;
