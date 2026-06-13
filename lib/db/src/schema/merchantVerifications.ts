import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { merchantsTable } from "./merchants";

export const VERIFICATION_STATUSES = ["pending", "under_review", "approved", "rejected", "needs_info", "suspended"] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const merchantVerificationsTable = pgTable(
  "merchant_verifications",
  {
    id: serial("id").primaryKey(),
    merchantId: integer("merchant_id").notNull().unique().references(() => merchantsTable.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    // Business info
    businessName: text("business_name"),
    ownerName: text("owner_name"),
    mobile: text("mobile"),
    email: text("email"),
    pan: text("pan"),
    gst: text("gst"),
    businessType: text("business_type"),
    websiteUrl: text("website_url"),
    address: text("address"),
    // Financial info
    expectedMonthlyVolume: text("expected_monthly_volume"),
    useCase: text("use_case"),
    // Banking details
    bankAccountName: text("bank_account_name"),
    bankAccountNumber: text("bank_account_number"),
    ifscCode: text("ifsc_code"),
    upiId: text("upi_id"),
    // Review fields
    adminNote: text("admin_note"),
    reviewedBy: integer("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    index("merchant_verifications_merchant_id_idx").on(table.merchantId),
    index("merchant_verifications_status_idx").on(table.status),
  ]
);

export const insertMerchantVerificationSchema = createInsertSchema(merchantVerificationsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertMerchantVerification = z.infer<typeof insertMerchantVerificationSchema>;
export type MerchantVerification = typeof merchantVerificationsTable.$inferSelect;
