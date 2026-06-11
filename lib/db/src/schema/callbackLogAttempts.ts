import { pgTable, serial, integer, timestamp, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const callbackLogAttemptsTable = pgTable("callback_log_attempts", {
  id: serial("id").primaryKey(),
  callbackLogId: integer("callback_log_id").notNull(),
  attemptNumber: integer("attempt_number").notNull(),
  firedAt: timestamp("fired_at", { withTimezone: true }).notNull().defaultNow(),
  httpStatus: integer("http_status"),
  responseBody: text("response_body"),
});

export const insertCallbackLogAttemptSchema = createInsertSchema(callbackLogAttemptsTable).omit({ id: true });
export type InsertCallbackLogAttempt = z.infer<typeof insertCallbackLogAttemptSchema>;
export type CallbackLogAttempt = typeof callbackLogAttemptsTable.$inferSelect;
