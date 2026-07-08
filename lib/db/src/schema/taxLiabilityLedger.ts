import { pgTable, serial, text, numeric, integer, timestamp } from "drizzle-orm/pg-core";

export const taxLiabilityLedgerTable = pgTable("tax_liability_ledger", {
  id:          serial("id").primaryKey(),
  sourceType:  text("source_type").notNull(), // payin_fee | payout_fee | settlement_fee | manual_credit | manual_debit
  sourceId:    integer("source_id"),
  merchantId:  integer("merchant_id"),
  gstAmount:   numeric("gst_amount",  { precision: 12, scale: 2 }).notNull().default("0"),
  balanceAfter:numeric("balance_after",{ precision: 12, scale: 2 }).notNull().default("0"),
  description: text("description"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  metadata:    text("metadata"), // JSON string
});

export type TaxLiabilityLedger = typeof taxLiabilityLedgerTable.$inferSelect;
export type InsertTaxLiabilityLedger = typeof taxLiabilityLedgerTable.$inferInsert;
