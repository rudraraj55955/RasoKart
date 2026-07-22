import { pgTable, serial, text, integer, numeric, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";

export const RAZORPAY_REFUND_STATUS = {
  PENDING:   "PENDING",
  PROCESSED: "PROCESSED",
  FAILED:    "FAILED",
  CANCELLED: "CANCELLED",
} as const;
export type RazorpayRefundStatus = (typeof RAZORPAY_REFUND_STATUS)[keyof typeof RAZORPAY_REFUND_STATUS];

export const razorpayRefundsTable = pgTable(
  "razorpay_refunds",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id").notNull(),
    razorpayPaymentId: text("razorpay_payment_id").notNull(),
    razorpayRefundId: text("razorpay_refund_id"),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("INR"),
    status: text("status").notNull().default(RAZORPAY_REFUND_STATUS.PENDING),
    speed: text("speed").notNull().default("normal"),
    notes: text("notes"),
    initiatedByAdminId: integer("initiated_by_admin_id"),
    initiatedByEmail: text("initiated_by_email"),
    providerResponse: text("provider_response"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("razorpay_refunds_refund_id_uniq").on(table.razorpayRefundId),
    index("razorpay_refunds_order_id_idx").on(table.orderId),
    index("razorpay_refunds_payment_id_idx").on(table.razorpayPaymentId),
  ],
);

export type RazorpayRefund = typeof razorpayRefundsTable.$inferSelect;
export type RazorpayRefundInsert = typeof razorpayRefundsTable.$inferInsert;
