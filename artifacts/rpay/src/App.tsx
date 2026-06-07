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

// Merchant Pages
import MerchantDashboard from "@/pages/merchant/dashboard";
import MerchantTransactions from "@/pages/merchant/transactions";
import MerchantWithdrawals from "@/pages/merchant/withdrawals";
import MerchantApiKeys from "@/pages/merchant/api-keys";
import MerchantWebhook from "@/pages/merchant/webhook";
import MerchantCallbacks from "@/pages/merchant/callbacks";
import MerchantSettlements from "@/pages/merchant/settlements";

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

function Router() {
  return (
    <Switch>
      <Route path="/" component={() => <MerchantLogin />} />
      <Route path="/admin/login" component={AdminLogin} />
      <Route path="/merchant/login" component={MerchantLogin} />
      <Route path="/merchant/register" component={MerchantRegister} />
      <Route path="/merchant/pending" component={MerchantPending} />

      {/* Admin Routes */}
      <Route path="/admin/dashboard">
        <AdminRoute component={AdminDashboard} />
      </Route>
      <Route path="/admin/merchants">
        <AdminRoute component={AdminMerchants} />
      </Route>
      <Route path="/admin/transactions">
        <AdminRoute component={AdminTransactions} />
      </Route>
      <Route path="/admin/withdrawals">
        <AdminRoute component={AdminWithdrawals} />
      </Route>
      <Route path="/admin/settlements">
        <AdminRoute component={AdminSettlements} />
      </Route>
      <Route path="/admin/callbacks">
        <AdminRoute component={AdminCallbacks} />
      </Route>
      <Route path="/admin/users">
        <AdminRoute component={AdminUsers} />
      </Route>

      {/* Merchant Routes */}
      <Route path="/merchant/dashboard">
        <MerchantRoute component={MerchantDashboard} />
      </Route>
      <Route path="/merchant/transactions">
        <MerchantRoute component={MerchantTransactions} />
      </Route>
      <Route path="/merchant/withdrawals">
        <MerchantRoute component={MerchantWithdrawals} />
      </Route>
      <Route path="/merchant/api-keys">
        <MerchantRoute component={MerchantApiKeys} />
      </Route>
      <Route path="/merchant/webhook">
        <MerchantRoute component={MerchantWebhook} />
      </Route>
      <Route path="/merchant/callbacks">
        <MerchantRoute component={MerchantCallbacks} />
      </Route>
      <Route path="/merchant/settlements">
        <MerchantRoute component={MerchantSettlements} />
      </Route>

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
