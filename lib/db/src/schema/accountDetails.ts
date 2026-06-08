import { pgTable, serial, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const accountDetailsTable = pgTable("account_details", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(), // bank_account | upi_id | qr_code | virtual_account | static_qr | merchant_qr_provider
  label: text("label").notNull(),
  accountNumber: text("account_number"),
  ifsc: text("ifsc"),
  bankName: text("bank_name"),
  accountHolder: text("account_holder"),
  upiId: text("upi_id"),
  qrPayload: text("qr_payload"),
  provider: text("provider"), // phonepe | paytm | bharatpe | yono_sbi | hdfc_smarthub
  metadata: text("metadata"), // JSON string for extra fields
  isActive: boolean("is_active").notNull().default(true),
  isGlobal: boolean("is_global").notNull().default(true), // visible to all merchants by default
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAccountDetailSchema = createInsertSchema(accountDetailsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAccountDetail = z.infer<typeof insertAccountDetailSchema>;
export type AccountDetail = typeof accountDetailsTable.$inferSelect;
