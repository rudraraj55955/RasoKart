import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/auth-context";
import { ProtectedRoute } from "@/components/protected-route";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { UserRole } from "@workspace/api-client-react";
import NotFound from "@/pages/not-found";

// Auth Pages
import AdminLogin from "@/pages/admin/login";
import MerchantLogin from "@/pages/merchant/login";
import MerchantRegister from "@/pages/merchant/register";
import MerchantPending from "@/pages/merchant/pending";

// Admin Pages
import AdminDashboard from "@/pages/admin/dashboard";
import AdminTransactions from "@/pages/admin/transactions";
import AdminMerchants from "@/pages/admin/merchants";
import AdminWithdrawals from "@/pages/admin/withdrawals";
import AdminSettlements from "@/pages/admin/settlements";
import AdminCallbacks from "@/pages/admin/callbacks";
import AdminUsers from "@/pages/admin/users";
import AdminPlans from "@/pages/admin/plans";
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
import AdminVisibilityRules from "@/pages/admin/visibility-rules";
import AdminMerchantAccess from "@/pages/admin/merchant-access";

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
import MerchantQrCodes from "@/pages/merchant/qr-codes";
import MerchantDeposits from "@/pages/merchant/deposits";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

function AdminRoute({ component: Component }: { component: React.ComponentType }) {
  return (
    <ProtectedRoute allowedRoles={[UserRole.admin]}>
      <DashboardLayout>
        <Component />
      </DashboardLayout>
    </ProtectedRoute>
  );
}

function MerchantRoute({ component: Component }: { component: React.ComponentType }) {
  return (
    <ProtectedRoute allowedRoles={[UserRole.merchant]}>
      <DashboardLayout>
        <Component />
      </DashboardLayout>
    </ProtectedRoute>
  );
}

function PublicPage({ component: Component }: { component: React.ComponentType }) {
  return (
    <DashboardLayout publicMode>
      <Component />
    </DashboardLayout>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={() => <MerchantLogin />} />
      <Route path="/admin/login" component={AdminLogin} />
      <Route path="/merchant/login" component={MerchantLogin} />
      <Route path="/merchant/register" component={MerchantRegister} />
      <Route path="/merchant/pending" component={MerchantPending} />

      {/* Admin Routes */}
      <Route path="/admin/dashboard"><AdminRoute component={AdminDashboard} /></Route>
      <Route path="/admin/merchants"><AdminRoute component={AdminMerchants} /></Route>
      <Route path="/admin/transactions"><AdminRoute component={AdminTransactions} /></Route>
      <Route path="/admin/withdrawals"><AdminRoute component={AdminWithdrawals} /></Route>
      <Route path="/admin/settlements"><AdminRoute component={AdminSettlements} /></Route>
      <Route path="/admin/callbacks"><AdminRoute component={AdminCallbacks} /></Route>
      <Route path="/admin/users"><AdminRoute component={AdminUsers} /></Route>
      <Route path="/admin/plans"><AdminRoute component={AdminPlans} /></Route>
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
      <Route path="/admin/visibility-rules"><AdminRoute component={AdminVisibilityRules} /></Route>
      <Route path="/admin/merchant-access"><AdminRoute component={AdminMerchantAccess} /></Route>

      {/* Merchant Routes */}
      <Route path="/merchant/dashboard"><MerchantRoute component={MerchantDashboard} /></Route>
      <Route path="/merchant/transactions"><MerchantRoute component={MerchantTransactions} /></Route>
      <Route path="/merchant/withdrawals"><MerchantRoute component={MerchantWithdrawals} /></Route>
      <Route path="/merchant/api-keys"><MerchantRoute component={MerchantApiKeys} /></Route>
      <Route path="/merchant/webhook"><MerchantRoute component={MerchantWebhook} /></Route>
      <Route path="/merchant/callbacks"><MerchantRoute component={MerchantCallbacks} /></Route>
      <Route path="/merchant/settlements"><MerchantRoute component={MerchantSettlements} /></Route>
      <Route path="/merchant/products"><MerchantRoute component={MerchantProducts} /></Route>
      <Route path="/merchant/connect"><MerchantRoute component={MerchantConnect} /></Route>
      <Route path="/merchant/virtual-accounts"><MerchantRoute component={MerchantVirtualAccounts} /></Route>
      <Route path="/merchant/qr-codes"><MerchantRoute component={MerchantQrCodes} /></Route>
      <Route path="/merchant/deposits"><MerchantRoute component={MerchantDeposits} /></Route>
      <Route path="/merchant/api-docs"><PublicPage component={MerchantApiDocs} /></Route>

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
