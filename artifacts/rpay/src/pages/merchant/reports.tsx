import { useState, useCallback, useRef, useEffect } from "react";
import {
  useGetTransactionReport,
  useGetSettlementReport,
  useListMerchantConnections,
  useListMerchantSavedFilters,
  useCreateMerchantSavedFilter,
  useDeleteMerchantSavedFilter,
  useRenameMerchantSavedFilter,
  useReorderMerchantSavedFilters,
} from "@workspace/api-client-react";
import { AllFiltersSheet } from "@/components/merchant/all-filters-sheet";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  FileText,
  Download,
  Loader2,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  XCircle,
  Clock,
  FileSpreadsheet,
  CalendarRange,
  Filter,
  BarChart3,
  QrCode,
  Building2,
  Link2,
  Coins,
  Banknote,
  Hash,
  Wallet,
  TrendingUp,
  Bookmark,
  BookmarkCheck,
  Pencil,
  Trash2,
  ChevronLeft,
  ChevronRight,
  X,
  Layers,
} from "lucide-react";
import { format, subDays, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { toast } from "sonner";

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
      return { from: format(startOfMonth(now), "yyyy-MM-dd"), to: format(endOfMonth(now), "yyyy-MM-dd") };
    },
  },
  {
    label: "Last month",
    getRange: () => {
      const now = new Date();
      const prev = subMonths(now, 1);
      return { from: format(startOfMonth(prev), "yyyy-MM-dd"), to: format(endOfMonth(prev), "yyyy-MM-dd") };
    },
  },
];

const PROVIDERS = [
  { value: "phonepe", label: "PhonePe" },
  { value: "paytm", label: "Paytm" },
  { value: "bharatpe", label: "BharatPe" },
  { value: "yono_sbi", label: "YONO SBI" },
  { value: "hdfc_smarthub", label: "HDFC SmartHub" },
  { value: "upi_id", label: "UPI ID" },
];

interface ReportsFilterData {
  dateFrom?: string;
  dateTo?: string;
  type?: string;
  status?: string;
  connectionProvider?: string;
  source?: string;
}

interface ReportsSavedFilter {
  id: string;
  name: string;
  filterData: ReportsFilterData;
  rawInput: string;
}

function buildReportsRawInput(fd: ReportsFilterData): string {
  const parts: string[] = [];
  if (fd.type) parts.push(fd.type.charAt(0).toUpperCase() + fd.type.slice(1));
  if (fd.status) parts.push(fd.status.charAt(0).toUpperCase() + fd.status.slice(1));
  if (fd.source) parts.push(fd.source.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()));
  if (fd.connectionProvider) parts.push(fd.connectionProvider.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()));
  if (fd.dateFrom && fd.dateTo) parts.push(`${fd.dateFrom} – ${fd.dateTo}`);
  else if (fd.dateFrom) parts.push(`From ${fd.dateFrom}`);
  else if (fd.dateTo) parts.push(`Until ${fd.dateTo}`);
  return parts.length > 0 ? parts.join(" · ") : "All filters";
}

function fmt(amount: number) {
  return `₹${amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function settlementBadgeColor(s: string) {
  if (s === "paid") return "text-emerald-400";
  if (s === "approved" || s === "processing") return "text-amber-400";
  return "text-muted-foreground";
}

function settlementStatusColor(s: string) {
  if (s === "paid") return "text-emerald-400";
  if (s === "approved") return "text-sky-400";
  if (s === "processing") return "text-amber-400";
  if (s === "rejected" || s === "cancelled") return "text-red-400";
  return "text-muted-foreground";
}

export default function MerchantReports() {
  const [activeTab, setActiveTab] = useState("transactions");

  // Transaction filter state
  const [txDateFrom, setTxDateFrom] = useState(() => format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [txDateTo, setTxDateTo] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [type, setType] = useState("all");
  const [txStatus, setTxStatus] = useState("all");
  const [connectionProvider, setConnectionProvider] = useState("all");
  const [source, setSource] = useState("all");
  const [txActivePreset, setTxActivePreset] = useState<string | null>(null);
  const [txExporting, setTxExporting] = useState<"pdf" | "xlsx" | null>(null);

  // Settlement filter state
  const [stlDateFrom, setStlDateFrom] = useState(() => format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [stlDateTo, setStlDateTo] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [stlStatus, setStlStatus] = useState("all");
  const [settlementId, setSettlementId] = useState("");
  const [stlActivePreset, setStlActivePreset] = useState<string | null>(null);
  const [stlExporting, setStlExporting] = useState<"pdf" | "xlsx" | null>(null);

  // Saved filters state
  const FILTER_CONTEXT = "merchant_reports";
  const filtersInitialized = useRef(false);
  const [savedFilters, setSavedFilters] = useState<ReportsSavedFilter[]>([]);
  const [showAllFilters, setShowAllFilters] = useState(false);
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [saveFilterName, setSaveFilterName] = useState("");
  const [saveFilterNameError, setSaveFilterNameError] = useState("");
  const saveNameInputRef = useRef<HTMLInputElement>(null);
  const dragIdRef = useRef<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  const { data: serverFiltersData, isSuccess: serverFiltersLoaded } = useListMerchantSavedFilters(
    { context: FILTER_CONTEXT },
    { query: { staleTime: Infinity, retry: false } as any },
  );
  const { mutateAsync: createFilterMutation } = useCreateMerchantSavedFilter();
  const { mutateAsync: deleteFilterMutation } = useDeleteMerchantSavedFilter();
  const { mutateAsync: renameFilterMutation } = useRenameMerchantSavedFilter();
  const { mutateAsync: reorderFilterMutation } = useReorderMerchantSavedFilters();

  useListMerchantConnections();

  const txParams = {
    dateFrom: txDateFrom || undefined,
    dateTo: txDateTo || undefined,
    type: type !== "all" ? (type as "deposit" | "withdrawal") : undefined,
    status: txStatus !== "all" ? (txStatus as "pending" | "success" | "failed") : undefined,
    connectionProvider: connectionProvider !== "all" ? (connectionProvider as "phonepe" | "paytm" | "bharatpe" | "yono_sbi" | "hdfc_smarthub" | "upi_id") : undefined,
    source: source !== "all" ? (source as "qr_code" | "virtual_account" | "payment_link" | "direct") : undefined,
  };

  const stlParams = {
    dateFrom: stlDateFrom || undefined,
    dateTo: stlDateTo || undefined,
    status: stlStatus !== "all" ? (stlStatus as "pending" | "processing" | "approved" | "rejected" | "paid" | "cancelled") : undefined,
    settlementId: settlementId ? parseInt(settlementId) : undefined,
  };

  const { data: txData, isLoading: txLoading, isFetching: txFetching } = useGetTransactionReport(txParams);
  const { data: stlData, isLoading: stlLoading, isFetching: stlFetching } = useGetSettlementReport(stlParams);

  const transactions = txData?.data ?? [];
  const txStats = txData?.stats;
  const settlements = stlData?.data ?? [];
  const stlStats = stlData?.stats;

  useEffect(() => {
    if (!serverFiltersLoaded) return;
    const serverFilters: ReportsSavedFilter[] = (serverFiltersData?.data ?? []).map((f) => ({
      id: String(f.id),
      name: f.name,
      filterData: f.filterData as ReportsFilterData,
      rawInput: f.rawInput,
    }));
    setSavedFilters(serverFilters);
    filtersInitialized.current = true;
  }, [serverFiltersData]);

  useEffect(() => {
    if (showSaveInput) setTimeout(() => saveNameInputRef.current?.focus(), 50);
  }, [showSaveInput]);

  useEffect(() => {
    if (renamingId) setTimeout(() => renameInputRef.current?.focus(), 50);
  }, [renamingId]);

  const applyTxPreset = (preset: typeof DATE_PRESETS[number]) => {
    const range = preset.getRange();
    setTxDateFrom(range.from);
    setTxDateTo(range.to);
    setTxActivePreset(preset.label);
  };

  const applyStlPreset = (preset: typeof DATE_PRESETS[number]) => {
    const range = preset.getRange();
    setStlDateFrom(range.from);
    setStlDateTo(range.to);
    setStlActivePreset(preset.label);
  };

  const applySavedFilter = (saved: ReportsSavedFilter) => {
    const fd = saved.filterData;
    setTxDateFrom(fd.dateFrom ?? format(startOfMonth(new Date()), "yyyy-MM-dd"));
    setTxDateTo(fd.dateTo ?? format(new Date(), "yyyy-MM-dd"));
    setType(fd.type ?? "all");
    setTxStatus(fd.status ?? "all");
    setConnectionProvider(fd.connectionProvider ?? "all");
    setSource(fd.source ?? "all");
    setTxActivePreset(null);
    setShowSaveInput(false);
    setSaveFilterName("");
    setSaveFilterNameError("");
  };

  const currentFilterData: ReportsFilterData = {
    dateFrom: txDateFrom || undefined,
    dateTo: txDateTo || undefined,
    type: type !== "all" ? type : undefined,
    status: txStatus !== "all" ? txStatus : undefined,
    connectionProvider: connectionProvider !== "all" ? connectionProvider : undefined,
    source: source !== "all" ? source : undefined,
  };

  const hasAnyFilter = type !== "all" || txStatus !== "all" || connectionProvider !== "all" || source !== "all";

  const isCurrentFilterSaved = hasAnyFilter && savedFilters.some(
    (f) => JSON.stringify(f.filterData) === JSON.stringify(currentFilterData),
  );

  const openSaveInput = () => {
    setSaveFilterName("");
    setSaveFilterNameError("");
    setShowSaveInput(true);
  };

  const confirmSaveFilter = async () => {
    const trimmed = saveFilterName.trim();
    if (!trimmed) { setSaveFilterNameError("Please enter a name."); saveNameInputRef.current?.focus(); return; }
    if (savedFilters.some((f) => f.name.toLowerCase() === trimmed.toLowerCase())) {
      setSaveFilterNameError("A filter with this name already exists."); saveNameInputRef.current?.focus(); return;
    }
    const rawInput = buildReportsRawInput(currentFilterData);
    try {
      const created = await createFilterMutation({
        data: { name: trimmed, rawInput, filterData: currentFilterData as Record<string, unknown>, context: FILTER_CONTEXT },
      });
      const newFilter: ReportsSavedFilter = {
        id: String(created.id),
        name: created.name,
        filterData: created.filterData as ReportsFilterData,
        rawInput: created.rawInput,
      };
      setSavedFilters((prev) => [...prev, newFilter]);
      setShowSaveInput(false);
      setSaveFilterName("");
      setSaveFilterNameError("");
    } catch {
      toast.error("Failed to save filter. Please try again.");
    }
  };

  const cancelSaveFilter = () => { setShowSaveInput(false); setSaveFilterName(""); setSaveFilterNameError(""); };

  const deleteSavedFilter = async (id: string) => {
    setSavedFilters((prev) => prev.filter((f) => f.id !== id));
    if (renamingId === id) setRenamingId(null);
    const numericId = parseInt(id);
    if (!isNaN(numericId)) {
      try { await deleteFilterMutation({ id: numericId }); } catch { /* optimistic */ }
    }
  };

  const moveSavedFilter = async (id: string, dir: -1 | 1) => {
    setSavedFilters((prev) => {
      const idx = prev.findIndex((f) => f.id === id);
      if (idx === -1) return prev;
      const newIdx = idx + dir;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      const updated = [...prev];
      [updated[idx], updated[newIdx]] = [updated[newIdx]!, updated[idx]!];
      const ids = updated.map((f) => parseInt(f.id)).filter((n) => !isNaN(n));
      reorderFilterMutation({ data: { ids, context: FILTER_CONTEXT } }).catch(() => {});
      return updated;
    });
  };

  const handleDragStart = (id: string) => { dragIdRef.current = id; setDraggingId(id); };
  const handleDragOver = (e: React.DragEvent, id: string) => { e.preventDefault(); if (dragIdRef.current !== id) setDragOverId(id); };
  const handleDragLeave = () => { setDragOverId(null); };
  const handleDrop = (targetId: string) => {
    const sourceId = dragIdRef.current;
    setDragOverId(null); setDraggingId(null); dragIdRef.current = null;
    if (!sourceId || sourceId === targetId) return;
    setSavedFilters((prev) => {
      const fromIdx = prev.findIndex((f) => f.id === sourceId);
      const toIdx = prev.findIndex((f) => f.id === targetId);
      if (fromIdx === -1 || toIdx === -1) return prev;
      const updated = [...prev];
      const [item] = updated.splice(fromIdx, 1);
      updated.splice(toIdx, 0, item!);
      const ids = updated.map((f) => parseInt(f.id)).filter((n) => !isNaN(n));
      reorderFilterMutation({ data: { ids, context: FILTER_CONTEXT } }).catch(() => {});
      return updated;
    });
  };
  const handleDragEnd = () => { dragIdRef.current = null; setDraggingId(null); setDragOverId(null); };

  const startRename = (saved: ReportsSavedFilter) => { setRenamingId(saved.id); setRenameValue(saved.name); };
  const commitRename = async () => {
    if (!renamingId) return;
    const trimmed = renameValue.trim();
    if (!trimmed) { setRenamingId(null); return; }
    if (savedFilters.some((f) => f.id !== renamingId && f.name.toLowerCase() === trimmed.toLowerCase())) {
      toast.error("A filter with this name already exists."); return;
    }
    setSavedFilters((prev) => prev.map((f) => f.id === renamingId ? { ...f, name: trimmed } : f));
    setRenamingId(null);
    const numericId = parseInt(renamingId);
    if (!isNaN(numericId)) {
      try { await renameFilterMutation({ id: numericId, data: { name: trimmed } }); } catch { /* optimistic */ }
    }
  };
  const cancelRename = () => { setRenamingId(null); };

  // ── Transaction exports ───────────────────────────────────────────────────
  const exportTxExcel = useCallback(async () => {
    if (!transactions.length) { toast.error("No data to export"); return; }
    setTxExporting("xlsx");
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();

      const summaryRows = [
        ["RasoKart — Transaction Report"],
        [`Generated: ${format(new Date(), "dd/MM/yyyy HH:mm")}`],
        [`Period: ${txDateFrom || "All time"} to ${txDateTo || "All time"}`],
        [],
        ["Summary"],
        ["Total Transactions", transactions.length],
        ["Deposit Volume (₹)", txStats?.depositVolume ?? 0],
        ["Withdrawal Volume (₹)", txStats?.withdrawalVolume ?? 0],
        ["Total Fees (₹)", txStats?.totalFees ?? 0],
        ["Successful", txStats?.successCount ?? 0],
        ["Failed", txStats?.failedCount ?? 0],
        ["Pending", txStats?.pendingCount ?? 0],
      ];
      const ws1 = XLSX.utils.aoa_to_sheet(summaryRows);
      ws1["!cols"] = [{ wch: 28 }, { wch: 20 }];
      XLSX.utils.book_append_sheet(wb, ws1, "Summary");

      const txRows = [
        ["Date", "UTR", "Reference ID", "Type", "Status", "Settlement Status", "Amount (₹)", "Fee (₹)", "Currency", "Source", "Provider", "Description"],
        ...transactions.map((t) => {
          const src = t.qrCodeId ? "QR Code" : t.virtualAccountId ? "Virtual Account" : t.paymentLinkId ? "Payment Link" : "Direct";
          return [
            format(new Date(t.createdAt), "dd/MM/yyyy HH:mm"),
            t.utr,
            t.referenceId ?? "",
            t.type,
            t.status,
            t.settlementStatus,
            Number(t.amount),
            Number(t.fee),
            t.currency,
            src,
            t.connectionProvider ?? "",
            t.description ?? "",
          ];
        }),
      ];
      const ws2 = XLSX.utils.aoa_to_sheet(txRows);
      ws2["!cols"] = [{ wch: 18 }, { wch: 22 }, { wch: 18 }, { wch: 12 }, { wch: 10 }, { wch: 16 }, { wch: 14 }, { wch: 12 }, { wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 30 }];
      XLSX.utils.book_append_sheet(wb, ws2, "Transactions");

      XLSX.writeFile(wb, `rasokart-tx-report-${format(new Date(), "yyyy-MM-dd")}.xlsx`);
      toast.success("Excel report downloaded");
    } catch {
      toast.error("Failed to export Excel");
    } finally {
      setTxExporting(null);
    }
  }, [transactions, txStats, txDateFrom, txDateTo]);

  const exportTxPDF = useCallback(async () => {
    if (!transactions.length) { toast.error("No data to export"); return; }
    setTxExporting("pdf");
    try {
      const { jsPDF } = await import("jspdf");
      const { default: autoTable } = await import("jspdf-autotable");

      const doc = new jsPDF({ orientation: "landscape" });

      doc.setFontSize(18);
      doc.setFont("helvetica", "bold");
      doc.text("RasoKart — Transaction Report", 14, 18);

      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(120, 120, 120);
      doc.text(`Generated: ${format(new Date(), "dd/MM/yyyy HH:mm")}`, 14, 26);
      doc.text(`Period: ${txDateFrom || "All time"} → ${txDateTo || "All time"}`, 14, 32);
      doc.setTextColor(0, 0, 0);

      autoTable(doc, {
        startY: 40,
        head: [["Metric", "Value"]],
        body: [
          ["Total Transactions", transactions.length.toString()],
          ["Deposit Volume", fmt(txStats?.depositVolume ?? 0)],
          ["Withdrawal Volume", fmt(txStats?.withdrawalVolume ?? 0)],
          ["Total Fees", fmt(txStats?.totalFees ?? 0)],
          ["Successful", (txStats?.successCount ?? 0).toString()],
          ["Failed", (txStats?.failedCount ?? 0).toString()],
          ["Pending", (txStats?.pendingCount ?? 0).toString()],
        ],
        theme: "grid",
        headStyles: { fillColor: [30, 30, 46] },
        columnStyles: { 0: { fontStyle: "bold", cellWidth: 60 }, 1: { cellWidth: 60 } },
      });

      const afterSummary = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;

      autoTable(doc, {
        startY: afterSummary,
        head: [["Date", "UTR", "Type", "Status", "Settlement", "Amount (₹)", "Fee (₹)", "Source", "Provider"]],
        body: transactions.map((t) => {
          const src = t.qrCodeId ? "QR Code" : t.virtualAccountId ? "Virtual Account" : t.paymentLinkId ? "Payment Link" : "Direct";
          return [
            format(new Date(t.createdAt), "dd/MM/yy HH:mm"),
            t.utr,
            t.type,
            t.status,
            t.settlementStatus,
            Number(t.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 }),
            Number(t.fee).toLocaleString("en-IN", { minimumFractionDigits: 2 }),
            src,
            t.connectionProvider ?? "",
          ];
        }),
        theme: "striped",
        headStyles: { fillColor: [30, 30, 46] },
        styles: { fontSize: 8 },
        columnStyles: {
          0: { cellWidth: 26 },
          1: { cellWidth: 36 },
          2: { cellWidth: 20 },
          3: { cellWidth: 18 },
          4: { cellWidth: 22 },
          5: { cellWidth: 26, halign: "right" },
          6: { cellWidth: 20, halign: "right" },
          7: { cellWidth: 24 },
          8: { cellWidth: "auto" },
        },
      });

      doc.save(`rasokart-tx-report-${format(new Date(), "yyyy-MM-dd")}.pdf`);
      toast.success("PDF report downloaded");
    } catch {
      toast.error("Failed to export PDF");
    } finally {
      setTxExporting(null);
    }
  }, [transactions, txStats, txDateFrom, txDateTo]);

  // ── Settlement exports ────────────────────────────────────────────────────
  const exportStlExcel = useCallback(async () => {
    if (!settlements.length) { toast.error("No data to export"); return; }
    setStlExporting("xlsx");
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();

      const summaryRows = [
        ["RasoKart — Settlement Report"],
        [`Generated: ${format(new Date(), "dd/MM/yyyy HH:mm")}`],
        [`Period: ${stlDateFrom || "All time"} to ${stlDateTo || "All time"}`],
        [],
        ["Summary"],
        ["Total Settlements", stlStats?.totalCount ?? 0],
        ["Total Amount (₹)", stlStats?.totalAmount ?? 0],
        ["Paid Amount (₹)", stlStats?.paidAmount ?? 0],
        ["Pending Amount (₹)", stlStats?.pendingAmount ?? 0],
        ["Rejected Amount (₹)", stlStats?.rejectedAmount ?? 0],
        ["Paid", stlStats?.paidCount ?? 0],
        ["Pending", stlStats?.pendingCount ?? 0],
        ["Processing / Approved", stlStats?.processingCount ?? 0],
        ["Rejected / Cancelled", stlStats?.rejectedCount ?? 0],
      ];
      const ws1 = XLSX.utils.aoa_to_sheet(summaryRows);
      ws1["!cols"] = [{ wch: 28 }, { wch: 20 }];
      XLSX.utils.book_append_sheet(wb, ws1, "Summary");

      const stlRows = [
        ["Settlement ID", "Status", "Period From", "Period To", "Requested Amount (₹)", "Settled Amount (₹)", "Fees (₹)", "Transactions", "UTR / Reference", "Paid At", "Created At"],
        ...settlements.map((s) => [
          s.id,
          s.status,
          s.periodFrom ?? "",
          s.periodTo ?? "",
          s.requestedAmount != null ? Number(s.requestedAmount) : "",
          Number(s.amount),
          Number(s.fees ?? 0),
          s.transactionCount,
          s.referenceNumber ?? "",
          s.paidAt ? format(new Date(s.paidAt), "dd/MM/yyyy HH:mm") : "",
          format(new Date(s.createdAt), "dd/MM/yyyy HH:mm"),
        ]),
      ];
      const ws2 = XLSX.utils.aoa_to_sheet(stlRows);
      ws2["!cols"] = [{ wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 22 }, { wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 28 }, { wch: 20 }, { wch: 20 }];
      XLSX.utils.book_append_sheet(wb, ws2, "Settlements");

      XLSX.writeFile(wb, `rasokart-settlement-report-${format(new Date(), "yyyy-MM-dd")}.xlsx`);
      toast.success("Excel report downloaded");
    } catch {
      toast.error("Failed to export Excel");
    } finally {
      setStlExporting(null);
    }
  }, [settlements, stlStats, stlDateFrom, stlDateTo]);

  const exportStlPDF = useCallback(async () => {
    if (!settlements.length) { toast.error("No data to export"); return; }
    setStlExporting("pdf");
    try {
      const { jsPDF } = await import("jspdf");
      const { default: autoTable } = await import("jspdf-autotable");

      const doc = new jsPDF({ orientation: "landscape" });

      doc.setFontSize(18);
      doc.setFont("helvetica", "bold");
      doc.text("RasoKart — Settlement Report", 14, 18);

      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(120, 120, 120);
      doc.text(`Generated: ${format(new Date(), "dd/MM/yyyy HH:mm")}`, 14, 26);
      doc.text(`Period: ${stlDateFrom || "All time"} → ${stlDateTo || "All time"}`, 14, 32);
      doc.setTextColor(0, 0, 0);

      autoTable(doc, {
        startY: 40,
        head: [["Metric", "Value"]],
        body: [
          ["Total Settlements", (stlStats?.totalCount ?? 0).toString()],
          ["Total Amount", fmt(stlStats?.totalAmount ?? 0)],
          ["Paid Amount", fmt(stlStats?.paidAmount ?? 0)],
          ["Pending Amount", fmt(stlStats?.pendingAmount ?? 0)],
          ["Rejected Amount", fmt(stlStats?.rejectedAmount ?? 0)],
          ["Paid Count", (stlStats?.paidCount ?? 0).toString()],
          ["Pending Count", (stlStats?.pendingCount ?? 0).toString()],
          ["Processing / Approved", (stlStats?.processingCount ?? 0).toString()],
          ["Rejected / Cancelled", (stlStats?.rejectedCount ?? 0).toString()],
        ],
        theme: "grid",
        headStyles: { fillColor: [30, 30, 46] },
        columnStyles: { 0: { fontStyle: "bold", cellWidth: 60 }, 1: { cellWidth: 60 } },
      });

      const afterSummary = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;

      autoTable(doc, {
        startY: afterSummary,
        head: [["ID", "Status", "Period", "Requested (₹)", "Settled (₹)", "Fees (₹)", "Txns", "UTR / Ref", "Paid At", "Created"]],
        body: settlements.map((s) => [
          `#${s.id}`,
          s.status,
          s.periodFrom && s.periodTo ? `${s.periodFrom} → ${s.periodTo}` : "—",
          s.requestedAmount != null ? Number(s.requestedAmount).toLocaleString("en-IN", { minimumFractionDigits: 2 }) : "—",
          Number(s.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 }),
          Number(s.fees ?? 0) > 0 ? Number(s.fees).toLocaleString("en-IN", { minimumFractionDigits: 2 }) : "—",
          s.transactionCount.toString(),
          s.referenceNumber ?? "—",
          s.paidAt ? format(new Date(s.paidAt), "dd/MM/yy") : "—",
          format(new Date(s.createdAt), "dd/MM/yy"),
        ]),
        theme: "striped",
        headStyles: { fillColor: [30, 30, 46] },
        styles: { fontSize: 8 },
        columnStyles: {
          0: { cellWidth: 12 },
          1: { cellWidth: 20 },
          2: { cellWidth: 32 },
          3: { cellWidth: 24, halign: "right" },
          4: { cellWidth: 24, halign: "right" },
          5: { cellWidth: 18, halign: "right" },
          6: { cellWidth: 12, halign: "right" },
          7: { cellWidth: 36 },
          8: { cellWidth: 20 },
          9: { cellWidth: "auto" },
        },
      });

      doc.save(`rasokart-settlement-report-${format(new Date(), "yyyy-MM-dd")}.pdf`);
      toast.success("PDF report downloaded");
    } catch {
      toast.error("Failed to export PDF");
    } finally {
      setStlExporting(null);
    }
  }, [settlements, stlStats, stlDateFrom, stlDateTo]);

  const isTxExporting = txExporting !== null;
  const isStlExporting = stlExporting !== null;
  const txNoData = !txLoading && transactions.length === 0;
  const stlNoData = !stlLoading && settlements.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-primary" />
            Reports
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Generate and download reports for any date range
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
          <TabsTrigger value="settlements">Settlements</TabsTrigger>
        </TabsList>

        {/* ── Transactions Tab ───────────────────────────────────────────── */}
        <TabsContent value="transactions" className="space-y-6">
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={exportTxExcel}
              disabled={isTxExporting || txLoading || transactions.length === 0}
            >
              {txExporting === "xlsx" ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <FileSpreadsheet className="w-4 h-4 mr-1.5" />}
              {txExporting === "xlsx" ? "Exporting…" : "Excel (.xlsx)"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={exportTxPDF}
              disabled={isTxExporting || txLoading || transactions.length === 0}
            >
              {txExporting === "pdf" ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <FileText className="w-4 h-4 mr-1.5" />}
              {txExporting === "pdf" ? "Exporting…" : "PDF (.pdf)"}
            </Button>
          </div>

          {/* Tx Filters */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Filter className="w-4 h-4" />
                  Filters
                </div>
                <button
                  onClick={() => setShowAllFilters(true)}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  title="View and manage saved report filters"
                >
                  <Layers className="w-3.5 h-3.5" />
                  Manage saved filters
                </button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <CalendarRange className="w-4 h-4 text-muted-foreground shrink-0" />
                {DATE_PRESETS.map((p) => (
                  <Button
                    key={p.label}
                    variant={txActivePreset === p.label ? "secondary" : "outline"}
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => applyTxPreset(p)}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>

              {/* Saved filter chips */}
              {savedFilters.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
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
                        "group inline-flex items-center gap-0.5 rounded-full border border-sky-500/30 bg-sky-500/8 text-xs font-medium text-sky-300 hover:border-sky-500/60 transition-colors select-none",
                        renamingId !== saved.id ? "cursor-grab active:cursor-grabbing" : "",
                        draggingId === saved.id ? "opacity-40 scale-95" : "",
                        dragOverId === saved.id && draggingId !== saved.id ? "ring-1 ring-sky-400 border-sky-500/60 bg-sky-500/15" : "",
                      ].filter(Boolean).join(" ")}
                    >
                      {idx > 0 && (
                        <button
                          onClick={() => moveSavedFilter(saved.id, -1)}
                          className="pl-1.5 pr-0.5 py-1 rounded-l-full text-sky-400/40 hover:text-sky-200 hover:bg-sky-500/10 transition-colors opacity-0 group-hover:opacity-100"
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
                          className="w-28 bg-transparent border-b border-sky-400 text-sky-100 text-xs outline-none py-0.5 mx-1"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitRename();
                            if (e.key === "Escape") cancelRename();
                          }}
                          onBlur={commitRename}
                          maxLength={40}
                        />
                      ) : (
                        <button
                          onClick={() => applySavedFilter(saved)}
                          className="flex items-center gap-1 px-1 py-1 hover:text-sky-100 transition-colors"
                          title={`Apply: ${saved.rawInput}`}
                        >
                          <BookmarkCheck className="w-3 h-3 shrink-0" />
                          {saved.name}
                        </button>
                      )}

                      {renamingId !== saved.id && (
                        <button
                          onClick={() => startRename(saved)}
                          className="p-0.5 text-sky-400/40 hover:text-sky-200 hover:bg-sky-500/10 transition-colors opacity-0 group-hover:opacity-100"
                          aria-label={`Rename "${saved.name}"`}
                          title="Rename"
                        >
                          <Pencil className="w-2.5 h-2.5" />
                        </button>
                      )}

                      {renamingId !== saved.id && (
                        <button
                          onClick={() => deleteSavedFilter(saved.id)}
                          className="pr-1.5 p-0.5 rounded-r-full text-sky-400/40 hover:text-rose-400 hover:bg-rose-500/10 transition-colors opacity-0 group-hover:opacity-100"
                          aria-label={`Delete saved filter "${saved.name}"`}
                          title="Delete this saved filter"
                        >
                          <Trash2 className="w-2.5 h-2.5" />
                        </button>
                      )}

                      {idx < savedFilters.length - 1 && renamingId !== saved.id && (
                        <button
                          onClick={() => moveSavedFilter(saved.id, 1)}
                          className="pr-1.5 pl-0.5 py-1 rounded-r-full text-sky-400/40 hover:text-sky-200 hover:bg-sky-500/10 transition-colors opacity-0 group-hover:opacity-100"
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

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">From</Label>
                  <Input
                    type="date"
                    value={txDateFrom}
                    onChange={(e) => { setTxDateFrom(e.target.value); setTxActivePreset(null); }}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">To</Label>
                  <Input
                    type="date"
                    value={txDateTo}
                    onChange={(e) => { setTxDateTo(e.target.value); setTxActivePreset(null); }}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Type</Label>
                  <Select value={type} onValueChange={setType}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All types</SelectItem>
                      <SelectItem value="deposit">Deposit</SelectItem>
                      <SelectItem value="withdrawal">Withdrawal</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Status</Label>
                  <Select value={txStatus} onValueChange={setTxStatus}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      <SelectItem value="success">Success</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="failed">Failed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Source</Label>
                  <Select value={source} onValueChange={setSource}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All sources</SelectItem>
                      <SelectItem value="qr_code">
                        <span className="flex items-center gap-1.5"><QrCode className="w-3 h-3" />QR Code</span>
                      </SelectItem>
                      <SelectItem value="virtual_account">
                        <span className="flex items-center gap-1.5"><Building2 className="w-3 h-3" />Virtual Account</span>
                      </SelectItem>
                      <SelectItem value="payment_link">
                        <span className="flex items-center gap-1.5"><Link2 className="w-3 h-3" />Payment Link</span>
                      </SelectItem>
                      <SelectItem value="direct">Direct</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Provider</Label>
                  <Select value={connectionProvider} onValueChange={setConnectionProvider}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All providers</SelectItem>
                      {PROVIDERS.map((p) => (
                        <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Save filter bar */}
              <div className="flex items-center gap-2 flex-wrap">
                {hasAnyFilter && !isCurrentFilterSaved && !showSaveInput && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs border-sky-500/40 text-sky-300 hover:bg-sky-500/10 hover:text-sky-200"
                    onClick={openSaveInput}
                    title="Save this filter combination for quick access"
                  >
                    <Bookmark className="w-3.5 h-3.5 mr-1.5" />Save current filters
                  </Button>
                )}
                {hasAnyFilter && isCurrentFilterSaved && (
                  <span className="inline-flex items-center gap-1 text-xs text-sky-400/60 font-medium">
                    <BookmarkCheck className="w-3.5 h-3.5" />Saved
                  </span>
                )}
                {showSaveInput && (
                  <div className="flex items-start gap-2">
                    <div className="flex-1">
                      <Input
                        ref={saveNameInputRef}
                        className="h-7 text-xs max-w-[240px]"
                        placeholder="Name this filter preset…"
                        value={saveFilterName}
                        onChange={(e) => { setSaveFilterName(e.target.value); setSaveFilterNameError(""); }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") confirmSaveFilter();
                          if (e.key === "Escape") cancelSaveFilter();
                        }}
                        maxLength={40}
                      />
                      {saveFilterNameError && (
                        <p className="mt-1 text-xs text-rose-400">{saveFilterNameError}</p>
                      )}
                    </div>
                    <Button size="sm" className="h-7 text-xs shrink-0" onClick={confirmSaveFilter}>Save</Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs shrink-0 px-2" onClick={cancelSaveFilter}>
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <AllFiltersSheet open={showAllFilters} onOpenChange={setShowAllFilters} />

          {/* Tx Stats */}
          {txStats && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <Card>
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                    <ArrowDownLeft className="w-3 h-3 text-emerald-400" />Deposit Volume
                  </p>
                  <p className="text-base font-bold text-emerald-400">{fmt(txStats.depositVolume)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                    <ArrowUpRight className="w-3 h-3 text-orange-400" />Withdrawal Volume
                  </p>
                  <p className="text-base font-bold text-orange-400">{fmt(txStats.withdrawalVolume)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                    <Coins className="w-3 h-3 text-violet-400" />Total Fees
                  </p>
                  <p className="text-base font-bold text-violet-400">{fmt(txStats.totalFees)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />Successful
                  </p>
                  <p className="text-base font-bold">{txStats.successCount.toLocaleString("en-IN")}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                    <XCircle className="w-3 h-3 text-red-400" />Failed
                  </p>
                  <p className="text-base font-bold text-red-400">{txStats.failedCount.toLocaleString("en-IN")}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                    <Clock className="w-3 h-3 text-amber-400" />Pending
                  </p>
                  <p className="text-base font-bold text-amber-400">{txStats.pendingCount.toLocaleString("en-IN")}</p>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Tx Table */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">
                  {txLoading || txFetching ? (
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />Loading…
                    </span>
                  ) : (
                    <span>{transactions.length.toLocaleString("en-IN")} transaction{transactions.length !== 1 ? "s" : ""} matched</span>
                  )}
                </p>
                {transactions.length > 0 && (
                  <div className="flex items-center gap-1.5">
                    <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={exportTxExcel} disabled={isTxExporting}>
                      <Download className="w-3 h-3" />xlsx
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={exportTxPDF} disabled={isTxExporting}>
                      <Download className="w-3 h-3" />pdf
                    </Button>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {txNoData ? (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
                  <FileText className="w-10 h-10 opacity-20" />
                  <p className="text-sm">No transactions match the selected filters</p>
                  <p className="text-xs opacity-60">Try adjusting the date range or clearing filters</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>UTR</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Settlement</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead>Provider</TableHead>
                        <TableHead className="text-right">Fee (₹)</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {txLoading
                        ? Array.from({ length: 5 }).map((_, i) => (
                            <TableRow key={i}>
                              {Array.from({ length: 9 }).map((__, j) => (
                                <TableCell key={j}><div className="h-4 w-full bg-muted animate-pulse rounded" /></TableCell>
                              ))}
                            </TableRow>
                          ))
                        : transactions.slice(0, 100).map((t) => {
                            const src = t.qrCodeId ? "QR Code" : t.virtualAccountId ? "Virtual Account" : t.paymentLinkId ? "Payment Link" : "Direct";
                            return (
                              <TableRow key={t.id}>
                                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                                  {format(new Date(t.createdAt), "dd MMM yyyy, HH:mm")}
                                </TableCell>
                                <TableCell className="font-mono text-xs">{t.utr}</TableCell>
                                <TableCell>
                                  <span className={`text-xs font-medium capitalize ${t.type === "deposit" ? "text-emerald-400" : "text-orange-400"}`}>
                                    {t.type}
                                  </span>
                                </TableCell>
                                <TableCell><StatusBadge status={t.status} /></TableCell>
                                <TableCell>
                                  <span className={`text-xs capitalize ${settlementBadgeColor(t.settlementStatus)}`}>
                                    {t.settlementStatus}
                                  </span>
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground">{src}</TableCell>
                                <TableCell className="text-xs capitalize text-muted-foreground">
                                  {t.connectionProvider ?? "—"}
                                </TableCell>
                                <TableCell className="text-right text-xs text-muted-foreground">
                                  {Number(t.fee) > 0 ? fmt(Number(t.fee)) : "—"}
                                </TableCell>
                                <TableCell className="text-right font-medium text-sm">
                                  {fmt(Number(t.amount))}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                    </TableBody>
                  </Table>
                  {transactions.length > 100 && (
                    <div className="text-center py-3 text-xs text-muted-foreground border-t border-border/50">
                      Showing first 100 of {transactions.length.toLocaleString("en-IN")} transactions — download the full report to see all rows
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Settlements Tab ────────────────────────────────────────────── */}
        <TabsContent value="settlements" className="space-y-6">
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={exportStlExcel}
              disabled={isStlExporting || stlLoading || settlements.length === 0}
            >
              {stlExporting === "xlsx" ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <FileSpreadsheet className="w-4 h-4 mr-1.5" />}
              {stlExporting === "xlsx" ? "Exporting…" : "Excel (.xlsx)"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={exportStlPDF}
              disabled={isStlExporting || stlLoading || settlements.length === 0}
            >
              {stlExporting === "pdf" ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <FileText className="w-4 h-4 mr-1.5" />}
              {stlExporting === "pdf" ? "Exporting…" : "PDF (.pdf)"}
            </Button>
          </div>

          {/* Settlement Filters */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Filter className="w-4 h-4" />
                Filters
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <CalendarRange className="w-4 h-4 text-muted-foreground shrink-0" />
                {DATE_PRESETS.map((p) => (
                  <Button
                    key={p.label}
                    variant={stlActivePreset === p.label ? "secondary" : "outline"}
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => applyStlPreset(p)}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">From</Label>
                  <Input
                    type="date"
                    value={stlDateFrom}
                    onChange={(e) => { setStlDateFrom(e.target.value); setStlActivePreset(null); }}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">To</Label>
                  <Input
                    type="date"
                    value={stlDateTo}
                    onChange={(e) => { setStlDateTo(e.target.value); setStlActivePreset(null); }}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Status</Label>
                  <Select value={stlStatus} onValueChange={setStlStatus}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="processing">Processing</SelectItem>
                      <SelectItem value="approved">Approved</SelectItem>
                      <SelectItem value="paid">Paid</SelectItem>
                      <SelectItem value="rejected">Rejected</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground flex items-center gap-1">
                    <Hash className="w-3 h-3" />Settlement ID
                  </Label>
                  <Input
                    type="number"
                    value={settlementId}
                    onChange={(e) => setSettlementId(e.target.value)}
                    placeholder="e.g. 42"
                    className="h-8 text-sm"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Settlement Stats */}
          {stlStats && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              <Card>
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                    <TrendingUp className="w-3 h-3 text-primary" />Total Amount
                  </p>
                  <p className="text-base font-bold">{fmt(stlStats.totalAmount)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                    <Banknote className="w-3 h-3 text-emerald-400" />Paid Amount
                  </p>
                  <p className="text-base font-bold text-emerald-400">{fmt(stlStats.paidAmount)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                    <Wallet className="w-3 h-3 text-amber-400" />Pending Amount
                  </p>
                  <p className="text-base font-bold text-amber-400">{fmt(stlStats.pendingAmount)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />Paid
                  </p>
                  <p className="text-base font-bold">{stlStats.paidCount.toLocaleString("en-IN")}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                    <Clock className="w-3 h-3 text-amber-400" />Pending / Processing
                  </p>
                  <p className="text-base font-bold text-amber-400">
                    {(stlStats.pendingCount + stlStats.processingCount).toLocaleString("en-IN")}
                  </p>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Settlement Table */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">
                  {stlLoading || stlFetching ? (
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />Loading…
                    </span>
                  ) : (
                    <span>{settlements.length.toLocaleString("en-IN")} settlement{settlements.length !== 1 ? "s" : ""} matched</span>
                  )}
                </p>
                {settlements.length > 0 && (
                  <div className="flex items-center gap-1.5">
                    <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={exportStlExcel} disabled={isStlExporting}>
                      <Download className="w-3 h-3" />xlsx
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={exportStlPDF} disabled={isStlExporting}>
                      <Download className="w-3 h-3" />pdf
                    </Button>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {stlNoData ? (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
                  <Banknote className="w-10 h-10 opacity-20" />
                  <p className="text-sm">No settlements match the selected filters</p>
                  <p className="text-xs opacity-60">Try adjusting the date range or clearing filters</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>ID</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Period</TableHead>
                        <TableHead className="text-right">Requested (₹)</TableHead>
                        <TableHead className="text-right">Settled (₹)</TableHead>
                        <TableHead className="text-right">Fees (₹)</TableHead>
                        <TableHead className="text-right">Txns</TableHead>
                        <TableHead>UTR / Reference</TableHead>
                        <TableHead>Paid At</TableHead>
                        <TableHead>Created</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {stlLoading
                        ? Array.from({ length: 5 }).map((_, i) => (
                            <TableRow key={i}>
                              {Array.from({ length: 9 }).map((__, j) => (
                                <TableCell key={j}><div className="h-4 w-full bg-muted animate-pulse rounded" /></TableCell>
                              ))}
                            </TableRow>
                          ))
                        : settlements.slice(0, 100).map((s) => (
                            <TableRow key={s.id}>
                              <TableCell className="font-mono text-xs text-muted-foreground">#{s.id}</TableCell>
                              <TableCell>
                                <span className={`text-xs font-medium capitalize ${settlementStatusColor(s.status)}`}>
                                  {s.status}
                                </span>
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                                {s.periodFrom && s.periodTo ? `${s.periodFrom} → ${s.periodTo}` : "—"}
                              </TableCell>
                              <TableCell className="text-right text-xs text-muted-foreground">
                                {s.requestedAmount != null ? fmt(Number(s.requestedAmount)) : "—"}
                              </TableCell>
                              <TableCell className="text-right font-medium text-sm">
                                {fmt(Number(s.amount))}
                              </TableCell>
                              <TableCell className="text-right text-xs text-muted-foreground">
                                {Number(s.fees ?? 0) > 0 ? fmt(Number(s.fees)) : "—"}
                              </TableCell>
                              <TableCell className="text-right text-xs text-muted-foreground">
                                {s.transactionCount.toLocaleString("en-IN")}
                              </TableCell>
                              <TableCell className="font-mono text-xs text-muted-foreground">
                                {s.referenceNumber ?? "—"}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                                {s.paidAt ? format(new Date(s.paidAt), "dd MMM yyyy") : "—"}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                                {format(new Date(s.createdAt), "dd MMM yyyy")}
                              </TableCell>
                            </TableRow>
                          ))}
                    </TableBody>
                  </Table>
                  {settlements.length > 100 && (
                    <div className="text-center py-3 text-xs text-muted-foreground border-t border-border/50">
                      Showing first 100 of {settlements.length.toLocaleString("en-IN")} settlements — download the full report to see all rows
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
