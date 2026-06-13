import { useState, useRef, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListMerchantSavedFilters,
  useDeleteMerchantSavedFilter,
  useRenameMerchantSavedFilter,
  useReorderMerchantSavedFilters,
} from "@workspace/api-client-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Layers,
  ArrowDownLeft,
  ArrowUpRight,
  BarChart3,
  BookmarkCheck,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Trash2,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

interface SmartFilter {
  amountMin?: number;
  amountMax?: number;
  dateFrom?: string;
  dateTo?: string;
  txType?: "deposit" | "withdrawal";
  txStatus?: "pending" | "success" | "failed";
  txProvider?: string;
}

interface SavedFilter {
  id: string;
  name: string;
  filter: SmartFilter;
  rawInput: string;
}

type PageKey = "deposits" | "transactions" | "reports";

const PAGE_META: Record<PageKey, { label: string; context: string; color: string; iconClass: string }> = {
  deposits: {
    label: "Deposits",
    context: "merchant_deposits",
    color: "emerald",
    iconClass: "text-emerald-400",
  },
  transactions: {
    label: "Transactions",
    context: "merchant_transactions",
    color: "violet",
    iconClass: "text-violet-400",
  },
  reports: {
    label: "Reports",
    context: "merchant_reports",
    color: "sky",
    iconClass: "text-sky-400",
  },
};

function FilterPreviewTooltip({ filter }: { filter: SmartFilter }) {
  const rows: { label: string; value: string }[] = [];
  if (filter.txType) rows.push({ label: "Type", value: filter.txType.charAt(0).toUpperCase() + filter.txType.slice(1) });
  if (filter.txStatus) rows.push({ label: "Status", value: filter.txStatus.charAt(0).toUpperCase() + filter.txStatus.slice(1) });
  if (filter.txProvider) rows.push({ label: "Provider", value: filter.txProvider.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) });
  if (filter.dateFrom || filter.dateTo) {
    rows.push({
      label: "Date",
      value:
        filter.dateFrom && filter.dateTo
          ? `${filter.dateFrom} – ${filter.dateTo}`
          : filter.dateFrom
            ? `From ${filter.dateFrom}`
            : `Until ${filter.dateTo}`,
    });
  }
  if (filter.amountMin != null || filter.amountMax != null) {
    rows.push({
      label: "Amount",
      value:
        filter.amountMin != null && filter.amountMax != null
          ? `₹${filter.amountMin} – ₹${filter.amountMax}`
          : filter.amountMin != null
            ? `≥ ₹${filter.amountMin}`
            : `≤ ₹${filter.amountMax}`,
    });
  }
  if (rows.length === 0) return null;
  return (
    <TooltipContent side="right" className="bg-zinc-900 border-zinc-700 p-0 overflow-hidden">
      <div className="px-3 py-1.5 border-b border-zinc-700">
        <p className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">Filter preview</p>
      </div>
      <div className="px-3 py-2 space-y-1">
        {rows.map(r => (
          <div key={r.label} className="flex items-center gap-2 text-xs">
            <span className="text-zinc-500 w-16 shrink-0">{r.label}</span>
            <span className="text-zinc-200">{r.value}</span>
          </div>
        ))}
      </div>
    </TooltipContent>
  );
}

interface GroupSectionProps {
  pageKey: PageKey;
  filters: SavedFilter[];
  loading: boolean;
  renamingId: string | null;
  renameValue: string;
  renameInputRef: React.RefObject<HTMLInputElement | null>;
  draggingId: string | null;
  dragOverId: string | null;
  setRenameValue: (v: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onStartRename: (f: SavedFilter) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onDragStart: (id: string) => void;
  onDragOver: (e: React.DragEvent, id: string) => void;
  onDragLeave: () => void;
  onDrop: (targetId: string) => void;
  onDragEnd: () => void;
}

function GroupSection({
  pageKey,
  filters,
  loading,
  renamingId,
  renameValue,
  renameInputRef,
  draggingId,
  dragOverId,
  setRenameValue,
  onCommitRename,
  onCancelRename,
  onStartRename,
  onDelete,
  onMove,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
}: GroupSectionProps) {
  const meta = PAGE_META[pageKey];
  const isDeposits = pageKey === "deposits";
  const isReports = pageKey === "reports";
  const borderColor = isDeposits ? "border-emerald-500/20" : isReports ? "border-sky-500/20" : "border-violet-500/20";
  const bgColor = isDeposits ? "bg-emerald-500/5" : isReports ? "bg-sky-500/5" : "bg-violet-500/5";
  const chipBorder = isDeposits ? "border-emerald-500/30" : isReports ? "border-sky-500/30" : "border-violet-500/30";
  const chipBg = isDeposits ? "bg-emerald-500/8" : isReports ? "bg-sky-500/8" : "bg-violet-500/8";
  const chipText = isDeposits ? "text-emerald-300" : isReports ? "text-sky-300" : "text-violet-300";
  const chipHover = isDeposits ? "hover:border-emerald-500/60" : isReports ? "hover:border-sky-500/60" : "hover:border-violet-500/60";
  const chipRingHover = isDeposits ? "ring-emerald-400 border-emerald-500/60 bg-emerald-500/15" : isReports ? "ring-sky-400 border-sky-500/60 bg-sky-500/15" : "ring-violet-400 border-violet-500/60 bg-violet-500/15";
  const arrowColor = isDeposits ? "text-emerald-400/40 hover:text-emerald-200" : isReports ? "text-sky-400/40 hover:text-sky-200" : "text-violet-400/40 hover:text-violet-200";
  const pencilColor = isDeposits ? "text-emerald-400/40 hover:text-emerald-200 hover:bg-emerald-500/10" : isReports ? "text-sky-400/40 hover:text-sky-200 hover:bg-sky-500/10" : "text-violet-400/40 hover:text-violet-200 hover:bg-violet-500/10";
  const renameBorder = isDeposits ? "border-emerald-400" : isReports ? "border-sky-400" : "border-violet-400";
  const renameFg = isDeposits ? "text-emerald-100" : isReports ? "text-sky-100" : "text-violet-100";
  const bookmarkFg = isDeposits ? "text-emerald-300 hover:text-emerald-100" : isReports ? "text-sky-300 hover:text-sky-100" : "text-violet-300 hover:text-violet-100";

  return (
    <div className={`rounded-xl border ${borderColor} ${bgColor} p-4`}>
      <div className="flex items-center gap-2 mb-3">
        {pageKey === "deposits"
          ? <ArrowDownLeft className={`w-4 h-4 ${meta.iconClass}`} />
          : pageKey === "reports"
            ? <BarChart3 className={`w-4 h-4 ${meta.iconClass}`} />
            : <ArrowUpRight className={`w-4 h-4 ${meta.iconClass}`} />}
        <h3 className="text-sm font-semibold">{meta.label}</h3>
        <span className="text-xs text-muted-foreground ml-auto">
          {loading ? "…" : `${filters.length} filter${filters.length !== 1 ? "s" : ""}`}
        </span>
      </div>

      {loading && (
        <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Loading…
        </div>
      )}

      {!loading && filters.length === 0 && (
        <p className="text-xs text-muted-foreground py-2">No saved filters yet. Create them from the {meta.label.toLowerCase()} page.</p>
      )}

      {!loading && filters.length > 0 && (
        <div className="flex flex-wrap items-start gap-2">
          {filters.map((saved, idx) => (
            <span
              key={saved.id}
              draggable={renamingId !== saved.id}
              onDragStart={() => onDragStart(saved.id)}
              onDragOver={(e) => onDragOver(e, saved.id)}
              onDragLeave={onDragLeave}
              onDrop={() => onDrop(saved.id)}
              onDragEnd={onDragEnd}
              className={[
                `group inline-flex items-center gap-0.5 rounded-full border ${chipBorder} ${chipBg} text-xs font-medium ${chipText} ${chipHover} transition-colors select-none`,
                renamingId !== saved.id ? "cursor-grab active:cursor-grabbing" : "",
                draggingId === saved.id ? "opacity-40 scale-95" : "",
                dragOverId === saved.id && draggingId !== saved.id ? `ring-1 ${chipRingHover}` : "",
              ].filter(Boolean).join(" ")}
            >
              {idx > 0 && (
                <button
                  onClick={() => onMove(saved.id, -1)}
                  className={`pl-1.5 pr-0.5 py-1 rounded-l-full ${arrowColor} hover:bg-white/5 transition-colors opacity-0 group-hover:opacity-100`}
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
                  className={`w-28 bg-transparent border-b ${renameBorder} ${renameFg} text-xs outline-none py-0.5 mx-1`}
                  value={renameValue}
                  onChange={e => setRenameValue(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter") onCommitRename();
                    if (e.key === "Escape") onCancelRename();
                  }}
                  onBlur={onCommitRename}
                  maxLength={40}
                />
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex items-center gap-1 px-1 py-1">
                      <BookmarkCheck className={`w-3 h-3 shrink-0 ${bookmarkFg}`} />
                      <button
                        onClick={() => onStartRename(saved)}
                        className="hover:opacity-80 transition-opacity"
                        title="Click to rename"
                      >
                        {saved.name}
                      </button>
                    </span>
                  </TooltipTrigger>
                  <FilterPreviewTooltip filter={saved.filter} />
                </Tooltip>
              )}

              {renamingId !== saved.id && (
                <button
                  onClick={() => onStartRename(saved)}
                  className={`p-0.5 ${pencilColor} transition-colors opacity-0 group-hover:opacity-100`}
                  aria-label={`Rename "${saved.name}"`}
                  title="Rename"
                >
                  <Pencil className="w-2.5 h-2.5" />
                </button>
              )}

              {renamingId !== saved.id && (
                <button
                  onClick={() => onDelete(saved.id)}
                  className="pr-1.5 p-0.5 rounded-r-full text-muted-foreground/40 hover:text-rose-400 hover:bg-rose-500/10 transition-colors opacity-0 group-hover:opacity-100"
                  aria-label={`Delete "${saved.name}"`}
                  title="Delete"
                >
                  <Trash2 className="w-2.5 h-2.5" />
                </button>
              )}

              {idx < filters.length - 1 && renamingId !== saved.id && (
                <button
                  onClick={() => onMove(saved.id, 1)}
                  className={`pr-1.5 pl-0.5 py-1 rounded-r-full ${arrowColor} hover:bg-white/5 transition-colors opacity-0 group-hover:opacity-100`}
                  aria-label="Move right"
                  title="Move right"
                >
                  <ChevronRight className="w-3 h-3" />
                </button>
              )}
              {idx === filters.length - 1 && renamingId !== saved.id && <span className="pr-1" />}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

interface AllFiltersSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AllFiltersSheet({ open, onOpenChange }: AllFiltersSheetProps) {
  const queryClient = useQueryClient();

  const { data: depositData, isLoading: depositLoading, isSuccess: depositLoaded } = useListMerchantSavedFilters(
    { context: "merchant_deposits" },
    { query: { enabled: open, staleTime: 0 } as any },
  );
  const { data: txData, isLoading: txLoading, isSuccess: txLoaded } = useListMerchantSavedFilters(
    { context: "merchant_transactions" },
    { query: { enabled: open, staleTime: 0 } as any },
  );
  const { data: reportsData, isLoading: reportsLoading, isSuccess: reportsLoaded } = useListMerchantSavedFilters(
    { context: "merchant_reports" },
    { query: { enabled: open, staleTime: 0 } as any },
  );

  const [deposits, setDeposits] = useState<SavedFilter[]>([]);
  const [txs, setTxs] = useState<SavedFilter[]>([]);
  const [reports, setReports] = useState<SavedFilter[]>([]);

  useEffect(() => {
    if (depositLoaded && depositData) {
      setDeposits(
        (depositData.data ?? []).map(f => ({
          id: String(f.id),
          name: f.name,
          filter: f.filterData as SmartFilter,
          rawInput: f.rawInput,
        })),
      );
    }
  }, [depositLoaded, depositData]);

  useEffect(() => {
    if (txLoaded && txData) {
      setTxs(
        (txData.data ?? []).map(f => ({
          id: String(f.id),
          name: f.name,
          filter: f.filterData as SmartFilter,
          rawInput: f.rawInput,
        })),
      );
    }
  }, [txLoaded, txData]);

  useEffect(() => {
    if (reportsLoaded && reportsData) {
      setReports(
        (reportsData.data ?? []).map(f => ({
          id: String(f.id),
          name: f.name,
          filter: f.filterData as SmartFilter,
          rawInput: f.rawInput,
        })),
      );
    }
  }, [reportsLoaded, reportsData]);

  const { mutateAsync: deleteMutation } = useDeleteMerchantSavedFilter();
  const { mutateAsync: renameMutation } = useRenameMerchantSavedFilter();
  const { mutateAsync: reorderMutation } = useReorderMerchantSavedFilters();

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  const dragIdRef = useRef<string | null>(null);
  const dragGroupRef = useRef<PageKey | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  useEffect(() => {
    if (renamingId) {
      setTimeout(() => renameInputRef.current?.focus(), 50);
    }
  }, [renamingId]);

  const getGroupState = (group: PageKey) => (group === "deposits" ? deposits : group === "reports" ? reports : txs);
  const setGroupState = (group: PageKey, filters: SavedFilter[]) => {
    if (group === "deposits") setDeposits(filters);
    else if (group === "reports") setReports(filters);
    else setTxs(filters);
  };

  const handleDelete = async (id: string, group: PageKey) => {
    const updated = getGroupState(group).filter(f => f.id !== id);
    setGroupState(group, updated);
    if (renamingId === id) setRenamingId(null);
    const numericId = parseInt(id);
    if (!isNaN(numericId)) {
      try {
        await deleteMutation({ id: numericId });
      } catch {
        toast.error("Failed to delete filter.");
      }
    }
  };

  const handleMove = async (id: string, dir: -1 | 1, group: PageKey) => {
    const list = getGroupState(group);
    const idx = list.findIndex(f => f.id === id);
    if (idx === -1) return;
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= list.length) return;
    const updated = [...list];
    [updated[idx], updated[newIdx]] = [updated[newIdx]!, updated[idx]!];
    setGroupState(group, updated);
    const context = PAGE_META[group].context;
    const ids = updated.map(f => parseInt(f.id)).filter(n => !isNaN(n));
    try {
      await reorderMutation({ data: { ids, context } });
    } catch {}
  };

  const startRename = (saved: SavedFilter) => {
    setRenamingId(saved.id);
    setRenameValue(saved.name);
  };

  const commitRename = async () => {
    if (!renamingId) return;
    const trimmed = renameValue.trim();
    if (!trimmed) { setRenamingId(null); return; }

    const group: PageKey = deposits.some(f => f.id === renamingId) ? "deposits" : reports.some(f => f.id === renamingId) ? "reports" : "transactions";
    const list = getGroupState(group);

    if (list.some(f => f.id !== renamingId && f.name.toLowerCase() === trimmed.toLowerCase())) {
      toast.error("A filter with this name already exists.");
      return;
    }
    const updated = list.map(f => f.id === renamingId ? { ...f, name: trimmed } : f);
    setGroupState(group, updated);
    setRenamingId(null);
    const numericId = parseInt(renamingId);
    if (!isNaN(numericId)) {
      try {
        await renameMutation({ id: numericId, data: { name: trimmed } });
      } catch {}
    }
  };

  const cancelRename = () => setRenamingId(null);

  const handleDragStart = (id: string, group: PageKey) => {
    dragIdRef.current = id;
    dragGroupRef.current = group;
    setDraggingId(id);
  };

  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    if (dragIdRef.current !== id) setDragOverId(id);
  };

  const handleDragLeave = () => setDragOverId(null);

  const handleDrop = async (targetId: string, group: PageKey) => {
    const sourceId = dragIdRef.current;
    const sourceGroup = dragGroupRef.current;
    setDragOverId(null);
    setDraggingId(null);
    dragIdRef.current = null;
    dragGroupRef.current = null;
    if (!sourceId || sourceId === targetId || sourceGroup !== group) return;

    const list = getGroupState(group);
    const fromIdx = list.findIndex(f => f.id === sourceId);
    const toIdx = list.findIndex(f => f.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const updated = [...list];
    const [item] = updated.splice(fromIdx, 1);
    updated.splice(toIdx, 0, item!);
    setGroupState(group, updated);
    const context = PAGE_META[group].context;
    const ids = updated.map(f => parseInt(f.id)).filter(n => !isNaN(n));
    reorderMutation({ data: { ids, context } }).catch(() => {});
  };

  const handleDragEnd = () => {
    dragIdRef.current = null;
    dragGroupRef.current = null;
    setDraggingId(null);
    setDragOverId(null);
  };

  const handleOpenChange = (v: boolean) => {
    if (!v) {
      queryClient.invalidateQueries({ queryKey: ["/api/merchant/saved-filters"] });
    }
    onOpenChange(v);
  };

  const makeGroupProps = (group: PageKey): Omit<GroupSectionProps, "pageKey"> => ({
    filters: getGroupState(group),
    loading: group === "deposits" ? depositLoading : group === "reports" ? reportsLoading : txLoading,
    renamingId,
    renameValue,
    renameInputRef,
    draggingId,
    dragOverId,
    setRenameValue,
    onCommitRename: commitRename,
    onCancelRename: cancelRename,
    onStartRename: startRename,
    onDelete: (id) => handleDelete(id, group),
    onMove: (id, dir) => handleMove(id, dir, group),
    onDragStart: (id) => handleDragStart(id, group),
    onDragOver: handleDragOver,
    onDragLeave: handleDragLeave,
    onDrop: (targetId) => handleDrop(targetId, group),
    onDragEnd: handleDragEnd,
  });

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader className="mb-6">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Layers className="w-4 h-4 text-primary" />
            Manage All Saved Filters
          </SheetTitle>
          <p className="text-sm text-muted-foreground">
            View, rename, reorder, and delete saved filters across your Deposits, Transactions, and Reports pages.
            Reordering here updates each page independently.
          </p>
        </SheetHeader>

        <div className="space-y-4">
          <GroupSection pageKey="deposits" {...makeGroupProps("deposits")} />
          <GroupSection pageKey="transactions" {...makeGroupProps("transactions")} />
          <GroupSection pageKey="reports" {...makeGroupProps("reports")} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
