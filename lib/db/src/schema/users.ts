import { pgTable, text, serial, timestamp, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull().default("merchant"), // admin | merchant
  isActive: boolean("is_active").notNull().default(true),
  merchantId: integer("merchant_id"),
  reconciliationAlertEmails: boolean("reconciliation_alert_emails").notNull().default(true),
  planExpiryAlertEmails: boolean("plan_expiry_alert_emails").notNull().default(true),
  settlementStateEmails: boolean("settlement_state_emails").notNull().default(true),
  signatureFailureAlertEmails: boolean("signature_failure_alert_emails").notNull().default(true),
  webhookFailureEmails: boolean("webhook_failure_emails").notNull().default(true),
  ekqrSyncAlertEmails: boolean("ekqr_sync_alert_emails").notNull().default(true),
  reportFailureAlertEmails: boolean("report_failure_alert_emails").notNull().default(true),
  apiKeyGeneratedEmails: boolean("api_key_generated_emails").notNull().default(true),
  apiKeyRevokedEmails: boolean("api_key_revoked_emails").notNull().default(true),
  loginAlertEmails: boolean("login_alert_emails").notNull().default(true),
  reportScheduleChangedEmails: boolean("report_schedule_changed_emails").notNull().default(true),
  settlementStateChangedEmails: boolean("settlement_state_changed_emails").notNull().default(true),
  lastSeenIp: text("last_seen_ip"),
  passwordUpdatedAt: timestamp("password_updated_at", { withTimezone: true }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
