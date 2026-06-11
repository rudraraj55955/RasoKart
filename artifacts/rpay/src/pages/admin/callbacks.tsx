import { useState } from "react";
import { useListCallbackLogs, useRetryCallback, useGetAdminCallbackStats, ListCallbackLogsEventType, useGetSignatureFailureAlertHistory, HourlyFailureCount } from "@workspace/api-client-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { EventTypeBadge } from "@/components/ui/event-type-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { AlertTriangle, CalendarRange, ChevronDown, ChevronRight, RefreshCw, RotateCcw, ShieldAlert, Users, X, Bell, Mail, TrendingUp } from "lucide-react";
import { format, formatDistanceToNow, sub, type Duration } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/lib/utils";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

type DatePreset = "1h" | "6h" | "24h" | "7d" | "custom" | "all";

const DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: "all", label: "All time" },
  { value: "1h", label: "Last 1h" },
  { value: "6h", label: "Last 6h" },
  { value: "24h", label: "Last 24h" },
  { value: "7d", label: "Last 7d" },
  { value: "custom", label: "Custom range" },
];

function computePresetRange(preset: Exclude<DatePreset, "all" | "custom">): { from: string; to: string } {
  const now = new Date();
  const durations: Record<string, Duration> = {
    "1h": { hours: 1 },
    "6h": { hours: 6 },
    "24h": { hours: 24 },
    "7d": { days: 7 },
  };
  return { from: sub(now, durations[preset]).toISOString(), to: now.toISOString() };
}

function toLocalDatetimeValue(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type RejectionCategory = "stale_timestamp" | "replay_detected" | "bad_signature" | "missing_header" | null;

function parseRejectionReason(responseBody: string | null | undefined): RejectionCategory {
  if (!responseBody) return null;
  if (responseBody.includes("outside the allowed window")) return "stale_timestamp";
  if (responseBody.toLowerCase().includes("replay detected") || responseBody.includes("already been used")) return "replay_detected";
  if (responseBody.includes("Invalid X-Signature")) return "bad_signature";
  if (responseBody.includes("header is required") || responseBody.includes("must be a Unix epoch")) return "missing_header";
  return null;
}

const REJECTION_LABELS: Record<NonNullable<RejectionCategory>, { label: string; className: string }> = {
  stale_timestamp: {
    label: "Stale timestamp",
    className: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20 hover:bg-yellow-500/20",
  },
  replay_detected: {
    label: "Replay detected",
    className: "bg-orange-500/10 text-orange-400 border-orange-500/20 hover:bg-orange-500/20",
  },
  bad_signature: {
    label: "Bad signature",
    className: "bg-rose-500/10 text-rose-400 border-rose-500/20 hover:bg-rose-500/20",
  },
  missing_header: {
    label: "Missing header",
    className: "bg-slate-500/10 text-slate-400 border-slate-500/20 hover:bg-slate-500/20",
  },
};

function RejectionReasonTag({ responseBody }: { responseBody: string | null | undefined }) {
  const category = parseRejectionReason(responseBody);
  if (!category) return null;
  const { label, className } = REJECTION_LABELS[category];
  return (
    <Badge className={`text-xs ${className}`}>{label}</Badge>
  );
}

function SignatureVerifiedBadge({ value }: { value: boolean | null | undefined }) {
  if (value === true) {
    return <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 hover:bg-emerald-500/20 text-xs">✓ Verified</Badge>;
  }
  if (value === false) {
    return <Badge className="bg-rose-500/10 text-rose-500 border-rose-500/20 hover:bg-rose-500/20 text-xs">✗ Failed</Badge>;
  }
  return <span className="text-muted-foreground text-xs">— None</span>;
}

function CallbackRow({ log }: { log: any }) {
  const [open, setOpen] = useState(false);
  const isPendingRetry = log.status === "pending_retry";
  const isFailed = log.status === "failed";
  const rejectionCategory = parseRejectionReason(log.responseBody);
  const queryClient = useQueryClient();
  const { mutate: retryCallback, isPending: isRetrying } = useRetryCallback({
    mutation: {
      onSuccess: () => {
        toast.success("Callback queued for retry");
        queryClient.invalidateQueries({ queryKey: ["listCallbackLogs"] });
      },
      onError: (err: unknown) => {
        toast.error(getApiErrorMessage(err, "Failed to queue retry"));
      },
    },
  });

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <TableRow className="cursor-pointer" onClick={() => setOpen(!open)}>
        <TableCell>{open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</TableCell>
        <TableCell onClick={e => e.stopPropagation()}>
          {log.merchantId ? (
            <a
              href={`/admin/merchants?search=${encodeURIComponent(log.merchantName ?? String(log.merchantId))}`}
              className="text-sm font-medium text-primary hover:underline whitespace-nowrap"
            >
              {log.merchantName ?? `#${log.merchantId}`}
            </a>
          ) : (
            <span className="text-muted-foreground text-sm">—</span>
          )}
        </TableCell>
        <TableCell className="max-w-[200px] truncate text-sm font-mono">{log.url}</TableCell>
        <TableCell>
          <div className="flex items-center gap-1.5 flex-wrap">
            <StatusBadge status={log.status} />
            {isPendingRetry && <RefreshCw className="w-3 h-3 text-amber-400 animate-spin" style={{ animationDuration: "3s" }} />}
            <EventTypeBadge eventType={log.eventType} />
            {rejectionCategory && (
              <RejectionReasonTag responseBody={log.responseBody} />
            )}
          </div>
        </TableCell>
        <TableCell><span className={`font-mono text-sm ${log.httpStatus === 200 ? "text-emerald-500" : "text-rose-500"}`}>{log.httpStatus || "—"}</span></TableCell>
        <TableCell className="text-center">{log.attempts}</TableCell>
        <TableCell><SignatureVerifiedBadge value={log.signatureVerified} /></TableCell>
        <TableCell className="text-sm text-muted-foreground">
          {isPendingRetry && log.nextRetryAt ? (
            <span className="text-amber-400" title={format(new Date(log.nextRetryAt), "MMM d, HH:mm:ss")}>
              in {formatDistanceToNow(new Date(log.nextRetryAt))}
            </span>
          ) : (
            "—"
          )}
        </TableCell>
        <TableCell className="text-sm text-muted-foreground">{format(new Date(log.createdAt), "MMM d, HH:mm")}</TableCell>
        <TableCell onClick={e => e.stopPropagation()}>
          {isFailed && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs gap-1"
              disabled={isRetrying}
              onClick={() => retryCallback({ id: log.id })}
            >
              <RotateCcw className={`w-3 h-3 ${isRetrying ? "animate-spin" : ""}`} />
              Retry
            </Button>
          )}
        </TableCell>
      </TableRow>
      <CollapsibleContent asChild>
        <TableRow>
          <TableCell colSpan={10} className="bg-muted/20 pb-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 px-2 pt-2">
              {rejectionCategory && (
                <div className="md:col-span-2 flex items-center gap-3 p-3 rounded-lg bg-background/50 border border-border/50">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider shrink-0">Rejection Reason</span>
                  <RejectionReasonTag responseBody={log.responseBody} />
                  <span className="text-xs text-muted-foreground font-mono">{log.responseBody}</span>
                </div>
              )}
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider">Request Body</p>
                <pre className="text-xs bg-background/50 rounded p-3 overflow-x-auto border border-border/50 whitespace-pre-wrap">{log.requestBody ? JSON.stringify(JSON.parse(log.requestBody), null, 2) : "—"}</pre>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider">Response Body</p>
                <pre className="text-xs bg-background/50 rounded p-3 overflow-x-auto border border-border/50 whitespace-pre-wrap">{log.responseBody ? (() => { try { return JSON.stringify(JSON.parse(log.responseBody), null, 2); } catch { return log.responseBody; } })() : "—"}</pre>
              </div>
              {log.lastAttemptAt && (
                <div className="md:col-span-2">
                  <p className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider">Last Attempt</p>
                  <p className="text-xs text-muted-foreground">{format(new Date(log.lastAttemptAt), "MMM d, yyyy HH:mm:ss")}</p>
                </div>
              )}
            </div>
          </TableCell>
        </TableRow>
      </CollapsibleContent>
    </Collapsible>
  );
}

const EVENT_TYPE_OPTIONS: { value: ListCallbackLogsEventType; label: string }[] = [
  { value: ListCallbackLogsEventType.paymentreceived, label: "payment.received" },
  { value: ListCallbackLogsEventType.paymentsuccess, label: "payment.success" },
  { value: ListCallbackLogsEventType.paymentfailed, label: "payment.failed" },
  { value: ListCallbackLogsEventType.paymentpending, label: "payment.pending" },
];

function SignatureFailureTrendChart({ data, thresholdExceeded }: { data: HourlyFailureCount[]; thresholdExceeded: boolean }) {
  const maxCount = Math.max(...data.map(d => d.count), 1);
  const accentColor = thresholdExceeded ? "#f43f5e" : "#f59e0b";
  const dimColor = thresholdExceeded ? "rgba(244,63,94,0.3)" : "rgba(245,158,11,0.3)";

  const chartData = data.map(d => ({
    hour: format(new Date(d.hour), "HH:mm"),
    count: d.count,
  }));

  return (
    <div className="mt-3 pt-3 border-t border-border/30">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
        <TrendingUp className="w-3 h-3" />
        Hourly trend — last 24 hours
      </p>
      <ResponsiveContainer width="100%" height={72}>
        <BarChart data={chartData} barCategoryGap="20%" margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <XAxis
            dataKey="hour"
            tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
            tickLine={false}
            axisLine={false}
            interval={3}
          />
          <YAxis hide domain={[0, maxCount]} />
          <Tooltip
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const val = payload[0]?.value as number;
              return (
                <div className="rounded border border-border/60 bg-background/95 px-2 py-1 text-xs shadow">
                  <span className="text-muted-foreground">{label} — </span>
                  <span className="font-semibold" style={{ color: accentColor }}>{val} failure{val !== 1 ? "s" : ""}</span>
                </div>
              );
            }}
          />
          <Bar dataKey="count" radius={[2, 2, 0, 0]} minPointSize={3}>
            {chartData.map((entry, index) => (
              <Cell key={index} fill={entry.count > 0 ? accentColor : dimColor} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function AlertHistoryPanel() {
  const { data, isLoading } = useGetSignatureFailureAlertHistory({ limit: 20 });
  const [expanded, setExpanded] = useState(false);

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Bell className="w-4 h-4 text-muted-foreground" />
            Alert Dispatch History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-10 bg-muted/50 rounded animate-pulse" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const entries = data?.data ?? [];
  const total = data?.total ?? 0;

  if (total === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Bell className="w-4 h-4 text-muted-foreground" />
            Alert Dispatch History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No signature failure alerts have been sent yet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Bell className="w-4 h-4 text-muted-foreground" />
            Alert Dispatch History
            <Badge variant="secondary" className="text-xs font-mono">{total}</Badge>
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y divide-border">
          {entries.map((entry, idx) => (
            <Collapsible key={entry.id} open={expanded === (entry.id as any)} onOpenChange={open => setExpanded(open ? (entry.id as any) : false)}>
              <CollapsibleTrigger asChild>
                <button className={`w-full text-left px-4 py-3 hover:bg-muted/30 transition-colors flex items-start gap-3 ${idx === 0 ? "rounded-t-none" : ""}`}>
                  <div className="mt-0.5 shrink-0">
                    <ShieldAlert className="w-4 h-4 text-rose-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-rose-400">
                        {entry.failureCount} failure{entry.failureCount !== 1 ? "s" : ""}
                      </span>
                      <span className="text-xs text-muted-foreground">·</span>
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        {entry.affectedMerchantCount} merchant{entry.affectedMerchantCount !== 1 ? "s" : ""}
                      </span>
                      <span className="text-xs text-muted-foreground">·</span>
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Mail className="w-3 h-3" />
                        {entry.recipientCount} sent
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {format(new Date(entry.sentAt), "MMM d, yyyy 'at' HH:mm")}
                      {" · "}
                      <span className="text-muted-foreground/60">{formatDistanceToNow(new Date(entry.sentAt), { addSuffix: true })}</span>
                    </p>
                  </div>
                  <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${(expanded as any) === entry.id ? "rotate-180" : ""}`} />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="px-4 pb-4 space-y-3 bg-muted/20 border-t border-border/50">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3">
                    <div className="rounded-md bg-background/60 border border-border/50 px-3 py-2">
                      <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Failures</p>
                      <p className="text-lg font-bold text-rose-400 font-mono">{entry.failureCount}</p>
                    </div>
                    <div className="rounded-md bg-background/60 border border-border/50 px-3 py-2">
                      <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Threshold</p>
                      <p className="text-lg font-bold font-mono">{entry.threshold}</p>
                    </div>
                    <div className="rounded-md bg-background/60 border border-border/50 px-3 py-2">
                      <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Window</p>
                      <p className="text-lg font-bold font-mono">{entry.windowHours}h</p>
                    </div>
                    <div className="rounded-md bg-background/60 border border-border/50 px-3 py-2">
                      <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Emails Sent</p>
                      <p className="text-lg font-bold font-mono">{entry.recipientCount}</p>
                    </div>
                  </div>

                  {entry.affectedMerchants.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Affected Merchants</p>
                      <div className="space-y-1">
                        {entry.affectedMerchants.map((m, i) => (
                          <div key={i} className="flex items-center justify-between text-sm px-2 py-1 rounded bg-background/40 border border-border/30">
                            <span className="truncate text-foreground/80">{m.name}</span>
                            <span className="font-mono text-xs text-rose-400 shrink-0 ml-2">{m.count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {entry.recipientEmails.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Recipients</p>
                      <div className="flex flex-wrap gap-1.5">
                        {entry.recipientEmails.map((email, i) => (
                          <span key={i} className="text-xs bg-background/60 border border-border/40 rounded px-2 py-0.5 font-mono text-muted-foreground">{email}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminCallbacks() {
  const [status, setStatus] = useState("all");
  const [sigVerified, setSigVerified] = useState("all");
  const [rejectionReason, setRejectionReason] = useState("all");
  const [eventTypeFilter, setEventTypeFilter] = useState("all");
  const [merchantIdFilter, setMerchantIdFilter] = useState<number | undefined>(undefined);
  const [merchantNameFilter, setMerchantNameFilter] = useState<string | undefined>(undefined);
  const [datePreset, setDatePreset] = useState<DatePreset>("all");
  const [presetFrom, setPresetFrom] = useState<string | undefined>(undefined);
  const [presetTo, setPresetTo] = useState<string | undefined>(undefined);
  const [customFrom, setCustomFrom] = useState<string | undefined>(undefined);
  const [customTo, setCustomTo] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [breakdownExpanded, setBreakdownExpanded] = useState(false);

  const sigVerifiedParam = sigVerified === "all" ? undefined : (sigVerified as any);
  const rejectionReasonParam = rejectionReason === "all" ? undefined : (rejectionReason as any);
  const eventTypeParam = eventTypeFilter === "all" ? undefined : (eventTypeFilter as ListCallbackLogsEventType);

  const fromParam = datePreset === "custom" ? customFrom : presetFrom;
  const toParam = datePreset === "custom" ? customTo : presetTo;

  const { data, isLoading } = useListCallbackLogs({
    status: status as any,
    signatureVerified: sigVerifiedParam,
    rejectionReason: rejectionReasonParam,
    eventType: eventTypeParam,
    merchantId: merchantIdFilter,
    from: fromParam,
    to: toParam,
    page,
    limit: 20,
  });

  function selectPreset(preset: DatePreset) {
    setDatePreset(preset);
    setPage(1);
    if (preset === "all" || preset === "custom") {
      setPresetFrom(undefined);
      setPresetTo(undefined);
    } else {
      const { from, to } = computePresetRange(preset);
      setPresetFrom(from);
      setPresetTo(to);
    }
  }

  const { data: adminStats } = useGetAdminCallbackStats();

  const failures24h = adminStats?.signatureFailures24h ?? 0;
  const alertThreshold = adminStats?.alertThreshold ?? 0;
  const thresholdExceeded = adminStats?.thresholdExceeded ?? false;
  const nearThreshold = !thresholdExceeded && alertThreshold > 0 && failures24h > alertThreshold * 0.5;
  const showBanner = thresholdExceeded || nearThreshold;
  const breakdown = adminStats?.merchantBreakdown ?? [];

  function filterToSignatureFailures() {
    setSigVerified("failed");
    setStatus("all");
    setMerchantIdFilter(undefined);
    setMerchantNameFilter(undefined);
    setPage(1);
  }

  function filterToMerchant(merchantId: number, merchantName: string | null | undefined) {
    setMerchantIdFilter(merchantId);
    setMerchantNameFilter(merchantName ?? `Merchant #${merchantId}`);
    setSigVerified("failed");
    setStatus("all");
    setPage(1);
  }

  function clearMerchantFilter() {
    setMerchantIdFilter(undefined);
    setMerchantNameFilter(undefined);
    setPage(1);
  }

  return (
    <div className="space-y-6">
      <div><h1 className="text-3xl font-bold tracking-tight">Callback Logs</h1><p className="text-muted-foreground mt-1">Webhook delivery history with automatic retry</p></div>

      {showBanner && (() => {
        const isExceeded = thresholdExceeded;
        const color = isExceeded
          ? { border: "border-rose-500/30", bg: "bg-rose-500/10", hoverBg: "hover:bg-rose-500/10", divider: "border-rose-500/20", icon: "text-rose-400", text: "text-rose-400", textMuted: "text-rose-400/70", badgeBg: "bg-rose-500/10", rowHover: "hover:bg-rose-500/10", rowText: "text-rose-300", rowTextHover: "group-hover:text-rose-200", rowBadge: "text-rose-400", chevron: "text-rose-400/40 group-hover:text-rose-400", sectionLabel: "text-rose-400/60" }
          : { border: "border-amber-500/30", bg: "bg-amber-500/10", hoverBg: "hover:bg-amber-500/10", divider: "border-amber-500/20", icon: "text-amber-400", text: "text-amber-400", textMuted: "text-amber-400/70", badgeBg: "bg-amber-500/10", rowHover: "hover:bg-amber-500/10", rowText: "text-amber-300", rowTextHover: "group-hover:text-amber-200", rowBadge: "text-amber-400", chevron: "text-amber-400/40 group-hover:text-amber-400", sectionLabel: "text-amber-400/60" };

        const Icon = isExceeded ? ShieldAlert : AlertTriangle;

        return (
          <div className={`rounded-lg border ${color.border} ${color.bg} overflow-hidden`}>
            <button
              onClick={() => setBreakdownExpanded(e => !e)}
              className={`w-full text-left px-4 py-3 ${color.hoverBg} transition-colors`}
            >
              <div className="flex items-center gap-3">
                <Icon className={`w-5 h-5 ${color.icon} shrink-0`} />
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold ${color.text}`}>
                    {isExceeded
                      ? `Alert threshold exceeded — ${failures24h} signature ${failures24h === 1 ? "failure" : "failures"} in the last 24 hours`
                      : `Signature failure spike — ${failures24h} of ${alertThreshold} threshold in the last 24 hours`}
                  </p>
                  <p className={`text-xs ${color.textMuted} mt-0.5 flex items-center gap-2`}>
                    <span className="flex items-center gap-1">
                      <Users className="w-3 h-3" />
                      {adminStats!.affectedMerchants} {adminStats!.affectedMerchants === 1 ? "merchant" : "merchants"} affected
                    </span>
                    <span>·</span>
                    <button
                      onClick={e => { e.stopPropagation(); filterToSignatureFailures(); }}
                      className={`underline underline-offset-2 ${color.text} hover:opacity-80 transition-opacity`}
                    >
                      Filter by signature failures →
                    </button>
                    <span>·</span>
                    <span>{breakdownExpanded ? "click to collapse" : "click to see breakdown"}</span>
                  </p>
                </div>
                <ChevronDown className={`w-4 h-4 ${color.textMuted} transition-transform ${breakdownExpanded ? "rotate-180" : ""}`} />
              </div>
            </button>

            {breakdownExpanded && breakdown.length > 0 && (
              <div className={`border-t ${color.divider} px-4 py-3 space-y-1`}>
                <p className={`text-xs font-medium ${color.sectionLabel} uppercase tracking-wider mb-2`}>Per-merchant breakdown</p>
                {breakdown.map(entry => (
                  <button
                    key={entry.merchantId}
                    onClick={() => filterToMerchant(entry.merchantId, entry.merchantName)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-md ${color.rowHover} transition-colors group text-left`}
                  >
                    <span className={`text-sm ${color.rowText} ${color.rowTextHover} font-medium truncate`}>
                      {entry.merchantName ?? `Merchant #${entry.merchantId}`}
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-xs font-mono ${color.rowBadge} ${color.badgeBg} px-2 py-0.5 rounded`}>
                        {entry.failures} {entry.failures === 1 ? "failure" : "failures"}
                      </span>
                      <ChevronRight className={`w-3 h-3 ${color.chevron}`} />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {adminStats && adminStats.hourlyTrend && (
        <Card>
          <CardContent className="px-4 pt-4 pb-3">
            <SignatureFailureTrendChart
              data={adminStats.hourlyTrend}
              thresholdExceeded={thresholdExceeded}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
              <Select value={status} onValueChange={v => { setStatus(v); setPage(1); }}>
                <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="success">Success</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                  <SelectItem value="pending_retry">Pending Retry</SelectItem>
                </SelectContent>
              </Select>
              <Select value={sigVerified} onValueChange={v => { setSigVerified(v); setPage(1); }}>
                <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Signatures</SelectItem>
                  <SelectItem value="verified">Sig. Verified</SelectItem>
                  <SelectItem value="failed">Sig. Failed</SelectItem>
                  <SelectItem value="none">No Signature</SelectItem>
                </SelectContent>
              </Select>
              <Select value={rejectionReason} onValueChange={v => { setRejectionReason(v); setPage(1); }}>
                <SelectTrigger className="w-[200px]"><SelectValue placeholder="All Rejection Reasons" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Rejection Reasons</SelectItem>
                  <SelectItem value="stale_timestamp">Stale timestamp</SelectItem>
                  <SelectItem value="replay_detected">Replay detected</SelectItem>
                  <SelectItem value="bad_signature">Bad signature</SelectItem>
                  <SelectItem value="missing_header">Missing header</SelectItem>
                </SelectContent>
              </Select>
              <Select value={eventTypeFilter} onValueChange={v => { setEventTypeFilter(v); setPage(1); }}>
                <SelectTrigger className="w-[200px]"><SelectValue placeholder="All Event Types" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Event Types</SelectItem>
                  {EVENT_TYPE_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {merchantIdFilter != null && merchantNameFilter && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-rose-500/10 border border-rose-500/20 text-sm text-rose-400">
                  <span className="font-medium">{merchantNameFilter}</span>
                  <button onClick={clearMerchantFilter} className="hover:text-rose-300 transition-colors ml-1" aria-label="Clear merchant filter">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-3 flex-wrap items-start sm:items-center">
              <div className="flex items-center gap-1.5">
                <CalendarRange className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="text-sm text-muted-foreground font-medium shrink-0">Time range:</span>
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {DATE_PRESETS.map(preset => (
                  <button
                    key={preset.value}
                    onClick={() => selectPreset(preset.value)}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-colors border ${
                      datePreset === preset.value
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-muted/40 text-muted-foreground border-border hover:bg-muted/70 hover:text-foreground"
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              {datePreset === "custom" && (
                <div className="flex items-center gap-2 flex-wrap">
                  <Input
                    type="datetime-local"
                    className="h-8 text-xs w-[200px]"
                    value={toLocalDatetimeValue(customFrom)}
                    onChange={e => {
                      const v = e.target.value;
                      setCustomFrom(v ? new Date(v).toISOString() : undefined);
                      setPage(1);
                    }}
                  />
                  <span className="text-xs text-muted-foreground">to</span>
                  <Input
                    type="datetime-local"
                    className="h-8 text-xs w-[200px]"
                    value={toLocalDatetimeValue(customTo)}
                    onChange={e => {
                      const v = e.target.value;
                      setCustomTo(v ? new Date(v).toISOString() : undefined);
                      setPage(1);
                    }}
                  />
                  {(customFrom || customTo) && (
                    <button
                      onClick={() => { setCustomFrom(undefined); setCustomTo(undefined); setPage(1); }}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                      aria-label="Clear custom date range"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>Merchant</TableHead>
                <TableHead>URL</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>HTTP</TableHead>
                <TableHead className="text-center">Attempts</TableHead>
                <TableHead>Signature</TableHead>
                <TableHead>Next Retry</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>{Array.from({ length: 10 }).map((_, j) => <TableCell key={j}><div className="h-4 bg-muted/50 rounded animate-pulse" /></TableCell>)}</TableRow>
              )) : data?.data?.length === 0 ? (
                <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-10">No callback logs found</TableCell></TableRow>
              ) : data?.data?.map(log => <CallbackRow key={log.id} log={log} />)}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {data && data.total > 20 && (
        <div className="flex justify-between items-center">
          <span className="text-sm text-muted-foreground">{data.total} total</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button>
            <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page * 20 >= data.total}>Next</Button>
          </div>
        </div>
      )}

      <AlertHistoryPanel />
    </div>
  );
}
