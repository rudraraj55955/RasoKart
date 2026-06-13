import { pgTable, text, serial, timestamp, numeric, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const merchantsTable = pgTable("merchants", {
  id: serial("id").primaryKey(),
  businessName: text("business_name").notNull(),
  contactName: text("contact_name").notNull(),
  email: text("email").notNull().unique(),
  phone: text("phone").notNull(),
  website: text("website"),
  status: text("status").notNull().default("pending"), // pending | approved | rejected | suspended
  verificationStatus: text("verification_status").notNull().default("pending"), // pending | under_review | approved | rejected | needs_info | suspended
  rejectionReason: text("rejection_reason"),
  totalDeposits: numeric("total_deposits", { precision: 18, scale: 2 }).notNull().default("0"),
  totalWithdrawals: numeric("total_withdrawals", { precision: 18, scale: 2 }).notNull().default("0"),
  balance: numeric("balance", { precision: 18, scale: 2 }).notNull().default("0"),
  logoUrl: text("logo_url"),
  brandColor: text("brand_color"),
  callbackSecret: text("callback_secret"),
  callbackSecretUpdatedAt: timestamp("callback_secret_updated_at", { withTimezone: true }),
  callbackTimestampWindowSeconds: integer("callback_timestamp_window_seconds"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertMerchantSchema = createInsertSchema(merchantsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMerchant = z.infer<typeof insertMerchantSchema>;
export type Merchant = typeof merchantsTable.$inferSelect;
