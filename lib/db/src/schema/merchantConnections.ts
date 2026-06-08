import { pgTable, serial, integer, text, boolean, numeric, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const merchantConnectionsTable = pgTable("merchant_connections", {
  id: serial("id").primaryKey(),
  merchantId: integer("merchant_id").notNull(),
  provider: text("provider").notNull(), // phonepe | paytm | bharatpe | yono_sbi | hdfc_smarthub | upi_id
  credentials: text("credentials"), // JSON string
  monthlyLimit: numeric("monthly_limit", { precision: 18, scale: 2 }).notNull().default("0"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertMerchantConnectionSchema = createInsertSchema(merchantConnectionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMerchantConnection = z.infer<typeof insertMerchantConnectionSchema>;
export type MerchantConnection = typeof merchantConnectionsTable.$inferSelect;
