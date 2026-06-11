import { useState } from "react";
import { useListTransactions } from "@workspace/api-client-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ArrowDownLeft, Search, TrendingUp, Clock, CheckCircle, CheckCircle2, XCircle, Hash } from "lucide-react";
import { format } from "date-fns";

function exportCsv(data: any[]) {
  if (!data.length) return;
  const rows = [["ID", "Merchant", "Amount", "Currency", "UTR", "Reference", "Status", "Description", "Date"]];
  data.forEach(t => rows.push([
    String(t.id), t.merchantName ?? "", String(t.amount), t.currency, t.utr,
    t.referenceId ?? "", t.status, t.description ?? "", t.createdAt,
  ]));
  const csv = rows.map(r => r.map(v => `"${v}"`).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = "deposits.csv";
  a.click();
}

export default function AdminDeposits() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [merchantId, setMerchantId] = useState("");
  const [page, setPage] = useState(1);

  const { data, isLoading } = useListTransactions({
    type: "deposit",
    status: status === "all" ? undefined : (status as any),
    search: search || undefined,
    merchantId: merchantId ? parseInt(merchantId) : undefined,
    page,
    limit: 20,
  });

  const stats = {
    total: data?.total ?? 0,
    pending: data?.stats?.pendingCount ?? 0,
    success: data?.stats?.successCount ?? 0,
    failed: data?.stats?.failedCount ?? 0,
    totalAmount: data?.stats?.depositVolume ?? 0,
  };

  const anyFilterActive = !!(search || status !== "all" || merchantId);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Deposits</h1>
          <p className="text-muted-foreground mt-1">Monitor all incoming deposits across merchants</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => exportCsv(data?.data ?? [])}>
          Export CSV
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-border/50 bg-card/50">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                <ArrowDownLeft className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Volume</p>
                <p className="text-lg font-bold font-mono">₹{stats.totalAmount.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card/50">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-amber-500/10 flex items-center justify-center">
                <Clock className="w-4 h-4 text-amber-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Pending</p>
                <p className="text-lg font-bold">{stats.pending}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card/50">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <CheckCircle className="w-4 h-4 text-emerald-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Successful</p>
                <p className="text-lg font-bold">{stats.success}</p>
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
                <p className="text-lg font-bold">{stats.failed}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter summary bar */}
      {anyFilterActive && (
        <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <span className="text-xs font-semibold text-violet-400 uppercase tracking-wider mr-1">Filter results</span>
            <div className="flex items-center gap-1.5 text-sm">
              <Hash className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="font-semibold text-foreground">
                {isLoading ? <span className="inline-block w-8 h-3.5 bg-muted/60 rounded animate-pulse" /> : (data?.total ?? 0).toLocaleString()}
              </span>
              <span className="text-muted-foreground">deposits</span>
            </div>
            <div className="flex items-center gap-1.5 text-sm">
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
              <span className="font-semibold text-emerald-400">
                {isLoading ? <span className="inline-block w-16 h-3.5 bg-muted/60 rounded animate-pulse" /> : `₹${(data?.stats?.depositVolume ?? 0).toLocaleString()}`}
              </span>
              <span className="text-muted-foreground">total amount</span>
            </div>
            <div className="flex items-center gap-1.5 text-sm">
              <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
              <span className="font-semibold text-green-400">
                {isLoading ? <span className="inline-block w-6 h-3.5 bg-muted/60 rounded animate-pulse" /> : (data?.stats?.successCount ?? 0).toLocaleString()}
              </span>
              <span className="text-muted-foreground">success</span>
            </div>
            <div className="flex items-center gap-1.5 text-sm">
              <Clock className="w-3.5 h-3.5 text-amber-400" />
              <span className="font-semibold text-amber-400">
                {isLoading ? <span className="inline-block w-6 h-3.5 bg-muted/60 rounded animate-pulse" /> : (data?.stats?.pendingCount ?? 0).toLocaleString()}
              </span>
              <span className="text-muted-foreground">pending</span>
            </div>
            <div className="flex items-center gap-1.5 text-sm">
              <XCircle className="w-3.5 h-3.5 text-rose-400" />
              <span className="font-semibold text-rose-400">
                {isLoading ? <span className="inline-block w-6 h-3.5 bg-muted/60 rounded animate-pulse" /> : (data?.stats?.failedCount ?? 0).toLocaleString()}
              </span>
              <span className="text-muted-foreground">failed</span>
            </div>
          </div>
        </div>
      )}

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search by UTR or reference..."
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
              />
            </div>
            <Input
              className="w-[160px]"
              placeholder="Merchant ID"
              value={merchantId}
              onChange={e => { setMerchantId(e.target.value); setPage(1); }}
            />
            <Select value={status} onValueChange={v => { setStatus(v); setPage(1); }}>
              <SelectTrigger className="w-[150px]"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="success">Success</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
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
                <TableHead>Amount</TableHead>
                <TableHead>UTR</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
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
              ) : !data?.data?.length ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-12">
                    No deposit transactions found
                  </TableCell>
                </TableRow>
              ) : data.data.map(t => (
                <TableRow key={t.id}>
                  <TableCell className="font-mono text-xs text-muted-foreground">#{t.id}</TableCell>
                  <TableCell className="font-medium">{t.merchantName ?? `Merchant #${t.merchantId}`}</TableCell>
                  <TableCell className="font-mono font-semibold text-emerald-400">
                    ₹{Number(t.amount).toLocaleString()}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{t.utr}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{t.referenceId ?? "—"}</TableCell>
                  <TableCell><StatusBadge status={t.status} /></TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {format(new Date(t.createdAt), "MMM d, yyyy HH:mm")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {data && data.total > 20 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{data.total} total deposits</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
              Previous
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page * 20 >= data.total}>
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
