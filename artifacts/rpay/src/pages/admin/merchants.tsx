import { useState } from "react";
import { useListMerchants, useApproveMerchant, useRejectMerchant, useListPlans, useAssignMerchantPlan, getListMerchantsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle, XCircle, Search, CreditCard } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

export default function AdminMerchants() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [rejectId, setRejectId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [assignPlanMerchant, setAssignPlanMerchant] = useState<{ id: number; name: string } | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string>("");

  const { data, isLoading } = useListMerchants({ status: status as any, search, page, limit: 20 });
  const { data: plans } = useListPlans();
  const approveMutation = useApproveMerchant();
  const rejectMutation = useRejectMerchant();
  const assignPlanMutation = useAssignMerchantPlan();

  const handleApprove = (id: number) => {
    approveMutation.mutate({ id }, {
      onSuccess: () => {
        toast.success("Merchant approved");
        qc.invalidateQueries({ queryKey: getListMerchantsQueryKey() });
      },
      onError: () => toast.error("Failed to approve merchant"),
    });
  };

  const handleReject = () => {
    if (!rejectId || !rejectReason.trim()) return;
    rejectMutation.mutate({ id: rejectId, data: { reason: rejectReason } }, {
      onSuccess: () => {
        toast.success("Merchant rejected");
        setRejectId(null);
        setRejectReason("");
        qc.invalidateQueries({ queryKey: getListMerchantsQueryKey() });
      },
      onError: () => toast.error("Failed to reject merchant"),
    });
  };

  const handleAssignPlan = () => {
    if (!assignPlanMerchant || !selectedPlanId) return;
    assignPlanMutation.mutate({ id: assignPlanMerchant.id, data: { planId: parseInt(selectedPlanId) } }, {
      onSuccess: () => {
        toast.success("Plan assigned successfully");
        setAssignPlanMerchant(null);
        setSelectedPlanId("");
      },
      onError: () => toast.error("Failed to assign plan"),
    });
  };

  const exportCsv = () => {
    if (!data?.data) return;
    const rows = [["ID", "Business Name", "Contact", "Email", "Phone", "Status", "Balance", "Created"]];
    data.data.forEach(m => rows.push([String(m.id), m.businessName, m.contactName, m.email, m.phone, m.status, String(m.balance), m.createdAt]));
    const csv = rows.map(r => r.join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv])); a.download = "merchants.csv"; a.click();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-3xl font-bold tracking-tight">Merchants</h1><p className="text-muted-foreground mt-1">Manage merchant accounts and approvals</p></div>
        <Button variant="outline" size="sm" onClick={exportCsv}>Export CSV</Button>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search by name or email..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
            </div>
            <Select value={status} onValueChange={v => { setStatus(v); setPage(1); }}>
              <SelectTrigger className="w-[160px]"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Business</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Balance</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>{Array.from({ length: 8 }).map((_, j) => <TableCell key={j}><div className="h-4 bg-muted/50 rounded animate-pulse" /></TableCell>)}</TableRow>
                ))
              ) : data?.data?.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-10">No merchants found</TableCell></TableRow>
              ) : data?.data?.map(merchant => (
                <TableRow key={merchant.id}>
                  <TableCell className="font-medium">{merchant.businessName}</TableCell>
                  <TableCell>{merchant.contactName}</TableCell>
                  <TableCell className="text-muted-foreground">{merchant.email}</TableCell>
                  <TableCell>{merchant.phone}</TableCell>
                  <TableCell className="font-mono">₹{Number(merchant.balance).toLocaleString()}</TableCell>
                  <TableCell><StatusBadge status={merchant.status} /></TableCell>
                  <TableCell className="text-muted-foreground text-sm">{format(new Date(merchant.createdAt), "MMM d, yyyy")}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      {merchant.status === "pending" && (
                        <>
                          <Button size="sm" variant="ghost" className="text-emerald-500 hover:text-emerald-400 hover:bg-emerald-500/10" onClick={() => handleApprove(merchant.id)} disabled={approveMutation.isPending}>
                            <CheckCircle className="w-4 h-4 mr-1" /> Approve
                          </Button>
                          <Button size="sm" variant="ghost" className="text-rose-500 hover:text-rose-400 hover:bg-rose-500/10" onClick={() => { setRejectId(merchant.id); setRejectReason(""); }}>
                            <XCircle className="w-4 h-4 mr-1" /> Reject
                          </Button>
                        </>
                      )}
                      <Button size="sm" variant="ghost" className="text-primary hover:bg-primary/10" onClick={() => { setAssignPlanMerchant({ id: merchant.id, name: merchant.businessName }); setSelectedPlanId(""); }}>
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

      {data && data.total > 20 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{data.total} total</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button>
            <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page * 20 >= data.total}>Next</Button>
          </div>
        </div>
      )}

      <Dialog open={!!rejectId} onOpenChange={() => setRejectId(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject Merchant</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <Label>Reason for rejection</Label>
            <Textarea placeholder="Explain why this merchant is being rejected..." value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={3} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleReject} disabled={!rejectReason.trim() || rejectMutation.isPending}>Reject Merchant</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!assignPlanMerchant} onOpenChange={() => { setAssignPlanMerchant(null); setSelectedPlanId(""); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Assign Plan — {assignPlanMerchant?.name}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <Label>Select Plan</Label>
            <Select value={selectedPlanId} onValueChange={setSelectedPlanId}>
              <SelectTrigger><SelectValue placeholder="Choose a plan..." /></SelectTrigger>
              <SelectContent>
                {plans?.map(plan => (
                  <SelectItem key={plan.id} value={String(plan.id)}>
                    {plan.name}
                    {plan.description ? ` — ${plan.description}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedPlanId && plans && (
              <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
                {(() => {
                  const plan = plans.find(p => String(p.id) === selectedPlanId);
                  if (!plan) return null;
                  let features: string[] = [];
                  try { features = JSON.parse(plan.features); } catch {}
                  return (
                    <div className="space-y-2">
                      <p className="text-sm font-medium">{plan.name}</p>
                      {features.length > 0 && (
                        <ul className="text-xs text-muted-foreground space-y-0.5">
                          {features.slice(0, 4).map((f, i) => <li key={i}>• {f}</li>)}
                        </ul>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAssignPlanMerchant(null); setSelectedPlanId(""); }}>Cancel</Button>
            <Button onClick={handleAssignPlan} disabled={!selectedPlanId || assignPlanMutation.isPending}>
              {assignPlanMutation.isPending ? "Assigning..." : "Assign Plan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
