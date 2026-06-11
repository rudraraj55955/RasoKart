import { useState, useEffect } from "react";
import { useListQrCodes, useDeleteQrCode, useGetQrCodeStats, useBulkDeleteQrCodes } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ExportCsvButton } from "@/components/ui/export-csv-button";
import { useMonitoringRefresh } from "@/hooks/use-monitoring-refresh";
import { Search, Trash2, QrCode, X, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

function statusBadge(status: string) {
  if (status === "active") return <Badge className="text-xs bg-emerald-500/15 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20">Active</Badge>;
  if (status === "expired") return <Badge className="text-xs bg-rose-500/15 text-rose-400 border-rose-500/20 hover:bg-rose-500/20">Expired</Badge>;
  if (status === "used") return <Badge className="text-xs bg-blue-500/15 text-blue-400 border-blue-500/20 hover:bg-blue-500/20">Used</Badge>;
  return <Badge variant="secondary" className="text-xs capitalize">{status}</Badge>;
}

type BulkConfirmDialogProps = {
  count: number;
  label: string;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
};

function BulkConfirmDialog({ count, label, onConfirm, onCancel, isPending }: BulkConfirmDialogProps) {
  return (
    <Dialog open onOpenChange={onCancel}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete {count} QR {count === 1 ? "code" : "codes"}?</DialogTitle>
          <p className="text-sm text-muted-foreground mt-1">
            This will permanently delete {label}. This action cannot be undone.
          </p>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel} disabled={isPending}>Cancel</Button>
          <Button variant="destructive" onClick={onConfirm} disabled={isPending}>
            <Trash2 className="w-4 h-4 mr-1.5" />
            {isPending ? "Deleting…" : `Delete ${count} ${count === 1 ? "code" : "codes"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminQrCodes() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [merchantName, setMerchantName] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("merchant") ?? "";
  });
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkConfirm, setBulkConfirm] = useState<{ ids?: number[]; statusFilter?: string; count: number; label: string } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const m = params.get("merchant");
    if (m) {
      setMerchantName(m);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const { lastRefreshed, isRefreshing, handleRefresh } = useMonitoringRefresh(
    () => qc.invalidateQueries({ queryKey: ["/api/qr-codes"] })
  );

  const { data, isLoading } = useListQrCodes({
    type: "dynamic" as any,
    status: status as any,
    search: search || undefined,
    merchantName: merchantName || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    page,
    limit: 50,
  } as any);
  const { data: stats } = useGetQrCodeStats({
    merchantName: merchantName || undefined,
    search: search || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  });
  const deleteMutation = useDeleteQrCode();
  const bulkDeleteMutation = useBulkDeleteQrCodes();

  const invalidateQr = () => {
    qc.invalidateQueries({ queryKey: ["/api/qr-codes"] });
    qc.invalidateQueries({ queryKey: ["/api/qr-codes/stats"] });
    setSelectedIds(new Set());
  };

  const handleDelete = (id: number) => {
    if (!confirm("Delete this QR code?")) return;
    deleteMutation.mutate({ id }, {
      onSuccess: () => { toast.success("QR code deleted"); invalidateQr(); },
      onError: () => toast.error("Failed to delete"),
    });
  };

  const exportCsv = () => {
    if (!data?.data?.length) return;
    const headers = ["ID", "Merchant", "Order ID", "Amount", "Expiry Time", "Status", "Merchant Reference", "Created At"];
    const rows = data.data.map(q => [
      String(q.id),
      q.merchantName ?? "",
      q.orderId ?? "",
      q.amount ?? "",
      q.expiresAt ? format(new Date(q.expiresAt as string), "yyyy-MM-dd HH:mm") : "",
      q.status,
      (q as any).merchantReference ?? "",
      q.createdAt,
    ]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `qr-codes-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
  };

  const clearAll = () => { setSearch(""); setMerchantName(""); setDateFrom(""); setDateTo(""); setPage(1); setSelectedIds(new Set()); };

  const rowIds = (data?.data ?? []).map(r => r.id as number);
  const allSelected = rowIds.length > 0 && rowIds.every(id => selectedIds.has(id));
  const someSelected = rowIds.some(id => selectedIds.has(id));
  const selectedCount = selectedIds.size;

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        rowIds.forEach(id => next.delete(id));
        return next;
      });
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev);
        rowIds.forEach(id => next.add(id));
        return next;
      });
    }
  };

  const toggleSelect = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const openBulkDeleteSelected = () => {
    const ids = Array.from(selectedIds);
    setBulkConfirm({ ids, count: ids.length, label: `${ids.length} selected QR ${ids.length === 1 ? "code" : "codes"}` });
  };

  const openBulkDeleteByStatus = (statusFilter: string) => {
    const count = statusFilter === "expired" ? (stats?.expired ?? 0) : (stats?.used ?? 0);
    const merchantSuffix = merchantName ? ` for "${merchantName}"` : " across all merchants";
    const label = `all ${statusFilter} QR codes${merchantSuffix}`;
    setBulkConfirm({ statusFilter, count, label });
  };

  const executeBulkDelete = () => {
    if (!bulkConfirm) return;
    const payload = bulkConfirm.ids
      ? { ids: bulkConfirm.ids }
      : { status: bulkConfirm.statusFilter as "expired" | "used" };

    bulkDeleteMutation.mutate({ data: payload }, {
      onSuccess: (res) => {
        toast.success(`${res.deleted} QR ${res.deleted === 1 ? "code" : "codes"} deleted`);
        setBulkConfirm(null);
        invalidateQr();
      },
      onError: () => {
        toast.error("Bulk delete failed");
        setBulkConfirm(null);
      },
    });
  };

  const showDeleteAllExpired = status === "expired" && (stats?.expired ?? 0) > 0;
  const showDeleteAllUsed = status === "used" && (stats?.used ?? 0) > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">QR Management</h1>
          <p className="text-muted-foreground mt-1">Monitor all dynamic QR codes across merchants · refreshed {format(lastRefreshed, "HH:mm:ss")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isRefreshing}>
            <RefreshCw className={`w-4 h-4 mr-1 ${isRefreshing ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <ExportCsvButton onExport={exportCsv} disabled={!data?.data?.length} />
        </div>
      </div>

      {/* Stats — clickable to filter */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total", value: stats?.total ?? 0, filter: "all", color: "text-primary", bg: "bg-primary/10", ring: "ring-primary/40" },
          { label: "Active", value: stats?.active ?? 0, filter: "active", color: "text-emerald-400", bg: "bg-emerald-500/10", ring: "ring-emerald-500/40" },
          { label: "Expired", value: stats?.expired ?? 0, filter: "expired", color: "text-rose-400", bg: "bg-rose-500/10", ring: "ring-rose-500/40" },
          { label: "Used", value: stats?.used ?? 0, filter: "used", color: "text-blue-400", bg: "bg-blue-500/10", ring: "ring-blue-500/40" },
        ].map(stat => {
          const isActive = status === stat.filter;
          return (
            <button
              key={stat.label}
              type="button"
              onClick={() => { setStatus(stat.filter); setPage(1); setSelectedIds(new Set()); }}
              className={`text-left rounded-xl border bg-card transition-all hover:ring-2 focus-visible:outline-none focus-visible:ring-2 ${isActive ? `ring-2 ${stat.ring}` : "hover:ring-border"}`}
            >
              <div className="px-5 pt-5 pb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">{stat.label}</p>
                    <p className={`text-2xl font-bold mt-1 ${stat.color}`}>{stat.value}</p>
                  </div>
                  <div className={`w-10 h-10 ${stat.bg} rounded-lg flex items-center justify-center`}>
                    <QrCode className={`w-5 h-5 ${stat.color}`} />
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
              <div className="relative flex-1 min-w-[160px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input className="pl-9" placeholder="Search by order ID or reference..." value={search}
                  onChange={e => { setSearch(e.target.value); setPage(1); }} />
              </div>
              <div className="relative min-w-[170px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input className="pl-9 pr-8" placeholder="Filter by merchant name..." value={merchantName}
                  onChange={e => { setMerchantName(e.target.value); setPage(1); }} />
                {merchantName && (
                  <button className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => { setMerchantName(""); setPage(1); }}>
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <Select value={status} onValueChange={v => { setStatus(v); setPage(1); setSelectedIds(new Set()); }}>
                <SelectTrigger className="w-[140px]"><SelectValue placeholder="All Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="expired">Expired</SelectItem>
                  <SelectItem value="used">Used</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center flex-wrap">
              <div className="flex items-center gap-2 flex-1">
                <span className="text-xs text-muted-foreground whitespace-nowrap">Date range:</span>
                <Input type="date" className="h-9 text-sm" value={dateFrom}
                  onChange={e => { setDateFrom(e.target.value); setPage(1); }} />
                <span className="text-xs text-muted-foreground">to</span>
                <Input type="date" className="h-9 text-sm" value={dateTo}
                  onChange={e => { setDateTo(e.target.value); setPage(1); }} />
                {(dateFrom || dateTo || search || merchantName) && (
                  <Button variant="ghost" size="sm" className="h-8 px-2 shrink-0 text-xs" onClick={clearAll}>
                    <X className="w-3 h-3 mr-1" />Clear all
                  </Button>
                )}
              </div>

              {/* Bulk action buttons */}
              {selectedCount > 0 && (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={openBulkDeleteSelected}
                  className="shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                  Delete selected ({selectedCount})
                </Button>
              )}
              {showDeleteAllExpired && selectedCount === 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => openBulkDeleteByStatus("expired")}
                  className="shrink-0 border-rose-500/40 text-rose-400 hover:bg-rose-500/10 hover:text-rose-300"
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                  Delete all expired ({stats?.expired})
                </Button>
              )}
              {showDeleteAllUsed && selectedCount === 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => openBulkDeleteByStatus("used")}
                  className="shrink-0 border-blue-500/40 text-blue-400 hover:bg-blue-500/10 hover:text-blue-300"
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                  Delete all used ({stats?.used})
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8 pl-4">
                  <Checkbox
                    checked={allSelected}
                    data-state={someSelected && !allSelected ? "indeterminate" : undefined}
                    onCheckedChange={toggleSelectAll}
                    aria-label="Select all"
                    disabled={rowIds.length === 0}
                  />
                </TableHead>
                <TableHead>ID</TableHead>
                <TableHead>Merchant</TableHead>
                <TableHead>Order ID</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Expiry Time</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Merchant Reference</TableHead>
                <TableHead>Created At</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 10 }).map((_, j) => (
                      <TableCell key={j}><div className="h-4 bg-muted/50 rounded animate-pulse" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : !data?.data?.length ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center text-muted-foreground py-14">
                    <QrCode className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">No QR codes found</p>
                  </TableCell>
                </TableRow>
              ) : data.data.map(qr => {
                const isExpiredTime = qr.expiresAt ? new Date(qr.expiresAt as string) < new Date() : false;
                const isChecked = selectedIds.has(qr.id);
                return (
                  <TableRow key={qr.id} className={isChecked ? "bg-muted/20" : ""}>
                    <TableCell className="pl-4 pr-0" onClick={e => toggleSelect(qr.id, e)}>
                      <Checkbox
                        checked={isChecked}
                        onCheckedChange={() => {}}
                        aria-label={`Select QR code ${qr.id}`}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-xs">#{qr.id}</TableCell>
                    <TableCell className="text-sm font-medium">{qr.merchantName ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{qr.orderId ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="font-mono text-sm">
                      {qr.amount ? `₹${parseFloat(qr.amount).toLocaleString("en-IN")}` : <span className="text-muted-foreground text-xs">Open</span>}
                    </TableCell>
                    <TableCell className="text-xs">
                      {qr.expiresAt ? (
                        <span className={isExpiredTime ? "text-rose-400" : "text-amber-400"}>
                          {format(new Date(qr.expiresAt as string), "MMM d, HH:mm")}
                        </span>
                      ) : <span className="text-muted-foreground">Never</span>}
                    </TableCell>
                    <TableCell>{statusBadge(qr.status)}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {(qr as any).merchantReference ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {format(new Date(qr.createdAt), "MMM d, yyyy HH:mm")}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-rose-500 hover:text-rose-400"
                        onClick={() => handleDelete(qr.id)} title="Delete">
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {data && data.total > 50 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{data.total} total</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button>
            <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page * 50 >= data.total}>Next</Button>
          </div>
        </div>
      )}

      {/* Bulk delete confirmation dialog */}
      {bulkConfirm && (
        <BulkConfirmDialog
          count={bulkConfirm.count}
          label={bulkConfirm.label}
          onConfirm={executeBulkDelete}
          onCancel={() => setBulkConfirm(null)}
          isPending={bulkDeleteMutation.isPending}
        />
      )}
    </div>
  );
}
