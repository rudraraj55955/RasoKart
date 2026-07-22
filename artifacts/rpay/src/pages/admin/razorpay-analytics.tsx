import { useState, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { getToken } from "@/lib/auth";
import {
  RefreshCw, TrendingUp, AlertTriangle, CheckCircle2, Clock,
  CreditCard, IndianRupee, RotateCcw, Shield, ExternalLink, Zap,
  ChevronDown, ChevronUp, CalendarDays,
} from "lucide-react";

const authHeader = () => ({ Authorization: `Bearer ${getToken()}` });

// ── types ─────────────────────────────────────────────────────────────────────

interface Kpis {
  totalAttempts: number;
  successful: number;
  failed: number;
  pending: number;
  successRate: number;
  totalVolumeInr: string;
  avgTransactionValue: string;
  refundCount: number;
  refundAmount: string;
}

interface ErrorBreakdownRow { errorCode: string | null; count: number; }
interface MethodBreakdownRow { method: string | null; count: number; volume: string; }
interface DailyBucket { day: string; count: number; vol: string; }

interface Order {
  id: number;
  internalOrderId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string | null;
  merchantId: number;
  amount: string;
  status: string;
  paymentMethod: string | null;
  errorCode: string | null;
  utr: string | null;
  paidAt: string | null;
  createdAt: string;
}

interface Settlement {
  yesterdayAmount: string | null;
  todayAmount: string | null;
  nextDate: string | null;
  balance: string | null;
  lastUtr: string | null;
  lastUpdatedAt: string | null;
}

interface RazorpayX {
  verificationStatus: string;
  verifiedAt: string | null;
  activated: boolean;
}

// ── constants ─────────────────────────────────────────────────────────────────

const PERIODS = [
  { label: "7 Days",  value: "7d"  },
  { label: "30 Days", value: "30d" },
  { label: "90 Days", value: "90d" },
  { label: "All Time", value: "all" },
] as const;
type Period = typeof PERIODS[number]["value"];

const METHOD_LABELS: Record<string, string> = {
  upi: "UPI", card: "Card", netbanking: "Net Banking",
  wallet: "Wallet", emi: "EMI", paylater: "Pay Later",
};

const STATUS_COLORS: Record<string, string> = {
  CAPTURED: "text-emerald-400",
  FAILED:   "text-red-400",
  PENDING:  "text-amber-400",
  CREATED:  "text-amber-400",
  REFUNDED: "text-violet-400",
};

// ── helpers ───────────────────────────────────────────────────────────────────

const fmtInr = (v: string | null | undefined) =>
  v == null ? "—" : `₹${parseFloat(v).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

const fmtDate = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" }) : "—";

// ── KpiCard ───────────────────────────────────────────────────────────────────

function KpiCard({
  icon, label, value, sub, accent, active, onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <Card
      className={cn(
        "border-border/50 transition-all",
        onClick && "cursor-pointer hover:border-primary/40 hover:bg-muted/30",
        active && "border-primary/60 bg-primary/5 ring-1 ring-primary/20",
      )}
      onClick={onClick}
    >
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs text-muted-foreground font-medium">{label}</p>
            <p className={cn("text-2xl font-bold mt-0.5 tracking-tight", accent)}>{value}</p>
            {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className="text-muted-foreground/60 mt-0.5 shrink-0">{icon}</div>
            {onClick && (active
              ? <ChevronUp className="w-3 h-3 text-primary/60" />
              : <ChevronDown className="w-3 h-3 text-muted-foreground/40" />
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── OrderDrillDown ─────────────────────────────────────────────────────────────

function OrderDrillDown({
  statusFilter, period, label,
}: { statusFilter: string | null; period: Period; label: string }) {
  const [orders, setOrders]   = useState<Order[]>([]);
  const [total, setTotal]     = useState(0);
  const [page, setPage]       = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const fetchOrders = useCallback(async (p: number) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(p), limit: "10" });
      if (statusFilter) params.set("status", statusFilter);
      const resp = await fetch(`/api/admin/razorpay/orders?${params}`, { headers: authHeader() });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json() as { data: Order[]; total: number };
      setOrders(json.data ?? []);
      setTotal(json.total ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load orders");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    setPage(1);
    fetchOrders(1);
  }, [statusFilter, period, fetchOrders]);

  const totalPages = Math.ceil(total / 10);

  return (
    <Card className="border-primary/20 bg-primary/[0.02]">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">
            {label} — Transaction Detail
            <Badge variant="outline" className="ml-2 text-[10px] font-normal">{total.toLocaleString()} records</Badge>
          </CardTitle>
          {loading && <RefreshCw className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
        </div>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="text-sm text-red-400 py-2">{error}</p>
        ) : orders.length === 0 && !loading ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No {label.toLowerCase()} orders in this period.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted-foreground border-b border-border/30">
                    <th className="text-left pb-2 font-medium pr-3">Internal ID</th>
                    <th className="text-left pb-2 font-medium pr-3">Amount</th>
                    <th className="text-left pb-2 font-medium pr-3">Status</th>
                    <th className="text-left pb-2 font-medium pr-3">Method</th>
                    <th className="text-left pb-2 font-medium pr-3">Merchant</th>
                    <th className="text-left pb-2 font-medium">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/20">
                  {orders.map(o => (
                    <tr key={o.id} className="hover:bg-muted/20">
                      <td className="py-2 pr-3 font-mono text-[11px] text-muted-foreground truncate max-w-[140px]" title={o.internalOrderId}>
                        {o.internalOrderId}
                      </td>
                      <td className="py-2 pr-3 font-mono text-emerald-400">{fmtInr(o.amount)}</td>
                      <td className="py-2 pr-3">
                        <span className={cn("font-semibold", STATUS_COLORS[o.status] ?? "text-muted-foreground")}>
                          {o.status}
                        </span>
                      </td>
                      <td className="py-2 pr-3 capitalize text-muted-foreground">
                        {METHOD_LABELS[o.paymentMethod ?? ""] ?? o.paymentMethod ?? "—"}
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground">{o.merchantId}</td>
                      <td className="py-2 text-muted-foreground">{fmtDate(o.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/20">
                <span className="text-xs text-muted-foreground">Page {page} of {totalPages}</span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1 || loading}
                    onClick={() => { const p = page - 1; setPage(p); fetchOrders(p); }}>
                    Previous
                  </Button>
                  <Button variant="outline" size="sm" disabled={page >= totalPages || loading}
                    onClick={() => { const p = page + 1; setPage(p); fetchOrders(p); }}>
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── main page ─────────────────────────────────────────────────────────────────

export default function AdminRazorpayAnalytics() {
  const [period, setPeriod]         = useState<Period>("30d");
  const [kpis, setKpis]             = useState<Kpis | null>(null);
  const [errorBreakdown, setErrorBreakdown] = useState<ErrorBreakdownRow[]>([]);
  const [methodBreakdown, setMethodBreakdown] = useState<MethodBreakdownRow[]>([]);
  const [dailyBuckets, setDailyBuckets] = useState<DailyBucket[]>([]);
  const [settlement, setSettlement] = useState<Settlement | null>(null);
  const [razorpayX, setRazorpayX]   = useState<RazorpayX | null>(null);
  const [loading, setLoading]       = useState(true);
  const [xVerifying, setXVerifying] = useState(false);
  const [error, setError]           = useState<string | null>(null);
  // KPI drill-down: which card is expanded
  const [activeDrill, setActiveDrill] = useState<{ status: string | null; label: string } | null>(null);

  const fetchAll = useCallback(async (p: Period) => {
    setLoading(true);
    setError(null);
    try {
      const [analyticsResp, settlementResp] = await Promise.all([
        fetch(`/api/admin/razorpay/analytics?period=${p}`, { headers: authHeader() }),
        fetch("/api/admin/razorpay/settlement-overview", { headers: authHeader() }),
      ]);

      if (analyticsResp.ok) {
        const j = await analyticsResp.json();
        setKpis(j.kpis ?? null);
        setErrorBreakdown(j.errorBreakdown ?? []);
        setMethodBreakdown(j.methodBreakdown ?? []);
        setDailyBuckets(j.dailyBuckets ?? []);
      } else {
        throw new Error(`Analytics HTTP ${analyticsResp.status}`);
      }

      if (settlementResp.ok) {
        const j = await settlementResp.json();
        setSettlement(j.settlement ?? null);
        setRazorpayX(j.razorpayx ?? null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(period); }, [period, fetchAll]);

  const handleXVerify = async () => {
    setXVerifying(true);
    try {
      const resp = await fetch("/api/admin/razorpay/razorpayx/verify", { headers: authHeader() });
      if (resp.ok) {
        const j = await resp.json();
        setRazorpayX({
          verificationStatus: j.activated ? "pass" : (j.keyConfigured ? "fail" : "not_configured"),
          verifiedAt: j.checkedAt ?? null,
          activated: j.activated,
        });
      }
    } finally {
      setXVerifying(false);
    }
  };

  const handleKpiClick = (status: string | null, label: string) => {
    setActiveDrill(prev =>
      prev?.status === status ? null : { status, label }
    );
  };

  // Sparkline: simple bar chart from dailyBuckets
  const maxBucketCount = Math.max(1, ...dailyBuckets.map(b => b.count));

  return (
    <div className="flex flex-col gap-6 p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Razorpay Analytics</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Transaction KPIs, error mapping, settlement overview, and RazorpayX verification
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Period selector */}
          <div className="flex items-center gap-1 bg-muted/40 rounded-lg p-1 border border-border/30">
            <CalendarDays className="w-3.5 h-3.5 text-muted-foreground ml-1 shrink-0" />
            {PERIODS.map(p => (
              <button
                key={p.value}
                onClick={() => { setPeriod(p.value); setActiveDrill(null); }}
                className={cn(
                  "text-xs px-2.5 py-1 rounded-md transition-all font-medium",
                  period === p.value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={() => fetchAll(period)} disabled={loading}>
            <RefreshCw className={cn("w-4 h-4 mr-1.5", loading && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-red-500/20 bg-red-500/5">
          <CardContent className="py-4 flex items-center gap-2 text-sm text-red-400">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {error}
          </CardContent>
        </Card>
      )}

      {/* KPI cards — clickable for drill-down */}
      {loading
        ? <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-24 rounded-xl bg-muted/40 animate-pulse" />
            ))}
          </div>
        : kpis
        ? (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiCard
                icon={<TrendingUp className="w-5 h-5" />}
                label="Total Attempts"
                value={kpis.totalAttempts.toLocaleString()}
                active={activeDrill?.status === null && activeDrill?.label === "All"}
                onClick={() => handleKpiClick(null, "All")}
              />
              <KpiCard
                icon={<CheckCircle2 className="w-5 h-5" />}
                label="Successful"
                value={kpis.successful.toLocaleString()}
                accent="text-emerald-400"
                sub={`${kpis.successRate}% success rate`}
                active={activeDrill?.status === "CAPTURED"}
                onClick={() => handleKpiClick("CAPTURED", "Successful")}
              />
              <KpiCard
                icon={<AlertTriangle className="w-5 h-5" />}
                label="Failed"
                value={kpis.failed.toLocaleString()}
                accent="text-red-400"
                active={activeDrill?.status === "FAILED"}
                onClick={() => handleKpiClick("FAILED", "Failed")}
              />
              <KpiCard
                icon={<Clock className="w-5 h-5" />}
                label="Pending"
                value={kpis.pending.toLocaleString()}
                accent="text-amber-400"
                active={activeDrill?.status === "PENDING"}
                onClick={() => handleKpiClick("PENDING", "Pending")}
              />
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiCard
                icon={<IndianRupee className="w-5 h-5" />}
                label="Total Volume"
                value={fmtInr(kpis.totalVolumeInr)}
                accent="text-cyan-400"
              />
              <KpiCard
                icon={<CreditCard className="w-5 h-5" />}
                label="Avg Transaction"
                value={fmtInr(kpis.avgTransactionValue)}
              />
              <KpiCard
                icon={<RotateCcw className="w-5 h-5" />}
                label="Refunds Issued"
                value={kpis.refundCount.toLocaleString()}
                accent="text-violet-400"
                sub={fmtInr(kpis.refundAmount)}
                active={activeDrill?.status === "REFUNDED"}
                onClick={() => handleKpiClick("REFUNDED", "Refunded")}
              />
              <KpiCard
                icon={<TrendingUp className="w-5 h-5" />}
                label="Success Rate"
                value={`${kpis.successRate}%`}
                accent={kpis.successRate >= 80 ? "text-emerald-400" : kpis.successRate >= 60 ? "text-amber-400" : "text-red-400"}
              />
            </div>

            {/* Drill-down panel */}
            {activeDrill && (
              <OrderDrillDown
                statusFilter={activeDrill.status}
                period={period}
                label={activeDrill.label}
              />
            )}
          </>
        )
        : (
          <Card className="border-border/50">
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No Razorpay transaction data available yet. Transactions will appear once orders are processed.
            </CardContent>
          </Card>
        )
      }

      {/* Sparkline — daily transaction counts */}
      {!loading && dailyBuckets.length > 0 && (
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-cyan-400" /> Daily Activity
            </CardTitle>
            <CardDescription className="text-xs">
              Transaction count per day for the selected period
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-1 h-16">
              {dailyBuckets.map(b => (
                <div key={b.day} className="flex-1 flex flex-col items-center gap-1 min-w-0 group relative">
                  <div
                    className="w-full bg-cyan-500/40 rounded-sm hover:bg-cyan-500/70 transition-colors"
                    style={{ height: `${Math.max(4, Math.round((b.count / maxBucketCount) * 56))}px` }}
                    title={`${b.day}: ${b.count} txns, ${fmtInr(b.vol)} captured`}
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-between mt-1.5">
              <span className="text-[10px] text-muted-foreground/60">{dailyBuckets[0]?.day ?? ""}</span>
              <span className="text-[10px] text-muted-foreground/60">{dailyBuckets[dailyBuckets.length - 1]?.day ?? ""}</span>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Error breakdown */}
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400" /> Error Breakdown
            </CardTitle>
            <CardDescription className="text-xs">Top failure reason codes from Razorpay — {PERIODS.find(p => p.value === period)?.label ?? period}</CardDescription>
          </CardHeader>
          <CardContent>
            {loading
              ? <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-8 bg-muted/40 rounded animate-pulse" />)}</div>
              : errorBreakdown.length === 0
              ? <p className="text-sm text-muted-foreground py-6 text-center">No error data for this period. Errors appear here once Razorpay payments fail.</p>
              : (
                <div className="space-y-2">
                  {errorBreakdown.map((e, i) => {
                    const maxCount = errorBreakdown[0]?.count ?? 1;
                    const pct = Math.round((e.count / maxCount) * 100);
                    return (
                      <div key={i} className="flex items-center gap-3">
                        <span className="text-xs font-mono text-muted-foreground w-40 truncate" title={e.errorCode ?? ""}>{e.errorCode ?? "(unknown)"}</span>
                        <div className="flex-1 bg-muted rounded-full h-1.5 overflow-hidden">
                          <div className="bg-red-500/70 h-full rounded-full transition-all" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs text-muted-foreground tabular-nums w-6 text-right">{e.count}</span>
                      </div>
                    );
                  })}
                </div>
              )
            }
          </CardContent>
        </Card>

        {/* Method breakdown */}
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-cyan-400" /> Payment Method Breakdown
            </CardTitle>
            <CardDescription className="text-xs">Transaction counts and captured volume by method — {PERIODS.find(p => p.value === period)?.label ?? period}</CardDescription>
          </CardHeader>
          <CardContent>
            {loading
              ? <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-8 bg-muted/40 rounded animate-pulse" />)}</div>
              : methodBreakdown.length === 0
              ? <p className="text-sm text-muted-foreground py-6 text-center">No payment method data for this period.</p>
              : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted-foreground border-b border-border/30">
                      <th className="text-left pb-2 font-medium">Method</th>
                      <th className="text-right pb-2 font-medium">Count</th>
                      <th className="text-right pb-2 font-medium">Volume</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/20">
                    {methodBreakdown.map((m, i) => (
                      <tr key={i}>
                        <td className="py-2 font-medium capitalize">{METHOD_LABELS[m.method ?? ""] ?? m.method ?? "Unknown"}</td>
                        <td className="py-2 text-right tabular-nums text-muted-foreground">{m.count.toLocaleString()}</td>
                        <td className="py-2 text-right tabular-nums text-cyan-400">{fmtInr(m.volume)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            }
          </CardContent>
        </Card>
      </div>

      {/* Settlement Overview */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <IndianRupee className="w-4 h-4 text-emerald-400" /> Settlement Overview
              </CardTitle>
              <CardDescription className="text-xs mt-0.5">
                Live cached data — updated automatically when Razorpay fires <code className="bg-muted px-1 rounded">settlement.processed</code> webhooks
              </CardDescription>
            </div>
            {settlement?.lastUpdatedAt && (
              <span className="text-[10px] text-muted-foreground/60 shrink-0 text-right">
                Last updated<br />{fmtDate(settlement.lastUpdatedAt)}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loading
            ? <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-16 rounded-lg bg-muted/40 animate-pulse" />)}
              </div>
            : !settlement || Object.values(settlement).every(v => v === null)
            ? (
              <div className="py-8 text-center space-y-2">
                <IndianRupee className="w-8 h-8 text-muted-foreground/30 mx-auto" />
                <p className="text-sm text-muted-foreground font-medium">No settlement data yet</p>
                <p className="text-xs text-muted-foreground/70 max-w-sm mx-auto">
                  Settlement data populates automatically when Razorpay sends{" "}
                  <code className="bg-muted px-1 rounded text-[10px]">settlement.processed</code> webhook events.
                  Ensure the webhook is enabled in your{" "}
                  <a href="https://dashboard.razorpay.com/app/webhooks" target="_blank" rel="noopener noreferrer"
                    className="text-primary hover:underline">Razorpay Dashboard</a>.
                </p>
              </div>
            )
            : (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {[
                  { label: "Yesterday Settled", val: fmtInr(settlement.yesterdayAmount), accent: "text-emerald-400" },
                  { label: "Today Pending",     val: fmtInr(settlement.todayAmount),     accent: "text-amber-400" },
                  { label: "Next Settlement",   val: settlement.nextDate ? new Date(settlement.nextDate).toLocaleDateString("en-IN") : "—", accent: "" },
                  { label: "Balance",           val: fmtInr(settlement.balance),          accent: "text-cyan-400" },
                  { label: "Last UTR",          val: settlement.lastUtr ?? "—",           accent: "text-muted-foreground font-mono text-xs" },
                ].map(({ label, val, accent }) => (
                  <div key={label} className="rounded-lg bg-muted/20 border border-border/20 px-4 py-3">
                    <p className="text-xs text-muted-foreground mb-1">{label}</p>
                    <p className={cn("font-semibold text-sm", accent || "text-foreground")}>{val}</p>
                  </div>
                ))}
              </div>
            )
          }
        </CardContent>
      </Card>

      {/* RazorpayX Payout Verification */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Zap className="w-4 h-4 text-violet-400" /> RazorpayX Payout Verification
          </CardTitle>
          <CardDescription className="text-xs">
            Probe the RazorpayX Payouts API to verify activation status for this account
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {razorpayX ? (
            <>
              <div className="flex items-center gap-3">
                {razorpayX.activated
                  ? <CheckCircle2 className="w-8 h-8 text-emerald-400 shrink-0" />
                  : razorpayX.verificationStatus === "not_configured"
                  ? <Shield className="w-8 h-8 text-zinc-500 shrink-0" />
                  : <AlertTriangle className="w-8 h-8 text-amber-400 shrink-0" />
                }
                <div>
                  <p className={cn("font-semibold text-sm",
                    razorpayX.activated ? "text-emerald-400"
                    : razorpayX.verificationStatus === "not_configured" ? "text-zinc-500"
                    : "text-amber-400"
                  )}>
                    {razorpayX.activated ? "RazorpayX is Active"
                      : razorpayX.verificationStatus === "not_configured" ? "Credentials Not Configured"
                      : "RazorpayX Not Activated"}
                  </p>
                  {razorpayX.verifiedAt && (
                    <p className="text-xs text-muted-foreground">
                      Last checked: {fmtDate(razorpayX.verifiedAt)}
                    </p>
                  )}
                </div>
              </div>

              {!razorpayX.activated && razorpayX.verificationStatus !== "not_configured" && (
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2.5 text-xs text-amber-400/90 leading-relaxed">
                  RazorpayX requires separate account activation. Contact Razorpay support to enable the Payouts API.
                  Also ensure <code className="bg-muted mx-1 px-1 rounded">RAZORPAY_X_KEY_ID</code> and{" "}
                  <code className="bg-muted mx-1 px-1 rounded">RAZORPAY_X_SECRET</code> are set as environment secrets.
                </div>
              )}

              {!razorpayX.activated && razorpayX.verificationStatus === "not_configured" && (
                <div className="rounded-lg border border-zinc-700/40 bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground leading-relaxed">
                  Set <code className="bg-muted mx-1 px-1 rounded">RAZORPAY_X_KEY_ID</code> and{" "}
                  <code className="bg-muted mx-1 px-1 rounded">RAZORPAY_X_SECRET</code> as environment secrets to enable verification.
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground py-2">
              Run a verification check to probe the RazorpayX Payouts API.
            </p>
          )}

          <Button variant="outline" size="sm" onClick={handleXVerify} disabled={xVerifying} className="w-full">
            <Shield className={cn("w-4 h-4 mr-1.5", xVerifying && "animate-pulse")} />
            {xVerifying ? "Verifying..." : "Run RazorpayX Verification"}
          </Button>

          <a
            href="https://razorpay.com/docs/razorpayx/payouts/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            RazorpayX Payout Docs <ExternalLink className="w-3 h-3" />
          </a>
        </CardContent>
      </Card>
    </div>
  );
}
