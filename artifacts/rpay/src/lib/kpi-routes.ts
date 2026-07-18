function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export const ADMIN_KPI_ROUTES = {
  totalDeposits:    "/admin/deposits",
  withdrawals:      "/admin/transactions?type=withdrawal",
  successTx:        "/admin/transactions?status=success",
  pendingActions:   "/admin/transactions?status=pending",
  netBalance:       "/admin/deposits",
  failedTx:         "/admin/transactions?status=failed",
  totalMerchants:   "/admin/merchants",
  pendingMerchants: "/admin/merchants?status=pending",
} as const;

export const MERCHANT_KPI_ROUTES = {
  todayDeposits:   () => `/merchant/transactions?from=${todayStr()}&to=${todayStr()}`,
  totalDeposits:   "/merchant/transactions",
  activeQrCodes:   "/merchant/qr-codes",
  virtualAccounts: "/merchant/virtual-accounts",
  apiKeys:         "/merchant/api-keys",
} as const;

export const PAYOUT_ADMIN_KPI_ROUTES = {
  payoutMerchants: "/payout-admin/payout-merchants",
  pendingApproval: "/payout-admin/payouts?status=PENDING_ADMIN_APPROVAL",
  todayPayouts:    "/payout-admin/payouts",
  todayVolume:     "/payout-admin/payouts",
  activeAgents:    "/payout-admin/agents",
} as const;

export const PAYOUT_MERCHANT_KPI_ROUTES = {
  availableBalance: "/payout-merchant/wallet",
  totalSent:        "/payout-merchant/payouts?status=Sent",
  pending:          "/payout-merchant/payouts?status=Processing",
  failed:           "/payout-merchant/payouts?status=Failed",
} as const;

export const AGENT_KPI_ROUTES = {
  totalMerchants:   "/agent/payout-merchants",
  pending:          "/agent/payout-merchants?status=pending",
  active:           "/agent/payout-merchants?status=approved",
  rejected:         "/agent/payout-merchants?status=rejected",
  commissionEarned: "/agent/commission",
  withdrawable:     "/agent/commission",
} as const;
