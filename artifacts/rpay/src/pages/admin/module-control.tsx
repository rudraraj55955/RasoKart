import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Search, ChevronLeft, ChevronRight, Settings2, Shield, Users, Trash2, ToggleLeft, ToggleRight, Info } from "lucide-react";
import { format } from "date-fns";

const MODULE_DEFS = [
  { name: "customer_login",         label: "Customer Login",             description: "Allow customers to log in and create accounts",            category: "Customer" },
  { name: "customer_wallet",        label: "Customer Wallet",            description: "Customer wallet balance and top-up",                       category: "Customer" },
  { name: "customer_kyc",           label: "Customer KYC",               description: "Customer identity verification",                           category: "Customer" },
  { name: "customer_support",       label: "Customer Support / Tickets", description: "Support ticket system for merchants and customers",         category: "Customer" },
  { name: "merchant_wallet",        label: "Merchant Wallet",            description: "Merchant wallet / ledger access",                          category: "Merchant" },
  { name: "merchant_kyc",           label: "Merchant KYC",               description: "Merchant identity and business verification",               category: "Merchant" },
  { name: "merchant_withdrawals",   label: "Merchant Withdrawals",       description: "Merchants can request withdrawal of funds",                 category: "Merchant" },
  { name: "merchant_settlements",   label: "Merchant Settlements",       description: "Merchants can view and request settlements",                category: "Merchant" },
  { name: "rasokart_services",      label: "RasoKart Services",          description: "Extra services marketplace for merchants",                  category: "Merchant" },
  { name: "api_access",             label: "API Access",                 description: "Merchant API key management and programmatic access",       category: "Merchant" },
  { name: "payout_requests",        label: "Payout Requests",            description: "Single payout / transfer requests",                        category: "Payouts"  },
  { name: "bulk_payout",            label: "Bulk Payout",                description: "Batch / bulk transfer payout operations",                  category: "Payouts"  },
  { name: "live_mode",              label: "Live Mode Access",           description: "Production / live payment processing",                     category: "Access"   },
  { name: "sandbox_mode",           label: "Test / Sandbox Mode",        description: "Test / sandbox payment environment",                       category: "Access"   },
  { name: "smart_routing",          label: "Smart Routing",              description: "Automated payment provider routing",                       category: "Access"   },
] as const;

type ModuleName = typeof MODULE_DEFS[number]["name"];

function getToken() { return localStorage.getItem("rasokart_token") ?? ""; }
const H = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` });

async function apiGet(path: string) {
  const res = await fetch(`/api${path}`, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
async function apiPut(path: string, body: object) {
  const res = await fetch(`/api${path}`, { method: "PUT", headers: H(), body: JSON.stringify(body) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
async function apiPost(path: string, body: object) {
  const res = await fetch(`/api${path}`, { method: "POST", headers: H(), body: JSON.stringify(body) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
async function apiDelete(path: string) {
  const res = await fetch(`/api${path}`, { method: "DELETE", headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

type ModuleStatus = {
  name: string;
  label: string;
  description: string;
  enabled: boolean;
  updatedAt: string | null;
  updatedByAdminEmail: string | null;
};

type MerchantOverride = {
  merchantId: number;
  businessName: string;
  email: string;
  status: string;
  override: { id: number; enabled: boolean; updatedAt: string; updatedByAdminEmail: string | null } | null;
};

const CATEGORY_ORDER = ["Customer", "Merchant", "Payouts", "Access"];

export default function AdminModuleControl() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<"global" | "overrides">("global");
  const [selectedModule, setSelectedModule] = useState<ModuleName>("merchant_withdrawals");
  const [overrideSearch, setOverrideSearch] = useState("");
  const [overridePage, setOverridePage] = useState(1);
  const [overrideDialog, setOverrideDialog] = useState<{ open: boolean; merchantId: number; businessName: string; currentOverride: boolean | null } | null>(null);
  const [overridePendingEnabled, setOverridePendingEnabled] = useState(true);

  // ── Global module status ───────────────────────────────────────────────────
  const { data: globalData, isLoading: globalLoading } = useQuery<{ modules: ModuleStatus[] }>({
    queryKey: ["module-control"],
    queryFn: () => apiGet("/module-control"),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ module, enabled }: { module: string; enabled: boolean }) =>
      apiPut(`/module-control/${module}`, { enabled }),
    onSuccess: (_data, { enabled, module }) => {
      qc.invalidateQueries({ queryKey: ["module-control"] });
      const def = MODULE_DEFS.find(m => m.name === module);
      toast.success(`${def?.label ?? module} ${enabled ? "enabled" : "disabled"} globally`);
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to update module"),
  });

  // ── Per-merchant overrides ─────────────────────────────────────────────────
  const overrideQKey = ["module-overrides", selectedModule, overrideSearch, overridePage];
  const { data: overrideData, isLoading: overrideLoading } = useQuery<{ data: MerchantOverride[]; total: number; page: number; limit: number }>({
    queryKey: overrideQKey,
    queryFn: () => apiGet(`/module-control/${selectedModule}/overrides?search=${encodeURIComponent(overrideSearch)}&page=${overridePage}&limit=15`),
    enabled: activeTab === "overrides",
  });

  const setOverrideMutation = useMutation({
    mutationFn: ({ module, entityId, enabled }: { module: string; entityId: number; enabled: boolean }) =>
      apiPost(`/module-control/${module}/overrides`, { entityType: "merchant", entityId, enabled }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["module-overrides"] });
      setOverrideDialog(null);
      toast.success("Override saved");
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to save override"),
  });

  const removeOverrideMutation = useMutation({
    mutationFn: ({ module, entityId }: { module: string; entityId: number }) =>
      apiDelete(`/module-control/${module}/overrides/merchant/${entityId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["module-overrides"] });
      toast.success("Override removed — merchant reverts to global setting");
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to remove override"),
  });

  const modules = globalData?.modules ?? [];
  const moduleMap = new Map(modules.map(m => [m.name, m]));

  const overrideRows    = overrideData?.data  ?? [];
  const overrideTotal   = overrideData?.total ?? 0;
  const overrideLimit   = overrideData?.limit ?? 15;
  const overrideTotalPages = Math.max(1, Math.ceil(overrideTotal / overrideLimit));
  const selectedDef = MODULE_DEFS.find(m => m.name === selectedModule);

  function openOverrideDialog(row: MerchantOverride) {
    setOverridePendingEnabled(row.override ? !row.override.enabled : false); // default: disable
    setOverrideDialog({ open: true, merchantId: row.merchantId, businessName: row.businessName, currentOverride: row.override?.enabled ?? null });
  }

  function handleSearch(value: string) { setOverrideSearch(value); setOverridePage(1); }
  function handleModuleChange(name: string) { setSelectedModule(name as ModuleName); setOverrideSearch(""); setOverridePage(1); }

  // Group modules by category for the global tab
  const grouped = CATEGORY_ORDER.map(cat => ({
    category: cat,
    items: MODULE_DEFS.filter(m => m.category === cat).map(def => ({ def, status: moduleMap.get(def.name) })),
  }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Module Control</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Enable or disable platform modules globally or per merchant. All changes are audit-logged.
          </p>
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground bg-muted/40 border border-border/40 rounded-lg px-3 py-1.5">
          <Shield className="w-3.5 h-3.5 text-emerald-400" />
          Audit-logged
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-2 border-b border-border/60 pb-0">
        <button
          onClick={() => setActiveTab("global")}
          className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${activeTab === "global" ? "border-emerald-500 text-emerald-400" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          <span className="flex items-center gap-1.5"><Settings2 className="w-4 h-4" />Global Controls</span>
        </button>
        <button
          onClick={() => setActiveTab("overrides")}
          className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ml-4 ${activeTab === "overrides" ? "border-emerald-500 text-emerald-400" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          <span className="flex items-center gap-1.5"><Users className="w-4 h-4" />Per-Merchant Overrides</span>
        </button>
      </div>

      {/* ── GLOBAL CONTROLS TAB ── */}
      {activeTab === "global" && (
        <div className="space-y-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1.5 bg-blue-500/5 border border-blue-500/20 rounded-lg px-3 py-2">
            <Info className="w-3.5 h-3.5 text-blue-400 shrink-0" />
            <span>Disabling a module globally blocks it for ALL merchants. Use Per-Merchant Overrides for selective control.</span>
          </div>

          {globalLoading ? (
            <div className="text-sm text-muted-foreground py-8 text-center">Loading modules…</div>
          ) : (
            <div className="space-y-4">
              {grouped.map(({ category, items }) => (
                <Card key={category} className="border-border/60 bg-card">
                  <CardHeader className="py-3 px-4 border-b border-border/40">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{category}</span>
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent border-b border-border/40">
                          <TableHead className="text-xs text-muted-foreground py-2 w-[200px]">Module</TableHead>
                          <TableHead className="text-xs text-muted-foreground py-2 hidden md:table-cell">Description</TableHead>
                          <TableHead className="text-xs text-muted-foreground py-2 w-[100px] text-center">Status</TableHead>
                          <TableHead className="text-xs text-muted-foreground py-2 w-[80px] text-center">Toggle</TableHead>
                          <TableHead className="text-xs text-muted-foreground py-2 w-[160px] hidden lg:table-cell">Last changed by</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {items.map(({ def, status }) => {
                          const isEnabled = status?.enabled ?? true;
                          const isPending = toggleMutation.isPending && toggleMutation.variables?.module === def.name;
                          return (
                            <TableRow key={def.name} className="hover:bg-muted/20 border-border/30">
                              <TableCell className="py-3 font-medium text-sm text-foreground">{def.label}</TableCell>
                              <TableCell className="py-3 text-xs text-muted-foreground hidden md:table-cell">{def.description}</TableCell>
                              <TableCell className="py-3 text-center">
                                <Badge variant="outline" className={`text-[11px] px-2 py-0 ${isEnabled ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/8" : "border-rose-500/40 text-rose-400 bg-rose-500/8"}`}>
                                  {isEnabled ? "Enabled" : "Disabled"}
                                </Badge>
                              </TableCell>
                              <TableCell className="py-3 text-center">
                                <Switch
                                  checked={isEnabled}
                                  disabled={isPending}
                                  onCheckedChange={(val) => toggleMutation.mutate({ module: def.name, enabled: val })}
                                  className="data-[state=checked]:bg-emerald-500"
                                />
                              </TableCell>
                              <TableCell className="py-3 text-xs text-muted-foreground hidden lg:table-cell">
                                {status?.updatedByAdminEmail
                                  ? <span title={status.updatedAt ? format(new Date(status.updatedAt), "dd MMM yyyy HH:mm") : ""}>{status.updatedByAdminEmail}</span>
                                  : <span className="italic opacity-50">—</span>}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── PER-MERCHANT OVERRIDES TAB ── */}
      {activeTab === "overrides" && (
        <div className="space-y-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1.5 bg-blue-500/5 border border-blue-500/20 rounded-lg px-3 py-2">
            <Info className="w-3.5 h-3.5 text-blue-400 shrink-0" />
            <span>Overrides only apply if the module is globally <strong className="text-foreground">enabled</strong>. A globally disabled module cannot be overridden per-merchant.</span>
          </div>

          {/* Controls bar */}
          <div className="flex flex-wrap gap-3 items-center">
            <div className="w-[260px]">
              <Select value={selectedModule} onValueChange={handleModuleChange}>
                <SelectTrigger className="border-border/60 bg-background text-sm">
                  <SelectValue placeholder="Select module" />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORY_ORDER.map(cat => (
                    <div key={cat}>
                      <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{cat}</div>
                      {MODULE_DEFS.filter(m => m.category === cat).map(m => (
                        <SelectItem key={m.name} value={m.name}>{m.label}</SelectItem>
                      ))}
                    </div>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                placeholder="Search merchants…"
                value={overrideSearch}
                onChange={e => handleSearch(e.target.value)}
                className="pl-9 border-border/60 bg-background text-sm"
              />
            </div>
            {selectedDef && (() => {
              const globalStatus = moduleMap.get(selectedModule);
              const isGlobalEnabled = globalStatus?.enabled ?? true;
              return !isGlobalEnabled ? (
                <Badge variant="outline" className="border-rose-500/40 text-rose-400 bg-rose-500/8 text-[11px] shrink-0">
                  ⚠ Module is globally disabled
                </Badge>
              ) : null;
            })()}
          </div>

          <Card className="border-border/60 bg-card">
            <CardHeader className="py-3 px-4 border-b border-border/40">
              <span className="text-sm font-medium text-foreground">
                Merchant Overrides — <span className="text-emerald-400">{selectedDef?.label}</span>
              </span>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-b border-border/40">
                    <TableHead className="text-xs text-muted-foreground py-2">Merchant</TableHead>
                    <TableHead className="text-xs text-muted-foreground py-2">Email</TableHead>
                    <TableHead className="text-xs text-muted-foreground py-2 text-center w-[120px]">Override</TableHead>
                    <TableHead className="text-xs text-muted-foreground py-2 hidden lg:table-cell">Last changed by</TableHead>
                    <TableHead className="text-xs text-muted-foreground py-2 text-right w-[180px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overrideLoading ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-8 text-sm">Loading…</TableCell>
                    </TableRow>
                  ) : overrideRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-8 text-sm">No merchants found</TableCell>
                    </TableRow>
                  ) : overrideRows.map(row => (
                    <TableRow key={row.merchantId} className="hover:bg-muted/20 border-border/30">
                      <TableCell className="py-2.5 font-medium text-sm text-foreground">{row.businessName}</TableCell>
                      <TableCell className="py-2.5 text-xs text-muted-foreground">{row.email}</TableCell>
                      <TableCell className="py-2.5 text-center">
                        {row.override == null ? (
                          <Badge variant="outline" className="border-border/50 text-muted-foreground text-[11px] px-1.5 py-0">Global</Badge>
                        ) : row.override.enabled ? (
                          <Badge variant="outline" className="border-emerald-500/40 text-emerald-400 bg-emerald-500/8 text-[11px] px-1.5 py-0">Enabled</Badge>
                        ) : (
                          <Badge variant="outline" className="border-rose-500/40 text-rose-400 bg-rose-500/8 text-[11px] px-1.5 py-0">Disabled</Badge>
                        )}
                      </TableCell>
                      <TableCell className="py-2.5 text-xs text-muted-foreground hidden lg:table-cell">
                        {row.override?.updatedByAdminEmail ?? <span className="italic opacity-40">—</span>}
                      </TableCell>
                      <TableCell className="py-2.5 text-right">
                        <div className="flex gap-1.5 justify-end">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs gap-1 border-border/60 hover:bg-muted/50"
                            onClick={() => openOverrideDialog(row)}
                          >
                            {row.override?.enabled === false
                              ? <><ToggleRight className="w-3.5 h-3.5 text-emerald-400" />Enable</>
                              : <><ToggleLeft className="w-3.5 h-3.5 text-rose-400" />Disable</>
                            }
                          </Button>
                          {row.override != null && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs gap-1 text-muted-foreground hover:text-rose-400 hover:bg-rose-500/10"
                              onClick={() => removeOverrideMutation.mutate({ module: selectedModule, entityId: row.merchantId })}
                              disabled={removeOverrideMutation.isPending}
                            >
                              <Trash2 className="w-3 h-3" />Reset
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Pagination */}
              {overrideTotal > overrideLimit && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-border/40">
                  <span className="text-xs text-muted-foreground">{overrideTotal} merchants</span>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" className="h-7 w-7 p-0" disabled={overridePage <= 1} onClick={() => setOverridePage(p => p - 1)}>
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </Button>
                    <span className="text-xs text-muted-foreground">{overridePage} / {overrideTotalPages}</span>
                    <Button size="sm" variant="outline" className="h-7 w-7 p-0" disabled={overridePage >= overrideTotalPages} onClick={() => setOverridePage(p => p + 1)}>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── OVERRIDE DIALOG ── */}
      <Dialog open={overrideDialog?.open ?? false} onOpenChange={open => { if (!open) setOverrideDialog(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">Set Module Override</DialogTitle>
          </DialogHeader>
          {overrideDialog && (
            <div className="space-y-4 py-2">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Merchant</p>
                <p className="text-sm font-medium text-foreground">{overrideDialog.businessName}</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Module</p>
                <p className="text-sm font-medium text-foreground">{selectedDef?.label}</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Current override</p>
                <p className="text-sm text-foreground">
                  {overrideDialog.currentOverride === null ? "None (uses global setting)" : overrideDialog.currentOverride ? "Enabled" : "Disabled"}
                </p>
              </div>
              <div className="flex items-center justify-between border border-border/60 rounded-lg px-4 py-3">
                <div>
                  <p className="text-sm font-medium">New value: <span className={overridePendingEnabled ? "text-emerald-400" : "text-rose-400"}>{overridePendingEnabled ? "Enabled" : "Disabled"}</span></p>
                  <p className="text-xs text-muted-foreground mt-0.5">Toggle to change</p>
                </div>
                <Switch
                  checked={overridePendingEnabled}
                  onCheckedChange={setOverridePendingEnabled}
                  className="data-[state=checked]:bg-emerald-500"
                />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOverrideDialog(null)}>Cancel</Button>
            <Button
              disabled={setOverrideMutation.isPending}
              onClick={() => {
                if (!overrideDialog) return;
                setOverrideMutation.mutate({ module: selectedModule, entityId: overrideDialog.merchantId, enabled: overridePendingEnabled });
              }}
              className={overridePendingEnabled ? "bg-emerald-600 hover:bg-emerald-700" : "bg-rose-600 hover:bg-rose-700"}
            >
              {setOverrideMutation.isPending ? "Saving…" : `Set ${overridePendingEnabled ? "Enabled" : "Disabled"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
