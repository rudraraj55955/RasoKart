import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const otpSmsSettingsTable = pgTable("otp_sms_settings", {
  id: serial("id").primaryKey(),
  provider: text("provider").notNull().default("msg91"),
  apiKeyEncrypted: text("api_key_encrypted"),
  apiKeyIv: text("api_key_iv"),
  apiKeyTag: text("api_key_tag"),
  senderId: text("sender_id"),
  dltEntityId: text("dlt_entity_id"),
  dltTemplateId: text("dlt_template_id"),
  otpTemplateText: text("otp_template_text").default("Your login code is {otp}. Valid for 5 minutes. Do not share."),
  otpExpirySeconds: integer("otp_expiry_seconds").notNull().default(300),
  maxResendCount: integer("max_resend_count").notNull().default(3),
  maxVerifyAttempts: integer("max_verify_attempts").notNull().default(5),
  otpLoginEnabled: boolean("otp_login_enabled").notNull().default(false),
  smsFallbackEnabled: boolean("sms_fallback_enabled").notNull().default(false),
  fallbackProvider: text("fallback_provider"),
  fallbackApiKeyEncrypted: text("fallback_api_key_encrypted"),
  fallbackApiKeyIv: text("fallback_api_key_iv"),
  fallbackApiKeyTag: text("fallback_api_key_tag"),
  fallbackSenderId: text("fallback_sender_id"),
  fallbackDltTemplateId: text("fallback_dlt_template_id"),
  updatedByEmail: text("updated_by_email"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertOtpSmsSettingsSchema = createInsertSchema(otpSmsSettingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOtpSmsSettings = z.infer<typeof insertOtpSmsSettingsSchema>;
export type OtpSmsSettings = typeof otpSmsSettingsTable.$inferSelect;
