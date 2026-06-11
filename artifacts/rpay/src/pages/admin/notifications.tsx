import { useState } from "react";
import { useListNotifications, useMarkAllNotificationsRead, useMarkNotificationRead } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Bell, Check, CheckCheck, AlertCircle, Mail, ExternalLink, Megaphone } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { getApiErrorMessage } from "@/lib/utils";

function extractMetadata(raw: unknown): Record<string, unknown> {
  if (raw == null) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; }
  }
  return {};
}

function notifIcon(type: string) {
  if (type === "reconciliation_email_failure" || type === "report_delivery_failure") return <Mail className="w-4 h-4" />;
  if (type === "system_notice") return <Megaphone className="w-4 h-4" />;
  return <AlertCircle className="w-4 h-4" />;
}

function notifColor(type: string): string {
  if (type === "reconciliation_email_failure" || type === "report_delivery_failure") return "text-red-400";
  if (type === "system_notice") return "text-blue-400";
  return "text-amber-400";
}

const TYPE_LABELS: Record<string, string> = {
  reconciliation_email_failure: "Email Failed",
  report_delivery_failure: "Delivery Failed",
  system_notice: "Notice",
};

type TypeFilter = "all" | "reconciliation_email_failure" | "report_delivery_failure" | "system_notice";

const TYPE_CHIPS: { value: TypeFilter; label: string; icon: React.ReactNode }[] = [
  { value: "all", label: "All", icon: <Bell className="w-3 h-3" /> },
  { value: "report_delivery_failure", label: "Delivery Failures", icon: <Mail className="w-3 h-3" /> },
  { value: "reconciliation_email_failure", label: "Email Failures", icon: <Mail className="w-3 h-3" /> },
  { value: "system_notice", label: "System Notice", icon: <Megaphone className="w-3 h-3" /> },
];

function getNotifLink(type: string, metadata: unknown): string | null {
  const meta = extractMetadata(metadata);
  if (type === "reconciliation_email_failure") {
    const runId = meta["runId"];
    if (runId != null) return `/admin/reconciliation?runId=${runId}`;
    return "/admin/reconciliation";
  }
  if (type === "report_delivery_failure") {
    const scheduleLink = typeof meta["scheduleLink"] === "string" ? meta["scheduleLink"] : null;
    if (scheduleLink) {
      return scheduleLink.replace(/^https?:\/\/[^/]+/, "");
    }
    return "/admin/audit-logs";
  }
  return null;
}

function getNotifLinkLabel(type: string): string {
  if (type === "report_delivery_failure") return "View schedule →";
  if (type === "reconciliation_email_failure") return "View run →";
  return "View →";
}

export default function AdminNotificationsPage() {
  const [tab, setTab] = useState<"all" | "unread">("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [page, setPage] = useState(1);
  const qc = useQueryClient();
  const [, navigate] = useLocation();

  const { data, isLoading, refetch } = useListNotifications({
    isRead: tab === "unread" ? "false" : undefined,
    type: typeFilter !== "all" ? typeFilter : undefined,
    page,
    limit: 20,
  });

  const markAll = useMarkAllNotificationsRead();
  const markOne = useMarkNotificationRead();

  function handleTabChange(v: string) {
    setTab(v as "all" | "unread");
    setPage(1);
  }

  function handleTypeFilter(v: TypeFilter) {
    setTypeFilter(v);
    setPage(1);
  }

  function handleMarkAll() {
    markAll.mutate(undefined, {
      onSuccess: () => {
        toast.success("All notifications marked as read");
        qc.invalidateQueries({ queryKey: ["/api/notifications"] });
        refetch();
      },
      onError: (err: unknown) => toast.error(getApiErrorMessage(err, "Failed to mark notifications as read")),
    });
  }

  function handleNotifClick(id: number, type: string, metadata: unknown, isRead: boolean) {
    if (!isRead) {
      markOne.mutate({ id }, {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: ["/api/notifications"] });
          refetch();
        },
        onError: (err: unknown) => toast.error(getApiErrorMessage(err, "Failed to mark notification as read")),
      });
    }
    const link = getNotifLink(type, metadata);
    if (link) navigate(link);
  }

  const notifications = data?.data ?? [];
  const total = data?.total ?? 0;
  const unread = data?.unread ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / 20));

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
        {unread > 0 && (
          <Button variant="outline" size="sm" onClick={handleMarkAll} disabled={markAll.isPending}>
            <CheckCheck className="w-4 h-4 mr-2" />
            Mark all read
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
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap gap-2">
        {TYPE_CHIPS.map(chip => (
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
          </button>
        ))}
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
                const link = getNotifLink(n.type, n.metadata);
                const isClickable = !!link || !n.isRead;
                return (
                  <li
                    key={n.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleNotifClick(n.id, n.type, n.metadata, n.isRead)}
                    onKeyDown={(e) => e.key === "Enter" && handleNotifClick(n.id, n.type, n.metadata, n.isRead)}
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
                        {link && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-primary/70">
                            <ExternalLink className="w-3 h-3" />
                            {getNotifLinkLabel(n.type)}
                          </span>
                        )}
                        {!n.isRead && (
                          <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mt-0.5 leading-snug">{n.body}</p>
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
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}
