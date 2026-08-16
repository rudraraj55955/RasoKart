import { pgTable, serial, text, numeric, timestamp, integer, boolean, index, unique } from "drizzle-orm/pg-core";
import { platformConnectionsTable } from "./platformConnections";
import { portalSessionsTable } from "./portalSessions";

/**
 * PORTAL_TRANSACTIONS — normalized payment records fetched from provider portals.
 *
 * Written only by the connector engine's fetchTransactions() adapter method.
 * All monetary amounts are stored as NUMERIC(18,2) strings (PostgreSQL numeric).
 *
 * IDEMPOTENCY: The (provider_slug, provider_tx_id) pair is UNIQUE — the engine
 * will UPSERT on conflict, updating status/settlement fields but never creating
 * a duplicate credit.
 *
 * STATUS values (from provider, normalised by the adapter):
 *   SUCCESS   — payment confirmed settled; eligible for wallet credit
 *   PENDING   — payment in progress; must NOT be credited yet
 *   FAILED    — payment failed; never eligible for credit
 *   REVERSED  — payment was reversed/refunded; do not credit or reverse credit
 *   UNKNOWN   — provider returned an unrecognised status; treat as PENDING
 *
 * Only SUCCESS rows where is_credited = false are eligible for wallet credit.
 *
 * RAW PAYLOAD: raw_payload stores the serialised raw API/page response.
 * It is NOT encrypted because it contains no secrets — only transaction
 * metadata already visible to the authenticated merchant account.
 */

export const PORTAL_TX_STATUS = [
  "SUCCESS",
  "PENDING",
  "FAILED",
  "REVERSED",
  "UNKNOWN",
] as const;
export type PortalTxStatus = (typeof PORTAL_TX_STATUS)[number];

export const portalTransactionsTable = pgTable(
  "portal_transactions",
  {
    id: serial("id").primaryKey(),

    platformConnectionId: integer("platform_connection_id")
      .notNull()
      .references(() => platformConnectionsTable.id, { onDelete: "cascade" }),

    portalSessionId: integer("portal_session_id")
      .references(() => portalSessionsTable.id, { onDelete: "set null" }),

    // ── Provider identifiers ─────────────────────────────────────────────────
    providerSlug: text("provider_slug").notNull(),
    providerTxId: text("provider_tx_id").notNull(),

    // ── Payment reference ────────────────────────────────────────────────────
    /** Unique Transaction Reference / RRN / UPI reference from the payment network */
    utr: text("utr"),
    /** Bank Reference Number (IMPS/NEFT/RTGS for settlements) */
    rrn: text("rrn"),

    // ── Amount ───────────────────────────────────────────────────────────────
    amount:   numeric("amount",   { precision: 18, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("INR"),

    // ── Status ───────────────────────────────────────────────────────────────
    /** Normalised status (SUCCESS | PENDING | FAILED | REVERSED | UNKNOWN) */
    status: text("status").notNull(),

    /** Raw status string as returned by the provider portal (before normalisation) */
    providerStatus: text("provider_status"),

    // ── Timestamps ───────────────────────────────────────────────────────────
    /** When the transaction occurred at the provider (payment timestamp) */
    txTimestamp: timestamp("tx_timestamp", { withTimezone: true }),

    /** When the settlement was credited at the provider level */
    settlementTimestamp: timestamp("settlement_timestamp", { withTimezone: true }),

    // ── Provider entity binding ───────────────────────────────────────────────
    /** Merchant ID as known to the provider (from discovery) */
    merchantIdProvider: text("merchant_id_provider"),
    /** Store ID as known to the provider (from discovery) */
    storeIdProvider: text("store_id_provider"),
    /** POS Terminal / EDC Device ID */
    deviceTid: text("device_tid"),
    /** QR code ID if payment came via static/dynamic QR */
    qrCodeId: text("qr_code_id"),
    /** Provider-level settlement batch reference */
    settlementReference: text("settlement_reference"),

    // ── Idempotency / credit tracking ─────────────────────────────────────────
    /**
     * Idempotency key = "<providerSlug>:<providerTxId>".
     * Used as the dedup key for wallet credits. UNIQUE constraint enforces
     * exactly-once semantics even if fetchTransactions() returns the same row
     * multiple times across syncs.
     */
    idempotencyKey: text("idempotency_key").notNull(),

    /** True after a wallet credit row has been committed for this transaction */
    isCredited: boolean("is_credited").notNull().default(false),
    creditedAt: timestamp("credited_at", { withTimezone: true }),

    /**
     * Raw payload from the provider. Serialised JSON of the raw page/API
     * response for this transaction. Not encrypted (no secrets). Stored for
     * audit and manual reconciliation.
     */
    rawPayload: text("raw_payload"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("portal_transactions_idempotency_uniq").on(table.idempotencyKey),
    index("portal_transactions_connection_idx").on(table.platformConnectionId),
    index("portal_transactions_provider_tx_idx").on(table.providerSlug, table.providerTxId),
    index("portal_transactions_status_credited_idx").on(table.status, table.isCredited),
    index("portal_transactions_tx_timestamp_idx").on(table.txTimestamp),
  ],
);

export type PortalTransaction = typeof portalTransactionsTable.$inferSelect;
