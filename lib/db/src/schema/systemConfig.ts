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
  VA_CLEANUP_RETENTION_DAYS: "va_cleanup_retention_days",
  LEDGER_BACKFILL_LAST_RUN_AT: "ledger_backfill_last_run_at",
  LEDGER_BACKFILL_ROWS_UPDATED: "ledger_backfill_rows_updated",
  SIGNATURE_FAILURE_ALERT_THRESHOLD: "signature_failure_alert_threshold",
  SIGNATURE_FAILURE_ALERT_COOLDOWN_HOURS: "signature_failure_alert_cooldown_hours",
  WEBHOOK_RETRY_MAX_ATTEMPTS: "webhook_retry_max_attempts",
  WEBHOOK_RETRY_DELAY_1: "webhook_retry_delay_1",
  WEBHOOK_RETRY_DELAY_2: "webhook_retry_delay_2",
  WEBHOOK_RETRY_DELAY_3: "webhook_retry_delay_3",
  TEST_EMAIL_HISTORY_RETENTION_DAYS: "test_email_history_retention_days",
  AUDIT_REPORT_LOG_RETENTION_DAYS: "audit_report_log_retention_days",
  QR_CLEANUP_LAST_RUN_AT: "qr_cleanup_last_run_at",
  QR_CLEANUP_LAST_RUN_DELETED: "qr_cleanup_last_run_deleted",
  AUDIT_REPORT_CLEANUP_LAST_RUN_AT: "audit_report_cleanup_last_run_at",
  AUDIT_REPORT_CLEANUP_LAST_RUN_DELETED: "audit_report_cleanup_last_run_deleted",
  VA_CLEANUP_LAST_RUN_AT: "va_cleanup_last_run_at",
  VA_CLEANUP_LAST_DELETED: "va_cleanup_last_deleted",
} as const;

export const SYSTEM_CONFIG_DEFAULTS = {
  [SYSTEM_CONFIG_KEYS.RECONCILIATION_HOUR]: "0",
  [SYSTEM_CONFIG_KEYS.RECONCILIATION_MINUTE]: "0",
  [SYSTEM_CONFIG_KEYS.RECONCILIATION_LOOKBACK_DAYS]: "1",
  [SYSTEM_CONFIG_KEYS.RECONCILIATION_ENABLED]: "true",
  [SYSTEM_CONFIG_KEYS.QR_CLEANUP_RETENTION_DAYS]: "30",
  [SYSTEM_CONFIG_KEYS.SIGNATURE_FAILURE_ALERT_THRESHOLD]: "10",
  [SYSTEM_CONFIG_KEYS.SIGNATURE_FAILURE_ALERT_COOLDOWN_HOURS]: "4",
  [SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_MAX_ATTEMPTS]: "4",
  [SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_DELAY_1]: "300",
  [SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_DELAY_2]: "900",
  [SYSTEM_CONFIG_KEYS.WEBHOOK_RETRY_DELAY_3]: "3600",
  [SYSTEM_CONFIG_KEYS.TEST_EMAIL_HISTORY_RETENTION_DAYS]: "30",
  [SYSTEM_CONFIG_KEYS.AUDIT_REPORT_LOG_RETENTION_DAYS]: "90",
} as const;
