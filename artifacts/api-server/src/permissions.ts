/**
 * IAM Permission Catalog — single source of truth for all permission keys.
 * Convention: snake_case grouping by portal prefix.
 *
 * ── Canonical role model ──────────────────────────────────────────────────────
 * The system has 7 string role values stored in users.role, plus a boolean
 * super-admin escalation flag (users.is_super_admin):
 *
 *   isSuperAdmin=true   → SUPER_ADMIN semantics: bypasses all IAM checks,
 *                         resolveUserPermissions returns { __all__: true }
 *   role="admin"        → platform admin (admin portal access)
 *   role="merchant"     → standard payment merchant
 *   role="payout_merchant"    → merchant with payout access
 *   role="payout_admin"       → payout operations admin
 *   role="payout_super_admin" → elevated payout admin (full payout ops)
 *   role="agent"        → support/ops agent (read-heavy, limited writes)
 *   role="customer"     → end-customer (lowest privilege)
 *
 * This 7-role model has been the production taxonomy since day 1 and is
 * intentional — do not consolidate or rename roles without a full DB migration.
 * The payout_admin / payout_super_admin split reflects the payout system's
 * own privilege hierarchy, analogous to admin / super-admin in the main portal.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const PERMISSIONS = {
  // ── Admin portal ─────────────────────────────────────────────────────────
  ADMIN_DASHBOARD:         "admin_dashboard",
  ADMIN_MERCHANTS:         "admin_merchants",
  ADMIN_TRANSACTIONS:      "admin_transactions",
  ADMIN_SETTLEMENTS:       "admin_settlements",
  ADMIN_PAYOUTS:           "admin_payouts",
  ADMIN_USERS:             "admin_users",
  ADMIN_PLANS:             "admin_plans",
  ADMIN_WEBHOOKS:          "admin_webhooks",
  ADMIN_AUDIT_LOGS:        "admin_audit_logs",
  ADMIN_FEATURE_CONTROL:   "admin_feature_control",
  ADMIN_SETTINGS:          "admin_settings",
  ADMIN_COMPANY_BRANDING:  "admin_company_branding",
  ADMIN_DATA_HYGIENE:      "admin_data_hygiene",
  ADMIN_SMART_ROUTING:     "admin_smart_routing",
  ADMIN_KYC:               "admin_kyc",
  ADMIN_PROVIDERS:         "admin_providers",
  ADMIN_REPORTS:           "admin_reports",
  ADMIN_SUPPORT:           "admin_support",
  ADMIN_PAYOUT_ADMINS:     "admin_payout_admins",
  ADMIN_PAYOUT_MERCHANTS:  "admin_payout_merchants",
  ADMIN_PAYOUT_SETTINGS:   "admin_payout_settings",
  ADMIN_RAZORPAY:          "admin_razorpay",
  ADMIN_SOCIAL_PROVIDERS:  "admin_social_providers",
  ADMIN_SECURE_ID:         "admin_secure_id",
  ADMIN_OTP_SETTINGS:      "admin_otp_settings",
  ADMIN_RECONCILIATION:    "admin_reconciliation",
  ADMIN_MODULE_CONTROL:    "admin_module_control",
  ADMIN_PLATFORM_PROFIT:   "admin_platform_profit",
  ADMIN_UTR_VERIFICATIONS: "admin_utr_verifications",
  ADMIN_PAYIN_CHARGES:     "admin_payin_charges",
  ADMIN_CONNECTIONS:       "admin_connections",
  ADMIN_API_MONITORING:    "admin_api_monitoring",

  // ── IAM (Super Admin only by default) ────────────────────────────────────
  IAM_READ:   "iam_read",
  IAM_MANAGE: "iam_manage",

  // ── Merchant portal ───────────────────────────────────────────────────────
  MERCHANT_DASHBOARD:        "merchant_dashboard",
  MERCHANT_TRANSACTIONS:     "merchant_transactions",
  MERCHANT_PAYOUTS:          "merchant_payouts",
  MERCHANT_API_KEYS:         "merchant_api_keys",
  MERCHANT_WEBHOOK:          "merchant_webhook",
  MERCHANT_VIRTUAL_ACCOUNTS: "merchant_virtual_accounts",
  MERCHANT_QR_CODES:         "merchant_qr_codes",
  MERCHANT_LEDGER:           "merchant_ledger",
  MERCHANT_REPORTS:          "merchant_reports",
  MERCHANT_KYC:              "merchant_kyc",
  MERCHANT_ONBOARDING:       "merchant_onboarding",
  MERCHANT_SUPPORT:          "merchant_support",
  MERCHANT_PAYMENT_LINKS:    "merchant_payment_links",

  // ── Payout merchant portal ────────────────────────────────────────────────
  PAYOUT_MERCHANT_DASHBOARD:    "payout_merchant_dashboard",
  PAYOUT_MERCHANT_PAYOUTS:      "payout_merchant_payouts",
  PAYOUT_MERCHANT_KYC:          "payout_merchant_kyc",
  PAYOUT_MERCHANT_WALLET_LOADS: "payout_merchant_wallet_loads",

  // ── Payout admin portal ───────────────────────────────────────────────────
  PAYOUT_ADMIN_DASHBOARD:  "payout_admin_dashboard",
  PAYOUT_ADMIN_MERCHANTS:  "payout_admin_merchants",
  PAYOUT_ADMIN_AUDIT_LOGS: "payout_admin_audit_logs",
  PAYOUT_ADMIN_SETTINGS:   "payout_admin_settings",

  // ── Agent portal ──────────────────────────────────────────────────────────
  AGENT_DASHBOARD:  "agent_dashboard",
  AGENT_MERCHANTS:  "agent_merchants",
  AGENT_COMMISSION: "agent_commission",
  AGENT_PROFILE:    "agent_profile",

  // ── Customer (payment link / checkout consumers) ───────────────────────
  // Customers are not portal users — they interact only through public
  // checkout flows and payment links. They have zero portal permissions by
  // default; this key exists so the canonical role model is complete and
  // any future customer-portal features can be gated here.
  CUSTOMER_CHECKOUT: "customer_checkout",
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSION_KEYS: PermissionKey[] = Object.values(PERMISSIONS) as PermissionKey[];

/**
 * Permissions that are Super Admin-only by convention.
 * Regular admin users do NOT receive these in the default role template.
 * Super Admin bypasses all checks entirely via the isSuperAdmin flag.
 */
export const SUPER_ADMIN_ONLY_PERMISSIONS: Set<string> = new Set([
  PERMISSIONS.ADMIN_COMPANY_BRANDING,
  PERMISSIONS.ADMIN_DATA_HYGIENE,
  PERMISSIONS.ADMIN_RAZORPAY,
  PERMISSIONS.ADMIN_SOCIAL_PROVIDERS,
  PERMISSIONS.ADMIN_SECURE_ID,
  PERMISSIONS.ADMIN_OTP_SETTINGS,
  PERMISSIONS.ADMIN_PLATFORM_PROFIT,
  PERMISSIONS.IAM_READ,
  PERMISSIONS.IAM_MANAGE,
]);

/**
 * Canonical roles in the RasoKart IAM system — the 6-entity model:
 *
 *   1. SUPER_ADMIN — modelled as `users.is_super_admin = TRUE` (not a role string).
 *                    Bypasses all permission checks. Only one in the system.
 *   2. admin          — platform admin; full ops dashboard, minus SA-only keys.
 *   3. merchant       — self-serve payment merchant.
 *   4. payout_merchant — wallet & payout-collection merchant.
 *   5. agent          — referral/commission tracking; read-heavy.
 *   6. customer       — checkout consumer; no portal access.
 *
 * CANONICAL_ROLES lists the 5 role string values that appear in `users.role`
 * for the canonical set. Together with the `isSuperAdmin` flag they form the
 * complete 6-entity canonical model.
 *
 * The payout system also defines two EXTENDED_ROLES (payout_admin and
 * payout_super_admin) that represent the payout platform's own ops hierarchy.
 * They are managed by the IAM engine but are not part of the 6-entity canonical
 * set — they are payout-subsystem-specific extensions. Use KNOWN_ROLES (which
 * includes both canonical and extended) when iterating over ALL system roles.
 */
export const CANONICAL_ROLES = [
  "admin",           // Admin portal — full ops access (non-SA)
  "merchant",        // Merchant portal — self-serve payment dashboard
  "payout_merchant", // Payout merchant portal — wallet & payout management
  "agent",           // Agent portal — referral & commission tracking
  "customer",        // Checkout consumer — no portal access; public flows only
] as const;

/**
 * Extended roles — payout subsystem's own privilege hierarchy.
 * Managed by the IAM engine (role_permissions rows, etc.) but not part of
 * the 6-entity canonical model above. They inherit the payout_admin_* key
 * prefix and differ only in operational authority level.
 */
export const EXTENDED_ROLES = [
  "payout_admin",       // Payout admin portal — payout ops oversight
  "payout_super_admin", // Elevated payout admin — broader authority
] as const;

/** All role strings that exist in `users.role` — canonical + extended. */
export const KNOWN_ROLES = [...CANONICAL_ROLES, ...EXTENDED_ROLES] as const;

export type CanonicalRole = (typeof CANONICAL_ROLES)[number];
export type ExtendedRole = (typeof EXTENDED_ROLES)[number];
export type KnownRole = (typeof KNOWN_ROLES)[number];

/**
 * Maps legacy camelCase boolean flag names (previously stored in users.permissions_json)
 * to their canonical new permission keys.
 *
 * Purpose: the IAM migration backfill must preserve effective access for users
 * whose permissionsJson contained keys that pre-date the IAM naming convention.
 * Any key in permissionsJson not found in ALL_PERMISSION_KEYS AND not found here
 * is truly unknown and will be logged + skipped (never silently dropped without trace).
 *
 * Add entries here whenever a legacy flag is discovered in real data — the key is
 * the exact string that appeared in permissions_json, the value is the canonical key.
 *
 * Role-specific context: the map is role-agnostic. If the same camelCase key could
 * map to different canonical keys for different roles, the safest approach is to
 * add the more-permissive mapping and let the backfill's role-escalation guard
 * (which rejects cross-role ALLOWs) trim any that go out of scope.
 */
export const LEGACY_KEY_MAP: Record<string, PermissionKey> = {
  // ── Admin-portal legacy flags ──────────────────────────────────────────────
  canViewMerchants:             "admin_merchants",
  canManageMerchants:           "admin_merchants",
  canViewTransactions:          "admin_transactions",
  canManageTransactions:        "admin_transactions",
  canViewSettlements:           "admin_settlements",
  canManageSettlements:         "admin_settlements",
  canViewPayouts:               "admin_payouts",
  canManagePayouts:             "admin_payouts",
  canManageUsers:               "admin_users",
  canManagePlans:               "admin_plans",
  canManageWebhooks:            "admin_webhooks",
  canViewAuditLogs:             "admin_audit_logs",
  canManageFeatureControl:      "admin_feature_control",
  canManageSettings:            "admin_settings",
  canManageSmartRouting:        "admin_smart_routing",
  canManageKyc:                 "admin_kyc",
  canViewKyc:                   "admin_kyc",
  canManageProviders:           "admin_providers",
  canViewProviders:             "admin_providers",
  canViewReports:               "admin_reports",
  canManageReports:             "admin_reports",
  canManageSupport:             "admin_support",
  canManagePayoutAdmins:        "admin_payout_admins",
  canManagePayoutMerchants:     "admin_payout_merchants",
  canManagePayoutSettings:      "admin_payout_settings",
  canManageReconciliation:      "admin_reconciliation",
  canViewReconciliation:        "admin_reconciliation",
  canManageModuleControl:       "admin_module_control",
  canViewPlatformProfit:        "admin_platform_profit",
  canManageUtrVerifications:    "admin_utr_verifications",
  canManagePayinCharges:        "admin_payin_charges",
  canViewConnections:           "admin_connections",
  canViewApiMonitoring:         "admin_api_monitoring",

  // ── Payout-admin legacy flags ─────────────────────────────────────────────
  canAccessPayoutDashboard:     "payout_admin_dashboard",
  canViewPayoutMerchants:       "payout_admin_merchants",
  canManagePayoutMerchantsList: "payout_admin_merchants",
  canViewPayoutAuditLogs:       "payout_admin_audit_logs",
  canManagePayoutAdminSettings: "payout_admin_settings",

  // ── Merchant-portal legacy flags ──────────────────────────────────────────
  canAccessMerchantDashboard:   "merchant_dashboard",
  canViewMerchantTransactions:  "merchant_transactions",
  canManageMerchantPayouts:     "merchant_payouts",
  canManageApiKeys:             "merchant_api_keys",
  canManageMerchantWebhook:     "merchant_webhook",
  canManageVirtualAccounts:     "merchant_virtual_accounts",
  canManageQrCodes:             "merchant_qr_codes",
  canViewLedger:                "merchant_ledger",
  canViewMerchantReports:       "merchant_reports",
  canManageMerchantKyc:         "merchant_kyc",
  canManageOnboarding:          "merchant_onboarding",
  canManageMerchantSupport:     "merchant_support",
  canManagePaymentLinks:        "merchant_payment_links",
};

export const ROLE_DEFAULT_PERMISSIONS: Record<string, Record<string, boolean>> = {
  admin: Object.fromEntries(
    ALL_PERMISSION_KEYS.map((k) => [
      k,
      k.startsWith("admin_") && !SUPER_ADMIN_ONLY_PERMISSIONS.has(k),
    ]),
  ),

  merchant: Object.fromEntries(
    ALL_PERMISSION_KEYS.map((k) => [k, k.startsWith("merchant_")]),
  ),

  payout_merchant: Object.fromEntries(
    ALL_PERMISSION_KEYS.map((k) => [k, k.startsWith("payout_merchant_")]),
  ),

  payout_admin: Object.fromEntries(
    ALL_PERMISSION_KEYS.map((k) => [k, k.startsWith("payout_admin_")]),
  ),

  payout_super_admin: Object.fromEntries(
    ALL_PERMISSION_KEYS.map((k) => [k, k.startsWith("payout_admin_")]),
  ),

  agent: Object.fromEntries(
    ALL_PERMISSION_KEYS.map((k) => [k, k.startsWith("agent_")]),
  ),

  // Customers have no portal permissions — they use public checkout flows.
  // All permission keys default to false; only customer_checkout is their
  // natural domain and can be explicitly granted when a customer portal
  // feature is introduced.
  customer: Object.fromEntries(
    ALL_PERMISSION_KEYS.map((k) => [k, false]),
  ),
};
