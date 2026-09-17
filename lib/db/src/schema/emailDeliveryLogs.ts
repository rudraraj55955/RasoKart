import { pgTable, serial, text, timestamp, integer, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const emailDeliveryLogsTable = pgTable(
  "email_delivery_logs",
  {
    id: serial("id").primaryKey(),
    recipientHash: text("recipient_hash").notNull(),
    recipientMasked: text("recipient_masked").notNull(),
    purpose: text("purpose").notNull(),
    provider: text("provider").notNull(),
    status: text("status").notNull(), // accepted | delivered | bounced | failed
    providerMessageId: text("provider_message_id"),
    providerEventId: text("provider_event_id"),
    errorReason: text("error_reason"),
    otpId: integer("otp_id"),
    userId: integer("user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    lastEventAt: timestamp("last_event_at", { withTimezone: true }),
  },
  (table) => ({
    createdAtIdx: index("email_delivery_logs_created_at_idx").on(table.createdAt),
    purposeCreatedAtIdx: index("email_delivery_logs_purpose_created_at_idx").on(table.purpose, table.createdAt),
    statusIdx: index("email_delivery_logs_status_idx").on(table.status),
    providerMessageIdIdx: index("email_delivery_logs_provider_message_id_idx").on(table.providerMessageId),
    providerEventIdUnique: uniqueIndex("email_delivery_logs_provider_event_id_unique")
      .on(table.providerEventId)
      .where(sql`provider_event_id IS NOT NULL`),
  }),
);

export type EmailDeliveryLog = typeof emailDeliveryLogsTable.$inferSelect;

export const emailDeliveryEventsTable = pgTable(
  "email_delivery_events",
  {
    id: serial("id").primaryKey(),
    deliveryLogId: integer("delivery_log_id")
      .notNull()
      .references(() => emailDeliveryLogsTable.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerMessageId: text("provider_message_id"),
    providerEventId: text("provider_event_id"),
    status: text("status").notNull(), // accepted | delivered | bounced | failed
    failureSummary: text("failure_summary"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    deliveryLogReceivedAtIdx: index("email_delivery_events_delivery_log_received_at_idx")
      .on(table.deliveryLogId, table.receivedAt),
    providerEventIdUnique: uniqueIndex("email_delivery_events_provider_event_id_unique")
      .on(table.providerEventId)
      .where(sql`provider_event_id IS NOT NULL`),
  }),
);

export type EmailDeliveryEvent = typeof emailDeliveryEventsTable.$inferSelect;