import {
  pgTable, serial, integer, text, boolean, timestamp, uniqueIndex,
} from "drizzle-orm/pg-core";
import { merchantsTable } from "./merchants";

/**
 * MERCHANT_PORTAL_TRANSACTIONS — read-only transactions fetched from provider portals.
 *
 * Each row belongs exclusively to one merchant (merchantId FK). Merchants can only
 * read their own rows. No cross-merchant access is possible at the API level.
 *
 * Duplicate protection: UNIQUE INDEX on (merchant_id, provider_slug, external_id)
 * ensures the same provider transaction is never inserted twice regardless of how
 * many sync runs occur.
 *
 * dry_run = TRUE (default): transaction recorded but wallet NOT credited.
 *   Requires explicit admin approval per-connection to enable real crediting.
 * dry_run = FALSE: auto-credit flow may debit the provider balance and credit
 *   the merchant wallet (after all safeguards and reconciliation checks pass).
 *
 * raw_payload stores a safe JSON snapshot (no secrets, no PII beyond amounts/IDs)
 * for audit and reconciliation. Never store OTPs, passwords, or session tokens here.
 */

export const merchantPortalTransactionsTable = pgTable(
  "merchant_portal_transactions",
  {
    id: serial("id").primaryKey(),

    /** Owning merchant — all queries filter on this. */
    merchantId: integer("merchant_id")
      .notNull()
      .references(() => merchantsTable.id, { onDelete: "cascade" }),

    /** Provider slug (e.g. "razorpay"). Matches the adapter registry slug. */
    providerSlug: text("provider_slug").notNull(),

    /** Provider-assigned transaction ID (e.g. Razorpay "pay_XXXX"). */
    externalId: text("external_id").notNull(),

    /** Provider-assigned order ID (e.g. Razorpay "order_XXXX"). Nullable. */
    externalOrderId: text("external_order_id"),

    /** Amount in the provider's smallest currency unit (paise for INR). */
    amount: integer("amount").notNull(),

    /** ISO 4217 currency code. Defaults to INR. */
    currency: text("currency").notNull().default("INR"),

    /** Raw provider status string (e.g. "captured", "failed"). */
    status: text("status").notNull(),

    /** Normalised status: SUCCESS | PENDING | FAILED | REVERSED | UNKNOWN. */
    normalizedStatus: text("normalized_status"),

    /** Payment method reported by the provider (e.g. "upi", "card", "netbanking"). */
    paymentMethod: text("payment_method"),

    /** UPI Transaction Reference / UTR number. */
    utr: text("utr"),

    /** Provider-reported transaction timestamp. */
    txTimestamp: timestamp("tx_timestamp", { withTimezone: true }),

    /**
     * Safe JSON snapshot of the provider transaction record.
     * Must NOT contain passwords, tokens, raw credentials, or sensitive PII.
     * Stored as a JSON string. Parsed on read if needed.
     */
    rawPayload: text("raw_payload"),

    /** When this row was fetched from the provider portal. */
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),

    /**
     * Dry-run flag — mirrors merchant_portal_sessions.dry_run at fetch time.
     * TRUE = record only; FALSE = eligible for auto-credit (requires explicit admin approval).
     */
    dryRun: boolean("dry_run").notNull().default(true),

    /** Whether this transaction was auto-credited to the merchant wallet. */
    autoCredited: boolean("auto_credited").notNull().default(false),

    /** FK to wallet_ledger.id if a wallet credit was created for this transaction. */
    walletLedgerId: integer("wallet_ledger_id"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    /**
     * Duplicate protection: one row per (merchant, provider, external_id).
     * ON CONFLICT DO NOTHING on insert = idempotent sync runs.
     */
    uniquePortalTx: uniqueIndex("merchant_portal_txns_unique_idx").on(
      table.merchantId,
      table.providerSlug,
      table.externalId,
    ),
  }),
);
