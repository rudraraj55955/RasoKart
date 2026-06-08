import { useGetDashboardStats, useGetDashboardChart, useGetMe, useGetMyPlan } from "@workspace/api-client-react";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowDownLeft, ArrowUpRight, Activity, Clock, CreditCard } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { format } from "date-fns";

export default function MerchantDashboard() {
  const { data: user } = useGetMe();
  const { data: stats, isLoading: statsLoading } = useGetDashboardStats();
  const { data: chartData, isLoading: chartLoading } = useGetDashboardChart();
  const { data: myPlan } = useGetMyPlan();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Welcome, {user?.name || "Merchant"}</h1>
        <p className="text-muted-foreground">Overview of your transaction activity.</p>
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
            title="Available Balance"
            value={`$${stats.totalBalance.toLocaleString()}`}
            icon={<ArrowDownLeft className="w-4 h-4 text-emerald-500" />}
          />
          <StatCard
            title="Total Withdrawals"
            value={`$${stats.totalWithdrawals.toLocaleString()}`}
            icon={<ArrowUpRight className="w-4 h-4 text-rose-500" />}
          />
          <StatCard
            title="Success Rate"
            value={`${((stats.successTransactions / (stats.successTransactions + stats.failedTransactions || 1)) * 100).toFixed(1)}%`}
            icon={<Activity className="w-4 h-4 text-primary" />}
            description={`${stats.successTransactions} successful, ${stats.failedTransactions} failed`}
          />
          <StatCard
            title="Pending Actions"
            value={stats.pendingTransactions}
            icon={<Clock className="w-4 h-4 text-amber-500" />}
            description={`${stats.pendingTransactions} pending transactions`}
          />
        </div>
      ) : null}

      {myPlan ? (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-primary" />
              <CardTitle className="text-base">Your Plan</CardTitle>
              <Badge variant="outline" className="ml-auto text-primary border-primary/40">{myPlan.planName}</Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {(() => {
                let pricing: { qr?: { monthly?: number; perTx?: number }; va?: { monthly?: number; perTx?: number } } = {};
                let features: string[] = [];
                try { pricing = JSON.parse(myPlan.pricing); } catch {}
                try { features = JSON.parse(myPlan.features); } catch {}
                return (
                  <>
                    <div className="space-y-1.5">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">QR Pricing</p>
                      {pricing.qr?.monthly != null && <p className="text-sm">Monthly fee: <span className="font-semibold">₹{pricing.qr.monthly}</span></p>}
                      {pricing.qr?.perTx != null && <p className="text-sm">Per transaction: <span className="font-semibold">₹{pricing.qr.perTx}</span></p>}
                    </div>
                    <div className="space-y-1.5">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">VA Pricing</p>
                      {pricing.va?.monthly != null && <p className="text-sm">Monthly fee: <span className="font-semibold">₹{pricing.va.monthly}</span></p>}
                      {pricing.va?.perTx != null && <p className="text-sm">Per transaction: <span className="font-semibold">₹{pricing.va.perTx}</span></p>}
                    </div>
                    <div className="space-y-1.5">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Features</p>
                      <ul className="space-y-0.5">
                        {features.slice(0, 4).map((f, i) => (
                          <li key={i} className="text-sm text-muted-foreground">• {f}</li>
                        ))}
                      </ul>
                    </div>
                  </>
                );
              })()}
            </div>
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
          <CardTitle>Volume (30 Days)</CardTitle>
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
                <XAxis
                  dataKey="date"
                  tickFormatter={(val) => format(new Date(val), "MMM d")}
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  dy={10}
                />
                <YAxis
                  tickFormatter={(val) => `$${val >= 1000 ? (val / 1000).toFixed(0) + 'k' : val}`}
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  dx={-10}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }}
                  itemStyle={{ color: 'hsl(var(--foreground))' }}
                  labelFormatter={(val) => format(new Date(val), "MMM d, yyyy")}
                />
                <Area
                  type="monotone"
                  dataKey="deposits"
                  name="Deposits"
                  stroke="hsl(var(--chart-1))"
                  fillOpacity={1}
                  fill="url(#colorDeposits)"
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="withdrawals"
                  name="Withdrawals"
                  stroke="hsl(var(--chart-5))"
                  fillOpacity={1}
                  fill="url(#colorWithdrawals)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="w-full h-full flex items-center justify-center text-muted-foreground">
              No data available
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
