import { ReactNode } from "react";
import { useAuth } from "@/lib/auth-context";
import { UserRole, useGetMyPlanUsage } from "@workspace/api-client-react";
import { SidebarProvider, Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarHeader, SidebarFooter } from "@/components/ui/sidebar";
import { Link, useLocation } from "wouter";
import { LogOut, LayoutDashboard, Store, ArrowRightLeft, Landmark, FileText, Webhook, KeyRound, Users, ShieldCheck, Package, Plug, BookOpen, QrCode, Building2, CreditCard, ArrowDownLeft, Activity, Shield, UserCog, Sliders, Eye, LayoutGrid, Lock, Receipt, BookMarked, Zap, GitMerge, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NotificationBell } from "@/components/notification-bell";

interface DashboardLayoutProps {
  children: ReactNode;
  publicMode?: boolean;
}

function MerchantSidebar() {
  const [location] = useLocation();
  const { data: usage } = useGetMyPlanUsage();

  const navGroups = [
    {
      group: "Overview",
      items: [
        { title: "Dashboard", icon: LayoutDashboard, href: "/merchant/dashboard", locked: false, lockReason: null },
        { title: "My Plan", icon: CreditCard, href: "/merchant/plan", locked: false, lockReason: null },
      ],
    },
    {
      group: "Payments",
      items: [
        { title: "Deposits", icon: ArrowDownLeft, href: "/merchant/deposits", locked: false, lockReason: null },
        { title: "Transactions", icon: ArrowRightLeft, href: "/merchant/transactions", locked: false, lockReason: null },
        { title: "Withdrawals", icon: Landmark, href: "/merchant/withdrawals", locked: false, lockReason: null },
        { title: "Settlements", icon: FileText, href: "/merchant/settlements", locked: false, lockReason: null },
        { title: "Balance Ledger", icon: BookMarked, href: "/merchant/ledger", locked: false, lockReason: null },
      ],
    },
    {
      group: "Products",
      items: [
        { title: "Virtual Accounts", icon: Building2, href: "/merchant/virtual-accounts", locked: false, lockReason: null },
        { title: "Dynamic QR", icon: QrCode, href: "/merchant/qr-codes", locked: false, lockReason: null },
        { title: "Payment Links", icon: Link2, href: "/merchant/payment-links", locked: false, lockReason: null },
        { title: "Plans & Pricing", icon: Package, href: "/merchant/products", locked: false, lockReason: null },
      ],
    },
    {
      group: "Integration",
      items: [
        { title: "Connect", icon: Plug, href: "/merchant/connect", locked: false, lockReason: null },
        {
          title: "API Keys", icon: KeyRound, href: "/merchant/api-keys",
          locked: usage !== undefined && !usage.apiAccess,
          lockReason: "API access is not included in your current plan. Upgrade to unlock."
        },
        {
          title: "Webhooks", icon: Webhook, href: "/merchant/webhook",
          locked: usage !== undefined && !usage.webhookAccess,
          lockReason: "Webhook access is not included in your current plan. Upgrade to unlock."
        },
        { title: "Callbacks", icon: FileText, href: "/merchant/callbacks", locked: false, lockReason: null },
        { title: "API Docs", icon: BookOpen, href: "/merchant/api-docs", locked: false, lockReason: null },
      ],
    },
  ];

  return (
    <>
      {navGroups.map((group) => (
        <SidebarGroup key={group.group}>
          <SidebarGroupLabel>{group.group}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {group.items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  {item.locked ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex items-center gap-3 px-2 py-1.5 rounded-md text-sm text-muted-foreground/50 cursor-not-allowed w-full">
                          <item.icon className="w-4 h-4 shrink-0" />
                          <span className="flex-1">{item.title}</span>
                          <Lock className="w-3 h-3 shrink-0 text-muted-foreground/40" />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="right" className="max-w-xs text-xs">
                        {item.lockReason}
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <SidebarMenuButton asChild isActive={location === item.href} tooltip={item.title}>
                      <Link href={item.href} className="flex items-center gap-3">
                        <item.icon className="w-4 h-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  )}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </>
  );
}

export function DashboardLayout({ children, publicMode = false }: DashboardLayoutProps) {
  const { user, logout } = useAuth();
  const [location] = useLocation();

  if (!publicMode && !user) return null;

  const isAdmin = user?.role === UserRole.admin;

  const adminNav = [
    {
      group: "Overview",
      items: [
        { title: "Dashboard", icon: LayoutDashboard, href: "/admin/dashboard" },
      ],
    },
    {
      group: "Merchants",
      items: [
        { title: "Merchants", icon: Store, href: "/admin/merchants" },
        { title: "Plans", icon: CreditCard, href: "/admin/plans" },
        { title: "Invoices", icon: Receipt, href: "/admin/invoices" },
      ],
    },
    {
      group: "Payments",
      items: [
        { title: "Deposits", icon: ArrowDownLeft, href: "/admin/deposits" },
        { title: "Withdrawals", icon: Landmark, href: "/admin/withdrawals" },
        { title: "Settlements", icon: FileText, href: "/admin/settlements" },
        { title: "Transactions", icon: ArrowRightLeft, href: "/admin/transactions" },
        { title: "Balance Ledger", icon: BookMarked, href: "/admin/ledger" },
      ],
    },
    {
      group: "Instruments",
      items: [
        { title: "Dynamic QR", icon: QrCode, href: "/admin/qr-codes" },
        { title: "Virtual Accounts", icon: Building2, href: "/admin/virtual-accounts" },
        { title: "Payment Links", icon: Link2, href: "/admin/payment-links" },
      ],
    },
    {
      group: "Monitoring",
      items: [
        { title: "Webhook Logs", icon: Webhook, href: "/admin/webhook-logs" },
        { title: "Callback Logs", icon: Activity, href: "/admin/callbacks" },
        { title: "API Monitoring", icon: Activity, href: "/admin/api-monitoring" },
      ],
    },
    {
      group: "Control & Access",
      items: [
        { title: "Feature Control", icon: Sliders, href: "/admin/feature-control" },
        { title: "Account Details", icon: CreditCard, href: "/admin/account-details" },
        { title: "Payment Providers", icon: Zap, href: "/admin/providers" },
        { title: "QR Providers", icon: QrCode, href: "/admin/qr-providers" },
        { title: "Visibility Rules", icon: Eye, href: "/admin/visibility-rules" },
        { title: "Merchant Access", icon: LayoutGrid, href: "/admin/merchant-access" },
      ],
    },
    {
      group: "Finance",
      items: [
        { title: "Reconciliation", icon: GitMerge, href: "/admin/reconciliation" },
      ],
    },
    {
      group: "Administration",
      items: [
        { title: "Audit Logs", icon: Shield, href: "/admin/audit-logs" },
        { title: "User Roles", icon: UserCog, href: "/admin/user-roles" },
      ],
    },
  ];

  const publicNav = [
    { title: "API Docs", icon: BookOpen, href: "/merchant/api-docs" },
  ];

  const portalLabel = publicMode ? "Developer Docs" : (isAdmin ? "Admin Console" : "Merchant Portal");

  return (
    <SidebarProvider>
      <div className="flex min-h-screen bg-background w-full">
        <Sidebar variant="sidebar" className="border-r border-border/50">
          <SidebarHeader className="p-4 flex flex-row items-center gap-2">
            <div className="w-8 h-8 bg-primary/20 rounded-lg flex items-center justify-center border border-primary/30 shrink-0">
              <ShieldCheck className="w-4 h-4 text-primary" />
            </div>
            <div className="flex flex-col flex-1 min-w-0">
              <span className="font-bold text-sm tracking-wide">RasoKart</span>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{portalLabel}</span>
            </div>
            {!publicMode && !isAdmin && user && <NotificationBell />}
          </SidebarHeader>
          <SidebarContent>
            {publicMode ? (
              <SidebarGroup>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {publicNav.map((item) => (
                      <SidebarMenuItem key={item.title}>
                        <SidebarMenuButton asChild isActive={location === item.href} tooltip={item.title}>
                          <Link href={item.href} className="flex items-center gap-3">
                            <item.icon className="w-4 h-4" />
                            <span>{item.title}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ) : isAdmin ? (
              adminNav.map((group) => (
                <SidebarGroup key={group.group}>
                  <SidebarGroupLabel>{group.group}</SidebarGroupLabel>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {group.items.map((item) => (
                        <SidebarMenuItem key={item.title}>
                          <SidebarMenuButton asChild isActive={location === item.href} tooltip={item.title}>
                            <Link href={item.href} className="flex items-center gap-3">
                              <item.icon className="w-4 h-4" />
                              <span>{item.title}</span>
                            </Link>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      ))}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
              ))
            ) : (
              <MerchantSidebar />
            )}
          </SidebarContent>
          <SidebarFooter className="p-4">
            {user ? (
              <div className="flex items-center justify-between">
                <div className="flex flex-col truncate pr-2">
                  <span className="text-sm font-medium truncate">{user.name}</span>
                  <span className="text-xs text-muted-foreground truncate">{user.email}</span>
                </div>
                <Button variant="ghost" size="icon" onClick={logout} title="Sign out" className="shrink-0 text-muted-foreground hover:text-foreground">
                  <LogOut className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              <Link href="/merchant/login">
                <Button variant="outline" size="sm" className="w-full">Sign In</Button>
              </Link>
            )}
          </SidebarFooter>
        </Sidebar>

        <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <div className="flex-1 overflow-y-auto p-6 lg:p-8">
            {children}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
