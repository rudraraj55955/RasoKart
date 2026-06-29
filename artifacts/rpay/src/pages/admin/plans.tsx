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
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Pencil, Trash2, PlusCircle, Search, Infinity, KeyRound, Webhook, Percent, CheckCircle2, XCircle, Network } from "lucide-react";
import { toast } from "sonner";
import type { Plan } from "@workspace/api-client-react";

interface PricingObj { qr: { monthly: number; perTx: number }; va: { monthly: number; perTx: number } }
const DEFAULT_PRICING: PricingObj = { qr: { monthly: 0, perTx: 0 }, va: { monthly: 0, perTx: 0 } };

function parsePricing(raw: string): PricingObj {
  try { return { ...DEFAULT_PRICING, ...JSON.parse(raw) }; } catch { return DEFAULT_PRICING; }
}

function LimitCell({ value }: { value: number }) {
  if (value >= 999) return <span className="flex items-center gap-1 text-emerald-400"><Infinity className="w-3.5 h-3.5" /></span>;
  return <span>{value}</span>;
}

interface PlanFormState {
  name: string;
  description: string;
  price: string;
  monthlyFee: string;
  yearlyFee: string;
  setupFee: string;
  pricing: PricingObj;
  features: string;
  customFeatures: string;
  dynamicQrLimit: number;
  staticQrLimit: number;
  virtualAccountLimit: number;
  paymentLinkLimit: number;
  payoutLimit: number;
  dailyTransactionLimit: number;
  monthlyTransactionLimit: number;
  settlementFee: string;
  depositFee: string;
  apiAccess: boolean;
  webhookAccess: boolean;
  providerAccess: boolean;
  isActive: boolean;
}

const DEFAULT_FORM: PlanFormState = {
  name: "", description: "", price: "0", monthlyFee: "0", yearlyFee: "0", setupFee: "0",
  pricing: DEFAULT_PRICING, features: "", customFeatures: "",
  dynamicQrLimit: 10, staticQrLimit: 10, virtualAccountLimit: 5,
  paymentLinkLimit: 10, payoutLimit: 20,
  dailyTransactionLimit: 999, monthlyTransactionLimit: 9999,
  settlementFee: "2.0", depositFee: "0.0",
  apiAccess: true, webhookAccess: true, providerAccess: false, isActive: true,
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

  const setField = <K extends keyof PlanFormState>(key: K, value: PlanFormState[K]) =>
    setForm(f => ({ ...f, [key]: value }));

  const openCreate = () => { setEditPlan(null); setForm(DEFAULT_FORM); setDialogOpen(true); };
  const openEdit = (plan: Plan) => {
    setEditPlan(plan);
    setForm({
      name: plan.name,
      description: plan.description ?? "",
      price: plan.price ?? "0",
      monthlyFee: plan.monthlyFee ?? plan.price ?? "0",
      yearlyFee: plan.yearlyFee ?? "0",
      setupFee: plan.setupFee ?? "0",
      pricing: parsePricing(plan.pricing),
      features: plan.features,
      customFeatures: plan.customFeatures ?? "",
      dynamicQrLimit: plan.dynamicQrLimit,
      staticQrLimit: plan.staticQrLimit,
      virtualAccountLimit: plan.virtualAccountLimit,
      paymentLinkLimit: plan.paymentLinkLimit,
      payoutLimit: plan.payoutLimit,
      dailyTransactionLimit: plan.dailyTransactionLimit,
      monthlyTransactionLimit: plan.monthlyTransactionLimit,
      settlementFee: plan.settlementFee,
      depositFee: plan.depositFee,
      apiAccess: plan.apiAccess,
      webhookAccess: plan.webhookAccess,
      providerAccess: plan.providerAccess ?? false,
      isActive: plan.isActive,
    });
    setDialogOpen(true);
  };

  const buildPayload = () => ({
    name: form.name,
    description: form.description || null,
    price: form.monthlyFee || "0",
    monthlyFee: form.monthlyFee || "0",
    yearlyFee: form.yearlyFee || "0",
    setupFee: form.setupFee || "0",
    pricing: JSON.stringify(form.pricing),
    features: form.features || "[]",
    customFeatures: form.customFeatures || "[]",
    dynamicQrLimit: form.dynamicQrLimit,
    staticQrLimit: form.staticQrLimit,
    virtualAccountLimit: form.virtualAccountLimit,
    paymentLinkLimit: form.paymentLinkLimit,
    payoutLimit: form.payoutLimit,
    dailyTransactionLimit: form.dailyTransactionLimit,
    monthlyTransactionLimit: form.monthlyTransactionLimit,
    settlementFee: form.settlementFee,
    depositFee: form.depositFee,
    apiAccess: form.apiAccess,
    webhookAccess: form.webhookAccess,
    providerAccess: form.providerAccess,
    isActive: form.isActive,
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
          <p className="text-muted-foreground mt-1">Manage subscription plans, feature limits, and fees</p>
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
                <TableHead className="text-right">Monthly</TableHead>
                <TableHead className="text-right">Yearly</TableHead>
                <TableHead className="text-right">Setup</TableHead>
                <TableHead className="text-right">DQR</TableHead>
                <TableHead className="text-right">VA</TableHead>
                <TableHead className="text-right">Settlement</TableHead>
                <TableHead className="text-center">API</TableHead>
                <TableHead className="text-center">WH</TableHead>
                <TableHead className="text-center">Provider</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                [1,2,3,4,5,6].map(i => (
                  <TableRow key={i}>
                    {[1,2,3,4,5,6,7,8,9,10,11,12].map(j => <TableCell key={j}><div className="h-4 bg-muted/50 animate-pulse rounded" /></TableCell>)}
                  </TableRow>
                ))
              ) : filteredPlans?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={12} className="text-center text-muted-foreground py-10">No plans found</TableCell>
                </TableRow>
              ) : filteredPlans?.map(plan => (
                <TableRow key={plan.id}>
                  <TableCell>
                    <div>
                      <p className="font-medium">{plan.name}</p>
                      {plan.description && <p className="text-xs text-muted-foreground mt-0.5 max-w-xs truncate">{plan.description}</p>}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {plan.monthlyFee === "0" ? <span className="text-emerald-400">Free</span> : `₹${parseInt(plan.monthlyFee).toLocaleString()}`}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm text-muted-foreground">
                    {plan.yearlyFee === "0" ? "—" : `₹${parseInt(plan.yearlyFee).toLocaleString()}`}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm text-muted-foreground">
                    {plan.setupFee === "0" ? "—" : `₹${parseInt(plan.setupFee).toLocaleString()}`}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm"><LimitCell value={plan.dynamicQrLimit} /></TableCell>
                  <TableCell className="text-right font-mono text-sm"><LimitCell value={plan.virtualAccountLimit} /></TableCell>
                  <TableCell className="text-right font-mono text-sm">{plan.settlementFee}%</TableCell>
                  <TableCell className="text-center">
                    {plan.apiAccess ? <CheckCircle2 className="w-4 h-4 text-emerald-400 mx-auto" /> : <XCircle className="w-4 h-4 text-muted-foreground mx-auto" />}
                  </TableCell>
                  <TableCell className="text-center">
                    {plan.webhookAccess ? <CheckCircle2 className="w-4 h-4 text-emerald-400 mx-auto" /> : <XCircle className="w-4 h-4 text-muted-foreground mx-auto" />}
                  </TableCell>
                  <TableCell className="text-center">
                    {plan.providerAccess ? <CheckCircle2 className="w-4 h-4 text-emerald-400 mx-auto" /> : <XCircle className="w-4 h-4 text-muted-foreground mx-auto" />}
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant={plan.isActive ? "outline" : "secondary"} className={plan.isActive ? "text-emerald-400 border-emerald-500/30" : ""}>
                      {plan.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
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
        <DialogContent className="max-w-3xl max-h-[calc(100dvh-4rem)] overflow-y-auto">
          <DialogHeader><DialogTitle>{editPlan ? "Edit Plan" : "Create Plan"}</DialogTitle></DialogHeader>
          <div className="space-y-5 py-2">

            {/* Basic */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Plan Name *</Label>
                <Input placeholder="e.g. Starter, Silver, Gold..." value={form.name} onChange={e => setField("name", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Monthly Fee (₹)</Label>
                <Input type="number" min={0} placeholder="0 = Free" value={form.monthlyFee} onChange={e => { setField("monthlyFee", e.target.value); }} />
              </div>
              <div className="space-y-1.5">
                <Label>Yearly Fee (₹)</Label>
                <Input type="number" min={0} placeholder="0 = not offered" value={form.yearlyFee} onChange={e => setField("yearlyFee", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Setup Fee (₹)</Label>
                <Input type="number" min={0} placeholder="0 = no setup fee" value={form.setupFee} onChange={e => setField("setupFee", e.target.value)} />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label>Description</Label>
                <Textarea placeholder="Brief description..." rows={2} value={form.description} onChange={e => setField("description", e.target.value)} />
              </div>
            </div>

            <Separator />

            {/* Feature Limits */}
            <div>
              <p className="text-sm font-semibold mb-3">Feature Limits <span className="text-muted-foreground font-normal">(set 999 = unlimited)</span></p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                {[
                  { label: "Dynamic QR Limit", key: "dynamicQrLimit" as const },
                  { label: "Static QR Limit", key: "staticQrLimit" as const },
                  { label: "Virtual Account Limit", key: "virtualAccountLimit" as const },
                  { label: "Payment Link Limit", key: "paymentLinkLimit" as const },
                  { label: "Payout Limit", key: "payoutLimit" as const },
                ].map(({ label, key }) => (
                  <div key={key} className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">{label}</Label>
                    <Input type="number" min={0} value={form[key] as number} onChange={e => setField(key, parseInt(e.target.value) || 0)} />
                  </div>
                ))}
              </div>
            </div>

            {/* Transaction Limits */}
            <div>
              <p className="text-sm font-semibold mb-3">Transaction Limits</p>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Daily Transaction Limit</Label>
                  <Input type="number" min={0} value={form.dailyTransactionLimit} onChange={e => setField("dailyTransactionLimit", parseInt(e.target.value) || 0)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Monthly Transaction Limit</Label>
                  <Input type="number" min={0} value={form.monthlyTransactionLimit} onChange={e => setField("monthlyTransactionLimit", parseInt(e.target.value) || 0)} />
                </div>
              </div>
            </div>

            <Separator />

            {/* Fees */}
            <div>
              <p className="text-sm font-semibold mb-3">Transaction Fees</p>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1 text-xs text-muted-foreground"><Percent className="w-3 h-3" /> Settlement Fee (%)</Label>
                  <Input placeholder="e.g. 1.5" value={form.settlementFee} onChange={e => setField("settlementFee", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1 text-xs text-muted-foreground"><Percent className="w-3 h-3" /> Deposit Fee (%)</Label>
                  <Input placeholder="e.g. 0.5" value={form.depositFee} onChange={e => setField("depositFee", e.target.value)} />
                </div>
              </div>
            </div>

            <Separator />

            {/* Feature Access */}
            <div>
              <p className="text-sm font-semibold mb-3">Feature Access</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-muted/20">
                  <div className="flex items-center gap-2">
                    <KeyRound className="w-4 h-4 text-muted-foreground" />
                    <Label className="text-sm cursor-pointer">API Access</Label>
                  </div>
                  <Switch checked={form.apiAccess} onCheckedChange={v => setField("apiAccess", v)} />
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-muted/20">
                  <div className="flex items-center gap-2">
                    <Webhook className="w-4 h-4 text-muted-foreground" />
                    <Label className="text-sm cursor-pointer">Webhooks</Label>
                  </div>
                  <Switch checked={form.webhookAccess} onCheckedChange={v => setField("webhookAccess", v)} />
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-muted/20">
                  <div className="flex items-center gap-2">
                    <Network className="w-4 h-4 text-muted-foreground" />
                    <Label className="text-sm cursor-pointer">Provider Access</Label>
                  </div>
                  <Switch checked={form.providerAccess} onCheckedChange={v => setField("providerAccess", v)} />
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-muted/20">
                  <Label className="text-sm cursor-pointer">Plan Active</Label>
                  <Switch checked={form.isActive} onCheckedChange={v => setField("isActive", v)} />
                </div>
              </div>
            </div>

            <Separator />

            {/* Per-Tx Pricing */}
            <div>
              <p className="text-sm font-semibold mb-3">Per-Transaction Pricing</p>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2 p-3 rounded-lg bg-muted/30">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">QR Pricing</p>
                  <div className="space-y-2">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Monthly (₹)</Label>
                      <Input type="number" value={form.pricing.qr.monthly} onChange={e => setField("pricing", { ...form.pricing, qr: { ...form.pricing.qr, monthly: parseFloat(e.target.value) || 0 } })} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Per Transaction (₹)</Label>
                      <Input type="number" value={form.pricing.qr.perTx} onChange={e => setField("pricing", { ...form.pricing, qr: { ...form.pricing.qr, perTx: parseFloat(e.target.value) || 0 } })} />
                    </div>
                  </div>
                </div>
                <div className="space-y-2 p-3 rounded-lg bg-muted/30">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Virtual Account Pricing</p>
                  <div className="space-y-2">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Monthly (₹)</Label>
                      <Input type="number" value={form.pricing.va.monthly} onChange={e => setField("pricing", { ...form.pricing, va: { ...form.pricing.va, monthly: parseFloat(e.target.value) || 0 } })} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Per Transaction (₹)</Label>
                      <Input type="number" value={form.pricing.va.perTx} onChange={e => setField("pricing", { ...form.pricing, va: { ...form.pricing.va, perTx: parseFloat(e.target.value) || 0 } })} />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <Separator />

            <div className="space-y-1.5">
              <Label>Standard Features (JSON array)</Label>
              <Textarea placeholder='["API Access", "Priority Support", "Custom Webhooks"]' rows={2} value={form.features} onChange={e => setField("features", e.target.value)} />
              <p className="text-xs text-muted-foreground">JSON array of feature strings shown on merchant plan page.</p>
            </div>

            <div className="space-y-1.5">
              <Label>Custom Features / Add-ons (JSON array)</Label>
              <Textarea placeholder='["T+1 settlement", "Dedicated manager", "Custom SLA"]' rows={2} value={form.customFeatures} onChange={e => setField("customFeatures", e.target.value)} />
              <p className="text-xs text-muted-foreground">Extra premium features negotiated per plan.</p>
            </div>

          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={!form.name.trim() || isPending}>
              {isPending ? "Saving..." : editPlan ? "Update Plan" : "Create Plan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
