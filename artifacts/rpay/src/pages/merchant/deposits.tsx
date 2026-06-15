import { useState, useRef, useEffect } from "react";
import { useSearch } from "wouter";
import { useCrossTabSync } from "@/hooks/use-cross-tab-sync";
import { AllFiltersSheet } from "@/components/merchant/all-filters-sheet";
import {
  useListTransactions,
  useSimulatePayment,
  useListQrCodes,
  useListVirtualAccounts,
  useGetDashboardStats,
  useListMerchantConnections,
  useListMerchantSavedFilters,
  useCreateMerchantSavedFilter,
  useDeleteMerchantSavedFilter,
  useRenameMerchantSavedFilter,
  useReorderMerchantSavedFilters,
} from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
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
  Layers,
  Trash2,
  X,
  Sparkles,
  Bookmark,
  BookmarkCheck,
  Pencil,
  ChevronLeft,
  ChevronRight,
  CreditCard,
} from "lucide-react";
import { format, parseISO, subDays, startOfMonth, endOfMonth, subMonths } from "date-fns";
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

const CUSTOM_DATE_PRESETS_KEY = "rasokart_custom_date_presets";
const LEGACY_PRESETS_KEY_DEPOSITS = "rasokart_custom_date_presets_deposits";

function loadCustomDatePresets(): CustomDatePreset[] {
  try {
    const legacyRaw = localStorage.getItem(LEGACY_PRESETS_KEY_DEPOSITS);
    if (legacyRaw) {
      const legacy = JSON.parse(legacyRaw) as CustomDatePreset[];
      if (Array.isArray(legacy) && legacy.length > 0) {
        const sharedRaw = localStorage.getItem(CUSTOM_DATE_PRESETS_KEY);
        const shared: CustomDatePreset[] = sharedRaw ? (JSON.parse(sharedRaw) as CustomDatePreset[]) : [];
        const seen = new Set(shared.map((p) => p.id));
        const seenSig = new Set(shared.map((p) => `${p.name}|${p.from}|${p.to}`));
        const merged = [...shared];
        for (const p of legacy) {
          if (!seen.has(p.id) && !seenSig.has(`${p.name}|${p.from}|${p.to}`)) {
            merged.push(p);
            seen.add(p.id);
            seenSig.add(`${p.name}|${p.from}|${p.to}`);
          }
        }
        localStorage.setItem(CUSTOM_DATE_PRESETS_KEY, JSON.stringify(merged));
        localStorage.removeItem(LEGACY_PRESETS_KEY_DEPOSITS);
        return merged;
      }
      localStorage.removeItem(LEGACY_PRESETS_KEY_DEPOSITS);
    }
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

interface SmartFilter {
  amountMin?: number;
  amountMax?: number;
  dateFrom?: string;
  dateTo?: string;
  txStatus?: "pending" | "success" | "failed";
  txProvider?: string;
}

const STATUS_KEYWORDS: Record<string, "pending" | "success" | "failed"> = {
  pending: "pending",
  success: "success",
  successful: "success",
  failed: "failed",
  failure: "failed",
};

const PROVIDER_KEYWORDS: Record<string, string> = {
  phonepe: "phonepe",
  paytm: "paytm",
  bharatpe: "bharatpe",
  yono: "yono_sbi",
  yono_sbi: "yono_sbi",
  hdfc: "hdfc_smarthub",
  hdfc_smarthub: "hdfc_smarthub",
  smartpay: "hdfc_smarthub",
  upi: "upi_id",
  upi_id: "upi_id",
};

function parseDateToken(token: string, now: Date): Pick<SmartFilter, "dateFrom" | "dateTo"> | null {
  const { startOfDay, endOfDay, startOfWeek, endOfWeek } = {
    startOfDay: (d: Date) => { const r = new Date(d); r.setHours(0, 0, 0, 0); return r; },
    endOfDay: (d: Date) => { const r = new Date(d); r.setHours(23, 59, 59, 999); return r; },
    startOfWeek: (d: Date) => { const r = new Date(d); const day = r.getDay(); const diff = (day === 0 ? -6 : 1 - day); r.setDate(r.getDate() + diff); r.setHours(0, 0, 0, 0); return r; },
    endOfWeek: (d: Date) => { const r = new Date(d); const day = r.getDay(); const diff = (day === 0 ? 0 : 7 - day); r.setDate(r.getDate() + diff); r.setHours(23, 59, 59, 999); return r; },
  };
  if (token === "today") {
    return { dateFrom: format(startOfDay(now), "yyyy-MM-dd"), dateTo: format(endOfDay(now), "yyyy-MM-dd") };
  }
  if (token === "this week") {
    return { dateFrom: format(startOfWeek(now), "yyyy-MM-dd"), dateTo: format(endOfWeek(now), "yyyy-MM-dd") };
  }
  if (token === "this month") {
    return { dateFrom: format(startOfMonth(now), "yyyy-MM-dd"), dateTo: format(endOfMonth(now), "yyyy-MM-dd") };
  }
  if (token === "last month") {
    const prev = subMonths(now, 1);
    return { dateFrom: format(startOfMonth(prev), "yyyy-MM-dd"), dateTo: format(endOfMonth(prev), "yyyy-MM-dd") };
  }
  if (token === "last week") {
    const prevWeek = subDays(now, 7);
    const pw = startOfWeek(prevWeek);
    const pe = endOfWeek(prevWeek);
    return { dateFrom: format(pw, "yyyy-MM-dd"), dateTo: format(pe, "yyyy-MM-dd") };
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
  if (!raw.trim()) return null;
  const filter: SmartFilter = {};
  const now = new Date();
  const lower = raw.toLowerCase();

  for (const phrase of ["this week", "last week", "this month", "last month"]) {
    if (lower.includes(phrase)) {
      const dateResult = parseDateToken(phrase, now);
      if (dateResult) { Object.assign(filter, dateResult); break; }
    }
  }
  if (!filter.dateFrom && lower.includes("today")) {
    const dateResult = parseDateToken("today", now);
    if (dateResult) Object.assign(filter, dateResult);
  }

  const tokens = lower.split(/\s+/);
  for (const token of tokens) {
    if (STATUS_KEYWORDS[token]) { filter.txStatus = STATUS_KEYWORDS[token]; continue; }
    if (PROVIDER_KEYWORDS[token]) { filter.txProvider = PROVIDER_KEYWORDS[token]; continue; }
    const amtResult = parseAmountToken(token);
    if (amtResult) { Object.assign(filter, amtResult); continue; }
    const bareNum = token.match(/^(\d+(?:\.\d+)?)$/);
    if (bareNum) { filter.amountMin = parseFloat(bareNum[1]!); continue; }
  }

  if (Object.keys(filter).length === 0) return null;
  return filter;
}

interface SavedFilter {
  id: string;
  name: string;
  filter: SmartFilter;
  rawInput: string;
}

const ALL_SAVED_FILTERS_KEY = "rasokart_all_saved_filters";
const LEGACY_DEPOSITS_FILTERS_KEY = "rasokart_merchant_deposits_saved_filters";

function migrateOldDepositFilters(): void {
  try {
    const old = localStorage.getItem(LEGACY_DEPOSITS_FILTERS_KEY);
    if (!old) return;
    const oldFilters = JSON.parse(old) as SavedFilter[];
    if (oldFilters.length > 0) {
      const existing = loadPageFilters("deposits");
      if (existing.length === 0) storePageFilters("deposits", oldFilters);
    }
    localStorage.removeItem(LEGACY_DEPOSITS_FILTERS_KEY);
  } catch {}
}

function loadPageFilters(page: "deposits" | "transactions"): SavedFilter[] {
  try {
    const raw = localStorage.getItem(ALL_SAVED_FILTERS_KEY);
    if (!raw) return [];
    const all = JSON.parse(raw) as Array<SavedFilter & { page: string }>;
    return all.filter(f => f.page === page);
  } catch {
    return [];
  }
}

function storePageFilters(page: "deposits" | "transactions", filters: SavedFilter[]): void {
  try {
    const raw = localStorage.getItem(ALL_SAVED_FILTERS_KEY);
    const all: Array<SavedFilter & { page: string }> = raw ? JSON.parse(raw) : [];
    const others = all.filter(f => f.page !== page);
    const tagged = filters.map(f => ({ ...f, page }));
    localStorage.setItem(ALL_SAVED_FILTERS_KEY, JSON.stringify([...others, ...tagged]));
  } catch {}
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

const LAST_STATUS_KEY_DEPOSITS = "rasokart_last_status_deposits";
const LAST_DATE_FROM_KEY_DEPOSITS = "rasokart_last_date_from_deposits";
const LAST_DATE_TO_KEY_DEPOSITS = "rasokart_last_date_to_deposits";

function loadLastStatus(key: string): string {
  try {
    return localStorage.getItem(key) ?? "all";
  } catch {
    return "all";
  }
}

export default function MerchantDeposits() {
  const queryClient = useQueryClient();
  const searchStr = useSearch();
  const _urlParams = new URLSearchParams(searchStr);
  const [search, setSearch] = useState(() => _urlParams.get("q") ?? "");
  const [status, setStatus] = useState(() => _urlParams.get("status") ?? loadLastStatus(LAST_STATUS_KEY_DEPOSITS));
  const setStatusAndPersist = (v: string) => {
    setStatus(v);
    try { localStorage.setItem(LAST_STATUS_KEY_DEPOSITS, v); } catch {}
  };
  const [dateFrom, setDateFrom] = useState(() => _urlParams.get("from") ?? ((() => { try { return localStorage.getItem(LAST_DATE_FROM_KEY_DEPOSITS) ?? ""; } catch { return ""; } })()));
  const [dateTo, setDateTo] = useState(() => _urlParams.get("to") ?? ((() => { try { return localStorage.getItem(LAST_DATE_TO_KEY_DEPOSITS) ?? ""; } catch { return ""; } })()));
  const [page, setPage] = useState(1);
  const [provider, setProvider] = useState(() => _urlParams.get("provider") ?? "all");
  const [exporting, setExporting] = useState(false);
  const [lastExportCount, setLastExportCount] = useState<number | null>(null);

  const [customDatePresets, setCustomDatePresets] = useState<CustomDatePreset[]>(() => loadCustomDatePresets());

  useCrossTabSync([
    {
      key: CUSTOM_DATE_PRESETS_KEY,
      onUpdate: (raw) => {
        try { setCustomDatePresets(raw ? (JSON.parse(raw) as CustomDatePreset[]) : []); }
        catch { setCustomDatePresets([]); }
      },
    },
    {
      key: ALL_SAVED_FILTERS_KEY,
      onUpdate: (raw) => {
        try { setSavedFilters(raw ? (JSON.parse(raw) as SavedFilter[]) : []); }
        catch { setSavedFilters([]); }
      },
    },
  ]);

  const [showSaveDatePreset, setShowSaveDatePreset] = useState(false);
  const [saveDatePresetName, setSaveDatePresetName] = useState("");
  const [saveDatePresetNameError, setSaveDatePresetNameError] = useState("");
  const saveDatePresetNameRef = useRef<HTMLInputElement>(null);

  // Rename state for custom date preset chips
  const [renamingPresetId, setRenamingPresetId] = useState<string | null>(null);
  const [renamePresetValue, setRenamePresetValue] = useState("");
  const renamePresetInputRef = useRef<HTMLInputElement>(null);

  // Drag-and-drop state for reordering custom date preset chips
  const dragPresetIdRef = useRef<string | null>(null);
  const [draggingPresetId, setDraggingPresetId] = useState<string | null>(null);
  const [dragOverPresetId, setDragOverPresetId] = useState<string | null>(null);

  // Smart filter state
  const [smartInput, setSmartInput] = useState(() => _urlParams.get("smart") ?? "");
  const [smartFilter, setSmartFilter] = useState<SmartFilter | null>(() => {
    const urlSmart = _urlParams.get("smart");
    return urlSmart ? parseSmartQuery(urlSmart) : null;
  });
  const [smartError, setSmartError] = useState("");
  const smartInputRef = useRef<HTMLInputElement>(null);

  // Saved filters state
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>(() => {
    migrateOldDepositFilters();
    return loadPageFilters("deposits");
  });
  const [showAllFilters, setShowAllFilters] = useState(false);
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [saveFilterName, setSaveFilterName] = useState("");
  const [saveFilterNameError, setSaveFilterNameError] = useState("");
  const saveNameInputRef = useRef<HTMLInputElement>(null);

  // Drag-and-drop state for filter chip reordering
  const dragIdRef = useRef<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  // Rename state
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Persist date range to localStorage whenever it changes
  useEffect(() => { try { localStorage.setItem(LAST_DATE_FROM_KEY_DEPOSITS, dateFrom); } catch {} }, [dateFrom]);
  useEffect(() => { try { localStorage.setItem(LAST_DATE_TO_KEY_DEPOSITS, dateTo); } catch {} }, [dateTo]);

  // Sync active filters to the URL so the view is bookmarkable and back-navigation restores state
  useEffect(() => {
    const params = new URLSearchParams();
    if (status && status !== "all") params.set("status", status);
    if (dateFrom) params.set("from", dateFrom);
    if (dateTo) params.set("to", dateTo);
    if (provider && provider !== "all") params.set("provider", provider);
    if (search) params.set("q", search);
    if (smartInput) params.set("smart", smartInput);
    const qs = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (qs ? "?" + qs : ""));
  }, [status, dateFrom, dateTo, provider, search, smartInput]);

  // Server-side saved filters sync
  const FILTER_CONTEXT = "merchant_deposits";
  const filtersInitialized = useRef(false);
  const { data: serverFiltersData, isSuccess: serverFiltersLoaded } = useListMerchantSavedFilters(
    { context: FILTER_CONTEXT },
    { query: { staleTime: Infinity, retry: false } as any },
  );
  const { mutateAsync: createFilterMutation } = useCreateMerchantSavedFilter();
  const { mutateAsync: deleteFilterMutation } = useDeleteMerchantSavedFilter();
  const { mutateAsync: renameFilterMutation } = useRenameMerchantSavedFilter();
  const { mutateAsync: reorderFilterMutation } = useReorderMerchantSavedFilters();

  // Server-side date preset sync
  const PRESET_CONTEXT = "merchant_deposits_date_presets";
  const presetsInitialized = useRef(false);
  const { data: serverPresetsData, isSuccess: serverPresetsLoaded } = useListMerchantSavedFilters(
    { context: PRESET_CONTEXT },
    { query: { staleTime: Infinity, retry: false } as any },
  );
  const { mutateAsync: createPresetMutation } = useCreateMerchantSavedFilter();
  const { mutateAsync: deletePresetMutation } = useDeleteMerchantSavedFilter();
  const { mutateAsync: renamePresetMutation } = useRenameMerchantSavedFilter();
  const { mutateAsync: reorderPresetMutation } = useReorderMerchantSavedFilters();

  useEffect(() => {
    if (!serverFiltersLoaded || filtersInitialized.current) return;
    filtersInitialized.current = true;
    const serverFilters: SavedFilter[] = (serverFiltersData?.data ?? []).map(f => ({
      id: String(f.id),
      name: f.name,
      filter: f.filterData as SmartFilter,
      rawInput: f.rawInput,
    }));
    if (serverFilters.length > 0) {
      setSavedFilters(serverFilters);
      storePageFilters("deposits", serverFilters);
    } else {
      const local = loadPageFilters("deposits");
      if (local.length > 0) {
        (async () => {
          const imported: SavedFilter[] = [];
          for (const f of local) {
            try {
              const created = await createFilterMutation({
                data: { name: f.name, rawInput: f.rawInput, filterData: f.filter as Record<string, unknown>, context: FILTER_CONTEXT },
              });
              imported.push({ id: String(created.id), name: created.name, filter: created.filterData as SmartFilter, rawInput: created.rawInput });
            } catch { /* skip duplicates or errors */ }
          }
          if (imported.length > 0) {
            setSavedFilters(imported);
            storePageFilters("deposits", imported);
          }
        })();
      }
    }
  }, [serverFiltersLoaded, serverFiltersData]);

  useEffect(() => {
    if (!serverPresetsLoaded || presetsInitialized.current) return;
    presetsInitialized.current = true;
    const serverPresets: CustomDatePreset[] = (serverPresetsData?.data ?? []).map(f => ({
      id: String(f.id),
      name: f.name,
      from: (f.filterData as Record<string, string>)["from"] ?? "",
      to: (f.filterData as Record<string, string>)["to"] ?? "",
    }));
    if (serverPresets.length > 0) {
      setCustomDatePresets(serverPresets);
      storeCustomDatePresets(serverPresets);
    } else {
      const local = loadCustomDatePresets();
      if (local.length > 0) {
        (async () => {
          const imported: CustomDatePreset[] = [];
          for (const p of local) {
            try {
              const created = await createPresetMutation({
                data: { name: p.name, rawInput: `${p.from} to ${p.to}`, filterData: { from: p.from, to: p.to }, context: PRESET_CONTEXT },
              });
              imported.push({
                id: String(created.id),
                name: created.name,
                from: (created.filterData as Record<string, string>)["from"] ?? p.from,
                to: (created.filterData as Record<string, string>)["to"] ?? p.to,
              });
            } catch { /* skip duplicates or errors */ }
          }
          if (imported.length > 0) {
            setCustomDatePresets(imported);
            storeCustomDatePresets(imported);
          }
        })();
      }
    }
  }, [serverPresetsLoaded, serverPresetsData]);

  useEffect(() => {
    if (showSaveDatePreset) {
      setTimeout(() => saveDatePresetNameRef.current?.focus(), 50);
    }
  }, [showSaveDatePreset]);

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

  useEffect(() => {
    if (renamingPresetId) {
      setTimeout(() => renamePresetInputRef.current?.focus(), 50);
    }
  }, [renamingPresetId]);

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

  const confirmSaveDatePreset = async () => {
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
    try {
      const created = await createPresetMutation({
        data: { name: trimmed, rawInput: `${dateFrom} to ${dateTo}`, filterData: { from: dateFrom, to: dateTo }, context: PRESET_CONTEXT },
      });
      const newPreset: CustomDatePreset = {
        id: String(created.id),
        name: created.name,
        from: (created.filterData as Record<string, string>)["from"] ?? dateFrom,
        to: (created.filterData as Record<string, string>)["to"] ?? dateTo,
      };
      const updated = [...customDatePresets, newPreset];
      setCustomDatePresets(updated);
      storeCustomDatePresets(updated);
    } catch {
      toast.error("Failed to save preset. Please try again.");
    }
    setShowSaveDatePreset(false);
    setSaveDatePresetName("");
    setSaveDatePresetNameError("");
  };

  const cancelSaveDatePreset = () => {
    setShowSaveDatePreset(false);
    setSaveDatePresetName("");
    setSaveDatePresetNameError("");
  };

  const deleteCustomDatePreset = async (id: string) => {
    const updated = customDatePresets.filter(p => p.id !== id);
    setCustomDatePresets(updated);
    storeCustomDatePresets(updated);
    if (renamingPresetId === id) setRenamingPresetId(null);
    const numericId = parseInt(id);
    if (!isNaN(numericId)) {
      try {
        await deletePresetMutation({ id: numericId });
      } catch { /* optimistic delete already applied locally */ }
    }
  };

  const moveCustomDatePreset = async (id: string, dir: -1 | 1) => {
    const idx = customDatePresets.findIndex(p => p.id === id);
    if (idx === -1) return;
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= customDatePresets.length) return;
    const updated = [...customDatePresets];
    [updated[idx], updated[newIdx]] = [updated[newIdx]!, updated[idx]!];
    setCustomDatePresets(updated);
    storeCustomDatePresets(updated);
    const ids = updated.map(p => parseInt(p.id)).filter(n => !isNaN(n));
    try {
      await reorderPresetMutation({ data: { ids, context: PRESET_CONTEXT } });
    } catch { /* optimistic reorder already applied locally */ }
  };

  const handlePresetDragStart = (id: string) => {
    dragPresetIdRef.current = id;
    setDraggingPresetId(id);
  };
  const handlePresetDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    if (dragPresetIdRef.current !== id) setDragOverPresetId(id);
  };
  const handlePresetDragLeave = () => { setDragOverPresetId(null); };
  const handlePresetDrop = (targetId: string) => {
    const sourceId = dragPresetIdRef.current;
    setDragOverPresetId(null);
    setDraggingPresetId(null);
    dragPresetIdRef.current = null;
    if (!sourceId || sourceId === targetId) return;
    const fromIdx = customDatePresets.findIndex(p => p.id === sourceId);
    const toIdx = customDatePresets.findIndex(p => p.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const updated = [...customDatePresets];
    const [item] = updated.splice(fromIdx, 1);
    updated.splice(toIdx, 0, item!);
    setCustomDatePresets(updated);
    storeCustomDatePresets(updated);
    const ids = updated.map(p => parseInt(p.id)).filter(n => !isNaN(n));
    reorderPresetMutation({ data: { ids, context: PRESET_CONTEXT } }).catch(() => {});
  };
  const handlePresetDragEnd = () => {
    dragPresetIdRef.current = null;
    setDraggingPresetId(null);
    setDragOverPresetId(null);
  };

  const startRenamePreset = (preset: CustomDatePreset) => {
    setRenamingPresetId(preset.id);
    setRenamePresetValue(preset.name);
  };

  const commitRenamePreset = async () => {
    if (!renamingPresetId) return;
    const trimmed = renamePresetValue.trim();
    if (!trimmed) { setRenamingPresetId(null); return; }
    if (customDatePresets.some(p => p.id !== renamingPresetId && p.name.toLowerCase() === trimmed.toLowerCase())) {
      toast.error("A preset with this name already exists.");
      return;
    }
    const updated = customDatePresets.map(p => p.id === renamingPresetId ? { ...p, name: trimmed } : p);
    setCustomDatePresets(updated);
    storeCustomDatePresets(updated);
    setRenamingPresetId(null);
    const numericId = parseInt(renamingPresetId);
    if (!isNaN(numericId)) {
      try {
        await renamePresetMutation({ id: numericId, data: { name: trimmed } });
      } catch { /* optimistic rename already applied locally */ }
    }
  };

  const cancelRenamePreset = () => { setRenamingPresetId(null); };

  // Smart filter handlers
  const applySmartSearch = () => {
    setSmartError("");
    const filter = parseSmartQuery(smartInput);
    if (!filter) {
      setSmartError("Try: pending, success >500, failed this week, >500, today");
      return;
    }
    setSmartFilter(filter);
    if (filter.txStatus) setStatus("all");
    if (filter.dateFrom || filter.dateTo) { setDateFrom(""); setDateTo(""); }
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
    if (saved.filter.dateFrom || saved.filter.dateTo) { setDateFrom(""); setDateTo(""); }
    setPage(1);
  };

  const openSaveInput = () => {
    setSaveFilterName("");
    setSaveFilterNameError("");
    setShowSaveInput(true);
  };

  const confirmSaveFilter = async () => {
    const trimmed = saveFilterName.trim();
    if (!trimmed) { setSaveFilterNameError("Please enter a name."); saveNameInputRef.current?.focus(); return; }
    if (!smartFilter) return;
    if (savedFilters.some(f => f.name.toLowerCase() === trimmed.toLowerCase())) {
      setSaveFilterNameError("A filter with this name already exists."); saveNameInputRef.current?.focus(); return;
    }
    try {
      const created = await createFilterMutation({
        data: { name: trimmed, rawInput: smartInput, filterData: smartFilter as Record<string, unknown>, context: FILTER_CONTEXT },
      });
      const newFilter: SavedFilter = {
        id: String(created.id),
        name: created.name,
        filter: created.filterData as SmartFilter,
        rawInput: created.rawInput,
      };
      const updated = [...savedFilters, newFilter];
      setSavedFilters(updated);
      storePageFilters("deposits", updated);
      setShowSaveInput(false);
      setSaveFilterName("");
      setSaveFilterNameError("");
    } catch {
      toast.error("Failed to save filter. Please try again.");
    }
  };

  const cancelSaveFilter = () => { setShowSaveInput(false); setSaveFilterName(""); setSaveFilterNameError(""); };

  const deleteSavedFilter = async (id: string) => {
    const updated = savedFilters.filter(f => f.id !== id);
    setSavedFilters(updated);
    storePageFilters("deposits", updated);
    if (renamingId === id) setRenamingId(null);
    const numericId = parseInt(id);
    if (!isNaN(numericId)) {
      try {
        await deleteFilterMutation({ id: numericId });
      } catch { /* optimistic delete already applied locally */ }
    }
  };

  const moveSavedFilter = async (id: string, dir: -1 | 1) => {
    const idx = savedFilters.findIndex(f => f.id === id);
    if (idx === -1) return;
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= savedFilters.length) return;
    const updated = [...savedFilters];
    [updated[idx], updated[newIdx]] = [updated[newIdx]!, updated[idx]!];
    setSavedFilters(updated);
    storePageFilters("deposits", updated);
    const ids = updated.map(f => parseInt(f.id)).filter(n => !isNaN(n));
    try {
      await reorderFilterMutation({ data: { ids, context: FILTER_CONTEXT } });
    } catch { /* optimistic reorder already applied locally */ }
  };

  const handleDragStart = (id: string) => {
    dragIdRef.current = id;
    setDraggingId(id);
  };
  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    if (dragIdRef.current !== id) setDragOverId(id);
  };
  const handleDragLeave = () => { setDragOverId(null); };
  const handleDrop = (targetId: string) => {
    const sourceId = dragIdRef.current;
    setDragOverId(null);
    setDraggingId(null);
    dragIdRef.current = null;
    if (!sourceId || sourceId === targetId) return;
    const fromIdx = savedFilters.findIndex(f => f.id === sourceId);
    const toIdx = savedFilters.findIndex(f => f.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const updated = [...savedFilters];
    const [item] = updated.splice(fromIdx, 1);
    updated.splice(toIdx, 0, item!);
    setSavedFilters(updated);
    storePageFilters("deposits", updated);
    const ids = updated.map(f => parseInt(f.id)).filter(n => !isNaN(n));
    reorderFilterMutation({ data: { ids, context: FILTER_CONTEXT } }).catch(() => {});
  };
  const handleDragEnd = () => {
    dragIdRef.current = null;
    setDraggingId(null);
    setDragOverId(null);
  };

  const startRename = (saved: SavedFilter) => {
    setRenamingId(saved.id);
    setRenameValue(saved.name);
  };

  const commitRename = async () => {
    if (!renamingId) return;
    const trimmed = renameValue.trim();
    if (!trimmed) { setRenamingId(null); return; }
    if (savedFilters.some(f => f.id !== renamingId && f.name.toLowerCase() === trimmed.toLowerCase())) {
      toast.error("A filter with this name already exists.");
      return;
    }
    const updated = savedFilters.map(f => f.id === renamingId ? { ...f, name: trimmed } : f);
    setSavedFilters(updated);
    storePageFilters("deposits", updated);
    setRenamingId(null);
    const numericId = parseInt(renamingId);
    if (!isNaN(numericId)) {
      try {
        await renameFilterMutation({ id: numericId, data: { name: trimmed } });
      } catch { /* optimistic rename already applied locally */ }
    }
  };

  const cancelRename = () => { setRenamingId(null); };

  const isCustomDateRangeEntered = !!(dateFrom && dateTo);
  const isBuiltInPresetActive = DATE_PRESETS.some(p => {
    const { from, to } = p.getRange();
    return dateFrom === from && dateTo === to;
  });
  const isCustomDateAlreadySaved = customDatePresets.some(p => p.from === dateFrom && p.to === dateTo);
  const canSaveDatePreset = isCustomDateRangeEntered && !isBuiltInPresetActive && !isCustomDateAlreadySaved;

  // Cashfree payment dialog state
  const [showCashfree, setShowCashfree] = useState(false);
  const [cfAmount, setCfAmount] = useState("");
  const [cfPhone, setCfPhone] = useState("");
  const [cfName, setCfName] = useState("");
  const [cfEmail, setCfEmail] = useState("");
  const [cfNote, setCfNote] = useState("");
  const [cfCreating, setCfCreating] = useState(false);

  const { data: cashfreeStatusData } = useQuery<{ enabled: boolean }>({
    queryKey: ["/api/merchant/payment/status"],
    queryFn: async () => {
      const token = localStorage.getItem("rasokart_token");
      const res = await fetch("/api/merchant/payment/status", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return { enabled: false };
      return res.json() as Promise<{ enabled: boolean }>;
    },
    staleTime: 60_000,
  });
  const cashfreeEnabled = cashfreeStatusData?.enabled ?? false;

  const handleCashfreePay = async () => {
    if (!cfAmount || Number(cfAmount) <= 0) { toast.error("Enter a valid amount"); return; }
    if (!cfPhone.trim()) { toast.error("Customer phone number is required"); return; }
    setCfCreating(true);
    try {
      const authToken = localStorage.getItem("rasokart_token");
      const res = await fetch("/api/merchant/payment/create-order", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({
          amount: Number(cfAmount),
          customerPhone: cfPhone.trim(),
          customerName: cfName.trim() || undefined,
          customerEmail: cfEmail.trim() || undefined,
          note: cfNote.trim() || undefined,
        }),
      });
      const result = await res.json() as {
        publicOrderId?: string;
        checkoutUrl?: string;
        amount?: number;
        status?: string;
        message?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(result.error ?? "Failed to create payment order");
      if (!result.checkoutUrl) throw new Error("Invalid payment order response");
      setShowCashfree(false);
      setCfAmount(""); setCfPhone(""); setCfName(""); setCfEmail(""); setCfNote("");
      toast.success("Payment order created — opening checkout…");
      window.open(result.checkoutUrl, "_blank", "noopener,noreferrer");
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to create payment order");
    } finally {
      setCfCreating(false);
    }
  };

  // Simulate payment dialog state
  const [showSimulate, setShowSimulate] = useState(false);
  const [simSourceType, setSimSourceType] = useState<"qr" | "va">("qr");
  const [simSourceId, setSimSourceId] = useState("");
  const [simAmount, setSimAmount] = useState("");
  const [simUtr, setSimUtr] = useState("");
  const [simExpected, setSimExpected] = useState<"success" | "failed" | "pending">("success");
  const [simProvider, setSimProvider] = useState("");

  const activeStatus = smartFilter?.txStatus ?? (status !== "all" ? status : undefined);
  const activeDateFrom = smartFilter?.dateFrom ?? (dateFrom || undefined);
  const activeDateTo = smartFilter?.dateTo ?? (dateTo || undefined);
  const activeProvider = smartFilter?.txProvider ?? (provider !== "all" ? provider : undefined);
  const rangeSummary = (() => {
    const from = activeDateFrom ?? "";
    const to = activeDateTo ?? "";
    const hasFrom = !!from;
    const hasTo = !!to;
    let label: string | null = null;
    if (hasFrom && hasTo) {
      const builtIn = DATE_PRESETS.find(p => { const r = p.getRange(); return r.from === from && r.to === to; });
      if (builtIn) label = builtIn.label;
      else { const custom = customDatePresets.find(p => p.from === from && p.to === to); if (custom) label = custom.name; }
    }
    const fmt = (s: string) => { try { return format(parseISO(s), "d MMM yyyy"); } catch { return s; } };
    if (!hasFrom && !hasTo) return "All time";
    if (hasFrom && hasTo) { const r = `${fmt(from)} – ${fmt(to)}`; return label ? `${label} · ${r}` : `Custom range · ${r}`; }
    if (hasFrom) return `From ${fmt(from)}`;
    return `Until ${fmt(to)}`;
  })();
  const amountMin = smartFilter?.amountMin;
  const amountMax = smartFilter?.amountMax;

  const { data, isLoading } = useListTransactions({
    type: "deposit",
    status: activeStatus as any,
    search: search || undefined,
    dateFrom: activeDateFrom,
    dateTo: activeDateTo,
    connectionProvider: activeProvider as import("@workspace/api-client-react").ListTransactionsConnectionProvider,
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

  const hasSmartFilter = smartFilter !== null;
  const isCurrentFilterSaved = hasSmartFilter && savedFilters.some(
    f => f.rawInput === smartInput && JSON.stringify(f.filter) === JSON.stringify(smartFilter)
  );
  const anyFilterActive = !!(hasSmartFilter || search || status !== "all" || dateFrom || dateTo || provider !== "all");

  const clearFilters = () => {
    setSearch("");
    setStatusAndPersist("all");
    setDateFrom("");
    setDateTo("");
    setProvider("all");
    setSmartFilter(null);
    setSmartInput("");
    setSmartError("");
    setShowSaveInput(false);
    setSaveFilterName("");
    setSaveFilterNameError("");
    setPage(1);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Deposits</h1>
          <p className="text-muted-foreground mt-1">All incoming payments via QR and Virtual Accounts</p>
        </div>
        <div className="flex flex-wrap gap-2">
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
          {cashfreeEnabled && (
            <Button size="sm" variant="outline" onClick={() => setShowCashfree(true)} className="border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300 hover:border-emerald-500/50">
              <CreditCard className="w-4 h-4 mr-2" />
              Pay via RasoKart
            </Button>
          )}
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
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Smart Search</p>
            <button
              onClick={() => setShowAllFilters(true)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              title="View and manage saved filters across all pages"
            >
              <Layers className="w-3.5 h-3.5" />
              Manage all filters
            </button>
          </div>

          {/* Saved filter chips */}
          {savedFilters.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="text-xs text-muted-foreground font-medium">Saved:</span>
              {savedFilters.map((saved, idx) => (
                <span
                  key={saved.id}
                  draggable={renamingId !== saved.id}
                  onDragStart={() => handleDragStart(saved.id)}
                  onDragOver={(e) => handleDragOver(e, saved.id)}
                  onDragLeave={handleDragLeave}
                  onDrop={() => handleDrop(saved.id)}
                  onDragEnd={handleDragEnd}
                  className={[
                    "group inline-flex items-center gap-0.5 rounded-full border border-violet-500/30 bg-violet-500/8 text-xs font-medium text-violet-300 hover:border-violet-500/60 transition-colors select-none",
                    renamingId !== saved.id ? "cursor-grab active:cursor-grabbing" : "",
                    draggingId === saved.id ? "opacity-40 scale-95" : "",
                    dragOverId === saved.id && draggingId !== saved.id ? "ring-1 ring-violet-400 border-violet-500/60 bg-violet-500/15" : "",
                  ].filter(Boolean).join(" ")}
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
                    <button
                      onClick={() => applySavedFilter(saved)}
                      className="flex items-center gap-1 px-1 py-1 hover:text-violet-100 transition-colors"
                      title={`Apply: ${saved.rawInput}`}
                    >
                      <BookmarkCheck className="w-3 h-3 shrink-0" />
                      {saved.name}
                    </button>
                  )}

                  {/* Rename icon (hidden until hover, not shown while renaming) */}
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
                      className="pr-1.5 p-0.5 rounded-r-full text-violet-400/40 hover:text-rose-400 hover:bg-rose-500/10 transition-colors opacity-0 group-hover:opacity-100"
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

          <div className="flex gap-3">
            <div className="relative flex-1">
              <Sparkles className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-violet-400" />
              <Input
                ref={smartInputRef}
                className="pl-9"
                placeholder="Try: pending  ·  success >500  ·  failed this week  ·  >1000  ·  today"
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
                onClick={openSaveInput}
                className="border-violet-500/40 text-violet-300 hover:bg-violet-500/10 hover:text-violet-200"
                title="Save this filter for quick access"
              >
                <Bookmark className="w-4 h-4 mr-2" />Save filter
              </Button>
            )}
            {hasSmartFilter && isCurrentFilterSaved && (
              <Button variant="outline" disabled className="border-violet-500/20 text-violet-400/50 cursor-default">
                <BookmarkCheck className="w-4 h-4 mr-2" />Saved
              </Button>
            )}
            {hasSmartFilter && (
              <Button variant="ghost" size="icon" onClick={clearSmartFilter} title="Clear smart filter">
                <X className="w-4 h-4" />
              </Button>
            )}
          </div>

          {smartError && (
            <p className="mt-2 text-xs text-amber-400">{smartError}</p>
          )}

          {/* Save filter inline form */}
          {showSaveInput && (
            <div className="mt-3 flex items-start gap-2">
              <div className="flex-1">
                <Input
                  ref={saveNameInputRef}
                  className="h-8 text-sm max-w-[260px]"
                  placeholder="Name this filter (e.g. Big pending deposits)"
                  value={saveFilterName}
                  onChange={e => { setSaveFilterName(e.target.value); setSaveFilterNameError(""); }}
                  onKeyDown={e => {
                    if (e.key === "Enter") confirmSaveFilter();
                    if (e.key === "Escape") cancelSaveFilter();
                  }}
                  maxLength={40}
                />
                {saveFilterNameError && (
                  <p className="mt-1 text-xs text-rose-400">{saveFilterNameError}</p>
                )}
              </div>
              <Button size="sm" onClick={confirmSaveFilter} className="h-8 shrink-0">Save</Button>
              <Button size="sm" variant="ghost" onClick={cancelSaveFilter} className="h-8 shrink-0 px-2">
                <X className="w-4 h-4" />
              </Button>
            </div>
          )}

          {/* Active smart filter summary */}
          {hasSmartFilter && smartFilter && (
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              {smartFilter.txStatus && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-500/15 border border-violet-500/30 text-violet-200">
                  Status: {smartFilter.txStatus}
                </span>
              )}
              {smartFilter.amountMin != null && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-500/15 border border-violet-500/30 text-violet-200">
                  Amount ≥ ₹{smartFilter.amountMin.toLocaleString()}
                </span>
              )}
              {smartFilter.amountMax != null && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-500/15 border border-violet-500/30 text-violet-200">
                  Amount ≤ ₹{smartFilter.amountMax.toLocaleString()}
                </span>
              )}
              {smartFilter.dateFrom && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-500/15 border border-violet-500/30 text-violet-200">
                  From: {smartFilter.dateFrom}
                </span>
              )}
              {smartFilter.dateTo && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-500/15 border border-violet-500/30 text-violet-200">
                  To: {smartFilter.dateTo}
                </span>
              )}
              {smartFilter.txProvider && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-500/15 border border-violet-500/30 text-violet-200">
                  Provider: {smartFilter.txProvider}
                </span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

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
            <Select value={status} onValueChange={v => { setStatusAndPersist(v); setPage(1); }}>
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
              {customDatePresets.map((preset, idx) => (
                <span
                  key={preset.id}
                  draggable={renamingPresetId !== preset.id}
                  onDragStart={() => handlePresetDragStart(preset.id)}
                  onDragOver={(e) => handlePresetDragOver(e, preset.id)}
                  onDragLeave={handlePresetDragLeave}
                  onDrop={() => handlePresetDrop(preset.id)}
                  onDragEnd={handlePresetDragEnd}
                  className={[
                    "group inline-flex items-center gap-0.5 rounded-md border text-xs font-medium transition-colors select-none",
                    renamingPresetId !== preset.id ? "cursor-grab active:cursor-grabbing" : "",
                    isCustomDatePresetActive(preset)
                      ? "border-primary/60 bg-primary/15 text-primary"
                      : "border-sky-500/30 bg-sky-500/8 text-sky-300 hover:border-sky-500/60",
                    draggingPresetId === preset.id ? "opacity-40 scale-95" : "",
                    dragOverPresetId === preset.id && draggingPresetId !== preset.id
                      ? "ring-1 ring-sky-400 border-sky-500/60 bg-sky-500/15" : "",
                  ].filter(Boolean).join(" ")}
                >
                  {/* Move left */}
                  {idx > 0 && (
                    <button
                      onClick={() => moveCustomDatePreset(preset.id, -1)}
                      className="pl-1.5 pr-0.5 py-1 rounded-l-md text-sky-400/40 hover:text-sky-200 hover:bg-sky-500/10 transition-colors opacity-0 group-hover:opacity-100"
                      aria-label="Move left"
                      title="Move left"
                    >
                      <ChevronLeft className="w-3 h-3" />
                    </button>
                  )}
                  {idx === 0 && <span className="pl-2" />}

                  {renamingPresetId === preset.id ? (
                    <input
                      ref={renamePresetInputRef}
                      className="w-28 bg-transparent border-b border-sky-400 text-sky-100 text-xs outline-none py-0.5 mx-1"
                      value={renamePresetValue}
                      onChange={e => setRenamePresetValue(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter") commitRenamePreset();
                        if (e.key === "Escape") cancelRenamePreset();
                      }}
                      onBlur={commitRenamePreset}
                      maxLength={40}
                    />
                  ) : (
                    <>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              onClick={() => applyCustomDatePreset(preset)}
                              className="p-0.5 text-sky-300 hover:text-sky-100 transition-colors"
                              title={`Apply: ${preset.from} – ${preset.to}`}
                            >
                              <CalendarRange className="w-3 h-3 shrink-0" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">
                            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">Date range</p>
                            <p className="font-mono text-xs">{preset.from} – {preset.to}</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <button
                        onClick={() => startRenamePreset(preset)}
                        className="px-0.5 py-1 hover:text-sky-100 transition-colors"
                        title="Click to rename"
                      >
                        {preset.name}
                      </button>
                    </>
                  )}

                  {/* Rename icon */}
                  {renamingPresetId !== preset.id && (
                    <button
                      onClick={() => startRenamePreset(preset)}
                      className="p-0.5 text-sky-400/40 hover:text-sky-200 hover:bg-sky-500/10 transition-colors opacity-0 group-hover:opacity-100"
                      aria-label={`Rename preset "${preset.name}"`}
                      title="Rename"
                    >
                      <Pencil className="w-2.5 h-2.5" />
                    </button>
                  )}

                  {/* Delete */}
                  {renamingPresetId !== preset.id && (
                    <button
                      onClick={() => deleteCustomDatePreset(preset.id)}
                      className="p-0.5 text-sky-400/40 hover:text-rose-400 hover:bg-rose-500/10 transition-colors opacity-0 group-hover:opacity-100"
                      aria-label={`Remove preset "${preset.name}"`}
                      title="Remove this preset"
                    >
                      <Trash2 className="w-2.5 h-2.5" />
                    </button>
                  )}

                  {/* Move right */}
                  {idx < customDatePresets.length - 1 && renamingPresetId !== preset.id && (
                    <button
                      onClick={() => moveCustomDatePreset(preset.id, 1)}
                      className="pr-1.5 pl-0.5 py-1 rounded-r-md text-sky-400/40 hover:text-sky-200 hover:bg-sky-500/10 transition-colors opacity-0 group-hover:opacity-100"
                      aria-label="Move right"
                      title="Move right"
                    >
                      <ChevronRight className="w-3 h-3" />
                    </button>
                  )}
                  {idx === customDatePresets.length - 1 && renamingPresetId !== preset.id && <span className="pr-1" />}
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
            {/* Date range summary */}
            <p className="text-xs text-muted-foreground/70 flex items-center gap-1.5">
              <CalendarRange className="w-3 h-3 shrink-0" />
              {rangeSummary}
            </p>
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
          <div className="overflow-x-auto">
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
          </div>
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

      {/* Payment Dialog */}
      <Dialog open={showCashfree} onOpenChange={setShowCashfree}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-emerald-400" />
              Pay via RasoKart
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Amount (₹) <span className="text-destructive">*</span></Label>
              <Input
                type="number"
                placeholder="e.g. 5000"
                min="1"
                value={cfAmount}
                onChange={e => setCfAmount(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Customer Phone <span className="text-destructive">*</span></Label>
              <Input
                type="tel"
                placeholder="e.g. 9876543210"
                value={cfPhone}
                onChange={e => setCfPhone(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Required for payment processing</p>
            </div>
            <div className="space-y-2">
              <Label>Customer Name <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input
                placeholder="e.g. John Doe"
                value={cfName}
                onChange={e => setCfName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Customer Email <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input
                type="email"
                placeholder="e.g. john@example.com"
                value={cfEmail}
                onChange={e => setCfEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Note <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input
                placeholder="e.g. Order #123"
                value={cfNote}
                onChange={e => setCfNote(e.target.value)}
              />
            </div>
            <div className="rounded-md bg-muted/40 border border-border/40 p-3 text-xs text-muted-foreground">
              A RasoKart payment order will be created and you will be redirected to RasoKart&apos;s hosted checkout page in a new tab. Once the customer completes payment, the deposit will appear in this list automatically.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCashfree(false)} disabled={cfCreating}>Cancel</Button>
            <Button onClick={handleCashfreePay} disabled={cfCreating || !cfAmount || !cfPhone.trim()}>
              {cfCreating ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creating…</> : "Create & Pay"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
      <AllFiltersSheet open={showAllFilters} onOpenChange={setShowAllFilters} />
    </div>
  );
}
