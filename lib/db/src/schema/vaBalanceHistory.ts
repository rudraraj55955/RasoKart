import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";

export const vaBalanceHistoryTable = pgTable("va_balance_history", {
  id: serial("id").primaryKey(),
  virtualAccountId: integer("virtual_account_id").notNull(),
  changedBy: integer("changed_by").notNull(),
  changedByRole: text("changed_by_role").notNull(),
  changedByName: text("changed_by_name").notNull(),
  oldBalance: text("old_balance"),
  newBalance: text("new_balance"),
  oldTotalCollection: text("old_total_collection"),
  newTotalCollection: text("new_total_collection"),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type VaBalanceHistory = typeof vaBalanceHistoryTable.$inferSelect;
