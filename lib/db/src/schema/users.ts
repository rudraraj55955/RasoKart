import { pgTable, text, serial, timestamp, boolean, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"),
  name: text("name").notNull(),
  role: text("role").notNull().default("merchant"), // admin | merchant | payout_merchant | payout_admin | payout_super_admin | agent
  isActive: boolean("is_active").notNull().default(true),
  isSuperAdmin: boolean("is_super_admin").notNull().default(false),
  merchantId: integer("merchant_id"),
  reconciliationAlertEmails: boolean("reconciliation_alert_emails").notNull().default(true),
  planExpiryAlertEmails: boolean("plan_expiry_alert_emails").notNull().default(true),
  settlementStateEmails: boolean("settlement_state_emails").notNull().default(true),
  signatureFailureAlertEmails: boolean("signature_failure_alert_emails").notNull().default(true),
  webhookFailureEmails: boolean("webhook_failure_emails").notNull().default(true),
  ekqrSyncAlertEmails: boolean("ekqr_sync_alert_emails").notNull().default(true),
  reportFailureAlertEmails: boolean("report_failure_alert_emails").notNull().default(true),
  githubSyncFailureAlertEmails: boolean("github_sync_failure_alert_emails").notNull().default(true),
  weeklyDeliveryDigestEmails: boolean("weekly_delivery_digest_emails").notNull().default(true),
  apiKeyGeneratedEmails: boolean("api_key_generated_emails").notNull().default(true),
  apiKeyRevokedEmails: boolean("api_key_revoked_emails").notNull().default(true),
  loginAlertEmails: boolean("login_alert_emails").notNull().default(true),
  reportScheduleChangedEmails: boolean("report_schedule_changed_emails").notNull().default(true),
  settlementStateChangedEmails: boolean("settlement_state_changed_emails").notNull().default(true),
  planChangeEmails: boolean("plan_change_emails").notNull().default(true),
  reconciliationAlertNotifs: boolean("reconciliation_alert_notifs").notNull().default(true),
  planExpiryAlertNotifs: boolean("plan_expiry_alert_notifs").notNull().default(true),
  settlementStateNotifs: boolean("settlement_state_notifs").notNull().default(true),
  signatureFailureAlertNotifs: boolean("signature_failure_alert_notifs").notNull().default(true),
  webhookFailureNotifs: boolean("webhook_failure_notifs").notNull().default(true),
  ekqrSyncAlertNotifs: boolean("ekqr_sync_alert_notifs").notNull().default(true),
  reportFailureAlertNotifs: boolean("report_failure_alert_notifs").notNull().default(true),
  weeklyDeliveryDigestNotifs: boolean("weekly_delivery_digest_notifs").notNull().default(true),
  apiKeyGeneratedNotifs: boolean("api_key_generated_notifs").notNull().default(true),
  apiKeyRevokedNotifs: boolean("api_key_revoked_notifs").notNull().default(true),
  loginAlertNotifs: boolean("login_alert_notifs").notNull().default(true),
  reportScheduleChangedNotifs: boolean("report_schedule_changed_notifs").notNull().default(true),
  settlementStateChangedNotifs: boolean("settlement_state_changed_notifs").notNull().default(true),
  planChangeNotifs: boolean("plan_change_notifs").notNull().default(true),
  notifReminderEmails: boolean("notif_reminder_emails").notNull().default(true),
  reportsBadgeSnoozedUntil: timestamp("reports_badge_snoozed_until", { withTimezone: true }),
  badgeSnoozedUntil: jsonb("badge_snoozed_until").$type<Record<string, string>>(),
  notifPrefsDisabledAt: timestamp("notif_prefs_disabled_at", { withTimezone: true }),
  notifReminderSentAt: timestamp("notif_reminder_sent_at", { withTimezone: true }),
  notifFieldDisabledAt: jsonb("notif_field_disabled_at").$type<Record<string, string>>(),
  canManagePayoutProviderCredentials: boolean("can_manage_payout_provider_credentials").notNull().default(false),
  permissionsJson: jsonb("permissions_json").$type<Record<string, boolean>>(),
  quietHoursStart: text("quiet_hours_start"),
  quietHoursEnd: text("quiet_hours_end"),
  quietHoursTimezone: text("quiet_hours_timezone"),
  lastSeenIp: text("last_seen_ip"),
  passwordUpdatedAt: timestamp("password_updated_at", { withTimezone: true }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  lastLoginMethod: text("last_login_method"), // password | otp | google | apple | microsoft | facebook
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
