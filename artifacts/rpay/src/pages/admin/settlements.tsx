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
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ChevronDown, ChevronRight, Search, X, MoreHorizontal, TrendingUp, Clock, CheckCircle2, DollarSign } from "lucide-react";
import { format } from "date-fns";

type ActionType = "process" | "approve" | "reject" | "hold" | "mark-paid";

interface ActionModal {
  id: number;
  type: ActionType;
  merchantName?: string | null;
  amount: number;
}

export default function AdminSettlements() {
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

  const qc = useQueryClient();

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

  const exportCsv = async () => {
    const params = new URLSearchParams();
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    if (search) params.set("search", search);
    if (status && status !== "all") params.set("status", status);
    const res = await fetch(`/api/settlements/export/csv?${params.toString()}`, { credentials: "include" });
    if (!res.ok) return;
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "settlements.csv";
    a.click();
  };

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Settlements</h1>
          <p className="text-muted-foreground mt-1">Review and process merchant settlement requests</p>
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv}>Export CSV</Button>
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

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input className="pl-9" placeholder="Search by merchant name..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
              </div>
              <Select value={status} onValueChange={v => { setStatus(v); setPage(1); }}>
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
                <Input type="date" className="w-40" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }} />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">To</span>
                <Input type="date" className="w-40" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }} />
              </div>
              {(dateFrom || dateTo) && (
                <Button variant="ghost" size="sm" onClick={() => { setDateFrom(""); setDateTo(""); }}>
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
                <TableRow key={i}>{Array.from({ length: 6 }).map((_, j) => <TableCell key={j}><div className="h-4 bg-muted/50 rounded animate-pulse" /></TableCell>)}</TableRow>
              )) : filtered?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-10">No settlements found</TableCell>
                </TableRow>
              ) : filtered?.map(s => {
                const isExpanded = expandedId === s.id;
                const amount = Number(s.requestedAmount ?? s.amount);
                return (
                  <>
                    <TableRow key={s.id}>
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
            Showing {filtered?.length ?? 0} of {data.total}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button>
            <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page * 20 >= data.total}>Next</Button>
          </div>
        </div>
      )}

      {/* Action Modal */}
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
    </div>
  );
}
