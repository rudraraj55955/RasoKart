import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";

export const callbackLogAttemptsTable = pgTable("callback_log_attempts", {
  id: serial("id").primaryKey(),
  callbackLogId: integer("callback_log_id").notNull(),
  attemptNumber: integer("attempt_number").notNull(),
  firedAt: timestamp("fired_at", { withTimezone: true }).notNull().defaultNow(),
  httpStatus: integer("http_status"),
  responseBody: text("response_body"),
});

export type CallbackLogAttempt = typeof callbackLogAttemptsTable.$inferSelect;
