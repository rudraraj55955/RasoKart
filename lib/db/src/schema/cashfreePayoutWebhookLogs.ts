import { pgTable, serial, text, integer, timestamp, boolean } from "drizzle-orm/pg-core";

export const cashfreePayoutWebhookLogsTable = pgTable("cashfree_payout_webhook_logs", {
  id: serial("id").primaryKey(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  endpoint: text("endpoint"),
  eventType: text("event_type"),
  status: text("status"),
  signatureVerified: boolean("signature_verified"),
  payoutId: integer("payout_id"),
  transferId: text("transfer_id"),
  cfTransferId: text("cf_transfer_id"),
  utr: text("utr"),
  safeError: text("safe_error"),
  processingResult: text("processing_result").notNull().default("received"),
  rawPayload: text("raw_payload"),
});

export type CashfreePayoutWebhookLog = typeof cashfreePayoutWebhookLogsTable.$inferSelect;
