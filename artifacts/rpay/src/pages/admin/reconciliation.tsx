import { useState, useEffect } from "react";
import { useQueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { getToken } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { GitMerge, Play, ArrowRightLeft, AlertTriangle, CheckCircle2, Clock, RefreshCw, ChevronRight, Link2, Zap, User, ShieldCheck, XCircle, Download, ChevronDown, Settings2, CalendarClock } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { useGetReconciliationScheduleConfig, useUpdateReconciliationScheduleConfig } from "@workspace/api-client-react";

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

async function apiPatch(path: string, body: object) {
  const res = await fetch(`/api${path}`, {
    method: "PATCH",
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
        <div className="bg-muted/40 rounded px-2 py-1.5 min-w-0">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Deposit</p>
          {item.transaction ? (
            <p className="font-mono text-xs text-foreground truncate">UTR: {item.transaction.utr}</p>
          ) : (
            <p className="text-xs text-muted-foreground/50">—</p>
          )}
        </div>
        <Link2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
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

function ResolvedCard({ item }: { item: any }) {
  const typeLabel =
    item.resolutionType === "linked_transaction" ? "Linked to Transaction"
    : item.resolutionType === "linked_settlement" ? "Linked to Settlement"
    : "Excluded";

  return (
    <div className="rounded-md border border-violet-500/20 bg-violet-500/5 p-3 text-sm">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <Badge className="text-[10px] px-1.5 py-0 h-4 border bg-violet-500/10 text-violet-400 border-violet-500/30 gap-1">
          <ShieldCheck className="w-2.5 h-2.5" /> Resolved
        </Badge>
        <span className="font-mono text-sm font-semibold">{formatCurrency(item.amount)}</span>
      </div>
      <p className="text-xs text-muted-foreground mb-1">{item.merchantName ?? `Merchant #${item.merchantId}`}</p>
      <p className="text-xs text-violet-300/80 font-medium mb-1">{typeLabel}</p>
      {item.resolutionType === "linked_transaction" && item.transaction && (
        <p className="text-xs text-muted-foreground font-mono">UTR: {item.transaction.utr}</p>
      )}
      {item.resolutionType === "linked_settlement" && item.settlement && (
        <p className="text-xs text-muted-foreground">
          Settlement #{item.settlement.id}
          {item.settlement.referenceNumber ? ` · ${item.settlement.referenceNumber}` : ""}
        </p>
      )}
      {item.resolutionNotes && (
        <p className="text-xs text-muted-foreground/60 mt-1 italic">"{item.resolutionNotes}"</p>
      )}
      {item.resolvedByEmail && (
        <p className="text-[10px] text-muted-foreground/40 mt-1">By {item.resolvedByEmail}</p>
      )}
    </div>
  );
}

type ResolutionType = "linked_transaction" | "linked_settlement" | "excluded";

interface ResolveDialogProps {
  item: any | null;
  onClose: () => void;
  onResolved: () => void;
}

function ResolveDialog({ item, onClose, onResolved }: ResolveDialogProps) {
  const [resolutionType, setResolutionType] = useState<ResolutionType>("excluded");
  const [linkedTransactionId, setLinkedTransactionId] = useState("");
  const [linkedSettlementId, setLinkedSettlementId] = useState("");
  const [resolutionNotes, setResolutionNotes] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      apiPatch(`/reconciliation/items/${item!.id}/resolve`, {
        resolutionType,
        linkedTransactionId: resolutionType === "linked_transaction" && linkedTransactionId ? parseInt(linkedTransactionId) : undefined,
        linkedSettlementId: resolutionType === "linked_settlement" && linkedSettlementId ? parseInt(linkedSettlementId) : undefined,
        resolutionNotes: resolutionNotes.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success("Item resolved successfully");
      onResolved();
      onClose();
    },
    onError: (err: any) => toast.error(`Failed to resolve: ${err.message}`),
  });

  const isDeposit = item?.status === "unmatched_deposit";

  const canSubmit =
    resolutionType === "excluded"
      ? true
      : resolutionType === "linked_transaction"
      ? !!linkedTransactionId
      : !!linkedSettlementId;

  if (!item) return null;

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="w-4 h-4 text-violet-400" />
            Resolve Unmatched Item
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Item summary */}
          <div className="rounded-md border border-border/50 bg-muted/20 px-3 py-2 text-sm">
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">
                {isDeposit ? "Unmatched Deposit" : "Unmatched Settlement"}
              </span>
              <span className="font-mono font-semibold">{formatCurrency(item.amount)}</span>
            </div>
            <p className="text-xs text-muted-foreground/60 mt-0.5">
              {item.merchantName ?? `Merchant #${item.merchantId}`}
            </p>
            {isDeposit && item.transaction?.utr && (
              <p className="text-xs text-muted-foreground/60 font-mono mt-0.5">UTR: {item.transaction.utr}</p>
            )}
            {!isDeposit && item.settlement && (
              <p className="text-xs text-muted-foreground/60 mt-0.5">Settlement #{item.settlement.id}</p>
            )}
          </div>

          {/* Resolution type */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Resolution Type</Label>
            <Select value={resolutionType} onValueChange={v => setResolutionType(v as ResolutionType)}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="linked_transaction">Link to Transaction ID</SelectItem>
                <SelectItem value="linked_settlement">Link to Settlement ID</SelectItem>
                <SelectItem value="excluded">Mark as Excluded</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Conditional ID input */}
          {resolutionType === "linked_transaction" && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Transaction ID</Label>
              <Input
                type="number"
                placeholder="e.g. 42"
                value={linkedTransactionId}
                onChange={e => setLinkedTransactionId(e.target.value)}
                className="h-9"
              />
              <p className="text-[10px] text-muted-foreground/60">
                Enter the numeric ID of the transaction to link this item to.
              </p>
            </div>
          )}

          {resolutionType === "linked_settlement" && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Settlement ID</Label>
              <Input
                type="number"
                placeholder="e.g. 7"
                value={linkedSettlementId}
                onChange={e => setLinkedSettlementId(e.target.value)}
                className="h-9"
              />
              <p className="text-[10px] text-muted-foreground/60">
                Enter the numeric ID of the settlement to link this item to.
              </p>
            </div>
          )}

          {resolutionType === "excluded" && (
            <div className="rounded-md border border-orange-500/20 bg-orange-500/5 px-3 py-2 text-xs text-orange-400/80">
              This item will be marked as intentionally excluded from matching.
            </div>
          )}

          {/* Notes */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Notes <span className="text-muted-foreground/40">(optional)</span></Label>
            <Textarea
              placeholder="Add a reason or note for this resolution…"
              value={resolutionNotes}
              onChange={e => setResolutionNotes(e.target.value)}
              className="h-20 resize-none text-sm"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1" onClick={onClose} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button
              className="flex-1 gap-2 bg-violet-600 hover:bg-violet-700 text-white"
              disabled={!canSubmit || mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending ? (
                <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Saving…</>
              ) : (
                <><ShieldCheck className="w-3.5 h-3.5" /> Resolve</>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function UnmatchedCard({ item, onResolve }: { item: any; onResolve: (item: any) => void }) {
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
      <div className="mt-2 flex justify-end">
        <Button
          size="sm"
          variant="outline"
          className="h-6 text-[11px] gap-1 border-violet-500/30 text-violet-400 hover:bg-violet-500/10 hover:text-violet-300"
          onClick={() => onResolve(item)}
        >
          <ShieldCheck className="w-3 h-3" /> Resolve
        </Button>
      </div>
    </div>
  );
}

function padTwo(n: number) {
  return String(n).padStart(2, "0");
}

function ScheduleSettingsCard() {
  const { data: config, isLoading: configLoading } = useGetReconciliationScheduleConfig();

  const [editing, setEditing] = useState(false);
  const [hour, setHour] = useState(0);
  const [minute, setMinute] = useState(0);
  const [lookbackDays, setLookbackDays] = useState(1);

  useEffect(() => {
    if (config) {
      setHour(config.hour);
      setMinute(config.minute);
      setLookbackDays(config.lookbackDays);
    }
  }, [config]);

  const { mutate: saveConfig, isPending: saving } = useUpdateReconciliationScheduleConfig({
    mutation: {
      onSuccess: () => {
        toast.success("Schedule settings saved — takes effect on the next run");
        setEditing(false);
      },
      onError: (err: any) => {
        toast.error(`Failed to save: ${err?.message ?? "Unknown error"}`);
      },
    },
  });

  const currentHour = config?.hour ?? 0;
  const currentMinute = config?.minute ?? 0;
  const currentLookback = config?.lookbackDays ?? 1;

  const scheduleLabel = `Daily at ${padTwo(currentHour)}:${padTwo(currentMinute)} server time`;
  const windowLabel = currentLookback === 1
    ? "lookback: yesterday"
    : `lookback: last ${currentLookback} days`;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between">
          <span className="flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-primary" />
            Schedule Settings
          </span>
          {!editing && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-muted-foreground"
              onClick={() => setEditing(true)}
              disabled={configLoading}
            >
              <Settings2 className="w-3.5 h-3.5" /> Configure
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!editing ? (
          <div className="space-y-3">
            {configLoading ? (
              <div className="text-sm text-muted-foreground">Loading…</div>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  <div className="rounded-md border border-border/50 bg-muted/20 px-3 py-2 min-w-[160px]">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Scheduled Time</p>
                    <p className="text-sm font-medium font-mono">{padTwo(currentHour)}:{padTwo(currentMinute)}</p>
                    <p className="text-[10px] text-muted-foreground/60">server time (24h)</p>
                  </div>
                  <div className="rounded-md border border-border/50 bg-muted/20 px-3 py-2 min-w-[160px]">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Lookback Window</p>
                    <p className="text-sm font-medium">{currentLookback} {currentLookback === 1 ? "day" : "days"}</p>
                    <p className="text-[10px] text-muted-foreground/60">{windowLabel}</p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Auto-reconciliation runs <span className="text-foreground font-medium">{scheduleLabel}</span>, covering the previous {currentLookback === 1 ? "day" : `${currentLookback} days`}.
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Run Hour <span className="text-muted-foreground/50">(0–23)</span></Label>
                <Input
                  type="number"
                  min={0}
                  max={23}
                  value={hour}
                  onChange={e => setHour(Math.min(23, Math.max(0, parseInt(e.target.value) || 0)))}
                  className="w-24"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Run Minute <span className="text-muted-foreground/50">(0–59)</span></Label>
                <Input
                  type="number"
                  min={0}
                  max={59}
                  value={minute}
                  onChange={e => setMinute(Math.min(59, Math.max(0, parseInt(e.target.value) || 0)))}
                  className="w-24"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Lookback Days <span className="text-muted-foreground/50">(1–90)</span></Label>
                <Input
                  type="number"
                  min={1}
                  max={90}
                  value={lookbackDays}
                  onChange={e => setLookbackDays(Math.min(90, Math.max(1, parseInt(e.target.value) || 1)))}
                  className="w-24"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              New schedule: <span className="text-foreground font-medium font-mono">{padTwo(hour)}:{padTwo(minute)}</span> daily,
              covering the previous <span className="text-foreground font-medium">{lookbackDays} {lookbackDays === 1 ? "day" : "days"}</span>.
              Changes take effect on the next scheduled run — no restart required.
            </p>
            <div className="flex gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditing(false);
                  if (config) {
                    setHour(config.hour);
                    setMinute(config.minute);
                    setLookbackDays(config.lookbackDays);
                  }
                }}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="gap-1.5"
                disabled={saving}
                onClick={() => saveConfig({ data: { hour, minute, lookbackDays } })}
              >
                {saving ? (
                  <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Saving…</>
                ) : (
                  <><CheckCircle2 className="w-3.5 h-3.5" /> Save Schedule</>
                )}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function AdminReconciliation() {
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  const [dateFrom, setDateFrom] = useState(thirtyDaysAgo);
  const [dateTo, setDateTo] = useState(today);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [resolveItem, setResolveItem] = useState<any | null>(null);
  const [exportFilter, setExportFilter] = useState<"all" | "matched" | "unmatched_deposit" | "unmatched_settlement">("all");
  const [csvExportFilter, setCsvExportFilter] = useState<"all" | "matched" | "unmatched">("all");

  const schedulerQuery = useQuery({
    queryKey: ["/api/reconciliation/scheduler-status"],
    queryFn: () => apiGet("/reconciliation/scheduler-status"),
    refetchInterval: 60000,
  });

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["/api/reconciliation/runs"],
    queryFn: () => apiGet("/reconciliation/runs?limit=20"),
    refetchInterval: 5000,
  });

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
  const resolvedItems = allItems.filter(i => i.status === "resolved");
  const unmatchedItems = allItems.filter(i => i.status !== "matched" && i.status !== "resolved");

  function handleResolved() {
    qc.invalidateQueries({ queryKey: ["/api/reconciliation/runs", selectedRunId, "items"] });
  }

  const schedulerStatus = schedulerQuery.data as {
    nextRunAt: string;
    cronExpression: string;
    hasEverRun: boolean;
    lastAutoRunAt: string | null;
    lastAutoRunStatus: string | null;
  } | undefined;

  function formatNextRun(isoStr: string): string {
    const next = new Date(isoStr);
    const now = new Date();
    const diffMs = next.getTime() - now.getTime();
    const diffHrs = diffMs / (1000 * 60 * 60);
    if (diffHrs < 1) {
      const mins = Math.round(diffMs / 60000);
      return `in ${mins} minute${mins !== 1 ? "s" : ""}`;
    }
    const hrs = Math.floor(diffHrs);
    const mins = Math.round((diffHrs - hrs) * 60);
    if (mins === 0) return `in ${hrs}h`;
    return `in ${hrs}h ${mins}m`;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <GitMerge className="w-6 h-6 text-primary" />
            Reconciliation Engine
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Match deposits to settlements and flag discrepancies
          </p>
        </div>
        {schedulerStatus && (() => {
          const lastRunFailed = schedulerStatus.lastAutoRunStatus === "failed";
          return (
            <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm shrink-0 ${
              lastRunFailed
                ? "border-destructive/50 bg-destructive/10"
                : "border-border/50 bg-muted/20"
            }`}>
              <span className="relative flex h-2 w-2">
                {lastRunFailed ? (
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-destructive" />
                ) : (
                  <>
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                  </>
                )}
              </span>
              <CalendarClock className={`w-3.5 h-3.5 ${lastRunFailed ? "text-destructive" : "text-muted-foreground"}`} />
              <div className="text-xs">
                {lastRunFailed ? (
                  <>
                    <span className="font-medium text-destructive">Last auto-run failed</span>
                    <span className="text-muted-foreground ml-1">— check notifications for details</span>
                    {schedulerStatus.lastAutoRunAt && (
                      <span className="text-muted-foreground/60 ml-1.5">
                        · {formatDistanceToNow(new Date(schedulerStatus.lastAutoRunAt), { addSuffix: true })}
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <span className="text-muted-foreground">Next auto-run: </span>
                    <span className="font-medium text-foreground">
                      {schedulerStatus.hasEverRun
                        ? `tonight at midnight (${formatNextRun(schedulerStatus.nextRunAt)})`
                        : `first run tonight at midnight (${formatNextRun(schedulerStatus.nextRunAt)})`}
                    </span>
                    {schedulerStatus.lastAutoRunAt && (
                      <span className="text-muted-foreground/60 ml-1.5">
                        · last ran {formatDistanceToNow(new Date(schedulerStatus.lastAutoRunAt), { addSuffix: true })}
                      </span>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })()}
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

      {/* Schedule Settings */}
      <ScheduleSettingsCard />

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
                    <th className="text-right px-4 py-2.5 text-xs text-muted-foreground font-medium">Unmatched Amt</th>
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
                          <div className="flex items-center gap-1.5 font-medium">
                            #{run.id}
                            {run.triggeredBy === "auto" ? (
                              <Badge className="text-[10px] px-1.5 py-0 h-4 border bg-violet-500/10 text-violet-400 border-violet-500/30 gap-1">
                                <Zap className="w-2.5 h-2.5" /> Auto
                              </Badge>
                            ) : (
                              <Badge className="text-[10px] px-1.5 py-0 h-4 border bg-sky-500/10 text-sky-400 border-sky-500/30 gap-1">
                                <User className="w-2.5 h-2.5" /> Manual
                              </Badge>
                            )}
                          </div>
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
                        <td className="px-4 py-3 text-right font-mono text-xs text-orange-400/80">{formatCurrency(run.unmatchedAmount)}</td>
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

      {/* Detail Dialog */}
      <Dialog 
        open={!!selectedRunId} 
        onOpenChange={open => {
          if (!open) {
            setSelectedRunId(null);
            setExportFilter("all");
            setCsvExportFilter("all");
          }
        }}
      >
        <DialogContent className="max-w-6xl max-h-[88vh] flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <GitMerge className="w-4 h-4 text-primary" />
              Run #{selectedRunId} — Reconciliation Details
              <div className="ml-auto flex items-center gap-2">
                {(() => {
                  const CSV_FILTER_LABELS: Record<string, string> = {
                    all: "All",
                    matched: "Matched only",
                    unmatched: "Unmatched only",
                  };
                  function doExport(filter: "all" | "matched" | "unmatched") {
                    const token = getToken();
                    const statusParam = filter !== "all" ? `?status=${filter}` : "";
                    const suffix = filter !== "all" ? `-${filter}` : "";
                    fetch(`/api/reconciliation/runs/${selectedRunId}/export.csv${statusParam}`, {
                      headers: { Authorization: `Bearer ${token}` },
                    })
                      .then(res => {
                        if (!res.ok) throw new Error("Export failed");
                        return res.blob();
                      })
                      .then(blob => {
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `reconciliation-run-${selectedRunId}${suffix}.csv`;
                        a.click();
                        URL.revokeObjectURL(url);
                      })
                      .catch(() => toast.error("Failed to export CSV"));
                  }
                  return (
                    <div className="flex items-center">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1.5 text-xs rounded-r-none border-r-0"
                        onClick={() => doExport(csvExportFilter)}
                      >
                        <Download className="w-3.5 h-3.5" />
                        Export CSV
                        {csvExportFilter !== "all" && (
                          <span className="text-primary/80">· {CSV_FILTER_LABELS[csvExportFilter]}</span>
                        )}
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-1.5 rounded-l-none border-l-0 text-muted-foreground"
                          >
                            <ChevronDown className="w-3.5 h-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          {(["all", "matched", "unmatched"] as const).map((f, idx, arr) => (
                            <div key={f}>
                              <DropdownMenuItem
                                className="text-xs gap-2"
                                onSelect={() => setCsvExportFilter(f)}
                              >
                                {csvExportFilter === f && (
                                  <CheckCircle2 className="w-3 h-3 text-primary shrink-0" />
                                )}
                                {csvExportFilter !== f && (
                                  <span className="w-3 shrink-0" />
                                )}
                                {CSV_FILTER_LABELS[f]}
                              </DropdownMenuItem>
                              {idx < arr.length - 1 && <DropdownMenuSeparator />}
                            </div>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  );
                })()}
              </div>
            </DialogTitle>
          </DialogHeader>

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

          {/* Filter Tabs */}
          <div className="flex flex-wrap gap-2">
            {[
              { id: "all", label: "All Items", count: allItems.length },
              { id: "matched", label: "Matched", count: matchedItems.length, color: "text-emerald-400" },
              { id: "unmatched_deposit", label: "Unmatched Deposits", count: allItems.filter(i => i.status === "unmatched_deposit").length, color: "text-orange-400" },
              { id: "unmatched_settlement", label: "Unmatched Settlements", count: allItems.filter(i => i.status === "unmatched_settlement").length, color: "text-red-400" },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setExportFilter(tab.id as any)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors ${
                  exportFilter === tab.id
                    ? "bg-primary/10 border-primary/30 text-primary"
                    : "bg-muted/30 border-border/50 text-muted-foreground hover:bg-muted/50"
                }`}
              >
                <span className={tab.color}>{tab.label}</span>
                <Badge variant="secondary" className="h-4 px-1 text-[10px] bg-muted/50">
                  {tab.count}
                </Badge>
              </button>
            ))}
          </div>

          {detailQuery.isLoading ? (
            <div className="py-10 text-center text-muted-foreground text-sm">Loading items…</div>
          ) : exportFilter !== "all" ? (
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {(() => {
                const filtered = allItems.filter(i => i.status === exportFilter);
                if (filtered.length === 0) {
                  return (
                    <div className="py-10 text-center text-muted-foreground text-xs border border-dashed border-border/40 rounded-md">
                      No items with status "{exportFilter}" in this run
                    </div>
                  );
                }
                return filtered.map((item: any) =>
                  item.status === "matched"
                    ? <MatchedPairCard key={item.id} item={item} />
                    : <UnmatchedCard key={item.id} item={item} onResolve={setResolveItem} />
                );
              })()}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1 overflow-hidden min-h-0 relative">
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

              {/* Right column — Unmatched + Resolved */}
              <div className="flex flex-col min-h-0">
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle className="w-4 h-4 text-orange-400" />
                  <h3 className="text-sm font-semibold">Unmatched Items</h3>
                  <Badge className="text-[10px] px-1.5 py-0 h-4 bg-orange-500/10 text-orange-400 border border-orange-500/30">
                    {unmatchedItems.length}
                  </Badge>
                  {resolvedItems.length > 0 && (
                    <Badge className="text-[10px] px-1.5 py-0 h-4 bg-violet-500/10 text-violet-400 border border-violet-500/30 gap-1 ml-1">
                      <ShieldCheck className="w-2.5 h-2.5" /> {resolvedItems.length} resolved
                    </Badge>
                  )}
                </div>
                <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                  {unmatchedItems.length === 0 && resolvedItems.length === 0 ? (
                    <div className="py-8 text-center text-muted-foreground text-xs border border-dashed border-border/40 rounded-md">
                      All items matched — no discrepancies
                    </div>
                  ) : (
                    <>
                      {unmatchedItems.map((item: any) => (
                        <UnmatchedCard key={item.id} item={item} onResolve={setResolveItem} />
                      ))}
                      {resolvedItems.length > 0 && (
                        <>
                          {unmatchedItems.length > 0 && (
                            <div className="flex items-center gap-2 my-2">
                              <div className="h-px flex-1 bg-border/40" />
                              <span className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">Resolved</span>
                              <div className="h-px flex-1 bg-border/40" />
                            </div>
                          )}
                          {resolvedItems.map((item: any) => (
                            <ResolvedCard key={item.id} item={item} />
                          ))}
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Resolve Dialog */}
      {resolveItem && (
        <ResolveDialog
          item={resolveItem}
          onClose={() => setResolveItem(null)}
          onResolved={handleResolved}
        />
      )}
    </div>
  );
}
