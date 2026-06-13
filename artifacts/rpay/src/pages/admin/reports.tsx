import { useState, useCallback } from "react";
import { useGetTransactionReport, useListMerchants } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
  Store,
  QrCode,
  Building2,
  Link2,
  Coins,
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

function fmt(amount: number) {
  return `₹${amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function settlementBadgeColor(s: string) {
  if (s === "paid") return "text-emerald-400";
  if (s === "approved" || s === "processing") return "text-amber-400";
  return "text-muted-foreground";
}

export default function AdminReports() {
  const [dateFrom, setDateFrom] = useState(() => format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [dateTo, setDateTo] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [connectionProvider, setConnectionProvider] = useState("all");
  const [source, setSource] = useState("all");
  const [merchantId, setMerchantId] = useState("all");
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [exporting, setExporting] = useState<"pdf" | "xlsx" | null>(null);

  const { data: merchantsData } = useListMerchants({ page: 1, limit: 200 });
  const merchants = merchantsData?.data ?? [];

  const params = {
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    type: type !== "all" ? (type as "deposit" | "withdrawal") : undefined,
    status: status !== "all" ? (status as "pending" | "success" | "failed") : undefined,
    connectionProvider: connectionProvider !== "all" ? (connectionProvider as "phonepe" | "paytm" | "bharatpe" | "yono_sbi" | "hdfc_smarthub" | "upi_id") : undefined,
    source: source !== "all" ? (source as "qr_code" | "virtual_account" | "payment_link" | "direct") : undefined,
    merchantId: merchantId !== "all" ? parseInt(merchantId) : undefined,
  };

  const { data, isLoading, isFetching } = useGetTransactionReport(params);

  const transactions = data?.data ?? [];
  const stats = data?.stats;

  const selectedMerchantName = merchantId !== "all"
    ? (merchants.find((m) => m.id === parseInt(merchantId))?.businessName ?? `Merchant #${merchantId}`)
    : "All Merchants";

  const applyPreset = (preset: typeof DATE_PRESETS[number]) => {
    const range = preset.getRange();
    setDateFrom(range.from);
    setDateTo(range.to);
    setActivePreset(preset.label);
  };

  const handleDateChange = (field: "from" | "to", val: string) => {
    if (field === "from") setDateFrom(val);
    else setDateTo(val);
    setActivePreset(null);
  };

  const exportExcel = useCallback(async () => {
    if (!transactions.length) { toast.error("No data to export"); return; }
    setExporting("xlsx");
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();

      const summaryRows = [
        ["RasoKart — Admin Transaction Report"],
        [`Generated: ${format(new Date(), "dd/MM/yyyy HH:mm")}`],
        [`Merchant: ${selectedMerchantName}`],
        [`Period: ${dateFrom || "All time"} to ${dateTo || "All time"}`],
        [],
        ["Summary"],
        ["Total Transactions", transactions.length],
        ["Deposit Volume (₹)", stats?.depositVolume ?? 0],
        ["Withdrawal Volume (₹)", stats?.withdrawalVolume ?? 0],
        ["Total Fees (₹)", stats?.totalFees ?? 0],
        ["Successful", stats?.successCount ?? 0],
        ["Failed", stats?.failedCount ?? 0],
        ["Pending", stats?.pendingCount ?? 0],
      ];
      const ws1 = XLSX.utils.aoa_to_sheet(summaryRows);
      ws1["!cols"] = [{ wch: 28 }, { wch: 20 }];
      XLSX.utils.book_append_sheet(wb, ws1, "Summary");

      const txRows = [
        ["Date", "Merchant", "UTR", "Reference ID", "Type", "Status", "Settlement Status", "Amount (₹)", "Fee (₹)", "Currency", "Source", "Provider", "Description"],
        ...transactions.map((t) => {
          const src = t.qrCodeId ? "QR Code" : t.virtualAccountId ? "Virtual Account" : t.paymentLinkId ? "Payment Link" : "Direct";
          return [
            format(new Date(t.createdAt), "dd/MM/yyyy HH:mm"),
            t.merchantName ?? "",
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
      ws2["!cols"] = [{ wch: 18 }, { wch: 22 }, { wch: 22 }, { wch: 18 }, { wch: 12 }, { wch: 10 }, { wch: 16 }, { wch: 14 }, { wch: 12 }, { wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 30 }];
      XLSX.utils.book_append_sheet(wb, ws2, "Transactions");

      XLSX.writeFile(wb, `rasokart-admin-report-${format(new Date(), "yyyy-MM-dd")}.xlsx`);
      toast.success("Excel report downloaded");
    } catch {
      toast.error("Failed to export Excel");
    } finally {
      setExporting(null);
    }
  }, [transactions, stats, dateFrom, dateTo, selectedMerchantName]);

  const exportPDF = useCallback(async () => {
    if (!transactions.length) { toast.error("No data to export"); return; }
    setExporting("pdf");
    try {
      const { jsPDF } = await import("jspdf");
      const { default: autoTable } = await import("jspdf-autotable");

      const doc = new jsPDF({ orientation: "landscape" });

      doc.setFontSize(18);
      doc.setFont("helvetica", "bold");
      doc.text("RasoKart — Admin Transaction Report", 14, 18);

      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(120, 120, 120);
      doc.text(`Generated: ${format(new Date(), "dd/MM/yyyy HH:mm")}`, 14, 26);
      doc.text(`Merchant: ${selectedMerchantName}`, 14, 32);
      doc.text(`Period: ${dateFrom || "All time"} → ${dateTo || "All time"}`, 14, 38);
      doc.setTextColor(0, 0, 0);

      autoTable(doc, {
        startY: 46,
        head: [["Metric", "Value"]],
        body: [
          ["Total Transactions", transactions.length.toString()],
          ["Deposit Volume", fmt(stats?.depositVolume ?? 0)],
          ["Withdrawal Volume", fmt(stats?.withdrawalVolume ?? 0)],
          ["Total Fees", fmt(stats?.totalFees ?? 0)],
          ["Successful", (stats?.successCount ?? 0).toString()],
          ["Failed", (stats?.failedCount ?? 0).toString()],
          ["Pending", (stats?.pendingCount ?? 0).toString()],
        ],
        theme: "grid",
        headStyles: { fillColor: [30, 30, 46] },
        columnStyles: { 0: { fontStyle: "bold", cellWidth: 60 }, 1: { cellWidth: 60 } },
      });

      const afterSummary = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;

      autoTable(doc, {
        startY: afterSummary,
        head: [["Date", "Merchant", "UTR", "Type", "Status", "Settlement", "Amount (₹)", "Fee (₹)", "Source", "Provider"]],
        body: transactions.map((t) => {
          const src = t.qrCodeId ? "QR Code" : t.virtualAccountId ? "Virtual Account" : t.paymentLinkId ? "Payment Link" : "Direct";
          return [
            format(new Date(t.createdAt), "dd/MM/yy HH:mm"),
            t.merchantName ?? "",
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
        styles: { fontSize: 7.5 },
        columnStyles: {
          0: { cellWidth: 22 },
          1: { cellWidth: 26 },
          2: { cellWidth: 30 },
          3: { cellWidth: 18 },
          4: { cellWidth: 18 },
          5: { cellWidth: 20 },
          6: { cellWidth: 24, halign: "right" },
          7: { cellWidth: 20, halign: "right" },
          8: { cellWidth: 22 },
          9: { cellWidth: "auto" },
        },
      });

      doc.save(`rasokart-admin-report-${format(new Date(), "yyyy-MM-dd")}.pdf`);
      toast.success("PDF report downloaded");
    } catch {
      toast.error("Failed to export PDF");
    } finally {
      setExporting(null);
    }
  }, [transactions, stats, dateFrom, dateTo, selectedMerchantName]);

  const isExporting = exporting !== null;
  const noData = !isLoading && transactions.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-primary" />
            Transaction Reports
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Generate and download transaction reports across all merchants
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={exportExcel}
            disabled={isExporting || isLoading || transactions.length === 0}
          >
            {exporting === "xlsx" ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <FileSpreadsheet className="w-4 h-4 mr-1.5" />}
            {exporting === "xlsx" ? "Exporting…" : "Excel (.xlsx)"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={exportPDF}
            disabled={isExporting || isLoading || transactions.length === 0}
          >
            {exporting === "pdf" ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <FileText className="w-4 h-4 mr-1.5" />}
            {exporting === "pdf" ? "Exporting…" : "PDF (.pdf)"}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Filter className="w-4 h-4" />
            Filters
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Date presets */}
          <div className="flex items-center gap-2 flex-wrap">
            <CalendarRange className="w-4 h-4 text-muted-foreground shrink-0" />
            {DATE_PRESETS.map((p) => (
              <Button
                key={p.label}
                variant={activePreset === p.label ? "secondary" : "outline"}
                size="sm"
                className="h-7 text-xs"
                onClick={() => applyPreset(p)}
              >
                {p.label}
              </Button>
            ))}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">From</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => handleDateChange("from", e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">To</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => handleDateChange("to", e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground flex items-center gap-1">
                <Store className="w-3 h-3" />
                Merchant
              </Label>
              <Select value={merchantId} onValueChange={setMerchantId}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All merchants</SelectItem>
                  {merchants.map((m) => (
                    <SelectItem key={m.id} value={m.id.toString()}>
                      {m.businessName ?? `Merchant #${m.id}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  <SelectItem value="deposit">Deposit</SelectItem>
                  <SelectItem value="withdrawal">Withdrawal</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
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
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
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
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All providers</SelectItem>
                  {PROVIDERS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                <ArrowDownLeft className="w-3 h-3 text-emerald-400" />
                Deposit Volume
              </p>
              <p className="text-base font-bold text-emerald-400">{fmt(stats.depositVolume)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                <ArrowUpRight className="w-3 h-3 text-orange-400" />
                Withdrawal Volume
              </p>
              <p className="text-base font-bold text-orange-400">{fmt(stats.withdrawalVolume)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                <Coins className="w-3 h-3 text-violet-400" />
                Total Fees
              </p>
              <p className="text-base font-bold text-violet-400">{fmt(stats.totalFees)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                Successful
              </p>
              <p className="text-base font-bold">{stats.successCount.toLocaleString("en-IN")}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                <XCircle className="w-3 h-3 text-red-400" />
                Failed
              </p>
              <p className="text-base font-bold text-red-400">{stats.failedCount.toLocaleString("en-IN")}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                <Clock className="w-3 h-3 text-amber-400" />
                Pending
              </p>
              <p className="text-base font-bold text-amber-400">{stats.pendingCount.toLocaleString("en-IN")}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Preview table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">
              {isLoading || isFetching ? (
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Loading…
                </span>
              ) : (
                <span>{transactions.length.toLocaleString("en-IN")} transaction{transactions.length !== 1 ? "s" : ""} matched</span>
              )}
            </p>
            {transactions.length > 0 && (
              <div className="flex items-center gap-1.5">
                <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={exportExcel} disabled={isExporting}>
                  <Download className="w-3 h-3" />
                  xlsx
                </Button>
                <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={exportPDF} disabled={isExporting}>
                  <Download className="w-3 h-3" />
                  pdf
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {noData ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
              <FileText className="w-10 h-10 opacity-20" />
              <p className="text-sm">No transactions match the selected filters</p>
              <p className="text-xs opacity-60">Try adjusting the date range, merchant, or clearing filters</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Merchant</TableHead>
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
                  {isLoading
                    ? Array.from({ length: 5 }).map((_, i) => (
                        <TableRow key={i}>
                          {Array.from({ length: 10 }).map((__, j) => (
                            <TableCell key={j}>
                              <div className="h-4 w-full bg-muted animate-pulse rounded" />
                            </TableCell>
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
                            <TableCell className="text-xs text-muted-foreground">
                              {t.merchantName ?? "—"}
                            </TableCell>
                            <TableCell className="font-mono text-xs">{t.utr}</TableCell>
                            <TableCell>
                              <span className={`text-xs font-medium capitalize ${t.type === "deposit" ? "text-emerald-400" : "text-orange-400"}`}>
                                {t.type}
                              </span>
                            </TableCell>
                            <TableCell>
                              <StatusBadge status={t.status} />
                            </TableCell>
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
    </div>
  );
}
