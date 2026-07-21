import { ReactNode, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { Spinner } from "@/components/ui/spinner";
import {
  SidebarProvider, Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarMenu, SidebarMenuItem, SidebarMenuButton,
  SidebarHeader, SidebarFooter, SidebarTrigger,
} from "@/components/ui/sidebar";
import { Link, useLocation } from "wouter";
import {
  LogOut, LayoutDashboard, Wallet, BookOpen, Users, Upload, ArrowRightLeft, User,
  ShieldCheck, Building2, ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { RasoKartLogo } from "@/components/ui/rasokart-logo";
import { useCompanySettings } from "@/lib/company-settings";
import { MobileBottomNav } from "@/components/layout/mobile-bottom-nav";
import { NotificationBell } from "@/components/notification-bell";
import { PageErrorBoundary } from "@/components/error-boundary";

interface NavItem {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
}

const PAYOUT_MERCHANT_NAV: NavItem[] = [
  { label: "Dashboard",      icon: LayoutDashboard,  href: "/payout-merchant/dashboard" },
  { label: "Send Payouts",   icon: ArrowRightLeft,   href: "/payout-merchant/payouts" },
  { label: "Bulk Payouts",   icon: Upload,           href: "/payout-merchant/bulk-payouts" },
  { label: "Beneficiaries",  icon: Users,            href: "/payout-merchant/beneficiaries" },
  { label: "Wallet",         icon: Wallet,           href: "/payout-merchant/wallet" },
  { label: "Ledger",         icon: BookOpen,         href: "/payout-merchant/ledger" },
  { label: "KYC Verification", icon: ShieldCheck,    href: "/payout-merchant/kyc" },
  { label: "Profile",        icon: User,             href: "/payout-merchant/profile" },
];

interface PayoutMerchantLayoutProps {
  children: ReactNode;
}

export function PayoutMerchantLayout({ children }: PayoutMerchantLayoutProps) {
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

  return (
    <SidebarProvider defaultOpen={true}>
      <div className="flex min-h-screen w-full bg-background">
        <Sidebar collapsible="icon" className="border-r border-border/50">
          <SidebarHeader className="border-b border-border/40 px-3 py-3">
            <Link href="/payout-merchant/dashboard" className="flex items-center gap-2 min-w-0">
              <RasoKartLogo className="h-7 w-auto shrink-0" />
              <div className="min-w-0 flex-1 overflow-hidden">
                <p className="text-xs font-semibold text-foreground truncate leading-tight">
                  {companyData?.companyName ?? "RasoKart"}
                </p>
                <p className="text-[10px] text-muted-foreground truncate leading-tight">
                  Payout Portal
                </p>
              </div>
            </Link>
          </SidebarHeader>

          <SidebarContent className="py-2">
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  {PAYOUT_MERCHANT_NAV.map((item) => {
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
              <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                <Building2 className="h-3.5 w-3.5 text-primary" />
              </div>
              <div className="min-w-0 flex-1 overflow-hidden">
                <p className="text-xs font-medium text-foreground truncate">{user.name ?? user.email}</p>
                <p className="text-[10px] text-muted-foreground truncate">Payout Merchant</p>
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
          {/* Top bar */}
          <div className="h-12 border-b border-border/50 flex items-center justify-between px-4 shrink-0">
            <SidebarTrigger className="h-12 w-12 [&>svg]:size-7" />
            <div className="flex items-center gap-2">
              <NotificationBell />
            </div>
          </div>

          {/* Page content */}
          <main className="flex-1 overflow-y-auto p-4 md:p-6">
            {children}
          </main>
        </div>
      </div>

      {/* Mobile bottom nav — payout merchant items are detected automatically via merchantType */}
      <MobileBottomNav />
    </SidebarProvider>
  );
}
