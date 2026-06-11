import { useState, useRef, useEffect } from "react";
import { useListCallbackLogs } from "@workspace/api-client-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Shield,
  Search,
  FileDown,
  Loader2,
  CalendarRange,
  X,
  CheckCircle2,
  XCircle,
  ShieldCheck,
  ShieldX,
  ShieldOff,
  Hash,
} from "lucide-react";
import { format, subDays, startOfMonth, endOfMonth, subMonths, parseISO, isAfter, isBefore, startOfDay, endOfDay } from "date-fns";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const DATE_PRESETS = [
  {
    label: "Last 7 days",
    getRange: () => {
      const to = new Date();
      const from = subDays(to, 6);
      return { from: format(from, "yyyy-MM-dd"), to: format(to, "yyyy-MM-dd") };
    },
  },
  {
    label: "Last 30 days",
    getRange: () => {
      const to = new Date();
      const from = subDays(to, 29);
      return { from: format(from, "yyyy-MM-dd"), to: format(to, "yyyy-MM-dd") };
    },
  },
  {
    label: "This month",
    getRange: () => {
      const now = new Date();
      return {
        from: format(startOfMonth(now), "yyyy-MM-dd"),
        to: format(endOfMonth(now), "yyyy-MM-dd"),
      };
    },
  },
  {
    label: "Last month",
    getRange: () => {
      const prev = subMonths(new Date(), 1);
      return {
        from: format(startOfMonth(prev), "yyyy-MM-dd"),
        to: format(endOfMonth(prev), "yyyy-MM-dd"),
      };
    },
  },
];

interface CustomDatePreset {
  id: string;
  name: string;
  from: string;
  to: string;
}

const CUSTOM_DATE_PRESETS_KEY = "rasokart_custom_date_presets_security";

function loadCustomDatePresets(): CustomDatePreset[] {
  try {
    const raw = localStorage.getItem(CUSTOM_DATE_PRESETS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as CustomDatePreset[];
  } catch {
    return [];
  }
}

function storeCustomDatePresets(presets: CustomDatePreset[]): void {
  localStorage.setItem(CUSTOM_DATE_PRESETS_KEY, JSON.stringify(presets));
}

function SignatureVerifiedBadge({ value }: { value: boolean | null | undefined }) {
  if (value === true) {
    return (
      <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 gap-1 text-xs">
        <ShieldCheck className="w-3 h-3" />
        Verified
      </Badge>
    );
  }
  if (value === false) {
    return (
      <Badge className="bg-rose-500/10 text-rose-400 border-rose-500/20 gap-1 text-xs">
        <ShieldX className="w-3 h-3" />
        Failed
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground gap-1 text-xs">
      <ShieldOff className="w-3 h-3" />
      No secret
    </Badge>
  );
}

function buildCsvText(data: any[]): string {
  const rows = [["ID", "Event Type", "Status", "HTTP Status", "Signature", "Attempts", "QR Code ID", "Transaction ID", "Date"]];
  data.forEach(log =>
    rows.push([
      String(log.id),
      log.eventType ?? "",
      log.status,
      log.httpStatus != null ? String(log.httpStatus) : "",
      log.signatureVerified === true ? "verified" : log.signatureVerified === false ? "failed" : "no_secret",
      String(log.attempts),
      log.qrCodeId != null ? String(log.qrCodeId) : "",
      log.transactionId != null ? String(log.transactionId) : "",
      log.createdAt,
    ])
  );
  return rows.map(r => r.map(v => `"${v}"`).join(",")).join("\n");
}

export default function MerchantSecurity() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [sigFilter, setSigFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [lastExportCount, setLastExportCount] = useState<number | null>(null);

  const [customDatePresets, setCustomDatePresets] = useState<CustomDatePreset[]>(() => loadCustomDatePresets());
  const [showSaveDatePreset, setShowSaveDatePreset] = useState(false);
  const [saveDatePresetName, setSaveDatePresetName] = useState("");
  const [saveDatePresetNameError, setSaveDatePresetNameError] = useState("");
  const saveDatePresetNameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showSaveDatePreset) {
      setTimeout(() => saveDatePresetNameRef.current?.focus(), 50);
    }
  }, [showSaveDatePreset]);

  const applyPreset = (preset: (typeof DATE_PRESETS)[number]) => {
    const { from, to } = preset.getRange();
    setDateFrom(from);
    setDateTo(to);
    setPage(1);
    setShowSaveDatePreset(false);
  };

  const isPresetActive = (preset: (typeof DATE_PRESETS)[number]) => {
    const { from, to } = preset.getRange();
    return dateFrom === from && dateTo === to;
  };

  const applyCustomDatePreset = (preset: CustomDatePreset) => {
    setDateFrom(preset.from);
    setDateTo(preset.to);
    setPage(1);
    setShowSaveDatePreset(false);
  };

  const isCustomDatePresetActive = (preset: CustomDatePreset) =>
    dateFrom === preset.from && dateTo === preset.to;

  const openSaveDatePreset = () => {
    setSaveDatePresetName("");
    setSaveDatePresetNameError("");
    setShowSaveDatePreset(true);
  };

  const confirmSaveDatePreset = () => {
    const trimmed = saveDatePresetName.trim();
    if (!trimmed) {
      setSaveDatePresetNameError("Please enter a name for this preset.");
      saveDatePresetNameRef.current?.focus();
      return;
    }
    const alreadyExists = customDatePresets.some(
      p => p.name.toLowerCase() === trimmed.toLowerCase()
    );
    if (alreadyExists) {
      setSaveDatePresetNameError("A preset with this name already exists.");
      saveDatePresetNameRef.current?.focus();
      return;
    }
    const newPreset: CustomDatePreset = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: trimmed,
      from: dateFrom,
      to: dateTo,
    };
    const updated = [...customDatePresets, newPreset];
    setCustomDatePresets(updated);
    storeCustomDatePresets(updated);
    setShowSaveDatePreset(false);
    setSaveDatePresetName("");
    setSaveDatePresetNameError("");
  };

  const cancelSaveDatePreset = () => {
    setShowSaveDatePreset(false);
    setSaveDatePresetName("");
    setSaveDatePresetNameError("");
  };

  const deleteCustomDatePreset = (id: string) => {
    const updated = customDatePresets.filter(p => p.id !== id);
    setCustomDatePresets(updated);
    storeCustomDatePresets(updated);
  };

  const isCustomDateRangeEntered = !!(dateFrom && dateTo);
  const isBuiltInPresetActive = DATE_PRESETS.some(p => {
    const { from, to } = p.getRange();
    return dateFrom === from && dateTo === to;
  });
  const isCustomDateAlreadySaved = customDatePresets.some(p => p.from === dateFrom && p.to === dateTo);
  const canSaveDatePreset = isCustomDateRangeEntered && !isBuiltInPresetActive && !isCustomDateAlreadySaved;

  const { data: rawData, isLoading } = useListCallbackLogs({
    status: status === "all" ? undefined : (status as any),
    signatureVerified: sigFilter === "all" ? undefined : (sigFilter as any),
    limit: 200,
    page: 1,
  });

  const allLogs = rawData?.data ?? [];

  const filteredLogs = allLogs.filter(log => {
    if (search) {
      const q = search.toLowerCase();
      const matchId = String(log.id).includes(q);
      const matchEvent = (log.eventType ?? "").toLowerCase().includes(q);
      const matchQr = log.qrCodeId != null ? String(log.qrCodeId).includes(q) : false;
      if (!matchId && !matchEvent && !matchQr) return false;
    }
    if (dateFrom) {
      const from = startOfDay(parseISO(dateFrom));
      if (isBefore(parseISO(log.createdAt), from)) return false;
    }
    if (dateTo) {
      const to = endOfDay(parseISO(dateTo));
      if (isAfter(parseISO(log.createdAt), to)) return false;
    }
    return true;
  });

  const PAGE_SIZE = 20;
  const totalFiltered = filteredLogs.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE));
  const pageSlice = filteredLogs.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const successCount = filteredLogs.filter(l => l.status === "success").length;
  const failedCount = filteredLogs.filter(l => l.status === "failed").length;
  const verifiedCount = filteredLogs.filter(l => l.signatureVerified === true).length;
  const sigFailedCount = filteredLogs.filter(l => l.signatureVerified === false).length;

  const anyFilterActive = !!(search || status !== "all" || sigFilter !== "all" || dateFrom || dateTo);

  const clearFilters = () => {
    setSearch("");
    setStatus("all");
    setSigFilter("all");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  };

  function handleExportCsv() {
    if (!filteredLogs.length) return;
    setExporting(true);
    try {
      const csv = buildCsvText(filteredLogs);
      const lines = csv.split("\n").filter(l => l.trim() !== "");
      const rowCount = Math.max(0, lines.length - 1);
      setLastExportCount(rowCount);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      a.download = `security-activity-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      toast.success(`Exported ${rowCount} record${rowCount !== 1 ? "s" : ""}`);
    } catch {
      toast.error("Export failed");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Shield className="w-7 h-7 text-violet-400" />
            Security Activity
          </h1>
          <p className="text-muted-foreground mt-1">Incoming callback events, signature verification, and delivery status</p>
        </div>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportCsv}
                disabled={exporting || !filteredLogs.length}
                className="border-sky-500/30 text-sky-400 hover:bg-sky-500/10 hover:text-sky-300 hover:border-sky-500/50"
              >
                {exporting
                  ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  : <FileDown className="w-3.5 h-3.5 mr-1.5" />}
                {exporting ? "Exporting…" : "Export CSV"}
              </Button>
            </TooltipTrigger>
            {lastExportCount != null && !exporting && (
              <TooltipContent side="bottom">
                Last export: {lastExportCount.toLocaleString()} row{lastExportCount !== 1 ? "s" : ""}
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* Filter summary bar */}
      {anyFilterActive && (
        <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <span className="text-xs font-semibold text-violet-400 uppercase tracking-wider mr-1">Filter results</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              className="ml-auto h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 gap-1.5"
            >
              <X className="w-3 h-3" />
              Clear filters
            </Button>
            <div className="flex items-center gap-1.5 text-sm">
              <Hash className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="font-semibold text-foreground">{totalFiltered.toLocaleString()}</span>
              <span className="text-muted-foreground">events</span>
            </div>
            <div className="flex items-center gap-1.5 text-sm">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span className="font-semibold text-emerald-400">{successCount.toLocaleString()}</span>
              <span className="text-muted-foreground">success</span>
            </div>
            <div className="flex items-center gap-1.5 text-sm">
              <XCircle className="w-3.5 h-3.5 text-rose-400" />
              <span className="font-semibold text-rose-400">{failedCount.toLocaleString()}</span>
              <span className="text-muted-foreground">failed</span>
            </div>
            <div className="flex items-center gap-1.5 text-sm">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span className="font-semibold text-emerald-400">{verifiedCount.toLocaleString()}</span>
              <span className="text-muted-foreground">sig verified</span>
            </div>
            {sigFailedCount > 0 && (
              <div className="flex items-center gap-1.5 text-sm">
                <ShieldX className="w-3.5 h-3.5 text-rose-400" />
                <span className="font-semibold text-rose-400">{sigFailedCount.toLocaleString()}</span>
                <span className="text-muted-foreground">sig failed</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Filters */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search by event type or QR code ID..."
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
              />
            </div>
            <Select value={status} onValueChange={v => { setStatus(v); setPage(1); }}>
              <SelectTrigger className="w-[160px]"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="success">Success</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="pending_retry">Pending Retry</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sigFilter} onValueChange={v => { setSigFilter(v); setPage(1); }}>
              <SelectTrigger className="w-[170px]"><SelectValue placeholder="Signature" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Signatures</SelectItem>
                <SelectItem value="verified">Verified</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="none">No Secret</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Date range preset row */}
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-xs text-muted-foreground font-medium mr-1">Date range:</span>
              {DATE_PRESETS.map(preset => (
                <Button
                  key={preset.label}
                  variant={isPresetActive(preset) ? "secondary" : "outline"}
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => applyPreset(preset)}
                >
                  {preset.label}
                </Button>
              ))}
              {customDatePresets.map(preset => (
                <span
                  key={preset.id}
                  className={`group inline-flex items-center gap-1 rounded-md border text-xs font-medium transition-colors ${
                    isCustomDatePresetActive(preset)
                      ? "border-primary/60 bg-primary/15 text-primary"
                      : "border-sky-500/30 bg-sky-500/8 text-sky-300 hover:border-sky-500/60"
                  }`}
                >
                  <button
                    onClick={() => applyCustomDatePreset(preset)}
                    className="flex items-center gap-1 h-8 px-2.5 hover:text-sky-100 transition-colors"
                    title={`${preset.from} – ${preset.to}`}
                  >
                    <CalendarRange className="w-3 h-3 shrink-0" />
                    {preset.name}
                  </button>
                  <button
                    onClick={() => deleteCustomDatePreset(preset.id)}
                    className="pr-1.5 rounded-r-md text-sky-400/50 hover:text-rose-400 hover:bg-rose-500/10 transition-colors opacity-0 group-hover:opacity-100 h-8 flex items-center"
                    aria-label={`Remove preset "${preset.name}"`}
                    title="Remove this preset"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
              <div className="flex items-center gap-2 ml-1">
                <Input
                  type="date"
                  className="w-[150px] h-8 text-xs [color-scheme:dark]"
                  value={dateFrom}
                  onChange={e => { setDateFrom(e.target.value); setPage(1); setShowSaveDatePreset(false); }}
                  title="From date"
                />
                <span className="text-muted-foreground text-sm">to</span>
                <Input
                  type="date"
                  className="w-[150px] h-8 text-xs [color-scheme:dark]"
                  value={dateTo}
                  onChange={e => { setDateTo(e.target.value); setPage(1); setShowSaveDatePreset(false); }}
                  title="To date"
                />
                {canSaveDatePreset && !showSaveDatePreset && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs border-sky-500/40 text-sky-300 hover:bg-sky-500/10 hover:text-sky-200"
                    onClick={openSaveDatePreset}
                    title="Save this date range as a quick-access preset"
                  >
                    <CalendarRange className="w-3 h-3 mr-1.5" />
                    Save as preset
                  </Button>
                )}
                {isCustomDateRangeEntered && isCustomDateAlreadySaved && (
                  <span className="inline-flex items-center gap-1 h-8 px-2.5 text-xs text-sky-400/60 border border-sky-500/20 rounded-md">
                    <CalendarRange className="w-3 h-3" />
                    Saved
                  </span>
                )}
              </div>
              {(dateFrom || dateTo) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs text-muted-foreground hover:text-foreground gap-1"
                  onClick={() => { setDateFrom(""); setDateTo(""); setPage(1); setShowSaveDatePreset(false); }}
                >
                  <X className="w-3 h-3" />
                  Clear dates
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">ID</TableHead>
                <TableHead>Event Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>HTTP</TableHead>
                <TableHead>Signature</TableHead>
                <TableHead className="text-center">Attempts</TableHead>
                <TableHead>QR Code</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 8 }).map((_, j) => (
                      <TableCell key={j}><div className="h-4 bg-muted/50 rounded animate-pulse" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : !pageSlice.length ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-12">
                    <div className="flex flex-col items-center gap-2">
                      <Shield className="w-8 h-8 text-muted-foreground/30" />
                      <p>{anyFilterActive ? "No events match your filters" : "No security activity yet"}</p>
                      {anyFilterActive && (
                        <Button variant="ghost" size="sm" onClick={clearFilters} className="text-xs">
                          Clear filters
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                pageSlice.map(log => (
                  <TableRow key={log.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">#{log.id}</TableCell>
                    <TableCell>
                      {log.eventType ? (
                        <span className="font-mono text-xs text-sky-400">{log.eventType}</span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell><StatusBadge status={log.status} /></TableCell>
                    <TableCell>
                      <span className={`font-mono text-sm ${
                        log.httpStatus != null && log.httpStatus >= 200 && log.httpStatus < 300
                          ? "text-emerald-500"
                          : log.httpStatus != null
                          ? "text-rose-500"
                          : "text-muted-foreground"
                      }`}>
                        {log.httpStatus ?? "—"}
                      </span>
                    </TableCell>
                    <TableCell><SignatureVerifiedBadge value={log.signatureVerified} /></TableCell>
                    <TableCell className="text-center">
                      <span className={`text-sm font-medium ${(log.attempts ?? 0) > 1 ? "text-amber-400" : "text-foreground"}`}>
                        {log.attempts ?? 0}
                      </span>
                    </TableCell>
                    <TableCell>
                      {log.qrCodeId != null ? (
                        <span className="font-mono text-xs text-blue-400">QR #{log.qrCodeId}</span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {format(parseISO(log.createdAt), "MMM d, HH:mm")}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, totalFiltered)} of {totalFiltered}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
              Previous
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Save preset dialog */}
      <Dialog open={showSaveDatePreset} onOpenChange={open => { if (!open) cancelSaveDatePreset(); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarRange className="w-5 h-5 text-sky-400" />
              Save Date Preset
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Save <span className="text-foreground font-medium">{dateFrom}</span> → <span className="text-foreground font-medium">{dateTo}</span> as a quick-access preset.
            </p>
            <div className="space-y-1">
              <Label htmlFor="preset-name" className="text-xs text-muted-foreground uppercase tracking-wider">Preset name</Label>
              <Input
                id="preset-name"
                ref={saveDatePresetNameRef}
                placeholder="e.g. Last quarter"
                value={saveDatePresetName}
                onChange={e => { setSaveDatePresetName(e.target.value); setSaveDatePresetNameError(""); }}
                onKeyDown={e => { if (e.key === "Enter") confirmSaveDatePreset(); }}
                className={saveDatePresetNameError ? "border-rose-500/50" : ""}
              />
              {saveDatePresetNameError && (
                <p className="text-xs text-rose-400">{saveDatePresetNameError}</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={cancelSaveDatePreset}>Cancel</Button>
            <Button size="sm" onClick={confirmSaveDatePreset}>Save preset</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
