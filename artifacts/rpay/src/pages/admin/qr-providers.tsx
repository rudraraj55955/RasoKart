import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Search, Plus, Pencil, Trash2, QrCode, Link2, ChevronLeft, ChevronRight, Plug, CheckCircle2, AlertCircle, Clock, XCircle, FlaskConical } from "lucide-react";
import { format } from "date-fns";

const QR_PROVIDERS = [
  { value: "phonepe",       label: "QR Network A",   color: "bg-violet-500/10 text-violet-400 border-violet-500/20" },
  { value: "paytm",         label: "QR Network B",   color: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  { value: "bharatpe",      label: "QR Network C",   color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  { value: "yono_sbi",      label: "QR Network D",   color: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  { value: "hdfc_smarthub", label: "QR Network E",   color: "bg-rose-500/10 text-rose-400 border-rose-500/20" },
  { value: "upi_id",        label: "UPI ID",         color: "bg-primary/10 text-primary border-primary/20" },
  { value: "ekqr",          label: "UPI Gateway",    color: "bg-teal-500/10 text-teal-400 border-teal-500/20" },
];

const CUSTOM_PROVIDER_COLOR = "bg-fuchsia-500/10 text-fuchsia-400 border-fuchsia-500/20";

const CONNECTION_STATUS_META: Record<string, { label: string; className: string; Icon: React.ElementType }> = {
  active:    { label: "Active",    className: "border-emerald-500/40 text-emerald-400", Icon: CheckCircle2 },
  pending:   { label: "Pending",   className: "border-amber-500/40 text-amber-400",    Icon: Clock },
  suspended: { label: "Suspended", className: "border-orange-500/40 text-orange-400",  Icon: AlertCircle },
  failed:    { label: "Failed",    className: "border-rose-500/40 text-rose-400",       Icon: XCircle },
};

function getToken() { return localStorage.getItem("rasokart_token") ?? ""; }
async function api(method: string, path: string, body?: object) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) { const e = await res.json().catch(() => ({ error: "Unknown error" })); throw new Error(e.error ?? "Request failed"); }
  return res.json();
}

function ProviderBadge({ provider, customLabels }: { provider: string; customLabels?: Record<string, string> }) {
  const p = QR_PROVIDERS.find(p => p.value === provider);
  const customLabel = customLabels?.[provider];
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${p?.color ?? (customLabel ? CUSTOM_PROVIDER_COLOR : "bg-muted/50 text-muted-foreground border-border")}`}>
      <QrCode className="w-3 h-3" />
      {p?.label ?? customLabel ?? provider}
    </span>
  );
}

function ConnectionStatusBadge({ status }: { status: string }) {
  const meta = CONNECTION_STATUS_META[status] ?? { label: status, className: "border-muted text-muted-foreground", Icon: Plug };
  const { label, className, Icon } = meta;
  return (
    <Badge variant="outline" className={`text-xs gap-1 ${className}`}>
      <Icon className="w-3 h-3" />
      {label}
    </Badge>
  );
}

interface FormState {
  merchantId: string;
  provider: string;
  monthlyLimit: string;
  isActive: boolean;
  credentials: string;
  capabilityQr: boolean;
  capabilityPayin: boolean;
  capabilityPaymentLinks: boolean;
  notes: string;
}

export default function AdminQrProviders() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<"create" | "edit" | "delete" | "test" | null>(null);
  const [editing, setEditing] = useState<any | null>(null);
  const [merchantSearch, setMerchantSearch] = useState("");
  const [testResult, setTestResult] = useState<{ pass: boolean; message: string } | null>(null);
  const [form, setForm] = useState<FormState>({
    merchantId: "", provider: "phonepe", monthlyLimit: "0", isActive: true,
    credentials: "", capabilityQr: true, capabilityPayin: true, capabilityPaymentLinks: false,
    notes: "",
  });

  // Fetch connections (QR provider assignments)
  const { data, isLoading } = useQuery({
    queryKey: ["connections", search, providerFilter, page],
    queryFn: () => api("GET", `/connections?search=${encodeURIComponent(search)}&provider=${providerFilter !== "all" ? providerFilter : ""}&page=${page}&limit=20`),
  });

  // Fetch merchants for the picker
  const { data: merchantData } = useQuery({
    queryKey: ["merchants-picker", merchantSearch],
    queryFn: () => api("GET", `/merchants?search=${encodeURIComponent(merchantSearch)}&limit=50`),
    enabled: dialog === "create" || dialog === "edit",
  });

  // Fetch admin-added custom gateways so they show up as selectable QR providers too
  const { data: integrationsData } = useQuery({
    queryKey: ["provider-integrations-for-qr"],
    queryFn: () => api("GET", "/provider-integrations/integrations"),
  });

  const rows: any[] = data?.data ?? [];
  const total: number = data?.total ?? 0;
  const merchants: any[] = merchantData?.data ?? [];
  const customIntegrations: any[] = (integrationsData?.data ?? integrationsData ?? []).filter((i: any) => i.isCustom && i.isEnabled);
  const customLabels: Record<string, string> = Object.fromEntries(customIntegrations.map((i: any) => [i.providerKey, i.displayNamePublic ?? i.providerKey]));
  const allProviderOptions = [
    ...QR_PROVIDERS,
    ...customIntegrations
      .filter((i: any) => !QR_PROVIDERS.some(p => p.value === i.providerKey))
      .map((i: any) => ({ value: i.providerKey, label: i.displayNamePublic ?? i.providerKey, color: CUSTOM_PROVIDER_COLOR })),
  ];

  const createMutation = useMutation({
    mutationFn: (body: object) => api("POST", "/connections", body),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["connections"] }); toast.success("QR provider assigned"); setDialog(null); resetForm(); },
    onError: (e: any) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: object }) => api("PUT", `/connections/${id}`, body),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["connections"] }); toast.success("Updated"); setDialog(null); },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api("DELETE", `/connections/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["connections"] }); toast.success("Removed"); setDialog(null); setEditing(null); },
    onError: (e: any) => toast.error(e.message),
  });

  const testMutation = useMutation({
    mutationFn: (id: number) => api("POST", `/connections/${id}/test`, {}),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["connections"] });
      setTestResult({ pass: data.pass, message: data.message ?? (data.pass ? "Connection verified" : "Test failed") });
    },
    onError: (e: any) => {
      setTestResult({ pass: false, message: e.message ?? "Test failed" });
    },
  });

  function resetForm() {
    setForm({ merchantId: "", provider: "phonepe", monthlyLimit: "0", isActive: true, credentials: "", capabilityQr: true, capabilityPayin: true, capabilityPaymentLinks: false, notes: "" });
    setMerchantSearch("");
    setTestResult(null);
  }

  function openCreate() { resetForm(); setEditing(null); setDialog("create"); }

  function openEdit(row: any) {
    setForm({
      merchantId: String(row.merchantId),
      provider: row.provider,
      monthlyLimit: String(row.monthlyLimit ?? 0),
      isActive: row.isActive,
      credentials: row.credentials ?? "",
      capabilityQr: row.capabilityQr !== false,
      capabilityPayin: row.capabilityPayin !== false,
      capabilityPaymentLinks: row.capabilityPaymentLinks === true,
      notes: row.notes ?? "",
    });
    setEditing(row); setDialog("edit");
  }

  function openTest(row: any) {
    setEditing(row);
    setTestResult(null);
    setDialog("test");
  }

  function handleSubmit() {
    if (!form.merchantId) { toast.error("Please select a merchant"); return; }
    const body = {
      merchantId: parseInt(form.merchantId),
      provider: form.provider,
      monthlyLimit: form.monthlyLimit || "0",
      isActive: form.isActive,
      credentials: form.credentials || null,
      capabilityQr: form.capabilityQr,
      capabilityPayin: form.capabilityPayin,
      capabilityPaymentLinks: form.capabilityPaymentLinks,
      notes: form.notes || null,
    };
    if (dialog === "create") createMutation.mutate(body);
    else if (dialog === "edit" && editing) updateMutation.mutate({ id: editing.id, body });
  }

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">QR Provider Manager</h1>
          <p className="text-muted-foreground mt-1">Assign and manage QR payment providers for merchants</p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="w-4 h-4 mr-2" />Assign Provider
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search merchants..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
            </div>
            <Select value={providerFilter} onValueChange={v => { setProviderFilter(v); setPage(1); }}>
              <SelectTrigger className="w-[180px]"><SelectValue placeholder="All providers" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Providers</SelectItem>
                {allProviderOptions.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Merchant</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Monthly Limit</TableHead>
                <TableHead>Used This Month</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Connection</TableHead>
                <TableHead>Assigned</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>{Array.from({ length: 8 }).map((_, j) => <TableCell key={j}><div className="h-4 bg-muted/50 rounded animate-pulse" /></TableCell>)}</TableRow>
                ))
              ) : !rows.length ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-16">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <Link2 className="w-8 h-8 opacity-30" />
                      <p className="text-sm">No QR provider assignments yet</p>
                      <Button size="sm" variant="outline" onClick={openCreate}><Plus className="w-3.5 h-3.5 mr-1" />Assign first</Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : rows.map((row: any) => {
                const limit = Number(row.monthlyLimit ?? 0);
                const used = Number(row.monthlyUsed ?? 0);
                const hasLimit = limit > 0;
                const pct = hasLimit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
                const usedColor = hasLimit && pct >= 100 ? "text-rose-400" : hasLimit && pct >= 80 ? "text-amber-400" : "text-foreground";
                const connStatus = row.connectionStatus ?? (row.isActive ? "active" : "inactive");
                return (
                <TableRow key={row.id}>
                  <TableCell>
                    <div>
                      <p className="text-sm font-medium">{row.businessName ?? row.merchantName ?? `Merchant #${row.merchantId}`}</p>
                      <p className="text-xs text-muted-foreground">{row.merchantEmail ?? `ID #${row.merchantId}`}</p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <ProviderBadge provider={row.provider} customLabels={customLabels} />
                      <div className="flex gap-1 flex-wrap">
                        {row.capabilityQr !== false && (
                          <span className="text-[10px] text-teal-400 bg-teal-500/10 border border-teal-500/20 rounded px-1">QR</span>
                        )}
                        {row.capabilityPayin !== false && (
                          <span className="text-[10px] text-sky-400 bg-sky-500/10 border border-sky-500/20 rounded px-1">Payin</span>
                        )}
                        {row.capabilityPaymentLinks === true && (
                          <span className="text-[10px] text-purple-400 bg-purple-500/10 border border-purple-500/20 rounded px-1">Links</span>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {hasLimit ? `₹${limit.toLocaleString("en-IN")}` : <span className="text-muted-foreground text-xs">No limit</span>}
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <p className={`font-mono text-sm tabular-nums ${usedColor}`}>
                        ₹{used.toLocaleString("en-IN")}
                      </p>
                      {hasLimit && (
                        <p className="text-xs text-muted-foreground">{pct}% of limit</p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-xs ${row.isActive ? "border-emerald-500/40 text-emerald-400" : "border-muted text-muted-foreground"}`}>
                      {row.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <ConnectionStatusBadge status={connStatus} />
                    {row.lastTestResult && row.lastTestResult !== "untested" && (
                      <p className="text-[10px] text-muted-foreground mt-1">
                        Last: {row.lastTestResult === "pass" ? "✓ pass" : "✗ fail"}
                        {row.lastTestedAt && ` · ${format(new Date(row.lastTestedAt), "MMM d")}`}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {format(new Date(row.createdAt), "MMM d, yyyy")}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" title="Test connection" onClick={() => openTest(row)}>
                        <FlaskConical className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => openEdit(row)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="text-rose-400 hover:text-rose-300" onClick={() => { setEditing(row); setDialog("delete"); }}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {total > 20 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{total} assignments</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}><ChevronLeft className="w-4 h-4" /></Button>
            <span className="text-sm text-muted-foreground flex items-center px-2">Page {page}</span>
            <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page * 20 >= total}><ChevronRight className="w-4 h-4" /></Button>
          </div>
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={dialog === "create" || dialog === "edit"} onOpenChange={open => !open && setDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{dialog === "create" ? "Assign QR Provider" : "Edit QR Provider"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {dialog === "create" && (
              <div>
                <Label className="text-xs text-muted-foreground">Merchant</Label>
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input className="pl-9" placeholder="Search merchants..." value={merchantSearch} onChange={e => setMerchantSearch(e.target.value)} />
                  </div>
                  <Select value={form.merchantId} onValueChange={v => setForm(f => ({ ...f, merchantId: v }))}>
                    <SelectTrigger><SelectValue placeholder="Select merchant" /></SelectTrigger>
                    <SelectContent>
                      {merchants.filter(m => m.status === "approved").map((m: any) => (
                        <SelectItem key={m.id} value={String(m.id)}>{m.businessName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
            {dialog === "edit" && (
              <p className="text-sm text-muted-foreground">Merchant ID #{editing?.merchantId}</p>
            )}
            <div>
              <Label className="text-xs text-muted-foreground">Provider</Label>
              <Select value={form.provider} onValueChange={v => setForm(f => ({ ...f, provider: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {allProviderOptions.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Monthly Limit (₹, 0 = no limit)</Label>
              <Input type="number" value={form.monthlyLimit} onChange={e => setForm(f => ({ ...f, monthlyLimit: e.target.value }))} placeholder="0" />
            </div>
            {form.provider === "ekqr" && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">API Key Override (optional)</Label>
                <Input
                  type="password"
                  placeholder="Leave blank to use the global UPI gateway API key"
                  value={form.credentials}
                  onChange={e => setForm(f => ({ ...f, credentials: e.target.value }))}
                  className="h-8 text-xs font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  If empty, the global key from{" "}
                  <a href="/admin/providers" className="underline underline-offset-2 text-teal-400">
                    Payment Providers → UPI Gateway Settings
                  </a>{" "}
                  is used for this merchant.
                </p>
              </div>
            )}

            {/* Capability flags */}
            <div className="space-y-2 rounded-lg border border-border/50 bg-muted/10 p-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Capabilities</p>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm">QR Payments</p>
                  <p className="text-xs text-muted-foreground">Allow QR code creation for this provider</p>
                </div>
                <Switch checked={form.capabilityQr} onCheckedChange={v => setForm(f => ({ ...f, capabilityQr: v }))} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm">Payin</p>
                  <p className="text-xs text-muted-foreground">Allow deposit / payin transactions</p>
                </div>
                <Switch checked={form.capabilityPayin} onCheckedChange={v => setForm(f => ({ ...f, capabilityPayin: v }))} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm">Payment Links</p>
                  <p className="text-xs text-muted-foreground">Allow merchant to create payment links</p>
                </div>
                <Switch checked={form.capabilityPaymentLinks} onCheckedChange={v => setForm(f => ({ ...f, capabilityPaymentLinks: v }))} />
              </div>
            </div>

            <div className="flex items-center gap-3 p-3 rounded-lg border border-border/50 bg-muted/10">
              <Switch checked={form.isActive} onCheckedChange={v => setForm(f => ({ ...f, isActive: v }))} />
              <p className="text-sm">Active</p>
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">Notes (optional)</Label>
              <Textarea
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Internal notes about this assignment..."
                className="text-sm resize-none h-16"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDialog(null); resetForm(); }}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={isSaving}>
              {isSaving ? "Saving..." : dialog === "create" ? "Assign" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Test Connection Dialog */}
      <Dialog open={dialog === "test"} onOpenChange={open => !open && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Test Connection</DialogTitle>
            <DialogDescription>
              Verify credentials for <strong>{editing?.businessName ?? `Merchant #${editing?.merchantId}`}</strong>
              {" "}→ <strong>{allProviderOptions.find(p => p.value === editing?.provider)?.label ?? editing?.provider}</strong>.
              No financial transactions will be created.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2 space-y-3">
            {testResult && (
              <div className={`flex items-start gap-3 rounded-lg border p-3 ${testResult.pass ? "border-emerald-500/30 bg-emerald-500/5" : "border-rose-500/30 bg-rose-500/5"}`}>
                {testResult.pass
                  ? <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                  : <XCircle className="w-4 h-4 text-rose-400 mt-0.5 shrink-0" />}
                <div>
                  <p className={`text-sm font-medium ${testResult.pass ? "text-emerald-400" : "text-rose-400"}`}>
                    {testResult.pass ? "Test passed" : "Test failed"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">{testResult.message}</p>
                </div>
              </div>
            )}
            {!testResult && (
              <p className="text-sm text-muted-foreground">
                Click <strong>Run Test</strong> to verify the provider credentials are valid and the connection is working.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Close</Button>
            <Button
              onClick={() => editing && testMutation.mutate(editing.id)}
              disabled={testMutation.isPending}
            >
              <FlaskConical className="w-4 h-4 mr-2" />
              {testMutation.isPending ? "Testing…" : "Run Test"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={dialog === "delete"} onOpenChange={open => !open && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove QR Provider</DialogTitle>
            <DialogDescription>Remove {allProviderOptions.find(p => p.value === editing?.provider)?.label ?? editing?.provider} from merchant #{editing?.merchantId}?</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => editing && deleteMutation.mutate(editing.id)} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? "Removing..." : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
