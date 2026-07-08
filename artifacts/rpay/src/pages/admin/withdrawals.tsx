import { useState } from "react";
import { useListWithdrawals, useApproveWithdrawal, useRejectWithdrawal, getListWithdrawalsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { CheckCircle, XCircle, ArrowUpRight, Clock, Download, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

const TOKEN_KEY = "rasokart_token";

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

export default function AdminWithdrawals() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [rejectId, setRejectId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const [slipPayoutId, setSlipPayoutId] = useState<number | null>(null);
  const [slipData, setSlipData] = useState<SlipData | null>(null);
  const [slipLoading, setSlipLoading] = useState(false);
  const [slipError, setSlipError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  const { data, isLoading, isError } = useListWithdrawals({ status: status as any, page, limit: 20 });
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
      onSuccess: (result) => {
        if (result.transferStatus === "SUCCESS") {
          toast.success("Withdrawal approved and payout sent successfully");
        } else if (result.transferStatus === "FAILED" || result.transferStatus === "REVERSED") {
          toast.error("Payout could not be completed. The hold has been released back to the merchant's balance.");
        } else {
          toast.success("Withdrawal approved — payout is processing");
        }
        qc.invalidateQueries({ queryKey: getListWithdrawalsQueryKey() });
      },
      onError: () => toast.error("Something went wrong. Please try again."),
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
              )) : isError ? (
                <TableRow><TableCell colSpan={7} className="text-center py-10"><div className="flex flex-col items-center gap-2 text-destructive"><XCircle className="w-5 h-5" /><p className="text-sm font-medium">Failed to load withdrawals</p><p className="text-xs text-muted-foreground">Please refresh the page and try again.</p></div></TableCell></TableRow>
              ) : data?.data?.length === 0 ? (
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
                    <div className="flex justify-end items-center gap-1 flex-wrap">
                      {w.status === "pending" && (
                        <>
                          <Button size="sm" variant="ghost" className="text-emerald-500 hover:text-emerald-400 hover:bg-emerald-500/10" onClick={() => handleApprove(w.id)} disabled={approveMutation.isPending}><CheckCircle className="w-4 h-4 mr-1" />Approve</Button>
                          <Button size="sm" variant="ghost" className="text-rose-500 hover:text-rose-400 hover:bg-rose-500/10" onClick={() => { setRejectId(w.id); setRejectReason(""); }}><XCircle className="w-4 h-4 mr-1" />Reject</Button>
                        </>
                      )}
                      <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => openSlip(w.id)} title="View payout slip">
                        <FileText className="w-3.5 h-3.5 mr-1" />Slip
                      </Button>
                      <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => downloadPdf(w.id)} disabled={downloadingId === w.id} title="Download PDF slip">
                        {downloadingId === w.id
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <Download className="w-3.5 h-3.5" />}
                      </Button>
                    </div>
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

      {/* Reject Dialog */}
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

      {/* Slip Modal */}
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
                    <SlipRow label="Merchant" value={slipData.merchant.businessName} />
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
                      <p className="mt-1 text-emerald-400">Amount has been released back to merchant wallet.</p>
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
                  System-generated RasoKart payout receipt · Generated: {slipData.generatedAt}
                </p>
              </div>
            );
          })()}

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { setSlipPayoutId(null); setSlipData(null); }}>
              Close
            </Button>
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
    </div>
  );
}
