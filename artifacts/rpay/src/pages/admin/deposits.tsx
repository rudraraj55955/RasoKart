import { useState, useRef, useEffect } from "react";
import { useCrossTabSync } from "@/hooks/use-cross-tab-sync";
import { useUrlFilters } from "@/hooks/use-url-filters";
import { useListTransactions, useListAdminPayinOrders } from "@workspace/api-client-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowDownLeft, Search, TrendingUp, Clock, CheckCircle, XCircle, Sparkles, X, Hash, CheckCircle2, Bookmark, BookmarkCheck, Trash2, Pencil, ChevronLeft, ChevronRight, RefreshCw, Download } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { format, subDays, startOfMonth, endOfMonth, subMonths, startOfWeek, endOfWeek, startOfDay, endOfDay } from "date-fns";
import { toast } from "sonner";

interface SmartFilter {
  amountMin?: number;
  amountMax?: number;
  dateFrom?: string;
  dateTo?: string;
  txStatus?: "pending" | "success" | "failed";
}

const STATUS_KEYWORDS: Record<string, "pending" | "success" | "failed"> = {
  pending: "pending",
  success: "success",
  successful: "success",
  failed: "failed",
  failure: "failed",
};

function parseDateToken(token: string, now: Date): Pick<SmartFilter, "dateFrom" | "dateTo"> | null {
  if (token === "today") {
    return { dateFrom: format(startOfDay(now), "yyyy-MM-dd"), dateTo: format(endOfDay(now), "yyyy-MM-dd") };
  }
  if (token === "this week") {
    return {
      dateFrom: format(startOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd"),
      dateTo: format(endOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd"),
    };
  }
  if (token === "this month") {
    return { dateFrom: format(startOfMonth(now), "yyyy-MM-dd"), dateTo: format(endOfMonth(now), "yyyy-MM-dd") };
  }
  if (token === "last month") {
    const prev = subMonths(now, 1);
    return { dateFrom: format(startOfMonth(prev), "yyyy-MM-dd"), dateTo: format(endOfMonth(prev), "yyyy-MM-dd") };
  }
  if (token === "last week") {
    const prevWeekStart = startOfWeek(subDays(now, 7), { weekStartsOn: 1 });
    const prevWeekEnd = endOfWeek(subDays(now, 7), { weekStartsOn: 1 });
    return { dateFrom: format(prevWeekStart, "yyyy-MM-dd"), dateTo: format(prevWeekEnd, "yyyy-MM-dd") };
  }
  return null;
}

function parseAmountToken(token: string): Pick<SmartFilter, "amountMin" | "amountMax"> | null {
  const gtMatch = token.match(/^(>=?)(\d+(?:\.\d+)?)$/);
  if (gtMatch) {
    const inclusive = gtMatch[1] === ">=";
    const val = parseFloat(gtMatch[2]!);
    return { amountMin: inclusive ? val : val + 0.01 };
  }
  const ltMatch = token.match(/^(<=?)(\d+(?:\.\d+)?)$/);
  if (ltMatch) {
    const inclusive = ltMatch[1] === "<=";
    const val = parseFloat(ltMatch[2]!);
    return { amountMax: inclusive ? val : val - 0.01 };
  }
  const rangeMatch = token.match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/);
  if (rangeMatch) {
    const min = parseFloat(rangeMatch[1]!);
    const max = parseFloat(rangeMatch[2]!);
    if (min <= max) return { amountMin: min, amountMax: max };
  }
  return null;
}

function parseSmartQuery(raw: string): SmartFilter | null {
  const q = raw.trim().toLowerCase();
  if (!q) return null;

  const filter: SmartFilter = {};
  const now = new Date();

  for (const phrase of ["this week", "this month", "last month", "last week"]) {
    if (q.includes(phrase)) {
      const dateResult = parseDateToken(phrase, now);
      if (dateResult) { Object.assign(filter, dateResult); break; }
    }
  }

  let remaining = q;
  if (filter.dateFrom) {
    for (const phrase of ["this week", "this month", "last month", "last week"]) {
      remaining = remaining.replace(phrase, "").trim();
    }
  }

  const tokens = remaining.split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    if (token in STATUS_KEYWORDS) { filter.txStatus = STATUS_KEYWORDS[token]!; continue; }
    if (!filter.dateFrom) {
      const dateResult = parseDateToken(token, now);
      if (dateResult) { Object.assign(filter, dateResult); continue; }
    }
    if (filter.amountMin == null && filter.amountMax == null) {
      const amtResult = parseAmountToken(token);
      if (amtResult) { Object.assign(filter, amtResult); continue; }
    }
  }

  const hasContent =
    filter.txStatus != null || filter.dateFrom != null ||
    filter.amountMin != null || filter.amountMax != null;

  return hasContent ? filter : null;
}

interface SavedFilter {
  id: string;
  name: string;
  filter: SmartFilter;
  rawInput: string;
}

const DEPOSITS_SAVED_FILTERS_KEY = "rasokart_admin_deposits_saved_filters";

function loadSavedFilters(): SavedFilter[] {
  try {
    const raw = localStorage.getItem(DEPOSITS_SAVED_FILTERS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SavedFilter[];
  } catch { return []; }
}

function storeSavedFilters(filters: SavedFilter[]): void {
  localStorage.setItem(DEPOSITS_SAVED_FILTERS_KEY, JSON.stringify(filters));
}

function exportCsv(data: any[]) {
  if (!data.length) return;
  const rows = [["ID", "Merchant", "Amount", "Currency", "UTR", "Reference", "Status", "Description", "Date"]];
  data.forEach(t => rows.push([
    String(t.id), t.merchantName ?? "", String(t.amount), t.currency, t.utr,
    t.referenceId ?? "", t.status, t.description ?? "", t.createdAt,
  ]));
  const csv = rows.map(r => r.map(v => `"${v}"`).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = "deposits.csv";
  a.click();
}

function exportPayinCsv(rows: { id: number; publicOrderId?: string | null; merchantName?: string | null; merchantId: number; amount: string; currency: string; status: string; utr?: string | null; paidAt?: string | null; createdAt: string }[]) {
  if (!rows.length) return;
  const csvRows = [["Order ID", "Merchant", "Amount", "Currency", "UTR", "Status", "Paid At", "Created At"]];
  rows.forEach(r => csvRows.push([
    r.publicOrderId ?? String(r.id),
    r.merchantName ?? `Merchant #${r.merchantId}`,
    r.amount, r.currency, r.utr ?? "",
    r.status, r.paidAt ?? "", r.createdAt,
  ]));
  const csv = csvRows.map(row => row.map(v => `"${v}"`).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = `upi-deposits-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}

function AdminPayinOrdersPanel() {
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const { data, isLoading, isFetching, refetch } = useListAdminPayinOrders({
    status: status !== "all" ? status : undefined,
    search: search || undefined,
    page,
    pageSize: 20,
  });

  const rows = data?.orders ?? [];

  return (
    <div className="space-y-4">
      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        <div className="flex flex-col gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Search by order ID or merchant..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <Select value={status} onValueChange={v => { setStatus(v); setPage(1); }}>
            <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="CREATED">Created</SelectItem>
              <SelectItem value="PENDING">Pending</SelectItem>
              <SelectItem value="PAID">Paid</SelectItem>
              <SelectItem value="FAILED">Failed</SelectItem>
              <SelectItem value="EXPIRED">Expired</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}><CardContent className="p-4"><div className="h-16 bg-muted/50 animate-pulse rounded" /></CardContent></Card>
          ))
        ) : !rows.length ? (
          <div className="text-center text-muted-foreground py-10 text-sm">No UPI deposit orders found</div>
        ) : rows.map(r => (
          <Card key={r.id}>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-mono text-xs text-muted-foreground">{r.publicOrderId ?? `#${r.id}`}</p>
                  <p className="font-semibold text-sm mt-0.5">{r.merchantName ?? `Merchant #${r.merchantId}`}</p>
                </div>
                <StatusBadge status={r.status === "PAID" ? "success" : r.status === "FAILED" || r.status === "EXPIRED" ? "failed" : "pending"} />
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <div>
                  <p className="text-[10px] uppercase text-muted-foreground font-medium">Amount</p>
                  <p className="font-mono font-semibold text-emerald-400">₹{Number(r.amount).toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase text-muted-foreground font-medium">UTR</p>
                  <p className="font-mono text-xs">{r.utr ?? "—"}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase text-muted-foreground font-medium">Paid At</p>
                  <p className="text-xs text-muted-foreground">{r.paidAt ? format(new Date(r.paidAt), "MMM d, HH:mm") : "—"}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase text-muted-foreground font-medium">Created</p>
                  <p className="text-xs text-muted-foreground">{format(new Date(r.createdAt), "MMM d, HH:mm")}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        {data && data.total > 20 && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{data.total} total</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Prev</Button>
              <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page * 20 >= data.total}>Next</Button>
            </div>
          </div>
        )}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block">
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-1 items-center gap-2">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Search by order ID or merchant..."
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
              />
            </div>
            <Select value={status} onValueChange={v => { setStatus(v); setPage(1); }}>
              <SelectTrigger className="w-[150px]"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="CREATED">Created</SelectItem>
                <SelectItem value="PENDING">Pending</SelectItem>
                <SelectItem value="PAID">Paid</SelectItem>
                <SelectItem value="FAILED">Failed</SelectItem>
                <SelectItem value="EXPIRED">Expired</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportPayinCsv(rows)} disabled={!rows.length}>
              <Download className="w-4 h-4 mr-2" />
              Export CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order ID</TableHead>
                  <TableHead>Merchant</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>UTR</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Paid At</TableHead>
                  <TableHead>Created</TableHead>
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
                ) : !rows.length ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-12">
                      No UPI deposit orders found
                    </TableCell>
                  </TableRow>
                ) : rows.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{r.publicOrderId ?? `#${r.id}`}</TableCell>
                    <TableCell className="font-medium">{r.merchantName ?? `Merchant #${r.merchantId}`}</TableCell>
                    <TableCell className="font-mono font-semibold text-emerald-400">
                      ₹{Number(r.amount).toLocaleString()}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.utr ?? "—"}</TableCell>
                    <TableCell><StatusBadge status={r.status === "PAID" ? "success" : r.status === "FAILED" || r.status === "EXPIRED" ? "failed" : "pending"} /></TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.paidAt ? format(new Date(r.paidAt), "MMM d, yyyy HH:mm") : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {format(new Date(r.createdAt), "MMM d, yyyy HH:mm")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {data && data.total > 20 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{data.total} total UPI orders</span>
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
      </div>
    </div>
  );
}

export default function AdminDeposits() {
  const [search, setSearch] = useState("");
  const urlFilters = useUrlFilters({ status: { default: "all", allow: ["all", "success", "pending", "failed"] } });
  const { status } = urlFilters;
  function setStatus(v: string) { urlFilters.set("status", v); }
  const [merchantId, setMerchantId] = useState("");
  const [page, setPage] = useState(1);

  const [smartInput, setSmartInput] = useState("");
  const [smartFilter, setSmartFilter] = useState<SmartFilter | null>(null);
  const [smartError, setSmartError] = useState("");
  const smartInputRef = useRef<HTMLInputElement>(null);

  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>(() => loadSavedFilters());

  useCrossTabSync([{
    key: DEPOSITS_SAVED_FILTERS_KEY,
    onUpdate: (raw) => {
      try { setSavedFilters(raw ? (JSON.parse(raw) as SavedFilter[]) : []); }
      catch { setSavedFilters([]); }
    },
  }]);

  const [showSaveInput, setShowSaveInput] = useState(false);
  const [saveFilterName, setSaveFilterName] = useState("");
  const [saveFilterNameError, setSaveFilterNameError] = useState("");
  const saveNameInputRef = useRef<HTMLInputElement>(null);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showSaveInput) {
      setTimeout(() => saveNameInputRef.current?.focus(), 50);
    }
  }, [showSaveInput]);

  useEffect(() => {
    if (renamingId) {
      setTimeout(() => renameInputRef.current?.focus(), 50);
    }
  }, [renamingId]);

  const activeStatus = smartFilter?.txStatus ?? (status !== "all" ? status : undefined);
  const activeDateFrom = smartFilter?.dateFrom ?? undefined;
  const activeDateTo = smartFilter?.dateTo ?? undefined;
  const amountMin = smartFilter?.amountMin;
  const amountMax = smartFilter?.amountMax;

  const { data, isLoading } = useListTransactions({
    type: "deposit",
    status: activeStatus as any,
    search: search || undefined,
    merchantId: merchantId ? parseInt(merchantId) : undefined,
    dateFrom: activeDateFrom,
    dateTo: activeDateTo,
    ...(amountMin != null ? { amountMin } : {}),
    ...(amountMax != null ? { amountMax } : {}),
    page,
    limit: 20,
  });

  const stats = {
    total: data?.total ?? 0,
    pending: data?.stats?.pendingCount ?? 0,
    success: data?.stats?.successCount ?? 0,
    failed: data?.stats?.failedCount ?? 0,
    totalAmount: data?.stats?.depositVolume ?? 0,
  };

  const hasSmartFilter = smartFilter !== null;
  const isCurrentFilterSaved = hasSmartFilter && savedFilters.some(
    f => f.rawInput === smartInput && JSON.stringify(f.filter) === JSON.stringify(smartFilter)
  );
  const anyFilterActive = hasSmartFilter || !!search || !!merchantId || status !== "all";
  const [depositGrandTotal, setDepositGrandTotal] = useState(0);
  useEffect(() => {
    if (!anyFilterActive && !isLoading && data?.total != null) {
      setDepositGrandTotal(data.total);
    }
  }, [anyFilterActive, isLoading, data?.total]);

  const applySmartSearch = () => {
    setSmartError("");
    const filter = parseSmartQuery(smartInput);
    if (!filter) {
      setSmartError("Try: pending, success >500, failed this week, >500, today");
      return;
    }
    setSmartFilter(filter);
    if (filter.txStatus) setStatus("all");
    setPage(1);
    setShowSaveInput(false);
    setSaveFilterName("");
  };

  const clearSmartFilter = () => {
    setSmartFilter(null);
    setSmartInput("");
    setSmartError("");
    setShowSaveInput(false);
    setSaveFilterName("");
    setSaveFilterNameError("");
    setPage(1);
    smartInputRef.current?.focus();
  };

  const applySavedFilter = (saved: SavedFilter) => {
    setSmartFilter(saved.filter);
    setSmartInput(saved.rawInput);
    setSmartError("");
    setShowSaveInput(false);
    setSaveFilterName("");
    setSaveFilterNameError("");
    if (saved.filter.txStatus) setStatus("all");
    setPage(1);
  };

  const confirmSaveFilter = () => {
    const trimmed = saveFilterName.trim();
    if (!trimmed) { setSaveFilterNameError("Please enter a name for this filter."); saveNameInputRef.current?.focus(); return; }
    if (!smartFilter) return;
    if (savedFilters.some(f => f.name.toLowerCase() === trimmed.toLowerCase())) {
      setSaveFilterNameError("A filter with this name already exists."); saveNameInputRef.current?.focus(); return;
    }
    const newFilter: SavedFilter = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: trimmed, filter: smartFilter, rawInput: smartInput,
    };
    const updated = [...savedFilters, newFilter];
    setSavedFilters(updated);
    storeSavedFilters(updated);
    setShowSaveInput(false);
    setSaveFilterName("");
    setSaveFilterNameError("");
  };

  const cancelSaveFilter = () => { setShowSaveInput(false); setSaveFilterName(""); setSaveFilterNameError(""); };

  const deleteSavedFilter = (id: string) => {
    const updated = savedFilters.filter(f => f.id !== id);
    setSavedFilters(updated);
    storeSavedFilters(updated);
    if (renamingId === id) setRenamingId(null);
  };

  const moveSavedFilter = (id: string, dir: -1 | 1) => {
    const idx = savedFilters.findIndex(f => f.id === id);
    if (idx === -1) return;
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= savedFilters.length) return;
    const updated = [...savedFilters];
    [updated[idx], updated[newIdx]] = [updated[newIdx]!, updated[idx]!];
    setSavedFilters(updated);
    storeSavedFilters(updated);
  };

  const startRename = (saved: SavedFilter) => {
    setRenamingId(saved.id);
    setRenameValue(saved.name);
  };

  const commitRename = () => {
    if (!renamingId) return;
    const trimmed = renameValue.trim();
    if (!trimmed) { setRenamingId(null); return; }
    if (savedFilters.some(f => f.id !== renamingId && f.name.toLowerCase() === trimmed.toLowerCase())) {
      toast.error("A filter with this name already exists.");
      return;
    }
    const updated = savedFilters.map(f => f.id === renamingId ? { ...f, name: trimmed } : f);
    setSavedFilters(updated);
    storeSavedFilters(updated);
    setRenamingId(null);
  };

  const cancelRename = () => { setRenamingId(null); };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Deposits</h1>
          <p className="text-muted-foreground mt-1">Monitor all incoming deposits across merchants</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => exportCsv(data?.data ?? [])} className="w-full sm:w-auto">
          Export CSV
        </Button>
      </div>

      <Tabs defaultValue="manual" className="space-y-6">
        <TabsList>
          <TabsTrigger value="manual">Bank Deposits</TabsTrigger>
          <TabsTrigger value="upi">UPI (Payin)</TabsTrigger>
        </TabsList>
        <TabsContent value="manual" className="space-y-6 mt-0">

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-border/50 bg-card/50">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                <ArrowDownLeft className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Volume</p>
                <p className="text-lg font-bold font-mono">₹{stats.totalAmount.toLocaleString()}</p>
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
                <p className="text-lg font-bold">{stats.pending}</p>
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
                <p className="text-lg font-bold">{stats.success}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card/50">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-rose-500/10 flex items-center justify-center">
                <XCircle className="w-4 h-4 text-rose-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Failed</p>
                <p className="text-lg font-bold">{stats.failed}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {status !== "all" && !hasSmartFilter && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Active filter:</span>
          <button
            onClick={() => { setStatus("all"); setPage(1); }}
            className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary border border-primary/30 text-xs px-2.5 py-1 hover:bg-primary/20 transition-colors capitalize"
          >
            Status: {status}
            <X className="w-3 h-3 ml-0.5" />
          </button>
        </div>
      )}

      {/* Smart Search Bar */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Smart Search</p>

          {savedFilters.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="text-xs text-muted-foreground font-medium">Saved:</span>
              {savedFilters.map((saved, idx) => (
                <span
                  key={saved.id}
                  className="group inline-flex items-center gap-0.5 rounded-full border border-violet-500/30 bg-violet-500/8 text-xs font-medium text-violet-300 hover:border-violet-500/60 transition-colors"
                >
                  {/* Move left */}
                  {idx > 0 && (
                    <button
                      onClick={() => moveSavedFilter(saved.id, -1)}
                      className="pl-1.5 pr-0.5 py-1 rounded-l-full text-violet-400/40 hover:text-violet-200 hover:bg-violet-500/10 transition-colors opacity-0 group-hover:opacity-100"
                      aria-label="Move left"
                      title="Move left"
                    >
                      <ChevronLeft className="w-3 h-3" />
                    </button>
                  )}
                  {idx === 0 && <span className="pl-2" />}

                  {renamingId === saved.id ? (
                    <input
                      ref={renameInputRef}
                      className="w-28 bg-transparent border-b border-violet-400 text-violet-100 text-xs outline-none py-0.5 mx-1"
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter") commitRename();
                        if (e.key === "Escape") cancelRename();
                      }}
                      onBlur={commitRename}
                      maxLength={40}
                    />
                  ) : (
                    <>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              onClick={() => applySavedFilter(saved)}
                              className="p-0.5 text-violet-300 hover:text-violet-100 transition-colors"
                              title={`Apply: ${saved.rawInput}`}
                            >
                              <BookmarkCheck className="w-3 h-3 shrink-0" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="max-w-xs">
                            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">Query</p>
                            <p className="font-mono text-xs break-all">{saved.rawInput}</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <button
                        onClick={() => startRename(saved)}
                        className="px-0.5 py-1 hover:text-violet-100 transition-colors"
                        title="Click to rename"
                      >
                        {saved.name}
                      </button>
                    </>
                  )}

                  {/* Rename icon */}
                  {renamingId !== saved.id && (
                    <button
                      onClick={() => startRename(saved)}
                      className="p-0.5 text-violet-400/40 hover:text-violet-200 hover:bg-violet-500/10 transition-colors opacity-0 group-hover:opacity-100"
                      aria-label={`Rename "${saved.name}"`}
                      title="Rename"
                    >
                      <Pencil className="w-2.5 h-2.5" />
                    </button>
                  )}

                  {/* Delete */}
                  {renamingId !== saved.id && (
                    <button
                      onClick={() => deleteSavedFilter(saved.id)}
                      className="p-0.5 text-violet-400/40 hover:text-rose-400 hover:bg-rose-500/10 transition-colors opacity-0 group-hover:opacity-100"
                      aria-label={`Delete saved filter "${saved.name}"`}
                      title="Delete this saved filter"
                    >
                      <Trash2 className="w-2.5 h-2.5" />
                    </button>
                  )}

                  {/* Move right */}
                  {idx < savedFilters.length - 1 && renamingId !== saved.id && (
                    <button
                      onClick={() => moveSavedFilter(saved.id, 1)}
                      className="pr-1.5 pl-0.5 py-1 rounded-r-full text-violet-400/40 hover:text-violet-200 hover:bg-violet-500/10 transition-colors opacity-0 group-hover:opacity-100"
                      aria-label="Move right"
                      title="Move right"
                    >
                      <ChevronRight className="w-3 h-3" />
                    </button>
                  )}
                  {idx === savedFilters.length - 1 && renamingId !== saved.id && <span className="pr-1" />}
                </span>
              ))}
            </div>
          )}

          <div className="flex flex-col sm:flex-row flex-wrap gap-3">
            <div className="relative flex-1">
              <Sparkles className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-violet-400" />
              <Input
                ref={smartInputRef}
                className="pl-9"
                placeholder="Try: pending  ·  success >500  ·  failed this week  ·  >500  ·  today"
                value={smartInput}
                onChange={e => { setSmartInput(e.target.value); setSmartError(""); }}
                onKeyDown={e => { if (e.key === "Enter") applySmartSearch(); }}
              />
            </div>
            <Button onClick={applySmartSearch} disabled={!smartInput.trim()}>
              <Search className="w-4 h-4 mr-2" />Apply
            </Button>
            {hasSmartFilter && !isCurrentFilterSaved && !showSaveInput && (
              <Button
                variant="outline"
                onClick={() => { setSaveFilterName(""); setSaveFilterNameError(""); setShowSaveInput(true); }}
                className="border-violet-500/40 text-violet-300 hover:bg-violet-500/10 hover:text-violet-200"
              >
                <Bookmark className="w-4 h-4 mr-2" />Save filter
              </Button>
            )}
            {hasSmartFilter && isCurrentFilterSaved && (
              <Button variant="outline" disabled className="border-violet-500/20 text-violet-400/50 cursor-default">
                <BookmarkCheck className="w-4 h-4 mr-2" />Saved
              </Button>
            )}
          </div>

          {showSaveInput && (
            <div className="mt-3 flex items-start gap-2">
              <div className="flex-1">
                <Input
                  ref={saveNameInputRef}
                  className="h-8 text-sm"
                  placeholder="Name this filter (e.g. Large deposits)"
                  value={saveFilterName}
                  onChange={e => { setSaveFilterName(e.target.value); setSaveFilterNameError(""); }}
                  onKeyDown={e => { if (e.key === "Enter") confirmSaveFilter(); if (e.key === "Escape") cancelSaveFilter(); }}
                  maxLength={40}
                />
                {saveFilterNameError && <p className="mt-1 text-xs text-rose-400">{saveFilterNameError}</p>}
              </div>
              <Button size="sm" onClick={confirmSaveFilter} className="h-8 shrink-0">Save</Button>
              <Button size="sm" variant="ghost" onClick={cancelSaveFilter} className="h-8 shrink-0 px-2"><X className="w-4 h-4" /></Button>
            </div>
          )}

          {smartError && <p className="mt-2 text-xs text-amber-400">{smartError}</p>}
          <p className="mt-2 text-xs text-muted-foreground">
            Status: <span className="font-mono text-foreground/60">pending</span>, <span className="font-mono text-foreground/60">success</span>, <span className="font-mono text-foreground/60">failed</span> — Amount: <span className="font-mono text-foreground/60">{">500"}</span>, <span className="font-mono text-foreground/60">{"200-999"}</span> — Date: <span className="font-mono text-foreground/60">today</span>, <span className="font-mono text-foreground/60">this week</span>, <span className="font-mono text-foreground/60">this month</span> — Combine: <span className="font-mono text-foreground/60">failed this week</span>
          </p>
        </CardContent>
      </Card>

      {/* Active smart filter chips */}
      {hasSmartFilter && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground font-medium">Smart filter:</span>
          {(() => {
            const sf = smartFilter!;
            const chips: { label: string; key: string }[] = [];
            if (sf.txStatus) chips.push({ key: "status", label: sf.txStatus.charAt(0).toUpperCase() + sf.txStatus.slice(1) });
            if (sf.dateFrom || sf.dateTo) {
              const d = sf.dateFrom && sf.dateTo
                ? `${sf.dateFrom} – ${sf.dateTo}`
                : sf.dateFrom ? `From ${sf.dateFrom}` : `Until ${sf.dateTo}`;
              chips.push({ key: "date", label: d });
            }
            if (sf.amountMin != null && sf.amountMax != null) {
              chips.push({ key: "amount", label: `₹${sf.amountMin.toLocaleString()} – ₹${sf.amountMax.toLocaleString()}` });
            } else if (sf.amountMin != null) {
              chips.push({ key: "amount", label: `≥ ₹${sf.amountMin.toLocaleString()}` });
            } else if (sf.amountMax != null) {
              chips.push({ key: "amount", label: `≤ ₹${sf.amountMax.toLocaleString()}` });
            }
            return chips.map((chip, i) => (
              <span key={chip.key} className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/40 bg-violet-500/10 px-3 py-1 text-xs font-medium text-violet-300">
                <Sparkles className="w-3 h-3" />
                {chip.label}
                {i === chips.length - 1 && (
                  <button
                    onClick={clearSmartFilter}
                    className="ml-0.5 rounded-full p-0.5 hover:bg-violet-500/20 transition-colors"
                    aria-label="Remove smart filter"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </span>
            ));
          })()}
        </div>
      )}

      {/* Regular filter chips */}
      {(!!search || !!merchantId || (status !== "all" && !smartFilter?.txStatus)) && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground font-medium">Filters:</span>
          {!!search && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/40 bg-sky-500/10 px-3 py-1 text-xs font-medium text-sky-300">
              Search: {search}
              <button
                onClick={() => { setSearch(""); setPage(1); }}
                className="ml-0.5 rounded-full p-0.5 hover:bg-sky-500/20 transition-colors"
                aria-label="Clear search filter"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
          {!!merchantId && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/40 bg-sky-500/10 px-3 py-1 text-xs font-medium text-sky-300">
              Merchant #{merchantId}
              <button
                onClick={() => { setMerchantId(""); setPage(1); }}
                className="ml-0.5 rounded-full p-0.5 hover:bg-sky-500/20 transition-colors"
                aria-label="Clear merchant filter"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
          {status !== "all" && !smartFilter?.txStatus && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/40 bg-sky-500/10 px-3 py-1 text-xs font-medium text-sky-300">
              Status: {status.charAt(0).toUpperCase() + status.slice(1)}
              <button
                onClick={() => { setStatus("all"); setPage(1); }}
                className="ml-0.5 rounded-full p-0.5 hover:bg-sky-500/20 transition-colors"
                aria-label="Clear status filter"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
        </div>
      )}

      {/* Filter summary bar */}
      {anyFilterActive && (
        <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <span className="text-xs font-semibold text-violet-400 uppercase tracking-wider mr-1">Filter results</span>
            <div className="flex items-center gap-1.5 text-sm">
              <Hash className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="font-semibold text-foreground">
                {isLoading ? <span className="inline-block w-16 h-3.5 bg-muted/60 rounded animate-pulse" /> : `${(data?.total ?? 0).toLocaleString()} of ${depositGrandTotal.toLocaleString()}`}
              </span>
              <span className="text-muted-foreground">deposit{depositGrandTotal !== 1 ? "s" : ""}</span>
            </div>
            <div className="flex items-center gap-1.5 text-sm">
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
              <span className="font-semibold text-emerald-400">
                {isLoading ? <span className="inline-block w-16 h-3.5 bg-muted/60 rounded animate-pulse" /> : `₹${(data?.stats?.depositVolume ?? 0).toLocaleString()}`}
              </span>
              <span className="text-muted-foreground">volume</span>
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

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search by UTR or reference..."
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
              />
            </div>
            <Input
              className="w-[160px]"
              placeholder="Merchant ID"
              value={merchantId}
              onChange={e => { setMerchantId(e.target.value); setPage(1); }}
            />
            <Select
              value={smartFilter?.txStatus ?? status}
              onValueChange={v => {
                if (smartFilter) clearSmartFilter();
                setStatus(v); setPage(1);
              }}
            >
              <SelectTrigger className="w-[150px]"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="success">Success</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Merchant</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>UTR</TableHead>
                <TableHead>Reference</TableHead>
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
                    {anyFilterActive ? (
                      <div className="space-y-2">
                        <p>No deposits match the current filters</p>
                        <Button variant="ghost" size="sm" onClick={clearSmartFilter} className="text-violet-400 hover:text-violet-300">
                          Clear smart filter
                        </Button>
                      </div>
                    ) : "No deposit transactions found"}
                  </TableCell>
                </TableRow>
              ) : data.data.map(t => (
                <TableRow key={t.id}>
                  <TableCell className="font-mono text-xs text-muted-foreground">#{t.id}</TableCell>
                  <TableCell className="font-medium">{t.merchantName ?? `Merchant #${t.merchantId}`}</TableCell>
                  <TableCell className="font-mono font-semibold text-emerald-400">
                    ₹{Number(t.amount).toLocaleString()}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{t.utr}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{t.referenceId ?? "—"}</TableCell>
                  <TableCell><StatusBadge status={t.status} /></TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {format(new Date(t.createdAt), "MMM d, yyyy HH:mm")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        </CardContent>
      </Card>

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
        </TabsContent>

        <TabsContent value="upi" className="mt-0">
          <AdminPayinOrdersPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
