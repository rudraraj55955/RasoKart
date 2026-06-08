import { useState } from "react";
import { useQueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { getToken } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { GitMerge, Play, ArrowRightLeft, AlertTriangle, CheckCircle2, Clock, RefreshCw, ChevronRight, Link2 } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

async function apiPost(path: string, body: object) {
  const res = await fetch(`/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    let msg = text;
    try { msg = JSON.parse(text).error ?? text; } catch {}
    throw new Error(msg);
  }
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

function formatCurrency(v: number | string) {
  return `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function MatchedPairCard({ item }: { item: any }) {
  return (
    <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-3 text-sm">
      <div className="flex items-center justify-between gap-2 mb-2">
        <Badge className="text-[10px] px-1.5 py-0 h-4 border bg-emerald-500/10 text-emerald-400 border-emerald-500/30 gap-1">
          <CheckCircle2 className="w-2.5 h-2.5" /> Matched
        </Badge>
        <span className="font-mono text-sm font-semibold">{formatCurrency(item.amount)}</span>
      </div>
      <p className="text-xs text-muted-foreground mb-2">{item.merchantName ?? `Merchant #${item.merchantId}`}</p>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        {/* Deposit side */}
        <div className="bg-muted/40 rounded px-2 py-1.5 min-w-0">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Deposit</p>
          {item.transaction ? (
            <p className="font-mono text-xs text-foreground truncate">UTR: {item.transaction.utr}</p>
          ) : (
            <p className="text-xs text-muted-foreground/50">—</p>
          )}
        </div>
        {/* Link icon */}
        <Link2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
        {/* Settlement side */}
        <div className="bg-muted/40 rounded px-2 py-1.5 min-w-0">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Settlement</p>
          {item.settlement ? (
            <p className="font-mono text-xs text-foreground truncate">
              #{item.settlement.id}
              {item.settlement.referenceNumber ? ` · ${item.settlement.referenceNumber}` : ""}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground/50">—</p>
          )}
        </div>
      </div>
    </div>
  );
}

function UnmatchedCard({ item }: { item: any }) {
  const isDeposit = item.status === "unmatched_deposit";
  return (
    <div className={`rounded-md border p-3 text-sm ${
      isDeposit
        ? "border-orange-500/20 bg-orange-500/5"
        : "border-red-500/20 bg-red-500/5"
    }`}>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <Badge className={`text-[10px] px-1.5 py-0 h-4 border gap-1 ${
          isDeposit
            ? "bg-orange-500/10 text-orange-400 border-orange-500/30"
            : "bg-red-500/10 text-red-400 border-red-500/30"
        }`}>
          {isDeposit ? <ArrowRightLeft className="w-2.5 h-2.5" /> : <Clock className="w-2.5 h-2.5" />}
          {isDeposit ? "Unmatched Deposit" : "Unmatched Settlement"}
        </Badge>
        <span className="font-mono text-sm font-semibold">{formatCurrency(item.amount)}</span>
      </div>
      <p className="text-xs text-muted-foreground mb-1.5">{item.merchantName ?? `Merchant #${item.merchantId}`}</p>
      {isDeposit && item.transaction ? (
        <p className="text-xs text-muted-foreground font-mono">UTR: {item.transaction.utr}</p>
      ) : !isDeposit && item.settlement ? (
        <p className="text-xs text-muted-foreground">
          Settlement #{item.settlement.id} · {item.settlement.status}
          {item.settlement.referenceNumber ? ` · Ref: ${item.settlement.referenceNumber}` : ""}
        </p>
      ) : null}
      {item.notes && <p className="text-xs text-muted-foreground/60 mt-1">{item.notes}</p>}
    </div>
  );
}

export default function AdminReconciliation() {
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  const [dateFrom, setDateFrom] = useState(thirtyDaysAgo);
  const [dateTo, setDateTo] = useState(today);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["/api/reconciliation/runs"],
    queryFn: () => apiGet("/reconciliation/runs?limit=20"),
    refetchInterval: 5000,
  });

  // Fetch ALL items for the detail view (up to 200) — split client-side into columns
  const detailQuery = useQuery({
    queryKey: ["/api/reconciliation/runs", selectedRunId, "items"],
    queryFn: () => apiGet(`/reconciliation/runs/${selectedRunId}/items?limit=200`),
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
  const allItems: any[] = detailQuery.data?.data ?? [];

  const matchedItems = allItems.filter(i => i.status === "matched");
  const unmatchedItems = allItems.filter(i => i.status !== "matched");

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
            Matches successful deposits to approved/paid settlements. Settlements with period bounds are matched by overlap; others by creation date.
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
                            onClick={() => setSelectedRunId(run.id)}
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

      {/* Detail Dialog — two-column: matched pairs | unmatched items */}
      <Dialog open={!!selectedRunId} onOpenChange={open => !open && setSelectedRunId(null)}>
        <DialogContent className="max-w-6xl max-h-[88vh] flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <GitMerge className="w-4 h-4 text-primary" />
              Run #{selectedRunId} — Reconciliation Details
            </DialogTitle>
          </DialogHeader>

          {/* Run summary */}
          {selectedRun && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 border-b border-border/50 pb-4">
              {[
                { label: "Period", value: `${selectedRun.dateFrom} → ${selectedRun.dateTo}` },
                {
                  label: "Matched",
                  value: `${selectedRun.totalMatched} items · ${formatCurrency(selectedRun.matchedAmount)}`,
                  highlight: "text-emerald-400",
                },
                {
                  label: "Unmatched",
                  value: `${selectedRun.totalUnmatched} items · ${formatCurrency(selectedRun.unmatchedAmount)}`,
                  highlight: "text-orange-400",
                },
                { label: "Status", value: STATUS_META[selectedRun.status]?.label ?? selectedRun.status },
              ].map(s => (
                <div key={s.label} className="rounded-md border border-border/50 bg-muted/20 px-3 py-2">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{s.label}</p>
                  <p className={`text-sm font-medium mt-0.5 ${s.highlight ?? ""}`}>{s.value}</p>
                </div>
              ))}
            </div>
          )}

          {/* Two-column body */}
          {detailQuery.isLoading ? (
            <div className="py-10 text-center text-muted-foreground text-sm">Loading items…</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1 overflow-hidden min-h-0">
              {/* Left column — Matched pairs */}
              <div className="flex flex-col min-h-0">
                <div className="flex items-center gap-2 mb-3">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-sm font-semibold">Matched Pairs</h3>
                  <Badge className="text-[10px] px-1.5 py-0 h-4 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 ml-auto">
                    {matchedItems.length}
                  </Badge>
                </div>
                <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                  {matchedItems.length === 0 ? (
                    <div className="py-8 text-center text-muted-foreground text-xs border border-dashed border-border/40 rounded-md">
                      No matched pairs in this run
                    </div>
                  ) : (
                    matchedItems.map((item: any) => (
                      <MatchedPairCard key={item.id} item={item} />
                    ))
                  )}
                </div>
              </div>

              {/* Divider */}
              <div className="hidden md:block absolute left-1/2 top-0 bottom-0 w-px bg-border/40 pointer-events-none" aria-hidden />

              {/* Right column — Unmatched items */}
              <div className="flex flex-col min-h-0">
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle className="w-4 h-4 text-orange-400" />
                  <h3 className="text-sm font-semibold">Unmatched Items</h3>
                  <Badge className="text-[10px] px-1.5 py-0 h-4 bg-orange-500/10 text-orange-400 border border-orange-500/30 ml-auto">
                    {unmatchedItems.length}
                  </Badge>
                </div>
                <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                  {unmatchedItems.length === 0 ? (
                    <div className="py-8 text-center text-muted-foreground text-xs border border-dashed border-border/40 rounded-md">
                      All items matched — no discrepancies
                    </div>
                  ) : (
                    unmatchedItems.map((item: any) => (
                      <UnmatchedCard key={item.id} item={item} />
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
