import { pgTable, varchar, text, timestamp } from "drizzle-orm/pg-core";

export const systemConfigTable = pgTable("system_config", {
  key: varchar("key", { length: 100 }).primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  updatedByEmail: varchar("updated_by_email", { length: 255 }),
});

export type SystemConfig = typeof systemConfigTable.$inferSelect;

export const SYSTEM_CONFIG_KEYS = {
  RECONCILIATION_HOUR: "reconciliation_hour",
  RECONCILIATION_MINUTE: "reconciliation_minute",
  RECONCILIATION_LOOKBACK_DAYS: "reconciliation_lookback_days",
  RECONCILIATION_ENABLED: "reconciliation_enabled",
  QR_CLEANUP_RETENTION_DAYS: "qr_cleanup_retention_days",
} as const;

export const SYSTEM_CONFIG_DEFAULTS = {
  [SYSTEM_CONFIG_KEYS.RECONCILIATION_HOUR]: "0",
  [SYSTEM_CONFIG_KEYS.RECONCILIATION_MINUTE]: "0",
  [SYSTEM_CONFIG_KEYS.RECONCILIATION_LOOKBACK_DAYS]: "1",
  [SYSTEM_CONFIG_KEYS.RECONCILIATION_ENABLED]: "true",
  [SYSTEM_CONFIG_KEYS.QR_CLEANUP_RETENTION_DAYS]: "30",
} as const;
