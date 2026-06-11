import { useState } from "react";
import { useListWithdrawals, useApproveWithdrawal, useRejectWithdrawal, getListWithdrawalsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { CheckCircle, XCircle, ArrowUpRight, Clock } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

export default function AdminWithdrawals() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [rejectId, setRejectId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const { data, isLoading } = useListWithdrawals({ status: status as any, page, limit: 20 });
  const approveMutation = useApproveWithdrawal();
  const rejectMutation = useRejectWithdrawal();

  const stats = {
    totalVolume: data?.stats?.totalVolume ?? 0,
    pendingCount: data?.stats?.pendingCount ?? 0,
    approvedCount: data?.stats?.approvedCount ?? 0,
    rejectedCount: data?.stats?.rejectedCount ?? 0,
  };

  const handleApprove = (id: number) => {
    approveMutation.mutate({ id }, {
      onSuccess: () => { toast.success("Withdrawal approved"); qc.invalidateQueries({ queryKey: getListWithdrawalsQueryKey() }); },
      onError: () => toast.error("Failed"),
    });
  };

  const handleReject = () => {
    if (!rejectId || !rejectReason.trim()) return;
    rejectMutation.mutate({ id: rejectId, data: { reason: rejectReason } }, {
      onSuccess: () => { toast.success("Withdrawal rejected"); setRejectId(null); setRejectReason(""); qc.invalidateQueries({ queryKey: getListWithdrawalsQueryKey() }); },
      onError: () => toast.error("Failed"),
    });
  };

  const exportCsv = () => {
    if (!data?.data) return;
    const rows = [["ID", "Merchant", "Amount", "Bank", "Account", "IFSC", "Status", "Date"]];
    data.data.forEach(w => rows.push([String(w.id), w.merchantName || "", String(w.amount), w.bankName, w.bankAccount, w.ifscCode, w.status, w.createdAt]));
    const csv = rows.map(r => r.join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv])); a.download = "withdrawals.csv"; a.click();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div><h1 className="text-3xl font-bold tracking-tight">Withdrawals</h1><p className="text-muted-foreground mt-1">Manage withdrawal requests</p></div>
        <Button variant="outline" size="sm" onClick={exportCsv} className="w-full sm:w-auto">Export CSV</Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-border/50 bg-card/50">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                <ArrowUpRight className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Volume</p>
                <p className="text-lg font-bold font-mono">₹{stats.totalVolume.toLocaleString()}</p>
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
                <p className="text-lg font-bold">{stats.pendingCount}</p>
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
                <p className="text-xs text-muted-foreground">Approved</p>
                <p className="text-lg font-bold">{stats.approvedCount}</p>
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
                <p className="text-xs text-muted-foreground">Rejected</p>
                <p className="text-lg font-bold">{stats.rejectedCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <Select value={status} onValueChange={v => { setStatus(v); setPage(1); }}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Merchant</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Bank / Account</TableHead>
                <TableHead>IFSC</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>{Array.from({ length: 7 }).map((_, j) => <TableCell key={j}><div className="h-4 bg-muted/50 rounded animate-pulse" /></TableCell>)}</TableRow>
              )) : data?.data?.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-10">No withdrawals found</TableCell></TableRow>
              ) : data?.data?.map(w => (
                <TableRow key={w.id}>
                  <TableCell className="font-medium">{w.merchantName || "—"}</TableCell>
                  <TableCell className="text-right font-mono font-semibold">₹{Number(w.amount).toLocaleString()}</TableCell>
                  <TableCell>
                    <div className="text-sm">{w.bankName}</div>
                    <div className="text-xs text-muted-foreground font-mono">{w.bankAccount}</div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{w.ifscCode}</TableCell>
                  <TableCell><StatusBadge status={w.status} /></TableCell>
                  <TableCell className="text-sm text-muted-foreground">{format(new Date(w.createdAt), "MMM d, yyyy")}</TableCell>
                  <TableCell className="text-right">
                    {w.status === "pending" && (
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="ghost" className="text-emerald-500 hover:text-emerald-400 hover:bg-emerald-500/10" onClick={() => handleApprove(w.id)} disabled={approveMutation.isPending}><CheckCircle className="w-4 h-4 mr-1" />Approve</Button>
                        <Button size="sm" variant="ghost" className="text-rose-500 hover:text-rose-400 hover:bg-rose-500/10" onClick={() => { setRejectId(w.id); setRejectReason(""); }}><XCircle className="w-4 h-4 mr-1" />Reject</Button>
                      </div>
                    )}
                    {w.status !== "pending" && <span className="text-muted-foreground text-xs">&mdash;</span>}
                  </TableCell>
                </TableRow>
              ))}
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

      <Dialog open={!!rejectId} onOpenChange={() => setRejectId(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject Withdrawal</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2"><Label>Reason</Label><Textarea placeholder="Reason for rejection..." value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={3} /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleReject} disabled={!rejectReason.trim() || rejectMutation.isPending}>Reject</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
