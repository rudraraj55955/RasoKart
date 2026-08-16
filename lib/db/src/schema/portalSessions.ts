import { pgTable, serial, text, timestamp, integer, index } from "drizzle-orm/pg-core";
import { platformConnectionsTable } from "./platformConnections";

/**
 * PORTAL_SESSIONS — encrypted provider-portal sessions per platform connection.
 *
 * One row per active or recent session attempt for a platform_connections entry.
 * The connector engine writes and reads this table exclusively via the
 * portalSessions route; credentials and cookies are AES-256-GCM encrypted at
 * rest and are NEVER returned in plaintext through any API response.
 *
 * Status lifecycle:
 *   PENDING              → initiateSession() called; adapter not yet started
 *   AWAITING_OTP         → OTP sent; waiting for operator to call /submit-otp
 *   AWAITING_PASSWORD    → password step required; waiting for /submit-otp
 *   AWAITING_CAPTCHA     → CAPTCHA/device-binding step; manual handoff required
 *   PARTNER_API_REQUIRED → adapter is fail-closed; no automation path available
 *   CONNECTED            → session authenticated and validated
 *   MONITORING           → session active; data is being fetched
 *   EXPIRED              → session expired; reconnect required
 *   BLOCKED              → provider blocked automation or ToS does not permit it
 *   FAILED               → connection failed for another reason
 *
 * Security invariants:
 *   - encrypted_session is never logged or returned in API responses
 *   - OTPs are never stored; only the session token post-authentication is kept
 *   - All writes go through the connector engine, never direct DB manipulation
 *   - Tenant isolation: each row belongs to exactly one platform_connection
 */

export const PORTAL_SESSION_STATUS = [
  "PENDING",
  "AWAITING_OTP",
  "AWAITING_PASSWORD",
  "AWAITING_CAPTCHA",
  "PARTNER_API_REQUIRED",
  "CONNECTED",
  "MONITORING",
  "EXPIRED",
  "BLOCKED",
  "FAILED",
] as const;
export type PortalSessionStatus = (typeof PORTAL_SESSION_STATUS)[number];

export const portalSessionsTable = pgTable(
  "portal_sessions",
  {
    id: serial("id").primaryKey(),

    /** FK → platform_connections.id */
    platformConnectionId: integer("platform_connection_id")
      .notNull()
      .references(() => platformConnectionsTable.id, { onDelete: "cascade" }),

    /** Mirrors platform_connections.provider for fast filtering */
    providerSlug: text("provider_slug").notNull(),

    // ── Status machine ──────────────────────────────────────────────────────
    status: text("status").notNull().default("PENDING"),

    // ── Next step hint ───────────────────────────────────────────────────────
    /** What the operator must do next (e.g. "ENTER_OTP", "ENTER_CAPTCHA") */
    nextStep: text("next_step"),
    nextStepPrompt: text("next_step_prompt"),

    // ── Encrypted session token ──────────────────────────────────────────────
    // Format: enc:v1:<ivHex>:<authTagHex>:<ciphertextHex>
    // Contains serialised browser cookies / API bearer token / session blob.
    // NEVER returned in any API response; used only server-side by the engine.
    encryptedSession: text("encrypted_session"),

    // ── Failure info (safe to return in API responses) ───────────────────────
    failReason: text("fail_reason"),
    failDetail: text("fail_detail"),
    helpUrl:    text("help_url"),

    // ── Discovery cache ───────────────────────────────────────────────────────
    /** JSON: { merchantIds: string[], storeIds: string[], deviceTids: string[], qrIds: string[] } */
    discoverySnapshot: text("discovery_snapshot"),
    lastDiscoveredAt:  timestamp("last_discovered_at", { withTimezone: true }),

    // ── Health ────────────────────────────────────────────────────────────────
    lastValidatedAt: timestamp("last_validated_at", { withTimezone: true }),
    expiresAt:       timestamp("expires_at",        { withTimezone: true }),
    lastHealthCheckAt: timestamp("last_health_check_at", { withTimezone: true }),
    lastHealthStatus:  text("last_health_status"),

    // ── Audit ─────────────────────────────────────────────────────────────────
    initiatedByEmail: text("initiated_by_email"),
    disconnectedByEmail: text("disconnected_by_email"),
    disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("portal_sessions_connection_idx").on(table.platformConnectionId),
    index("portal_sessions_provider_status_idx").on(table.providerSlug, table.status),
  ],
);

export type PortalSession = typeof portalSessionsTable.$inferSelect;
