import { pgTable, serial, integer, varchar, numeric, text, timestamp, index } from "drizzle-orm/pg-core";

export const routingLogsTable = pgTable("routing_logs", {
  id: serial("id").primaryKey(),
  merchantId: integer("merchant_id").notNull(),
  configId: integer("config_id"),
  configName: varchar("config_name", { length: 64 }),
  strategyUsed: varchar("strategy_used", { length: 32 }),
  attemptNumber: integer("attempt_number").notNull().default(1),
  providerKey: varchar("provider_key", { length: 64 }).notNull(),
  result: varchar("result", { length: 32 }).notNull(),
  responseTimeMs: integer("response_time_ms"),
  amount: numeric("amount", { precision: 18, scale: 2 }),
  paymentMode: varchar("payment_mode", { length: 32 }),
  publicReferenceId: varchar("public_reference_id", { length: 64 }),
  providerReferenceId: varchar("provider_reference_id", { length: 128 }),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("routing_logs_merchant_idx").on(t.merchantId),
  index("routing_logs_created_idx").on(t.createdAt),
]);

export type RoutingLog = typeof routingLogsTable.$inferSelect;
