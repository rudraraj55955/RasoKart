import { useState } from "react";
import { useListCallbackLogs, useRetryCallback, useGetAdminCallbackStats } from "@workspace/api-client-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight, RefreshCw, RotateCcw, ShieldAlert, Users } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
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

export default function AdminCallbacks() {
  const [status, setStatus] = useState("all");
  const [sigVerified, setSigVerified] = useState("all");
  const [rejectionReason, setRejectionReason] = useState("all");
  const [page, setPage] = useState(1);

  const sigVerifiedParam = sigVerified === "all" ? undefined : (sigVerified as any);
  const rejectionReasonParam = rejectionReason === "all" ? undefined : (rejectionReason as any);

  const { data, isLoading } = useListCallbackLogs({
    status: status as any,
    signatureVerified: sigVerifiedParam,
    rejectionReason: rejectionReasonParam,
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
      <div><h1 className="text-3xl font-bold tracking-tight">Callback Logs</h1><p className="text-muted-foreground mt-1">Webhook delivery history with automatic retry</p></div>

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
          </div>
        </button>
      )}

      <Card>
        <CardHeader className="pb-4">
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
    </div>
  );
}
