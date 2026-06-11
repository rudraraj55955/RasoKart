import { useState } from "react";
import {
  useListInvoices, useCreateInvoice, useMarkInvoicePaid, useVoidInvoice,
  useListMerchants, useListPlans, getListInvoicesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PlusCircle, CheckCircle2, Ban, Search, Receipt } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { getApiErrorMessage } from "@/lib/utils";

const STATUS_STYLE: Record<string, string> = {
  draft: "text-muted-foreground border-muted-foreground/30",
  issued: "text-sky-400 border-sky-500/30 bg-sky-500/10",
  paid: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
  void: "text-rose-400 border-rose-500/30 bg-rose-500/10",
};

export default function AdminInvoices() {
  const qc = useQueryClient();
  const [merchantFilter, setMerchantFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    merchantId: "", planId: "", amount: "", currency: "INR",
    period: "", periodFrom: "", periodTo: "", dueDate: "", notes: "", status: "issued",
  });

  const { data, isLoading } = useListInvoices({
    status: statusFilter !== "all" ? statusFilter as any : undefined,
    page, limit: 20,
  });
  const { data: merchants } = useListMerchants({ limit: 200 });
  const { data: plans } = useListPlans();
  const createMutation = useCreateInvoice();
  const markPaidMutation = useMarkInvoicePaid();
  const voidMutation = useVoidInvoice();

  const invalidate = () => qc.invalidateQueries({ queryKey: getListInvoicesQueryKey() });

  const handleCreate = () => {
    if (!form.merchantId || !form.amount) return;
    createMutation.mutate({
      data: {
        merchantId: parseInt(form.merchantId),
        planId: form.planId ? parseInt(form.planId) : null,
        amount: form.amount,
        currency: form.currency || "INR",
        period: form.period || null,
        periodFrom: form.periodFrom || null,
        periodTo: form.periodTo || null,
        dueDate: form.dueDate || null,
        notes: form.notes || null,
        status: form.status || "issued",
      },
    }, {
      onSuccess: () => { toast.success("Invoice created"); setCreateOpen(false); invalidate(); },
      onError: (err: unknown) => toast.error(getApiErrorMessage(err, "Failed to create invoice")),
    });
  };

  const handleMarkPaid = (id: number) => {
    markPaidMutation.mutate({ id }, {
      onSuccess: () => { toast.success("Marked as paid"); invalidate(); },
      onError: (err: unknown) => toast.error(getApiErrorMessage(err, "Failed to mark as paid")),
    });
  };

  const handleVoid = (id: number) => {
    if (!confirm("Void this invoice?")) return;
    voidMutation.mutate({ id }, {
      onSuccess: () => { toast.success("Invoice voided"); invalidate(); },
      onError: (err: unknown) => toast.error(getApiErrorMessage(err, "Failed to void invoice")),
    });
  };

  const invoices = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 20);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Invoices</h1>
          <p className="text-muted-foreground mt-1">{total} total invoices</p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <PlusCircle className="w-4 h-4 mr-2" />Create Invoice
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search merchant..." value={merchantFilter} onChange={e => setMerchantFilter(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="issued">Issued</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="void">Void</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice #</TableHead>
                <TableHead>Merchant</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Period</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                [1,2,3,4,5].map(i => (
                  <TableRow key={i}>
                    {[1,2,3,4,5,6,7,8,9].map(j => <TableCell key={j}><div className="h-4 bg-muted/50 animate-pulse rounded" /></TableCell>)}
                  </TableRow>
                ))
              ) : invoices.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-10">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <Receipt className="w-8 h-8 opacity-30" />
                      <p className="text-sm">No invoices yet</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : invoices
                  .filter(inv => !merchantFilter || (inv.merchantName ?? "").toLowerCase().includes(merchantFilter.toLowerCase()))
                  .map(inv => (
                <TableRow key={inv.id}>
                  <TableCell className="font-mono text-xs">{inv.invoiceNumber}</TableCell>
                  <TableCell>
                    <div>
                      <p className="text-sm font-medium">{inv.merchantName ?? `Merchant #${inv.merchantId}`}</p>
                      {inv.merchantEmail && <p className="text-xs text-muted-foreground">{inv.merchantEmail}</p>}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{inv.planName ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{inv.period ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono text-sm font-semibold">₹{parseFloat(inv.amount).toLocaleString()}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {inv.dueDate ? format(new Date(inv.dueDate), "MMM d, yyyy") : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-xs ${STATUS_STYLE[inv.status] ?? ""}`}>
                      {inv.status.charAt(0).toUpperCase() + inv.status.slice(1)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {format(new Date(inv.createdAt), "MMM d, yyyy")}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {(inv.status === "issued" || inv.status === "draft") && (
                        <Button size="sm" variant="ghost" className="text-emerald-500 hover:bg-emerald-500/10" onClick={() => handleMarkPaid(inv.id)}>
                          <CheckCircle2 className="w-3.5 h-3.5 mr-1" />Paid
                        </Button>
                      )}
                      {inv.status !== "void" && inv.status !== "paid" && (
                        <Button size="sm" variant="ghost" className="text-rose-500 hover:bg-rose-500/10" onClick={() => handleVoid(inv.id)}>
                          <Ban className="w-3.5 h-3.5 mr-1" />Void
                        </Button>
                      )}
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

      {/* Create Invoice Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Create Invoice</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Merchant *</Label>
              <Select value={form.merchantId} onValueChange={v => setForm(f => ({ ...f, merchantId: v }))}>
                <SelectTrigger><SelectValue placeholder="Select merchant..." /></SelectTrigger>
                <SelectContent>
                  {merchants?.data?.map(m => (
                    <SelectItem key={m.id} value={String(m.id)}>{m.businessName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Plan (optional)</Label>
              <Select value={form.planId} onValueChange={v => {
                const plan = plans?.find(p => String(p.id) === v);
                setForm(f => ({ ...f, planId: v, amount: plan?.monthlyFee ?? f.amount }));
              }}>
                <SelectTrigger><SelectValue placeholder="Link to plan..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None</SelectItem>
                  {plans?.map(p => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.name} — ₹{parseInt(p.monthlyFee).toLocaleString()}/mo</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Amount (₹) *</Label>
                <Input type="number" min={0} value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="e.g. 999" />
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="issued">Issued</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Period (e.g. "June 2026")</Label>
              <Input value={form.period} onChange={e => setForm(f => ({ ...f, period: e.target.value }))} placeholder="June 2026" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Due Date</Label>
                <Input type="date" value={form.dueDate} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Any additional notes..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!form.merchantId || !form.amount || createMutation.isPending}>
              {createMutation.isPending ? "Creating..." : "Create Invoice"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
