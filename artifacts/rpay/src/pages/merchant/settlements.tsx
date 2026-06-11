import { useState } from "react";
import {
  useListSettlements,
  useCreateSettlement,
  useGetMe,
  useGetMerchant,
  useListWithdrawals,
  getListSettlementsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, ChevronDown, ChevronRight, Clock, Plus } from "lucide-react";
import { format } from "date-fns";

export default function MerchantSettlements() {
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [requestOpen, setRequestOpen] = useState(false);
  const [reqAmount, setReqAmount] = useState("");
  const [reqNote, setReqNote] = useState("");
  const [reqError, setReqError] = useState("");

  const qc = useQueryClient();
  const { data: me } = useGetMe();
  const { data: merchantData } = useGetMerchant(me?.merchantId ?? 0);
  const { data, isLoading } = useListSettlements({ page, limit: 20 });
  const { data: withdrawalsData } = useListWithdrawals({ limit: 1 });

  const createMutation = useCreateSettlement({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListSettlementsQueryKey() });
        setRequestOpen(false);
        setReqAmount("");
        setReqNote("");
        setReqError("");
      },
      onError: (err: any) => {
        const msg = err?.response?.data?.error ?? err?.message ?? "Failed to submit request";
        setReqError(msg);
      },
    },
  });

  const handleSubmitRequest = () => {
    setReqError("");
    const amount = parseFloat(reqAmount);
    if (!reqAmount || isNaN(amount) || amount <= 0) {
      setReqError("Please enter a valid amount");
      return;
    }
    createMutation.mutate({ data: { requestedAmount: amount, requestedNote: reqNote || undefined } });
  };

  const balance = merchantData ? Number(merchantData.balance) : 0;
  const latestWithdrawal = withdrawalsData?.data?.[0];

  // Sum amounts reserved by any pending/processing settlements (server enforces at most 1 at a time,
  // but we compute from ALL loaded pages for correctness).
  const inFlightSettlement = (data?.data ?? []).find(s => s.status === "pending" || s.status === "processing");
  const pendingReserved = (data?.data ?? [])
    .filter(s => s.status === "pending" || s.status === "processing")
    .reduce((sum, s) => sum + Number(s.requestedAmount ?? s.amount), 0);
  const availableBalance = balance - pendingReserved;

  const exportCsv = () => {
    if (!data?.data) return;
    const header = ["ID", "Amount", "Status", "Admin Remark", "Reference", "Note", "Created"];
    const rows = data.data.map(s => [
      String(s.id),
      String(s.requestedAmount ?? s.amount),
      s.status,
      s.adminRemark ?? "",
      s.referenceNumber ?? "",
      s.requestedNote ?? "",
      s.createdAt,
    ]);
    const csv = [header, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "settlements.csv";
    a.click();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Settlements</h1>
          <p className="text-muted-foreground mt-1">Request and track your settlement payouts</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={exportCsv}>Export CSV</Button>
          <Button
            size="sm"
            disabled={!!inFlightSettlement}
            onClick={() => { setRequestOpen(true); setReqError(""); }}
            title={inFlightSettlement ? "A settlement request is already in progress" : undefined}
          >
            <Plus className="w-4 h-4 mr-1" /> Request Settlement
          </Button>
        </div>
      </div>

      {/* In-flight settlement warning banner */}
      {inFlightSettlement && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-400" />
          <div className="flex-1 min-w-0">
            <span className="font-medium text-amber-200">Settlement request in progress — </span>
            a{" "}
            <span className="font-medium capitalize">{inFlightSettlement.status}</span> request for{" "}
            <span className="font-mono font-semibold">
              ₹{Number(inFlightSettlement.requestedAmount ?? inFlightSettlement.amount).toLocaleString()}
            </span>{" "}
            is already in flight. You can submit another request once it is resolved.{" "}
            <button
              className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-amber-100 transition-colors font-medium"
              onClick={() => setExpandedId(inFlightSettlement.id)}
            >
              <Clock className="w-3 h-3" /> View request
            </button>
          </div>
        </div>
      )}

      {/* Balance summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="border-primary/30">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Available Balance</p>
            <p className="text-xl font-bold mt-1 text-primary">₹{availableBalance.toLocaleString()}</p>
            {pendingReserved > 0 && (
              <p className="text-xs text-amber-400 mt-0.5">₹{pendingReserved.toLocaleString()} reserved</p>
            )}
          </CardContent>
        </Card>
        {[
          { label: "Pending", value: data?.data?.filter(s => s.status === "pending").length ?? "—" },
          { label: "Processing", value: data?.data?.filter(s => s.status === "processing").length ?? "—" },
          { label: "Paid (all time)", value: `₹${(data?.data?.filter(s => s.status === "paid").reduce((a, s) => a + Number(s.requestedAmount ?? s.amount), 0) ?? 0).toLocaleString()}` },
        ].map(card => (
          <Card key={card.label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{card.label}</p>
              <p className="text-xl font-bold mt-1">{card.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead className="text-right">Requested Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Note</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>{Array.from({ length: 5 }).map((_, j) => <TableCell key={j}><div className="h-4 bg-muted/50 rounded animate-pulse" /></TableCell>)}</TableRow>
              )) : data?.data?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-16">
                    <p className="font-medium">No settlement requests yet</p>
                    <p className="text-sm mt-1">Click "Request Settlement" to create your first request</p>
                  </TableCell>
                </TableRow>
              ) : data?.data?.map(s => {
                const isExpanded = expandedId === s.id;
                const hasDetails = s.adminRemark || s.referenceNumber || s.paidAt;
                return (
                  <>
                    <TableRow
                      key={s.id}
                      className={hasDetails ? "cursor-pointer hover:bg-muted/30" : ""}
                      onClick={() => hasDetails && setExpandedId(isExpanded ? null : s.id)}
                    >
                      <TableCell className="w-8 text-muted-foreground">
                        {hasDetails ? (isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />) : null}
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold">
                        ₹{Number(s.requestedAmount ?? s.amount).toLocaleString()}
                      </TableCell>
                      <TableCell><StatusBadge status={s.status} /></TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-xs truncate">{s.requestedNote || "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{format(new Date(s.createdAt), "MMM d, yyyy")}</TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow key={`${s.id}-detail`} className="bg-muted/10">
                        <TableCell />
                        <TableCell colSpan={4} className="py-3">
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                            {s.adminRemark && (
                              <div>
                                <p className="text-xs text-muted-foreground mb-0.5">Admin Remark</p>
                                <p className="font-medium">{s.adminRemark}</p>
                              </div>
                            )}
                            {s.referenceNumber && (
                              <div>
                                <p className="text-xs text-muted-foreground mb-0.5">Reference Number</p>
                                <Badge variant="outline" className="font-mono text-xs">{s.referenceNumber}</Badge>
                              </div>
                            )}
                            {s.paidAt && (
                              <div>
                                <p className="text-xs text-muted-foreground mb-0.5">Paid At</p>
                                <p className="font-medium">{format(new Date(s.paidAt), "MMM d, yyyy HH:mm")}</p>
                              </div>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {data && data.total > 20 && (
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button>
          <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page * 20 >= data.total}>Next</Button>
        </div>
      )}

      {/* Request Settlement Dialog */}
      <Dialog open={requestOpen} onOpenChange={setRequestOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Request Settlement</DialogTitle>
            <DialogDescription>
              Submit a payout request for your available balance. Admin will review and process it.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            <div className="rounded-lg border border-border p-3 bg-muted/30 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Total Balance</span>
                <span className="font-semibold text-foreground">₹{balance.toLocaleString()}</span>
              </div>
              {pendingReserved > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-amber-400">Reserved (pending withdrawal)</span>
                  <span className="font-semibold text-amber-400">− ₹{pendingReserved.toLocaleString()}</span>
                </div>
              )}
              <div className="flex items-center justify-between pt-1 border-t border-border/50">
                <span className="text-sm font-medium">Available to Request</span>
                <span className="font-bold text-lg text-primary">₹{availableBalance.toLocaleString()}</span>
              </div>
            </div>

            {/* Payout account — pre-filled from most recent withdrawal */}
            <div className="rounded-lg border border-border p-3 bg-muted/20 space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Payout Account</p>
              {latestWithdrawal ? (
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Account Holder</span>
                    <span className="font-medium">{latestWithdrawal.accountHolder}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Bank</span>
                    <span className="font-medium">{latestWithdrawal.bankName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Account No.</span>
                    <span className="font-mono font-medium">{"•".repeat(Math.max(0, (latestWithdrawal.bankAccount ?? "").length - 4))}{(latestWithdrawal.bankAccount ?? "").slice(-4)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">IFSC</span>
                    <span className="font-mono font-medium">{latestWithdrawal.ifscCode}</span>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-amber-400">No bank account on file. Please submit a withdrawal request first to register your bank details.</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="reqAmount">Amount (₹) <span className="text-rose-500">*</span></Label>
              <Input
                id="reqAmount"
                type="number"
                min="1"
                max={availableBalance}
                step="0.01"
                placeholder={`Max ₹${availableBalance.toLocaleString()}`}
                value={reqAmount}
                onChange={e => setReqAmount(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="reqNote">Note (optional)</Label>
              <Textarea
                id="reqNote"
                placeholder="Reason or notes for this settlement request..."
                rows={3}
                value={reqNote}
                onChange={e => setReqNote(e.target.value)}
              />
            </div>

            {reqError && (
              <p className="text-sm text-rose-500 bg-rose-500/10 border border-rose-500/20 rounded-md px-3 py-2">{reqError}</p>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setRequestOpen(false)}>Cancel</Button>
              <Button onClick={handleSubmitRequest} disabled={createMutation.isPending}>
                {createMutation.isPending ? "Submitting..." : "Submit Request"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
