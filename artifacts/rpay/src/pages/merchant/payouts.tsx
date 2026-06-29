import { useState } from "react";
import {
  useListWithdrawals,
  useCreateWithdrawal,
  getListWithdrawalsQueryKey,
  useGetMyPlanUsage,
} from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, AlertTriangle, TrendingUp, Wallet, Lock, CheckCircle2, Clock, XCircle } from "lucide-react";
import { Link } from "wouter";
import { toast } from "sonner";
import { format } from "date-fns";

const TOKEN_KEY = "rasokart_token";
async function apiGet(path: string) {
  const token = localStorage.getItem(TOKEN_KEY);
  const res = await fetch(`/api${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

type PayoutStatus = "pending" | "approved" | "rejected";
type TransferStatus = "NOT_STARTED" | "INITIATED" | "PENDING" | "SUCCESS" | "FAILED" | "REVERSED";

function getDisplayStatus(status: PayoutStatus, transferStatus: TransferStatus) {
  if (status === "rejected") return { label: "Rejected", color: "text-rose-400 bg-rose-500/10" };
  if (status === "pending") return { label: "Pending Approval", color: "text-amber-400 bg-amber-500/10" };
  if (status === "approved") {
    if (transferStatus === "SUCCESS") return { label: "Sent", color: "text-emerald-400 bg-emerald-500/10" };
    if (transferStatus === "FAILED" || transferStatus === "REVERSED")
      return { label: "Failed", color: "text-rose-400 bg-rose-500/10" };
    return { label: "Processing", color: "text-sky-400 bg-sky-500/10" };
  }
  return { label: status, color: "text-muted-foreground bg-muted/30" };
}

const PAYOUT_MODES = ["IMPS", "NEFT", "RTGS", "UPI"] as const;

export default function MerchantPayouts() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    amount: "",
    payoutMode: "IMPS",
    accountNumber: "",
    bankName: "",
    ifscCode: "",
    accountHolderName: "",
    upiId: "",
    remarks: "",
  });

  const { data, isLoading, isError } = useListWithdrawals({ page, limit: 20 });
  const { data: usage } = useGetMyPlanUsage();
  const { data: wallet } = useQuery({
    queryKey: ["merchant-wallet"],
    queryFn: () => apiGet("/wallets/me"),
  });
  const createMutation = useCreateWithdrawal();

  const payoutUsed = usage?.payout?.used ?? 0;
  const payoutLimit = usage?.payout?.limit ?? 0;
  const isAtLimit = payoutLimit > 0 && payoutUsed >= payoutLimit;
  const payoutPct = payoutLimit > 0 ? Math.min(100, Math.round((payoutUsed / payoutLimit) * 100)) : 0;

  const availableBalance: number = wallet?.availableBalance ?? 0;
  const holdBalance: number = wallet?.holdBalance ?? 0;
  const totalPayout: number = wallet?.totalPayout ?? 0;

  const resetForm = () =>
    setForm({ amount: "", payoutMode: "IMPS", accountNumber: "", bankName: "", ifscCode: "", accountHolderName: "", upiId: "", remarks: "" });

  const handleSubmit = () => {
    const amt = parseFloat(form.amount);
    if (!form.amount || isNaN(amt) || amt <= 0) {
      toast.error("Enter a valid amount");
      return;
    }
    if (amt > availableBalance) {
      toast.error("Amount exceeds your available balance");
      return;
    }
    if (form.payoutMode === "UPI") {
      if (!form.upiId.trim()) { toast.error("UPI ID is required"); return; }
    } else {
      if (!form.accountNumber || !form.bankName || !form.ifscCode || !form.accountHolderName) {
        toast.error("All bank details are required");
        return;
      }
    }
    createMutation.mutate(
      {
        data: {
          amount: amt,
          payoutMode: form.payoutMode as any,
          accountNumber: form.payoutMode !== "UPI" ? form.accountNumber : undefined,
          bankName: form.payoutMode !== "UPI" ? form.bankName : undefined,
          ifscCode: form.payoutMode !== "UPI" ? form.ifscCode : undefined,
          accountHolderName: form.payoutMode !== "UPI" ? form.accountHolderName : undefined,
          upiId: form.payoutMode === "UPI" ? form.upiId : undefined,
          remarks: form.remarks.trim() || undefined,
        },
      },
      {
        onSuccess: () => {
          toast.success("Payout request submitted");
          setOpen(false);
          resetForm();
          qc.invalidateQueries({ queryKey: getListWithdrawalsQueryKey() });
          qc.invalidateQueries({ queryKey: ["merchant-wallet"] });
        },
        onError: (e: any) => {
          // ApiError (custom-fetch.ts) stores parsed JSON at e.data, not e.response.data
          const msg =
            (e?.data as any)?.error ??
            e?.message ??
            "Failed to submit payout request";
          toast.error(msg);
        },
      }
    );
  };

  const exportCsv = () => {
    if (!data?.data) return;
    const rows = [["ID", "Amount", "Mode", "Bank/UPI", "Status", "Transfer Status", "UTR", "Date"]];
    data.data.forEach(w => {
      const dest = w.payoutMode === "UPI" ? (w.upiId ?? "") : `${w.bankName} ${w.bankAccount}`;
      rows.push([String(w.id), String(w.amount), w.payoutMode, dest, w.status, w.transferStatus, w.utr ?? "", w.createdAt]);
    });
    const csv = rows.map(r => r.map(v => `"${v}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv]));
    a.download = "payouts.csv";
    a.click();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Payouts</h1>
          <p className="text-muted-foreground mt-1">Request and track your payouts</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv}>
            Export CSV
          </Button>
          <Button onClick={() => setOpen(true)} disabled={isAtLimit}>
            <Plus className="w-4 h-4 mr-2" />
            New Payout Request
          </Button>
        </div>
      </div>

      {/* Wallet balance summary */}
      {wallet && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="border-border/50 bg-card/50">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                  <Wallet className="w-4 h-4 text-emerald-500" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Available</p>
                  <p className="text-lg font-bold font-mono">
                    ₹{Number(availableBalance).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50 bg-card/50">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-amber-500/10 flex items-center justify-center">
                  <Lock className="w-4 h-4 text-amber-500" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Locked (Processing)</p>
                  <p className="text-lg font-bold font-mono">
                    ₹{Number(holdBalance).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50 bg-card/50">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                  <CheckCircle2 className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Total Paid Out</p>
                  <p className="text-lg font-bold font-mono">
                    ₹{Number(totalPayout).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Plan limit banner */}
      {usage && (
        isAtLimit ? (
          <Card className="border-destructive/50 bg-destructive/5">
            <CardContent className="flex items-start gap-3 py-4">
              <AlertTriangle className="w-5 h-5 text-destructive mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-destructive">Monthly payout limit reached</p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  You've used all {payoutLimit} payout{payoutLimit !== 1 ? "s" : ""} for this month on your{" "}
                  {usage.planName ?? "current"} plan.
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
              <span className="text-sm font-semibold tabular-nums shrink-0">{payoutLimit - payoutUsed} left</span>
            </CardContent>
          </Card>
        ) : null
      )}

      {/* Payout history table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>Beneficiary</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>UTR / Reference</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading
                  ? Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        {Array.from({ length: 6 }).map((_, j) => (
                          <TableCell key={j}>
                            <div className="h-4 bg-muted/50 rounded animate-pulse" />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  : isError ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-10">
                          <div className="flex flex-col items-center gap-2 text-destructive">
                            <AlertTriangle className="w-5 h-5" />
                            <p className="text-sm font-medium">Failed to load payouts</p>
                            <p className="text-xs text-muted-foreground">Please refresh the page and try again.</p>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : data?.data?.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-10">
                          No payout requests yet
                        </TableCell>
                      </TableRow>
                    ) : (
                      data?.data?.map(w => {
                        const ds = getDisplayStatus(w.status as PayoutStatus, w.transferStatus as TransferStatus);
                        const beneficiary =
                          w.payoutMode === "UPI"
                            ? w.upiId ?? "—"
                            : `${w.bankName} ···${(w.bankAccount ?? "").slice(-4)}`;
                        return (
                          <TableRow key={w.id}>
                            <TableCell className="text-right font-mono font-semibold">
                              ₹{Number(w.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="font-mono text-xs">
                                {w.payoutMode}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground max-w-[180px] truncate">
                              {beneficiary}
                            </TableCell>
                            <TableCell>
                              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${ds.color}`}>
                                {ds.label}
                              </span>
                              {w.rejectionReason && (
                                <p className="text-xs text-muted-foreground mt-0.5 max-w-[160px] truncate" title={w.rejectionReason}>
                                  {w.rejectionReason}
                                </p>
                              )}
                              {(w.transferStatus === "FAILED" || w.transferStatus === "REVERSED") && w.failureReason && (
                                <p className="text-xs text-rose-400 mt-0.5 max-w-[160px] truncate" title={w.failureReason}>
                                  {w.failureReason}
                                </p>
                              )}
                            </TableCell>
                            <TableCell className="font-mono text-xs text-muted-foreground">
                              {w.utr ?? "—"}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                              {format(new Date(w.createdAt), "MMM d, yyyy")}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {data && data.total > 20 && (
        <div className="flex justify-between items-center">
          <span className="text-sm text-muted-foreground">{data.total} total</span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => p + 1)}
              disabled={page * 20 >= data.total}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* New Payout Request Dialog */}
      <Dialog open={open} onOpenChange={v => { setOpen(v); if (!v) resetForm(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New Payout Request</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Amount (INR)</Label>
              <Input
                className="mt-1.5 font-mono"
                type="number"
                placeholder="Enter amount..."
                value={form.amount}
                onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
              />
              {wallet && (
                <p className="text-xs text-muted-foreground mt-1">
                  Available: ₹{Number(availableBalance).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </p>
              )}
            </div>
            <div>
              <Label>Payout Mode</Label>
              <Select value={form.payoutMode} onValueChange={v => setForm(f => ({ ...f, payoutMode: v }))}>
                <SelectTrigger className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYOUT_MODES.map(m => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {form.payoutMode === "UPI" ? (
              <div>
                <Label>UPI ID</Label>
                <Input
                  className="mt-1.5 font-mono"
                  placeholder="e.g. merchant@upi"
                  value={form.upiId}
                  onChange={e => setForm(f => ({ ...f, upiId: e.target.value }))}
                />
              </div>
            ) : (
              <>
                <div>
                  <Label>Bank Name</Label>
                  <Input
                    className="mt-1.5"
                    placeholder="e.g. HDFC Bank"
                    value={form.bankName}
                    onChange={e => setForm(f => ({ ...f, bankName: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>Account Number</Label>
                  <Input
                    className="mt-1.5 font-mono"
                    placeholder="Bank account number"
                    value={form.accountNumber}
                    onChange={e => setForm(f => ({ ...f, accountNumber: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>IFSC Code</Label>
                  <Input
                    className="mt-1.5 font-mono uppercase"
                    placeholder="e.g. HDFC0001234"
                    value={form.ifscCode}
                    onChange={e => setForm(f => ({ ...f, ifscCode: e.target.value.toUpperCase() }))}
                  />
                </div>
                <div>
                  <Label>Account Holder Name</Label>
                  <Input
                    className="mt-1.5"
                    placeholder="As per bank records"
                    value={form.accountHolderName}
                    onChange={e => setForm(f => ({ ...f, accountHolderName: e.target.value }))}
                  />
                </div>
              </>
            )}

            <div>
              <Label>Remarks (optional)</Label>
              <Textarea
                className="mt-1.5"
                placeholder="Any notes for this payout..."
                rows={2}
                value={form.remarks}
                onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpen(false); resetForm(); }}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={createMutation.isPending}>
              {createMutation.isPending ? "Submitting..." : "Submit Request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
