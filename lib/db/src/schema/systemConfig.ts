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
  RECONCILIATION_LOOKBACK_PRESETS: "reconciliation_lookback_presets",
  QR_CLEANUP_RETENTION_DAYS: "qr_cleanup_retention_days",
  VA_CLEANUP_RETENTION_DAYS: "va_cleanup_retention_days",
  STORAGE_CLEANUP_ENABLED: "storage_cleanup_enabled",
  STORAGE_CLEANUP_HOUR: "storage_cleanup_hour",
  SIGNATURE_FAILURE_ALERT_THRESHOLD: "signature_failure_alert_threshold",
  SIGNATURE_FAILURE_ALERT_WINDOW_HOURS: "signature_failure_alert_window_hours",
  SIGNATURE_FAILURE_ALERT_RATE_LIMIT_HOURS: "signature_failure_alert_rate_limit_hours",
  WEBHOOK_SECRET_CHECK_HOUR: "webhook_secret_check_hour",
  WEBHOOK_SECRET_CHECK_MINUTE: "webhook_secret_check_minute",
  WEBHOOK_RETRY_MAX_ATTEMPTS: "webhook_retry_max_attempts",
  WEBHOOK_RETRY_DELAY_1_SECONDS: "webhook_retry_delay_1_seconds",
  WEBHOOK_RETRY_DELAY_2_SECONDS: "webhook_retry_delay_2_seconds",
  WEBHOOK_RETRY_DELAY_3_SECONDS: "webhook_retry_delay_3_seconds",
  WEBHOOK_TEST_MAX_AUTO_RETRIES: "webhook_test_max_auto_retries",
  WEBHOOK_TEST_RETRY_DELAY_SECONDS: "webhook_test_retry_delay_seconds",
} as const;

export const SYSTEM_CONFIG_DEFAULTS = {
  [SYSTEM_CONFIG_KEYS.RECONCILIATION_HOUR]: "0",
  [SYSTEM_CONFIG_KEYS.RECONCILIATION_MINUTE]: "0",
  [SYSTEM_CONFIG_KEYS.RECONCILIATION_LOOKBACK_DAYS]: "1",
  [SYSTEM_CONFIG_KEYS.RECONCILIATION_ENABLED]: "true",
  [SYSTEM_CONFIG_KEYS.QR_CLEANUP_RETENTION_DAYS]: "30",
  [SYSTEM_CONFIG_KEYS.VA_CLEANUP_RETENTION_DAYS]: "30",
  [SYSTEM_CONFIG_KEYS.STORAGE_CLEANUP_ENABLED]: "true",
  [SYSTEM_CONFIG_KEYS.STORAGE_CLEANUP_HOUR]: "3",
  [SYSTEM_CONFIG_KEYS.SIGNATURE_FAILURE_ALERT_THRESHOLD]: "10",
  [SYSTEM_CONFIG_KEYS.SIGNATURE_FAILURE_ALERT_WINDOW_HOURS]: "1",
  [SYSTEM_CONFIG_KEYS.SIGNATURE_FAILURE_ALERT_RATE_LIMIT_HOURS]: "1",
  [SYSTEM_CONFIG_KEYS.WEBHOOK_SECRET_CHECK_HOUR]: "9",
  [SYSTEM_CONFIG_KEYS.WEBHOOK_SECRET_CHECK_MINUTE]: "0",
  [SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_MAX_ATTEMPTS]: "4",
  [SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_DELAY_1_SECONDS]: "30",
  [SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_DELAY_2_SECONDS]: "300",
  [SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_DELAY_3_SECONDS]: "1800",
  [SYSTEM_CONFIG_KEYS.WEBHOOK_TEST_MAX_AUTO_RETRIES]: "1",
  [SYSTEM_CONFIG_KEYS.WEBHOOK_TEST_RETRY_DELAY_SECONDS]: "60",
} as const;
