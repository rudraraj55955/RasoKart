import { useState } from "react";
import { useListCallbackLogs } from "@workspace/api-client-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Webhook, Search, CheckCircle2, XCircle, Activity, Eye } from "lucide-react";
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

export default function AdminWebhookLogs() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [sigVerified, setSigVerified] = useState("all");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<any | null>(null);

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

  function getHttpBadge(code: number | null) {
    if (!code) return <span className="text-muted-foreground text-xs">—</span>;
    const color = code < 300 ? "text-emerald-400" : code < 500 ? "text-amber-400" : "text-rose-400";
    return <span className={`font-mono text-xs font-semibold ${color}`}>{code}</span>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Webhook Logs</h1>
          <p className="text-muted-foreground mt-1">Monitor webhook delivery attempts and failures</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => exportCsv(items)}>Export CSV</Button>
      </div>

      <div className="grid grid-cols-3 gap-4">
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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Merchant</TableHead>
                <TableHead>Endpoint URL</TableHead>
                <TableHead>HTTP</TableHead>
                <TableHead>Attempts</TableHead>
                <TableHead>Signature</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
                <TableHead></TableHead>
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
                <TableRow key={c.id}>
                  <TableCell className="font-mono text-xs text-muted-foreground">#{c.id}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">#{c.merchantId}</TableCell>
                  <TableCell className="max-w-[200px]">
                    <span className="font-mono text-xs truncate block" title={c.url}>{c.url}</span>
                  </TableCell>
                  <TableCell>{getHttpBadge(c.httpStatus)}</TableCell>
                  <TableCell>
                    <Badge variant={c.attempts > 2 ? "destructive" : "secondary"} className="text-xs">
                      {c.attempts}x
                    </Badge>
                  </TableCell>
                  <TableCell><SignatureVerifiedBadge value={c.signatureVerified} /></TableCell>
                  <TableCell><StatusBadge status={c.status} /></TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {format(new Date(c.createdAt), "MMM d, HH:mm")}
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" onClick={() => setSelected(c)}>
                      <Eye className="w-3.5 h-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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

      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Webhook className="w-4 h-4" /> Webhook Delivery #{selected?.id}
            </DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground mb-1">Status</p>
                  <StatusBadge status={selected.status} />
                </div>
                <div className="rounded-lg bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground mb-1">HTTP Status</p>
                  <p className="font-mono font-semibold">{selected.httpStatus ?? "—"}</p>
                </div>
                <div className="rounded-lg bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground mb-1">Attempts</p>
                  <p className="font-semibold">{selected.attempts}</p>
                </div>
                <div className="rounded-lg bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground mb-1">Merchant ID</p>
                  <p className="font-mono">#{selected.merchantId}</p>
                </div>
                <div className="rounded-lg bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground mb-1">Signature</p>
                  <SignatureVerifiedBadge value={selected.signatureVerified} />
                </div>
              </div>
              <div className="rounded-lg bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground mb-1">Endpoint URL</p>
                <p className="font-mono text-xs break-all">{selected.url}</p>
              </div>
              {selected.requestBody && (
                <div className="rounded-lg bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground mb-2">Request Body</p>
                  <pre className="text-xs overflow-auto max-h-40 font-mono">
                    {(() => { try { return JSON.stringify(JSON.parse(selected.requestBody), null, 2); } catch { return selected.requestBody; } })()}
                  </pre>
                </div>
              )}
              {selected.responseBody && (
                <div className="rounded-lg bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground mb-2">Response Body</p>
                  <pre className="text-xs overflow-auto max-h-40 font-mono">{selected.responseBody}</pre>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
