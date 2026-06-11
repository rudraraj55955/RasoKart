import { useAuth } from "@/lib/auth-context";
import { UserRole } from "@workspace/api-client-react";
import { Link, useLocation } from "wouter";
import { LayoutDashboard, ArrowDownLeft, Landmark, QrCode, Store, ArrowRightLeft } from "lucide-react";
import { cn } from "@/lib/utils";

const adminItems = [
  { title: "Dashboard", icon: LayoutDashboard, href: "/admin/dashboard" },
  { title: "Deposits", icon: ArrowDownLeft, href: "/admin/deposits" },
  { title: "Withdrawals", icon: Landmark, href: "/admin/withdrawals" },
  { title: "QR", icon: QrCode, href: "/admin/qr-codes" },
  { title: "Merchants", icon: Store, href: "/admin/merchants" },
];

const merchantItems = [
  { title: "Dashboard", icon: LayoutDashboard, href: "/merchant/dashboard" },
  { title: "Deposits", icon: ArrowDownLeft, href: "/merchant/deposits" },
  { title: "QR", icon: QrCode, href: "/merchant/qr-codes" },
  { title: "Withdraw", icon: Landmark, href: "/merchant/withdrawals" },
  { title: "Txns", icon: ArrowRightLeft, href: "/merchant/transactions" },
];

export function MobileBottomNav() {
  const { user } = useAuth();
  const [location] = useLocation();

  if (!user) return null;

  const isAdmin = (user as { role?: string }).role === UserRole.admin;
  const items = isAdmin ? adminItems : merchantItems;

  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-50 bg-sidebar border-t border-border/50"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="flex items-stretch justify-around h-16">
        {items.map((item) => {
          const isActive =
            location === item.href ||
            (item.href.length > 1 && location.startsWith(item.href));
          return (
            <Link key={item.href} href={item.href} className="flex-1">
              <div
                className={cn(
                  "flex flex-col items-center justify-center gap-1 h-full px-1 transition-colors active:scale-95",
                  isActive
                    ? "text-primary"
                    : "text-muted-foreground"
                )}
              >
                <item.icon className={cn("w-5 h-5", isActive && "drop-shadow-[0_0_6px_hsl(var(--primary)/0.6)]")} />
                <span className="text-[9px] font-medium leading-none tracking-wide">{item.title}</span>
              </div>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
