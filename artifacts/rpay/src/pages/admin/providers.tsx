import { useState, useRef, useEffect } from "react";
import { useListProviders, useCreateProvider, useUpdateProvider, useDeleteProvider, useSetProviderVisibility, useBulkSetProviderVisibility, getProviderMerchantVisibility, getGetProviderMerchantVisibilityQueryKey, useListMerchants, useGetEkqrConfig, useUpdateEkqrConfig, useTestEkqrConnection, getGetEkqrConfigQueryKey } from "@workspace/api-client-react";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { getToken } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Link } from "wouter";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Eye, EyeOff, Users, Globe, RefreshCw, Search, GripVertical, Megaphone, Settings, Zap, FlaskConical, Save, CheckCircle2, AlertCircle, Copy } from "lucide-react";
import { RateLimitBanner, useRateLimit } from "@/components/ui/rate-limit-banner";

const STATUS_META: Record<string, { label: string; color: string }> = {
  live:         { label: "Live",        color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" },
  testing:      { label: "Testing",     color: "bg-amber-500/10 text-amber-400 border-amber-500/30" },
  coming_soon:  { label: "Coming Soon", color: "bg-sky-500/10 text-sky-400 border-sky-500/30" },
  disabled:     { label: "Disabled",    color: "bg-muted text-muted-foreground border-border" },
};

const CATEGORY_META: Record<string, string> = {
  upi:     "UPI",
  bank:    "Bank",
  gateway: "Gateway",
};

type FormState = {
  name: string; slug: string; category: string; status: string; description: string; sortOrder: string;
};

const DEFAULT_FORM: FormState = { name: "", slug: "", category: "upi", status: "live", description: "", sortOrder: "0" };

function slugify(s: string) { return s.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, ""); }

async function apiPut(path: string, body: object) {
  const res = await fetch(`/api${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(text) as Error & { status: number; headers: Headers };
    err.status = res.status;
    err.headers = res.headers;
    throw err;
  }
  return res.json();
}

async function apiPost(path: string, body: object) {
  const res = await fetch(`/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export default function AdminProviders() {
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  // EKQR Settings Sheet
  const [ekqrSheetOpen, setEkqrSheetOpen] = useState(false);
  const [ekqrApiKey, setEkqrApiKey] = useState("");
  const [ekqrEnabled, setEkqrEnabled] = useState(true);
  const [showEkqrKey, setShowEkqrKey] = useState(false);
  const [ekqrTestResult, setEkqrTestResult] = useState<{ ok: boolean; msg: string; raw?: string } | null>(null);
  const [ekqrRawOpen, setEkqrRawOpen] = useState(false);

  const { data: ekqrConfig, isLoading: ekqrLoading } = useGetEkqrConfig();
  const { mutate: saveEkqrConfig, isPending: savingEkqr } = useUpdateEkqrConfig({
    mutation: {
      onSuccess: () => {
        toast.success("UPI gateway settings saved");
        setEkqrApiKey("");
        qc.invalidateQueries({ queryKey: getGetEkqrConfigQueryKey() });
      },
      onError: () => toast.error("Failed to save UPI gateway settings"),
    },
  });
  const { mutate: testEkqr, isPending: testingEkqr } = useTestEkqrConnection({
    mutation: {
      onSuccess: (res: any) => {
        setEkqrTestResult({ ok: res.ok, msg: res.msg ?? "", raw: res.raw });
      },
      onError: () => setEkqrTestResult({ ok: false, msg: "Test request failed" }),
    },
  });

  const currentEkqrEnabled = ekqrConfig?.enabled ?? true;
  const ekqrUnchanged = ekqrApiKey === "" && ekqrEnabled === currentEkqrEnabled;

  useEffect(() => {
    if (ekqrConfig != null) {
      setEkqrEnabled(ekqrConfig.enabled ?? true);
    }
  }, [ekqrConfig?.enabled]);

  // Broadcast dialog
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [broadcastTitle, setBroadcastTitle] = useState("");
  const [broadcastBody, setBroadcastBody] = useState("");
  const [broadcastTarget, setBroadcastTarget] = useState<"all" | "merchant">("all");
  const [broadcastMerchantId, setBroadcastMerchantId] = useState("");

  const { data: merchantsData } = useListMerchants({ status: "approved", limit: 200 });
  const approvedMerchants = merchantsData?.data ?? [];

  const broadcastMut = useMutation({
    mutationFn: (data: { title: string; body: string; merchantId?: number }) => apiPost("/notifications/broadcast", data),
    onSuccess: (res: { count: number }) => {
      toast.success(`Notification sent to ${res.count} merchant(s)`);
      setBroadcastOpen(false);
      setBroadcastTitle("");
      setBroadcastBody("");
      setBroadcastTarget("all");
      setBroadcastMerchantId("");
    },
    onError: () => toast.error("Failed to send broadcast"),
  });

  // Create / Edit / Delete dialog
  const [dialog, setDialog] = useState<"create" | "edit" | "delete" | null>(null);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);

  // Visibility drawer
  const [visDrawer, setVisDrawer] = useState<any | null>(null);
  const [merchantSearch, setMerchantSearch] = useState("");
  const [selectedMerchants, setSelectedMerchants] = useState<Set<number>>(new Set());

  // Drag-to-reorder state
  const [localIds, setLocalIds] = useState<number[]>([]);
  const [dragOverId, setDragOverId] = useState<number | null>(null);
  const dragId = useRef<number | null>(null);
  const isFiltering = !!(search || categoryFilter !== "all" || statusFilter !== "all");

  const { data, isLoading, refetch } = useListProviders({
    category: categoryFilter !== "all" ? categoryFilter : undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
  });

  const allData = data?.data ?? [];

  // Initialise / sync local order when data arrives
  useEffect(() => {
    if (allData.length > 0) {
      setLocalIds(prev => {
        // Merge: keep existing order for known ids, append new ones
        const known = new Set(prev);
        const newIds = allData.map(p => p.id).filter(id => !known.has(id));
        return [...prev.filter(id => allData.some(p => p.id === id)), ...newIds];
      });
    }
  }, [JSON.stringify(allData.map(p => p.id))]);

  const providers = isFiltering
    ? allData.filter(p => !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.slug.includes(search.toLowerCase()))
    : localIds.map(id => allData.find(p => p.id === id)).filter(Boolean) as typeof allData;

  // Rate-limit guards
  const reorderRateLimit = useRateLimit();
  const visRateLimit = useRateLimit();
  const submitRateLimit = useRateLimit();
  const deleteRateLimit = useRateLimit();

  // Mutations
  const createMut = useCreateProvider();
  const updateMut = useUpdateProvider();
  const deleteMut = useDeleteProvider();
  const setVisMut = useSetProviderVisibility();
  const bulkVisMut = useBulkSetProviderVisibility();

  const reorderMut = useMutation({
    mutationFn: (order: number[]) => apiPut("/providers/reorder", { order }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/providers"] }); toast.success("Sort order saved"); },
    onError: (err) => {
      if (reorderRateLimit.handleRateLimitError(err)) return;
      toast.error("Failed to save sort order");
    },
  });

  // Merchant visibility drawer data
  const { data: merchantVisData, isLoading: visLoading, refetch: refetchVis } = useQuery({
    queryKey: getGetProviderMerchantVisibilityQueryKey(visDrawer?.id ?? 0),
    queryFn: () => getProviderMerchantVisibility(visDrawer!.id),
    enabled: !!visDrawer,
  });
  const merchantVis = (merchantVisData ?? []).filter(
    m => !merchantSearch || m.businessName.toLowerCase().includes(merchantSearch.toLowerCase())
  );

  // Stats
  const statsByStatus = allData.reduce((acc: Record<string, number>, p) => {
    acc[p.status] = (acc[p.status] ?? 0) + 1;
    return acc;
  }, {});

  function openCreate() { setForm(DEFAULT_FORM); setEditing(null); setDialog("create"); }
  function openEdit(p: any) {
    setForm({ name: p.name, slug: p.slug, category: p.category, status: p.status, description: p.description ?? "", sortOrder: String(p.sortOrder) });
    setEditing(p);
    setDialog("edit");
  }

  function handleSubmit() {
    const payload = { name: form.name.trim(), slug: form.slug.trim(), category: form.category, status: form.status, description: form.description.trim() || null, sortOrder: parseInt(form.sortOrder) || 0 };
    if (!payload.name || !payload.slug) { toast.error("Name and slug are required"); return; }

    if (dialog === "create") {
      createMut.mutate({ data: payload }, {
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/providers"] }); toast.success("Provider created"); setDialog(null); },
        onError: (e: any) => {
          if (submitRateLimit.handleRateLimitError(e)) return;
          toast.error(e?.response?.data?.error ?? "Failed to create provider");
        },
      });
    } else if (editing) {
      updateMut.mutate({ id: editing.id, data: payload }, {
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/providers"] }); toast.success("Provider updated"); setDialog(null); },
        onError: (e: any) => {
          if (submitRateLimit.handleRateLimitError(e)) return;
          toast.error(e?.response?.data?.error ?? "Failed to update provider");
        },
      });
    }
  }

  function handleDelete() {
    if (!editing) return;
    deleteMut.mutate({ id: editing.id }, {
      onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/providers"] }); toast.success("Provider deleted"); setDialog(null); setEditing(null); },
      onError: (e: any) => {
        if (deleteRateLimit.handleRateLimitError(e)) return;
        toast.error(e?.response?.data?.error ?? "Failed to delete provider");
      },
    });
  }

  function handleInlineStatus(providerId: number, newStatus: string) {
    updateMut.mutate({ id: providerId, data: { status: newStatus } }, {
      onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/providers"] }); toast.success("Status updated"); },
      onError: (e: any) => toast.error(e?.response?.data?.error ?? "Failed to update status"),
    });
  }

  function handleGlobalVisibility(providerId: number, visible: boolean) {
    setVisMut.mutate({ id: providerId, data: { merchantId: null, visible } }, {
      onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/providers"] }); refetchVis(); toast.success(visible ? "Enabled for all merchants" : "Disabled for all merchants"); },
      onError: (e: any) => {
        if (visRateLimit.handleRateLimitError(e)) return;
        toast.error(e?.response?.data?.error ?? "Failed to update visibility");
      },
    });
  }

  function handleMerchantToggle(providerId: number, merchantId: number, visible: boolean) {
    setVisMut.mutate({ id: providerId, data: { merchantId, visible } }, {
      onSuccess: () => { refetchVis(); qc.invalidateQueries({ queryKey: ["/api/providers"] }); toast.success("Visibility updated"); },
      onError: (e: any) => {
        if (visRateLimit.handleRateLimitError(e)) return;
        toast.error(e?.response?.data?.error ?? "Failed");
      },
    });
  }

  function handleBulkVisibility(visible: boolean) {
    if (selectedMerchants.size === 0) { toast.error("Select at least one merchant"); return; }
    bulkVisMut.mutate({ id: visDrawer.id, data: { merchantIds: Array.from(selectedMerchants), visible } }, {
      onSuccess: () => { refetchVis(); qc.invalidateQueries({ queryKey: ["/api/providers"] }); toast.success(`Updated ${selectedMerchants.size} merchants`); setSelectedMerchants(new Set()); },
      onError: (e: any) => {
        if (visRateLimit.handleRateLimitError(e)) return;
        toast.error(e?.response?.data?.error ?? "Failed");
      },
    });
  }

  // Drag handlers
  function handleDragStart(id: number) {
    dragId.current = id;
  }

  function handleDragOver(e: React.DragEvent, id: number) {
    e.preventDefault();
    if (dragId.current !== id) setDragOverId(id);
  }

  function handleDrop(targetId: number) {
    const sourceId = dragId.current;
    if (!sourceId || sourceId === targetId) return;
    const newOrder = [...localIds];
    const fromIdx = newOrder.indexOf(sourceId);
    const toIdx = newOrder.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    newOrder.splice(fromIdx, 1);
    newOrder.splice(toIdx, 0, sourceId);
    setLocalIds(newOrder);
    setDragOverId(null);
    dragId.current = null;
    reorderMut.mutate(newOrder);
  }

  function handleDragEnd() {
    dragId.current = null;
    setDragOverId(null);
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Payment Providers</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage provider catalogue and control merchant visibility</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
            <RefreshCw className="w-4 h-4" /> Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={() => setBroadcastOpen(true)} className="gap-2">
            <Megaphone className="w-4 h-4" /> Broadcast
          </Button>
          <Button size="sm" onClick={openCreate} className="gap-2">
            <Plus className="w-4 h-4" /> Add Provider
          </Button>
        </div>
      </div>

      {/* Status stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {(["live", "testing", "coming_soon", "disabled"] as const).map(s => (
          <Card key={s} className="bg-card border-border/50">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">{STATUS_META[s].label}</p>
                <Badge variant="outline" className={`text-xs ${STATUS_META[s].color}`}>{statsByStatus[s] ?? 0}</Badge>
              </div>
              <p className="text-2xl font-bold mt-1">{statsByStatus[s] ?? 0}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search providers…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            <SelectItem value="upi">UPI</SelectItem>
            <SelectItem value="bank">Bank</SelectItem>
            <SelectItem value="gateway">Gateway</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="live">Live</SelectItem>
            <SelectItem value="testing">Testing</SelectItem>
            <SelectItem value="coming_soon">Coming Soon</SelectItem>
            <SelectItem value="disabled">Disabled</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {!isFiltering && (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <GripVertical className="w-3 h-3" /> Drag rows to reorder — sort order is saved automatically
        </p>
      )}
      {reorderRateLimit.isRateLimited && reorderRateLimit.rateLimitSeconds !== null && (
        <RateLimitBanner
          retryAfterSeconds={reorderRateLimit.rateLimitSeconds}
          message="Too many reorder requests. Please wait before saving again."
          onDismiss={reorderRateLimit.dismiss}
        />
      )}

      {/* Providers table */}
      <Card className="bg-card border-border/50">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-border/50">
                {!isFiltering && <TableHead className="w-8" />}
                <TableHead>#</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Visibility</TableHead>
                <TableHead>Sort</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: isFiltering ? 7 : 8 }).map((_, j) => (
                      <TableCell key={j}><div className="h-4 bg-muted/40 rounded animate-pulse" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : providers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isFiltering ? 7 : 8} className="text-center py-12 text-muted-foreground">No providers found</TableCell>
                </TableRow>
              ) : (
                providers.map(p => {
                  const meta = STATUS_META[p.status] ?? STATUS_META.disabled;
                  const isDragTarget = dragOverId === p.id;
                  return (
                    <TableRow
                      key={p.id}
                      className={`border-border/30 hover:bg-muted/20 transition-colors ${isDragTarget ? "bg-primary/5 border-t-primary/40" : ""}`}
                      draggable={!isFiltering && !reorderRateLimit.isRateLimited}
                      onDragStart={() => handleDragStart(p.id)}
                      onDragOver={e => handleDragOver(e, p.id)}
                      onDrop={() => handleDrop(p.id)}
                      onDragEnd={handleDragEnd}
                    >
                      {!isFiltering && (
                        <TableCell className={`w-8 text-muted-foreground/40 ${reorderRateLimit.isRateLimited ? "cursor-not-allowed opacity-40" : "cursor-grab active:cursor-grabbing hover:text-muted-foreground"}`}>
                          <GripVertical className="w-4 h-4" />
                        </TableCell>
                      )}
                      <TableCell className="text-muted-foreground text-sm">{p.id}</TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium text-sm">{p.name}</p>
                          <p className="text-xs text-muted-foreground font-mono">{p.slug}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{CATEGORY_META[p.category] ?? p.category}</Badge>
                      </TableCell>
                      <TableCell>
                        <Select value={p.status} onValueChange={v => handleInlineStatus(p.id, v)}>
                          <SelectTrigger className="h-7 w-36 text-xs">
                            <Badge variant="outline" className={`text-xs ${meta.color}`}>{meta.label}</Badge>
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(STATUS_META).map(([k, v]) => (
                              <SelectItem key={k} value={k}>{v.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Users className="w-3 h-3" />
                            <span className="text-emerald-400">{p.visibleCount ?? 0} visible</span>
                            <span>·</span>
                            <span className="text-rose-400">{p.hiddenCount ?? 0} hidden</span>
                          </div>
                          {p.globalVisible !== null && (
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Globe className="w-3 h-3" />
                              <span>Global: {p.globalVisible ? "visible" : "hidden"}</span>
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{p.sortOrder}</TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          {p.slug === "ekqr" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-teal-400 hover:text-teal-300"
                              title="UPI Gateway Settings"
                              onClick={() => setEkqrSheetOpen(true)}
                            >
                              <Settings className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Manage visibility" onClick={() => { setVisDrawer(p); setSelectedMerchants(new Set()); setMerchantSearch(""); }}>
                            <Eye className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(p)}>
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-rose-400 hover:text-rose-300" onClick={() => { setEditing(p); setDialog("delete"); }}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Create / Edit Dialog */}
      <Dialog open={dialog === "create" || dialog === "edit"} onOpenChange={open => !open && setDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{dialog === "create" ? "Add Provider" : "Edit Provider"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value, slug: dialog === "create" ? slugify(e.target.value) : f.slug }))} placeholder="PhonePe Business" />
              </div>
              <div className="space-y-1.5">
                <Label>Slug</Label>
                <Input value={form.slug} onChange={e => setForm(f => ({ ...f, slug: slugify(e.target.value) }))} placeholder="phonepe" className="font-mono text-sm" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="upi">UPI</SelectItem>
                    <SelectItem value="bank">Bank</SelectItem>
                    <SelectItem value="gateway">Gateway</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="live">Live</SelectItem>
                    <SelectItem value="testing">Testing</SelectItem>
                    <SelectItem value="coming_soon">Coming Soon</SelectItem>
                    <SelectItem value="disabled">Disabled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Short description…" />
            </div>
            <div className="space-y-1.5">
              <Label>Sort Order</Label>
              <Input type="number" value={form.sortOrder} onChange={e => setForm(f => ({ ...f, sortOrder: e.target.value }))} />
            </div>
          </div>
          {submitRateLimit.isRateLimited && submitRateLimit.rateLimitSeconds !== null && (
            <RateLimitBanner
              retryAfterSeconds={submitRateLimit.rateLimitSeconds}
              message="Too many requests. Please wait before trying again."
              onDismiss={submitRateLimit.dismiss}
            />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={createMut.isPending || updateMut.isPending || submitRateLimit.isRateLimited}>
              {createMut.isPending || updateMut.isPending ? "Saving…" : dialog === "create" ? "Add Provider" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={dialog === "delete"} onOpenChange={open => !open && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Provider</DialogTitle>
            <DialogDescription>
              Delete <strong>{editing?.name}</strong>? This will also remove all visibility rules for this provider. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {deleteRateLimit.isRateLimited && deleteRateLimit.rateLimitSeconds !== null && (
            <RateLimitBanner
              retryAfterSeconds={deleteRateLimit.rateLimitSeconds}
              message="Too many requests. Please wait before trying again."
              onDismiss={deleteRateLimit.dismiss}
            />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteMut.isPending || deleteRateLimit.isRateLimited}>
              {deleteMut.isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Broadcast Dialog */}
      <Dialog open={broadcastOpen} onOpenChange={open => { if (!open) { setBroadcastOpen(false); setBroadcastTitle(""); setBroadcastBody(""); setBroadcastTarget("all"); setBroadcastMerchantId(""); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Megaphone className="w-4 h-4" /> Broadcast Notification
            </DialogTitle>
            <DialogDescription>
              Send a system notice to merchants. They will see it in their notification centre.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Send to</Label>
              <Select value={broadcastTarget} onValueChange={v => { setBroadcastTarget(v as "all" | "merchant"); setBroadcastMerchantId(""); }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All active merchants</SelectItem>
                  <SelectItem value="merchant">Specific merchant</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {broadcastTarget === "merchant" && (
              <div className="space-y-1.5">
                <Label>Merchant</Label>
                <Select value={broadcastMerchantId} onValueChange={setBroadcastMerchantId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a merchant…" />
                  </SelectTrigger>
                  <SelectContent>
                    {approvedMerchants.map(m => (
                      <SelectItem key={m.id} value={String(m.id)}>{m.businessName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Title</Label>
              <Input
                value={broadcastTitle}
                onChange={e => setBroadcastTitle(e.target.value)}
                placeholder="Scheduled Maintenance"
                maxLength={120}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Message</Label>
              <Textarea
                value={broadcastBody}
                onChange={e => setBroadcastBody(e.target.value)}
                placeholder="Write the notification body here…"
                rows={4}
                maxLength={500}
              />
              <p className="text-xs text-muted-foreground text-right">{broadcastBody.length}/500</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBroadcastOpen(false)}>Cancel</Button>
            <Button
              onClick={() => broadcastMut.mutate({
                title: broadcastTitle.trim(),
                body: broadcastBody.trim(),
                ...(broadcastTarget === "merchant" && broadcastMerchantId ? { merchantId: parseInt(broadcastMerchantId) } : {}),
              })}
              disabled={
                !broadcastTitle.trim() ||
                !broadcastBody.trim() ||
                (broadcastTarget === "merchant" && !broadcastMerchantId) ||
                broadcastMut.isPending
              }
            >
              {broadcastMut.isPending ? "Sending…" : broadcastTarget === "merchant" ? "Send to Merchant" : "Send to All Merchants"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Visibility Drawer */}
      <Sheet open={!!visDrawer} onOpenChange={open => !open && setVisDrawer(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          {visDrawer && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <Eye className="w-4 h-4" />
                  Visibility — {visDrawer.name}
                </SheetTitle>
              </SheetHeader>

              <div className="mt-6 space-y-4">
                {/* Visibility rate-limit banner */}
                {visRateLimit.isRateLimited && visRateLimit.rateLimitSeconds !== null && (
                  <RateLimitBanner
                    retryAfterSeconds={visRateLimit.rateLimitSeconds}
                    message="Too many visibility changes. Please wait before trying again."
                    onDismiss={visRateLimit.dismiss}
                  />
                )}

                {/* Global toggle */}
                <Card className="bg-card border-border/50">
                  <CardContent className="pt-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-sm flex items-center gap-1.5"><Globe className="w-3.5 h-3.5" /> Global Rule</p>
                        <p className="text-xs text-muted-foreground mt-0.5">Applies to all merchants without a specific rule</p>
                        {visDrawer.globalVisible !== null && (
                          <p className="text-xs text-muted-foreground mt-0.5">Currently: <span className={visDrawer.globalVisible ? "text-emerald-400" : "text-rose-400"}>{visDrawer.globalVisible ? "Visible" : "Hidden"}</span></p>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" className="text-emerald-400 border-emerald-500/30 h-7 text-xs" onClick={() => handleGlobalVisibility(visDrawer.id, true)} disabled={visRateLimit.isRateLimited || setVisMut.isPending}>Enable All</Button>
                        <Button size="sm" variant="outline" className="text-rose-400 border-rose-500/30 h-7 text-xs" onClick={() => handleGlobalVisibility(visDrawer.id, false)} disabled={visRateLimit.isRateLimited || setVisMut.isPending}>Disable All</Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Bulk actions */}
                {selectedMerchants.size > 0 && (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/5 border border-primary/20">
                    <span className="text-xs text-muted-foreground flex-1">{selectedMerchants.size} merchant{selectedMerchants.size > 1 ? "s" : ""} selected</span>
                    <Button size="sm" className="h-7 text-xs gap-1" onClick={() => handleBulkVisibility(true)} disabled={visRateLimit.isRateLimited || bulkVisMut.isPending}>Enable</Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-rose-400 border-rose-500/30" onClick={() => handleBulkVisibility(false)} disabled={visRateLimit.isRateLimited || bulkVisMut.isPending}>Disable</Button>
                  </div>
                )}

                {/* Per-merchant search */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <Input className="pl-8 h-8 text-sm" placeholder="Search merchants…" value={merchantSearch} onChange={e => setMerchantSearch(e.target.value)} />
                </div>

                {/* Per-merchant list */}
                {visLoading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-12 bg-muted/40 rounded animate-pulse" />)}
                  </div>
                ) : merchantVis.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">No approved merchants found</p>
                ) : (
                  <div className="space-y-1">
                    {merchantVis.map(m => (
                      <div key={m.merchantId} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-muted/20 border border-transparent hover:border-border/30">
                        <input
                          type="checkbox"
                          className="rounded"
                          checked={selectedMerchants.has(m.merchantId)}
                          onChange={e => {
                            const s = new Set(selectedMerchants);
                            e.target.checked ? s.add(m.merchantId) : s.delete(m.merchantId);
                            setSelectedMerchants(s);
                          }}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{m.businessName}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {m.email}
                            {m.source !== "merchant" && <span className="ml-1 text-muted-foreground/60">({m.source})</span>}
                          </p>
                        </div>
                        <Switch
                          checked={m.visible}
                          onCheckedChange={v => handleMerchantToggle(visDrawer.id, m.merchantId, v)}
                          disabled={visRateLimit.isRateLimited || setVisMut.isPending}
                          className="shrink-0"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* EKQR Settings Sheet */}
      <Sheet open={ekqrSheetOpen} onOpenChange={open => { setEkqrSheetOpen(open); if (!open) { setEkqrTestResult(null); setEkqrRawOpen(false); } }}>
        <SheetContent className="sm:max-w-[500px] overflow-y-auto">
          <SheetHeader className="mb-6">
            <SheetTitle className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-yellow-400" />
              UPI Gateway Settings
            </SheetTitle>
            <SheetDescription>
              Configure the global UPI gateway API key and status.
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-5">
            {/* Webhook URL */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">Webhook URL</Label>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs bg-muted/50 border border-border/50 rounded px-3 py-2 font-mono truncate">
                  https://rasokart.com/api/payment/webhook
                </code>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 shrink-0"
                  onClick={() => {
                    navigator.clipboard.writeText("https://rasokart.com/api/payment/webhook");
                    toast.success("Webhook URL copied");
                  }}
                >
                  <Copy className="w-3.5 h-3.5" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Configure this URL in your gateway dashboard to receive payment notifications.</p>
            </div>

            {/* Enable/disable */}
            <div className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-muted/10">
              <div>
                <p className="text-sm font-medium">Enable UPI Gateway</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Merchants with a UPI gateway connection will use this for QR payments
                </p>
              </div>
              <Switch
                checked={ekqrEnabled}
                onCheckedChange={setEkqrEnabled}
                disabled={ekqrLoading}
              />
            </div>

            {/* API Key */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">API Key</Label>
              {ekqrConfig?.apiKeySet && ekqrApiKey === "" && (
                <p className="text-xs text-muted-foreground">
                  Current key: <span className="font-mono">{ekqrConfig.apiKeyMasked ?? "••••••••"}</span>
                  {" — "}enter a new key below to replace it
                </p>
              )}
              <div className="relative">
                <Input
                  type={showEkqrKey ? "text" : "password"}
                  placeholder={ekqrConfig?.apiKeySet ? "Enter new API key to replace…" : "Enter EKQR API key"}
                  value={ekqrApiKey}
                  onChange={e => setEkqrApiKey(e.target.value)}
                  className="h-8 text-xs pr-9 font-mono"
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowEkqrKey(v => !v)}
                >
                  {showEkqrKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {/* Test result */}
            {ekqrTestResult && (
              <div className={`rounded-md px-3 py-2.5 space-y-1.5 ${ekqrTestResult.ok ? "bg-emerald-500/10 border border-emerald-500/25" : "bg-destructive/10 border border-destructive/25"}`}>
                <div className="flex items-center gap-2">
                  {ekqrTestResult.ok
                    ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    : <AlertCircle className="w-3.5 h-3.5 text-destructive shrink-0" />}
                  <span className={`text-xs font-medium ${ekqrTestResult.ok ? "text-emerald-400" : "text-destructive"}`}>
                    {ekqrTestResult.ok ? "Connection successful" : ekqrTestResult.msg}
                  </span>
                </div>
                {ekqrTestResult.raw && (
                  <div>
                    <button
                      type="button"
                      className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                      onClick={() => setEkqrRawOpen(v => !v)}
                    >
                      {ekqrRawOpen ? "Hide" : "Show"} raw response
                    </button>
                    {ekqrRawOpen && (
                      <pre className="mt-1.5 text-xs bg-background/50 rounded p-2 overflow-x-auto max-h-40 whitespace-pre-wrap border border-border/40">
                        {(() => { try { return JSON.stringify(JSON.parse(ekqrTestResult.raw!), null, 2); } catch { return ekqrTestResult.raw; } })()}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Action buttons */}
            <div className="flex items-center gap-2 flex-wrap pt-1">
              <Button
                size="sm"
                onClick={() => saveEkqrConfig({ data: { ...(ekqrApiKey ? { apiKey: ekqrApiKey } : {}), enabled: ekqrEnabled } })}
                disabled={savingEkqr || ekqrLoading || ekqrUnchanged}
              >
                <Save className="w-3.5 h-3.5 mr-1.5" />
                {savingEkqr ? "Saving…" : "Save"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => { setEkqrTestResult(null); setEkqrRawOpen(false); testEkqr(); }}
                disabled={testingEkqr || ekqrLoading || !ekqrConfig?.apiKeySet}
              >
                <FlaskConical className="w-3.5 h-3.5 mr-1.5" />
                {testingEkqr ? "Testing…" : "Test Connection"}
              </Button>
              {!ekqrUnchanged && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => { setEkqrApiKey(""); setEkqrEnabled(currentEkqrEnabled); setEkqrTestResult(null); }}
                  disabled={savingEkqr}
                >
                  Cancel
                </Button>
              )}
            </div>

            <p className="text-xs text-muted-foreground border-t border-border/40 pt-4">
              Full UPI Gateway configuration also available in{" "}
              <a href="/admin/payment-gateways" className="underline underline-offset-2 text-teal-400 hover:text-teal-300">
                Payment Gateways → UPI Gateway
              </a>.
            </p>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
