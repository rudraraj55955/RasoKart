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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  GitMerge, Activity, BarChart2, ScrollText, Plus, Pencil, Trash2,
  RefreshCw, ArrowUpDown, CheckCircle2, XCircle, Clock, AlertTriangle,
  ShieldCheck, Zap, Settings2,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";

// ── Types ────────────────────────────────────────────────────────────────────

type RoutingConfig = {
  id: number;
  configName: string;
  description: string | null;
  strategy: string;
  isEnabled: boolean;
  fallbackEnabled: boolean;
  timeoutMs: number;
  minSuccessRateThreshold: string | null;
  updatedByEmail: string | null;
  updatedAt: string;
};

type RoutingRule = {
  id: number;
  configId: number;
  providerKey: string;
  priority: number;
  weightPercent: number;
  minAmount: string | null;
  maxAmount: string | null;
  allowedPaymentModes: string | null;
  isEnabled: boolean;
  notes: string | null;
  updatedAt: string;
};

type ProviderMetric = {
  id: number;
  providerKey: string;
  timeWindow: string;
  totalAttempts: number;
  successCount: number;
  failedCount: number;
  timeoutCount: number;
  avgResponseMs: number | null;
  successRate: number | null;
  lastComputedAt: string;
};

type RoutingLog = {
  id: number;
  merchantId: number;
  configName: string | null;
  strategyUsed: string | null;
  attemptNumber: number;
  providerKey: string;
  result: string;
  responseTimeMs: number | null;
  amount: number | null;
  paymentMode: string | null;
  publicReferenceId: string | null;
  errorMessage: string | null;
  createdAt: string;
};

type StatusData = {
  configured: boolean;
  configName: string | null;
  strategy: string | null;
  isEnabled: boolean;
  fallbackEnabled: boolean;
  timeoutMs: number;
  providerCount: number;
  providers: { providerKey: string; priority: number; weightPercent: number; isEnabled: boolean }[];
  metrics24h: { providerKey: string; successRate: number; totalAttempts: number; avgResponseMs: number | null }[];
  recentActivity: { successCount24h: number; failedCount24h: number };
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const STRATEGY_LABELS: Record<string, string> = {
  priority: "Priority (Ordered Failover)",
  percentage: "Percentage Split",
  success_rate: "Success Rate Based",
  round_robin: "Round Robin",
};

const PAYMENT_MODES = ["upi", "card", "netbanking", "wallet", "bnpl", "emi"];

function resultBadge(result: string) {
  switch (result) {
    case "success": return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">Success</Badge>;
    case "failed": return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">Failed</Badge>;
    case "timeout": return <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30">Timeout</Badge>;
    case "disabled": return <Badge className="bg-zinc-500/20 text-zinc-400 border-zinc-500/30">Disabled</Badge>;
    case "skipped": return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">Skipped</Badge>;
    default: return <Badge variant="outline">{result}</Badge>;
  }
}

async function apiReq(path: string, method = "GET", body?: unknown) {
  const r = await fetch(`/api/smart-routing${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ error: r.statusText }));
    throw new Error((err as any).error ?? r.statusText);
  }
  return r.json();
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AdminSmartRouting() {
  const qc = useQueryClient();

  // Selected config (for rules view)
  const [selectedConfigId, setSelectedConfigId] = useState<number | null>(null);
  const [metricsWindow, setMetricsWindow] = useState("24h");
  const [logsPage, setLogsPage] = useState(1);

  // Dialogs
  const [editConfigOpen, setEditConfigOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<RoutingConfig | null>(null);
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<RoutingRule | null>(null);
  const [deleteRuleId, setDeleteRuleId] = useState<number | null>(null);

  // Form state — config
  const [cfStrategy, setCfStrategy] = useState("priority");
  const [cfEnabled, setCfEnabled] = useState(true);
  const [cfFallback, setCfFallback] = useState(true);
  const [cfTimeout, setCfTimeout] = useState(30000);
  const [cfThreshold, setCfThreshold] = useState(80);
  const [cfDescription, setCfDescription] = useState("");

  // Form state — rule
  const [rfProviderKey, setRfProviderKey] = useState("cashfree_payin");
  const [rfPriority, setRfPriority] = useState(1);
  const [rfWeight, setRfWeight] = useState(100);
  const [rfMinAmount, setRfMinAmount] = useState("");
  const [rfMaxAmount, setRfMaxAmount] = useState("");
  const [rfModes, setRfModes] = useState<string[]>([]);
  const [rfEnabled, setRfEnabled] = useState(true);
  const [rfNotes, setRfNotes] = useState("");

  // Queries
  const statusQ = useQuery<StatusData>({
    queryKey: ["smart-routing-status"],
    queryFn: () => apiReq("/status"),
    refetchInterval: 30000,
  });

  const configsQ = useQuery<RoutingConfig[]>({
    queryKey: ["smart-routing-configs"],
    queryFn: () => apiReq("/configs"),
  });

  const rulesQ = useQuery<RoutingRule[]>({
    queryKey: ["smart-routing-rules", selectedConfigId],
    queryFn: () => apiReq(`/configs/${selectedConfigId}/rules`),
    enabled: selectedConfigId != null,
  });

  const metricsQ = useQuery<ProviderMetric[]>({
    queryKey: ["smart-routing-metrics", metricsWindow],
    queryFn: () => apiReq(`/metrics?window=${metricsWindow}`),
    refetchInterval: 60000,
  });

  const logsQ = useQuery<{ total: number; logs: RoutingLog[] }>({
    queryKey: ["smart-routing-logs", logsPage],
    queryFn: () => apiReq(`/logs?page=${logsPage}&limit=50`),
    refetchInterval: 30000,
  });

  // Mutations
  const updateConfigM = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) => apiReq(`/configs/${id}`, "PUT", data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["smart-routing-configs"] }); qc.invalidateQueries({ queryKey: ["smart-routing-status"] }); setEditConfigOpen(false); toast.success("Routing config updated"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveRuleM = useMutation({
    mutationFn: (data: Record<string, unknown>) => editingRule
      ? apiReq(`/rules/${editingRule.id}`, "PUT", data)
      : apiReq(`/configs/${selectedConfigId}/rules`, "POST", data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["smart-routing-rules", selectedConfigId] }); setRuleDialogOpen(false); toast.success(editingRule ? "Rule updated" : "Rule added"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteRuleM = useMutation({
    mutationFn: (id: number) => apiReq(`/rules/${id}`, "DELETE"),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["smart-routing-rules", selectedConfigId] }); setDeleteRuleId(null); toast.success("Rule deleted"); },
    onError: (e: Error) => toast.error(e.message),
  });

  // Open edit config dialog
  function openEditConfig(cfg: RoutingConfig) {
    setEditingConfig(cfg);
    setCfStrategy(cfg.strategy);
    setCfEnabled(cfg.isEnabled);
    setCfFallback(cfg.fallbackEnabled);
    setCfTimeout(cfg.timeoutMs);
    setCfThreshold(Number(cfg.minSuccessRateThreshold ?? 80));
    setCfDescription(cfg.description ?? "");
    setEditConfigOpen(true);
  }

  function submitEditConfig() {
    if (!editingConfig) return;
    updateConfigM.mutate({ id: editingConfig.id, data: { strategy: cfStrategy, isEnabled: cfEnabled, fallbackEnabled: cfFallback, timeoutMs: cfTimeout, minSuccessRateThreshold: cfThreshold, description: cfDescription } });
  }

  function openAddRule() {
    setEditingRule(null);
    setRfProviderKey("cashfree_payin");
    setRfPriority(1); setRfWeight(100); setRfMinAmount(""); setRfMaxAmount(""); setRfModes([]); setRfEnabled(true); setRfNotes("");
    setRuleDialogOpen(true);
  }

  function openEditRule(rule: RoutingRule) {
    setEditingRule(rule);
    setRfProviderKey(rule.providerKey);
    setRfPriority(rule.priority); setRfWeight(rule.weightPercent);
    setRfMinAmount(rule.minAmount ?? ""); setRfMaxAmount(rule.maxAmount ?? "");
    setRfModes(rule.allowedPaymentModes ? JSON.parse(rule.allowedPaymentModes) : []);
    setRfEnabled(rule.isEnabled); setRfNotes(rule.notes ?? "");
    setRuleDialogOpen(true);
  }

  function submitRule() {
    saveRuleM.mutate({
      providerKey: rfProviderKey, priority: rfPriority, weightPercent: rfWeight,
      minAmount: rfMinAmount ? Number(rfMinAmount) : null,
      maxAmount: rfMaxAmount ? Number(rfMaxAmount) : null,
      allowedPaymentModes: rfModes, isEnabled: rfEnabled, notes: rfNotes,
    });
  }

  const status = statusQ.data;
  const configs = configsQ.data ?? [];
  const activeConfig = configs[0] ?? null;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <GitMerge className="w-6 h-6 text-violet-400" />
              Smart Routing
            </h1>
            <p className="text-zinc-400 text-sm mt-1">
              Automatic failover & provider selection — merchants never see provider names
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => { qc.invalidateQueries({ queryKey: ["smart-routing-status"] }); qc.invalidateQueries({ queryKey: ["smart-routing-metrics", metricsWindow] }); }} className="border-zinc-700 text-zinc-300 hover:text-white">
            <RefreshCw className="w-4 h-4 mr-1" /> Refresh
          </Button>
        </div>

        {/* Status Cards */}
        {status && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="bg-zinc-900 border-zinc-800">
              <CardContent className="pt-4">
                <p className="text-xs text-zinc-500 uppercase tracking-wide">Status</p>
                <div className="mt-1">{status.isEnabled ? <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">Active</Badge> : <Badge className="bg-zinc-700 text-zinc-400">Disabled</Badge>}</div>
                <p className="text-xs text-zinc-600 mt-1">{STRATEGY_LABELS[status.strategy ?? ""] ?? status.strategy}</p>
              </CardContent>
            </Card>
            <Card className="bg-zinc-900 border-zinc-800">
              <CardContent className="pt-4">
                <p className="text-xs text-zinc-500 uppercase tracking-wide">Providers</p>
                <p className="text-2xl font-bold text-white mt-1">{status.providerCount}</p>
                <p className="text-xs text-zinc-600">enabled rules</p>
              </CardContent>
            </Card>
            <Card className="bg-zinc-900 border-zinc-800">
              <CardContent className="pt-4">
                <p className="text-xs text-zinc-500 uppercase tracking-wide">Fallback</p>
                <div className="mt-1">{status.fallbackEnabled ? <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">Enabled</Badge> : <Badge className="bg-zinc-700 text-zinc-400">Disabled</Badge>}</div>
                <p className="text-xs text-zinc-600 mt-1">auto-retry on failure</p>
              </CardContent>
            </Card>
            <Card className="bg-zinc-900 border-zinc-800">
              <CardContent className="pt-4">
                <p className="text-xs text-zinc-500 uppercase tracking-wide">Recent (24h)</p>
                <p className="text-2xl font-bold text-emerald-400 mt-1">{status.recentActivity.successCount24h}</p>
                <p className="text-xs text-zinc-600">{status.recentActivity.failedCount24h} failed/timeout</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Tabs */}
        <Tabs defaultValue="config" className="space-y-4">
          <TabsList className="bg-zinc-900 border border-zinc-800">
            <TabsTrigger value="config" className="data-[state=active]:bg-zinc-800 data-[state=active]:text-white text-zinc-400">
              <Settings2 className="w-4 h-4 mr-1.5" /> Routing Strategy
            </TabsTrigger>
            <TabsTrigger value="rules" className="data-[state=active]:bg-zinc-800 data-[state=active]:text-white text-zinc-400" onClick={() => { if (!selectedConfigId && activeConfig) setSelectedConfigId(activeConfig.id); }}>
              <ArrowUpDown className="w-4 h-4 mr-1.5" /> Provider Rules
            </TabsTrigger>
            <TabsTrigger value="metrics" className="data-[state=active]:bg-zinc-800 data-[state=active]:text-white text-zinc-400">
              <BarChart2 className="w-4 h-4 mr-1.5" /> Success Metrics
            </TabsTrigger>
            <TabsTrigger value="logs" className="data-[state=active]:bg-zinc-800 data-[state=active]:text-white text-zinc-400">
              <ScrollText className="w-4 h-4 mr-1.5" /> Routing Logs
            </TabsTrigger>
          </TabsList>

          {/* ── Tab 1: Routing Strategy ── */}
          <TabsContent value="config">
            {configsQ.isLoading ? (
              <div className="text-zinc-500 text-center py-8">Loading...</div>
            ) : configs.length === 0 ? (
              <Card className="bg-zinc-900 border-zinc-800"><CardContent className="py-8 text-center text-zinc-500">No routing configs found.</CardContent></Card>
            ) : (
              <div className="space-y-4">
                {configs.map(cfg => (
                  <Card key={cfg.id} className="bg-zinc-900 border-zinc-800">
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle className="text-white text-base">{cfg.configName}</CardTitle>
                          {cfg.description && <CardDescription className="text-zinc-500 mt-0.5">{cfg.description}</CardDescription>}
                        </div>
                        <div className="flex items-center gap-2">
                          {cfg.isEnabled ? <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">Active</Badge> : <Badge className="bg-zinc-700 text-zinc-400">Inactive</Badge>}
                          <Button variant="outline" size="sm" onClick={() => openEditConfig(cfg)} className="border-zinc-700 text-zinc-300 hover:text-white">
                            <Pencil className="w-3.5 h-3.5 mr-1" /> Edit
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div>
                          <p className="text-xs text-zinc-500 mb-1">Strategy</p>
                          <Badge variant="outline" className="text-violet-400 border-violet-500/30 bg-violet-500/10">
                            {STRATEGY_LABELS[cfg.strategy] ?? cfg.strategy}
                          </Badge>
                        </div>
                        <div>
                          <p className="text-xs text-zinc-500 mb-1">Fallback</p>
                          <p className="text-sm text-white">{cfg.fallbackEnabled ? "Enabled" : "Disabled"}</p>
                        </div>
                        <div>
                          <p className="text-xs text-zinc-500 mb-1">Timeout</p>
                          <p className="text-sm text-white">{cfg.timeoutMs / 1000}s</p>
                        </div>
                        <div>
                          <p className="text-xs text-zinc-500 mb-1">Min. Success Rate</p>
                          <p className="text-sm text-white">{cfg.minSuccessRateThreshold ?? "80"}%</p>
                        </div>
                      </div>
                      {cfg.updatedByEmail && (
                        <p className="text-xs text-zinc-600 mt-3">Last updated by {cfg.updatedByEmail}</p>
                      )}
                    </CardContent>
                  </Card>
                ))}

                {/* Strategy guide */}
                <Card className="bg-zinc-900/50 border-zinc-800/50">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-zinc-300 text-sm">Strategy Reference</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                      {[
                        { key: "priority", icon: <ArrowUpDown className="w-4 h-4 text-violet-400" />, desc: "Tries providers in priority order (1 = first). If provider 1 fails, falls back to provider 2, 3, etc." },
                        { key: "percentage", icon: <BarChart2 className="w-4 h-4 text-blue-400" />, desc: "Splits traffic by weight%. E.g. 70% to provider A, 30% to provider B. Falls back if selected provider fails." },
                        { key: "success_rate", icon: <Activity className="w-4 h-4 text-emerald-400" />, desc: "Routes to the provider with the highest recent success rate. Providers below the threshold are deprioritized." },
                        { key: "round_robin", icon: <RefreshCw className="w-4 h-4 text-amber-400" />, desc: "Cycles evenly across enabled providers, one by one. Falls back if the selected provider fails." },
                      ].map(s => (
                        <div key={s.key} className="flex gap-2 p-3 rounded-lg bg-zinc-800/50 border border-zinc-700/50">
                          <div className="mt-0.5">{s.icon}</div>
                          <div>
                            <p className="text-white font-medium text-xs">{STRATEGY_LABELS[s.key]}</p>
                            <p className="text-zinc-500 text-xs mt-0.5">{s.desc}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </TabsContent>

          {/* ── Tab 2: Provider Rules ── */}
          <TabsContent value="rules">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Label className="text-zinc-400 text-sm">Config:</Label>
                  <Select
                    value={selectedConfigId?.toString() ?? ""}
                    onValueChange={v => setSelectedConfigId(parseInt(v))}
                  >
                    <SelectTrigger className="w-48 bg-zinc-900 border-zinc-700 text-white">
                      <SelectValue placeholder="Select config" />
                    </SelectTrigger>
                    <SelectContent className="bg-zinc-900 border-zinc-700">
                      {configs.map(c => <SelectItem key={c.id} value={c.id.toString()}>{c.configName}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {selectedConfigId && (
                  <Button size="sm" onClick={openAddRule} className="bg-violet-600 hover:bg-violet-500 text-white">
                    <Plus className="w-4 h-4 mr-1" /> Add Rule
                  </Button>
                )}
              </div>

              {!selectedConfigId ? (
                <Card className="bg-zinc-900 border-zinc-800"><CardContent className="py-8 text-center text-zinc-500">Select a routing config to view its rules.</CardContent></Card>
              ) : rulesQ.isLoading ? (
                <Card className="bg-zinc-900 border-zinc-800"><CardContent className="py-8 text-center text-zinc-500">Loading...</CardContent></Card>
              ) : (rulesQ.data ?? []).length === 0 ? (
                <Card className="bg-zinc-900 border-zinc-800"><CardContent className="py-8 text-center text-zinc-500">No rules configured. Add a provider rule to start routing.</CardContent></Card>
              ) : (
                <Card className="bg-zinc-900 border-zinc-800">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-zinc-800 hover:bg-transparent">
                        <TableHead className="text-zinc-400">Priority</TableHead>
                        <TableHead className="text-zinc-400">Provider Key</TableHead>
                        <TableHead className="text-zinc-400">Weight</TableHead>
                        <TableHead className="text-zinc-400">Amount Range</TableHead>
                        <TableHead className="text-zinc-400">Payment Modes</TableHead>
                        <TableHead className="text-zinc-400">Status</TableHead>
                        <TableHead className="text-zinc-400 text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(rulesQ.data ?? []).map(rule => {
                        let modes: string[] = [];
                        try { modes = rule.allowedPaymentModes ? JSON.parse(rule.allowedPaymentModes) : []; } catch { /* ignore */ }
                        return (
                          <TableRow key={rule.id} className="border-zinc-800 hover:bg-zinc-800/50">
                            <TableCell>
                              <Badge variant="outline" className="text-violet-400 border-violet-500/30 font-mono">
                                #{rule.priority}
                              </Badge>
                            </TableCell>
                            <TableCell className="font-mono text-sm text-zinc-300">{rule.providerKey}</TableCell>
                            <TableCell className="text-zinc-300">{rule.weightPercent}%</TableCell>
                            <TableCell className="text-zinc-400 text-sm">
                              {rule.minAmount || rule.maxAmount
                                ? `₹${rule.minAmount ?? "0"} – ${rule.maxAmount ? `₹${rule.maxAmount}` : "∞"}`
                                : <span className="text-zinc-600">All amounts</span>}
                            </TableCell>
                            <TableCell>
                              {modes.length === 0
                                ? <span className="text-zinc-600 text-sm">All modes</span>
                                : <div className="flex flex-wrap gap-1">{modes.map(m => <Badge key={m} variant="outline" className="text-xs text-zinc-400 border-zinc-700">{m}</Badge>)}</div>}
                            </TableCell>
                            <TableCell>
                              {rule.isEnabled
                                ? <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">Enabled</Badge>
                                : <Badge className="bg-zinc-700 text-zinc-400">Disabled</Badge>}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1">
                                <Button variant="ghost" size="sm" onClick={() => openEditRule(rule)} className="text-zinc-400 hover:text-white h-7 px-2">
                                  <Pencil className="w-3.5 h-3.5" />
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => setDeleteRuleId(rule.id)} className="text-red-400 hover:text-red-300 h-7 px-2">
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </Card>
              )}

              {/* Failover info */}
              <Card className="bg-zinc-900/50 border-zinc-800/50">
                <CardContent className="py-3 flex items-start gap-3">
                  <ShieldCheck className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                  <p className="text-xs text-zinc-400">
                    <span className="text-white font-medium">Failover rules:</span> When a provider returns an error, times out, or is disabled, RasoKart automatically tries the next eligible provider. Merchants only ever see public reference IDs — the underlying provider is never revealed.
                  </p>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ── Tab 3: Success Metrics ── */}
          <TabsContent value="metrics">
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Label className="text-zinc-400 text-sm">Time Window:</Label>
                {["1h", "24h", "7d"].map(w => (
                  <Button key={w} variant={metricsWindow === w ? "default" : "outline"} size="sm"
                    onClick={() => setMetricsWindow(w)}
                    className={metricsWindow === w ? "bg-violet-600 hover:bg-violet-500 text-white" : "border-zinc-700 text-zinc-400 hover:text-white"}>
                    {w}
                  </Button>
                ))}
              </div>

              {metricsQ.isLoading ? (
                <Card className="bg-zinc-900 border-zinc-800"><CardContent className="py-8 text-center text-zinc-500">Loading metrics...</CardContent></Card>
              ) : (metricsQ.data ?? []).length === 0 ? (
                <Card className="bg-zinc-900 border-zinc-800"><CardContent className="py-8 text-center text-zinc-500">No metrics yet. Metrics are updated when payments are routed.</CardContent></Card>
              ) : (
                <Card className="bg-zinc-900 border-zinc-800">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-zinc-800 hover:bg-transparent">
                        <TableHead className="text-zinc-400">Provider Key</TableHead>
                        <TableHead className="text-zinc-400">Success Rate</TableHead>
                        <TableHead className="text-zinc-400">Attempts</TableHead>
                        <TableHead className="text-zinc-400">Success</TableHead>
                        <TableHead className="text-zinc-400">Failed</TableHead>
                        <TableHead className="text-zinc-400">Timeout</TableHead>
                        <TableHead className="text-zinc-400">Avg. Response</TableHead>
                        <TableHead className="text-zinc-400">Health</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(metricsQ.data ?? []).map(m => {
                        const rate = m.successRate ?? 0;
                        const health = rate >= 95 ? "Excellent" : rate >= 80 ? "Good" : rate >= 60 ? "Degraded" : "Critical";
                        const healthClass = rate >= 95 ? "text-emerald-400" : rate >= 80 ? "text-blue-400" : rate >= 60 ? "text-amber-400" : "text-red-400";
                        return (
                          <TableRow key={m.id} className="border-zinc-800 hover:bg-zinc-800/50">
                            <TableCell className="font-mono text-sm text-zinc-300">{m.providerKey}</TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <div className="w-20 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                                  <div className={`h-full rounded-full ${rate >= 95 ? "bg-emerald-500" : rate >= 80 ? "bg-blue-500" : rate >= 60 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${rate}%` }} />
                                </div>
                                <span className="text-white font-mono text-sm">{rate.toFixed(1)}%</span>
                              </div>
                            </TableCell>
                            <TableCell className="text-zinc-300">{m.totalAttempts.toLocaleString()}</TableCell>
                            <TableCell className="text-emerald-400">{m.successCount.toLocaleString()}</TableCell>
                            <TableCell className="text-red-400">{m.failedCount.toLocaleString()}</TableCell>
                            <TableCell className="text-amber-400">{m.timeoutCount.toLocaleString()}</TableCell>
                            <TableCell className="text-zinc-300">{m.avgResponseMs != null ? `${m.avgResponseMs}ms` : "—"}</TableCell>
                            <TableCell className={`font-medium text-sm ${healthClass}`}>{health}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </Card>
              )}

              <Card className="bg-zinc-900/50 border-zinc-800/50">
                <CardContent className="py-3 flex items-start gap-3">
                  <Activity className="w-4 h-4 text-violet-400 mt-0.5 shrink-0" />
                  <p className="text-xs text-zinc-400">
                    <span className="text-white font-medium">Success Rate Based routing</span> uses these metrics to select the best provider. Providers below the configured threshold (default 80%) are deprioritized but remain as fallback. Metrics update on every routed payment attempt.
                  </p>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ── Tab 4: Routing Logs ── */}
          <TabsContent value="logs">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-zinc-400">
                  Admin-only view — provider keys are visible here and never exposed to merchants.
                </p>
                <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ["smart-routing-logs", logsPage] })} className="border-zinc-700 text-zinc-400 hover:text-white">
                  <RefreshCw className="w-4 h-4 mr-1" /> Refresh
                </Button>
              </div>

              {logsQ.isLoading ? (
                <Card className="bg-zinc-900 border-zinc-800"><CardContent className="py-8 text-center text-zinc-500">Loading...</CardContent></Card>
              ) : (logsQ.data?.logs ?? []).length === 0 ? (
                <Card className="bg-zinc-900 border-zinc-800"><CardContent className="py-8 text-center text-zinc-500">No routing logs yet. Logs appear here when payments are routed.</CardContent></Card>
              ) : (
                <Card className="bg-zinc-900 border-zinc-800">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-zinc-800 hover:bg-transparent">
                        <TableHead className="text-zinc-400">Time</TableHead>
                        <TableHead className="text-zinc-400">Merchant</TableHead>
                        <TableHead className="text-zinc-400">Provider Key</TableHead>
                        <TableHead className="text-zinc-400">Strategy</TableHead>
                        <TableHead className="text-zinc-400">Attempt</TableHead>
                        <TableHead className="text-zinc-400">Amount</TableHead>
                        <TableHead className="text-zinc-400">Mode</TableHead>
                        <TableHead className="text-zinc-400">Result</TableHead>
                        <TableHead className="text-zinc-400">Response</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(logsQ.data?.logs ?? []).map(log => (
                        <TableRow key={log.id} className="border-zinc-800 hover:bg-zinc-800/50">
                          <TableCell className="text-zinc-400 text-xs whitespace-nowrap">
                            {new Date(log.createdAt).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}
                          </TableCell>
                          <TableCell className="text-zinc-300 text-sm">#{log.merchantId}</TableCell>
                          <TableCell className="font-mono text-xs text-violet-300">{log.providerKey}</TableCell>
                          <TableCell className="text-zinc-400 text-xs">{log.strategyUsed ?? "—"}</TableCell>
                          <TableCell className="text-center">
                            {log.attemptNumber > 1 ? (
                              <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-xs">#{log.attemptNumber}</Badge>
                            ) : (
                              <span className="text-zinc-500 text-xs">1st</span>
                            )}
                          </TableCell>
                          <TableCell className="text-zinc-300 text-sm">
                            {log.amount != null ? `₹${Number(log.amount).toLocaleString("en-IN")}` : "—"}
                          </TableCell>
                          <TableCell className="text-zinc-400 text-sm">{log.paymentMode ?? "—"}</TableCell>
                          <TableCell>{resultBadge(log.result)}</TableCell>
                          <TableCell className="text-zinc-400 text-sm">
                            {log.responseTimeMs != null ? `${log.responseTimeMs}ms` : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {/* Pagination */}
                  {(logsQ.data?.total ?? 0) > 50 && (
                    <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-800">
                      <p className="text-xs text-zinc-500">Showing {((logsPage - 1) * 50) + 1}–{Math.min(logsPage * 50, logsQ.data!.total)} of {logsQ.data!.total}</p>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" disabled={logsPage === 1} onClick={() => setLogsPage(p => p - 1)} className="border-zinc-700 text-zinc-400">Prev</Button>
                        <Button variant="outline" size="sm" disabled={logsPage * 50 >= (logsQ.data?.total ?? 0)} onClick={() => setLogsPage(p => p + 1)} className="border-zinc-700 text-zinc-400">Next</Button>
                      </div>
                    </div>
                  )}
                </Card>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* ── Edit Config Dialog ── */}
      <Dialog open={editConfigOpen} onOpenChange={setEditConfigOpen}>
        <DialogContent className="bg-zinc-950 border-zinc-800 text-white max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Routing Config — {editingConfig?.configName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-5">
            <div>
              <Label className="text-zinc-400 text-sm mb-1.5 block">Strategy</Label>
              <Select value={cfStrategy} onValueChange={setCfStrategy}>
                <SelectTrigger className="bg-zinc-900 border-zinc-700 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-700">
                  <SelectItem value="priority">Priority (Ordered Failover)</SelectItem>
                  <SelectItem value="percentage">Percentage Split</SelectItem>
                  <SelectItem value="success_rate">Success Rate Based</SelectItem>
                  <SelectItem value="round_robin">Round Robin</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-zinc-600 mt-1">{STRATEGY_LABELS[cfStrategy]}</p>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label className="text-zinc-300 text-sm">Routing Enabled</Label>
                <p className="text-xs text-zinc-500">When disabled, all routing decisions are skipped</p>
              </div>
              <Switch checked={cfEnabled} onCheckedChange={setCfEnabled} />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label className="text-zinc-300 text-sm">Automatic Failover</Label>
                <p className="text-xs text-zinc-500">Retry with next provider on failure/timeout</p>
              </div>
              <Switch checked={cfFallback} onCheckedChange={setCfFallback} />
            </div>

            <div>
              <Label className="text-zinc-400 text-sm mb-1.5 block">Provider Timeout: {cfTimeout / 1000}s</Label>
              <Slider
                min={5000} max={120000} step={5000}
                value={[cfTimeout]}
                onValueChange={([v]) => setCfTimeout(v)}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-zinc-600 mt-1"><span>5s</span><span>120s</span></div>
            </div>

            <div>
              <Label className="text-zinc-400 text-sm mb-1.5 block">Min. Success Rate Threshold: {cfThreshold}%</Label>
              <Slider
                min={0} max={100} step={5}
                value={[cfThreshold]}
                onValueChange={([v]) => setCfThreshold(v)}
                className="w-full"
              />
              <p className="text-xs text-zinc-600 mt-1">Providers below this threshold are deprioritized in Success Rate strategy</p>
            </div>
          </div>
          <DialogFooter className="mt-2">
            <Button variant="ghost" onClick={() => setEditConfigOpen(false)} className="text-zinc-400">Cancel</Button>
            <Button onClick={submitEditConfig} disabled={updateConfigM.isPending} className="bg-violet-600 hover:bg-violet-500 text-white">
              {updateConfigM.isPending ? "Saving..." : "Save Config"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Add/Edit Rule Dialog ── */}
      <Dialog open={ruleDialogOpen} onOpenChange={setRuleDialogOpen}>
        <DialogContent className="bg-zinc-950 border-zinc-800 text-white max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingRule ? "Edit Routing Rule" : "Add Provider Rule"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-zinc-400 text-sm mb-1.5 block">Provider Key</Label>
              <Input
                value={rfProviderKey}
                onChange={e => setRfProviderKey(e.target.value)}
                placeholder="e.g. cashfree_payin"
                className="bg-zinc-900 border-zinc-700 text-white font-mono"
              />
              <p className="text-xs text-zinc-600 mt-1">Internal identifier — not shown to merchants</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-zinc-400 text-sm mb-1.5 block">Priority</Label>
                <Input type="number" min={1} value={rfPriority} onChange={e => setRfPriority(parseInt(e.target.value) || 1)} className="bg-zinc-900 border-zinc-700 text-white" />
                <p className="text-xs text-zinc-600 mt-1">1 = highest priority</p>
              </div>
              <div>
                <Label className="text-zinc-400 text-sm mb-1.5 block">Weight %</Label>
                <Input type="number" min={1} max={100} value={rfWeight} onChange={e => setRfWeight(parseInt(e.target.value) || 100)} className="bg-zinc-900 border-zinc-700 text-white" />
                <p className="text-xs text-zinc-600 mt-1">For percentage strategy</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-zinc-400 text-sm mb-1.5 block">Min Amount (₹)</Label>
                <Input type="number" value={rfMinAmount} onChange={e => setRfMinAmount(e.target.value)} placeholder="No minimum" className="bg-zinc-900 border-zinc-700 text-white" />
              </div>
              <div>
                <Label className="text-zinc-400 text-sm mb-1.5 block">Max Amount (₹)</Label>
                <Input type="number" value={rfMaxAmount} onChange={e => setRfMaxAmount(e.target.value)} placeholder="No maximum" className="bg-zinc-900 border-zinc-700 text-white" />
              </div>
            </div>

            <div>
              <Label className="text-zinc-400 text-sm mb-2 block">Allowed Payment Modes</Label>
              <div className="grid grid-cols-3 gap-2">
                {PAYMENT_MODES.map(mode => (
                  <div key={mode} className="flex items-center gap-2">
                    <Checkbox
                      id={`mode-${mode}`}
                      checked={rfModes.includes(mode)}
                      onCheckedChange={checked => setRfModes(prev => checked ? [...prev, mode] : prev.filter(m => m !== mode))}
                    />
                    <label htmlFor={`mode-${mode}`} className="text-sm text-zinc-300 cursor-pointer capitalize">{mode}</label>
                  </div>
                ))}
              </div>
              <p className="text-xs text-zinc-600 mt-1.5">Leave unchecked to allow all payment modes</p>
            </div>

            <div className="flex items-center justify-between">
              <Label className="text-zinc-300 text-sm">Rule Enabled</Label>
              <Switch checked={rfEnabled} onCheckedChange={setRfEnabled} />
            </div>
          </div>
          <DialogFooter className="mt-2">
            <Button variant="ghost" onClick={() => setRuleDialogOpen(false)} className="text-zinc-400">Cancel</Button>
            <Button onClick={submitRule} disabled={saveRuleM.isPending} className="bg-violet-600 hover:bg-violet-500 text-white">
              {saveRuleM.isPending ? "Saving..." : editingRule ? "Update Rule" : "Add Rule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirm ── */}
      <Dialog open={deleteRuleId != null} onOpenChange={o => { if (!o) setDeleteRuleId(null); }}>
        <DialogContent className="bg-zinc-950 border-zinc-800 text-white max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Routing Rule?</DialogTitle>
          </DialogHeader>
          <p className="text-zinc-400 text-sm">This rule will be permanently removed from the routing config.</p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteRuleId(null)} className="text-zinc-400">Cancel</Button>
            <Button variant="destructive" onClick={() => deleteRuleId && deleteRuleM.mutate(deleteRuleId)} disabled={deleteRuleM.isPending}>
              {deleteRuleM.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
