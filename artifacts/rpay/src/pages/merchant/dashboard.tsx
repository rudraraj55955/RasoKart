import { useGetDashboardStats, useGetDashboardChart, useGetMe, useGetMyPlan, useGetMyPlanUsage } from "@workspace/api-client-react";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TrendingUp, ArrowDownLeft, QrCode, Building2, CreditCard, Infinity, AlertTriangle, ChevronRight, Lock } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { format } from "date-fns";
import { Link } from "wouter";

interface UsageRowProps { label: string; used: number; limit: number; }

function UsageRow({ label, used, limit }: UsageRowProps) {
  const isUnlimited = limit >= 999;
  const pct = isUnlimited ? 0 : Math.min(100, (used / limit) * 100);
  const isNearLimit = !isUnlimited && pct >= 80;
  const isAtLimit = !isUnlimited && used >= limit;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className={`font-medium tabular-nums ${isAtLimit ? "text-rose-400" : isNearLimit ? "text-amber-400" : "text-foreground"}`}>
          {isUnlimited
            ? <span className="flex items-center gap-1">{used} / <Infinity className="w-3.5 h-3.5 text-emerald-400" /></span>
            : `${used} / ${limit}`}
        </span>
      </div>
      {!isUnlimited && (
        <div className="h-1.5 w-full rounded-full bg-muted/50">
          <div className={`h-1.5 rounded-full transition-all ${isAtLimit ? "bg-rose-500" : isNearLimit ? "bg-amber-400" : "bg-primary"}`} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

export default function MerchantDashboard() {
  const { data: user } = useGetMe();
  const { data: stats, isLoading: statsLoading } = useGetDashboardStats();
  const { data: chartData, isLoading: chartLoading } = useGetDashboardChart();
  const { data: myPlan } = useGetMyPlan();
  const { data: usage } = useGetMyPlanUsage();

  const isExpiringSoon = myPlan && !myPlan.isExpired && myPlan.daysUntilExpiry != null && myPlan.daysUntilExpiry <= 7;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Welcome, {user?.name || "Merchant"}</h1>
        <p className="text-muted-foreground">Overview of your deposit collection activity.</p>
      </div>

      {statsLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="animate-pulse bg-muted/50 h-32" />
          ))}
        </div>
      ) : stats ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Today's Deposits"
            value={`₹${stats.todayDepositAmount.toLocaleString()}`}
            icon={<TrendingUp className="w-4 h-4 text-primary" />}
            description={`${stats.todayDeposits} payment${stats.todayDeposits !== 1 ? "s" : ""} today`}
          />
          <StatCard
            title="Total Deposits"
            value={`₹${stats.totalDeposits.toLocaleString()}`}
            icon={<ArrowDownLeft className="w-4 h-4 text-emerald-500" />}
            description={`₹${stats.totalBalance.toLocaleString()} available balance`}
          />
          <StatCard
            title="Active QR Codes"
            value={stats.qrCount}
            icon={<QrCode className="w-4 h-4 text-sky-500" />}
            description="Dynamic QR codes accepting payments"
          />
          <StatCard
            title="Virtual Accounts"
            value={stats.vaCount}
            icon={<Building2 className="w-4 h-4 text-violet-500" />}
            description="Active virtual bank accounts"
          />
        </div>
      ) : null}

      {/* Expiry alerts */}
      {myPlan?.isExpired && (
        <Card className="border-rose-500/40 bg-rose-950/20">
          <CardContent className="py-4 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
            <div className="flex-1">
              <p className="text-sm text-rose-400 font-medium">Plan Expired</p>
              <p className="text-xs text-rose-400/70">Your {myPlan.planName} plan has expired. New QR codes, virtual accounts, and payouts are restricted.</p>
            </div>
            <Link href="/merchant/plan">
              <Button size="sm" variant="outline" className="border-rose-500/30 text-rose-400 hover:bg-rose-500/10 shrink-0">View Plan</Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {isExpiringSoon && !myPlan?.isExpired && (
        <Card className="border-amber-500/40 bg-amber-950/20">
          <CardContent className="py-4 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
            <div className="flex-1">
              <p className="text-sm text-amber-400 font-medium">Plan Expiring Soon</p>
              <p className="text-xs text-amber-400/70">Your {myPlan?.planName} plan expires in {myPlan?.daysUntilExpiry} day{myPlan?.daysUntilExpiry === 1 ? "" : "s"}. Contact support to renew.</p>
            </div>
            <Link href="/merchant/plan">
              <Button size="sm" variant="outline" className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10 shrink-0">View Plan</Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {myPlan ? (
        <Card className={`border ${myPlan.isExpired ? "border-rose-500/30 bg-rose-950/10" : "border-primary/30 bg-primary/5"}`}>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-primary" />
              <CardTitle className="text-base">Active Plan</CardTitle>
              <Badge variant="outline" className={`ml-1 ${myPlan.isExpired ? "text-rose-400 border-rose-500/30" : "text-primary border-primary/40"}`}>{myPlan.planName}</Badge>
              {myPlan.isExpired && <Badge variant="destructive" className="text-xs">Expired</Badge>}
              {myPlan.expiresAt && !myPlan.isExpired && (
                <span className={`ml-auto text-xs ${isExpiringSoon ? "text-amber-400" : "text-muted-foreground"}`}>
                  Expires {format(new Date(myPlan.expiresAt), "MMM d, yyyy")}
                </span>
              )}
              {!myPlan.expiresAt && <span className="ml-auto text-xs text-emerald-400">No expiry</span>}
              <Link href="/merchant/plan">
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground ml-1">
                  View Details <ChevronRight className="w-3 h-3 ml-0.5" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {usage ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-4">
                <UsageRow label="Dynamic QR Codes" used={usage.dynamicQr.used} limit={usage.dynamicQr.limit} />
                <UsageRow label="Static QR Codes" used={usage.staticQr.used} limit={usage.staticQr.limit} />
                <UsageRow label="Virtual Accounts" used={usage.virtualAccount.used} limit={usage.virtualAccount.limit} />
                <UsageRow label="Payment Links" used={usage.paymentLink.used} limit={usage.paymentLink.limit} />
                <UsageRow label="Payouts" used={usage.payout.used} limit={usage.payout.limit} />
                <UsageRow label="Transactions Today" used={usage.dailyTransaction.used} limit={usage.dailyTransaction.limit} />
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {(() => {
                  let features: string[] = [];
                  try { features = JSON.parse(myPlan.features); } catch {}
                  return (
                    <div className="col-span-full space-y-1.5">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Features</p>
                      <ul className="flex flex-wrap gap-x-6 gap-y-1">
                        {features.slice(0, 6).map((f, i) => (
                          <li key={i} className="text-sm text-muted-foreground">• {f}</li>
                        ))}
                      </ul>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Feature access badges */}
            {usage && (
              <div className="mt-4 pt-3 border-t border-border/50 flex flex-wrap gap-2">
                <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs border ${usage.apiAccess ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border-rose-500/30 bg-rose-500/10 text-rose-400"}`}>
                  {usage.apiAccess ? null : <Lock className="w-3 h-3" />}
                  API {usage.apiAccess ? "Enabled" : "Locked"}
                </div>
                <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs border ${usage.webhookAccess ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border-rose-500/30 bg-rose-500/10 text-rose-400"}`}>
                  {usage.webhookAccess ? null : <Lock className="w-3 h-3" />}
                  Webhooks {usage.webhookAccess ? "Enabled" : "Locked"}
                </div>
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-full text-xs border border-border/50 text-muted-foreground">
                  Settlement: {usage.settlementFee}%
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card className="border-dashed border-muted-foreground/30">
          <CardContent className="py-4 flex items-center gap-3 text-muted-foreground">
            <CreditCard className="w-4 h-4 shrink-0" />
            <p className="text-sm">No plan assigned yet. Contact support to get started with a plan.</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Deposit Volume (30 Days)</CardTitle>
        </CardHeader>
        <CardContent className="h-[400px]">
          {chartLoading ? (
            <div className="w-full h-full animate-pulse bg-muted/20 rounded-md" />
          ) : chartData && chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorDeposits" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorWithdrawals" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--chart-5))" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(var(--chart-5))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tickFormatter={(val) => format(new Date(val), "MMM d")} stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} dy={10} />
                <YAxis tickFormatter={(val) => `₹${val >= 1000 ? (val / 1000).toFixed(0) + 'k' : val}`} stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} dx={-10} />
                <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }} itemStyle={{ color: 'hsl(var(--foreground))' }} labelFormatter={(val) => format(new Date(val), "MMM d, yyyy")} />
                <Area type="monotone" dataKey="deposits" name="Deposits" stroke="hsl(var(--chart-1))" fillOpacity={1} fill="url(#colorDeposits)" strokeWidth={2} />
                <Area type="monotone" dataKey="withdrawals" name="Withdrawals" stroke="hsl(var(--chart-5))" fillOpacity={1} fill="url(#colorWithdrawals)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="w-full h-full flex items-center justify-center text-muted-foreground">No data available</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
