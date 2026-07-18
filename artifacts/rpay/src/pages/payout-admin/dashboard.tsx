import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Users, ArrowRightLeft, Clock, CheckCircle2, TrendingUp, UserCog, ChevronRight, Activity,
} from "lucide-react";
import { getToken } from "@/lib/auth";

interface DashboardStats {
  payoutMerchantCount: number;
  pendingPayoutCount: number;
  todayPayoutCount: number;
  todayPayoutVolume: number;
  activeAgentCount: number;
}

async function fetchPayoutAdminDashboard(): Promise<DashboardStats> {
  const token = getToken();
  const res = await fetch("/api/payout-admin/dashboard", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to load dashboard");
  return res.json();
}

export default function PayoutAdminDashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPayoutAdminDashboard()
      .then(setStats)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const statCards = [
    {
      label: "Payout Merchants",
      value: stats?.payoutMerchantCount ?? "—",
      icon: Users,
      color: "text-primary",
      bg: "bg-primary/10",
      href: "/payout-admin/payout-merchants",
    },
    {
      label: "Pending Approval",
      value: stats?.pendingPayoutCount ?? "—",
      icon: Clock,
      color: "text-amber-400",
      bg: "bg-amber-500/10",
      href: "/payout-admin/payouts?status=PENDING_ADMIN_APPROVAL",
    },
    {
      label: "Today's Payouts",
      value: stats?.todayPayoutCount ?? "—",
      icon: ArrowRightLeft,
      color: "text-emerald-400",
      bg: "bg-emerald-500/10",
      href: "/payout-admin/payouts",
    },
    {
      label: "Today's Volume",
      value: stats ? `₹${Number(stats.todayPayoutVolume).toLocaleString()}` : "—",
      icon: TrendingUp,
      color: "text-cyan-400",
      bg: "bg-cyan-500/10",
      href: "/payout-admin/payouts",
    },
    {
      label: "Active Agents",
      value: stats?.activeAgentCount ?? "—",
      icon: UserCog,
      color: "text-violet-400",
      bg: "bg-violet-500/10",
      href: "/payout-admin/agents",
    },
  ];

  const quickActions = [
    { label: "Payout Merchants", href: "/payout-admin/payout-merchants", icon: Users, color: "text-primary", bg: "bg-primary/10" },
    { label: "Pending Payouts", href: "/payout-admin/payouts", icon: Clock, color: "text-amber-400", bg: "bg-amber-500/10" },
    { label: "Agents", href: "/payout-admin/agents", icon: UserCog, color: "text-violet-400", bg: "bg-violet-500/10" },
    { label: "Audit Logs", href: "/payout-admin/audit-logs", icon: Activity, color: "text-cyan-400", bg: "bg-cyan-500/10" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight">Payout Admin Dashboard</h1>
        <p className="text-muted-foreground">Overview of payout operations</p>
      </div>

      {stats?.pendingPayoutCount != null && stats.pendingPayoutCount > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <Clock className="h-4 w-4 text-amber-400 shrink-0" />
          <p className="text-sm text-amber-300">
            <span className="font-semibold">{stats.pendingPayoutCount} payout{stats.pendingPayoutCount !== 1 ? "s" : ""}</span> pending admin approval.
          </p>
          <Link href="/payout-admin/payouts">
            <Button size="sm" variant="outline" className="ml-auto border-amber-500/40 text-amber-400 hover:bg-amber-500/20 h-7 text-xs gap-1">
              Review <ChevronRight className="h-3 w-3" />
            </Button>
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {statCards.map((card) => (
          <Link key={card.label} href={card.href}>
            <Card className="border-border/50 cursor-pointer hover:border-border/80 transition-colors">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">{card.label}</p>
                    <p className={`text-2xl font-bold ${loading ? "animate-pulse text-muted-foreground" : card.color}`}>
                      {loading ? "..." : card.value}
                    </p>
                  </div>
                  <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${card.bg}`}>
                    <card.icon className={`h-5 w-5 ${card.color}`} />
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Activity className="h-4 w-4 text-primary" />
            Quick Actions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {quickActions.map((action) => (
              <Link key={action.label} href={action.href}>
                <div className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-border/40 bg-card/30 p-4 text-center transition-all hover:border-border/80 hover:bg-card/60">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${action.bg}`}>
                    <action.icon className={`h-5 w-5 ${action.color}`} />
                  </div>
                  <span className="text-xs text-muted-foreground">{action.label}</span>
                </div>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
