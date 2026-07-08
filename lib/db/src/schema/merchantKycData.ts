import { pgTable, text, serial, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const KYC_VERIFICATION_STATUSES = ["PENDING", "VERIFIED", "FAILED", "SKIPPED", "MISMATCH"] as const;
export type KycVerificationStatus = (typeof KYC_VERIFICATION_STATUSES)[number];

export const KYC_ADMIN_DECISIONS = ["PENDING", "APPROVED", "REJECTED", "RE_UPLOAD_REQUIRED"] as const;
export type KycAdminDecision = (typeof KYC_ADMIN_DECISIONS)[number];

export const merchantKycDataTable = pgTable("merchant_kyc_data", {
  id: serial("id").primaryKey(),
  merchantId: integer("merchant_id").notNull().unique(),
  onboardingSessionId: integer("onboarding_session_id"),
  fullName: text("full_name"),
  dob: text("dob"),
  gender: text("gender"),
  email: text("email"),
  panMasked: text("pan_masked"),
  aadhaarLast4: text("aadhaar_last4"),
  addressLine1: text("address_line1"),
  addressLine2: text("address_line2"),
  city: text("city"),
  stateName: text("state_name"),
  pincode: text("pincode"),
  businessName: text("business_name"),
  gstinMasked: text("gstin_masked"),
  cinNumber: text("cin_number"),
  bankAccountMasked: text("bank_account_masked"),
  bankIfsc: text("bank_ifsc"),
  bankName: text("bank_name"),
  bankHolderName: text("bank_holder_name"),
  panStatus: text("pan_status").default("PENDING"),
  aadhaarStatus: text("aadhaar_status").default("PENDING"),
  gstStatus: text("gst_status").default("SKIPPED"),
  cinStatus: text("cin_status").default("SKIPPED"),
  udyamNumber: text("udyam_number"),
  udyamStatus: text("udyam_status").default("SKIPPED"),
  bankStatus: text("bank_status").default("PENDING"),
  riskScore: integer("risk_score").default(0),
  mismatchFlags: jsonb("mismatch_flags"),
  adminDecision: text("admin_decision").notNull().default("PENDING"),
  rejectionReason: text("rejection_reason"),
  approvedBy: text("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertMerchantKycDataSchema = createInsertSchema(merchantKycDataTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMerchantKycData = z.infer<typeof insertMerchantKycDataSchema>;
export type MerchantKycData = typeof merchantKycDataTable.$inferSelect;
