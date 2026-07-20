import { pgTable, text, serial, timestamp, integer, numeric, boolean } from "drizzle-orm/pg-core";

/**
 * PayU payment order status constants.
 * INITIATED = form params generated, user hasn't paid yet
 * SUCCESS   = payment confirmed + hash verified
 * FAILED    = payment failed (card declined, timeout, etc.)
 * PENDING   = payment in limbo (bank processing)
 * CANCELLED = user cancelled on PayU page
 */
export const PAYU_ORDER_STATUS = {
  INITIATED: "INITIATED",
  SUCCESS:   "SUCCESS",
  FAILED:    "FAILED",
  PENDING:   "PENDING",
  CANCELLED: "CANCELLED",
} as const;
export type PayuOrderStatus = (typeof PAYU_ORDER_STATUS)[keyof typeof PAYU_ORDER_STATUS];

/**
 * payu_payment_orders — one row per payment attempt initiated via PayU Hosted Checkout.
 * txnid is the unique transaction ID sent to PayU and is the primary dedup key.
 */
export const payuPaymentOrdersTable = pgTable("payu_payment_orders", {
  id:           serial("id").primaryKey(),
  merchantId:   integer("merchant_id").notNull(),
  txnid:        text("txnid").notNull().unique(),        // RK-PAY-{merchantId}-{timestamp}-{random}
  amount:       numeric("amount", { precision: 18, scale: 2 }).notNull(),
  productinfo:  text("productinfo").notNull(),
  firstname:    text("firstname"),
  email:        text("email"),
  phone:        text("phone"),
  udf1:         text("udf1"),                            // reserved for merchant order ref
  environment:  text("environment").notNull().default("uat"),
  status:       text("status").notNull().default(PAYU_ORDER_STATUS.INITIATED),
  mihpayid:     text("mihpayid"),                        // PayU payment ID on success
  bankRefNo:    text("bank_ref_no"),                     // bank reference / UTR
  paymentMode:  text("payment_mode"),                    // NET_BANKING | CREDIT_CARD | UPI etc.
  rawResponse:  text("raw_response"),                    // full PayU response payload (sanitized)
  hashVerified: boolean("hash_verified").notNull().default(false),
  failureReason: text("failure_reason"),
  paidAt:       timestamp("paid_at", { withTimezone: true }),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

/**
 * payu_webhook_logs — every PayU s2s / browser-return callback logged here.
 * Used for audit, duplicate detection debugging, and replay analysis.
 */
export const payuWebhookLogsTable = pgTable("payu_webhook_logs", {
  id:               serial("id").primaryKey(),
  txnid:            text("txnid"),
  merchantId:       integer("merchant_id"),
  amount:           text("amount"),
  status:           text("status"),
  source:           text("source"),   // "s2s_webhook" | "browser_return"
  rawPayload:       text("raw_payload").notNull(),
  processingResult: text("processing_result").notNull(), // credited|duplicate|ignored|error|hash_invalid
  hashVerified:     boolean("hash_verified").notNull().default(false),
  errorMessage:     text("error_message"),
  receivedAt:       timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PayuPaymentOrder    = typeof payuPaymentOrdersTable.$inferSelect;
export type PayuWebhookLog      = typeof payuWebhookLogsTable.$inferSelect;
