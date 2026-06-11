import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const callbackLogsTable = pgTable("callback_logs", {
  id: serial("id").primaryKey(),
  merchantId: integer("merchant_id").notNull(),
  qrCodeId: integer("qr_code_id"),
  transactionId: integer("transaction_id"),
  url: text("url").notNull(),
  status: text("status").notNull(), // success | failed | pending_retry
  httpStatus: integer("http_status"),
  requestBody: text("request_body"),
  responseBody: text("response_body"),
  attempts: integer("attempts").notNull().default(1),
  nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  signatureVerified: boolean("signature_verified"), // true = HMAC passed, false = HMAC failed, null = no secret configured
  isTest: boolean("is_test").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCallbackLogSchema = createInsertSchema(callbackLogsTable).omit({ id: true, createdAt: true });
export type InsertCallbackLog = z.infer<typeof insertCallbackLogSchema>;
export type CallbackLog = typeof callbackLogsTable.$inferSelect;
