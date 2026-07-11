import { useState, useEffect, useMemo } from "react";
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
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import {
  GitMerge, Activity, BarChart2, ScrollText, Plus, Pencil, Trash2,
  RefreshCw, ArrowUpDown, CheckCircle2, XCircle, Clock, AlertTriangle,
  ShieldCheck, Zap, Settings2, ChevronsDown, Shield, FlaskConical, Loader2,
  Copy, Download, Info, CheckCircle,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Tooltip as UiTooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

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
  isFallbackOnly: boolean;
  maxRetries: number;
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

type FailoverEvent = {
  id: number;
  createdAt: string;
  failureCount: number;
  windowMinutes: number;
  triggerMerchantId: number | null;
  providersInvolved: string[];
  status: "resolved" | "ongoing";
  resolvedAt: string | null;
  durationSeconds: number | null;
};

type FailureTrendPoint = {
  day: string;
  providerKey: string;
  totalAttempts: number;
  failedAttempts: number;
  failureRate: number;
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

type CoverageGap = {
  paymentMode: string | null;
  uncoveredAmounts: number[];
  minUncovered: number;
  maxUncovered: number;
  description: string;
};

type CoverageCheckResult = {
  configName: string;
  hasGaps: boolean;
  gaps: CoverageGap[];
  testedAmountCount: number;
  testedModeCount: number;
  excludedRuleId: number | null;
};

type SimulateStep = {
  step: number;
  providerKey: string;
  priority: number;
  isFallbackOnly: boolean;
  maxRetries: number;
  weightPercent: number;
  role: "primary" | "fallback";
  notes: string | null;
};

type SimulateResult = {
  configName: string;
  strategy: string;
  amount: number;
  paymentMode: string | null;
  steps: SimulateStep[];
  totalProviders: number;
  isDeterministic: boolean;
  warning: string | null;
  wouldFail: boolean;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const STRATEGY_LABELS: Record<string, string> = {
  priority: "Priority (Ordered Failover)",
  percentage: "Percentage Split",
  success_rate: "Success Rate Based",
  round_robin: "Round Robin",
};

const PAYMENT_MODES = ["upi", "card", "netbanking", "wallet", "bnpl", "emi"];

function formatDuration(seconds: number): string {
  if (seconds >= 3600) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  if (seconds >= 60) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  return `${seconds}s`;
}

function resultBadge(result: string) {
  switch (result) {
    case "success": return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">Success</Badge>;
    case "failed": return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">Failed</Badge>;
    case "timeout": return <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30">Timeout</Badge>;
    case "disabled": return <Badge className="bg-zinc-500/20 text-zinc-400 border-zinc-500/30">Disabled</Badge>;
    case "skipped": return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">Skipped</Badge>;
    case "misconfigured": return <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30">Misconfigured</Badge>;
    case "chain_exhausted": return <Badge className="bg-rose-600/20 text-rose-400 border-rose-600/30">Chain Exhausted</Badge>;
    default: return <Badge variant="outline">{result}</Badge>;
  }
}

function buildSimulateReportText(result: SimulateResult) {
  const lines: string[] = [];
  lines.push("Smart Routing — Failover Simulation Report");
  lines.push(`Generated: ${new Date().toLocaleString()}`);
  lines.push("");
  lines.push(`Config: ${result.configName}`);
  lines.push(`Strategy: ${STRATEGY_LABELS[result.strategy] ?? result.strategy}`);
  lines.push(`Amount: ₹${result.amount.toLocaleString("en-IN")}`);
  lines.push(`Payment Mode: ${result.paymentMode ?? "Any"}`);
  lines.push(`Total Providers: ${result.totalProviders}`);
  if (result.warning) lines.push(`Warning: ${result.warning}`);
  lines.push("");
  if (result.steps.length === 0) {
    lines.push("No providers match — payment would fail immediately.");
  } else {
    lines.push("Failover Chain:");
    result.steps.forEach((step, idx) => {
      lines.push(
        `  ${idx + 1}. ${step.providerKey} — priority #${step.priority}${step.isFallbackOnly ? " (fallback only)" : ""}` +
        `${step.maxRetries > 1 ? `, up to ${step.maxRetries} attempts` : ""}` +
        `${result.strategy === "percentage" ? `, ${step.weightPercent}% weight` : ""}` +
        `${step.notes ? ` — ${step.notes}` : ""}`
      );
    });
    lines.push("  → No more providers — payment order fails");
  }
  return lines.join("\n");
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

// ── Client-side coverage check ────────────────────────────────────────────────

const COVERAGE_STANDARD_AMOUNTS = [1, 100, 500, 1000, 5000, 10000, 50000, 100000];
const COVERAGE_STANDARD_MODES = ["upi", "card", "netbanking", "wallet", "bnpl", "emi"];

/**
 * Compute coverage gaps for a proposed rule set (current rules + pending dialog changes).
 * Mirrors the logic in GET /api/smart-routing/configs/:id/coverage-check.
 *
 * Returns human-readable gap descriptions, or an empty array if coverage is complete.
 * Returns null if the rule list is empty / no primary rules exist (other warnings cover that).
 */
function computeCoverageGaps(rules: RoutingRule[]): string[] | null {
  const enabledRules = rules.filter(r => r.isEnabled);
  const primaryRules = enabledRules.filter(r => !r.isFallbackOnly);

  // If no primary rules remain in the proposed set, every payment would be rejected.
  // Return an explicit gap rather than null so the dialog warning fires for this case too
  // (e.g. admin disables the last primary rule, or disabling leaves only fallbacks).
  if (primaryRules.length === 0) {
    return ["All payments would be rejected — no primary (non-fallback) rules are active after this change"];
  }

  // Build amount checkpoints from rule boundaries + standard amounts
  const amountSet = new Set<number>(COVERAGE_STANDARD_AMOUNTS);
  for (const r of enabledRules) {
    if (r.minAmount != null) {
      const min = Number(r.minAmount);
      if (min > 1) amountSet.add(min - 1);
      amountSet.add(min);
      amountSet.add(min + 1);
    }
    if (r.maxAmount != null) {
      const max = Number(r.maxAmount);
      if (max > 1) amountSet.add(max - 1);
      amountSet.add(max);
      amountSet.add(max + 1);
    }
  }
  const testAmounts = Array.from(amountSet).filter(a => a > 0).sort((a, b) => a - b);
  const testModes: (string | null)[] = [null, ...COVERAGE_STANDARD_MODES];

  function isCoveredByPrimary(amount: number, mode: string | null): boolean {
    return primaryRules.some(r => {
      if (r.minAmount != null && amount < Number(r.minAmount)) return false;
      if (r.maxAmount != null && amount > Number(r.maxAmount)) return false;
      if (mode != null && r.allowedPaymentModes) {
        try {
          const modes = JSON.parse(r.allowedPaymentModes) as string[];
          if (modes.length > 0 && !modes.includes("all") && !modes.includes(mode)) return false;
        } catch { /* ignore */ }
      }
      return true;
    });
  }

  const gaps: string[] = [];
  const nullGapAmounts: Set<number> = new Set();

  for (const mode of testModes) {
    const uncovered = testAmounts.filter(a => !isCoveredByPrimary(a, mode));
    if (uncovered.length === 0) continue;

    // Track which amounts are uncovered for "any mode" to avoid redundant mode-specific messages
    if (mode === null) {
      for (const a of uncovered) nullGapAmounts.add(a);
    } else {
      // Only report mode-specific gap if it adds amounts beyond the null-mode gap
      const newAmounts = uncovered.filter(a => !nullGapAmounts.has(a));
      if (newAmounts.length === 0) continue;
    }

    const min = uncovered[0];
    const max = uncovered[uncovered.length - 1];
    const modeLabel = mode == null ? "any payment mode" : `${mode} payments`;

    let description: string;
    if (uncovered.length === testAmounts.length) {
      description = `No primary rule covers any amount for ${modeLabel}`;
    } else if (min === testAmounts[0]) {
      description = `Amounts up to ₹${max.toLocaleString("en-IN")} are not covered for ${modeLabel}`;
    } else if (max === testAmounts[testAmounts.length - 1]) {
      description = `Amounts from ₹${min.toLocaleString("en-IN")} and above are not covered for ${modeLabel}`;
    } else {
      description = `Amounts ₹${min.toLocaleString("en-IN")}–₹${max.toLocaleString("en-IN")} are not covered for ${modeLabel}`;
    }
    gaps.push(description);
  }

  return gaps;
}

// ── DeleteCoveragePreview ─────────────────────────────────────────────────────

/**
 * Fetches the coverage check with the to-be-deleted rule excluded and shows
 * an inline warning if the deletion would leave any amount ranges uncovered.
 * Mounted inside the delete-confirm dialog so it only fetches when the dialog opens.
 */
function DeleteCoveragePreview({
  configId,
  excludeRuleId,
}: {
  configId: number | null;
  excludeRuleId: number | null;
}) {
  const previewQ = useQuery<CoverageCheckResult>({
    queryKey: ["smart-routing-coverage-preview", configId, excludeRuleId],
    queryFn: () =>
      fetch(`/api/smart-routing/configs/${configId}/coverage-check?excludeRuleId=${excludeRuleId}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      }).then(async r => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? r.statusText);
        return d as CoverageCheckResult;
      }),
    enabled: configId != null && excludeRuleId != null,
    staleTime: 0,
  });

  if (previewQ.isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-zinc-500 py-1">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Checking coverage impact…
      </div>
    );
  }

  if (!previewQ.data) return null;

  if (!previewQ.data.hasGaps) {
    return (
      <div className="flex items-center gap-2 p-2.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
        Remaining rules still cover all tested amounts and payment modes — no coverage gap introduced.
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 p-2.5 rounded-md bg-orange-500/10 border border-orange-500/30">
      <AlertTriangle className="w-3.5 h-3.5 text-orange-400 mt-0.5 shrink-0" />
      <div>
        <p className="text-xs font-medium text-orange-300 mb-1">
          Deleting this rule will leave coverage gaps:
        </p>
        <ul className="space-y-0.5">
          {previewQ.data.gaps.map((gap, i) => (
            <li key={i} className="text-xs text-orange-200/80 flex items-start gap-1">
              <span className="text-orange-400 shrink-0 mt-0.5">•</span>
              {gap.description}
            </li>
          ))}
        </ul>
        <p className="text-xs text-orange-400/60 mt-1.5">Orders in these ranges will receive a 422 error until the gaps are filled.</p>
      </div>
    </div>
  );
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

  // Simulate
  const [simulateOpen, setSimulateOpen] = useState(false);
  const [simAmount, setSimAmount] = useState("");
  const [simMode, setSimMode] = useState("any");
  const [simConfigName, setSimConfigName] = useState<string>("");
  const [simLoading, setSimLoading] = useState(false);
  const [simResult, setSimResult] = useState<SimulateResult | null>(null);
  const [simError, setSimError] = useState<string | null>(null);

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
  const [rfFallbackOnly, setRfFallbackOnly] = useState(false);
  const [rfMaxRetries, setRfMaxRetries] = useState(1);
  const [rfNotes, setRfNotes] = useState("");

  // Form state — alert settings
  const [alertThreshold, setAlertThreshold] = useState<number>(5);
  const [alertWindowMinutes, setAlertWindowMinutes] = useState<number>(60);
  const [alertSettingsDirty, setAlertSettingsDirty] = useState(false);
  const [alertSettingsInitialized, setAlertSettingsInitialized] = useState(false);

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

  const failoverEventsQ = useQuery<{ events: FailoverEvent[] }>({
    queryKey: ["smart-routing-failover-events"],
    queryFn: () => apiReq(`/failover-events?limit=20`),
    refetchInterval: 30000,
  });

  const [trendDays, setTrendDays] = useState(7);
  const failureTrendQ = useQuery<{ days: number; trend: FailureTrendPoint[] }>({
    queryKey: ["smart-routing-failure-trend", trendDays],
    queryFn: () => apiReq(`/failure-trend?days=${trendDays}`),
    refetchInterval: 60000,
  });

  const alertSettingsQ = useQuery<{ threshold: number; windowMinutes: number }>({
    queryKey: ["smart-routing-alert-settings"],
    queryFn: () => apiReq("/alert-settings"),
  });

  const coverageCheckQ = useQuery<CoverageCheckResult>({
    queryKey: ["smart-routing-coverage", selectedConfigId],
    queryFn: () => apiReq(`/configs/${selectedConfigId}/coverage-check`),
    enabled: selectedConfigId != null,
    staleTime: 0,
  });

  // Admin-added custom gateways — offered as provider key suggestions alongside the built-ins.
  const integrationsQ = useQuery<{ providerKey: string; displayNamePublic: string; isEnabled: boolean }[]>({
    queryKey: ["smart-routing-integrations"],
    queryFn: async () => {
      const r = await fetch(`/api/provider-integrations/integrations`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!r.ok) return [];
      return r.json();
    },
  });
  const providerKeyOptions = [
    { providerKey: "cashfree_payin", displayNamePublic: "Cashfree (Payin)" },
    { providerKey: "cashfree_payout", displayNamePublic: "Cashfree (Payout)" },
    { providerKey: "ekqr", displayNamePublic: "EKQR" },
    ...((integrationsQ.data ?? []).filter(i => i.isEnabled).map(i => ({ providerKey: i.providerKey, displayNamePublic: i.displayNamePublic }))),
  ];

  // Sync alert settings state from server (only on first successful load)
  useEffect(() => {
    if (alertSettingsQ.data && !alertSettingsInitialized) {
      setAlertThreshold(alertSettingsQ.data.threshold);
      setAlertWindowMinutes(alertSettingsQ.data.windowMinutes);
      setAlertSettingsInitialized(true);
    }
  }, [alertSettingsQ.data, alertSettingsInitialized]);

  // Mutations
  const saveAlertSettingsM = useMutation({
    mutationFn: (data: { threshold: number; windowMinutes: number }) =>
      apiReq("/alert-settings", "PUT", data),
    onSuccess: (data: { threshold: number; windowMinutes: number }) => {
      qc.invalidateQueries({ queryKey: ["smart-routing-alert-settings"] });
      setAlertThreshold(data.threshold);
      setAlertWindowMinutes(data.windowMinutes);
      setAlertSettingsDirty(false);
      toast.success("Alert settings saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateConfigM = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) => apiReq(`/configs/${id}`, "PUT", data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["smart-routing-configs"] }); qc.invalidateQueries({ queryKey: ["smart-routing-status"] }); setEditConfigOpen(false); toast.success("Routing config updated"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveRuleM = useMutation({
    mutationFn: (data: Record<string, unknown>) => editingRule
      ? apiReq(`/rules/${editingRule.id}`, "PUT", data)
      : apiReq(`/configs/${selectedConfigId}/rules`, "POST", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["smart-routing-rules", selectedConfigId] });
      qc.invalidateQueries({ queryKey: ["smart-routing-coverage", selectedConfigId] });
      setRuleDialogOpen(false);
      toast.success(editingRule ? "Rule updated" : "Rule added");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteRuleM = useMutation({
    mutationFn: (id: number) => apiReq(`/rules/${id}`, "DELETE"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["smart-routing-rules", selectedConfigId] });
      qc.invalidateQueries({ queryKey: ["smart-routing-coverage", selectedConfigId] });
      setDeleteRuleId(null);
      toast.success("Rule deleted");
    },
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
    setRfPriority(1); setRfWeight(100); setRfMinAmount(""); setRfMaxAmount(""); setRfModes([]);
    setRfEnabled(true); setRfFallbackOnly(false); setRfMaxRetries(1); setRfNotes("");
    setRuleDialogOpen(true);
  }

  function openEditRule(rule: RoutingRule) {
    setEditingRule(rule);
    setRfProviderKey(rule.providerKey);
    setRfPriority(rule.priority); setRfWeight(rule.weightPercent);
    setRfMinAmount(rule.minAmount ?? ""); setRfMaxAmount(rule.maxAmount ?? "");
    setRfModes(rule.allowedPaymentModes ? JSON.parse(rule.allowedPaymentModes) : []);
    setRfEnabled(rule.isEnabled); setRfFallbackOnly(rule.isFallbackOnly ?? false);
    setRfMaxRetries(rule.maxRetries ?? 1); setRfNotes(rule.notes ?? "");
    setRuleDialogOpen(true);
  }

  function submitRule() {
    saveRuleM.mutate({
      providerKey: rfProviderKey, priority: rfPriority, weightPercent: rfWeight,
      minAmount: rfMinAmount ? Number(rfMinAmount) : null,
      maxAmount: rfMaxAmount ? Number(rfMaxAmount) : null,
      allowedPaymentModes: rfModes, isEnabled: rfEnabled,
      isFallbackOnly: rfFallbackOnly, maxRetries: rfMaxRetries, notes: rfNotes,
    });
  }

  const priorityConflictRule = rfEnabled
    ? (rulesQ.data ?? []).find(r =>
        r.isEnabled &&
        r.priority === rfPriority &&
        r.id !== editingRule?.id
      ) ?? null
    : null;

  const wouldLeaveNoPrimaryRule = rfEnabled && rfFallbackOnly
    ? (rulesQ.data ?? [])
        .filter(r => r.isEnabled && r.id !== editingRule?.id)
        .every(r => r.isFallbackOnly)
    : false;

  /**
   * Pre-save coverage check: build the proposed rule set (current rules + dialog changes)
   * and run the client-side gap check to warn before the admin clicks Save.
   */
  const dialogCoverageGaps = useMemo<string[] | null>(() => {
    if (!ruleDialogOpen || !rulesQ.data) return null;
    // Adding a brand-new rule that's already disabled can't create gaps (it's a no-op on coverage).
    // But disabling an *existing* enabled rule can expose gaps — always compute for edits.
    if (!rfEnabled && !editingRule) return null;
    if (wouldLeaveNoPrimaryRule) return null; // already warned by the dedicated banner

    const proposedRule: RoutingRule = {
      id: editingRule?.id ?? -1,
      configId: selectedConfigId ?? 0,
      providerKey: rfProviderKey,
      priority: rfPriority,
      weightPercent: rfWeight,
      minAmount: rfMinAmount !== "" ? rfMinAmount : null,
      maxAmount: rfMaxAmount !== "" ? rfMaxAmount : null,
      allowedPaymentModes: rfModes.length > 0 ? JSON.stringify(rfModes) : null,
      isEnabled: rfEnabled,
      isFallbackOnly: rfFallbackOnly,
      maxRetries: rfMaxRetries,
      notes: rfNotes,
      updatedAt: new Date().toISOString(),
    };

    const proposedRules: RoutingRule[] = editingRule
      ? rulesQ.data.map(r => (r.id === editingRule.id ? proposedRule : r))
      : [...rulesQ.data, proposedRule];

    return computeCoverageGaps(proposedRules);
  }, [
    ruleDialogOpen, rulesQ.data, rfEnabled, rfFallbackOnly, rfProviderKey, rfPriority,
    rfWeight, rfMinAmount, rfMaxAmount, rfModes, rfMaxRetries, rfNotes,
    editingRule, selectedConfigId, wouldLeaveNoPrimaryRule,
  ]);

  async function runSimulate() {
    const amount = parseFloat(simAmount);
    if (!isFinite(amount) || amount <= 0) {
      setSimError("Enter a valid positive amount.");
      return;
    }
    setSimLoading(true);
    setSimError(null);
    setSimResult(null);
    try {
      const params = new URLSearchParams({ amount: String(amount) });
      if (simMode && simMode !== "any") params.set("paymentMode", simMode);
      if (simConfigName) params.set("configName", simConfigName);
      const r = await fetch(`/api/smart-routing/simulate?${params}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? r.statusText);
      setSimResult(data as SimulateResult);
    } catch (e: unknown) {
      setSimError(e instanceof Error ? e.message : "Simulation failed");
    } finally {
      setSimLoading(false);
    }
  }

  async function copySimulateReport() {
    if (!simResult) return;
    try {
      await navigator.clipboard.writeText(buildSimulateReportText(simResult));
      toast.success("Report copied to clipboard");
    } catch {
      toast.error("Failed to copy report");
    }
  }

  function downloadSimulateReport() {
    if (!simResult) return;
    const text = buildSimulateReportText(simResult);
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    a.href = url;
    a.download = `failover-simulation-${simResult.configName}-${ts}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function openSimulate() {
    setSimAmount("");
    setSimMode("any");
    // Default to the currently viewed config (if enabled), else first enabled config
    const enabledConfigs = configs.filter(c => c.isEnabled);
    const viewedEnabled = selectedConfigId
      ? configs.find(c => c.id === selectedConfigId && c.isEnabled)
      : null;
    const defaultCfg = viewedEnabled?.configName ?? enabledConfigs[0]?.configName ?? "";
    setSimConfigName(defaultCfg);
    setSimResult(null);
    setSimError(null);
    setSimulateOpen(true);
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
            <TabsTrigger value="failover" className="data-[state=active]:bg-zinc-800 data-[state=active]:text-white text-zinc-400">
              <AlertTriangle className="w-4 h-4 mr-1.5" /> Failover Events
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

                {/* Failover Alert Settings */}
                <Card className="bg-zinc-900 border-zinc-800">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-white text-base flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-amber-400" />
                          Failover Alert Threshold
                        </CardTitle>
                        <CardDescription className="text-zinc-500 mt-0.5">
                          Admins receive a notification when routing failures exceed the threshold within the rolling window
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {alertSettingsQ.isLoading ? (
                      <div className="text-zinc-500 text-sm">Loading...</div>
                    ) : (
                      <>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label className="text-zinc-300 text-sm">Failure Count Threshold</Label>
                            <Input
                              type="number"
                              min={1}
                              max={10000}
                              value={alertThreshold}
                              onChange={e => { setAlertThreshold(parseInt(e.target.value) || 1); setAlertSettingsDirty(true); }}
                              className="bg-zinc-800 border-zinc-700 text-white w-full"
                            />
                            <p className="text-xs text-zinc-500">Number of routing failures in the window that trigger an alert</p>
                          </div>
                          <div className="space-y-2">
                            <Label className="text-zinc-300 text-sm">Rolling Window (minutes)</Label>
                            <Input
                              type="number"
                              min={1}
                              max={1440}
                              value={alertWindowMinutes}
                              onChange={e => { setAlertWindowMinutes(parseInt(e.target.value) || 1); setAlertSettingsDirty(true); }}
                              className="bg-zinc-800 border-zinc-700 text-white w-full"
                            />
                            <p className="text-xs text-zinc-500">Duration of the rolling failure-count window (max 1440 = 24 h)</p>
                          </div>
                        </div>
                        <div className="flex items-center justify-between pt-1">
                          <p className="text-xs text-zinc-500">
                            Current: alert if{" "}
                            <span className="text-white font-semibold">{alertThreshold}</span>{" "}
                            failures occur within{" "}
                            <span className="text-white font-semibold">
                              {alertWindowMinutes >= 60
                                ? `${alertWindowMinutes / 60}h`
                                : `${alertWindowMinutes}m`}
                            </span>
                          </p>
                          <Button
                            size="sm"
                            disabled={!alertSettingsDirty || saveAlertSettingsM.isPending}
                            onClick={() => saveAlertSettingsM.mutate({ threshold: alertThreshold, windowMinutes: alertWindowMinutes })}
                            className="bg-violet-600 hover:bg-violet-500 text-white"
                          >
                            {saveAlertSettingsM.isPending ? <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />Saving…</> : "Save"}
                          </Button>
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>

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
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={openSimulate} className="border-violet-500/50 text-violet-400 hover:text-violet-300 hover:border-violet-400">
                    <FlaskConical className="w-4 h-4 mr-1" /> Simulate
                  </Button>
                  {selectedConfigId && (
                    <Button size="sm" onClick={openAddRule} className="bg-violet-600 hover:bg-violet-500 text-white">
                      <Plus className="w-4 h-4 mr-1" /> Add Rule
                    </Button>
                  )}
                </div>
              </div>

              {!selectedConfigId ? (
                <Card className="bg-zinc-900 border-zinc-800"><CardContent className="py-8 text-center text-zinc-500">Select a routing config to view its rules.</CardContent></Card>
              ) : rulesQ.isLoading ? (
                <Card className="bg-zinc-900 border-zinc-800"><CardContent className="py-8 text-center text-zinc-500">Loading...</CardContent></Card>
              ) : (rulesQ.data ?? []).length === 0 ? (
                <Card className="bg-zinc-900 border-zinc-800"><CardContent className="py-8 text-center text-zinc-500">No rules configured. Add a provider rule to start routing.</CardContent></Card>
              ) : (
                <>
                {(() => {
                  const enabledRules = (rulesQ.data ?? []).filter(r => r.isEnabled);
                  const priorityCounts = enabledRules.reduce<Record<number, string[]>>((acc, r) => {
                    (acc[r.priority] ??= []).push(r.providerKey);
                    return acc;
                  }, {});
                  const clashes = Object.entries(priorityCounts).filter(([, keys]) => keys.length > 1);
                  const allFallback = enabledRules.length > 0 && enabledRules.every(r => r.isFallbackOnly);
                  return (
                    <>
                      {allFallback && (
                        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 mb-2">
                          <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                          <div>
                            <p className="text-sm font-medium text-red-300">No primary rules — routing will always fail</p>
                            <p className="text-xs text-red-200/70 mt-1">
                              Every enabled rule is marked <span className="font-semibold">Fallback Only</span>. The router suppresses fallback rules until a primary attempt has been made, so no provider will ever be tried and every payment order will be dropped immediately. Set at least one rule to <span className="font-semibold">Primary</span> role to restore routing.
                            </p>
                          </div>
                        </div>
                      )}
                      {clashes.length > 0 && (
                        <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 mb-2">
                          <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                          <div>
                            <p className="text-sm font-medium text-amber-300">Priority conflict detected</p>
                            <ul className="mt-1 space-y-0.5">
                              {clashes.map(([pri, keys]) => (
                                <li key={pri} className="text-xs text-amber-200/80">
                                  Priority <span className="font-mono font-semibold">#{pri}</span> is shared by: {keys.map(k => <span key={k} className="font-mono">{k}</span>).reduce((a, b) => <>{a}, {b}</>)}. The oldest rule wins silently — edit one to use a unique priority.
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      )}
                      {coverageCheckQ.data?.hasGaps && (
                        <div className="flex items-start gap-2 p-3 rounded-lg bg-orange-500/10 border border-orange-500/30 mb-2">
                          <AlertTriangle className="w-4 h-4 text-orange-400 mt-0.5 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-orange-300">Coverage gaps detected — some payments would be rejected</p>
                            <p className="text-xs text-orange-200/70 mt-0.5 mb-1.5">
                              The current rules leave the following amount ranges or payment modes without a primary provider. Orders in these ranges will receive a 422 error at order-create time.
                            </p>
                            <ul className="space-y-1">
                              {coverageCheckQ.data.gaps.map((gap, i) => (
                                <li key={i} className="text-xs text-orange-200/80 flex items-start gap-1.5">
                                  <span className="text-orange-400 mt-0.5 shrink-0">•</span>
                                  {gap.description}
                                </li>
                              ))}
                            </ul>
                            <p className="text-xs text-orange-400/60 mt-2">
                              Use the <span className="font-medium">Simulate</span> tool to test specific amounts and modes, or edit rules to extend coverage.
                            </p>
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
                <Card className="bg-zinc-900 border-zinc-800">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-zinc-800 hover:bg-transparent">
                        <TableHead className="text-zinc-400">Priority</TableHead>
                        <TableHead className="text-zinc-400">Provider Key</TableHead>
                        <TableHead className="text-zinc-400">Role</TableHead>
                        <TableHead className="text-zinc-400">Retries</TableHead>
                        <TableHead className="text-zinc-400">Weight</TableHead>
                        <TableHead className="text-zinc-400">Amount Range</TableHead>
                        <TableHead className="text-zinc-400">Status</TableHead>
                        <TableHead className="text-zinc-400 text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(rulesQ.data ?? []).map(rule => (
                        <TableRow key={rule.id} className="border-zinc-800 hover:bg-zinc-800/50">
                          <TableCell>
                            <Badge variant="outline" className="text-violet-400 border-violet-500/30 font-mono">
                              #{rule.priority}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-sm text-zinc-300">{rule.providerKey}</TableCell>
                          <TableCell>
                            {rule.isFallbackOnly
                              ? <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-xs"><Shield className="w-3 h-3 mr-1 inline" />Fallback Only</Badge>
                              : <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-xs">Primary</Badge>}
                          </TableCell>
                          <TableCell className="text-zinc-300 text-sm">
                            {(rule.maxRetries ?? 1) > 1
                              ? <span className="font-mono">{rule.maxRetries}×</span>
                              : <span className="text-zinc-600">1×</span>}
                          </TableCell>
                          <TableCell className="text-zinc-300">{rule.weightPercent}%</TableCell>
                          <TableCell className="text-zinc-400 text-sm">
                            {rule.minAmount || rule.maxAmount
                              ? `₹${rule.minAmount ?? "0"} – ${rule.maxAmount ? `₹${rule.maxAmount}` : "∞"}`
                              : <span className="text-zinc-600">All amounts</span>}
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
                      ))}
                    </TableBody>
                  </Table>
                </Card>

                {/* Failover chain visualisation */}
                {(() => {
                  const sortedEnabled = (rulesQ.data ?? [])
                    .filter(r => r.isEnabled)
                    .sort((a, b) => a.priority - b.priority);
                  if (sortedEnabled.length === 0) return null;
                  const allFallback = sortedEnabled.every(r => r.isFallbackOnly);
                  return (
                    <Card className={`border-zinc-800 ${allFallback ? "bg-red-950/20" : "bg-zinc-900"}`}>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-zinc-300 text-sm flex items-center gap-2">
                          <ChevronsDown className="w-4 h-4 text-violet-400" />
                          Failover Chain
                          {allFallback && (
                            <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-xs ml-1">
                              <AlertTriangle className="w-3 h-3 mr-1 inline" />Broken
                            </Badge>
                          )}
                        </CardTitle>
                        <CardDescription className={`text-xs ${allFallback ? "text-red-300/70" : "text-zinc-500"}`}>
                          {allFallback
                            ? "All rules are Fallback Only — no primary will ever be attempted, so no provider in this chain will be tried."
                            : "Order in which providers are tried on failure. Fallback-only providers are skipped until a primary attempt has been made."}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="pt-0">
                        <div className="space-y-1">
                          {sortedEnabled.map((rule, idx) => (
                            <div key={rule.id}>
                              <div className={`flex items-center gap-3 p-2.5 rounded-lg border ${allFallback ? "bg-red-500/5 border-red-500/20 opacity-60" : rule.isFallbackOnly ? "bg-amber-500/5 border-amber-500/20" : "bg-blue-500/5 border-blue-500/20"}`}>
                                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${allFallback ? "bg-red-500/20 text-red-400" : rule.isFallbackOnly ? "bg-amber-500/20 text-amber-400" : "bg-blue-500/20 text-blue-400"}`}>
                                  {idx + 1}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-mono text-sm text-white">{rule.providerKey}</span>
                                    {rule.isFallbackOnly && (
                                      <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-xs py-0"><Shield className="w-3 h-3 mr-1 inline" />Fallback Only</Badge>
                                    )}
                                    {(rule.maxRetries ?? 1) > 1 && (
                                      <Badge variant="outline" className="text-zinc-400 border-zinc-600 text-xs py-0">up to {rule.maxRetries} attempts</Badge>
                                    )}
                                  </div>
                                  <p className="text-xs text-zinc-500 mt-0.5">Priority #{rule.priority}{rule.isFallbackOnly ? " — only tried after a primary route fails" : ""}</p>
                                </div>
                                <div className="text-xs text-zinc-600">
                                  {idx < sortedEnabled.length - 1 ? "→ fails" : "→ order fails"}
                                </div>
                              </div>
                              {idx < sortedEnabled.length - 1 && (
                                <div className="flex items-center justify-center py-0.5">
                                  <div className="w-px h-3 bg-zinc-700" />
                                </div>
                              )}
                            </div>
                          ))}
                          {allFallback ? (
                            <div className="flex items-center gap-3 p-2.5 rounded-lg border border-dashed border-red-500/40 mt-1 bg-red-500/5">
                              <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 bg-red-500/20 text-red-400">
                                ✕
                              </div>
                              <p className="text-xs text-red-300/80">No primary attempt is ever made — all providers are skipped and every payment order fails immediately</p>
                            </div>
                          ) : (
                            <div className="flex items-center gap-3 p-2.5 rounded-lg border border-dashed border-zinc-700 mt-1">
                              <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 bg-zinc-800 text-zinc-500">
                                ✕
                              </div>
                              <p className="text-xs text-zinc-500">No more providers — payment order fails and merchant is notified</p>
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })()}
                </>
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

          {/* ── Tab: Failover Events ── */}
          <TabsContent value="failover">
            <div className="space-y-4">
              <p className="text-sm text-zinc-400">
                Chain-exhaustion events fire when all configured gateways fail repeatedly within a rolling window. Review recent outages and per-provider failure trends here.
              </p>

              {/* Recent chain-exhaustion events */}
              <Card className="bg-zinc-900 border-zinc-800">
                <CardHeader className="pb-3">
                  <CardTitle className="text-white text-sm flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-red-400" />
                    Recent Chain-Exhaustion Events
                  </CardTitle>
                  <CardDescription className="text-zinc-500 text-xs">
                    Fired when routing failures cross the alert threshold in a rolling window — all configured gateways failed and merchants may be unable to deposit.
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  {failoverEventsQ.isLoading ? (
                    <p className="text-center text-zinc-500 py-6 text-sm">Loading...</p>
                  ) : (failoverEventsQ.data?.events ?? []).length === 0 ? (
                    <p className="text-center text-zinc-500 py-6 text-sm">No failover events recorded — the gateway chain hasn't been fully exhausted.</p>
                  ) : (
                    <div className="space-y-2">
                      {(failoverEventsQ.data?.events ?? []).map(ev => (
                        <div
                          key={ev.id}
                          className={`flex items-start gap-3 p-3 rounded-lg border ${
                            ev.status === "resolved"
                              ? "bg-emerald-500/5 border-emerald-500/20"
                              : "bg-red-500/5 border-red-500/20"
                          }`}
                        >
                          {ev.status === "resolved"
                            ? <CheckCircle className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                            : <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                          }
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`text-sm font-medium ${ev.status === "resolved" ? "text-emerald-300" : "text-red-300"}`}>
                                {ev.failureCount} failures in {ev.windowMinutes}m
                              </span>
                              {ev.status === "resolved"
                                ? <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-xs">Resolved</Badge>
                                : <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-xs">Ongoing</Badge>
                              }
                              <span className="text-xs text-zinc-500">
                                Started: {new Date(ev.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                              </span>
                            </div>
                            <div className="flex items-center gap-3 mt-1 flex-wrap">
                              {ev.status === "resolved" && ev.resolvedAt != null && (
                                <span className="text-xs text-zinc-400">
                                  Recovered: <span className="text-zinc-300">{new Date(ev.resolvedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</span>
                                  {ev.durationSeconds != null && (
                                    <span className="text-zinc-500"> · outage lasted <span className="text-amber-300 font-medium">{formatDuration(ev.durationSeconds)}</span></span>
                                  )}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-zinc-400 mt-1">
                              Providers tried: {ev.providersInvolved.length > 0
                                ? ev.providersInvolved.map(p => <span key={p} className="font-mono text-zinc-300">{p}</span>).reduce((a, b) => <>{a}, {b}</>)
                                : <span className="text-zinc-600">unknown</span>}
                              {ev.triggerMerchantId != null && <span className="text-zinc-600"> · triggered by merchant #{ev.triggerMerchantId}</span>}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Rolling failure-rate chart per provider */}
              <Card className="bg-zinc-900 border-zinc-800">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-white text-sm flex items-center gap-2">
                        <Activity className="w-4 h-4 text-amber-400" />
                        Failure Rate Trend
                      </CardTitle>
                      <CardDescription className="text-zinc-500 text-xs mt-1">Daily failure rate (%) per provider, computed from routing logs.</CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      {[7, 14, 30].map(d => (
                        <Button key={d} variant={trendDays === d ? "default" : "outline"} size="sm"
                          onClick={() => setTrendDays(d)}
                          className={trendDays === d ? "bg-violet-600 hover:bg-violet-500 text-white" : "border-zinc-700 text-zinc-400 hover:text-white"}>
                          {d}d
                        </Button>
                      ))}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  {failureTrendQ.isLoading ? (
                    <p className="text-center text-zinc-500 py-6 text-sm">Loading trend...</p>
                  ) : (failureTrendQ.data?.trend ?? []).length === 0 ? (
                    <p className="text-center text-zinc-500 py-6 text-sm">No routing activity in this window yet.</p>
                  ) : (() => {
                    const trend = failureTrendQ.data?.trend ?? [];
                    const providerKeys = Array.from(new Set(trend.map(t => t.providerKey)));
                    const days = Array.from(new Set(trend.map(t => t.day))).sort();
                    const chartData = days.map(day => {
                      const point: Record<string, string | number> = { day };
                      for (const pk of providerKeys) {
                        const match = trend.find(t => t.day === day && t.providerKey === pk);
                        point[pk] = match?.failureRate ?? 0;
                      }
                      return point;
                    });
                    const colors = ["#f87171", "#fbbf24", "#60a5fa", "#a78bfa", "#34d399", "#f472b6"];
                    return (
                      <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={chartData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                            <XAxis dataKey="day" stroke="#71717a" fontSize={11} />
                            <YAxis stroke="#71717a" fontSize={11} unit="%" />
                            <Tooltip contentStyle={{ backgroundColor: "#18181b", border: "1px solid #3f3f46", borderRadius: 8, fontSize: 12 }} labelStyle={{ color: "#e4e4e7" }} />
                            <Legend wrapperStyle={{ fontSize: 12 }} />
                            {providerKeys.map((pk, i) => (
                              <Line key={pk} type="monotone" dataKey={pk} stroke={colors[i % colors.length]} strokeWidth={2} dot={{ r: 3 }} name={pk} />
                            ))}
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    );
                  })()}
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
                          <TableCell>
                            {log.errorMessage ? (
                              <TooltipProvider>
                                <UiTooltip>
                                  <TooltipTrigger asChild>
                                    <span className="cursor-help">{resultBadge(log.result)}</span>
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-xs bg-zinc-900 border-zinc-700 text-zinc-300 text-xs break-words">
                                    {log.errorMessage}
                                  </TooltipContent>
                                </UiTooltip>
                              </TooltipProvider>
                            ) : resultBadge(log.result)}
                          </TableCell>
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
                list="provider-key-options"
              />
              <datalist id="provider-key-options">
                {providerKeyOptions.map(p => <option key={p.providerKey} value={p.providerKey}>{p.displayNamePublic}</option>)}
              </datalist>
              <p className="text-xs text-zinc-600 mt-1">
                Internal identifier — not shown to merchants. Pick a built-in gateway or any admin-added custom gateway's provider key.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-zinc-400 text-sm mb-1.5 block">Priority</Label>
                <Input
                  type="number" min={1} value={rfPriority}
                  onChange={e => setRfPriority(parseInt(e.target.value) || 1)}
                  className={`bg-zinc-900 border-zinc-700 text-white ${priorityConflictRule ? "border-amber-500/60" : ""}`}
                />
                {priorityConflictRule ? (
                  <div className="flex items-start gap-1.5 mt-1.5 p-2 rounded-md bg-amber-500/10 border border-amber-500/30">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
                    <p className="text-xs text-amber-300">
                      Priority {rfPriority} is already used by <span className="font-mono font-medium">{priorityConflictRule.providerKey}</span>. Ties silently favour the oldest rule — your rule would be ignored. Choose a different number.
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-zinc-600 mt-1">1 = highest priority</p>
                )}
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

            <div>
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-zinc-300 text-sm">Fallback Only</Label>
                  <p className="text-xs text-zinc-500">Only tried after a primary provider has failed</p>
                </div>
                <Switch checked={rfFallbackOnly} onCheckedChange={setRfFallbackOnly} />
              </div>
              {wouldLeaveNoPrimaryRule ? (
                <div className="flex items-start gap-1.5 mt-1.5 p-2 rounded-md bg-red-500/10 border border-red-500/30">
                  <AlertTriangle className="w-3.5 h-3.5 text-red-400 mt-0.5 shrink-0" />
                  <p className="text-xs text-red-300">
                    This would leave zero primary rules enabled in this config — every payment order would fail immediately. Add or enable a primary rule first, then set this one to fallback-only.
                  </p>
                </div>
              ) : null}
            </div>

            <div>
              <Label className="text-zinc-400 text-sm mb-1.5 block">Max Retries: {rfMaxRetries}</Label>
              <Slider
                min={1} max={5} step={1}
                value={[rfMaxRetries]}
                onValueChange={([v]) => setRfMaxRetries(v)}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-zinc-600 mt-1"><span>1 (no retry)</span><span>5</span></div>
              <p className="text-xs text-zinc-600 mt-1">How many times to attempt this provider before moving to the next</p>
            </div>

            <div className="flex items-center justify-between">
              <Label className="text-zinc-300 text-sm">Rule Enabled</Label>
              <Switch checked={rfEnabled} onCheckedChange={setRfEnabled} />
            </div>

            {dialogCoverageGaps != null && dialogCoverageGaps.length > 0 && (
              <div className="flex items-start gap-2 p-2.5 rounded-md bg-orange-500/10 border border-orange-500/30">
                <AlertTriangle className="w-3.5 h-3.5 text-orange-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-medium text-orange-300 mb-1">
                    {editingRule ? "After this update, some payments would be rejected:" : "After adding this rule, some payments would still be rejected:"}
                  </p>
                  <ul className="space-y-0.5">
                    {dialogCoverageGaps.map((gap, i) => (
                      <li key={i} className="text-xs text-orange-200/80 flex items-start gap-1">
                        <span className="text-orange-400 shrink-0 mt-0.5">•</span>
                        {gap}
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-orange-400/60 mt-1.5">You can still save — add more rules to fill the gaps.</p>
                </div>
              </div>
            )}
          </div>
          <DialogFooter className="mt-2">
            <Button variant="ghost" onClick={() => setRuleDialogOpen(false)} className="text-zinc-400">Cancel</Button>
            <Button onClick={submitRule} disabled={saveRuleM.isPending || wouldLeaveNoPrimaryRule} className="bg-violet-600 hover:bg-violet-500 text-white">
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
          <DeleteCoveragePreview
            configId={selectedConfigId}
            excludeRuleId={deleteRuleId}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteRuleId(null)} className="text-zinc-400">Cancel</Button>
            <Button variant="destructive" onClick={() => deleteRuleId && deleteRuleM.mutate(deleteRuleId)} disabled={deleteRuleM.isPending}>
              {deleteRuleM.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Simulate Failover Chain Dialog ── */}
      <Dialog open={simulateOpen} onOpenChange={o => { if (!o) setSimulateOpen(false); }}>
        <DialogContent className="bg-zinc-950 border-zinc-800 text-white max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FlaskConical className="w-5 h-5 text-violet-400" />
              Simulate Failover Chain
            </DialogTitle>
          </DialogHeader>

          <p className="text-xs text-zinc-500 -mt-2 mb-1 flex items-center gap-1.5">
            Dry-run the routing engine for any amount and payment mode. No real payment is created, no routing log is written — the result shows exactly which providers would be attempted in order.
            <TooltipProvider>
              <UiTooltip>
                <TooltipTrigger asChild>
                  <Info className="w-3.5 h-3.5 text-zinc-500 hover:text-violet-400 shrink-0 cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-sm bg-zinc-900 border-zinc-700 text-zinc-200">
                  <p className="text-xs mb-1.5">
                    This same check is available via the API (see the "SmartRouting" section of the API reference) — use it in CI/CD to catch a routing config change that would leave zero providers for a payment mode:
                  </p>
                  <pre className="text-[10px] bg-zinc-950 border border-zinc-800 rounded p-2 overflow-x-auto whitespace-pre-wrap">
{`curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \\
  "$API_BASE/api/smart-routing/simulate?amount=1000&paymentMode=upi" \\
  | jq -e '.wouldFail == false'`}
                  </pre>
                </TooltipContent>
              </UiTooltip>
            </TooltipProvider>
          </p>

          {/* Inputs */}
          <div className="space-y-3">
            {/* Config selector */}
            {configs.length > 1 && (
              <div>
                <Label className="text-zinc-400 text-sm mb-1.5 block">Routing Config</Label>
                <Select value={simConfigName} onValueChange={setSimConfigName}>
                  <SelectTrigger className="bg-zinc-900 border-zinc-700 text-white">
                    <SelectValue placeholder="Select config" />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-900 border-zinc-700">
                    {configs.filter(c => c.isEnabled).map(c => (
                      <SelectItem key={c.id} value={c.configName}>{c.configName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-zinc-400 text-sm mb-1.5 block">Amount (₹)</Label>
                <Input
                  type="number"
                  min={1}
                  placeholder="e.g. 1000"
                  value={simAmount}
                  onChange={e => setSimAmount(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") runSimulate(); }}
                  className="bg-zinc-900 border-zinc-700 text-white"
                />
              </div>
              <div>
                <Label className="text-zinc-400 text-sm mb-1.5 block">Payment Mode</Label>
                <Select value={simMode} onValueChange={setSimMode}>
                  <SelectTrigger className="bg-zinc-900 border-zinc-700 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-900 border-zinc-700">
                    <SelectItem value="any">Any mode</SelectItem>
                    {PAYMENT_MODES.map(m => <SelectItem key={m} value={m} className="capitalize">{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {simError && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300">
              <XCircle className="w-4 h-4 shrink-0" />
              {simError}
            </div>
          )}

          {/* Results */}
          {simResult && (
            <div className="space-y-3 mt-1">
              {/* Summary bar */}
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-zinc-900 border border-zinc-800">
                <div className="flex items-center gap-3 text-xs text-zinc-400">
                  <span>Config: <span className="text-white font-mono">{simResult.configName}</span></span>
                  <span className="text-zinc-700">|</span>
                  <span>Strategy: <span className="text-violet-300">{STRATEGY_LABELS[simResult.strategy] ?? simResult.strategy}</span></span>
                  <span className="text-zinc-700">|</span>
                  <span>₹{simResult.amount.toLocaleString("en-IN")}</span>
                  {simResult.paymentMode && <><span className="text-zinc-700">|</span><span className="capitalize">{simResult.paymentMode}</span></>}
                </div>
                <Badge variant="outline" className="text-zinc-400 border-zinc-700 text-xs">
                  {simResult.totalProviders} provider{simResult.totalProviders !== 1 ? "s" : ""}
                </Badge>
              </div>

              {/* Warning */}
              {simResult.warning && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
                  <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                  <p className="text-xs text-amber-300">{simResult.warning}</p>
                </div>
              )}

              {/* Failover chain */}
              {simResult.steps.length === 0 ? (
                <div className="flex items-center gap-3 p-3 rounded-lg border border-dashed border-red-500/40 bg-red-500/5">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 bg-red-500/20 text-red-400">✕</div>
                  <p className="text-xs text-red-300/80">No providers match — payment would fail immediately</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {simResult.steps.map((step, idx) => (
                    <div key={step.step}>
                      <div className={`flex items-center gap-3 p-2.5 rounded-lg border ${step.isFallbackOnly ? "bg-amber-500/5 border-amber-500/20" : "bg-blue-500/5 border-blue-500/20"}`}>
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${step.isFallbackOnly ? "bg-amber-500/20 text-amber-400" : "bg-blue-500/20 text-blue-400"}`}>
                          {step.step}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-sm text-white">{step.providerKey}</span>
                            {step.isFallbackOnly && (
                              <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-xs py-0">
                                <Shield className="w-3 h-3 mr-1 inline" />Fallback Only
                              </Badge>
                            )}
                            {step.maxRetries > 1 && (
                              <Badge variant="outline" className="text-zinc-400 border-zinc-600 text-xs py-0">up to {step.maxRetries} attempts</Badge>
                            )}
                            {simResult.strategy === "percentage" && (
                              <Badge variant="outline" className="text-zinc-500 border-zinc-700 text-xs py-0">{step.weightPercent}% weight</Badge>
                            )}
                          </div>
                          <p className="text-xs text-zinc-500 mt-0.5">
                            Priority #{step.priority}{step.isFallbackOnly ? " — tried only after a primary attempt" : ""}
                            {step.notes ? <span className="text-zinc-600"> · {step.notes}</span> : null}
                          </p>
                        </div>
                        <div className="text-xs text-zinc-600 shrink-0">
                          {idx < simResult.steps.length - 1 ? "→ fails" : "→ order fails"}
                        </div>
                      </div>
                      {idx < simResult.steps.length - 1 && (
                        <div className="flex items-center justify-center py-0.5">
                          <div className="w-px h-3 bg-zinc-700" />
                        </div>
                      )}
                    </div>
                  ))}
                  <div className="flex items-center gap-3 p-2.5 rounded-lg border border-dashed border-zinc-700 mt-1">
                    <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 bg-zinc-800 text-zinc-500">✕</div>
                    <p className="text-xs text-zinc-500">No more providers — payment order fails</p>
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="mt-2 sm:justify-between">
            <div className="flex items-center gap-2">
              {simResult && (
                <>
                  <Button
                    variant="outline"
                    onClick={copySimulateReport}
                    className="border-zinc-700 text-zinc-300 hover:text-white"
                  >
                    <Copy className="w-4 h-4 mr-1.5" />Copy report
                  </Button>
                  <Button
                    variant="outline"
                    onClick={downloadSimulateReport}
                    className="border-zinc-700 text-zinc-300 hover:text-white"
                  >
                    <Download className="w-4 h-4 mr-1.5" />Download
                  </Button>
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={() => setSimulateOpen(false)} className="text-zinc-400">Close</Button>
              <Button
                onClick={runSimulate}
                disabled={simLoading || !simAmount}
                className="bg-violet-600 hover:bg-violet-500 text-white"
              >
                {simLoading ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Simulating…</> : <><FlaskConical className="w-4 h-4 mr-1.5" />Run Simulation</>}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
