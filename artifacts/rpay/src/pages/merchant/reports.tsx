import { useState, useCallback, useRef, useEffect } from "react";
import { useQueries } from "@tanstack/react-query";
import { useCrossTabSync } from "@/hooks/use-cross-tab-sync";
import {
  useGetTransactionReport,
  useGetSettlementReport,
  useListMerchantConnections,
  useListMerchantSavedFilters,
  useCreateMerchantSavedFilter,
  useDeleteMerchantSavedFilter,
  useRenameMerchantSavedFilter,
  useReorderMerchantSavedFilters,
  useGetReportSchedule,
  useUpsertReportSchedule,
  useDeleteReportSchedule,
  useSendReportNow,
  useReenableReportSchedule,
  useRetryReportDeliveryLog,
  getGetTransactionReportCountQueryOptions,
  getGetSettlementReportCountQueryOptions,
  useGetReportScheduleHistory,
} from "@workspace/api-client-react";
import { AllFiltersSheet } from "@/components/merchant/all-filters-sheet";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FormatBadge } from "@/components/ui/format-badge";
import { FrequencyBadge } from "@/components/ui/frequency-badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/ui/status-badge";
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
  QrCode,
  Building2,
  Link2,
  Coins,
  Banknote,
  Hash,
  Wallet,
  TrendingUp,
  Bookmark,
  BookmarkCheck,
  Pencil,
  ChevronLeft,
  ChevronRight,
  X,
  Layers,
  Bell,
  BellOff,
  Mail,
  Send,
  CalendarDays,
  Trash2,
  PlayCircle,
  AlertTriangle,
  History,
  PauseCircle,
  Check,
  RotateCcw,
} from "lucide-react";
import { format, formatDistanceToNow, subDays, startOfMonth, endOfMonth, subMonths, parseISO } from "date-fns";
import { toast } from "sonner";
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

function getThisMonthDefault(): { from: string; to: string } {
  const now = new Date();
  return { from: format(startOfMonth(now), "yyyy-MM-dd"), to: format(now, "yyyy-MM-dd") };
}

const PROVIDERS = [
  { value: "phonepe", label: "phonepe" },
  { value: "paytm", label: "paytm" },
  { value: "bharatpe", label: "bharatpe" },
  { value: "yono_sbi", label: "yono_sbi" },
  { value: "hdfc_smarthub", label: "hdfc_smarthub" },
  { value: "upi_id", label: "UPI ID" },
];

interface ReportsFilterData {
  dateFrom?: string;
  dateTo?: string;
  type?: string;
  status?: string;
  connectionProvider?: string;
  source?: string;
}

interface ReportsSavedFilter {
  id: string;
  name: string;
  filterData: ReportsFilterData;
  rawInput: string;
}

const REPORTS_SAVED_FILTERS_KEY = "rasokart_merchant_reports_saved_filters";
const CUSTOM_DATE_PRESETS_KEY = "rasokart_custom_date_presets";
const DATE_LOCK_KEY = "rasokart_reports_date_locked";
const TX_DATE_FROM_KEY = "rasokart_reports_tx_date_from";
const TX_DATE_TO_KEY = "rasokart_reports_tx_date_to";
const STL_DATE_FROM_KEY = "rasokart_reports_stl_date_from";
const STL_DATE_TO_KEY = "rasokart_reports_stl_date_to";
const TX_TYPE_KEY = "rasokart_reports_tx_type";
const TX_STATUS_KEY = "rasokart_reports_tx_status";
const TX_SOURCE_KEY = "rasokart_reports_tx_source";
const TX_CONNECTION_PROVIDER_KEY = "rasokart_reports_tx_connection_provider";
const STL_STATUS_KEY = "rasokart_reports_stl_status";
const HISTORY_FORMAT_FILTER_KEY = "rasokart_schedule_history_format_filter";
const HISTORY_DATE_FROM_KEY = "rasokart_schedule_history_date_from";
const HISTORY_DATE_TO_KEY = "rasokart_schedule_history_date_to";
const HISTORY_TRIGGERED_BY_KEY = "rasokart_schedule_history_triggered_by";
const SCHEDULE_FREQUENCY_KEY = "rasokart_schedule_frequency";
const SCHEDULE_FORMAT_KEY = "rasokart_schedule_format";
const SCHEDULE_DAY_OF_WEEK_KEY = "rasokart_schedule_day_of_week";
const SCHEDULE_DAY_OF_MONTH_KEY = "rasokart_schedule_day_of_month";
const ACTIVE_REPORT_TAB_KEY = "rasokart_reports_active_tab";

interface CustomDatePreset {
  id: string;
  name: string;
  from: string;
  to: string;
}

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

function loadReportsFilters(): ReportsSavedFilter[] {
  try {
    const raw = localStorage.getItem(REPORTS_SAVED_FILTERS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ReportsSavedFilter[];
  } catch {
    return [];
  }
}

function storeReportsFilters(filters: ReportsSavedFilter[]): void {
  try {
    localStorage.setItem(REPORTS_SAVED_FILTERS_KEY, JSON.stringify(filters));
  } catch {}
}

function buildReportsRawInput(fd: ReportsFilterData): string {
  const parts: string[] = [];
  if (fd.type) parts.push(fd.type.charAt(0).toUpperCase() + fd.type.slice(1));
  if (fd.status) parts.push(fd.status.charAt(0).toUpperCase() + fd.status.slice(1));
  if (fd.source) parts.push(fd.source.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()));
  if (fd.connectionProvider) parts.push(fd.connectionProvider.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()));
  if (fd.dateFrom && fd.dateTo) parts.push(`${fd.dateFrom} – ${fd.dateTo}`);
  else if (fd.dateFrom) parts.push(`From ${fd.dateFrom}`);
  else if (fd.dateTo) parts.push(`Until ${fd.dateTo}`);
  return parts.length > 0 ? parts.join(" · ") : "All filters";
}

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

const DOW_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

function domLabel(day: number): string {
  if (day === 1 || day === 21) return `${day}st`;
  if (day === 2 || day === 22) return `${day}nd`;
  if (day === 3 || day === 23) return `${day}rd`;
  return `${day}th`;
}

function getNextDue(lastSentAt: string | null | undefined, frequency: string): Date | null {
  if (!lastSentAt) return null;
  const last = new Date(lastSentAt);
  const days = frequency === "monthly" ? 28 : frequency === "daily" ? 1 : 7;
  return new Date(last.getTime() + days * 24 * 60 * 60 * 1000);
}

function scheduleSendOnLabel(schedule: { frequency: string; dayOfWeek?: number | null; dayOfMonth?: number | null }): string {
  if (schedule.frequency === "weekly") {
    if (schedule.dayOfWeek != null) return `Sends every ${DOW_LABELS[schedule.dayOfWeek]}`;
    return "Sends on a rolling 7-day cadence";
  }
  if (schedule.dayOfMonth != null) return `Sends on the ${domLabel(schedule.dayOfMonth)} of each month`;
  return "Sends on a rolling 30-day cadence";
}

function SchedulePanel() {
  const queryClient = useQueryClient();
  const { data: scheduleData, isLoading: scheduleLoading } = useGetReportSchedule();
  const schedule = scheduleData?.schedule ?? null;

  const [retriedLogIds, setRetriedLogIds] = useState<Set<number>>(new Set());
  const [pendingRetryId, setPendingRetryId] = useState<number | null>(null);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyFormatFilter, setHistoryFormatFilter] = useState<"all" | "xlsx" | "pdf">(() => {
    try {
      const v = localStorage.getItem(HISTORY_FORMAT_FILTER_KEY);
      return (v === "xlsx" || v === "pdf" ? v : "all") as "all" | "xlsx" | "pdf";
    } catch { return "all"; }
  });
  const [historyDateFrom, setHistoryDateFrom] = useState<string>(() => {
    try { return localStorage.getItem(HISTORY_DATE_FROM_KEY) ?? ""; } catch { return ""; }
  });
  const [historyDateTo, setHistoryDateTo] = useState<string>(() => {
    try { return localStorage.getItem(HISTORY_DATE_TO_KEY) ?? ""; } catch { return ""; }
  });
  const [historyTriggeredBy, setHistoryTriggeredBy] = useState<"all" | "manual" | "scheduler">(() => {
    try {
      const v = localStorage.getItem(HISTORY_TRIGGERED_BY_KEY);
      return (v === "manual" || v === "scheduler" ? v : "all") as "all" | "manual" | "scheduler";
    } catch { return "all"; }
  });

  useEffect(() => {
    try {
      if (historyFormatFilter !== "all") localStorage.setItem(HISTORY_FORMAT_FILTER_KEY, historyFormatFilter);
      else localStorage.removeItem(HISTORY_FORMAT_FILTER_KEY);
    } catch {}
  }, [historyFormatFilter]);

  useEffect(() => {
    try {
      if (historyDateFrom) localStorage.setItem(HISTORY_DATE_FROM_KEY, historyDateFrom);
      else localStorage.removeItem(HISTORY_DATE_FROM_KEY);
    } catch {}
  }, [historyDateFrom]);

  useEffect(() => {
    try {
      if (historyDateTo) localStorage.setItem(HISTORY_DATE_TO_KEY, historyDateTo);
      else localStorage.removeItem(HISTORY_DATE_TO_KEY);
    } catch {}
  }, [historyDateTo]);

  useEffect(() => {
    try {
      if (historyTriggeredBy !== "all") localStorage.setItem(HISTORY_TRIGGERED_BY_KEY, historyTriggeredBy);
      else localStorage.removeItem(HISTORY_TRIGGERED_BY_KEY);
    } catch {}
  }, [historyTriggeredBy]);

  const historyParams: Record<string, unknown> = { limit: 50 };
  if (historyFormatFilter !== "all") historyParams["format"] = historyFormatFilter;
  if (historyDateFrom) historyParams["dateFrom"] = historyDateFrom;
  if (historyDateTo) historyParams["dateTo"] = historyDateTo;
  if (historyTriggeredBy !== "all") historyParams["triggeredBy"] = historyTriggeredBy;

  const { data: historyData, isLoading: historyLoading } = useGetReportScheduleHistory(
    historyParams as Parameters<typeof useGetReportScheduleHistory>[0],
    { query: { enabled: !!schedule } as any },
  );
  const deliveryLogs = historyData?.logs ?? [];

  const [frequency, setFrequency] = useState<"weekly" | "monthly">("weekly");
  const [fileFormat, setFileFormat] = useState<"xlsx" | "pdf">("xlsx");
  const [dayOfWeek, setDayOfWeek] = useState<number | null>(1);
  const [dayOfMonth, setDayOfMonth] = useState<number | null>(1);
  const [autoPauseAfterFailures, setAutoPauseAfterFailures] = useState<number>(3);
  const [hasInitialized, setHasInitialized] = useState(false);

  if (!hasInitialized && !scheduleLoading && schedule) {
    setFrequency(schedule.frequency as "weekly" | "monthly");
    setFileFormat(schedule.format as "xlsx" | "pdf");
    setDayOfWeek((schedule as any).dayOfWeek ?? 1);
    setDayOfMonth((schedule as any).dayOfMonth ?? 1);
    setAutoPauseAfterFailures(schedule.autoPauseAfterFailures);
    setHasInitialized(true);
  }
  if (!hasInitialized && !scheduleLoading && !schedule) {
    try {
      const savedFreq = localStorage.getItem(SCHEDULE_FREQUENCY_KEY);
      if (savedFreq === "weekly" || savedFreq === "monthly") setFrequency(savedFreq);
      const savedFormat = localStorage.getItem(SCHEDULE_FORMAT_KEY);
      if (savedFormat === "xlsx" || savedFormat === "pdf") setFileFormat(savedFormat);
      const savedDow = localStorage.getItem(SCHEDULE_DAY_OF_WEEK_KEY);
      if (savedDow !== null) setDayOfWeek(parseInt(savedDow));
      const savedDom = localStorage.getItem(SCHEDULE_DAY_OF_MONTH_KEY);
      if (savedDom !== null) setDayOfMonth(parseInt(savedDom));
    } catch {}
    setHasInitialized(true);
  }

  useEffect(() => {
    if (!hasInitialized) return;
    try {
      localStorage.setItem(SCHEDULE_FREQUENCY_KEY, frequency);
      localStorage.setItem(SCHEDULE_FORMAT_KEY, fileFormat);
      if (dayOfWeek !== null) localStorage.setItem(SCHEDULE_DAY_OF_WEEK_KEY, String(dayOfWeek));
      if (dayOfMonth !== null) localStorage.setItem(SCHEDULE_DAY_OF_MONTH_KEY, String(dayOfMonth));
    } catch {}
  }, [hasInitialized, frequency, fileFormat, dayOfWeek, dayOfMonth]);

  const upsert = useUpsertReportSchedule();
  const deleteMut = useDeleteReportSchedule();
  const sendNow = useSendReportNow();
  const reenable = useReenableReportSchedule();
  const retryDelivery = useRetryReportDeliveryLog();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/reports/schedule"] });
    queryClient.invalidateQueries({ queryKey: ["/api/reports/schedule/history"] });
  };

  const handleRetryDelivery = (logId: number) => {
    setPendingRetryId(logId);
    retryDelivery.mutate({ id: logId }, {
      onSuccess: () => {
        setRetriedLogIds((prev) => new Set(prev).add(logId));
        toast.success("Report resent successfully.");
        invalidate();
      },
      onError: () => toast.error("Failed to resend report — check your SMTP configuration."),
      onSettled: () => setPendingRetryId(null),
    });
  };

  const handleReenable = () => {
    reenable.mutate(undefined, {
      onSuccess: () => {
        toast.success("Schedule re-enabled — your reports will resume as normal.");
        invalidate();
      },
      onError: () => toast.error("Failed to re-enable schedule"),
    });
  };

  const handleRetryNow = () => {
    sendNow.mutate(undefined, {
      onSuccess: (data) => {
        reenable.mutate(undefined, {
          onSuccess: () => {
            toast.success(`Report delivered to ${(data as any).to} — schedule re-enabled.`);
            invalidate();
          },
          onError: () => {
            toast.success(`Report delivered to ${(data as any).to}.`);
            invalidate();
          },
        });
      },
      onError: () => {
        toast.error("Delivery failed — see updated failure log below.");
        invalidate();
      },
    });
  };

  const handleSave = () => {
    const data: Record<string, unknown> = { frequency, format: fileFormat, isActive: true, autoPauseAfterFailures };
    if (frequency === "weekly") data["dayOfWeek"] = dayOfWeek;
    else data["dayOfMonth"] = dayOfMonth;
    upsert.mutate(
      { data: data as Parameters<typeof upsert.mutate>[0]["data"] },
      {
        onSuccess: () => {
          toast.success("Report schedule saved");
          invalidate();
        },
        onError: () => toast.error("Failed to save schedule"),
      },
    );
  };

  const handleToggle = (active: boolean) => {
    upsert.mutate(
      { data: { isActive: active } },
      {
        onSuccess: () => {
          toast.success(active ? "Schedule enabled" : "Schedule paused");
          invalidate();
        },
        onError: () => toast.error("Failed to update schedule"),
      },
    );
  };

  const handleDelete = () => {
    deleteMut.mutate(undefined, {
      onSuccess: () => {
        toast.success("Schedule removed");
        setHasInitialized(false);
        invalidate();
      },
      onError: () => toast.error("Failed to remove schedule"),
    });
  };

  const handleSendNow = () => {
    sendNow.mutate(undefined, {
      onSuccess: (data) => {
        toast.success(`Report sent to ${(data as any).to}`);
        invalidate();
      },
      onError: () => toast.error("Failed to send — check SMTP settings"),
    });
  };

  if (scheduleLoading) {
    return (
      <Card>
        <CardContent className="py-8 flex justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const isAutoPaused =
    schedule != null &&
    !schedule.isActive &&
    schedule.consecutiveFailures >= schedule.autoPauseAfterFailures &&
    schedule.consecutiveFailures > 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <CalendarDays className="w-4 h-4 text-primary" />
            Scheduled Reports
          </div>
          {schedule && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {schedule.isActive ? "Active" : "Paused"}
              </span>
              <Switch
                checked={schedule.isActive}
                onCheckedChange={handleToggle}
                disabled={upsert.isPending || isAutoPaused}
              />
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Automatically email your transaction report on a schedule. The report covers the previous week or month depending on frequency.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">

        {/* ─── Auto-pause banner ─────────────────────────────────────────── */}
        {isAutoPaused && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex items-start gap-3">
            <PauseCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-amber-300">Schedule auto-paused</p>
              <p className="text-xs text-amber-400/80 mt-0.5">
                Your schedule was automatically paused after reaching{" "}
                <span className="font-semibold text-amber-300">{schedule.consecutiveFailures} of {schedule.autoPauseAfterFailures}</span>{" "}
                consecutive delivery {schedule.consecutiveFailures === 1 ? "failure" : "failures"}. Re-enable it below once the issue is resolved.
              </p>

              {/* ─── Recent failure details ─── */}
              {(schedule as any).recentFailures && (schedule as any).recentFailures.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  <p className="text-xs font-medium text-amber-300/80">Recent delivery failures:</p>
                  {((schedule as any).recentFailures as Array<{ id: number; attemptedAt: string; failureReason?: string | null }>).map((f) => (
                    <div key={f.id} className="flex items-start gap-2 rounded border border-amber-500/20 bg-amber-500/5 px-2.5 py-1.5">
                      <XCircle className="w-3 h-3 text-red-400 shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className="text-xs text-amber-400/70">
                          {format(new Date(f.attemptedAt), "dd MMM yyyy, HH:mm")}
                        </p>
                        <p className="text-xs text-amber-300/90 mt-0.5 break-words">
                          {f.failureReason ?? "Unknown error"}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-3 flex items-center gap-4">
                <button
                  className="text-xs font-medium text-amber-300 underline underline-offset-2 hover:text-amber-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={handleRetryNow}
                  disabled={sendNow.isPending || reenable.isPending}
                >
                  {sendNow.isPending ? "Sending…" : "Retry now"}
                </button>
                <button
                  className="text-xs font-medium text-amber-300/70 underline underline-offset-2 hover:text-amber-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={handleReenable}
                  disabled={reenable.isPending || sendNow.isPending}
                >
                  {reenable.isPending && !sendNow.isPending ? "Resuming…" : "Resume schedule"}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Frequency</Label>
            <Select value={frequency} onValueChange={(v) => setFrequency(v as "weekly" | "monthly")}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="weekly">Weekly (last 7 days)</SelectItem>
                <SelectItem value="monthly">Monthly (last 30 days)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Format</Label>
            <Select value={fileFormat} onValueChange={(v) => setFileFormat(v as "xlsx" | "pdf")}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="xlsx">
                  <span className="flex items-center gap-1.5"><FileSpreadsheet className="w-3.5 h-3.5" />Excel (.xlsx)</span>
                </SelectItem>
                <SelectItem value="pdf">
                  <span className="flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" />PDF (.pdf)</span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Send on</Label>
          {frequency === "weekly" ? (
            <Select
              value={String(dayOfWeek ?? 1)}
              onValueChange={(v) => setDayOfWeek(parseInt(v))}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOW_LABELS.map((label, idx) => (
                  <SelectItem key={idx} value={String(idx)}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Select
              value={String(dayOfMonth ?? 1)}
              onValueChange={(v) => setDayOfMonth(parseInt(v))}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                  <SelectItem key={d} value={String(d)}>{domLabel(d)} of the month</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Auto-pause after</Label>
          <Select
            value={String(autoPauseAfterFailures)}
            onValueChange={(v) => setAutoPauseAfterFailures(parseInt(v))}
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n} consecutive {n === 1 ? "failure" : "failures"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground/70">
            The schedule pauses automatically when delivery fails this many times in a row.
          </p>
        </div>

        {schedule && !schedule.isActive && !isAutoPaused && (
          <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-amber-300">Schedule paused</p>
              <p className="text-xs text-amber-400/80 mt-0.5">
                This schedule is currently paused. Use the toggle above or the button here to resume automatic delivery.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={handleReenable}
              disabled={reenable.isPending}
              className="h-7 text-xs shrink-0 gap-1.5 border-amber-500/40 text-amber-400 hover:bg-amber-500/10 hover:text-amber-300 hover:border-amber-500/60"
            >
              {reenable.isPending
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <PlayCircle className="w-3.5 h-3.5" />}
              Resume schedule
            </Button>
          </div>
        )}

        {schedule && (
          <div className="rounded-lg bg-muted/40 border border-border/60 px-4 py-3 text-sm space-y-1.5">
            <div className="flex items-center gap-2 text-muted-foreground">
              <CalendarDays className="w-3.5 h-3.5 shrink-0 text-primary" />
              <span className="text-xs">{scheduleSendOnLabel(schedule as any)}</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Mail className="w-3.5 h-3.5 shrink-0" />
              <span className="text-xs">Report emailed to your registered merchant email address</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <FileSpreadsheet className="w-3.5 h-3.5 shrink-0" />
              <span className="text-xs mr-1">Format:</span>
              <FormatBadge format={schedule.format} />
            </div>
            {schedule.lastSentAt && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
                <span className="text-xs">
                  Last sent: {format(new Date(schedule.lastSentAt), "dd MMM yyyy, HH:mm")}{" "}
                  <span className="text-muted-foreground/60">({formatDistanceToNow(new Date(schedule.lastSentAt), { addSuffix: true })})</span>
                </span>
              </div>
            )}
            {!schedule.lastSentAt && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Clock className="w-3.5 h-3.5 shrink-0" />
                <span className="text-xs">No report sent yet — first report will go out on the next scheduled run</span>
              </div>
            )}
            {(() => {
              const nextDue = getNextDue(schedule.lastSentAt, schedule.frequency);
              if (!nextDue) return null;
              const isOverdue = nextDue < new Date();
              return (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Clock className={`w-3.5 h-3.5 shrink-0 ${isOverdue ? "text-amber-400" : "text-primary"}`} />
                  <span className="text-xs">
                    Next due: {format(nextDue, "dd MMM yyyy, HH:mm")}{" "}
                    <span className={isOverdue ? "text-amber-400/80" : "text-muted-foreground/60"}>
                      ({formatDistanceToNow(nextDue, { addSuffix: true })})
                    </span>
                  </span>
                </div>
              );
            })()}

            {/* ─── Delivery health ─── */}
            {schedule.lastDeliveryAt != null && (
              <div className="flex items-center gap-2 text-muted-foreground">
                {schedule.lastDeliverySuccess
                  ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
                  : <XCircle className="w-3.5 h-3.5 shrink-0 text-red-400" />}
                <span className="text-xs">
                  Last delivery:{" "}
                  <span className={schedule.lastDeliverySuccess ? "text-emerald-400" : "text-red-400"}>
                    {schedule.lastDeliverySuccess ? "succeeded" : "failed"}
                  </span>
                  {" "}· {format(new Date(schedule.lastDeliveryAt), "dd MMM yyyy, HH:mm")}{" "}
                  <span className="text-muted-foreground/60">
                    ({formatDistanceToNow(new Date(schedule.lastDeliveryAt), { addSuffix: true })})
                  </span>
                </span>
              </div>
            )}
            {schedule.sevenDayTotal != null && schedule.sevenDayTotal > 0 && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <BarChart3 className="w-3.5 h-3.5 shrink-0 text-primary" />
                <span className="text-xs">
                  7-day delivery:{" "}
                  <span className={
                    (schedule.sevenDaySuccesses ?? 0) === schedule.sevenDayTotal
                      ? "text-emerald-400"
                      : (schedule.sevenDaySuccesses ?? 0) === 0
                      ? "text-red-400"
                      : "text-amber-400"
                  }>
                    {schedule.sevenDaySuccesses ?? 0} of {schedule.sevenDayTotal} delivered
                  </span>
                </span>
              </div>
            )}
            {schedule.sevenDayTotal != null && schedule.sevenDayTotal === 0 && schedule.lastDeliveryAt == null && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <BarChart3 className="w-3.5 h-3.5 shrink-0" />
                <span className="text-xs text-muted-foreground/60">No deliveries in the last 7 days</span>
              </div>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            onClick={handleSave}
            disabled={upsert.isPending}
            className="h-8"
          >
            {upsert.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Bell className="w-3.5 h-3.5 mr-1.5" />}
            {schedule ? "Update Schedule" : "Enable Schedule"}
          </Button>

          {schedule && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={handleSendNow}
                disabled={sendNow.isPending}
                className="h-8"
              >
                {sendNow.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Send className="w-3.5 h-3.5 mr-1.5" />}
                Send Now
              </Button>

              <Button
                size="sm"
                variant="ghost"
                onClick={handleDelete}
                disabled={deleteMut.isPending}
                className="h-8 text-destructive hover:text-destructive"
              >
                {deleteMut.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5 mr-1.5" />}
                Remove
              </Button>
            </>
          )}
        </div>

        {/* ─── Delivery History ──────────────────────────────────────────── */}
        {schedule && (
          <div className="pt-2 border-t border-border/50">
            <button
              type="button"
              onClick={() => setHistoryOpen((o) => !o)}
              className="flex items-center gap-2 w-full text-left group mb-0"
            >
              <History className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <span className="text-xs font-medium text-muted-foreground group-hover:text-foreground transition-colors">
                Delivery History
              </span>
              {schedule.consecutiveFailures > 0 && (
                <span className="flex items-center gap-1 text-xs text-amber-400 shrink-0">
                  <AlertTriangle className="w-3 h-3" />
                  {schedule.consecutiveFailures}/{schedule.autoPauseAfterFailures} consecutive {schedule.consecutiveFailures === 1 ? "failure" : "failures"}
                </span>
              )}
              <ChevronRight
                className={`w-3.5 h-3.5 text-muted-foreground ml-auto shrink-0 transition-transform duration-200 ${historyOpen ? "rotate-90" : ""}`}
              />
            </button>

            {historyOpen && (
              <div className="mt-3 space-y-3">
              {/* Format filter pill buttons */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground">Format:</span>
                <div className="flex items-center gap-1">
                {(["all", "xlsx", "pdf"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setHistoryFormatFilter(f)}
                    className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                      historyFormatFilter === f
                        ? f === "xlsx"
                          ? "bg-emerald-600/20 text-emerald-400 border border-emerald-600/40"
                          : f === "pdf"
                          ? "bg-blue-600/20 text-blue-400 border border-blue-600/40"
                          : "bg-primary/15 text-primary border border-primary/30"
                        : "text-muted-foreground border border-border/50 hover:border-border hover:text-foreground"
                    }`}
                  >
                    {f === "all" ? "All formats" : f.toUpperCase()}
                  </button>
                ))}
                </div>
              </div>

              {/* Triggered-by filter pill buttons */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground">Triggered by:</span>
                <div className="flex items-center gap-1">
                {(["all", "manual", "scheduler"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setHistoryTriggeredBy(t)}
                    className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                      historyTriggeredBy === t
                        ? t === "manual"
                          ? "bg-violet-600/20 text-violet-400 border border-violet-600/40"
                          : t === "scheduler"
                          ? "bg-amber-600/20 text-amber-400 border border-amber-600/40"
                          : "bg-primary/15 text-primary border border-primary/30"
                        : "text-muted-foreground border border-border/50 hover:border-border hover:text-foreground"
                    }`}
                  >
                    {t === "all" ? "All" : t === "manual" ? "Manual" : "Scheduler"}
                  </button>
                ))}
                </div>
              </div>

            {/* Date-range filter row */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <CalendarRange className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="text-xs text-muted-foreground">Date range:</span>
                <div className="flex items-center gap-1 flex-wrap">
                  {DATE_PRESETS.map((preset) => {
                    const range = preset.getRange();
                    const isActive = historyDateFrom === range.from && historyDateTo === range.to;
                    return (
                      <button
                        key={preset.label}
                        onClick={() => { setHistoryDateFrom(range.from); setHistoryDateTo(range.to); }}
                        className={`px-2 py-0.5 rounded text-xs font-medium transition-colors border ${
                          isActive
                            ? "bg-primary/15 text-primary border-primary/30"
                            : "text-muted-foreground border-border/50 hover:border-border hover:text-foreground"
                        }`}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                  <button
                    onClick={() => { setHistoryDateFrom(""); setHistoryDateTo(""); }}
                    className={`px-2 py-0.5 rounded text-xs font-medium transition-colors border ${
                      !historyDateFrom && !historyDateTo
                        ? "bg-primary/15 text-primary border-primary/30"
                        : "text-muted-foreground border-border/50 hover:border-border hover:text-foreground"
                    }`}
                  >
                    All time
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap pl-5">
                <Input
                  type="date"
                  value={historyDateFrom}
                  onChange={(e) => setHistoryDateFrom(e.target.value)}
                  className="h-7 text-xs w-36 px-2 min-w-0"
                  placeholder="From"
                />
                <span className="text-xs text-muted-foreground">–</span>
                <Input
                  type="date"
                  value={historyDateTo}
                  onChange={(e) => setHistoryDateTo(e.target.value)}
                  min={historyDateFrom || undefined}
                  className="h-7 text-xs w-36 px-2 min-w-0"
                  placeholder="To"
                />
                {(historyDateFrom || historyDateTo) && (
                  <button
                    onClick={() => { setHistoryDateFrom(""); setHistoryDateTo(""); }}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5"
                  >
                    <X className="w-3 h-3" />
                    Clear
                  </button>
                )}
              </div>
            </div>

            {/* Clear all filters */}
            {(historyFormatFilter !== "all" || historyTriggeredBy !== "all" || historyDateFrom || historyDateTo) && (
              <div className="flex justify-end">
                <button
                  onClick={() => {
                    setHistoryFormatFilter("all");
                    setHistoryTriggeredBy("all");
                    setHistoryDateFrom("");
                    setHistoryDateTo("");
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5"
                >
                  <X className="w-3 h-3" />
                  Clear filters
                </button>
              </div>
            )}

            {historyLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            ) : deliveryLogs.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">
                {historyFormatFilter !== "all" || historyTriggeredBy !== "all" || historyDateFrom || historyDateTo
                  ? "No deliveries match the selected filters."
                  : "No delivery history yet — logs appear here after your first scheduled send."}
              </p>
            ) : (
              <>
              <div className="rounded-lg border border-border/50 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent border-border/50">
                      <TableHead className="text-xs py-2 h-auto">Date &amp; Time</TableHead>
                      <TableHead className="text-xs py-2 h-auto">Frequency</TableHead>
                      <TableHead className="text-xs py-2 h-auto">Format</TableHead>
                      <TableHead className="text-xs py-2 h-auto">Triggered By</TableHead>
                      <TableHead className="text-xs py-2 h-auto">Outcome</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {deliveryLogs.map((log) => (
                      <TableRow key={log.id} className="border-border/40 hover:bg-muted/30">
                        <TableCell className="py-2 text-xs text-muted-foreground whitespace-nowrap">
                          {format(new Date(log.attemptedAt), "dd MMM yyyy, HH:mm")}
                        </TableCell>
                        <TableCell className="py-2">
                          <FrequencyBadge frequency={log.frequency} />
                        </TableCell>
                        <TableCell className="py-2">
                          <FormatBadge format={log.format} />
                        </TableCell>
                        <TableCell className="py-2">
                          {log.triggeredBy === "manual" || log.triggeredBy === "bulk" ? (
                            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-violet-600/15 text-violet-400 border border-violet-600/30">
                              <Send className="w-2.5 h-2.5" />
                              {log.triggeredByEmail ? `Manual — ${log.triggeredByEmail}` : "Manual"}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-sky-600/15 text-sky-400 border border-sky-600/30">
                              <RotateCcw className="w-2.5 h-2.5" />
                              Scheduled
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="py-2">
                          {log.outcome === "re-enabled" ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400">
                              <PlayCircle className="w-3 h-3" />
                              Re-enabled
                            </span>
                          ) : log.isAutoPause ? (
                            <div className="space-y-1">
                              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-amber-600/15 text-amber-400 border border-amber-600/30">
                                <PauseCircle className="w-2.5 h-2.5" />
                                Auto-paused
                              </span>
                              {log.failureReason && (
                                <p className="text-xs text-amber-400/70 leading-tight break-words max-w-[220px]">
                                  {log.failureReason}
                                </p>
                              )}
                              {(log.maxAttempts != null || log.backoffBaseMs != null) && (
                                <div className="flex items-center gap-2 pt-0.5 flex-wrap">
                                  {log.maxAttempts != null && (
                                    <span className="text-[10px] text-muted-foreground bg-muted rounded px-1.5 py-0.5">
                                      Max retries: <span className="text-foreground/70 font-medium">{log.maxAttempts}</span>
                                    </span>
                                  )}
                                  {log.backoffBaseMs != null && (
                                    <span className="text-[10px] text-muted-foreground bg-muted rounded px-1.5 py-0.5">
                                      Backoff base: <span className="text-foreground/70 font-medium">{log.backoffBaseMs}ms</span>
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          ) : log.success ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400">
                              <CheckCircle2 className="w-3 h-3" />
                              Delivered
                            </span>
                          ) : retriedLogIds.has(log.id) ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400">
                              <Check className="w-3 h-3" />
                              Retried
                            </span>
                          ) : (
                            <div className="space-y-0.5">
                              <span className="inline-flex items-center gap-1 text-xs font-medium text-red-400">
                                <XCircle className="w-3 h-3" />
                                Failed
                              </span>
                              {log.failureReason && (
                                <p className="text-xs text-red-400/70 leading-tight break-words max-w-[200px]">
                                  {log.failureReason}
                                </p>
                              )}
                              <button
                                onClick={() => handleRetryDelivery(log.id)}
                                disabled={pendingRetryId === log.id}
                                className="mt-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium border border-primary/30 text-primary hover:bg-primary/10 hover:border-primary/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {pendingRetryId === log.id ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <RotateCcw className="w-3 h-3" />
                                )}
                                {pendingRetryId === log.id ? "Retrying…" : "Retry"}
                              </button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {deliveryLogs[0]?.isAutoPause && !schedule.isActive && (
                <div className="mt-3 flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/8 px-3 py-2.5">
                  <PauseCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <p className="flex-1 text-xs text-amber-400/90">
                    Schedule was auto-paused after repeated failures. Fix the delivery issue, then re-enable to resume.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleReenable}
                    disabled={reenable.isPending}
                    className="h-7 text-xs shrink-0 gap-1.5 border-amber-500/40 text-amber-400 hover:bg-amber-500/10 hover:text-amber-300 hover:border-amber-500/60"
                  >
                    {reenable.isPending
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <PlayCircle className="w-3.5 h-3.5" />}
                    Re-enable schedule
                  </Button>
                </div>
              )}
              </>
            )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DeliveryHealthBanner() {
  const queryClient = useQueryClient();
  const { data: scheduleData, isLoading } = useGetReportSchedule({
    query: {
      refetchInterval: (data: any) =>
        (data?.schedule?.consecutiveFailures ?? 1) > 0 ? 60_000 : false,
      refetchIntervalInBackground: false,
    } as any,
  });
  const reenable = useReenableReportSchedule();
  const schedule = scheduleData?.schedule ?? null;

  if (isLoading || !schedule) return null;

  const isAutoPaused =
    !schedule.isActive &&
    schedule.consecutiveFailures >= schedule.autoPauseAfterFailures &&
    schedule.consecutiveFailures > 0;

  const hasFailures = schedule.consecutiveFailures > 0;

  if (!hasFailures) return null;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/reports/schedule"] });
    queryClient.invalidateQueries({ queryKey: ["/api/reports/schedule/history"] });
  };

  const handleReenable = () => {
    reenable.mutate(undefined, {
      onSuccess: () => {
        toast.success("Schedule re-enabled — your reports will resume as normal.");
        invalidate();
      },
      onError: () => toast.error("Failed to re-enable schedule"),
    });
  };

  if (isAutoPaused) {
    return (
      <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 flex items-start gap-3">
        <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-red-300">Report schedule auto-paused</p>
          <p className="text-xs text-red-400/80 mt-0.5">
            Delivery failed{" "}
            <span className="font-semibold text-red-300">
              {schedule.consecutiveFailures} consecutive {schedule.consecutiveFailures === 1 ? "time" : "times"}
            </span>{" "}
            and the schedule has been auto-paused. Fix your email settings, then re-enable below.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={handleReenable}
          disabled={reenable.isPending}
          className="shrink-0 h-8 text-xs gap-1.5 border-red-500/40 text-red-400 hover:bg-red-500/10 hover:text-red-300 hover:border-red-500/60"
        >
          {reenable.isPending
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <PlayCircle className="w-3.5 h-3.5" />}
          Re-enable
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex items-center gap-3">
      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
      <p className="flex-1 text-sm text-amber-300">
        <span className="font-semibold">
          {schedule.consecutiveFailures} consecutive delivery {schedule.consecutiveFailures === 1 ? "failure" : "failures"}
        </span>{" "}
        — your schedule is still active but may be auto-paused if failures continue. Check the Schedule section below for details.
      </p>
    </div>
  );
}

export default function MerchantReports() {
  const [activeTab, setActiveTab] = useState<string>(() => {
    try {
      const v = localStorage.getItem(ACTIVE_REPORT_TAB_KEY);
      return v === "settlements" ? "settlements" : "transactions";
    } catch {
      return "transactions";
    }
  });

  const handleTabChange = useCallback((tab: string) => {
    setActiveTab(tab);
    try { localStorage.setItem(ACTIVE_REPORT_TAB_KEY, tab); } catch {}
  }, []);

  // Transaction filter state
  const [txDateFrom, setTxDateFrom] = useState(() => {
    try { const v = localStorage.getItem(TX_DATE_FROM_KEY); if (v) return v; } catch {}
    return format(startOfMonth(new Date()), "yyyy-MM-dd");
  });
  const [txDateTo, setTxDateTo] = useState(() => {
    try { const v = localStorage.getItem(TX_DATE_TO_KEY); if (v) return v; } catch {}
    return format(new Date(), "yyyy-MM-dd");
  });
  const [type, setType] = useState(() => {
    try { const v = localStorage.getItem(TX_TYPE_KEY); if (v) return v; } catch {}
    return "all";
  });
  const [txStatus, setTxStatus] = useState(() => {
    try { const v = localStorage.getItem(TX_STATUS_KEY); if (v) return v; } catch {}
    return "all";
  });
  const [connectionProvider, setConnectionProvider] = useState(() => {
    try { const v = localStorage.getItem(TX_CONNECTION_PROVIDER_KEY); if (v) return v; } catch {}
    return "all";
  });
  const [source, setSource] = useState(() => {
    try { const v = localStorage.getItem(TX_SOURCE_KEY); if (v) return v; } catch {}
    return "all";
  });
  const [txActivePreset, setTxActivePreset] = useState<string | null>(null);
  const [txExporting, setTxExporting] = useState<"pdf" | "xlsx" | null>(null);

  // Settlement filter state
  const [stlDateFrom, setStlDateFrom] = useState(() => {
    try { const v = localStorage.getItem(STL_DATE_FROM_KEY); if (v) return v; } catch {}
    return format(startOfMonth(new Date()), "yyyy-MM-dd");
  });
  const [stlDateTo, setStlDateTo] = useState(() => {
    try { const v = localStorage.getItem(STL_DATE_TO_KEY); if (v) return v; } catch {}
    return format(new Date(), "yyyy-MM-dd");
  });
  const [stlStatus, setStlStatus] = useState(() => {
    try { const v = localStorage.getItem(STL_STATUS_KEY); if (v) return v; } catch {}
    return "all";
  });
  const [settlementId, setSettlementId] = useState("");
  const [stlActivePreset, setStlActivePreset] = useState<string | null>(null);
  const [stlExporting, setStlExporting] = useState<"pdf" | "xlsx" | null>(null);

  // Saved filters state
  const FILTER_CONTEXT = "merchant_reports";
  const filtersInitialized = useRef(false);
  const [savedFilters, setSavedFilters] = useState<ReportsSavedFilter[]>(() => loadReportsFilters());
  const [customDatePresets, setCustomDatePresets] = useState<CustomDatePreset[]>(() => loadCustomDatePresets());

  useCrossTabSync([
    {
      key: REPORTS_SAVED_FILTERS_KEY,
      onUpdate: (raw) => {
        try { setSavedFilters(raw ? (JSON.parse(raw) as ReportsSavedFilter[]) : []); }
        catch { setSavedFilters([]); }
      },
    },
    {
      key: CUSTOM_DATE_PRESETS_KEY,
      onUpdate: (raw) => {
        try { setCustomDatePresets(raw ? (JSON.parse(raw) as CustomDatePreset[]) : []); }
        catch { setCustomDatePresets([]); }
      },
    },
  ]);

  const [showAllFilters, setShowAllFilters] = useState(false);
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [saveFilterName, setSaveFilterName] = useState("");
  const [saveFilterNameError, setSaveFilterNameError] = useState("");
  const saveNameInputRef = useRef<HTMLInputElement>(null);
  const dragIdRef = useRef<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  const { data: serverFiltersData, isSuccess: serverFiltersLoaded } = useListMerchantSavedFilters(
    { context: FILTER_CONTEXT },
    { query: { staleTime: Infinity, retry: false } as any },
  );
  const { mutateAsync: createFilterMutation } = useCreateMerchantSavedFilter();
  const { mutateAsync: deleteFilterMutation } = useDeleteMerchantSavedFilter();
  const { mutateAsync: renameFilterMutation } = useRenameMerchantSavedFilter();
  const { mutateAsync: reorderFilterMutation } = useReorderMerchantSavedFilters();

  // Custom date preset server sync
  const PRESET_CONTEXT = "merchant_reports_date_presets";
  const presetsInitialized = useRef(false);
  const { data: serverPresetsData, isSuccess: serverPresetsLoaded } = useListMerchantSavedFilters(
    { context: PRESET_CONTEXT },
    { query: { staleTime: Infinity, retry: false } as any },
  );
  const { mutateAsync: createPresetMutation } = useCreateMerchantSavedFilter();
  const { mutateAsync: deletePresetMutation } = useDeleteMerchantSavedFilter();
  const { mutateAsync: renamePresetMutation } = useRenameMerchantSavedFilter();
  const { mutateAsync: reorderPresetMutation } = useReorderMerchantSavedFilters();

  // Save date preset UI state — TX tab
  const [txShowSaveDatePreset, setTxShowSaveDatePreset] = useState(false);
  const [txSaveDatePresetName, setTxSaveDatePresetName] = useState("");
  const [txSaveDatePresetNameError, setTxSaveDatePresetNameError] = useState("");
  const txSaveDatePresetNameRef = useRef<HTMLInputElement>(null);

  // Save date preset UI state — STL tab
  const [stlShowSaveDatePreset, setStlShowSaveDatePreset] = useState(false);
  const [stlSaveDatePresetName, setStlSaveDatePresetName] = useState("");
  const [stlSaveDatePresetNameError, setStlSaveDatePresetNameError] = useState("");
  const stlSaveDatePresetNameRef = useRef<HTMLInputElement>(null);

  // Date lock state — persisted to localStorage
  const [dateLocked, setDateLocked] = useState<boolean>(() => {
    try { return localStorage.getItem(DATE_LOCK_KEY) === "true"; }
    catch { return false; }
  });

  const toggleDateLock = () => {
    const next = !dateLocked;
    setDateLocked(next);
    try { localStorage.setItem(DATE_LOCK_KEY, String(next)); }
    catch {}
    if (next) {
      setStlDateFrom(txDateFrom);
      setStlDateTo(txDateTo);
      setStlActivePreset(txActivePreset);
    }
  };

  // Persist date range values to localStorage whenever they change
  useEffect(() => { try { localStorage.setItem(TX_DATE_FROM_KEY, txDateFrom); } catch {} }, [txDateFrom]);
  useEffect(() => { try { localStorage.setItem(TX_DATE_TO_KEY, txDateTo); } catch {} }, [txDateTo]);
  useEffect(() => { try { localStorage.setItem(STL_DATE_FROM_KEY, stlDateFrom); } catch {} }, [stlDateFrom]);
  useEffect(() => { try { localStorage.setItem(STL_DATE_TO_KEY, stlDateTo); } catch {} }, [stlDateTo]);

  // Persist dropdown filter values to localStorage whenever they change
  useEffect(() => { try { localStorage.setItem(TX_TYPE_KEY, type); } catch {} }, [type]);
  useEffect(() => { try { localStorage.setItem(TX_STATUS_KEY, txStatus); } catch {} }, [txStatus]);
  useEffect(() => { try { localStorage.setItem(TX_SOURCE_KEY, source); } catch {} }, [source]);
  useEffect(() => { try { localStorage.setItem(TX_CONNECTION_PROVIDER_KEY, connectionProvider); } catch {} }, [connectionProvider]);
  useEffect(() => { try { localStorage.setItem(STL_STATUS_KEY, stlStatus); } catch {} }, [stlStatus]);

  // Rename/drag state for custom date preset chips (shared across both tabs)
  const [renamingPresetId, setRenamingPresetId] = useState<string | null>(null);
  const [renamePresetValue, setRenamePresetValue] = useState("");
  const renamePresetInputRef = useRef<HTMLInputElement>(null);
  const dragPresetIdRef = useRef<string | null>(null);
  const [draggingPresetId, setDraggingPresetId] = useState<string | null>(null);
  const [dragOverPresetId, setDragOverPresetId] = useState<string | null>(null);

  useListMerchantConnections();

  const txParams = {
    dateFrom: txDateFrom || undefined,
    dateTo: txDateTo || undefined,
    type: type !== "all" ? (type as "deposit" | "withdrawal") : undefined,
    status: txStatus !== "all" ? (txStatus as "pending" | "success" | "failed") : undefined,
    connectionProvider: connectionProvider !== "all" ? (connectionProvider as "phonepe" | "paytm" | "bharatpe" | "yono_sbi" | "hdfc_smarthub" | "upi_id") : undefined,
    source: source !== "all" ? (source as "qr_code" | "virtual_account" | "payment_link" | "direct") : undefined,
  };

  const stlParams = {
    dateFrom: stlDateFrom || undefined,
    dateTo: stlDateTo || undefined,
    status: stlStatus !== "all" ? (stlStatus as "pending" | "processing" | "approved" | "rejected" | "paid" | "cancelled") : undefined,
    settlementId: settlementId ? parseInt(settlementId) : undefined,
  };

  const { data: txData, isLoading: txLoading, isFetching: txFetching } = useGetTransactionReport(txParams);
  const { data: stlData, isLoading: stlLoading, isFetching: stlFetching } = useGetSettlementReport(stlParams);

  const transactions = txData?.data ?? [];
  const txStats = txData?.stats;
  const settlements = stlData?.data ?? [];
  const stlStats = stlData?.stats;

  // Build ordered list of all date ranges for preset count badges
  const txCountNonDateFilters = {
    type: type !== "all" ? (type as "deposit" | "withdrawal") : undefined,
    status: txStatus !== "all" ? (txStatus as "pending" | "success" | "failed") : undefined,
    connectionProvider: connectionProvider !== "all" ? (connectionProvider as "phonepe" | "paytm" | "bharatpe" | "yono_sbi" | "hdfc_smarthub" | "upi_id") : undefined,
    source: source !== "all" ? (source as "qr_code" | "virtual_account" | "payment_link" | "direct") : undefined,
  };
  const stlCountNonDateFilters = {
    status: stlStatus !== "all" ? (stlStatus as "pending" | "processing" | "approved" | "rejected" | "paid" | "cancelled") : undefined,
  };

  const txPresetRanges = [
    ...DATE_PRESETS.map((p) => { const r = p.getRange(); return { key: p.label, from: r.from, to: r.to }; }),
    ...customDatePresets.map((p) => ({ key: p.id, from: p.from, to: p.to })),
  ];
  const stlPresetRanges = [
    ...DATE_PRESETS.map((p) => { const r = p.getRange(); return { key: p.label, from: r.from, to: r.to }; }),
    ...customDatePresets.map((p) => ({ key: p.id, from: p.from, to: p.to })),
  ];

  const txCountResults = useQueries({
    queries: txPresetRanges.map(({ from, to }) => ({
      ...getGetTransactionReportCountQueryOptions({ dateFrom: from, dateTo: to, ...txCountNonDateFilters }),
      staleTime: 60_000,
    })),
  });
  const stlCountResults = useQueries({
    queries: stlPresetRanges.map(({ from, to }) => ({
      ...getGetSettlementReportCountQueryOptions({ dateFrom: from, dateTo: to, ...stlCountNonDateFilters }),
      staleTime: 60_000,
    })),
  });

  const txCountMap: Record<string, { count: number | undefined; loading: boolean }> = {};
  txPresetRanges.forEach((r, i) => {
    txCountMap[r.key] = { count: txCountResults[i]?.data?.count, loading: txCountResults[i]?.isLoading ?? false };
  });
  const stlCountMap: Record<string, { count: number | undefined; loading: boolean }> = {};
  stlPresetRanges.forEach((r, i) => {
    stlCountMap[r.key] = { count: stlCountResults[i]?.data?.count, loading: stlCountResults[i]?.isLoading ?? false };
  });

  const txSavedFilterCountResults = useQueries({
    queries: savedFilters.map((saved) => {
      const fd = saved.filterData;
      return getGetTransactionReportCountQueryOptions({
        dateFrom: fd.dateFrom || undefined,
        dateTo: fd.dateTo || undefined,
        type: fd.type as "deposit" | "withdrawal" | undefined,
        status: fd.status as "pending" | "success" | "failed" | undefined,
        connectionProvider: fd.connectionProvider as "phonepe" | "paytm" | "bharatpe" | "yono_sbi" | "hdfc_smarthub" | "upi_id" | undefined,
        source: fd.source as "qr_code" | "virtual_account" | "payment_link" | "direct" | undefined,
      });
    }),
  });

  const stlSavedFilterCountResults = useQueries({
    queries: savedFilters.map((saved) => {
      const fd = saved.filterData;
      return getGetSettlementReportCountQueryOptions({
        dateFrom: fd.dateFrom || undefined,
        dateTo: fd.dateTo || undefined,
      });
    }),
  });

  const txSavedCountMap: Record<string, { count: number | undefined; loading: boolean }> = {};
  savedFilters.forEach((saved, i) => {
    txSavedCountMap[saved.id] = { count: txSavedFilterCountResults[i]?.data?.count, loading: txSavedFilterCountResults[i]?.isLoading ?? false };
  });

  const stlSavedCountMap: Record<string, { count: number | undefined; loading: boolean }> = {};
  savedFilters.forEach((saved, i) => {
    stlSavedCountMap[saved.id] = { count: stlSavedFilterCountResults[i]?.data?.count, loading: stlSavedFilterCountResults[i]?.isLoading ?? false };
  });

  useEffect(() => {
    if (!serverFiltersLoaded || filtersInitialized.current) return;
    filtersInitialized.current = true;
    const serverFilters: ReportsSavedFilter[] = (serverFiltersData?.data ?? []).map((f) => ({
      id: String(f.id),
      name: f.name,
      filterData: f.filterData as ReportsFilterData,
      rawInput: f.rawInput,
    }));
    if (serverFilters.length > 0) {
      setSavedFilters(serverFilters);
      storeReportsFilters(serverFilters);
    } else {
      const local = loadReportsFilters();
      if (local.length > 0) {
        (async () => {
          const imported: ReportsSavedFilter[] = [];
          for (const f of local) {
            try {
              const created = await createFilterMutation({
                data: { name: f.name, rawInput: f.rawInput, filterData: f.filterData as Record<string, unknown>, context: FILTER_CONTEXT },
              });
              imported.push({
                id: String(created.id),
                name: created.name,
                filterData: created.filterData as ReportsFilterData,
                rawInput: created.rawInput,
              });
            } catch { /* skip duplicates or errors */ }
          }
          if (imported.length > 0) {
            setSavedFilters(imported);
            storeReportsFilters(imported);
          }
        })();
      }
    }
  }, [serverFiltersLoaded, serverFiltersData]);

  useEffect(() => {
    if (!serverPresetsLoaded || presetsInitialized.current) return;
    presetsInitialized.current = true;
    const serverPresets: CustomDatePreset[] = (serverPresetsData?.data ?? []).map((f) => ({
      id: String(f.id),
      name: f.name,
      from: (f.filterData as Record<string, string>)["from"] ?? "",
      to: (f.filterData as Record<string, string>)["to"] ?? "",
    }));
    if (serverPresets.length > 0) {
      setCustomDatePresets(serverPresets);
      storeCustomDatePresets(serverPresets);
    } else {
      const local = loadCustomDatePresets();
      if (local.length > 0) {
        (async () => {
          const imported: CustomDatePreset[] = [];
          for (const p of local) {
            try {
              const created = await createPresetMutation({
                data: { name: p.name, rawInput: `${p.from} to ${p.to}`, filterData: { from: p.from, to: p.to }, context: PRESET_CONTEXT },
              });
              imported.push({
                id: String(created.id),
                name: created.name,
                from: (created.filterData as Record<string, string>)["from"] ?? p.from,
                to: (created.filterData as Record<string, string>)["to"] ?? p.to,
              });
            } catch { /* skip duplicates */ }
          }
          if (imported.length > 0) {
            setCustomDatePresets(imported);
            storeCustomDatePresets(imported);
          }
        })();
      }
    }
  }, [serverPresetsLoaded, serverPresetsData]);

  useEffect(() => {
    if (showSaveInput) setTimeout(() => saveNameInputRef.current?.focus(), 50);
  }, [showSaveInput]);

  useEffect(() => {
    if (renamingId) setTimeout(() => renameInputRef.current?.focus(), 50);
  }, [renamingId]);

  useEffect(() => {
    if (txShowSaveDatePreset) setTimeout(() => txSaveDatePresetNameRef.current?.focus(), 50);
  }, [txShowSaveDatePreset]);

  useEffect(() => {
    if (stlShowSaveDatePreset) setTimeout(() => stlSaveDatePresetNameRef.current?.focus(), 50);
  }, [stlShowSaveDatePreset]);

  useEffect(() => {
    if (renamingPresetId) setTimeout(() => renamePresetInputRef.current?.focus(), 50);
  }, [renamingPresetId]);

  const applyTxPreset = (preset: typeof DATE_PRESETS[number]) => {
    const range = preset.getRange();
    setTxDateFrom(range.from);
    setTxDateTo(range.to);
    setTxActivePreset(preset.label);
    if (dateLocked) {
      setStlDateFrom(range.from);
      setStlDateTo(range.to);
      setStlActivePreset(preset.label);
    }
  };

  const applyStlPreset = (preset: typeof DATE_PRESETS[number]) => {
    const range = preset.getRange();
    setStlDateFrom(range.from);
    setStlDateTo(range.to);
    setStlActivePreset(preset.label);
    if (dateLocked) {
      setTxDateFrom(range.from);
      setTxDateTo(range.to);
      setTxActivePreset(preset.label);
    }
  };

  const applyCustomPresetTx = (preset: CustomDatePreset) => {
    setTxDateFrom(preset.from);
    setTxDateTo(preset.to);
    setTxActivePreset(null);
    setTxShowSaveDatePreset(false);
    if (dateLocked) {
      setStlDateFrom(preset.from);
      setStlDateTo(preset.to);
      setStlActivePreset(null);
    }
  };

  const applyCustomPresetStl = (preset: CustomDatePreset) => {
    setStlDateFrom(preset.from);
    setStlDateTo(preset.to);
    setStlActivePreset(null);
    setStlShowSaveDatePreset(false);
    if (dateLocked) {
      setTxDateFrom(preset.from);
      setTxDateTo(preset.to);
      setTxActivePreset(null);
    }
  };

  const confirmSaveDatePreset = async (from: string, to: string, name: string, setName: (v: string) => void, setError: (v: string) => void, setShow: (v: boolean) => void, nameRef: React.RefObject<HTMLInputElement | null>) => {
    const trimmed = name.trim();
    if (!trimmed) { setError("Please enter a name for this preset."); nameRef.current?.focus(); return; }
    if (customDatePresets.some(p => p.name.toLowerCase() === trimmed.toLowerCase())) {
      setError("A preset with this name already exists."); nameRef.current?.focus(); return;
    }
    try {
      const created = await createPresetMutation({
        data: { name: trimmed, rawInput: `${from} to ${to}`, filterData: { from, to }, context: PRESET_CONTEXT },
      });
      const newPreset: CustomDatePreset = {
        id: String(created.id),
        name: created.name,
        from: (created.filterData as Record<string, string>)["from"] ?? from,
        to: (created.filterData as Record<string, string>)["to"] ?? to,
      };
      const updated = [...customDatePresets, newPreset];
      setCustomDatePresets(updated);
      storeCustomDatePresets(updated);
    } catch {
      toast.error("Failed to save preset. Please try again.");
    }
    setShow(false);
    setName("");
    setError("");
  };

  const deleteCustomDatePreset = async (id: string) => {
    const updated = customDatePresets.filter(p => p.id !== id);
    setCustomDatePresets(updated);
    storeCustomDatePresets(updated);
    if (renamingPresetId === id) setRenamingPresetId(null);
    const numericId = parseInt(id);
    if (!isNaN(numericId)) {
      try { await deletePresetMutation({ id: numericId }); } catch { /* optimistic */ }
    }
  };

  const moveCustomDatePreset = async (id: string, dir: -1 | 1) => {
    const idx = customDatePresets.findIndex(p => p.id === id);
    if (idx === -1) return;
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= customDatePresets.length) return;
    const updated = [...customDatePresets];
    [updated[idx], updated[newIdx]] = [updated[newIdx]!, updated[idx]!];
    setCustomDatePresets(updated);
    storeCustomDatePresets(updated);
    const ids = updated.map(p => parseInt(p.id)).filter(n => !isNaN(n));
    reorderPresetMutation({ data: { ids, context: PRESET_CONTEXT } }).catch(() => {});
  };

  const handlePresetDragStart = (id: string) => { dragPresetIdRef.current = id; setDraggingPresetId(id); };
  const handlePresetDragOver = (e: React.DragEvent, id: string) => { e.preventDefault(); if (dragPresetIdRef.current !== id) setDragOverPresetId(id); };
  const handlePresetDragLeave = () => { setDragOverPresetId(null); };
  const handlePresetDrop = (targetId: string) => {
    const sourceId = dragPresetIdRef.current;
    setDragOverPresetId(null); setDraggingPresetId(null); dragPresetIdRef.current = null;
    if (!sourceId || sourceId === targetId) return;
    const fromIdx = customDatePresets.findIndex(p => p.id === sourceId);
    const toIdx = customDatePresets.findIndex(p => p.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const updated = [...customDatePresets];
    const [item] = updated.splice(fromIdx, 1);
    updated.splice(toIdx, 0, item!);
    setCustomDatePresets(updated);
    storeCustomDatePresets(updated);
    const ids = updated.map(p => parseInt(p.id)).filter(n => !isNaN(n));
    reorderPresetMutation({ data: { ids, context: PRESET_CONTEXT } }).catch(() => {});
  };
  const handlePresetDragEnd = () => { dragPresetIdRef.current = null; setDraggingPresetId(null); setDragOverPresetId(null); };

  const startRenamePreset = (preset: CustomDatePreset) => { setRenamingPresetId(preset.id); setRenamePresetValue(preset.name); };
  const cancelRenamePreset = () => { setRenamingPresetId(null); };
  const commitRenamePreset = async () => {
    if (!renamingPresetId) return;
    const trimmed = renamePresetValue.trim();
    if (!trimmed) { setRenamingPresetId(null); return; }
    if (customDatePresets.some(p => p.id !== renamingPresetId && p.name.toLowerCase() === trimmed.toLowerCase())) {
      toast.error("A preset with this name already exists.");
      return;
    }
    const updated = customDatePresets.map(p => p.id === renamingPresetId ? { ...p, name: trimmed } : p);
    setCustomDatePresets(updated);
    storeCustomDatePresets(updated);
    setRenamingPresetId(null);
    const numericId = parseInt(renamingPresetId);
    if (!isNaN(numericId)) {
      try { await renamePresetMutation({ id: numericId, data: { name: trimmed } }); } catch { /* optimistic */ }
    }
  };

  const applySavedFilter = (saved: ReportsSavedFilter) => {
    const fd = saved.filterData;
    setTxDateFrom(fd.dateFrom ?? format(startOfMonth(new Date()), "yyyy-MM-dd"));
    setTxDateTo(fd.dateTo ?? format(new Date(), "yyyy-MM-dd"));
    setType(fd.type ?? "all");
    setTxStatus(fd.status ?? "all");
    setConnectionProvider(fd.connectionProvider ?? "all");
    setSource(fd.source ?? "all");
    setTxActivePreset(null);
    setShowSaveInput(false);
    setSaveFilterName("");
    setSaveFilterNameError("");
  };

  const currentFilterData: ReportsFilterData = {
    dateFrom: txDateFrom || undefined,
    dateTo: txDateTo || undefined,
    type: type !== "all" ? type : undefined,
    status: txStatus !== "all" ? txStatus : undefined,
    connectionProvider: connectionProvider !== "all" ? connectionProvider : undefined,
    source: source !== "all" ? source : undefined,
  };

  const hasAnyFilter = type !== "all" || txStatus !== "all" || connectionProvider !== "all" || source !== "all";

  const isCurrentFilterSaved = hasAnyFilter && savedFilters.some(
    (f) => JSON.stringify(f.filterData) === JSON.stringify(currentFilterData),
  );

  // Custom date preset computed values
  const isCustomTxPresetActive = (preset: CustomDatePreset) => txDateFrom === preset.from && txDateTo === preset.to;
  const isCustomStlPresetActive = (preset: CustomDatePreset) => stlDateFrom === preset.from && stlDateTo === preset.to;

  const txIsBuiltInPresetActive = DATE_PRESETS.some(p => { const r = p.getRange(); return txDateFrom === r.from && txDateTo === r.to; });
  const stlIsBuiltInPresetActive = DATE_PRESETS.some(p => { const r = p.getRange(); return stlDateFrom === r.from && stlDateTo === r.to; });

  const txIsCustomDateAlreadySaved = customDatePresets.some(p => p.from === txDateFrom && p.to === txDateTo);
  const stlIsCustomDateAlreadySaved = customDatePresets.some(p => p.from === stlDateFrom && p.to === stlDateTo);

  const txCanSaveDatePreset = !!(txDateFrom && txDateTo) && !txIsBuiltInPresetActive && !txIsCustomDateAlreadySaved;
  const stlCanSaveDatePreset = !!(stlDateFrom && stlDateTo) && !stlIsBuiltInPresetActive && !stlIsCustomDateAlreadySaved;

  const formatDateLabel = (dateStr: string): string => {
    try { return format(parseISO(dateStr), "d MMM yyyy"); }
    catch { return dateStr; }
  };

  const buildRangeSummary = (
    dateFrom: string,
    dateTo: string,
    activePreset: string | null,
  ): string => {
    const hasFrom = !!dateFrom;
    const hasTo = !!dateTo;

    let presetLabel: string | null = activePreset;
    if (!presetLabel && hasFrom && hasTo) {
      const matched = customDatePresets.find(p => p.from === dateFrom && p.to === dateTo);
      if (matched) presetLabel = matched.name;
    }

    if (!hasFrom && !hasTo) return "All time";
    if (hasFrom && hasTo) {
      const range = `${formatDateLabel(dateFrom)} – ${formatDateLabel(dateTo)}`;
      return presetLabel ? `${presetLabel} · ${range}` : `Custom range · ${range}`;
    }
    if (hasFrom) return `From ${formatDateLabel(dateFrom)}`;
    return `Until ${formatDateLabel(dateTo)}`;
  };

  const txIsStale = (() => {
    const d = getThisMonthDefault();
    return txDateFrom !== d.from || txDateTo !== d.to;
  })();
  const stlIsStale = (() => {
    const d = getThisMonthDefault();
    return stlDateFrom !== d.from || stlDateTo !== d.to;
  })();

  const resetTxToThisMonth = () => {
    const d = getThisMonthDefault();
    setTxDateFrom(d.from);
    setTxDateTo(d.to);
    setTxActivePreset(null);
    if (dateLocked) {
      setStlDateFrom(d.from);
      setStlDateTo(d.to);
      setStlActivePreset(null);
    }
  };

  const resetStlToThisMonth = () => {
    const d = getThisMonthDefault();
    setStlDateFrom(d.from);
    setStlDateTo(d.to);
    setStlActivePreset(null);
    if (dateLocked) {
      setTxDateFrom(d.from);
      setTxDateTo(d.to);
      setTxActivePreset(null);
    }
  };

  const openSaveInput = () => {
    setSaveFilterName("");
    setSaveFilterNameError("");
    setShowSaveInput(true);
  };

  const confirmSaveFilter = async () => {
    const trimmed = saveFilterName.trim();
    if (!trimmed) { setSaveFilterNameError("Please enter a name."); saveNameInputRef.current?.focus(); return; }
    if (savedFilters.some((f) => f.name.toLowerCase() === trimmed.toLowerCase())) {
      setSaveFilterNameError("A filter with this name already exists."); saveNameInputRef.current?.focus(); return;
    }
    const rawInput = buildReportsRawInput(currentFilterData);
    try {
      const created = await createFilterMutation({
        data: { name: trimmed, rawInput, filterData: currentFilterData as Record<string, unknown>, context: FILTER_CONTEXT },
      });
      const newFilter: ReportsSavedFilter = {
        id: String(created.id),
        name: created.name,
        filterData: created.filterData as ReportsFilterData,
        rawInput: created.rawInput,
      };
      const updatedFilters = [...savedFilters, newFilter];
      setSavedFilters(updatedFilters);
      storeReportsFilters(updatedFilters);
      setShowSaveInput(false);
      setSaveFilterName("");
      setSaveFilterNameError("");
    } catch {
      toast.error("Failed to save filter. Please try again.");
    }
  };

  const cancelSaveFilter = () => { setShowSaveInput(false); setSaveFilterName(""); setSaveFilterNameError(""); };

  const deleteSavedFilter = async (id: string) => {
    const updated = savedFilters.filter((f) => f.id !== id);
    setSavedFilters(updated);
    storeReportsFilters(updated);
    if (renamingId === id) setRenamingId(null);
    const numericId = parseInt(id);
    if (!isNaN(numericId)) {
      try { await deleteFilterMutation({ id: numericId }); } catch { /* optimistic */ }
    }
  };

  const moveSavedFilter = async (id: string, dir: -1 | 1) => {
    const idx = savedFilters.findIndex((f) => f.id === id);
    if (idx === -1) return;
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= savedFilters.length) return;
    const updated = [...savedFilters];
    [updated[idx], updated[newIdx]] = [updated[newIdx]!, updated[idx]!];
    setSavedFilters(updated);
    storeReportsFilters(updated);
    const ids = updated.map((f) => parseInt(f.id)).filter((n) => !isNaN(n));
    reorderFilterMutation({ data: { ids, context: FILTER_CONTEXT } }).catch(() => {});
  };

  const handleDragStart = (id: string) => { dragIdRef.current = id; setDraggingId(id); };
  const handleDragOver = (e: React.DragEvent, id: string) => { e.preventDefault(); if (dragIdRef.current !== id) setDragOverId(id); };
  const handleDragLeave = () => { setDragOverId(null); };
  const handleDrop = (targetId: string) => {
    const sourceId = dragIdRef.current;
    setDragOverId(null); setDraggingId(null); dragIdRef.current = null;
    if (!sourceId || sourceId === targetId) return;
    const fromIdx = savedFilters.findIndex((f) => f.id === sourceId);
    const toIdx = savedFilters.findIndex((f) => f.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const updated = [...savedFilters];
    const [item] = updated.splice(fromIdx, 1);
    updated.splice(toIdx, 0, item!);
    setSavedFilters(updated);
    storeReportsFilters(updated);
    const ids = updated.map((f) => parseInt(f.id)).filter((n) => !isNaN(n));
    reorderFilterMutation({ data: { ids, context: FILTER_CONTEXT } }).catch(() => {});
  };
  const handleDragEnd = () => { dragIdRef.current = null; setDraggingId(null); setDragOverId(null); };

  const startRename = (saved: ReportsSavedFilter) => { setRenamingId(saved.id); setRenameValue(saved.name); };
  const commitRename = async () => {
    if (!renamingId) return;
    const trimmed = renameValue.trim();
    if (!trimmed) { setRenamingId(null); return; }
    if (savedFilters.some((f) => f.id !== renamingId && f.name.toLowerCase() === trimmed.toLowerCase())) {
      toast.error("A filter with this name already exists."); return;
    }
    const updated = savedFilters.map((f) => f.id === renamingId ? { ...f, name: trimmed } : f);
    setSavedFilters(updated);
    storeReportsFilters(updated);
    setRenamingId(null);
    const numericId = parseInt(renamingId);
    if (!isNaN(numericId)) {
      try { await renameFilterMutation({ id: numericId, data: { name: trimmed } }); } catch { /* optimistic */ }
    }
  };
  const cancelRename = () => { setRenamingId(null); };

  // ── Transaction exports ───────────────────────────────────────────────────
  const exportTxExcel = useCallback(async () => {
    if (!transactions.length) { toast.error("No data to export"); return; }
    setTxExporting("xlsx");
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();

      const summaryRows = [
        ["RasoKart — Transaction Report"],
        [`Generated: ${format(new Date(), "dd/MM/yyyy HH:mm")}`],
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
        ["Date", "UTR", "Reference ID", "Type", "Status", "Settlement Status", "Amount (₹)", "Fee (₹)", "Currency", "Source", "Provider", "Description"],
        ...transactions.map((t) => {
          const src = t.qrCodeId ? "QR Code" : t.virtualAccountId ? "Virtual Account" : t.paymentLinkId ? "Payment Link" : "Direct";
          return [
            format(new Date(t.createdAt), "dd/MM/yyyy HH:mm"),
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
      ws2["!cols"] = [{ wch: 18 }, { wch: 22 }, { wch: 18 }, { wch: 12 }, { wch: 10 }, { wch: 16 }, { wch: 14 }, { wch: 12 }, { wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 30 }];
      XLSX.utils.book_append_sheet(wb, ws2, "Transactions");

      XLSX.writeFile(wb, `rasokart-tx-report-${format(new Date(), "yyyy-MM-dd")}.xlsx`);
      toast.success("Excel report downloaded");
    } catch {
      toast.error("Failed to export Excel");
    } finally {
      setTxExporting(null);
    }
  }, [transactions, txStats, txDateFrom, txDateTo]);

  const exportTxPDF = useCallback(async () => {
    if (!transactions.length) { toast.error("No data to export"); return; }
    setTxExporting("pdf");
    try {
      const { jsPDF } = await import("jspdf");
      const { default: autoTable } = await import("jspdf-autotable");

      const doc = new jsPDF({ orientation: "landscape" });

      doc.setFontSize(18);
      doc.setFont("helvetica", "bold");
      doc.text("RasoKart — Transaction Report", 14, 18);

      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(120, 120, 120);
      doc.text(`Generated: ${format(new Date(), "dd/MM/yyyy HH:mm")}`, 14, 26);
      doc.text(`Period: ${txDateFrom || "All time"} → ${txDateTo || "All time"}`, 14, 32);
      doc.setTextColor(0, 0, 0);

      autoTable(doc, {
        startY: 40,
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
        head: [["Date", "UTR", "Type", "Status", "Settlement", "Amount (₹)", "Fee (₹)", "Source", "Provider"]],
        body: transactions.map((t) => {
          const src = t.qrCodeId ? "QR Code" : t.virtualAccountId ? "Virtual Account" : t.paymentLinkId ? "Payment Link" : "Direct";
          return [
            format(new Date(t.createdAt), "dd/MM/yy HH:mm"),
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
        styles: { fontSize: 8 },
        columnStyles: {
          0: { cellWidth: 26 },
          1: { cellWidth: 36 },
          2: { cellWidth: 20 },
          3: { cellWidth: 18 },
          4: { cellWidth: 22 },
          5: { cellWidth: 26, halign: "right" },
          6: { cellWidth: 20, halign: "right" },
          7: { cellWidth: 24 },
          8: { cellWidth: "auto" },
        },
      });

      doc.save(`rasokart-tx-report-${format(new Date(), "yyyy-MM-dd")}.pdf`);
      toast.success("PDF report downloaded");
    } catch {
      toast.error("Failed to export PDF");
    } finally {
      setTxExporting(null);
    }
  }, [transactions, txStats, txDateFrom, txDateTo]);

  // ── Settlement exports ────────────────────────────────────────────────────
  const exportStlExcel = useCallback(async () => {
    if (!settlements.length) { toast.error("No data to export"); return; }
    setStlExporting("xlsx");
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();

      const summaryRows = [
        ["RasoKart — Settlement Report"],
        [`Generated: ${format(new Date(), "dd/MM/yyyy HH:mm")}`],
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
        ["Settlement ID", "Status", "Period From", "Period To", "Requested Amount (₹)", "Settled Amount (₹)", "Fees (₹)", "Transactions", "UTR / Reference", "Paid At", "Created At"],
        ...settlements.map((s) => [
          s.id,
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
      ws2["!cols"] = [{ wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 22 }, { wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 28 }, { wch: 20 }, { wch: 20 }];
      XLSX.utils.book_append_sheet(wb, ws2, "Settlements");

      XLSX.writeFile(wb, `rasokart-settlement-report-${format(new Date(), "yyyy-MM-dd")}.xlsx`);
      toast.success("Excel report downloaded");
    } catch {
      toast.error("Failed to export Excel");
    } finally {
      setStlExporting(null);
    }
  }, [settlements, stlStats, stlDateFrom, stlDateTo]);

  const exportStlPDF = useCallback(async () => {
    if (!settlements.length) { toast.error("No data to export"); return; }
    setStlExporting("pdf");
    try {
      const { jsPDF } = await import("jspdf");
      const { default: autoTable } = await import("jspdf-autotable");

      const doc = new jsPDF({ orientation: "landscape" });

      doc.setFontSize(18);
      doc.setFont("helvetica", "bold");
      doc.text("RasoKart — Settlement Report", 14, 18);

      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(120, 120, 120);
      doc.text(`Generated: ${format(new Date(), "dd/MM/yyyy HH:mm")}`, 14, 26);
      doc.text(`Period: ${stlDateFrom || "All time"} → ${stlDateTo || "All time"}`, 14, 32);
      doc.setTextColor(0, 0, 0);

      autoTable(doc, {
        startY: 40,
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
        head: [["ID", "Status", "Period", "Requested (₹)", "Settled (₹)", "Fees (₹)", "Txns", "UTR / Ref", "Paid At", "Created"]],
        body: settlements.map((s) => [
          `#${s.id}`,
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
        styles: { fontSize: 8 },
        columnStyles: {
          0: { cellWidth: 12 },
          1: { cellWidth: 20 },
          2: { cellWidth: 32 },
          3: { cellWidth: 24, halign: "right" },
          4: { cellWidth: 24, halign: "right" },
          5: { cellWidth: 18, halign: "right" },
          6: { cellWidth: 12, halign: "right" },
          7: { cellWidth: 36 },
          8: { cellWidth: 20 },
          9: { cellWidth: "auto" },
        },
      });

      doc.save(`rasokart-settlement-report-${format(new Date(), "yyyy-MM-dd")}.pdf`);
      toast.success("PDF report downloaded");
    } catch {
      toast.error("Failed to export PDF");
    } finally {
      setStlExporting(null);
    }
  }, [settlements, stlStats, stlDateFrom, stlDateTo]);

  const isTxExporting = txExporting !== null;
  const isStlExporting = stlExporting !== null;
  const txNoData = !txLoading && transactions.length === 0;
  const stlNoData = !stlLoading && settlements.length === 0;
  const rangesMatch = txDateFrom === stlDateFrom && txDateTo === stlDateTo;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-primary" />
            Reports
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Generate and download reports for any date range
          </p>
        </div>
      </div>
      <DeliveryHealthBanner />
      <SchedulePanel />

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <TabsList>
            <TabsTrigger value="transactions" className="gap-2">
              <FileText className="w-4 h-4" />
              Transactions
            </TabsTrigger>
            <TabsTrigger value="settlements" className="gap-2">
              <Banknote className="w-4 h-4" />
              Settlements
            </TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-2">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className={[
                      "inline-flex items-center gap-1 h-6 px-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-400 text-[11px] font-medium select-none",
                      "transition-all duration-200 ease-in-out",
                      rangesMatch && !dateLocked
                        ? "opacity-100 translate-y-0 pointer-events-auto"
                        : "opacity-0 -translate-y-1 pointer-events-none",
                    ].join(" ")}
                    aria-hidden={!(rangesMatch && !dateLocked)}
                  >
                    <Check className="w-3 h-3" />
                    Ranges match
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[220px] text-center">
                  Both tabs are showing the same date range.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={toggleDateLock}
                    className={[
                      "inline-flex items-center gap-1.5 h-8 px-3 rounded-md border text-xs font-medium transition-colors",
                      dateLocked
                        ? "border-primary/50 bg-primary/10 text-primary hover:bg-primary/20"
                        : "border-border/60 bg-transparent text-muted-foreground hover:text-foreground hover:border-border",
                    ].join(" ")}
                    aria-label={dateLocked ? "Date ranges are synced — click to unlock" : "Click to sync date ranges across both tabs"}
                  >
                    <Link2 className={`w-3.5 h-3.5 ${dateLocked ? "text-primary" : ""}`} />
                    {dateLocked ? "Dates synced" : "Sync dates"}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[220px] text-center">
                  {dateLocked
                    ? "Date ranges are synced across both tabs — changing one updates the other. Click to unlock."
                    : "Click to sync date ranges across both tabs so changes in one tab mirror to the other."}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>

        {/* u2500u2500 Transactions Tab u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500 */} 
        <TabsContent value="transactions" className="space-y-6">
          <div className="flex items-center justify-end gap-2 flex-wrap">
            <div className="flex items-center gap-1 bg-muted/50 p-1 rounded-md border border-border/50">
              {DATE_PRESETS.map((p) => {
                const txCnt = txCountMap[p.label];
                return (
                  <Button
                    key={p.label}
                    variant={txActivePreset === p.label ? "secondary" : "ghost"}
                    size="sm"
                    className="h-7 text-xs px-2.5"
                    onClick={() => applyTxPreset(p)}
                  >
                    {p.label}
                    {txCnt?.loading ? (
                      <Loader2 className="w-2.5 h-2.5 ml-1 animate-spin opacity-40" />
                    ) : txCnt?.count !== undefined ? (
                      <span className="ml-1 opacity-50 font-normal tabular-nums">· {txCnt.count.toLocaleString("en-IN")}</span>
                    ) : null}
                  </Button>
                );
              })}
            </div>
            {customDatePresets.map((preset, idx) => {
              const txCnt = txCountMap[preset.id];
              return (
              <span
                key={preset.id}
                draggable={renamingPresetId !== preset.id}
                onDragStart={() => handlePresetDragStart(preset.id)}
                onDragOver={(e) => handlePresetDragOver(e, preset.id)}
                onDragLeave={handlePresetDragLeave}
                onDrop={() => handlePresetDrop(preset.id)}
                onDragEnd={handlePresetDragEnd}
                className={[
                  "group inline-flex items-center gap-0.5 rounded-md border text-xs font-medium transition-colors select-none",
                  renamingPresetId !== preset.id ? "cursor-grab active:cursor-grabbing" : "",
                  isCustomTxPresetActive(preset)
                    ? "border-primary/60 bg-primary/15 text-primary"
                    : "border-sky-500/30 bg-sky-500/8 text-sky-300 hover:border-sky-500/60",
                  draggingPresetId === preset.id ? "opacity-40 scale-95" : "",
                  dragOverPresetId === preset.id && draggingPresetId !== preset.id ? "ring-1 ring-sky-400 border-sky-500/60 bg-sky-500/15" : "",
                ].filter(Boolean).join(" ")}
              >
                {idx > 0 && (
                  <button onClick={() => moveCustomDatePreset(preset.id, -1)} className="pl-1.5 pr-0.5 py-1 rounded-l-md text-sky-400/40 hover:text-sky-200 hover:bg-sky-500/10 transition-colors opacity-0 group-hover:opacity-100" aria-label="Move left" title="Move left">
                    <ChevronLeft className="w-3 h-3" />
                  </button>
                )}
                {idx === 0 && <span className="pl-2" />}
                {renamingPresetId === preset.id ? (
                  <input ref={renamePresetInputRef} className="w-28 bg-transparent border-b border-sky-400 text-sky-100 text-xs outline-none py-0.5 mx-1" value={renamePresetValue} onChange={e => setRenamePresetValue(e.target.value)} onKeyDown={e => { if (e.key === "Enter") commitRenamePreset(); if (e.key === "Escape") cancelRenamePreset(); }} onBlur={commitRenamePreset} maxLength={40} />
                ) : (
                  <>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button onClick={() => applyCustomPresetTx(preset)} className="p-0.5 text-sky-300 hover:text-sky-100 transition-colors" title={`Apply: ${preset.from} – ${preset.to}`}>
                            <CalendarRange className="w-3 h-3 shrink-0" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">Date range</p>
                          <p className="font-mono text-xs">{preset.from} – {preset.to}</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <button onClick={() => startRenamePreset(preset)} className="px-0.5 py-1 hover:text-sky-100 transition-colors" title="Click to rename">
                      {preset.name}
                      {txCnt?.loading ? (
                        <Loader2 className="w-2.5 h-2.5 ml-0.5 animate-spin opacity-40 inline" />
                      ) : txCnt?.count !== undefined ? (
                        <span className="ml-0.5 opacity-50 font-normal tabular-nums">· {txCnt.count.toLocaleString("en-IN")}</span>
                      ) : null}
                    </button>
                  </>
                )}
                {renamingPresetId !== preset.id && (
                  <button onClick={() => startRenamePreset(preset)} className="p-0.5 text-sky-400/40 hover:text-sky-200 hover:bg-sky-500/10 transition-colors opacity-0 group-hover:opacity-100" aria-label={`Rename preset "${preset.name}"`} title="Rename">
                    <Pencil className="w-2.5 h-2.5" />
                  </button>
                )}
                {renamingPresetId !== preset.id && (
                  <button onClick={() => deleteCustomDatePreset(preset.id)} className="p-0.5 text-sky-400/40 hover:text-rose-400 hover:bg-rose-500/10 transition-colors opacity-0 group-hover:opacity-100" aria-label={`Remove preset "${preset.name}"`} title="Remove this preset">
                    <Trash2 className="w-2.5 h-2.5" />
                  </button>
                )}
                {idx < customDatePresets.length - 1 && renamingPresetId !== preset.id && (
                  <button onClick={() => moveCustomDatePreset(preset.id, 1)} className="pr-1.5 pl-0.5 py-1 rounded-r-md text-sky-400/40 hover:text-sky-200 hover:bg-sky-500/10 transition-colors opacity-0 group-hover:opacity-100" aria-label="Move right" title="Move right">
                    <ChevronRight className="w-3 h-3" />
                  </button>
                )}
                {idx === customDatePresets.length - 1 && renamingPresetId !== preset.id && <span className="pr-1" />}
              </span>
            );
            })}
          </div>

          {/* Tx Filters */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Filter className="w-4 h-4" />
                  Filters
                </div>
                <button
                  onClick={() => setShowAllFilters(true)}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  title="View and manage saved report filters"
                >
                  <Layers className="w-3.5 h-3.5" />
                  Manage saved filters
                </button>
              </div>

              {/* My Presets — quick-apply row (visually distinct from date-preset buttons) */}
              {savedFilters.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-500/20 bg-sky-500/5 px-3 py-2">
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Bookmark className="w-3.5 h-3.5 text-sky-400" />
                    <span className="text-xs text-sky-400 font-semibold">My presets</span>
                  </div>
                  <div className="w-px h-3.5 bg-sky-500/30 shrink-0" />
                  {savedFilters.map((saved, idx) => (
                    <span
                      key={saved.id}
                      draggable={renamingId !== saved.id}
                      onDragStart={() => handleDragStart(saved.id)}
                      onDragOver={(e) => handleDragOver(e, saved.id)}
                      onDragLeave={handleDragLeave}
                      onDrop={() => handleDrop(saved.id)}
                      onDragEnd={handleDragEnd}
                      className={[
                        "group inline-flex items-center gap-0.5 rounded-full border border-sky-500/30 bg-sky-500/8 text-xs font-medium text-sky-300 hover:border-sky-500/60 transition-colors select-none",
                        renamingId !== saved.id ? "cursor-grab active:cursor-grabbing" : "",
                        draggingId === saved.id ? "opacity-40 scale-95" : "",
                        dragOverId === saved.id && draggingId !== saved.id ? "ring-1 ring-sky-400 border-sky-500/60 bg-sky-500/15" : "",
                      ].filter(Boolean).join(" ")}
                    >
                      {idx > 0 && (
                        <button
                          onClick={() => moveSavedFilter(saved.id, -1)}
                          className="pl-1.5 pr-0.5 py-1 rounded-l-full text-sky-400/40 hover:text-sky-200 hover:bg-sky-500/10 transition-colors opacity-0 group-hover:opacity-100"
                          aria-label="Move left"
                          title="Move left"
                        >
                          <ChevronLeft className="w-3 h-3" />
                        </button>
                      )}
                      {idx === 0 && <span className="pl-2" />}

                      {renamingId === saved.id ? (
                        <input
                          ref={renameInputRef}
                          className="w-28 bg-transparent border-b border-sky-400 text-sky-100 text-xs outline-none py-0.5 mx-1"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitRename();
                            if (e.key === "Escape") cancelRename();
                          }}
                          onBlur={commitRename}
                          maxLength={40}
                        />
                      ) : (
                        <button
                          onClick={() => applySavedFilter(saved)}
                          className="flex items-center gap-1 px-1 py-1 hover:text-sky-100 transition-colors"
                          title={`Apply: ${saved.rawInput}`}
                        >
                          <BookmarkCheck className="w-3 h-3 shrink-0" />
                          {saved.name}
                          {txSavedCountMap[saved.id]?.loading ? (
                            <Loader2 className="w-2.5 h-2.5 ml-0.5 animate-spin opacity-40" />
                          ) : txSavedCountMap[saved.id]?.count !== undefined ? (
                            <span className="ml-0.5 opacity-50 font-normal tabular-nums">· {txSavedCountMap[saved.id]!.count!.toLocaleString("en-IN")}</span>
                          ) : null}
                        </button>
                      )}

                      {renamingId !== saved.id && (
                        <button
                          onClick={() => startRename(saved)}
                          className="p-0.5 text-sky-400/40 hover:text-sky-200 hover:bg-sky-500/10 transition-colors opacity-0 group-hover:opacity-100"
                          aria-label={`Rename "${saved.name}"`}
                          title="Rename"
                        >
                          <Pencil className="w-2.5 h-2.5" />
                        </button>
                      )}

                      {renamingId !== saved.id && (
                        <button
                          onClick={() => deleteSavedFilter(saved.id)}
                          className="pr-1.5 p-0.5 rounded-r-full text-sky-400/40 hover:text-rose-400 hover:bg-rose-500/10 transition-colors opacity-0 group-hover:opacity-100"
                          aria-label={`Delete saved filter "${saved.name}"`}
                          title="Delete this saved filter"
                        >
                          <Trash2 className="w-2.5 h-2.5" />
                        </button>
                      )}

                      {idx < savedFilters.length - 1 && renamingId !== saved.id && (
                        <button
                          onClick={() => moveSavedFilter(saved.id, 1)}
                          className="pr-1.5 pl-0.5 py-1 rounded-r-full text-sky-400/40 hover:text-sky-200 hover:bg-sky-500/10 transition-colors opacity-0 group-hover:opacity-100"
                          aria-label="Move right"
                          title="Move right"
                        >
                          <ChevronRight className="w-3 h-3" />
                        </button>
                      )}
                      {idx === savedFilters.length - 1 && renamingId !== saved.id && <span className="pr-1" />}
                    </span>
                  ))}
                </div>
              )}
            </CardHeader>
            <CardContent className="space-y-4">

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">From</Label>
                  <Input
                    type="date"
                    value={txDateFrom}
                    onChange={(e) => {
                      setTxDateFrom(e.target.value);
                      setTxActivePreset(null);
                      if (dateLocked) { setStlDateFrom(e.target.value); setStlActivePreset(null); }
                    }}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">To</Label>
                  <Input
                    type="date"
                    value={txDateTo}
                    onChange={(e) => {
                      setTxDateTo(e.target.value);
                      setTxActivePreset(null);
                      if (dateLocked) { setStlDateTo(e.target.value); setStlActivePreset(null); }
                    }}
                    className="h-8 text-sm"
                  />
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

              {/* Date range summary */}
              <p className="text-xs text-muted-foreground/70 flex items-center gap-1.5">
                <CalendarRange className="w-3 h-3 shrink-0" />
                {buildRangeSummary(txDateFrom, txDateTo, txActivePreset)}
              </p>

              {/* Save date preset bar */}
              {(txCanSaveDatePreset || txIsCustomDateAlreadySaved || txShowSaveDatePreset || txIsStale) && (
                <div className="flex flex-wrap items-center gap-2">
                  {txIsStale && (
                    <button
                      className="inline-flex items-center gap-1.5 h-7 px-2.5 text-xs rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 hover:border-amber-500/60 transition-colors"
                      onClick={resetTxToThisMonth}
                      title="Reset to the current month's date range"
                    >
                      <RotateCcw className="w-3 h-3" />This month
                    </button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className={[
                      "h-7 text-xs border-sky-500/40 text-sky-300 hover:bg-sky-500/10 hover:text-sky-200",
                      "transition-all duration-200 ease-in-out",
                      txCanSaveDatePreset && !txShowSaveDatePreset
                        ? "opacity-100 translate-y-0 pointer-events-auto"
                        : "opacity-0 -translate-y-1 pointer-events-none",
                    ].join(" ")}
                    onClick={() => { setTxSaveDatePresetName(""); setTxSaveDatePresetNameError(""); setTxShowSaveDatePreset(true); }}
                    title="Save this date range as a quick-access preset"
                    tabIndex={txCanSaveDatePreset && !txShowSaveDatePreset ? undefined : -1}
                  >
                    <CalendarRange className="w-3 h-3 mr-1.5" />Save as date preset
                  </Button>
                  <span
                    className={[
                      "inline-flex items-center gap-1 h-7 px-2.5 text-xs text-sky-400/60 border border-sky-500/20 rounded-md",
                      "transition-all duration-200 ease-in-out",
                      txIsCustomDateAlreadySaved && !txShowSaveDatePreset
                        ? "opacity-100 translate-y-0"
                        : "opacity-0 -translate-y-1 pointer-events-none",
                    ].join(" ")}
                    aria-hidden={!(txIsCustomDateAlreadySaved && !txShowSaveDatePreset)}
                  >
                    <CalendarRange className="w-3 h-3" />Saved
                  </span>
                  <div
                    className={[
                      "flex items-start gap-2 overflow-hidden transition-all duration-200 ease-in-out",
                      txShowSaveDatePreset
                        ? "opacity-100 translate-y-0 max-w-[600px]"
                        : "opacity-0 -translate-y-1 max-w-0 pointer-events-none",
                    ].join(" ")}
                    aria-hidden={!txShowSaveDatePreset}
                  >
                    <div className="flex-1">
                      <Input ref={txSaveDatePresetNameRef} className="h-7 text-xs max-w-[220px]" placeholder="Name this date preset…" value={txSaveDatePresetName} onChange={e => { setTxSaveDatePresetName(e.target.value); setTxSaveDatePresetNameError(""); }} onKeyDown={e => { if (e.key === "Enter") confirmSaveDatePreset(txDateFrom, txDateTo, txSaveDatePresetName, setTxSaveDatePresetName, setTxSaveDatePresetNameError, setTxShowSaveDatePreset, txSaveDatePresetNameRef); if (e.key === "Escape") { setTxShowSaveDatePreset(false); setTxSaveDatePresetName(""); setTxSaveDatePresetNameError(""); } }} maxLength={40} />
                      {txSaveDatePresetNameError && <p className="mt-1 text-xs text-rose-400">{txSaveDatePresetNameError}</p>}
                    </div>
                    <Button size="sm" className="h-7 text-xs shrink-0" onClick={() => confirmSaveDatePreset(txDateFrom, txDateTo, txSaveDatePresetName, setTxSaveDatePresetName, setTxSaveDatePresetNameError, setTxShowSaveDatePreset, txSaveDatePresetNameRef)}>Save</Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs shrink-0 px-2" onClick={() => { setTxShowSaveDatePreset(false); setTxSaveDatePresetName(""); setTxSaveDatePresetNameError(""); }}><X className="w-3.5 h-3.5" /></Button>
                  </div>
                </div>
              )}

              {/* Save filter bar */}
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  className={[
                    "h-7 text-xs border-sky-500/40 text-sky-300 hover:bg-sky-500/10 hover:text-sky-200",
                    "transition-all duration-200 ease-in-out",
                    hasAnyFilter && !isCurrentFilterSaved && !showSaveInput
                      ? "opacity-100 translate-y-0 pointer-events-auto"
                      : "opacity-0 -translate-y-1 pointer-events-none",
                  ].join(" ")}
                  onClick={openSaveInput}
                  title="Save this filter combination for quick access"
                  tabIndex={hasAnyFilter && !isCurrentFilterSaved && !showSaveInput ? undefined : -1}
                >
                  <Bookmark className="w-3.5 h-3.5 mr-1.5" />Save current filters
                </Button>
                <span
                  className={[
                    "inline-flex items-center gap-1 text-xs text-sky-400/60 font-medium",
                    "transition-all duration-200 ease-in-out",
                    hasAnyFilter && isCurrentFilterSaved && !showSaveInput
                      ? "opacity-100 translate-y-0"
                      : "opacity-0 -translate-y-1 pointer-events-none",
                  ].join(" ")}
                  aria-hidden={!(hasAnyFilter && isCurrentFilterSaved && !showSaveInput)}
                >
                  <BookmarkCheck className="w-3.5 h-3.5" />Saved
                </span>
                <div
                  className={[
                    "flex items-start gap-2 overflow-hidden transition-all duration-200 ease-in-out",
                    showSaveInput
                      ? "opacity-100 translate-y-0 max-w-[600px]"
                      : "opacity-0 -translate-y-1 max-w-0 pointer-events-none",
                  ].join(" ")}
                  aria-hidden={!showSaveInput}
                >
                  <div className="flex-1">
                    <Input
                      ref={saveNameInputRef}
                      className="h-7 text-xs max-w-[240px]"
                      placeholder="Name this filter preset…"
                      value={saveFilterName}
                      onChange={(e) => { setSaveFilterName(e.target.value); setSaveFilterNameError(""); }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") confirmSaveFilter();
                        if (e.key === "Escape") cancelSaveFilter();
                      }}
                      maxLength={40}
                    />
                    {saveFilterNameError && (
                      <p className="mt-1 text-xs text-rose-400">{saveFilterNameError}</p>
                    )}
                  </div>
                  <Button size="sm" className="h-7 text-xs shrink-0" onClick={confirmSaveFilter}>Save</Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs shrink-0 px-2" onClick={cancelSaveFilter}>
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <AllFiltersSheet open={showAllFilters} onOpenChange={setShowAllFilters} />

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
                  <p className="text-xs opacity-60">Try adjusting the date range or clearing filters</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
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
                              {Array.from({ length: 9 }).map((__, j) => (
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

              {/* My Presets — quick-apply row for settlements */}
              {savedFilters.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-500/20 bg-sky-500/5 px-3 py-2 mt-2">
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Bookmark className="w-3.5 h-3.5 text-sky-400" />
                    <span className="text-xs text-sky-400 font-semibold">My presets</span>
                  </div>
                  <div className="w-px h-3.5 bg-sky-500/30 shrink-0" />
                  {savedFilters.map((saved) => (
                    <button
                      key={saved.id}
                      onClick={() => {
                        const fd = saved.filterData;
                        setStlDateFrom(fd.dateFrom ?? format(startOfMonth(new Date()), "yyyy-MM-dd"));
                        setStlDateTo(fd.dateTo ?? format(new Date(), "yyyy-MM-dd"));
                        setStlActivePreset(null);
                      }}
                      className="inline-flex items-center gap-1 rounded-full border border-sky-500/30 bg-sky-500/8 px-2 py-1 text-xs font-medium text-sky-300 hover:border-sky-500/60 hover:text-sky-100 transition-colors"
                      title={`Apply date range: ${saved.rawInput}`}
                    >
                      <BookmarkCheck className="w-3 h-3 shrink-0" />
                      {saved.name}
                      {stlSavedCountMap[saved.id]?.loading ? (
                        <Loader2 className="w-2.5 h-2.5 ml-0.5 animate-spin opacity-40" />
                      ) : stlSavedCountMap[saved.id]?.count !== undefined ? (
                        <span className="ml-0.5 opacity-50 font-normal tabular-nums">· {stlSavedCountMap[saved.id]!.count!.toLocaleString("en-IN")}</span>
                      ) : null}
                    </button>
                  ))}
                </div>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <CalendarRange className="w-4 h-4 text-muted-foreground shrink-0" />
                {DATE_PRESETS.map((p) => {
                  const stlCnt = stlCountMap[p.label];
                  return (
                    <Button
                      key={p.label}
                      variant={stlActivePreset === p.label ? "secondary" : "outline"}
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => applyStlPreset(p)}
                    >
                      {p.label}
                      {stlCnt?.loading ? (
                        <Loader2 className="w-2.5 h-2.5 ml-1 animate-spin opacity-40" />
                      ) : stlCnt?.count !== undefined ? (
                        <span className="ml-1 opacity-50 font-normal tabular-nums">· {stlCnt.count.toLocaleString("en-IN")}</span>
                      ) : null}
                    </Button>
                  );
                })}
                {customDatePresets.map((preset, idx) => {
                  const stlCnt = stlCountMap[preset.id];
                  return (
                  <span
                    key={preset.id}
                    draggable={renamingPresetId !== preset.id}
                    onDragStart={() => handlePresetDragStart(preset.id)}
                    onDragOver={(e) => handlePresetDragOver(e, preset.id)}
                    onDragLeave={handlePresetDragLeave}
                    onDrop={() => handlePresetDrop(preset.id)}
                    onDragEnd={handlePresetDragEnd}
                    className={[
                      "group inline-flex items-center gap-0.5 rounded-md border text-xs font-medium transition-colors select-none",
                      renamingPresetId !== preset.id ? "cursor-grab active:cursor-grabbing" : "",
                      isCustomStlPresetActive(preset)
                        ? "border-primary/60 bg-primary/15 text-primary"
                        : "border-sky-500/30 bg-sky-500/8 text-sky-300 hover:border-sky-500/60",
                      draggingPresetId === preset.id ? "opacity-40 scale-95" : "",
                      dragOverPresetId === preset.id && draggingPresetId !== preset.id ? "ring-1 ring-sky-400 border-sky-500/60 bg-sky-500/15" : "",
                    ].filter(Boolean).join(" ")}
                  >
                    {idx > 0 && (
                      <button onClick={() => moveCustomDatePreset(preset.id, -1)} className="pl-1.5 pr-0.5 py-1 rounded-l-md text-sky-400/40 hover:text-sky-200 hover:bg-sky-500/10 transition-colors opacity-0 group-hover:opacity-100" aria-label="Move left" title="Move left">
                        <ChevronLeft className="w-3 h-3" />
                      </button>
                    )}
                    {idx === 0 && <span className="pl-2" />}
                    {renamingPresetId === preset.id ? (
                      <input ref={renamePresetInputRef} className="w-28 bg-transparent border-b border-sky-400 text-sky-100 text-xs outline-none py-0.5 mx-1" value={renamePresetValue} onChange={e => setRenamePresetValue(e.target.value)} onKeyDown={e => { if (e.key === "Enter") commitRenamePreset(); if (e.key === "Escape") cancelRenamePreset(); }} onBlur={commitRenamePreset} maxLength={40} />
                    ) : (
                      <>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button onClick={() => applyCustomPresetStl(preset)} className="p-0.5 text-sky-300 hover:text-sky-100 transition-colors" title={`Apply: ${preset.from} – ${preset.to}`}>
                                <CalendarRange className="w-3 h-3 shrink-0" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">
                              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">Date range</p>
                              <p className="font-mono text-xs">{preset.from} – {preset.to}</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                        <button onClick={() => startRenamePreset(preset)} className="px-0.5 py-1 hover:text-sky-100 transition-colors" title="Click to rename">
                          {preset.name}
                          {stlCnt?.loading ? (
                            <Loader2 className="w-2.5 h-2.5 ml-0.5 animate-spin opacity-40 inline" />
                          ) : stlCnt?.count !== undefined ? (
                            <span className="ml-0.5 opacity-50 font-normal tabular-nums">· {stlCnt.count.toLocaleString("en-IN")}</span>
                          ) : null}
                        </button>
                      </>
                    )}
                    {renamingPresetId !== preset.id && (
                      <button onClick={() => startRenamePreset(preset)} className="p-0.5 text-sky-400/40 hover:text-sky-200 hover:bg-sky-500/10 transition-colors opacity-0 group-hover:opacity-100" aria-label={`Rename preset "${preset.name}"`} title="Rename">
                        <Pencil className="w-2.5 h-2.5" />
                      </button>
                    )}
                    {renamingPresetId !== preset.id && (
                      <button onClick={() => deleteCustomDatePreset(preset.id)} className="p-0.5 text-sky-400/40 hover:text-rose-400 hover:bg-rose-500/10 transition-colors opacity-0 group-hover:opacity-100" aria-label={`Remove preset "${preset.name}"`} title="Remove this preset">
                        <Trash2 className="w-2.5 h-2.5" />
                      </button>
                    )}
                    {idx < customDatePresets.length - 1 && renamingPresetId !== preset.id && (
                      <button onClick={() => moveCustomDatePreset(preset.id, 1)} className="pr-1.5 pl-0.5 py-1 rounded-r-md text-sky-400/40 hover:text-sky-200 hover:bg-sky-500/10 transition-colors opacity-0 group-hover:opacity-100" aria-label="Move right" title="Move right">
                        <ChevronRight className="w-3 h-3" />
                      </button>
                    )}
                    {idx === customDatePresets.length - 1 && renamingPresetId !== preset.id && <span className="pr-1" />}
                  </span>
                );
                })}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">From</Label>
                  <Input
                    type="date"
                    value={stlDateFrom}
                    onChange={(e) => {
                      setStlDateFrom(e.target.value);
                      setStlActivePreset(null);
                      if (dateLocked) { setTxDateFrom(e.target.value); setTxActivePreset(null); }
                    }}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">To</Label>
                  <Input
                    type="date"
                    value={stlDateTo}
                    onChange={(e) => {
                      setStlDateTo(e.target.value);
                      setStlActivePreset(null);
                      if (dateLocked) { setTxDateTo(e.target.value); setTxActivePreset(null); }
                    }}
                    className="h-8 text-sm"
                  />
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

              {/* Date range summary */}
              <p className="text-xs text-muted-foreground/70 flex items-center gap-1.5">
                <CalendarRange className="w-3 h-3 shrink-0" />
                {buildRangeSummary(stlDateFrom, stlDateTo, stlActivePreset)}
              </p>

              {/* Save date preset bar */}
              {(stlCanSaveDatePreset || stlIsCustomDateAlreadySaved || stlShowSaveDatePreset || stlIsStale) && (
                <div className="flex flex-wrap items-center gap-2">
                  {stlIsStale && (
                    <button
                      className="inline-flex items-center gap-1.5 h-7 px-2.5 text-xs rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 hover:border-amber-500/60 transition-colors"
                      onClick={resetStlToThisMonth}
                      title="Reset to the current month's date range"
                    >
                      <RotateCcw className="w-3 h-3" />This month
                    </button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className={[
                      "h-7 text-xs border-sky-500/40 text-sky-300 hover:bg-sky-500/10 hover:text-sky-200",
                      "transition-all duration-200 ease-in-out",
                      stlCanSaveDatePreset && !stlShowSaveDatePreset
                        ? "opacity-100 translate-y-0 pointer-events-auto"
                        : "opacity-0 -translate-y-1 pointer-events-none",
                    ].join(" ")}
                    onClick={() => { setStlSaveDatePresetName(""); setStlSaveDatePresetNameError(""); setStlShowSaveDatePreset(true); }}
                    title="Save this date range as a quick-access preset"
                    tabIndex={stlCanSaveDatePreset && !stlShowSaveDatePreset ? undefined : -1}
                  >
                    <CalendarRange className="w-3 h-3 mr-1.5" />Save as date preset
                  </Button>
                  <span
                    className={[
                      "inline-flex items-center gap-1 h-7 px-2.5 text-xs text-sky-400/60 border border-sky-500/20 rounded-md",
                      "transition-all duration-200 ease-in-out",
                      stlIsCustomDateAlreadySaved && !stlShowSaveDatePreset
                        ? "opacity-100 translate-y-0"
                        : "opacity-0 -translate-y-1 pointer-events-none",
                    ].join(" ")}
                    aria-hidden={!(stlIsCustomDateAlreadySaved && !stlShowSaveDatePreset)}
                  >
                    <CalendarRange className="w-3 h-3" />Saved
                  </span>
                  <div
                    className={[
                      "flex items-start gap-2 overflow-hidden transition-all duration-200 ease-in-out",
                      stlShowSaveDatePreset
                        ? "opacity-100 translate-y-0 max-w-[600px]"
                        : "opacity-0 -translate-y-1 max-w-0 pointer-events-none",
                    ].join(" ")}
                    aria-hidden={!stlShowSaveDatePreset}
                  >
                    <div className="flex-1">
                      <Input ref={stlSaveDatePresetNameRef} className="h-7 text-xs max-w-[220px]" placeholder="Name this date preset…" value={stlSaveDatePresetName} onChange={e => { setStlSaveDatePresetName(e.target.value); setStlSaveDatePresetNameError(""); }} onKeyDown={e => { if (e.key === "Enter") confirmSaveDatePreset(stlDateFrom, stlDateTo, stlSaveDatePresetName, setStlSaveDatePresetName, setStlSaveDatePresetNameError, setStlShowSaveDatePreset, stlSaveDatePresetNameRef); if (e.key === "Escape") { setStlShowSaveDatePreset(false); setStlSaveDatePresetName(""); setStlSaveDatePresetNameError(""); } }} maxLength={40} />
                      {stlSaveDatePresetNameError && <p className="mt-1 text-xs text-rose-400">{stlSaveDatePresetNameError}</p>}
                    </div>
                    <Button size="sm" className="h-7 text-xs shrink-0" onClick={() => confirmSaveDatePreset(stlDateFrom, stlDateTo, stlSaveDatePresetName, setStlSaveDatePresetName, setStlSaveDatePresetNameError, setStlShowSaveDatePreset, stlSaveDatePresetNameRef)}>Save</Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs shrink-0 px-2" onClick={() => { setStlShowSaveDatePreset(false); setStlSaveDatePresetName(""); setStlSaveDatePresetNameError(""); }}><X className="w-3.5 h-3.5" /></Button>
                  </div>
                </div>
              )}
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
                  <p className="text-xs opacity-60">Try adjusting the date range or clearing filters</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>ID</TableHead>
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
                              {Array.from({ length: 9 }).map((__, j) => (
                                <TableCell key={j}><div className="h-4 w-full bg-muted animate-pulse rounded" /></TableCell>
                              ))}
                            </TableRow>
                          ))
                        : settlements.slice(0, 100).map((s) => (
                            <TableRow key={s.id}>
                              <TableCell className="font-mono text-xs text-muted-foreground">#{s.id}</TableCell>
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
      </Tabs>
    </div>
  );
}
