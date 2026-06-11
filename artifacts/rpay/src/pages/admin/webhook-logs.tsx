import { useState } from "react";
import { useListCallbackLogs, useGetWebhookLogAttempts } from "@workspace/api-client-react";
import type { CallbackLogAttempt } from "@workspace/api-client-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { Activity, CheckCircle2, ChevronDown, ChevronRight, ListOrdered, Loader2, Search, XCircle } from "lucide-react";
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

function getHttpBadgeText(code: number | null): { text: string; className: string } {
  if (!code) return { text: "—", className: "text-muted-foreground text-xs" };
  const color = code < 300 ? "text-emerald-400" : code < 500 ? "text-amber-400" : "text-rose-400";
  return { text: String(code), className: `font-mono text-xs font-semibold ${color}` };
}

function WebhookRow({ log }: { log: any }) {
  const [open, setOpen] = useState(false);

  const tryParse = (s: string | null) => {
    if (!s) return null;
    try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; }
  };

  const { text: httpText, className: httpClass } = getHttpBadgeText(log.httpStatus);

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
          <span className="font-mono text-xs truncate block" title={log.url}>{log.url}</span>
        </TableCell>
        <TableCell><span className={httpClass}>{httpText}</span></TableCell>
        <TableCell>
          <Badge variant={log.attempts > 2 ? "destructive" : "secondary"} className="text-xs">
            {log.attempts}x
          </Badge>
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
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider">Request</p>
                <pre className="text-xs bg-background/50 rounded p-3 overflow-x-auto border border-border/50 whitespace-pre-wrap">
                  {tryParse(log.requestBody) || "—"}
                </pre>
              </div>
              <div>
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

export default function AdminWebhookLogs() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [sigVerified, setSigVerified] = useState("all");
  const [page, setPage] = useState(1);

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
          <p className="text-muted-foreground mt-1">Monitor webhook delivery attempts and failures</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => exportCsv(items)}>Export CSV</Button>
      </div>

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
    </div>
  );
}
