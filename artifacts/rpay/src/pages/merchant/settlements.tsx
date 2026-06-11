import { useState, useRef, useEffect } from "react";
import {
  useListSettlements,
  useCreateSettlement,
  useGetMe,
  useGetMerchant,
  useListWithdrawals,
  useGetSettlementHistory,
  getListSettlementsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle, ChevronDown, ChevronRight, Clock, Plus, CalendarRange, X,
  Search, Sparkles, Bookmark, BookmarkCheck, Trash2, Hash, TrendingUp,
  CheckCircle2, XCircle, Loader2, PauseCircle, Banknote, Send,
} from "lucide-react";
import { getApiErrorMessage, isRateLimitError } from "@/lib/utils";
import { RateLimitBanner, useRateLimit } from "@/components/ui/rate-limit-banner";
import {
  format, subDays, startOfMonth, endOfMonth, subMonths,
  startOfWeek, endOfWeek, startOfDay, endOfDay, parseISO, isValid,
} from "date-fns";

// ── Smart search types & parsing ─────────────────────────────────────────────

type SettlementStatusFilter = "pending" | "processing" | "paid" | "rejected";

interface SmartFilter {
  amountMin?: number;
  amountMax?: number;
  dateFrom?: string;
  dateTo?: string;
  settlementStatus?: SettlementStatusFilter;
}

const STATUS_KEYWORDS: Record<string, SettlementStatusFilter> = {
  pending: "pending",
  processing: "processing",
  paid: "paid",
  rejected: "rejected",
  approved: "paid",
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
    if (token in STATUS_KEYWORDS) { filter.settlementStatus = STATUS_KEYWORDS[token]!; continue; }
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

// ── Saved filters ─────────────────────────────────────────────────────────────

interface SavedFilter {
  id: string;
  name: string;
  filter: SmartFilter;
  rawInput: string;
}

const SAVED_FILTERS_KEY = "rasokart_merchant_settlements_saved_filters";

function loadSavedFilters(): SavedFilter[] {
  try {
    const raw = localStorage.getItem(SAVED_FILTERS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SavedFilter[];
  } catch { return []; }
}

function storeSavedFilters(filters: SavedFilter[]): void {
  localStorage.setItem(SAVED_FILTERS_KEY, JSON.stringify(filters));
}

// ── Date presets ──────────────────────────────────────────────────────────────

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

const CUSTOM_DATE_PRESETS_KEY = "rasokart_custom_date_presets_settlements";
const LAST_DATE_RANGE_KEY = "rasokart_last_date_range_settlements";

function loadLastDateRange(): { from: string; to: string } {
  try {
    const raw = localStorage.getItem(LAST_DATE_RANGE_KEY);
    if (!raw) return { from: "", to: "" };
    const parsed = JSON.parse(raw) as { from: string; to: string };
    if (typeof parsed.from === "string" && typeof parsed.to === "string") return parsed;
    return { from: "", to: "" };
  } catch { return { from: "", to: "" }; }
}

function saveLastDateRange(from: string, to: string): void {
  localStorage.setItem(LAST_DATE_RANGE_KEY, JSON.stringify({ from, to }));
}

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

const SETTLEMENT_STATUSES = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "processing", label: "Processing" },
  { value: "paid", label: "Paid" },
  { value: "rejected", label: "Rejected" },
];

// ── Settlement event config ───────────────────────────────────────────────────

type EventType = "requested" | "processing" | "approved" | "rejected" | "paid" | "held";

const EVENT_CONFIG: Record<EventType, { label: string; icon: React.ReactNode; color: string }> = {
  requested: {
    label: "Settlement Requested",
    icon: <Send className="w-3.5 h-3.5" />,
    color: "text-blue-400 bg-blue-500/10 border-blue-500/30",
  },
  processing: {
    label: "Moved to Processing",
    icon: <Loader2 className="w-3.5 h-3.5" />,
    color: "text-amber-400 bg-amber-500/10 border-amber-500/30",
  },
  approved: {
    label: "Approved",
    icon: <CheckCircle2 className="w-3.5 h-3.5" />,
    color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
  },
  rejected: {
    label: "Rejected",
    icon: <XCircle className="w-3.5 h-3.5" />,
    color: "text-rose-400 bg-rose-500/10 border-rose-500/30",
  },
  paid: {
    label: "Payment Disbursed",
    icon: <Banknote className="w-3.5 h-3.5" />,
    color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
  },
  held: {
    label: "Put On Hold",
    icon: <PauseCircle className="w-3.5 h-3.5" />,
    color: "text-orange-400 bg-orange-500/10 border-orange-500/30",
  },
};

function SettlementTimeline({ settlementId }: { settlementId: number }) {
  const { data, isLoading } = useGetSettlementHistory(settlementId);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Loading action trail…
      </div>
    );
  }

  const events = data?.data ?? [];

  if (events.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic py-1">No recorded events yet.</p>
    );
  }

  return (
    <div className="space-y-0">
      {events.map((ev, idx) => {
        const cfg = EVENT_CONFIG[ev.event as EventType] ?? {
          label: ev.event,
          icon: <Clock className="w-3.5 h-3.5" />,
          color: "text-muted-foreground bg-muted/20 border-border",
        };
        const isLast = idx === events.length - 1;
        return (
          <div key={ev.id} className="flex gap-3">
            {/* Vertical connector + icon */}
            <div className="flex flex-col items-center">
              <div className={`flex items-center justify-center w-6 h-6 rounded-full border shrink-0 ${cfg.color}`}>
                {cfg.icon}
              </div>
              {!isLast && <div className="w-px flex-1 bg-border/50 my-0.5 min-h-[14px]" />}
            </div>
            {/* Content */}
            <div className={`pb-3 ${isLast ? "" : ""}`}>
              <p className="text-sm font-medium leading-tight">{cfg.label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {format(new Date(ev.createdAt), "MMM d, yyyy 'at' HH:mm")}
                {ev.actorEmail && (
                  <span className="ml-1.5">
                    · <span className="text-foreground/70">{ev.actorEmail}</span>
                  </span>
                )}
              </p>
              {ev.note && (
                <p className="text-xs text-muted-foreground mt-1 italic">"{ev.note}"</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function MerchantSettlements() {
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [requestOpen, setRequestOpen] = useState(false);
  const [reqAmount, setReqAmount] = useState("");
  const [reqNote, setReqNote] = useState("");
  const [reqError, setReqError] = useState("");
  const { isRateLimited, secondsLeft, trigger: triggerRateLimit, clear: clearRateLimit } = useRateLimit();
  const [dateFrom, setDateFrom] = useState(() => loadLastDateRange().from);
  const [dateTo, setDateTo] = useState(() => loadLastDateRange().to);
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");

  // ── Smart search state ───────────────────────────────────────────────────
  const [smartInput, setSmartInput] = useState("");
  const [smartFilter, setSmartFilter] = useState<SmartFilter | null>(null);
  const [smartError, setSmartError] = useState("");
  const smartInputRef = useRef<HTMLInputElement>(null);

  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>(() => loadSavedFilters());
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [saveFilterName, setSaveFilterName] = useState("");
  const [saveFilterNameError, setSaveFilterNameError] = useState("");
  const saveNameInputRef = useRef<HTMLInputElement>(null);

  // ── Custom date preset state ─────────────────────────────────────────────
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

  useEffect(() => {
    saveLastDateRange(dateFrom, dateTo);
  }, [dateFrom, dateTo]);

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === SAVED_FILTERS_KEY) {
        setSavedFilters(loadSavedFilters());
      } else if (e.key === CUSTOM_DATE_PRESETS_KEY) {
        setCustomDatePresets(loadCustomDatePresets());
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  // Smart filter takes precedence over status buttons for status; date pickers for dates
  const activeStatus = smartFilter?.settlementStatus ?? (status !== "all" ? (status as SettlementStatusFilter) : undefined);
  const activeDateFrom = smartFilter?.dateFrom ?? (dateFrom || undefined);
  const activeDateTo = smartFilter?.dateTo ?? (dateTo || undefined);
  const amountMin = smartFilter?.amountMin;
  const amountMax = smartFilter?.amountMax;

  // ── Smart search handlers ─────────────────────────────────────────────────
  const applySmartSearch = () => {
    setSmartError("");
    const filter = parseSmartQuery(smartInput);
    if (!filter) {
      setSmartError("Try: pending, paid >500, rejected this week, >500, today");
      return;
    }
    setSmartFilter(filter);
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
  };

  const hasSmartFilter = smartFilter !== null;
  const isCurrentFilterSaved = hasSmartFilter && savedFilters.some(
    f => f.rawInput === smartInput && JSON.stringify(f.filter) === JSON.stringify(smartFilter)
  );

  // ── Date preset handlers ──────────────────────────────────────────────────
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

  // Unified "any filter active" covering both smart search and manual filter controls
  const anyFilterActive = hasSmartFilter || !!(search || status !== "all" || dateFrom || dateTo);

  const clearAllFilters = () => {
    setSmartFilter(null);
    setSmartInput("");
    setSmartError("");
    setShowSaveInput(false);
    setSaveFilterName("");
    setSaveFilterNameError("");
    setSearch("");
    setStatus("all");
    setDateFrom("");
    setDateTo("");
    setShowSaveDatePreset(false);
    setPage(1);
  };

  const qc = useQueryClient();
  const { data: me } = useGetMe();
  const { data: merchantData } = useGetMerchant(me?.merchantId ?? 0);
  const { data, isLoading } = useListSettlements({
    page,
    limit: 20,
    status: activeStatus as any,
    dateFrom: activeDateFrom,
    dateTo: activeDateTo,
  });
  const { data: withdrawalsData } = useListWithdrawals({ limit: 1 });

  // Client-side amount filter applied on top of server results
  const filteredSettlements = (data?.data ?? []).filter(s => {
    const amount = Number(s.requestedAmount ?? s.amount);
    if (amountMin != null && amount < amountMin) return false;
    if (amountMax != null && amount > amountMax) return false;
    return true;
  });

  // Client-side text search on top of amount filter
  const searchTerm = search.toLowerCase();
  const displayedRows = filteredSettlements.filter(s => {
    if (!searchTerm) return true;
    return (
      (s.requestedNote ?? "").toLowerCase().includes(searchTerm) ||
      (s.adminRemark ?? "").toLowerCase().includes(searchTerm) ||
      (s.referenceNumber ?? "").toLowerCase().includes(searchTerm) ||
      (s.actionedByEmail ?? "").toLowerCase().includes(searchTerm) ||
      String(s.id).includes(searchTerm)
    );
  });

  const createMutation = useCreateSettlement({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListSettlementsQueryKey() });
        setRequestOpen(false);
        setReqAmount("");
        setReqNote("");
        setReqError("");
        clearRateLimit();
      },
      onError: (err: unknown) => {
        if (isRateLimitError(err)) {
          triggerRateLimit();
          setReqError("");
        } else {
          setReqError(getApiErrorMessage(err, "Failed to submit request"));
        }
      },
    },
  });

  const handleSubmitRequest = () => {
    setReqError("");
    const amount = parseFloat(reqAmount);
    if (!reqAmount || isNaN(amount) || amount <= 0) {
      setReqError("Please enter a valid amount");
      return;
    }
    createMutation.mutate({ data: { requestedAmount: amount, requestedNote: reqNote || undefined } });
  };

  const balance = merchantData ? Number(merchantData.balance) : 0;
  const latestWithdrawal = withdrawalsData?.data?.[0];

  const inFlightSettlement = (data?.data ?? []).find(s => s.status === "pending" || s.status === "processing");
  const pendingReserved = (data?.data ?? [])
    .filter(s => s.status === "pending" || s.status === "processing")
    .reduce((sum, s) => sum + Number(s.requestedAmount ?? s.amount), 0);
  const availableBalance = balance - pendingReserved;

  const exportCsv = () => {
    if (!data?.data) return;
    const header = ["ID", "Amount", "Status", "Actioned By", "Admin Remark", "Reference", "Note", "Created"];
    const rows = data.data.map(s => [
      String(s.id),
      String(s.requestedAmount ?? s.amount),
      s.status,
      s.actionedByEmail ?? "",
      s.adminRemark ?? "",
      s.referenceNumber ?? "",
      s.requestedNote ?? "",
      s.createdAt,
    ]);
    const csv = [header, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "settlements.csv";
    a.click();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Settlements</h1>
          <p className="text-muted-foreground mt-1">Request and track your settlement payouts</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={exportCsv}>Export CSV</Button>
          <Button
            size="sm"
            disabled={!!inFlightSettlement}
            onClick={() => { setRequestOpen(true); setReqError(""); clearRateLimit(); }}
            title={inFlightSettlement ? "A settlement request is already in progress" : undefined}
          >
            <Plus className="w-4 h-4 mr-1" /> Request Settlement
          </Button>
        </div>
      </div>

      {/* In-flight settlement warning banner */}
      {inFlightSettlement && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-400" />
          <div className="flex-1 min-w-0">
            <span className="font-medium text-amber-200">Settlement request in progress — </span>
            a{" "}
            <span className="font-medium capitalize">{inFlightSettlement.status}</span> request for{" "}
            <span className="font-mono font-semibold">
              ₹{Number(inFlightSettlement.requestedAmount ?? inFlightSettlement.amount).toLocaleString()}
            </span>{" "}
            is already in flight. You can submit another request once it is resolved.{" "}
            <button
              className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-amber-100 transition-colors font-medium"
              onClick={() => setExpandedId(inFlightSettlement.id)}
            >
              <Clock className="w-3 h-3" /> View request
            </button>
          </div>
        </div>
      )}

      {/* Balance summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="border-primary/30">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Available Balance</p>
            <p className="text-xl font-bold mt-1 text-primary">₹{availableBalance.toLocaleString()}</p>
            {pendingReserved > 0 && (
              <p className="text-xs text-amber-400 mt-0.5">₹{pendingReserved.toLocaleString()} reserved</p>
            )}
          </CardContent>
        </Card>
        {[
          { label: "Pending", value: data?.data?.filter(s => s.status === "pending").length ?? "—" },
          { label: "Processing", value: data?.data?.filter(s => s.status === "processing").length ?? "—" },
          { label: "Paid (all time)", value: `₹${(data?.data?.filter(s => s.status === "paid").reduce((a, s) => a + Number(s.requestedAmount ?? s.amount), 0) ?? 0).toLocaleString()}` },
        ].map(card => (
          <Card key={card.label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{card.label}</p>
              <p className="text-xl font-bold mt-1">{card.value}</p>
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
                placeholder="Try: pending  ·  paid >500  ·  rejected this week  ·  >500  ·  today"
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
                  placeholder="Name this filter (e.g. Large payouts)"
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
            Status: <span className="font-mono text-foreground/60">pending</span>, <span className="font-mono text-foreground/60">processing</span>, <span className="font-mono text-foreground/60">paid</span>, <span className="font-mono text-foreground/60">rejected</span> — Amount: <span className="font-mono text-foreground/60">{">500"}</span>, <span className="font-mono text-foreground/60">{"200-999"}</span> — Date: <span className="font-mono text-foreground/60">today</span>, <span className="font-mono text-foreground/60">this week</span>, <span className="font-mono text-foreground/60">this month</span> — Combine: <span className="font-mono text-foreground/60">rejected this week</span>
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

      {/* Unified filter summary bar */}
      {anyFilterActive && (
        <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 px-4 py-3 space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-violet-400 uppercase tracking-wider">Active filters</span>
            {search && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/40 bg-violet-500/10 px-3 py-1 text-xs font-medium text-violet-300">
                Search: <span className="font-mono">{search}</span>
                <button
                  onClick={() => { setSearch(""); setPage(1); }}
                  className="ml-0.5 rounded-full p-0.5 hover:bg-violet-500/20 transition-colors"
                  aria-label="Remove search filter"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            {activeStatus && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/40 bg-violet-500/10 px-3 py-1 text-xs font-medium text-violet-300">
                Status: {activeStatus.charAt(0).toUpperCase() + activeStatus.slice(1)}
                <button
                  onClick={() => {
                    if (smartFilter?.settlementStatus) setSmartFilter(prev => prev ? { ...prev, settlementStatus: undefined } : null);
                    else setStatus("all");
                    setPage(1);
                  }}
                  className="ml-0.5 rounded-full p-0.5 hover:bg-violet-500/20 transition-colors"
                  aria-label="Remove status filter"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            {activeDateFrom && (() => { const d = parseISO(activeDateFrom); return isValid(d) ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/40 bg-violet-500/10 px-3 py-1 text-xs font-medium text-violet-300">
                From: {format(d, "MMM d, yyyy")}
                <button
                  onClick={() => {
                    if (smartFilter?.dateFrom) setSmartFilter(prev => prev ? { ...prev, dateFrom: undefined, dateTo: undefined } : null);
                    else setDateFrom("");
                    setPage(1);
                  }}
                  className="ml-0.5 rounded-full p-0.5 hover:bg-violet-500/20 transition-colors"
                  aria-label="Remove from-date filter"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ) : null; })()}
            {activeDateTo && (() => { const d = parseISO(activeDateTo); return isValid(d) ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/40 bg-violet-500/10 px-3 py-1 text-xs font-medium text-violet-300">
                To: {format(d, "MMM d, yyyy")}
                <button
                  onClick={() => {
                    if (smartFilter?.dateTo) setSmartFilter(prev => prev ? { ...prev, dateFrom: undefined, dateTo: undefined } : null);
                    else setDateTo("");
                    setPage(1);
                  }}
                  className="ml-0.5 rounded-full p-0.5 hover:bg-violet-500/20 transition-colors"
                  aria-label="Remove to-date filter"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ) : null; })()}
            <Button
              variant="ghost"
              size="sm"
              onClick={clearAllFilters}
              className="ml-auto h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 gap-1.5"
            >
              <X className="w-3 h-3" />
              Clear filters
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <div className="flex items-center gap-1.5 text-sm">
              <Hash className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="font-semibold text-foreground">
                {isLoading ? <span className="inline-block w-8 h-3.5 bg-muted/60 rounded animate-pulse" /> : (data?.total ?? 0).toLocaleString()}
              </span>
              <span className="text-muted-foreground">settlements</span>
            </div>
            <div className="flex items-center gap-1.5 text-sm">
              <TrendingUp className="w-3.5 h-3.5 text-primary" />
              <span className="font-semibold text-primary">
                {isLoading
                  ? <span className="inline-block w-16 h-3.5 bg-muted/60 rounded animate-pulse" />
                  : `₹${(displayedRows.reduce((a, s) => a + Number(s.requestedAmount ?? s.amount), 0)).toLocaleString()}`
                }
              </span>
              <span className="text-muted-foreground">total</span>
            </div>
          </div>
        </div>
      )}

      <Card>
        <CardHeader className="pb-4">
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
            {/* Status filter + search row */}
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-xs text-muted-foreground font-medium mr-1">Status:</span>
              {SETTLEMENT_STATUSES.map(s => (
                <Button
                  key={s.value}
                  variant={!hasSmartFilter && status === s.value ? "secondary" : "outline"}
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => { setStatus(s.value); setPage(1); }}
                >
                  {s.label}
                </Button>
              ))}
              <div className="relative ml-2">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  className="h-8 pl-8 pr-8 text-xs w-[200px]"
                  placeholder="Search note, ref, email…"
                  value={search}
                  onChange={e => { setSearch(e.target.value); setPage(1); }}
                />
                {search && (
                  <button
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => { setSearch(""); setPage(1); }}
                    aria-label="Clear search"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
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
                <TableHead className="w-8" />
                <TableHead className="text-right">Requested Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Note</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>{Array.from({ length: 5 }).map((_, j) => <TableCell key={j}><div className="h-4 bg-muted/50 rounded animate-pulse" /></TableCell>)}</TableRow>
              )) : displayedRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-16">
                    <p className="font-medium">{anyFilterActive ? "No settlements match your filters" : "No settlement requests yet"}</p>
                    <p className="text-sm mt-1">{anyFilterActive ? "Try adjusting or clearing your filters" : "Click \"Request Settlement\" to create your first request"}</p>
                  </TableCell>
                </TableRow>
              ) : displayedRows.map(s => {
                const isExpanded = expandedId === s.id;
                return (
                  <>
                    <TableRow
                      key={s.id}
                      className="cursor-pointer hover:bg-muted/30"
                      onClick={() => setExpandedId(isExpanded ? null : s.id)}
                    >
                      <TableCell className="w-8 text-muted-foreground">
                        {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold">
                        ₹{Number(s.requestedAmount ?? s.amount).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={s.status} />
                        {s.actionedByEmail && (
                          <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-[180px]" title={s.actionedByEmail}>
                            {s.status === "paid" ? "Approved" : s.status === "rejected" ? "Rejected" : "Actioned"} by {s.actionedByEmail}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-xs truncate">{s.requestedNote || "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{format(new Date(s.createdAt), "MMM d, yyyy")}</TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow key={`${s.id}-detail`} className="bg-muted/10 hover:bg-muted/10">
                        <TableCell />
                        <TableCell colSpan={4} className="py-4">
                          <div className="flex flex-col gap-4">
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Action Trail</p>
                              <SettlementTimeline settlementId={s.id} />
                            </div>
                            {(s.adminRemark || s.referenceNumber) && (
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm pt-3 border-t border-border/40">
                                {s.adminRemark && (
                                  <div>
                                    <p className="text-xs text-muted-foreground mb-0.5">Latest Admin Remark</p>
                                    <p className="font-medium">{s.adminRemark}</p>
                                  </div>
                                )}
                                {s.referenceNumber && (
                                  <div>
                                    <p className="text-xs text-muted-foreground mb-0.5">Reference Number</p>
                                    <Badge variant="outline" className="font-mono text-xs">{s.referenceNumber}</Badge>
                                  </div>
                                )}
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
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button>
          <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page * 20 >= data.total}>Next</Button>
        </div>
      )}

      {/* Request Settlement Dialog */}
      <Dialog open={requestOpen} onOpenChange={setRequestOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Request Settlement</DialogTitle>
            <DialogDescription>
              Submit a payout request for your available balance. Admin will review and process it.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            <div className="rounded-lg border border-border p-3 bg-muted/30 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Total Balance</span>
                <span className="font-semibold text-foreground">₹{balance.toLocaleString()}</span>
              </div>
              {pendingReserved > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-amber-400">Reserved (pending withdrawal)</span>
                  <span className="font-semibold text-amber-400">− ₹{pendingReserved.toLocaleString()}</span>
                </div>
              )}
              <div className="flex items-center justify-between pt-1 border-t border-border/50">
                <span className="text-sm font-medium">Available to Request</span>
                <span className="font-bold text-lg text-primary">₹{availableBalance.toLocaleString()}</span>
              </div>
            </div>

            {/* Payout account — pre-filled from most recent withdrawal */}
            <div className="rounded-lg border border-border p-3 bg-muted/20 space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Payout Account</p>
              {latestWithdrawal ? (
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Account Holder</span>
                    <span className="font-medium">{latestWithdrawal.accountHolder}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Bank</span>
                    <span className="font-medium">{latestWithdrawal.bankName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Account No.</span>
                    <span className="font-mono font-medium">{"•".repeat(Math.max(0, (latestWithdrawal.bankAccount ?? "").length - 4))}{(latestWithdrawal.bankAccount ?? "").slice(-4)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">IFSC</span>
                    <span className="font-mono font-medium">{latestWithdrawal.ifscCode}</span>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-amber-400">No bank account on file. Please submit a withdrawal request first to register your bank details.</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="reqAmount">Amount (₹) <span className="text-rose-500">*</span></Label>
              <Input
                id="reqAmount"
                type="number"
                min="1"
                max={availableBalance}
                step="0.01"
                placeholder={`Max ₹${availableBalance.toLocaleString()}`}
                value={reqAmount}
                onChange={e => setReqAmount(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="reqNote">Note (optional)</Label>
              <Textarea
                id="reqNote"
                placeholder="Reason or notes for this settlement request..."
                rows={3}
                value={reqNote}
                onChange={e => setReqNote(e.target.value)}
              />
            </div>

            {reqError && (
              <p className="text-sm text-rose-500 bg-rose-500/10 border border-rose-500/20 rounded-md px-3 py-2">{reqError}</p>
            )}

            <RateLimitBanner secondsLeft={secondsLeft} />

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => { setRequestOpen(false); clearRateLimit(); }}>Cancel</Button>
              <Button onClick={handleSubmitRequest} disabled={createMutation.isPending || isRateLimited}>
                {createMutation.isPending ? "Submitting..." : isRateLimited ? `Try again in ${secondsLeft}s` : "Submit Request"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
