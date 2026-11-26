import { pgTable, serial, text, boolean, timestamp } from "drizzle-orm/pg-core";

/**
 * PLATFORM_CONNECTIONS — RasoKart's own provider accounts.
 *
 * Completely separate from merchant_connections (per-tenant credentials).
 * Only Super Admins can read or write these rows.
 * Credentials are AES-256-GCM encrypted at rest (same scheme as merchant_connections).
 */

export const PLATFORM_CONNECTION_STATUS = ["pending", "active", "suspended", "failed"] as const;
export const PLATFORM_CONNECTION_TEST_RESULT = ["pass", "fail", "untested"] as const;

export const platformConnectionsTable = pgTable("platform_connections", {
  id: serial("id").primaryKey(),
  /** matches providers.slug (cashfree, razorpay, payu, pinelabs …) */
  provider: text("provider").notNull(),
  /** Optional human label, e.g. "RasoKart Main Cashfree Payin" */
  label: text("label"),
  /** "sandbox" or "live" — set by the admin at creation time */
  environment: text("environment").notNull().default("sandbox"),

  // ── Credentials (AES-256-GCM encrypted at rest) ────────────────────────────
  // Format: enc:v1:<ivHex>:<tagHex>:<ciphertextHex>
  // Never returned in plaintext. Masked as "***" in all API responses.
  credentials: text("credentials"),

  // ── Lifecycle ───────────────────────────────────────────────────────────────
  connectionStatus: text("connection_status").notNull().default("pending"),
  isActive: boolean("is_active").notNull().default(false),
  deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),

  // ── Test / health ───────────────────────────────────────────────────────────
  lastTestedAt: timestamp("last_tested_at", { withTimezone: true }),
  lastTestResult: text("last_test_result").default("untested"),

  // ── Capability flags ────────────────────────────────────────────────────────
  capabilityPayin:        boolean("capability_payin").notNull().default(true),
  capabilityPayout:       boolean("capability_payout").notNull().default(false),
  capabilityUpi:          boolean("capability_upi").notNull().default(true),
  capabilityQr:           boolean("capability_qr").notNull().default(true),
  capabilityPaymentLinks: boolean("capability_payment_links").notNull().default(false),
  capabilityRefunds:      boolean("capability_refunds").notNull().default(false),
  capabilitySettlement:   boolean("capability_settlement").notNull().default(false),

  // ── Metadata ────────────────────────────────────────────────────────────────
  notes: text("notes"),
  createdByEmail: text("created_by_email"),

  // ── Timestamps ──────────────────────────────────────────────────────────────
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type PlatformConnection = typeof platformConnectionsTable.$inferSelect;
