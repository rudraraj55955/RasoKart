import { Switch, Route, Router as WouterRouter, Redirect, useLocation } from "wouter";
import { QueryClient, QueryClientProvider, MutationCache, QueryCache } from "@tanstack/react-query";
import { toast } from "sonner";
import { useEffect } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/auth-context";
import { useAuth } from "@/lib/auth-context";
import { getToken, getStoredUser } from "@/lib/auth";
import { ProtectedRoute } from "@/components/protected-route";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { PayoutMerchantLayout } from "@/components/layout/payout-merchant-layout";
import { PayoutAdminLayout } from "@/components/layout/payout-admin-layout";
import { AgentLayout } from "@/components/layout/agent-layout";
import { PageErrorBoundary } from "@/components/error-boundary";
import { Spinner } from "@/components/ui/spinner";
import { UserRole } from "@workspace/api-client-react";
import { useNoIndexSync } from "@/lib/use-no-index";
import NotFound from "@/pages/not-found";
import PayoutSlipPublic from "@/pages/payout-slip-public";
import PayoutVerifyPublic from "@/pages/payout-verify-public";

// Landing Page
import Landing from "@/pages/landing";
import UpiCollectionApi from "@/pages/upi-collection-api";
import PrivacyPolicy from "@/pages/privacy-policy";

// Legal / Policy Pages
import TermsAndConditions from "@/pages/terms-and-conditions";
import RefundCancellationPolicy from "@/pages/refund-cancellation-policy";
import ServiceDeliveryPolicy from "@/pages/service-delivery-policy";
import ContactUs from "@/pages/contact-us";
import GrievanceRedressalPolicy from "@/pages/grievance-redressal-policy";
import PricingFeesSettlementPolicy from "@/pages/pricing-fees-settlement-policy";
import MerchantAgreementPage from "@/pages/merchant-agreement";
import ProhibitedBusinesses from "@/pages/prohibited-businesses";
import KycAmlPolicy from "@/pages/kyc-aml-policy";
import PaymentPayoutSettlementPolicy from "@/pages/payment-payout-settlement-policy";
import ChargebackDisputePolicy from "@/pages/chargeback-dispute-policy";
import CookiePolicyPage from "@/pages/cookie-policy";
import SecurityPolicyPage from "@/pages/security-policy";
import DisclaimerPage from "@/pages/disclaimer";
import AdminLegalPages from "@/pages/admin/legal-pages";
import { CookieConsent } from "@/components/ui/cookie-consent";

// Auth Pages
import AdminLogin from "@/pages/admin/login";
import MerchantLogin from "@/pages/merchant/login";
import MerchantRegister from "@/pages/merchant/register";
import MerchantPending from "@/pages/merchant/pending";
import MerchantSuspended from "@/pages/merchant/suspended";
import AgentLogin from "@/pages/agent/login";
import AgentDashboard from "@/pages/agent/dashboard";
import AgentPayoutMerchants from "@/pages/agent/payout-merchants";
import AgentCommission from "@/pages/agent/commission";
import AgentProfile from "@/pages/agent/profile";

// Payout Admin Pages
import PayoutAdminLogin from "@/pages/payout-admin/login";
import PayoutAdminDashboard from "@/pages/payout-admin/dashboard";
import PayoutAdminMerchants from "@/pages/payout-admin/payout-merchants";
import PayoutAdminPayouts from "@/pages/payout-admin/payouts";
import PayoutAdminAgents from "@/pages/payout-admin/agents";
import PayoutAdminAuditLogs from "@/pages/payout-admin/audit-logs";
import PayoutAdminSettings from "@/pages/payout-admin/settings";

// Admin Pages
import AdminApiDocs from "@/pages/admin/api-docs";
import AdminDashboard from "@/pages/admin/dashboard";
import AdminTransactions from "@/pages/admin/transactions";
import AdminMerchants from "@/pages/admin/merchants";
import AdminWithdrawals from "@/pages/admin/withdrawals";
import AdminPayouts from "@/pages/admin/payouts";
import AdminPayoutBeneficiaries from "@/pages/admin/payout-beneficiaries";
import MerchantPayouts from "@/pages/merchant/payouts";
import AdminSettlements from "@/pages/admin/settlements";
import AdminCallbacks from "@/pages/admin/callbacks";
import AdminUsers from "@/pages/admin/users";
import AdminPlans from "@/pages/admin/plans";
import AdminInvoices from "@/pages/admin/invoices";
import AdminQrCodes from "@/pages/admin/qr-codes";
import AdminVirtualAccounts from "@/pages/admin/virtual-accounts";
import AdminDeposits from "@/pages/admin/deposits";
import AdminWebhookLogs from "@/pages/admin/webhook-logs";
import AdminPayoutWebhookLogs from "@/pages/admin/payout-webhook-logs";
import AdminApiMonitoring from "@/pages/admin/api-monitoring";
import AdminAuditLogs from "@/pages/admin/audit-logs";
import AdminUserRoles from "@/pages/admin/user-roles";
import AdminFeatureControl from "@/pages/admin/feature-control";
import AdminAccountDetails from "@/pages/admin/account-details";
import AdminQrProviders from "@/pages/admin/qr-providers";
import AdminProviders from "@/pages/admin/providers";
import AdminVisibilityRules from "@/pages/admin/visibility-rules";
import AdminMerchantAccess from "@/pages/admin/merchant-access";
import AdminLedger from "@/pages/admin/ledger";
import AdminReconciliation from "@/pages/admin/reconciliation";
import AdminPaymentLinks from "@/pages/admin/payment-links";
import AdminSettings from "@/pages/admin/settings";
import AdminCompanyBranding from "@/pages/admin/company-branding";
import AdminOtpSettings from "@/pages/admin/otp-settings";
import AdminOtpEmailSettings from "@/pages/admin/otp-email-settings";
import AdminSocialProviders from "@/pages/admin/social-providers";
import AdminDataHygiene from "@/pages/admin/data-hygiene";
import AdminSecureIdSettings from "@/pages/admin/secure-id-settings";
import AdminIam from "@/pages/admin/iam";
import AdminMerchantOnboarding from "@/pages/admin/merchant-onboarding";
import MerchantOnboarding from "@/pages/merchant/onboarding";
import MerchantAutoKyc from "@/pages/merchant/auto-kyc";
import AdminMerchantKyc from "@/pages/admin/merchant-kyc";
import AdminMerchantKycSettings from "@/pages/admin/merchant-kyc-settings";
import AdminPaymentGateway from "@/pages/admin/payment-gateway";
import AdminPayoutGateway from "@/pages/admin/payout-gateway";
import AdminPaymentGateways from "@/pages/admin/payment-gateways";
import AdminUpiGateways from "@/pages/admin/upi-gateways";
import AdminProviderIntegrations from "@/pages/admin/provider-integrations";
import AdminSmartRouting from "@/pages/admin/smart-routing";
import AdminModuleControl from "@/pages/admin/module-control";
import AdminWallets from "@/pages/admin/wallets";
import AdminWalletDetail from "@/pages/admin/wallet-detail";
import AdminSupportTickets from "@/pages/admin/support-tickets";
import AdminMerchantVerifications from "@/pages/admin/merchant-verifications";
import AdminUtrVerifications from "@/pages/admin/utr-verifications";
import AdminRazorpayTransactions from "@/pages/admin/razorpay-transactions";
import AdminRazorpayWebhookLogs from "@/pages/admin/razorpay-webhook-logs";
import PayPage from "@/pages/pay";
import QrPayPage from "@/pages/qr-pay";
import VaPayPage from "@/pages/va-pay";
import CheckoutPage from "@/pages/checkout";

// Merchant Pages
import MerchantDashboard from "@/pages/merchant/dashboard";
import MerchantTransactions from "@/pages/merchant/transactions";
import MerchantWithdrawals from "@/pages/merchant/withdrawals";
import MerchantApiKeys from "@/pages/merchant/api-keys";
import MerchantWebhook from "@/pages/merchant/webhook";
import MerchantCallbacks from "@/pages/merchant/callbacks";
import MerchantSettlements from "@/pages/merchant/settlements";
import MerchantProducts from "@/pages/merchant/products";
import MerchantConnect from "@/pages/merchant/connect";
import MerchantApiDocs from "@/pages/merchant/api-docs";
import MerchantVirtualAccounts from "@/pages/merchant/virtual-accounts";
import MerchantPlanPage from "@/pages/merchant/plan";
import MerchantQrCodes from "@/pages/merchant/qr-codes";
import MerchantDeposits from "@/pages/merchant/deposits";
import MerchantLedger from "@/pages/merchant/ledger";
import MerchantNotifications from "@/pages/merchant/notifications";
import MerchantPaymentLinks from "@/pages/merchant/payment-links";
import MerchantBranding from "@/pages/merchant/branding";
import MerchantSecurity from "@/pages/merchant/security";
import MerchantProfile from "@/pages/merchant/profile";
import MerchantRasokartServices from "@/pages/merchant/rasokart-services";
import MerchantVerification from "@/pages/merchant/verification";
import MerchantWallet from "@/pages/merchant/wallet";
import AdminKycReview from "@/pages/admin/kyc-review";
import MerchantReports from "@/pages/merchant/reports";
import AdminReports from "@/pages/admin/reports";
import AdminPlatformProfit from "@/pages/admin/platform-profit";
import MerchantSupport from "@/pages/merchant/support";
import MerchantAccountStatement from "@/pages/merchant/account-statement";
import AdminMerchantStatements from "@/pages/admin/merchant-statements";
import AdminPayoutMerchants from "@/pages/admin/payout-merchants";
import AdminPayoutMerchantDetail from "@/pages/admin/payout-merchant-detail";
import AdminPayoutWalletLoads from "@/pages/admin/payout-wallet-loads";

// Payout Merchant Pages
import PayoutMerchantLogin from "@/pages/payout-merchant/login";
import PayoutMerchantDashboard from "@/pages/payout-merchant/dashboard";
import PayoutMerchantLoadFunds from "@/pages/payout-merchant/load-funds";
import PayoutMerchantLoadHistory from "@/pages/payout-merchant/load-history";
import PayoutMerchantPayouts from "@/pages/payout-merchant/payouts";
import PayoutMerchantBulkPayouts from "@/pages/payout-merchant/bulk-payouts";
import PayoutMerchantBeneficiaries from "@/pages/payout-merchant/beneficiaries";
import PayoutMerchantWallet from "@/pages/payout-merchant/wallet";
import PayoutMerchantLedger from "@/pages/payout-merchant/ledger";
import PayoutMerchantProfile from "@/pages/payout-merchant/profile";
import PayoutMerchantKyc from "@/pages/payout-merchant/kyc";
import PayoutMerchantSignup from "@/pages/payout-merchant/signup";

function extractApiError(error: unknown): string | null {
  if (!error) return null;
  const e = error as any;
  return e?.response?.data?.error ?? e?.message ?? null;
}

// Errors from queries/mutations that set their own onError are left alone.
// This global handler only fires when NO per-call onError was set.
const queryClient = new QueryClient({
  mutationCache: new MutationCache({
    onError(error, _variables, _context, mutation) {
      // Skip if the mutation has a specific onError handler
      if (mutation.options.onError) return;
      const msg = extractApiError(error);
      toast.error(msg ?? "An error occurred. Please try again.");
    },
  }),
  queryCache: new QueryCache({
    onError(error, query) {
      // Only fire for background refetches (data was previously loaded), not initial loads
      if (query.state.data === undefined) return;
      const msg = extractApiError(error);
      // Suppress 401/403 — auth-context handles these already
      const status = (error as any)?.response?.status;
      if (status === 401 || status === 403) return;
      toast.error(msg ?? "Failed to refresh data. Please try again.");
    },
  }),
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

function AuthSpinner() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <Spinner className="w-8 h-8 text-primary" />
    </div>
  );
}

/**
 * /admin — show spinner while resolving, redirect admin to dashboard, else show login.
 * Never shows the login form to an already-authenticated admin.
 */
function SmartAdminEntry() {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && user?.role === UserRole.admin) {
      setLocation("/admin/dashboard", { replace: true } as Parameters<typeof setLocation>[1]);
    }
  }, [user, isLoading]);

  if (isLoading || user?.role === UserRole.admin) return <AuthSpinner />;
  return <AdminLogin />;
}

/**
 * /admin/login — same as SmartAdminEntry: redirect if already admin, else show login.
 */
function SmartAdminLogin() {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && user?.role === UserRole.admin) {
      setLocation("/admin/dashboard", { replace: true } as Parameters<typeof setLocation>[1]);
    }
  }, [user, isLoading]);

  if (isLoading || user?.role === UserRole.admin) return <AuthSpinner />;
  return <AdminLogin />;
}

/**
 * /merchant — show spinner while resolving, redirect merchant to dashboard, else show login.
 * Payout-only merchants go to /payout-merchant/dashboard instead.
 */
function SmartMerchantEntry() {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && user?.role === UserRole.merchant) {
      const merchantType = (user as any).merchantType;
      const dest = merchantType === "PAYOUT_ONLY"
        ? "/payout-merchant/dashboard"
        : "/merchant/dashboard";
      setLocation(dest, { replace: true } as Parameters<typeof setLocation>[1]);
    }
  }, [user, isLoading]);

  if (isLoading || user?.role === UserRole.merchant) return <AuthSpinner />;
  return <MerchantLogin />;
}

/**
 * /merchant/login — same as SmartMerchantEntry: redirect if already merchant, else show login.
 */
function SmartMerchantLogin() {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && user?.role === UserRole.merchant) {
      const merchantType = (user as any).merchantType;
      const dest = merchantType === "PAYOUT_ONLY"
        ? "/payout-merchant/dashboard"
        : "/merchant/dashboard";
      setLocation(dest, { replace: true } as Parameters<typeof setLocation>[1]);
    }
  }, [user, isLoading]);

  if (isLoading || user?.role === UserRole.merchant) return <AuthSpinner />;
  return <MerchantLogin />;
}

function AdminRoute({ component: Component }: { component: React.ComponentType }) {
  return (
    <ProtectedRoute allowedRoles={[UserRole.admin]}>
      <DashboardLayout>
        <PageErrorBoundary>
          <Component />
        </PageErrorBoundary>
      </DashboardLayout>
    </ProtectedRoute>
  );
}

function MerchantRoute({ component: Component }: { component: React.ComponentType }) {
  return (
    <ProtectedRoute allowedRoles={[UserRole.merchant]}>
      <DashboardLayout>
        <PageErrorBoundary>
          <Component />
        </PageErrorBoundary>
      </DashboardLayout>
    </ProtectedRoute>
  );
}

function PayoutMerchantRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  // Fallback for the moment right after a hard redirect from login: the
  // AuthProvider's /api/auth/me query may not have resolved yet, but the
  // token + user JSON were already written to storage before navigating.
  // Trust that immediately so a valid PAYOUT_ONLY session is never bounced
  // back to login while the context is still catching up.
  const fallbackToken = getToken();
  const fallbackUser = getStoredUser();
  const effectiveUser = user ?? (fallbackToken && fallbackUser ? fallbackUser : null);
  const effectiveIsLoading = isLoading && !effectiveUser;

  useEffect(() => {
    if (!effectiveIsLoading && !effectiveUser) {
      setLocation("/payout-merchant/login", { replace: true } as Parameters<typeof setLocation>[1]);
    } else if (!effectiveIsLoading && effectiveUser) {
      const role = effectiveUser.role as string;
      if (role === UserRole.payout_merchant) {
        // Dedicated payout_merchant role — always allowed here
      } else if (role === UserRole.merchant) {
        const merchantType = (effectiveUser as any).merchantType;
        if (merchantType === "NORMAL") {
          // Normal payin merchant tried to access payout-merchant routes
          setLocation("/merchant/dashboard", { replace: true } as Parameters<typeof setLocation>[1]);
        }
      } else {
        // Other role — send to their home
        setLocation("/", { replace: true } as Parameters<typeof setLocation>[1]);
      }
    }
  }, [effectiveUser, effectiveIsLoading]);

  if (effectiveIsLoading) return <AuthSpinner />;
  if (!effectiveUser) return <AuthSpinner />;
  const role = effectiveUser.role as string;
  if (role !== UserRole.payout_merchant && role !== UserRole.merchant) return <AuthSpinner />;
  if (role === UserRole.merchant && (effectiveUser as any).merchantType === "NORMAL") return <AuthSpinner />;

  return (
    <PayoutMerchantLayout>
      <PageErrorBoundary>
        <Component />
      </PageErrorBoundary>
    </PayoutMerchantLayout>
  );
}

function PayoutAdminRoute({ component: Component }: { component: React.ComponentType }) {
  return (
    <ProtectedRoute allowedRoles={[UserRole.payout_admin, UserRole.payout_super_admin]}>
      <PayoutAdminLayout>
        <Component />
      </PayoutAdminLayout>
    </ProtectedRoute>
  );
}

function AgentRoute({ component: Component }: { component: React.ComponentType }) {
  return (
    <ProtectedRoute allowedRoles={[UserRole.agent]}>
      <AgentLayout>
        <PageErrorBoundary>
          <Component />
        </PageErrorBoundary>
      </AgentLayout>
    </ProtectedRoute>
  );
}

function PublicPage({ component: Component }: { component: React.ComponentType }) {
  return (
    <DashboardLayout publicMode>
      <PageErrorBoundary>
        <Component />
      </PageErrorBoundary>
    </DashboardLayout>
  );
}

function Router() {
  useNoIndexSync();
  return (
    <Switch>
      {/* Public landing page */}
      <Route path="/" component={Landing} />

      {/* Smart entry routes — show login OR redirect to dashboard based on auth state */}
      <Route path="/admin" component={SmartAdminEntry} />
      <Route path="/merchant" component={SmartMerchantEntry} />
      <Route path="/agent" component={AgentLogin} />

      {/* Agent Routes */}
      <Route path="/agent/dashboard"><AgentRoute component={AgentDashboard} /></Route>
      <Route path="/agent/payout-merchants"><AgentRoute component={AgentPayoutMerchants} /></Route>
      <Route path="/agent/commission"><AgentRoute component={AgentCommission} /></Route>
      <Route path="/agent/profile"><AgentRoute component={AgentProfile} /></Route>
      <Route path="/merchant/apply" component={MerchantRegister} />
      <Route path="/merchant/pending" component={MerchantPending} />
      <Route path="/merchant/suspended" component={MerchantSuspended} />

      {/* Login aliases — smart: redirect if already authenticated for that role */}
      <Route path="/admin/login" component={SmartAdminLogin} />
      <Route path="/merchant/login" component={SmartMerchantLogin} />
      <Route path="/payout-admin/login" component={PayoutAdminLogin} />
      <Route path="/payout-merchant/login" component={PayoutMerchantLogin} />
      <Route path="/payout-merchant/signup" component={PayoutMerchantSignup} />
      <Route path="/merchant/register"><Redirect to="/merchant/apply" /></Route>

      {/* Admin Routes */}
      <Route path="/admin/dashboard"><AdminRoute component={AdminDashboard} /></Route>
      <Route path="/admin/merchants"><AdminRoute component={AdminMerchants} /></Route>
      <Route path="/admin/transactions"><AdminRoute component={AdminTransactions} /></Route>
      <Route path="/admin/withdrawals"><Redirect to="/admin/payouts" /></Route>
      <Route path="/admin/payouts"><AdminRoute component={AdminPayouts} /></Route>
      <Route path="/admin/payout-beneficiaries"><AdminRoute component={AdminPayoutBeneficiaries} /></Route>
      <Route path="/admin/settlements"><AdminRoute component={AdminSettlements} /></Route>
      <Route path="/admin/callbacks"><AdminRoute component={AdminCallbacks} /></Route>
      <Route path="/admin/users"><AdminRoute component={AdminUsers} /></Route>
      <Route path="/admin/plans"><AdminRoute component={AdminPlans} /></Route>
      <Route path="/admin/invoices"><AdminRoute component={AdminInvoices} /></Route>
      <Route path="/admin/qr-codes"><AdminRoute component={AdminQrCodes} /></Route>
      <Route path="/admin/virtual-accounts"><AdminRoute component={AdminVirtualAccounts} /></Route>
      <Route path="/admin/deposits"><AdminRoute component={AdminDeposits} /></Route>
      <Route path="/admin/utr-verifications"><AdminRoute component={AdminUtrVerifications} /></Route>
      <Route path="/admin/razorpay-transactions"><AdminRoute component={AdminRazorpayTransactions} /></Route>
      <Route path="/admin/razorpay-webhook-logs"><AdminRoute component={AdminRazorpayWebhookLogs} /></Route>
      <Route path="/admin/webhook-logs"><AdminRoute component={AdminWebhookLogs} /></Route>
      <Route path="/admin/payout-webhook-logs"><AdminRoute component={AdminPayoutWebhookLogs} /></Route>
      <Route path="/admin/api-monitoring"><AdminRoute component={AdminApiMonitoring} /></Route>
      <Route path="/admin/audit-logs"><AdminRoute component={AdminAuditLogs} /></Route>
      <Route path="/admin/user-roles"><AdminRoute component={AdminUserRoles} /></Route>
      <Route path="/admin/feature-control"><AdminRoute component={AdminFeatureControl} /></Route>
      <Route path="/admin/account-details"><AdminRoute component={AdminAccountDetails} /></Route>
      <Route path="/admin/qr-providers"><AdminRoute component={AdminQrProviders} /></Route>
      <Route path="/admin/providers"><AdminRoute component={AdminProviders} /></Route>
      <Route path="/admin/visibility-rules"><AdminRoute component={AdminVisibilityRules} /></Route>
      <Route path="/admin/merchant-access"><AdminRoute component={AdminMerchantAccess} /></Route>
      <Route path="/admin/ledger"><AdminRoute component={AdminLedger} /></Route>
      <Route path="/admin/reconciliation"><AdminRoute component={AdminReconciliation} /></Route>
      <Route path="/admin/payment-links"><AdminRoute component={AdminPaymentLinks} /></Route>
      <Route path="/admin/settings"><AdminRoute component={AdminSettings} /></Route>
      <Route path="/admin/company-branding"><AdminRoute component={AdminCompanyBranding} /></Route>
      <Route path="/admin/otp-settings"><AdminRoute component={AdminOtpSettings} /></Route>
      <Route path="/admin/otp-email-settings"><AdminRoute component={AdminOtpEmailSettings} /></Route>
      <Route path="/admin/social-providers"><AdminRoute component={AdminSocialProviders} /></Route>
      <Route path="/admin/data-hygiene"><AdminRoute component={AdminDataHygiene} /></Route>
      <Route path="/admin/secure-id-settings"><AdminRoute component={AdminSecureIdSettings} /></Route>
      <Route path="/admin/merchant-onboarding"><AdminRoute component={AdminMerchantOnboarding} /></Route>
      <Route path="/merchant/onboarding"><MerchantRoute component={MerchantOnboarding} /></Route>
      <Route path="/merchant/auto-kyc"><MerchantRoute component={MerchantAutoKyc} /></Route>
      <Route path="/admin/merchant-kyc"><AdminRoute component={AdminMerchantKyc} /></Route>
      <Route path="/admin/merchant-kyc-settings"><AdminRoute component={AdminMerchantKycSettings} /></Route>
      <Route path="/admin/payment-gateways"><AdminRoute component={AdminPaymentGateways} /></Route>
      <Route path="/admin/upi-gateways"><AdminRoute component={AdminUpiGateways} /></Route>
      <Route path="/admin/payin-gateway"><AdminRoute component={AdminPaymentGateway} /></Route>
      <Route path="/admin/payment-gateway"><AdminRoute component={AdminPaymentGateway} /></Route>
      <Route path="/admin/payout-gateway"><AdminRoute component={AdminPayoutGateway} /></Route>
      <Route path="/admin/provider-integrations"><AdminRoute component={AdminProviderIntegrations} /></Route>
      <Route path="/admin/smart-routing"><AdminRoute component={AdminSmartRouting} /></Route>
      <Route path="/admin/module-control"><AdminRoute component={AdminModuleControl} /></Route>
      <Route path="/admin/wallets/:merchantId"><AdminRoute component={AdminWalletDetail} /></Route>
      <Route path="/admin/wallets"><AdminRoute component={AdminWallets} /></Route>
      <Route path="/admin/kyc-review"><AdminRoute component={AdminKycReview} /></Route>
      <Route path="/admin/merchant-verifications"><AdminRoute component={AdminMerchantVerifications} /></Route>
      <Route path="/admin/reports"><AdminRoute component={AdminReports} /></Route>
      <Route path="/admin/platform-profit"><AdminRoute component={AdminPlatformProfit} /></Route>
      <Route path="/admin/support-tickets"><AdminRoute component={AdminSupportTickets} /></Route>
      <Route path="/admin/support"><AdminRoute component={AdminSupportTickets} /></Route>
      <Route path="/admin/merchant-statements"><AdminRoute component={AdminMerchantStatements} /></Route>
      <Route path="/admin/payout-merchants/:merchantId"><AdminRoute component={AdminPayoutMerchantDetail} /></Route>
      <Route path="/admin/payout-merchants"><AdminRoute component={AdminPayoutMerchants} /></Route>
      <Route path="/admin/payout-wallet-loads"><AdminRoute component={AdminPayoutWalletLoads} /></Route>
      <Route path="/admin/api-docs"><AdminRoute component={AdminApiDocs} /></Route>
      <Route path="/admin/legal-pages"><AdminRoute component={AdminLegalPages} /></Route>
      <Route path="/admin/iam"><AdminRoute component={AdminIam} /></Route>

      {/* Legacy/broken payout routes — redirect to canonical page */}
      <Route path="/admin/cashfree-payout"><Redirect to="/admin/payout-gateway" /></Route>
      <Route path="/admin/payout-settings"><Redirect to="/admin/payout-gateway" /></Route>
      <Route path="/admin/cas"><Redirect to="/admin/payout-gateway" /></Route>


      {/* Merchant Routes */}
      <Route path="/merchant/dashboard"><MerchantRoute component={MerchantDashboard} /></Route>
      <Route path="/merchant/transactions"><MerchantRoute component={MerchantTransactions} /></Route>
      <Route path="/merchant/withdrawals"><Redirect to="/merchant/payouts" /></Route>
      <Route path="/merchant/payouts"><MerchantRoute component={MerchantPayouts} /></Route>
      <Route path="/merchant/api-keys"><MerchantRoute component={MerchantApiKeys} /></Route>
      <Route path="/merchant/webhook"><MerchantRoute component={MerchantWebhook} /></Route>
      <Route path="/merchant/callbacks"><MerchantRoute component={MerchantCallbacks} /></Route>
      <Route path="/merchant/settlements"><MerchantRoute component={MerchantSettlements} /></Route>
      <Route path="/merchant/products"><MerchantRoute component={MerchantProducts} /></Route>
      <Route path="/merchant/connect"><MerchantRoute component={MerchantConnect} /></Route>
      <Route path="/merchant/virtual-accounts"><MerchantRoute component={MerchantVirtualAccounts} /></Route>
      <Route path="/merchant/qr-codes"><MerchantRoute component={MerchantQrCodes} /></Route>
      <Route path="/merchant/qr"><MerchantRoute component={MerchantQrCodes} /></Route>
      <Route path="/merchant/deposits"><MerchantRoute component={MerchantDeposits} /></Route>
      <Route path="/merchant/plan"><MerchantRoute component={MerchantPlanPage} /></Route>
      <Route path="/merchant/ledger"><MerchantRoute component={MerchantLedger} /></Route>
      <Route path="/merchant/notifications"><MerchantRoute component={MerchantNotifications} /></Route>
      <Route path="/merchant/payment-links"><MerchantRoute component={MerchantPaymentLinks} /></Route>
      <Route path="/merchant/profile"><MerchantRoute component={MerchantProfile} /></Route>
      <Route path="/merchant/branding"><MerchantRoute component={MerchantBranding} /></Route>
      <Route path="/merchant/security"><MerchantRoute component={MerchantSecurity} /></Route>
      <Route path="/merchant/settings"><MerchantRoute component={MerchantSecurity} /></Route>
      <Route path="/merchant/rasokart-services"><MerchantRoute component={MerchantRasokartServices} /></Route>
      <Route path="/merchant/verification"><MerchantRoute component={MerchantVerification} /></Route>
      <Route path="/merchant/wallet"><MerchantRoute component={MerchantWallet} /></Route>
      <Route path="/merchant/reports"><MerchantRoute component={MerchantReports} /></Route>
      <Route path="/merchant/support"><MerchantRoute component={MerchantSupport} /></Route>
      <Route path="/merchant/account-statement"><MerchantRoute component={MerchantAccountStatement} /></Route>
      <Route path="/merchant/api-docs"><PublicPage component={MerchantApiDocs} /></Route>

      {/* Payout Admin Routes */}
      <Route path="/payout-admin/dashboard"><PayoutAdminRoute component={PayoutAdminDashboard} /></Route>
      <Route path="/payout-admin/payout-merchants"><PayoutAdminRoute component={PayoutAdminMerchants} /></Route>
      <Route path="/payout-admin/payouts"><PayoutAdminRoute component={PayoutAdminPayouts} /></Route>
      <Route path="/payout-admin/wallet-loads"><PayoutAdminRoute component={AdminPayoutWalletLoads} /></Route>
      <Route path="/payout-admin/agents"><PayoutAdminRoute component={PayoutAdminAgents} /></Route>
      <Route path="/payout-admin/audit-logs"><PayoutAdminRoute component={PayoutAdminAuditLogs} /></Route>
      <Route path="/payout-admin/settings"><PayoutAdminRoute component={PayoutAdminSettings} /></Route>
      <Route path="/payout-admin"><Redirect to="/payout-admin/login" /></Route>

      {/* Payout Merchant Routes */}
      <Route path="/payout-merchant/dashboard"><PayoutMerchantRoute component={PayoutMerchantDashboard} /></Route>
      <Route path="/payout-merchant/payouts"><PayoutMerchantRoute component={PayoutMerchantPayouts} /></Route>
      <Route path="/payout-merchant/bulk-payouts"><PayoutMerchantRoute component={PayoutMerchantBulkPayouts} /></Route>
      <Route path="/payout-merchant/beneficiaries"><PayoutMerchantRoute component={PayoutMerchantBeneficiaries} /></Route>
      <Route path="/payout-merchant/wallet/load-funds"><PayoutMerchantRoute component={PayoutMerchantLoadFunds} /></Route>
      <Route path="/payout-merchant/wallet/load-history"><PayoutMerchantRoute component={PayoutMerchantLoadHistory} /></Route>
      <Route path="/payout-merchant/wallet"><PayoutMerchantRoute component={PayoutMerchantWallet} /></Route>
      <Route path="/payout-merchant/ledger"><PayoutMerchantRoute component={PayoutMerchantLedger} /></Route>
      <Route path="/payout-merchant/profile"><PayoutMerchantRoute component={PayoutMerchantProfile} /></Route>
      <Route path="/payout-merchant/kyc"><PayoutMerchantRoute component={PayoutMerchantKyc} /></Route>
      {/* Redirect /payout-merchant root to dashboard */}
      <Route path="/payout-merchant"><Redirect to="/payout-merchant/dashboard" /></Route>
      <Route path="/api-docs"><Redirect to="/merchant/api-docs" /></Route>

      <Route path="/privacy-policy" component={PrivacyPolicy} />
      <Route path="/terms-and-conditions" component={TermsAndConditions} />
      <Route path="/refund-cancellation-policy" component={RefundCancellationPolicy} />
      <Route path="/service-delivery-policy" component={ServiceDeliveryPolicy} />
      <Route path="/contact-us" component={ContactUs} />
      <Route path="/grievance-redressal-policy" component={GrievanceRedressalPolicy} />
      <Route path="/pricing-fees-settlement-policy" component={PricingFeesSettlementPolicy} />
      <Route path="/merchant-agreement" component={MerchantAgreementPage} />
      <Route path="/prohibited-businesses" component={ProhibitedBusinesses} />
      <Route path="/kyc-aml-policy" component={KycAmlPolicy} />
      <Route path="/payment-payout-settlement-policy" component={PaymentPayoutSettlementPolicy} />
      <Route path="/chargeback-dispute-policy" component={ChargebackDisputePolicy} />
      <Route path="/cookie-policy" component={CookiePolicyPage} />
      <Route path="/security-policy" component={SecurityPolicyPage} />
      <Route path="/disclaimer" component={DisclaimerPage} />
      <Route path="/upi-collection-api"><PublicPage component={UpiCollectionApi} /></Route>

      <Route path="/pay/:slug" component={PayPage} />
      <Route path="/qr/:id" component={QrPayPage} />
      <Route path="/va/:id" component={VaPayPage} />
      <Route path="/checkout" component={CheckoutPage} />

      {/* Public payout receipt — token-authenticated, no login required */}
      <Route path="/payout-slip/:token" component={PayoutSlipPublic} />

      {/* Public payout verification — verification-token, no login required */}
      <Route path="/verify-payout/:token" component={PayoutVerifyPublic} />

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
            <CookieConsent />
          </WouterRouter>
        </AuthProvider>
        <Toaster theme="dark" position="top-right" />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
