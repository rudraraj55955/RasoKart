import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getToken } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Pencil, CheckCircle2, XCircle, Clock, RefreshCw, Layers, Settings2, Users, Link2, ExternalLink } from "lucide-react";
import { Link } from "wouter";

// ── Types ────────────────────────────────────────────────────────────────────

type Integration = {
  id: number;
  providerKey: string;
  providerNameInternal: string;
  displayNamePublic: string;
  environment: string;
  isEnabled: boolean;
  productType: string | null;
  webhookUrl: string | null;
  notes: string | null;
  updatedByEmail: string | null;
  createdAt: string;
  updatedAt: string;
};

type Product = {
  id: number;
  productKey: string;
  providerKey: string | null;
  publicName: string;
  internalName: string | null;
  description: string | null;
  iconKey: string | null;
  isEnabled: boolean;
  status: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

type ActivationRequest = {
  id: number;
  merchantId: number;
  productKey: string;
  status: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
};

// ── API helpers ───────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}`, ...options.headers },
  });
  if (!res.ok) { const t = await res.text(); throw new Error(t || res.statusText); }
  return res.json();
}

// ── Status helpers ────────────────────────────────────────────────────────────

const ENV_BADGE: Record<string, string> = {
  test: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  live: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
};

const STATUS_BADGE: Record<string, string> = {
  active:      "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  coming_soon: "bg-sky-500/10 text-sky-400 border-sky-500/30",
  disabled:    "bg-muted text-muted-foreground border-border",
};

const REQUEST_BADGE: Record<string, string> = {
  pending:  "bg-amber-500/10 text-amber-400 border-amber-500/30",
  approved: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  rejected: "bg-red-500/10 text-red-400 border-red-500/30",
};

// ── Integration Edit Dialog ───────────────────────────────────────────────────

function EditIntegrationDialog({ integration, onClose }: { integration: Integration; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    environment: integration.environment,
    isEnabled: integration.isEnabled,
    displayNamePublic: integration.displayNamePublic,
    webhookUrl: integration.webhookUrl ?? "",
    notes: integration.notes ?? "",
  });

  const mutation = useMutation({
    mutationFn: () => apiFetch(`/provider-integrations/integrations/${integration.providerKey}`, {
      method: "PUT", body: JSON.stringify({ ...form, isEnabled: form.isEnabled }),
    }),
    onSuccess: () => {
      toast.success("Integration updated");
      qc.invalidateQueries({ queryKey: ["providerIntegrations"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg bg-card border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-primary" />
            Edit: {integration.providerNameInternal}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Internal Provider</Label>
              <p className="text-sm font-medium">{integration.providerNameInternal}</p>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Provider Key</Label>
              <p className="text-sm font-mono text-muted-foreground">{integration.providerKey}</p>
            </div>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">Public Display Name</Label>
            <Input
              value={form.displayNamePublic}
              onChange={e => setForm(f => ({ ...f, displayNamePublic: e.target.value }))}
              placeholder="e.g. RasoKart Payment Gateway"
            />
            <p className="text-xs text-muted-foreground mt-1">Shown in admin product mapping only. Never shown to merchants.</p>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">Environment</Label>
            <Select value={form.environment} onValueChange={v => setForm(f => ({ ...f, environment: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="test">Sandbox / Test</SelectItem>
                <SelectItem value="live">Live / Production</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">Webhook URL (reference only)</Label>
            <Input
              value={form.webhookUrl}
              onChange={e => setForm(f => ({ ...f, webhookUrl: e.target.value }))}
              placeholder="https://api.rasokart.com/api/payment/cashfree/webhook"
            />
          </div>

          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">Internal Notes (admin only)</Label>
            <Textarea
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              rows={2}
              placeholder="Internal notes for admins..."
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium">Integration Enabled</p>
              <p className="text-xs text-muted-foreground">Activates/deactivates this backend provider</p>
            </div>
            <Switch checked={form.isEnabled} onCheckedChange={v => setForm(f => ({ ...f, isEnabled: v }))} />
          </div>

          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-400">
            <strong>Credentials</strong> (Client ID, Secret, Webhook Secret) are managed separately in{" "}
            <Link href={integration.productType === "payout" ? "/admin/cashfree-payout" : "/admin/cashfree-gateway"}
              className="underline underline-offset-2 hover:text-amber-300">
              System Config → {integration.productType === "payout" ? "Payout Gateway" : "Payin Gateway"}
            </Link>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? "Saving…" : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Product Edit Dialog ───────────────────────────────────────────────────────

function EditProductDialog({ product, onClose }: { product: Product; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    status: product.status,
    isEnabled: product.isEnabled,
    publicName: product.publicName,
    description: product.description ?? "",
    sortOrder: String(product.sortOrder),
  });

  const mutation = useMutation({
    mutationFn: () => apiFetch(`/provider-integrations/products/${product.productKey}`, {
      method: "PUT",
      body: JSON.stringify({ ...form, sortOrder: parseInt(form.sortOrder) || 0 }),
    }),
    onSuccess: () => {
      toast.success("Service updated");
      qc.invalidateQueries({ queryKey: ["providerProducts"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg bg-card border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-primary" />
            Edit Service: {product.publicName}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Product Key</Label>
              <p className="font-mono text-muted-foreground">{product.productKey}</p>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Internal Name</Label>
              <p className="text-muted-foreground">{product.internalName ?? "—"}</p>
            </div>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">Public Name (shown to merchants)</Label>
            <Input value={form.publicName} onChange={e => setForm(f => ({ ...f, publicName: e.target.value }))} />
          </div>

          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">Description</Label>
            <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Status</Label>
              <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="coming_soon">Coming Soon</SelectItem>
                  <SelectItem value="disabled">Disabled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Sort Order</Label>
              <Input type="number" value={form.sortOrder} onChange={e => setForm(f => ({ ...f, sortOrder: e.target.value }))} />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <p className="text-sm font-medium">Show to Merchants</p>
            <Switch checked={form.isEnabled} onCheckedChange={v => setForm(f => ({ ...f, isEnabled: v }))} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? "Saving…" : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminProviderIntegrations() {
  const qc = useQueryClient();
  const [editIntegration, setEditIntegration] = useState<Integration | null>(null);
  const [editProduct, setEditProduct] = useState<Product | null>(null);

  const { data: integrations = [], isLoading: loadingI } = useQuery<Integration[]>({
    queryKey: ["providerIntegrations"],
    queryFn: () => apiFetch("/provider-integrations/integrations"),
  });

  const { data: products = [], isLoading: loadingP } = useQuery<Product[]>({
    queryKey: ["providerProducts"],
    queryFn: () => apiFetch("/provider-integrations/products"),
  });

  const { data: activationRequests = [], isLoading: loadingA } = useQuery<ActivationRequest[]>({
    queryKey: ["activationRequests"],
    queryFn: () => apiFetch("/provider-integrations/activation-requests"),
  });

  const approveRejectMutation = useMutation({
    mutationFn: ({ id, status, note }: { id: number; status: string; note?: string }) =>
      apiFetch(`/provider-integrations/activation-requests/${id}`, {
        method: "PUT", body: JSON.stringify({ status, note }),
      }),
    onSuccess: (_, vars) => {
      toast.success(`Request ${vars.status}`);
      qc.invalidateQueries({ queryKey: ["activationRequests"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pendingCount = activationRequests.filter(r => r.status === "pending").length;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Provider Integrations</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Super Admin view — backend provider identities are visible here only.
            Merchants see only RasoKart-branded service names.
          </p>
        </div>
        <Badge variant="outline" className="bg-amber-500/10 text-amber-400 border-amber-500/30 px-3 py-1 text-xs font-medium self-start sm:self-auto">
          🔒 Super Admin Only
        </Badge>
      </div>

      {/* Warning banner */}
      <div className="rounded-lg border border-red-500/30 bg-red-950/20 p-4 text-sm text-red-400">
        <strong className="font-semibold">Security Notice:</strong> Provider names, internal IDs, and raw API
        responses on this page are NEVER exposed to merchants or customers. The white-label architecture
        ensures all external-facing surfaces show only RasoKart branding.
      </div>

      <Tabs defaultValue="integrations">
        <TabsList className="bg-muted/30">
          <TabsTrigger value="integrations" className="gap-2">
            <Settings2 className="w-3.5 h-3.5" /> Backend Providers
          </TabsTrigger>
          <TabsTrigger value="services" className="gap-2">
            <Layers className="w-3.5 h-3.5" /> Service Catalogue
          </TabsTrigger>
          <TabsTrigger value="requests" className="gap-2">
            <Users className="w-3.5 h-3.5" />
            Activation Requests
            {pendingCount > 0 && (
              <span className="flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-amber-500 text-[10px] font-bold text-black px-1">
                {pendingCount}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── Backend Providers Tab ── */}
        <TabsContent value="integrations" className="mt-6 space-y-4">
          <p className="text-sm text-muted-foreground">
            These are the actual payment processors powering RasoKart. This information is{" "}
            <strong className="text-foreground">never</strong> shown to merchants or customers.
          </p>
          {loadingI ? (
            <div className="text-sm text-muted-foreground py-8 text-center">Loading integrations…</div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {integrations.map(integration => (
                <Card key={integration.id} className="bg-card/50 border-border hover:border-border/80 transition-colors">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <CardTitle className="text-base">{integration.providerNameInternal}</CardTitle>
                          <Badge variant="outline" className={ENV_BADGE[integration.environment] ?? "bg-muted"}>
                            {integration.environment === "live" ? "Live" : "Sandbox"}
                          </Badge>
                          <Badge variant="outline" className={integration.isEnabled
                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                            : "bg-muted text-muted-foreground border-border"
                          }>
                            {integration.isEnabled ? "Enabled" : "Disabled"}
                          </Badge>
                        </div>
                        <CardDescription className="mt-1 font-mono text-xs">{integration.providerKey}</CardDescription>
                      </div>
                      <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8" onClick={() => setEditIntegration(integration)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-xs text-muted-foreground mb-0.5">Public Name (admin ref)</p>
                        <p className="font-medium text-xs">{integration.displayNamePublic}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground mb-0.5">Product Type</p>
                        <p className="font-medium text-xs capitalize">{integration.productType ?? "—"}</p>
                      </div>
                    </div>
                    {integration.notes && (
                      <p className="text-xs text-muted-foreground border-t border-border/50 pt-2">{integration.notes}</p>
                    )}
                    <div className="flex items-center gap-2 border-t border-border/50 pt-2">
                      <Link
                        href={integration.productType === "payout" ? "/admin/cashfree-payout" : "/admin/cashfree-gateway"}
                        className="text-xs text-primary hover:underline flex items-center gap-1"
                      >
                        <ExternalLink className="w-3 h-3" />
                        Manage Credentials
                      </Link>
                    </div>
                    {integration.updatedByEmail && (
                      <p className="text-xs text-muted-foreground/60">
                        Last updated by {integration.updatedByEmail} · {new Date(integration.updatedAt).toLocaleDateString()}
                      </p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Service Catalogue Tab ── */}
        <TabsContent value="services" className="mt-6 space-y-4">
          <p className="text-sm text-muted-foreground">
            Merchant-facing service catalogue. Merchants see only the <strong className="text-foreground">Public Name</strong>.
            The internal provider name is never exposed.
          </p>
          {loadingP ? (
            <div className="text-sm text-muted-foreground py-8 text-center">Loading services…</div>
          ) : (
            <div className="rounded-lg border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className="text-muted-foreground text-xs font-medium">#</TableHead>
                    <TableHead className="text-muted-foreground text-xs font-medium">Public Name (merchant sees)</TableHead>
                    <TableHead className="text-muted-foreground text-xs font-medium">Internal Provider</TableHead>
                    <TableHead className="text-muted-foreground text-xs font-medium">Status</TableHead>
                    <TableHead className="text-muted-foreground text-xs font-medium">Visible</TableHead>
                    <TableHead className="text-muted-foreground text-xs font-medium w-16"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products.map((p, i) => (
                    <TableRow key={p.id} className="border-border hover:bg-muted/20">
                      <TableCell className="text-muted-foreground text-xs">{i + 1}</TableCell>
                      <TableCell>
                        <div>
                          <p className="text-sm font-medium">{p.publicName}</p>
                          <p className="text-xs text-muted-foreground font-mono">{p.productKey}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <p className="text-sm">{p.internalName ?? <span className="text-muted-foreground/50">Not assigned</span>}</p>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-xs ${STATUS_BADGE[p.status] ?? "bg-muted"}`}>
                          {p.status === "active" ? "Active" : p.status === "coming_soon" ? "Coming Soon" : "Disabled"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={p.isEnabled
                          ? "text-xs bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                          : "text-xs bg-muted text-muted-foreground border-border"
                        }>
                          {p.isEnabled ? "Visible" : "Hidden"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditProduct(p)}>
                          <Pencil className="w-3 h-3" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* ── Activation Requests Tab ── */}
        <TabsContent value="requests" className="mt-6 space-y-4">
          {loadingA ? (
            <div className="text-sm text-muted-foreground py-8 text-center">Loading requests…</div>
          ) : activationRequests.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Users className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p className="text-sm">No activation requests yet</p>
            </div>
          ) : (
            <div className="rounded-lg border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className="text-muted-foreground text-xs font-medium">ID</TableHead>
                    <TableHead className="text-muted-foreground text-xs font-medium">Merchant ID</TableHead>
                    <TableHead className="text-muted-foreground text-xs font-medium">Service</TableHead>
                    <TableHead className="text-muted-foreground text-xs font-medium">Status</TableHead>
                    <TableHead className="text-muted-foreground text-xs font-medium">Requested</TableHead>
                    <TableHead className="text-muted-foreground text-xs font-medium">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activationRequests.map(r => (
                    <TableRow key={r.id} className="border-border hover:bg-muted/20">
                      <TableCell className="text-muted-foreground text-xs">#{r.id}</TableCell>
                      <TableCell className="text-sm font-mono">{r.merchantId}</TableCell>
                      <TableCell>
                        <div>
                          <p className="text-sm font-medium">{
                            products.find(p => p.productKey === r.productKey)?.publicName ?? r.productKey
                          }</p>
                          <p className="text-xs text-muted-foreground font-mono">{r.productKey}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-xs ${REQUEST_BADGE[r.status] ?? "bg-muted"}`}>
                          {r.status === "pending" && <Clock className="w-3 h-3 mr-1" />}
                          {r.status === "approved" && <CheckCircle2 className="w-3 h-3 mr-1" />}
                          {r.status === "rejected" && <XCircle className="w-3 h-3 mr-1" />}
                          {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(r.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        {r.status === "pending" && (
                          <div className="flex items-center gap-1.5">
                            <Button
                              size="sm"
                              className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700"
                              disabled={approveRejectMutation.isPending}
                              onClick={() => approveRejectMutation.mutate({ id: r.id, status: "approved" })}
                            >
                              <CheckCircle2 className="w-3 h-3 mr-1" /> Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs border-red-500/30 text-red-400 hover:bg-red-500/10"
                              disabled={approveRejectMutation.isPending}
                              onClick={() => approveRejectMutation.mutate({ id: r.id, status: "rejected" })}
                            >
                              <XCircle className="w-3 h-3 mr-1" /> Reject
                            </Button>
                          </div>
                        )}
                        {r.status !== "pending" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs text-muted-foreground"
                            disabled={approveRejectMutation.isPending}
                            onClick={() => approveRejectMutation.mutate({ id: r.id, status: "pending" })}
                          >
                            <RefreshCw className="w-3 h-3 mr-1" /> Reopen
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {editIntegration && <EditIntegrationDialog integration={editIntegration} onClose={() => setEditIntegration(null)} />}
      {editProduct && <EditProductDialog product={editProduct} onClose={() => setEditProduct(null)} />}
    </div>
  );
}
