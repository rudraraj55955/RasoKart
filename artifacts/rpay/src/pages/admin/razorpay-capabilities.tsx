import { useState, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { getToken } from "@/lib/auth";
import { RefreshCw, CheckCircle2, AlertCircle, Clock, ExternalLink, Shield, Info, Search, XCircle } from "lucide-react";

const authHeader = () => ({ Authorization: `Bearer ${getToken()}` });

interface CapabilityProduct {
  id: number;
  productKey: string;
  providerKey: string | null;
  publicName: string;
  description: string | null;
  isEnabled: boolean;
  capabilityStatus: string | null;
  officialApiAvailable: boolean | null;
  officialSdkAvailable: boolean | null;
  testModeStatus: string | null;
  liveModeStatus: string | null;
  webhookSupport: boolean | null;
  webhookEvents: string[] | null;
  approvalRequired: boolean | null;
  approvalReason: string | null;
  merchantAccess: boolean | null;
  customerFacingModule: boolean | null;
  implNotes: string | null;
  docsUrl: string | null;
  lastTestAt: string | null;
  lastFailAt: string | null;
  failureReason: string | null;
  sortOrder: number;
}

interface Summary {
  total: number;
  CONFIGURED?: number;
  TESTED?: number;
  LIVE?: number;
  DISABLED?: number;
  APPROVAL_REQUIRED?: number;
  VERIFICATION_REQUIRED?: number;
  DASHBOARD_ONLY?: number;
  NOT_SUPPORTED_BY_API?: number;
  ERROR?: number;
  UNCHECKED?: number;
  [key: string]: number | undefined;
}

const STATUS_META: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  LIVE:                  { label: "Live",                 color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20", icon: <CheckCircle2 className="w-3 h-3" /> },
  TESTED:                { label: "Tested",               color: "text-blue-400 bg-blue-500/10 border-blue-500/20",         icon: <CheckCircle2 className="w-3 h-3" /> },
  CONFIGURED:            { label: "Configured",           color: "text-cyan-400 bg-cyan-500/10 border-cyan-500/20",         icon: <CheckCircle2 className="w-3 h-3" /> },
  APPROVAL_REQUIRED:     { label: "Approval Required",    color: "text-amber-400 bg-amber-500/10 border-amber-500/20",      icon: <Clock className="w-3 h-3" /> },
  VERIFICATION_REQUIRED: { label: "Verification Required",color: "text-orange-400 bg-orange-500/10 border-orange-500/20",  icon: <Shield className="w-3 h-3" /> },
  DASHBOARD_ONLY:        { label: "Dashboard Only",       color: "text-violet-400 bg-violet-500/10 border-violet-500/20",  icon: <Info className="w-3 h-3" /> },
  NOT_SUPPORTED_BY_API:  { label: "No Public API",        color: "text-zinc-400 bg-zinc-500/10 border-zinc-500/20",        icon: <XCircle className="w-3 h-3" /> },
  DISABLED:              { label: "Disabled",             color: "text-red-400 bg-red-500/10 border-red-500/20",           icon: <XCircle className="w-3 h-3" /> },
  ERROR:                 { label: "Error",                color: "text-red-500 bg-red-500/15 border-red-500/30",           icon: <AlertCircle className="w-3 h-3" /> },
  UNCHECKED:             { label: "Unchecked",            color: "text-zinc-500 bg-zinc-800/60 border-zinc-700/30",        icon: <Info className="w-3 h-3" /> },
};

function StatusBadge({ status }: { status: string | null }) {
  const key = status ?? "UNCHECKED";
  const meta = STATUS_META[key] ?? STATUS_META["UNCHECKED"]!;
  return (
    <span className={cn("inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border", meta.color)}>
      {meta.icon}
      {meta.label}
    </span>
  );
}

function BoolDot({ val }: { val: boolean | null | undefined }) {
  if (val === null || val === undefined) return <span className="text-zinc-600 text-xs">—</span>;
  return val
    ? <span className="inline-block w-2 h-2 rounded-full bg-emerald-400" title="Yes" />
    : <span className="inline-block w-2 h-2 rounded-full bg-zinc-600" title="No" />;
}

const SUMMARY_ORDER: { key: string; label: string }[] = [
  { key: "LIVE",                  label: "Live" },
  { key: "TESTED",                label: "Tested" },
  { key: "CONFIGURED",            label: "Configured" },
  { key: "APPROVAL_REQUIRED",     label: "Approval Required" },
  { key: "VERIFICATION_REQUIRED", label: "Verification Required" },
  { key: "DASHBOARD_ONLY",        label: "Dashboard Only" },
  { key: "NOT_SUPPORTED_BY_API",  label: "No Public API" },
  { key: "DISABLED",              label: "Disabled" },
  { key: "ERROR",                 label: "Error" },
  { key: "UNCHECKED",             label: "Unchecked" },
];

export default function AdminRazorpayCapabilities() {
  const [products, setProducts] = useState<CapabilityProduct[]>([]);
  const [summary, setSummary] = useState<Summary>({ total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch("/api/admin/razorpay/capabilities", { headers: authHeader() });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      setProducts(json.products ?? []);
      setSummary(json.summary ?? { total: 0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load capabilities");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = products.filter(p => {
    const matchesSearch = !search ||
      p.publicName.toLowerCase().includes(search.toLowerCase()) ||
      p.productKey.toLowerCase().includes(search.toLowerCase()) ||
      (p.implNotes ?? "").toLowerCase().includes(search.toLowerCase());
    const matchesStatus = filterStatus === "all" || (p.capabilityStatus ?? "UNCHECKED") === filterStatus;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="flex flex-col gap-6 p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Razorpay Capability Audit</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Official Razorpay product matrix — API availability, approval gates, and implementation status
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchData} disabled={loading} className="shrink-0">
          <RefreshCw className={cn("w-4 h-4 mr-1.5", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {/* Summary Strip */}
      {!loading && !error && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {SUMMARY_ORDER.filter(s => (summary[s.key] ?? 0) > 0).map(s => {
            const meta = STATUS_META[s.key];
            return (
              <button
                key={s.key}
                onClick={() => setFilterStatus(f => f === s.key ? "all" : s.key)}
                className={cn(
                  "rounded-lg border px-3 py-2.5 text-left transition-all",
                  filterStatus === s.key
                    ? "ring-2 ring-offset-1 ring-offset-background ring-current " + meta?.color
                    : "border-border bg-card hover:border-border/80",
                )}
              >
                <div className={cn("text-xs font-medium mb-0.5", meta?.color.split(" ")[0])}>
                  {s.label}
                </div>
                <div className="text-xl font-bold">{summary[s.key] ?? 0}</div>
              </button>
            );
          })}
          <button
            onClick={() => setFilterStatus("all")}
            className={cn(
              "rounded-lg border px-3 py-2.5 text-left transition-all",
              filterStatus === "all" ? "border-primary bg-primary/10" : "border-border bg-card hover:border-border/80",
            )}
          >
            <div className="text-xs font-medium mb-0.5 text-muted-foreground">Total Products</div>
            <div className="text-xl font-bold">{summary.total}</div>
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 items-center">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search products..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
        {filterStatus !== "all" && (
          <Button variant="ghost" size="sm" onClick={() => setFilterStatus("all")} className="text-xs">
            <XCircle className="w-3.5 h-3.5 mr-1" /> Clear filter
          </Button>
        )}
        <span className="text-xs text-muted-foreground ml-auto">{filtered.length} of {products.length} shown</span>
      </div>

      {/* Error */}
      {error && (
        <Card className="border-red-500/20 bg-red-500/5">
          <CardContent className="py-4 text-sm text-red-400">{error}</CardContent>
        </Card>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 rounded-lg bg-muted/40 animate-pulse" />
          ))}
        </div>
      )}

      {/* Capability Table */}
      {!loading && !error && (
        <Card className="overflow-hidden border-border/50">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-left">
                  <th className="px-4 py-3 font-medium text-muted-foreground w-52">Product</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground">Status</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground text-center">Official API</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground text-center">SDK</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground text-center">Webhooks</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground text-center">Approval</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground text-center">Merchant</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground">Test Mode</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground">Live Mode</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground min-w-[220px]">Notes</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground">Docs</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={11} className="px-4 py-12 text-center text-muted-foreground text-sm">
                      No products match your filter.
                    </td>
                  </tr>
                )}
                {filtered.map(p => (
                  <tr key={p.productKey} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-sm leading-snug">{p.publicName}</div>
                      <div className="text-[10px] text-muted-foreground font-mono mt-0.5 truncate max-w-[180px]">{p.productKey}</div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <StatusBadge status={p.capabilityStatus} />
                    </td>
                    <td className="px-4 py-3 text-center"><BoolDot val={p.officialApiAvailable} /></td>
                    <td className="px-4 py-3 text-center"><BoolDot val={p.officialSdkAvailable} /></td>
                    <td className="px-4 py-3 text-center"><BoolDot val={p.webhookSupport} /></td>
                    <td className="px-4 py-3 text-center">
                      {p.approvalRequired
                        ? <span className="text-amber-400 text-xs font-semibold">Required</span>
                        : <BoolDot val={p.approvalRequired === false ? false : null} />
                      }
                    </td>
                    <td className="px-4 py-3 text-center"><BoolDot val={p.merchantAccess} /></td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {p.testModeStatus ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {p.liveModeStatus ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground leading-relaxed max-w-[240px]">
                      {p.implNotes ?? (p.approvalReason ?? "—")}
                    </td>
                    <td className="px-4 py-3">
                      {p.docsUrl
                        ? <a href={p.docsUrl} target="_blank" rel="noopener noreferrer"
                             className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                            Docs <ExternalLink className="w-3 h-3" />
                          </a>
                        : <span className="text-muted-foreground text-xs">—</span>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Webhook events panel — only when a product is hovered/clicked */}
      {!loading && !error && filtered.some(p => p.webhookEvents && Array.isArray(p.webhookEvents) && p.webhookEvents.length > 0) && (
        <Card className="border-border/40">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Webhook Events by Product</CardTitle>
            <CardDescription className="text-xs">All Razorpay webhook event types tracked per product</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.filter(p => Array.isArray(p.webhookEvents) && (p.webhookEvents as string[]).length > 0).map(p => (
              <div key={p.productKey}>
                <div className="text-xs font-semibold text-foreground mb-1.5">{p.publicName}</div>
                <div className="flex flex-wrap gap-1">
                  {(p.webhookEvents as string[]).map(ev => (
                    <span key={ev} className="text-[10px] font-mono bg-muted px-1.5 py-0.5 rounded border border-border/50 text-muted-foreground">
                      {ev}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
