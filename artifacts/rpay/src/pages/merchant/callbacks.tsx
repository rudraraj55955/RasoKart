import { useState } from "react";
import { Link } from "wouter";
import { useListCallbackLogs, useGetCallbackStats } from "@workspace/api-client-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { AlertTriangle, ChevronDown, ChevronRight, QrCode, ShieldAlert, X } from "lucide-react";
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

function CallbackRow({ log }: { log: any }) {
  const [open, setOpen] = useState(false);
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
          </TableCell>
        </TableRow>
      </CollapsibleContent>
    </Collapsible>
  );
}

const SIG_WARN_THRESHOLD = 5;
const SIG_WARN_KEY = "rasokart_sig_warn_dismissed_until";
const SIG_WARN_TTL_MS = 24 * 60 * 60 * 1000;

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
  const [status, setStatus] = useState("all");
  const [sigVerified, setSigVerified] = useState("all");
  const [qrCodeIdInput, setQrCodeIdInput] = useState("");
  const [qrCodeId, setQrCodeId] = useState<number | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [sigWarnDismissed, setSigWarnDismissed] = useState(() => {
    const d = readSigWarnDismissal();
    return d != null && Date.now() < d.dismissedUntil;
  });

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
      setQrCodeId(undefined);
    } else if (!isNaN(parsed) && parsed > 0) {
      setQrCodeId(parsed);
    }
    setPage(1);
  };

  const clearQrFilter = () => {
    setQrCodeIdInput("");
    setQrCodeId(undefined);
    setPage(1);
  };

  const applySigFailureFilter = () => {
    setSigVerified("failed");
    setPage(1);
  };

  const clearSigFilter = () => {
    setSigVerified("all");
    setPage(1);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Callback Logs</h1>
        <p className="text-muted-foreground mt-1">Webhook delivery history for your endpoint</p>
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
            <Select value={status} onValueChange={v => { setStatus(v); setPage(1); }}>
              <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="success">Success</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sigVerified} onValueChange={v => { setSigVerified(v); setPage(1); }}>
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
              ) : data?.data?.map(log => <CallbackRow key={log.id} log={log} />)}
            </TableBody>
          </Table>
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
