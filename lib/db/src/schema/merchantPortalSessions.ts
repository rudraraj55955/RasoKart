import {
  pgTable, serial, integer, text, boolean, timestamp, unique,
} from "drizzle-orm/pg-core";
import { merchantsTable } from "./merchants";

/**
 * MERCHANT_PORTAL_SESSIONS — tenant-owned portal automation sessions.
 *
 * Each row belongs exclusively to one merchant (merchantId FK). Merchants
 * can only read/write their own rows. No cross-merchant access is possible
 * at the API level (every query filters on req.user.merchantId).
 *
 * This is SEPARATE from portal_sessions (admin/platform-owned sessions).
 * Admins cannot see merchant portal sessions; merchants cannot see admin ones.
 *
 * Status FSM (identical to portal_sessions for consistency):
 *   PENDING → AWAITING_OTP → AWAITING_MPIN → AWAITING_CAPTCHA
 *          → CONNECTED → EXPIRED → DISCONNECTED | FAILED | LOCKED | SUSPENDED
 *
 * All providers are currently BLOCKED (PARTNER_API_REQUIRED). This table is
 * the infrastructure layer — ready for when providers issue official APIs.
 */
export const MERCHANT_PORTAL_SESSION_STATUS = [
  "PENDING",
  "AWAITING_OTP",
  "AWAITING_MPIN",
  "AWAITING_CAPTCHA",
  "CONNECTED",
  "EXPIRED",
  "DISCONNECTED",
  "FAILED",
  "LOCKED",
  "SUSPENDED",
] as const;

export type MerchantPortalSessionStatus =
  (typeof MERCHANT_PORTAL_SESSION_STATUS)[number];

export const merchantPortalSessionsTable = pgTable(
  "merchant_portal_sessions",
  {
    id: serial("id").primaryKey(),

    /** Owning merchant — immutable after INSERT. */
    merchantId: integer("merchant_id")
      .notNull()
      .references(() => merchantsTable.id, { onDelete: "cascade" }),

    /**
     * Provider slug — matches providers.slug (pinelabs_one, phonepe, paytm …).
     * Not a FK so the table survives provider catalog changes.
     */
    providerSlug: text("provider_slug").notNull(),

    /** Current FSM state. */
    status: text("status").notNull().default("PENDING"),

    /**
     * AES-256-GCM encrypted session token (enc:v1:<ivHex>:<tagHex>:<cipherHex>).
     * Never returned to the client — stripped from every API response.
     */
    encryptedSession: text("encrypted_session"),

    /**
     * How many consecutive step-submission failures for this session.
     * Resets to 0 on each successful step.
     */
    stepFailureCount: integer("step_failure_count").notNull().default(0),

    /**
     * Provider-returned error code on the last failure (e.g. "INVALID_OTP").
     * Cleared on success.
     */
    lastErrorCode: text("last_error_code"),

    /**
     * Human-readable status message from the last provider response.
     * Shown to the merchant in the UI.
     */
    lastStatusMessage: text("last_status_message"),

    /**
     * When the session token expires (UTC). Null for PENDING/FAILED rows.
     */
    expiresAt: timestamp("expires_at", { withTimezone: true }),

    /**
     * When the session transitioned to CONNECTED (UTC).
     */
    connectedAt: timestamp("connected_at", { withTimezone: true }),

    /**
     * When the session was disconnected or expired (UTC).
     */
    endedAt: timestamp("ended_at", { withTimezone: true }),

    /**
     * Reason the session ended (TIMEOUT, MERCHANT_REQUEST, PROVIDER_REVOKED, etc.).
     */
    endReason: text("end_reason"),

    /**
     * Whether dry-run mode is active (credits simulated, not real).
     */
    dryRun: boolean("dry_run").notNull().default(true),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // One active session per (merchant, provider). CONNECTED/AWAITING_* rows
    // are unique; ENDED rows are archived.
    unique("merchant_portal_sessions_active_uniq").on(
      t.merchantId,
      t.providerSlug,
    ),
  ],
);

export type MerchantPortalSession =
  typeof merchantPortalSessionsTable.$inferSelect;
