import { useGetApiMonitoringStats } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Activity, CheckCircle2, XCircle, Key, TrendingUp, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from "recharts";

function StatCard({ title, value, sub, icon, accent }: { title: string; value: string | number; sub?: string; icon: React.ReactNode; accent?: string }) {
  return (
    <Card className="border-border/50 bg-card/50">
      <CardContent className="pt-5 pb-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground mb-1">{title}</p>
            <p className="text-2xl font-bold tracking-tight">{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
          </div>
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${accent ?? "bg-primary/10"}`}>
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminApiMonitoring() {
  const { data, isLoading } = useGetApiMonitoringStats();

  const pieData = data ? [
    { name: "Success", value: data.successRequests, color: "hsl(var(--chart-2))" },
    { name: "Failed", value: data.failedRequests, color: "hsl(var(--chart-5))" },
  ] : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">API Monitoring</h1>
        <p className="text-muted-foreground mt-1">Real-time webhook delivery and API key statistics</p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="border-border/50 bg-card/50 h-28 animate-pulse" />
          ))}
        </div>
      ) : data ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <StatCard
              title="Total Webhook Calls"
              value={data.totalRequests.toLocaleString()}
              icon={<Activity className="w-5 h-5 text-primary" />}
              accent="bg-primary/10"
            />
            <StatCard
              title="Successful Deliveries"
              value={data.successRequests.toLocaleString()}
              sub={`${data.successRate}% success rate`}
              icon={<CheckCircle2 className="w-5 h-5 text-emerald-500" />}
              accent="bg-emerald-500/10"
            />
            <StatCard
              title="Failed Deliveries"
              value={data.failedRequests.toLocaleString()}
              sub={`${(100 - data.successRate).toFixed(1)}% failure rate`}
              icon={<XCircle className="w-5 h-5 text-rose-500" />}
              accent="bg-rose-500/10"
            />
            <StatCard
              title="Total API Keys"
              value={data.totalApiKeys}
              icon={<Key className="w-5 h-5 text-amber-500" />}
              accent="bg-amber-500/10"
            />
            <StatCard
              title="Active API Keys"
              value={data.activeApiKeys}
              sub={`${data.totalApiKeys - data.activeApiKeys} inactive`}
              icon={<TrendingUp className="w-5 h-5 text-primary" />}
              accent="bg-primary/10"
            />
            <Card className="border-border/50 bg-card/50">
              <CardContent className="pt-5 pb-5">
                <p className="text-xs text-muted-foreground mb-3">Delivery Success Rate</p>
                <div className="w-full bg-muted/30 rounded-full h-3">
                  <div
                    className="h-3 rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all"
                    style={{ width: `${data.successRate}%` }}
                  />
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-xs text-emerald-400">{data.successRate}%</span>
                  <span className="text-xs text-rose-400">{(100 - data.successRate).toFixed(1)}%</span>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="border-border/50">
              <CardHeader>
                <CardTitle className="text-base">Delivery Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                {data.totalRequests > 0 ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" paddingAngle={3}>
                        {pieData.map((entry, index) => (
                          <Cell key={index} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}
                        itemStyle={{ color: "hsl(var(--foreground))" }}
                      />
                      <Legend
                        formatter={(value) => <span className="text-xs text-muted-foreground">{value}</span>}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">
                    No webhook data yet
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-border/50 lg:col-span-2">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-500" />
                  <CardTitle className="text-base">Recent Failed Deliveries</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {!data.recentErrors.length ? (
                  <div className="py-12 text-center">
                    <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2 opacity-60" />
                    <p className="text-sm text-muted-foreground">No failed deliveries</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Endpoint</TableHead>
                        <TableHead>Merchant</TableHead>
                        <TableHead>HTTP</TableHead>
                        <TableHead>Time</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.recentErrors.map((err, i) => (
                        <TableRow key={i}>
                          <TableCell className="max-w-[180px]">
                            <span className="font-mono text-xs truncate block" title={err.url}>{err.url}</span>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {err.merchantName ?? "—"}
                          </TableCell>
                          <TableCell>
                            <Badge variant="destructive" className="font-mono text-xs">
                              {err.httpStatus ?? "ERR"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {format(new Date(err.createdAt), "MMM d, HH:mm")}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}
