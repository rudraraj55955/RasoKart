import { pgTable, serial, integer, varchar, numeric, boolean, text, timestamp } from "drizzle-orm/pg-core";
import { routingConfigsTable } from "./routingConfigs";

export const routingRulesTable = pgTable("routing_rules", {
  id: serial("id").primaryKey(),
  configId: integer("config_id").notNull().references(() => routingConfigsTable.id, { onDelete: "cascade" }),
  providerKey: varchar("provider_key", { length: 64 }).notNull(),
  priority: integer("priority").notNull().default(1),
  weightPercent: integer("weight_percent").notNull().default(100),
  minAmount: numeric("min_amount", { precision: 18, scale: 2 }),
  maxAmount: numeric("max_amount", { precision: 18, scale: 2 }),
  allowedPaymentModes: text("allowed_payment_modes"),
  isEnabled: boolean("is_enabled").notNull().default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type RoutingRule = typeof routingRulesTable.$inferSelect;
export type RoutingRuleInsert = typeof routingRulesTable.$inferInsert;
