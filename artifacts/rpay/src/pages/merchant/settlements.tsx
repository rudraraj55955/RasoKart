import { useState } from "react";
import { useListSettlements } from "@workspace/api-client-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { format } from "date-fns";

export default function MerchantSettlements() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useListSettlements({ page, limit: 20 });

  const exportCsv = () => {
    if (!data?.data) return;
    const rows = [["ID", "Amount", "Currency", "Status", "From", "To", "Transactions", "Created"]];
    data.data.forEach(s => rows.push([String(s.id), String(s.amount), s.currency, s.status, s.periodFrom, s.periodTo, String(s.transactionCount), s.createdAt]));
    const csv = rows.map(r => r.join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv])); a.download = "settlements.csv"; a.click();
  };

  const total = data?.data?.reduce((a, s) => a + Number(s.amount), 0) || 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-3xl font-bold tracking-tight">Settlements</h1><p className="text-muted-foreground mt-1">Your settlement history</p></div>
        <Button variant="outline" size="sm" onClick={exportCsv}>Export CSV</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
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
                <TableRow key={i}>{Array.from({ length: 6 }).map((_, j) => <TableCell key={j}><div className="h-4 bg-muted/50 rounded animate-pulse" /></TableCell>)}</TableRow>
              )) : data?.data?.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-10">No settlements yet</TableCell></TableRow>
              ) : data?.data?.map(s => (
                <TableRow key={s.id}>
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
        <div className="flex justify-between items-center">
          <span className="text-sm text-muted-foreground">Total: <span className="font-semibold text-foreground">₹{total.toLocaleString()}</span></span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p-1))} disabled={page === 1}>Previous</Button>
            <Button variant="outline" size="sm" onClick={() => setPage(p => p+1)} disabled={page * 20 >= data.total}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}
