import { pgTable, serial, integer, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const merchantTryItPresetsTable = pgTable("merchant_tryit_presets", {
  id: serial("id").primaryKey(),
  merchantId: integer("merchant_id").notNull(),
  presets: jsonb("presets").notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("merchant_tryit_presets_merchant_id_uidx").on(table.merchantId),
]);

export type MerchantTryItPresetsRow = typeof merchantTryItPresetsTable.$inferSelect;

export const adminTryItPresetsTable = pgTable("admin_tryit_presets", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  presets: jsonb("presets").notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("admin_tryit_presets_user_id_uidx").on(table.userId),
]);

export type AdminTryItPresetsRow = typeof adminTryItPresetsTable.$inferSelect;
