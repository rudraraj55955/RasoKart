import { useState, useCallback } from "react";
import { getToken } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Loader2,
  Search,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  SkipForward,
  HelpCircle,
  ChevronRight,
  ShieldAlert,
  Receipt,
  Download,
} from "lucide-react";

const authHeader = () => ({ Authorization: `Bearer ${getToken()}` });

const DEFAULT_SINCE = "2026-01-01";
const DEFAULT_UNTIL = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

interface StuckOrder {
  id: number;
  merchantId: number;
  merchantName: string | null;
  cashfreeOrderId: string | null;
  publicOrderId: string | null;
  amount: number;
  currency: string;
  status: string;
  utr: string | null;
  paidAt: string | null;
  createdAt: string;
  webhookLogCount: number;
  webhookLogResults: string[];
}

interface StuckOrdersResponse {
  since: string;
  until: string;
  total: number;
  grandTotal: number;
  orders: StuckOrder[];
}

type BackfillOutcome = "credited" | "duplicate" | "not_found" | "error";

interface BackfillResult {
  cashfreeOrderId: string;
  outcome: BackfillOutcome;
  detail: string;
}

interface BackfillSummary {
  credited: number;
  duplicate: number;
  notFound: number;
  errors: number;
  total: number;
}

interface BackfillResponse {
  results: BackfillResult[];
  summary: BackfillSummary;
}

function statusBadge(status: string) {
  switch (status.toUpperCase()) {
    case "PAID":    return <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 border">PAID</Badge>;
    case "CREATED": return <Badge className="bg-sky-500/10 text-sky-400 border-sky-500/30 border">CREATED</Badge>;
    case "PENDING": return <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/30 border">PENDING</Badge>;
    case "EXPIRED": return <Badge className="bg-zinc-500/10 text-zinc-400 border-zinc-500/30 border">EXPIRED</Badge>;
    case "FAILED":  return <Badge className="bg-rose-500/10 text-rose-400 border-rose-500/30 border">FAILED</Badge>;
    default:        return <Badge variant="outline">{status}</Badge>;
  }
}

function outcomeIcon(outcome: BackfillOutcome) {
  switch (outcome) {
    case "credited":   return <CheckCircle2 className="h-4 w-4 text-emerald-400" />;
    case "duplicate":  return <SkipForward  className="h-4 w-4 text-sky-400" />;
    case "not_found":  return <HelpCircle   className="h-4 w-4 text-amber-400" />;
    case "error":      return <XCircle      className="h-4 w-4 text-rose-400" />;
  }
}

function outcomeBadge(outcome: BackfillOutcome) {
  switch (outcome) {
    case "credited":  return <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 border">Credited</Badge>;
    case "duplicate": return <Badge className="bg-sky-500/10 text-sky-400 border-sky-500/30 border">Already Paid</Badge>;
    case "not_found": return <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/30 border">Not Found</Badge>;
    case "error":     return <Badge className="bg-rose-500/10 text-rose-400 border-rose-500/30 border">Error</Badge>;
  }
}

export default function AdminCashfreePayinRecon() {
  // ── Date window state ────────────────────────────────────────────────────
  const [since, setSince] = useState(DEFAULT_SINCE);
  const [until, setUntil] = useState(DEFAULT_UNTIL);

  // ── Report state ─────────────────────────────────────────────────────────
  const [reportData, setReportData]     = useState<StuckOrdersResponse | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [reportError, setReportError]   = useState<string | null>(null);

  // ── Selection state ──────────────────────────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // ── Backfill state ───────────────────────────────────────────────────────
  const [confirmOpen, setConfirmOpen]   = useState(false);
  const [backfilling, setBackfilling]   = useState(false);
  const [backfillResult, setBackfillResult] = useState<BackfillResponse | null>(null);
  const [backfillError, setBackfillError] = useState<string | null>(null);

  // ── Load report ──────────────────────────────────────────────────────────
  // `clearResults` — when true (default) this is a fresh user-initiated load
  // that should reset everything.  Pass false after a backfill so that the
  // per-order outcomes remain visible while the table refreshes in place.
  const loadReport = useCallback(async (clearResults = true) => {
    setLoadingReport(true);
    setReportError(null);
    setReportData(null);
    if (clearResults) {
      setSelected(new Set());
      setBackfillResult(null);
      setBackfillError(null);
    }

    try {
      const params = new URLSearchParams({
        since: since + "T00:00:00Z",
        until: until + "T23:59:59Z",
      });
      const resp = await fetch(`/api/admin/cashfree-payin-recon/stuck-orders?${params}`, {
        headers: authHeader(),
      });
      if (!resp.ok) {
        const json = await resp.json().catch(() => ({}));
        throw new Error((json as any).error ?? `HTTP ${resp.status}`);
      }
      const data: StuckOrdersResponse = await resp.json();
      setReportData(data);
    } catch (e) {
      setReportError(e instanceof Error ? e.message : "Failed to load stuck orders");
    } finally {
      setLoadingReport(false);
    }
  }, [since, until]);

  // ── Selection helpers ────────────────────────────────────────────────────
  const eligibleOrders = (reportData?.orders ?? []).filter(o => o.cashfreeOrderId);
  const allSelected    = eligibleOrders.length > 0 && eligibleOrders.every(o => selected.has(o.cashfreeOrderId!));
  const someSelected   = eligibleOrders.some(o => selected.has(o.cashfreeOrderId!));

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(eligibleOrders.map(o => o.cashfreeOrderId!)));
    }
  }

  function toggleOrder(cashfreeOrderId: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(cashfreeOrderId)) next.delete(cashfreeOrderId);
      else next.add(cashfreeOrderId);
      return next;
    });
  }

  // ── Download CSV ─────────────────────────────────────────────────────────
  const [downloadingCsv, setDownloadingCsv] = useState(false);

  const downloadCsv = useCallback(async () => {
    setDownloadingCsv(true);
    try {
      const params = new URLSearchParams({
        since: since + "T00:00:00Z",
        until: until + "T23:59:59Z",
      });
      const resp = await fetch(`/api/admin/cashfree-payin-recon/stuck-orders/export?${params}`, {
        headers: authHeader(),
      });
      if (!resp.ok) {
        const json = await resp.json().catch(() => ({}));
        throw new Error((json as any).error ?? `HTTP ${resp.status}`);
      }
      const blob = await resp.blob();
      const disposition = resp.headers.get("Content-Disposition") ?? "";
      const nameMatch = disposition.match(/filename="([^"]+)"/);
      const filename = nameMatch ? nameMatch[1] : "stuck-orders.csv";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      // Surface error in a simple alert — non-critical path
      alert(e instanceof Error ? e.message : "CSV download failed");
    } finally {
      setDownloadingCsv(false);
    }
  }, [since, until]);

  // ── Run backfill ─────────────────────────────────────────────────────────
  async function runBackfill() {
    setConfirmOpen(false);
    setBackfilling(true);
    setBackfillResult(null);
    setBackfillError(null);

    try {
      const resp = await fetch("/api/admin/cashfree-payin-recon/backfill", {
        method: "POST",
        headers: { ...authHeader(), "Content-Type": "application/json" },
        body: JSON.stringify({ cashfreeOrderIds: Array.from(selected) }),
      });
      if (!resp.ok) {
        const json = await resp.json().catch(() => ({}));
        throw new Error((json as any).error ?? `HTTP ${resp.status}`);
      }
      const data: BackfillResponse = await resp.json();
      setBackfillResult(data);
      // Reload the report to reflect newly PAID orders, but preserve the
      // backfill results so outcomes remain visible in the table and banner.
      await loadReport(false);
    } catch (e) {
      setBackfillError(e instanceof Error ? e.message : "Backfill failed");
    } finally {
      setBackfilling(false);
    }
  }

  const selectedCount = selected.size;
  const selectedAmount = eligibleOrders
    .filter(o => o.cashfreeOrderId && selected.has(o.cashfreeOrderId))
    .reduce((s, o) => s + o.amount, 0);

  return (
    <div className="space-y-6 p-6">
      {/* Page header */}
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-amber-500/10 p-2 mt-0.5">
          <Receipt className="h-5 w-5 text-amber-400" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-foreground">Cashfree Payin Reconciliation</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Identify and backfill payments that were collected by Cashfree but not credited to merchant
            wallets due to the webhook signature decryption bug (pre-fix window).
          </p>
        </div>
      </div>

      {/* Security notice */}
      <Alert className="border-amber-500/30 bg-amber-500/5">
        <ShieldAlert className="h-4 w-4 text-amber-400" />
        <AlertDescription className="text-amber-200/80 text-sm">
          <strong className="text-amber-300">Super Admin only.</strong> Backfill operations are
          irreversible — each order is credited atomically and logged for audit. Verify the order list
          against Cashfree's Settlement dashboard before backfilling.
        </AlertDescription>
      </Alert>

      {/* Date range picker */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Stuck-Order Report Window</CardTitle>
          <CardDescription>
            Orders in CREATED / PENDING / EXPIRED status within this window will be listed.
            Defaults to the bug-affected window (2026-01-01 → today).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row items-end gap-3">
            <div className="grid w-full sm:w-auto gap-1.5">
              <Label htmlFor="since">From date</Label>
              <Input
                id="since"
                type="date"
                value={since}
                onChange={e => setSince(e.target.value)}
                className="w-full sm:w-44"
              />
            </div>
            <div className="grid w-full sm:w-auto gap-1.5">
              <Label htmlFor="until">To date</Label>
              <Input
                id="until"
                type="date"
                value={until}
                onChange={e => setUntil(e.target.value)}
                className="w-full sm:w-44"
              />
            </div>
            <Button onClick={() => loadReport()} disabled={loadingReport} className="flex-shrink-0">
              {loadingReport
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Loading…</>
                : <><Search className="h-4 w-4 mr-2" />Load Stuck Orders</>
              }
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Error state */}
      {reportError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{reportError}</AlertDescription>
        </Alert>
      )}

      {/* Backfill result banner */}
      {backfillResult && (
        <Alert className="border-emerald-500/30 bg-emerald-500/5">
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          <AlertDescription className="text-emerald-200/80">
            <strong className="text-emerald-300">Backfill complete.</strong>{" "}
            {backfillResult.summary.credited} credited, {backfillResult.summary.duplicate} already paid,
            {backfillResult.summary.notFound} not found, {backfillResult.summary.errors} errors.
          </AlertDescription>
        </Alert>
      )}

      {backfillError && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertDescription>{backfillError}</AlertDescription>
        </Alert>
      )}

      {/* Results table */}
      {reportData && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base">
                  {reportData.total} Stuck Order{reportData.total !== 1 ? "s" : ""}
                  {reportData.total > 0 && (
                    <span className="ml-2 text-muted-foreground font-normal text-sm">
                      — total uncredited:{" "}
                      <span className="text-foreground font-medium">
                        ₹{reportData.grandTotal.toFixed(2)}
                      </span>
                    </span>
                  )}
                </CardTitle>
                <CardDescription>
                  {new Date(reportData.since).toLocaleDateString()} →{" "}
                  {new Date(reportData.until).toLocaleDateString()}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={downloadCsv}
                  disabled={downloadingCsv}
                >
                  {downloadingCsv
                    ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Exporting…</>
                    : <><Download className="h-3.5 w-3.5 mr-1.5" />Download CSV</>
                  }
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => loadReport()}
                  disabled={loadingReport}
                >
                  <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loadingReport ? "animate-spin" : ""}`} />
                  Refresh
                </Button>
                <Button
                  size="sm"
                  disabled={selectedCount === 0 || backfilling}
                  onClick={() => setConfirmOpen(true)}
                >
                  {backfilling
                    ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Backfilling…</>
                    : <>
                        <ChevronRight className="h-3.5 w-3.5 mr-1.5" />
                        Backfill {selectedCount > 0 ? `${selectedCount} selected` : "selected"}
                      </>
                  }
                </Button>
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            {reportData.total === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <CheckCircle2 className="h-8 w-8 text-emerald-400 mb-2" />
                <p className="text-sm font-medium">No stuck orders found in this window.</p>
                <p className="text-xs mt-1">All orders are either PAID or the window has no matching records.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10 pl-4">
                        <Checkbox
                          checked={allSelected}
                          onCheckedChange={toggleAll}
                          aria-label="Select all"
                          data-state={someSelected && !allSelected ? "indeterminate" : undefined}
                        />
                      </TableHead>
                      <TableHead>Order ID</TableHead>
                      <TableHead>Merchant</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>UTR</TableHead>
                      <TableHead>Webhook Logs</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Backfill Result</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reportData.orders.map(order => {
                      const cfId = order.cashfreeOrderId;
                      const isSelected = cfId != null && selected.has(cfId);
                      const result = backfillResult?.results.find(
                        r => r.cashfreeOrderId === cfId,
                      );

                      return (
                        <TableRow
                          key={order.id}
                          className={isSelected ? "bg-primary/5" : undefined}
                        >
                          <TableCell className="pl-4">
                            {cfId ? (
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={() => toggleOrder(cfId)}
                                aria-label={`Select order ${order.publicOrderId ?? cfId}`}
                              />
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="font-mono text-xs">
                              <div className="text-foreground">{order.publicOrderId ?? order.cashfreeOrderId ?? `#${order.id}`}</div>
                              {order.publicOrderId && order.cashfreeOrderId && (
                                <div className="text-muted-foreground">{order.cashfreeOrderId}</div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="text-sm">
                              {order.merchantName ?? <span className="text-muted-foreground">Merchant {order.merchantId}</span>}
                            </div>
                            <div className="text-xs text-muted-foreground">ID: {order.merchantId}</div>
                          </TableCell>
                          <TableCell className="font-medium">
                            {order.currency} {order.amount.toFixed(2)}
                          </TableCell>
                          <TableCell>{statusBadge(order.status)}</TableCell>
                          <TableCell>
                            {order.utr ? (
                              <span className="font-mono text-xs">{order.utr}</span>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {order.webhookLogCount > 0 ? (
                              <div>
                                <Badge variant="outline" className="text-xs">
                                  {order.webhookLogCount} log{order.webhookLogCount !== 1 ? "s" : ""}
                                </Badge>
                                <div className="text-xs text-muted-foreground mt-0.5">
                                  {[...new Set(order.webhookLogResults)].join(", ")}
                                </div>
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {order.createdAt
                              ? new Date(order.createdAt).toLocaleString()
                              : "—"}
                          </TableCell>
                          <TableCell>
                            {result ? (
                              <div className="flex items-center gap-1.5">
                                {outcomeIcon(result.outcome)}
                                {outcomeBadge(result.outcome)}
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Detailed backfill results */}
      {backfillResult && backfillResult.results.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Backfill Results Detail</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>CF Order ID</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead>Detail</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {backfillResult.results.map(r => (
                    <TableRow key={r.cashfreeOrderId}>
                      <TableCell className="font-mono text-xs">{r.cashfreeOrderId}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          {outcomeIcon(r.outcome)}
                          {outcomeBadge(r.outcome)}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{r.detail}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Confirmation dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-400" />
              Confirm Backfill
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-3 pt-1">
                <p>
                  You are about to credit{" "}
                  <strong className="text-foreground">{selectedCount} order{selectedCount !== 1 ? "s" : ""}</strong>{" "}
                  totalling{" "}
                  <strong className="text-foreground">₹{selectedAmount.toFixed(2)}</strong>{" "}
                  to merchant wallets.
                </p>
                <ul className="text-xs space-y-1 bg-muted/30 rounded-md p-3">
                  <li>✅ Each order is processed atomically — partial failures won't roll back others.</li>
                  <li>✅ Idempotent — already-PAID orders are skipped automatically.</li>
                  <li>✅ Every credit is tagged <code className="font-mono">[RECONCILIATION]</code> in the ledger.</li>
                  <li>✅ Your identity is recorded in the audit log for each order.</li>
                </ul>
                <p className="text-amber-400/80 text-xs">
                  ⚠️ Ensure you have verified these orders against Cashfree's Settlement dashboard
                  before proceeding. This operation cannot be undone.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button onClick={runBackfill} disabled={backfilling}>
              {backfilling
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Backfilling…</>
                : "Confirm Backfill"
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
