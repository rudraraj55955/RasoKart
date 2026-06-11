import { pgTable, serial, integer, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { merchantsTable } from "./merchants";

export const merchantFilterPresetsTable = pgTable("merchant_filter_presets", {
  id: serial("id").primaryKey(),
  merchantId: integer("merchant_id").notNull().references(() => merchantsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  presetType: text("preset_type").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("merchant_filter_presets_merchant_idx").on(table.merchantId),
]);

export type MerchantFilterPresetRow = typeof merchantFilterPresetsTable.$inferSelect;
