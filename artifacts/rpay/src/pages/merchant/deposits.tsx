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
  Sparkles,
  Bookmark,
  BookmarkCheck,
  Layers,
  Pencil,
  ChevronLeft,
  ChevronRight,
  Check,
} from "lucide-react";
import { format, subDays, startOfMonth, endOfMonth, subMonths, startOfWeek, endOfWeek, startOfDay, endOfDay, parseISO, isValid } from "date-fns";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

// ── Smart search types & parsing ──────────────────────────────────────────────

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

// ── URL search param sync ─────────────────────────────────────────────────────

function pushSmartQuery(q: string): void {
  const params = new URLSearchParams(window.location.search);
  if (q) {
    params.set("q", q);
  } else {
    params.delete("q");
  }
  const search = params.toString();
  window.history.pushState(null, "", window.location.pathname + (search ? "?" + search : ""));
}

// ── Saved filters ─────────────────────────────────────────────────────────────

interface SavedFilter {
  id: string;
  name: string;
  filter: SmartFilter;
  rawInput: string;
}

const MERCHANT_DEPOSITS_SAVED_FILTERS_KEY = "rasokart_merchant_deposits_saved_filters";

function loadSavedFilters(): SavedFilter[] {
  try {
    const raw = localStorage.getItem(MERCHANT_DEPOSITS_SAVED_FILTERS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SavedFilter[];
  } catch { return []; }
}

function storeSavedFilters(filters: SavedFilter[]): void {
  localStorage.setItem(MERCHANT_DEPOSITS_SAVED_FILTERS_KEY, JSON.stringify(filters));
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

const CUSTOM_DATE_PRESETS_KEY = "rasokart_custom_date_presets_deposits";
const LAST_DATE_RANGE_KEY = "rasokart_last_date_range_deposits";

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

interface CombinedPreset {
  id: string;
  name: string;
  type: string;
  status: string;
  provider: string;
  dateFrom: string;
  dateTo: string;
  source?: string;
}

const COMBINED_PRESETS_KEY = "rasokart_combined_presets";

function loadCombinedPresets(): CombinedPreset[] {
  try {
    const raw = localStorage.getItem(COMBINED_PRESETS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as CombinedPreset[];
  } catch {
    return [];
  }
}

function storeCombinedPresets(presets: CombinedPreset[]): void {
  localStorage.setItem(COMBINED_PRESETS_KEY, JSON.stringify(presets));
}

const PROVIDER_LABELS: Record<string, string> = {
  phonepe: "PhonePe",
  paytm: "Paytm",
  bharatpe: "BharatPe",
  yono_sbi: "YONO SBI",
  hdfc_smarthub: "HDFC SmartHub",
  upi_id: "UPI",
};

function formatProvider(p: string | null | undefined): string {
  if (!p) return "—";
  return PROVIDER_LABELS[p] ?? p.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
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
  const [dateFrom, setDateFrom] = useState(() => loadLastDateRange().from);
  const [dateTo, setDateTo] = useState(() => loadLastDateRange().to);
  const [page, setPage] = useState(1);
  const [provider, setProvider] = useState("all");
  const [exporting, setExporting] = useState(false);
  const [lastExportCount, setLastExportCount] = useState<number | null>(null);

  // ── Smart search state ───────────────────────────────────────────────────
  const [smartInput, setSmartInput] = useState<string>(() => {
    return new URLSearchParams(window.location.search).get("q") ?? "";
  });
  const [smartFilter, setSmartFilter] = useState<SmartFilter | null>(() => {
    const q = new URLSearchParams(window.location.search).get("q") ?? "";
    return q ? parseSmartQuery(q) : null;
  });
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

  const [allCombinedPresets, setAllCombinedPresets] = useState<CombinedPreset[]>(() => loadCombinedPresets());
  const combinedPresets = allCombinedPresets.filter(p => p.type === "deposit");
  const [showSaveCombinedPreset, setShowSaveCombinedPreset] = useState(false);
  const [saveCombinedPresetName, setSaveCombinedPresetName] = useState("");
  const [saveCombinedPresetNameError, setSaveCombinedPresetNameError] = useState("");
  const saveCombinedPresetNameRef = useRef<HTMLInputElement>(null);

  const [renamingCombinedPresetId, setRenamingCombinedPresetId] = useState<string | null>(null);
  const [renameCombinedValue, setRenameCombinedValue] = useState("");

  useEffect(() => {
    if (showSaveDatePreset) {
      setTimeout(() => saveDatePresetNameRef.current?.focus(), 50);
    }
  }, [showSaveDatePreset]);

  useEffect(() => {
    saveLastDateRange(dateFrom, dateTo);
  }, [dateFrom, dateTo]);

  useEffect(() => {
    if (showSaveCombinedPreset) {
      setTimeout(() => saveCombinedPresetNameRef.current?.focus(), 50);
    }
  }, [showSaveCombinedPreset]);

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === MERCHANT_DEPOSITS_SAVED_FILTERS_KEY) {
        setSavedFilters(loadSavedFilters());
      } else if (e.key === CUSTOM_DATE_PRESETS_KEY) {
        setCustomDatePresets(loadCustomDatePresets());
      } else if (e.key === COMBINED_PRESETS_KEY) {
        setAllCombinedPresets(loadCombinedPresets());
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  useEffect(() => {
    const onPop = () => {
      const q = new URLSearchParams(window.location.search).get("q") ?? "";
      setSmartInput(q);
      setSmartFilter(q ? parseSmartQuery(q) : null);
      setSmartError("");
      setPage(1);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Effective filter values — smart filter takes precedence over manual dropdowns
  const activeStatus = smartFilter?.txStatus ?? (status !== "all" ? status : undefined);
  const activeDateFrom = smartFilter?.dateFrom ?? (dateFrom || undefined);
  const activeDateTo = smartFilter?.dateTo ?? (dateTo || undefined);
  const amountMin = smartFilter?.amountMin;
  const amountMax = smartFilter?.amountMax;

  // ── Smart search handlers ────────────────────────────────────────────────
  const applySmartSearch = () => {
    setSmartError("");
    const filter = parseSmartQuery(smartInput);
    if (!filter) {
      setSmartError("Try: pending, success >500, failed this week, >500, today");
      return;
    }
    setSmartFilter(filter);
    pushSmartQuery(smartInput);
    if (filter.txStatus) setStatus("all");
    setPage(1);
    setShowSaveInput(false);
    setSaveFilterName("");
  };

  const clearSmartFilter = () => {
    setSmartFilter(null);
    setSmartInput("");
    setSmartError("");
    pushSmartQuery("");
    setShowSaveInput(false);
    setSaveFilterName("");
    setSaveFilterNameError("");
    setPage(1);
    smartInputRef.current?.focus();
  };

  const applySavedFilter = (saved: SavedFilter) => {
    setSmartFilter(saved.filter);
    setSmartInput(saved.rawInput);
    pushSmartQuery(saved.rawInput);
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
  };

  const hasSmartFilter = smartFilter !== null;
  const isCurrentFilterSaved = hasSmartFilter && savedFilters.some(
    f => f.rawInput === smartInput && JSON.stringify(f.filter) === JSON.stringify(smartFilter)
  );

  // ── Date preset handlers ─────────────────────────────────────────────────
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

  const applyCombinedPreset = (preset: CombinedPreset) => {
    setStatus(preset.status);
    setProvider(preset.provider);
    setDateFrom(preset.dateFrom);
    setDateTo(preset.dateTo);
    setShowSaveCombinedPreset(false);
    setPage(1);
  };

  const openSaveCombinedPreset = () => {
    setSaveCombinedPresetName("");
    setSaveCombinedPresetNameError("");
    setShowSaveCombinedPreset(true);
  };

  const confirmSaveCombinedPreset = () => {
    const trimmed = saveCombinedPresetName.trim();
    if (!trimmed) {
      setSaveCombinedPresetNameError("Please enter a name for this preset.");
      saveCombinedPresetNameRef.current?.focus();
      return;
    }
    const alreadyExists = allCombinedPresets.some(
      p => p.name.toLowerCase() === trimmed.toLowerCase()
    );
    if (alreadyExists) {
      setSaveCombinedPresetNameError("A preset with this name already exists.");
      saveCombinedPresetNameRef.current?.focus();
      return;
    }
    const newPreset: CombinedPreset = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: trimmed,
      type: "deposit",
      status,
      provider,
      dateFrom,
      dateTo,
      source: "deposits",
    };
    const updated = [...allCombinedPresets, newPreset];
    setAllCombinedPresets(updated);
    storeCombinedPresets(updated);
    setShowSaveCombinedPreset(false);
    setSaveCombinedPresetName("");
    setSaveCombinedPresetNameError("");
  };

  const cancelSaveCombinedPreset = () => {
    setShowSaveCombinedPreset(false);
    setSaveCombinedPresetName("");
    setSaveCombinedPresetNameError("");
  };

  const deleteCombinedPreset = (id: string) => {
    const updated = allCombinedPresets.filter(p => p.id !== id);
    setAllCombinedPresets(updated);
    storeCombinedPresets(updated);
  };

  const startRenameCombinedPreset = (preset: CombinedPreset) => {
    setRenamingCombinedPresetId(preset.id);
    setRenameCombinedValue(preset.name);
  };

  const confirmRenameCombinedPreset = () => {
    if (!renamingCombinedPresetId) return;
    const trimmed = renameCombinedValue.trim();
    if (trimmed) {
      const updated = allCombinedPresets.map(p =>
        p.id === renamingCombinedPresetId ? { ...p, name: trimmed } : p
      );
      setAllCombinedPresets(updated);
      storeCombinedPresets(updated);
    }
    setRenamingCombinedPresetId(null);
    setRenameCombinedValue("");
  };

  const cancelRenameCombinedPreset = () => {
    setRenamingCombinedPresetId(null);
    setRenameCombinedValue("");
  };

  const moveCombinedPreset = (id: string, direction: "left" | "right") => {
    const depositIndices = allCombinedPresets
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => p.type === "deposit")
      .map(({ i }) => i);
    const posInDeposits = depositIndices.findIndex(idx => allCombinedPresets[idx]!.id === id);
    if (posInDeposits === -1) return;
    const newPos = direction === "left" ? posInDeposits - 1 : posInDeposits + 1;
    if (newPos < 0 || newPos >= depositIndices.length) return;
    const updated = [...allCombinedPresets];
    const idxA = depositIndices[posInDeposits]!;
    const idxB = depositIndices[newPos]!;
    [updated[idxA], updated[idxB]] = [updated[idxB]!, updated[idxA]!];
    setAllCombinedPresets(updated);
    storeCombinedPresets(updated);
  };

  const isCombinedPresetActive = (preset: CombinedPreset) =>
    preset.type === "deposit" &&
    status === preset.status && provider === preset.provider &&
    dateFrom === preset.dateFrom && dateTo === preset.dateTo;

  const buildCombinedPresetLabel = (preset: CombinedPreset): string => {
    const parts: string[] = [];
    if (preset.status !== "all") parts.push(preset.status.charAt(0).toUpperCase() + preset.status.slice(1));
    if (preset.provider !== "all") parts.push(formatProvider(preset.provider));
    parts.push(`${preset.dateFrom} – ${preset.dateTo}`);
    return parts.join(" · ");
  };

  const isCustomDateRangeEntered = !!(dateFrom && dateTo);
  const isBuiltInPresetActive = DATE_PRESETS.some(p => {
    const { from, to } = p.getRange();
    return dateFrom === from && dateTo === to;
  });
  const isCustomDateAlreadySaved = customDatePresets.some(p => p.from === dateFrom && p.to === dateTo);
  const canSaveDatePreset = isCustomDateRangeEntered && !isBuiltInPresetActive && !isCustomDateAlreadySaved;

  const hasStatusFilter = status !== "all";
  const hasProviderFilter = provider !== "all";
  const isCombinedPresetAlreadySaved = allCombinedPresets.some(
    p => p.type === "deposit" && p.status === status && p.provider === provider &&
      p.dateFrom === dateFrom && p.dateTo === dateTo
  );
  const canSaveCombinedPreset =
    (hasStatusFilter || hasProviderFilter) &&
    !!(dateFrom && dateTo) &&
    !isCombinedPresetAlreadySaved;

  // ── Simulate payment dialog state ────────────────────────────────────────
  const [showSimulate, setShowSimulate] = useState(false);
  const [simSourceType, setSimSourceType] = useState<"qr" | "va">("qr");
  const [simSourceId, setSimSourceId] = useState("");
  const [simAmount, setSimAmount] = useState("");
  const [simUtr, setSimUtr] = useState("");
  const [simExpected, setSimExpected] = useState<"success" | "failed" | "pending">("success");
  const [simProvider, setSimProvider] = useState("");

  const { data, isLoading } = useListTransactions({
    type: "deposit",
    status: activeStatus as any,
    search: search || undefined,
    dateFrom: activeDateFrom,
    dateTo: activeDateTo,
    connectionProvider: provider !== "all" ? provider as import("@workspace/api-client-react").ListTransactionsConnectionProvider : undefined,
    ...(amountMin != null ? { amountMin } : {}),
    ...(amountMax != null ? { amountMax } : {}),
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

  const anyFilterActive = hasSmartFilter || !!(search || status !== "all" || dateFrom || dateTo || provider !== "all");

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

      {/* Filter summary bar */}
      {anyFilterActive && (
        <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 px-4 py-3 space-y-2.5">
          {/* Row 1: label + active filter chips + clear button */}
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
            {status !== "all" && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/40 bg-violet-500/10 px-3 py-1 text-xs font-medium text-violet-300">
                Status: {status.charAt(0).toUpperCase() + status.slice(1)}
                <button
                  onClick={() => { setStatus("all"); setPage(1); }}
                  className="ml-0.5 rounded-full p-0.5 hover:bg-violet-500/20 transition-colors"
                  aria-label="Remove status filter"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            {dateFrom && (() => { const d = parseISO(dateFrom); return isValid(d) ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/40 bg-violet-500/10 px-3 py-1 text-xs font-medium text-violet-300">
                From: {format(d, "MMM d, yyyy")}
                <button
                  onClick={() => { setDateFrom(""); setPage(1); }}
                  className="ml-0.5 rounded-full p-0.5 hover:bg-violet-500/20 transition-colors"
                  aria-label="Remove from-date filter"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ) : null; })()}
            {dateTo && (() => { const d = parseISO(dateTo); return isValid(d) ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/40 bg-violet-500/10 px-3 py-1 text-xs font-medium text-violet-300">
                To: {format(d, "MMM d, yyyy")}
                <button
                  onClick={() => { setDateTo(""); setPage(1); }}
                  className="ml-0.5 rounded-full p-0.5 hover:bg-violet-500/20 transition-colors"
                  aria-label="Remove to-date filter"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ) : null; })()}
            {provider !== "all" && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/40 bg-violet-500/10 px-3 py-1 text-xs font-medium text-violet-300">
                Provider: {provider.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase())}
                <button
                  onClick={() => { setProvider("all"); setPage(1); }}
                  className="ml-0.5 rounded-full p-0.5 hover:bg-violet-500/20 transition-colors"
                  aria-label="Remove provider filter"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
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
          {/* Row 2: aggregate stats */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
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
          <div className="space-y-3">
            {/* Combined preset chips */}
            {combinedPresets.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                  <Layers className="w-3 h-3" />Presets:
                </span>
                {combinedPresets.map((preset, idx) =>
                  renamingCombinedPresetId === preset.id ? (
                    <span
                      key={preset.id}
                      className="inline-flex items-center gap-1 rounded-full border border-teal-500/60 bg-teal-500/15 text-teal-200 px-2 py-0.5 text-xs font-medium"
                    >
                      <Layers className="w-3 h-3 shrink-0" />
                      <input
                        className="bg-transparent border-none outline-none text-teal-100 w-24 min-w-0 text-xs"
                        value={renameCombinedValue}
                        onChange={e => setRenameCombinedValue(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === "Enter") confirmRenameCombinedPreset();
                          if (e.key === "Escape") cancelRenameCombinedPreset();
                        }}
                        onBlur={confirmRenameCombinedPreset}
                        maxLength={40}
                        autoFocus
                      />
                      <button
                        onClick={confirmRenameCombinedPreset}
                        className="text-teal-400 hover:text-teal-100 transition-colors p-0.5"
                        aria-label="Confirm rename"
                        title="Save name"
                      >
                        <Check className="w-3 h-3" />
                      </button>
                      <button
                        onMouseDown={e => { e.preventDefault(); cancelRenameCombinedPreset(); }}
                        className="text-teal-400/50 hover:text-rose-400 transition-colors p-0.5"
                        aria-label="Cancel rename"
                        title="Cancel"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ) : (
                    <span
                      key={preset.id}
                      className={`group inline-flex items-center gap-1 rounded-full border text-xs font-medium transition-colors ${
                        isCombinedPresetActive(preset)
                          ? "border-teal-500/60 bg-teal-500/15 text-teal-200"
                          : "border-teal-500/30 bg-teal-500/8 text-teal-300 hover:border-teal-500/60"
                      }`}
                    >
                      <button
                        onClick={() => applyCombinedPreset(preset)}
                        className="flex items-center gap-1 pl-2.5 py-1 hover:text-teal-100 transition-colors"
                        title={buildCombinedPresetLabel(preset)}
                      >
                        <Layers className="w-3 h-3 shrink-0" />
                        {preset.name}
                        {preset.source === "transactions" && (
                          <span className="text-[10px] opacity-50 font-normal">(Transactions)</span>
                        )}
                      </button>
                      <button
                        onClick={() => moveCombinedPreset(preset.id, "left")}
                        disabled={idx === 0}
                        className="py-1 px-0.5 text-teal-400/50 hover:text-teal-200 transition-colors opacity-0 group-hover:opacity-100 disabled:pointer-events-none disabled:opacity-0"
                        aria-label={`Move "${preset.name}" left`}
                        title="Move left"
                      >
                        <ChevronLeft className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => moveCombinedPreset(preset.id, "right")}
                        disabled={idx === combinedPresets.length - 1}
                        className="py-1 px-0.5 text-teal-400/50 hover:text-teal-200 transition-colors opacity-0 group-hover:opacity-100 disabled:pointer-events-none disabled:opacity-0"
                        aria-label={`Move "${preset.name}" right`}
                        title="Move right"
                      >
                        <ChevronRight className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => startRenameCombinedPreset(preset)}
                        className="py-1 px-0.5 text-teal-400/50 hover:text-teal-200 transition-colors opacity-0 group-hover:opacity-100"
                        aria-label={`Rename "${preset.name}"`}
                        title="Rename"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => deleteCombinedPreset(preset.id)}
                        className="pr-1.5 pl-0.5 text-teal-400/50 hover:text-rose-400 hover:bg-rose-500/10 rounded-full transition-colors opacity-0 group-hover:opacity-100 py-1 flex items-center"
                        aria-label={`Remove preset "${preset.name}"`}
                        title="Remove this preset"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  )
                )}
              </div>
            )}
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
              {canSaveCombinedPreset && !showSaveCombinedPreset && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 text-xs border-teal-500/40 text-teal-300 hover:bg-teal-500/10 hover:text-teal-200 self-start"
                  onClick={openSaveCombinedPreset}
                  title="Save status + provider + date range as a reusable preset"
                >
                  <Layers className="w-3 h-3 mr-1.5" />
                  Save as preset
                </Button>
              )}
              {(hasStatusFilter || hasProviderFilter) && !!(dateFrom && dateTo) && isCombinedPresetAlreadySaved && (
                <span className="inline-flex items-center gap-1 h-9 px-2.5 text-xs text-teal-400/60 border border-teal-500/20 rounded-md self-start">
                  <Layers className="w-3 h-3" />
                  Saved
                </span>
              )}
            </div>
            {showSaveCombinedPreset && (
              <div className="flex items-start gap-2 pl-1">
                <div className="flex-shrink-0 pt-1">
                  <Layers className="w-3.5 h-3.5 text-teal-400" />
                </div>
                <div className="flex-1">
                  <Input
                    ref={saveCombinedPresetNameRef}
                    className="h-8 text-sm max-w-[260px]"
                    placeholder="Name this preset (e.g. Failed PhonePe Jan)"
                    value={saveCombinedPresetName}
                    onChange={e => { setSaveCombinedPresetName(e.target.value); setSaveCombinedPresetNameError(""); }}
                    onKeyDown={e => {
                      if (e.key === "Enter") confirmSaveCombinedPreset();
                      if (e.key === "Escape") cancelSaveCombinedPreset();
                    }}
                    maxLength={40}
                  />
                  {saveCombinedPresetNameError && (
                    <p className="mt-1 text-xs text-rose-400">{saveCombinedPresetNameError}</p>
                  )}
                </div>
                <Button size="sm" onClick={confirmSaveCombinedPreset} className="h-8 shrink-0">
                  Save
                </Button>
                <Button size="sm" variant="ghost" onClick={cancelSaveCombinedPreset} className="h-8 shrink-0 px-2">
                  <X className="w-4 h-4" />
                </Button>
              </div>
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
                      {anyFilterActive ? (
                        <>
                          <p>No deposits match the current filters</p>
                          <Button variant="ghost" size="sm" onClick={clearAllFilters} className="text-violet-400 hover:text-violet-300">
                            Clear all filters
                          </Button>
                        </>
                      ) : (
                        <>
                          <p>No deposit transactions found</p>
                          <Button size="sm" variant="outline" onClick={() => setShowSimulate(true)}>
                            <Plus className="w-4 h-4 mr-2" />
                            Simulate your first payment
                          </Button>
                        </>
                      )}
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
