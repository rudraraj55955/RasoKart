import { Switch, Route, Router as WouterRouter, Redirect, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/auth-context";
import { useAuth } from "@/lib/auth-context";
import { ProtectedRoute } from "@/components/protected-route";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { PageErrorBoundary } from "@/components/error-boundary";
import { Spinner } from "@/components/ui/spinner";
import { UserRole } from "@workspace/api-client-react";
import NotFound from "@/pages/not-found";

// Landing Page
import Landing from "@/pages/landing";
import UpiCollectionApi from "@/pages/upi-collection-api";

// Auth Pages
import AdminLogin from "@/pages/admin/login";
import MerchantLogin from "@/pages/merchant/login";
import MerchantRegister from "@/pages/merchant/register";
import MerchantPending from "@/pages/merchant/pending";
import MerchantSuspended from "@/pages/merchant/suspended";
import AgentLogin from "@/pages/agent/login";
import AgentDashboard from "@/pages/agent/dashboard";

// Admin Pages
import AdminDashboard from "@/pages/admin/dashboard";
import AdminTransactions from "@/pages/admin/transactions";
import AdminMerchants from "@/pages/admin/merchants";
import AdminWithdrawals from "@/pages/admin/withdrawals";
import AdminSettlements from "@/pages/admin/settlements";
import AdminCallbacks from "@/pages/admin/callbacks";
import AdminUsers from "@/pages/admin/users";
import AdminPlans from "@/pages/admin/plans";
import AdminInvoices from "@/pages/admin/invoices";
import AdminQrCodes from "@/pages/admin/qr-codes";
import AdminVirtualAccounts from "@/pages/admin/virtual-accounts";
import AdminDeposits from "@/pages/admin/deposits";
import AdminWebhookLogs from "@/pages/admin/webhook-logs";
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
import AdminCashfreeGateway from "@/pages/admin/cashfree-gateway";
import AdminCashfreePayout from "@/pages/admin/cashfree-payout";
import AdminPaymentGateways from "@/pages/admin/payment-gateways";
import AdminProviderIntegrations from "@/pages/admin/provider-integrations";
import AdminSmartRouting from "@/pages/admin/smart-routing";
import AdminModuleControl from "@/pages/admin/module-control";
import AdminWallets from "@/pages/admin/wallets";
import AdminWalletDetail from "@/pages/admin/wallet-detail";
import AdminSupportTickets from "@/pages/admin/support-tickets";
import AdminMerchantVerifications from "@/pages/admin/merchant-verifications";
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
import MerchantRasokartServices from "@/pages/merchant/rasokart-services";
import MerchantVerification from "@/pages/merchant/verification";
import MerchantWallet from "@/pages/merchant/wallet";
import AdminKycReview from "@/pages/admin/kyc-review";
import MerchantReports from "@/pages/merchant/reports";
import AdminReports from "@/pages/admin/reports";
import MerchantSupport from "@/pages/merchant/support";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

/**
 * Smart entry for /admin — shows spinner while auth resolves, then either
 * redirects a logged-in admin to /admin/dashboard or renders the login page.
 * This means /admin is NEVER blank and NEVER shows login to an already-logged-in admin.
 */
function SmartAdminEntry() {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && user?.role === UserRole.admin) {
      setLocation("/admin/dashboard", { replace: true } as Parameters<typeof setLocation>[1]);
    }
  }, [user, isLoading]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Spinner className="w-8 h-8 text-primary" />
      </div>
    );
  }

  if (user?.role === UserRole.admin) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Spinner className="w-8 h-8 text-primary" />
      </div>
    );
  }

  return <AdminLogin />;
}

/**
 * Smart entry for /merchant — shows spinner while auth resolves, then either
 * redirects a logged-in merchant to /merchant/dashboard or renders the login page.
 */
function SmartMerchantEntry() {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && user?.role === UserRole.merchant) {
      setLocation("/merchant/dashboard", { replace: true } as Parameters<typeof setLocation>[1]);
    }
  }, [user, isLoading]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Spinner className="w-8 h-8 text-primary" />
      </div>
    );
  }

  if (user?.role === UserRole.merchant) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Spinner className="w-8 h-8 text-primary" />
      </div>
    );
  }

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
  return (
    <Switch>
      {/* Public landing page */}
      <Route path="/" component={Landing} />

      {/* Smart entry routes — show login OR redirect to dashboard based on auth state */}
      <Route path="/admin" component={SmartAdminEntry} />
      <Route path="/merchant" component={SmartMerchantEntry} />
      <Route path="/agent" component={AgentLogin} />

      {/* Agent dashboard */}
      <Route path="/agent/dashboard"><AdminRoute component={AgentDashboard} /></Route>
      <Route path="/merchant/apply" component={MerchantRegister} />
      <Route path="/merchant/pending" component={MerchantPending} />
      <Route path="/merchant/suspended" component={MerchantSuspended} />

      {/* Login aliases — render directly so /admin/login always shows login UI */}
      <Route path="/admin/login" component={AdminLogin} />
      <Route path="/merchant/login" component={MerchantLogin} />
      <Route path="/merchant/register"><Redirect to="/merchant/apply" /></Route>

      {/* Admin Routes */}
      <Route path="/admin/dashboard"><AdminRoute component={AdminDashboard} /></Route>
      <Route path="/admin/merchants"><AdminRoute component={AdminMerchants} /></Route>
      <Route path="/admin/transactions"><AdminRoute component={AdminTransactions} /></Route>
      <Route path="/admin/withdrawals"><AdminRoute component={AdminWithdrawals} /></Route>
      <Route path="/admin/settlements"><AdminRoute component={AdminSettlements} /></Route>
      <Route path="/admin/callbacks"><AdminRoute component={AdminCallbacks} /></Route>
      <Route path="/admin/users"><AdminRoute component={AdminUsers} /></Route>
      <Route path="/admin/plans"><AdminRoute component={AdminPlans} /></Route>
      <Route path="/admin/invoices"><AdminRoute component={AdminInvoices} /></Route>
      <Route path="/admin/qr-codes"><AdminRoute component={AdminQrCodes} /></Route>
      <Route path="/admin/virtual-accounts"><AdminRoute component={AdminVirtualAccounts} /></Route>
      <Route path="/admin/deposits"><AdminRoute component={AdminDeposits} /></Route>
      <Route path="/admin/webhook-logs"><AdminRoute component={AdminWebhookLogs} /></Route>
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
      <Route path="/admin/payment-gateways"><AdminRoute component={AdminPaymentGateways} /></Route>
      <Route path="/admin/cashfree-gateway"><AdminRoute component={AdminCashfreeGateway} /></Route>
      <Route path="/admin/cashfree-payout"><AdminRoute component={AdminCashfreePayout} /></Route>
      <Route path="/admin/provider-integrations"><AdminRoute component={AdminProviderIntegrations} /></Route>
      <Route path="/admin/smart-routing"><AdminRoute component={AdminSmartRouting} /></Route>
      <Route path="/admin/module-control"><AdminRoute component={AdminModuleControl} /></Route>
      <Route path="/admin/wallets/:merchantId"><AdminRoute component={AdminWalletDetail} /></Route>
      <Route path="/admin/wallets"><AdminRoute component={AdminWallets} /></Route>
      <Route path="/admin/kyc-review"><AdminRoute component={AdminKycReview} /></Route>
      <Route path="/admin/merchant-verifications"><AdminRoute component={AdminMerchantVerifications} /></Route>
      <Route path="/admin/reports"><AdminRoute component={AdminReports} /></Route>
      <Route path="/admin/support-tickets"><AdminRoute component={AdminSupportTickets} /></Route>
      <Route path="/admin/support"><AdminRoute component={AdminSupportTickets} /></Route>
      <Route path="/admin/payouts"><AdminRoute component={AdminWithdrawals} /></Route>

      {/* Merchant Routes */}
      <Route path="/merchant/dashboard"><MerchantRoute component={MerchantDashboard} /></Route>
      <Route path="/merchant/transactions"><MerchantRoute component={MerchantTransactions} /></Route>
      <Route path="/merchant/withdrawals"><MerchantRoute component={MerchantWithdrawals} /></Route>
      <Route path="/merchant/payouts"><MerchantRoute component={MerchantWithdrawals} /></Route>
      <Route path="/merchant/api-keys"><MerchantRoute component={MerchantApiKeys} /></Route>
      <Route path="/merchant/webhook"><MerchantRoute component={MerchantWebhook} /></Route>
      <Route path="/merchant/callbacks"><MerchantRoute component={MerchantCallbacks} /></Route>
      <Route path="/merchant/settlements"><MerchantRoute component={MerchantSettlements} /></Route>
      <Route path="/merchant/products"><MerchantRoute component={MerchantProducts} /></Route>
      <Route path="/merchant/connect"><MerchantRoute component={MerchantConnect} /></Route>
      <Route path="/merchant/virtual-accounts"><MerchantRoute component={MerchantVirtualAccounts} /></Route>
      <Route path="/merchant/qr-codes"><MerchantRoute component={MerchantQrCodes} /></Route>
      <Route path="/merchant/deposits"><MerchantRoute component={MerchantDeposits} /></Route>
      <Route path="/merchant/plan"><MerchantRoute component={MerchantPlanPage} /></Route>
      <Route path="/merchant/ledger"><MerchantRoute component={MerchantLedger} /></Route>
      <Route path="/merchant/notifications"><MerchantRoute component={MerchantNotifications} /></Route>
      <Route path="/merchant/payment-links"><MerchantRoute component={MerchantPaymentLinks} /></Route>
      <Route path="/merchant/branding"><MerchantRoute component={MerchantBranding} /></Route>
      <Route path="/merchant/security"><MerchantRoute component={MerchantSecurity} /></Route>
      <Route path="/merchant/rasokart-services"><MerchantRoute component={MerchantRasokartServices} /></Route>
      <Route path="/merchant/verification"><MerchantRoute component={MerchantVerification} /></Route>
      <Route path="/merchant/wallet"><MerchantRoute component={MerchantWallet} /></Route>
      <Route path="/merchant/reports"><MerchantRoute component={MerchantReports} /></Route>
      <Route path="/merchant/support"><MerchantRoute component={MerchantSupport} /></Route>
      <Route path="/merchant/api-docs"><PublicPage component={MerchantApiDocs} /></Route>
      <Route path="/api-docs"><Redirect to="/merchant/api-docs" /></Route>

      <Route path="/upi-collection-api"><PublicPage component={UpiCollectionApi} /></Route>

      <Route path="/pay/:slug" component={PayPage} />
      <Route path="/qr/:id" component={QrPayPage} />
      <Route path="/va/:id" component={VaPayPage} />
      <Route path="/checkout" component={CheckoutPage} />

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
          </WouterRouter>
        </AuthProvider>
        <Toaster theme="dark" position="top-right" />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
