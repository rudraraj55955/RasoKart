import { pgTable, serial, varchar, text, boolean, integer, numeric, timestamp } from "drizzle-orm/pg-core";

export const routingConfigsTable = pgTable("routing_configs", {
  id: serial("id").primaryKey(),
  configName: varchar("config_name", { length: 64 }).notNull().unique(),
  description: text("description"),
  strategy: varchar("strategy", { length: 32 }).notNull().default("priority"),
  isEnabled: boolean("is_enabled").notNull().default(true),
  fallbackEnabled: boolean("fallback_enabled").notNull().default(true),
  timeoutMs: integer("timeout_ms").notNull().default(30000),
  minSuccessRateThreshold: numeric("min_success_rate_threshold", { precision: 5, scale: 2 }).default("80.00"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  updatedByEmail: varchar("updated_by_email", { length: 255 }),
});

export type RoutingConfig = typeof routingConfigsTable.$inferSelect;
export type RoutingConfigInsert = typeof routingConfigsTable.$inferInsert;
