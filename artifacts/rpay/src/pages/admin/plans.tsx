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
import { Pencil, Trash2, PlusCircle, Search } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

interface PricingObj { qr: { monthly: number; perTx: number }; va: { monthly: number; perTx: number } }
const DEFAULT_PRICING: PricingObj = { qr: { monthly: 0, perTx: 0 }, va: { monthly: 0, perTx: 0 } };

function parsePricing(raw: string): PricingObj {
  try { return { ...DEFAULT_PRICING, ...JSON.parse(raw) }; } catch { return DEFAULT_PRICING; }
}

function parseFeatures(raw: string): string[] {
  try { return JSON.parse(raw); } catch { return []; }
}

export default function AdminPlans() {
  const qc = useQueryClient();
  const { data: plans, isLoading } = useListPlans();
  const createMutation = useCreatePlan();
  const updateMutation = useUpdatePlan();
  const deleteMutation = useDeletePlan();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editPlan, setEditPlan] = useState<{ id: number; name: string; description: string; pricing: PricingObj; features: string } | null>(null);
  const [search, setSearch] = useState("");

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [pricing, setPricing] = useState<PricingObj>(DEFAULT_PRICING);
  const [features, setFeatures] = useState("");

  const filteredPlans = plans?.filter(p =>
    !search || p.name.toLowerCase().includes(search.toLowerCase()) || (p.description ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const openCreate = () => {
    setEditPlan(null);
    setName(""); setDescription(""); setPricing(DEFAULT_PRICING); setFeatures("");
    setDialogOpen(true);
  };

  const openEdit = (plan: NonNullable<typeof plans>[0]) => {
    const p = parsePricing(plan.pricing);
    setEditPlan({ id: plan.id, name: plan.name, description: plan.description ?? "", pricing: p, features: plan.features });
    setName(plan.name); setDescription(plan.description ?? ""); setPricing(p); setFeatures(plan.features);
    setDialogOpen(true);
  };

  const handleSave = () => {
    const pricingStr = JSON.stringify(pricing);
    const payload = { name, description: description || null, pricing: pricingStr, features: features || "[]" };
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

  const handleDelete = (id: number) => {
    if (!confirm("Delete this plan?")) return;
    deleteMutation.mutate({ id }, {
      onSuccess: () => { toast.success("Plan deleted"); qc.invalidateQueries({ queryKey: getListPlansQueryKey() }); },
      onError: () => toast.error("Failed to delete"),
    });
  };

  const exportCsv = () => {
    if (!filteredPlans?.length) return;
    const rows = [["Name", "Description", "QR Monthly (₹)", "QR Per Txn (₹)", "VA Monthly (₹)", "VA Per Txn (₹)", "Created"]];
    filteredPlans.forEach(plan => {
      const p = parsePricing(plan.pricing);
      rows.push([plan.name, plan.description ?? "", String(p.qr.monthly), String(p.qr.perTx), String(p.va.monthly), String(p.va.perTx), plan.createdAt]);
    });
    const csv = rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv])); a.download = "plans.csv"; a.click();
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Plans</h1>
          <p className="text-muted-foreground mt-1">Manage subscription plans and pricing tiers</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv}>Export CSV</Button>
          <Button onClick={openCreate} size="sm"><PlusCircle className="w-4 h-4 mr-2" />Create Plan</Button>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="Search plans..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {isLoading ? (
          [1,2,3].map(i => <Card key={i} className="animate-pulse h-52 bg-muted/50" />)
        ) : filteredPlans?.length === 0 ? (
          <p className="col-span-full text-center text-muted-foreground py-10">No plans found</p>
        ) : filteredPlans?.map(plan => {
          const p = parsePricing(plan.pricing);
          const featureList = parseFeatures(plan.features);
          return (
            <Card key={plan.id} className="border-border">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg">{plan.name}</CardTitle>
                    {plan.description && <p className="text-sm text-muted-foreground mt-0.5">{plan.description}</p>}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(plan)}><Pencil className="w-3.5 h-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-rose-500 hover:text-rose-400" onClick={() => handleDelete(plan.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-md bg-muted/50 p-2">
                    <p className="text-muted-foreground font-medium mb-1">QR</p>
                    <p>₹{p.qr.monthly}/mo</p>
                    <p className="text-muted-foreground">₹{p.qr.perTx}/txn</p>
                  </div>
                  <div className="rounded-md bg-muted/50 p-2">
                    <p className="text-muted-foreground font-medium mb-1">Virtual Account</p>
                    <p>₹{p.va.monthly}/mo</p>
                    <p className="text-muted-foreground">₹{p.va.perTx}/txn</p>
                  </div>
                </div>
                {featureList.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {featureList.map((f, i) => <Badge key={i} variant="outline" className="text-[10px]">{f}</Badge>)}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">Created {format(new Date(plan.createdAt), "MMM d, yyyy")}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {filteredPlans && filteredPlans.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Pricing Breakdown</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Plan</TableHead>
                  <TableHead>QR Monthly</TableHead>
                  <TableHead>QR Per Txn</TableHead>
                  <TableHead>VA Monthly</TableHead>
                  <TableHead>VA Per Txn</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPlans.map(plan => {
                  const p = parsePricing(plan.pricing);
                  return (
                    <TableRow key={plan.id}>
                      <TableCell className="font-medium">{plan.name}</TableCell>
                      <TableCell className="font-mono">₹{p.qr.monthly}</TableCell>
                      <TableCell className="font-mono">₹{p.qr.perTx}</TableCell>
                      <TableCell className="font-mono">₹{p.va.monthly}</TableCell>
                      <TableCell className="font-mono">₹{p.va.perTx}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editPlan ? "Edit Plan" : "Create Plan"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Plan Name</Label>
              <Input placeholder="e.g. Starter, Business..." value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea placeholder="Brief description..." rows={2} value={description} onChange={e => setDescription(e.target.value)} />
            </div>
            <div>
              <Label className="block mb-2">QR Pricing</Label>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Monthly (₹)</Label>
                  <Input type="number" value={pricing.qr.monthly} onChange={e => setPricing(p => ({ ...p, qr: { ...p.qr, monthly: parseFloat(e.target.value) || 0 } }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Per Transaction (₹)</Label>
                  <Input type="number" value={pricing.qr.perTx} onChange={e => setPricing(p => ({ ...p, qr: { ...p.qr, perTx: parseFloat(e.target.value) || 0 } }))} />
                </div>
              </div>
            </div>
            <div>
              <Label className="block mb-2">Virtual Account Pricing</Label>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Monthly (₹)</Label>
                  <Input type="number" value={pricing.va.monthly} onChange={e => setPricing(p => ({ ...p, va: { ...p.va, monthly: parseFloat(e.target.value) || 0 } }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Per Transaction (₹)</Label>
                  <Input type="number" value={pricing.va.perTx} onChange={e => setPricing(p => ({ ...p, va: { ...p.va, perTx: parseFloat(e.target.value) || 0 } }))} />
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Features (JSON array)</Label>
              <Textarea placeholder='["Unlimited QR", "Priority Support"]' rows={2} value={features} onChange={e => setFeatures(e.target.value)} />
              <p className="text-xs text-muted-foreground">Enter as JSON array of strings</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={!name.trim() || isPending}>{editPlan ? "Update" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
