import { useState } from "react";
import { useListNotifications, useMarkAllNotificationsRead, useMarkNotificationRead, useReenableReportSchedule, useGetReportSchedule, useGetNotificationUnreadCounts, getGetNotificationUnreadCountsQueryKey, useGetQuietHoursQueueCount, useListQuietHoursQueue, getListQuietHoursQueueQueryKey, getGetQuietHoursQueueCountQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Bell, Check, CheckCheck, AlertCircle, CreditCard, Zap, Megaphone, RefreshCw, ExternalLink, Calendar, PlayCircle, CheckCircle2, Trash2, PauseCircle, Clock, Send, User, Moon, Mail, Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { toast } from "sonner";
import { formatDistanceToNow, format } from "date-fns";

function notifIcon(type: string) {
  if (type.startsWith("settlement")) return <CreditCard className="w-4 h-4" />;
  if (type.startsWith("plan")) return <Zap className="w-4 h-4" />;
  if (type === "provider_limit_reset") return <RefreshCw className="w-4 h-4" />;
  if (type === "limit_exceeded" || type === "provider_limit_warning" || type === "provider_limit_reached") return <AlertCircle className="w-4 h-4" />;
  if (type === "scheduled_report_auto_paused" || type === "scheduled_report_auto_paused_admin") return <PauseCircle className="w-4 h-4" />;
  if (type === "scheduled_report_failure") return <AlertCircle className="w-4 h-4" />;
  if (type === "scheduled_report_retry_success" || type === "report_schedule_reenabled" || type === "report_schedule_failures_reset") return <PlayCircle className="w-4 h-4" />;
  if (type === "scheduled_report_overdue") return <Clock className="w-4 h-4" />;
  if (type === "report_schedule_deleted") return <Trash2 className="w-4 h-4" />;
  if (type === "report_schedule_next_run_updated") return <Calendar className="w-4 h-4" />;
  if (type === "report_manual_send") return <Send className="w-4 h-4" />;
  if (type === "preference_change_unknown_device") return <ShieldAlert className="w-4 h-4" />;
  return <Megaphone className="w-4 h-4" />;
}

function notifColor(type: string): string {
  if (type === "settlement_approved" || type === "settlement_paid") return "text-emerald-400";
  if (type === "settlement_rejected") return "text-red-400";
  if (type === "plan_expiring" || type === "limit_exceeded" || type === "provider_limit_warning") return "text-amber-400";
  if (type === "plan_expired" || type === "provider_limit_reached") return "text-red-400";
  if (type === "provider_limit_reset") return "text-emerald-400";
  if (type === "scheduled_report_auto_paused" || type === "scheduled_report_auto_paused_admin" || type === "scheduled_report_failure" || type === "scheduled_report_overdue") return "text-amber-400";
  if (type === "scheduled_report_retry_success" || type === "report_schedule_reenabled" || type === "report_schedule_failures_reset") return "text-emerald-400";
  if (type === "report_schedule_deleted") return "text-red-400";
  if (type === "report_schedule_next_run_updated") return "text-sky-400";
  if (type === "report_manual_send") return "text-sky-400";
  if (type === "preference_change_unknown_device") return "text-red-400";
  return "text-blue-400";
}

const TYPE_LABELS: Record<string, string> = {
  settlement_approved: "Approved",
  settlement_rejected: "Rejected",
  settlement_paid: "Paid",
  plan_expiring: "Plan Expiring",
  plan_expired: "Plan Expired",
  limit_exceeded: "Limit",
  provider_limit_warning: "Limit Warning",
  provider_limit_reached: "Limit Reached",
  provider_limit_reset: "Limit Reset",
  system_notice: "Notice",
  scheduled_report_auto_paused: "Report Paused",
  scheduled_report_auto_paused_admin: "Report Paused",
  scheduled_report_failure: "Report Failed",
  scheduled_report_retry_success: "Report Resumed",
  scheduled_report_overdue: "Report Overdue",
  report_schedule_deleted: "Schedule Deleted",
  report_schedule_next_run_updated: "Schedule Updated",
  report_schedule_reenabled: "Schedule Re-enabled",
  report_schedule_failures_reset: "Failures Reset",
  report_manual_send: "Report Sent",
  preference_change_unknown_device: "Security Alert",
};

type TabValue = "all" | "unread" | "queued";

type TypeFilter =
  | "all"
  | "settlements"
  | "plans"
  | "limits"
  | "system_notice"
  | "reports";

const TYPE_CHIPS: { value: TypeFilter; label: string; icon: React.ReactNode }[] = [
  { value: "all", label: "All Types", icon: <Bell className="w-3 h-3" /> },
  { value: "settlements", label: "Settlements", icon: <CreditCard className="w-3 h-3" /> },
  { value: "plans", label: "Plans", icon: <Zap className="w-3 h-3" /> },
  { value: "limits", label: "Limits", icon: <AlertCircle className="w-3 h-3" /> },
  { value: "system_notice", label: "Notice", icon: <Megaphone className="w-3 h-3" /> },
  { value: "reports", label: "Reports", icon: <Calendar className="w-3 h-3" /> },
];

function getAdminDisplay(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const m = metadata as Record<string, unknown>;
  const name = typeof m["adminName"] === "string" && m["adminName"] ? m["adminName"] : null;
  const email = typeof m["adminEmail"] === "string" && m["adminEmail"] ? m["adminEmail"] : null;
  return name ?? email ?? null;
}

const PROVIDER_LIMIT_TYPES = new Set(["limit_exceeded", "provider_limit_warning", "provider_limit_reached", "provider_limit_reset"]);

const REPORT_NOTIFICATION_TYPES = new Set([
  "scheduled_report_auto_paused",
  "scheduled_report_auto_paused_admin",
  "scheduled_report_failure",
  "scheduled_report_retry_success",
  "scheduled_report_overdue",
  "report_schedule_deleted",
  "report_schedule_next_run_updated",
  "report_schedule_reenabled",
  "report_schedule_failures_reset",
  "report_manual_send",
]);

function DeliverAfterBadge({ deliverAfter }: { deliverAfter: string }) {
  const date = new Date(deliverAfter);
  const isPast = date <= new Date();
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded border ${
        isPast
          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
          : "bg-amber-500/10 text-amber-400 border-amber-500/20"
      }`}
    >
      <Clock className="w-3 h-3 shrink-0" />
      {isPast ? "Ready to deliver" : `Held until ${format(date, "HH:mm")}`}
    </span>
  );
}

function QueuedNotificationsSkeleton() {
  return (
    <ul className="divide-y divide-border/50">
      {[0, 1, 2].map((i) => (
        <li key={i} className="flex items-start gap-4 px-5 py-4">
          <Skeleton className="w-8 h-8 rounded-full mt-0.5 shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-3 w-24" />
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function NotificationsPage() {
  const searchStr = useSearch();
  const [notifLocation, notifNavigate] = useLocation();

  const _nqp = new URLSearchParams(searchStr);
  const rawTab = _nqp.get("tab");
  const tab: TabValue = rawTab === "unread" || rawTab === "queued" ? rawTab : "all";
  const rawType = _nqp.get("type");
  const typeFilter: TypeFilter =
    rawType === "settlements" || rawType === "plans" || rawType === "limits" || rawType === "system_notice" || rawType === "reports"
      ? rawType
      : "all";
  const page = Math.max(1, parseInt(_nqp.get("page") ?? "1") || 1);

  const setNotifFilter = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(searchStr);
    for (const [key, value] of Object.entries(updates)) {
      if (value == null || value === "") {
        next.delete(key);
      } else {
        next.set(key, value);
      }
    }
    notifNavigate(`${notifLocation}?${next.toString()}`);
  };

  const [flushingQueue, setFlushingQueue] = useState(false);
  const qc = useQueryClient();
  const [, navigate] = useLocation();

  const { data, isLoading, refetch } = useListNotifications({
    isRead: tab === "unread" ? "false" : undefined,
    type: typeFilter !== "all" ? typeFilter : undefined,
    page,
    limit: 20,
  });

  const { data: unreadCountsData } = useGetNotificationUnreadCounts({
    query: {
      queryKey: getGetNotificationUnreadCountsQueryKey(),
      refetchInterval: 30_000,
      refetchIntervalInBackground: false,
    },
  });

  const { data: queueData, isLoading: queueLoading, refetch: refetchQueue } = useListQuietHoursQueue({
    query: {
      queryKey: getListQuietHoursQueueQueryKey(),
      enabled: tab === "queued",
      refetchInterval: tab === "queued" ? 60_000 : false,
    },
  });

  const { data: queueCountData } = useGetQuietHoursQueueCount({
    query: {
      queryKey: getGetQuietHoursQueueCountQueryKey(),
      refetchInterval: 60_000,
      refetchIntervalInBackground: false,
    },
  });

  const markAll = useMarkAllNotificationsRead();
  const markOne = useMarkNotificationRead();
  const reenable = useReenableReportSchedule();
  const { data: scheduleData } = useGetReportSchedule();
  const scheduleIsActive = scheduleData?.schedule?.isActive ?? false;

  function handleTabChange(v: string) {
    setNotifFilter({ tab: v === "all" ? null : v, page: null });
  }

  function handleTypeFilter(v: TypeFilter) {
    setNotifFilter({ type: v === "all" ? null : v, page: null });
  }

  function invalidateUnreadCounts() {
    qc.invalidateQueries({ queryKey: getGetNotificationUnreadCountsQueryKey() });
  }

  function handleMarkAll() {
    markAll.mutate(undefined, {
      onSuccess: () => {
        toast.success("All notifications marked as read");
        qc.invalidateQueries({ queryKey: ["/api/notifications"] });
        invalidateUnreadCounts();
        refetch();
      },
    });
  }

  function handleMarkOne(id: number) {
    markOne.mutate({ id }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ["/api/notifications"] });
        invalidateUnreadCounts();
        refetch();
      },
    });
  }

  function handleNotifClick(id: number, type: string, isRead: boolean) {
    if (!isRead) handleMarkOne(id);
    if (PROVIDER_LIMIT_TYPES.has(type)) navigate("/merchant/connect");
  }

  function handleReenable(e: React.MouseEvent, notifId: number, isRead: boolean) {
    e.stopPropagation();
    reenable.mutate(undefined, {
      onSuccess: () => {
        toast.success("Schedule re-enabled — your reports will resume as normal.");
        qc.invalidateQueries({ queryKey: ["/api/reports/schedule"] });
        if (!isRead) {
          markOne.mutate({ id: notifId }, {
            onSuccess: () => {
              qc.invalidateQueries({ queryKey: ["/api/notifications"] });
              invalidateUnreadCounts();
              refetch();
            },
          });
        } else {
          qc.invalidateQueries({ queryKey: ["/api/notifications"] });
          refetch();
        }
      },
      onError: () => {
        toast.error("Failed to re-enable schedule. Please try again or visit the Reports page.");
      },
    });
  }

  async function handleFlushQueue() {
    setFlushingQueue(true);
    try {
      const token = localStorage.getItem("rasokart_token");
      const res = await fetch("/api/auth/quiet-hours/flush", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("Failed to flush queue");
      const json = await res.json();
      toast.success(json.message ?? `Flushed ${json.flushed} queued email(s)`);
      void refetchQueue();
      qc.invalidateQueries({ queryKey: getGetQuietHoursQueueCountQueryKey() });
    } catch {
      toast.error("Failed to deliver queued emails");
    } finally {
      setFlushingQueue(false);
    }
  }

  const notifications = data?.data ?? [];
  const total = data?.total ?? 0;
  const unread = data?.unread ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / 20));

  const typeCounts = unreadCountsData?.counts ?? {};
  const queuedCount = queueCountData?.count ?? 0;
  const queuedItems = queueData?.items ?? [];

  function chipUnreadCount(chipValue: TypeFilter): number {
    if (chipValue === "all") return unreadCountsData?.total ?? 0;
    if (chipValue === "reports") {
      return Object.entries(typeCounts)
        .filter(([t]) => REPORT_NOTIFICATION_TYPES.has(t))
        .reduce((sum, [, n]) => sum + n, 0);
    }
    if (chipValue === "limits") {
      return Object.entries(typeCounts)
        .filter(([t]) => PROVIDER_LIMIT_TYPES.has(t))
        .reduce((sum, [, n]) => sum + n, 0);
    }
    if (chipValue === "plans") {
      return (typeCounts["plan_expiring"] ?? 0) + (typeCounts["plan_expired"] ?? 0);
    }
    return typeCounts[chipValue] ?? 0;
  }

  const showQueuedTab = tab === "queued" || queuedCount > 0;

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Bell className="w-6 h-6 text-primary" />
            Notifications
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {unread > 0 ? `${unread} unread notification${unread !== 1 ? "s" : ""}` : "You're all caught up"}
          </p>
        </div>
        {tab !== "queued" && unread > 0 && (
          <Button variant="outline" size="sm" onClick={handleMarkAll} disabled={markAll.isPending}>
            <CheckCheck className="w-4 h-4 mr-2" />
            Mark all read
          </Button>
        )}
        {tab === "queued" && queuedItems.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleFlushQueue}
            disabled={flushingQueue}
            className="border-amber-500/40 text-amber-400 hover:bg-amber-500/10 hover:text-amber-300 hover:border-amber-500/60"
          >
            {flushingQueue ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Send className="w-4 h-4 mr-2" />
            )}
            Deliver now
          </Button>
        )}
      </div>

      <Tabs value={tab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="unread">
            Unread
            {unread > 0 && (
              <Badge variant="secondary" className="ml-2 h-5 px-1.5 text-[10px]">{unread}</Badge>
            )}
          </TabsTrigger>
          {showQueuedTab && (
            <TabsTrigger value="queued">
              <Moon className="w-3 h-3 mr-1.5" />
              Queued
              {queuedCount > 0 && (
                <Badge className="ml-2 h-5 px-1.5 text-[10px] bg-amber-500/20 text-amber-400 border border-amber-500/30">
                  {queuedCount}
                </Badge>
              )}
            </TabsTrigger>
          )}
        </TabsList>
      </Tabs>

      {tab !== "queued" && (
        <>
          <div className="flex flex-wrap gap-2">
            {TYPE_CHIPS.map(chip => {
              const chipCount = chipUnreadCount(chip.value);
              return (
                <button
                  key={chip.value}
                  onClick={() => handleTypeFilter(chip.value)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                    typeFilter === chip.value
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border/60 text-muted-foreground hover:text-foreground hover:border-border bg-transparent"
                  }`}
                >
                  {chip.icon}
                  {chip.label}
                  {chipCount > 0 && (
                    <span className={`inline-flex items-center justify-center rounded-full min-w-[16px] h-4 px-1 text-[10px] font-semibold leading-none ${
                      typeFilter === chip.value
                        ? "bg-primary-foreground/20 text-primary-foreground"
                        : "bg-primary/15 text-primary"
                    }`}>
                      {chipCount > 99 ? "99+" : chipCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <Card>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="py-16 text-center text-muted-foreground text-sm">Loading…</div>
              ) : notifications.length === 0 ? (
                <div className="py-16 flex flex-col items-center gap-3 text-muted-foreground">
                  <Bell className="w-10 h-10 opacity-20" />
                  <p className="text-sm">
                    {tab === "unread" ? "No unread notifications" : typeFilter !== "all" ? "No notifications for this filter" : "No notifications yet"}
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-border/50">
                  {notifications.map((n) => {
                    const isProviderLimit = PROVIDER_LIMIT_TYPES.has(n.type);
                    const isAutoPaused = n.type === "scheduled_report_auto_paused";
                    const isClickable = !n.isRead || isProviderLimit;
                    return (
                      <li
                        key={n.id}
                        role={isClickable ? "button" : undefined}
                        tabIndex={isClickable ? 0 : undefined}
                        onClick={() => handleNotifClick(n.id, n.type, n.isRead)}
                        onKeyDown={(e) => e.key === "Enter" && handleNotifClick(n.id, n.type, n.isRead)}
                        className={`flex items-start gap-4 px-5 py-4 transition-colors ${!n.isRead ? "bg-primary/5" : ""} ${isClickable ? "cursor-pointer hover:bg-primary/10" : "cursor-default"}`}
                      >
                        <div className={`mt-0.5 shrink-0 ${notifColor(n.type)}`}>
                          {notifIcon(n.type)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm">{n.title}</span>
                            {TYPE_LABELS[n.type] && (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                                {TYPE_LABELS[n.type]}
                              </Badge>
                            )}
                            {isProviderLimit && (
                              <span className="inline-flex items-center gap-1 text-[10px] text-primary/70">
                                <ExternalLink className="w-3 h-3" />
                                View providers
                              </span>
                            )}
                            {!n.isRead && (
                              <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground mt-0.5 leading-snug">{n.body}</p>
                          {n.type === "report_manual_send" && (() => {
                            const adminDisplay = getAdminDisplay(n.metadata);
                            return adminDisplay ? (
                              <p className="inline-flex items-center gap-1 text-xs text-sky-400/80 mt-1">
                                <User className="w-3 h-3" />
                                Sent by {adminDisplay}
                              </p>
                            ) : null;
                          })()}
                          {n.type === "preference_change_unknown_device" && (() => {
                            const meta = n.metadata as Record<string, unknown> | null;
                            const trustToken = typeof meta?.["trustToken"] === "string" ? meta["trustToken"] : null;
                            return trustToken ? (
                              <div className="mt-2">
                                <a
                                  href={`/api/auth/trust-ip?token=${encodeURIComponent(trustToken)}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300 hover:border-emerald-500/60 transition-colors"
                                >
                                  <ShieldCheck className="w-3.5 h-3.5" />
                                  Trust this device
                                </a>
                              </div>
                            ) : null;
                          })()}
                          {isAutoPaused && (
                            <div className="mt-2">
                              {scheduleIsActive ? (
                                <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400/80">
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  Already active
                                </span>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs gap-1.5 border-amber-500/40 text-amber-400 hover:bg-amber-500/10 hover:text-amber-300 hover:border-amber-500/60"
                                  onClick={(e) => handleReenable(e, n.id, n.isRead)}
                                  disabled={reenable.isPending}
                                >
                                  <PlayCircle className="w-3.5 h-3.5" />
                                  Re-enable schedule
                                </Button>
                              )}
                            </div>
                          )}
                          <p className="text-[11px] text-muted-foreground/60 mt-1">
                            {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                          </p>
                        </div>
                        {!n.isRead && (
                          <div className="shrink-0 h-7 w-7 flex items-center justify-center text-muted-foreground" title="Click row to mark as read">
                            <Check className="w-3.5 h-3.5" />
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>Page {page} of {totalPages} • {total} total</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setNotifFilter({ page: String(page - 1) })}>Previous</Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setNotifFilter({ page: String(page + 1) })}>Next</Button>
              </div>
            </div>
          )}
        </>
      )}

      {tab === "queued" ? (
        <Card>
          <CardContent className="p-0">
            {queueLoading ? (
              <QueuedNotificationsSkeleton />
            ) : queuedItems.length === 0 ? (
              <div className="py-16 flex flex-col items-center gap-3 text-muted-foreground">
                <Moon className="w-10 h-10 opacity-20" />
                <p className="text-sm">No emails are being held by quiet hours</p>
                <p className="text-xs text-muted-foreground/60 max-w-xs text-center">
                  Emails held during your quiet-hours window will appear here until they are delivered.
                </p>
              </div>
            ) : (
              <>
                <div className="px-5 py-3 border-b border-border/50 flex items-center gap-2">
                  <Moon className="w-4 h-4 text-amber-400" />
                  <p className="text-xs text-muted-foreground">
                    These emails are being held during your quiet-hours window and will be delivered automatically when it ends.
                  </p>
                </div>
                <ul className="divide-y divide-border/50">
                  {queuedItems.map((item) => (
                    <li key={item.id} className="flex items-start gap-4 px-5 py-4">
                      <div className="mt-0.5 shrink-0 text-amber-400">
                        <Mail className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="font-medium text-sm truncate">{item.subject}</span>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <DeliverAfterBadge deliverAfter={item.deliverAfter} />
                        </div>
                        <p className="text-[11px] text-muted-foreground/60 mt-1">
                          Queued {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="py-16 text-center text-muted-foreground text-sm">Loading…</div>
              ) : notifications.length === 0 ? (
                <div className="py-16 flex flex-col items-center gap-3 text-muted-foreground">
                  <Bell className="w-10 h-10 opacity-20" />
                  <p className="text-sm">
                    {tab === "unread" ? "No unread notifications" : typeFilter !== "all" ? "No notifications for this filter" : "No notifications yet"}
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-border/50">
                  {notifications.map((n) => {
                    const isProviderLimit = PROVIDER_LIMIT_TYPES.has(n.type);
                    const isAutoPaused = n.type === "scheduled_report_auto_paused";
                    const isClickable = !n.isRead || isProviderLimit;
                    return (
                      <li
                        key={n.id}
                        role={isClickable ? "button" : undefined}
                        tabIndex={isClickable ? 0 : undefined}
                        onClick={() => handleNotifClick(n.id, n.type, n.isRead)}
                        onKeyDown={(e) => e.key === "Enter" && handleNotifClick(n.id, n.type, n.isRead)}
                        className={`flex items-start gap-4 px-5 py-4 transition-colors ${!n.isRead ? "bg-primary/5" : ""} ${isClickable ? "cursor-pointer hover:bg-primary/10" : "cursor-default"}`}
                      >
                        <div className={`mt-0.5 shrink-0 ${notifColor(n.type)}`}>
                          {notifIcon(n.type)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm">{n.title}</span>
                            {TYPE_LABELS[n.type] && (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                                {TYPE_LABELS[n.type]}
                              </Badge>
                            )}
                            {isProviderLimit && (
                              <span className="inline-flex items-center gap-1 text-[10px] text-primary/70">
                                <ExternalLink className="w-3 h-3" />
                                View providers
                              </span>
                            )}
                            {!n.isRead && (
                              <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground mt-0.5 leading-snug">{n.body}</p>
                          {n.type === "report_manual_send" && (() => {
                            const adminDisplay = getAdminDisplay(n.metadata);
                            return adminDisplay ? (
                              <p className="inline-flex items-center gap-1 text-xs text-sky-400/80 mt-1">
                                <User className="w-3 h-3" />
                                Sent by {adminDisplay}
                              </p>
                            ) : null;
                          })()}
                          {isAutoPaused && (
                            <div className="mt-2">
                              {scheduleIsActive ? (
                                <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400/80">
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  Already active
                                </span>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs gap-1.5 border-amber-500/40 text-amber-400 hover:bg-amber-500/10 hover:text-amber-300 hover:border-amber-500/60"
                                  onClick={(e) => handleReenable(e, n.id, n.isRead)}
                                  disabled={reenable.isPending}
                                >
                                  <PlayCircle className="w-3.5 h-3.5" />
                                  Re-enable schedule
                                </Button>
                              )}
                            </div>
                          )}
                          <p className="text-[11px] text-muted-foreground/60 mt-1">
                            {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                          </p>
                        </div>
                        {!n.isRead && (
                          <div className="shrink-0 h-7 w-7 flex items-center justify-center text-muted-foreground" title="Click row to mark as read">
                            <Check className="w-3.5 h-3.5" />
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>Page {page} of {totalPages} • {total} total</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setNotifFilter({ page: String(page - 1) })}>Previous</Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setNotifFilter({ page: String(page + 1) })}>Next</Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
