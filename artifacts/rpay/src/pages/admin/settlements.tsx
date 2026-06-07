import { useState } from "react";
import { useListSettlements } from "@workspace/api-client-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { format } from "date-fns";

export default function AdminSettlements() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);

  const { data, isLoading } = useListSettlements({ dateFrom: dateFrom || undefined, dateTo: dateTo || undefined, page, limit: 20 });

  const exportCsv = () => {
    if (!data?.data) return;
    const rows = [["ID", "Merchant", "Amount", "Currency", "Status", "From", "To", "Transactions", "Created"]];
    data.data.forEach(s => rows.push([String(s.id), s.merchantName || "", String(s.amount), s.currency, s.status, s.periodFrom, s.periodTo, String(s.transactionCount), s.createdAt]));
    const csv = rows.map(r => r.join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv])); a.download = "settlements.csv"; a.click();
  };

  const total = data?.data?.reduce((acc, s) => acc + Number(s.amount), 0) || 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-3xl font-bold tracking-tight">Settlements</h1><p className="text-muted-foreground mt-1">Settlement reports by period</p></div>
        <Button variant="outline" size="sm" onClick={exportCsv}>Export CSV</Button>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">From</span>
              <Input type="date" className="w-40" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">To</span>
              <Input type="date" className="w-40" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }} />
            </div>
            {(dateFrom || dateTo) && <Button variant="ghost" size="sm" onClick={() => { setDateFrom(""); setDateTo(""); }}>Clear</Button>}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Merchant</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Currency</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Period</TableHead>
                <TableHead className="text-right">Transactions</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>{Array.from({ length: 7 }).map((_, j) => <TableCell key={j}><div className="h-4 bg-muted/50 rounded animate-pulse" /></TableCell>)}</TableRow>
              )) : data?.data?.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-10">No settlements found</TableCell></TableRow>
              ) : data?.data?.map(s => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.merchantName || "—"}</TableCell>
                  <TableCell className="text-right font-mono font-semibold">₹{Number(s.amount).toLocaleString()}</TableCell>
                  <TableCell>{s.currency}</TableCell>
                  <TableCell><StatusBadge status={s.status} /></TableCell>
                  <TableCell className="text-sm">{s.periodFrom} — {s.periodTo}</TableCell>
                  <TableCell className="text-right">{s.transactionCount}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{format(new Date(s.createdAt), "MMM d, yyyy")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {data && data.data.length > 0 && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            Showing {data.data.length} of {data.total} · Total: <span className="font-semibold text-foreground">₹{total.toLocaleString()}</span>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button>
            <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page * 20 >= data.total}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}
