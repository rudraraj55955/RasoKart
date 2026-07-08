import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const smsSendLogsTable = pgTable("sms_send_logs", {
  id: serial("id").primaryKey(),
  mobileHash: text("mobile_hash").notNull(),
  mobileLast4: text("mobile_last4"),
  otpPurpose: text("otp_purpose"),
  providerUsed: text("provider_used").notNull(),
  status: text("status").notNull(),
  fallbackAttempted: boolean("fallback_attempted").notNull().default(false),
  fallbackProviderUsed: text("fallback_provider_used"),
  providerMsgId: text("provider_msg_id"),
  errorReason: text("error_reason"),
  merchantId: integer("merchant_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSmsSendLogSchema = createInsertSchema(smsSendLogsTable).omit({ id: true, createdAt: true });
export type InsertSmsSendLog = z.infer<typeof insertSmsSendLogSchema>;
export type SmsSendLog = typeof smsSendLogsTable.$inferSelect;
