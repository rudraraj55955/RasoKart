import { pgTable, serial, integer, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";

export const savedFiltersTable = pgTable("saved_filters", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  merchantId: integer("merchant_id"),
  name: text("name").notNull(),
  rawInput: text("raw_input").notNull(),
  filterData: jsonb("filter_data").notNull(),
  context: text("context").notNull().default(""),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("saved_filters_user_idx").on(table.userId),
  index("saved_filters_merchant_context_idx").on(table.merchantId, table.context),
]);

export type SavedFilterRow = typeof savedFiltersTable.$inferSelect;
