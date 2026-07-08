import { pgTable, serial, text, numeric, integer, timestamp } from "drizzle-orm/pg-core";

export const platformWalletLedgerTable = pgTable("platform_wallet_ledger", {
  id:               serial("id").primaryKey(),
  sourceType:       text("source_type").notNull(), // payin_fee | payout_fee | settlement_fee | manual_credit | manual_debit | adjustment | refund_reversal
  sourceId:         integer("source_id"),           // FK to transaction/payout/settlement id
  merchantId:       integer("merchant_id"),
  grossAmount:      numeric("gross_amount",   { precision: 12, scale: 2 }).notNull().default("0"),
  feeAmount:        numeric("fee_amount",     { precision: 12, scale: 2 }).notNull().default("0"),
  gstAmount:        numeric("gst_amount",     { precision: 12, scale: 2 }).notNull().default("0"),
  providerCost:     numeric("provider_cost",  { precision: 12, scale: 2 }).notNull().default("0"),
  profitAmount:     numeric("profit_amount",  { precision: 12, scale: 2 }).notNull().default("0"),
  balanceAfter:     numeric("balance_after",  { precision: 12, scale: 2 }).notNull().default("0"),
  description:      text("description"),
  createdByAdminId: integer("created_by_admin_id"),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  metadata:         text("metadata"), // JSON string
});

export type PlatformWalletLedger = typeof platformWalletLedgerTable.$inferSelect;
export type InsertPlatformWalletLedger = typeof platformWalletLedgerTable.$inferInsert;
