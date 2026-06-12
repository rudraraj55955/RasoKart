import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const ekqrWebhookLogsTable = pgTable("ekqr_webhook_logs", {
  id: serial("id").primaryKey(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  clientTxnId: text("client_txn_id").notNull(),
  qrCodeId: integer("qr_code_id"),
  merchantId: integer("merchant_id"),
  status: text("status"),
  amount: text("amount"),
  rawPayload: text("raw_payload").notNull(),
  processingResult: text("processing_result").notNull(),
  errorMessage: text("error_message"),
});

export const insertEkqrWebhookLogSchema = createInsertSchema(ekqrWebhookLogsTable).omit({ id: true, receivedAt: true });
export type InsertEkqrWebhookLog = z.infer<typeof insertEkqrWebhookLogSchema>;
export type EkqrWebhookLog = typeof ekqrWebhookLogsTable.$inferSelect;
