/**
 * Reusable Merchant Portal Browser Connector Engine — Type Definitions
 *
 * Every provider adapter implements the ProviderAdapter interface.
 * The ConnectorEngine class dispatches calls to the correct adapter
 * based on the platform_connection.provider slug.
 *
 * ADAPTER CONTRACT:
 *   - All methods must be async
 *   - All methods must be read-only with respect to the provider portal
 *   - No real-money operations (payments, refunds, payouts, settlements)
 *   - FAIL-CLOSED: if the adapter cannot safely proceed, return the
 *     BLOCKED or PARTNER_API_REQUIRED status; never fabricate CONNECTED
 *   - Never log, return, or store OTPs, passwords, or raw cookies in
 *     cleartext — use sessionCrypto.encrypt() for any session blob
 *
 * ADDING A NEW PROVIDER:
 *   1. Create artifacts/api-server/src/helpers/connectorEngine/adapters/<slug>.ts
 *   2. Export a const implementing ProviderAdapter
 *   3. Register it in adapters/registry.ts
 *   4. Add a provider row in seed.ts (matching slug)
 *   No other code changes are required.
 */

// ── Status ────────────────────────────────────────────────────────────────────

export type PortalSessionStatus =
  | "PENDING"
  | "AWAITING_OTP"
  | "AWAITING_PASSWORD"
  | "AWAITING_CAPTCHA"
  | "PARTNER_API_REQUIRED"
  | "CONNECTED"
  | "MONITORING"
  | "EXPIRED"
  | "BLOCKED"
  | "FAILED";

export type PortalTxStatus =
  | "SUCCESS"
  | "PENDING"
  | "FAILED"
  | "REVERSED"
  | "UNKNOWN";

export type PortalEntityType =
  | "merchant"
  | "store"
  | "device"
  | "qr"
  | "staff_account";

// ── Login methods ─────────────────────────────────────────────────────────────

export interface LoginMethod {
  /** Machine-readable key, e.g. "mobile_otp", "email_password", "mid_otp" */
  key: string;
  /** Human label shown in the UI */
  label: string;
  /** Primary identifier field (what the operator types first) */
  identifierLabel: string;
  identifierType: "mobile" | "email" | "username" | "mid" | "store_id";
  /** Whether this method uses an OTP step after the identifier */
  requiresOtp: boolean;
  /** Whether this method uses a password step */
  requiresPassword: boolean;
  /** Whether this method may present CAPTCHA or device-binding prompts */
  mayRequireCaptcha: boolean;
}

// ── Initiate session ──────────────────────────────────────────────────────────

export interface InitiateParams {
  loginMethod: string;
  /** Encrypted identifier (mobile/email/MID) — decrypted inside adapter */
  encryptedIdentifier: string;
  /** Encrypted password if requiresPassword — adapter decrypts, never stores */
  encryptedPassword?: string;
}

export interface InitiateResult {
  status: PortalSessionStatus;
  /**
   * Opaque encrypted session token.
   * Produced by sessionCrypto.encrypt().
   * Passed back to the adapter on every subsequent call.
   * NEVER returned to the frontend or logged.
   */
  encryptedSessionToken?: string;
  /** What the operator must do next */
  nextStep?: "ENTER_OTP" | "ENTER_PASSWORD" | "ENTER_CAPTCHA" | "COMPLETE" | null;
  nextStepPrompt?: string;
  /** Failure information (safe to surface to admin UI) */
  failReason?: string;
  failDetail?: string;
  helpUrl?: string;
}

// ── Submit OTP / password / CAPTCHA step ─────────────────────────────────────

export interface SubmitStepParams {
  encryptedSessionToken: string;
  /** Encrypted OTP string — adapter decrypts inside method, never stores */
  encryptedOtp?: string;
  /** Encrypted password — adapter decrypts, never stores after session is made */
  encryptedPassword?: string;
}

export interface SubmitStepResult {
  status: PortalSessionStatus;
  encryptedSessionToken?: string;
  nextStep?: "ENTER_OTP" | "ENTER_PASSWORD" | "ENTER_CAPTCHA" | "COMPLETE" | null;
  nextStepPrompt?: string;
  failReason?: string;
  failDetail?: string;
}

// ── Session validation ────────────────────────────────────────────────────────

export interface ValidateResult {
  valid: boolean;
  /** Updated session token if the adapter refreshed internal state */
  encryptedSessionToken?: string;
  expiresAt?: Date;
  reason?: string;
}

// ── Discovery ─────────────────────────────────────────────────────────────────

export interface DiscoveredEntity {
  entityType: PortalEntityType;
  providerEntityId: string;
  providerEntityName?: string;
  parentEntityId?: string;
  isPrimary: boolean;
  /** Raw metadata (no secrets) */
  metadata?: Record<string, unknown>;
}

export interface DiscoveryResult {
  entities: DiscoveredEntity[];
  /** Updated session token if the adapter refreshed internal state */
  encryptedSessionToken?: string;
}

// ── Transactions ──────────────────────────────────────────────────────────────

export interface FetchTransactionsParams {
  encryptedSessionToken: string;
  from: Date;
  to: Date;
  page?: number;
  pageSize?: number;
}

export interface NormalizedTransaction {
  /** Unique ID as assigned by the provider */
  providerTxId: string;
  utr?: string;
  rrn?: string;
  amount: number;
  currency: string;
  /** Normalised status */
  status: PortalTxStatus;
  /** Raw status string from provider before normalisation */
  providerStatus?: string;
  txTimestamp?: Date;
  settlementTimestamp?: Date;
  merchantIdProvider?: string;
  storeIdProvider?: string;
  deviceTid?: string;
  qrCodeId?: string;
  settlementReference?: string;
  /** Safe-to-store raw payload object */
  rawPayload?: Record<string, unknown>;
}

export interface FetchTransactionsResult {
  transactions: NormalizedTransaction[];
  hasMore: boolean;
  /** Updated session token if the adapter refreshed internal state */
  encryptedSessionToken?: string;
}

// ── Health check ──────────────────────────────────────────────────────────────

export interface HealthCheckResult {
  healthy: boolean;
  status: PortalSessionStatus;
  reason?: string;
  detail?: string;
}

// ── Provider adapter interface ────────────────────────────────────────────────

/**
 * Distinguishes API-key-based optional connectors from the primary
 * credential-first portal session connectors.
 *
 * "api_key_connector"      — Merchant pastes programmatic API keys (Key ID +
 *                            Secret, clientId + clientSecret, etc.).  These are
 *                            developer credentials generated in a dashboard, not
 *                            the merchant's own portal login details.  Optional
 *                            convenience path only.
 *
 * "portal_session_connector" — Merchant supplies their normal authorized login
 *                            details (mobile / email / username / MID + password
 *                            + manually entered OTP).  This is the primary
 *                            credential-first path required by Merchant Connect.
 *
 * The two kinds must never be merged, and an api_key_connector must never be
 * presented to users or in reports as satisfying the portal-session requirement.
 */
export type AdapterKind = "api_key_connector" | "portal_session_connector";

/**
 * Every provider adapter must implement this interface.
 * See adapters/pinelabs-one.ts for a reference fail-closed implementation.
 */
export interface ProviderAdapter {
  readonly slug: string;
  readonly displayName: string;
  /**
   * Declares whether this adapter uses programmatic API keys (api_key_connector)
   * or the merchant's own portal login credentials (portal_session_connector).
   * Must be set accurately — never label an API-key adapter as portal_session.
   */
  readonly adapterKind: AdapterKind;
  readonly category: "pos" | "gateway" | "bank" | "upi";

  /**
   * Login methods this adapter supports.
   * Empty array = no automation path available (fail-closed).
   */
  readonly supportedLoginMethods: LoginMethod[];

  /**
   * Initiate a new provider portal session.
   * Must be fail-closed: if the provider blocks automation, return
   * { status: "PARTNER_API_REQUIRED" | "BLOCKED", failReason, helpUrl }.
   */
  initiateSession(params: InitiateParams): Promise<InitiateResult>;

  /**
   * Submit OTP / password / CAPTCHA continuation step.
   * Called after initiateSession() returns AWAITING_OTP/PASSWORD/CAPTCHA.
   */
  submitStep(params: SubmitStepParams): Promise<SubmitStepResult>;

  /**
   * Validate an existing session token.
   * Returns { valid: false } if expired or revoked.
   */
  validateSession(encryptedSessionToken: string): Promise<ValidateResult>;

  /**
   * Discover merchants, stores, devices, and QR codes visible to this session.
   * Read-only. No writes to the provider portal.
   */
  discoverEntities(encryptedSessionToken: string): Promise<DiscoveryResult>;

  /**
   * Fetch and normalise transactions from the provider portal.
   * Read-only. Strict date range. Returns paginated results.
   * Must return ONLY successfully completed transactions correctly — never guess.
   */
  fetchTransactions(params: FetchTransactionsParams): Promise<FetchTransactionsResult>;

  /**
   * Light-weight health check (does NOT require a valid session token).
   * Returns whether the provider portal is reachable and the adapter is operational.
   */
  healthCheck(encryptedSessionToken?: string): Promise<HealthCheckResult>;

  /**
   * Reconnect an expired or disconnected session WITHOUT asking the merchant
   * for credentials again, when the adapter can silently re-authenticate from
   * the stored encrypted session data (e.g. API-key-based adapters).
   *
   * Return behaviour:
   *   CONNECTED           — session refreshed; encryptedSessionToken is the new token
   *   AWAITING_OTP        — provider requires a fresh OTP (e.g. mobile-OTP login)
   *   AWAITING_CAPTCHA    — CAPTCHA appeared; pause for manual completion
   *   FAILED + REQUIRES_FULL_REAUTH — stored credentials are no longer valid;
   *                         the UI must show the credential form again
   *   PARTNER_API_REQUIRED — adapter is fail-closed; no automation path
   *
   * Must NEVER fabricate CONNECTED.
   * Must NEVER re-use an OTP or re-submit a password without the merchant's
   * explicit action.
   */
  reconnect(encryptedSessionToken: string): Promise<InitiateResult>;

  /**
   * Safely log out of the provider portal session and invalidate the token.
   * Must not throw — swallow errors and return cleanly.
   */
  logout(encryptedSessionToken: string): Promise<void>;
}
