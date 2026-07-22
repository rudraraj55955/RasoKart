import { pgTable, text, serial, timestamp, integer, numeric, uniqueIndex, index, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const RAZORPAY_ORDER_STATUS = {
  CREATED: "CREATED",
  PENDING: "PENDING",
  SUCCESS: "SUCCESS",
  FAILED: "FAILED",
  REFUNDED: "REFUNDED",
} as const;
export type RazorpayOrderStatus = (typeof RAZORPAY_ORDER_STATUS)[keyof typeof RAZORPAY_ORDER_STATUS];

export const razorpayPaymentOrdersTable = pgTable(
  "razorpay_payment_orders",
  {
    id: serial("id").primaryKey(),
    merchantId: integer("merchant_id").notNull(),
    internalOrderId: text("internal_order_id").notNull(),
    razorpayOrderId: text("razorpay_order_id").notNull(),
    razorpayPaymentId: text("razorpay_payment_id"),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("INR"),
    status: text("status").notNull().default(RAZORPAY_ORDER_STATUS.CREATED),
    paymentMethod: text("payment_method"),
    utr: text("utr"),
    failureReason: text("failure_reason"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    // Analytics columns added via schemaGuard ALTER TABLE
    errorCode: text("error_code"),
    errorDescription: text("error_description"),
    errorSource: text("error_source"),
    capturedAt: timestamp("captured_at", { withTimezone: true }),
    settlementId: text("settlement_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("razorpay_orders_internal_id_uniq").on(table.internalOrderId),
    uniqueIndex("razorpay_orders_rzp_order_id_uniq").on(table.razorpayOrderId),
    uniqueIndex("razorpay_orders_rzp_payment_id_uniq").on(table.razorpayPaymentId),
    uniqueIndex("razorpay_orders_utr_uniq").on(table.utr),
    index("razorpay_orders_merchant_created_idx").on(table.merchantId, table.createdAt),
  ]
);

export const razorpayWebhookLogsTable = pgTable(
  "razorpay_webhook_logs",
  {
    id: serial("id").primaryKey(),
    webhookEventId: text("webhook_event_id"),
    eventType: text("event_type"),
    razorpayOrderId: text("razorpay_order_id"),
    razorpayPaymentId: text("razorpay_payment_id"),
    merchantId: integer("merchant_id"),
    amount: text("amount"),
    processingResult: text("processing_result").notNull(),
    safeMessage: text("safe_message"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("razorpay_webhook_logs_event_id_uniq").on(table.webhookEventId),
    index("razorpay_webhook_logs_created_idx").on(table.receivedAt),
  ]
);

export const insertRazorpayPaymentOrderSchema = createInsertSchema(razorpayPaymentOrdersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRazorpayPaymentOrder = z.infer<typeof insertRazorpayPaymentOrderSchema>;
export type RazorpayPaymentOrder = typeof razorpayPaymentOrdersTable.$inferSelect;
export type RazorpayWebhookLog = typeof razorpayWebhookLogsTable.$inferSelect;
