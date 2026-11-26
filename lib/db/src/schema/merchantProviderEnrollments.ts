import { pgTable, serial, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { merchantsTable } from "./merchants";

/**
 * ENROLLMENT_STATUS — lifecycle of a merchant's self-service enrollment for a
 * payment provider. This is separate from merchant_connections, which tracks
 * admin-configured platform connections.
 *
 *   not_enrolled         — no record (or explicitly reset)
 *   pending_kyc          — merchant has initiated; redirected to provider signup
 *   credentials_submitted — merchant submitted API credentials for review/activation
 *   active               — credentials verified; provider ready for use
 *   suspended            — connection suspended (health check failed or admin action)
 *   disconnected         — merchant explicitly disconnected; credentials cleared
 */
export const ENROLLMENT_STATUS = [
  "not_enrolled",
  "pending_kyc",
  "credentials_submitted",
  "active",
  "suspended",
  "disconnected",
] as const;

export type EnrollmentStatus = (typeof ENROLLMENT_STATUS)[number];

/**
 * merchant_provider_enrollments — merchant self-service provider connection records.
 *
 * Security contract:
 *   - encryptedApiKey / encryptedApiSecret / encryptedWebhookSecret are stored
 *     using AES-256-GCM via encryptSecret() and NEVER returned in API responses.
 *   - maskedIdentifier holds only the last 4 chars of the mobile/email used to
 *     initiate enrollment — safe to display.
 *   - Audit logs capture connect, credential-update, disconnect events without
 *     storing credential values.
 */
export const merchantProviderEnrollmentsTable = pgTable(
  "merchant_provider_enrollments",
  {
    id: serial("id").primaryKey(),

    merchantId: integer("merchant_id")
      .notNull()
      .references(() => merchantsTable.id, { onDelete: "cascade" }),

    /** Matches providers.slug (phonepe, paytm, bharatpe, amazon_pay, mobikwik, ekqr, …) */
    providerSlug: text("provider_slug").notNull(),

    enrollmentStatus: text("enrollment_status").notNull().default("pending_kyc"),

    // ── Credentials (AES-256-GCM encrypted at rest) ──────────────────────────
    // Format: enc:v1:<ivHex>:<tagHex>:<ciphertextHex>
    // NEVER returned in any API response. Masked as "***" in list/read endpoints.
    encryptedApiKey:        text("encrypted_api_key"),
    encryptedApiSecret:     text("encrypted_api_secret"),
    encryptedWebhookSecret: text("encrypted_webhook_secret"),

    // ── Safe display field (not a secret) ─────────────────────────────────────
    /** Last 4 chars of mobile/email used at enrollment initiation. Safe to show. */
    maskedIdentifier: text("masked_identifier"),

    // ── Onboarding link stored at enrollment initiation ───────────────────────
    onboardingUrl: text("onboarding_url"),

    // ── Lifecycle timestamps ──────────────────────────────────────────────────
    connectedAt:     timestamp("connected_at",     { withTimezone: true }),
    lastVerifiedAt:  timestamp("last_verified_at", { withTimezone: true }),
    disconnectedAt:  timestamp("disconnected_at",  { withTimezone: true }),
    disconnectedBy:  text("disconnected_by"),   // "merchant" | "admin" | "system"

    failureReason: text("failure_reason"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("merchant_provider_enrollments_uniq").on(table.merchantId, table.providerSlug),
  ]
);

export type MerchantProviderEnrollment = typeof merchantProviderEnrollmentsTable.$inferSelect;
export type InsertMerchantProviderEnrollment = typeof merchantProviderEnrollmentsTable.$inferInsert;
