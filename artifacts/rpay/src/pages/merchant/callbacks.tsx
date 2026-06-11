import { useState, useEffect, useCallback } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useListCallbackLogs, useGetCallbackStats, useGetWebhookLogAttempts, useRetryWebhookLog, getListCallbackLogsQueryKey } from "@workspace/api-client-react";
import type { CallbackLogAttempt } from "@workspace/api-client-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { AlertTriangle, ChevronDown, ChevronRight, Clock, ListOrdered, Loader2, QrCode, RefreshCw, ShieldAlert, X } from "lucide-react";
import { format } from "date-fns";

function SignatureVerifiedBadge({ value }: { value: boolean | null | undefined }) {
  if (value === true) {
    return <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 hover:bg-emerald-500/20 text-xs">Verified</Badge>;
  }
  if (value === false) {
    return <Badge className="bg-rose-500/10 text-rose-500 border-rose-500/20 hover:bg-rose-500/20 text-xs">Failed</Badge>;
  }
  return <span className="text-muted-foreground text-xs">—</span>;
}

function AttemptStatusDot({ httpStatus }: { httpStatus: number | null | undefined }) {
  if (httpStatus != null && httpStatus >= 200 && httpStatus < 300) {
    return <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 shrink-0 mt-0.5" />;
  }
  if (httpStatus != null) {
    return <span className="inline-block w-2 h-2 rounded-full bg-rose-400 shrink-0 mt-0.5" />;
  }
  return <span className="inline-block w-2 h-2 rounded-full bg-muted-foreground/30 shrink-0 mt-0.5" />;
}

function RetryHistorySection({ logId: _logId }: { logId: number }) {
  return (
    <div className="px-2 pt-3">
      <div className="flex items-center gap-1.5 mb-2">
        <ListOrdered className="w-3.5 h-3.5 text-muted-foreground/60" />
        <p className="text-xs text-muted-foreground/60 uppercase tracking-wider font-medium">Attempt History</p>
      </div>
      <p className="text-xs text-muted-foreground/50 italic px-1">No per-attempt records yet — history is recorded for new deliveries going forward.</p>
    </div>
  );
}

const RETRY_COOLDOWN_DEFAULT = 30;
const COOLDOWN_STORAGE_PREFIX = "rasokart_retry_cooldown_";

function getCooldownKey(logId: number) {
  return `${COOLDOWN_STORAGE_PREFIX}${logId}`;
}

function readStoredCooldown(logId: number): number | null {
  try {
    const raw = sessionStorage.getItem(getCooldownKey(logId));
    if (!raw) return null;
    const until = parseInt(raw, 10);
    if (!Number.isFinite(until) || until <= Date.now()) {
      sessionStorage.removeItem(getCooldownKey(logId));
      return null;
    }
    return until;
  } catch {
    return null;
  }
}

function writeStoredCooldown(logId: number, until: number) {
  try {
    sessionStorage.setItem(getCooldownKey(logId), String(until));
  } catch {
    // ignore storage errors
  }
}

function clearStoredCooldown(logId: number) {
  try {
    sessionStorage.removeItem(getCooldownKey(logId));
  } catch {
    // ignore storage errors
  }
}

function CallbackRow({ log, activeQrFilter, onFilterByQr }: { log: any; activeQrFilter: number | undefined; onFilterByQr: (id: number) => void }) {
  const [open, setOpen] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(() => readStoredCooldown(log.id));
  const [secondsLeft, setSecondsLeft] = useState(() => {
    const stored = readStoredCooldown(log.id);
    return stored != null ? Math.ceil((stored - Date.now()) / 1000) : 0;
  });
  const queryClient = useQueryClient();

  useEffect(() => {
    if (cooldownUntil == null) return;
    const tick = () => {
      const remaining = Math.ceil((cooldownUntil - Date.now()) / 1000);
      if (remaining <= 0) {
        setSecondsLeft(0);
        setCooldownUntil(null);
        clearStoredCooldown(log.id);
      } else {
        setSecondsLeft(remaining);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [cooldownUntil, log.id]);

  const startCooldown = (seconds: number) => {
    const until = Date.now() + seconds * 1000;
    writeStoredCooldown(log.id, until);
    setCooldownUntil(until);
    setSecondsLeft(seconds);
  };

  const { mutate: retryWebhook, isPending: isRetrying } = useRetryWebhookLog({
    mutation: {
      onSuccess: () => {
        setRetryError(null);
        startCooldown(RETRY_COOLDOWN_DEFAULT);
        queryClient.invalidateQueries({ queryKey: getListCallbackLogsQueryKey() });
      },
      onError: (err: any) => {
        const msg = (err?.data as any)?.error ?? err?.message ?? "Retry failed";
        setRetryError(msg);
        const bodyRetryAfter = (err?.data as any)?.retryAfter;
        const headerRetryAfter = Number(err?.headers?.get?.("retry-after"));
        const retryAfter: number =
          (Number.isFinite(bodyRetryAfter) && bodyRetryAfter > 0 ? bodyRetryAfter : null) ??
          (Number.isFinite(headerRetryAfter) && headerRetryAfter > 0 ? headerRetryAfter : null) ??
          RETRY_COOLDOWN_DEFAULT;
        startCooldown(retryAfter);
      },
    },
  });

  const isCoolingDown = secondsLeft > 0;
  const canRetry = log.status === "failed" || log.status === "pending_retry";


  const tryParse = (s: string | null) => {
    if (!s) return null;
    try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; }
  };
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <TableRow className="cursor-pointer" onClick={() => setOpen(!open)}>
        <TableCell>{open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</TableCell>
        <TableCell>
          {log.qrCodeId ? (
            <span className="font-mono text-xs text-blue-400">QR #{log.qrCodeId}</span>
          ) : (
            <span className="text-muted-foreground text-xs">—</span>
          )}
        </TableCell>
        <TableCell><StatusBadge status={log.status} /></TableCell>
        <TableCell><span className={`font-mono text-sm ${log.httpStatus === 200 ? "text-emerald-500" : "text-rose-500"}`}>{log.httpStatus || "—"}</span></TableCell>
        <TableCell className="text-center">{log.attempts}</TableCell>
        <TableCell><SignatureVerifiedBadge value={log.signatureVerified} /></TableCell>
        <TableCell className="text-sm text-muted-foreground">{format(new Date(log.createdAt), "MMM d, HH:mm")}</TableCell>
      </TableRow>
      <CollapsibleContent asChild>
        <TableRow>
          <TableCell colSpan={7} className="bg-muted/20 pb-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 px-2 pt-2">
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider">Request</p>
                <pre className="text-xs bg-background/50 rounded p-3 overflow-x-auto border border-border/50 whitespace-pre-wrap">{tryParse(log.requestBody) || "—"}</pre>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider">Response</p>
                <pre className="text-xs bg-background/50 rounded p-3 overflow-x-auto border border-border/50 whitespace-pre-wrap">{tryParse(log.responseBody) || "—"}</pre>
              </div>
            </div>
            {open && <RetryHistorySection logId={log.id} />}
            {log.qrCodeId && activeQrFilter !== log.qrCodeId && (
              <div className="px-2 pt-3">
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); onFilterByQr(log.qrCodeId); }}
                  className="inline-flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors underline-offset-2 hover:underline"
                >
                  <QrCode className="w-3.5 h-3.5 shrink-0" />
                  Show all for QR #{log.qrCodeId}
                </button>
              </div>
            )}
            {canRetry && (
              <div className="flex items-center gap-3 mt-3 px-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 border-amber-500/40 text-amber-400 hover:bg-amber-500/10 hover:text-amber-300 hover:border-amber-500/60 disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={isRetrying || isCoolingDown}
                  onClick={e => {
                    e.stopPropagation();
                    setRetryError(null);
                    retryWebhook({ id: log.id });
                  }}
                >
                  {isRetrying ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : isCoolingDown ? (
                    <Clock className="w-3.5 h-3.5" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5" />
                  )}
                  {isRetrying ? "Retrying…" : isCoolingDown ? `Retry in ${secondsLeft}s…` : "Retry now"}
                </Button>
                {retryError && (
                  <span className="text-xs text-rose-400">{retryError}</span>
                )}
              </div>
            )}
          </TableCell>
        </TableRow>
      </CollapsibleContent>
    </Collapsible>
  );
}

const SIG_WARN_THRESHOLD = 5;
const SIG_WARN_KEY = "rasokart_sig_warn_dismissed_until";
const SIG_WARN_TTL_MS = 24 * 60 * 60 * 1000;

export const SIG_VERIFIED_KEY = "rasokart_sig_verified";
const SIG_VERIFIED_THRESHOLD = 3;

interface SigWarnDismissal {
  dismissedUntil: number;
  dismissedAt: number;
}

function readSigWarnDismissal(): SigWarnDismissal | null {
  try {
    const val = localStorage.getItem(SIG_WARN_KEY);
    if (!val) return null;
    return JSON.parse(val) as SigWarnDismissal;
  } catch {
    return null;
  }
}

function isSigWarnStillDismissed(dismissal: SigWarnDismissal, recentLogs: any[]): boolean {
  if (Date.now() >= dismissal.dismissedUntil) return false;
  const hasNewFailure = recentLogs.some(
    l => l.signatureVerified === false && new Date(l.createdAt).getTime() > dismissal.dismissedAt
  );
  if (hasNewFailure) return false;
  return true;
}

function writeSigWarnDismissal() {
  try {
    const now = Date.now();
    const dismissal: SigWarnDismissal = {
      dismissedUntil: now + SIG_WARN_TTL_MS,
      dismissedAt: now,
    };
    localStorage.setItem(SIG_WARN_KEY, JSON.stringify(dismissal));
  } catch {
    // ignore storage errors
  }
}

export default function MerchantCallbacks() {
  const search = useSearch();
  const [, setLocation] = useLocation();

  const params = new URLSearchParams(search);
  const status = params.get("status") ?? "all";
  const sigVerified = params.get("sig") ?? "all";
  const qrCodeId = (() => { const v = params.get("qr"); const n = v ? parseInt(v) : NaN; return !isNaN(n) && n > 0 ? n : undefined; })();
  const page = (() => { const v = params.get("page"); const n = v ? parseInt(v) : NaN; return !isNaN(n) && n > 0 ? n : 1; })();

  const [qrCodeIdInput, setQrCodeIdInput] = useState(() => qrCodeId != null ? String(qrCodeId) : "");
  const [sigWarnDismissed, setSigWarnDismissed] = useState(() => {
    const d = readSigWarnDismissal();
    return d != null && Date.now() < d.dismissedUntil;
  });

  const updateParams = useCallback((patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(search);
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === "" || (k === "status" && v === "all") || (k === "sig" && v === "all") || (k === "page" && v === "1")) {
        next.delete(k);
      } else {
        next.set(k, v);
      }
    }
    const qs = next.toString();
    setLocation(qs ? `?${qs}` : "?", { replace: true });
  }, [search, setLocation]);

  const setStatus = (v: string) => updateParams({ status: v, page: "1" });
  const setSigVerified = (v: string) => updateParams({ sig: v, page: "1" });
  const setPage = (fn: (p: number) => number) => updateParams({ page: String(fn(page)) });

  const { data: stats } = useGetCallbackStats();
  const failureCount = stats?.signatureFailures24h ?? 0;

  const sigFilter = sigVerified !== "all" ? sigVerified : undefined;

  const { data, isLoading } = useListCallbackLogs({
    status: status as any,
    qrCodeId,
    signatureVerified: sigFilter as any,
    page,
    limit: 20,
  });

  const recentLogs = data?.data ?? [];
  const recentN = recentLogs.slice(0, SIG_WARN_THRESHOLD);
  const allRecentFailed =
    recentN.length >= SIG_WARN_THRESHOLD &&
    recentN.every(l => l.signatureVerified === false);

  const verifiedN = recentLogs.slice(0, SIG_VERIFIED_THRESHOLD);
  const allRecentVerified =
    verifiedN.length >= SIG_VERIFIED_THRESHOLD &&
    verifiedN.every(l => l.signatureVerified === true);

  useEffect(() => {
    if (isLoading) return;
    if (allRecentVerified) {
      try { localStorage.setItem(SIG_VERIFIED_KEY, String(Date.now())); } catch { /* ignore */ }
    } else if (recentLogs.some(l => l.signatureVerified === false)) {
      try { localStorage.removeItem(SIG_VERIFIED_KEY); } catch { /* ignore */ }
    }
  }, [allRecentVerified, isLoading, recentLogs]);

  const showSigWarning = (() => {
    if (!allRecentFailed) return false;
    if (!sigWarnDismissed) return true;
    const d = readSigWarnDismissal();
    if (!d) return true;
    return !isSigWarnStillDismissed(d, recentLogs);
  })();

  const applyQrFilter = () => {
    const parsed = parseInt(qrCodeIdInput.trim());
    if (!qrCodeIdInput.trim()) {
      updateParams({ qr: undefined, page: "1" });
    } else if (!isNaN(parsed) && parsed > 0) {
      updateParams({ qr: String(parsed), page: "1" });
    }
  };

  const clearQrFilter = () => {
    setQrCodeIdInput("");
    updateParams({ qr: undefined, page: "1" });
  };

  const applyQrFilterById = (id: number) => {
    setQrCodeIdInput(String(id));
    updateParams({ qr: String(id), page: "1" });
  };

  const applySigFailureFilter = () => {
    updateParams({ sig: "failed", page: "1" });
  };

  const clearSigFilter = () => {
    updateParams({ sig: undefined, page: "1" });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Callback Logs</h1>
          <p className="text-muted-foreground mt-1">Webhook delivery history for your endpoint</p>
        </div>
      </div>

      {showSigWarning && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3">
          <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-amber-300">
              Recent callbacks have failing signature checks — your signing secret may be misconfigured
            </p>
            <p className="text-xs text-amber-400/70 mt-0.5">
              The last {SIG_WARN_THRESHOLD} logged callbacks all failed signature verification. Check that your webhook signing secret matches the one configured on your server.{" "}
              <Link
                href="/merchant/webhook"
                className="underline text-amber-400 hover:text-amber-300 transition-colors"
              >
                Check webhook settings →
              </Link>
            </p>
          </div>
          <button
            type="button"
            aria-label="Dismiss warning"
            onClick={() => { writeSigWarnDismissal(); setSigWarnDismissed(true); }}
            className="shrink-0 text-amber-400/60 hover:text-amber-300 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {failureCount > 0 && (
        <div
          role="button"
          tabIndex={0}
          onClick={sigFilter === "failed" ? clearSigFilter : applySigFailureFilter}
          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); (sigFilter === "failed" ? clearSigFilter : applySigFailureFilter)(); } }}
          className={`flex items-center gap-3 rounded-lg border px-4 py-3 transition-colors cursor-pointer ${
            sigFilter === "failed"
              ? "border-rose-500/50 bg-rose-500/15"
              : "border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/15"
          }`}
        >
          <ShieldAlert className="w-5 h-5 text-rose-500 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-rose-400">
              {failureCount} signature verification {failureCount === 1 ? "failure" : "failures"} in the last 24 hours
            </p>
            <p className="text-xs text-rose-400/70 mt-0.5">
              {sigFilter === "failed"
                ? "Showing filtered results — click to clear filter"
                : "Your callback secret may be misconfigured — click to filter these logs"}{" "}
              <Link
                href="/merchant/webhook"
                onClick={e => e.stopPropagation()}
                className="underline text-rose-400 hover:text-rose-300 transition-colors"
              >
                Check webhook settings →
              </Link>
            </p>
          </div>
          {sigFilter === "failed" ? (
            <X className="w-4 h-4 text-rose-400 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-rose-400/70 shrink-0" />
          )}
        </div>
      )}

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
            <Select value={status} onValueChange={v => setStatus(v)}>
              <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="success">Success</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sigVerified} onValueChange={v => setSigVerified(v)}>
              <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Signatures</SelectItem>
                <SelectItem value="verified">Sig. Verified</SelectItem>
                <SelectItem value="failed">Sig. Failed</SelectItem>
                <SelectItem value="none">No Signature</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2 flex-1 min-w-[180px]">
              <div className="relative flex-1">
                <QrCode className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  className="pl-9 pr-3 h-9"
                  placeholder="Filter by QR code ID…"
                  value={qrCodeIdInput}
                  onChange={e => setQrCodeIdInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && applyQrFilter()}
                />
              </div>
              {qrCodeId ? (
                <Button variant="ghost" size="sm" className="h-9 px-2 text-muted-foreground" onClick={clearQrFilter}>
                  <X className="w-3.5 h-3.5" />
                </Button>
              ) : (
                <Button variant="outline" size="sm" className="h-9" onClick={applyQrFilter}>
                  Filter
                </Button>
              )}
            </div>
            {qrCodeId && (
              <div className="flex items-center gap-1.5 text-xs text-blue-400 bg-blue-500/10 border border-blue-500/20 rounded px-2.5 py-1">
                <QrCode className="w-3 h-3" />
                <span>QR #{qrCodeId}</span>
              </div>
            )}
            {sigFilter === "failed" && (
              <div className="flex items-center gap-1.5 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded px-2.5 py-1">
                <ShieldAlert className="w-3 h-3" />
                <span>Sig. failures only</span>
                <button type="button" onClick={clearSigFilter} className="ml-0.5 hover:text-rose-300">
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
            {sigFilter === "verified" && (
              <div className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded px-2.5 py-1">
                <ShieldAlert className="w-3 h-3" />
                <span>Sig. verified only</span>
                <button type="button" onClick={clearSigFilter} className="ml-0.5 hover:text-emerald-300">
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
            {sigFilter === "none" && (
              <div className="flex items-center gap-1.5 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded px-2.5 py-1">
                <ShieldAlert className="w-3 h-3" />
                <span>No signature</span>
                <button type="button" onClick={clearSigFilter} className="ml-0.5 hover:text-amber-300">
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>QR Code</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>HTTP</TableHead>
                <TableHead className="text-center">Attempts</TableHead>
                <TableHead>Sig. Verified</TableHead>
                <TableHead>Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>{Array.from({ length: 7 }).map((_, j) => <TableCell key={j}><div className="h-4 bg-muted/50 rounded animate-pulse" /></TableCell>)}</TableRow>
              )) : data?.data?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-10">
                    {sigFilter === "failed"
                      ? "No signature failure logs found"
                      : sigFilter === "verified"
                      ? "No verified-signature logs found"
                      : sigFilter === "none"
                      ? "No unsigned callback logs found"
                      : qrCodeId ? `No webhook logs for QR #${qrCodeId}` : "No callback logs yet"}
                  </TableCell>
                </TableRow>
              ) : data?.data?.map(log => <CallbackRow key={log.id} log={log} activeQrFilter={qrCodeId} onFilterByQr={applyQrFilterById} />)}
            </TableBody>
          </Table>
          </div>
        </CardContent>
      </Card>
      {data && data.total > 20 && (
        <div className="flex justify-between">
          <span className="text-sm text-muted-foreground">{data.total} total</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p-1))} disabled={page === 1}>Previous</Button>
            <Button variant="outline" size="sm" onClick={() => setPage(p => p+1)} disabled={page * 20 >= data.total}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}
