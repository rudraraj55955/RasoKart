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
import { GitMerge, Play, ArrowRightLeft, AlertTriangle, CheckCircle2, Clock, RefreshCw, ChevronRight, ChevronLeft, Link2, Zap, User, ShieldCheck, XCircle, Download, ChevronDown, Settings2, CalendarClock, PauseCircle, Loader2, Mail, MailX, MailCheck } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { useGetReconciliationScheduleConfig, useUpdateReconciliationScheduleConfig, useGetReconciliationNextRun } from "@workspace/api-client-react";

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

function formatRunDuration(start: Date, end: Date): string {
  const ms = end.getTime() - start.getTime();
  if (ms < 0) return "—";
  const totalSecs = ms / 1000;
  if (totalSecs < 60) return `${totalSecs.toFixed(1)}s`;
  const mins = Math.floor(totalSecs / 60);
  const secs = Math.round(totalSecs % 60);
  return `${mins}m ${secs}s`;
}

function padTwo(n: number) {
  return String(n).padStart(2, "0");
}

/**
 * Given a scheduled hour/minute in the server's IANA timezone, returns the
 * equivalent local time string (e.g. "08:00 AM") for the browser's timezone.
 * Returns null if the timezone is invalid or conversion fails.
 */
function serverTimeToLocalDisplay(hour: number, minute: number, serverTz: string): string | null {
  try {
    const hm = serverTimeToLocalHM(hour, minute, serverTz);
    if (!hm) return null;
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hm.hour, hm.minute);
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return null;
  }
}

/**
 * Converts server-time hour/minute (in serverTz) to the browser's local hour/minute.
 * Returns null on failure.
 */
function serverTimeToLocalHM(hour: number, minute: number, serverTz: string): { hour: number; minute: number } | null {
  try {
    const now = new Date();
    const todayInServerTz = new Intl.DateTimeFormat("en-CA", { timeZone: serverTz }).format(now);
    const naiveUTC = new Date(`${todayInServerTz}T${padTwo(hour)}:${padTwo(minute)}:00Z`);
    const serverParts = new Intl.DateTimeFormat("en-US", {
      timeZone: serverTz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(naiveUTC);
    const actualServerHour = parseInt(serverParts.find((p) => p.type === "hour")?.value ?? "0");
    const actualServerMinute = parseInt(serverParts.find((p) => p.type === "minute")?.value ?? "0");
    const intendedMs = (hour * 60 + minute) * 60000;
    const actualMs = (actualServerHour * 60 + actualServerMinute) * 60000;
    const correctedUTC = new Date(naiveUTC.getTime() + (intendedMs - actualMs));
    const localParts = new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(correctedUTC);
    return {
      hour: parseInt(localParts.find((p) => p.type === "hour")?.value ?? "0") % 24,
      minute: parseInt(localParts.find((p) => p.type === "minute")?.value ?? "0"),
    };
  } catch {
    return null;
  }
}

/**
 * Converts local-time hour/minute (browser timezone) to the server's IANA timezone hour/minute.
 * Returns null on failure.
 */
function localTimeToServerHM(localHour: number, localMinute: number, serverTz: string): { hour: number; minute: number } | null {
  try {
    const now = new Date();
    const localDateStr = `${now.getFullYear()}-${padTwo(now.getMonth() + 1)}-${padTwo(now.getDate())}T${padTwo(localHour)}:${padTwo(localMinute)}:00`;
    const d = new Date(localDateStr);
    const serverParts = new Intl.DateTimeFormat("en-US", {
      timeZone: serverTz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(d);
    return {
      hour: parseInt(serverParts.find((p) => p.type === "hour")?.value ?? "0") % 24,
      minute: parseInt(serverParts.find((p) => p.type === "minute")?.value ?? "0"),
    };
  } catch {
    return null;
  }
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

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function formatCountdown(targetMs: number, nowMs: number): string {
  const diffMs = targetMs - nowMs;
  if (diffMs <= 0) return "now";
  const totalSecs = Math.floor(diffMs / 1000);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

function ScheduleSettingsCard() {
  const qc = useQueryClient();
  const { data: config, isLoading: configLoading } = useGetReconciliationScheduleConfig();
  const { data: nextRunData } = useGetReconciliationNextRun();
  const now = useNow(1000);

  const [editing, setEditing] = useState(false);
  const [localTimeStr, setLocalTimeStr] = useState("00:00");
  const [lookbackDays, setLookbackDays] = useState(1);
  const [lookbackPreset, setLookbackPreset] = useState<"1" | "3" | "7" | "30" | "custom">("1");
  const [enabled, setEnabled] = useState(true);

  function syncLookback(days: number) {
    setLookbackDays(days);
    setLookbackPreset([1, 3, 7, 30].includes(days) ? (String(days) as "1" | "3" | "7" | "30") : "custom");
  }

  const tz = nextRunData?.serverTimezone ?? null;

  useEffect(() => {
    if (config) {
      if (tz) {
        const local = serverTimeToLocalHM(config.hour, config.minute, tz);
        setLocalTimeStr(local ? `${padTwo(local.hour)}:${padTwo(local.minute)}` : `${padTwo(config.hour)}:${padTwo(config.minute)}`);
      } else {
        setLocalTimeStr(`${padTwo(config.hour)}:${padTwo(config.minute)}`);
      }
      syncLookback(config.lookbackDays);
      setEnabled(config.enabled);
    }
  }, [config, tz]);

  const { mutate: saveConfig, isPending: saving } = useUpdateReconciliationScheduleConfig({
    mutation: {
      onSuccess: () => {
        toast.success("Schedule settings saved — takes effect on the next run");
        setEditing(false);
        qc.invalidateQueries({ queryKey: ["/api/system-config/reconciliation/next-run"] });
        qc.invalidateQueries({ queryKey: ["/api/system-config/reconciliation"] });
      },
      onError: (err: any) => {
        toast.error(`Failed to save: ${err?.message ?? "Unknown error"}`);
      },
    },
  });

  const currentHour = config?.hour ?? 0;
  const currentMinute = config?.minute ?? 0;
  const currentLookback = config?.lookbackDays ?? 1;
  const currentEnabled = config?.enabled ?? true;

  const serverTz = tz;
  const localEquivalent = serverTz ? serverTimeToLocalDisplay(currentHour, currentMinute, serverTz) : null;
  const tzDiffers = serverTz !== null && serverTz !== Intl.DateTimeFormat().resolvedOptions().timeZone;

  const editLocalTimeParts = localTimeStr.split(":").map(Number);
  const editLocalHour = editLocalTimeParts[0] ?? 0;
  const editLocalMinute = editLocalTimeParts[1] ?? 0;
  const editServerEquivalent = (() => {
    if (!serverTz || !localTimeStr) return null;
    const s = localTimeToServerHM(editLocalHour, editLocalMinute, serverTz);
    return s ? { hour: s.hour, minute: s.minute } : null;
  })();
  const editTzDiffers = serverTz !== null && serverTz !== Intl.DateTimeFormat().resolvedOptions().timeZone;

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
                <div className="flex items-center justify-between rounded-md border border-border/50 bg-muted/20 px-3 py-2">
                  <div className="flex items-center gap-2">
                    {currentEnabled ? (
                      <CalendarClock className="w-3.5 h-3.5 text-green-500" />
                    ) : (
                      <PauseCircle className="w-3.5 h-3.5 text-amber-500" />
                    )}
                    <span className="text-sm font-medium">
                      {currentEnabled ? "Auto-reconciliation enabled" : "Auto-reconciliation paused"}
                    </span>
                  </div>
                  <Badge variant={currentEnabled ? "default" : "secondary"} className="text-[10px]">
                    {currentEnabled ? "Active" : "Paused"}
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-2">
                  <div className="rounded-md border border-border/50 bg-muted/20 px-3 py-2 min-w-[160px]">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Scheduled Time</p>
                    <p className={`text-sm font-medium font-mono ${!currentEnabled ? "text-muted-foreground/60" : ""}`}>{padTwo(currentHour)}:{padTwo(currentMinute)}</p>
                    {tz && <p className="text-[10px] text-muted-foreground/60">{tz}</p>}
                    {localEquivalent && tzDiffers && (
                      <p className="text-[10px] text-primary/70 mt-0.5">= {localEquivalent} your time</p>
                    )}
                  </div>
                  <div className="rounded-md border border-border/50 bg-muted/20 px-3 py-2 min-w-[160px]">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Lookback Window</p>
                    <p className={`text-sm font-medium ${!currentEnabled ? "text-muted-foreground/60" : ""}`}>{currentLookback} {currentLookback === 1 ? "day" : "days"}</p>
                    <p className="text-[10px] text-muted-foreground/60">{windowLabel}</p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {currentEnabled
                    ? <>
                        Auto-reconciliation runs{" "}
                        <span className="text-foreground font-medium">{scheduleLabel}</span>
                        {localEquivalent && tzDiffers && (
                          <span className="text-primary/70"> ({localEquivalent} your time)</span>
                        )}
                        , covering the previous {currentLookback === 1 ? "day" : `${currentLookback} days`}.
                      </>
                    : "The scheduler is paused and will not run until re-enabled."}
                </p>
                {nextRunData?.nextRunAt && (
                  <div className="flex items-center gap-1.5 text-xs text-emerald-400/80">
                    <Clock className="w-3 h-3 shrink-0" />
                    <span>
                      Next run in{" "}
                      <span className="font-medium text-emerald-400 tabular-nums">
                        {formatCountdown(new Date(nextRunData.nextRunAt).getTime(), now)}
                      </span>
                      <span className="text-muted-foreground/60 ml-1">
                        ({new Date(nextRunData.nextRunAt).toLocaleString(undefined, {
                          month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
                        })} local)
                      </span>
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-md border border-border/50 bg-muted/20 px-3 py-2.5">
              <Switch
                id="recon-enabled"
                checked={enabled}
                onCheckedChange={setEnabled}
                disabled={saving}
              />
              <div>
                <Label htmlFor="recon-enabled" className="text-sm font-medium cursor-pointer">
                  {enabled ? "Scheduler enabled" : "Scheduler paused"}
                </Label>
                <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                  {enabled ? "Runs will execute on schedule" : "Scheduled runs will be skipped"}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Run Time <span className="text-muted-foreground/50">(your local time)</span></Label>
                <Input
                  type="time"
                  value={localTimeStr}
                  onChange={e => setLocalTimeStr(e.target.value)}
                  className="w-32"
                  disabled={saving}
                />
                {editTzDiffers && editServerEquivalent && (
                  <p className="text-[10px] text-primary/70">
                    = {padTwo(editServerEquivalent.hour)}:{padTwo(editServerEquivalent.minute)} server time ({serverTz})
                  </p>
                )}
                {!editTzDiffers && serverTz && (
                  <p className="text-[10px] text-muted-foreground/50">server timezone matches yours</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Lookback Window</Label>
                <Select
                  value={lookbackPreset}
                  onValueChange={(v) => {
                    const val = v as "1" | "3" | "7" | "30" | "custom";
                    setLookbackPreset(val);
                    if (val !== "custom") setLookbackDays(parseInt(val));
                  }}
                  disabled={saving}
                >
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Yesterday (1 day)</SelectItem>
                    <SelectItem value="3">Last 3 days</SelectItem>
                    <SelectItem value="7">Last 7 days</SelectItem>
                    <SelectItem value="30">Last 30 days</SelectItem>
                    <SelectItem value="custom">Custom…</SelectItem>
                  </SelectContent>
                </Select>
                {lookbackPreset === "custom" && (
                  <Input
                    type="number"
                    min={1}
                    max={90}
                    value={lookbackDays}
                    onChange={e => setLookbackDays(Math.min(90, Math.max(1, parseInt(e.target.value) || 1)))}
                    className="w-24 mt-1.5"
                    placeholder="1–90"
                    disabled={saving}
                  />
                )}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {enabled
                ? <>
                    New schedule: daily at{" "}
                    <span className="text-foreground font-medium font-mono">{localTimeStr}</span>
                    {" "}your local time
                    {editTzDiffers && editServerEquivalent && (
                      <> (<span className="text-primary/70 font-mono">{padTwo(editServerEquivalent.hour)}:{padTwo(editServerEquivalent.minute)}</span> server time)</>
                    )}
                    , covering the previous <span className="text-foreground font-medium">{lookbackDays} {lookbackDays === 1 ? "day" : "days"}</span>. Changes take effect on the next scheduled run.
                  </>
                : "The scheduler is paused. Scheduled runs will be skipped until re-enabled."}
            </p>
            <div className="flex gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditing(false);
                  if (config) {
                    const tzLocal = tz;
                    if (tzLocal) {
                      const local = serverTimeToLocalHM(config.hour, config.minute, tzLocal);
                      setLocalTimeStr(local ? `${padTwo(local.hour)}:${padTwo(local.minute)}` : `${padTwo(config.hour)}:${padTwo(config.minute)}`);
                    } else {
                      setLocalTimeStr(`${padTwo(config.hour)}:${padTwo(config.minute)}`);
                    }
                    syncLookback(config.lookbackDays);
                    setEnabled(config.enabled);
                  }
                }}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="gap-1.5"
                disabled={saving || !localTimeStr}
                onClick={() => {
                  const [lh, lm] = localTimeStr.split(":").map(Number);
                  let serverH = lh, serverM = lm;
                  if (serverTz) {
                    const converted = localTimeToServerHM(lh, lm, serverTz);
                    if (converted) { serverH = converted.hour; serverM = converted.minute; }
                  }
                  saveConfig({ data: { hour: serverH, minute: serverM, lookbackDays, enabled } });
                }}
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
  const [isExporting, setIsExporting] = useState(false);
  const [emailLogOpen, setEmailLogOpen] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [emailFailureBannerDismissed, setEmailFailureBannerDismissed] = useState(false);
  const HISTORY_PAGE_SIZE = 15;

  const schedulerQuery = useQuery({
    queryKey: ["/api/reconciliation/scheduler-status"],
    queryFn: () => apiGet("/reconciliation/scheduler-status"),
    refetchInterval: 60000,
  });

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["/api/reconciliation/runs", historyPage, HISTORY_PAGE_SIZE],
    queryFn: () => apiGet(`/reconciliation/runs?page=${historyPage}&limit=${HISTORY_PAGE_SIZE}`),
    refetchInterval: 5000,
  });

  const detailQuery = useQuery({
    queryKey: ["/api/reconciliation/runs", selectedRunId, "items"],
    queryFn: () => apiGet(`/reconciliation/runs/${selectedRunId}/items?limit=200`),
    enabled: !!selectedRunId,
  });

  const emailLogsQuery = useQuery({
    queryKey: ["/api/reconciliation/runs", selectedRunId, "email-logs"],
    queryFn: () => apiGet(`/reconciliation/runs/${selectedRunId}/email-logs`),
    enabled: !!selectedRunId,
  });

  const runMutation = useMutation({
    mutationFn: () => apiPost("/reconciliation/run", { dateFrom, dateTo }),
    onSuccess: () => {
      toast.success("Reconciliation run complete");
      setHistoryPage(1);
      qc.invalidateQueries({ queryKey: ["/api/reconciliation/runs"] });
      refetch();
    },
    onError: (err: any) => toast.error(`Run failed: ${err.message}`),
  });

  const resendEmailMutation = useMutation({
    mutationFn: () => apiPost(`/reconciliation/runs/${selectedRunId}/email-logs/resend`, {}),
    onSuccess: () => {
      toast.success("Report email resent");
      qc.invalidateQueries({ queryKey: ["/api/reconciliation/runs", selectedRunId, "email-logs"] });
    },
    onError: (err: any) => toast.error(`Resend failed: ${err.message}`),
  });

  const runs = data?.data ?? [];
  const historyTotal: number = data?.total ?? 0;
  const failedEmailRuns: any[] = runs.filter((r: any) => r.lastEmail?.status === "failed");
  const historyTotalPages = Math.max(1, Math.ceil(historyTotal / HISTORY_PAGE_SIZE));
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

  function cronToHumanTime(cronExpression: string): string {
    const parts = cronExpression.split(" ");
    if (parts.length < 2) return cronExpression;
    const minute = parts[0]!.padStart(2, "0");
    const hour = parts[1]!.padStart(2, "0");
    return `${hour}:${minute}`;
  }

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
                        ? `daily at ${cronToHumanTime(schedulerStatus.cronExpression)} (${formatNextRun(schedulerStatus.nextRunAt)})`
                        : `first run at ${cronToHumanTime(schedulerStatus.cronExpression)} (${formatNextRun(schedulerStatus.nextRunAt)})`}
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

      {/* Failed email delivery banner */}
      {failedEmailRuns.length > 0 && !emailFailureBannerDismissed && (
        <div className="flex items-start gap-3 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm">
          <MailX className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-medium text-red-300 mb-0.5">
              Report email delivery failed
            </p>
            <p className="text-red-300/70 text-xs">
              {failedEmailRuns.length === 1
                ? `Run #${failedEmailRuns[0].id} (${failedEmailRuns[0].dateFrom} to ${failedEmailRuns[0].dateTo}) could not deliver its report email to the configured recipients.`
                : `${failedEmailRuns.length} recent runs could not deliver their report emails (runs ${failedEmailRuns.map((r: any) => `#${r.id}`).join(", ")}).`
              }
              {" "}Open the run to view the email log and resend.
            </p>
          </div>
          <button
            onClick={() => setEmailFailureBannerDismissed(true)}
            className="text-red-400/60 hover:text-red-300 transition-colors shrink-0 mt-0.5"
            aria-label="Dismiss"
          >
            <XCircle className="w-4 h-4" />
          </button>
        </div>
      )}

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
            <span className="flex items-center gap-2">
              Run History
              {historyTotal > 0 && (
                <Badge variant="secondary" className="text-[10px] px-1.5 h-4">{historyTotal}</Badge>
              )}
            </span>
            <Button variant="ghost" size="sm" onClick={() => refetch()} className="h-7 gap-1.5 text-muted-foreground">
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="py-12 text-center text-muted-foreground text-sm">Loading…</div>
          ) : runs.length === 0 && historyPage === 1 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">
              No reconciliation runs yet. Run one above.
            </div>
          ) : (
            <>
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
                      <th className="text-right px-4 py-2.5 text-xs text-muted-foreground font-medium">Duration</th>
                      <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Last Emailed</th>
                      <th className="px-4 py-2.5"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/30">
                    {runs.map((run: any) => {
                      const meta = STATUS_META[run.status] ?? STATUS_META.complete;
                      const lastEmail = run.lastEmail as { sentAt: string; status: string; recipients: string } | null;
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
                            {run.triggeredBy !== "auto" && (run as any).createdByEmail && (
                              <div className="text-[10px] text-muted-foreground/60 mt-0.5">
                                by {(run as any).createdByEmail}
                              </div>
                            )}
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
                          <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground">
                            {run.completedAt
                              ? formatRunDuration(new Date(run.createdAt), new Date(run.completedAt))
                              : <span className="text-muted-foreground/40">—</span>}
                          </td>
                          <td className="px-4 py-3">
                            {lastEmail ? (
                              <div className="flex items-center gap-1.5">
                                {lastEmail.status === "sent" ? (
                                  <MailCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                                ) : (
                                  <MailX className="w-3.5 h-3.5 text-red-400 shrink-0" />
                                )}
                                <div>
                                  <p className={`text-xs font-medium ${lastEmail.status === "sent" ? "text-emerald-400" : "text-red-400"}`}>
                                    {lastEmail.status === "sent" ? "Sent" : "Failed"}
                                  </p>
                                  <p className="text-[10px] text-muted-foreground/60 whitespace-nowrap">
                                    {formatDistanceToNow(new Date(lastEmail.sentAt), { addSuffix: true })}
                                  </p>
                                </div>
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground/40">—</span>
                            )}
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

              {/* Pagination */}
              {historyTotalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-border/50">
                  <p className="text-xs text-muted-foreground">
                    Page {historyPage} of {historyTotalPages}
                    <span className="ml-1 text-muted-foreground/60">
                      ({historyTotal} total run{historyTotal !== 1 ? "s" : ""})
                    </span>
                  </p>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => setHistoryPage(p => Math.max(1, p - 1))}
                      disabled={historyPage === 1 || isLoading}
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </Button>
                    {Array.from({ length: Math.min(historyTotalPages, 7) }, (_, i) => {
                      let page: number;
                      if (historyTotalPages <= 7) {
                        page = i + 1;
                      } else if (historyPage <= 4) {
                        page = i + 1;
                        if (i === 6) page = historyTotalPages;
                        if (i === 5) page = -1;
                      } else if (historyPage >= historyTotalPages - 3) {
                        if (i === 0) page = 1;
                        else if (i === 1) page = -1;
                        else page = historyTotalPages - (6 - i);
                      } else {
                        if (i === 0) page = 1;
                        else if (i === 1) page = -1;
                        else if (i === 5) page = -2;
                        else if (i === 6) page = historyTotalPages;
                        else page = historyPage + (i - 3);
                      }
                      if (page < 0) {
                        return (
                          <span key={`ellipsis-${i}`} className="px-1 text-muted-foreground/40 text-xs select-none">…</span>
                        );
                      }
                      return (
                        <Button
                          key={page}
                          variant={historyPage === page ? "default" : "outline"}
                          size="sm"
                          className="h-7 w-7 p-0 text-xs"
                          onClick={() => setHistoryPage(page)}
                          disabled={isLoading}
                        >
                          {page}
                        </Button>
                      );
                    })}
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => setHistoryPage(p => Math.min(historyTotalPages, p + 1))}
                      disabled={historyPage === historyTotalPages || isLoading}
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </>
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
            setEmailLogOpen(false);
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
                    if (isExporting) return;
                    setIsExporting(true);
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
                        toast.success("Export downloaded");
                      })
                      .catch(() => toast.error("Failed to export CSV"))
                      .finally(() => setIsExporting(false));
                  }
                  return (
                    <div className="flex items-center">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1.5 text-xs rounded-r-none border-r-0"
                        onClick={() => doExport(csvExportFilter)}
                        disabled={isExporting}
                      >
                        {isExporting ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Download className="w-3.5 h-3.5" />
                        )}
                        {isExporting ? "Exporting…" : "Export CSV"}
                        {!isExporting && csvExportFilter !== "all" && (
                          <span className="text-primary/80">· {CSV_FILTER_LABELS[csvExportFilter]}</span>
                        )}
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-1.5 rounded-l-none border-l-0 text-muted-foreground"
                            disabled={isExporting}
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

          {/* Email Delivery Log */}
          {(() => {
            const emailLogs: Array<{ id: number; emailType: string; recipients: string; status: string; errorMessage: string | null; sentAt: string }> = emailLogsQuery.data?.data ?? [];
            const hasSent = emailLogs.some(l => l.status === "sent");
            const hasFailed = emailLogs.some(l => l.status === "failed");
            const indicatorIcon = hasFailed
              ? <MailX className="w-3.5 h-3.5 text-red-400" />
              : hasSent
              ? <MailCheck className="w-3.5 h-3.5 text-emerald-400" />
              : <Mail className="w-3.5 h-3.5 text-muted-foreground/50" />;
            const indicatorLabel = hasFailed
              ? <span className="text-red-400">Some emails failed</span>
              : hasSent
              ? <span className="text-emerald-400">All emails sent</span>
              : <span className="text-muted-foreground/50">No emails sent</span>;

            return (
              <div className="border border-border/50 rounded-md">
                <button
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/20 transition-colors rounded-md"
                  onClick={() => setEmailLogOpen(v => !v)}
                >
                  {indicatorIcon}
                  <span className="font-medium text-xs">Email Delivery Log</span>
                  <span className="text-xs ml-1">{indicatorLabel}</span>
                  {emailLogs.length > 0 && (
                    <Badge variant="secondary" className="h-4 px-1.5 text-[10px] ml-0.5">{emailLogs.length}</Badge>
                  )}
                  <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground ml-auto transition-transform ${emailLogOpen ? "rotate-180" : ""}`} />
                </button>
                {emailLogOpen && (
                  <div className="border-t border-border/50 px-3 py-2.5 space-y-2">
                    {emailLogsQuery.isLoading ? (
                      <p className="text-xs text-muted-foreground">Loading…</p>
                    ) : emailLogs.length === 0 ? (
                      <p className="text-xs text-muted-foreground/50">No email sends recorded for this run.</p>
                    ) : (
                      emailLogs.map(log => (
                        <div key={log.id} className={`rounded-md border px-3 py-2 text-xs ${
                          log.status === "sent"
                            ? "border-emerald-500/20 bg-emerald-500/5"
                            : "border-red-500/20 bg-red-500/5"
                        }`}>
                          <div className="flex items-center gap-2 mb-1">
                            {log.status === "sent"
                              ? <MailCheck className="w-3 h-3 text-emerald-400 shrink-0" />
                              : <MailX className="w-3 h-3 text-red-400 shrink-0" />
                            }
                            <span className={`font-medium ${log.status === "sent" ? "text-emerald-400" : "text-red-400"}`}>
                              {log.status === "sent" ? "Sent" : "Failed"}
                            </span>
                            <Badge className={`text-[10px] px-1.5 py-0 h-4 border ${
                              log.emailType === "report"
                                ? "bg-violet-500/10 text-violet-400 border-violet-500/30"
                                : "bg-orange-500/10 text-orange-400 border-orange-500/30"
                            }`}>
                              {log.emailType === "report" ? "Report" : "Unmatched Alert"}
                            </Badge>
                            <span className="text-muted-foreground/50 ml-auto whitespace-nowrap">
                              {new Date(log.sentAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </div>
                          <p className="text-muted-foreground/70 truncate">
                            <span className="text-muted-foreground/40">To: </span>{log.recipients || "—"}
                          </p>
                          {log.errorMessage && (
                            <p className="text-red-400/70 mt-1 italic">{log.errorMessage}</p>
                          )}
                        </div>
                      ))
                    )}
                    {(() => {
                      const reportLogs = emailLogs.filter(l => l.emailType === "report");
                      const lastReport = reportLogs[0];
                      const showResend = !lastReport || lastReport.status === "failed";
                      if (!showResend) return null;
                      return (
                        <Button
                          size="sm"
                          variant="outline"
                          className="w-full h-7 text-xs gap-1.5 border-violet-500/30 text-violet-400 hover:bg-violet-500/10 hover:text-violet-300"
                          onClick={() => resendEmailMutation.mutate()}
                          disabled={resendEmailMutation.isPending}
                        >
                          {resendEmailMutation.isPending
                            ? <Loader2 className="w-3 h-3 animate-spin" />
                            : <Mail className="w-3 h-3" />
                          }
                          {resendEmailMutation.isPending ? "Sending…" : "Resend Report Email"}
                        </Button>
                      );
                    })()}
                  </div>
                )}
              </div>
            );
          })()}

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
