import { useState, useRef } from "react";
import {
  useListSettlements,
  useGetSettlementStats,
  useProcessSettlement,
  useApproveSettlement,
  useRejectSettlement,
  useHoldSettlement,
  useMarkSettlementPaid,
  getListSettlementsQueryKey,
  getGetSettlementStatsQueryKey,
  listSettlements,
  useGetMerchant,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ExportCsvButton, downloadCsvFromUrl } from "@/components/ui/export-csv-button";
import { useMonitoringRefresh } from "@/hooks/use-monitoring-refresh";
import { ChevronDown, ChevronRight, Search, X, MoreHorizontal, TrendingUp, Clock, CheckCircle2, DollarSign, RefreshCw, CheckSquare, AlertTriangle, Wallet, Sparkles, Hash, Bookmark, BookmarkCheck, Trash2 } from "lucide-react";
import { format, subDays, startOfMonth, endOfMonth, subMonths, startOfWeek, endOfWeek, startOfDay, endOfDay } from "date-fns";
import { toast } from "sonner";

type ActionType = "process" | "approve" | "reject" | "hold" | "mark-paid";

interface ActionModal {
  id: number;
  type: ActionType;
  merchantName?: string | null;
  amount: number;
  merchantId?: number;
}

interface SmartFilter {
  amountMin?: number;
  amountMax?: number;
  dateFrom?: string;
  dateTo?: string;
  settlementStatus?: "pending" | "processing" | "approved" | "rejected" | "paid" | "hold";
}

const STATUS_KEYWORDS: Record<string, SmartFilter["settlementStatus"]> = {
  pending: "pending",
  processing: "processing",
  approved: "approved",
  approve: "approved",
  rejected: "rejected",
  reject: "rejected",
  paid: "paid",
  hold: "hold",
  held: "hold",
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
    if (token in STATUS_KEYWORDS) { filter.settlementStatus = STATUS_KEYWORDS[token]; continue; }
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
    filter.settlementStatus != null || filter.dateFrom != null ||
    filter.amountMin != null || filter.amountMax != null;

  return hasContent ? filter : null;
}

interface SavedFilter {
  id: string;
  name: string;
  filter: SmartFilter;
  rawInput: string;
}

const SETTLEMENTS_SAVED_FILTERS_KEY = "rasokart_admin_settlements_saved_filters";

function loadSavedFilters(): SavedFilter[] {
  try {
    const raw = localStorage.getItem(SETTLEMENTS_SAVED_FILTERS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SavedFilter[];
  } catch { return []; }
}

function storeSavedFilters(filters: SavedFilter[]): void {
  localStorage.setItem(SETTLEMENTS_SAVED_FILTERS_KEY, JSON.stringify(filters));
}

export default function AdminSettlements() {
  const qc = useQueryClient();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [actionModal, setActionModal] = useState<ActionModal | null>(null);
  const [remark, setRemark] = useState("");
  const [refNumber, setRefNumber] = useState("");
  const [actionError, setActionError] = useState("");

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [selectAllMode, setSelectAllMode] = useState(false);
  const [bulkAction, setBulkAction] = useState<"approve" | "reject" | null>(null);
  const [bulkRemark, setBulkRemark] = useState("");
  const [bulkError, setBulkError] = useState("");

  const [smartInput, setSmartInput] = useState("");
  const [smartFilter, setSmartFilter] = useState<SmartFilter | null>(null);
  const [smartError, setSmartError] = useState("");
  const smartInputRef = useRef<HTMLInputElement>(null);

  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>(() => loadSavedFilters());
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [saveFilterName, setSaveFilterName] = useState("");
  const [saveFilterNameError, setSaveFilterNameError] = useState("");
  const saveNameInputRef = useRef<HTMLInputElement>(null);

  const { lastRefreshed, isRefreshing, handleRefresh } = useMonitoringRefresh(() => {
    qc.invalidateQueries({ queryKey: getListSettlementsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetSettlementStatsQueryKey() });
  });

  const activeStatus = smartFilter?.settlementStatus ?? (status !== "all" ? status : undefined);
  const activeDateFrom = smartFilter?.dateFrom ?? (dateFrom || undefined);
  const activeDateTo = smartFilter?.dateTo ?? (dateTo || undefined);

  const { data, isLoading } = useListSettlements({
    status: activeStatus as any,
    dateFrom: activeDateFrom,
    dateTo: activeDateTo,
    page,
    limit: 20,
  });

  const { data: stats } = useGetSettlementStats();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getListSettlementsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetSettlementStatsQueryKey() });
    setActionModal(null);
    setRemark("");
    setRefNumber("");
    setActionError("");
  };

  const onError = (err: any) => {
    setActionError(err?.response?.data?.error ?? err?.message ?? "Action failed");
  };

  const processMut = useProcessSettlement({ mutation: { onSuccess: invalidate, onError } });
  const approveMut = useApproveSettlement({ mutation: { onSuccess: invalidate, onError } });
  const rejectMut = useRejectSettlement({ mutation: { onSuccess: invalidate, onError } });
  const holdMut = useHoldSettlement({ mutation: { onSuccess: invalidate, onError } });
  const paidMut = useMarkSettlementPaid({ mutation: { onSuccess: invalidate, onError } });

  const isPending = processMut.isPending || approveMut.isPending || rejectMut.isPending || holdMut.isPending || paidMut.isPending;

  const isApproveModal = actionModal?.type === "approve" && !!actionModal?.merchantId;
  const { data: approvalMerchant, isLoading: isMerchantLoading } = useGetMerchant(
    actionModal?.merchantId ?? 0,
    { query: { enabled: isApproveModal } as any }
  );
  const merchantBalance = approvalMerchant?.balance ?? null;
  const isOverdraw = merchantBalance != null && actionModal != null && actionModal.amount > merchantBalance;

  const handleAction = () => {
    if (!actionModal) return;
    setActionError("");
    if (!remark.trim()) {
      setActionError("Remark is required");
      return;
    }
    if (actionModal.type === "mark-paid" && !refNumber.trim()) {
      setActionError("Reference number is required");
      return;
    }

    const { id, type } = actionModal;
    if (type === "process") processMut.mutate({ id, data: { remark } });
    else if (type === "approve") approveMut.mutate({ id, data: { remark } });
    else if (type === "reject") rejectMut.mutate({ id, data: { remark } });
    else if (type === "hold") holdMut.mutate({ id, data: { remark } });
    else if (type === "mark-paid") paidMut.mutate({ id, data: { remark, referenceNumber: refNumber } });
  };

  const openAction = (id: number, type: ActionType, merchantName?: string | null, amount?: number, merchantId?: number) => {
    setRemark("");
    setRefNumber("");
    setActionError("");
    setActionModal({ id, type, merchantName, amount: amount ?? 0, merchantId });
  };

  const exportCsv = () => downloadCsvFromUrl("/api/settlements/export/csv", "settlements.csv", {
    dateFrom: activeDateFrom,
    dateTo: activeDateTo,
    search: search || undefined,
    status: activeStatus,
  });

  // Apply amount filter client-side (API doesn't support amountMin/amountMax)
  const amountMin = smartFilter?.amountMin;
  const amountMax = smartFilter?.amountMax;

  const filtered = data?.data?.filter(s => {
    const amount = Number(s.requestedAmount ?? s.amount);
    if (amountMin != null && amount < amountMin) return false;
    if (amountMax != null && amount > amountMax) return false;
    if (search && !s.merchantName?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const actionLabels: Record<ActionType, string> = {
    "process": "Mark as Processing",
    "approve": "Approve Settlement",
    "reject": "Reject Settlement",
    "hold": "Put on Hold",
    "mark-paid": "Mark as Paid",
  };

  const actionColors: Record<ActionType, string> = {
    "process": "text-blue-400",
    "approve": "text-emerald-400",
    "reject": "text-rose-400",
    "hold": "text-amber-400",
    "mark-paid": "text-teal-400",
  };

  const total = data?.total ?? 0;
  const pageItems = filtered ?? [];
  const allPageIds = pageItems.map(s => s.id);
  const allPageSelected = allPageIds.length > 0 && allPageIds.every(id => selected.has(id));
  const somePageSelected = allPageIds.some(id => selected.has(id));
  const selectedOnPage = allPageIds.filter(id => selected.has(id)).length;
  const selectedOffPage = selected.size - selectedOnPage;

  const clearSelection = () => { setSelected(new Set()); setSelectAllMode(false); };

  const handleSearchChange = (v: string) => { setSearch(v); setPage(1); clearSelection(); };
  const handleStatusChange = (v: string) => {
    if (smartFilter) clearSmartFilter();
    setStatus(v); setPage(1); clearSelection();
  };

  const handleSelectAllPages = async () => {
    const PAGE_SIZE = 100;
    const totalPages = Math.ceil(total / PAGE_SIZE);
    try {
      const pages = await Promise.all(
        Array.from({ length: totalPages }, (_, i) =>
          listSettlements({
            status: activeStatus as any,
            dateFrom: activeDateFrom,
            dateTo: activeDateTo,
            page: i + 1,
            limit: PAGE_SIZE,
          })
        )
      );
      const allIds = pages.flatMap(p => p.data.map(s => s.id));
      if (allIds.length !== total) {
        toast.error("Could not select all settlements — please try again");
        return;
      }
      setSelected(new Set(allIds));
      setSelectAllMode(true);
    } catch {
      toast.error("Failed to select all settlements");
    }
  };

  const toggleSelectAll = () => {
    if (allPageSelected) {
      setSelected(prev => {
        const next = new Set(prev);
        allPageIds.forEach(id => next.delete(id));
        return next;
      });
      setSelectAllMode(false);
    } else {
      setSelected(prev => {
        const next = new Set(prev);
        allPageIds.forEach(id => next.add(id));
        return next;
      });
    }
  };

  const toggleSelect = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setSelectAllMode(false);
  };

  const handleBulkAction = async () => {
    if (!bulkAction || selected.size === 0) return;
    setBulkError("");
    if (!bulkRemark.trim()) {
      setBulkError("Remark is required");
      return;
    }

    const ids = Array.from(selected);
    let succeeded = 0;
    let failed = 0;

    await Promise.allSettled(
      ids.map(id =>
        (bulkAction === "approve"
          ? approveMut.mutateAsync({ id, data: { remark: bulkRemark } })
          : rejectMut.mutateAsync({ id, data: { remark: bulkRemark } })
        ).then(() => { succeeded++; }).catch(() => { failed++; })
      )
    );

    qc.invalidateQueries({ queryKey: getListSettlementsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetSettlementStatsQueryKey() });

    if (failed === 0) {
      toast.success(`${succeeded} settlement${succeeded !== 1 ? "s" : ""} ${bulkAction === "approve" ? "approved" : "rejected"}`);
    } else {
      toast.warning(`${succeeded} succeeded, ${failed} failed`);
    }

    setBulkAction(null);
    setBulkRemark("");
    clearSelection();
  };

  const hasSmartFilter = smartFilter !== null;
  const isCurrentFilterSaved = hasSmartFilter && savedFilters.some(
    f => f.rawInput === smartInput && JSON.stringify(f.filter) === JSON.stringify(smartFilter)
  );
  const anyFilterActive = hasSmartFilter || !!search || status !== "all" || !!(dateFrom || dateTo);

  const applySmartSearch = () => {
    setSmartError("");
    const filter = parseSmartQuery(smartInput);
    if (!filter) {
      setSmartError("Try: pending, approved >5000, rejected this month, >1000, today");
      return;
    }
    setSmartFilter(filter);
    if (filter.settlementStatus) setStatus("all");
    if (filter.dateFrom || filter.dateTo) { setDateFrom(""); setDateTo(""); }
    setPage(1);
    clearSelection();
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
    if (saved.filter.settlementStatus) setStatus("all");
    if (saved.filter.dateFrom || saved.filter.dateTo) { setDateFrom(""); setDateTo(""); }
    setPage(1);
    clearSelection();
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
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Settlements</h1>
          <p className="text-muted-foreground mt-1">Review and process merchant settlement requests · refreshed {format(lastRefreshed, "HH:mm:ss")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isRefreshing}>
            <RefreshCw className={`w-4 h-4 mr-1 ${isRefreshing ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <ExportCsvButton onExport={exportCsv} />
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        {[
          {
            label: "Pending Total",
            value: `₹${(stats?.pendingTotal ?? 0).toLocaleString()}`,
            icon: Clock,
            color: "text-amber-500",
            bg: "bg-amber-500/10",
          },
          {
            label: "Paid MTD",
            value: `₹${(stats?.paidMTD ?? 0).toLocaleString()}`,
            icon: DollarSign,
            color: "text-teal-400",
            bg: "bg-teal-500/10",
          },
          {
            label: "Pending",
            value: `${stats?.counts?.pending ?? 0}`,
            icon: TrendingUp,
            color: "text-amber-400",
            bg: "bg-amber-500/10",
          },
          {
            label: "Processing",
            value: `${stats?.counts?.processing ?? 0}`,
            icon: CheckCircle2,
            color: "text-blue-400",
            bg: "bg-blue-500/10",
          },
          {
            label: "Approved",
            value: `${stats?.counts?.approved ?? 0}`,
            icon: CheckCircle2,
            color: "text-green-400",
            bg: "bg-green-500/10",
          },
          {
            label: "Rejected",
            value: `${stats?.counts?.rejected ?? 0}`,
            icon: TrendingUp,
            color: "text-rose-400",
            bg: "bg-rose-500/10",
          },
        ].map(card => (
          <Card key={card.label}>
            <CardContent className="p-4 flex items-start gap-3">
              <div className={`p-2 rounded-lg ${card.bg}`}>
                <card.icon className={`w-4 h-4 ${card.color}`} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{card.label}</p>
                <p className="font-bold mt-0.5">{card.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Smart Search Bar */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Smart Search</p>

          {savedFilters.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="text-xs text-muted-foreground font-medium">Saved:</span>
              {savedFilters.map(saved => (
                <span
                  key={saved.id}
                  className="group inline-flex items-center gap-1 rounded-full border border-violet-500/30 bg-violet-500/8 px-2.5 py-0.5 text-xs font-medium text-violet-300 hover:border-violet-500/60 transition-colors"
                >
                  <button
                    onClick={() => applySavedFilter(saved)}
                    className="flex items-center gap-1 hover:text-violet-100 transition-colors"
                    title={`Apply: ${saved.rawInput}`}
                  >
                    <BookmarkCheck className="w-3 h-3 shrink-0" />
                    {saved.name}
                  </button>
                  <button
                    onClick={() => deleteSavedFilter(saved.id)}
                    className="ml-0.5 rounded-full p-0.5 text-violet-400/50 hover:text-rose-400 hover:bg-rose-500/10 transition-colors opacity-0 group-hover:opacity-100"
                    aria-label={`Delete saved filter "${saved.name}"`}
                  >
                    <Trash2 className="w-2.5 h-2.5" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="flex gap-3">
            <div className="relative flex-1">
              <Sparkles className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-violet-400" />
              <Input
                ref={smartInputRef}
                className="pl-9"
                placeholder="Try: pending  ·  approved >5000  ·  rejected this month  ·  >1000  ·  today"
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
                  placeholder="Name this filter (e.g. Large pending settlements)"
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
            Status: <span className="font-mono text-foreground/60">pending</span>, <span className="font-mono text-foreground/60">processing</span>, <span className="font-mono text-foreground/60">approved</span>, <span className="font-mono text-foreground/60">rejected</span>, <span className="font-mono text-foreground/60">paid</span>, <span className="font-mono text-foreground/60">hold</span> — Amount: <span className="font-mono text-foreground/60">{">1000"}</span>, <span className="font-mono text-foreground/60">{"500-5000"}</span> — Date: <span className="font-mono text-foreground/60">today</span>, <span className="font-mono text-foreground/60">this week</span>, <span className="font-mono text-foreground/60">this month</span> — Combine: <span className="font-mono text-foreground/60">approved this month</span>
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
            if (sf.settlementStatus) chips.push({ key: "status", label: sf.settlementStatus.charAt(0).toUpperCase() + sf.settlementStatus.slice(1) });
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

      {/* Filter summary bar */}
      {anyFilterActive && (
        <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <span className="text-xs font-semibold text-violet-400 uppercase tracking-wider mr-1">Filter results</span>
            <div className="flex items-center gap-1.5 text-sm">
              <Hash className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="font-semibold text-foreground">
                {isLoading ? <span className="inline-block w-8 h-3.5 bg-muted/60 rounded animate-pulse" /> : (data?.total ?? 0).toLocaleString()}
              </span>
              <span className="text-muted-foreground">settlements</span>
            </div>
            <div className="flex items-center gap-1.5 text-sm">
              <TrendingUp className="w-3.5 h-3.5 text-amber-400" />
              <span className="font-semibold text-amber-400">
                {isLoading
                  ? <span className="inline-block w-16 h-3.5 bg-muted/60 rounded animate-pulse" />
                  : `₹${(pageItems.reduce((sum, s) => sum + Number(s.requestedAmount ?? s.amount), 0)).toLocaleString()}`}
              </span>
              <span className="text-muted-foreground">page total</span>
            </div>
          </div>
        </div>
      )}

      {/* Bulk action toolbar */}
      {selected.size > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5">
          <div className="flex items-center gap-3 flex-wrap">
            <CheckSquare className="w-4 h-4 text-primary shrink-0" />
            <span className="text-sm font-medium text-primary">
              {selectAllMode ? `All ${total} settlements selected` : `${selected.size} settlement${selected.size !== 1 ? "s" : ""} selected`}
              {!selectAllMode && selectedOffPage > 0 && (
                <span className="text-xs text-primary/60 ml-1.5">(includes {selectedOffPage} from other page{selectedOffPage !== 1 ? "s" : ""})</span>
              )}
            </span>
            <div className="flex gap-2 ml-auto flex-wrap">
              <Button
                size="sm"
                variant="outline"
                className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
                onClick={() => { setBulkRemark(""); setBulkError(""); setBulkAction("approve"); }}
              >
                <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-rose-400 border-rose-500/30 hover:bg-rose-500/10"
                onClick={() => { setBulkRemark(""); setBulkError(""); setBulkAction("reject"); }}
              >
                <X className="w-3.5 h-3.5 mr-1.5" />
                Reject
              </Button>
              <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={clearSelection}>
                Clear
              </Button>
            </div>
          </div>
          {!selectAllMode && allPageSelected && total > pageItems.length && (
            <div className="text-xs text-center text-primary/70 border-t border-primary/20 pt-2">
              All {pageItems.length} settlements on this page are selected.{" "}
              <button
                className="underline text-primary font-medium hover:text-primary/80"
                onClick={handleSelectAllPages}
              >
                Select all {total} settlements
              </button>
            </div>
          )}
          {selectAllMode && (
            <div className="text-xs text-center text-primary/70 border-t border-primary/20 pt-2">
              All {total} settlements are selected.{" "}
              <button
                className="underline text-primary font-medium hover:text-primary/80"
                onClick={clearSelection}
              >
                Clear selection
              </button>
            </div>
          )}
        </div>
      )}

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input className="pl-9" placeholder="Search by merchant name..." value={search} onChange={e => handleSearchChange(e.target.value)} />
              </div>
              <Select value={smartFilter?.settlementStatus ?? status} onValueChange={v => handleStatusChange(v)}>
                <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="processing">Processing</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">From</span>
                <Input
                  type="date"
                  className="w-40"
                  value={smartFilter?.dateFrom ?? dateFrom}
                  onChange={e => {
                    if (smartFilter) clearSmartFilter();
                    setDateFrom(e.target.value); setPage(1); clearSelection();
                  }}
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">To</span>
                <Input
                  type="date"
                  className="w-40"
                  value={smartFilter?.dateTo ?? dateTo}
                  onChange={e => {
                    if (smartFilter) clearSmartFilter();
                    setDateTo(e.target.value); setPage(1); clearSelection();
                  }}
                />
              </div>
              {(dateFrom || dateTo || smartFilter?.dateFrom || smartFilter?.dateTo) && (
                <Button variant="ghost" size="sm" onClick={() => { setDateFrom(""); setDateTo(""); if (smartFilter) clearSmartFilter(); clearSelection(); }}>
                  <X className="w-3.5 h-3.5 mr-1" /> Clear
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={allPageSelected ? true : somePageSelected ? "indeterminate" : false}
                    onCheckedChange={toggleSelectAll}
                    aria-label="Select all on this page"
                  />
                </TableHead>
                <TableHead className="w-8" />
                <TableHead>Merchant</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Requested</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>{Array.from({ length: 7 }).map((_, j) => <TableCell key={j}><div className="h-4 bg-muted/50 rounded animate-pulse" /></TableCell>)}</TableRow>
              )) : pageItems.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-10">
                    {anyFilterActive ? (
                      <div className="space-y-2">
                        <p>No settlements match the current filters</p>
                        {hasSmartFilter && (
                          <Button variant="ghost" size="sm" onClick={clearSmartFilter} className="text-violet-400 hover:text-violet-300">
                            Clear smart filter
                          </Button>
                        )}
                      </div>
                    ) : "No settlements found"}
                  </TableCell>
                </TableRow>
              ) : pageItems.map(s => {
                const isExpanded = expandedId === s.id;
                const amount = Number(s.requestedAmount ?? s.amount);
                return (
                  <>
                    <TableRow key={s.id} className={selected.has(s.id) ? "bg-primary/5" : undefined}>
                      <TableCell>
                        <Checkbox
                          checked={selected.has(s.id)}
                          onCheckedChange={() => toggleSelect(s.id)}
                          aria-label={`Select settlement ${s.id}`}
                        />
                      </TableCell>
                      <TableCell className="w-8">
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : s.id)}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </button>
                      </TableCell>
                      <TableCell className="font-medium">{s.merchantName || "—"}</TableCell>
                      <TableCell className="text-right font-mono font-semibold">₹{amount.toLocaleString()}</TableCell>
                      <TableCell><StatusBadge status={s.status} /></TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {format(new Date(s.createdAt), "MMM d, yyyy")}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                              <MoreHorizontal className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {s.status === "pending" && (
                              <>
                                <DropdownMenuItem
                                  className="text-blue-400"
                                  onClick={() => openAction(s.id, "process", s.merchantName, amount, s.merchantId)}
                                >
                                  Mark Processing
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="text-rose-400"
                                  onClick={() => openAction(s.id, "reject", s.merchantName, amount, s.merchantId)}
                                >
                                  Reject
                                </DropdownMenuItem>
                              </>
                            )}
                            {s.status === "processing" && (
                              <>
                                <DropdownMenuItem
                                  className="text-emerald-400"
                                  onClick={() => openAction(s.id, "approve", s.merchantName, amount, s.merchantId)}
                                >
                                  Approve
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="text-rose-400"
                                  onClick={() => openAction(s.id, "reject", s.merchantName, amount, s.merchantId)}
                                >
                                  Reject
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-amber-400"
                                  onClick={() => openAction(s.id, "hold", s.merchantName, amount, s.merchantId)}
                                >
                                  Put on Hold
                                </DropdownMenuItem>
                              </>
                            )}
                            {s.status === "approved" && (
                              <DropdownMenuItem
                                className="text-teal-400"
                                onClick={() => openAction(s.id, "mark-paid", s.merchantName, amount, s.merchantId)}
                              >
                                Mark as Paid
                              </DropdownMenuItem>
                            )}
                            {(s.status === "rejected" || s.status === "paid") && (
                              <DropdownMenuItem disabled className="text-muted-foreground text-xs">
                                No actions available
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow key={`${s.id}-detail`} className="bg-muted/10">
                        <TableCell />
                        <TableCell />
                        <TableCell colSpan={5} className="py-3">
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                            {s.requestedNote && (
                              <div>
                                <p className="text-xs text-muted-foreground mb-0.5">Merchant Note</p>
                                <p className="font-medium">{s.requestedNote}</p>
                              </div>
                            )}
                            {s.adminRemark && (
                              <div>
                                <p className="text-xs text-muted-foreground mb-0.5">Admin Remark</p>
                                <p className="font-medium">{s.adminRemark}</p>
                              </div>
                            )}
                            {s.referenceNumber && (
                              <div>
                                <p className="text-xs text-muted-foreground mb-0.5">Reference</p>
                                <Badge variant="outline" className="font-mono text-xs">{s.referenceNumber}</Badge>
                              </div>
                            )}
                            {s.paidAt && (
                              <div>
                                <p className="text-xs text-muted-foreground mb-0.5">Paid At</p>
                                <p className="font-medium">{format(new Date(s.paidAt), "MMM d, yyyy HH:mm")}</p>
                              </div>
                            )}
                            {s.processedAt && (
                              <div>
                                <p className="text-xs text-muted-foreground mb-0.5">Processed At</p>
                                <p className="font-medium">{format(new Date(s.processedAt), "MMM d, yyyy HH:mm")}</p>
                              </div>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {data && data.total > 20 && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            Showing {pageItems.length} of {data.total}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button>
            <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page * 20 >= data.total}>Next</Button>
          </div>
        </div>
      )}

      {/* Single-row action modal */}
      <Dialog open={!!actionModal} onOpenChange={open => { if (!open) { setActionModal(null); setRemark(""); setRefNumber(""); setActionError(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{actionModal ? actionLabels[actionModal.type] : ""}</DialogTitle>
            <DialogDescription>
              {actionModal && (
                <>
                  Settlement of <span className="font-semibold text-foreground">₹{actionModal.amount.toLocaleString()}</span>
                  {actionModal.merchantName && <> for <span className="font-semibold text-foreground">{actionModal.merchantName}</span></>}
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            {actionModal?.type === "approve" && (
              <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 flex items-center gap-3">
                <div className="p-1.5 rounded-md bg-emerald-500/10 shrink-0">
                  <Wallet className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground mb-0.5">Merchant Available Balance</p>
                  {isMerchantLoading ? (
                    <div className="h-4 w-24 bg-muted/60 rounded animate-pulse" />
                  ) : merchantBalance != null ? (
                    <p className="font-semibold font-mono text-sm text-foreground">₹{merchantBalance.toLocaleString()}</p>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">Unavailable</p>
                  )}
                </div>
              </div>
            )}

            {isOverdraw && (
              <div className="flex items-start gap-2.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-400">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>
                  The settlement amount (₹{actionModal!.amount.toLocaleString()}) exceeds the merchant's available balance (₹{merchantBalance!.toLocaleString()}). Approving will result in a negative balance.
                </span>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="remark">Remark <span className="text-rose-500">*</span></Label>
              <Textarea
                id="remark"
                placeholder="Add a remark for this action..."
                rows={3}
                value={remark}
                onChange={e => setRemark(e.target.value)}
              />
            </div>

            {actionModal?.type === "mark-paid" && (
              <div className="space-y-2">
                <Label htmlFor="refNumber">Reference Number <span className="text-rose-500">*</span></Label>
                <Input
                  id="refNumber"
                  placeholder="e.g. NEFT/UTR reference..."
                  value={refNumber}
                  onChange={e => setRefNumber(e.target.value)}
                />
              </div>
            )}

            {actionError && (
              <p className="text-sm text-rose-500 bg-rose-500/10 border border-rose-500/20 rounded-md px-3 py-2">{actionError}</p>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setActionModal(null)}>Cancel</Button>
              <Button
                onClick={handleAction}
                disabled={isPending}
                className={actionModal ? actionColors[actionModal.type]?.replace("text-", "hover:bg-").replace("400", "500/20") : ""}
              >
                {isPending ? "Processing..." : actionModal ? actionLabels[actionModal.type] : "Confirm"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Bulk action modal */}
      <Dialog open={!!bulkAction} onOpenChange={open => { if (!open) { setBulkAction(null); setBulkRemark(""); setBulkError(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {bulkAction === "approve" ? "Bulk Approve Settlements" : "Bulk Reject Settlements"}
            </DialogTitle>
            <DialogDescription>
              This will {bulkAction} <span className="font-semibold text-foreground">{selected.size} settlement{selected.size !== 1 ? "s" : ""}</span>.
              A single remark will be applied to all.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="bulk-remark">Remark <span className="text-rose-500">*</span></Label>
              <Textarea
                id="bulk-remark"
                placeholder="Add a remark for this bulk action..."
                rows={3}
                value={bulkRemark}
                onChange={e => setBulkRemark(e.target.value)}
              />
            </div>
            {bulkError && (
              <p className="text-sm text-rose-500 bg-rose-500/10 border border-rose-500/20 rounded-md px-3 py-2">{bulkError}</p>
            )}
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setBulkAction(null)}>Cancel</Button>
              <Button
                onClick={handleBulkAction}
                disabled={isPending}
                className={bulkAction === "approve" ? "text-emerald-400 hover:bg-emerald-500/20" : "text-rose-400 hover:bg-rose-500/20"}
              >
                {isPending ? "Processing..." : bulkAction === "approve" ? `Approve ${selected.size}` : `Reject ${selected.size}`}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
