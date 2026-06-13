import { useState, useRef, useEffect } from "react";
import { useListTransactions, useSearchByUtr, useGetTransaction, useGetPaymentLink, useListMerchantSavedFilters, useCreateMerchantSavedFilter, useDeleteMerchantSavedFilter, useRenameMerchantSavedFilter, useReorderMerchantSavedFilters } from "@workspace/api-client-react";
import { useCrossTabSync } from "@/hooks/use-cross-tab-sync";
import { AllFiltersSheet } from "@/components/merchant/all-filters-sheet";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Download, Search, X, Info, Sparkles, Zap, TrendingUp, CheckCircle2, XCircle, Hash, Bookmark, BookmarkCheck, Trash2, CreditCard, ArrowDownLeft, ArrowUpRight, FileText, Loader2, Link2, CalendarRange, Layers, ChevronLeft, ChevronRight, Pencil } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { format, parseISO, subDays, startOfMonth, endOfMonth, subMonths, startOfWeek, endOfWeek, startOfDay, endOfDay } from "date-fns";
import { getToken } from "@/lib/auth";
import { toast } from "sonner";

function highlightUtr(utr: string, search: string) {
  if (!search) return <>{utr}</>;
  const idx = utr.toLowerCase().indexOf(search.toLowerCase());
  if (idx === -1) return <>{utr}</>;
  return (
    <>
      {utr.slice(0, idx)}
      <mark className="bg-amber-400/30 text-amber-200 rounded-sm px-0.5 not-italic font-semibold">
        {utr.slice(idx, idx + search.length)}
      </mark>
      {utr.slice(idx + search.length)}
    </>
  );
}

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

interface SmartFilter {
  amountMin?: number;
  amountMax?: number;
  dateFrom?: string;
  dateTo?: string;
  txType?: "deposit" | "withdrawal";
  txStatus?: "pending" | "success" | "failed";
  txProvider?: string;
}

const TYPE_KEYWORDS: Record<string, "deposit" | "withdrawal"> = {
  deposit: "deposit",
  deposits: "deposit",
  withdrawal: "withdrawal",
  withdrawals: "withdrawal",
};

const STATUS_KEYWORDS: Record<string, "pending" | "success" | "failed"> = {
  pending: "pending",
  success: "success",
  successful: "success",
  failed: "failed",
  failure: "failed",
};

const PROVIDER_KEYWORDS: Record<string, string> = {
  upi: "upi_id",
  upi_id: "upi_id",
  collect: "phonepe",
  wallet: "paytm",
  merchant: "bharatpe",
  bank: "yono_sbi",
  yono: "yono_sbi",
  yono_sbi: "yono_sbi",
  hdfc: "hdfc_smarthub",
  hdfc_smarthub: "hdfc_smarthub",
  smartpay: "hdfc_smarthub",
  phonepe: "phonepe",
  paytm: "paytm",
  bharatpe: "bharatpe",
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

interface SavedFilter {
  id: string;
  name: string;
  filter: SmartFilter;
  rawInput: string;
}

const ALL_SAVED_FILTERS_KEY = "rasokart_all_saved_filters";
const LEGACY_TX_FILTERS_KEY = "rasokart_saved_filters";

function migrateOldTxFilters(): void {
  try {
    const old = localStorage.getItem(LEGACY_TX_FILTERS_KEY);
    if (!old) return;
    const oldFilters = JSON.parse(old) as SavedFilter[];
    if (oldFilters.length > 0) {
      const existing = loadPageFilters("transactions");
      if (existing.length === 0) storePageFilters("transactions", oldFilters);
    }
    localStorage.removeItem(LEGACY_TX_FILTERS_KEY);
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

interface CustomDatePreset {
  id: string;
  name: string;
  from: string;
  to: string;
}

const CUSTOM_DATE_PRESETS_KEY = "rasokart_custom_date_presets";

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

function parseSmartQuery(raw: string): SmartFilter | null {
  const q = raw.trim().toLowerCase();
  if (!q) return null;

  const filter: SmartFilter = {};
  const now = new Date();

  // Check multi-word date phrases first (order matters: longer phrases first)
  for (const phrase of ["this week", "this month", "last month", "last week"]) {
    if (q.includes(phrase)) {
      const dateResult = parseDateToken(phrase, now);
      if (dateResult) {
        Object.assign(filter, dateResult);
        break;
      }
    }
  }

  // Tokenise the remaining words (single-word tokens)
  // Remove already-matched multi-word date phrase from remaining
  let remaining = q;
  if (filter.dateFrom) {
    for (const phrase of ["this week", "this month", "last month", "last week"]) {
      remaining = remaining.replace(phrase, "").trim();
    }
  }

  const tokens = remaining.split(/\s+/).filter(Boolean);

  for (const token of tokens) {
    if (token in TYPE_KEYWORDS) {
      filter.txType = TYPE_KEYWORDS[token]!;
      continue;
    }
    if (token in STATUS_KEYWORDS) {
      filter.txStatus = STATUS_KEYWORDS[token]!;
      continue;
    }
    if (token in PROVIDER_KEYWORDS) {
      filter.txProvider = PROVIDER_KEYWORDS[token]!;
      continue;
    }
    // Single-word date shortcuts
    if (!filter.dateFrom) {
      const dateResult = parseDateToken(token, now);
      if (dateResult) { Object.assign(filter, dateResult); continue; }
    }
    // Amount patterns
    if (filter.amountMin == null && filter.amountMax == null) {
      const amtResult = parseAmountToken(token);
      if (amtResult) { Object.assign(filter, amtResult); continue; }
    }
  }

  const hasContent =
    filter.txType != null ||
    filter.txStatus != null ||
    filter.dateFrom != null ||
    filter.amountMin != null ||
    filter.amountMax != null ||
    filter.txProvider != null;

  return hasContent ? filter : null;
}

const PROVIDER_LABELS: Record<string, string> = {
  upi_id:        "UPI Direct",
  google_pay:    "RasoKart UPI",
  phonepe:       "RasoKart Collect",
  paytm:         "RasoKart Wallet",
  bharatpe:      "RasoKart Merchant",
  freecharge:    "RasoKart Pay",
  amazon_pay:    "RasoKart Digital",
  yono_sbi:      "Bank UPI",
  sbi_yono:      "Bank UPI",
  hdfc_smarthub: "Bank SmartQR",
  icici_eazypay: "Bank QR",
  axis_pay:      "Bank QR",
  kotak_smart:   "Bank Smart Collect",
  razorpay:      "RasoKart Gateway",
  cashfree:      "RasoKart Payments",
  payu:          "RasoKart Gateway Plus",
  ekqr:          "RasoKart QR Gateway",
};

function formatProvider(p: string | null | undefined): string {
  if (!p) return "—";
  return PROVIDER_LABELS[p] ?? p.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function ProviderBadge({ provider }: { provider: string | null | undefined }) {
  if (!provider) return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <Badge variant="outline" className="text-xs gap-1 border-violet-500/30 text-violet-300 bg-violet-500/10">
      <Zap className="w-3 h-3" />
      {formatProvider(provider)}
    </Badge>
  );
}

const PROVIDERS = [
  { value: "upi_id",        label: "UPI Direct" },
  { value: "google_pay",    label: "RasoKart UPI" },
  { value: "phonepe",       label: "RasoKart Collect" },
  { value: "paytm",         label: "RasoKart Wallet" },
  { value: "bharatpe",      label: "RasoKart Merchant" },
  { value: "yono_sbi",      label: "Bank UPI" },
  { value: "hdfc_smarthub", label: "Bank SmartQR" },
] as const;

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3">
      <span className="text-sm text-muted-foreground shrink-0">{label}</span>
      <span className={`text-sm text-right break-all ${mono ? "font-mono" : "font-medium"}`}>{value}</span>
    </div>
  );
}

function TransactionDetailPanel({ id, open, onClose, utrSearch }: { id: number | null; open: boolean; onClose: () => void; utrSearch?: string }) {
  const { data: tx, isLoading } = useGetTransaction(id ?? 0, {
    query: { enabled: open && id != null } as any,
  });

  const paymentLinkId = (tx as any)?.paymentLinkId as number | null | undefined;
  const { data: paymentLink, isLoading: linkLoading } = useGetPaymentLink(paymentLinkId ?? 0, {
    query: { enabled: open && paymentLinkId != null } as any,
  });

  const metadataParsed = (() => {
    if (!tx?.metadata) return null;
    try { return JSON.parse(tx.metadata); } catch { return tx.metadata; }
  })();

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader className="mb-6">
          <SheetTitle className="flex items-center gap-2 text-base">
            <CreditCard className="w-4 h-4 text-primary" />
            Transaction Details
          </SheetTitle>
        </SheetHeader>

        {isLoading || !tx ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Loading transaction…</span>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Status & Amount Hero */}
            <div className="rounded-xl border bg-card/60 p-5 flex items-center gap-5">
              <div className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 ${tx.type === "deposit" ? "bg-primary/10" : "bg-violet-500/10"}`}>
                {tx.type === "deposit"
                  ? <ArrowDownLeft className="w-5 h-5 text-primary" />
                  : <ArrowUpRight className="w-5 h-5 text-violet-500" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-2xl font-bold font-mono">₹{Number(tx.amount).toLocaleString()}</p>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <Badge variant="outline" className="text-xs capitalize">{tx.type}</Badge>
                  <StatusBadge status={tx.status} />
                  <span className="text-xs text-muted-foreground font-mono">{tx.currency}</span>
                </div>
              </div>
            </div>

            {/* Transaction Info */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" /> Transaction Info
              </p>
              <div className="space-y-0 rounded-lg border divide-y divide-border bg-card/40">
                <DetailRow label="ID" value={`#${tx.id}`} mono />
                <div className="flex items-start justify-between gap-4 px-4 py-3">
                  <span className="text-sm text-muted-foreground shrink-0">UTR</span>
                  <span className="text-sm text-right break-all font-mono">
                    {tx.utr ? highlightUtr(tx.utr, utrSearch ?? "") : "—"}
                  </span>
                </div>
                {tx.referenceId && <DetailRow label="Reference ID" value={tx.referenceId} mono />}
                {tx.description && <DetailRow label="Description" value={tx.description} />}
              </div>
            </div>

            {/* Provider Connection — only shown when a provider is linked */}
            {(tx as any).connectionProvider != null && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5" /> Provider Connection
                </p>
                <div className="space-y-0 rounded-lg border divide-y divide-border bg-card/40">
                  <div className="flex items-start justify-between gap-4 px-4 py-3">
                    <span className="text-sm text-muted-foreground shrink-0">Provider</span>
                    <ProviderBadge provider={(tx as any).connectionProvider} />
                  </div>
                  {(tx as any).connectionId != null && (
                    <DetailRow label="Connection ID" value={`#${(tx as any).connectionId}`} mono />
                  )}
                </div>
              </div>
            )}

            {/* Payment Link Details */}
            {paymentLinkId != null && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
                  <Link2 className="w-3.5 h-3.5" /> Payment Link
                </p>
                <div className="space-y-0 rounded-lg border divide-y divide-border bg-card/40">
                  {linkLoading ? (
                    <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading link details…
                    </div>
                  ) : paymentLink ? (
                    <>
                      <DetailRow label="Title" value={paymentLink.title} />
                      <DetailRow label="Slug" value={paymentLink.slug} mono />
                      <DetailRow
                        label="Amount"
                        value={paymentLink.amount != null ? `₹${Number(paymentLink.amount).toLocaleString()}` : "Any"}
                      />
                      <DetailRow
                        label="Payments"
                        value={
                          paymentLink.maxPayments != null
                            ? `${paymentLink.paymentCount} / ${paymentLink.maxPayments}`
                            : `${paymentLink.paymentCount} (no limit)`
                        }
                      />
                      <div className="flex items-center justify-between gap-4 px-4 py-3">
                        <span className="text-sm text-muted-foreground shrink-0">Status</span>
                        <Badge
                          variant="outline"
                          className={`text-xs capitalize ${paymentLink.status === "active" ? "border-green-500/40 text-green-400" : paymentLink.status === "expired" ? "border-orange-500/40 text-orange-400" : "border-zinc-500/40 text-zinc-400"}`}
                        >
                          {paymentLink.status}
                        </Badge>
                      </div>
                    </>
                  ) : (
                    <DetailRow label="Payment Link" value={`#${paymentLinkId}`} mono />
                  )}
                </div>
              </div>
            )}

            {/* Timestamps */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5" /> Timestamps
              </p>
              <div className="space-y-0 rounded-lg border divide-y divide-border bg-card/40">
                <DetailRow label="Created" value={format(new Date(tx.createdAt), "MMM d, yyyy HH:mm:ss")} />
                {tx.updatedAt && <DetailRow label="Updated" value={format(new Date(tx.updatedAt), "MMM d, yyyy HH:mm:ss")} />}
              </div>
            </div>

            {/* Metadata */}
            {metadataParsed != null && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Metadata</p>
                <pre className="text-xs rounded-lg border bg-muted/30 p-4 overflow-x-auto whitespace-pre-wrap break-all font-mono leading-relaxed">
                  {typeof metadataParsed === "string"
                    ? metadataParsed
                    : JSON.stringify(metadataParsed, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default function MerchantTransactions() {
  const [selectedTxId, setSelectedTxId] = useState<number | null>(null);
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [provider, setProvider] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [utrSearch, setUtrSearch] = useState("");
  const [utrInput, setUtrInput] = useState("");

  // Smart search bar state
  const [smartInput, setSmartInput] = useState("");
  const [smartFilter, setSmartFilter] = useState<SmartFilter | null>(null);
  const [smartError, setSmartError] = useState("");
  const smartInputRef = useRef<HTMLInputElement>(null);

  // Saved filters state
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>(() => {
    migrateOldTxFilters();
    return loadPageFilters("transactions");
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

  // Server-side saved filters sync
  const FILTER_CONTEXT = "merchant_transactions";
  const filtersInitialized = useRef(false);
  const { data: serverFiltersData, isSuccess: serverFiltersLoaded } = useListMerchantSavedFilters(
    { context: FILTER_CONTEXT },
    { query: { staleTime: Infinity, retry: false } as any },
  );
  const { mutateAsync: createFilterMutation } = useCreateMerchantSavedFilter();
  const { mutateAsync: deleteFilterMutation } = useDeleteMerchantSavedFilter();
  const { mutateAsync: renameFilterMutation } = useRenameMerchantSavedFilter();
  const { mutateAsync: reorderFilterMutation } = useReorderMerchantSavedFilters();

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
      storePageFilters("transactions", serverFilters);
    } else {
      const local = loadPageFilters("transactions");
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
            storePageFilters("transactions", imported);
          }
        })();
      }
    }
  }, [serverFiltersLoaded, serverFiltersData]);

  useCrossTabSync([
    {
      key: ALL_SAVED_FILTERS_KEY,
      onUpdate: (raw) => {
        try { setSavedFilters(raw ? (JSON.parse(raw) as SavedFilter[]) : []); }
        catch { setSavedFilters([]); }
      },
    },
  ]);

  // Custom date preset state
  const [customDatePresets, setCustomDatePresets] = useState<CustomDatePreset[]>(() => loadCustomDatePresets());
  const [showSaveDatePreset, setShowSaveDatePreset] = useState(false);
  const [saveDatePresetName, setSaveDatePresetName] = useState("");
  const [saveDatePresetNameError, setSaveDatePresetNameError] = useState("");
  const saveDatePresetNameRef = useRef<HTMLInputElement>(null);

  // Combined preset state
  const [combinedPresets, setCombinedPresets] = useState<CombinedPreset[]>(() => loadCombinedPresets());
  const [showSaveCombinedPreset, setShowSaveCombinedPreset] = useState(false);
  const [saveCombinedPresetName, setSaveCombinedPresetName] = useState("");
  const [saveCombinedPresetNameError, setSaveCombinedPresetNameError] = useState("");
  const saveCombinedPresetNameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showSaveInput) {
      setTimeout(() => saveNameInputRef.current?.focus(), 50);
    }
  }, [showSaveInput]);

  useEffect(() => {
    if (showSaveDatePreset) {
      setTimeout(() => saveDatePresetNameRef.current?.focus(), 50);
    }
  }, [showSaveDatePreset]);

  useEffect(() => {
    if (showSaveCombinedPreset) {
      setTimeout(() => saveCombinedPresetNameRef.current?.focus(), 50);
    }
  }, [showSaveCombinedPreset]);

  useEffect(() => {
    if (renamingId) {
      setTimeout(() => renameInputRef.current?.focus(), 50);
    }
  }, [renamingId]);

  const amountMin = smartFilter?.amountMin;
  const amountMax = smartFilter?.amountMax;
  const smartDateFrom = smartFilter?.dateFrom;
  const smartDateTo = smartFilter?.dateTo;

  // Smart date filter overrides manual date pickers when active
  const activeDateFrom = smartDateFrom ?? dateFrom;
  const activeDateTo = smartDateTo ?? dateTo;

  // Smart type/status/provider override dropdowns when set
  const activeType = smartFilter?.txType ?? type;
  const activeStatus = smartFilter?.txStatus ?? status;
  const activeProvider = smartFilter?.txProvider ?? (provider !== "all" ? provider : undefined);

  const { data, isLoading } = useListTransactions({
    type: activeType as any,
    status: activeStatus as any,
    page,
    limit: 20,
    search: utrSearch || undefined,
    ...(activeDateFrom ? { dateFrom: activeDateFrom } : {}),
    ...(activeDateTo ? { dateTo: activeDateTo } : {}),
    ...(amountMin != null ? { amountMin } : {}),
    ...(amountMax != null ? { amountMax } : {}),
    ...(activeProvider ? { connectionProvider: activeProvider as any } : {}),
  });
  const { data: utrResult, isLoading: utrLoading, error: utrError } = useSearchByUtr(
    { utr: utrSearch || "" },
    { query: { enabled: !!utrSearch } as any }
  );

  const applyPreset = (preset: (typeof DATE_PRESETS)[number]) => {
    const { from, to } = preset.getRange();
    setDateFrom(from);
    setDateTo(to);
    setPage(1);
    // Clear any date smart filter when preset applied
    if (smartFilter?.dateFrom || smartFilter?.dateTo) {
      setSmartFilter(null);
      setSmartInput("");
    }
  };

  const isPresetActive = (preset: (typeof DATE_PRESETS)[number]) => {
    const { from, to } = preset.getRange();
    return activeDateFrom === from && activeDateTo === to;
  };

  const applySmartSearch = () => {
    setSmartError("");
    const filter = parseSmartQuery(smartInput);
    if (!filter) {
      setSmartError("Try: failed deposits, pending >500, deposits this week, >500, today");
      return;
    }
    setSmartFilter(filter);
    // If it's a date filter, clear the manual date pickers
    if (filter.dateFrom || filter.dateTo) {
      setDateFrom("");
      setDateTo("");
    }
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

  // Apply a saved filter (one-click)
  const applySavedFilter = (saved: SavedFilter) => {
    setSmartFilter(saved.filter);
    setSmartInput(saved.rawInput);
    setSmartError("");
    setShowSaveInput(false);
    setSaveFilterName("");
    setSaveFilterNameError("");
    if (saved.filter.dateFrom != null) {
      setDateFrom("");
      setDateTo("");
    }
    setPage(1);
  };

  const openSaveInput = () => {
    setSaveFilterName("");
    setSaveFilterNameError("");
    setShowSaveInput(true);
  };

  const confirmSaveFilter = async () => {
    const trimmed = saveFilterName.trim();
    if (!trimmed) {
      setSaveFilterNameError("Please enter a name for this filter.");
      saveNameInputRef.current?.focus();
      return;
    }
    if (!smartFilter) return;
    const alreadyExists = savedFilters.some(
      f => f.name.toLowerCase() === trimmed.toLowerCase()
    );
    if (alreadyExists) {
      setSaveFilterNameError("A filter with this name already exists.");
      saveNameInputRef.current?.focus();
      return;
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
      storePageFilters("transactions", updated);
      setShowSaveInput(false);
      setSaveFilterName("");
      setSaveFilterNameError("");
    } catch {
      toast.error("Failed to save filter. Please try again.");
    }
  };

  const cancelSaveFilter = () => {
    setShowSaveInput(false);
    setSaveFilterName("");
    setSaveFilterNameError("");
  };

  const deleteSavedFilter = async (id: string) => {
    const updated = savedFilters.filter(f => f.id !== id);
    setSavedFilters(updated);
    storePageFilters("transactions", updated);
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
    storePageFilters("transactions", updated);
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
    storePageFilters("transactions", updated);
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
    storePageFilters("transactions", updated);
    setRenamingId(null);
    const numericId = parseInt(renamingId);
    if (!isNaN(numericId)) {
      try {
        await renameFilterMutation({ id: numericId, data: { name: trimmed } });
      } catch { /* optimistic rename already applied locally */ }
    }
  };

  const cancelRename = () => { setRenamingId(null); };

  // Custom date preset handlers
  const applyCustomDatePreset = (preset: CustomDatePreset) => {
    setDateFrom(preset.from);
    setDateTo(preset.to);
    setPage(1);
    if (smartFilter?.dateFrom || smartFilter?.dateTo) {
      setSmartFilter(null);
      setSmartInput("");
    }
    setShowSaveDatePreset(false);
  };

  const isCustomDatePresetActive = (preset: CustomDatePreset) =>
    activeDateFrom === preset.from && activeDateTo === preset.to;

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

  // Combined preset handlers
  const applyCombinedPreset = (preset: CombinedPreset) => {
    setType(preset.type);
    setStatus(preset.status);
    setProvider(preset.provider);
    setDateFrom(preset.dateFrom);
    setDateTo(preset.dateTo);
    if (smartFilter) {
      setSmartFilter(null);
      setSmartInput("");
      setSmartError("");
    }
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
    const alreadyExists = combinedPresets.some(
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
      type,
      status,
      provider,
      dateFrom,
      dateTo,
    };
    const updated = [...combinedPresets, newPreset];
    setCombinedPresets(updated);
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
    const updated = combinedPresets.filter(p => p.id !== id);
    setCombinedPresets(updated);
    storeCombinedPresets(updated);
  };

  const exportCsv = async () => {
    const params = new URLSearchParams();
    if (activeType && activeType !== "all") params.set("type", activeType);
    if (activeStatus && activeStatus !== "all") params.set("status", activeStatus);
    if (activeProvider) params.set("connectionProvider", activeProvider);
    if (utrSearch) params.set("search", utrSearch);
    if (activeDateFrom) params.set("dateFrom", activeDateFrom);
    if (activeDateTo) params.set("dateTo", activeDateTo);
    if (amountMin != null) params.set("amountMin", String(amountMin));
    if (amountMax != null) params.set("amountMax", String(amountMax));
    const url = `/api/transactions/export/csv?${params.toString()}`;
    const token = getToken();
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "transactions.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const hasSmartFilter = smartFilter !== null;
  const hasUtrSearch = !!utrSearch;
  const hasTypeFilter = type !== "all";
  const hasStatusFilter = status !== "all";
  const hasProviderFilter = provider !== "all";
  const hasDateFilter = !!(activeDateFrom || activeDateTo);
  const hasSmartProviderFilter = smartFilter != null && !!smartFilter.txProvider;
  const anyFilterActive = hasSmartFilter || hasUtrSearch || hasTypeFilter || hasStatusFilter || hasProviderFilter || hasDateFilter || hasSmartProviderFilter;

  const clearAllFilters = () => {
    setType("all");
    setStatus("all");
    setProvider("all");
    setDateFrom("");
    setDateTo("");
    setSmartFilter(null);
    setSmartInput("");
    setSmartError("");
    setUtrSearch("");
    setUtrInput("");
    setPage(1);
  };

  // Check if the current active smart filter is already saved
  const isCurrentFilterSaved = hasSmartFilter && savedFilters.some(
    f => f.rawInput === smartInput && JSON.stringify(f.filter) === JSON.stringify(smartFilter)
  );

  // Custom date preset derived state
  const isCustomDateRangeEntered = !!(dateFrom && dateTo && !smartFilter?.dateFrom && !smartFilter?.dateTo);
  const isBuiltInPresetActive = DATE_PRESETS.some(p => {
    const { from, to } = p.getRange();
    return dateFrom === from && dateTo === to;
  });
  const isCustomDateAlreadySaved = customDatePresets.some(p => p.from === dateFrom && p.to === dateTo);
  const canSaveDatePreset = isCustomDateRangeEntered && !isBuiltInPresetActive && !isCustomDateAlreadySaved;
  const rangeSummary = (() => {
    const from = activeDateFrom;
    const to = activeDateTo;
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

  // Combined preset derived state
  const isCombinedPresetAlreadySaved = combinedPresets.some(
    p => p.type === type && p.status === status && p.provider === provider &&
      p.dateFrom === dateFrom && p.dateTo === dateTo
  );
  const canSaveCombinedPreset =
    !smartFilter &&
    (hasTypeFilter || hasStatusFilter || hasProviderFilter) &&
    !!(dateFrom && dateTo) &&
    !isCombinedPresetAlreadySaved;

  const buildCombinedPresetLabel = (preset: CombinedPreset): string => {
    const parts: string[] = [];
    if (preset.type !== "all") parts.push(preset.type.charAt(0).toUpperCase() + preset.type.slice(1) + "s");
    if (preset.status !== "all") parts.push(preset.status.charAt(0).toUpperCase() + preset.status.slice(1));
    if (preset.provider !== "all") parts.push(formatProvider(preset.provider));
    parts.push(`${preset.dateFrom} – ${preset.dateTo}`);
    return parts.join(" · ");
  };

  const isCombinedPresetActive = (preset: CombinedPreset) =>
    type === preset.type && status === preset.status && provider === preset.provider &&
    dateFrom === preset.dateFrom && dateTo === preset.dateTo;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div><h1 className="text-3xl font-bold tracking-tight">Transactions</h1><p className="text-muted-foreground mt-1">Your payment history</p></div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv}><Download className="w-4 h-4 mr-2" />Export CSV</Button>
        </div>
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
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex items-center gap-1 px-1 py-1">
                          <button
                            onClick={() => applySavedFilter(saved)}
                            className="text-violet-300 hover:text-violet-100 transition-colors shrink-0"
                            title={`Apply: ${saved.rawInput}`}
                            aria-label={`Apply filter "${saved.name}"`}
                          >
                            <BookmarkCheck className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => startRename(saved)}
                            className="hover:text-violet-100 transition-colors"
                            title="Click to rename"
                          >
                            {saved.name}
                          </button>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="bg-zinc-900 border-zinc-700 p-0 overflow-hidden">
                        <div className="px-3 py-1.5 border-b border-zinc-700">
                          <p className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">Filter preview</p>
                        </div>
                        <div className="px-3 py-2 space-y-1">
                          {saved.filter.txType && (
                            <div className="flex items-center gap-2 text-xs">
                              <span className="text-zinc-500 w-16 shrink-0">Type</span>
                              <span className="text-zinc-200">{saved.filter.txType.charAt(0).toUpperCase() + saved.filter.txType.slice(1)}</span>
                            </div>
                          )}
                          {saved.filter.txStatus && (
                            <div className="flex items-center gap-2 text-xs">
                              <span className="text-zinc-500 w-16 shrink-0">Status</span>
                              <span className="text-zinc-200">{saved.filter.txStatus.charAt(0).toUpperCase() + saved.filter.txStatus.slice(1)}</span>
                            </div>
                          )}
                          {saved.filter.txProvider && (
                            <div className="flex items-center gap-2 text-xs">
                              <span className="text-zinc-500 w-16 shrink-0">Provider</span>
                              <span className="text-zinc-200">{formatProvider(saved.filter.txProvider)}</span>
                            </div>
                          )}
                          {(saved.filter.dateFrom ?? saved.filter.dateTo) && (
                            <div className="flex items-center gap-2 text-xs">
                              <span className="text-zinc-500 w-16 shrink-0">Date</span>
                              <span className="text-zinc-200">
                                {saved.filter.dateFrom && saved.filter.dateTo
                                  ? `${saved.filter.dateFrom} – ${saved.filter.dateTo}`
                                  : saved.filter.dateFrom
                                    ? `From ${saved.filter.dateFrom}`
                                    : `Until ${saved.filter.dateTo}`}
                              </span>
                            </div>
                          )}
                          {(saved.filter.amountMin != null || saved.filter.amountMax != null) && (
                            <div className="flex items-center gap-2 text-xs">
                              <span className="text-zinc-500 w-16 shrink-0">Amount</span>
                              <span className="text-zinc-200">
                                {saved.filter.amountMin != null && saved.filter.amountMax != null
                                  ? `₹${saved.filter.amountMin} – ₹${saved.filter.amountMax}`
                                  : saved.filter.amountMin != null
                                    ? `≥ ₹${saved.filter.amountMin}`
                                    : `≤ ₹${saved.filter.amountMax}`}
                              </span>
                            </div>
                          )}
                        </div>
                      </TooltipContent>
                    </Tooltip>
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

          <div className="flex flex-col sm:flex-row flex-wrap gap-3">
            <div className="relative flex-1">
              <Sparkles className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-violet-400" />
              <Input
                ref={smartInputRef}
                className="pl-9"
                placeholder="Try: upi deposits  ·  failed deposits  ·  pending >500  ·  deposits this week  ·  collect this week"
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
          </div>

          {/* Save filter inline form */}
          {showSaveInput && (
            <div className="mt-3 flex items-start gap-2">
              <div className="flex-1">
                <Input
                  ref={saveNameInputRef}
                  className="h-8 text-sm"
                  placeholder="Name this filter (e.g. Large deposits)"
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
              <Button size="sm" onClick={confirmSaveFilter} className="h-8 shrink-0">
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={cancelSaveFilter} className="h-8 shrink-0 px-2">
                <X className="w-4 h-4" />
              </Button>
            </div>
          )}

          {smartError && (
            <p className="mt-2 text-xs text-amber-400">{smartError}</p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Type: <span className="font-mono text-foreground/60">deposit</span>, <span className="font-mono text-foreground/60">withdrawal</span> — Status: <span className="font-mono text-foreground/60">pending</span>, <span className="font-mono text-foreground/60">success</span>, <span className="font-mono text-foreground/60">failed</span> — Amount: <span className="font-mono text-foreground/60">{">500"}</span>, <span className="font-mono text-foreground/60">{"200-999"}</span> — Date: <span className="font-mono text-foreground/60">today</span>, <span className="font-mono text-foreground/60">this week</span>, <span className="font-mono text-foreground/60">this month</span> — Provider: <span className="font-mono text-foreground/60">upi</span>, <span className="font-mono text-foreground/60">collect</span>, <span className="font-mono text-foreground/60">wallet</span>, <span className="font-mono text-foreground/60">bank</span> — Combine freely: <span className="font-mono text-foreground/60">collect deposits this week</span>
          </p>
        </CardContent>
      </Card>

      {/* UTR Search */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Search by UTR</p>
          <div className="flex flex-col sm:flex-row flex-wrap gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input className="pl-9 font-mono" placeholder="Enter UTR number..." value={utrInput} onChange={e => setUtrInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { setUtrSearch(utrInput); setPage(1); } }} />
            </div>
            <Button onClick={() => { setUtrSearch(utrInput); setPage(1); }} disabled={!utrInput}>Search</Button>
            {utrSearch && <Button variant="ghost" size="icon" onClick={() => { setUtrSearch(""); setUtrInput(""); setPage(1); }}><X className="w-4 h-4" /></Button>}
          </div>
          {utrSearch && (
            <div className="mt-3 p-3 rounded-lg border bg-card/50">
              {utrLoading && <p className="text-sm text-muted-foreground">Searching...</p>}
              {utrError && <p className="text-sm text-rose-500">No transaction found for UTR: {utrSearch}</p>}
              {utrResult && (
                <div className="flex flex-wrap gap-4 text-sm">
                  <div><span className="text-muted-foreground">UTR:</span> <span className="font-mono font-medium">{highlightUtr(utrResult.utr, utrSearch)}</span></div>
                  <div><span className="text-muted-foreground">Amount:</span> <span className="font-semibold">₹{Number(utrResult.amount).toLocaleString()}</span></div>
                  <div><span className="text-muted-foreground">Type:</span> <Badge variant="outline">{utrResult.type}</Badge></div>
                  <div><span className="text-muted-foreground">Status:</span> <StatusBadge status={utrResult.status} /></div>
                  <div><span className="text-muted-foreground">Date:</span> {format(new Date(utrResult.createdAt), "MMM d, yyyy HH:mm")}</div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Active filter chips */}
      {(hasSmartFilter || hasUtrSearch) && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground font-medium">Active filters:</span>
          {hasSmartFilter && (() => {
            const sf = smartFilter!;
            const chips: { label: string; key: string }[] = [];
            if (sf.txType) chips.push({ key: "type", label: sf.txType === "deposit" ? "Deposits" : "Withdrawals" });
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
            if (sf.txProvider) chips.push({ key: "provider", label: formatProvider(sf.txProvider) });
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
          {hasUtrSearch && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-300">
              <Info className="w-3 h-3" />
              UTR: <span className="font-mono">{utrSearch}</span>
              <button
                onClick={() => { setUtrSearch(""); setUtrInput(""); setPage(1); }}
                className="ml-0.5 rounded-full p-0.5 hover:bg-amber-500/20 transition-colors"
                aria-label="Clear UTR filter"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
        </div>
      )}

      {/* Live Filter Summary Bar */}
      {anyFilterActive && (
        <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <span className="text-xs font-semibold text-violet-400 uppercase tracking-wider mr-1">Filter results</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearAllFilters}
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
              <span className="text-muted-foreground">transactions</span>
            </div>
            <div className="flex items-center gap-1.5 text-sm">
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
              <span className="font-semibold text-emerald-400">
                {isLoading ? <span className="inline-block w-16 h-3.5 bg-muted/60 rounded animate-pulse" /> : `₹${(data?.stats?.depositVolume ?? 0).toLocaleString()}`}
              </span>
              <span className="text-muted-foreground">deposit volume</span>
            </div>
            <div className="flex items-center gap-1.5 text-sm">
              <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
              <span className="font-semibold text-green-400">
                {isLoading ? <span className="inline-block w-6 h-3.5 bg-muted/60 rounded animate-pulse" /> : (data?.stats?.successCount ?? 0).toLocaleString()}
              </span>
              <span className="text-muted-foreground">success</span>
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
          <div className="space-y-3">
            {/* Combined preset chips */}
            {combinedPresets.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                  <Layers className="w-3 h-3" />Presets:
                </span>
                {combinedPresets.map(preset => (
                  <span
                    key={preset.id}
                    className={`group inline-flex items-center gap-1 rounded-full border text-xs font-medium transition-colors ${
                      isCombinedPresetActive(preset)
                        ? "border-teal-500/60 bg-teal-500/15 text-teal-200"
                        : "border-teal-500/30 bg-teal-500/8 text-teal-300 hover:border-teal-500/60"
                    }`}
                  >
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => applyCombinedPreset(preset)}
                          className="flex items-center gap-1 px-2.5 py-1 hover:text-teal-100 transition-colors"
                        >
                          <Layers className="w-3 h-3 shrink-0" />
                          {preset.name}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="bg-zinc-900 border-zinc-700 p-0 overflow-hidden">
                        <div className="px-3 py-1.5 border-b border-zinc-700">
                          <p className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">Filter preview</p>
                        </div>
                        <div className="px-3 py-2 space-y-1">
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-zinc-500 w-14 shrink-0">Type</span>
                            <span className="text-zinc-200">{preset.type === "all" ? "All Types" : preset.type.charAt(0).toUpperCase() + preset.type.slice(1)}</span>
                          </div>
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-zinc-500 w-14 shrink-0">Status</span>
                            <span className="text-zinc-200">{preset.status === "all" ? "All Statuses" : preset.status.charAt(0).toUpperCase() + preset.status.slice(1)}</span>
                          </div>
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-zinc-500 w-14 shrink-0">Provider</span>
                            <span className="text-zinc-200">{preset.provider === "all" ? "All Providers" : formatProvider(preset.provider)}</span>
                          </div>
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-zinc-500 w-14 shrink-0">Date</span>
                            <span className="text-zinc-200">{preset.dateFrom} – {preset.dateTo}</span>
                          </div>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                    <button
                      onClick={() => deleteCombinedPreset(preset.id)}
                      className="pr-1.5 text-teal-400/50 hover:text-rose-400 hover:bg-rose-500/10 rounded-full transition-colors opacity-0 group-hover:opacity-100 py-1 flex items-center"
                      aria-label={`Remove preset "${preset.name}"`}
                      title="Remove this preset"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-3 items-center">
              <Select value={type} onValueChange={v => { setType(v); setPage(1); }}>
                <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="deposit">Deposit</SelectItem>
                  <SelectItem value="withdrawal">Withdrawal</SelectItem>
                </SelectContent>
              </Select>
              <Select value={status} onValueChange={v => { setStatus(v); setPage(1); }}>
                <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="success">Success</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                </SelectContent>
              </Select>
              <Select value={provider} onValueChange={v => { setProvider(v); setPage(1); }}>
                <SelectTrigger className="w-[150px]"><SelectValue placeholder="All Providers" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Providers</SelectItem>
                  {PROVIDERS.map(p => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => applyCustomDatePreset(preset)}
                          className="flex items-center gap-1 h-8 px-2.5 hover:text-sky-100 transition-colors"
                        >
                          <CalendarRange className="w-3 h-3 shrink-0" />
                          {preset.name}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="bg-zinc-900 border-zinc-700 p-0 overflow-hidden">
                        <div className="px-3 py-1.5 border-b border-zinc-700">
                          <p className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">Filter preview</p>
                        </div>
                        <div className="px-3 py-2">
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-zinc-500 w-14 shrink-0">Date</span>
                            <span className="text-zinc-200">{preset.from} – {preset.to}</span>
                          </div>
                        </div>
                      </TooltipContent>
                    </Tooltip>
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
                    value={smartFilter?.dateFrom ?? dateFrom}
                    onChange={e => {
                      if (smartFilter?.dateFrom) return;
                      setDateFrom(e.target.value);
                      setPage(1);
                      setShowSaveDatePreset(false);
                    }}
                    title="From date"
                    readOnly={!!smartFilter?.dateFrom}
                  />
                  <span className="text-muted-foreground text-sm">to</span>
                  <Input
                    type="date"
                    className="w-[150px] h-8 text-xs [color-scheme:dark]"
                    value={smartFilter?.dateTo ?? dateTo}
                    onChange={e => {
                      if (smartFilter?.dateTo) return;
                      setDateTo(e.target.value);
                      setPage(1);
                      setShowSaveDatePreset(false);
                    }}
                    title="To date"
                    readOnly={!!smartFilter?.dateTo}
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
                {(dateFrom || dateTo || smartFilter?.dateFrom || smartFilter?.dateTo) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground h-8 px-2"
                    onClick={() => {
                      setDateFrom("");
                      setDateTo("");
                      setShowSaveDatePreset(false);
                      if (smartFilter?.dateFrom || smartFilter?.dateTo) clearSmartFilter();
                      setPage(1);
                    }}
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
            {/* Combined preset save button */}
            {(canSaveCombinedPreset || (isCombinedPresetAlreadySaved && !smartFilter && (hasTypeFilter || hasStatusFilter || hasProviderFilter) && !!(dateFrom && dateTo))) && (
              <div className="flex items-center gap-2">
                {canSaveCombinedPreset && !showSaveCombinedPreset && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs border-teal-500/40 text-teal-300 hover:bg-teal-500/10 hover:text-teal-200"
                    onClick={openSaveCombinedPreset}
                    title="Save this combination of filters as a one-click preset"
                  >
                    <Layers className="w-3 h-3 mr-1.5" />
                    Save as preset
                  </Button>
                )}
                {isCombinedPresetAlreadySaved && !smartFilter && (hasTypeFilter || hasStatusFilter || hasProviderFilter) && !!(dateFrom && dateTo) && !showSaveCombinedPreset && (
                  <span className="inline-flex items-center gap-1 h-8 px-2.5 text-xs text-teal-400/60 border border-teal-500/20 rounded-md">
                    <Layers className="w-3 h-3" />
                    Saved
                  </span>
                )}
              </div>
            )}
            {showSaveCombinedPreset && (
              <div className="flex items-start gap-2 pl-1">
                <div className="flex-shrink-0 pt-1">
                  <Layers className="w-3.5 h-3.5 text-teal-400" />
                </div>
                <div className="flex-1">
                  <Input
                    ref={saveCombinedPresetNameRef}
                    className="h-8 text-sm max-w-[300px]"
                    placeholder="Name this preset (e.g. Pending deposits Jan 2025)"
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
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
            <TableHeader>
              <TableRow>
                <TableHead>UTR</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>{Array.from({ length: 7 }).map((_, j) => <TableCell key={j}><div className="h-4 bg-muted/50 rounded animate-pulse" /></TableCell>)}</TableRow>
              )) : data?.data?.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-10">No transactions found</TableCell></TableRow>
              ) : data?.data?.map(tx => (
                <TableRow
                  key={tx.id}
                  className={`cursor-pointer hover:bg-muted/40 transition-colors ${utrSearch ? "bg-amber-500/5 ring-1 ring-inset ring-amber-500/20" : ""}`}
                  onClick={() => setSelectedTxId(tx.id)}
                >
                  <TableCell className="font-mono text-xs">{highlightUtr(tx.utr ?? "", utrSearch)}</TableCell>
                  <TableCell><Badge variant="outline" className="text-xs">{tx.type}</Badge></TableCell>
                  <TableCell><StatusBadge status={tx.status} /></TableCell>
                  <TableCell><ProviderBadge provider={tx.connectionProvider} /></TableCell>
                  <TableCell className="text-right font-mono font-semibold">₹{Number(tx.amount).toLocaleString()}</TableCell>
                  <TableCell className="text-xs text-muted-foreground font-mono">{tx.referenceId || "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{format(new Date(tx.createdAt), "MMM d, HH:mm")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        </CardContent>
      </Card>

      {data && data.total > 20 && (
        <div className="flex justify-between items-center">
          <span className="text-sm text-muted-foreground">{data.total} total</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button>
            <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page * 20 >= data.total}>Next</Button>
          </div>
        </div>
      )}

      <TransactionDetailPanel
        id={selectedTxId}
        open={selectedTxId !== null}
        onClose={() => setSelectedTxId(null)}
        utrSearch={utrSearch}
      />
      <AllFiltersSheet open={showAllFilters} onOpenChange={setShowAllFilters} />
    </div>
  );
}
