import { pgTable, serial, integer, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";

export const savedFiltersTable = pgTable("saved_filters", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(),
  rawInput: text("raw_input").notNull(),
  filterData: jsonb("filter_data").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("saved_filters_user_idx").on(table.userId),
]);

export type SavedFilterRow = typeof savedFiltersTable.$inferSelect;
