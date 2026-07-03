import { useState } from "react";
import {
  useListWithdrawals,
  useApproveWithdrawal,
  useRejectWithdrawal,
  useRefreshWithdrawalStatus,
  useRetryWithdrawal,
  getListWithdrawalsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  CheckCircle,
  XCircle,
  ArrowUpRight,
  Clock,
  RefreshCw,
  RotateCcw,
  Lock,
  Send,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

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

export default function AdminPayouts() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [rejectId, setRejectId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [confirmApproveId, setConfirmApproveId] = useState<number | null>(null);
  const [confirmApproveAmount, setConfirmApproveAmount] = useState<number>(0);

  const { data, isLoading, isError } = useListWithdrawals({ status: status as any, page, limit: 20 });
  const approveMutation = useApproveWithdrawal();
  const rejectMutation = useRejectWithdrawal();
  const refreshMutation = useRefreshWithdrawalStatus();
  const retryMutation = useRetryWithdrawal();

  const invalidate = () => qc.invalidateQueries({ queryKey: getListWithdrawalsQueryKey() });

  const stats = {
    totalVolume: data?.stats?.totalVolume ?? 0,
    pendingCount: data?.stats?.pendingCount ?? 0,
    processingCount: data?.stats?.processingCount ?? 0,
    successCount: data?.stats?.successCount ?? 0,
    failedCount: data?.stats?.failedCount ?? 0,
    lockedAmount: data?.stats?.lockedAmount ?? 0,
  };

  const handleApprove = () => {
    if (!confirmApproveId) return;
    approveMutation.mutate(
      { id: confirmApproveId },
      {
        onSuccess: (result) => {
          const ts = (result as any)?.transferStatus;
          const fr = (result as any)?.failureReason as string | null | undefined;
          if (ts === "SUCCESS") toast.success("Payout approved and sent successfully");
          else if (fr?.startsWith("PAYOUT_CREDENTIAL_ERROR"))
            toast.error("Payout provider credentials invalid. Check payout Client ID / Secret in Gateway Settings.");
          else if (ts === "FAILED" || ts === "REVERSED") toast.warning("Payout approved but transfer failed — check status");
          else toast.success("Payout approved — processing with provider");
          setConfirmApproveId(null);
          invalidate();
        },
        onError: (e: any) => toast.error((e?.data as any)?.error ?? e?.message ?? "Failed to approve payout"),
      }
    );
  };

  const handleReject = () => {
    if (!rejectId || !rejectReason.trim()) return;
    rejectMutation.mutate(
      { id: rejectId, data: { reason: rejectReason } },
      {
        onSuccess: () => {
          toast.success("Payout rejected — funds released back to merchant");
          setRejectId(null);
          setRejectReason("");
          invalidate();
        },
        onError: (e: any) => toast.error((e?.data as any)?.error ?? e?.message ?? "Failed to reject payout"),
      }
    );
  };

  const handleRefreshStatus = (id: number) => {
    refreshMutation.mutate(
      { id },
      {
        onSuccess: (result) => {
          const ts = (result as any)?.transferStatus;
          toast.success(`Status updated: ${ts}`);
          invalidate();
        },
        onError: (e: any) => toast.error((e?.data as any)?.error ?? e?.message ?? "Failed to refresh status"),
      }
    );
  };

  const handleRetry = (id: number) => {
    retryMutation.mutate(
      { id },
      {
        onSuccess: (result) => {
          const ts = (result as any)?.transferStatus;
          if (ts === "SUCCESS") toast.success("Retry successful — payout sent");
          else toast.info(`Retry initiated — status: ${ts}`);
          invalidate();
        },
        onError: (e: any) => toast.error((e?.data as any)?.error ?? e?.message ?? "Failed to retry payout"),
      }
    );
  };

  const exportCsv = () => {
    if (!data?.data) return;
    const rows = [["ID", "Merchant", "Amount", "Mode", "Beneficiary", "Status", "Transfer Status", "UTR", "Date"]];
    data.data.forEach(w => {
      const dest = w.payoutMode === "UPI" ? (w.upiId ?? "") : `${w.bankName} ${w.bankAccount}`;
      rows.push([
        String(w.id),
        w.merchantName || "",
        String(w.amount),
        w.payoutMode,
        dest,
        w.status,
        w.transferStatus,
        w.utr ?? "",
        w.createdAt,
      ]);
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
          <p className="text-muted-foreground mt-1">Manage merchant payout requests</p>
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv} className="w-full sm:w-auto">
          Export CSV
        </Button>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <Card className="border-border/50 bg-card/50">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                <ArrowUpRight className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Volume</p>
                <p className="text-lg font-bold font-mono">₹{Number(stats.totalVolume).toLocaleString("en-IN")}</p>
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
                <p className="text-xs text-muted-foreground">Pending Approval</p>
                <p className="text-lg font-bold">{stats.pendingCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card/50">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-sky-500/10 flex items-center justify-center">
                <RefreshCw className="w-4 h-4 text-sky-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Processing</p>
                <p className="text-lg font-bold">{stats.processingCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card/50">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <Send className="w-4 h-4 text-emerald-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Sent</p>
                <p className="text-lg font-bold">{stats.successCount}</p>
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
                <p className="text-lg font-bold">{stats.failedCount}</p>
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
                <p className="text-xs text-muted-foreground">Locked</p>
                <p className="text-lg font-bold font-mono">₹{Number(stats.lockedAmount).toLocaleString("en-IN")}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <Select
            value={status}
            onValueChange={v => {
              setStatus(v);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="pending">Pending Approval</SelectItem>
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
                  <TableHead>Mode</TableHead>
                  <TableHead>Beneficiary</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>UTR</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading
                  ? Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        {Array.from({ length: 8 }).map((_, j) => (
                          <TableCell key={j}>
                            <div className="h-4 bg-muted/50 rounded animate-pulse" />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  : isError ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-10">
                          <div className="flex flex-col items-center gap-2 text-destructive">
                            <XCircle className="w-5 h-5" />
                            <p className="text-sm font-medium">Failed to load payouts</p>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : data?.data?.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center text-muted-foreground py-10">
                          No payouts found
                        </TableCell>
                      </TableRow>
                    ) : (
                      data?.data?.map(w => {
                        const ds = getDisplayStatus(w.status as PayoutStatus, w.transferStatus as TransferStatus);
                        const isProcessing =
                          w.status === "approved" &&
                          ["NOT_STARTED", "INITIATED", "PENDING"].includes(w.transferStatus);
                        const isFailed =
                          w.status === "approved" &&
                          ["FAILED", "REVERSED", "INITIATED"].includes(w.transferStatus);
                        const beneficiary =
                          w.payoutMode === "UPI"
                            ? w.upiId ?? "—"
                            : `${w.bankName} ···${(w.bankAccount ?? "").slice(-4)}`;
                        return (
                          <TableRow key={w.id}>
                            <TableCell className="font-medium">{w.merchantName || "—"}</TableCell>
                            <TableCell className="text-right font-mono font-semibold">
                              ₹{Number(w.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="font-mono text-xs">
                                {w.payoutMode}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground max-w-[150px] truncate">
                              {beneficiary}
                            </TableCell>
                            <TableCell>
                              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${ds.color}`}>
                                {ds.label}
                              </span>
                              {w.rejectionReason && (
                                <p className="text-xs text-muted-foreground mt-0.5 max-w-[140px] truncate" title={w.rejectionReason}>
                                  {w.rejectionReason}
                                </p>
                              )}
                              {w.failureReason && (
                                <p
                                  className="text-xs text-rose-400 mt-0.5 max-w-[160px] truncate"
                                  title={
                                    w.failureReason.startsWith("PAYOUT_CREDENTIAL_ERROR")
                                      ? "Payout provider credentials invalid. Check payout Client ID / Secret in Gateway Settings."
                                      : "Payout failed. Please retry or contact support."
                                  }
                                >
                                  {w.failureReason.startsWith("PAYOUT_CREDENTIAL_ERROR")
                                    ? "⚠ Payout provider credentials invalid — fix in Gateway Settings"
                                    : "Payout failed. Please retry or contact support."}
                                </p>
                              )}
                            </TableCell>
                            <TableCell className="font-mono text-xs text-muted-foreground">
                              {w.utr ?? "—"}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                              {format(new Date(w.createdAt), "MMM d, yyyy")}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1.5">
                                {w.status === "pending" && (
                                  <>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="text-emerald-500 hover:text-emerald-400 hover:bg-emerald-500/10"
                                      onClick={() => {
                                        setConfirmApproveId(w.id);
                                        setConfirmApproveAmount(Number(w.amount));
                                      }}
                                      disabled={approveMutation.isPending}
                                    >
                                      <CheckCircle className="w-4 h-4 mr-1" />
                                      Approve
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="text-rose-500 hover:text-rose-400 hover:bg-rose-500/10"
                                      onClick={() => {
                                        setRejectId(w.id);
                                        setRejectReason("");
                                      }}
                                    >
                                      <XCircle className="w-4 h-4 mr-1" />
                                      Reject
                                    </Button>
                                  </>
                                )}
                                {isProcessing && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="text-sky-500 hover:text-sky-400 hover:bg-sky-500/10"
                                    onClick={() => handleRefreshStatus(w.id)}
                                    disabled={refreshMutation.isPending}
                                  >
                                    <RefreshCw className={`w-4 h-4 mr-1 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
                                    Refresh
                                  </Button>
                                )}
                                {isFailed && (
                                  w.failureReason?.startsWith("PAYOUT_CREDENTIAL_ERROR") ? (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="text-rose-500 hover:text-rose-400 hover:bg-rose-500/10"
                                      onClick={() => handleRetry(w.id)}
                                      disabled={retryMutation.isPending}
                                      title="Payout provider credentials invalid. Fix in Gateway Settings → Payout Gateway before retrying."
                                    >
                                      <AlertTriangle className="w-4 h-4 mr-1" />
                                      Retry (fix creds first)
                                    </Button>
                                  ) : (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="text-amber-500 hover:text-amber-400 hover:bg-amber-500/10"
                                      onClick={() => handleRetry(w.id)}
                                      disabled={retryMutation.isPending}
                                    >
                                      <RotateCcw className="w-4 h-4 mr-1" />
                                      Retry
                                    </Button>
                                  )
                                )}
                                {w.status !== "pending" && !isProcessing && !isFailed && (
                                  <span className="text-muted-foreground text-xs">—</span>
                                )}
                              </div>
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

      {/* Approve confirmation dialog */}
      <Dialog open={!!confirmApproveId} onOpenChange={() => setConfirmApproveId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve Payout</DialogTitle>
          </DialogHeader>
          <div className="py-3 space-y-2">
            <p className="text-sm text-muted-foreground">
              This will approve the payout of{" "}
              <span className="font-mono font-semibold text-foreground">
                ₹{confirmApproveAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
              </span>{" "}
              and dispatch it to the payment provider. Funds will be released from the merchant's hold balance.
            </p>
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
              <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-400">
                This action cannot be undone. If the transfer fails, you can retry it from the payout list.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmApproveId(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleApprove}
              disabled={approveMutation.isPending}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              <CheckCircle className="w-4 h-4 mr-2" />
              {approveMutation.isPending ? "Approving..." : "Approve & Send"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject dialog */}
      <Dialog open={!!rejectId} onOpenChange={() => setRejectId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Payout</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Rejecting will release the locked funds back to the merchant's available balance.
            </p>
            <div>
              <Label>Reason for rejection</Label>
              <Textarea
                className="mt-1.5"
                placeholder="Reason for rejection..."
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={!rejectReason.trim() || rejectMutation.isPending}
            >
              {rejectMutation.isPending ? "Rejecting..." : "Reject Payout"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
