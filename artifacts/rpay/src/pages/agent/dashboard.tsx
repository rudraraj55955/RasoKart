import { useListMerchants, useApproveMerchant, useGetDashboardStats } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Users,
  CheckCircle2,
  Clock,
  TrendingUp,
  ArrowDownLeft,
  Store,
  ChevronRight,
  UserCheck,
  UserX,
  AlertCircle,
  Activity,
} from "lucide-react";
import { Link } from "wouter";
import { format } from "date-fns";

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  active:    { label: "Active",    className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  pending:   { label: "Pending",   className: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  suspended: { label: "Suspended", className: "bg-rose-500/10 text-rose-400 border-rose-500/20" },
  rejected:  { label: "Rejected",  className: "bg-muted text-muted-foreground" },
};

export default function AgentDashboard() {
  const qc = useQueryClient();
  const [approvingId, setApprovingId] = useState<number | null>(null);

  const { data: stats } = useGetDashboardStats();
  const { data: pendingData } = useListMerchants({ status: "pending", page: 1, limit: 10 });
  const { data: allData } = useListMerchants({ page: 1, limit: 200 });

  const approveMutation = useApproveMerchant();

  const pending = pendingData?.data ?? [];
  const all = allData?.data ?? [];
  const activeCount  = all.filter((m) => (m.status as string) === "approved").length;
  const suspendedCount = all.filter((m) => (m.status as string) === "suspended").length;

  function handleApprove(id: number) {
    setApprovingId(id);
    approveMutation.mutate(
      { id },
      {
        onSuccess: () => {
          toast.success("Merchant approved successfully");
          void qc.invalidateQueries({ queryKey: ["/api/merchants"] });
        },
        onError: (err) => toast.error(err.message || "Approval failed"),
        onSettled: () => setApprovingId(null),
      }
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight">Agent Dashboard</h1>
        <p className="text-muted-foreground">Merchant onboarding overview and quick actions</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-border/50">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Pending Applications</p>
                <p className="text-3xl font-bold text-amber-400">{pending.length}</p>
              </div>
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/10">
                <Clock className="h-6 w-6 text-amber-400" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Active Merchants</p>
                <p className="text-3xl font-bold text-emerald-400">{activeCount}</p>
              </div>
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/10">
                <CheckCircle2 className="h-6 w-6 text-emerald-400" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Deposits</p>
                <p className="text-3xl font-bold">
                  ₹{stats ? Number(stats.totalDeposits).toLocaleString() : "—"}
                </p>
              </div>
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
                <ArrowDownLeft className="h-6 w-6 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Suspended</p>
                <p className="text-3xl font-bold text-rose-400">{suspendedCount}</p>
              </div>
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-rose-500/10">
                <AlertCircle className="h-6 w-6 text-rose-400" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Pending Applications */}
        <Card className="border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <Clock className="h-4 w-4 text-amber-400" />
              Pending Applications
              {pending.length > 0 && (
                <Badge className="ml-1 border-amber-500/30 bg-amber-500/10 text-amber-400" variant="outline">
                  {pending.length}
                </Badge>
              )}
            </CardTitle>
            <Link href="/admin/merchants">
              <Button variant="ghost" size="sm" className="gap-1 text-xs">
                View all <ChevronRight className="h-3 w-3" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {pending.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center text-muted-foreground">
                <CheckCircle2 className="mb-2 h-8 w-8 text-emerald-400/50" />
                <p className="text-sm">No pending applications</p>
              </div>
            ) : (
              <div className="space-y-3">
                {pending.map((m) => (
                  <div
                    key={m.id}
                    className="flex items-center justify-between rounded-xl border border-border/40 bg-card/30 p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{m.businessName}</p>
                      <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                      {m.createdAt && (
                        <p className="mt-0.5 text-xs text-muted-foreground/60">
                          Applied {format(new Date(m.createdAt), "dd MMM yyyy")}
                        </p>
                      )}
                    </div>
                    <div className="ml-3 flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 text-xs"
                        disabled={approvingId === m.id}
                        onClick={() => handleApprove(m.id)}
                      >
                        <UserCheck className="h-3 w-3" />
                        {approvingId === m.id ? "…" : "Approve"}
                      </Button>
                      <Link href="/admin/merchants">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0">
                          <ChevronRight className="h-3 w-3" />
                        </Button>
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* All Merchants Overview */}
        <Card className="border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <Store className="h-4 w-4 text-primary" />
              Merchant Overview
            </CardTitle>
            <Link href="/admin/merchants">
              <Button variant="ghost" size="sm" className="gap-1 text-xs">
                Manage all <ChevronRight className="h-3 w-3" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {all.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center text-muted-foreground">
                <Users className="mb-2 h-8 w-8 opacity-30" />
                <p className="text-sm">No merchants yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {all.slice(0, 8).map((m) => {
                  const badge = STATUS_BADGE[m.status] ?? STATUS_BADGE["pending"];
                  return (
                    <div
                      key={m.id}
                      className="flex items-center justify-between rounded-lg border border-border/30 bg-card/20 px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{m.businessName}</p>
                        <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                      </div>
                      <Badge
                        variant="outline"
                        className={`ml-2 shrink-0 text-xs ${badge.className}`}
                      >
                        {badge.label}
                      </Badge>
                    </div>
                  );
                })}
                {all.length > 8 && (
                  <Link href="/admin/merchants">
                    <p className="pt-1 text-center text-xs text-muted-foreground hover:text-foreground cursor-pointer">
                      +{all.length - 8} more merchants →
                    </p>
                  </Link>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Activity className="h-4 w-4 text-primary" />
            Quick Actions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "All Merchants", href: "/admin/merchants", icon: Users, color: "text-primary", bg: "bg-primary/10" },
              { label: "Transactions", href: "/admin/transactions", icon: TrendingUp, color: "text-emerald-400", bg: "bg-emerald-500/10" },
              { label: "Settlements", href: "/admin/settlements", icon: ArrowDownLeft, color: "text-violet-400", bg: "bg-violet-500/10" },
              { label: "Audit Logs", href: "/admin/audit-logs", icon: Activity, color: "text-cyan-400", bg: "bg-cyan-500/10" },
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
