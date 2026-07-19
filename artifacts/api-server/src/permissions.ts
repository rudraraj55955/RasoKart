/**
 * IAM Permission Catalog — single source of truth for all permission keys.
 * Convention: snake_case grouping by portal prefix.
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
 * Default permission map per role at IAM migration time.
 * Reflects what each role already had access to before IAM was introduced
 * — preserving all existing access.
 */
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
};
