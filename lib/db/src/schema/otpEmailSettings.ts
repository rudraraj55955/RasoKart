import { pgTable, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";

export const otpEmailSettingsTable = pgTable("otp_email_settings", {
  id: integer("id").primaryKey(),
  otpExpirySeconds: integer("otp_expiry_seconds").notNull().default(600),
  otpLoginEnabled: boolean("otp_login_enabled").notNull().default(false),
  testVerifiedAt: timestamp("test_verified_at", { withTimezone: true }),
  updatedByEmail: text("updated_by_email"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type OtpEmailSettings = typeof otpEmailSettingsTable.$inferSelect;
