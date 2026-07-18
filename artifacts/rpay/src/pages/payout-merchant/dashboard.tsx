import { useQuery } from "@tanstack/react-query";
import { getToken } from "@/lib/auth";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ArrowRightLeft, Wallet, CheckCircle2, Clock, XCircle, TrendingUp, ChevronRight, AlertCircle } from "lucide-react";
import { Link } from "wouter";
import { format } from "date-fns";

async function apiFetch<T>(url: string): Promise<T> {
  const token = getToken();
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as any).error ?? "Request failed"); }
  return res.json();
}

function fmtAmount(v: string | number | null | undefined): string {
  const n = Number(v ?? 0);
  return "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    "Sent": "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    "Processing": "bg-blue-500/15 text-blue-400 border-blue-500/30",
    "Failed": "bg-red-500/15 text-red-400 border-red-500/30",
    "Reversed": "bg-amber-500/15 text-amber-400 border-amber-500/30",
    "Rejected": "bg-red-500/15 text-red-400 border-red-500/30",
  };
  return (
    <Badge variant="outline" className={`text-[10px] border ${map[status] ?? "bg-muted/30 text-muted-foreground border-border"}`}>
      {status}
    </Badge>
  );
}

export default function PayoutMerchantDashboard() {
  const { user } = useAuth();
  const u = user as any;

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["payout-merchant-stats"],
    queryFn: () => apiFetch<any>("/api/payout-merchant/stats"),
  });
  const { data: config } = useQuery({
    queryKey: ["payout-merchant-config"],
    queryFn: () => apiFetch<any>("/api/payout-merchant/config"),
  });
  const { data: recentPayouts, isLoading: payoutsLoading } = useQuery({
    queryKey: ["payout-merchant-recent-payouts"],
    queryFn: () => apiFetch<any>("/api/payout-merchant/payouts?limit=5"),
  });

  if (statsLoading) {
    return <div className="flex items-center justify-center h-64"><Spinner className="w-8 h-8 text-primary" /></div>;
  }

  const isServiceEnabled = config?.payoutServiceEnabled ?? false;
  const isApproved = config?.merchant?.status === "approved";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Welcome back, {user?.name ?? user?.email}
        </p>
      </div>

      {/* Approval/service warning */}
      {(!isApproved || !isServiceEnabled) && (
        <div className="border border-amber-500/30 bg-amber-500/10 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-amber-400">
              {!isApproved ? "Account Pending Approval" : "Payout Service Disabled"}
            </p>
            <p className="text-xs text-amber-400/80 mt-1">
              {!isApproved
                ? "Your payout merchant account is awaiting admin approval. You'll be notified once approved."
                : "Payout service is currently disabled for your account. Please contact support."}
            </p>
          </div>
        </div>
      )}

      {/* Stats cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Link href="/payout-merchant/wallet">
          <Card className="bg-card border-border/50 cursor-pointer hover:border-border/80 transition-colors">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Wallet className="w-4 h-4 text-blue-400" />
                <span className="text-xs text-muted-foreground">Available Balance</span>
              </div>
              <p className="text-2xl font-bold text-foreground">{fmtAmount(stats?.walletAvailable)}</p>
              {Number(stats?.walletHold ?? 0) > 0 && (
                <p className="text-xs text-muted-foreground mt-1">{fmtAmount(stats?.walletHold)} on hold</p>
              )}
            </CardContent>
          </Card>
        </Link>
        <Link href="/payout-merchant/payouts?status=Sent">
          <Card className="bg-card border-border/50 cursor-pointer hover:border-border/80 transition-colors">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span className="text-xs text-muted-foreground">Total Sent</span>
              </div>
              <p className="text-2xl font-bold text-foreground">{fmtAmount(stats?.successTotal)}</p>
              <p className="text-xs text-muted-foreground mt-1">{stats?.successCount ?? 0} payouts</p>
            </CardContent>
          </Card>
        </Link>
        <Link href="/payout-merchant/payouts?status=Processing">
          <Card className="bg-card border-border/50 cursor-pointer hover:border-border/80 transition-colors">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-4 h-4 text-amber-400" />
                <span className="text-xs text-muted-foreground">Pending</span>
              </div>
              <p className="text-2xl font-bold text-foreground">{fmtAmount(stats?.pendingTotal)}</p>
              <p className="text-xs text-muted-foreground mt-1">{stats?.pendingCount ?? 0} payouts</p>
            </CardContent>
          </Card>
        </Link>
        <Link href="/payout-merchant/payouts?status=Failed">
          <Card className="bg-card border-border/50 cursor-pointer hover:border-border/80 transition-colors">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <XCircle className="w-4 h-4 text-red-400" />
                <span className="text-xs text-muted-foreground">Failed</span>
              </div>
              <p className="text-2xl font-bold text-foreground">{stats?.failedCount ?? 0}</p>
              <p className="text-xs text-muted-foreground mt-1">payouts</p>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Link href="/payout-merchant/payouts">
          <Card className="bg-card border-border/50 hover:border-primary/40 cursor-pointer transition-colors group">
            <CardContent className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                  <ArrowRightLeft className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Send Payout</p>
                  <p className="text-xs text-muted-foreground">Transfer funds to beneficiary</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
            </CardContent>
          </Card>
        </Link>
        <Link href="/payout-merchant/wallet">
          <Card className="bg-card border-border/50 hover:border-primary/40 cursor-pointer transition-colors group">
            <CardContent className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-blue-500/10 flex items-center justify-center">
                  <Wallet className="w-4 h-4 text-blue-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Wallet</p>
                  <p className="text-xs text-muted-foreground">View balance & history</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Recent payouts */}
      <Card className="bg-card border-border/50">
        <CardHeader className="flex flex-row items-center justify-between px-4 py-3 border-b border-border/40">
          <CardTitle className="text-sm font-semibold">Recent Payouts</CardTitle>
          <Link href="/payout-merchant/payouts">
            <Button variant="ghost" size="sm" className="text-xs h-7 text-primary hover:text-primary">
              View all <ChevronRight className="w-3 h-3 ml-1" />
            </Button>
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          {payoutsLoading ? (
            <div className="flex items-center justify-center py-8"><Spinner className="w-5 h-5 text-muted-foreground" /></div>
          ) : (recentPayouts?.payouts ?? []).length === 0 ? (
            <div className="py-10 text-center">
              <ArrowRightLeft className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No payouts yet</p>
              <Link href="/payout-merchant/payouts">
                <Button size="sm" className="mt-3">Send First Payout</Button>
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-border/40">
              {(recentPayouts?.payouts ?? []).map((p: any) => (
                <div key={p.id} className="flex items-center justify-between px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground truncate">{p.accountHolder ?? "—"}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.payoutMode} · {format(new Date(p.createdAt), "dd MMM yyyy, HH:mm")}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 ml-4">
                    <p className="text-sm font-semibold text-foreground">{fmtAmount(p.amount)}</p>
                    <StatusBadge status={p.displayStatus} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
