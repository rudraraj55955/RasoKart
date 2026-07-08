import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const verificationLogsTable = pgTable("verification_logs", {
  id: serial("id").primaryKey(),
  merchantId: integer("merchant_id").notNull(),
  onboardingSessionId: integer("onboarding_session_id"),
  verificationType: text("verification_type").notNull(),
  status: text("status").notNull(),
  requestId: text("request_id"),
  rawResponseEncrypted: text("raw_response_encrypted"),
  rawResponseIv: text("raw_response_iv"),
  rawResponseTag: text("raw_response_tag"),
  errorEncrypted: text("error_encrypted"),
  errorIv: text("error_iv"),
  errorTag: text("error_tag"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertVerificationLogSchema = createInsertSchema(verificationLogsTable).omit({ id: true, createdAt: true });
export type InsertVerificationLog = z.infer<typeof insertVerificationLogSchema>;
export type VerificationLog = typeof verificationLogsTable.$inferSelect;
