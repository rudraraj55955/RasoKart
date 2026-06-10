import { useState } from "react";
import { useListWithdrawals, useCreateWithdrawal, getListWithdrawalsQueryKey, useGetMyPlanUsage } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, AlertTriangle, TrendingUp } from "lucide-react";
import { Link } from "wouter";
import { toast } from "sonner";
import { format } from "date-fns";

export default function MerchantWithdrawals() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ amount: "", bankAccount: "", bankName: "", ifscCode: "", accountHolder: "" });

  const { data, isLoading } = useListWithdrawals({ page, limit: 20 });
  const { data: usage } = useGetMyPlanUsage();
  const createMutation = useCreateWithdrawal();

  const payoutUsed = usage?.payout?.used ?? 0;
  const payoutLimit = usage?.payout?.limit ?? 0;
  const isAtLimit = payoutLimit > 0 && payoutUsed >= payoutLimit;
  const payoutPct = payoutLimit > 0 ? Math.min(100, Math.round((payoutUsed / payoutLimit) * 100)) : 0;

  const handleSubmit = () => {
    if (!form.amount || !form.bankAccount || !form.bankName || !form.ifscCode || !form.accountHolder) {
      toast.error("All fields are required");
      return;
    }
    createMutation.mutate({
      data: { ...form, amount: parseFloat(form.amount) }
    }, {
      onSuccess: () => {
        toast.success("Withdrawal request submitted");
        setOpen(false);
        setForm({ amount: "", bankAccount: "", bankName: "", ifscCode: "", accountHolder: "" });
        qc.invalidateQueries({ queryKey: getListWithdrawalsQueryKey() });
      },
      onError: () => toast.error("Failed to submit withdrawal"),
    });
  };

  const exportCsv = () => {
    if (!data?.data) return;
    const rows = [["ID", "Amount", "Bank", "Account", "IFSC", "Holder", "Status", "Date"]];
    data.data.forEach(w => rows.push([String(w.id), String(w.amount), w.bankName, w.bankAccount, w.ifscCode, w.accountHolder, w.status, w.createdAt]));
    const csv = rows.map(r => r.join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv])); a.download = "withdrawals.csv"; a.click();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-3xl font-bold tracking-tight">Withdrawals</h1><p className="text-muted-foreground mt-1">Request and track your withdrawals</p></div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv}>Export CSV</Button>
          <Button onClick={() => setOpen(true)} disabled={isAtLimit}><Plus className="w-4 h-4 mr-2" />New Request</Button>
        </div>
      </div>

      {usage && (
        isAtLimit ? (
          <Card className="border-destructive/50 bg-destructive/5">
            <CardContent className="flex items-start gap-3 py-4">
              <AlertTriangle className="w-5 h-5 text-destructive mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-destructive">Monthly payout limit reached</p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  You've used all {payoutLimit} payout{payoutLimit !== 1 ? "s" : ""} for this month on your {usage.planName ?? "current"} plan. New withdrawal requests will be available when the month resets.
                </p>
                <Link href="/merchant/plan" className="inline-block mt-2 text-sm font-medium text-primary hover:underline">
                  Upgrade plan for more payouts →
                </Link>
              </div>
            </CardContent>
          </Card>
        ) : payoutLimit > 0 ? (
          <Card className="border-border/50">
            <CardContent className="flex items-center gap-4 py-4">
              <TrendingUp className="w-5 h-5 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-medium">Payouts this month</span>
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {payoutUsed} of {payoutLimit} used
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${payoutPct >= 80 ? "bg-amber-500" : "bg-primary"}`}
                    style={{ width: `${payoutPct}%` }}
                  />
                </div>
              </div>
              <span className="text-sm font-semibold tabular-nums shrink-0">
                {payoutLimit - payoutUsed} left
              </span>
            </CardContent>
          </Card>
        ) : null
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Bank / Account</TableHead>
                <TableHead>IFSC</TableHead>
                <TableHead>Account Holder</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>{Array.from({ length: 6 }).map((_, j) => <TableCell key={j}><div className="h-4 bg-muted/50 rounded animate-pulse" /></TableCell>)}</TableRow>
              )) : data?.data?.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-10">No withdrawal requests yet</TableCell></TableRow>
              ) : data?.data?.map(w => (
                <TableRow key={w.id}>
                  <TableCell className="text-right font-mono font-semibold">₹{Number(w.amount).toLocaleString()}</TableCell>
                  <TableCell>
                    <div className="text-sm">{w.bankName}</div>
                    <div className="text-xs text-muted-foreground font-mono">{w.bankAccount}</div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{w.ifscCode}</TableCell>
                  <TableCell>{w.accountHolder}</TableCell>
                  <TableCell><StatusBadge status={w.status} /></TableCell>
                  <TableCell className="text-sm text-muted-foreground">{format(new Date(w.createdAt), "MMM d, yyyy")}</TableCell>
                </TableRow>
              ))}
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

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>New Withdrawal Request</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Amount (INR)</Label>
              <Input className="mt-1.5 font-mono" type="number" placeholder="Enter amount..." value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
            </div>
            <div>
              <Label>Bank Name</Label>
              <Input className="mt-1.5" placeholder="e.g. HDFC Bank" value={form.bankName} onChange={e => setForm(f => ({ ...f, bankName: e.target.value }))} />
            </div>
            <div>
              <Label>Account Number</Label>
              <Input className="mt-1.5 font-mono" placeholder="Bank account number" value={form.bankAccount} onChange={e => setForm(f => ({ ...f, bankAccount: e.target.value }))} />
            </div>
            <div>
              <Label>IFSC Code</Label>
              <Input className="mt-1.5 font-mono uppercase" placeholder="e.g. HDFC0001234" value={form.ifscCode} onChange={e => setForm(f => ({ ...f, ifscCode: e.target.value.toUpperCase() }))} />
            </div>
            <div>
              <Label>Account Holder Name</Label>
              <Input className="mt-1.5" placeholder="As per bank records" value={form.accountHolder} onChange={e => setForm(f => ({ ...f, accountHolder: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={createMutation.isPending}>Submit Request</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
