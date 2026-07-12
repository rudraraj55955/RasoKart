import { useState } from "react";
import { format } from "date-fns";
import { useListAdminRazorpayOrders } from "@workspace/api-client-react";
import { getToken } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Search, CreditCard, FileDown } from "lucide-react";

const authHeader = () => ({ Authorization: `Bearer ${getToken()}` });

function statusColor(status?: string) {
  if (!status) return "bg-zinc-500/10 text-zinc-400 border-zinc-500/30";
  switch (status.toUpperCase()) {
    case "SUCCESS": return "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
    case "FAILED": return "bg-rose-500/10 text-rose-400 border-rose-500/30";
    case "PENDING": return "bg-amber-500/10 text-amber-400 border-amber-500/30";
    case "CREATED": return "bg-sky-500/10 text-sky-400 border-sky-500/30";
    default: return "bg-zinc-500/10 text-zinc-400 border-zinc-500/30";
  }
}

export default function AdminRazorpayTransactions() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);

  const { data, isLoading, isError } = useListAdminRazorpayOrders(
    {
      page,
      limit: 20,
      ...(status !== "all" ? { status } : {}),
      ...(search ? { search } : {}),
    },
    { request: { headers: authHeader() } },
  );

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;

  const handleExportCsv = () => {
    const token = getToken();
    const params = new URLSearchParams();
    if (status !== "all") params.set("status", status);
    const url = `/api/admin/razorpay/orders/export/csv?${params}`;
    const a = document.createElement("a");
    a.href = url;
    a.setAttribute("download", `razorpay-transactions-${new Date().toISOString().slice(0, 10)}.csv`);
    const link = document.createElement("a");
    link.href = url;
    const headers = new Headers({ Authorization: `Bearer ${token}` });
    fetch(url, { headers }).then(r => r.blob()).then(blob => {
      const objectUrl = URL.createObjectURL(blob);
      const a2 = document.createElement("a");
      a2.href = objectUrl;
      a2.download = `razorpay-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
      a2.click();
      URL.revokeObjectURL(objectUrl);
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-indigo-400" />
            Razorpay Transactions
          </h1>
          <p className="text-sm text-muted-foreground mt-1">All Razorpay payment orders across merchants</p>
        </div>
        <Button variant="outline" size="sm" onClick={handleExportCsv} disabled={!rows.length}>
          <FileDown className="w-3.5 h-3.5 mr-1.5" />Export CSV
        </Button>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder="Search order ID, payment ID…"
            className="pl-9 h-8 text-sm"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <Select value={status} onValueChange={v => { setStatus(v); setPage(1); }}>
          <SelectTrigger className="h-8 w-36 text-xs">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="CREATED">Created</SelectItem>
            <SelectItem value="PENDING">Pending</SelectItem>
            <SelectItem value="SUCCESS">Success</SelectItem>
            <SelectItem value="FAILED">Failed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">
            {isLoading ? "Loading…" : `${total.toLocaleString()} transaction${total !== 1 ? "s" : ""}`}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : isError ? (
            <div className="py-12 text-center text-sm text-destructive">Failed to load transactions</div>
          ) : !rows.length ? (
            <div className="py-12 text-center text-sm text-muted-foreground">No transactions found</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Internal ID</TableHead>
                    <TableHead className="text-xs">Razorpay Order</TableHead>
                    <TableHead className="text-xs">Merchant</TableHead>
                    <TableHead className="text-xs">Amount</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs">Method</TableHead>
                    <TableHead className="text-xs">UTR</TableHead>
                    <TableHead className="text-xs">Paid At</TableHead>
                    <TableHead className="text-xs">Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(row => (
                    <TableRow key={row.id}>
                      <TableCell className="font-mono text-xs">{row.internalOrderId ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs max-w-[140px] truncate" title={row.razorpayOrderId}>
                        {row.razorpayOrderId ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs">{row.merchantId ?? "—"}</TableCell>
                      <TableCell className="text-xs font-mono">
                        ₹{Number(row.amount ?? 0).toLocaleString()} {row.currency ?? "INR"}
                      </TableCell>
                      <TableCell>
                        <Badge className={`text-[10px] h-5 ${statusColor(row.status)}`}>
                          {row.status ?? "—"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{row.paymentMethod ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{row.utr ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {row.paidAt ? format(new Date(row.paidAt), "MMM d, yyyy HH:mm") : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {row.createdAt ? format(new Date(row.createdAt), "MMM d, yyyy HH:mm") : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {total > 20 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{total} total</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
              Previous
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page * 20 >= total}>
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
