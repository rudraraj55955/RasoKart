import { useState } from "react";
import {
  useListWithdrawals,
  useCreateWithdrawal,
  getListWithdrawalsQueryKey,
  useGetMyPlanUsage,
  useListPayoutBeneficiaries,
  getListPayoutBeneficiariesQueryKey,
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Plus, AlertTriangle, TrendingUp, Wallet, Lock, CheckCircle2, Clock, XCircle, RotateCcw, BadgeCheck, FileText, Download, Loader2, Share2, Copy, Link2, MessageCircle } from "lucide-react";
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

type SlipData = {
  id: number;
  receiptId: string;
  generatedAt: string;
  merchant: { businessName: string };
  amount: number;
  currency: string;
  payoutMode: string;
  displayStatus: "SUCCESS" | "FAILED" | "REJECTED" | "PROCESSING";
  statusLabel: string;
  utr: string | null;
  safeFailureReason: string | null;
  rejectionReason: string | null;
  requestedAt: string;
  processedAt: string | null;
  beneficiary: {
    name: string | null;
    bankName: string | null;
    maskedAccount: string | null;
    ifscCode: string | null;
    maskedUpi: string | null;
  };
  remarks: string | null;
  isNotFinal: boolean;
  walletRefunded: boolean;
};

function slipStatusStyle(s: SlipData["displayStatus"]) {
  switch (s) {
    case "SUCCESS":    return { bg: "bg-emerald-500/10", text: "text-emerald-400" };
    case "FAILED":     return { bg: "bg-rose-500/10",    text: "text-rose-400" };
    case "REJECTED":   return { bg: "bg-amber-500/10",   text: "text-amber-400" };
    case "PROCESSING": return { bg: "bg-sky-500/10",     text: "text-sky-400" };
  }
}

function SlipRow({ label, value, mono = false }: { label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-sm font-medium mt-0.5 break-all ${mono ? "font-mono" : ""}`}>{value ?? "—"}</p>
    </div>
  );
}

function buildShareText(
  info: { receiptId: string; statusLabel: string; amount: number; payoutMode: string; utr: string | null },
  shareUrl: string,
): string {
  const lines = [
    "RasoKart Payout Receipt",
    `Status: ${info.statusLabel}`,
    `Amount: ₹${info.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`,
    `Mode: ${info.payoutMode}`,
  ];
  if (info.utr) lines.push(`UTR: ${info.utr}`);
  lines.push(`Receipt ID: ${info.receiptId}`);
  if (shareUrl) lines.push(`View Slip: ${shareUrl}`);
  return lines.join("\n");
}

export default function MerchantPayouts() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [slipPayoutId, setSlipPayoutId] = useState<number | null>(null);
  const [slipData, setSlipData] = useState<SlipData | null>(null);
  const [slipLoading, setSlipLoading] = useState(false);
  const [slipError, setSlipError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [sharingId, setSharingId] = useState<number | null>(null);
  const [shareMenu, setShareMenu] = useState<{
    payoutId: number;
    receiptId: string;
    statusLabel: string;
    amount: number;
    payoutMode: string;
    utr: string | null;
    shareUrl: string | null;
    shareUrlLoading: boolean;
  } | null>(null);
  const [beneficiaryMode, setBeneficiaryMode] = useState<"saved" | "new">("saved");
  const [selectedBeneficiaryId, setSelectedBeneficiaryId] = useState<string>("");
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
  const { data: beneficiariesData } = useListPayoutBeneficiaries();
  const createMutation = useCreateWithdrawal();

  const activeBeneficiaries = (beneficiariesData?.data ?? []).filter(b => b.localStatus === "active");

  const payoutUsed = usage?.payout?.used ?? 0;
  const payoutLimit = usage?.payout?.limit ?? 0;
  const isAtLimit = payoutLimit > 0 && payoutUsed >= payoutLimit;
  const payoutPct = payoutLimit > 0 ? Math.min(100, Math.round((payoutUsed / payoutLimit) * 100)) : 0;

  const availableBalance: number = wallet?.availableBalance ?? 0;
  const holdBalance: number = wallet?.holdBalance ?? 0;
  const totalPayout: number = wallet?.totalPayout ?? 0;

  const resetForm = () => {
    setForm({ amount: "", payoutMode: "IMPS", accountNumber: "", bankName: "", ifscCode: "", accountHolderName: "", upiId: "", remarks: "" });
    setBeneficiaryMode(activeBeneficiaries.length > 0 ? "saved" : "new");
    setSelectedBeneficiaryId("");
  };

  const beneficiaryLabel = (b: (typeof activeBeneficiaries)[number]) => {
    const dest = b.payoutMode === "UPI" ? (b.upiIdMasked ?? "UPI") : `${b.bankName ?? "Bank"} ···${b.bankAccountLast4 ?? ""}`;
    return b.label ? `${b.label} — ${dest}` : dest;
  };

  const openRepeatPayout = (beneficiaryId: number) => {
    setForm({ amount: "", payoutMode: "IMPS", accountNumber: "", bankName: "", ifscCode: "", accountHolderName: "", upiId: "", remarks: "" });
    setBeneficiaryMode("saved");
    setSelectedBeneficiaryId(String(beneficiaryId));
    setOpen(true);
  };

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

    let payload: Record<string, unknown>;
    if (beneficiaryMode === "saved") {
      if (!selectedBeneficiaryId) {
        toast.error("Select a saved beneficiary");
        return;
      }
      payload = {
        amount: amt,
        beneficiaryId: Number(selectedBeneficiaryId),
        remarks: form.remarks.trim() || undefined,
      };
    } else {
      if (form.payoutMode === "UPI") {
        if (!form.upiId.trim()) { toast.error("UPI ID is required"); return; }
      } else {
        if (!form.accountNumber || !form.bankName || !form.ifscCode || !form.accountHolderName) {
          toast.error("All bank details are required");
          return;
        }
      }
      payload = {
        amount: amt,
        payoutMode: form.payoutMode as any,
        accountNumber: form.payoutMode !== "UPI" ? form.accountNumber : undefined,
        bankName: form.payoutMode !== "UPI" ? form.bankName : undefined,
        ifscCode: form.payoutMode !== "UPI" ? form.ifscCode : undefined,
        accountHolderName: form.payoutMode !== "UPI" ? form.accountHolderName : undefined,
        upiId: form.payoutMode === "UPI" ? form.upiId : undefined,
        remarks: form.remarks.trim() || undefined,
      };
    }

    createMutation.mutate(
      { data: payload as any },
      {
        onSuccess: () => {
          toast.success("Payout request submitted");
          setOpen(false);
          resetForm();
          qc.invalidateQueries({ queryKey: getListWithdrawalsQueryKey() });
          qc.invalidateQueries({ queryKey: ["merchant-wallet"] });
          qc.invalidateQueries({ queryKey: getListPayoutBeneficiariesQueryKey() });
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

  const openSlip = async (id: number) => {
    setSlipPayoutId(id);
    setSlipData(null);
    setSlipError(null);
    setSlipLoading(true);
    try {
      const token = localStorage.getItem(TOKEN_KEY);
      const res = await fetch(`/api/withdrawals/${id}/slip`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("Failed");
      setSlipData(await res.json());
    } catch {
      setSlipError("Unable to load payout slip. Please try again.");
    } finally {
      setSlipLoading(false);
    }
  };

  const downloadPdf = async (id: number) => {
    setDownloadingId(id);
    try {
      const token = localStorage.getItem(TOKEN_KEY);
      const res = await fetch(`/api/withdrawals/${id}/slip.pdf`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("Failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `rasokart-payout-slip-${id}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Payout slip downloaded");
    } catch {
      toast.error("Unable to generate payout slip right now. Please try again.");
    } finally {
      setDownloadingId(null);
    }
  };

  const generateShareLink = async (payoutId: number): Promise<string> => {
    const t = localStorage.getItem(TOKEN_KEY);
    const res = await fetch(`/api/withdrawals/${payoutId}/slip/share-link`, {
      method: "POST",
      headers: t ? { Authorization: `Bearer ${t}` } : {},
    });
    if (!res.ok) throw new Error("Unable to share slip right now");
    const { url } = await res.json() as { url: string };
    return window.location.origin + url;
  };

  const openShareMenu = (info: { payoutId: number; receiptId: string; statusLabel: string; amount: number; payoutMode: string; utr: string | null }) => {
    setShareMenu({ ...info, shareUrl: null, shareUrlLoading: true });
    generateShareLink(info.payoutId)
      .then(url => setShareMenu(prev => prev ? { ...prev, shareUrl: url, shareUrlLoading: false } : null))
      .catch(() => {
        setShareMenu(prev => prev ? { ...prev, shareUrlLoading: false } : null);
        toast.error("Unable to share slip right now");
      });
  };

  const handleShare = async (info: { payoutId: number; receiptId: string; statusLabel: string; amount: number; payoutMode: string; utr: string | null }) => {
    if (typeof navigator.share === "function") {
      setSharingId(info.payoutId);
      try {
        const fullUrl = await generateShareLink(info.payoutId);
        const text = buildShareText(info, fullUrl);
        let nativeShared = false;
        if (typeof (navigator as any).canShare === "function") {
          try {
            const t = localStorage.getItem(TOKEN_KEY);
            const pdfRes = await fetch(`/api/withdrawals/${info.payoutId}/slip.pdf`, {
              headers: t ? { Authorization: `Bearer ${t}` } : {},
            });
            if (pdfRes.ok) {
              const blob = await pdfRes.blob();
              const file = new File([blob], `rasokart-payout-slip-${info.payoutId}.pdf`, { type: "application/pdf" });
              if ((navigator as any).canShare({ files: [file] })) {
                await navigator.share({ title: "RasoKart Payout Receipt", text, files: [file] } as ShareData);
                toast.success("Receipt shared");
                nativeShared = true;
              }
            }
          } catch {}
        }
        if (!nativeShared) {
          await navigator.share({ title: "RasoKart Payout Receipt", text, url: fullUrl });
          toast.success("Receipt shared");
        }
        return;
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
      } finally {
        setSharingId(null);
      }
    }
    openShareMenu(info);
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

      {/* PayU compliance notice */}
      <div className="rounded-lg border border-border/50 bg-muted/30 px-4 py-3 text-xs text-muted-foreground leading-relaxed">
        Payout services are available only to approved business merchants after successful KYC and onboarding. All payouts are processed through authorised banking/payment partners.
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
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading
                  ? Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        {Array.from({ length: 7 }).map((_, j) => (
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
                              {(w.transferStatus === "FAILED" || w.transferStatus === "REVERSED") && (
                                <p className="text-xs text-rose-400 mt-0.5">
                                  Transfer failed. Please contact support or retry after verification.
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
                              <div className="flex justify-end items-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-muted-foreground"
                                  onClick={() => openSlip(w.id)}
                                  title="View payout slip"
                                >
                                  <FileText className="w-3.5 h-3.5 mr-1" />
                                  Slip
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-muted-foreground px-2"
                                  onClick={() => downloadPdf(w.id)}
                                  disabled={downloadingId === w.id}
                                  title="Download PDF slip"
                                >
                                  {downloadingId === w.id
                                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    : <Download className="w-3.5 h-3.5" />}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-muted-foreground px-2"
                                  onClick={() => handleShare({
                                    payoutId: w.id,
                                    receiptId: `RK-PO-${String(w.id).padStart(6, "0")}`,
                                    statusLabel: getDisplayStatus(w.status as PayoutStatus, w.transferStatus as TransferStatus).label,
                                    amount: Number(w.amount),
                                    payoutMode: w.payoutMode,
                                    utr: w.utr ?? null,
                                  })}
                                  disabled={sharingId === w.id}
                                  title="Share payout slip"
                                >
                                  {sharingId === w.id
                                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    : <Share2 className="w-3.5 h-3.5" />}
                                </Button>
                                {w.beneficiaryId ? (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-muted-foreground px-2"
                                    onClick={() => openRepeatPayout(w.beneficiaryId!)}
                                    title="Repeat this payout with a new request"
                                  >
                                    <RotateCcw className="w-3.5 h-3.5" />
                                  </Button>
                                ) : null}
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

      {/* Payout Slip Modal */}
      <Dialog
        open={slipPayoutId !== null}
        onOpenChange={open => { if (!open) { setSlipPayoutId(null); setSlipData(null); setSlipError(null); } }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between gap-3">
              <span>Payout Receipt</span>
              {slipData && (
                <span className="text-xs font-mono font-normal text-muted-foreground">{slipData.receiptId}</span>
              )}
            </DialogTitle>
          </DialogHeader>

          {slipLoading && (
            <div className="flex justify-center items-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {slipError && (
            <div className="text-center py-8">
              <p className="text-sm text-destructive">{slipError}</p>
            </div>
          )}

          {slipData && (() => {
            const sc = slipStatusStyle(slipData.displayStatus);
            return (
              <div className="space-y-4">
                <div className={`flex items-center gap-2 rounded-lg px-4 py-2.5 ${sc.bg}`}>
                  <span className={`text-sm font-semibold ${sc.text}`}>{slipData.statusLabel}</span>
                  {slipData.isNotFinal && (
                    <Badge variant="outline" className="ml-auto text-amber-400 border-amber-400/40 text-[10px]">NOT FINAL</Badge>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                  <div className="space-y-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Payout Details</p>
                    <SlipRow label="Amount" value={`₹${slipData.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`} />
                    <SlipRow label="Mode" value={slipData.payoutMode} />
                    <SlipRow label="Requested" value={slipData.requestedAt} />
                    {slipData.processedAt && <SlipRow label="Processed" value={slipData.processedAt} />}
                    {slipData.utr && <SlipRow label="UTR" value={slipData.utr} mono />}
                    {slipData.remarks && <SlipRow label="Remarks" value={slipData.remarks} />}
                  </div>
                  <div className="space-y-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Beneficiary</p>
                    {slipData.beneficiary.name && <SlipRow label="Name" value={slipData.beneficiary.name} />}
                    {slipData.beneficiary.maskedUpi
                      ? <SlipRow label="UPI ID" value={slipData.beneficiary.maskedUpi} mono />
                      : <>
                          {slipData.beneficiary.bankName && <SlipRow label="Bank" value={slipData.beneficiary.bankName} />}
                          {slipData.beneficiary.maskedAccount && <SlipRow label="Account" value={slipData.beneficiary.maskedAccount} mono />}
                          {slipData.beneficiary.ifscCode && <SlipRow label="IFSC" value={slipData.beneficiary.ifscCode} mono />}
                        </>
                    }
                  </div>
                </div>

                {slipData.safeFailureReason && (
                  <div className="rounded-md bg-rose-500/10 border border-rose-500/20 px-3 py-2 text-xs">
                    <span className="font-semibold text-rose-400">Failure reason: </span>
                    <span className="text-rose-300">{slipData.safeFailureReason}</span>
                    {slipData.walletRefunded && (
                      <p className="mt-1 text-emerald-400">Amount has been released back to your wallet.</p>
                    )}
                  </div>
                )}

                {slipData.rejectionReason && (
                  <div className="rounded-md bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-xs">
                    <span className="font-semibold text-amber-400">Rejection reason: </span>
                    <span className="text-amber-300">{slipData.rejectionReason}</span>
                  </div>
                )}

                <div className="rounded-md bg-muted/30 px-4 py-2.5 flex justify-between text-sm border border-border/40">
                  <span className="text-muted-foreground">Net Debit</span>
                  <span className="font-semibold font-mono">₹{slipData.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
                </div>

                <p className="text-[10px] text-muted-foreground text-center border-t border-border/50 pt-3">
                  System-generated RasoKart payout receipt · {slipData.generatedAt}
                </p>
              </div>
            );
          })()}

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { setSlipPayoutId(null); setSlipData(null); }}>
              Close
            </Button>
            {slipData && slipPayoutId !== null && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleShare({
                  payoutId: slipData.id,
                  receiptId: slipData.receiptId,
                  statusLabel: slipData.statusLabel,
                  amount: slipData.amount,
                  payoutMode: slipData.payoutMode,
                  utr: slipData.utr,
                })}
                disabled={sharingId === slipPayoutId}
              >
                {sharingId === slipPayoutId
                  ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  : <Share2 className="w-4 h-4 mr-2" />}
                Share
              </Button>
            )}
            {slipPayoutId !== null && (
              <Button size="sm" onClick={() => downloadPdf(slipPayoutId!)} disabled={downloadingId === slipPayoutId}>
                {downloadingId === slipPayoutId
                  ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  : <Download className="w-4 h-4 mr-2" />}
                Download PDF
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Share Menu Dialog */}
      <Dialog open={shareMenu !== null} onOpenChange={o => { if (!o) setShareMenu(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Share Payout Receipt</DialogTitle>
          </DialogHeader>
          {shareMenu && (
            <div className="space-y-4 py-1">
              <div className="grid grid-cols-2 gap-3">
                <Button
                  variant="outline"
                  className="h-auto flex flex-col gap-2 py-4"
                  disabled={shareMenu.shareUrlLoading || !shareMenu.shareUrl}
                  onClick={async () => {
                    if (!shareMenu.shareUrl) return;
                    try {
                      await navigator.clipboard.writeText(shareMenu.shareUrl);
                      toast.success("Slip link copied");
                    } catch {
                      toast.error("Unable to copy link");
                    }
                  }}
                >
                  {shareMenu.shareUrlLoading
                    ? <Loader2 className="w-5 h-5 animate-spin" />
                    : <Link2 className="w-5 h-5" />}
                  <span className="text-xs">Copy Link</span>
                </Button>

                <Button
                  variant="outline"
                  className="h-auto flex flex-col gap-2 py-4"
                  disabled={shareMenu.shareUrlLoading}
                  onClick={async () => {
                    const text = buildShareText(shareMenu, shareMenu.shareUrl ?? "");
                    try {
                      await navigator.clipboard.writeText(text);
                      toast.success("Summary copied");
                    } catch {
                      toast.error("Unable to copy summary");
                    }
                  }}
                >
                  <Copy className="w-5 h-5" />
                  <span className="text-xs">Copy Summary</span>
                </Button>

                <Button
                  variant="outline"
                  className="h-auto flex flex-col gap-2 py-4"
                  disabled={shareMenu.shareUrlLoading}
                  onClick={() => {
                    const text = buildShareText(shareMenu, shareMenu.shareUrl ?? "");
                    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
                  }}
                >
                  <MessageCircle className="w-5 h-5 text-green-400" />
                  <span className="text-xs">WhatsApp</span>
                </Button>

                <Button
                  variant="outline"
                  className="h-auto flex flex-col gap-2 py-4"
                  disabled={downloadingId === shareMenu.payoutId}
                  onClick={() => downloadPdf(shareMenu.payoutId)}
                >
                  {downloadingId === shareMenu.payoutId
                    ? <Loader2 className="w-5 h-5 animate-spin" />
                    : <Download className="w-5 h-5" />}
                  <span className="text-xs">Download PDF</span>
                </Button>
              </div>

              {shareMenu.shareUrl && (
                <div className="rounded-md bg-muted/30 px-3 py-2 border border-border/40">
                  <p className="text-[10px] text-muted-foreground mb-1">Share link · expires in 24 hours</p>
                  <p className="text-xs font-mono text-foreground/70 break-all">{shareMenu.shareUrl}</p>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShareMenu(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
              <Label>Beneficiary</Label>
              {activeBeneficiaries.length > 0 ? (
                <RadioGroup
                  value={beneficiaryMode}
                  onValueChange={v => setBeneficiaryMode(v as "saved" | "new")}
                  className="mt-1.5 grid grid-cols-2 gap-2"
                >
                  <Label className="flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-sm font-normal cursor-pointer">
                    <RadioGroupItem value="saved" />
                    Saved beneficiary
                  </Label>
                  <Label className="flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-sm font-normal cursor-pointer">
                    <RadioGroupItem value="new" />
                    New beneficiary
                  </Label>
                </RadioGroup>
              ) : (
                <p className="text-xs text-muted-foreground mt-1.5">
                  No saved beneficiaries yet — enter bank/UPI details below to create one.
                </p>
              )}
            </div>

            {beneficiaryMode === "saved" && activeBeneficiaries.length > 0 ? (
              <div>
                <Label>Select Saved Beneficiary</Label>
                <Select value={selectedBeneficiaryId} onValueChange={setSelectedBeneficiaryId}>
                  <SelectTrigger className="mt-1.5">
                    <SelectValue placeholder="Choose a beneficiary..." />
                  </SelectTrigger>
                  <SelectContent>
                    {activeBeneficiaries.map(b => (
                      <SelectItem key={b.id} value={String(b.id)}>
                        {beneficiaryLabel(b)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
            <>
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
