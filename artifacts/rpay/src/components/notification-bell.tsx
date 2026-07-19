import { useState, useEffect } from "react";
import { useListNotifications, useMarkAllNotificationsRead, useMarkNotificationRead, useGetNotificationUnreadCounts, getGetNotificationUnreadCountsQueryKey, useGetQuietHoursQueueCount, getGetQuietHoursQueueCountQueryKey, useGetMe, getGetMeQueryKey, useUpdateMyPreferences } from "@workspace/api-client-react";
import { Bell, BellOff, Check, CheckCheck, CreditCard, Zap, AlertCircle, Megaphone, BarChart3, ShieldAlert, Mail, ShieldCheck, Settings2, ChevronDown, ChevronUp, VolumeX, CheckCircle2, WifiOff } from "lucide-react";
import { IN_APP_NOTIF_FIELDS, IN_APP_NOTIF_LABELS, typeToField } from "@/lib/notification-categories";
import type { InAppNotifField } from "@/lib/notification-categories";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Link, useLocation } from "wouter";

function notifIcon(type: string) {
  if (type.startsWith("settlement")) return <CreditCard className="w-3.5 h-3.5" />;
  if (type.startsWith("plan")) return <Zap className="w-3.5 h-3.5" />;
  if (type === "limit_exceeded") return <AlertCircle className="w-3.5 h-3.5" />;
  if (type === "report_schedule_auto_paused_admin" || type === "report_schedule_reenabled_by_merchant" || type === "scheduled_report_auto_paused" || type === "scheduled_report_failure" || type === "report_schedule_failures_reset") return <BarChart3 className="w-3.5 h-3.5" />;
  if (type === "preference_change_unknown_device") return <ShieldAlert className="w-3.5 h-3.5" />;
  if (type === "gateway_recovered") return <CheckCircle2 className="w-3.5 h-3.5" />;
  if (type === "gateway_failover_exhausted") return <WifiOff className="w-3.5 h-3.5" />;
  return <Megaphone className="w-3.5 h-3.5" />;
}

function notifColor(type: string): string {
  if (type === "settlement_approved" || type === "settlement_paid") return "text-emerald-400";
  if (type === "settlement_rejected") return "text-red-400";
  if (type === "plan_expiring" || type === "limit_exceeded") return "text-amber-400";
  if (type === "plan_expired") return "text-red-400";
  if (type === "report_schedule_auto_paused_admin" || type === "scheduled_report_auto_paused") return "text-amber-400";
  if (type === "report_schedule_reenabled_by_merchant" || type === "report_schedule_failures_reset") return "text-emerald-400";
  if (type === "scheduled_report_failure") return "text-orange-400";
  if (type === "preference_change_unknown_device") return "text-red-400";
  if (type === "gateway_recovered") return "text-emerald-400";
  if (type === "gateway_failover_exhausted") return "text-amber-400";
  return "text-blue-400";
}

function notifNavTarget(type: string, metadata: unknown): string | null {
  if (type === "report_schedule_auto_paused_admin" || type === "report_schedule_reenabled_by_merchant") {
    const meta = metadata as Record<string, unknown> | null;
    const merchantId = meta?.merchantId;
    if (merchantId != null) return `/admin/reports?merchantId=${merchantId}`;
    return "/admin/reports";
  }
  if (type === "scheduled_report_auto_paused" || type === "scheduled_report_failure" || type === "report_schedule_failures_reset") {
    const meta = metadata as Record<string, unknown> | null;
    return (meta?.target as string | undefined) ?? "/merchant/reports";
  }
  if (type === "preference_change_unknown_device") {
    return "/merchant/security";
  }
  if (type === "gateway_recovered" || type === "gateway_failover_exhausted") {
    return "/admin/smart-routing?tab=failover";
  }
  return null;
}


function countMutedInAppTypes(me: Record<string, unknown> | null | undefined): number {
  if (!me) return 0;
  return IN_APP_NOTIF_FIELDS.filter(field => me[field] === false).length;
}

interface NotificationBellProps {
  isAdmin?: boolean;
}

export function NotificationBell({ isAdmin = false }: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const [showPrefs, setShowPrefs] = useState(false);
  const [hideMuted, setHideMuted] = useState(false);
  const qc = useQueryClient();
  const [, navigate] = useLocation();

  const { data, refetch } = useListNotifications({ limit: 10, page: 1 });
  const { data: unreadCountsData } = useGetNotificationUnreadCounts({
    query: {
      queryKey: getGetNotificationUnreadCountsQueryKey(),
      refetchInterval: 30_000,
      refetchIntervalInBackground: false,
    },
  });
  const { data: queueCountData } = useGetQuietHoursQueueCount({
    query: {
      queryKey: getGetQuietHoursQueueCountQueryKey(),
      refetchInterval: 60_000,
      refetchIntervalInBackground: false,
      enabled: !isAdmin,
    },
  });
  const { data: meData } = useGetMe({ query: { queryKey: getGetMeQueryKey(), enabled: !isAdmin } });
  const markAll = useMarkAllNotificationsRead();
  const markOne = useMarkNotificationRead();

  const { mutate: updatePrefs, isPending: savingPrefs } = useUpdateMyPreferences({
    mutation: {
      onSuccess: (updated) => {
        qc.setQueryData(getGetMeQueryKey(), (old: any) => ({ ...old, ...updated }));
      },
    },
  });

  useEffect(() => {
    const id = setInterval(() => {
      qc.invalidateQueries({ queryKey: ["/api/notifications"] });
      qc.invalidateQueries({ queryKey: getGetNotificationUnreadCountsQueryKey() });
      if (!isAdmin) {
        qc.invalidateQueries({ queryKey: getGetQuietHoursQueueCountQueryKey() });
      }
    }, 60_000);
    return () => clearInterval(id);
  }, [qc, isAdmin]);

  const unread = unreadCountsData?.total ?? 0;
  const queueCount = (!isAdmin ? (queueCountData?.count ?? 0) : 0);
  const allItems = data?.data ?? [];
  const meRecord = meData as Record<string, unknown> | null | undefined;
  const mutedCount = !isAdmin ? countMutedInAppTypes(meRecord) : 0;

  const items = hideMuted && !isAdmin
    ? allItems.filter((n) => {
        const field = typeToField(n.type);
        if (field == null) return true;
        return meRecord ? meRecord[field] !== false : true;
      })
    : allItems;

  function handleMarkAll() {
    markAll.mutate(undefined, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ["/api/notifications"] });
        qc.invalidateQueries({ queryKey: getGetNotificationUnreadCountsQueryKey() });
        refetch();
      },
    });
  }

  function handleMarkOne(id: number, type: string, metadata: unknown) {
    const target = notifNavTarget(type, metadata);
    markOne.mutate({ id }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ["/api/notifications"] });
        qc.invalidateQueries({ queryKey: getGetNotificationUnreadCountsQueryKey() });
        if (target) {
          setOpen(false);
          navigate(target);
        }
      },
    });
    if (target && !markOne.isPending) {
      setOpen(false);
      navigate(target);
    }
  }

  function handleToggleField(field: InAppNotifField, value: boolean) {
    updatePrefs({ data: { [field]: value } as any });
  }

  function handleMuteAll() {
    const payload = Object.fromEntries(IN_APP_NOTIF_FIELDS.map((f) => [f, false]));
    updatePrefs({ data: payload as any });
  }

  function handleRestoreAll() {
    const payload = Object.fromEntries(IN_APP_NOTIF_FIELDS.map((f) => [f, true]));
    updatePrefs({ data: payload as any });
  }

  return (
    <TooltipProvider>
      <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) setShowPrefs(false); }}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className="relative h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground">
            <Bell className="w-4 h-4" />
            {unread > 0 && (
              <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">
                {unread > 99 ? "99+" : unread}
              </span>
            )}
            {queueCount > 0 && (
              <span
                className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-500 text-[8px] font-bold text-black cursor-pointer"
                title={`${queueCount} email${queueCount === 1 ? "" : "s"} queued during quiet hours — click to view`}
                onClick={(e) => {
                  e.stopPropagation();
                  navigate("/merchant/security#quiet-hours");
                }}
              >
                {queueCount > 9 ? "9+" : queueCount}
              </span>
            )}
            {mutedCount > 0 && unread === 0 && queueCount === 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="absolute -top-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-muted-foreground/40 text-background">
                    <BellOff className="w-2.5 h-2.5" />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="right" className="text-xs">
                  {mutedCount} in-app notification type{mutedCount === 1 ? "" : "s"} muted
                </TooltipContent>
              </Tooltip>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent side="right" align="start" className="w-80 p-0" sideOffset={8}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
            <span className="text-sm font-semibold">Notifications</span>
            <div className="flex items-center gap-1.5">
              {!isAdmin && mutedCount > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => setHideMuted((v) => !v)}
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${
                        hideMuted
                          ? "bg-amber-500/20 text-amber-400 hover:bg-amber-500/30"
                          : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
                      }`}
                    >
                      <BellOff className="w-2.5 h-2.5" />
                      {hideMuted ? "Showing active" : "Hide muted"}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    {hideMuted ? "Click to show muted notifications" : `Hide ${mutedCount} muted type${mutedCount === 1 ? "" : "s"}`}
                  </TooltipContent>
                </Tooltip>
              )}
              {unread > 0 && (
                <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={handleMarkAll} disabled={markAll.isPending}>
                  <CheckCheck className="w-3 h-3 mr-1" />
                  Mark all read
                </Button>
              )}
            </div>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <div className="py-10 text-center text-xs text-muted-foreground">No notifications yet</div>
            ) : (
              <ul className="divide-y divide-border/40">
                {items.map((n) => {
                  const target = notifNavTarget(n.type, n.metadata);
                  const prefField = !isAdmin ? typeToField(n.type) : null;
                  const isTypeMuted = prefField != null && meRecord ? (meRecord[prefField] === false) : false;
                  return (
                    <li
                      key={n.id}
                      className={`group flex items-start gap-3 px-4 py-3 transition-opacity ${isTypeMuted ? "opacity-50" : ""} ${!n.isRead && !isTypeMuted ? "bg-primary/5" : ""} ${target ? "cursor-pointer hover:bg-muted/30" : ""}`}
                      onClick={target ? () => handleMarkOne(n.id, n.type, n.metadata) : undefined}
                    >
                      <div className={`mt-0.5 shrink-0 ${notifColor(n.type)}`}>{notifIcon(n.type)}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-xs font-medium leading-tight truncate">{n.title}</p>
                          {n.type === "gateway_recovered" && (
                            <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/15 px-1.5 py-px text-[9px] font-semibold text-emerald-400 leading-tight shrink-0">
                              <CheckCircle2 className="w-2.5 h-2.5" />
                              Recovered
                            </span>
                          )}
                          {!n.isRead && !isTypeMuted && <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />}
                          {isTypeMuted && (
                            <span className="inline-flex items-center gap-0.5 text-[9px] text-muted-foreground/50">
                              <BellOff className="w-2.5 h-2.5" />
                              muted
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground leading-snug mt-0.5 line-clamp-2">{n.body}</p>
                        {prefField != null && (
                          <span className="inline-flex items-center mt-1 rounded-full border border-border/50 bg-muted/60 px-1.5 py-px text-[9px] font-medium text-muted-foreground/70 leading-tight">
                            {IN_APP_NOTIF_LABELS[prefField]}
                          </span>
                        )}
                        {n.type === "preference_change_unknown_device" && (() => {
                          const meta = n.metadata as Record<string, unknown> | null;
                          const trustToken = typeof meta?.["trustToken"] === "string" ? meta["trustToken"] : null;
                          return trustToken ? (
                            <a
                              href={`/api/auth/trust-ip?token=${encodeURIComponent(trustToken)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center gap-1 text-[10px] text-emerald-400 hover:text-emerald-300 mt-1"
                            >
                              <ShieldCheck className="w-3 h-3" />
                              Trust this device
                            </a>
                          ) : null;
                        })()}
                        <p className="text-[10px] text-muted-foreground/50 mt-0.5">
                          {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        {!n.isRead && !target && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground hover:text-foreground"
                            onClick={(e) => { e.stopPropagation(); handleMarkOne(n.id, n.type, n.metadata); }}
                          >
                            <Check className="w-3 h-3" />
                          </Button>
                        )}
                        {prefField != null && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className={`h-6 w-6 transition-opacity ${isTypeMuted ? "opacity-100 text-amber-400 hover:text-amber-300" : "opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground"}`}
                                disabled={savingPrefs}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleToggleField(prefField, isTypeMuted);
                                }}
                              >
                                {isTypeMuted ? <Bell className="w-3 h-3" /> : <VolumeX className="w-3 h-3" />}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="left" className="text-xs max-w-[160px]">
                              {isTypeMuted
                                ? `Unmute "${IN_APP_NOTIF_LABELS[prefField]}"`
                                : `Mute "${IN_APP_NOTIF_LABELS[prefField]}"`}
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {!isAdmin && queueCount > 0 && (
            <div className="border-t border-border/50 px-4 py-2.5">
              <Link
                href="/merchant/security#quiet-hours"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 w-full rounded-md px-2 py-1.5 text-xs text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 transition-colors"
              >
                <Mail className="w-3.5 h-3.5 shrink-0" />
                <span className="flex-1 font-medium">
                  {queueCount} email{queueCount === 1 ? "" : "s"} queued (quiet hours)
                </span>
                <span className="text-amber-400/70 text-[10px]">View →</span>
              </Link>
            </div>
          )}
          {!isAdmin && (
            <div className={`${queueCount > 0 ? "" : "border-t border-border/50 "}px-4 py-2`}>
              <Link href="/merchant/notifications" onClick={() => setOpen(false)}>
                <Button variant="ghost" size="sm" className="w-full text-xs text-muted-foreground">
                  View all notifications
                </Button>
              </Link>
            </div>
          )}
          {!isAdmin && (
            <div className="border-t border-border/50">
              <button
                type="button"
                onClick={() => setShowPrefs((v) => !v)}
                className="flex items-center gap-2 w-full px-6 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
              >
                <Settings2 className="w-3.5 h-3.5 shrink-0" />
                <span className="flex-1 text-left">Manage notification preferences</span>
                {mutedCount > 0 && !showPrefs && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
                    <BellOff className="w-2.5 h-2.5" />
                    {mutedCount} muted
                  </span>
                )}
                {showPrefs ? (
                  <ChevronUp className="w-3.5 h-3.5 shrink-0 text-muted-foreground/60" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 shrink-0 text-muted-foreground/60" />
                )}
              </button>

              {showPrefs && (
                <div className="border-t border-border/40 bg-muted/10">
                  <div className="flex items-center justify-between px-4 pt-2.5 pb-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 flex items-center gap-1">
                      <Bell className="w-3 h-3" />
                      In-app alerts
                    </span>
                    <div className="flex items-center gap-1.5">
                      {mutedCount > 0 && (
                        <button
                          type="button"
                          onClick={handleRestoreAll}
                          disabled={savingPrefs}
                          className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400 hover:bg-emerald-500/25 transition-colors disabled:opacity-50"
                        >
                          <Bell className="w-2.5 h-2.5" />
                          Restore all
                        </button>
                      )}
                      {mutedCount < IN_APP_NOTIF_FIELDS.length && (
                        <button
                          type="button"
                          onClick={handleMuteAll}
                          disabled={savingPrefs}
                          className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-400 hover:bg-amber-500/25 transition-colors disabled:opacity-50"
                        >
                          <BellOff className="w-2.5 h-2.5" />
                          Mute all
                        </button>
                      )}
                    </div>
                  </div>
                  <ul className="divide-y divide-border/30 max-h-56 overflow-y-auto">
                    {IN_APP_NOTIF_FIELDS.map((field) => {
                      const isEnabled = meRecord ? (meRecord[field] !== false) : true;
                      return (
                        <li key={field} className="flex items-center gap-3 px-4 py-2">
                          <span className={`flex-1 text-xs ${isEnabled ? "text-foreground" : "text-muted-foreground/60"}`}>
                            {IN_APP_NOTIF_LABELS[field]}
                          </span>
                          <Switch
                            checked={isEnabled}
                            onCheckedChange={(val) => handleToggleField(field, val)}
                            disabled={savingPrefs || meData === undefined}
                            className="scale-75 origin-right"
                          />
                        </li>
                      );
                    })}
                  </ul>
                  <div className="px-4 py-2 border-t border-border/40">
                    <Link
                      href="/merchant/security#notification-settings"
                      onClick={() => { setShowPrefs(false); setOpen(false); }}
                      className="text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                    >
                      Full settings →
                    </Link>
                  </div>
                </div>
              )}
            </div>
          )}
        </PopoverContent>
      </Popover>
    </TooltipProvider>
  );
}
