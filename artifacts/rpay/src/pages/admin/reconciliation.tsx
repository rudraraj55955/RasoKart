import { useState } from "react";
import { useQueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { getToken } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { GitMerge, Play, ArrowRightLeft, AlertTriangle, CheckCircle2, Clock, RefreshCw, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow, format } from "date-fns";

async function apiPost(path: string, body: object) {
  const res = await fetch(`/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function apiGet(path: string) {
  const res = await fetch(`/api${path}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

const STATUS_META: Record<string, { label: string; className: string; icon: React.ReactNode }> = {
  running: {
    label: "Running",
    className: "bg-blue-500/10 text-blue-400 border-blue-500/30",
    icon: <RefreshCw className="w-3 h-3 animate-spin" />,
  },
  complete: {
    label: "Complete",
    className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
    icon: <CheckCircle2 className="w-3 h-3" />,
  },
  failed: {
    label: "Failed",
    className: "bg-red-500/10 text-red-400 border-red-500/30",
    icon: <AlertTriangle className="w-3 h-3" />,
  },
};

const ITEM_STATUS_META: Record<string, { label: string; className: string }> = {
  matched: { label: "Matched", className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" },
  unmatched_deposit: { label: "Unmatched Deposit", className: "bg-orange-500/10 text-orange-400 border-orange-500/30" },
  unmatched_settlement: { label: "Unmatched Settlement", className: "bg-red-500/10 text-red-400 border-red-500/30" },
};

function formatCurrency(v: number) {
  return `₹${v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function AdminReconciliation() {
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  const [dateFrom, setDateFrom] = useState(thirtyDaysAgo);
  const [dateTo, setDateTo] = useState(today);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [detailPage, setDetailPage] = useState(1);
  const [detailStatusFilter, setDetailStatusFilter] = useState("all");

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["/api/reconciliation/runs"],
    queryFn: () => apiGet("/reconciliation/runs?limit=20"),
    refetchInterval: 5000,
  });

  const detailQuery = useQuery({
    queryKey: ["/api/reconciliation/runs", selectedRunId, "items", detailPage, detailStatusFilter],
    queryFn: () => apiGet(`/reconciliation/runs/${selectedRunId}/items?limit=50&page=${detailPage}&status=${detailStatusFilter}`),
    enabled: !!selectedRunId,
  });

  const runMutation = useMutation({
    mutationFn: () => apiPost("/reconciliation/run", { dateFrom, dateTo }),
    onSuccess: () => {
      toast.success("Reconciliation run complete");
      qc.invalidateQueries({ queryKey: ["/api/reconciliation/runs"] });
      refetch();
    },
    onError: (err: any) => toast.error(`Run failed: ${err.message}`),
  });

  const runs = data?.data ?? [];
  const selectedRun = detailQuery.data?.run;
  const detailItems = detailQuery.data?.data ?? [];
  const detailTotal = detailQuery.data?.total ?? 0;
  const detailTotalPages = Math.max(1, Math.ceil(detailTotal / 50));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <GitMerge className="w-6 h-6 text-primary" />
            Reconciliation Engine
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Match deposits to settlements and flag discrepancies
          </p>
        </div>
      </div>

      {/* Run Trigger */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Run Reconciliation</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">From</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                className="w-40"
                max={dateTo}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">To</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                className="w-40"
                min={dateFrom}
                max={today}
              />
            </div>
            <Button
              onClick={() => runMutation.mutate()}
              disabled={!dateFrom || !dateTo || runMutation.isPending}
              className="gap-2"
            >
              {runMutation.isPending ? (
                <><RefreshCw className="w-4 h-4 animate-spin" /> Running…</>
              ) : (
                <><Play className="w-4 h-4" /> Run Now</>
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            Matches all successful deposits to approved/paid settlements in the selected period.
          </p>
        </CardContent>
      </Card>

      {/* Run History */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between">
            Run History
            <Button variant="ghost" size="sm" onClick={() => refetch()} className="h-7 gap-1.5 text-muted-foreground">
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="py-12 text-center text-muted-foreground text-sm">Loading…</div>
          ) : runs.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">
              No reconciliation runs yet. Run one above.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Run</th>
                    <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Period</th>
                    <th className="text-right px-4 py-2.5 text-xs text-muted-foreground font-medium">Deposits</th>
                    <th className="text-right px-4 py-2.5 text-xs text-muted-foreground font-medium">Matched</th>
                    <th className="text-right px-4 py-2.5 text-xs text-muted-foreground font-medium">Unmatched</th>
                    <th className="text-right px-4 py-2.5 text-xs text-muted-foreground font-medium">Matched Amt</th>
                    <th className="text-center px-4 py-2.5 text-xs text-muted-foreground font-medium">Status</th>
                    <th className="px-4 py-2.5"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {runs.map((run: any) => {
                    const meta = STATUS_META[run.status] ?? STATUS_META.complete;
                    return (
                      <tr key={run.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3">
                          <div className="font-medium">#{run.id}</div>
                          <div className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(run.createdAt), { addSuffix: true })}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                          {run.dateFrom} → {run.dateTo}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs">{run.totalDeposits}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs text-emerald-400">{run.totalMatched}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs text-orange-400">{run.totalUnmatched}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs">{formatCurrency(run.matchedAmount)}</td>
                        <td className="px-4 py-3 text-center">
                          <Badge className={`text-[10px] px-1.5 py-0 h-5 gap-1 border ${meta.className}`}>
                            {meta.icon}
                            {meta.label}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 gap-1 text-xs"
                            onClick={() => { setSelectedRunId(run.id); setDetailPage(1); setDetailStatusFilter("all"); }}
                          >
                            Details <ChevronRight className="w-3 h-3" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <Dialog open={!!selectedRunId} onOpenChange={open => !open && setSelectedRunId(null)}>
        <DialogContent className="max-w-5xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <GitMerge className="w-4 h-4 text-primary" />
              Run #{selectedRunId} — Reconciliation Details
            </DialogTitle>
          </DialogHeader>

          {selectedRun && (
            <div className="grid grid-cols-4 gap-3 pb-3 border-b border-border/50">
              {[
                { label: "Period", value: `${selectedRun.dateFrom} → ${selectedRun.dateTo}` },
                { label: "Matched", value: `${selectedRun.totalMatched} (${formatCurrency(selectedRun.matchedAmount)})`, highlight: "text-emerald-400" },
                { label: "Unmatched", value: `${selectedRun.totalUnmatched}`, highlight: "text-orange-400" },
                { label: "Status", value: STATUS_META[selectedRun.status]?.label ?? selectedRun.status },
              ].map(s => (
                <div key={s.label} className="rounded-md border border-border/50 bg-muted/20 px-3 py-2">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{s.label}</p>
                  <p className={`text-sm font-medium mt-0.5 ${s.highlight ?? ""}`}>{s.value}</p>
                </div>
              ))}
            </div>
          )}

          {/* Filter chips */}
          <div className="flex gap-2 flex-wrap">
            {["all", "matched", "unmatched_deposit", "unmatched_settlement"].map(f => (
              <button
                key={f}
                onClick={() => { setDetailStatusFilter(f); setDetailPage(1); }}
                className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                  detailStatusFilter === f
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border/60 text-muted-foreground hover:text-foreground"
                }`}
              >
                {f === "all" ? "All" : ITEM_STATUS_META[f]?.label ?? f}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto min-h-0">
            {detailQuery.isLoading ? (
              <div className="py-10 text-center text-muted-foreground text-sm">Loading items…</div>
            ) : detailItems.length === 0 ? (
              <div className="py-10 text-center text-muted-foreground text-sm">No items for this filter.</div>
            ) : (
              <div className="space-y-2">
                {detailItems.map((item: any) => {
                  const meta = ITEM_STATUS_META[item.status];
                  const isMatched = item.status === "matched";
                  return (
                    <div
                      key={item.id}
                      className={`rounded-md border p-3 text-sm ${
                        isMatched ? "border-emerald-500/20 bg-emerald-500/5" :
                        item.status === "unmatched_deposit" ? "border-orange-500/20 bg-orange-500/5" :
                        "border-red-500/20 bg-red-500/5"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <Badge className={`text-[10px] px-1.5 py-0 h-4 border shrink-0 ${meta?.className}`}>
                            {meta?.label}
                          </Badge>
                          <span className="text-muted-foreground text-xs truncate">
                            {item.merchantName ?? `Merchant #${item.merchantId}`}
                          </span>
                        </div>
                        <span className="font-mono text-sm font-medium shrink-0">{formatCurrency(item.amount)}</span>
                      </div>

                      {isMatched && item.transaction && item.settlement ? (
                        <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                          <div className="flex items-center gap-1.5 bg-muted/40 rounded px-2 py-1">
                            <ArrowRightLeft className="w-3 h-3 text-blue-400" />
                            <span>Deposit UTR: <span className="font-mono text-foreground">{item.transaction.utr}</span></span>
                          </div>
                          <span className="text-muted-foreground/40">↔</span>
                          <div className="flex items-center gap-1.5 bg-muted/40 rounded px-2 py-1">
                            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                            <span>Settlement #{item.settlement.id}
                              {item.settlement.referenceNumber ? ` · Ref: ${item.settlement.referenceNumber}` : ""}
                            </span>
                          </div>
                        </div>
                      ) : item.transaction ? (
                        <div className="mt-2 text-xs text-muted-foreground flex items-center gap-1.5">
                          <ArrowRightLeft className="w-3 h-3 text-orange-400" />
                          <span>Deposit UTR: <span className="font-mono text-foreground">{item.transaction.utr}</span></span>
                          {item.transaction.createdAt && (
                            <span className="text-muted-foreground/60">· {format(new Date(item.transaction.createdAt), "dd MMM yyyy")}</span>
                          )}
                        </div>
                      ) : item.settlement ? (
                        <div className="mt-2 text-xs text-muted-foreground flex items-center gap-1.5">
                          <Clock className="w-3 h-3 text-red-400" />
                          <span>Settlement #{item.settlement.id} ({item.settlement.status})</span>
                          {item.settlement.referenceNumber && (
                            <span>· Ref: {item.settlement.referenceNumber}</span>
                          )}
                        </div>
                      ) : null}

                      {item.notes && (
                        <p className="mt-1.5 text-xs text-muted-foreground/70">{item.notes}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {detailTotalPages > 1 && (
            <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t border-border/50">
              <span>Page {detailPage} of {detailTotalPages} · {detailTotal} items</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="h-7" disabled={detailPage <= 1} onClick={() => setDetailPage(p => p - 1)}>Prev</Button>
                <Button variant="outline" size="sm" className="h-7" disabled={detailPage >= detailTotalPages} onClick={() => setDetailPage(p => p + 1)}>Next</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
