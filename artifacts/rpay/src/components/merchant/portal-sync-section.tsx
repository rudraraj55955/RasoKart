/**
 * PortalSyncSection — displays Paytm Business Portal synced transactions.
 *
 * Rendered below the main transactions table when a CONNECTED paytm_merchant
 * session exists. Shows read-only portal data from merchant_portal_transactions.
 *
 * INVARIANTS:
 *   - dry_run=true on all rows (wallet not modified, badge shown).
 *   - No wallet-credit actions in this UI.
 *   - rawPayload is excluded from every response (never shown).
 *   - Pagination: 20 rows per page.
 *   - Filters: normalized status, date range.
 *   - "Sync Now" posts to /api/merchant/portal-sessions/paytm_merchant/sync.
 */

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, RefreshCw, AlertTriangle, ChevronLeft, ChevronRight, Link2, Database, CheckCircle2, XCircle, Clock, RotateCcw } from "lucide-react";
import { format, subDays, parseISO } from "date-fns";
import { getToken } from "@/lib/auth";
import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PortalSession {
  id: number;
  providerSlug: string;
  status: string;
  connectedAt: string | null;
  updatedAt: string;
  lastStatusMessage: string | null;
}

interface PortalTransaction {
  id: number;
  externalId: string;
  externalOrderId: string | null;
  amount: number;            // in paise
  currency: string;
  status: string;            // raw provider status
  normalizedStatus: string;  // SUCCESS|FAILED|PENDING|REVERSED|UNKNOWN
  paymentMethod: string | null;
  utr: string | null;
  txTimestamp: string | null;
  fetchedAt: string;
  dryRun: boolean;
  autoCredited: boolean;
  createdAt: string;
}

interface TxListResponse {
  transactions: PortalTransaction[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const LIMIT = 20;
const PROVIDER = "paytm_merchant";
const API_BASE = import.meta.env["BASE_URL"]?.replace(/\/$/, "") ?? "";

function apiHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function formatPaise(paise: number): string {
  return "₹" + (paise / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function maskExternalId(id: string): string {
  if (id.length <= 8) return id;
  return id.slice(0, 4) + "…" + id.slice(-4);
}

function normalizedStatusBadge(status: string) {
  switch (status) {
    case "SUCCESS":
      return (
        <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/20 gap-1 text-xs">
          <CheckCircle2 className="w-3 h-3" /> Success
        </Badge>
      );
    case "FAILED":
      return (
        <Badge className="bg-red-500/15 text-red-400 border-red-500/20 gap-1 text-xs">
          <XCircle className="w-3 h-3" /> Failed
        </Badge>
      );
    case "PENDING":
      return (
        <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/20 gap-1 text-xs">
          <Clock className="w-3 h-3" /> Pending
        </Badge>
      );
    case "REVERSED":
      return (
        <Badge className="bg-blue-500/15 text-blue-400 border-blue-500/20 gap-1 text-xs">
          <RotateCcw className="w-3 h-3" /> Reversed
        </Badge>
      );
    default:
      return (
        <Badge className="bg-muted/50 text-muted-foreground border gap-1 text-xs">
          Unknown
        </Badge>
      );
  }
}

// ── Main component ─────────────────────────────────────────────────────────────

export function PortalSyncSection() {
  // ── Session state ─────────────────────────────────────────────────────────
  const [session, setSession] = useState<PortalSession | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);

  // ── Transaction list state ────────────────────────────────────────────────
  const [txData, setTxData] = useState<TxListResponse | null>(null);
  const [txLoading, setTxLoading] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);

  // ── Filters ───────────────────────────────────────────────────────────────
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [dateFrom, setDateFrom] = useState<string>(() =>
    format(subDays(new Date(), 29), "yyyy-MM-dd"),
  );
  const [dateTo, setDateTo] = useState<string>(() => format(new Date(), "yyyy-MM-dd"));

  // ── Sync state ────────────────────────────────────────────────────────────
  const [syncing, setSyncing] = useState(false);

  // ── Load session ───────────────────────────────────────────────────────────
  useEffect(() => {
    async function loadSession() {
      try {
        const r = await fetch(`${API_BASE}/api/merchant/portal-sessions`, {
          headers: apiHeaders(),
          credentials: "include",
        });
        if (!r.ok) return;
        const d = await r.json();
        const sessions: PortalSession[] = d.sessions ?? [];
        const s = sessions.find((x) => x.providerSlug === PROVIDER) ?? null;
        setSession(s);
      } catch {
        // Fail silently — section hidden if no session
      } finally {
        setSessionLoading(false);
      }
    }
    loadSession();
  }, []);

  // ── Load transactions ──────────────────────────────────────────────────────
  const loadTransactions = useCallback(async (p: number) => {
    setTxLoading(true);
    setTxError(null);
    try {
      const params = new URLSearchParams({
        page: String(p),
        limit: String(LIMIT),
        dateFrom,
        dateTo,
      });
      if (statusFilter !== "ALL") params.set("status", statusFilter);

      const r = await fetch(
        `${API_BASE}/api/merchant/portal-sessions/${PROVIDER}/transactions?${params}`,
        { headers: apiHeaders(), credentials: "include" },
      );
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        setTxError((err as any).error ?? "Failed to load transactions");
        return;
      }
      const d: TxListResponse = await r.json();
      setTxData(d);
    } catch (err: any) {
      setTxError("Network error — please try again.");
    } finally {
      setTxLoading(false);
    }
  }, [statusFilter, dateFrom, dateTo]);

  useEffect(() => {
    if (session?.status === "CONNECTED") {
      setPage(1);
      loadTransactions(1);
    }
  }, [session, statusFilter, dateFrom, dateTo, loadTransactions]);

  // ── Sync now ───────────────────────────────────────────────────────────────
  async function handleSync() {
    setSyncing(true);
    try {
      const r = await fetch(
        `${API_BASE}/api/merchant/portal-sessions/${PROVIDER}/sync`,
        { method: "POST", headers: apiHeaders(), credentials: "include" },
      );
      const d = await r.json();
      if (!r.ok) {
        toast.error(d.error ?? "Sync failed");
        return;
      }
      toast.success(`Synced ${d.synced} new transaction${d.synced !== 1 ? "s" : ""}.`);
      // Refresh transaction list
      await loadTransactions(page);
      // Refresh session (updated_at changes)
      const sr = await fetch(`${API_BASE}/api/merchant/portal-sessions`, {
        headers: apiHeaders(), credentials: "include",
      });
      if (sr.ok) {
        const sd = await sr.json();
        const s = (sd.sessions as PortalSession[]).find((x) => x.providerSlug === PROVIDER) ?? null;
        setSession(s);
      }
    } catch {
      toast.error("Sync failed — please try again.");
    } finally {
      setSyncing(false);
    }
  }

  // ── Pagination ─────────────────────────────────────────────────────────────
  function goPage(p: number) {
    setPage(p);
    loadTransactions(p);
  }

  // ── Render guards ──────────────────────────────────────────────────────────

  // While loading the session list, show nothing (no flash)
  if (sessionLoading) return null;

  // No session or not connected → don't show the section
  if (!session || session.status !== "CONNECTED") return null;

  // ── Render ─────────────────────────────────────────────────────────────────
  const total = txData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));
  const lastSynced = session.updatedAt
    ? format(parseISO(session.updatedAt), "MMM d, HH:mm")
    : null;

  return (
    <div className="mt-8 space-y-4">
      {/* Section header */}
      <div className="flex items-center gap-2">
        <div className="h-px flex-1 bg-border" />
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground px-2">
          <Link2 className="w-4 h-4 text-sky-400" />
          Portal Sync
        </div>
        <div className="h-px flex-1 bg-border" />
      </div>

      <Card className="border-sky-500/20 bg-sky-950/10">
        <CardHeader className="pb-3 pt-4 px-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            {/* Provider + status */}
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-sky-500/15 flex items-center justify-center">
                <Database className="w-4 h-4 text-sky-400" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm">Paytm Business</span>
                  <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/20 text-xs">
                    Connected
                  </Badge>
                  <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/20 text-xs gap-1">
                    <AlertTriangle className="w-2.5 h-2.5" />
                    Read-only · Dry run
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Portal-synced transactions · wallet not modified
                  {lastSynced && ` · Last synced ${lastSynced}`}
                </p>
              </div>
            </div>

            {/* Sync button */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleSync}
              disabled={syncing}
              className="border-sky-500/30 text-sky-400 hover:bg-sky-500/10 hover:text-sky-300 shrink-0"
            >
              {syncing ? (
                <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5 mr-2" />
              )}
              Sync Now
            </Button>
          </div>
        </CardHeader>

        <CardContent className="px-5 pb-5 pt-0 space-y-4">
          {/* Filters row */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Status */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground font-medium">Status</span>
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v)}>
                <SelectTrigger className="h-8 w-36 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All</SelectItem>
                  <SelectItem value="SUCCESS">Success</SelectItem>
                  <SelectItem value="FAILED">Failed</SelectItem>
                  <SelectItem value="PENDING">Pending</SelectItem>
                  <SelectItem value="REVERSED">Reversed</SelectItem>
                  <SelectItem value="UNKNOWN">Unknown</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Date from */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground font-medium">From</span>
              <input
                type="date"
                value={dateFrom}
                max={dateTo}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-8 rounded-md border border-input bg-transparent px-3 text-xs ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {/* Date to */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground font-medium">To</span>
              <input
                type="date"
                value={dateTo}
                min={dateFrom}
                max={format(new Date(), "yyyy-MM-dd")}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-8 rounded-md border border-input bg-transparent px-3 text-xs ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {total > 0 && (
              <span className="text-xs text-muted-foreground ml-auto">
                {total.toLocaleString()} transaction{total !== 1 ? "s" : ""}
              </span>
            )}
          </div>

          {/* Table */}
          {txLoading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Loading synced transactions…</span>
            </div>
          ) : txError ? (
            <div className="flex items-center gap-2 rounded-md border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {txError}
            </div>
          ) : !txData || txData.transactions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground gap-2">
              <Database className="w-8 h-8 opacity-30" />
              <p className="text-sm">No synced transactions found for this period.</p>
              <p className="text-xs">Use "Sync Now" to pull the latest data from Paytm Business.</p>
            </div>
          ) : (
            <div className="rounded-md border border-border/50 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-border/50">
                    <TableHead className="text-xs font-medium">Tx ID</TableHead>
                    <TableHead className="text-xs font-medium">UTR / Ref</TableHead>
                    <TableHead className="text-xs font-medium">Amount</TableHead>
                    <TableHead className="text-xs font-medium">Provider Status</TableHead>
                    <TableHead className="text-xs font-medium">Normalized</TableHead>
                    <TableHead className="text-xs font-medium">Tx Date</TableHead>
                    <TableHead className="text-xs font-medium">Fetched</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {txData.transactions.map((tx) => (
                    <TableRow key={tx.id} className="hover:bg-muted/30 border-border/30">
                      {/* External ID — truncated for readability */}
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {maskExternalId(tx.externalId)}
                      </TableCell>

                      {/* UTR */}
                      <TableCell className="font-mono text-xs">
                        {tx.utr ? (
                          <span className="text-sky-300/80">{tx.utr}</span>
                        ) : tx.externalOrderId ? (
                          <span className="text-muted-foreground">{tx.externalOrderId}</span>
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </TableCell>

                      {/* Amount */}
                      <TableCell className="text-sm font-semibold tabular-nums">
                        {tx.amount > 0
                          ? formatPaise(tx.amount)
                          : <span className="text-muted-foreground text-xs">—</span>}
                      </TableCell>

                      {/* Provider status (raw) */}
                      <TableCell className="text-xs text-muted-foreground capitalize">
                        {tx.status?.toLowerCase() ?? "—"}
                      </TableCell>

                      {/* Normalized status */}
                      <TableCell>{normalizedStatusBadge(tx.normalizedStatus)}</TableCell>

                      {/* Tx Date */}
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {tx.txTimestamp
                          ? format(parseISO(tx.txTimestamp), "MMM d, HH:mm")
                          : <span className="opacity-40">—</span>}
                      </TableCell>

                      {/* Fetched At */}
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {format(parseISO(tx.fetchedAt), "MMM d, HH:mm")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Pagination */}
          {total > LIMIT && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => goPage(Math.max(1, page - 1))}
                  disabled={page === 1 || txLoading}
                >
                  <ChevronLeft className="w-4 h-4 mr-1" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => goPage(Math.min(totalPages, page + 1))}
                  disabled={page >= totalPages || txLoading}
                >
                  Next
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
