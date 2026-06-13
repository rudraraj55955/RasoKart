import { useState, useCallback, useMemo } from "react";
import { useSearch, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetTransactionReport,
  useGetSettlementReport,
  useListMerchants,
  useListMerchantReportSchedules,
  useUpsertAdminMerchantReportSchedule,
  useDeleteAdminMerchantReportSchedule,
  useSendAdminMerchantReportNow,
  useGetAdminMerchantReportScheduleHistory,
  useSendAllOverdueReports,
  useReenableAdminMerchantReportSchedule,
  getListMerchantReportSchedulesQueryOptions,
  useGetAdminReportDeliveryHistory,
  getGetAdminReportDeliveryHistoryQueryKey,
  previewAdminMerchantReportScheduleEmail,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { FormatBadge } from "@/components/ui/format-badge";
import { FrequencyBadge } from "@/components/ui/frequency-badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  FileText,
  Download,
  Loader2,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  XCircle,
  Clock,
  FileSpreadsheet,
  CalendarRange,
  Filter,
  BarChart3,
  Store,
  QrCode,
  Building2,
  Link2,
  Coins,
  Banknote,
  Hash,
  Wallet,
  TrendingUp,
  CalendarClock,
  Send,
  Trash2,
  ToggleLeft,
  ToggleRight,
  Search,
  CalendarDays,
  X,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  History,
  CheckCircle,
  AlertCircle,
  AlertTriangle,
  PauseCircle,
  RotateCcw,
  Info,
  Eye,
  Mail,
} from "lucide-react";
import { format, formatDistanceToNow, subDays, startOfMonth, endOfMonth, subMonths, eachDayOfInterval, parseISO } from "date-fns";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
} from "recharts";
import { toast } from "sonner";

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
      return { from: format(startOfMonth(now), "yyyy-MM-dd"), to: format(endOfMonth(now), "yyyy-MM-dd") };
    },
  },
  {
    label: "Last month",
    getRange: () => {
      const now = new Date();
      const prev = subMonths(now, 1);
      return { from: format(startOfMonth(prev), "yyyy-MM-dd"), to: format(endOfMonth(prev), "yyyy-MM-dd") };
    },
  },
];

const PROVIDERS = [
  { value: "phonepe", label: "PhonePe" },
  { value: "paytm", label: "Paytm" },
  { value: "bharatpe", label: "BharatPe" },
  { value: "yono_sbi", label: "YONO SBI" },
  { value: "hdfc_smarthub", label: "HDFC SmartHub" },
  { value: "upi_id", label: "UPI ID" },
];

function fmt(amount: number) {
  return `₹${amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function settlementBadgeColor(s: string) {
  if (s === "paid") return "text-emerald-400";
  if (s === "approved" || s === "processing") return "text-amber-400";
  return "text-muted-foreground";
}

function settlementStatusColor(s: string) {
  if (s === "paid") return "text-emerald-400";
  if (s === "approved") return "text-sky-400";
  if (s === "processing") return "text-amber-400";
  if (s === "rejected" || s === "cancelled") return "text-red-400";
  return "text-muted-foreground";
}

function getNextDue(lastSentAt: string | null | undefined, frequency: string, nextRunAt?: string | null): Date | null {
  if (nextRunAt) return new Date(nextRunAt);
  if (!lastSentAt) return null;
  const last = new Date(lastSentAt);
  const days = frequency === "monthly" ? 28 : frequency === "daily" ? 1 : 7;
  return new Date(last.getTime() + days * 24 * 60 * 60 * 1000);
}

function toLocalDatetimeInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function TriggeredByBadge({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-xs text-muted-foreground/50">—</span>;
  if (value === "manual") return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-sky-400 bg-sky-400/10 rounded px-1.5 py-0.5">
      <Send className="w-2.5 h-2.5" />Manual
    </span>
  );
  if (value === "bulk") return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-violet-400 bg-violet-400/10 rounded px-1.5 py-0.5">
      <Send className="w-2.5 h-2.5" />Bulk
    </span>
  );
  if (value === "scheduler") return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-400 bg-amber-400/10 rounded px-1.5 py-0.5">
      <CalendarClock className="w-2.5 h-2.5" />Scheduler
    </span>
  );
  return <span className="text-xs text-muted-foreground capitalize">{value}</span>;
}

type ReportDeliveryLogEntry = {
  id: number;
  attemptedAt: string;
  failureReason?: string | null;
  isAutoPause: boolean;
};

function AutoPausedStatus({
  consecutiveFailures,
  autoPauseAfterFailures,
  recentFailures,
}: {
  consecutiveFailures: number;
  autoPauseAfterFailures: number;
  recentFailures: ReportDeliveryLogEntry[];
}) {
  const lastReason = recentFailures[0]?.failureReason ?? null;

  const trigger = (
    <button
      type="button"
      className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-400 hover:text-amber-300 transition-colors group"
    >
      <PauseCircle className="w-3.5 h-3.5 shrink-0" />
      Auto-paused
      <Info className="w-3 h-3 opacity-50 group-hover:opacity-100 transition-opacity shrink-0" />
    </button>
  );

  if (recentFailures.length === 0) {
    return (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>{trigger}</TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs">
            <p className="font-medium">Auto-paused after {consecutiveFailures} failure{consecutiveFailures !== 1 ? "s" : ""}</p>
            <p className="text-xs opacity-75 mt-0.5">No failure details recorded</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-80 p-0">
        <div className="px-3 py-2 border-b border-border flex items-center gap-2">
          <PauseCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span className="text-xs font-semibold text-amber-400">
            Auto-paused — {consecutiveFailures} of {autoPauseAfterFailures} failure{consecutiveFailures !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="p-2 space-y-1.5">
          {recentFailures.map((log) => (
            <div key={log.id} className="rounded-md bg-muted/40 px-2.5 py-2 space-y-1">
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <XCircle className="w-3 h-3 text-red-400 shrink-0" />
                <span>
                  {format(new Date(log.attemptedAt), "dd MMM yyyy, HH:mm")}
                </span>
                <span className="opacity-60">
                  ({formatDistanceToNow(new Date(log.attemptedAt), { addSuffix: true })})
                </span>
                {log.isAutoPause && (
                  <span className="ml-auto inline-flex items-center gap-0.5 text-amber-400 font-medium">
                    <PauseCircle className="w-2.5 h-2.5" />
                    paused here
                  </span>
                )}
              </div>
              <p className="text-xs text-foreground/80 break-words">
                {log.failureReason ?? <span className="italic text-muted-foreground">No reason recorded</span>}
              </p>
            </div>
          ))}
        </div>
        {lastReason && (
          <div className="px-3 py-1.5 border-t border-border text-[10px] text-muted-foreground">
            Fix the underlying issue before re-enabling to avoid immediate re-pause.
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function ScheduleHistoryDialog({
  merchantId,
  merchantName,
  open,
  onClose,
}: {
  merchantId: number | null;
  merchantName: string;
  open: boolean;
  onClose: () => void;
}) {
  const { data, isLoading } = useGetAdminMerchantReportScheduleHistory(
    merchantId ?? 0,
    { limit: 50 },
    { query: { enabled: open && merchantId != null } as any },
  );
  const logs = data?.logs ?? [];

  function outcomeIcon(log: { success: boolean; isAutoPause: boolean }) {
    if (log.isAutoPause) return <PauseCircle className="w-4 h-4 text-amber-400 shrink-0" />;
    if (log.success) return <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />;
    return <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />;
  }

  function outcomeLabel(log: { success: boolean; isAutoPause: boolean }) {
    if (log.isAutoPause) return <span className="text-amber-400 font-medium">Auto-paused</span>;
    if (log.success) return <span className="text-emerald-400 font-medium">Success</span>;
    return <span className="text-red-400 font-medium">Failed</span>;
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <History className="w-4 h-4 text-primary" />
            Delivery History — {merchantName}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Loading history…</span>
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground gap-2">
              <History className="w-10 h-10 opacity-20" />
              <p className="text-sm">No delivery attempts recorded yet</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Date &amp; Time</TableHead>
                  <TableHead className="text-xs">Triggered By</TableHead>
                  <TableHead className="text-xs">Outcome</TableHead>
                  <TableHead className="text-xs">Failure Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {format(new Date(log.attemptedAt), "dd MMM yyyy, HH:mm")}
                      <span className="ml-1 text-muted-foreground/60">
                        ({formatDistanceToNow(new Date(log.attemptedAt), { addSuffix: true })})
                      </span>
                    </TableCell>
                    <TableCell>
                      <TriggeredByBadge value={(log as any).triggeredBy} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        {outcomeIcon(log)}
                        {outcomeLabel(log)}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-xs">
                      {log.failureReason ?? <span className="opacity-40">—</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        <p className="text-xs text-muted-foreground pt-2 border-t border-border">
          Showing last {logs.length} attempt{logs.length !== 1 ? "s" : ""} (max 50)
        </p>
      </DialogContent>
    </Dialog>
  );
}

function ScheduledReportsPanel() {
  const qc = useQueryClient();
  const { data, isLoading } = useListMerchantReportSchedules();
  const schedules = data?.schedules ?? [];

  const upsert = useUpsertAdminMerchantReportSchedule();
  const del = useDeleteAdminMerchantReportSchedule();
  const sendNow = useSendAdminMerchantReportNow();
  const sendAllOverdue = useSendAllOverdueReports();
  const reenable = useReenableAdminMerchantReportSchedule();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [frequencyFilter, setFrequencyFilter] = useState("all");
  const [formatFilter, setFormatFilter] = useState("all");
  const [historyMerchant, setHistoryMerchant] = useState<{ id: number; name: string } | null>(null);
  const [sendFailures, setSendFailures] = useState<{ merchantId: number; merchantName: string; email: string; reason: string }[] | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  type SortCol = "merchant" | "email" | "frequency" | "format" | "status" | "lastSent" | "nextDue";
  const VALID_SORT_COLS: SortCol[] = ["merchant", "email", "frequency", "format", "status", "lastSent", "nextDue"];

  const searchStr = useSearch();
  const [location, navigate] = useLocation();
  const urlParams = new URLSearchParams(searchStr);
  const rawSort = urlParams.get("sort") ?? "merchant";
  const rawDir = urlParams.get("dir") ?? "asc";
  const sortCol: SortCol = (VALID_SORT_COLS.includes(rawSort as SortCol) ? rawSort : "merchant") as SortCol;
  const sortDir: "asc" | "desc" = rawDir === "desc" ? "desc" : "asc";

  const handleSort = (col: SortCol) => {
    const newDir = col === sortCol ? (sortDir === "asc" ? "desc" : "asc") : "asc";
    const next = new URLSearchParams(searchStr);
    next.set("sort", col);
    next.set("dir", newDir);
    navigate(`${location}?${next.toString()}`);
  };

  const [overrideTarget, setOverrideTarget] = useState<{ merchantId: number; name: string; current: string | null } | null>(null);
  const [overrideValue, setOverrideValue] = useState("");
  const [overrideSaving, setOverrideSaving] = useState(false);
  const [sendingMerchantId, setSendingMerchantId] = useState<number | null>(null);
  const [confirmSend, setConfirmSend] = useState<{ merchantId: number; name: string; email: string; frequency: string; format: string } | null>(null);
  const [emailPreview, setEmailPreview] = useState<{ html: string; subject: string } | null>(null);
  const [emailPreviewLoading, setEmailPreviewLoading] = useState(false);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getListMerchantReportSchedulesQueryOptions().queryKey });
  };

  const handleToggle = async (merchantId: number, current: boolean) => {
    await upsert.mutateAsync({ merchantId, data: { isActive: !current } });
    invalidate();
    toast.success(!current ? "Schedule activated" : "Schedule paused");
  };

  const handleDelete = async (merchantId: number, name: string) => {
    await del.mutateAsync({ merchantId });
    invalidate();
    toast.success(`Schedule removed for ${name}`);
  };

  const handleReenable = async (merchantId: number, name: string) => {
    try {
      await reenable.mutateAsync({ merchantId });
      invalidate();
      toast.success(`Schedule re-enabled for ${name}`);
    } catch {
      toast.error(`Failed to re-enable schedule for ${name}`);
    }
  };

  const handleSendNow = async (merchantId: number, name: string) => {
    setSendingMerchantId(merchantId);
    setConfirmSend(null);
    try {
      const res = await sendNow.mutateAsync({ merchantId });
      toast.success(`Report sent to ${res.to} for ${name}`);
      invalidate();
    } catch {
      toast.error(`Failed to send report for ${name} — check SMTP configuration`);
    } finally {
      setSendingMerchantId(null);
    }
  };

  const handleSendAllOverdue = async () => {
    try {
      const merchantIds = filteredSchedules.map((s) => s.merchantId);
      const res = await sendAllOverdue.mutateAsync({ data: { merchantIds } });
      if (res.total === 0) {
        toast.info("No overdue schedules found");
      } else if (res.failed === 0) {
        toast.success(`Sent ${res.sent} overdue report${res.sent !== 1 ? "s" : ""} successfully`);
      } else if (res.sent === 0) {
        toast.error(`All ${res.failed} overdue report${res.failed !== 1 ? "s" : ""} failed — see details`);
        setSendFailures(res.failures);
      } else {
        toast.warning(`Sent ${res.sent}, failed ${res.failed} of ${res.total} overdue reports`);
        setSendFailures(res.failures);
      }
      invalidate();
    } catch {
      toast.error("Failed to send overdue reports — check SMTP configuration");
    }
  };

  const now = new Date();
  const statusCounts = {
    active: schedules.filter((s) => s.isActive).length,
    paused: schedules.filter((s) => !s.isActive && s.consecutiveFailures === 0).length,
    autoPaused: schedules.filter((s) => !s.isActive && s.consecutiveFailures > 0).length,
  };

  const frequencyCounts = {
    daily: schedules.filter((s) => (s.frequency as string) === "daily").length,
    weekly: schedules.filter((s) => (s.frequency as string) === "weekly").length,
    monthly: schedules.filter((s) => (s.frequency as string) === "monthly").length,
  };

  const formatCounts = {
    xlsx: schedules.filter((s) => s.format === "xlsx").length,
    pdf: schedules.filter((s) => s.format === "pdf").length,
  };

  const filteredSchedules = schedules.filter((s) => {
    const q = search.trim().toLowerCase();
    if (q && !s.businessName.toLowerCase().includes(q) && !s.merchantEmail.toLowerCase().includes(q)) return false;
    if (statusFilter === "active" && !s.isActive) return false;
    if (statusFilter === "paused" && (s.isActive || s.consecutiveFailures > 0)) return false;
    if (statusFilter === "auto-paused" && (s.isActive || s.consecutiveFailures === 0)) return false;
    if (statusFilter === "overdue") {
      if (!s.isActive) return false;
      const nextDue = getNextDue(s.lastSentAt, s.frequency);
      if (!nextDue || nextDue >= now) return false;
    }
    if (frequencyFilter !== "all" && s.frequency !== frequencyFilter) return false;
    if (formatFilter !== "all" && s.format !== formatFilter) return false;
    return true;
  });

  const overdueCount = schedules.filter((s) => {
    if (!s.isActive) return false;
    const nextDue = getNextDue(s.lastSentAt, s.frequency);
    return nextDue != null && nextDue < now;
  }).length;

  const hasFilters = search.trim() !== "" || statusFilter !== "all" || frequencyFilter !== "all" || formatFilter !== "all";

  const freqOrder: Record<string, number> = { daily: 1, weekly: 7, monthly: 28 };

  const sortedSchedules = [...filteredSchedules].sort((a, b) => {
    let cmp = 0;
    if (sortCol === "merchant") {
      cmp = a.businessName.localeCompare(b.businessName);
    } else if (sortCol === "email") {
      cmp = a.merchantEmail.localeCompare(b.merchantEmail);
    } else if (sortCol === "frequency") {
      cmp = (freqOrder[a.frequency] ?? 0) - (freqOrder[b.frequency] ?? 0);
    } else if (sortCol === "format") {
      cmp = a.format.localeCompare(b.format);
    } else if (sortCol === "status") {
      cmp = (a.isActive ? 1 : 0) - (b.isActive ? 1 : 0);
    } else if (sortCol === "lastSent") {
      const ta = a.lastSentAt ? new Date(a.lastSentAt).getTime() : 0;
      const tb = b.lastSentAt ? new Date(b.lastSentAt).getTime() : 0;
      cmp = ta - tb;
    } else if (sortCol === "nextDue") {
      const na = getNextDue(a.lastSentAt, a.frequency);
      const nb = getNextDue(b.lastSentAt, b.frequency);
      cmp = (na?.getTime() ?? 0) - (nb?.getTime() ?? 0);
    }
    return sortDir === "asc" ? cmp : -cmp;
  });

  const openOverrideDialog = (merchantId: number, name: string, currentNextRunAt: string | null) => {
    const defaultValue = currentNextRunAt
      ? toLocalDatetimeInput(new Date(currentNextRunAt))
      : toLocalDatetimeInput(new Date(Date.now() + 60 * 60 * 1000));
    setOverrideTarget({ merchantId, name, current: currentNextRunAt });
    setOverrideValue(defaultValue);
  };

  const clearFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setFrequencyFilter("all");
    setFormatFilter("all");
  };

  const handleOverrideSave = async () => {
    if (!overrideTarget) return;
    setOverrideSaving(true);
    try {
      const isoValue = overrideValue ? new Date(overrideValue).toISOString() : null;
      await upsert.mutateAsync({ merchantId: overrideTarget.merchantId, data: { nextRunAt: isoValue } });
      invalidate();
      toast.success(isoValue
        ? `Next run set to ${format(new Date(isoValue), "dd MMM yyyy, HH:mm")} for ${overrideTarget.name}`
        : `Next run override cleared for ${overrideTarget.name}`);
      setOverrideTarget(null);
    } catch {
      toast.error("Failed to set next run date");
    } finally {
      setOverrideSaving(false);
    }
  };

  const handleOverrideClear = async () => {
    if (!overrideTarget) return;
    setOverrideSaving(true);
    try {
      await upsert.mutateAsync({ merchantId: overrideTarget.merchantId, data: { nextRunAt: null } });
      invalidate();
      toast.success(`Next run override cleared for ${overrideTarget.name}`);
      setOverrideTarget(null);
    } catch {
      toast.error("Failed to clear next run override");
    } finally {
      setOverrideSaving(false);
    }
  };

  const handlePreviewEmail = async () => {
    if (!overrideTarget) return;
    setEmailPreviewLoading(true);
    try {
      const nextRunAt = overrideValue ? new Date(overrideValue).toISOString() : undefined;
      const result = await previewAdminMerchantReportScheduleEmail(overrideTarget.merchantId, nextRunAt ? { nextRunAt } : {});
      setEmailPreview(result);
    } catch {
      toast.error("Failed to load email preview");
    } finally {
      setEmailPreviewLoading(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <CalendarClock className="w-4 h-4 text-primary" />
            Scheduled Report Delivery
          </div>
          <p className="text-xs text-muted-foreground">
            All merchants with an active report schedule — admin can pause, delete, trigger immediate delivery, or set a custom next run date.
          </p>
          {schedules.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                onClick={() => setStatusFilter("active")}
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${statusFilter === "active" ? "bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/40" : "bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20"}`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                Active: {statusCounts.active}
              </button>
              <button
                onClick={() => setStatusFilter("paused")}
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${statusFilter === "paused" ? "bg-muted/60 text-foreground ring-1 ring-border" : "bg-muted/30 text-muted-foreground hover:bg-muted/50"}`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground shrink-0" />
                Paused: {statusCounts.paused}
              </button>
              <button
                onClick={() => setStatusFilter("auto-paused")}
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${statusFilter === "auto-paused" ? "bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/40" : "bg-amber-500/10 text-amber-500 hover:bg-amber-500/20"}`}
              >
                <PauseCircle className="w-3 h-3 shrink-0" />
                Auto-paused: {statusCounts.autoPaused}
              </button>
            </div>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {/* Auto-paused warning banner */}
          {statusCounts.autoPaused > 0 && !bannerDismissed && (
            <div className="flex items-center gap-3 px-4 py-2.5 bg-amber-500/10 border-b border-amber-500/20 text-amber-400">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <p className="flex-1 text-xs">
                <span className="font-semibold">{statusCounts.autoPaused} schedule{statusCounts.autoPaused !== 1 ? "s" : ""} auto-paused</span>
                {" "}due to repeated delivery failures. Review and re-enable them to resume report delivery.
              </p>
              <button
                type="button"
                onClick={() => setStatusFilter("auto-paused")}
                className="shrink-0 text-xs font-medium underline underline-offset-2 hover:text-amber-300 transition-colors"
              >
                View auto-paused
              </button>
              <button
                type="button"
                onClick={() => setBannerDismissed(true)}
                aria-label="Dismiss"
                className="shrink-0 text-amber-400/60 hover:text-amber-300 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          {/* Filter bar */}
          <div className="flex flex-wrap items-center gap-2 px-4 pb-3 pt-1 border-b border-border">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search by merchant or email…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 pl-8 text-xs"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8 w-[130px] text-xs">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="paused">Paused</SelectItem>
                <SelectItem value="auto-paused">
                  <span className="flex items-center gap-1.5">
                    Auto-paused
                    {statusCounts.autoPaused > 0 && (
                      <span className="inline-flex items-center justify-center rounded-full bg-amber-500/20 text-amber-400 text-[10px] font-semibold px-1.5 min-w-[18px] h-[18px] leading-none">
                        {statusCounts.autoPaused}
                      </span>
                    )}
                  </span>
                </SelectItem>
                <SelectItem value="overdue">
                  <span className="flex items-center gap-1.5">
                    Overdue
                    {overdueCount > 0 && (
                      <span className="inline-flex items-center justify-center rounded-full bg-amber-500/20 text-amber-400 text-[10px] font-semibold px-1.5 min-w-[18px] h-[18px] leading-none">
                        {overdueCount}
                      </span>
                    )}
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
            <Select value={frequencyFilter} onValueChange={setFrequencyFilter}>
              <SelectTrigger className="h-8 w-[130px] text-xs">
                <SelectValue placeholder="Frequency" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Frequencies</SelectItem>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
            <Select value={formatFilter} onValueChange={setFormatFilter}>
              <SelectTrigger className="h-8 w-[120px] text-xs">
                <SelectValue placeholder="Format" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Formats</SelectItem>
                <SelectItem value="xlsx">XLSX</SelectItem>
                <SelectItem value="pdf">PDF</SelectItem>
              </SelectContent>
            </Select>
            {hasFilters && (
              <Button variant="ghost" size="sm" className="h-8 px-2 text-xs gap-1 text-muted-foreground" onClick={clearFilters}>
                <X className="w-3.5 h-3.5" />
                Clear
              </Button>
            )}
            {statusFilter === "overdue" && filteredSchedules.length > 0 && (
              <Button
                size="sm"
                className="h-8 px-3 text-xs gap-1.5 bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30 hover:text-amber-200"
                onClick={handleSendAllOverdue}
                disabled={sendAllOverdue.isPending}
              >
                {sendAllOverdue.isPending
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Send className="w-3.5 h-3.5" />}
                Send All Now
              </Button>
            )}
            {hasFilters && (
              <span className="ml-auto text-xs text-muted-foreground whitespace-nowrap flex items-center gap-2">
                {statusFilter === "overdue" && filteredSchedules.length > 0 && (
                  <span className="inline-flex items-center gap-1 text-amber-400 font-medium">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400" />
                    {filteredSchedules.length} overdue
                  </span>
                )}
                {filteredSchedules.length} of {schedules.length} schedule{schedules.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Loading schedules…</span>
            </div>
          ) : schedules.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
              <CalendarClock className="w-10 h-10 opacity-20" />
              <p className="text-sm">No merchants have configured a report schedule yet</p>
            </div>
          ) : filteredSchedules.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
            <Search className="w-10 h-10 opacity-20" />
            <p className="text-sm">No schedules match your filters</p>
            <Button variant="link" size="sm" className="text-xs" onClick={clearFilters}>Clear filters</Button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {(
                  [
                    { col: "merchant", label: "Merchant" },
                    { col: "email", label: "Email" },
                    { col: "frequency", label: "Frequency" },
                    { col: "format", label: "Format" },
                    { col: "status", label: "Status" },
                    { col: "lastSent", label: "Last Sent" },
                    { col: "nextDue", label: "Next Due" },
                  ] as { col: "merchant" | "email" | "frequency" | "format" | "status" | "lastSent" | "nextDue"; label: string }[]
                ).map(({ col, label }) => (
                  <TableHead key={col}>
                    <button
                      onClick={() => handleSort(col)}
                      className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors select-none"
                    >
                      {label}
                      {sortCol === col ? (
                        sortDir === "asc" ? (
                          <ChevronUp className="w-3.5 h-3.5 text-primary" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5 text-primary" />
                        )
                      ) : (
                        <ChevronsUpDown className="w-3.5 h-3.5 opacity-40" />
                      )}
                    </button>
                  </TableHead>
                ))}
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedSchedules.map((s) => {
                const rowNextDue = getNextDue(s.lastSentAt, s.frequency, (s as any).nextRunAt as string | null | undefined);
                const isRowOverdue = s.isActive && rowNextDue != null && rowNextDue < now;
                return (
                <TableRow
                  key={s.id}
                  className={isRowOverdue ? "border-l-2 border-amber-500/60 bg-amber-500/[0.04] hover:bg-amber-500/[0.07]" : ""}
                >
                  <TableCell className="font-medium text-sm">{s.businessName}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{s.merchantEmail}</TableCell>
                  <TableCell>
                    <FrequencyBadge frequency={s.frequency} />
                  </TableCell>
                  <TableCell>
                    <FormatBadge format={s.format} />
                  </TableCell>
                  <TableCell>
                    {s.isActive ? (
                      <span className="text-xs font-medium text-emerald-400">Active</span>
                    ) : s.consecutiveFailures > 0 ? (
                      <AutoPausedStatus
                        consecutiveFailures={s.consecutiveFailures}
                        autoPauseAfterFailures={s.autoPauseAfterFailures}
                        recentFailures={(s as any).recentFailures ?? []}
                      />
                    ) : (
                      <span className="text-xs font-medium text-muted-foreground">Paused</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {s.lastSentAt ? (
                      <span>
                        {format(new Date(s.lastSentAt), "dd MMM yyyy, HH:mm")}
                        <span className="ml-1 text-muted-foreground/60">
                          ({formatDistanceToNow(new Date(s.lastSentAt), { addSuffix: true })})
                        </span>
                      </span>
                    ) : "Never"}
                  </TableCell>
                  <TableCell className="text-xs">
                    {(() => {
                      const nextRunAtVal = (s as any).nextRunAt as string | null | undefined;
                      const isOverride = !!nextRunAtVal;
                      const nextDue = getNextDue(s.lastSentAt, s.frequency, nextRunAtVal);
                      if (!nextDue) {
                        return <span className="text-muted-foreground">Pending first run</span>;
                      }
                      const isOverdue = nextDue < new Date();
                      return (
                        <span className={`flex items-center gap-1.5 flex-wrap ${isOverride ? "text-violet-400 font-medium" : isOverdue ? "text-amber-400 font-medium" : "text-muted-foreground"}`}>
                          {isOverride && <CalendarDays className="w-3 h-3 shrink-0" />}
                          {format(nextDue, "dd MMM yyyy, HH:mm")}
                          <span className="ml-0.5 font-normal opacity-75">
                            ({formatDistanceToNow(nextDue, { addSuffix: true })})
                          </span>
                          {isOverride && <span className="text-violet-500">(override)</span>}
                          {!isOverride && isOverdue && (
                            <span className="inline-flex items-center justify-center rounded-full bg-amber-500/20 text-amber-400 text-[10px] font-semibold px-1.5 h-[18px] leading-none border border-amber-500/30">
                              Overdue
                            </span>
                          )}
                        </span>
                      );
                    })()}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground"
                        onClick={() => setHistoryMerchant({ id: s.merchantId, name: s.businessName })}
                        title="View delivery history"
                      >
                        <History className="w-3.5 h-3.5" />
                      </Button>
                      {!s.isActive && s.consecutiveFailures > 0 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs gap-1 text-amber-400 hover:text-amber-300"
                          onClick={() => handleReenable(s.merchantId, s.businessName)}
                          disabled={reenable.isPending}
                          title={`Re-enable auto-paused schedule (${s.consecutiveFailures} failure${s.consecutiveFailures !== 1 ? "s" : ""})`}
                        >
                          {reenable.isPending
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <RotateCcw className="w-3.5 h-3.5" />}
                          <span className="hidden sm:inline">Re-enable</span>
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs gap-1"
                        onClick={() => handleToggle(s.merchantId, s.isActive)}
                        disabled={upsert.isPending}
                        title={s.isActive ? "Pause schedule" : "Activate schedule"}
                      >
                        {s.isActive
                          ? <ToggleRight className="w-4 h-4 text-emerald-400" />
                          : <ToggleLeft className="w-4 h-4 text-muted-foreground" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs gap-1 text-violet-400 hover:text-violet-300"
                        onClick={() => openOverrideDialog(s.merchantId, s.businessName, (s as any).nextRunAt ?? null)}
                        title="Set next run date"
                      >
                        <CalendarDays className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs gap-1 text-sky-400 hover:text-sky-300"
                        onClick={() => setConfirmSend({ merchantId: s.merchantId, name: s.businessName, email: s.merchantEmail, frequency: s.frequency, format: s.format })}
                        disabled={sendingMerchantId === s.merchantId}
                        title="Send report now"
                      >
                        {sendingMerchantId === s.merchantId
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <Send className="w-3.5 h-3.5" />}
                        <span className="hidden sm:inline">Send Now</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs gap-1 text-red-400 hover:text-red-300"
                        onClick={() => handleDelete(s.merchantId, s.businessName)}
                        disabled={del.isPending}
                        title="Remove schedule"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>

      <ScheduleHistoryDialog
        merchantId={historyMerchant?.id ?? null}
        merchantName={historyMerchant?.name ?? ""}
        open={historyMerchant != null}
        onClose={() => setHistoryMerchant(null)}
      />

      {/* Send Now confirmation dialog */}
      <Dialog open={confirmSend != null} onOpenChange={(open) => { if (!open) setConfirmSend(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
              <Send className="w-4 h-4 text-sky-400" />
              Send Report Now
            </DialogTitle>
          </DialogHeader>
          {confirmSend && (
            <div className="py-2 space-y-3">
              <p className="text-sm text-muted-foreground">
                This will immediately send a{" "}
                <strong className="text-foreground capitalize">{confirmSend.frequency}</strong>{" "}
                <strong className="text-foreground uppercase">{confirmSend.format}</strong>{" "}
                report to{" "}
                <strong className="text-foreground">{confirmSend.name}</strong>.
              </p>
              <div className="rounded-md bg-muted/50 border border-border px-3 py-2 text-xs text-muted-foreground space-y-1">
                <div className="flex items-center gap-1.5">
                  <span className="opacity-60">Recipient:</span>
                  <span className="text-foreground font-medium">{confirmSend.email}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="opacity-60">Cadence window:</span>
                  <span className="text-foreground font-medium">
                    Last {confirmSend.frequency === "monthly" ? "30" : "7"} days of transactions
                  </span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                The schedule's <span className="text-foreground font-medium">last sent</span> timestamp and <span className="text-foreground font-medium">next run</span> will update after delivery.
              </p>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-7"
              onClick={() => setConfirmSend(null)}
              disabled={sendingMerchantId != null}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="text-xs h-7 gap-1.5 bg-sky-600 hover:bg-sky-500 text-white"
              onClick={() => confirmSend && handleSendNow(confirmSend.merchantId, confirmSend.name)}
              disabled={sendingMerchantId != null}
            >
              {sendingMerchantId != null
                ? <Loader2 className="w-3 h-3 animate-spin" />
                : <Send className="w-3 h-3" />}
              {sendingMerchantId != null ? "Sending…" : "Send Now"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={sendFailures != null} onOpenChange={(open) => { if (!open) setSendFailures(null); }}>
        <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <XCircle className="w-4 h-4 text-red-400" />
              Failed Deliveries ({sendFailures?.length ?? 0})
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            The following merchants did not receive their overdue report. Click "Retry Failed" to re-attempt all failed deliveries at once, or address the errors individually using "Send Now" in the table.
          </p>
          <div className="flex-1 overflow-y-auto min-h-0">
            {sendFailures && sendFailures.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Merchant</TableHead>
                    <TableHead className="text-xs">Email</TableHead>
                    <TableHead className="text-xs">Error</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sendFailures.map((f) => (
                    <TableRow key={f.merchantId}>
                      <TableCell className="text-xs font-medium text-foreground whitespace-nowrap">
                        {f.merchantName}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {f.email}
                      </TableCell>
                      <TableCell className="text-xs text-red-400 max-w-[180px]">
                        {f.reason}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-xs text-muted-foreground py-4 text-center">No failure details available.</p>
            )}
          </div>
          <DialogFooter className="gap-2 flex-wrap">
            <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => setSendFailures(null)}>
              Close
            </Button>
            {sendFailures && sendFailures.length > 0 && (
              <Button
                size="sm"
                className="text-xs h-7 gap-1.5 bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30 hover:text-red-200"
                disabled={sendAllOverdue.isPending}
                onClick={async () => {
                  if (!sendFailures) return;
                  const failedIds = sendFailures.map((f) => f.merchantId);
                  try {
                    const res = await sendAllOverdue.mutateAsync({ data: { merchantIds: failedIds } });
                    if (res.failed === 0) {
                      toast.success(`Retried ${res.sent} report${res.sent !== 1 ? "s" : ""} — all delivered successfully`);
                      setSendFailures(null);
                    } else if (res.sent === 0) {
                      toast.error(`All ${res.failed} retr${res.failed !== 1 ? "ies" : "y"} failed again`);
                      setSendFailures(res.failures);
                    } else {
                      toast.warning(`Sent ${res.sent}, still failed ${res.failed}`);
                      setSendFailures(res.failures);
                    }
                    invalidate();
                  } catch {
                    toast.error("Retry failed — check SMTP configuration");
                  }
                }}
              >
                {sendAllOverdue.isPending
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <RotateCcw className="w-3.5 h-3.5" />}
                Retry Failed
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!overrideTarget} onOpenChange={(open) => { if (!open) setOverrideTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">Set Next Run Date</DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-3">
            {overrideTarget && (
              <p className="text-xs text-muted-foreground">
                Override the next scheduled delivery for <strong className="text-foreground">{overrideTarget.name}</strong>.
                The schedule will fire at this time and then resume its normal cadence.
              </p>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs">Next run date &amp; time</Label>
              <Input
                type="datetime-local"
                value={overrideValue}
                onChange={(e) => setOverrideValue(e.target.value)}
                className="text-xs h-8"
              />
            </div>
            <div className="rounded-md bg-muted/30 border border-border px-3 py-2 text-xs text-muted-foreground">
              <p className="flex items-center gap-1.5">
                <Mail className="w-3 h-3 shrink-0" />
                Saving will send a notification email to the merchant.
              </p>
            </div>
          </div>
          <DialogFooter className="gap-2 flex-wrap">
            {overrideTarget?.current && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-7 text-muted-foreground gap-1"
                onClick={handleOverrideClear}
                disabled={overrideSaving}
              >
                <X className="w-3 h-3" />
                Clear override
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-7 gap-1 text-violet-400 border-violet-500/30 hover:bg-violet-500/10 hover:text-violet-300"
              onClick={handlePreviewEmail}
              disabled={emailPreviewLoading || overrideSaving}
            >
              {emailPreviewLoading
                ? <Loader2 className="w-3 h-3 animate-spin" />
                : <Eye className="w-3 h-3" />}
              Preview email
            </Button>
            <Button
              size="sm"
              className="text-xs h-7"
              onClick={handleOverrideSave}
              disabled={overrideSaving || !overrideValue}
            >
              {overrideSaving ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Email preview modal */}
      <Dialog open={!!emailPreview} onOpenChange={(open) => { if (!open) setEmailPreview(null); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
              <Eye className="w-4 h-4 text-violet-400" />
              Email Preview
            </DialogTitle>
          </DialogHeader>
          {emailPreview && (
            <>
              <div className="rounded-md bg-muted/40 border border-border px-3 py-2 text-xs text-muted-foreground space-y-1 shrink-0">
                <div className="flex items-start gap-1.5">
                  <span className="opacity-60 shrink-0">Subject:</span>
                  <span className="text-foreground font-medium break-all">{emailPreview.subject}</span>
                </div>
                <p className="text-[11px] text-muted-foreground/70 italic">
                  This is a preview only — no email will be sent until you click Save.
                </p>
              </div>
              <div className="flex-1 min-h-0 rounded-md border border-border overflow-hidden">
                <iframe
                  srcDoc={emailPreview.html}
                  title="Email preview"
                  className="w-full h-full min-h-[420px]"
                  sandbox="allow-same-origin"
                />
              </div>
            </>
          )}
          <DialogFooter>
            <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => setEmailPreview(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function DeliveryHistoryPanel() {
  const queryClient = useQueryClient();
  const { data: merchantsData } = useListMerchants({ page: 1, limit: 200 });
  const merchants = merchantsData?.data ?? [];

  const searchStr = useSearch();
  const urlMerchantId = new URLSearchParams(searchStr).get("merchantId") ?? "all";

  const [merchantFilter, setMerchantFilter] = useState(urlMerchantId);
  const [successFilter, setSuccessFilter] = useState("all");
  const [triggeredByFilter, setTriggeredByFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [reEnabling, setReEnabling] = useState<number | null>(null);

  const params = {
    merchantId: merchantFilter !== "all" ? parseInt(merchantFilter) : undefined,
    success: successFilter !== "all" ? (successFilter as "true" | "false") : undefined,
    triggeredBy: triggeredByFilter !== "all" ? (triggeredByFilter as "manual" | "bulk" | "scheduler") : undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    limit: 200,
  };

  const { data, isLoading, isFetching } = useGetAdminReportDeliveryHistory(params);
  const logs = data?.logs ?? [];

  const reenable = useReenableAdminMerchantReportSchedule();

  const handleReEnable = async (merchantId: number, merchantName: string) => {
    setReEnabling(merchantId);
    try {
      await reenable.mutateAsync({ merchantId });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListMerchantReportSchedulesQueryOptions().queryKey }),
        queryClient.invalidateQueries({ queryKey: getGetAdminReportDeliveryHistoryQueryKey() }),
      ]);
      toast.success(`Schedule re-enabled for ${merchantName}`);
    } catch {
      toast.error("Failed to re-enable schedule");
    } finally {
      setReEnabling(null);
    }
  };

  const hasFilters = merchantFilter !== "all" || successFilter !== "all" || triggeredByFilter !== "all" || !!dateFrom || !!dateTo;

  const clearFilters = () => {
    setMerchantFilter("all");
    setSuccessFilter("all");
    setTriggeredByFilter("all");
    setDateFrom("");
    setDateTo("");
  };

  const failureCount = logs.filter((l) => !l.success).length;
  const autoPauseCount = logs.filter((l) => l.isAutoPause).length;

  const merchantChartData = useMemo(() => {
    const map = new Map<string, { merchant: string; success: number; failed: number }>();
    for (const log of logs) {
      const name = log.businessName ?? `Merchant #${log.merchantId}`;
      const entry = map.get(name) ?? { merchant: name, success: 0, failed: 0 };
      if (log.success) entry.success++;
      else entry.failed++;
      map.set(name, entry);
    }
    return Array.from(map.values())
      .sort((a, b) => b.failed - a.failed || b.success - a.success)
      .slice(0, 12);
  }, [logs]);

  const timelineChartData = useMemo(() => {
    if (logs.length === 0) return [];
    const cutoff = subDays(new Date(), 29);
    const recentLogs = logs.filter((l) => new Date(l.attemptedAt) >= cutoff);
    if (recentLogs.length === 0) return [];
    const dayMap = new Map<string, { date: string; success: number; failed: number }>();
    const days = eachDayOfInterval({ start: cutoff, end: new Date() });
    for (const d of days) {
      const key = format(d, "dd MMM");
      dayMap.set(key, { date: key, success: 0, failed: 0 });
    }
    for (const log of recentLogs) {
      const key = format(parseISO(log.attemptedAt), "dd MMM");
      const entry = dayMap.get(key);
      if (entry) {
        if (log.success) entry.success++;
        else entry.failed++;
      }
    }
    return Array.from(dayMap.values());
  }, [logs]);

  const merchantSuccessRates = useMemo(() => {
    const map = new Map<number, { success: number; total: number }>();
    for (const log of logs) {
      const entry = map.get(log.merchantId) ?? { success: 0, total: 0 };
      entry.total++;
      if (log.success) entry.success++;
      map.set(log.merchantId, entry);
    }
    return map;
  }, [logs]);

  const showCharts = !isLoading && logs.length > 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <CalendarClock className="w-4 h-4 text-primary" />
          Report Delivery History
          {(isLoading || isFetching) && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
        </div>
        <p className="text-xs text-muted-foreground">
          Per-attempt delivery log across all merchants — failures, auto-pauses, and successes in one view. Each attempt records how it was triggered (manual send, bulk overdue sweep, or automated scheduler).
        </p>
        {!isLoading && logs.length > 0 && (failureCount > 0 || autoPauseCount > 0) && (
          <div className="flex items-center gap-3 pt-1">
            {failureCount > 0 && (
              <span className="inline-flex items-center gap-1 text-xs text-red-400 font-medium">
                <XCircle className="w-3.5 h-3.5" />
                {failureCount} failure{failureCount !== 1 ? "s" : ""}
              </span>
            )}
            {autoPauseCount > 0 && (
              <span className="inline-flex items-center gap-1 text-xs text-amber-400 font-medium">
                <Clock className="w-3.5 h-3.5" />
                {autoPauseCount} auto-pause{autoPauseCount !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-2 px-4 pb-3 pt-1 border-b border-border">
          <Select value={merchantFilter} onValueChange={setMerchantFilter}>
            <SelectTrigger className="h-8 w-[180px] text-xs">
              <SelectValue placeholder="All merchants" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All merchants</SelectItem>
              {merchants.map((m) => (
                <SelectItem key={m.id} value={m.id.toString()}>
                  {m.businessName ?? `Merchant #${m.id}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={successFilter} onValueChange={setSuccessFilter}>
            <SelectTrigger className="h-8 w-[130px] text-xs">
              <SelectValue placeholder="All outcomes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All outcomes</SelectItem>
              <SelectItem value="true">
                <span className="flex items-center gap-1.5 text-emerald-400"><CheckCircle2 className="w-3 h-3" />Success</span>
              </SelectItem>
              <SelectItem value="false">
                <span className="flex items-center gap-1.5 text-red-400"><XCircle className="w-3 h-3" />Failed</span>
              </SelectItem>
            </SelectContent>
          </Select>
          <Select value={triggeredByFilter} onValueChange={setTriggeredByFilter}>
            <SelectTrigger className="h-8 w-[140px] text-xs">
              <SelectValue placeholder="All triggers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All triggers</SelectItem>
              <SelectItem value="manual">
                <span className="flex items-center gap-1.5 text-sky-400"><Send className="w-3 h-3" />Manual</span>
              </SelectItem>
              <SelectItem value="bulk">
                <span className="flex items-center gap-1.5 text-violet-400"><Send className="w-3 h-3" />Bulk</span>
              </SelectItem>
              <SelectItem value="scheduler">
                <span className="flex items-center gap-1.5 text-amber-400"><CalendarClock className="w-3 h-3" />Scheduler</span>
              </SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1.5">
            <Label className="text-xs text-muted-foreground whitespace-nowrap">From</Label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-8 text-xs w-[130px]"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <Label className="text-xs text-muted-foreground whitespace-nowrap">To</Label>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-8 text-xs w-[130px]"
            />
          </div>
          {hasFilters && (
            <Button variant="ghost" size="sm" className="h-8 px-2 text-xs gap-1 text-muted-foreground" onClick={clearFilters}>
              <X className="w-3.5 h-3.5" />
              Clear
            </Button>
          )}
          <span className="ml-auto text-xs text-muted-foreground whitespace-nowrap">
            {!isLoading && `${logs.length.toLocaleString("en-IN")} attempt${logs.length !== 1 ? "s" : ""}`}
          </span>
        </div>

        {showCharts && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 px-4 py-4 border-b border-border">
            {/* Per-merchant success/failure bar chart */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                <BarChart3 className="w-3.5 h-3.5 text-primary" />
                Success vs Failure per Merchant
              </p>
              <ResponsiveContainer width="100%" height={Math.max(120, merchantChartData.length * 36)}>
                <BarChart
                  layout="vertical"
                  data={merchantChartData}
                  margin={{ top: 0, right: 16, left: 0, bottom: 0 }}
                  barCategoryGap="28%"
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis
                    type="number"
                    allowDecimals={false}
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="merchant"
                    width={110}
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: string) => v.length > 16 ? v.slice(0, 15) + "…" : v}
                  />
                  <RechartsTooltip
                    cursor={{ fill: "hsl(var(--muted)/0.15)" }}
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 6,
                      fontSize: 11,
                    }}
                    formatter={(value: number, name: string) => [
                      value,
                      name === "success" ? "Delivered" : "Failed",
                    ]}
                    labelStyle={{ color: "hsl(var(--foreground))", fontWeight: 600, marginBottom: 4 }}
                  />
                  <Legend
                    iconType="square"
                    iconSize={8}
                    wrapperStyle={{ fontSize: 10, paddingTop: 8 }}
                    formatter={(value: string) => value === "success" ? "Delivered" : "Failed"}
                  />
                  <Bar dataKey="success" name="success" stackId="a" fill="hsl(142 71% 45%)" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="failed" name="failed" stackId="a" fill="hsl(0 84% 60%)" radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Timeline: failures over last 30 days */}
            {timelineChartData.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                  <CalendarDays className="w-3.5 h-3.5 text-primary" />
                  Delivery Timeline — last 30 days
                </p>
                <ResponsiveContainer width="100%" height={Math.max(120, merchantChartData.length * 36)}>
                  <BarChart
                    data={timelineChartData}
                    margin={{ top: 0, right: 8, left: -20, bottom: 24 }}
                    barCategoryGap="20%"
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                      tickLine={false}
                      axisLine={false}
                      interval={Math.floor(timelineChartData.length / 7)}
                      angle={-40}
                      textAnchor="end"
                      dy={4}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <RechartsTooltip
                      cursor={{ fill: "hsl(var(--muted)/0.15)" }}
                      contentStyle={{
                        background: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 6,
                        fontSize: 11,
                      }}
                      formatter={(value: number, name: string) => [
                        value,
                        name === "success" ? "Delivered" : "Failed",
                      ]}
                      labelStyle={{ color: "hsl(var(--foreground))", fontWeight: 600, marginBottom: 4 }}
                    />
                    <Legend
                      iconType="square"
                      iconSize={8}
                      wrapperStyle={{ fontSize: 10, paddingTop: 8 }}
                      formatter={(value: string) => value === "success" ? "Delivered" : "Failed"}
                    />
                    <Bar dataKey="success" name="success" stackId="t" fill="hsl(142 71% 45%)" />
                    <Bar dataKey="failed" name="failed" stackId="t" fill="hsl(0 84% 60%)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Loading delivery history…</span>
          </div>
        ) : logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
            <CalendarClock className="w-10 h-10 opacity-20" />
            <p className="text-sm">{hasFilters ? "No delivery attempts match your filters" : "No delivery attempts recorded yet"}</p>
            {hasFilters && (
              <Button variant="link" size="sm" className="text-xs" onClick={clearFilters}>Clear filters</Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Attempted At</TableHead>
                  <TableHead>Merchant</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Triggered By</TableHead>
                  <TableHead>Frequency</TableHead>
                  <TableHead>Format</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead>Auto-pause</TableHead>
                  <TableHead>Failure Reason</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id} className={!log.success ? "bg-red-950/10 hover:bg-red-950/20" : undefined}>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {format(new Date(log.attemptedAt), "dd MMM yyyy, HH:mm")}
                      <span className="ml-1 text-muted-foreground/60">
                        ({formatDistanceToNow(new Date(log.attemptedAt), { addSuffix: true })})
                      </span>
                    </TableCell>
                    <TableCell className="font-medium text-sm">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span>{log.businessName ?? `Merchant #${log.merchantId}`}</span>
                        {(() => {
                          const rate = merchantSuccessRates.get(log.merchantId);
                          if (!rate || rate.total === 0) return null;
                          const pct = Math.round((rate.success / rate.total) * 100);
                          const color =
                            pct >= 90
                              ? "text-emerald-400 bg-emerald-400/10 border-emerald-400/20"
                              : pct >= 70
                              ? "text-amber-400 bg-amber-400/10 border-amber-400/20"
                              : "text-red-400 bg-red-400/10 border-red-400/20";
                          return (
                            <span
                              className={`inline-flex items-center rounded-full border px-1.5 py-0 text-[10px] font-semibold leading-5 ${color}`}
                              title={`${rate.success} of ${rate.total} delivered (from visible logs)`}
                            >
                              {pct}% delivered
                            </span>
                          );
                        })()}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{log.merchantEmail ?? "—"}</TableCell>
                    <TableCell>
                      <TriggeredByBadge value={(log as any).triggeredBy} />
                    </TableCell>
                    <TableCell>
                      {log.frequency ? (
                        <FrequencyBadge frequency={log.frequency as "weekly" | "monthly"} />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {log.format ? (
                        <FormatBadge format={log.format as "xlsx" | "pdf"} />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {log.success ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400">
                          <CheckCircle2 className="w-3.5 h-3.5" />Delivered
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-red-400">
                          <XCircle className="w-3.5 h-3.5" />Failed
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {log.isAutoPause ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-400">
                          <Clock className="w-3.5 h-3.5" />Yes
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[280px] truncate" title={log.failureReason ?? undefined}>
                      {log.failureReason ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {log.isAutoPause ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs gap-1 text-emerald-400 hover:text-emerald-300"
                          onClick={() => handleReEnable(log.merchantId, log.businessName ?? `Merchant #${log.merchantId}`)}
                          disabled={reEnabling === log.merchantId}
                          title="Re-enable this merchant's report schedule"
                        >
                          {reEnabling === log.merchantId
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <ToggleRight className="w-3.5 h-3.5" />}
                          Re-enable
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {logs.length >= 200 && (
              <div className="text-center py-3 text-xs text-muted-foreground border-t border-border/50">
                Showing the most recent 200 attempts — apply filters to narrow results
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function AdminReports() {
  const [activeTab, setActiveTab] = useState("transactions");

  // Transaction filter state
  const [txDateFrom, setTxDateFrom] = useState(() => format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [txDateTo, setTxDateTo] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [type, setType] = useState("all");
  const [txStatus, setTxStatus] = useState("all");
  const [connectionProvider, setConnectionProvider] = useState("all");
  const [source, setSource] = useState("all");
  const [txMerchantId, setTxMerchantId] = useState("all");
  const [txActivePreset, setTxActivePreset] = useState<string | null>(null);
  const [txExporting, setTxExporting] = useState<"pdf" | "xlsx" | null>(null);

  // Settlement filter state
  const [stlDateFrom, setStlDateFrom] = useState(() => format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [stlDateTo, setStlDateTo] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [stlStatus, setStlStatus] = useState("all");
  const [settlementId, setSettlementId] = useState("");
  const [stlMerchantId, setStlMerchantId] = useState("all");
  const [stlActivePreset, setStlActivePreset] = useState<string | null>(null);
  const [stlExporting, setStlExporting] = useState<"pdf" | "xlsx" | null>(null);

  const { data: merchantsData } = useListMerchants({ page: 1, limit: 200 });
  const merchants = merchantsData?.data ?? [];

  const txParams = {
    dateFrom: txDateFrom || undefined,
    dateTo: txDateTo || undefined,
    type: type !== "all" ? (type as "deposit" | "withdrawal") : undefined,
    status: txStatus !== "all" ? (txStatus as "pending" | "success" | "failed") : undefined,
    connectionProvider: connectionProvider !== "all" ? (connectionProvider as "phonepe" | "paytm" | "bharatpe" | "yono_sbi" | "hdfc_smarthub" | "upi_id") : undefined,
    source: source !== "all" ? (source as "qr_code" | "virtual_account" | "payment_link" | "direct") : undefined,
    merchantId: txMerchantId !== "all" ? parseInt(txMerchantId) : undefined,
  };

  const stlParams = {
    dateFrom: stlDateFrom || undefined,
    dateTo: stlDateTo || undefined,
    status: stlStatus !== "all" ? (stlStatus as "pending" | "processing" | "approved" | "rejected" | "paid" | "cancelled") : undefined,
    settlementId: settlementId ? parseInt(settlementId) : undefined,
    merchantId: stlMerchantId !== "all" ? parseInt(stlMerchantId) : undefined,
  };

  const { data: txData, isLoading: txLoading, isFetching: txFetching } = useGetTransactionReport(txParams);
  const { data: stlData, isLoading: stlLoading, isFetching: stlFetching } = useGetSettlementReport(stlParams);

  const transactions = txData?.data ?? [];
  const txStats = txData?.stats;
  const settlements = stlData?.data ?? [];
  const stlStats = stlData?.stats;

  const txMerchantName = txMerchantId !== "all"
    ? (merchants.find((m) => m.id === parseInt(txMerchantId))?.businessName ?? `Merchant #${txMerchantId}`)
    : "All Merchants";

  const stlMerchantName = stlMerchantId !== "all"
    ? (merchants.find((m) => m.id === parseInt(stlMerchantId))?.businessName ?? `Merchant #${stlMerchantId}`)
    : "All Merchants";

  const applyTxPreset = (preset: typeof DATE_PRESETS[number]) => {
    const range = preset.getRange();
    setTxDateFrom(range.from);
    setTxDateTo(range.to);
    setTxActivePreset(preset.label);
  };

  const applyStlPreset = (preset: typeof DATE_PRESETS[number]) => {
    const range = preset.getRange();
    setStlDateFrom(range.from);
    setStlDateTo(range.to);
    setStlActivePreset(preset.label);
  };

  // ── Transaction exports ───────────────────────────────────────────────────
  const exportTxExcel = useCallback(async () => {
    if (!transactions.length) { toast.error("No data to export"); return; }
    setTxExporting("xlsx");
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();

      const summaryRows = [
        ["RasoKart — Admin Transaction Report"],
        [`Generated: ${format(new Date(), "dd/MM/yyyy HH:mm")}`],
        [`Merchant: ${txMerchantName}`],
        [`Period: ${txDateFrom || "All time"} to ${txDateTo || "All time"}`],
        [],
        ["Summary"],
        ["Total Transactions", transactions.length],
        ["Deposit Volume (₹)", txStats?.depositVolume ?? 0],
        ["Withdrawal Volume (₹)", txStats?.withdrawalVolume ?? 0],
        ["Total Fees (₹)", txStats?.totalFees ?? 0],
        ["Successful", txStats?.successCount ?? 0],
        ["Failed", txStats?.failedCount ?? 0],
        ["Pending", txStats?.pendingCount ?? 0],
      ];
      const ws1 = XLSX.utils.aoa_to_sheet(summaryRows);
      ws1["!cols"] = [{ wch: 28 }, { wch: 20 }];
      XLSX.utils.book_append_sheet(wb, ws1, "Summary");

      const txRows = [
        ["Date", "Merchant", "UTR", "Reference ID", "Type", "Status", "Settlement Status", "Amount (₹)", "Fee (₹)", "Currency", "Source", "Provider", "Description"],
        ...transactions.map((t) => {
          const src = t.qrCodeId ? "QR Code" : t.virtualAccountId ? "Virtual Account" : t.paymentLinkId ? "Payment Link" : "Direct";
          return [
            format(new Date(t.createdAt), "dd/MM/yyyy HH:mm"),
            t.merchantName ?? "",
            t.utr,
            t.referenceId ?? "",
            t.type,
            t.status,
            t.settlementStatus,
            Number(t.amount),
            Number(t.fee),
            t.currency,
            src,
            t.connectionProvider ?? "",
            t.description ?? "",
          ];
        }),
      ];
      const ws2 = XLSX.utils.aoa_to_sheet(txRows);
      ws2["!cols"] = [{ wch: 18 }, { wch: 22 }, { wch: 22 }, { wch: 18 }, { wch: 12 }, { wch: 10 }, { wch: 16 }, { wch: 14 }, { wch: 12 }, { wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 30 }];
      XLSX.utils.book_append_sheet(wb, ws2, "Transactions");

      XLSX.writeFile(wb, `rasokart-admin-tx-report-${format(new Date(), "yyyy-MM-dd")}.xlsx`);
      toast.success("Excel report downloaded");
    } catch {
      toast.error("Failed to export Excel");
    } finally {
      setTxExporting(null);
    }
  }, [transactions, txStats, txDateFrom, txDateTo, txMerchantName]);

  const exportTxPDF = useCallback(async () => {
    if (!transactions.length) { toast.error("No data to export"); return; }
    setTxExporting("pdf");
    try {
      const { jsPDF } = await import("jspdf");
      const { default: autoTable } = await import("jspdf-autotable");

      const doc = new jsPDF({ orientation: "landscape" });

      doc.setFontSize(18);
      doc.setFont("helvetica", "bold");
      doc.text("RasoKart — Admin Transaction Report", 14, 18);

      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(120, 120, 120);
      doc.text(`Generated: ${format(new Date(), "dd/MM/yyyy HH:mm")}`, 14, 26);
      doc.text(`Merchant: ${txMerchantName}`, 14, 32);
      doc.text(`Period: ${txDateFrom || "All time"} → ${txDateTo || "All time"}`, 14, 38);
      doc.setTextColor(0, 0, 0);

      autoTable(doc, {
        startY: 46,
        head: [["Metric", "Value"]],
        body: [
          ["Total Transactions", transactions.length.toString()],
          ["Deposit Volume", fmt(txStats?.depositVolume ?? 0)],
          ["Withdrawal Volume", fmt(txStats?.withdrawalVolume ?? 0)],
          ["Total Fees", fmt(txStats?.totalFees ?? 0)],
          ["Successful", (txStats?.successCount ?? 0).toString()],
          ["Failed", (txStats?.failedCount ?? 0).toString()],
          ["Pending", (txStats?.pendingCount ?? 0).toString()],
        ],
        theme: "grid",
        headStyles: { fillColor: [30, 30, 46] },
        columnStyles: { 0: { fontStyle: "bold", cellWidth: 60 }, 1: { cellWidth: 60 } },
      });

      const afterSummary = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;

      autoTable(doc, {
        startY: afterSummary,
        head: [["Date", "Merchant", "UTR", "Type", "Status", "Settlement", "Amount (₹)", "Fee (₹)", "Source", "Provider"]],
        body: transactions.map((t) => {
          const src = t.qrCodeId ? "QR Code" : t.virtualAccountId ? "Virtual Account" : t.paymentLinkId ? "Payment Link" : "Direct";
          return [
            format(new Date(t.createdAt), "dd/MM/yy HH:mm"),
            t.merchantName ?? "",
            t.utr,
            t.type,
            t.status,
            t.settlementStatus,
            Number(t.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 }),
            Number(t.fee).toLocaleString("en-IN", { minimumFractionDigits: 2 }),
            src,
            t.connectionProvider ?? "",
          ];
        }),
        theme: "striped",
        headStyles: { fillColor: [30, 30, 46] },
        styles: { fontSize: 7.5 },
        columnStyles: {
          0: { cellWidth: 22 },
          1: { cellWidth: 26 },
          2: { cellWidth: 30 },
          3: { cellWidth: 18 },
          4: { cellWidth: 18 },
          5: { cellWidth: 20 },
          6: { cellWidth: 24, halign: "right" },
          7: { cellWidth: 20, halign: "right" },
          8: { cellWidth: 22 },
          9: { cellWidth: "auto" },
        },
      });

      doc.save(`rasokart-admin-tx-report-${format(new Date(), "yyyy-MM-dd")}.pdf`);
      toast.success("PDF report downloaded");
    } catch {
      toast.error("Failed to export PDF");
    } finally {
      setTxExporting(null);
    }
  }, [transactions, txStats, txDateFrom, txDateTo, txMerchantName]);

  // ── Settlement exports ────────────────────────────────────────────────────
  const exportStlExcel = useCallback(async () => {
    if (!settlements.length) { toast.error("No data to export"); return; }
    setStlExporting("xlsx");
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();

      const summaryRows = [
        ["RasoKart — Admin Settlement Report"],
        [`Generated: ${format(new Date(), "dd/MM/yyyy HH:mm")}`],
        [`Merchant: ${stlMerchantName}`],
        [`Period: ${stlDateFrom || "All time"} to ${stlDateTo || "All time"}`],
        [],
        ["Summary"],
        ["Total Settlements", stlStats?.totalCount ?? 0],
        ["Total Amount (₹)", stlStats?.totalAmount ?? 0],
        ["Paid Amount (₹)", stlStats?.paidAmount ?? 0],
        ["Pending Amount (₹)", stlStats?.pendingAmount ?? 0],
        ["Rejected Amount (₹)", stlStats?.rejectedAmount ?? 0],
        ["Paid", stlStats?.paidCount ?? 0],
        ["Pending", stlStats?.pendingCount ?? 0],
        ["Processing / Approved", stlStats?.processingCount ?? 0],
        ["Rejected / Cancelled", stlStats?.rejectedCount ?? 0],
      ];
      const ws1 = XLSX.utils.aoa_to_sheet(summaryRows);
      ws1["!cols"] = [{ wch: 28 }, { wch: 20 }];
      XLSX.utils.book_append_sheet(wb, ws1, "Summary");

      const stlRows = [
        ["Settlement ID", "Merchant", "Status", "Period From", "Period To", "Requested Amount (₹)", "Settled Amount (₹)", "Fees (₹)", "Transactions", "UTR / Reference", "Paid At", "Created At"],
        ...settlements.map((s) => [
          s.id,
          s.merchantName ?? "",
          s.status,
          s.periodFrom ?? "",
          s.periodTo ?? "",
          s.requestedAmount != null ? Number(s.requestedAmount) : "",
          Number(s.amount),
          Number(s.fees ?? 0),
          s.transactionCount,
          s.referenceNumber ?? "",
          s.paidAt ? format(new Date(s.paidAt), "dd/MM/yyyy HH:mm") : "",
          format(new Date(s.createdAt), "dd/MM/yyyy HH:mm"),
        ]),
      ];
      const ws2 = XLSX.utils.aoa_to_sheet(stlRows);
      ws2["!cols"] = [{ wch: 14 }, { wch: 22 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 22 }, { wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 28 }, { wch: 20 }, { wch: 20 }];
      XLSX.utils.book_append_sheet(wb, ws2, "Settlements");

      XLSX.writeFile(wb, `rasokart-admin-settlement-report-${format(new Date(), "yyyy-MM-dd")}.xlsx`);
      toast.success("Excel report downloaded");
    } catch {
      toast.error("Failed to export Excel");
    } finally {
      setStlExporting(null);
    }
  }, [settlements, stlStats, stlDateFrom, stlDateTo, stlMerchantName]);

  const exportStlPDF = useCallback(async () => {
    if (!settlements.length) { toast.error("No data to export"); return; }
    setStlExporting("pdf");
    try {
      const { jsPDF } = await import("jspdf");
      const { default: autoTable } = await import("jspdf-autotable");

      const doc = new jsPDF({ orientation: "landscape" });

      doc.setFontSize(18);
      doc.setFont("helvetica", "bold");
      doc.text("RasoKart — Admin Settlement Report", 14, 18);

      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(120, 120, 120);
      doc.text(`Generated: ${format(new Date(), "dd/MM/yyyy HH:mm")}`, 14, 26);
      doc.text(`Merchant: ${stlMerchantName}`, 14, 32);
      doc.text(`Period: ${stlDateFrom || "All time"} → ${stlDateTo || "All time"}`, 14, 38);
      doc.setTextColor(0, 0, 0);

      autoTable(doc, {
        startY: 46,
        head: [["Metric", "Value"]],
        body: [
          ["Total Settlements", (stlStats?.totalCount ?? 0).toString()],
          ["Total Amount", fmt(stlStats?.totalAmount ?? 0)],
          ["Paid Amount", fmt(stlStats?.paidAmount ?? 0)],
          ["Pending Amount", fmt(stlStats?.pendingAmount ?? 0)],
          ["Rejected Amount", fmt(stlStats?.rejectedAmount ?? 0)],
          ["Paid Count", (stlStats?.paidCount ?? 0).toString()],
          ["Pending Count", (stlStats?.pendingCount ?? 0).toString()],
          ["Processing / Approved", (stlStats?.processingCount ?? 0).toString()],
          ["Rejected / Cancelled", (stlStats?.rejectedCount ?? 0).toString()],
        ],
        theme: "grid",
        headStyles: { fillColor: [30, 30, 46] },
        columnStyles: { 0: { fontStyle: "bold", cellWidth: 60 }, 1: { cellWidth: 60 } },
      });

      const afterSummary = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;

      autoTable(doc, {
        startY: afterSummary,
        head: [["ID", "Merchant", "Status", "Period", "Requested (₹)", "Settled (₹)", "Fees (₹)", "Txns", "UTR / Ref", "Paid At", "Created"]],
        body: settlements.map((s) => [
          `#${s.id}`,
          s.merchantName ?? "—",
          s.status,
          s.periodFrom && s.periodTo ? `${s.periodFrom} → ${s.periodTo}` : "—",
          s.requestedAmount != null ? Number(s.requestedAmount).toLocaleString("en-IN", { minimumFractionDigits: 2 }) : "—",
          Number(s.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 }),
          Number(s.fees ?? 0) > 0 ? Number(s.fees).toLocaleString("en-IN", { minimumFractionDigits: 2 }) : "—",
          s.transactionCount.toString(),
          s.referenceNumber ?? "—",
          s.paidAt ? format(new Date(s.paidAt), "dd/MM/yy") : "—",
          format(new Date(s.createdAt), "dd/MM/yy"),
        ]),
        theme: "striped",
        headStyles: { fillColor: [30, 30, 46] },
        styles: { fontSize: 7.5 },
        columnStyles: {
          0: { cellWidth: 10 },
          1: { cellWidth: 24 },
          2: { cellWidth: 18 },
          3: { cellWidth: 28 },
          4: { cellWidth: 22, halign: "right" },
          5: { cellWidth: 22, halign: "right" },
          6: { cellWidth: 16, halign: "right" },
          7: { cellWidth: 10, halign: "right" },
          8: { cellWidth: 32 },
          9: { cellWidth: 18 },
          10: { cellWidth: "auto" },
        },
      });

      doc.save(`rasokart-admin-settlement-report-${format(new Date(), "yyyy-MM-dd")}.pdf`);
      toast.success("PDF report downloaded");
    } catch {
      toast.error("Failed to export PDF");
    } finally {
      setStlExporting(null);
    }
  }, [settlements, stlStats, stlDateFrom, stlDateTo, stlMerchantName]);

  const isTxExporting = txExporting !== null;
  const isStlExporting = stlExporting !== null;
  const txNoData = !txLoading && transactions.length === 0;
  const stlNoData = !stlLoading && settlements.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-primary" />
            Reports
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Generate and download reports across all merchants
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
          <TabsTrigger value="settlements">Settlements</TabsTrigger>
          <TabsTrigger value="delivery-history" className="flex items-center gap-1.5">
            <History className="w-3.5 h-3.5" />
            Delivery History
          </TabsTrigger>
        </TabsList>

        {/* ── Transactions Tab ───────────────────────────────────────────── */}
        <TabsContent value="transactions" className="space-y-6">
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={exportTxExcel}
              disabled={isTxExporting || txLoading || transactions.length === 0}
            >
              {txExporting === "xlsx" ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <FileSpreadsheet className="w-4 h-4 mr-1.5" />}
              {txExporting === "xlsx" ? "Exporting…" : "Excel (.xlsx)"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={exportTxPDF}
              disabled={isTxExporting || txLoading || transactions.length === 0}
            >
              {txExporting === "pdf" ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <FileText className="w-4 h-4 mr-1.5" />}
              {txExporting === "pdf" ? "Exporting…" : "PDF (.pdf)"}
            </Button>
          </div>

          {/* Tx Filters */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Filter className="w-4 h-4" />
                Filters
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <CalendarRange className="w-4 h-4 text-muted-foreground shrink-0" />
                {DATE_PRESETS.map((p) => (
                  <Button
                    key={p.label}
                    variant={txActivePreset === p.label ? "secondary" : "outline"}
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => applyTxPreset(p)}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">From</Label>
                  <Input
                    type="date"
                    value={txDateFrom}
                    onChange={(e) => { setTxDateFrom(e.target.value); setTxActivePreset(null); }}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">To</Label>
                  <Input
                    type="date"
                    value={txDateTo}
                    onChange={(e) => { setTxDateTo(e.target.value); setTxActivePreset(null); }}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground flex items-center gap-1">
                    <Store className="w-3 h-3" />Merchant
                  </Label>
                  <Select value={txMerchantId} onValueChange={setTxMerchantId}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All merchants</SelectItem>
                      {merchants.map((m) => (
                        <SelectItem key={m.id} value={m.id.toString()}>
                          {m.businessName ?? `Merchant #${m.id}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Type</Label>
                  <Select value={type} onValueChange={setType}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All types</SelectItem>
                      <SelectItem value="deposit">Deposit</SelectItem>
                      <SelectItem value="withdrawal">Withdrawal</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Status</Label>
                  <Select value={txStatus} onValueChange={setTxStatus}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      <SelectItem value="success">Success</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="failed">Failed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Source</Label>
                  <Select value={source} onValueChange={setSource}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All sources</SelectItem>
                      <SelectItem value="qr_code">
                        <span className="flex items-center gap-1.5"><QrCode className="w-3 h-3" />QR Code</span>
                      </SelectItem>
                      <SelectItem value="virtual_account">
                        <span className="flex items-center gap-1.5"><Building2 className="w-3 h-3" />Virtual Account</span>
                      </SelectItem>
                      <SelectItem value="payment_link">
                        <span className="flex items-center gap-1.5"><Link2 className="w-3 h-3" />Payment Link</span>
                      </SelectItem>
                      <SelectItem value="direct">Direct</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Provider</Label>
                  <Select value={connectionProvider} onValueChange={setConnectionProvider}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All providers</SelectItem>
                      {PROVIDERS.map((p) => (
                        <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Tx Stats */}
          {txStats && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <Card>
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                    <ArrowDownLeft className="w-3 h-3 text-emerald-400" />Deposit Volume
                  </p>
                  <p className="text-base font-bold text-emerald-400">{fmt(txStats.depositVolume)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                    <ArrowUpRight className="w-3 h-3 text-orange-400" />Withdrawal Volume
                  </p>
                  <p className="text-base font-bold text-orange-400">{fmt(txStats.withdrawalVolume)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                    <Coins className="w-3 h-3 text-violet-400" />Total Fees
                  </p>
                  <p className="text-base font-bold text-violet-400">{fmt(txStats.totalFees)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />Successful
                  </p>
                  <p className="text-base font-bold">{txStats.successCount.toLocaleString("en-IN")}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                    <XCircle className="w-3 h-3 text-red-400" />Failed
                  </p>
                  <p className="text-base font-bold text-red-400">{txStats.failedCount.toLocaleString("en-IN")}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                    <Clock className="w-3 h-3 text-amber-400" />Pending
                  </p>
                  <p className="text-base font-bold text-amber-400">{txStats.pendingCount.toLocaleString("en-IN")}</p>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Tx Table */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">
                  {txLoading || txFetching ? (
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />Loading…
                    </span>
                  ) : (
                    <span>{transactions.length.toLocaleString("en-IN")} transaction{transactions.length !== 1 ? "s" : ""} matched</span>
                  )}
                </p>
                {transactions.length > 0 && (
                  <div className="flex items-center gap-1.5">
                    <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={exportTxExcel} disabled={isTxExporting}>
                      <Download className="w-3 h-3" />xlsx
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={exportTxPDF} disabled={isTxExporting}>
                      <Download className="w-3 h-3" />pdf
                    </Button>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {txNoData ? (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
                  <FileText className="w-10 h-10 opacity-20" />
                  <p className="text-sm">No transactions match the selected filters</p>
                  <p className="text-xs opacity-60">Try adjusting the date range, merchant, or clearing filters</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Merchant</TableHead>
                        <TableHead>UTR</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Settlement</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead>Provider</TableHead>
                        <TableHead className="text-right">Fee (₹)</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {txLoading
                        ? Array.from({ length: 5 }).map((_, i) => (
                            <TableRow key={i}>
                              {Array.from({ length: 10 }).map((__, j) => (
                                <TableCell key={j}><div className="h-4 w-full bg-muted animate-pulse rounded" /></TableCell>
                              ))}
                            </TableRow>
                          ))
                        : transactions.slice(0, 100).map((t) => {
                            const src = t.qrCodeId ? "QR Code" : t.virtualAccountId ? "Virtual Account" : t.paymentLinkId ? "Payment Link" : "Direct";
                            return (
                              <TableRow key={t.id}>
                                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                                  {format(new Date(t.createdAt), "dd MMM yyyy, HH:mm")}
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground">
                                  {t.merchantName ?? "—"}
                                </TableCell>
                                <TableCell className="font-mono text-xs">{t.utr}</TableCell>
                                <TableCell>
                                  <span className={`text-xs font-medium capitalize ${t.type === "deposit" ? "text-emerald-400" : "text-orange-400"}`}>
                                    {t.type}
                                  </span>
                                </TableCell>
                                <TableCell><StatusBadge status={t.status} /></TableCell>
                                <TableCell>
                                  <span className={`text-xs capitalize ${settlementBadgeColor(t.settlementStatus)}`}>
                                    {t.settlementStatus}
                                  </span>
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground">{src}</TableCell>
                                <TableCell className="text-xs capitalize text-muted-foreground">
                                  {t.connectionProvider ?? "—"}
                                </TableCell>
                                <TableCell className="text-right text-xs text-muted-foreground">
                                  {Number(t.fee) > 0 ? fmt(Number(t.fee)) : "—"}
                                </TableCell>
                                <TableCell className="text-right font-medium text-sm">
                                  {fmt(Number(t.amount))}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                    </TableBody>
                  </Table>
                  {transactions.length > 100 && (
                    <div className="text-center py-3 text-xs text-muted-foreground border-t border-border/50">
                      Showing first 100 of {transactions.length.toLocaleString("en-IN")} transactions — download the full report to see all rows
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Settlements Tab ────────────────────────────────────────────── */}
        <TabsContent value="settlements" className="space-y-6">
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={exportStlExcel}
              disabled={isStlExporting || stlLoading || settlements.length === 0}
            >
              {stlExporting === "xlsx" ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <FileSpreadsheet className="w-4 h-4 mr-1.5" />}
              {stlExporting === "xlsx" ? "Exporting…" : "Excel (.xlsx)"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={exportStlPDF}
              disabled={isStlExporting || stlLoading || settlements.length === 0}
            >
              {stlExporting === "pdf" ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <FileText className="w-4 h-4 mr-1.5" />}
              {stlExporting === "pdf" ? "Exporting…" : "PDF (.pdf)"}
            </Button>
          </div>

          {/* Settlement Filters */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Filter className="w-4 h-4" />
                Filters
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <CalendarRange className="w-4 h-4 text-muted-foreground shrink-0" />
                {DATE_PRESETS.map((p) => (
                  <Button
                    key={p.label}
                    variant={stlActivePreset === p.label ? "secondary" : "outline"}
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => applyStlPreset(p)}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">From</Label>
                  <Input
                    type="date"
                    value={stlDateFrom}
                    onChange={(e) => { setStlDateFrom(e.target.value); setStlActivePreset(null); }}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">To</Label>
                  <Input
                    type="date"
                    value={stlDateTo}
                    onChange={(e) => { setStlDateTo(e.target.value); setStlActivePreset(null); }}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground flex items-center gap-1">
                    <Store className="w-3 h-3" />Merchant
                  </Label>
                  <Select value={stlMerchantId} onValueChange={setStlMerchantId}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All merchants</SelectItem>
                      {merchants.map((m) => (
                        <SelectItem key={m.id} value={m.id.toString()}>
                          {m.businessName ?? `Merchant #${m.id}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Status</Label>
                  <Select value={stlStatus} onValueChange={setStlStatus}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="processing">Processing</SelectItem>
                      <SelectItem value="approved">Approved</SelectItem>
                      <SelectItem value="paid">Paid</SelectItem>
                      <SelectItem value="rejected">Rejected</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground flex items-center gap-1">
                    <Hash className="w-3 h-3" />Settlement ID
                  </Label>
                  <Input
                    type="number"
                    value={settlementId}
                    onChange={(e) => setSettlementId(e.target.value)}
                    placeholder="e.g. 42"
                    className="h-8 text-sm"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Settlement Stats */}
          {stlStats && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              <Card>
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                    <TrendingUp className="w-3 h-3 text-primary" />Total Amount
                  </p>
                  <p className="text-base font-bold">{fmt(stlStats.totalAmount)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                    <Banknote className="w-3 h-3 text-emerald-400" />Paid Amount
                  </p>
                  <p className="text-base font-bold text-emerald-400">{fmt(stlStats.paidAmount)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                    <Wallet className="w-3 h-3 text-amber-400" />Pending Amount
                  </p>
                  <p className="text-base font-bold text-amber-400">{fmt(stlStats.pendingAmount)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />Paid
                  </p>
                  <p className="text-base font-bold">{stlStats.paidCount.toLocaleString("en-IN")}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                    <Clock className="w-3 h-3 text-amber-400" />Pending / Processing
                  </p>
                  <p className="text-base font-bold text-amber-400">
                    {(stlStats.pendingCount + stlStats.processingCount).toLocaleString("en-IN")}
                  </p>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Settlement Table */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">
                  {stlLoading || stlFetching ? (
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />Loading…
                    </span>
                  ) : (
                    <span>{settlements.length.toLocaleString("en-IN")} settlement{settlements.length !== 1 ? "s" : ""} matched</span>
                  )}
                </p>
                {settlements.length > 0 && (
                  <div className="flex items-center gap-1.5">
                    <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={exportStlExcel} disabled={isStlExporting}>
                      <Download className="w-3 h-3" />xlsx
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={exportStlPDF} disabled={isStlExporting}>
                      <Download className="w-3 h-3" />pdf
                    </Button>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {stlNoData ? (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
                  <Banknote className="w-10 h-10 opacity-20" />
                  <p className="text-sm">No settlements match the selected filters</p>
                  <p className="text-xs opacity-60">Try adjusting the date range, merchant, or clearing filters</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>ID</TableHead>
                        <TableHead>Merchant</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Period</TableHead>
                        <TableHead className="text-right">Requested (₹)</TableHead>
                        <TableHead className="text-right">Settled (₹)</TableHead>
                        <TableHead className="text-right">Fees (₹)</TableHead>
                        <TableHead className="text-right">Txns</TableHead>
                        <TableHead>UTR / Reference</TableHead>
                        <TableHead>Paid At</TableHead>
                        <TableHead>Created</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {stlLoading
                        ? Array.from({ length: 5 }).map((_, i) => (
                            <TableRow key={i}>
                              {Array.from({ length: 10 }).map((__, j) => (
                                <TableCell key={j}><div className="h-4 w-full bg-muted animate-pulse rounded" /></TableCell>
                              ))}
                            </TableRow>
                          ))
                        : settlements.slice(0, 100).map((s) => (
                            <TableRow key={s.id}>
                              <TableCell className="font-mono text-xs text-muted-foreground">#{s.id}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {s.merchantName ?? "—"}
                              </TableCell>
                              <TableCell>
                                <span className={`text-xs font-medium capitalize ${settlementStatusColor(s.status)}`}>
                                  {s.status}
                                </span>
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                                {s.periodFrom && s.periodTo ? `${s.periodFrom} → ${s.periodTo}` : "—"}
                              </TableCell>
                              <TableCell className="text-right text-xs text-muted-foreground">
                                {s.requestedAmount != null ? fmt(Number(s.requestedAmount)) : "—"}
                              </TableCell>
                              <TableCell className="text-right font-medium text-sm">
                                {fmt(Number(s.amount))}
                              </TableCell>
                              <TableCell className="text-right text-xs text-muted-foreground">
                                {Number(s.fees ?? 0) > 0 ? fmt(Number(s.fees)) : "—"}
                              </TableCell>
                              <TableCell className="text-right text-xs text-muted-foreground">
                                {s.transactionCount.toLocaleString("en-IN")}
                              </TableCell>
                              <TableCell className="font-mono text-xs text-muted-foreground">
                                {s.referenceNumber ?? "—"}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                                {s.paidAt ? format(new Date(s.paidAt), "dd MMM yyyy") : "—"}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                                {format(new Date(s.createdAt), "dd MMM yyyy")}
                              </TableCell>
                            </TableRow>
                          ))}
                    </TableBody>
                  </Table>
                  {settlements.length > 100 && (
                    <div className="text-center py-3 text-xs text-muted-foreground border-t border-border/50">
                      Showing first 100 of {settlements.length.toLocaleString("en-IN")} settlements — download the full report to see all rows
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Delivery History Tab ────────────────────────────────────────── */}
        <TabsContent value="delivery-history" className="space-y-6">
          <DeliveryHistoryPanel />
        </TabsContent>
      </Tabs>

      <ScheduledReportsPanel />
    </div>
  );
}
