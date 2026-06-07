import { useGetDashboardStats, useGetDashboardChart } from "@workspace/api-client-react";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowDownLeft, ArrowUpRight, Activity, Clock } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { format } from "date-fns";

export default function AdminDashboard() {
  const { data: stats, isLoading: statsLoading } = useGetDashboardStats();
  const { data: chartData, isLoading: chartLoading } = useGetDashboardChart();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Overview</h1>
        <p className="text-muted-foreground">Monitor platform activity and metrics.</p>
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
            title="Total Deposits"
            value={`$${stats.totalDeposits.toLocaleString()}`}
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
            value={stats.pendingTransactions + stats.pendingMerchants}
            icon={<Clock className="w-4 h-4 text-amber-500" />}
            description={`${stats.pendingTransactions} txns, ${stats.pendingMerchants} merchants`}
          />
        </div>
      ) : null}

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
