import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const merchantAuthOtpsTable = pgTable("merchant_auth_otps", {
  id: serial("id").primaryKey(),
  merchantId: integer("merchant_id"),
  identifierHash: text("identifier_hash").notNull(),
  otpHash: text("otp_hash").notNull(),
  purpose: text("purpose").notNull(), // LOGIN | PASSWORD_RESET | other verification purposes
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  attempts: integer("attempts").notNull().default(0),
  resendCount: integer("resend_count").notNull().default(0),
  ipHash: text("ip_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertMerchantAuthOtpSchema = createInsertSchema(merchantAuthOtpsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMerchantAuthOtp = z.infer<typeof insertMerchantAuthOtpSchema>;
export type MerchantAuthOtp = typeof merchantAuthOtpsTable.$inferSelect;
