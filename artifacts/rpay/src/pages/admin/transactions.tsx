import { useState } from "react";
import { useListTransactions, useSearchByUtr } from "@workspace/api-client-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, X } from "lucide-react";
import { format } from "date-fns";

export default function AdminTransactions() {
  const [search, setSearch] = useState("");
  const [utrSearch, setUtrSearch] = useState("");
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);

  const { data, isLoading } = useListTransactions({ type: type as any, status: status as any, search, page, limit: 20 });
  const { data: utrResult, isLoading: utrLoading, error: utrError } = useSearchByUtr(
    { utr: utrSearch || "" },
    { query: { enabled: !!utrSearch } as any }
  );

  const exportCsv = () => {
    if (!data?.data) return;
    const rows = [["ID", "UTR", "Merchant", "Type", "Status", "Amount", "Currency", "Reference", "Date"]];
    data.data.forEach(t => rows.push([String(t.id), t.utr, t.merchantName || "", t.type, t.status, String(t.amount), t.currency, t.referenceId || "", t.createdAt]));
    const csv = rows.map(r => r.join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv])); a.download = "transactions.csv"; a.click();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-3xl font-bold tracking-tight">Transactions</h1><p className="text-muted-foreground mt-1">Complete transaction history</p></div>
        <Button variant="outline" size="sm" onClick={exportCsv}>Export CSV</Button>
      </div>

      {/* UTR Search */}
      <Card>
        <CardHeader className="pb-3 pt-4">
          <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">UTR / Reference Search</p>
        </CardHeader>
        <CardContent className="pb-4">
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input className="pl-9 font-mono" placeholder="Enter UTR number..." value={utrSearch} onChange={e => setUtrSearch(e.target.value)} />
            </div>
            {utrSearch && <Button variant="ghost" size="icon" onClick={() => setUtrSearch("")}><X className="w-4 h-4" /></Button>}
          </div>
          {utrSearch && (
            <div className="mt-3 p-3 rounded-lg border bg-card/50">
              {utrLoading && <p className="text-sm text-muted-foreground">Searching...</p>}
              {utrError && <p className="text-sm text-rose-500">Transaction not found for UTR: {utrSearch}</p>}
              {utrResult && (
                <div className="flex flex-wrap gap-4 text-sm">
                  <div><span className="text-muted-foreground">UTR:</span> <span className="font-mono font-medium">{utrResult.utr}</span></div>
                  <div><span className="text-muted-foreground">Amount:</span> <span className="font-semibold">₹{Number(utrResult.amount).toLocaleString()}</span></div>
                  <div><span className="text-muted-foreground">Type:</span> <Badge variant="outline">{utrResult.type}</Badge></div>
                  <div><span className="text-muted-foreground">Status:</span> <StatusBadge status={utrResult.status} /></div>
                  <div><span className="text-muted-foreground">Date:</span> {format(new Date(utrResult.createdAt), "MMM d, yyyy HH:mm")}</div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search UTR or reference..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
            </div>
            <Select value={type} onValueChange={v => { setType(v); setPage(1); }}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="deposit">Deposit</SelectItem>
                <SelectItem value="withdrawal">Withdrawal</SelectItem>
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={v => { setStatus(v); setPage(1); }}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
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
                <TableHead>UTR</TableHead>
                <TableHead>Merchant</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>{Array.from({ length: 7 }).map((_, j) => <TableCell key={j}><div className="h-4 bg-muted/50 rounded animate-pulse" /></TableCell>)}</TableRow>
                ))
              ) : data?.data?.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-10">No transactions found</TableCell></TableRow>
              ) : data?.data?.map(tx => (
                <TableRow key={tx.id}>
                  <TableCell className="font-mono text-xs">{tx.utr}</TableCell>
                  <TableCell className="text-sm">{tx.merchantName || "—"}</TableCell>
                  <TableCell><Badge variant="outline" className="text-xs">{tx.type}</Badge></TableCell>
                  <TableCell><StatusBadge status={tx.status} /></TableCell>
                  <TableCell className="text-right font-mono font-medium">₹{Number(tx.amount).toLocaleString()}</TableCell>
                  <TableCell className="text-xs text-muted-foreground font-mono">{tx.referenceId || "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{format(new Date(tx.createdAt), "MMM d, HH:mm")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {data && data.total > 20 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{data.total} total transactions</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button>
            <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page * 20 >= data.total}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}
