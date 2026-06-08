import { pgTable, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Per-merchant overrides for account detail visibility.
// If isGlobal=true on the account detail, all merchants see it UNLESS a rule sets visible=false.
// If isGlobal=false, only merchants with visible=true rules can see it.
export const accountVisibilityRulesTable = pgTable("account_visibility_rules", {
  id: serial("id").primaryKey(),
  accountDetailId: integer("account_detail_id").notNull(),
  merchantId: integer("merchant_id").notNull(),
  visible: boolean("visible").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAccountVisibilityRuleSchema = createInsertSchema(accountVisibilityRulesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAccountVisibilityRule = z.infer<typeof insertAccountVisibilityRuleSchema>;
export type AccountVisibilityRule = typeof accountVisibilityRulesTable.$inferSelect;
