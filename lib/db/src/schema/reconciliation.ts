import { pgTable, text, serial, timestamp, numeric, integer, date } from "drizzle-orm/pg-core";

export const reconciliationRunsTable = pgTable("reconciliation_runs", {
  id: serial("id").primaryKey(),
  merchantId: integer("merchant_id"),
  dateFrom: date("date_from", { mode: "string" }).notNull(),
  dateTo: date("date_to", { mode: "string" }).notNull(),
  runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
  totalDeposits: integer("total_deposits").notNull().default(0),
  totalMatched: integer("total_matched").notNull().default(0),
  totalUnmatched: integer("total_unmatched").notNull().default(0),
  totalSettlements: integer("total_settlements").notNull().default(0),
  matchedAmount: numeric("matched_amount", { precision: 18, scale: 2 }).notNull().default("0"),
  unmatchedAmount: numeric("unmatched_amount", { precision: 18, scale: 2 }).notNull().default("0"),
  status: text("status").notNull().default("running"),
  createdBy: integer("created_by"),
  triggeredBy: text("triggered_by").notNull().default("manual"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const reconciliationItemsTable = pgTable("reconciliation_items", {
  id: serial("id").primaryKey(),
  runId: integer("run_id").notNull(),
  transactionId: integer("transaction_id"),
  settlementId: integer("settlement_id"),
  merchantId: integer("merchant_id").notNull(),
  status: text("status").notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  matchedAt: timestamp("matched_at", { withTimezone: true }),
  notes: text("notes"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedBy: integer("resolved_by"),
  resolvedByEmail: text("resolved_by_email"),
  resolutionType: text("resolution_type"),
  resolutionNotes: text("resolution_notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
