import { useState } from "react";
import { useListPlans, useCreatePlan, useUpdatePlan, useDeletePlan, getListPlansQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Pencil, Trash2, PlusCircle, Search, Infinity } from "lucide-react";
import { toast } from "sonner";
import type { Plan } from "@workspace/api-client-react";

interface PricingObj { qr: { monthly: number; perTx: number }; va: { monthly: number; perTx: number } }
const DEFAULT_PRICING: PricingObj = { qr: { monthly: 0, perTx: 0 }, va: { monthly: 0, perTx: 0 } };

function parsePricing(raw: string): PricingObj {
  try { return { ...DEFAULT_PRICING, ...JSON.parse(raw) }; } catch { return DEFAULT_PRICING; }
}

function LimitCell({ value }: { value: number }) {
  if (value >= 999) return <span className="flex items-center gap-1 text-emerald-400"><Infinity className="w-3.5 h-3.5" />Unlimited</span>;
  return <span>{value}</span>;
}

interface PlanFormState {
  name: string;
  description: string;
  pricing: PricingObj;
  features: string;
  dynamicQrLimit: number;
  staticQrLimit: number;
  virtualAccountLimit: number;
  paymentLinkLimit: number;
  payoutLimit: number;
}

const DEFAULT_FORM: PlanFormState = {
  name: "", description: "", pricing: DEFAULT_PRICING, features: "",
  dynamicQrLimit: 10, staticQrLimit: 10, virtualAccountLimit: 5,
  paymentLinkLimit: 10, payoutLimit: 20,
};

export default function AdminPlans() {
  const qc = useQueryClient();
  const { data: plans, isLoading } = useListPlans();
  const createMutation = useCreatePlan();
  const updateMutation = useUpdatePlan();
  const deleteMutation = useDeletePlan();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editPlan, setEditPlan] = useState<Plan | null>(null);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<PlanFormState>(DEFAULT_FORM);

  const filteredPlans = plans?.filter(p =>
    !search || p.name.toLowerCase().includes(search.toLowerCase()) || (p.description ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const setFormField = <K extends keyof PlanFormState>(key: K, value: PlanFormState[K]) =>
    setForm(f => ({ ...f, [key]: value }));

  const openCreate = () => {
    setEditPlan(null);
    setForm(DEFAULT_FORM);
    setDialogOpen(true);
  };

  const openEdit = (plan: Plan) => {
    setEditPlan(plan);
    setForm({
      name: plan.name,
      description: plan.description ?? "",
      pricing: parsePricing(plan.pricing),
      features: plan.features,
      dynamicQrLimit: plan.dynamicQrLimit,
      staticQrLimit: plan.staticQrLimit,
      virtualAccountLimit: plan.virtualAccountLimit,
      paymentLinkLimit: plan.paymentLinkLimit,
      payoutLimit: plan.payoutLimit,
    });
    setDialogOpen(true);
  };

  const buildPayload = () => ({
    name: form.name,
    description: form.description || null,
    pricing: JSON.stringify(form.pricing),
    features: form.features || "[]",
    dynamicQrLimit: form.dynamicQrLimit,
    staticQrLimit: form.staticQrLimit,
    virtualAccountLimit: form.virtualAccountLimit,
    paymentLinkLimit: form.paymentLinkLimit,
    payoutLimit: form.payoutLimit,
  });

  const handleSave = () => {
    const payload = buildPayload();
    if (editPlan) {
      updateMutation.mutate({ id: editPlan.id, data: payload }, {
        onSuccess: () => { toast.success("Plan updated"); setDialogOpen(false); qc.invalidateQueries({ queryKey: getListPlansQueryKey() }); },
        onError: () => toast.error("Failed to update plan"),
      });
    } else {
      createMutation.mutate({ data: payload }, {
        onSuccess: () => { toast.success("Plan created"); setDialogOpen(false); qc.invalidateQueries({ queryKey: getListPlansQueryKey() }); },
        onError: () => toast.error("Failed to create plan"),
      });
    }
  };

  const handleDelete = (id: number, name: string) => {
    if (!confirm(`Delete plan "${name}"? This will unassign it from any merchants.`)) return;
    deleteMutation.mutate({ id }, {
      onSuccess: () => { toast.success("Plan deleted"); qc.invalidateQueries({ queryKey: getListPlansQueryKey() }); },
      onError: () => toast.error("Failed to delete"),
    });
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Plans</h1>
          <p className="text-muted-foreground mt-1">Manage subscription plans and feature limits</p>
        </div>
        <Button onClick={openCreate} size="sm"><PlusCircle className="w-4 h-4 mr-2" />Create Plan</Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="Search plans..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plan</TableHead>
                <TableHead className="text-right">Dynamic QR</TableHead>
                <TableHead className="text-right">Static QR</TableHead>
                <TableHead className="text-right">Virtual Accounts</TableHead>
                <TableHead className="text-right">Payment Links</TableHead>
                <TableHead className="text-right">Payouts</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                [1,2,3,4,5].map(i => (
                  <TableRow key={i}>
                    {[1,2,3,4,5,6,7].map(j => <TableCell key={j}><div className="h-4 bg-muted/50 animate-pulse rounded" /></TableCell>)}
                  </TableRow>
                ))
              ) : filteredPlans?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-10">No plans found</TableCell>
                </TableRow>
              ) : filteredPlans?.map(plan => (
                <TableRow key={plan.id}>
                  <TableCell>
                    <div>
                      <p className="font-medium">{plan.name}</p>
                      {plan.description && <p className="text-xs text-muted-foreground mt-0.5">{plan.description}</p>}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm"><LimitCell value={plan.dynamicQrLimit} /></TableCell>
                  <TableCell className="text-right font-mono text-sm"><LimitCell value={plan.staticQrLimit} /></TableCell>
                  <TableCell className="text-right font-mono text-sm"><LimitCell value={plan.virtualAccountLimit} /></TableCell>
                  <TableCell className="text-right font-mono text-sm"><LimitCell value={plan.paymentLinkLimit} /></TableCell>
                  <TableCell className="text-right font-mono text-sm"><LimitCell value={plan.payoutLimit} /></TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(plan)}><Pencil className="w-3.5 h-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-rose-500 hover:text-rose-400" onClick={() => handleDelete(plan.id, plan.name)}><Trash2 className="w-3.5 h-3.5" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editPlan ? "Edit Plan" : "Create Plan"}</DialogTitle></DialogHeader>
          <div className="space-y-5 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5 col-span-2 sm:col-span-1">
                <Label>Plan Name *</Label>
                <Input placeholder="e.g. Starter, Business..." value={form.name} onChange={e => setFormField("name", e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea placeholder="Brief description..." rows={2} value={form.description} onChange={e => setFormField("description", e.target.value)} />
            </div>

            <div>
              <p className="text-sm font-medium mb-3 text-foreground">Feature Limits</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Dynamic QR Limit</Label>
                  <Input type="number" min={0} value={form.dynamicQrLimit} onChange={e => setFormField("dynamicQrLimit", parseInt(e.target.value) || 0)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Static QR Limit</Label>
                  <Input type="number" min={0} value={form.staticQrLimit} onChange={e => setFormField("staticQrLimit", parseInt(e.target.value) || 0)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Virtual Account Limit</Label>
                  <Input type="number" min={0} value={form.virtualAccountLimit} onChange={e => setFormField("virtualAccountLimit", parseInt(e.target.value) || 0)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Payment Link Limit</Label>
                  <Input type="number" min={0} value={form.paymentLinkLimit} onChange={e => setFormField("paymentLinkLimit", parseInt(e.target.value) || 0)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Payout Limit</Label>
                  <Input type="number" min={0} value={form.payoutLimit} onChange={e => setFormField("payoutLimit", parseInt(e.target.value) || 0)} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">Set to 999 for "unlimited".</p>
            </div>

            <div>
              <p className="text-sm font-medium mb-3 text-foreground">Pricing</p>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2 p-3 rounded-lg bg-muted/30">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">QR Pricing</p>
                  <div className="space-y-2">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Monthly (₹)</Label>
                      <Input type="number" value={form.pricing.qr.monthly} onChange={e => setFormField("pricing", { ...form.pricing, qr: { ...form.pricing.qr, monthly: parseFloat(e.target.value) || 0 } })} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Per Transaction (₹)</Label>
                      <Input type="number" value={form.pricing.qr.perTx} onChange={e => setFormField("pricing", { ...form.pricing, qr: { ...form.pricing.qr, perTx: parseFloat(e.target.value) || 0 } })} />
                    </div>
                  </div>
                </div>
                <div className="space-y-2 p-3 rounded-lg bg-muted/30">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Virtual Account Pricing</p>
                  <div className="space-y-2">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Monthly (₹)</Label>
                      <Input type="number" value={form.pricing.va.monthly} onChange={e => setFormField("pricing", { ...form.pricing, va: { ...form.pricing.va, monthly: parseFloat(e.target.value) || 0 } })} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Per Transaction (₹)</Label>
                      <Input type="number" value={form.pricing.va.perTx} onChange={e => setFormField("pricing", { ...form.pricing, va: { ...form.pricing.va, perTx: parseFloat(e.target.value) || 0 } })} />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Features (JSON array)</Label>
              <Textarea placeholder='["Unlimited QR", "Priority Support"]' rows={2} value={form.features} onChange={e => setFormField("features", e.target.value)} />
              <p className="text-xs text-muted-foreground">JSON array of feature strings shown to merchants</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={!form.name.trim() || isPending}>{editPlan ? "Update Plan" : "Create Plan"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
