import { ReactNode } from "react";
import { useAuth } from "@/lib/auth-context";
import { UserRole } from "@workspace/api-client-react";
import { SidebarProvider, Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarHeader, SidebarFooter } from "@/components/ui/sidebar";
import { Link, useLocation } from "wouter";
import { LogOut, LayoutDashboard, Store, ArrowRightLeft, Landmark, FileText, Webhook, KeyRound, Users, ShieldCheck, Package, Plug, BookOpen, QrCode, Building2, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DashboardLayoutProps {
  children: ReactNode;
  publicMode?: boolean;
}

export function DashboardLayout({ children, publicMode = false }: DashboardLayoutProps) {
  const { user, logout } = useAuth();
  const [location] = useLocation();

  if (!publicMode && !user) return null;

  const isAdmin = user?.role === UserRole.admin;

  const adminNav = [
    { title: "Overview", icon: LayoutDashboard, href: "/admin/dashboard" },
    { title: "Merchants", icon: Store, href: "/admin/merchants" },
    { title: "Transactions", icon: ArrowRightLeft, href: "/admin/transactions" },
    { title: "Withdrawals", icon: Landmark, href: "/admin/withdrawals" },
    { title: "Settlements", icon: FileText, href: "/admin/settlements" },
    { title: "Callbacks", icon: Webhook, href: "/admin/callbacks" },
    { title: "Plans", icon: CreditCard, href: "/admin/plans" },
    { title: "QR Management", icon: QrCode, href: "/admin/qr-codes" },
    { title: "Virtual Accounts", icon: Building2, href: "/admin/virtual-accounts" },
    { title: "Team", icon: Users, href: "/admin/users" },
  ];

  const merchantNav = [
    { title: "Overview", icon: LayoutDashboard, href: "/merchant/dashboard" },
    { title: "Transactions", icon: ArrowRightLeft, href: "/merchant/transactions" },
    { title: "Withdrawals", icon: Landmark, href: "/merchant/withdrawals" },
    { title: "Settlements", icon: FileText, href: "/merchant/settlements" },
    { title: "Virtual Accounts", icon: Building2, href: "/merchant/virtual-accounts" },
    { title: "Dynamic QR", icon: QrCode, href: "/merchant/qr-codes" },
    { title: "Products", icon: Package, href: "/merchant/products" },
    { title: "Connect", icon: Plug, href: "/merchant/connect" },
    { title: "API Keys", icon: KeyRound, href: "/merchant/api-keys" },
    { title: "Webhooks", icon: Webhook, href: "/merchant/webhook" },
    { title: "Callbacks", icon: FileText, href: "/merchant/callbacks" },
    { title: "API Docs", icon: BookOpen, href: "/merchant/api-docs" },
  ];

  const publicNav = [
    { title: "API Docs", icon: BookOpen, href: "/merchant/api-docs" },
  ];

  const navItems = publicMode ? publicNav : (isAdmin ? adminNav : merchantNav);
  const portalLabel = publicMode ? "Developer Docs" : (isAdmin ? "Admin Console" : "Merchant Portal");

  return (
    <SidebarProvider>
      <div className="flex min-h-screen bg-background w-full">
        <Sidebar variant="sidebar" className="border-r border-border/50">
          <SidebarHeader className="p-4 flex flex-row items-center gap-2">
            <div className="w-8 h-8 bg-primary/20 rounded-lg flex items-center justify-center border border-primary/30">
              <ShieldCheck className="w-4 h-4 text-primary" />
            </div>
            <div className="flex flex-col">
              <span className="font-bold text-sm tracking-wide">RPay</span>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{portalLabel}</span>
            </div>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Menu</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {navItems.map((item) => (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton
                        asChild
                        isActive={location === item.href}
                        tooltip={item.title}
                      >
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
