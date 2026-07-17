import { useState } from "react";
import {
  useListUtrVerifications,
  getListUtrVerificationsQueryKey,
  useApproveUtrVerification,
  useRejectUtrVerification,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { Search, RefreshCw, CheckCircle, XCircle, ExternalLink, Copy, AlertCircle, Clock, IndianRupee } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

type UtrVerification = {
  id: number;
  merchantId: number;
  merchantName?: string | null;
  merchantEmail?: string | null;
  amount: string;
  currency: string;
  utr: string;
  status: string;
  paymentLinkId?: number | null;
  payerName?: string | null;
  payerUpi?: string | null;
  screenshotUrl?: string | null;
  rejectionReason?: string | null;
  reviewedAt?: string | null;
  reviewedByEmail?: string | null;
  createdAt: string;
  updatedAt: string;
};

function statusBadge(status: string) {
  if (status === "pending_verification") return <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30">Pending</Badge>;
  if (status === "success") return <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30">Approved</Badge>;
  if (status === "failed") return <Badge className="bg-rose-500/15 text-rose-400 border-rose-500/30">Rejected</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

function copyText(t: string, label: string) {
  navigator.clipboard.writeText(t).then(() => toast.success(`${label} copied`));
}

export default function AdminUtrVerifications() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("pending_verification");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");

  const params = {
    status: statusFilter !== "all" ? statusFilter : undefined,
    search: search || undefined,
  };

  const { data, isLoading, refetch } = useListUtrVerifications(params);
  const items: UtrVerification[] = (data as any)?.items ?? [];

  const invalidate = () => qc.invalidateQueries({ queryKey: getListUtrVerificationsQueryKey(params) });

  // Detail sheet
  const [selected, setSelected] = useState<UtrVerification | null>(null);

  // Approve confirmation dialog
  const [pendingApproval, setPendingApproval] = useState<UtrVerification | null>(null);

  const approveMut = useApproveUtrVerification({
    mutation: {
      onSuccess: () => {
        toast.success("Approved — merchant wallet credited");
        setSelected(null);
        setPendingApproval(null);
        invalidate();
      },
      onError: (e: any) => toast.error(e?.response?.data?.error ?? "Failed to approve"),
    },
  });

  // Reject dialog
  const [rejectTarget, setRejectTarget] = useState<UtrVerification | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const rejectMut = useRejectUtrVerification({
    mutation: {
      onSuccess: () => { toast.success("Rejected"); setRejectTarget(null); setRejectReason(""); setSelected(null); invalidate(); },
      onError: (e: any) => toast.error(e?.response?.data?.error ?? "Failed to reject"),
    },
  });

  function handleApprove(item: UtrVerification) {
    setPendingApproval(item);
  }

  function confirmApprove() {
    if (!pendingApproval) return;
    approveMut.mutate({ id: pendingApproval.id });
  }

  function openReject(item: UtrVerification) {
    setRejectTarget(item);
    setRejectReason("");
  }

  function submitReject() {
    if (!rejectTarget) return;
    rejectMut.mutate({ id: rejectTarget.id, data: { reason: rejectReason.trim() || undefined } });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">UPI Approvals</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Review and approve manual UPI payments submitted via payment links</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
          <RefreshCw className="w-4 h-4" /> Refresh
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-48">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Search UTR, merchant…"
                  value={searchInput}
                  onChange={e => setSearchInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && setSearch(searchInput)}
                />
              </div>
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pending_verification">Pending Review</SelectItem>
                <SelectItem value="success">Approved</SelectItem>
                <SelectItem value="failed">Rejected</SelectItem>
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
            {search && (
              <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setSearchInput(""); }}>Clear</Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
              <RefreshCw className="w-4 h-4 animate-spin" /> Loading…
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Clock className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No {statusFilter === "pending_verification" ? "pending" : statusFilter} UTR submissions</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>UTR</TableHead>
                  <TableHead>Merchant</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Payer</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map(item => (
                  <TableRow key={item.id} className="cursor-pointer hover:bg-muted/30" onClick={() => setSelected(item)}>
                    <TableCell className="text-muted-foreground text-xs">{item.id}</TableCell>
                    <TableCell>
                      <span className="font-mono text-sm">{item.utr}</span>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="text-sm font-medium">{item.merchantName ?? "—"}</p>
                        <p className="text-xs text-muted-foreground">{item.merchantEmail ?? ""}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="font-semibold">₹{parseFloat(item.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="text-sm">{item.payerName ?? "—"}</p>
                        {item.payerUpi && <p className="text-xs text-muted-foreground font-mono">{item.payerUpi}</p>}
                      </div>
                    </TableCell>
                    <TableCell>{statusBadge(item.status)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {format(new Date(item.createdAt), "d MMM, h:mm a")}
                    </TableCell>
                    <TableCell className="text-right" onClick={e => e.stopPropagation()}>
                      {item.status === "pending_verification" && (
                        <div className="flex items-center justify-end gap-1">
                          <Button size="sm" className="h-7 px-2 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={() => handleApprove(item)} disabled={approveMut.isPending}>
                            <CheckCircle className="w-3.5 h-3.5 mr-1" />Approve
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-rose-400 border-rose-500/30 hover:bg-rose-500/10" onClick={() => openReject(item)}>
                            <XCircle className="w-3.5 h-3.5 mr-1" />Reject
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail sheet */}
      <Sheet open={!!selected} onOpenChange={v => { if (!v) setSelected(null); }}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-400" />
              UTR Submission #{selected?.id}
            </SheetTitle>
          </SheetHeader>
          {selected && (
            <div className="mt-6 space-y-5">
              <div className="flex items-center justify-between">
                {statusBadge(selected.status)}
                <span className="text-xs text-muted-foreground">{format(new Date(selected.createdAt), "d MMM yyyy, h:mm a")}</span>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between rounded-lg bg-muted/30 border border-border px-3 py-2">
                  <div>
                    <p className="text-xs text-muted-foreground">UTR / Reference</p>
                    <p className="font-mono font-semibold">{selected.utr}</p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => copyText(selected.utr, "UTR")}><Copy className="w-4 h-4" /></Button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg bg-muted/30 border border-border px-3 py-2">
                    <p className="text-xs text-muted-foreground">Amount</p>
                    <p className="font-bold text-lg">₹{parseFloat(selected.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</p>
                  </div>
                  <div className="rounded-lg bg-muted/30 border border-border px-3 py-2">
                    <p className="text-xs text-muted-foreground">Merchant</p>
                    <p className="font-medium text-sm">{selected.merchantName ?? "—"}</p>
                    <p className="text-xs text-muted-foreground">{selected.merchantEmail}</p>
                  </div>
                </div>
              </div>

              <Separator />

              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Payer Details</p>
                <div className="text-sm space-y-1">
                  <div className="flex justify-between"><span className="text-muted-foreground">Name</span><span>{selected.payerName ?? "—"}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">UPI ID</span><span className="font-mono">{selected.payerUpi ?? "—"}</span></div>
                </div>
              </div>

              {selected.screenshotUrl && (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Screenshot</p>
                    <a href={selected.screenshotUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-sm text-primary hover:underline">
                      <ExternalLink className="w-3.5 h-3.5" /> View Screenshot
                    </a>
                  </div>
                </>
              )}

              {selected.paymentLinkId && (
                <>
                  <Separator />
                  <p className="text-xs text-muted-foreground">Payment Link ID: #{selected.paymentLinkId}</p>
                </>
              )}

              {(selected.rejectionReason || selected.reviewedByEmail) && (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Review</p>
                    {selected.rejectionReason && <p className="text-sm text-rose-300">{selected.rejectionReason}</p>}
                    {selected.reviewedByEmail && <p className="text-xs text-muted-foreground">by {selected.reviewedByEmail}{selected.reviewedAt ? ` · ${format(new Date(selected.reviewedAt), "d MMM, h:mm a")}` : ""}</p>}
                  </div>
                </>
              )}

              {selected.status === "pending_verification" && (
                <>
                  <Separator />
                  <div className="flex gap-2">
                    <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700" onClick={() => handleApprove(selected)} disabled={approveMut.isPending}>
                      <CheckCircle className="w-4 h-4 mr-1.5" />{approveMut.isPending ? "Approving…" : "Approve"}
                    </Button>
                    <Button variant="outline" className="flex-1 text-rose-400 border-rose-500/30 hover:bg-rose-500/10" onClick={() => openReject(selected)}>
                      <XCircle className="w-4 h-4 mr-1.5" />Reject
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Approve confirmation dialog */}
      <Dialog open={!!pendingApproval} onOpenChange={v => { if (!v) setPendingApproval(null); }}>
        <DialogContent className="max-w-sm bg-card border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-400" />
              Approve UTR Payment
            </DialogTitle>
            <DialogDescription>
              Approving will credit the merchant's wallet. Payin charges and GST (if applicable) will be deducted automatically per the merchant's plan.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg bg-muted/30 border border-border px-3 py-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">UTR / Reference</span>
              <span className="font-mono font-semibold">{pendingApproval?.utr}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Merchant</span>
              <span className="font-medium">{pendingApproval?.merchantName ?? "—"}</span>
            </div>
            <Separator />
            <div className="flex justify-between">
              <span className="text-muted-foreground">Gross Amount</span>
              <span className="font-bold text-emerald-400 flex items-center gap-0.5">
                <IndianRupee className="w-3.5 h-3.5" />
                {pendingApproval ? parseFloat(pendingApproval.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 }) : ""}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground/70 pt-1">
              Net credit = gross minus applicable fee + GST. Merchant receives the net amount.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPendingApproval(null)}
              disabled={approveMut.isPending}
            >
              Cancel
            </Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700"
              onClick={confirmApprove}
              disabled={approveMut.isPending}
            >
              <CheckCircle className="w-4 h-4 mr-1.5" />
              {approveMut.isPending ? "Approving…" : "Confirm Approve"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject dialog */}
      <Dialog open={!!rejectTarget} onOpenChange={v => { if (!v) setRejectTarget(null); }}>
        <DialogContent className="max-w-sm bg-card border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><XCircle className="w-4 h-4 text-rose-400" />Reject UTR</DialogTitle>
            <DialogDescription>Reject UTR <span className="font-mono font-medium text-foreground">{rejectTarget?.utr}</span> for ₹{rejectTarget ? parseFloat(rejectTarget.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 }) : ""}?</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Rejection Reason (shown to merchant)</Label>
            <Textarea
              rows={3}
              placeholder="e.g. UTR not found in our records, please contact support"
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={submitReject} disabled={rejectMut.isPending}>
              {rejectMut.isPending ? "Rejecting…" : "Confirm Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
