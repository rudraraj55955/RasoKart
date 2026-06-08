import { useState } from "react";
import { useListMerchants, useApproveMerchant, useRejectMerchant, useListPlans, useAssignMerchantPlan, useGetMerchantPlan, useGetMerchantPlanHistory, getListMerchantsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle, XCircle, Search, CreditCard, Calendar, History, CheckCircle2, XCircle as XIcon, Infinity } from "lucide-react";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";

const ACTION_COLOR: Record<string, string> = {
  assigned: "text-sky-400",
  upgraded: "text-emerald-400",
  downgraded: "text-amber-400",
  renewed: "text-violet-400",
  expired: "text-rose-400",
  removed: "text-muted-foreground",
};

export default function AdminMerchants() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [rejectId, setRejectId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [assignPlanMerchant, setAssignPlanMerchant] = useState<{ id: number; name: string } | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string>("");
  const [expiresAt, setExpiresAt] = useState<string>("");
  const [assignNotes, setAssignNotes] = useState<string>("");
  const [showHistory, setShowHistory] = useState(false);

  const { data, isLoading } = useListMerchants({ status: status as any, search, page, limit: 20 });
  const { data: plans } = useListPlans();
  const { data: currentMerchantPlan, isLoading: planLoading } = useGetMerchantPlan(
    assignPlanMerchant?.id ?? 0,
    { query: { enabled: !!assignPlanMerchant, queryKey: ["getMerchantPlan", assignPlanMerchant?.id ?? 0] } }
  );
  const { data: planHistory } = useGetMerchantPlanHistory(
    assignPlanMerchant?.id ?? 0,
    { query: { enabled: !!assignPlanMerchant && showHistory, queryKey: ["getMerchantPlanHistory", assignPlanMerchant?.id ?? 0] } }
  );
  const approveMutation = useApproveMerchant();
  const rejectMutation = useRejectMerchant();
  const assignPlanMutation = useAssignMerchantPlan();

  const handleApprove = (id: number) => {
    approveMutation.mutate({ id }, {
      onSuccess: () => { toast.success("Merchant approved"); qc.invalidateQueries({ queryKey: getListMerchantsQueryKey() }); },
      onError: () => toast.error("Failed to approve merchant"),
    });
  };

  const handleReject = () => {
    if (!rejectId || !rejectReason.trim()) return;
    rejectMutation.mutate({ id: rejectId, data: { reason: rejectReason } }, {
      onSuccess: () => {
        toast.success("Merchant rejected");
        setRejectId(null); setRejectReason("");
        qc.invalidateQueries({ queryKey: getListMerchantsQueryKey() });
      },
      onError: () => toast.error("Failed to reject merchant"),
    });
  };

  const openAssignPlan = (id: number, name: string) => {
    setAssignPlanMerchant({ id, name });
    setSelectedPlanId("");
    setExpiresAt("");
    setAssignNotes("");
    setShowHistory(false);
  };

  const closeAssignPlan = () => {
    setAssignPlanMerchant(null);
    setSelectedPlanId("");
    setExpiresAt("");
    setAssignNotes("");
    setShowHistory(false);
  };

  const handleAssignPlan = () => {
    if (!assignPlanMerchant || !selectedPlanId) return;
    assignPlanMutation.mutate({
      id: assignPlanMerchant.id,
      data: {
        planId: parseInt(selectedPlanId),
        expiresAt: expiresAt || null,
        notes: assignNotes || null,
      },
    }, {
      onSuccess: () => {
        toast.success("Plan assigned successfully");
        qc.invalidateQueries({ queryKey: ["getMerchantPlan", assignPlanMerchant.id] });
        qc.invalidateQueries({ queryKey: ["getMerchantPlanHistory", assignPlanMerchant.id] });
        closeAssignPlan();
      },
      onError: () => toast.error("Failed to assign plan"),
    });
  };

  const exportCsv = () => {
    if (!data?.data) return;
    const rows = [["ID", "Business Name", "Contact", "Email", "Phone", "Status", "Balance", "Created"]];
    data.data.forEach(m => rows.push([String(m.id), m.businessName, m.contactName, m.email, m.phone, m.status, String(m.balance), m.createdAt]));
    const csv = rows.map(r => r.map(v => `"${v}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "merchants.csv"; a.click(); URL.revokeObjectURL(url);
  };

  const merchants = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 20);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Merchants</h1>
          <p className="text-muted-foreground mt-1">{total} total merchants</p>
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv}>Export CSV</Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search merchants..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <Select value={status} onValueChange={v => { setStatus(v); setPage(1); }}>
          <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Business</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                [1,2,3,4,5].map(i => (
                  <TableRow key={i}>
                    {[1,2,3,4,5,6].map(j => <TableCell key={j}><div className="h-4 bg-muted/50 animate-pulse rounded" /></TableCell>)}
                  </TableRow>
                ))
              ) : merchants.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-10">No merchants found</TableCell>
                </TableRow>
              ) : merchants.map(merchant => (
                <TableRow key={merchant.id}>
                  <TableCell>
                    <div>
                      <p className="font-medium">{merchant.businessName}</p>
                      <p className="text-xs text-muted-foreground">{merchant.email}</p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div>
                      <p className="text-sm">{merchant.contactName}</p>
                      <p className="text-xs text-muted-foreground">{merchant.phone}</p>
                    </div>
                  </TableCell>
                  <TableCell><StatusBadge status={merchant.status} /></TableCell>
                  <TableCell className="text-right font-mono text-sm">₹{Number(merchant.balance).toLocaleString()}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{format(new Date(merchant.createdAt), "MMM d, yyyy")}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {merchant.status === "pending" && (
                        <>
                          <Button size="sm" variant="ghost" className="text-emerald-500 hover:bg-emerald-500/10" onClick={() => handleApprove(merchant.id)}>
                            <CheckCircle className="w-4 h-4 mr-1" /> Approve
                          </Button>
                          <Button size="sm" variant="ghost" className="text-rose-500 hover:bg-rose-500/10" onClick={() => { setRejectId(merchant.id); setRejectReason(""); }}>
                            <XCircle className="w-4 h-4 mr-1" /> Reject
                          </Button>
                        </>
                      )}
                      <Button size="sm" variant="ghost" className="text-primary hover:bg-primary/10" onClick={() => openAssignPlan(merchant.id, merchant.businessName)}>
                        <CreditCard className="w-4 h-4 mr-1" /> Plan
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex justify-center items-center gap-3 text-sm">
          <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button>
          <span className="text-muted-foreground">Page {page} of {totalPages}</span>
          <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>Next</Button>
        </div>
      )}

      {/* Reject Dialog */}
      <Dialog open={!!rejectId} onOpenChange={() => { setRejectId(null); setRejectReason(""); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject Merchant</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <Label>Rejection reason *</Label>
            <Textarea placeholder="Explain why this merchant is being rejected..." rows={3} value={rejectReason} onChange={e => setRejectReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRejectId(null); setRejectReason(""); }}>Cancel</Button>
            <Button variant="destructive" onClick={handleReject} disabled={!rejectReason.trim() || rejectMutation.isPending}>
              {rejectMutation.isPending ? "Rejecting..." : "Reject Merchant"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign Plan Dialog */}
      <Dialog open={!!assignPlanMerchant} onOpenChange={closeAssignPlan}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Assign Plan — {assignPlanMerchant?.name}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            {/* Current Plan */}
            {planLoading ? (
              <div className="rounded-lg border border-border/50 bg-muted/10 p-3 animate-pulse h-12" />
            ) : currentMerchantPlan ? (
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-primary shrink-0" />
                  <div className="flex-1">
                    <p className="text-xs text-muted-foreground">Current Plan</p>
                    <p className="text-sm font-semibold">{currentMerchantPlan.planName}</p>
                  </div>
                  {currentMerchantPlan.isExpired && <Badge variant="destructive" className="text-xs">Expired</Badge>}
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                  <div>
                    <span className="block font-medium text-foreground">{currentMerchantPlan.settlementFee}%</span>
                    Settlement
                  </div>
                  <div>
                    <span className="block font-medium text-foreground">{currentMerchantPlan.apiAccess ? "✓" : "✗"}</span>
                    API Access
                  </div>
                  <div>
                    <span className="block font-medium text-foreground">
                      {currentMerchantPlan.expiresAt
                        ? (currentMerchantPlan.isExpired ? "Expired" : format(new Date(currentMerchantPlan.expiresAt), "MMM d, yyyy"))
                        : "No expiry"}
                    </span>
                    Expiry
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-muted-foreground/30 bg-muted/5 p-3 flex items-center gap-2 text-muted-foreground">
                <CreditCard className="w-4 h-4 shrink-0" />
                <p className="text-xs">No plan currently assigned</p>
              </div>
            )}

            {/* Plan selector */}
            <div className="space-y-2">
              <Label>{currentMerchantPlan ? "Change Plan" : "Select Plan"}</Label>
              <Select value={selectedPlanId} onValueChange={setSelectedPlanId}>
                <SelectTrigger><SelectValue placeholder="Choose a plan..." /></SelectTrigger>
                <SelectContent>
                  {plans?.map(plan => (
                    <SelectItem key={plan.id} value={String(plan.id)}>
                      {plan.name}
                      {plan.price !== "0" ? ` — ₹${parseInt(plan.price).toLocaleString()}/mo` : " — Free"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Preview selected plan */}
            {selectedPlanId && plans && (() => {
              const plan = plans.find(p => String(p.id) === selectedPlanId);
              if (!plan) return null;
              return (
                <div className="rounded-lg border border-border/50 bg-muted/20 p-3 space-y-2">
                  <p className="text-sm font-medium">{plan.name}</p>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-muted-foreground">
                    <span>Dynamic QR: {plan.dynamicQrLimit >= 999 ? "∞" : plan.dynamicQrLimit}</span>
                    <span>Virtual Accounts: {plan.virtualAccountLimit >= 999 ? "∞" : plan.virtualAccountLimit}</span>
                    <span>Settlement: {plan.settlementFee}%</span>
                    <span>Daily Tx: {plan.dailyTransactionLimit >= 999 ? "∞" : plan.dailyTransactionLimit}</span>
                    <span>API: {plan.apiAccess ? "✓ Enabled" : "✗ Disabled"}</span>
                    <span>Webhooks: {plan.webhookAccess ? "✓ Enabled" : "✗ Disabled"}</span>
                  </div>
                </div>
              );
            })()}

            {/* Expiry Date */}
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> Plan Expiry Date (optional)</Label>
              <Input type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} min={new Date().toISOString().split("T")[0]} />
              <p className="text-xs text-muted-foreground">Leave empty for no expiry.</p>
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Textarea placeholder="e.g. Trial period, special arrangement..." rows={2} value={assignNotes} onChange={e => setAssignNotes(e.target.value)} />
            </div>

            <Separator />

            {/* Plan History toggle */}
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-muted-foreground"
              onClick={() => setShowHistory(h => !h)}
            >
              <History className="w-4 h-4 mr-2" />
              {showHistory ? "Hide" : "Show"} Plan History
            </Button>

            {showHistory && (
              <div className="space-y-2">
                {!planHistory || planHistory.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2 text-center">No plan history for this merchant.</p>
                ) : planHistory.map(entry => (
                  <div key={entry.id} className="flex items-start gap-3 text-xs">
                    <div className="w-1 h-1 rounded-full bg-primary/40 mt-1.5 shrink-0" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`font-medium capitalize ${ACTION_COLOR[entry.action] ?? "text-muted-foreground"}`}>{entry.action}</span>
                        {entry.toPlanName && <Badge variant="outline" className="text-xs py-0">{entry.toPlanName}</Badge>}
                        <span className="text-muted-foreground ml-auto">{formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true })}</span>
                      </div>
                      {entry.adminEmail && <p className="text-muted-foreground">by {entry.adminEmail}</p>}
                      {entry.notes && <p className="text-muted-foreground italic">"{entry.notes}"</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeAssignPlan}>Cancel</Button>
            <Button onClick={handleAssignPlan} disabled={!selectedPlanId || assignPlanMutation.isPending}>
              {assignPlanMutation.isPending ? "Assigning..." : currentMerchantPlan ? "Change Plan" : "Assign Plan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
