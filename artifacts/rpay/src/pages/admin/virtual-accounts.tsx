import { useState, useCallback } from "react";
import { Link } from "wouter";
import {
  useListVirtualAccounts,
  useUpdateVirtualAccount,
  useDeleteVirtualAccount,
  useGetVirtualAccountTransactions,
  useGetVirtualAccountBalanceHistory,
  useListVaBalanceAudit,
  useBackfillVaBalanceHistory,
} from "@workspace/api-client-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tooltip as UITooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ExportCsvButton } from "@/components/ui/export-csv-button";
import { useMonitoringRefresh } from "@/hooks/use-monitoring-refresh";
import { Search, XCircle, Trash2, X, Eye, Download, Calendar, RefreshCw, Pencil, AlertCircle, Copy, QrCode, History, TrendingUp, ShieldCheck, Info, Building2, ChevronDown, ChevronRight, Zap } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { QRCodeCanvas } from "qrcode.react";
import { buildUpiId, buildUpiUrl } from "@/lib/upi";

type VaRow = {
  id: number;
  merchantId?: number | null;
  accountNumber: string;
  ifsc: string;
  bankName: string;
  accountHolder: string;
  label?: string | null;
  balance: string;
  totalCollection: string;
  status: string;
  createdAt: string;
  merchantName?: string | null;
};

function AdminInlineVaRow({ va }: { va: VaRow }) {
  const [copied, setCopied] = useState<"account" | "upi" | null>(null);

  const { data: txData, isLoading: txLoading } = useGetVirtualAccountTransactions(
    va.id,
    { query: { enabled: true } as any }
  );

  const recentTx = (txData?.data ?? []).slice(0, 5);

  const handleCopyAccountNumber = useCallback(() => {
    navigator.clipboard.writeText(va.accountNumber).then(() => {
      setCopied("account");
      toast.success("Account number copied");
      setTimeout(() => setCopied(null), 2000);
    });
  }, [va.accountNumber]);

  const handleCopyUpiId = useCallback(() => {
    const upiId = buildUpiId(va.accountNumber, va.ifsc);
    navigator.clipboard.writeText(upiId).then(() => {
      setCopied("upi");
      toast.success("UPI ID copied");
      setTimeout(() => setCopied(null), 2000);
    });
  }, [va.accountNumber, va.ifsc]);

  const handleDownloadQr = useCallback(() => {
    const canvas = document.querySelector(`#admin-va-inline-qr-${va.id} canvas`) as HTMLCanvasElement | null;
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `va-qr-${va.accountNumber}.png`;
    a.click();
    toast.success("QR code downloaded");
  }, [va.accountNumber, va.id]);

  return (
    <TableRow className="bg-muted/20 border-t-0 hover:bg-muted/20">
      <TableCell colSpan={11} className="py-4 px-6">
        <div className="flex gap-6 items-start">
          {/* UPI QR */}
          <div id={`admin-va-inline-qr-${va.id}`} className="bg-white p-3 rounded-xl shrink-0">
            <QRCodeCanvas
              value={buildUpiUrl(va.accountNumber, va.ifsc, va.accountHolder)}
              size={120}
              level="H"
              includeMargin
            />
          </div>

          <div className="flex-1 min-w-0">
            {/* Merchant context */}
            <div className="flex items-center gap-2 mb-3 pb-3 border-b border-border/50">
              <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />
              <div>
                <span className="text-xs text-muted-foreground">Merchant · </span>
                <span className="text-sm font-semibold">{va.merchantName ?? "Unknown"}</span>
                {va.merchantId != null && (
                  <span className="text-xs text-muted-foreground ml-2">ID #{va.merchantId}</span>
                )}
              </div>
            </div>

            {/* Account metadata grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-sm mb-3">
              <div>
                <span className="text-xs text-muted-foreground block">Account Number</span>
                <span className="font-mono text-xs">{va.accountNumber}</span>
              </div>
              <div>
                <span className="text-xs text-muted-foreground block">Bank</span>
                <span className="text-xs">{va.bankName}</span>
              </div>
              <div>
                <span className="text-xs text-muted-foreground block">IFSC</span>
                <span className="font-mono text-xs">{va.ifsc}</span>
              </div>
              <div>
                <span className="text-xs text-muted-foreground block">Status</span>
                <Badge variant={va.status === "active" ? "default" : "secondary"} className="text-xs capitalize">
                  {va.status}
                </Badge>
              </div>
              <div>
                <span className="text-xs text-muted-foreground block">Balance</span>
                <span className="font-mono text-xs font-semibold text-emerald-400">
                  ₹{parseFloat(va.balance || "0").toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div>
                <span className="text-xs text-muted-foreground block">Total Collection</span>
                <span className="font-mono text-xs font-semibold text-blue-400">
                  ₹{parseFloat(va.totalCollection || "0").toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div>
                <span className="text-xs text-muted-foreground block">UPI ID</span>
                <span className="font-mono text-xs text-muted-foreground">{buildUpiId(va.accountNumber, va.ifsc)}</span>
              </div>
              <div>
                <span className="text-xs text-muted-foreground block">Created</span>
                <span className="text-xs">{format(new Date(va.createdAt), "MMM d, yyyy")}</span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2 mb-4">
              <Button size="sm" variant="outline" onClick={handleCopyAccountNumber} className="h-7 text-xs px-3">
                <Copy className="w-3.5 h-3.5 mr-1.5" />
                {copied === "account" ? "Copied!" : "Copy Account No."}
              </Button>
              <Button size="sm" variant="outline" onClick={handleCopyUpiId} className="h-7 text-xs px-3">
                <Copy className="w-3.5 h-3.5 mr-1.5" />
                {copied === "upi" ? "Copied!" : "Copy UPI ID"}
              </Button>
              <Button size="sm" variant="outline" onClick={handleDownloadQr} className="h-7 text-xs px-3">
                <Download className="w-3.5 h-3.5 mr-1.5" />Download QR
              </Button>
            </div>

            {/* Recent transactions */}
            <div className="border-t border-border/50 pt-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Recent Transactions
              </p>
              {txLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="h-9 bg-muted/40 rounded-md animate-pulse" />
                  ))}
                </div>
              ) : recentTx.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No transactions yet</p>
              ) : (
                <div className="space-y-1.5">
                  {recentTx.map(tx => (
                    <div key={tx.id} className="flex items-center gap-3 rounded-md border border-border/60 bg-muted/20 px-3 py-2">
                      <Zap className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <div className="flex-1 min-w-0 flex items-center gap-3 flex-wrap">
                        <span className="font-mono text-xs font-semibold">
                          ₹{parseFloat(tx.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </span>
                        <Badge
                          variant={tx.status === "success" ? "default" : tx.status === "failed" ? "destructive" : "secondary"}
                          className="text-[10px] capitalize px-1.5 py-0"
                        >
                          {tx.status}
                        </Badge>
                        <Badge variant="outline" className="text-[10px] capitalize px-1.5 py-0">{tx.type}</Badge>
                        {tx.utr && (
                          <span className="font-mono text-[10px] text-muted-foreground">UTR: {tx.utr}</span>
                        )}
                        <span className="text-[10px] text-muted-foreground ml-auto">
                          {format(new Date(tx.createdAt), "MMM d, HH:mm")}
                        </span>
                      </div>
                    </div>
                  ))}
                  {(txData?.data?.length ?? 0) > 5 && (
                    <p className="text-[10px] text-muted-foreground text-right pt-1">
                      +{(txData?.data?.length ?? 0) - 5} more — open full view for complete history
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </TableCell>
    </TableRow>
  );
}

type PageTab = "accounts" | "audit";

export default function AdminVirtualAccounts() {
  const qc = useQueryClient();
  const [pageTab, setPageTab] = useState<PageTab>("accounts");

  // Accounts tab state
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [merchantName, setMerchantName] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const m = params.get("merchant");
    if (m) window.history.replaceState({}, "", window.location.pathname);
    return m ?? "";
  });
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [expandedVaId, setExpandedVaId] = useState<number | null>(null);
  const [selectedVa, setSelectedVa] = useState<VaRow | null>(null);
  const [drawerTab, setDrawerTab] = useState<"transactions" | "history">("transactions");
  const [editVa, setEditVa] = useState<VaRow | null>(null);
  const [editMode, setEditMode] = useState<"balance" | "collection">("balance");
  const [editValue, setEditValue] = useState("");
  const [editReason, setEditReason] = useState("");
  const [editError, setEditError] = useState<string | null>(null);

  // Audit tab state
  const [auditMerchantName, setAuditMerchantName] = useState("");
  const [auditChangedBy, setAuditChangedBy] = useState("");
  const [auditDateFrom, setAuditDateFrom] = useState("");
  const [auditDateTo, setAuditDateTo] = useState("");
  const [auditFieldChanged, setAuditFieldChanged] = useState<"" | "balance" | "totalCollection">("");
  const [auditPage, setAuditPage] = useState(1);

  const { lastRefreshed, isRefreshing, handleRefresh } = useMonitoringRefresh(
    () => qc.invalidateQueries({ queryKey: ["/api/virtual-accounts"] })
  );

  const { data, isLoading } = useListVirtualAccounts({
    status: status as "active" | "closed" | "all",
    search: search || undefined,
    merchantName: merchantName || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    page,
    limit: 20,
  } as Parameters<typeof useListVirtualAccounts>[0]);

  const { data: auditData, isLoading: auditLoading } = useListVaBalanceAudit({
    merchantName: auditMerchantName || undefined,
    changedBy: auditChangedBy || undefined,
    dateFrom: auditDateFrom || undefined,
    dateTo: auditDateTo || undefined,
    fieldChanged: auditFieldChanged || undefined,
    page: auditPage,
    limit: 20,
  });

  const updateMutation = useUpdateVirtualAccount();
  const deleteMutation = useDeleteVirtualAccount();
  const backfillMutation = useBackfillVaBalanceHistory();

  const { data: historyData, isLoading: historyLoading } = useGetVirtualAccountTransactions(
    selectedVa?.id ?? 0,
    { query: { enabled: !!selectedVa } as any }
  );

  const { data: balHistoryData, isLoading: balHistoryLoading } = useGetVirtualAccountBalanceHistory(
    selectedVa?.id ?? 0,
    undefined,
    { query: { enabled: !!selectedVa } as any }
  );

  const handleClose = (id: number) => {
    updateMutation.mutate({ id, data: { status: "closed" } }, {
      onSuccess: () => { toast.success("Account closed"); qc.invalidateQueries({ queryKey: ["/api/virtual-accounts"] }); },
      onError: () => toast.error("Failed to close account"),
    });
  };

  const handleDelete = (id: number) => {
    if (!confirm("Delete this virtual account?")) return;
    deleteMutation.mutate({ id }, {
      onSuccess: () => { toast.success("Virtual account deleted"); qc.invalidateQueries({ queryKey: ["/api/virtual-accounts"] }); },
      onError: () => toast.error("Failed to delete"),
    });
  };

  const openAdjustBalance = (va: VaRow) => {
    setEditVa(va);
    setEditMode("balance");
    setEditValue(va.balance ?? "0.00");
    setEditReason("");
    setEditError(null);
  };

  const openRecordCollection = (va: VaRow) => {
    setEditVa(va);
    setEditMode("collection");
    setEditValue(va.totalCollection ?? "0.00");
    setEditReason("");
    setEditError(null);
  };

  const handleEditSave = () => {
    setEditError(null);
    const val = parseFloat(editValue);
    if (isNaN(val) || val < 0) {
      setEditError(`${editMode === "balance" ? "Balance" : "Total collection"} must be a non-negative number.`);
      return;
    }
    const vaId = editVa!.id;
    let payload: Record<string, string>;
    if (editMode === "balance") {
      const currentTc = parseFloat(editVa!.totalCollection);
      if (val > currentTc) {
        setEditError(`Balance cannot exceed total collection (₹${currentTc.toFixed(2)}).`);
        return;
      }
      payload = { balance: val.toFixed(2) };
    } else {
      const currentBal = parseFloat(editVa!.balance);
      if (val < currentBal) {
        setEditError(`Total collection cannot be set below the current balance (₹${currentBal.toFixed(2)}).`);
        return;
      }
      payload = { totalCollection: val.toFixed(2) };
    }
    if (editReason.trim()) payload.reason = editReason.trim();
    updateMutation.mutate(
      { id: vaId, data: payload as any },
      {
        onSuccess: () => {
          toast.success(editMode === "balance" ? "Balance adjusted" : "Collection recorded");
          setEditVa(null);
          qc.invalidateQueries({ queryKey: ["/api/virtual-accounts"] });
          qc.invalidateQueries({ queryKey: [`/api/virtual-accounts/${vaId}/balance-history`] });
          qc.invalidateQueries({ queryKey: ["/api/virtual-accounts/balance-audit"] });
        },
        onError: (err: any) => {
          const msg = err?.response?.data?.error ?? err?.response?.data?.message ?? null;
          setEditError(msg ?? "Failed to update.");
        },
      }
    );
  };

  const clearFilters = () => {
    setSearch(""); setMerchantName(""); setStatus("all"); setDateFrom(""); setDateTo(""); setPage(1);
  };

  const clearAuditFilters = () => {
    setAuditMerchantName(""); setAuditChangedBy(""); setAuditDateFrom(""); setAuditDateTo(""); setAuditFieldChanged(""); setAuditPage(1);
  };

  const hasFilters = search || merchantName || status !== "all" || dateFrom || dateTo;
  const hasAuditFilters = auditMerchantName || auditChangedBy || auditDateFrom || auditDateTo || auditFieldChanged;

  const exportCsv = async () => {
    const { downloadCsvFromUrl } = await import("@/components/ui/export-csv-button");
    await downloadCsvFromUrl("/api/virtual-accounts/export/csv", `virtual-accounts-${format(new Date(), "yyyy-MM-dd")}.csv`, {
      status: status !== "all" ? status : undefined,
      search: search || undefined,
      merchantName: merchantName || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    });
  };

  const txList = historyData?.data ?? [];
  const txCount = txList.length;
  const balList = balHistoryData?.data ?? [];

  const exportBalanceHistoryCsv = async () => {
    if (!selectedVa) return;
    const { downloadCsvFromUrl } = await import("@/components/ui/export-csv-button");
    await downloadCsvFromUrl(
      `/api/virtual-accounts/${selectedVa.id}/balance-history/export`,
      `balance-history-va-${selectedVa.id}.csv`
    );
  };

  const exportAuditCsv = async () => {
    const { downloadCsvFromUrl } = await import("@/components/ui/export-csv-button");
    await downloadCsvFromUrl(
      "/api/virtual-accounts/balance-audit/export/csv",
      `balance-audit-${format(new Date(), "yyyy-MM-dd")}.csv`,
      {
        merchantName: auditMerchantName || undefined,
        changedBy: auditChangedBy || undefined,
        dateFrom: auditDateFrom || undefined,
        dateTo: auditDateTo || undefined,
        fieldChanged: auditFieldChanged || undefined,
      }
    );
  };

  const exportMerchantBalanceHistoryCsv = async () => {
    if (!selectedVa) return;
    const mid = (selectedVa as any).merchantId;
    if (!mid) return;
    const { downloadCsvFromUrl } = await import("@/components/ui/export-csv-button");
    await downloadCsvFromUrl(
      `/api/virtual-accounts/balance-history/export`,
      `balance-history-merchant-${mid}.csv`,
      { merchantId: String(mid) }
    );
  };

  const handleCopyUpiId = (va: VaRow) => {
    const upiId = buildUpiId(va.accountNumber, va.ifsc);
    navigator.clipboard.writeText(upiId).then(() => toast.success("UPI ID copied to clipboard"));
  };

  const handleDownloadQr = (va: VaRow) => {
    const canvas = document.getElementById(`admin-va-qr-${va.id}`) as HTMLCanvasElement | null;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `va-qr-${va.accountNumber}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Virtual Accounts</h1>
          <p className="text-muted-foreground mt-1">Monitor all merchant virtual accounts · refreshed {format(lastRefreshed, "HH:mm:ss")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isRefreshing}>
            <RefreshCw className={`w-4 h-4 mr-1 ${isRefreshing ? "animate-spin" : ""}`} /> Refresh
          </Button>
          {pageTab === "accounts" && <ExportCsvButton onExport={exportCsv} />}
          {pageTab === "audit" && <ExportCsvButton onExport={exportAuditCsv} />}
        </div>
      </div>

      {/* Top-level tab switcher */}
      <div className="flex gap-1 border-b border-border">
        <button
          onClick={() => setPageTab("accounts")}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
            pageTab === "accounts"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Virtual Accounts
        </button>
        <button
          onClick={() => setPageTab("audit")}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
            pageTab === "audit"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          Balance Audit Log
        </button>
      </div>

      {pageTab === "accounts" ? (
        <>
          <Card>
            <CardHeader className="pb-4">
              <div className="flex flex-col gap-3">
                {/* Row 1: search inputs + status */}
                <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
                  <div className="relative flex-1 min-w-[160px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input className="pl-9" placeholder="Search account number, holder..." value={search}
                      onChange={e => { setSearch(e.target.value); setPage(1); }} />
                  </div>
                  <div className="relative min-w-[160px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input className="pl-9 pr-8" placeholder="Filter by merchant name..." value={merchantName}
                      onChange={e => { setMerchantName(e.target.value); setPage(1); }} />
                    {merchantName && (
                      <button className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        onClick={() => setMerchantName("")}>
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <Select value={status} onValueChange={v => { setStatus(v); setPage(1); }}>
                    <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="closed">Closed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {/* Row 2: date range */}
                <div className="flex flex-col sm:flex-row gap-3 items-center">
                  <div className="flex items-center gap-2 flex-1">
                    <Calendar className="w-4 h-4 text-muted-foreground shrink-0" />
                    <Input
                      type="date"
                      className="w-[160px]"
                      value={dateFrom}
                      onChange={e => { setDateFrom(e.target.value); setPage(1); }}
                    />
                    <span className="text-muted-foreground text-sm">to</span>
                    <Input
                      type="date"
                      className="w-[160px]"
                      value={dateTo}
                      onChange={e => { setDateTo(e.target.value); setPage(1); }}
                    />
                  </div>
                  {hasFilters && (
                    <Button variant="ghost" size="sm" onClick={clearFilters} className="text-muted-foreground hover:text-foreground">
                      <X className="w-3.5 h-3.5 mr-1.5" />Clear filters
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Merchant</TableHead>
                    <TableHead>Account Holder</TableHead>
                    <TableHead>Account Number</TableHead>
                    <TableHead>Bank</TableHead>
                    <TableHead>IFSC</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Balance</TableHead>
                    <TableHead>Total Collection</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>{Array.from({ length: 11 }).map((_, j) => <TableCell key={j}><div className="h-4 bg-muted/50 rounded animate-pulse" /></TableCell>)}</TableRow>
                    ))
                  ) : !data?.data?.length ? (
                    <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground py-10">No virtual accounts found</TableCell></TableRow>
                  ) : (data.data as VaRow[]).flatMap(va => {
                    const isExpanded = expandedVaId === va.id;
                    return [
                      <TableRow
                        key={va.id}
                        className={`cursor-pointer hover:bg-muted/30 ${isExpanded ? "bg-muted/20" : ""}`}
                        onClick={() => setExpandedVaId(prev => prev === va.id ? null : va.id)}
                      >
                        <TableCell className="w-5 pr-0">
                          {isExpanded
                            ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                            : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
                        </TableCell>
                        <TableCell className="font-medium text-sm">{va.merchantName ?? "—"}</TableCell>
                        <TableCell className="text-sm">{va.accountHolder}</TableCell>
                        <TableCell className="font-mono text-xs">{va.accountNumber}</TableCell>
                        <TableCell className="text-sm">{va.bankName}</TableCell>
                        <TableCell className="font-mono text-xs">{va.ifsc}</TableCell>
                        <TableCell onClick={e => e.stopPropagation()}>
                          <Badge variant={va.status === "active" ? "default" : "secondary"} className="text-xs">
                            {va.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-sm text-emerald-400">
                          ₹{parseFloat(va.balance || "0").toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="font-mono text-sm text-blue-400">
                          ₹{parseFloat(va.totalCollection || "0").toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{format(new Date(va.createdAt), "MMM d, yyyy")}</TableCell>
                        <TableCell className="text-right" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            <Button size="icon" variant="ghost" className="h-8 w-8 text-amber-400 hover:text-amber-300 hover:bg-amber-500/10"
                              title="Balance History" onClick={() => { setSelectedVa(va); setDrawerTab("history"); }}>
                              <History className="w-3.5 h-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-8 w-8 text-violet-400 hover:text-violet-300 hover:bg-violet-500/10"
                              title="Adjust Balance" onClick={() => openAdjustBalance(va)}>
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            {va.status === "active" && (
                              <Button size="sm" variant="ghost" className="text-amber-500 hover:text-amber-400 hover:bg-amber-500/10 h-8 text-xs"
                                onClick={() => handleClose(va.id)}>
                                <XCircle className="w-3.5 h-3.5 mr-1" />Close
                              </Button>
                            )}
                            <Button size="icon" variant="ghost" className="h-8 w-8 text-rose-500 hover:text-rose-400"
                              onClick={() => handleDelete(va.id)}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>,
                      ...(isExpanded ? [<AdminInlineVaRow key={`inline-${va.id}`} va={va} />] : []),
                    ];
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {data && data.total > 20 && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{data.total} total</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button>
                <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page * 20 >= data.total}>Next</Button>
              </div>
            </div>
          )}
        </>
      ) : (
        /* Balance Audit Log Tab */
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-4">
              <div className="flex flex-col gap-3">
                <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
                  <div className="relative flex-1 min-w-[160px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      className="pl-9 pr-8"
                      placeholder="Filter by merchant name..."
                      value={auditMerchantName}
                      onChange={e => { setAuditMerchantName(e.target.value); setAuditPage(1); }}
                    />
                    {auditMerchantName && (
                      <button className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        onClick={() => setAuditMerchantName("")}>
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="relative flex-1 min-w-[160px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      className="pl-9 pr-8"
                      placeholder="Filter by changed by..."
                      value={auditChangedBy}
                      onChange={e => { setAuditChangedBy(e.target.value); setAuditPage(1); }}
                    />
                    {auditChangedBy && (
                      <button className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        onClick={() => setAuditChangedBy("")}>
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <Select value={auditFieldChanged || "all"} onValueChange={v => { setAuditFieldChanged(v === "all" ? "" : v as "balance" | "totalCollection"); setAuditPage(1); }}>
                    <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Any field</SelectItem>
                      <SelectItem value="balance">Balance</SelectItem>
                      <SelectItem value="totalCollection">Total Collection</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col sm:flex-row gap-3 items-center">
                  <div className="flex items-center gap-2 flex-1">
                    <Calendar className="w-4 h-4 text-muted-foreground shrink-0" />
                    <Input
                      type="date"
                      className="w-[160px]"
                      value={auditDateFrom}
                      onChange={e => { setAuditDateFrom(e.target.value); setAuditPage(1); }}
                    />
                    <span className="text-muted-foreground text-sm">to</span>
                    <Input
                      type="date"
                      className="w-[160px]"
                      value={auditDateTo}
                      onChange={e => { setAuditDateTo(e.target.value); setAuditPage(1); }}
                    />
                  </div>
                  {hasAuditFilters && (
                    <Button variant="ghost" size="sm" onClick={clearAuditFilters} className="text-muted-foreground hover:text-foreground">
                      <X className="w-3.5 h-3.5 mr-1.5" />Clear filters
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={backfillMutation.isPending}
                    onClick={() => {
                      backfillMutation.mutate(undefined, {
                        onSuccess: (result) => {
                          if (result.rowsUpdated === 0) {
                            toast.info("No rows needed backfilling");
                          } else {
                            toast.success(`Backfilled ${result.rowsUpdated} history row${result.rowsUpdated !== 1 ? "s" : ""} across ${result.vasProcessed} virtual account${result.vasProcessed !== 1 ? "s" : ""}`);
                          }
                          qc.invalidateQueries({ queryKey: ["/api/virtual-accounts"] });
                        },
                        onError: () => toast.error("Backfill failed"),
                      });
                    }}
                    className="text-muted-foreground whitespace-nowrap"
                  >
                    <History className="w-3.5 h-3.5 mr-1.5" />
                    {backfillMutation.isPending ? "Backfilling…" : "Backfill History"}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {(() => {
                const auditBackfilledCount = auditData?.data?.filter(e => e.backfilled).length ?? 0;
                return auditBackfilledCount > 0 ? (
                  <div className="px-4 py-2 border-b border-border flex items-center gap-2">
                    <TooltipProvider>
                      <UITooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 text-[10px] font-medium text-amber-500 cursor-default select-none">
                            <span className="text-amber-500 leading-none" aria-hidden>■</span>
                            estimated rows
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="right" className="max-w-[260px] text-xs">
                          <p>Amber-highlighted rows were estimated during a balance backfill — values are reconstructed from deposit records and may not be exact.</p>
                          <p className="mt-1 text-muted-foreground">{auditBackfilledCount} of {auditData?.data?.length ?? 0} rows on this page are estimated.</p>
                        </TooltipContent>
                      </UITooltip>
                    </TooltipProvider>
                  </div>
                ) : null;
              })()}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Account Number</TableHead>
                    <TableHead>Merchant</TableHead>
                    <TableHead>Changed By</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>
                      <TooltipProvider>
                        <UITooltip>
                          <TooltipTrigger asChild>
                            <span className="flex items-center gap-1 cursor-default">
                              Balance Change
                              <Info className="w-3 h-3 text-amber-500/70 shrink-0" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-[220px] text-xs">
                            <span className="text-amber-400 font-semibold italic">est.</span> means the value was estimated during a balance backfill and may not be exact.
                          </TooltipContent>
                        </UITooltip>
                      </TooltipProvider>
                    </TableHead>
                    <TableHead>
                      <TooltipProvider>
                        <UITooltip>
                          <TooltipTrigger asChild>
                            <span className="flex items-center gap-1 cursor-default">
                              Collection Change
                              <Info className="w-3 h-3 text-amber-500/70 shrink-0" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-[220px] text-xs">
                            <span className="text-amber-400 font-semibold italic">est.</span> means the value was estimated during a balance backfill and may not be exact.
                          </TooltipContent>
                        </UITooltip>
                      </TooltipProvider>
                    </TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Timestamp</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {auditLoading ? (
                    Array.from({ length: 6 }).map((_, i) => (
                      <TableRow key={i}>{Array.from({ length: 8 }).map((_, j) => <TableCell key={j}><div className="h-4 bg-muted/50 rounded animate-pulse" /></TableCell>)}</TableRow>
                    ))
                  ) : !auditData?.data?.length ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-16">
                        <ShieldCheck className="w-8 h-8 mx-auto mb-2 text-muted-foreground opacity-30" />
                        <p className="text-sm text-muted-foreground">No balance changes found</p>
                        {hasAuditFilters && (
                          <p className="text-xs text-muted-foreground mt-1 opacity-70">Try adjusting your filters</p>
                        )}
                      </TableCell>
                    </TableRow>
                  ) : auditData.data.map(entry => (
                    <TableRow key={entry.id} className={entry.backfilled ? "bg-amber-500/[0.06] border-l-2 border-l-amber-500/60" : ""}>
                      <TableCell className="font-mono text-xs">{entry.accountNumber}</TableCell>
                      <TableCell className="text-sm font-medium">{entry.merchantName ?? "—"}</TableCell>
                      <TableCell className="text-sm">
                        <div className="flex items-center gap-1.5">
                          <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${entry.changedByRole === "admin" ? "bg-violet-400" : "bg-blue-400"}`} />
                          {entry.changedByName}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px] capitalize px-1.5">
                          {entry.changedByRole}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {entry.oldBalance != null && entry.newBalance != null ? (
                          entry.oldBalance !== entry.newBalance ? (
                            <div className="flex items-center gap-1 text-xs font-mono">
                              <span className="text-rose-400">₹{parseFloat(entry.oldBalance).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
                              <span className="text-muted-foreground">→</span>
                              <span className="text-emerald-400">₹{parseFloat(entry.newBalance).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
                              {entry.backfilled && <span className="text-[10px] text-amber-500/70 italic ml-0.5">est.</span>}
                            </div>
                          ) : (
                            <div className="flex items-center gap-1 text-xs font-mono">
                              <span className="text-muted-foreground/60">₹{parseFloat(entry.newBalance).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
                              <span className="text-[10px] text-muted-foreground/40 italic">unchanged</span>
                              {entry.backfilled && <span className="text-[10px] text-amber-500/70 italic">est.</span>}
                            </div>
                          )
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {entry.oldTotalCollection != null && entry.newTotalCollection != null ? (
                          entry.oldTotalCollection !== entry.newTotalCollection ? (
                            <div className="flex items-center gap-1 text-xs font-mono">
                              <span className="text-rose-400">₹{parseFloat(entry.oldTotalCollection).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
                              <span className="text-muted-foreground">→</span>
                              <span className="text-emerald-400">₹{parseFloat(entry.newTotalCollection).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
                              {entry.backfilled && <span className="text-[10px] text-amber-500/70 italic ml-0.5">est.</span>}
                            </div>
                          ) : (
                            <div className="flex items-center gap-1 text-xs font-mono">
                              <span className="text-muted-foreground/60">₹{parseFloat(entry.newTotalCollection).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
                              <span className="text-[10px] text-muted-foreground/40 italic">unchanged</span>
                              {entry.backfilled && <span className="text-[10px] text-amber-500/70 italic">est.</span>}
                            </div>
                          )
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs max-w-[180px]">
                        {(entry as any).reason ? (
                          <span className="text-amber-300/80 italic truncate block" title={(entry as any).reason}>
                            {(entry as any).reason}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {format(new Date(entry.createdAt), "MMM d, yyyy HH:mm")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {auditData && auditData.total > 20 && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{auditData.total} total entries</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setAuditPage(p => Math.max(1, p - 1))} disabled={auditPage === 1}>Previous</Button>
                <Button variant="outline" size="sm" onClick={() => setAuditPage(p => p + 1)} disabled={auditPage * 20 >= auditData.total}>Next</Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Adjust Balance / Record Collection Dialog */}
      <Dialog open={!!editVa} onOpenChange={v => { if (!v) setEditVa(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {editMode === "balance" ? "Adjust Current Balance" : "Record Manual Collection"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {editError && (
              <div className="flex items-start gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-sm text-rose-400">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{editError}</span>
              </div>
            )}
            {editVa && (
              <p className="text-sm text-muted-foreground">
                {editVa.merchantName ?? "—"} · {editVa.accountHolder} · <span className="font-mono">{editVa.accountNumber}</span>
              </p>
            )}
            {editVa && editMode === "balance" && (
              <div className="rounded-md bg-violet-500/10 border border-violet-500/20 px-3 py-2 text-xs text-violet-300">
                Sets the available balance. Must be between ₹0.00 and the total collection of{" "}
                <span className="font-semibold font-mono">₹{parseFloat(editVa.totalCollection).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>.
              </div>
            )}
            {editVa && editMode === "collection" && (
              <div className="rounded-md bg-blue-500/10 border border-blue-500/20 px-3 py-2 text-xs text-blue-300">
                Records cumulative funds received. Must be ≥ the current balance of{" "}
                <span className="font-semibold font-mono">₹{parseFloat(editVa.balance).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>.
              </div>
            )}
            <div className="space-y-1.5">
              <Label>{editMode === "balance" ? "New Balance (₹)" : "New Total Collection (₹)"}</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={editValue}
                onChange={e => setEditValue(e.target.value)}
                autoFocus
              />
              {editMode === "collection" && editVa && editValue !== "" && !isNaN(parseFloat(editValue)) && parseFloat(editValue) < parseFloat(editVa.balance) && (
                <p className="flex items-center gap-1.5 text-xs text-amber-400">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  New total (₹{parseFloat(editValue).toLocaleString("en-IN", { minimumFractionDigits: 2 })}) is below the current balance of ₹{parseFloat(editVa.balance).toLocaleString("en-IN", { minimumFractionDigits: 2 })} — this will be rejected.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-muted-foreground">Reason / Note <span className="text-xs font-normal">(optional)</span></Label>
              <textarea
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                rows={2}
                maxLength={500}
                placeholder="e.g. correcting double-counted deposit, manual reconciliation…"
                value={editReason}
                onChange={e => setEditReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditVa(null)}>Cancel</Button>
            {(() => {
              const val = parseFloat(editValue);
              const invalid = isNaN(val) || val < 0;
              const balanceExceedsTotal = editMode === "balance" && !invalid && !!editVa && val > parseFloat(editVa.totalCollection);
              const collectionBelowBalance = editMode === "collection" && !invalid && !!editVa && val < parseFloat(editVa.balance);
              const saveDisabled = updateMutation.isPending || balanceExceedsTotal || collectionBelowBalance;
              const saveTitle = balanceExceedsTotal
                ? `Balance cannot exceed total collection (₹${parseFloat(editVa!.totalCollection).toFixed(2)})`
                : collectionBelowBalance
                ? `Total collection cannot be below current balance (₹${parseFloat(editVa!.balance).toFixed(2)})`
                : undefined;
              return (
                <Button onClick={handleEditSave} disabled={saveDisabled} title={saveTitle} aria-label={saveTitle}>
                  {updateMutation.isPending ? "Saving..." : editMode === "balance" ? "Adjust Balance" : "Record Collection"}
                </Button>
              );
            })()}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail Drawer */}
      <Sheet open={!!selectedVa} onOpenChange={v => { if (!v) setSelectedVa(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader className="mb-4">
            <SheetTitle>Virtual Account Detail</SheetTitle>
            {selectedVa && (
              <div className="text-sm text-muted-foreground space-y-0.5">
                <Link
                  href={`/admin/merchants?open=${selectedVa.merchantId}`}
                  className="font-medium text-foreground hover:text-primary hover:underline underline-offset-2 transition-colors"
                >
                  {selectedVa.merchantName ?? "Unknown Merchant"}
                </Link>
                <p>{selectedVa.accountHolder} · {selectedVa.accountNumber} · {selectedVa.bankName}</p>
              </div>
            )}
          </SheetHeader>

          {/* Mini stats */}
          {selectedVa && (
            <div className="grid grid-cols-3 gap-3 mb-5">
              <Card>
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Balance</p>
                  <p className="text-lg font-bold text-emerald-400 mt-1">
                    ₹{parseFloat(selectedVa.balance || "0").toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Collected</p>
                  <p className="text-lg font-bold text-blue-400 mt-1">
                    ₹{parseFloat(selectedVa.totalCollection || "0").toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Transactions</p>
                  <p className="text-lg font-bold mt-1">{historyLoading ? "—" : txCount}</p>
                </CardContent>
              </Card>
            </div>
          )}

          {/* UPI QR Code */}
          {selectedVa && (
            <Card className="mb-5 border-primary/20 bg-primary/5">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-start gap-5">
                  <div className="shrink-0 p-2 bg-white rounded-lg">
                    <QRCodeCanvas
                      id={`admin-va-qr-${selectedVa.id}`}
                      value={buildUpiUrl(selectedVa.accountNumber, selectedVa.ifsc, selectedVa.accountHolder)}
                      size={108}
                      level="M"
                      includeMargin={false}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <QrCode className="w-4 h-4 text-primary" />
                      <p className="text-sm font-semibold">UPI Payment QR</p>
                    </div>
                    <p className="text-xs text-muted-foreground mb-3">
                      Merchant can scan or share this QR to receive payments into this virtual account.
                    </p>
                    <div className="bg-muted/60 rounded-md px-3 py-2 mb-3">
                      <p className="text-xs text-muted-foreground mb-0.5">UPI ID</p>
                      <p className="font-mono text-sm font-medium break-all">
                        {buildUpiId(selectedVa.accountNumber, selectedVa.ifsc)}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5"
                        onClick={() => handleCopyUpiId(selectedVa)}>
                        <Copy className="w-3.5 h-3.5" />
                        Copy UPI ID
                      </Button>
                      <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5"
                        onClick={() => handleDownloadQr(selectedVa)}>
                        <Download className="w-3.5 h-3.5" />
                        Download QR
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Tabs */}
          <div className="flex gap-1 mb-4 border-b border-border">
            <button
              onClick={() => setDrawerTab("transactions")}
              className={`px-3 py-2 text-xs font-semibold uppercase tracking-wide border-b-2 transition-colors ${
                drawerTab === "transactions"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              Transaction History
            </button>
            <button
              onClick={() => setDrawerTab("history")}
              className={`px-3 py-2 text-xs font-semibold uppercase tracking-wide border-b-2 transition-colors flex items-center gap-1.5 ${
                drawerTab === "history"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <History className="w-3 h-3" />
              Balance Changes
              {balList.length > 0 && (
                <span className="ml-1 bg-amber-500/20 text-amber-400 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                  {balHistoryData?.total ?? balList.length}
                </span>
              )}
            </button>
          </div>

          {drawerTab === "transactions" ? (
            historyLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-12 bg-muted/50 rounded animate-pulse" />
                ))}
              </div>
            ) : !txList.length ? (
              <div className="text-center text-muted-foreground py-12">
                <p className="text-sm">No transactions found</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>UTR</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {txList.map(tx => (
                    <TableRow key={tx.id}>
                      <TableCell className="font-mono text-xs">#{tx.id}</TableCell>
                      <TableCell className="font-mono text-sm font-semibold">
                        ₹{parseFloat(tx.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs capitalize">{tx.type}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{tx.utr ?? "—"}</TableCell>
                      <TableCell>
                        <Badge
                          variant={tx.status === "success" ? "default" : tx.status === "failed" ? "destructive" : "secondary"}
                          className="text-xs"
                        >
                          {tx.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {format(new Date(tx.createdAt), "MMM d, yyyy HH:mm")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )
          ) : (
            balHistoryLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-16 bg-muted/50 rounded animate-pulse" />
                ))}
              </div>
            ) : !balList.length ? (
              <div className="text-center text-muted-foreground py-12">
                <History className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No balance changes recorded yet</p>
                <p className="text-xs mt-1 opacity-60">Manual balance edits will appear here</p>
              </div>
            ) : (() => {
              const chartData = [...balList]
                .filter(e => e.newBalance != null || e.newTotalCollection != null)
                .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
                .map((e: (typeof balList)[number]) => ({
                  time: format(new Date(e.createdAt), "MMM d HH:mm"),
                  balance: e.newBalance != null ? parseFloat(e.newBalance) : undefined,
                  totalCollection: e.newTotalCollection != null ? parseFloat(e.newTotalCollection) : undefined,
                }));
              const backfilledCount = balList.filter(e => e.backfilled).length;
              return (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <p className="text-xs text-muted-foreground">{balHistoryData?.total ?? balList.length} change{(balHistoryData?.total ?? balList.length) !== 1 ? "s" : ""}</p>
                      {backfilledCount > 0 && (
                        <TooltipProvider>
                          <UITooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 text-[10px] font-medium text-amber-500 cursor-default select-none">
                                <span className="text-amber-500 leading-none" aria-hidden>■</span>
                                estimated rows
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="max-w-[240px] text-xs">
                              <p><span className="text-amber-400 font-semibold italic">est.</span> rows were estimated during a balance backfill — they reconstruct historical values from deposit records and may not be exact.</p>
                              <p className="mt-1 text-muted-foreground">{backfilledCount} of {balHistoryData?.total ?? balList.length} rows in this view are estimated.</p>
                            </TooltipContent>
                          </UITooltip>
                        </TooltipProvider>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <ExportCsvButton label="Export This VA" onExport={exportBalanceHistoryCsv} />
                      {(selectedVa as any)?.merchantId && (
                        <ExportCsvButton label="Export All VAs" onExport={exportMerchantBalanceHistoryCsv} />
                      )}
                    </div>
                  </div>

                  {chartData.length >= 2 && (
                    <Card className="border-border bg-muted/10">
                      <CardContent className="pt-4 pb-3 px-3">
                        <div className="flex items-center justify-between mb-3">
                          <p className="text-xs text-muted-foreground uppercase tracking-wide">Balance &amp; Collection Over Time</p>
                          <div className="flex items-center gap-3">
                            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <span className="inline-block w-3 h-0.5 rounded bg-emerald-400" />
                              Balance
                            </span>
                            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <span className="inline-block w-3 h-0.5 rounded bg-blue-400" />
                              Total Collection
                            </span>
                          </div>
                        </div>
                        <ResponsiveContainer width="100%" height={160}>
                          <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                            <XAxis
                              dataKey="time"
                              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                              tickLine={false}
                              axisLine={false}
                              interval="preserveStartEnd"
                            />
                            <YAxis
                              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                              tickLine={false}
                              axisLine={false}
                              tickFormatter={v => `₹${v.toLocaleString("en-IN")}`}
                              width={72}
                            />
                            <Tooltip
                              contentStyle={{
                                background: "hsl(var(--card))",
                                border: "1px solid hsl(var(--border))",
                                borderRadius: "8px",
                                fontSize: "12px",
                              }}
                              formatter={(value: number, name: string) => [
                                `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`,
                                name === "balance" ? "Balance" : "Total Collection",
                              ]}
                              labelStyle={{ color: "hsl(var(--muted-foreground))", marginBottom: "4px" }}
                            />
                            <Line
                              type="monotone"
                              dataKey="balance"
                              stroke="#34d399"
                              strokeWidth={2}
                              dot={{ fill: "#34d399", r: 3, strokeWidth: 0 }}
                              activeDot={{ r: 5, fill: "#34d399" }}
                              connectNulls
                            />
                            <Line
                              type="monotone"
                              dataKey="totalCollection"
                              stroke="#60a5fa"
                              strokeWidth={2}
                              dot={{ fill: "#60a5fa", r: 3, strokeWidth: 0 }}
                              activeDot={{ r: 5, fill: "#60a5fa" }}
                              connectNulls
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </CardContent>
                    </Card>
                  )}
                  {(() => {
                    const lastBalance = [...chartData].reverse().find(p => p.balance !== undefined)?.balance
                      ?? parseFloat(selectedVa?.balance ?? "0");
                    const lastCollection = [...chartData].reverse().find(p => p.totalCollection !== undefined)?.totalCollection
                      ?? parseFloat(selectedVa?.totalCollection ?? "0");
                    const totalCollected = isNaN(lastCollection) ? 0 : lastCollection;
                    const netBalance = isNaN(lastBalance) ? 0 : lastBalance;
                    const impliedSettlements = totalCollected - netBalance;
                    const fmt = (v: number) =>
                      `₹${v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                    return (
                      <div className="grid grid-cols-3 gap-3">
                        <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5 text-center">
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Total Collected</p>
                          <p className="text-sm font-semibold font-mono text-blue-400">{fmt(totalCollected)}</p>
                        </div>
                        <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5 text-center">
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Net Balance</p>
                          <p className="text-sm font-semibold font-mono text-emerald-400">{fmt(netBalance)}</p>
                        </div>
                        <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5 text-center">
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Implied Settlements</p>
                          <p className={`text-sm font-semibold font-mono ${impliedSettlements > 0 ? "text-amber-400" : "text-muted-foreground"}`}>
                            {fmt(impliedSettlements)}
                          </p>
                        </div>
                      </div>
                    );
                  })()}
                  <div className="space-y-2">
                    {balList.map((entry: (typeof balList)[number]) => {
                      const balChanged = entry.oldBalance != null && entry.newBalance != null && entry.oldBalance !== entry.newBalance;
                      const tcChanged = entry.oldTotalCollection != null && entry.newTotalCollection != null && entry.oldTotalCollection !== entry.newTotalCollection;
                      return (
                        <div key={entry.id} className={`rounded-lg border px-4 py-3 ${entry.backfilled ? "border-amber-500/40 border-l-2 border-l-amber-500 bg-amber-500/[0.04]" : "border-border bg-muted/20"}`}>
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <div className={`w-2 h-2 rounded-full ${entry.changedByRole === "admin" ? "bg-violet-400" : "bg-blue-400"}`} />
                              <span className="text-sm font-medium">{entry.changedByName}</span>
                              <Badge variant="outline" className="text-[10px] capitalize px-1.5">
                                {entry.changedByRole}
                              </Badge>
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {format(new Date(entry.createdAt), "MMM d, yyyy HH:mm")}
                            </span>
                          </div>
                          {(entry as any).reason && (
                            <p className="text-xs text-amber-300/80 italic mb-2 flex items-start gap-1.5">
                              <span className="shrink-0 mt-0.5">💬</span>
                              <span>{(entry as any).reason}</span>
                            </p>
                          )}
                          <div className="grid grid-cols-1 gap-1.5">
                            {entry.oldBalance != null && entry.newBalance != null ? (
                              <div className="flex items-center gap-2 text-xs">
                                <span className={`w-28 shrink-0 ${balChanged ? "text-muted-foreground" : "text-muted-foreground/50"}`}>Balance</span>
                                {balChanged ? (
                                  <>
                                    <span className="font-mono text-rose-400">
                                      ₹{parseFloat(entry.oldBalance).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                                    </span>
                                    <span className="text-muted-foreground">→</span>
                                    <span className="font-mono text-emerald-400">
                                      ₹{parseFloat(entry.newBalance).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                                    </span>
                                  </>
                                ) : (
                                  <>
                                    <span className="font-mono text-muted-foreground/60">
                                      ₹{parseFloat(entry.newBalance).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                                    </span>
                                    <span className="text-[10px] text-muted-foreground/50 italic">unchanged</span>
                                  </>
                                )}
                                {entry.backfilled && <span className="text-[10px] text-amber-500/70 italic">est.</span>}
                              </div>
                            ) : null}
                            {entry.oldTotalCollection != null && entry.newTotalCollection != null ? (
                              <div className="flex items-center gap-2 text-xs">
                                <span className={`w-28 shrink-0 ${tcChanged ? "text-muted-foreground" : "text-muted-foreground/50"}`}>Total Collection</span>
                                {tcChanged ? (
                                  <>
                                    <span className="font-mono text-rose-400">
                                      ₹{parseFloat(entry.oldTotalCollection).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                                    </span>
                                    <span className="text-muted-foreground">→</span>
                                    <span className="font-mono text-emerald-400">
                                      ₹{parseFloat(entry.newTotalCollection).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                                    </span>
                                  </>
                                ) : (
                                  <>
                                    <span className="font-mono text-muted-foreground/60">
                                      ₹{parseFloat(entry.newTotalCollection).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                                    </span>
                                    <span className="text-[10px] text-muted-foreground/50 italic">unchanged</span>
                                  </>
                                )}
                                {entry.backfilled && <span className="text-[10px] text-amber-500/70 italic">est.</span>}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
