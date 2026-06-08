import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const merchantProductsTable = pgTable("merchant_products", {
  id: serial("id").primaryKey(),
  merchantId: integer("merchant_id").notNull(),
  productType: text("product_type").notNull(), // dynamic_qr | static_qr | virtual_account | payment_links | payouts
  enabled: boolean("enabled").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertMerchantProductSchema = createInsertSchema(merchantProductsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMerchantProduct = z.infer<typeof insertMerchantProductSchema>;
export type MerchantProduct = typeof merchantProductsTable.$inferSelect;
