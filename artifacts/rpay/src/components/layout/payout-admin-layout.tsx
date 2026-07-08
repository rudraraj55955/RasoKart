import { ReactNode } from "react";
import { useAuth } from "@/lib/auth-context";
import { Spinner } from "@/components/ui/spinner";
import {
  SidebarProvider, Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarMenu, SidebarMenuItem, SidebarMenuButton,
  SidebarHeader, SidebarFooter, SidebarTrigger,
} from "@/components/ui/sidebar";
import { Link, useLocation } from "wouter";
import {
  LogOut, LayoutDashboard, Users, ArrowRightLeft, BookOpen, ShieldCheck,
  Settings, Activity, Building2, UserCog, Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { RasoKartLogo } from "@/components/ui/rasokart-logo";
import { useCompanySettings } from "@/lib/company-settings";
import { PageErrorBoundary } from "@/components/error-boundary";

interface NavItem {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  superOnly?: boolean;
}

const PAYOUT_ADMIN_NAV: NavItem[] = [
  { label: "Dashboard",        icon: LayoutDashboard,  href: "/payout-admin/dashboard" },
  { label: "Payout Merchants", icon: Users,             href: "/payout-admin/payout-merchants" },
  { label: "Payouts",          icon: ArrowRightLeft,    href: "/payout-admin/payouts" },
  { label: "Wallet Loads",     icon: Wallet,            href: "/payout-admin/wallet-loads" },
  { label: "Agents",           icon: UserCog,           href: "/payout-admin/agents" },
  { label: "Audit Logs",       icon: Activity,          href: "/payout-admin/audit-logs" },
  { label: "Settings",         icon: Settings,          href: "/payout-admin/settings", superOnly: true },
];

interface PayoutAdminLayoutProps {
  children: ReactNode;
}

export function PayoutAdminLayout({ children }: PayoutAdminLayoutProps) {
  const { user, logout } = useAuth();
  const [location] = useLocation();
  const companyData = useCompanySettings();

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Spinner className="w-8 h-8 text-primary" />
      </div>
    );
  }

  const isPayoutSuperAdmin = user.role === "payout_super_admin" || (user.role === "admin" && user.isSuperAdmin);
  const visibleNav = PAYOUT_ADMIN_NAV.filter((item) => !item.superOnly || isPayoutSuperAdmin);

  return (
    <SidebarProvider defaultOpen={true}>
      <div className="flex min-h-screen w-full bg-background">
        <Sidebar collapsible="icon" className="border-r border-border/50">
          <SidebarHeader className="border-b border-border/40 px-3 py-3">
            <Link href="/payout-admin/dashboard" className="flex items-center gap-2 min-w-0">
              <RasoKartLogo className="h-7 w-auto shrink-0" />
              <div className="min-w-0 flex-1 overflow-hidden">
                <p className="text-xs font-semibold text-foreground truncate leading-tight">
                  {companyData?.companyName ?? "RasoKart"}
                </p>
                <p className="text-[10px] text-muted-foreground truncate leading-tight">
                  Payout Admin
                </p>
              </div>
            </Link>
          </SidebarHeader>

          <SidebarContent className="py-2">
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  {visibleNav.map((item) => {
                    const active = location === item.href || location.startsWith(item.href + "/");
                    return (
                      <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                          <Link href={item.href} className="flex items-center gap-2">
                            <item.icon className="h-4 w-4 shrink-0" />
                            <span>{item.label}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>

          <SidebarFooter className="border-t border-border/40 p-3 space-y-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-full bg-violet-500/20 flex items-center justify-center shrink-0">
                <ShieldCheck className="h-3.5 w-3.5 text-violet-400" />
              </div>
              <div className="min-w-0 flex-1 overflow-hidden">
                <p className="text-xs font-medium text-foreground truncate">{user.name ?? user.email}</p>
                <p className="text-[10px] text-muted-foreground truncate">
                  {user.role === "payout_super_admin" ? "Payout Super Admin" : "Payout Admin"}
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2 text-muted-foreground hover:text-red-400 hover:bg-red-500/10 h-8"
              onClick={logout}
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="text-xs">Sign Out</span>
            </Button>
          </SidebarFooter>
        </Sidebar>

        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          <div className="h-12 border-b border-border/50 flex items-center justify-between px-4 shrink-0">
            <SidebarTrigger className="h-7 w-7" />
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Payout Operations</span>
            </div>
          </div>
          <main className="flex-1 overflow-y-auto p-4 md:p-6">
            <PageErrorBoundary>
              {children}
            </PageErrorBoundary>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
