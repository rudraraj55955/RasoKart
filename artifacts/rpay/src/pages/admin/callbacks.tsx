import { useState } from "react";
import { useListCallbackLogs, useRetryCallback, useGetAdminCallbackStats, useGetWebhookLogAttempts, ListCallbackLogsEventType, CallbackLogAttempt } from "@workspace/api-client-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { EventTypeBadge, EVENT_TYPE_COLORS } from "@/components/ui/event-type-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ChevronDown, ChevronRight, ListOrdered, RefreshCw, RotateCcw, ShieldAlert, Users, Info, ArrowRight, AlertTriangle, CheckCircle2, XCircle, Clock } from "lucide-react";
import { format, formatDistanceToNow, differenceInSeconds } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

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

function RetriesExhaustedBadge({ attempts, maxRetries }: { attempts: number; maxRetries: number | null | undefined }) {
  if (maxRetries == null) return null;
  const exhausted = (attempts - 1) >= maxRetries;
  if (!exhausted) return null;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-rose-500/15 text-rose-400 border border-rose-500/25">
      <AlertTriangle className="w-3 h-3" />
      Retries exhausted
    </span>
  );
}

function formatDelay(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

function RetryTimeline({ logId, totalAttempts, status, nextRetryAt }: {
  logId: number;
  totalAttempts: number;
  status: string;
  nextRetryAt?: string | null;
}) {
  const { data, isLoading } = useGetWebhookLogAttempts(logId);
  const [detailOpen, setDetailOpen] = useState(false);
  const attempts = data?.data ?? [];

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-2">
        <div className="h-3 w-3 rounded-full bg-muted/50 animate-pulse" />
        <div className="h-3 w-48 rounded bg-muted/50 animate-pulse" />
      </div>
    );
  }

  const isPendingRetry = status === "pending_retry";

  if (attempts.length === 0) {
    return <p className="text-xs text-muted-foreground/50 italic px-1">No per-attempt records — history is recorded for new deliveries going forward.</p>;
  }

  if (attempts.length === 1 && !isPendingRetry) {
    return <p className="text-xs text-muted-foreground/50 italic px-1">Only one attempt was made — no retry history to show.</p>;
  }

  const sorted = [...attempts].sort((a, b) => a.attemptNumber - b.attemptNumber);

  return (
    <TooltipProvider>
      <div className="space-y-3">
        <div className="flex items-start gap-0 flex-wrap">
          {sorted.map((attempt: CallbackLogAttempt, idx: number) => {
            const isSuccess = attempt.httpStatus != null && attempt.httpStatus >= 200 && attempt.httpStatus < 300;
            const prev = sorted[idx - 1];
            const delaySeconds = prev
              ? differenceInSeconds(new Date(attempt.firedAt), new Date(prev.firedAt))
              : null;

            return (
              <div key={attempt.id} className="flex items-center gap-1.5">
                {idx > 0 && delaySeconds != null && (
                  <div className="flex items-center gap-1.5 mx-1">
                    <ArrowRight className="w-3 h-3 text-muted-foreground/40 shrink-0" />
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="text-xs text-muted-foreground/60 font-mono cursor-default">
                          +{formatDelay(delaySeconds)}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-xs">
                        {delaySeconds}s after previous attempt
                      </TooltipContent>
                    </Tooltip>
                    <ArrowRight className="w-3 h-3 text-muted-foreground/40 shrink-0" />
                  </div>
                )}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border cursor-default ${
                      isSuccess
                        ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-400"
                        : "bg-rose-500/10 border-rose-500/25 text-rose-400"
                    }`}>
                      {isSuccess
                        ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        : <XCircle className="w-3.5 h-3.5 shrink-0" />
                      }
                      <span className="text-xs font-semibold">#{attempt.attemptNumber}</span>
                      {attempt.httpStatus != null && (
                        <span className="text-xs font-mono opacity-75">{attempt.httpStatus}</span>
                      )}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs space-y-1">
                    <p className="font-semibold">Attempt {attempt.attemptNumber}</p>
                    <p className="text-muted-foreground">{format(new Date(attempt.firedAt), "MMM d, yyyy HH:mm:ss")}</p>
                    {attempt.httpStatus != null && (
                      <p>HTTP {attempt.httpStatus} — {isSuccess ? "Success" : "Failed"}</p>
                    )}
                    {attempt.responseBody && (
                      <p className="font-mono max-w-[240px] truncate opacity-80">{attempt.responseBody}</p>
                    )}
                  </TooltipContent>
                </Tooltip>
              </div>
            );
          })}

          {isPendingRetry && nextRetryAt && (
            <div className="flex items-center gap-1.5">
              <div className="flex items-center gap-1.5 mx-1">
                <ArrowRight className="w-3 h-3 text-muted-foreground/40 shrink-0" />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-xs text-amber-400/70 font-mono cursor-default">
                      in {formatDistanceToNow(new Date(nextRetryAt))}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">
                    Scheduled for {format(new Date(nextRetryAt), "MMM d, HH:mm:ss")}
                  </TooltipContent>
                </Tooltip>
                <ArrowRight className="w-3 h-3 text-muted-foreground/40 shrink-0" />
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border bg-amber-500/10 border-amber-500/25 text-amber-400 cursor-default">
                    <Clock className="w-3.5 h-3.5 shrink-0 animate-pulse" style={{ animationDuration: "2s" }} />
                    <span className="text-xs font-semibold">#{totalAttempts + 1}</span>
                    <span className="text-xs opacity-75">pending</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  <p className="font-semibold">Next attempt scheduled</p>
                  <p className="text-muted-foreground">{format(new Date(nextRetryAt), "MMM d, yyyy HH:mm:ss")}</p>
                </TooltipContent>
              </Tooltip>
            </div>
          )}
        </div>

        {sorted.length > 1 && (
          <Collapsible open={detailOpen} onOpenChange={setDetailOpen}>
            <CollapsibleTrigger asChild>
              <button className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                {detailOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                Retry attempts detail
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-2 rounded-md border border-border/50 overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/50 bg-muted/30">
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground w-16">#</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Timestamp</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground w-24">HTTP Status</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Response Snippet</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((attempt: CallbackLogAttempt, idx: number) => {
                      const isSuccess = attempt.httpStatus != null && attempt.httpStatus >= 200 && attempt.httpStatus < 300;
                      return (
                        <tr key={attempt.id} className={`border-b border-border/30 last:border-0 ${idx % 2 === 0 ? "" : "bg-muted/10"}`}>
                          <td className="px-3 py-2 font-mono text-muted-foreground">
                            {attempt.attemptNumber === 1 ? (
                              <span className="text-muted-foreground/60">init</span>
                            ) : (
                              <span className="text-amber-400/80">retry {attempt.attemptNumber - 1}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 font-mono text-muted-foreground whitespace-nowrap">
                            {format(new Date(attempt.firedAt), "MMM d, HH:mm:ss")}
                          </td>
                          <td className="px-3 py-2">
                            {attempt.httpStatus != null ? (
                              <span className={`font-mono font-semibold ${isSuccess ? "text-emerald-400" : "text-rose-400"}`}>
                                {attempt.httpStatus}
                              </span>
                            ) : (
                              <span className="text-muted-foreground/50">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 font-mono text-muted-foreground/70 max-w-[320px] truncate">
                            {attempt.responseBody
                              ? attempt.responseBody.slice(0, 120) + (attempt.responseBody.length > 120 ? "…" : "")
                              : <span className="opacity-40">—</span>
                            }
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
    </TooltipProvider>
  );
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
      onError: () => {
        toast.error("Failed to queue retry");
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
        <TableCell className="text-center">
          <span className={`font-mono text-sm font-semibold ${
            log.status === "success" && (log.attempts ?? 1) === 1
              ? "text-emerald-400"
              : log.status === "success" && (log.attempts ?? 1) > 1
              ? "text-amber-400"
              : log.status === "pending_retry"
              ? "text-amber-400"
              : log.status === "failed"
              ? "text-rose-400"
              : "text-foreground"
          }`}>{log.attempts}</span>
        </TableCell>
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
              {open && (
                <div className="md:col-span-2 p-3 rounded-lg bg-background/50 border border-border/50">
                  <div className="flex items-center gap-1.5 mb-2.5">
                    <ListOrdered className="w-3.5 h-3.5 text-muted-foreground/60" />
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Attempt History{(log.attempts ?? 0) > 1 ? ` · ${log.attempts}` : ""}
                    </p>
                  </div>
                  <RetryTimeline
                    logId={log.id}
                    totalAttempts={log.attempts ?? 0}
                    status={log.status}
                    nextRetryAt={log.nextRetryAt}
                  />
                </div>
              )}
              {rejectionCategory && (
                <div className="md:col-span-2 flex items-center gap-3 p-3 rounded-lg bg-background/50 border border-border/50">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider shrink-0">Rejection Reason</span>
                  <RejectionReasonTag responseBody={log.responseBody} />
                  <span className="text-xs text-muted-foreground font-mono">{log.responseBody}</span>
                </div>
              )}
              {(() => {
                let reqParsed: Record<string, unknown> | null = null;
                let isEkqr = false;
                try { if (log.requestBody) { reqParsed = JSON.parse(log.requestBody); isEkqr = reqParsed?.provider === "ekqr"; } } catch {}
                const prettyReq = reqParsed ? JSON.stringify(reqParsed, null, 2) : (log.requestBody || "—");
                return isEkqr ? (
                  <div className="md:col-span-2">
                    <div className="flex items-center gap-2 mb-1.5">
                      <p className="text-xs font-medium text-teal-400 uppercase tracking-wider">UPI Raw Payload</p>
                      <span className="inline-flex items-center gap-1 rounded border border-teal-500/30 bg-teal-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-teal-400">provider: ekqr</span>
                      {!!reqParsed?.event && <span className="text-xs text-muted-foreground font-mono">{String(reqParsed.event)}</span>}
                      {!!reqParsed?.amount && <span className="text-xs font-mono text-emerald-400">₹{String(reqParsed.amount)}</span>}
                    </div>
                    <pre className="text-xs bg-background/50 rounded p-3 overflow-x-auto border border-teal-500/20 whitespace-pre-wrap max-h-48">{prettyReq}</pre>
                  </div>
                ) : (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider">Request Body</p>
                    <pre className="text-xs bg-background/50 rounded p-3 overflow-x-auto border border-border/50 whitespace-pre-wrap">{prettyReq}</pre>
                  </div>
                );
              })()}
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
              <div className="md:col-span-2 flex items-center gap-3 p-3 rounded-lg bg-background/50 border border-border/50">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider shrink-0">Retry Config</span>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-mono text-foreground">
                    {log.attempts} {log.attempts === 1 ? "attempt" : "attempts"}
                    {log.maxRetries != null && (
                      <span className="text-muted-foreground"> / max {log.maxRetries} {log.maxRetries === 1 ? "retry" : "retries"}</span>
                    )}
                  </span>
                  {log.maxRetries == null && (
                    <span className="text-xs text-muted-foreground italic">No webhook configured</span>
                  )}
                  <RetriesExhaustedBadge attempts={log.attempts} maxRetries={log.maxRetries} />
                </div>
              </div>
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

function RetryScheduleBanner({ maxAttempts, delays }: { maxAttempts: number; delays: { attempt: number; delaySeconds: number; label: string }[] }) {
  return (
    <TooltipProvider>
      <div className="flex items-center gap-3 rounded-lg border border-blue-500/20 bg-blue-500/5 px-4 py-2.5">
        <Info className="w-4 h-4 text-blue-400 shrink-0" />
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span className="text-xs font-medium text-blue-300 shrink-0">Active retry policy:</span>
          <div className="flex items-center gap-1.5 flex-wrap">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="px-2 py-0.5 rounded bg-blue-500/15 text-blue-300 text-xs font-mono font-semibold border border-blue-500/20 cursor-default">
                  Attempt 1
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">Initial delivery</TooltipContent>
            </Tooltip>
            {delays.map((d) => (
              <div key={d.attempt} className="flex items-center gap-1.5">
                <ArrowRight className="w-3 h-3 text-blue-400/50 shrink-0" />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-300/80 text-xs font-mono border border-blue-500/15 cursor-default">
                      +{d.label}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    Retry #{d.attempt} — waits {d.label} after previous failure
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="px-2 py-0.5 rounded bg-blue-500/15 text-blue-300 text-xs font-mono font-semibold border border-blue-500/20 cursor-default">
                      Attempt {d.attempt + 1}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">Retry #{d.attempt} of {maxAttempts - 1}</TooltipContent>
                </Tooltip>
              </div>
            ))}
          </div>
          <span className="text-xs text-blue-400/60 shrink-0">· max {maxAttempts} attempts total</span>
        </div>
      </div>
    </TooltipProvider>
  );
}

function getInitialStatus(): string {
  const params = new URLSearchParams(window.location.search);
  const s = params.get("status");
  return s === "failed" || s === "success" || s === "pending_retry" ? s : "all";
}

export default function AdminCallbacks() {
  const [status, setStatus] = useState(getInitialStatus);
  const [sigVerified, setSigVerified] = useState("all");
  const [rejectionReason, setRejectionReason] = useState("all");
  const [eventTypeFilter, setEventTypeFilter] = useState("all");
  const [page, setPage] = useState(1);

  const sigVerifiedParam = sigVerified === "all" ? undefined : (sigVerified as any);
  const rejectionReasonParam = rejectionReason === "all" ? undefined : (rejectionReason as any);
  const eventTypeParam = eventTypeFilter === "all" ? undefined : (eventTypeFilter as ListCallbackLogsEventType);

  const { data, isLoading } = useListCallbackLogs({
    status: status as any,
    signatureVerified: sigVerifiedParam,
    rejectionReason: rejectionReasonParam,
    eventType: eventTypeParam,
    page,
    limit: 20,
  });

  const { data: adminStats } = useGetAdminCallbackStats();
  const hasFailures = (adminStats?.signatureFailures24h ?? 0) > 0;

  function filterToSignatureFailures() {
    setSigVerified("failed");
    setStatus("all");
    setPage(1);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div><h1 className="text-3xl font-bold tracking-tight">Callback Logs</h1><p className="text-muted-foreground mt-1">Webhook delivery history with automatic retry</p></div>
      </div>

      {hasFailures && (
        <button
          onClick={filterToSignatureFailures}
          className="w-full text-left rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 hover:bg-rose-500/20 transition-colors"
        >
          <div className="flex items-center gap-3">
            <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-rose-400">
                {adminStats!.signatureFailures24h} signature {adminStats!.signatureFailures24h === 1 ? "failure" : "failures"} in the last 24 hours
              </p>
              <p className="text-xs text-rose-400/70 mt-0.5 flex items-center gap-1">
                <Users className="w-3 h-3" />
                {adminStats!.affectedMerchants} {adminStats!.affectedMerchants === 1 ? "merchant" : "merchants"} affected — click to filter
              </p>
            </div>
            <a
              href="/admin/settings#signature-failure-alert"
              onClick={e => e.stopPropagation()}
              className="shrink-0 text-xs text-rose-400/80 hover:text-rose-300 border border-rose-500/30 hover:border-rose-500/60 rounded px-2 py-1 transition-colors whitespace-nowrap"
              title="Go to Signature Failure Alert settings"
            >
              Threshold: {adminStats!.alertThreshold} {adminStats!.alertThreshold === 1 ? "failure" : "failures"} / {adminStats!.alertWindowHours === 1 ? "1 hour" : `${adminStats!.alertWindowHours}h`}
            </a>
          </div>
        </button>
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
            </div>

            <div className="flex flex-col sm:flex-row gap-3 flex-wrap items-start sm:items-center">
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-sm text-muted-foreground font-medium">Event type:</span>
              </div>
              <div className="flex gap-1.5 flex-wrap">
                <button
                  onClick={() => { setEventTypeFilter("all"); setPage(1); }}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors border ${
                    eventTypeFilter === "all"
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted/40 text-muted-foreground border-border hover:bg-muted/70 hover:text-foreground"
                  }`}
                >
                  All
                </button>
                {EVENT_TYPE_OPTIONS.map(opt => {
                  const colors = EVENT_TYPE_COLORS[opt.label] ?? { bg: "bg-muted/40", text: "text-muted-foreground", border: "border-border" };
                  const isActive = eventTypeFilter === opt.value;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => { setEventTypeFilter(isActive ? "all" : opt.value); setPage(1); }}
                      className={`px-2.5 py-1 rounded text-xs font-mono font-semibold transition-colors border ${
                        isActive
                          ? `${colors.bg} ${colors.text} ${colors.border} ring-1 ring-inset ${colors.border}`
                          : "bg-muted/40 text-muted-foreground border-border hover:bg-muted/70 hover:text-foreground"
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
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
          </div>
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
    </div>
  );
}
