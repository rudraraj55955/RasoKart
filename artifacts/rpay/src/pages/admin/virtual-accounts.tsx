import { useState } from "react";
import {
  useListVirtualAccounts,
  useUpdateVirtualAccount,
  useDeleteVirtualAccount,
  useGetVirtualAccountTransactions,
  useGetVirtualAccountBalanceHistory,
} from "@workspace/api-client-react";
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
import { ExportCsvButton } from "@/components/ui/export-csv-button";
import { useMonitoringRefresh } from "@/hooks/use-monitoring-refresh";
import { Search, XCircle, Trash2, X, Eye, Download, Calendar, RefreshCw, Pencil, AlertCircle, Copy, QrCode, History } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { QRCodeCanvas } from "qrcode.react";
import { buildUpiId, buildUpiUrl } from "@/lib/upi";

type VaRow = {
  id: number;
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

export default function AdminVirtualAccounts() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [merchantName, setMerchantName] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [selectedVa, setSelectedVa] = useState<VaRow | null>(null);
  const [drawerTab, setDrawerTab] = useState<"transactions" | "history">("transactions");
  const [editVa, setEditVa] = useState<VaRow | null>(null);
  const [editForm, setEditForm] = useState({ balance: "", totalCollection: "" });
  const [editError, setEditError] = useState<string | null>(null);

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

  const updateMutation = useUpdateVirtualAccount();
  const deleteMutation = useDeleteVirtualAccount();

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

  const openEditBalance = (va: VaRow) => {
    setEditVa(va);
    setEditForm({ balance: va.balance ?? "0.00", totalCollection: va.totalCollection ?? "0.00" });
    setEditError(null);
  };

  const handleEditBalance = () => {
    setEditError(null);
    const balance = parseFloat(editForm.balance);
    const totalCollection = parseFloat(editForm.totalCollection);
    if (isNaN(balance) || balance < 0) { setEditError("Balance must be a non-negative number."); return; }
    if (isNaN(totalCollection) || totalCollection < 0) { setEditError("Total collection must be a non-negative number."); return; }
    if (balance > totalCollection) { setEditError("Current balance cannot exceed total collection."); return; }
    updateMutation.mutate(
      { id: editVa!.id, data: { balance: balance.toFixed(2), totalCollection: totalCollection.toFixed(2) } as any },
      {
        onSuccess: () => {
          toast.success("Balance updated");
          setEditVa(null);
          qc.invalidateQueries({ queryKey: ["/api/virtual-accounts"] });
          qc.invalidateQueries({ queryKey: [`/api/virtual-accounts/${editVa!.id}/balance-history`] });
        },
        onError: (err: any) => {
          const msg = err?.response?.data?.error ?? err?.response?.data?.message ?? null;
          setEditError(msg ?? "Failed to update balance.");
        },
      }
    );
  };

  const clearFilters = () => {
    setSearch(""); setMerchantName(""); setStatus("all"); setDateFrom(""); setDateTo(""); setPage(1);
  };

  const hasFilters = search || merchantName || status !== "all" || dateFrom || dateTo;

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
          <ExportCsvButton onExport={exportCsv} />
        </div>
      </div>

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
                  <TableRow key={i}>{Array.from({ length: 10 }).map((_, j) => <TableCell key={j}><div className="h-4 bg-muted/50 rounded animate-pulse" /></TableCell>)}</TableRow>
                ))
              ) : !data?.data?.length ? (
                <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-10">No virtual accounts found</TableCell></TableRow>
              ) : (data.data as VaRow[]).map(va => (
                <TableRow key={va.id} className="cursor-pointer hover:bg-muted/30" onClick={() => { setSelectedVa(va); setDrawerTab("transactions"); }}>
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
                      <Button size="icon" variant="ghost" className="h-8 w-8" title="View Transactions"
                        onClick={() => { setSelectedVa(va); setDrawerTab("transactions"); }}>
                        <Eye className="w-4 h-4" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-amber-400 hover:text-amber-300 hover:bg-amber-500/10"
                        title="Balance History" onClick={() => { setSelectedVa(va); setDrawerTab("history"); }}>
                        <History className="w-3.5 h-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-violet-400 hover:text-violet-300 hover:bg-violet-500/10"
                        title="Update Balance" onClick={() => openEditBalance(va)}>
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
                </TableRow>
              ))}
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

      {/* Edit Balance Dialog */}
      <Dialog open={!!editVa} onOpenChange={v => { if (!v) setEditVa(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Update Balance</DialogTitle>
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
            <div className="space-y-1.5">
              <Label>Current Balance (₹)</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={editForm.balance}
                onChange={e => setEditForm(f => ({ ...f, balance: e.target.value }))}
              />
              {(() => {
                const tc = parseFloat(editForm.totalCollection);
                const bal = parseFloat(editForm.balance);
                const exceeded = !isNaN(bal) && !isNaN(tc) && bal > tc;
                if (isNaN(tc) || tc < 0) return null;
                return (
                  <p className={`text-xs flex items-center gap-1 ${exceeded ? "text-rose-400" : "text-muted-foreground"}`}>
                    <AlertCircle className={`w-3 h-3 shrink-0 ${exceeded ? "opacity-100" : "opacity-0"}`} />
                    Cannot exceed Total Collection (₹{tc.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
                  </p>
                );
              })()}
            </div>
            <div className="space-y-1.5">
              <Label>Total Collection (₹)</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={editForm.totalCollection}
                onChange={e => setEditForm(f => ({ ...f, totalCollection: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditVa(null)}>Cancel</Button>
            <Button onClick={handleEditBalance} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
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
                <p className="font-medium text-foreground">{selectedVa.merchantName ?? "Unknown Merchant"}</p>
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
            ) : (
              <div className="space-y-2">
                {balList.map(entry => (
                  <div key={entry.id} className="rounded-lg border border-border bg-muted/20 px-4 py-3">
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
                    <div className="grid grid-cols-1 gap-1.5">
                      {entry.oldBalance != null && entry.newBalance != null && (
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-muted-foreground w-28 shrink-0">Balance</span>
                          <span className="font-mono text-rose-400">
                            ₹{parseFloat(entry.oldBalance).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                          </span>
                          <span className="text-muted-foreground">→</span>
                          <span className="font-mono text-emerald-400">
                            ₹{parseFloat(entry.newBalance).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                          </span>
                        </div>
                      )}
                      {entry.oldTotalCollection != null && entry.newTotalCollection != null && (
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-muted-foreground w-28 shrink-0">Total Collection</span>
                          <span className="font-mono text-rose-400">
                            ₹{parseFloat(entry.oldTotalCollection).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                          </span>
                          <span className="text-muted-foreground">→</span>
                          <span className="font-mono text-emerald-400">
                            ₹{parseFloat(entry.newTotalCollection).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
