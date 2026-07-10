import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const AUTO_KYC_STATUSES = [
  "PENDING",
  "PAN_VERIFIED",
  "AADHAAR_VERIFIED",
  "CONTACT_PENDING",
  "APPROVED",
  "MANUAL_REVIEW",
  "BLOCKED",
  "PENDING_RETRY",
  "FAILED",
  "REJECTED",
] as const;
export type AutoKycStatus = (typeof AUTO_KYC_STATUSES)[number];

export const merchantKycVerificationsTable = pgTable("merchant_kyc_verifications", {
  id: serial("id").primaryKey(),
  merchantId: integer("merchant_id").notNull().unique(),

  panNumberMasked: text("pan_number_masked"),
  panNumberHash: text("pan_number_hash"),
  panName: text("pan_name"),
  panType: text("pan_type"),
  panVerified: boolean("pan_verified").notNull().default(false),
  panVerifiedAt: timestamp("pan_verified_at", { withTimezone: true }),
  panReferenceIdEncrypted: text("pan_reference_id_encrypted"),
  panReferenceIdIv: text("pan_reference_id_iv"),
  panReferenceIdTag: text("pan_reference_id_tag"),

  aadhaarLast4: text("aadhaar_last4"),
  aadhaarNumberHash: text("aadhaar_number_hash"),
  aadhaarName: text("aadhaar_name"),
  aadhaarVerified: boolean("aadhaar_verified").notNull().default(false),
  aadhaarVerifiedAt: timestamp("aadhaar_verified_at", { withTimezone: true }),
  aadhaarReferenceIdEncrypted: text("aadhaar_reference_id_encrypted"),
  aadhaarReferenceIdIv: text("aadhaar_reference_id_iv"),
  aadhaarReferenceIdTag: text("aadhaar_reference_id_tag"),
  aadhaarDigilockerSessionEncrypted: text("aadhaar_digilocker_session_encrypted"),
  aadhaarDigilockerSessionIv: text("aadhaar_digilocker_session_iv"),
  aadhaarDigilockerSessionTag: text("aadhaar_digilocker_session_tag"),

  mobileVerified: boolean("mobile_verified").notNull().default(false),
  mobileVerifiedAt: timestamp("mobile_verified_at", { withTimezone: true }),
  emailVerified: boolean("email_verified").notNull().default(false),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),

  nameMatchScore: integer("name_match_score"),
  verificationStatus: text("verification_status").notNull().default("PENDING"),
  failureReason: text("failure_reason"),

  consentIp: text("consent_ip"),
  consentUserAgent: text("consent_user_agent"),
  consentAt: timestamp("consent_at", { withTimezone: true }),

  adminDecisionBy: text("admin_decision_by"),
  adminDecisionAt: timestamp("admin_decision_at", { withTimezone: true }),
  adminDecisionNote: text("admin_decision_note"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertMerchantKycVerificationSchema = createInsertSchema(merchantKycVerificationsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMerchantKycVerification = z.infer<typeof insertMerchantKycVerificationSchema>;
export type MerchantKycVerification = typeof merchantKycVerificationsTable.$inferSelect;
