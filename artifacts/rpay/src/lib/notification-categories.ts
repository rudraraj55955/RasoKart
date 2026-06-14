export const IN_APP_NOTIF_FIELDS = [
  "apiKeyGeneratedNotifs",
  "apiKeyRevokedNotifs",
  "signatureFailureAlertNotifs",
  "loginAlertNotifs",
  "reportScheduleChangedNotifs",
  "settlementStateChangedNotifs",
  "reconciliationAlertNotifs",
  "planExpiryAlertNotifs",
  "settlementStateNotifs",
  "webhookFailureNotifs",
  "reportFailureAlertNotifs",
  "weeklyDeliveryDigestNotifs",
  "ekqrSyncAlertNotifs",
  "planChangeNotifs",
] as const;

export type InAppNotifField = typeof IN_APP_NOTIF_FIELDS[number];

export const IN_APP_NOTIF_LABELS: Record<InAppNotifField, string> = {
  apiKeyGeneratedNotifs: "API key generated",
  apiKeyRevokedNotifs: "API key revoked",
  signatureFailureAlertNotifs: "Signature failure alerts",
  loginAlertNotifs: "New login alerts",
  reportScheduleChangedNotifs: "Report schedule changed",
  settlementStateChangedNotifs: "Settlement state changed",
  reconciliationAlertNotifs: "Reconciliation alerts",
  planExpiryAlertNotifs: "Plan expiry alerts",
  settlementStateNotifs: "Settlement state updates",
  webhookFailureNotifs: "Webhook failures",
  reportFailureAlertNotifs: "Report failure alerts",
  weeklyDeliveryDigestNotifs: "Weekly delivery digest",
  ekqrSyncAlertNotifs: "EKQR sync alerts",
  planChangeNotifs: "Plan changes",
};

export const NOTIF_TYPE_TO_FIELD: Partial<Record<string, InAppNotifField>> = {
  settlement_approved: "settlementStateChangedNotifs",
  settlement_rejected: "settlementStateChangedNotifs",
  settlement_paid: "settlementStateChangedNotifs",
  plan_expiring: "planExpiryAlertNotifs",
  plan_expired: "planExpiryAlertNotifs",
  webhook_failure: "webhookFailureNotifs",
  reconciliation_email_failure: "reconciliationAlertNotifs",
  scheduled_report_failure: "reportFailureAlertNotifs",
  scheduled_report_retry_success: "reportFailureAlertNotifs",
  scheduled_report_auto_paused: "reportFailureAlertNotifs",
  scheduled_report_overdue: "reportFailureAlertNotifs",
  report_schedule_deleted: "reportScheduleChangedNotifs",
  report_schedule_next_run_updated: "reportScheduleChangedNotifs",
  report_schedule_reenabled: "reportScheduleChangedNotifs",
  report_schedule_reenabled_by_merchant: "reportScheduleChangedNotifs",
  report_schedule_auto_paused_admin: "reportScheduleChangedNotifs",
  report_schedule_failures_reset: "reportScheduleChangedNotifs",
  report_manual_send: "reportScheduleChangedNotifs",
  report_delivery_low_success_rate: "weeklyDeliveryDigestNotifs",
  preference_change_unknown_device: "loginAlertNotifs",
};

export function typeToField(type: string): InAppNotifField | null {
  return NOTIF_TYPE_TO_FIELD[type] ?? null;
}
