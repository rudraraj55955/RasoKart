import { useState } from "react";
import {
  useListSettlements,
  useGetSettlementStats,
  useProcessSettlement,
  useApproveSettlement,
  useRejectSettlement,
  useHoldSettlement,
  useMarkSettlementPaid,
  getListSettlementsQueryKey,
  getGetSettlementStatsQueryKey,
  listSettlements,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ExportCsvButton, downloadCsvFromUrl } from "@/components/ui/export-csv-button";
import { useMonitoringRefresh } from "@/hooks/use-monitoring-refresh";
import { ChevronDown, ChevronRight, Search, X, MoreHorizontal, TrendingUp, Clock, CheckCircle2, DollarSign, RefreshCw, CheckSquare } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

type ActionType = "process" | "approve" | "reject" | "hold" | "mark-paid";

interface ActionModal {
  id: number;
  type: ActionType;
  merchantName?: string | null;
  amount: number;
}

export default function AdminSettlements() {
  const qc = useQueryClient();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [actionModal, setActionModal] = useState<ActionModal | null>(null);
  const [remark, setRemark] = useState("");
  const [refNumber, setRefNumber] = useState("");
  const [actionError, setActionError] = useState("");

  // Bulk selection state
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [selectAllMode, setSelectAllMode] = useState(false);
  const [bulkAction, setBulkAction] = useState<"approve" | "reject" | null>(null);
  const [bulkRemark, setBulkRemark] = useState("");
  const [bulkError, setBulkError] = useState("");

  const { lastRefreshed, isRefreshing, handleRefresh } = useMonitoringRefresh(() => {
    qc.invalidateQueries({ queryKey: getListSettlementsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetSettlementStatsQueryKey() });
  });

  const { data, isLoading } = useListSettlements({
    status: status !== "all" ? (status as any) : undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    page,
    limit: 20,
  });

  const { data: stats } = useGetSettlementStats();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getListSettlementsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetSettlementStatsQueryKey() });
    setActionModal(null);
    setRemark("");
    setRefNumber("");
    setActionError("");
  };

  const onError = (err: any) => {
    setActionError(err?.response?.data?.error ?? err?.message ?? "Action failed");
  };

  const processMut = useProcessSettlement({ mutation: { onSuccess: invalidate, onError } });
  const approveMut = useApproveSettlement({ mutation: { onSuccess: invalidate, onError } });
  const rejectMut = useRejectSettlement({ mutation: { onSuccess: invalidate, onError } });
  const holdMut = useHoldSettlement({ mutation: { onSuccess: invalidate, onError } });
  const paidMut = useMarkSettlementPaid({ mutation: { onSuccess: invalidate, onError } });

  const isPending = processMut.isPending || approveMut.isPending || rejectMut.isPending || holdMut.isPending || paidMut.isPending;

  const handleAction = () => {
    if (!actionModal) return;
    setActionError("");
    if (!remark.trim()) {
      setActionError("Remark is required");
      return;
    }
    if (actionModal.type === "mark-paid" && !refNumber.trim()) {
      setActionError("Reference number is required");
      return;
    }

    const { id, type } = actionModal;
    if (type === "process") processMut.mutate({ id, data: { remark } });
    else if (type === "approve") approveMut.mutate({ id, data: { remark } });
    else if (type === "reject") rejectMut.mutate({ id, data: { remark } });
    else if (type === "hold") holdMut.mutate({ id, data: { remark } });
    else if (type === "mark-paid") paidMut.mutate({ id, data: { remark, referenceNumber: refNumber } });
  };

  const openAction = (id: number, type: ActionType, merchantName?: string | null, amount?: number) => {
    setRemark("");
    setRefNumber("");
    setActionError("");
    setActionModal({ id, type, merchantName, amount: amount ?? 0 });
  };

  const exportCsv = () => downloadCsvFromUrl("/api/settlements/export/csv", "settlements.csv", {
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    search: search || undefined,
    status: status !== "all" ? status : undefined,
  });

  const filtered = data?.data?.filter(s =>
    !search || (s.merchantName?.toLowerCase().includes(search.toLowerCase()))
  );

  const actionLabels: Record<ActionType, string> = {
    "process": "Mark as Processing",
    "approve": "Approve Settlement",
    "reject": "Reject Settlement",
    "hold": "Put on Hold",
    "mark-paid": "Mark as Paid",
  };

  const actionColors: Record<ActionType, string> = {
    "process": "text-blue-400",
    "approve": "text-emerald-400",
    "reject": "text-rose-400",
    "hold": "text-amber-400",
    "mark-paid": "text-teal-400",
  };

  // Cross-page selection helpers
  const total = data?.total ?? 0;
  const pageItems = filtered ?? [];
  const allPageIds = pageItems.map(s => s.id);
  const allPageSelected = allPageIds.length > 0 && allPageIds.every(id => selected.has(id));
  const somePageSelected = allPageIds.some(id => selected.has(id));
  const selectedOnPage = allPageIds.filter(id => selected.has(id)).length;
  const selectedOffPage = selected.size - selectedOnPage;

  const clearSelection = () => { setSelected(new Set()); setSelectAllMode(false); };

  const handleSearchChange = (v: string) => { setSearch(v); setPage(1); clearSelection(); };
  const handleStatusChange = (v: string) => { setStatus(v); setPage(1); clearSelection(); };

  const handleSelectAllPages = async () => {
    const PAGE_SIZE = 100;
    const totalPages = Math.ceil(total / PAGE_SIZE);
    try {
      const pages = await Promise.all(
        Array.from({ length: totalPages }, (_, i) =>
          listSettlements({
            status: status !== "all" ? (status as any) : undefined,
            dateFrom: dateFrom || undefined,
            dateTo: dateTo || undefined,
            page: i + 1,
            limit: PAGE_SIZE,
          })
        )
      );
      const allIds = pages.flatMap(p => p.data.map(s => s.id));
      if (allIds.length !== total) {
        toast.error("Could not select all settlements — please try again");
        return;
      }
      setSelected(new Set(allIds));
      setSelectAllMode(true);
    } catch {
      toast.error("Failed to select all settlements");
    }
  };

  const toggleSelectAll = () => {
    if (allPageSelected) {
      setSelected(prev => {
        const next = new Set(prev);
        allPageIds.forEach(id => next.delete(id));
        return next;
      });
      setSelectAllMode(false);
    } else {
      setSelected(prev => {
        const next = new Set(prev);
        allPageIds.forEach(id => next.add(id));
        return next;
      });
    }
  };

  const toggleSelect = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setSelectAllMode(false);
  };

  // Bulk approve/reject via sequential individual mutations
  const handleBulkAction = async () => {
    if (!bulkAction || selected.size === 0) return;
    setBulkError("");
    if (!bulkRemark.trim()) {
      setBulkError("Remark is required");
      return;
    }

    const ids = Array.from(selected);
    let succeeded = 0;
    let failed = 0;

    await Promise.allSettled(
      ids.map(id =>
        (bulkAction === "approve"
          ? approveMut.mutateAsync({ id, data: { remark: bulkRemark } })
          : rejectMut.mutateAsync({ id, data: { remark: bulkRemark } })
        ).then(() => { succeeded++; }).catch(() => { failed++; })
      )
    );

    qc.invalidateQueries({ queryKey: getListSettlementsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetSettlementStatsQueryKey() });

    if (failed === 0) {
      toast.success(`${succeeded} settlement${succeeded !== 1 ? "s" : ""} ${bulkAction === "approve" ? "approved" : "rejected"}`);
    } else {
      toast.warning(`${succeeded} succeeded, ${failed} failed`);
    }

    setBulkAction(null);
    setBulkRemark("");
    clearSelection();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Settlements</h1>
          <p className="text-muted-foreground mt-1">Review and process merchant settlement requests · refreshed {format(lastRefreshed, "HH:mm:ss")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isRefreshing}>
            <RefreshCw className={`w-4 h-4 mr-1 ${isRefreshing ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <ExportCsvButton onExport={exportCsv} />
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        {[
          {
            label: "Pending Total",
            value: `₹${(stats?.pendingTotal ?? 0).toLocaleString()}`,
            icon: Clock,
            color: "text-amber-500",
            bg: "bg-amber-500/10",
          },
          {
            label: "Paid MTD",
            value: `₹${(stats?.paidMTD ?? 0).toLocaleString()}`,
            icon: DollarSign,
            color: "text-teal-400",
            bg: "bg-teal-500/10",
          },
          {
            label: "Pending",
            value: `${stats?.counts?.pending ?? 0}`,
            icon: TrendingUp,
            color: "text-amber-400",
            bg: "bg-amber-500/10",
          },
          {
            label: "Processing",
            value: `${stats?.counts?.processing ?? 0}`,
            icon: CheckCircle2,
            color: "text-blue-400",
            bg: "bg-blue-500/10",
          },
          {
            label: "Approved",
            value: `${stats?.counts?.approved ?? 0}`,
            icon: CheckCircle2,
            color: "text-green-400",
            bg: "bg-green-500/10",
          },
          {
            label: "Rejected",
            value: `${stats?.counts?.rejected ?? 0}`,
            icon: TrendingUp,
            color: "text-rose-400",
            bg: "bg-rose-500/10",
          },
        ].map(card => (
          <Card key={card.label}>
            <CardContent className="p-4 flex items-start gap-3">
              <div className={`p-2 rounded-lg ${card.bg}`}>
                <card.icon className={`w-4 h-4 ${card.color}`} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{card.label}</p>
                <p className="font-bold mt-0.5">{card.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Bulk action toolbar */}
      {selected.size > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5">
          <div className="flex items-center gap-3 flex-wrap">
            <CheckSquare className="w-4 h-4 text-primary shrink-0" />
            <span className="text-sm font-medium text-primary">
              {selectAllMode ? `All ${total} settlements selected` : `${selected.size} settlement${selected.size !== 1 ? "s" : ""} selected`}
              {!selectAllMode && selectedOffPage > 0 && (
                <span className="text-xs text-primary/60 ml-1.5">(includes {selectedOffPage} from other page{selectedOffPage !== 1 ? "s" : ""})</span>
              )}
            </span>
            <div className="flex gap-2 ml-auto flex-wrap">
              <Button
                size="sm"
                variant="outline"
                className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
                onClick={() => { setBulkRemark(""); setBulkError(""); setBulkAction("approve"); }}
              >
                <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-rose-400 border-rose-500/30 hover:bg-rose-500/10"
                onClick={() => { setBulkRemark(""); setBulkError(""); setBulkAction("reject"); }}
              >
                <X className="w-3.5 h-3.5 mr-1.5" />
                Reject
              </Button>
              <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={clearSelection}>
                Clear
              </Button>
            </div>
          </div>
          {/* Select all pages banner */}
          {!selectAllMode && allPageSelected && total > pageItems.length && (
            <div className="text-xs text-center text-primary/70 border-t border-primary/20 pt-2">
              All {pageItems.length} settlements on this page are selected.{" "}
              <button
                className="underline text-primary font-medium hover:text-primary/80"
                onClick={handleSelectAllPages}
              >
                Select all {total} settlements
              </button>
            </div>
          )}
          {selectAllMode && (
            <div className="text-xs text-center text-primary/70 border-t border-primary/20 pt-2">
              All {total} settlements are selected.{" "}
              <button
                className="underline text-primary font-medium hover:text-primary/80"
                onClick={clearSelection}
              >
                Clear selection
              </button>
            </div>
          )}
        </div>
      )}

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input className="pl-9" placeholder="Search by merchant name..." value={search} onChange={e => handleSearchChange(e.target.value)} />
              </div>
              <Select value={status} onValueChange={v => handleStatusChange(v)}>
                <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="processing">Processing</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">From</span>
                <Input type="date" className="w-40" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); clearSelection(); }} />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">To</span>
                <Input type="date" className="w-40" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); clearSelection(); }} />
              </div>
              {(dateFrom || dateTo) && (
                <Button variant="ghost" size="sm" onClick={() => { setDateFrom(""); setDateTo(""); clearSelection(); }}>
                  <X className="w-3.5 h-3.5 mr-1" /> Clear
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={allPageSelected ? true : somePageSelected ? "indeterminate" : false}
                    onCheckedChange={toggleSelectAll}
                    aria-label="Select all on this page"
                  />
                </TableHead>
                <TableHead className="w-8" />
                <TableHead>Merchant</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Requested</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>{Array.from({ length: 7 }).map((_, j) => <TableCell key={j}><div className="h-4 bg-muted/50 rounded animate-pulse" /></TableCell>)}</TableRow>
              )) : pageItems.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-10">No settlements found</TableCell>
                </TableRow>
              ) : pageItems.map(s => {
                const isExpanded = expandedId === s.id;
                const amount = Number(s.requestedAmount ?? s.amount);
                return (
                  <>
                    <TableRow key={s.id} className={selected.has(s.id) ? "bg-primary/5" : undefined}>
                      <TableCell>
                        <Checkbox
                          checked={selected.has(s.id)}
                          onCheckedChange={() => toggleSelect(s.id)}
                          aria-label={`Select settlement ${s.id}`}
                        />
                      </TableCell>
                      <TableCell className="w-8">
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : s.id)}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </button>
                      </TableCell>
                      <TableCell className="font-medium">{s.merchantName || "—"}</TableCell>
                      <TableCell className="text-right font-mono font-semibold">₹{amount.toLocaleString()}</TableCell>
                      <TableCell><StatusBadge status={s.status} /></TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {format(new Date(s.createdAt), "MMM d, yyyy")}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                              <MoreHorizontal className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {s.status === "pending" && (
                              <>
                                <DropdownMenuItem
                                  className="text-blue-400"
                                  onClick={() => openAction(s.id, "process", s.merchantName, amount)}
                                >
                                  Mark Processing
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="text-rose-400"
                                  onClick={() => openAction(s.id, "reject", s.merchantName, amount)}
                                >
                                  Reject
                                </DropdownMenuItem>
                              </>
                            )}
                            {s.status === "processing" && (
                              <>
                                <DropdownMenuItem
                                  className="text-emerald-400"
                                  onClick={() => openAction(s.id, "approve", s.merchantName, amount)}
                                >
                                  Approve
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="text-rose-400"
                                  onClick={() => openAction(s.id, "reject", s.merchantName, amount)}
                                >
                                  Reject
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-amber-400"
                                  onClick={() => openAction(s.id, "hold", s.merchantName, amount)}
                                >
                                  Put on Hold
                                </DropdownMenuItem>
                              </>
                            )}
                            {s.status === "approved" && (
                              <DropdownMenuItem
                                className="text-teal-400"
                                onClick={() => openAction(s.id, "mark-paid", s.merchantName, amount)}
                              >
                                Mark as Paid
                              </DropdownMenuItem>
                            )}
                            {(s.status === "rejected" || s.status === "paid") && (
                              <DropdownMenuItem disabled className="text-muted-foreground text-xs">
                                No actions available
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow key={`${s.id}-detail`} className="bg-muted/10">
                        <TableCell />
                        <TableCell />
                        <TableCell colSpan={5} className="py-3">
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                            {s.requestedNote && (
                              <div>
                                <p className="text-xs text-muted-foreground mb-0.5">Merchant Note</p>
                                <p className="font-medium">{s.requestedNote}</p>
                              </div>
                            )}
                            {s.adminRemark && (
                              <div>
                                <p className="text-xs text-muted-foreground mb-0.5">Admin Remark</p>
                                <p className="font-medium">{s.adminRemark}</p>
                              </div>
                            )}
                            {s.referenceNumber && (
                              <div>
                                <p className="text-xs text-muted-foreground mb-0.5">Reference</p>
                                <Badge variant="outline" className="font-mono text-xs">{s.referenceNumber}</Badge>
                              </div>
                            )}
                            {s.paidAt && (
                              <div>
                                <p className="text-xs text-muted-foreground mb-0.5">Paid At</p>
                                <p className="font-medium">{format(new Date(s.paidAt), "MMM d, yyyy HH:mm")}</p>
                              </div>
                            )}
                            {s.processedAt && (
                              <div>
                                <p className="text-xs text-muted-foreground mb-0.5">Processed At</p>
                                <p className="font-medium">{format(new Date(s.processedAt), "MMM d, yyyy HH:mm")}</p>
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
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            Showing {pageItems.length} of {data.total}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button>
            <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page * 20 >= data.total}>Next</Button>
          </div>
        </div>
      )}

      {/* Single-row action modal */}
      <Dialog open={!!actionModal} onOpenChange={open => { if (!open) { setActionModal(null); setRemark(""); setRefNumber(""); setActionError(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{actionModal ? actionLabels[actionModal.type] : ""}</DialogTitle>
            <DialogDescription>
              {actionModal && (
                <>
                  Settlement of <span className="font-semibold text-foreground">₹{actionModal.amount.toLocaleString()}</span>
                  {actionModal.merchantName && <> for <span className="font-semibold text-foreground">{actionModal.merchantName}</span></>}
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="remark">Remark <span className="text-rose-500">*</span></Label>
              <Textarea
                id="remark"
                placeholder="Add a remark for this action..."
                rows={3}
                value={remark}
                onChange={e => setRemark(e.target.value)}
              />
            </div>

            {actionModal?.type === "mark-paid" && (
              <div className="space-y-2">
                <Label htmlFor="refNumber">Reference Number <span className="text-rose-500">*</span></Label>
                <Input
                  id="refNumber"
                  placeholder="e.g. NEFT/UTR reference..."
                  value={refNumber}
                  onChange={e => setRefNumber(e.target.value)}
                />
              </div>
            )}

            {actionError && (
              <p className="text-sm text-rose-500 bg-rose-500/10 border border-rose-500/20 rounded-md px-3 py-2">{actionError}</p>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setActionModal(null)}>Cancel</Button>
              <Button
                onClick={handleAction}
                disabled={isPending}
                className={actionModal ? actionColors[actionModal.type]?.replace("text-", "hover:bg-").replace("400", "500/20") : ""}
              >
                {isPending ? "Processing..." : actionModal ? actionLabels[actionModal.type] : "Confirm"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Bulk action modal */}
      <Dialog open={!!bulkAction} onOpenChange={open => { if (!open) { setBulkAction(null); setBulkRemark(""); setBulkError(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {bulkAction === "approve" ? "Bulk Approve Settlements" : "Bulk Reject Settlements"}
            </DialogTitle>
            <DialogDescription>
              This will {bulkAction} <span className="font-semibold text-foreground">{selected.size} settlement{selected.size !== 1 ? "s" : ""}</span>.
              A single remark will be applied to all.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="bulk-remark">Remark <span className="text-rose-500">*</span></Label>
              <Textarea
                id="bulk-remark"
                placeholder="Add a remark for this bulk action..."
                rows={3}
                value={bulkRemark}
                onChange={e => setBulkRemark(e.target.value)}
              />
            </div>
            {bulkError && (
              <p className="text-sm text-rose-500 bg-rose-500/10 border border-rose-500/20 rounded-md px-3 py-2">{bulkError}</p>
            )}
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setBulkAction(null)}>Cancel</Button>
              <Button
                onClick={handleBulkAction}
                disabled={isPending}
                className={bulkAction === "approve" ? "text-emerald-400 hover:bg-emerald-500/20" : "text-rose-400 hover:bg-rose-500/20"}
              >
                {isPending ? "Processing..." : bulkAction === "approve" ? `Approve ${selected.size}` : `Reject ${selected.size}`}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
