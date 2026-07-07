import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListUpiGateways, getListUpiGatewaysQueryKey,
  useCreateUpiGateway, useUpdateUpiGateway, useDeleteUpiGateway,
  useTestUpiGatewayConnection, useTestUpiGatewayWebhook, useAssignUpiGatewayMerchants,
  useGetUpiGatewayMerchants,
  useGetMe,
} from "@workspace/api-client-react";
import type { UpiGateway, UpiGatewayAssignMerchantsBodyPerMerchantItem } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  Search, Plus, Settings2, Users, FlaskConical, Radio, Pencil, Trash2,
  CheckCircle2, XCircle, Lock, ShieldAlert, RefreshCw, Zap,
} from "lucide-react";

const CATEGORY_LABEL: Record<string, string> = {
  upi: "UPI", bank_upi: "Bank UPI", qr: "QR", custom: "Custom",
};
const STATUS_META: Record<string, { label: string; color: string }> = {
  live:        { label: "Live",        color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" },
  testing:     { label: "Testing",     color: "bg-amber-500/10 text-amber-400 border-amber-500/30" },
  coming_soon: { label: "Coming Soon", color: "bg-sky-500/10 text-sky-400 border-sky-500/30" },
  disabled:    { label: "Disabled",    color: "bg-muted text-muted-foreground border-border" },
};

type CreateForm = {
  name: string; category: string; status: string; mode: string;
  apiBaseUrl: string; apiKey: string; clientId: string; clientSecret: string; webhookSecret: string;
  minAmount: string; maxAmount: string; dailyLimit: string; priority: string; notes: string;
};
const DEFAULT_CREATE: CreateForm = {
  name: "", category: "upi", status: "live", mode: "test",
  apiBaseUrl: "", apiKey: "", clientId: "", clientSecret: "", webhookSecret: "",
  minAmount: "", maxAmount: "", dailyLimit: "", priority: "0", notes: "",
};

export default function AdminUpiGateways() {
  const qc = useQueryClient();
  const { data: me } = useGetMe();
  const isSuperAdmin = me?.isSuperAdmin === true;

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");
  const [visibility, setVisibility] = useState("all");

  const { data, isLoading, refetch } = useListUpiGateways({
    search: search || undefined,
    category: category !== "all" ? (category as any) : undefined,
    status: status !== "all" ? (status as any) : undefined,
    visibility: visibility !== "all" ? (visibility as any) : undefined,
  });
  const gateways = data?.data ?? [];

  const invalidate = () => qc.invalidateQueries({ queryKey: getListUpiGatewaysQueryKey({
    search: search || undefined,
    category: category !== "all" ? (category as any) : undefined,
    status: status !== "all" ? (status as any) : undefined,
    visibility: visibility !== "all" ? (visibility as any) : undefined,
  }) });

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateForm>(DEFAULT_CREATE);
  const createMut = useCreateUpiGateway({
    mutation: {
      onSuccess: () => { toast.success("UPI gateway added"); setCreateOpen(false); setCreateForm(DEFAULT_CREATE); invalidate(); },
      onError: (e: any) => toast.error(e?.response?.data?.error ?? "Failed to add gateway"),
    },
  });

  // Configure/edit dialog
  const [editing, setEditing] = useState<UpiGateway | null>(null);
  const [editForm, setEditForm] = useState<Partial<CreateForm>>({});
  const updateMut = useUpdateUpiGateway({
    mutation: {
      onSuccess: () => { toast.success("Gateway updated"); setEditing(null); invalidate(); },
      onError: (e: any) => toast.error(e?.response?.data?.error ?? "Failed to update gateway"),
    },
  });

  // Delete
  const [deleting, setDeleting] = useState<UpiGateway | null>(null);
  const deleteMut = useDeleteUpiGateway({
    mutation: {
      onSuccess: () => { toast.success("Gateway deleted"); setDeleting(null); invalidate(); },
      onError: (e: any) => { toast.error(e?.response?.data?.error ?? "Failed to delete gateway"); },
    },
  });

  // Test connection / webhook
  const [testResult, setTestResult] = useState<{ id: number; kind: string; success: boolean; message: string } | null>(null);
  const testConnMut = useTestUpiGatewayConnection({
    mutation: {
      onSuccess: (res, vars) => setTestResult({ id: vars.id, kind: "connection", success: res.success, message: res.message }),
      onError: (e: any, vars) => setTestResult({ id: vars.id, kind: "connection", success: false, message: e?.response?.data?.error ?? "Test failed" }),
    },
  });
  const testWebhookMut = useTestUpiGatewayWebhook({
    mutation: {
      onSuccess: (res, vars) => setTestResult({ id: vars.id, kind: "webhook", success: res.success, message: res.message }),
      onError: (e: any, vars) => setTestResult({ id: vars.id, kind: "webhook", success: false, message: e?.response?.data?.error ?? "Test failed" }),
    },
  });

  // Assign merchants dialog
  const [assigning, setAssigning] = useState<UpiGateway | null>(null);
  const [assignMode, setAssignMode] = useState<"all" | "selected" | "hide">("all");
  const [merchantSearch, setMerchantSearch] = useState("");
  const [selectedMerchants, setSelectedMerchants] = useState<Set<number>>(new Set());
  const { data: assignMerchantsData, isLoading: assignMerchantsLoading, isError: assignMerchantsError, error: assignMerchantsErrorObj, refetch: refetchAssignMerchants } = useGetUpiGatewayMerchants(
    assigning?.id ?? 0,
    { query: { enabled: !!assigning && (assigning.id ?? 0) > 0, queryKey: ["getUpiGatewayMerchants", assigning?.id ?? 0] } }
  );

  useEffect(() => {
    if (!assignMerchantsData || !assigning) return;
    const merchantRows = assignMerchantsData.filter(r => r.source === "merchant");
    const globalRow = assignMerchantsData.find(r => r.source === "global" || r.source === "default");
    const hasGlobalFalse = assignMerchantsData.some(r => r.source === "global" && !r.isActive);
    const hasGlobalTrue = assignMerchantsData.some(r => r.source === "global" && r.isActive);
    if (hasGlobalFalse) {
      setAssignMode("hide");
    } else if (hasGlobalTrue && merchantRows.length === 0) {
      setAssignMode("all");
    } else if (merchantRows.length > 0) {
      setAssignMode("selected");
      setSelectedMerchants(new Set(merchantRows.filter(r => r.isActive).map(r => r.merchantId)));
    } else {
      setAssignMode(assigning.globalVisible === true ? "all" : assigning.globalVisible === false ? "hide" : "all");
    }
  }, [assignMerchantsData, assigning]);

  const allMerchants = assignMerchantsData ?? [];
  const merchants = allMerchants.filter(
    m => !merchantSearch || m.businessName.toLowerCase().includes(merchantSearch.toLowerCase())
  );

  const assignMut = useAssignUpiGatewayMerchants({
    mutation: {
      onSuccess: () => {
        toast.success("Merchant assignments updated successfully");
        setAssigning(null);
        invalidate();
      },
      onError: (e: any) => {
        const serverMsg = e?.response?.data?.error as string | undefined;
        toast.error(serverMsg ?? `Failed to update merchant assignments for "${assigning?.name ?? "gateway"}"`);
      },
    },
  });

  function openCreate() { setCreateForm(DEFAULT_CREATE); setCreateOpen(true); }

  function submitCreate() {
    if (!createForm.name.trim()) { toast.error("Name is required"); return; }
    createMut.mutate({
      data: {
        name: createForm.name.trim(),
        category: createForm.category as any,
        status: createForm.status as any,
        mode: createForm.mode as any,
        apiBaseUrl: createForm.apiBaseUrl.trim() || undefined,
        apiKey: createForm.apiKey.trim() || undefined,
        clientId: createForm.clientId.trim() || undefined,
        clientSecret: createForm.clientSecret.trim() || undefined,
        webhookSecret: createForm.webhookSecret.trim() || undefined,
        minAmount: createForm.minAmount.trim() || undefined,
        maxAmount: createForm.maxAmount.trim() || undefined,
        dailyLimit: createForm.dailyLimit.trim() || undefined,
        priority: createForm.priority ? parseInt(createForm.priority) : undefined,
        notes: createForm.notes.trim() || undefined,
      },
    });
  }

  function openEdit(g: UpiGateway) {
    setEditing(g);
    setEditForm({
      name: g.name, category: g.category, status: g.status, mode: g.mode,
      apiBaseUrl: g.apiBaseUrl ?? "", minAmount: g.minAmount ?? "", maxAmount: g.maxAmount ?? "",
      dailyLimit: g.dailyLimit ?? "", priority: String(g.sortOrder ?? 0), notes: g.notes ?? "",
      apiKey: "", clientId: "", clientSecret: "", webhookSecret: "",
    });
  }

  function submitEdit() {
    if (!editing) return;
    const f = editForm;
    updateMut.mutate({
      id: editing.id,
      data: {
        name: f.name?.trim() || undefined,
        category: f.category as any,
        status: f.status as any,
        mode: f.mode as any,
        apiBaseUrl: f.apiBaseUrl?.trim() || undefined,
        apiKey: f.apiKey?.trim() || undefined,
        clientId: f.clientId?.trim() || undefined,
        clientSecret: f.clientSecret?.trim() || undefined,
        webhookSecret: f.webhookSecret?.trim() || undefined,
        minAmount: f.minAmount?.trim() || undefined,
        maxAmount: f.maxAmount?.trim() || undefined,
        dailyLimit: f.dailyLimit?.trim() || undefined,
        priority: f.priority ? parseInt(f.priority) : undefined,
        notes: f.notes?.trim() || undefined,
      },
    });
  }

  function toggleEnabled(g: UpiGateway) {
    updateMut.mutate({ id: g.id, data: { isEnabled: !g.isEnabled } }, {
      onSuccess: () => { toast.success(g.isEnabled ? "Gateway disabled" : "Gateway enabled"); invalidate(); },
      onError: (e: any) => toast.error(e?.response?.data?.error ?? "Failed to toggle gateway"),
    });
  }

  function openAssign(g: UpiGateway) {
    setAssigning(g);
    setAssignMode("all");
    setSelectedMerchants(new Set());
    setMerchantSearch("");
  }

  function submitAssign() {
    if (!assigning) return;
    const perMerchant: UpiGatewayAssignMerchantsBodyPerMerchantItem[] =
      assignMode === "selected" ? Array.from(selectedMerchants).map(id => ({ merchantId: id, isActive: true })) : [];
    assignMut.mutate({
      id: assigning.id,
      data: {
        mode: assignMode,
        merchantIds: assignMode === "selected" ? Array.from(selectedMerchants) : undefined,
        perMerchant: assignMode === "selected" ? perMerchant : undefined,
      },
    });
  }

  const stats = {
    total: gateways.length,
    live: gateways.filter(g => g.status === "live").length,
    enabled: gateways.filter(g => g.isEnabled).length,
    assigned: gateways.reduce((acc, g) => acc + g.assignedMerchantsCount, 0),
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">UPI Gateways</h1>
          <p className="text-sm text-muted-foreground mt-1">Consolidated view of every UPI, Bank UPI, QR and custom collection gateway</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
            <RefreshCw className="w-4 h-4" /> Refresh
          </Button>
          {isSuperAdmin ? (
            <Button size="sm" onClick={openCreate} className="gap-2">
              <Plus className="w-4 h-4" /> Add UPI Gateway
            </Button>
          ) : (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground px-2">
              <Lock className="w-3.5 h-3.5" /> View &amp; test only
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Gateways", value: stats.total },
          { label: "Live", value: stats.live },
          { label: "Enabled", value: stats.enabled },
          { label: "Merchant Assignments", value: stats.assigned },
        ].map(s => (
          <Card key={s.label} className="bg-card border-border/50">
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="text-2xl font-bold mt-1">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search gateways…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            <SelectItem value="upi">UPI</SelectItem>
            <SelectItem value="bank_upi">Bank UPI</SelectItem>
            <SelectItem value="qr">QR</SelectItem>
            <SelectItem value="custom">Custom</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="live">Live</SelectItem>
            <SelectItem value="testing">Testing</SelectItem>
            <SelectItem value="coming_soon">Coming Soon</SelectItem>
            <SelectItem value="disabled">Disabled</SelectItem>
          </SelectContent>
        </Select>
        <Select value={visibility} onValueChange={setVisibility}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Visibility" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any Visibility</SelectItem>
            <SelectItem value="selected">Selected Merchants</SelectItem>
            <SelectItem value="hidden">Hidden From All</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-3">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="bg-card border-border/50"><CardContent className="pt-4 pb-3 h-16 animate-pulse bg-muted/20 rounded" /></Card>
          ))
        ) : gateways.length === 0 ? (
          <Card className="bg-card border-border/50"><CardContent className="py-12 text-center text-muted-foreground">No UPI gateways found</CardContent></Card>
        ) : (
          gateways.map(g => {
            const meta = STATUS_META[g.status] ?? STATUS_META.disabled;
            const tr = testResult?.id === g.id ? testResult : null;
            return (
              <Card key={g.id} className="bg-card border-border/50">
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-sm">{g.name}</p>
                        <Badge variant="outline" className="text-[10px]">{CATEGORY_LABEL[g.category] ?? g.category}</Badge>
                        <Badge variant="outline" className={`text-[10px] ${meta.color}`}>{meta.label}</Badge>
                        {g.isEnabled
                          ? <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-[10px]">Enabled</Badge>
                          : <Badge className="bg-zinc-500/10 text-zinc-400 border-zinc-500/30 text-[10px]">Disabled</Badge>}
                        {g.mode === "live" && <Badge className="bg-violet-500/10 text-violet-400 border-violet-500/30 text-[10px]">Live Mode</Badge>}
                        {g.isCustom && <Badge variant="outline" className="text-[10px]">Custom</Badge>}
                      </div>
                      <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1"><Users className="w-3 h-3" />{g.assignedMerchantsCount} merchants</span>
                        <span>Priority {g.sortOrder}</span>
                        {g.globalVisible === true && <span className="text-emerald-400">Visible to all</span>}
                        {g.globalVisible === false && <span className="text-rose-400">Hidden from all</span>}
                        {g.updatedByEmail && <span>Updated by {g.updatedByEmail}</span>}
                      </div>
                      {tr && (
                        <div className={`flex items-center gap-1.5 mt-2 text-xs ${tr.success ? "text-emerald-400" : "text-rose-400"}`}>
                          {tr.success ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                          {tr.kind === "connection" ? "Connection test" : "Webhook test"}: {tr.message}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap justify-end">
                      <Button variant="outline" size="sm" className="h-7 text-xs gap-1"
                        onClick={() => testConnMut.mutate({ id: g.id })} disabled={testConnMut.isPending}>
                        <Zap className="w-3 h-3" /> Test Connection
                      </Button>
                      <Button variant="outline" size="sm" className="h-7 text-xs gap-1"
                        onClick={() => testWebhookMut.mutate({ id: g.id })} disabled={testWebhookMut.isPending}>
                        <Radio className="w-3 h-3" /> Test Webhook
                      </Button>
                      {isSuperAdmin && !g.isCustom && (
                        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => openAssign(g)}>
                          <Users className="w-3 h-3" /> Assign Merchants
                        </Button>
                      )}
                      {isSuperAdmin && (
                        <>
                          <div className="flex items-center gap-1.5 px-1">
                            <Switch checked={g.isEnabled} onCheckedChange={() => toggleEnabled(g)} />
                          </div>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(g)} title="Configure">
                            <Settings2 className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant="ghost" size="icon" className="h-7 w-7 text-rose-400 hover:text-rose-300"
                            title={g.isEnabled ? "Disable before deleting" : "Delete"}
                            disabled={g.isEnabled}
                            onClick={() => setDeleting(g)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* Add UPI Gateway dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg bg-card border-border max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Plus className="w-4 h-4 text-primary" />Add UPI Gateway</DialogTitle>
            <DialogDescription>Credentials are encrypted at rest. New gateways are hidden from merchants until you assign them.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Name *</Label>
              <Input placeholder="e.g. PhonePe UPI" value={createForm.name} onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Category</Label>
                <Select value={createForm.category} onValueChange={v => setCreateForm(f => ({ ...f, category: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="upi">UPI</SelectItem>
                    <SelectItem value="bank_upi">Bank UPI</SelectItem>
                    <SelectItem value="qr">QR</SelectItem>
                    <SelectItem value="custom">Custom</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Status</Label>
                <Select value={createForm.status} onValueChange={v => setCreateForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="live">Live</SelectItem>
                    <SelectItem value="testing">Testing</SelectItem>
                    <SelectItem value="coming_soon">Coming Soon</SelectItem>
                    <SelectItem value="disabled">Disabled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Mode</Label>
                <Select value={createForm.mode} onValueChange={v => setCreateForm(f => ({ ...f, mode: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="test">Test</SelectItem>
                    <SelectItem value="live">Live</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">API Base URL</Label>
              <Input placeholder="https://api.provider.com" value={createForm.apiBaseUrl} onChange={e => setCreateForm(f => ({ ...f, apiBaseUrl: e.target.value }))} />
            </div>
            <div className="grid grid-cols-1 gap-3 rounded-lg border border-border/50 p-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Credentials (encrypted at rest)</p>
              <Input type="password" placeholder="API Key" className="font-mono" value={createForm.apiKey} onChange={e => setCreateForm(f => ({ ...f, apiKey: e.target.value }))} />
              <Input type="password" placeholder="Client ID" className="font-mono" value={createForm.clientId} onChange={e => setCreateForm(f => ({ ...f, clientId: e.target.value }))} />
              <Input type="password" placeholder="Client Secret" className="font-mono" value={createForm.clientSecret} onChange={e => setCreateForm(f => ({ ...f, clientSecret: e.target.value }))} />
              <Input type="password" placeholder="Webhook Secret" className="font-mono" value={createForm.webhookSecret} onChange={e => setCreateForm(f => ({ ...f, webhookSecret: e.target.value }))} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Input placeholder="Min Amount" value={createForm.minAmount} onChange={e => setCreateForm(f => ({ ...f, minAmount: e.target.value }))} />
              <Input placeholder="Max Amount" value={createForm.maxAmount} onChange={e => setCreateForm(f => ({ ...f, maxAmount: e.target.value }))} />
              <Input placeholder="Daily Limit" value={createForm.dailyLimit} onChange={e => setCreateForm(f => ({ ...f, dailyLimit: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Routing Priority</Label>
              <Input type="number" value={createForm.priority} onChange={e => setCreateForm(f => ({ ...f, priority: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Notes</Label>
              <Textarea rows={2} value={createForm.notes} onChange={e => setCreateForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={submitCreate} disabled={createMut.isPending}>{createMut.isPending ? "Adding…" : "Add Gateway"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Configure / edit dialog */}
      <Dialog open={!!editing} onOpenChange={v => { if (!v) setEditing(null); }}>
        <DialogContent className="max-w-lg bg-card border-border max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Settings2 className="w-4 h-4 text-primary" />Configure {editing?.name}</DialogTitle>
            <DialogDescription>Leave a credential field blank to keep the existing stored value.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Name</Label>
              <Input value={editForm.name ?? ""} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Status</Label>
                <Select value={editForm.status ?? "live"} onValueChange={v => setEditForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="live">Live</SelectItem>
                    <SelectItem value="testing">Testing</SelectItem>
                    <SelectItem value="coming_soon">Coming Soon</SelectItem>
                    <SelectItem value="disabled">Disabled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Mode</Label>
                <Select value={editForm.mode ?? "test"} onValueChange={v => setEditForm(f => ({ ...f, mode: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="test">Test</SelectItem>
                    <SelectItem value="live">Live</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Priority</Label>
                <Input type="number" value={editForm.priority ?? "0"} onChange={e => setEditForm(f => ({ ...f, priority: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">API Base URL</Label>
              <Input value={editForm.apiBaseUrl ?? ""} onChange={e => setEditForm(f => ({ ...f, apiBaseUrl: e.target.value }))} />
            </div>
            <div className="grid grid-cols-1 gap-3 rounded-lg border border-border/50 p-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Rotate Credentials</p>
              <Input type="password" placeholder="New API Key" className="font-mono" value={editForm.apiKey ?? ""} onChange={e => setEditForm(f => ({ ...f, apiKey: e.target.value }))} />
              <Input type="password" placeholder="New Client ID" className="font-mono" value={editForm.clientId ?? ""} onChange={e => setEditForm(f => ({ ...f, clientId: e.target.value }))} />
              <Input type="password" placeholder="New Client Secret" className="font-mono" value={editForm.clientSecret ?? ""} onChange={e => setEditForm(f => ({ ...f, clientSecret: e.target.value }))} />
              <Input type="password" placeholder="New Webhook Secret" className="font-mono" value={editForm.webhookSecret ?? ""} onChange={e => setEditForm(f => ({ ...f, webhookSecret: e.target.value }))} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Input placeholder="Min Amount" value={editForm.minAmount ?? ""} onChange={e => setEditForm(f => ({ ...f, minAmount: e.target.value }))} />
              <Input placeholder="Max Amount" value={editForm.maxAmount ?? ""} onChange={e => setEditForm(f => ({ ...f, maxAmount: e.target.value }))} />
              <Input placeholder="Daily Limit" value={editForm.dailyLimit ?? ""} onChange={e => setEditForm(f => ({ ...f, dailyLimit: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Notes</Label>
              <Textarea rows={2} value={editForm.notes ?? ""} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={submitEdit} disabled={updateMut.isPending}>{updateMut.isPending ? "Saving…" : "Save Changes"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign merchants dialog */}
      <Dialog open={!!assigning} onOpenChange={v => { if (!v) setAssigning(null); }}>
        <DialogContent className="max-w-lg bg-card border-border max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" />
              Assign Merchants — {assigning?.name}
            </DialogTitle>
            <DialogDescription>
              Control which merchants can see and use <span className="font-medium text-foreground">{assigning?.name}</span>.
              {assigning && (
                <span className="block text-xs mt-1 text-muted-foreground/70">
                  Gateway ID: {assigning.id} · Category: {CATEGORY_LABEL[assigning.category] ?? assigning.category}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {assignMerchantsLoading ? (
              <div className="flex items-center justify-center py-6 text-muted-foreground text-sm gap-2">
                <RefreshCw className="w-4 h-4 animate-spin" /> Loading merchants…
              </div>
            ) : assignMerchantsError ? (
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-4 space-y-2">
                <p className="text-sm font-medium text-rose-400">Failed to load merchants</p>
                <p className="text-xs text-muted-foreground">
                  {(assignMerchantsErrorObj as any)?.response?.data?.error ?? (assignMerchantsErrorObj as any)?.message ?? "Unknown error"}
                </p>
                <Button size="sm" variant="outline" className="mt-1 gap-1.5" onClick={() => refetchAssignMerchants()}>
                  <RefreshCw className="w-3.5 h-3.5" /> Retry
                </Button>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <Select value={assignMode} onValueChange={v => { setAssignMode(v as "all" | "selected" | "hide"); if (v !== "selected") setSelectedMerchants(new Set()); }}>
                    <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Visible to all merchants</SelectItem>
                      <SelectItem value="selected">Visible to selected merchants only</SelectItem>
                      <SelectItem value="hide">Hidden from all merchants</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" title="Refresh merchant list" onClick={() => refetchAssignMerchants()}>
                    <RefreshCw className="w-4 h-4" />
                  </Button>
                </div>
                {assignMode === "selected" && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs text-muted-foreground">
                        {(assignMerchantsData?.length ?? 0)} merchants available
                      </Label>
                      <span className="text-xs text-muted-foreground">{selectedMerchants.size} selected</span>
                    </div>
                    <div className="flex gap-2">
                      <Input
                        placeholder="Search by name, email or phone…"
                        value={merchantSearch}
                        onChange={e => setMerchantSearch(e.target.value)}
                        className="flex-1"
                      />
                      <Button variant="outline" size="sm" className="shrink-0 gap-1" onClick={() => setMerchantSearch(merchantSearch)}>
                        <Search className="w-3.5 h-3.5" /> Search
                      </Button>
                    </div>
                    <div className="max-h-72 overflow-y-auto border border-border/50 rounded-lg divide-y divide-border/30">
                      {merchants.map(m => (
                        <label key={m.merchantId} className="flex items-start gap-2.5 p-3 text-sm cursor-pointer hover:bg-muted/20">
                          <Checkbox
                            className="mt-0.5 shrink-0"
                            checked={selectedMerchants.has(m.merchantId)}
                            onCheckedChange={checked => setSelectedMerchants(prev => {
                              const next = new Set(prev);
                              if (checked) next.add(m.merchantId); else next.delete(m.merchantId);
                              return next;
                            })}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="font-medium truncate">{m.businessName}</p>
                              {m.verificationStatus && m.verificationStatus !== "approved" && (
                                <Badge className="text-[10px] bg-amber-500/10 text-amber-400 border-amber-500/30 px-1 py-0">KYC pending</Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground truncate">{m.email}{m.phone ? ` · ${m.phone}` : ""}</p>
                            <p className="text-[10px] text-muted-foreground/60 mt-0.5">ID: {m.merchantId} · Status: {m.status}</p>
                          </div>
                        </label>
                      ))}
                      {merchants.length === 0 && (
                        <div className="p-4 text-center">
                          <p className="text-xs text-muted-foreground">
                            {merchantSearch ? `No merchants matching "${merchantSearch}"` : "No approved merchants found"}
                          </p>
                          {merchantSearch && (
                            <Button variant="ghost" size="sm" className="mt-1 text-xs" onClick={() => setMerchantSearch("")}>
                              Clear search
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {assignMode === "all" && (
                  <p className="text-xs text-muted-foreground bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-3">
                    This gateway will be visible to all approved merchants ({assignMerchantsData?.length ?? 0} total).
                  </p>
                )}
                {assignMode === "hide" && (
                  <p className="text-xs text-muted-foreground bg-rose-500/5 border border-rose-500/20 rounded-lg p-3">
                    This gateway will be hidden from all merchants.
                  </p>
                )}
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssigning(null)}>Cancel</Button>
            <Button onClick={submitAssign} disabled={assignMut.isPending || assignMerchantsLoading || assignMerchantsError}>
              {assignMut.isPending ? "Saving…" : "Save Assignments"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog open={!!deleting} onOpenChange={v => { if (!v) setDeleting(null); }}>
        <DialogContent className="max-w-sm bg-card border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-rose-400"><ShieldAlert className="w-4 h-4" />Delete {deleting?.name}?</DialogTitle>
            <DialogDescription>This cannot be undone. Gateways still assigned to merchants cannot be deleted.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button variant="destructive" disabled={deleteMut.isPending} onClick={() => deleting && deleteMut.mutate({ id: deleting.id })}>
              {deleteMut.isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
