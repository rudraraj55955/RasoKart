import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const ONBOARDING_STATUSES = [
  "INITIATED",
  "AWAITING_CONSENT",
  "CONSENTED",
  "DATA_FETCHED",
  "KYC_PENDING",
  "SUBMITTED",
  "APPROVED",
  "REJECTED",
  "RE_UPLOAD_REQUIRED",
] as const;
export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];

export const CONSENT_STATUSES = ["PENDING", "GIVEN", "DENIED"] as const;
export type ConsentStatus = (typeof CONSENT_STATUSES)[number];

export const merchantOnboardingSessionsTable = pgTable("merchant_onboarding_sessions", {
  id: serial("id").primaryKey(),
  merchantId: integer("merchant_id").notNull(),
  mobileLast4: text("mobile_last4"),
  mobileHash: text("mobile_hash"),
  verificationId: text("verification_id").notNull().unique(),
  sessionIdEncrypted: text("session_id_encrypted"),
  sessionIdIv: text("session_id_iv"),
  sessionIdTag: text("session_id_tag"),
  authCodeEncrypted: text("auth_code_encrypted"),
  authCodeIv: text("auth_code_iv"),
  authCodeTag: text("auth_code_tag"),
  accessTokenEncrypted: text("access_token_encrypted"),
  accessTokenIv: text("access_token_iv"),
  accessTokenTag: text("access_token_tag"),
  status: text("status").notNull().default("INITIATED"),
  consentStatus: text("consent_status").notNull().default("PENDING"),
  dataAvailable: boolean("data_available").default(false),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertMerchantOnboardingSessionSchema = createInsertSchema(merchantOnboardingSessionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMerchantOnboardingSession = z.infer<typeof insertMerchantOnboardingSessionSchema>;
export type MerchantOnboardingSession = typeof merchantOnboardingSessionsTable.$inferSelect;
