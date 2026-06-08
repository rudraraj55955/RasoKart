import { pgTable, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const merchantFeaturesTable = pgTable("merchant_features", {
  id: serial("id").primaryKey(),
  merchantId: integer("merchant_id").notNull().unique(),
  dynamicQr: boolean("dynamic_qr").notNull().default(false),
  staticQr: boolean("static_qr").notNull().default(false),
  virtualAccount: boolean("virtual_account").notNull().default(false),
  paymentLinks: boolean("payment_links").notNull().default(false),
  payouts: boolean("payouts").notNull().default(false),
  withdrawals: boolean("withdrawals").notNull().default(true),
  settlements: boolean("settlements").notNull().default(true),
  webhooks: boolean("webhooks").notNull().default(true),
  apiKeys: boolean("api_keys").notNull().default(true),
  csvExport: boolean("csv_export").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertMerchantFeaturesSchema = createInsertSchema(merchantFeaturesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMerchantFeatures = z.infer<typeof insertMerchantFeaturesSchema>;
export type MerchantFeatures = typeof merchantFeaturesTable.$inferSelect;
