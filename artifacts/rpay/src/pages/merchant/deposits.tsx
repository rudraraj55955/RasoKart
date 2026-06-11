import { useState, useRef, useEffect } from "react";
import {
  useListTransactions,
  useSimulatePayment,
  useListQrCodes,
  useListVirtualAccounts,
  useGetDashboardStats,
  useListMerchantConnections,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  ArrowDownLeft,
  Search,
  Clock,
  CheckCircle,
  CheckCircle2,
  XCircle,
  Plus,
  QrCode,
  Building2,
  TrendingUp,
  Hash,
  FileDown,
  Loader2,
  CalendarRange,
  Trash2,
  X,
} from "lucide-react";
import { format, subDays, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const DATE_PRESETS = [
  {
    label: "Last 7 days",
    getRange: () => {
      const to = new Date();
      const from = subDays(to, 6);
      return { from: format(from, "yyyy-MM-dd"), to: format(to, "yyyy-MM-dd") };
    },
  },
  {
    label: "Last 30 days",
    getRange: () => {
      const to = new Date();
      const from = subDays(to, 29);
      return { from: format(from, "yyyy-MM-dd"), to: format(to, "yyyy-MM-dd") };
    },
  },
  {
    label: "This month",
    getRange: () => {
      const now = new Date();
      return {
        from: format(startOfMonth(now), "yyyy-MM-dd"),
        to: format(endOfMonth(now), "yyyy-MM-dd"),
      };
    },
  },
  {
    label: "Last month",
    getRange: () => {
      const prev = subMonths(new Date(), 1);
      return {
        from: format(startOfMonth(prev), "yyyy-MM-dd"),
        to: format(endOfMonth(prev), "yyyy-MM-dd"),
      };
    },
  },
];

interface CustomDatePreset {
  id: string;
  name: string;
  from: string;
  to: string;
}

const CUSTOM_DATE_PRESETS_KEY = "rasokart_custom_date_presets_deposits";

function loadCustomDatePresets(): CustomDatePreset[] {
  try {
    const raw = localStorage.getItem(CUSTOM_DATE_PRESETS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as CustomDatePreset[];
  } catch {
    return [];
  }
}

function storeCustomDatePresets(presets: CustomDatePreset[]): void {
  localStorage.setItem(CUSTOM_DATE_PRESETS_KEY, JSON.stringify(presets));
}

function buildCsvText(data: any[]): string {
  const rows = [["ID", "Amount", "Currency", "UTR", "Reference", "Status", "Description", "Source", "Date"]];
  data.forEach(t => rows.push([
    String(t.id),
    String(t.amount),
    t.currency,
    t.utr,
    t.referenceId ?? "",
    t.status,
    t.description ?? "",
    t.metadata ? (() => { try { const m = JSON.parse(t.metadata); return `${m.sourceType?.toUpperCase() ?? ""} #${m.sourceId ?? ""}`; } catch { return ""; } })() : "",
    t.createdAt,
  ]));
  return rows.map(r => r.map(v => `"${v}"`).join(",")).join("\n");
}

export default function MerchantDeposits() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [provider, setProvider] = useState("all");
  const [exporting, setExporting] = useState(false);
  const [lastExportCount, setLastExportCount] = useState<number | null>(null);

  const [customDatePresets, setCustomDatePresets] = useState<CustomDatePreset[]>(() => loadCustomDatePresets());
  const [showSaveDatePreset, setShowSaveDatePreset] = useState(false);
  const [saveDatePresetName, setSaveDatePresetName] = useState("");
  const [saveDatePresetNameError, setSaveDatePresetNameError] = useState("");
  const saveDatePresetNameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showSaveDatePreset) {
      setTimeout(() => saveDatePresetNameRef.current?.focus(), 50);
    }
  }, [showSaveDatePreset]);

  const applyPreset = (preset: (typeof DATE_PRESETS)[number]) => {
    const { from, to } = preset.getRange();
    setDateFrom(from);
    setDateTo(to);
    setPage(1);
    setShowSaveDatePreset(false);
  };

  const isPresetActive = (preset: (typeof DATE_PRESETS)[number]) => {
    const { from, to } = preset.getRange();
    return dateFrom === from && dateTo === to;
  };

  const applyCustomDatePreset = (preset: CustomDatePreset) => {
    setDateFrom(preset.from);
    setDateTo(preset.to);
    setPage(1);
    setShowSaveDatePreset(false);
  };

  const isCustomDatePresetActive = (preset: CustomDatePreset) =>
    dateFrom === preset.from && dateTo === preset.to;

  const openSaveDatePreset = () => {
    setSaveDatePresetName("");
    setSaveDatePresetNameError("");
    setShowSaveDatePreset(true);
  };

  const confirmSaveDatePreset = () => {
    const trimmed = saveDatePresetName.trim();
    if (!trimmed) {
      setSaveDatePresetNameError("Please enter a name for this preset.");
      saveDatePresetNameRef.current?.focus();
      return;
    }
    const alreadyExists = customDatePresets.some(
      p => p.name.toLowerCase() === trimmed.toLowerCase()
    );
    if (alreadyExists) {
      setSaveDatePresetNameError("A preset with this name already exists.");
      saveDatePresetNameRef.current?.focus();
      return;
    }
    const newPreset: CustomDatePreset = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: trimmed,
      from: dateFrom,
      to: dateTo,
    };
    const updated = [...customDatePresets, newPreset];
    setCustomDatePresets(updated);
    storeCustomDatePresets(updated);
    setShowSaveDatePreset(false);
    setSaveDatePresetName("");
    setSaveDatePresetNameError("");
  };

  const cancelSaveDatePreset = () => {
    setShowSaveDatePreset(false);
    setSaveDatePresetName("");
    setSaveDatePresetNameError("");
  };

  const deleteCustomDatePreset = (id: string) => {
    const updated = customDatePresets.filter(p => p.id !== id);
    setCustomDatePresets(updated);
    storeCustomDatePresets(updated);
  };

  const isCustomDateRangeEntered = !!(dateFrom && dateTo);
  const isBuiltInPresetActive = DATE_PRESETS.some(p => {
    const { from, to } = p.getRange();
    return dateFrom === from && dateTo === to;
  });
  const isCustomDateAlreadySaved = customDatePresets.some(p => p.from === dateFrom && p.to === dateTo);
  const canSaveDatePreset = isCustomDateRangeEntered && !isBuiltInPresetActive && !isCustomDateAlreadySaved;

  // Simulate payment dialog state
  const [showSimulate, setShowSimulate] = useState(false);
  const [simSourceType, setSimSourceType] = useState<"qr" | "va">("qr");
  const [simSourceId, setSimSourceId] = useState("");
  const [simAmount, setSimAmount] = useState("");
  const [simUtr, setSimUtr] = useState("");
  const [simExpected, setSimExpected] = useState<"success" | "failed" | "pending">("success");
  const [simProvider, setSimProvider] = useState("");

  const { data, isLoading } = useListTransactions({
    type: "deposit",
    status: status === "all" ? undefined : (status as any),
    search: search || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    connectionProvider: provider !== "all" ? provider as import("@workspace/api-client-react").ListTransactionsConnectionProvider : undefined,
    page,
    limit: 20,
  });

  const { data: stats } = useGetDashboardStats();
  const { data: qrList } = useListQrCodes({ status: "active", limit: 100 });
  const { data: vaList } = useListVirtualAccounts({ status: "active", limit: 100 });
  const { data: connectionsRaw } = useListMerchantConnections();
  const activeConnections = Array.isArray(connectionsRaw) ? connectionsRaw.filter(c => c.isActive) : [];

  const { mutate: simulate, isPending: simulating } = useSimulatePayment({
    mutation: {
      onSuccess: () => {
        toast.success("Payment simulated successfully");
        setShowSimulate(false);
        setSimAmount("");
        setSimUtr("");
        setSimSourceId("");
        queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
        queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      },
      onError: (err: any) => {
        toast.error(err?.message ?? "Failed to simulate payment");
      },
    },
  });

  const handleSimulate = () => {
    if (!simSourceId) { toast.error("Select a source"); return; }
    if (!simAmount || Number(simAmount) <= 0) { toast.error("Enter a valid amount"); return; }
    simulate({
      data: {
        sourceType: simSourceType,
        sourceId: parseInt(simSourceId),
        amount: Number(simAmount),
        utr: simUtr || undefined,
        provider: simProvider || undefined,
        expectedStatus: simExpected,
      },
    });
  };

  function handleExportCsv() {
    const rows = data?.data ?? [];
    if (!rows.length) return;
    setExporting(true);
    try {
      const csv = buildCsvText(rows);
      const lines = csv.split("\n").filter(l => l.trim() !== "");
      const rowCount = Math.max(0, lines.length - 1);
      setLastExportCount(rowCount);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      a.download = `deposits-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
    } finally {
      setExporting(false);
    }
  }


  const successCount = data?.data?.filter(t => t.status === "success").length ?? 0;
  const pendingCount = data?.data?.filter(t => t.status === "pending").length ?? 0;

  const anyFilterActive = !!(search || status !== "all" || dateFrom || dateTo || provider !== "all");

  const clearFilters = () => {
    setSearch("");
    setStatus("all");
    setDateFrom("");
    setDateTo("");
    setProvider("all");
    setPage(1);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Deposits</h1>
          <p className="text-muted-foreground mt-1">All incoming payments via QR and Virtual Accounts</p>
        </div>
        <div className="flex gap-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExportCsv}
                  disabled={exporting || !data?.data?.length}
                  className="border-sky-500/30 text-sky-400 hover:bg-sky-500/10 hover:text-sky-300 hover:border-sky-500/50"
                >
                  {exporting
                    ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                    : <FileDown className="w-3.5 h-3.5 mr-1.5" />}
                  {exporting ? "Exporting…" : "Export CSV"}
                </Button>
              </TooltipTrigger>
              {lastExportCount != null && !exporting && (
                <TooltipContent side="bottom">
                  Last export: {lastExportCount.toLocaleString()} row{lastExportCount !== 1 ? "s" : ""}
                </TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
          <Button size="sm" onClick={() => setShowSimulate(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Simulate Payment
          </Button>
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-border/50 bg-card/50">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                <TrendingUp className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Today's Deposits</p>
                <p className="text-lg font-bold font-mono">₹{(stats?.todayDepositAmount ?? 0).toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">{stats?.todayDeposits ?? 0} payments</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card/50">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <ArrowDownLeft className="w-4 h-4 text-emerald-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Deposits</p>
                <p className="text-lg font-bold font-mono">₹{(stats?.totalDeposits ?? 0).toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">{data?.total ?? 0} transactions</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card/50">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-amber-500/10 flex items-center justify-center">
                <Clock className="w-4 h-4 text-amber-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Pending</p>
                <p className="text-lg font-bold">{pendingCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card/50">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <CheckCircle className="w-4 h-4 text-emerald-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Successful</p>
                <p className="text-lg font-bold">{successCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter summary bar */}
      {anyFilterActive && (
        <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <span className="text-xs font-semibold text-violet-400 uppercase tracking-wider mr-1">Filter results</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              className="ml-auto h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 gap-1.5"
            >
              <X className="w-3 h-3" />
              Clear filters
            </Button>
            <div className="flex items-center gap-1.5 text-sm">
              <Hash className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="font-semibold text-foreground">
                {isLoading ? <span className="inline-block w-8 h-3.5 bg-muted/60 rounded animate-pulse" /> : (data?.total ?? 0).toLocaleString()}
              </span>
              <span className="text-muted-foreground">deposits</span>
            </div>
            <div className="flex items-center gap-1.5 text-sm">
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
              <span className="font-semibold text-emerald-400">
                {isLoading ? <span className="inline-block w-16 h-3.5 bg-muted/60 rounded animate-pulse" /> : `₹${(data?.stats?.depositVolume ?? 0).toLocaleString()}`}
              </span>
              <span className="text-muted-foreground">total amount</span>
            </div>
            <div className="flex items-center gap-1.5 text-sm">
              <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
              <span className="font-semibold text-green-400">
                {isLoading ? <span className="inline-block w-6 h-3.5 bg-muted/60 rounded animate-pulse" /> : (data?.stats?.successCount ?? 0).toLocaleString()}
              </span>
              <span className="text-muted-foreground">success</span>
            </div>
            <div className="flex items-center gap-1.5 text-sm">
              <Clock className="w-3.5 h-3.5 text-amber-400" />
              <span className="font-semibold text-amber-400">
                {isLoading ? <span className="inline-block w-6 h-3.5 bg-muted/60 rounded animate-pulse" /> : (data?.stats?.pendingCount ?? 0).toLocaleString()}
              </span>
              <span className="text-muted-foreground">pending</span>
            </div>
            <div className="flex items-center gap-1.5 text-sm">
              <XCircle className="w-3.5 h-3.5 text-rose-400" />
              <span className="font-semibold text-rose-400">
                {isLoading ? <span className="inline-block w-6 h-3.5 bg-muted/60 rounded animate-pulse" /> : (data?.stats?.failedCount ?? 0).toLocaleString()}
              </span>
              <span className="text-muted-foreground">failed</span>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search by UTR or reference..."
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
              />
            </div>
            <Select value={status} onValueChange={v => { setStatus(v); setPage(1); }}>
              <SelectTrigger className="w-[150px]"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="success">Success</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
            {activeConnections.length > 0 && (
              <Select value={provider} onValueChange={v => { setProvider(v); setPage(1); }}>
                <SelectTrigger className="w-[160px]"><SelectValue placeholder="Provider" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Providers</SelectItem>
                  {activeConnections.map(c => (
                    <SelectItem key={c.id} value={c.provider}>
                      {c.provider.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase())}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-xs text-muted-foreground font-medium mr-1">Date range:</span>
              {DATE_PRESETS.map(preset => (
                <Button
                  key={preset.label}
                  variant={isPresetActive(preset) ? "secondary" : "outline"}
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => applyPreset(preset)}
                >
                  {preset.label}
                </Button>
              ))}
              {customDatePresets.map(preset => (
                <span
                  key={preset.id}
                  className={`group inline-flex items-center gap-1 rounded-md border text-xs font-medium transition-colors ${
                    isCustomDatePresetActive(preset)
                      ? "border-primary/60 bg-primary/15 text-primary"
                      : "border-sky-500/30 bg-sky-500/8 text-sky-300 hover:border-sky-500/60"
                  }`}
                >
                  <button
                    onClick={() => applyCustomDatePreset(preset)}
                    className="flex items-center gap-1 h-8 px-2.5 hover:text-sky-100 transition-colors"
                    title={`${preset.from} – ${preset.to}`}
                  >
                    <CalendarRange className="w-3 h-3 shrink-0" />
                    {preset.name}
                  </button>
                  <button
                    onClick={() => deleteCustomDatePreset(preset.id)}
                    className="pr-1.5 rounded-r-md text-sky-400/50 hover:text-rose-400 hover:bg-rose-500/10 transition-colors opacity-0 group-hover:opacity-100 h-8 flex items-center"
                    aria-label={`Remove preset "${preset.name}"`}
                    title="Remove this preset"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
              <div className="flex items-center gap-2 ml-1">
                <Input
                  type="date"
                  className="w-[150px] h-8 text-xs [color-scheme:dark]"
                  value={dateFrom}
                  onChange={e => { setDateFrom(e.target.value); setPage(1); setShowSaveDatePreset(false); }}
                  title="From date"
                />
                <span className="text-muted-foreground text-sm">to</span>
                <Input
                  type="date"
                  className="w-[150px] h-8 text-xs [color-scheme:dark]"
                  value={dateTo}
                  onChange={e => { setDateTo(e.target.value); setPage(1); setShowSaveDatePreset(false); }}
                  title="To date"
                />
                {canSaveDatePreset && !showSaveDatePreset && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs border-sky-500/40 text-sky-300 hover:bg-sky-500/10 hover:text-sky-200"
                    onClick={openSaveDatePreset}
                    title="Save this date range as a quick-access preset"
                  >
                    <CalendarRange className="w-3 h-3 mr-1.5" />
                    Save as preset
                  </Button>
                )}
                {isCustomDateRangeEntered && isCustomDateAlreadySaved && (
                  <span className="inline-flex items-center gap-1 h-8 px-2.5 text-xs text-sky-400/60 border border-sky-500/20 rounded-md">
                    <CalendarRange className="w-3 h-3" />
                    Saved
                  </span>
                )}
              </div>
              {(dateFrom || dateTo) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground h-8 px-2"
                  onClick={() => { setDateFrom(""); setDateTo(""); setShowSaveDatePreset(false); setPage(1); }}
                >
                  <X className="w-3 h-3 mr-1" />Clear
                </Button>
              )}
            </div>
            {showSaveDatePreset && (
              <div className="flex items-start gap-2 pl-1">
                <div className="flex-shrink-0 pt-1">
                  <CalendarRange className="w-3.5 h-3.5 text-sky-400" />
                </div>
                <div className="flex-1">
                  <Input
                    ref={saveDatePresetNameRef}
                    className="h-8 text-sm max-w-[260px]"
                    placeholder="Name this preset (e.g. Q1 2025)"
                    value={saveDatePresetName}
                    onChange={e => { setSaveDatePresetName(e.target.value); setSaveDatePresetNameError(""); }}
                    onKeyDown={e => {
                      if (e.key === "Enter") confirmSaveDatePreset();
                      if (e.key === "Escape") cancelSaveDatePreset();
                    }}
                    maxLength={40}
                  />
                  {saveDatePresetNameError && (
                    <p className="mt-1 text-xs text-rose-400">{saveDatePresetNameError}</p>
                  )}
                </div>
                <Button size="sm" onClick={confirmSaveDatePreset} className="h-8 shrink-0">
                  Save
                </Button>
                <Button size="sm" variant="ghost" onClick={cancelSaveDatePreset} className="h-8 shrink-0 px-2">
                  <X className="w-4 h-4" />
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>UTR</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 7 }).map((_, j) => (
                      <TableCell key={j}><div className="h-4 bg-muted/50 rounded animate-pulse" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : !data?.data?.length ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-12">
                    <div className="flex flex-col items-center gap-3">
                      <ArrowDownLeft className="w-8 h-8 text-muted-foreground/40" />
                      <p>No deposit transactions found</p>
                      <Button size="sm" variant="outline" onClick={() => setShowSimulate(true)}>
                        <Plus className="w-4 h-4 mr-2" />
                        Simulate your first payment
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : data.data.map(t => {
                let sourceInfo = "";
                try {
                  const m = JSON.parse(t.metadata ?? "{}");
                  if (m.sourceType) sourceInfo = `${m.sourceType === "qr" ? "QR" : "VA"} #${m.sourceId}`;
                } catch {}
                return (
                  <TableRow key={t.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">#{t.id}</TableCell>
                    <TableCell className="font-mono font-semibold text-emerald-400">
                      ₹{Number(t.amount).toLocaleString()}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{t.utr}</TableCell>
                    <TableCell>
                      {sourceInfo ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                          {sourceInfo.startsWith("QR") ? <QrCode className="w-3 h-3" /> : <Building2 className="w-3 h-3" />}
                          {sourceInfo}
                        </span>
                      ) : <span className="text-muted-foreground text-xs">—</span>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                      {t.description ?? "—"}
                    </TableCell>
                    <TableCell><StatusBadge status={t.status} /></TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {format(new Date(t.createdAt), "MMM d, yyyy HH:mm")}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pagination */}
      {data && data.total > 20 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{data.total} total deposits</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
              Previous
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page * 20 >= data.total}>
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Simulate Payment Dialog */}
      <Dialog open={showSimulate} onOpenChange={setShowSimulate}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Simulate Payment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Payment Source</Label>
              <Select value={simSourceType} onValueChange={v => { setSimSourceType(v as "qr" | "va"); setSimSourceId(""); }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="qr">
                    <span className="flex items-center gap-2"><QrCode className="w-4 h-4" /> QR Code</span>
                  </SelectItem>
                  <SelectItem value="va">
                    <span className="flex items-center gap-2"><Building2 className="w-4 h-4" /> Virtual Account</span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{simSourceType === "qr" ? "QR Code" : "Virtual Account"}</Label>
              <Select value={simSourceId} onValueChange={setSimSourceId}>
                <SelectTrigger>
                  <SelectValue placeholder={`Select ${simSourceType === "qr" ? "QR code" : "virtual account"}`} />
                </SelectTrigger>
                <SelectContent>
                  {simSourceType === "qr" ? (
                    qrList?.data?.length ? (
                      qrList.data.map(qr => (
                        <SelectItem key={qr.id} value={String(qr.id)}>
                          {qr.label ?? `QR #${qr.id}`} — {qr.type}
                        </SelectItem>
                      ))
                    ) : (
                      <SelectItem value="none" disabled>No active QR codes</SelectItem>
                    )
                  ) : (
                    vaList?.data?.length ? (
                      vaList.data.map(va => (
                        <SelectItem key={va.id} value={String(va.id)}>
                          {va.label ?? va.accountNumber} — {va.bankName}
                        </SelectItem>
                      ))
                    ) : (
                      <SelectItem value="none" disabled>No active virtual accounts</SelectItem>
                    )
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Amount (₹)</Label>
              <Input
                type="number"
                placeholder="e.g. 5000"
                min="1"
                value={simAmount}
                onChange={e => setSimAmount(e.target.value)}
              />
            </div>

            {activeConnections.length > 0 && (
              <div className="space-y-2">
                <Label>Provider <span className="text-muted-foreground text-xs">(optional — tracks usage toward monthly limit)</span></Label>
                <Select value={simProvider} onValueChange={setSimProvider}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select provider (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">None</SelectItem>
                    {activeConnections.map(c => (
                      <SelectItem key={c.id} value={c.provider}>{c.provider}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label>UTR <span className="text-muted-foreground text-xs">(optional — auto-generated if blank)</span></Label>
              <Input
                placeholder="e.g. HDFC000123456789"
                value={simUtr}
                onChange={e => setSimUtr(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Expected Outcome <span className="text-muted-foreground text-xs">(demo only)</span></Label>
              <Select value={simExpected} onValueChange={v => setSimExpected(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="success">
                    <span className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-emerald-500" /> Success</span>
                  </SelectItem>
                  <SelectItem value="failed">
                    <span className="flex items-center gap-2"><XCircle className="w-4 h-4 text-rose-500" /> Failed</span>
                  </SelectItem>
                  <SelectItem value="pending">
                    <span className="flex items-center gap-2"><Clock className="w-4 h-4 text-amber-500" /> Pending</span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSimulate(false)}>Cancel</Button>
            <Button onClick={handleSimulate} disabled={simulating || !simSourceId || !simAmount}>
              {simulating ? "Simulating..." : "Simulate Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
