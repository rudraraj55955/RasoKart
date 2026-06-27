import { useState } from "react";
import { Link, useSearch } from "wouter";
import { useListCallbackLogs, useGetWebhookLogAttempts, useGetWebhookRetryPolicy, useListEkqrWebhookLogs } from "@workspace/api-client-react";
import type { CallbackLogAttempt, WebhookRetryPolicy } from "@workspace/api-client-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { Activity, CheckCircle2, ChevronDown, ChevronRight, ExternalLink, Info, ListOrdered, Loader2, RefreshCw, Search, XCircle, Zap } from "lucide-react";
import { format } from "date-fns";

function SignatureVerifiedBadge({ value }: { value: boolean | null | undefined }) {
  if (value === true) {
    return <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 hover:bg-emerald-500/20 text-xs">✓ Verified</Badge>;
  }
  if (value === false) {
    return <Badge className="bg-rose-500/10 text-rose-500 border-rose-500/20 hover:bg-rose-500/20 text-xs">✗ Failed</Badge>;
  }
  return <span className="text-muted-foreground text-xs">— None</span>;
}

function exportCsv(data: any[]) {
  if (!data.length) return;
  const rows = [["ID", "Merchant ID", "URL", "Status", "HTTP Status", "Attempts", "Signature", "Date"]];
  data.forEach(c => {
    const sig = c.signatureVerified === true ? "verified" : c.signatureVerified === false ? "failed" : "none";
    rows.push([
      String(c.id), String(c.merchantId), c.url, c.status,
      String(c.httpStatus ?? ""), String(c.attempts), sig, c.createdAt,
    ]);
  });
  const csv = rows.map(r => r.map(v => `"${v}"`).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = "webhook-logs.csv";
  a.click();
}

function AttemptStatusDot({ httpStatus }: { httpStatus: number | null | undefined }) {
  if (httpStatus != null && httpStatus >= 200 && httpStatus < 300) {
    return <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 shrink-0 mt-0.5" />;
  }
  if (httpStatus != null) {
    return <span className="inline-block w-2 h-2 rounded-full bg-rose-400 shrink-0 mt-0.5" />;
  }
  return <span className="inline-block w-2 h-2 rounded-full bg-muted-foreground/30 shrink-0 mt-0.5" />;
}

function RetryHistorySection({ logId, open }: { logId: number; open: boolean }) {
  const { data, isLoading, isError } = useGetWebhookLogAttempts(logId, {
    query: { enabled: open } as any,
  });

  const attempts: CallbackLogAttempt[] = (data as any)?.data ?? [];

  return (
    <div className="px-2 pt-3">
      <div className="flex items-center gap-1.5 mb-2">
        <ListOrdered className="w-3.5 h-3.5 text-muted-foreground/60" />
        <p className="text-xs text-muted-foreground/60 uppercase tracking-wider font-medium">
          Attempt History{attempts.length > 0 ? ` · ${attempts.length}` : ""}
        </p>
      </div>
      {isLoading ? (
        <div className="flex items-center gap-2 px-1 py-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground/50" />
          <span className="text-xs text-muted-foreground/50">Loading attempt history…</span>
        </div>
      ) : isError ? (
        <p className="text-xs text-rose-400/70 italic px-1">Failed to load attempt history.</p>
      ) : attempts.length === 0 ? (
        <p className="text-xs text-muted-foreground/50 italic px-1">No per-attempt records — history is recorded for new deliveries going forward.</p>
      ) : (
        <div className="space-y-2">
          {attempts.map(a => (
            <div key={a.id} className="flex items-start gap-2 px-1">
              <AttemptStatusDot httpStatus={a.httpStatus} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-medium text-foreground/80">#{a.attemptNumber}</span>
                  {a.httpStatus != null && (
                    <span className={`font-mono text-xs font-semibold ${
                      a.httpStatus >= 200 && a.httpStatus < 300
                        ? "text-emerald-400"
                        : a.httpStatus < 500
                        ? "text-amber-400"
                        : "text-rose-400"
                    }`}>{a.httpStatus}</span>
                  )}
                  <span className="text-xs text-muted-foreground/50">
                    {format(new Date(a.firedAt), "MMM d, HH:mm:ss")}
                  </span>
                </div>
                {a.responseBody && (
                  <pre className="mt-1 text-xs text-muted-foreground/60 bg-background/30 rounded px-2 py-1 overflow-x-auto whitespace-pre-wrap line-clamp-3 border border-border/30">
                    {a.responseBody}
                  </pre>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatDelaySchedule(policy: WebhookRetryPolicy): string {
  if (!policy.delays || policy.delays.length === 0) return "No retries";
  return policy.delays.map(d => d.label).join(" → ");
}

function RetryPolicyBanner() {
  const { data, isLoading, isError } = useGetWebhookRetryPolicy();
  const policy = data as WebhookRetryPolicy | undefined;

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-border/50 bg-muted/20 text-xs text-muted-foreground">
        <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" />
        <span>Loading retry policy…</span>
      </div>
    );
  }

  if (isError || !policy) {
    return null;
  }

  const schedule = formatDelaySchedule(policy);

  return (
    <Link href="/admin/settings">
      <div className="group flex items-center gap-3 px-4 py-2.5 rounded-lg border border-primary/20 bg-primary/5 hover:bg-primary/10 hover:border-primary/30 transition-colors cursor-pointer">
        <Info className="w-3.5 h-3.5 text-primary shrink-0" />
        <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-foreground/80">Active retry policy:</span>
          <span className="text-xs text-muted-foreground">
            Up to <span className="font-semibold text-foreground/70">{policy.maxAttempts}</span> attempt{policy.maxAttempts !== 1 ? "s" : ""}
            {policy.delays.length > 0 && (
              <> · <span className="font-mono">{schedule}</span></>
            )}
          </span>
        </div>
        <div className="flex items-center gap-1 text-xs text-primary/60 group-hover:text-primary transition-colors shrink-0">
          <span>Settings</span>
          <ExternalLink className="w-3 h-3" />
        </div>
      </div>
    </Link>
  );
}

function getHttpBadgeText(code: number | null): { text: string; className: string } {
  if (!code) return { text: "—", className: "text-muted-foreground text-xs" };
  const color = code < 300 ? "text-emerald-400" : code < 500 ? "text-amber-400" : "text-rose-400";
  return { text: String(code), className: `font-mono text-xs font-semibold ${color}` };
}

function detectEkqrPayload(requestBody: string | null): { isEkqr: boolean; parsed: Record<string, unknown> | null } {
  if (!requestBody) return { isEkqr: false, parsed: null };
  try {
    const obj = JSON.parse(requestBody);
    return { isEkqr: obj?.provider === "ekqr", parsed: obj };
  } catch {
    return { isEkqr: false, parsed: null };
  }
}

function WebhookRow({ log }: { log: any }) {
  const [open, setOpen] = useState(false);
  const [rawExpanded, setRawExpanded] = useState(false);

  const tryParse = (s: string | null) => {
    if (!s) return null;
    try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; }
  };

  const { text: httpText, className: httpClass } = getHttpBadgeText(log.httpStatus);
  const { isEkqr, parsed: ekqrParsed } = detectEkqrPayload(log.requestBody);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <TableRow className="cursor-pointer" onClick={() => setOpen(!open)}>
        <TableCell className="w-8">
          {open
            ? <ChevronDown className="w-4 h-4 text-muted-foreground" />
            : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
        </TableCell>
        <TableCell className="font-mono text-xs text-muted-foreground">#{log.id}</TableCell>
        <TableCell className="text-xs text-muted-foreground">#{log.merchantId}</TableCell>
        <TableCell className="max-w-[200px]">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-xs truncate block" title={log.url}>{log.url}</span>
            {isEkqr && (
              <span className="shrink-0 inline-flex items-center gap-1 rounded border border-teal-500/30 bg-teal-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-teal-400">
                UPI
              </span>
            )}
          </div>
        </TableCell>
        <TableCell><span className={httpClass}>{httpText}</span></TableCell>
        <TableCell>
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
        <TableCell><StatusBadge status={log.status} /></TableCell>
        <TableCell className="text-xs text-muted-foreground">
          {format(new Date(log.createdAt), "MMM d, HH:mm")}
        </TableCell>
      </TableRow>
      <CollapsibleContent asChild>
        <TableRow>
          <TableCell colSpan={9} className="bg-muted/20 pb-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 px-2 pt-2">
              {isEkqr ? (
                <div className="md:col-span-2">
                  <div className="flex items-center gap-2 mb-1.5">
                    <p className="text-xs font-medium text-teal-400 uppercase tracking-wider">UPI Raw Payload</p>
                    <span className="inline-flex items-center gap-1 rounded border border-teal-500/30 bg-teal-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-teal-400">
                      upi gateway
                    </span>
                    <button
                      type="button"
                      className="ml-auto text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                      onClick={e => { e.stopPropagation(); setRawExpanded(v => !v); }}
                    >
                      {rawExpanded ? "Collapse" : "Expand full JSON"}
                    </button>
                  </div>
                  {ekqrParsed && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2 text-xs">
                      {!!ekqrParsed.event && <div><span className="text-muted-foreground">Event: </span><span className="font-mono text-foreground">{String(ekqrParsed.event)}</span></div>}
                      {!!ekqrParsed.amount && <div><span className="text-muted-foreground">Amount: </span><span className="font-mono text-emerald-400">₹{String(ekqrParsed.amount)}</span></div>}
                      {!!(ekqrParsed.orderId ?? ekqrParsed.order_id) && <div><span className="text-muted-foreground">Order: </span><span className="font-mono text-foreground">{String(ekqrParsed.orderId ?? ekqrParsed.order_id)}</span></div>}
                      {!!(ekqrParsed.transactionId ?? ekqrParsed.transaction_id) && <div><span className="text-muted-foreground">Txn: </span><span className="font-mono text-blue-400">{String(ekqrParsed.transactionId ?? ekqrParsed.transaction_id)}</span></div>}
                    </div>
                  )}
                  <pre className={`text-xs bg-background/50 rounded p-3 overflow-x-auto border border-teal-500/20 whitespace-pre-wrap ${rawExpanded ? "" : "max-h-32"}`}>
                    {tryParse(log.requestBody) || "—"}
                  </pre>
                </div>
              ) : (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider">Request</p>
                  <pre className="text-xs bg-background/50 rounded p-3 overflow-x-auto border border-border/50 whitespace-pre-wrap">
                    {tryParse(log.requestBody) || "—"}
                  </pre>
                </div>
              )}
              <div className={isEkqr ? "" : ""}>
                <p className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider">Response</p>
                <pre className="text-xs bg-background/50 rounded p-3 overflow-x-auto border border-border/50 whitespace-pre-wrap">
                  {tryParse(log.responseBody) || "—"}
                </pre>
              </div>
            </div>
            <RetryHistorySection logId={log.id} open={open} />
          </TableCell>
        </TableRow>
      </CollapsibleContent>
    </Collapsible>
  );
}

function processingResultBadge(result: string) {
  if (result === "credited") return <Badge className="text-xs bg-emerald-500/10 text-emerald-400 border-emerald-500/20">credited</Badge>;
  if (result === "duplicate") return <Badge className="text-xs bg-amber-500/10 text-amber-400 border-amber-500/20">duplicate</Badge>;
  if (result === "error") return <Badge className="text-xs bg-rose-500/10 text-rose-400 border-rose-500/20">error</Badge>;
  return <Badge className="text-xs bg-muted/50 text-muted-foreground border-border/30">ignored</Badge>;
}

function EkqrWebhookRow({ log }: { log: any }) {
  const [open, setOpen] = useState(false);

  const tryParse = (s: string | null) => {
    if (!s) return null;
    try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; }
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <TableRow className="cursor-pointer" onClick={() => setOpen(!open)}>
        <TableCell className="w-8">
          {open
            ? <ChevronDown className="w-4 h-4 text-muted-foreground" />
            : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
        </TableCell>
        <TableCell className="text-xs text-muted-foreground">
          {format(new Date(log.receivedAt), "MMM d, HH:mm:ss")}
        </TableCell>
        <TableCell className="font-mono text-xs max-w-[160px]">
          <span className="truncate block" title={log.clientTxnId}>{log.clientTxnId}</span>
        </TableCell>
        <TableCell className="text-xs text-muted-foreground">
          {log.merchantId != null ? `#${log.merchantId}` : <span className="italic">—</span>}
        </TableCell>
        <TableCell className="font-mono text-sm">
          {log.amount != null ? `₹${parseFloat(log.amount).toLocaleString("en-IN")}` : <span className="text-muted-foreground text-xs">—</span>}
        </TableCell>
        <TableCell>
          <Badge className="text-xs font-mono">{log.status ?? "—"}</Badge>
        </TableCell>
        <TableCell>{processingResultBadge(log.processingResult)}</TableCell>
      </TableRow>
      <CollapsibleContent asChild>
        <TableRow>
          <TableCell colSpan={7} className="bg-muted/20 pb-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 px-2 pt-2">
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider">Raw Payload</p>
                <pre className="text-xs bg-background/50 rounded p-3 overflow-x-auto border border-border/50 whitespace-pre-wrap max-h-64">
                  {tryParse(log.rawPayload) || "—"}
                </pre>
              </div>
              {(log.errorMessage || log.qrCodeId != null) && (
                <div className="space-y-3">
                  {log.qrCodeId != null && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider">QR Code</p>
                      <span className="font-mono text-xs text-foreground/80">#{log.qrCodeId}</span>
                    </div>
                  )}
                  {log.errorMessage && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider">Note</p>
                      <p className="text-xs text-amber-400/80">{log.errorMessage}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </TableCell>
        </TableRow>
      </CollapsibleContent>
    </Collapsible>
  );
}

function EkqrWebhookLogsTab() {
  const [processingResult, setProcessingResult] = useState("all");
  const [page, setPage] = useState(1);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const { data, isLoading } = useListEkqrWebhookLogs({
    processingResult: processingResult === "all" ? undefined : (processingResult as any),
    page,
    limit: 50,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  });

  const items = data?.data ?? [];
  const total = data?.total ?? 0;

  const creditedCount = items.filter(r => r.processingResult === "credited").length;
  const ignoredCount = items.filter(r => r.processingResult === "ignored").length;
  const errorCount = items.filter(r => r.processingResult === "error").length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-border/50 bg-card/50">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                <Activity className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Received</p>
                <p className="text-lg font-bold">{total}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card/50">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Credited</p>
                <p className="text-lg font-bold">{creditedCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card/50">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-rose-500/10 flex items-center justify-center">
                <XCircle className="w-4 h-4 text-rose-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Errors / Ignored</p>
                <p className="text-lg font-bold">{errorCount + ignoredCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <Select value={processingResult} onValueChange={v => { setProcessingResult(v); setPage(1); }}>
              <SelectTrigger className="w-[180px]"><SelectValue placeholder="All Results" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Results</SelectItem>
                <SelectItem value="credited">Credited</SelectItem>
                <SelectItem value="duplicate">Duplicate</SelectItem>
                <SelectItem value="ignored">Ignored</SelectItem>
                <SelectItem value="error">Error</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground whitespace-nowrap">Date range:</span>
              <Input type="date" className="h-9 text-sm w-36" value={dateFrom}
                onChange={e => { setDateFrom(e.target.value); setPage(1); }} />
              <span className="text-xs text-muted-foreground">to</span>
              <Input type="date" className="h-9 text-sm w-36" value={dateTo}
                onChange={e => { setDateTo(e.target.value); setPage(1); }} />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Received At</TableHead>
                  <TableHead>Client Txn ID</TableHead>
                  <TableHead>Merchant</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Payment Status</TableHead>
                  <TableHead>Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 7 }).map((_, j) => (
                        <TableCell key={j}><div className="h-4 bg-muted/50 rounded animate-pulse" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : !items.length ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-12">
                      <Zap className="w-6 h-6 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">No UPI webhook logs found</p>
                    </TableCell>
                  </TableRow>
                ) : items.map((log: any) => (
                  <EkqrWebhookRow key={log.id} log={log} />
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {total > 50 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{total} total logs</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button>
            <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page * 50 >= total}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminWebhookLogs() {
  const search_ = useSearch();
  const params = new URLSearchParams(search_);
  const initialTab = params.get("tab") === "ekqr" ? "ekqr" : "outgoing";

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [sigVerified, setSigVerified] = useState("all");
  const [page, setPage] = useState(1);
  const [activeTab, setActiveTab] = useState<"outgoing" | "ekqr">(initialTab);

  const sigVerifiedParam = sigVerified === "all" ? undefined : (sigVerified as any);

  const { data, isLoading } = useListCallbackLogs({
    status: status === "all" ? undefined : (status as any),
    signatureVerified: sigVerifiedParam,
    page,
    limit: 20,
  } as any);

  const items = (data as any)?.data ?? [];
  const total = (data as any)?.total ?? 0;
  const successCount = items.filter((c: any) => c.status === "success").length;
  const failedCount = items.filter((c: any) => c.status === "failed").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Webhook Logs</h1>
          <p className="text-muted-foreground mt-1">Monitor webhook delivery attempts and UPI incoming events</p>
        </div>
        {activeTab === "outgoing" && (
          <Button variant="outline" size="sm" onClick={() => exportCsv(items)}>Export CSV</Button>
        )}
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 border-b border-border/50">
        <button
          type="button"
          className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${activeTab === "outgoing" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          onClick={() => setActiveTab("outgoing")}
        >
          Outgoing Callbacks
        </button>
        <button
          type="button"
          className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px flex items-center gap-1.5 ${activeTab === "ekqr" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          onClick={() => setActiveTab("ekqr")}
        >
          <Zap className="w-3.5 h-3.5" />
          UPI Incoming
        </button>
      </div>

      {activeTab === "ekqr" ? (
        <EkqrWebhookLogsTab />
      ) : (
        <>
          <RetryPolicyBanner />

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card className="border-border/50 bg-card/50">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Activity className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Total Deliveries</p>
                    <p className="text-lg font-bold">{total}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="border-border/50 bg-card/50">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Successful</p>
                    <p className="text-lg font-bold">{successCount}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="border-border/50 bg-card/50">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-rose-500/10 flex items-center justify-center">
                    <XCircle className="w-4 h-4 text-rose-500" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Failed</p>
                    <p className="text-lg font-bold">{failedCount}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    className="pl-9"
                    placeholder="Search by URL..."
                    value={search}
                    onChange={e => { setSearch(e.target.value); setPage(1); }}
                  />
                </div>
                <Select value={status} onValueChange={v => { setStatus(v); setPage(1); }}>
                  <SelectTrigger className="w-[150px]"><SelectValue placeholder="Status" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="success">Success</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
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
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8"></TableHead>
                      <TableHead>ID</TableHead>
                      <TableHead>Merchant</TableHead>
                      <TableHead>Endpoint URL</TableHead>
                      <TableHead>HTTP</TableHead>
                      <TableHead>Attempts</TableHead>
                      <TableHead>Signature</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      Array.from({ length: 6 }).map((_, i) => (
                        <TableRow key={i}>
                          {Array.from({ length: 9 }).map((_, j) => (
                            <TableCell key={j}><div className="h-4 bg-muted/50 rounded animate-pulse" /></TableCell>
                          ))}
                        </TableRow>
                      ))
                    ) : !items.length ? (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center text-muted-foreground py-12">
                          No webhook logs found
                        </TableCell>
                      </TableRow>
                    ) : items.map((c: any) => (
                      <WebhookRow key={c.id} log={c} />
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {total > 20 && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{total} total logs</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button>
                <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page * 20 >= total}>Next</Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
