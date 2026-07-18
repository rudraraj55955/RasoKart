import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Users, CheckCircle2, Clock, TrendingUp,
  ChevronRight, AlertCircle, Wallet, BookOpen, UserCog,
} from "lucide-react";
import { Link } from "wouter";
import { getToken } from "@/lib/auth";

interface AgentDashboardStats {
  totalMerchantsOnboarded: number;
  pendingMerchants: number;
  approvedMerchants: number;
  rejectedMerchants: number;
  suspendedMerchants: number;
  walletBalance: number;
  totalCommissionEarned: number;
  totalCommissionPaid: number;
  withdrawableCommission: number;
}

interface AgentMerchant {
  id: number;
  businessName: string;
  email: string;
  status: string;
  payoutServiceEnabled: boolean;
  createdAt: string;
}

async function fetchDashboard(): Promise<AgentDashboardStats> {
  const token = getToken();
  const res = await fetch("/api/agent/dashboard", { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error("Failed to load dashboard");
  return res.json();
}

async function fetchMyMerchants(): Promise<AgentMerchant[]> {
  const token = getToken();
  const res = await fetch("/api/agent/payout-merchants", { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error("Failed to load merchants");
  const data = await res.json();
  return data.data ?? [];
}

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  approved:  { label: "Active",    className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  pending:   { label: "Pending",   className: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  suspended: { label: "Suspended", className: "bg-rose-500/10 text-rose-400 border-rose-500/20" },
  rejected:  { label: "Rejected",  className: "bg-muted text-muted-foreground" },
};

export default function AgentDashboard() {
  const [stats, setStats] = useState<AgentDashboardStats | null>(null);
  const [merchants, setMerchants] = useState<AgentMerchant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchDashboard(), fetchMyMerchants()])
      .then(([s, m]) => { setStats(s); setMerchants(m); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <AlertCircle className="h-10 w-10 text-rose-400/60" />
        <p className="text-sm text-muted-foreground">{error}</p>
        <p className="text-xs text-muted-foreground/60">Ensure your agent profile is set up by an admin.</p>
      </div>
    );
  }

  const statCards = [
    { label: "Total Merchants",   value: stats?.totalMerchantsOnboarded ?? "—", icon: Users,       color: "text-primary",     bg: "bg-primary/10",     href: "/agent/payout-merchants" },
    { label: "Pending",           value: stats?.pendingMerchants ?? "—",         icon: Clock,        color: "text-amber-400",   bg: "bg-amber-500/10",   href: "/agent/payout-merchants?status=pending" },
    { label: "Active",            value: stats?.approvedMerchants ?? "—",        icon: CheckCircle2, color: "text-emerald-400", bg: "bg-emerald-500/10", href: "/agent/payout-merchants?status=approved" },
    { label: "Rejected",          value: stats?.rejectedMerchants ?? "—",        icon: AlertCircle,  color: "text-rose-400",    bg: "bg-rose-500/10",    href: "/agent/payout-merchants?status=rejected" },
    { label: "Commission Earned", value: stats ? `₹${stats.totalCommissionEarned.toLocaleString()}` : "—", icon: TrendingUp, color: "text-cyan-400",   bg: "bg-cyan-500/10",   href: "/agent/commission" },
    { label: "Withdrawable",      value: stats ? `₹${stats.withdrawableCommission.toLocaleString()}` : "—", icon: Wallet,    color: "text-violet-400", bg: "bg-violet-500/10", href: "/agent/commission" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight">Agent Dashboard</h1>
        <p className="text-muted-foreground">Your merchant onboarding overview</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {statCards.map((card) => {
          const cardEl = (
            <Card className={`border-border/50 ${card.href ? "cursor-pointer hover:border-border/80 transition-colors" : ""}`}>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">{card.label}</p>
                    <p className={`text-2xl font-bold ${loading ? "animate-pulse text-muted-foreground" : card.color}`}>
                      {loading ? "…" : card.value}
                    </p>
                  </div>
                  <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${card.bg}`}>
                    <card.icon className={`h-5 w-5 ${card.color}`} />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
          return card.href ? (
            <Link key={card.label} href={card.href}>{cardEl}</Link>
          ) : (
            <div key={card.label}>{cardEl}</div>
          );
        })}
      </div>

      <Card className="border-border/50">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Users className="h-4 w-4 text-primary" />
            My Payout Merchants
            {merchants.length > 0 && (
              <Badge className="ml-1 text-xs border-border/40" variant="outline">{merchants.length}</Badge>
            )}
          </CardTitle>
          <Link href="/agent/payout-merchants">
            <Button variant="ghost" size="sm" className="gap-1 text-xs">
              View all <ChevronRight className="h-3 w-3" />
            </Button>
          </Link>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
          ) : merchants.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center text-muted-foreground">
              <UserCog className="mb-2 h-8 w-8 opacity-30" />
              <p className="text-sm">No payout merchants yet.</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Share your referral code to onboard merchants.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {merchants.slice(0, 8).map((m) => {
                const badge = STATUS_BADGE[m.status] ?? STATUS_BADGE["pending"];
                return (
                  <div key={m.id} className="flex items-center justify-between rounded-lg border border-border/30 bg-card/20 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{m.businessName}</p>
                      <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                    </div>
                    <Badge variant="outline" className={`ml-2 shrink-0 text-xs ${badge.className}`}>
                      {badge.label}
                    </Badge>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[
              { label: "My Merchants", href: "/agent/payout-merchants", icon: Users,    color: "text-primary",    bg: "bg-primary/10" },
              { label: "Commission",   href: "/agent/commission",        icon: BookOpen, color: "text-cyan-400",   bg: "bg-cyan-500/10" },
              { label: "Profile",      href: "/agent/profile",           icon: UserCog,  color: "text-violet-400", bg: "bg-violet-500/10" },
            ].map((action) => (
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
