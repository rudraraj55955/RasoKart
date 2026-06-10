import { pgTable, text, serial, timestamp, numeric, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { merchantConnectionsTable } from "./merchantConnections";

export const transactionsTable = pgTable("transactions", {
  id: serial("id").primaryKey(),
  merchantId: integer("merchant_id").notNull(),
  virtualAccountId: integer("virtual_account_id"),
  qrCodeId: integer("qr_code_id"), // set when this transaction was triggered by a QR code payment callback
  connectionId: integer("connection_id").references(() => merchantConnectionsTable.id, { onDelete: "set null" }), // FK to merchant_connections — which provider connection this payment came through
  provider: text("provider"), // payment provider key e.g. phonepe | paytm | upi_id — null for legacy records
  paymentLinkId: integer("payment_link_id"),
  type: text("type").notNull(), // deposit | withdrawal
  status: text("status").notNull().default("pending"), // pending | success | failed
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("INR"),
  utr: text("utr").notNull().unique(),
  referenceId: text("reference_id"),
  description: text("description"),
  metadata: text("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertTransactionSchema = createInsertSchema(transactionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type Transaction = typeof transactionsTable.$inferSelect;
