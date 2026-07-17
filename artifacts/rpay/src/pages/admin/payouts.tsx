import { useState } from "react";
import {
  useListWithdrawals,
  useApproveWithdrawal,
  useRejectWithdrawal,
  useRefreshWithdrawalStatus,
  useRetryWithdrawal,
  useReregisterWithdrawalBeneficiary,
  useRepairWithdrawalBeneficiaryMapping,
  useCheckWithdrawalBeneficiaryStatus,
  getListWithdrawalsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
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
  UserCog,
  Eye,
  ShieldCheck,
  FileText,
} from "lucide-react";
import { PayoutSlipModal } from "@/components/payout-slip-modal";
import { toast } from "sonner";
import { format } from "date-fns";

type BeneficiaryStatus = "NOT_REGISTERED" | "VERIFIED" | "NOT_VERIFIED" | "FAILED";

function beneficiaryStatusBadge(bs?: BeneficiaryStatus | null) {
  switch (bs) {
    case "VERIFIED":
      return { label: "Verified", color: "text-emerald-400 bg-emerald-500/10" };
    case "NOT_VERIFIED":
      return { label: "Not Verified", color: "text-amber-400 bg-amber-500/10" };
    case "FAILED":
      return { label: "Failed", color: "text-rose-400 bg-rose-500/10" };
    case "NOT_REGISTERED":
    default:
      return { label: "Not Registered", color: "text-muted-foreground bg-muted/30" };
  }
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

export default function AdminPayouts() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [rejectId, setRejectId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectReasonError, setRejectReasonError] = useState("");
  const [confirmApproveId, setConfirmApproveId] = useState<number | null>(null);
  const [confirmApproveAmount, setConfirmApproveAmount] = useState<number>(0);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [slipPayoutId, setSlipPayoutId] = useState<number | null>(null);

  const { data, isLoading, isError } = useListWithdrawals({ status: status as any, page, limit: 20 });
  const approveMutation = useApproveWithdrawal();
  const rejectMutation = useRejectWithdrawal();
  const refreshMutation = useRefreshWithdrawalStatus();
  const retryMutation = useRetryWithdrawal();
  const reregisterMutation = useReregisterWithdrawalBeneficiary();
  const repairMappingMutation = useRepairWithdrawalBeneficiaryMapping();
  const checkBeneficiaryStatusMutation = useCheckWithdrawalBeneficiaryStatus();

  const invalidate = () => qc.invalidateQueries({ queryKey: getListWithdrawalsQueryKey() });

  const detailPayout = data?.data?.find(w => w.id === detailId) ?? null;

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
          else if (fr?.startsWith("PAYOUT_BENEFICIARY_ERROR") || fr === "Beneficiary setup failed. Please re-register beneficiary.")
            toast.error("Beneficiary setup failed. Please re-register beneficiary.");
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
    if (!rejectId) return;
    if (!rejectReason.trim() || rejectReason.trim().length < 3) {
      setRejectReasonError("Rejection reason is required (minimum 3 characters)");
      return;
    }
    setRejectReasonError("");
    rejectMutation.mutate(
      { id: rejectId, data: { reason: rejectReason } },
      {
        onSuccess: () => {
          toast.success("Payout rejected successfully");
          setRejectId(null);
          setRejectReason("");
          setRejectReasonError("");
          invalidate();
        },
        onError: (e: any) => toast.error((e?.data as any)?.error ?? e?.message ?? "Failed to reject payout"),
      }
    );
  };

  const openRejectModal = (id: number) => {
    setRejectId(id);
    setRejectReason("");
    setRejectReasonError("");
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
          const fr = (result as any)?.failureReason as string | null | undefined;
          if (ts === "SUCCESS") toast.success("Retry successful — payout sent");
          else if (fr?.startsWith("PAYOUT_CREDENTIAL_ERROR"))
            toast.error("Payout provider credentials invalid. Check payout Client ID / Secret in Gateway Settings.");
          else if (fr?.startsWith("PAYOUT_BENEFICIARY_ERROR") || fr === "Beneficiary setup failed. Please re-register beneficiary.")
            toast.error("Beneficiary setup failed. Please re-register beneficiary.");
          else toast.info(`Retry initiated — status: ${ts}`);
          invalidate();
        },
        onError: (e: any) => toast.error((e?.data as any)?.error ?? e?.message ?? "Failed to retry payout"),
      }
    );
  };

  const handleRepairBeneficiaryMapping = (id: number) => {
    repairMappingMutation.mutate(
      { id },
      {
        onSuccess: (result: any) => {
          if (result?.ok && result?.beneficiaryStatus === "VERIFIED") {
            toast.success("Beneficiary mapping repaired — provider record linked. You can retry the payout now.");
          } else if (result?.foundOnProvider) {
            toast.info("Beneficiary found on provider but may not be fully verified yet. Check status before retrying.");
          } else {
            toast.warning("Beneficiary not found on provider. Try Re-register Beneficiary to create a new registration.");
          }
          invalidate();
        },
        onError: (e: any) => toast.error((e?.data as any)?.error ?? e?.message ?? "Failed to repair beneficiary mapping"),
      }
    );
  };

  const handleReregisterBeneficiary = (id: number) => {
    reregisterMutation.mutate(
      { id },
      {
        onSuccess: (result: any) => {
          if (result?.beneficiaryStatus === "VERIFIED") toast.success("Beneficiary re-registered and verified — you can retry the payout now");
          else toast.error("Beneficiary setup failed. Please re-register beneficiary.");
          invalidate();
        },
        onError: (e: any) => toast.error((e?.data as any)?.error ?? e?.message ?? "Failed to re-register beneficiary"),
      }
    );
  };

  const handleCheckBeneficiaryStatus = (id: number) => {
    checkBeneficiaryStatusMutation.mutate(
      { id },
      {
        onSuccess: (result: any) => {
          toast.success(`Beneficiary status: ${result?.beneficiaryStatus ?? "unknown"}`);
          invalidate();
        },
        onError: (e: any) => toast.error((e?.data as any)?.error ?? e?.message ?? "Failed to check beneficiary status"),
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

      {/* Mobile cards — status filter + card list */}
      <div className="md:hidden space-y-3">
        <Select value={status} onValueChange={v => { setStatus(v); setPage(1); }}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="pending">Pending Approval</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}><CardContent className="p-4"><div className="h-20 bg-muted/50 animate-pulse rounded" /></CardContent></Card>
          ))
        ) : isError ? (
          <div className="text-center py-10 text-destructive text-sm">Failed to load payouts</div>
        ) : data?.data?.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground text-sm">No payouts found</div>
        ) : data?.data?.map(w => {
          const ds = getDisplayStatus(w.status as PayoutStatus, w.transferStatus as TransferStatus);
          const beneficiary = w.payoutMode === "UPI" ? w.upiId ?? "—" : `${w.bankName} ···${(w.bankAccount ?? "").slice(-4)}`;
          return (
            <Card key={w.id}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-sm">{w.merchantName || "—"}</p>
                    <p className="font-mono font-bold text-base text-emerald-400">₹{Number(w.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</p>
                  </div>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium shrink-0 ${ds.color}`}>{ds.label}</span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  <div>
                    <p className="text-[10px] uppercase text-muted-foreground font-medium">Mode</p>
                    <Badge variant="outline" className="font-mono text-xs">{w.payoutMode}</Badge>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase text-muted-foreground font-medium">Beneficiary</p>
                    <p className="text-xs text-muted-foreground truncate">{beneficiary}</p>
                  </div>
                  {w.utr && (
                    <div className="col-span-2">
                      <p className="text-[10px] uppercase text-muted-foreground font-medium">UTR</p>
                      <p className="font-mono text-xs">{w.utr}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-[10px] uppercase text-muted-foreground font-medium">Date</p>
                    <p className="text-xs text-muted-foreground">{format(new Date(w.createdAt), "MMM d, yyyy")}</p>
                  </div>
                </div>
                <div className="flex justify-end gap-1.5 pt-1 border-t border-border/30">
                  <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground hover:text-foreground" onClick={() => setDetailId(w.id)}>
                    <Eye className="w-3 h-3 mr-1" />Details
                  </Button>
                  {w.status === "pending" && (
                    <>
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-emerald-500 hover:bg-emerald-500/10" onClick={() => { setConfirmApproveId(w.id); setConfirmApproveAmount(Number(w.amount)); }} disabled={approveMutation.isPending}>
                        <CheckCircle className="w-3 h-3 mr-1" />Approve
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-rose-500 hover:bg-rose-500/10" onClick={() => openRejectModal(w.id)}>
                        <XCircle className="w-3 h-3 mr-1" />Reject
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
        {data && data.total > 20 && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{data.total} total</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Prev</Button>
              <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page * 20 >= data.total}>Next</Button>
            </div>
          </div>
        )}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block">
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
                                      : w.failureReason.startsWith("PAYOUT_BENEFICIARY_ERROR") ||
                                        w.failureReason === "Beneficiary setup failed. Please re-register beneficiary."
                                      ? "Beneficiary setup failed. Please re-register beneficiary."
                                      : w.failureReason === "Transfer was not created. Please retry after beneficiary setup." ||
                                        w.failureReason === "Transfer was not created / provider transfer not found"
                                      ? "Transfer was not created. Please retry after beneficiary setup."
                                      : "Payout failed. Please retry or contact support."
                                  }
                                >
                                  {w.failureReason.startsWith("PAYOUT_CREDENTIAL_ERROR")
                                    ? "⚠ Payout provider credentials invalid — fix in Gateway Settings"
                                    : w.failureReason.startsWith("PAYOUT_BENEFICIARY_ERROR") ||
                                      w.failureReason === "Beneficiary setup failed. Please re-register beneficiary."
                                    ? "⚠ Beneficiary setup failed. Please re-register beneficiary."
                                    : w.failureReason === "Transfer was not created. Please retry after beneficiary setup." ||
                                      w.failureReason === "Transfer was not created / provider transfer not found"
                                    ? "⚠ Transfer was not created. Please retry after beneficiary setup."
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
                                      onClick={() => openRejectModal(w.id)}
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
                                  w.hasProviderReference ? (
                                    // Payout reached the provider — may have succeeded. Block retry
                                    // until Check Payout Status confirms the actual outcome.
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="text-sky-400 hover:text-sky-300 hover:bg-sky-500/10"
                                      onClick={() => handleRefreshStatus(w.id)}
                                      disabled={refreshMutation.isPending}
                                      title="This payout reached the provider and may have succeeded. Check the current status before retrying to avoid a duplicate payment."
                                    >
                                      <RefreshCw className={`w-4 h-4 mr-1 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
                                      Check Payout Status
                                    </Button>
                                  ) : w.failureReason?.startsWith("PAYOUT_CREDENTIAL_ERROR") ? (
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
                                  ) : (w.beneficiaryStatus as BeneficiaryStatus | undefined) === "VERIFIED" ? (
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
                                  ) : (
                                    <>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
                                        onClick={() => handleRepairBeneficiaryMapping(w.id)}
                                        disabled={repairMappingMutation.isPending || reregisterMutation.isPending}
                                        title="Find the existing beneficiary on the provider side and link it (non-destructive). Try this first before Re-register."
                                      >
                                        <ShieldCheck className="w-4 h-4 mr-1" />
                                        Repair Mapping
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="text-rose-500 hover:text-rose-400 hover:bg-rose-500/10"
                                        onClick={() => handleReregisterBeneficiary(w.id)}
                                        disabled={reregisterMutation.isPending || repairMappingMutation.isPending}
                                        title="Retry is disabled until the beneficiary is verified. Re-register the beneficiary with the provider first."
                                      >
                                        <UserCog className="w-4 h-4 mr-1" />
                                        Re-register
                                      </Button>
                                    </>
                                  )
                                )}
                                {isFailed && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="text-muted-foreground hover:text-foreground"
                                    onClick={() => handleCheckBeneficiaryStatus(w.id)}
                                    disabled={checkBeneficiaryStatusMutation.isPending}
                                    title="Check the beneficiary's current status directly with the provider (read-only)."
                                  >
                                    <ShieldCheck className="w-4 h-4 mr-1" />
                                    Check Beneficiary
                                  </Button>
                                )}
                                {w.status === "approved" && w.transferStatus !== "SUCCESS" && !w.utr && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="text-rose-500 hover:text-rose-400 hover:bg-rose-500/10"
                                    onClick={() => openRejectModal(w.id)}
                                    title="Reject and close out this payout with a mandatory reason."
                                  >
                                    <XCircle className="w-4 h-4 mr-1" />
                                    Reject
                                  </Button>
                                )}
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-muted-foreground hover:text-foreground"
                                  onClick={() => setDetailId(w.id)}
                                >
                                  <Eye className="w-4 h-4 mr-1" />
                                  Details
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-muted-foreground hover:text-foreground"
                                  onClick={() => setSlipPayoutId(w.id)}
                                  title="View payout transaction slip"
                                >
                                  <FileText className="w-4 h-4 mr-1" />
                                  Slip
                                </Button>
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
      </div>

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
              Are you sure you want to reject this payout? Locked funds will be released back to the merchant's available balance.
            </p>
            <div>
              <Label htmlFor="reject-reason">
                Rejection reason <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="reject-reason"
                className={`mt-1.5 ${rejectReasonError ? "border-destructive" : ""}`}
                placeholder="Enter reason shown to merchant/admin record..."
                value={rejectReason}
                onChange={e => {
                  setRejectReason(e.target.value);
                  if (rejectReasonError) setRejectReasonError("");
                }}
                rows={3}
              />
              {rejectReasonError && (
                <p className="text-xs text-destructive mt-1">{rejectReasonError}</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={rejectMutation.isPending}
            >
              {rejectMutation.isPending ? "Rejecting..." : "Reject Payout"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Payout detail drawer */}
      <Sheet open={!!detailId} onOpenChange={(open) => !open && setDetailId(null)}>
        <SheetContent className="sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Payout #{detailPayout?.id}</SheetTitle>
            <SheetDescription>Full status detail for this payout</SheetDescription>
          </SheetHeader>
          {detailPayout && (
            <div className="mt-6 space-y-5 px-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Local Status</span>
                <Badge variant="outline" className="capitalize">{detailPayout.status}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Transfer Status</span>
                <Badge variant="outline">{detailPayout.transferStatus}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Beneficiary Status</span>
                {(() => {
                  const b = beneficiaryStatusBadge(detailPayout.beneficiaryStatus as BeneficiaryStatus | undefined);
                  return (
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${b.color}`}>
                      {b.label}
                    </span>
                  );
                })()}
              </div>
              <div className="space-y-1">
                <span className="text-sm text-muted-foreground">Safe Failure Reason</span>
                <p className="text-sm">{detailPayout.safeFailureReason ?? "—"}</p>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">UTR</span>
                <span className="font-mono text-sm">{detailPayout.utr ?? "—"}</span>
              </div>
              {detailPayout.rejectionReason && (
                <div className="space-y-1">
                  <span className="text-sm text-muted-foreground">Rejection Reason</span>
                  <p className="text-sm text-rose-400">{detailPayout.rejectionReason}</p>
                </div>
              )}
              {(detailPayout as any).rejectedAt && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Rejected At</span>
                  <span className="text-sm">{format(new Date((detailPayout as any).rejectedAt), "MMM d, yyyy HH:mm")}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Updated At</span>
                <span className="text-sm">{detailPayout.updatedAt ? format(new Date(detailPayout.updatedAt), "MMM d, yyyy HH:mm") : "—"}</span>
              </div>

              <div className="pt-4 border-t border-border/50 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleRefreshStatus(detailPayout.id)}
                  disabled={refreshMutation.isPending}
                >
                  <RefreshCw className={`w-4 h-4 mr-1 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
                  Check Payout Status
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleCheckBeneficiaryStatus(detailPayout.id)}
                  disabled={checkBeneficiaryStatusMutation.isPending}
                >
                  <ShieldCheck className="w-4 h-4 mr-1" />
                  Check Beneficiary Status
                </Button>
                {["FAILED", "REVERSED"].includes(detailPayout.transferStatus) && (
                  detailPayout.hasProviderReference ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-sky-400 border-sky-400/40"
                      onClick={() => handleRefreshStatus(detailPayout.id)}
                      disabled={refreshMutation.isPending}
                      title="This payout reached the provider and may have succeeded. Check payout status before retrying to avoid a duplicate payment."
                    >
                      <RefreshCw className={`w-4 h-4 mr-1 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
                      Check Payout Status
                    </Button>
                  ) : detailPayout.beneficiaryStatus === "VERIFIED" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-amber-500"
                      onClick={() => handleRetry(detailPayout.id)}
                      disabled={retryMutation.isPending}
                    >
                      <RotateCcw className="w-4 h-4 mr-1" />
                      Retry
                    </Button>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-blue-400 border-blue-400/40"
                        onClick={() => handleRepairBeneficiaryMapping(detailPayout.id)}
                        disabled={repairMappingMutation.isPending || reregisterMutation.isPending}
                        title="Find the existing beneficiary on the provider side and link it (non-destructive). Try this first before Re-register."
                      >
                        <ShieldCheck className="w-4 h-4 mr-1" />
                        Repair Mapping
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-rose-500"
                        onClick={() => handleReregisterBeneficiary(detailPayout.id)}
                        disabled={reregisterMutation.isPending || repairMappingMutation.isPending}
                        title="Retry is disabled until the beneficiary is verified."
                      >
                        <UserCog className="w-4 h-4 mr-1" />
                        Re-register Beneficiary
                      </Button>
                    </>
                  )
                )}
                {detailPayout.status !== "rejected" && detailPayout.transferStatus !== "SUCCESS" && !detailPayout.utr && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-rose-500 border-rose-500/30"
                    onClick={() => {
                      setDetailId(null);
                      openRejectModal(detailPayout.id);
                    }}
                    disabled={rejectMutation.isPending}
                  >
                    <XCircle className="w-4 h-4 mr-1" />
                    Reject Payout
                  </Button>
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Payout Slip Modal */}
      <PayoutSlipModal
        payoutId={slipPayoutId}
        open={slipPayoutId !== null}
        onClose={() => setSlipPayoutId(null)}
        isAdmin
      />
    </div>
  );
}
