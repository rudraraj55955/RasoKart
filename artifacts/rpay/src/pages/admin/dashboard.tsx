import { useGetDashboardStats, useGetDashboardChart, useGetDashboardMerchantVolumes, useGetDashboardNotifications, useGetDashboardRisk } from "@workspace/api-client-react";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowDownLeft, ArrowUpRight, Activity, Clock, Store, AlertTriangle, Bell, TrendingDown, ShieldAlert, ChevronRight } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, BarChart, Bar, Legend } from "recharts";
import { format } from "date-fns";
import { Link } from "wouter";

const SEVERITY_STYLES: Record<string, string> = {
  error:   "bg-rose-500/10 text-rose-400 border-rose-500/20",
  warning: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  info:    "bg-primary/10 text-primary border-primary/20",
};

export default function AdminDashboard() {
  const { data: stats, isLoading: statsLoading } = useGetDashboardStats();
  const { data: chartData, isLoading: chartLoading } = useGetDashboardChart();
  const { data: merchantVolumes, isLoading: mvLoading } = useGetDashboardMerchantVolumes();
  const { data: notifications } = useGetDashboardNotifications();
  const { data: risk } = useGetDashboardRisk();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">Platform overview and real-time monitoring</p>
      </div>

      {notifications && notifications.data.length > 0 && (
        <div className="space-y-2">
          {notifications.data.map((n) => (
            <div key={n.id} className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-sm ${SEVERITY_STYLES[n.severity]}`}>
              <Bell className="w-4 h-4 shrink-0" />
              <span className="flex-1">{n.message}</span>
              {n.link && (
                <Link href={n.link}>
                  <span className="flex items-center gap-1 text-xs opacity-80 hover:opacity-100 cursor-pointer">
                    View <ChevronRight className="w-3 h-3" />
                  </span>
                </Link>
              )}
            </div>
          ))}
        </div>
      )}

      {statsLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Card key={i} className="animate-pulse bg-muted/50 h-32" />)}
        </div>
      ) : stats ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Total Deposits"
            value={`₹${Number(stats.totalDeposits).toLocaleString()}`}
            icon={<ArrowDownLeft className="w-4 h-4 text-emerald-500" />}
          />
          <StatCard
            title="Total Withdrawals"
            value={`₹${Number(stats.totalWithdrawals).toLocaleString()}`}
            icon={<ArrowUpRight className="w-4 h-4 text-rose-500" />}
          />
          <StatCard
            title="Success Rate"
            value={`${((stats.successTransactions / Math.max(1, stats.successTransactions + stats.failedTransactions)) * 100).toFixed(1)}%`}
            icon={<Activity className="w-4 h-4 text-primary" />}
            description={`${stats.successTransactions} successful · ${stats.failedTransactions} failed`}
          />
          <StatCard
            title="Pending Actions"
            value={stats.pendingTransactions + stats.pendingMerchants}
            icon={<Clock className="w-4 h-4 text-amber-500" />}
            description={`${stats.pendingTransactions} txns · ${stats.pendingMerchants} merchants`}
          />
        </div>
      ) : null}

      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="border-border/50 bg-card/50">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Store className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Total Merchants</p>
                  <p className="text-xl font-bold">{stats.totalMerchants}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50 bg-card/50">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-amber-500/10 flex items-center justify-center">
                  <Clock className="w-4 h-4 text-amber-500" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Pending Merchants</p>
                  <p className="text-xl font-bold">{stats.pendingMerchants}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50 bg-card/50">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                  <Activity className="w-4 h-4 text-emerald-500" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Net Balance</p>
                  <p className="text-xl font-bold font-mono">₹{Number(stats.totalBalance ?? 0).toLocaleString()}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50 bg-card/50">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-rose-500/10 flex items-center justify-center">
                  <ShieldAlert className="w-4 h-4 text-rose-500" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Failure Rate</p>
                  <p className="text-xl font-bold">{risk ? `${risk.failedRatePercent}%` : "—"}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Volume — Last 30 Days</CardTitle>
        </CardHeader>
        <CardContent className="h-[300px]">
          {chartLoading ? (
            <div className="w-full h-full animate-pulse bg-muted/20 rounded-md" />
          ) : chartData && chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorDep2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorWit2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--chart-5))" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(var(--chart-5))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tickFormatter={(v) => format(new Date(v), "MMM d")} stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} dy={8} />
                <YAxis tickFormatter={(v) => `₹${v >= 1000 ? `${(v/1000).toFixed(0)}k` : v}`} stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} dx={-8} />
                <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))" }} itemStyle={{ color: "hsl(var(--foreground))" }} labelFormatter={(v) => format(new Date(v), "MMM d, yyyy")} />
                <Area type="monotone" dataKey="deposits" name="Deposits" stroke="hsl(var(--chart-1))" fillOpacity={1} fill="url(#colorDep2)" strokeWidth={2} />
                <Area type="monotone" dataKey="withdrawals" name="Withdrawals" stroke="hsl(var(--chart-5))" fillOpacity={1} fill="url(#colorWit2)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">No data available</div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top Merchant Volumes</CardTitle>
          </CardHeader>
          <CardContent className="h-[280px]">
            {mvLoading ? (
              <div className="w-full h-full animate-pulse bg-muted/20 rounded-md" />
            ) : merchantVolumes && merchantVolumes.data.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={merchantVolumes.data.slice(0, 6)} margin={{ top: 5, right: 5, left: 0, bottom: 45 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="merchantName"
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                    dy={8}
                    angle={-20}
                    textAnchor="end"
                    interval={0}
                    tick={{ fill: "hsl(var(--muted-foreground))" }}
                  />
                  <YAxis tickFormatter={(v) => `₹${v >= 1000 ? `${(v/1000).toFixed(0)}k` : v}`} stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))" }} formatter={(v: any) => [`₹${Number(v).toLocaleString()}`, ""]} />
                  <Legend formatter={(v) => <span className="text-xs text-muted-foreground capitalize">{v}</span>} />
                  <Bar dataKey="totalDeposits" name="Deposits" fill="hsl(var(--chart-1))" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="totalWithdrawals" name="Withdrawals" fill="hsl(var(--chart-5))" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">No merchant data</div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader>
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <CardTitle className="text-base">Risk Monitoring</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {risk ? (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-lg bg-muted/20 p-3 text-center">
                    <p className="text-2xl font-bold text-amber-400">{risk.highValueCount}</p>
                    <p className="text-xs text-muted-foreground mt-1">High-Value</p>
                    <p className="text-[10px] text-muted-foreground opacity-60">&gt;₹1L</p>
                  </div>
                  <div className="rounded-lg bg-muted/20 p-3 text-center">
                    <p className="text-2xl font-bold text-rose-400">{risk.failedRatePercent}%</p>
                    <p className="text-xs text-muted-foreground mt-1">Failure Rate</p>
                    <p className="text-[10px] text-muted-foreground opacity-60">overall</p>
                  </div>
                  <div className="rounded-lg bg-muted/20 p-3 text-center">
                    <p className="text-2xl font-bold text-orange-400">{risk.suspiciousCount}</p>
                    <p className="text-xs text-muted-foreground mt-1">Flagged</p>
                    <p className="text-[10px] text-muted-foreground opacity-60">items</p>
                  </div>
                </div>
                {risk.topFailingMerchants.length > 0 ? (
                  <div>
                    <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                      <TrendingDown className="w-3 h-3" /> Top failing merchants
                    </p>
                    <div className="space-y-2">
                      {risk.topFailingMerchants.map((m: any) => (
                        <div key={m.merchantId} className="flex items-center justify-between">
                          <span className="text-sm truncate max-w-[140px]">{m.merchantName}</span>
                          <div className="flex items-center gap-2">
                            <div className="w-24 bg-muted/30 rounded-full h-1.5">
                              <div className="h-1.5 rounded-full bg-rose-500" style={{ width: `${Math.min(100, m.failedRate)}%` }} />
                            </div>
                            <span className="text-xs text-rose-400 font-mono w-10 text-right">{m.failedRate.toFixed(0)}%</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/20 p-4 text-center">
                    <p className="text-sm text-emerald-400">No high-risk merchants detected</p>
                    <p className="text-xs text-muted-foreground mt-1">All merchants within normal parameters</p>
                  </div>
                )}
              </>
            ) : (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 bg-muted/20 rounded-lg animate-pulse" />)}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
