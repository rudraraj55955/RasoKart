import { pgTable, serial, text, integer, numeric, timestamp, index } from "drizzle-orm/pg-core";

/**
 * Agent commission ledger — one row per credit or debit event on an agent's
 * commission wallet.
 *
 * type values:
 *   earned      — commission credited when a referred merchant's transaction settles
 *   paid        — payout of accumulated commission to the agent
 *   adjustment  — manual correction by admin (positive or negative)
 */
export const agentCommissionLedgerTable = pgTable("agent_commission_ledger", {
  id: serial("id").primaryKey(),
  agentId: integer("agent_id").notNull(),
  type: text("type").notNull(), // earned | paid | adjustment
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  balanceBefore: numeric("balance_before", { precision: 18, scale: 2 }).notNull().default("0"),
  balanceAfter: numeric("balance_after", { precision: 18, scale: 2 }).notNull().default("0"),
  description: text("description").notNull(),
  referenceId: text("reference_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("agent_commission_ledger_agent_created_idx").on(table.agentId, table.createdAt),
]);

export type AgentCommissionLedgerEntry = typeof agentCommissionLedgerTable.$inferSelect;
