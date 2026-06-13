import { pgTable, serial, varchar, integer, numeric, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const providerMetricsTable = pgTable("provider_metrics", {
  id: serial("id").primaryKey(),
  providerKey: varchar("provider_key", { length: 64 }).notNull(),
  timeWindow: varchar("time_window", { length: 8 }).notNull().default("24h"),
  totalAttempts: integer("total_attempts").notNull().default(0),
  successCount: integer("success_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  timeoutCount: integer("timeout_count").notNull().default(0),
  avgResponseMs: integer("avg_response_ms"),
  successRate: numeric("success_rate", { precision: 5, scale: 2 }).default("0.00"),
  lastComputedAt: timestamp("last_computed_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("provider_metrics_key_window_uidx").on(t.providerKey, t.timeWindow),
]);

export type ProviderMetric = typeof providerMetricsTable.$inferSelect;
