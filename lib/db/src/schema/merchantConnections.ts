import { pgTable, serial, integer, text, boolean, numeric, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * CONNECTION_STATUS — lifecycle of a merchant-provider connection.
 *   pending    created but not yet tested or activated
 *   active     tested and enabled for live traffic
 *   suspended  manually suspended by admin (no traffic, preserves config)
 *   failed     last test failed; admin must retest before activation
 */
export const CONNECTION_STATUS = ["pending", "active", "suspended", "failed"] as const;

/**
 * CONNECTION_TEST_RESULT — outcome of the last test-connection call.
 *   pass      connectivity and credential check passed
 *   fail      check failed (see lastTestError in test response)
 *   untested  no test has been run yet
 */
export const CONNECTION_TEST_RESULT = ["pass", "fail", "untested"] as const;

/**
 * CONNECTION_OWNERSHIP — who owns the provider credentials.
 *   rasokart_owned  RasoKart's platform account assigned to this merchant
 *   merchant_owned  merchant's own approved provider credentials
 */
export const CONNECTION_OWNERSHIP = ["rasokart_owned", "merchant_owned"] as const;

export const merchantConnectionsTable = pgTable("merchant_connections", {
  id: serial("id").primaryKey(),
  merchantId: integer("merchant_id").notNull(),
  provider: text("provider").notNull(), // matches providers.slug (upi_id, google_pay, phonepe, cashfree, payu, ekqr, razorpay …)

  // ── Credentials (AES-256-GCM encrypted at rest via encryptSecret()) ────────
  // Format: enc:v1:<ivHex>:<tagHex>:<ciphertextHex>
  // Never returned in plaintext by any list/read API. Masked as "***" in responses.
  // Use POST /api/connections/:id/test to verify without exposing the value.
  credentials: text("credentials"),

  // ── Limits ─────────────────────────────────────────────────────────────────
  monthlyLimit: numeric("monthly_limit", { precision: 18, scale: 2 }).notNull().default("0"),

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  isActive: boolean("is_active").notNull().default(true),
  connectionStatus: text("connection_status").notNull().default("active"),
  deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),

  // ── Test / health ──────────────────────────────────────────────────────────
  lastTestedAt: timestamp("last_tested_at", { withTimezone: true }),
  lastTestResult: text("last_test_result").default("untested"),

  // ── Ownership ──────────────────────────────────────────────────────────────
  ownership: text("ownership").notNull().default("rasokart_owned"),

  // ── Per-connection capability flags ────────────────────────────────────────
  // Enforced server-side in addition to UI hiding.
  // Defaults follow the most conservative safe set; admin enables explicitly.
  capabilityPayin: boolean("capability_payin").notNull().default(true),
  capabilityPayout: boolean("capability_payout").notNull().default(false),
  capabilityUpi: boolean("capability_upi").notNull().default(true),
  capabilityQr: boolean("capability_qr").notNull().default(true),
  capabilityPaymentLinks: boolean("capability_payment_links").notNull().default(false),
  capabilityRefunds: boolean("capability_refunds").notNull().default(false),
  capabilitySettlement: boolean("capability_settlement").notNull().default(false),

  // ── Visibility / metadata ──────────────────────────────────────────────────
  visibilityEnabled: boolean("visibility_enabled").notNull().default(true),
  notes: text("notes"),

  // ── Timestamps ────────────────────────────────────────────────────────────
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertMerchantConnectionSchema = createInsertSchema(merchantConnectionsTable)
  .omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMerchantConnection = z.infer<typeof insertMerchantConnectionSchema>;
export type MerchantConnection = typeof merchantConnectionsTable.$inferSelect;
