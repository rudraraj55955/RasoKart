import { pgTable, text, serial, timestamp, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Canonical payin order status values. Always compare/insert/update
 * `cashfreePaymentOrdersTable.status` using these constants — never raw
 * string literals — so the app and the daily-limit / reconciliation
 * queries can never drift on casing (e.g. "paid" vs "PAID").
 */
export const PAYIN_ORDER_STATUS = {
  CREATED: "CREATED",
  PENDING: "PENDING",
  PAID: "PAID",
  FAILED: "FAILED",
  EXPIRED: "EXPIRED",
} as const;
export type PayinOrderStatus = (typeof PAYIN_ORDER_STATUS)[keyof typeof PAYIN_ORDER_STATUS];

export const cashfreePaymentOrdersTable = pgTable("cashfree_payment_orders", {
  id: serial("id").primaryKey(),
  merchantId: integer("merchant_id").notNull(),
  publicOrderId: text("public_order_id"),
  providerKey: text("provider_key").default("cashfree"),
  cashfreeOrderId: text("cashfree_order_id").notNull().unique(),
  paymentSessionId: text("payment_session_id"),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("INR"),
  status: text("status").notNull().default(PAYIN_ORDER_STATUS.CREATED),
  paymentMethod: text("payment_method"),
  utr: text("utr"),
  customerPhone: text("customer_phone"),
  customerEmail: text("customer_email"),
  rawProviderStatus: text("raw_provider_status"),
  failureReason: text("failure_reason"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  rawPayload: text("raw_payload"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const cashfreePaymentLogsTable = pgTable("cashfree_payment_logs", {
  id: serial("id").primaryKey(),
  eventType: text("event_type"),
  cashfreeOrderId: text("cashfree_order_id"),
  merchantId: integer("merchant_id"),
  amount: text("amount"),
  status: text("status"),
  rawPayload: text("raw_payload").notNull(),
  processingResult: text("processing_result").notNull(),
  errorMessage: text("error_message"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCashfreePaymentOrderSchema = createInsertSchema(cashfreePaymentOrdersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCashfreePaymentOrder = z.infer<typeof insertCashfreePaymentOrderSchema>;
export type CashfreePaymentOrder = typeof cashfreePaymentOrdersTable.$inferSelect;

export const insertCashfreePaymentLogSchema = createInsertSchema(cashfreePaymentLogsTable).omit({ id: true, receivedAt: true });
export type InsertCashfreePaymentLog = z.infer<typeof insertCashfreePaymentLogSchema>;
export type CashfreePaymentLog = typeof cashfreePaymentLogsTable.$inferSelect;
