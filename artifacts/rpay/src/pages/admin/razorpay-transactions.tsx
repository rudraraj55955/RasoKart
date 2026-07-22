import { useState, useCallback, useEffect } from "react";
import { format } from "date-fns";
import { useListAdminRazorpayOrders } from "@workspace/api-client-react";
import { getToken } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Loader2, Search, CreditCard, FileDown, RotateCcw, RefreshCw } from "lucide-react";

const authHeader = () => ({ Authorization: `Bearer ${getToken()}` });

function statusColor(status?: string) {
  if (!status) return "bg-zinc-500/10 text-zinc-400 border-zinc-500/30";
  switch (status.toUpperCase()) {
    case "SUCCESS":  return "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
    case "FAILED":   return "bg-rose-500/10 text-rose-400 border-rose-500/30";
    case "PENDING":  return "bg-amber-500/10 text-amber-400 border-amber-500/30";
    case "CREATED":  return "bg-sky-500/10 text-sky-400 border-sky-500/30";
    default:         return "bg-zinc-500/10 text-zinc-400 border-zinc-500/30";
  }
}

function refundStatusColor(status?: string) {
  switch ((status ?? "").toUpperCase()) {
    case "PROCESSED": return "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
    case "FAILED":    return "bg-rose-500/10 text-rose-400 border-rose-500/30";
    case "PENDING":   return "bg-amber-500/10 text-amber-400 border-amber-500/30";
    default:          return "bg-zinc-500/10 text-zinc-400 border-zinc-500/30";
  }
}

interface RazorpayRefund {
  id: number;
  orderId: number;
  razorpayPaymentId: string;
  razorpayRefundId?: string | null;
  amount: string;
  currency: string;
  status: string;
  speed: string;
  notes?: string | null;
  initiatedByEmail?: string | null;
  processedAt?: string | null;
  createdAt: string;
}

interface InitiateRefundState {
  open: boolean;
  internalOrderId: number | null;
  razorpayPaymentId: string;
  razorpayOrderId: string;
  maxAmountInr: number;
}

export default function AdminRazorpayTransactions() {
  const [activeTab, setActiveTab] = useState<"transactions" | "refunds">("transactions");

  // ── Transactions state ──────────────────────────────────────────────────
  const [search, setSearch]     = useState("");
  const [status, setStatus]     = useState("all");
  const [page, setPage]         = useState(1);

  const { data, isLoading, isError } = useListAdminRazorpayOrders(
    { page, limit: 20, ...(status !== "all" ? { status } : {}), ...(search ? { search } : {}) },
    { request: { headers: authHeader() } },
  );
  const rows  = data?.data ?? [];
  const total = data?.total ?? 0;

  // ── Refunds list state ──────────────────────────────────────────────────
  const [refunds, setRefunds]           = useState<RazorpayRefund[]>([]);
  const [refundTotal, setRefundTotal]   = useState(0);
  const [refundPage, setRefundPage]     = useState(1);
  const [loadingRefunds, setLoadingRefunds] = useState(false);
  const [refundListError, setRefundListError] = useState<string | null>(null);

  const fetchRefunds = useCallback(async (p: number) => {
    setLoadingRefunds(true);
    setRefundListError(null);
    try {
      const resp = await fetch(`/api/admin/razorpay/refunds?page=${p}&limit=20`, { headers: authHeader() });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      setRefunds(json.data ?? []);
      setRefundTotal(json.total ?? 0);
    } catch (e) {
      setRefundListError(e instanceof Error ? e.message : "Failed to load refunds");
    } finally {
      setLoadingRefunds(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "refunds") fetchRefunds(refundPage);
  }, [activeTab, refundPage, fetchRefunds]);

  // ── Initiate Refund dialog ──────────────────────────────────────────────
  const [refundDlg, setRefundDlg] = useState<InitiateRefundState>({
    open: false, internalOrderId: null, razorpayPaymentId: "", razorpayOrderId: "", maxAmountInr: 0,
  });
  const [refundAmountStr, setRefundAmountStr] = useState("");
  const [refundPaymentId, setRefundPaymentId] = useState("");
  const [refundNotes, setRefundNotes]         = useState("");
  const [submitting, setSubmitting]           = useState(false);
  const [submitError, setSubmitError]         = useState<string | null>(null);
  const [submitOk, setSubmitOk]               = useState(false);

  const openRefundDlg = (row: typeof rows[number]) => {
    setRefundDlg({
      open: true,
      internalOrderId: (row as any).id ?? null,
      razorpayPaymentId: (row as any).razorpayPaymentId ?? "",
      razorpayOrderId: row.razorpayOrderId ?? "",
      maxAmountInr: Number(row.amount ?? 0),
    });
    setRefundAmountStr("");
    setRefundPaymentId((row as any).razorpayPaymentId ?? "");
    setRefundNotes("");
    setSubmitError(null);
    setSubmitOk(false);
  };

  const handleInitiateRefund = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const amountPaise = refundAmountStr.trim()
        ? Math.round(parseFloat(refundAmountStr) * 100)
        : undefined;
      const body: Record<string, unknown> = {
        razorpayPaymentId: refundPaymentId.trim(),
        orderId: refundDlg.internalOrderId,
      };
      if (amountPaise !== undefined) body.amount = amountPaise;
      if (refundNotes.trim()) body.notes = refundNotes.trim();

      const resp = await fetch("/api/admin/razorpay/refunds", {
        method: "POST",
        headers: { ...authHeader(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error((err as any).error ?? `HTTP ${resp.status}`);
      }
      setSubmitOk(true);
      setTimeout(() => {
        setRefundDlg(s => ({ ...s, open: false }));
        if (activeTab === "refunds") fetchRefunds(1);
      }, 1500);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Failed to initiate refund");
    } finally {
      setSubmitting(false);
    }
  };

  // ── CSV export ───────────────────────────────────────────────────────────
  const handleExportCsv = () => {
    const token = getToken();
    const params = new URLSearchParams();
    if (status !== "all") params.set("status", status);
    const url = `/api/admin/razorpay/orders/export/csv?${params}`;
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.blob())
      .then(blob => {
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = `razorpay-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(objectUrl);
      });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-indigo-400" />
            Razorpay Transactions
          </h1>
          <p className="text-sm text-muted-foreground mt-1">All Razorpay payment orders across merchants</p>
        </div>
        {activeTab === "transactions" && (
          <Button variant="outline" size="sm" onClick={handleExportCsv} disabled={!rows.length}>
            <FileDown className="w-3.5 h-3.5 mr-1.5" />Export CSV
          </Button>
        )}
        {activeTab === "refunds" && (
          <Button variant="outline" size="sm" onClick={() => fetchRefunds(refundPage)} disabled={loadingRefunds}>
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loadingRefunds ? "animate-spin" : ""}`} />Refresh
          </Button>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-border gap-1">
        {(["transactions", "refunds"] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab === "transactions" ? "Transactions" : "Refunds"}
          </button>
        ))}
      </div>

      {/* ── TRANSACTIONS TAB ──────────────────────────────────────────────── */}
      {activeTab === "transactions" && (
        <>
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                placeholder="Search order ID, payment ID…"
                className="pl-9 h-8 text-sm"
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
              />
            </div>
            <Select value={status} onValueChange={v => { setStatus(v); setPage(1); }}>
              <SelectTrigger className="h-8 w-36 text-xs">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="CREATED">Created</SelectItem>
                <SelectItem value="PENDING">Pending</SelectItem>
                <SelectItem value="SUCCESS">Success</SelectItem>
                <SelectItem value="FAILED">Failed</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">
                {isLoading ? "Loading…" : `${total.toLocaleString()} transaction${total !== 1 ? "s" : ""}`}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : isError ? (
                <div className="py-12 text-center text-sm text-destructive">Failed to load transactions</div>
              ) : !rows.length ? (
                <div className="py-12 text-center text-sm text-muted-foreground">No transactions found</div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Internal ID</TableHead>
                        <TableHead className="text-xs">Razorpay Order</TableHead>
                        <TableHead className="text-xs">Merchant</TableHead>
                        <TableHead className="text-xs">Amount</TableHead>
                        <TableHead className="text-xs">Status</TableHead>
                        <TableHead className="text-xs">Method</TableHead>
                        <TableHead className="text-xs">UTR</TableHead>
                        <TableHead className="text-xs">Paid At</TableHead>
                        <TableHead className="text-xs">Created</TableHead>
                        <TableHead className="text-xs">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map(row => (
                        <TableRow key={row.id}>
                          <TableCell className="font-mono text-xs">{row.internalOrderId ?? "—"}</TableCell>
                          <TableCell className="font-mono text-xs max-w-[140px] truncate" title={row.razorpayOrderId}>
                            {row.razorpayOrderId ?? "—"}
                          </TableCell>
                          <TableCell className="text-xs">{row.merchantId ?? "—"}</TableCell>
                          <TableCell className="text-xs font-mono">
                            ₹{Number(row.amount ?? 0).toLocaleString()} {row.currency ?? "INR"}
                          </TableCell>
                          <TableCell>
                            <Badge className={`text-[10px] h-5 ${statusColor(row.status)}`}>
                              {row.status ?? "—"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs">{row.paymentMethod ?? "—"}</TableCell>
                          <TableCell className="font-mono text-xs">{row.utr ?? "—"}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {row.paidAt ? format(new Date(row.paidAt), "MMM d, yyyy HH:mm") : "—"}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {row.createdAt ? format(new Date(row.createdAt), "MMM d, yyyy HH:mm") : "—"}
                          </TableCell>
                          <TableCell>
                            {row.status?.toUpperCase() === "SUCCESS" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs text-amber-400 hover:text-amber-300 hover:bg-amber-500/10"
                                onClick={() => openRefundDlg(row)}
                              >
                                <RotateCcw className="w-3 h-3 mr-1" />
                                Refund
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {total > 20 && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{total} total</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                  Previous
                </Button>
                <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page * 20 >= total}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── REFUNDS TAB ───────────────────────────────────────────────────── */}
      {activeTab === "refunds" && (
        <>
          {refundListError && (
            <div className="text-sm text-destructive py-4 text-center">{refundListError}</div>
          )}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">
                {loadingRefunds ? "Loading…" : `${refundTotal.toLocaleString()} refund${refundTotal !== 1 ? "s" : ""}`}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {loadingRefunds ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : !refunds.length ? (
                <div className="py-12 text-center text-sm text-muted-foreground">No refunds found</div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Refund ID</TableHead>
                        <TableHead className="text-xs">Payment ID</TableHead>
                        <TableHead className="text-xs">Amount</TableHead>
                        <TableHead className="text-xs">Status</TableHead>
                        <TableHead className="text-xs">Speed</TableHead>
                        <TableHead className="text-xs">Initiated By</TableHead>
                        <TableHead className="text-xs">Notes</TableHead>
                        <TableHead className="text-xs">Created</TableHead>
                        <TableHead className="text-xs">Processed</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {refunds.map(r => (
                        <TableRow key={r.id}>
                          <TableCell className="font-mono text-xs max-w-[140px] truncate" title={r.razorpayRefundId ?? undefined}>
                            {r.razorpayRefundId ?? "—"}
                          </TableCell>
                          <TableCell className="font-mono text-xs max-w-[140px] truncate" title={r.razorpayPaymentId}>
                            {r.razorpayPaymentId}
                          </TableCell>
                          <TableCell className="text-xs font-mono">
                            ₹{Number(r.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })} {r.currency}
                          </TableCell>
                          <TableCell>
                            <Badge className={`text-[10px] h-5 ${refundStatusColor(r.status)}`}>
                              {r.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs">{r.speed}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{r.initiatedByEmail ?? "Webhook"}</TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-[120px] truncate">{r.notes ?? "—"}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {r.createdAt ? format(new Date(r.createdAt), "MMM d, yyyy HH:mm") : "—"}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {r.processedAt ? format(new Date(r.processedAt), "MMM d, yyyy HH:mm") : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {refundTotal > 20 && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{refundTotal} total</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setRefundPage(p => Math.max(1, p - 1))} disabled={refundPage === 1}>
                  Previous
                </Button>
                <Button variant="outline" size="sm" onClick={() => setRefundPage(p => p + 1)} disabled={refundPage * 20 >= refundTotal}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Initiate Refund Dialog ─────────────────────────────────────────── */}
      <Dialog open={refundDlg.open} onOpenChange={open => setRefundDlg(s => ({ ...s, open }))}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Initiate Refund</DialogTitle>
          </DialogHeader>

          {submitOk ? (
            <div className="py-6 text-center text-emerald-400 text-sm font-medium">
              Refund initiated successfully ✓
            </div>
          ) : (
            <div className="grid gap-4 py-2">
              <div className="text-xs text-muted-foreground">
                Order: <span className="font-mono">{refundDlg.razorpayOrderId || "—"}</span>
                {refundDlg.maxAmountInr > 0 && (
                  <> · Max ₹{refundDlg.maxAmountInr.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</>
                )}
              </div>

              <div className="grid gap-1.5">
                <Label className="text-xs">Razorpay Payment ID <span className="text-destructive">*</span></Label>
                <Input
                  className="h-8 text-sm font-mono"
                  placeholder="pay_xxxxxxxxxxxx"
                  value={refundPaymentId}
                  onChange={e => setRefundPaymentId(e.target.value)}
                />
              </div>

              <div className="grid gap-1.5">
                <Label className="text-xs">Amount (₹) — leave blank for full refund</Label>
                <Input
                  className="h-8 text-sm"
                  type="number"
                  min="0.01"
                  step="0.01"
                  max={refundDlg.maxAmountInr || undefined}
                  placeholder={`Full refund${refundDlg.maxAmountInr > 0 ? ` (₹${refundDlg.maxAmountInr})` : ""}`}
                  value={refundAmountStr}
                  onChange={e => setRefundAmountStr(e.target.value)}
                />
              </div>

              <div className="grid gap-1.5">
                <Label className="text-xs">Notes (optional)</Label>
                <Input
                  className="h-8 text-sm"
                  placeholder="Reason for refund"
                  value={refundNotes}
                  onChange={e => setRefundNotes(e.target.value)}
                />
              </div>

              {submitError && (
                <p className="text-xs text-destructive">{submitError}</p>
              )}
            </div>
          )}

          {!submitOk && (
            <DialogFooter>
              <Button variant="ghost" size="sm" onClick={() => setRefundDlg(s => ({ ...s, open: false }))} disabled={submitting}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleInitiateRefund}
                disabled={submitting || !refundPaymentId.trim()}
                className="bg-amber-500 hover:bg-amber-600 text-white"
              >
                {submitting ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Initiating…</> : "Initiate Refund"}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
