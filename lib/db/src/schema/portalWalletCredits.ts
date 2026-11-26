import { pgTable, serial, text, numeric, timestamp, integer, index, unique } from "drizzle-orm/pg-core";
import { platformConnectionsTable } from "./platformConnections";
import { portalTransactionsTable } from "./portalTransactions";

/**
 * PORTAL_WALLET_CREDITS — immutable record of every RasoKart wallet credit
 * that originated from a portal transaction.
 *
 * EXACTLY ONE row per portal_transaction (enforced by the unique constraint on
 * portal_transaction_id). The connector engine writes this row atomically
 * alongside the wallet_ledger entry inside a DB transaction — if either fails,
 * neither is committed.
 *
 * Idempotency chain:
 *   1. portal_transactions.idempotency_key (providerSlug:providerTxId) — dedup
 *   2. portal_wallet_credits.portal_transaction_id — one credit per transaction
 *   3. wallet_ledger referenceType="portal_credit" + referenceId=this.id — ledger trace
 *
 * IMMUTABILITY: rows in this table are never updated after creation. If a
 * reversal is needed, a separate portal_transaction row with status=REVERSED
 * is created and a corresponding manual_debit wallet_ledger entry is written.
 *
 * SECURITY: merchant_id here is the RasoKart merchant that received the credit,
 * not the provider's merchant ID string. Only admin or the automated engine
 * writes these rows; merchants have no write access.
 */

export const portalWalletCreditsTable = pgTable(
  "portal_wallet_credits",
  {
    id: serial("id").primaryKey(),

    /** FK → portal_transactions.id — one credit per transaction */
    portalTransactionId: integer("portal_transaction_id")
      .notNull()
      .references(() => portalTransactionsTable.id, { onDelete: "restrict" }),

    platformConnectionId: integer("platform_connection_id")
      .notNull()
      .references(() => platformConnectionsTable.id, { onDelete: "restrict" }),

    /** RasoKart internal merchant ID that received the credit */
    merchantId: integer("merchant_id").notNull(),

    // ── Credit details ────────────────────────────────────────────────────────
    amount:   numeric("amount",   { precision: 18, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("INR"),

    /**
     * wallet_ledger.id of the ledger entry created for this credit.
     * Null only during the brief atomic window before the ledger row
     * is committed; always non-null after the transaction succeeds.
     */
    walletLedgerId: integer("wallet_ledger_id"),

    // ── Idempotency ───────────────────────────────────────────────────────────
    /**
     * Mirrors portal_transactions.idempotency_key.
     * Second dedup layer — if the engine ever attempts to credit the same
     * provider transaction twice, the DB UNIQUE constraint prevents it.
     */
    idempotencyKey: text("idempotency_key").notNull(),

    // ── Mode ──────────────────────────────────────────────────────────────────
    /** "auto" (engine-triggered) or the admin email who manually triggered it */
    creditedBy: text("credited_by").notNull().default("auto"),

    // ── Verification record ───────────────────────────────────────────────────
    /**
     * JSON object capturing the full pre-credit verification result:
     *   {
     *     txStatus: "SUCCESS",
     *     merchantOwnershipVerified: true,
     *     storeIdMatch: "STORE_123",
     *     deviceTid: "TID_456",
     *     providerTxId: "...",
     *     utr: "...",
     *     amount: "500.00",
     *     verifiedAt: "<ISO timestamp>"
     *   }
     */
    verificationRecord: text("verification_record").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("portal_wallet_credits_tx_uniq").on(table.portalTransactionId),
    unique("portal_wallet_credits_idempotency_uniq").on(table.idempotencyKey),
    index("portal_wallet_credits_merchant_idx").on(table.merchantId),
    index("portal_wallet_credits_connection_idx").on(table.platformConnectionId),
  ],
);

export type PortalWalletCredit = typeof portalWalletCreditsTable.$inferSelect;
