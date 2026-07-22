import { useState, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { getToken } from "@/lib/auth";
import {
  RefreshCw, TrendingUp, AlertTriangle, CheckCircle2, Clock,
  CreditCard, IndianRupee, RotateCcw, Shield, ExternalLink, Zap
} from "lucide-react";

const authHeader = () => ({ Authorization: `Bearer ${getToken()}` });

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

interface ErrorBreakdownRow {
  errorCode: string | null;
  count: number;
}

interface MethodBreakdownRow {
  method: string | null;
  count: number;
  volume: string;
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

function KpiCard({
  icon, label, value, sub, accent
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
}) {
  return (
    <Card className="border-border/50">
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs text-muted-foreground font-medium">{label}</p>
            <p className={cn("text-2xl font-bold mt-0.5 tracking-tight", accent)}>{value}</p>
            {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
          </div>
          <div className="text-muted-foreground/60 mt-0.5 shrink-0">{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}

const METHOD_LABELS: Record<string, string> = {
  upi:      "UPI",
  card:     "Card",
  netbanking: "Net Banking",
  wallet:   "Wallet",
  emi:      "EMI",
  paylater: "Pay Later",
};

export default function AdminRazorpayAnalytics() {
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [errorBreakdown, setErrorBreakdown] = useState<ErrorBreakdownRow[]>([]);
  const [methodBreakdown, setMethodBreakdown] = useState<MethodBreakdownRow[]>([]);
  const [settlement, setSettlement] = useState<Settlement | null>(null);
  const [razorpayX, setRazorpayX] = useState<RazorpayX | null>(null);
  const [loading, setLoading] = useState(true);
  const [xVerifying, setXVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [analyticsResp, settlementResp] = await Promise.all([
        fetch("/api/admin/razorpay/analytics", { headers: authHeader() }),
        fetch("/api/admin/razorpay/settlement-overview", { headers: authHeader() }),
      ]);

      if (analyticsResp.ok) {
        const j = await analyticsResp.json();
        setKpis(j.kpis ?? null);
        setErrorBreakdown(j.errorBreakdown ?? []);
        setMethodBreakdown(j.methodBreakdown ?? []);
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

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleXVerify = async () => {
    setXVerifying(true);
    try {
      const resp = await fetch("/api/admin/razorpay/razorpayx/verify", { headers: authHeader() });
      if (resp.ok) {
        const j = await resp.json();
        setRazorpayX({
          verificationStatus: j.activated ? "pass" : (j.keyConfigured ? "fail" : "not_configured"),
          verifiedAt: j.verifiedAt,
          activated: j.activated,
        });
      }
    } finally {
      setXVerifying(false);
    }
  };

  const fmtInr = (v: string | null | undefined) =>
    v == null ? "—" : `₹${parseFloat(v).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

  return (
    <div className="flex flex-col gap-6 p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Razorpay Analytics</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Error mapping, transaction analytics, settlement overview, and RazorpayX status
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchAll} disabled={loading} className="shrink-0">
          <RefreshCw className={cn("w-4 h-4 mr-1.5", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {error && (
        <Card className="border-red-500/20 bg-red-500/5">
          <CardContent className="py-4 text-sm text-red-400">{error}</CardContent>
        </Card>
      )}

      {/* KPI cards */}
      {loading
        ? <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-24 rounded-xl bg-muted/40 animate-pulse" />
            ))}
          </div>
        : kpis && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiCard icon={<TrendingUp className="w-5 h-5" />}    label="Total Attempts"   value={kpis.totalAttempts.toLocaleString()} />
              <KpiCard icon={<CheckCircle2 className="w-5 h-5" />}  label="Successful"       value={kpis.successful.toLocaleString()} accent="text-emerald-400" sub={`${kpis.successRate}% success rate`} />
              <KpiCard icon={<AlertTriangle className="w-5 h-5" />} label="Failed"           value={kpis.failed.toLocaleString()} accent="text-red-400" />
              <KpiCard icon={<Clock className="w-5 h-5" />}         label="Pending"          value={kpis.pending.toLocaleString()} accent="text-amber-400" />
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiCard icon={<IndianRupee className="w-5 h-5" />}   label="Total Volume"     value={fmtInr(kpis.totalVolumeInr)} accent="text-cyan-400" />
              <KpiCard icon={<CreditCard className="w-5 h-5" />}    label="Avg Transaction"  value={fmtInr(kpis.avgTransactionValue)} />
              <KpiCard icon={<RotateCcw className="w-5 h-5" />}     label="Refunds Issued"   value={kpis.refundCount.toLocaleString()} accent="text-violet-400" sub={fmtInr(kpis.refundAmount)} />
              <KpiCard icon={<TrendingUp className="w-5 h-5" />}    label="Success Rate"     value={`${kpis.successRate}%`} accent={kpis.successRate >= 80 ? "text-emerald-400" : kpis.successRate >= 60 ? "text-amber-400" : "text-red-400"} />
            </div>
          </>
        )
      }

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Error breakdown */}
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400" /> Error Breakdown
            </CardTitle>
            <CardDescription className="text-xs">Top failure reason codes from Razorpay</CardDescription>
          </CardHeader>
          <CardContent>
            {loading
              ? <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-8 bg-muted/40 rounded animate-pulse" />)}</div>
              : errorBreakdown.length === 0
              ? <p className="text-sm text-muted-foreground py-6 text-center">No error data yet — errors appear here once Razorpay payments fail.</p>
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
            <CardDescription className="text-xs">Transaction counts and captured volume by method</CardDescription>
          </CardHeader>
          <CardContent>
            {loading
              ? <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-8 bg-muted/40 rounded animate-pulse" />)}</div>
              : methodBreakdown.length === 0
              ? <p className="text-sm text-muted-foreground py-6 text-center">No payment method data yet. Appears once Razorpay payments are processed.</p>
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

      {/* Settlement Overview + RazorpayX */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Settlement */}
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <IndianRupee className="w-4 h-4 text-emerald-400" /> Settlement Overview
            </CardTitle>
            <CardDescription className="text-xs">
              Cached settlement data — updated when Razorpay settlement webhooks arrive
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading
              ? <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-8 bg-muted/40 rounded animate-pulse" />)}</div>
              : !settlement || Object.values(settlement).every(v => v === null)
              ? (
                <div className="py-6 text-center space-y-2">
                  <p className="text-sm text-muted-foreground">No settlement data available yet.</p>
                  <p className="text-xs text-muted-foreground/70">
                    Settlement data is populated automatically when Razorpay sends settlement webhook events.
                    Ensure the <code className="bg-muted px-1 rounded text-[10px]">settlement.processed</code> webhook is enabled in your Razorpay dashboard.
                  </p>
                </div>
              )
              : (
                <div className="space-y-2.5">
                  {[
                    { label: "Yesterday",       val: fmtInr(settlement.yesterdayAmount) },
                    { label: "Today Pending",    val: fmtInr(settlement.todayAmount) },
                    { label: "Next Settlement",  val: settlement.nextDate ?? "—" },
                    { label: "Balance",          val: fmtInr(settlement.balance) },
                    { label: "Last UTR",         val: settlement.lastUtr ?? "—" },
                    { label: "Last Updated",     val: settlement.lastUpdatedAt ? new Date(settlement.lastUpdatedAt).toLocaleString("en-IN") : "—" },
                  ].map(({ label, val }) => (
                    <div key={label} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="font-mono font-medium">{val}</span>
                    </div>
                  ))}
                </div>
              )
            }
          </CardContent>
        </Card>

        {/* RazorpayX */}
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Zap className="w-4 h-4 text-violet-400" /> RazorpayX Payout Verification
            </CardTitle>
            <CardDescription className="text-xs">
              Verify if RazorpayX Payouts API is activated on this Razorpay account
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
                        Checked: {new Date(razorpayX.verifiedAt).toLocaleString("en-IN")}
                      </p>
                    )}
                  </div>
                </div>

                {!razorpayX.activated && razorpayX.verificationStatus !== "not_configured" && (
                  <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2.5 text-xs text-amber-400/90 leading-relaxed">
                    RazorpayX requires separate account activation. Contact Razorpay support to enable the Payouts API, or set
                    <code className="bg-muted mx-1 px-1 rounded">RAZORPAY_X_KEY_ID</code> and
                    <code className="bg-muted mx-1 px-1 rounded">RAZORPAY_X_SECRET</code> environment variables.
                  </div>
                )}

                {!razorpayX.activated && razorpayX.verificationStatus === "not_configured" && (
                  <div className="rounded-lg border border-zinc-700/40 bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground leading-relaxed">
                    Set <code className="bg-muted mx-1 px-1 rounded">RAZORPAY_X_KEY_ID</code> and
                    <code className="bg-muted mx-1 px-1 rounded">RAZORPAY_X_SECRET</code> as environment secrets to enable verification.
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground py-2">
                Run a verification check to probe the RazorpayX Payouts API.
              </p>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={handleXVerify}
              disabled={xVerifying}
              className="w-full"
            >
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
    </div>
  );
}
