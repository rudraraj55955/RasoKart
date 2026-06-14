import { useState, useRef, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { useListCallbackLogs, useGetMe, useUpdateMyPreferences, getGetMeQueryKey, useListMySecurityActivity, useListSecurityEvents, useListKnownLoginIps, useListTrustedIps, useDeleteTrustedIp, getListTrustedIpsQueryKey, useLabelKnownLoginIp, getListKnownLoginIpsQueryKey } from "@workspace/api-client-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
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
  KeyRound,
  RotateCcw,
  AlertTriangle,
  Bell,
  BellOff,
  Mail,
  ClipboardList,
  ChevronLeft,
  ChevronRight,
  LogIn,
  Monitor,
  MapPin,
  Trash2,
  Moon,
  Send,
} from "lucide-react";
import { format, subDays, startOfMonth, endOfMonth, subMonths, parseISO } from "date-fns";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useQueryClient } from "@tanstack/react-query";

// ─── Date presets ────────────────────────────────────────────────────────────

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

// ─── Callback log helpers ────────────────────────────────────────────────────

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

function buildCallbackCsvRows(data: any[]): string[][] {
  return data.map(log => [
    String(log.id),
    "callback",
    log.eventType ?? "",
    log.status,
    log.httpStatus != null ? String(log.httpStatus) : "",
    log.signatureVerified === true ? "verified" : log.signatureVerified === false ? "failed" : "no_secret",
    String(log.attempts),
    log.qrCodeId != null ? String(log.qrCodeId) : "",
    log.transactionId != null ? String(log.transactionId) : "",
    "",
    log.createdAt,
  ]);
}

function buildSecurityCsvRows(data: any[]): string[][] {
  return data.map(ev => [
    String(ev.id),
    "security",
    ev.eventType,
    "",
    "",
    "",
    "",
    "",
    ev.ipAddress ?? "",
    ev.actorEmail ?? "",
    ev.occurredAt,
  ]);
}

function buildCredentialEventCsvText(data: LocalSecurityEvent[]): string {
  const header = ["ID", "Event Type", "Key Prefix", "Actor Email", "IP Address", "Date"];
  const rows = data.map(ev => [
    String(ev.id),
    ev.eventType,
    ev.keyPrefix ?? "",
    ev.actorEmail ?? "",
    ev.ipAddress ?? "",
    ev.occurredAt,
  ]);
  return [header, ...rows].map(r => r.map(v => `"${v.replace(/"/g, '""')}"`).join(",")).join("\n");
}

function buildUnifiedCsvText(callbackData: any[], securityData: any[]): string {
  const header = ["ID", "Source", "Event Type", "Status", "HTTP Status", "Signature", "Attempts", "QR Code ID", "IP / Transaction ID", "Actor Email", "Date"];
  const rows = [
    header,
    ...buildCallbackCsvRows(callbackData),
    ...buildSecurityCsvRows(securityData),
  ];
  return rows.map(r => r.map(v => `"${v}"`).join(",")).join("\n");
}

// ─── Security event helpers ───────────────────────────────────────────────────

type SecurityEventType = "merchant_login" | "api_key_generated" | "api_key_revoked" | "callback_secret_rotated";

interface LocalSecurityEvent {
  id: number;
  eventType: SecurityEventType;
  actorEmail: string;
  keyPrefix?: string | null;
  ipAddress?: string | null;
  occurredAt: string;
}

function securityEventMeta(eventType: SecurityEventType) {
  switch (eventType) {
    case "merchant_login":
      return {
        icon: <LogIn className="w-4 h-4" />,
        label: "Login",
        badgeClass: "bg-sky-500/10 text-sky-400 border-sky-500/20",
      };
    case "callback_secret_rotated":
      return {
        icon: <RotateCcw className="w-4 h-4" />,
        label: "Secret Rotated",
        badgeClass: "bg-amber-500/10 text-amber-400 border-amber-500/20",
      };
    case "api_key_generated":
      return {
        icon: <KeyRound className="w-4 h-4" />,
        label: "Key Generated",
        badgeClass: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
      };
    case "api_key_revoked":
      return {
        icon: <KeyRound className="w-4 h-4" />,
        label: "Key Revoked",
        badgeClass: "bg-rose-500/10 text-rose-400 border-rose-500/20",
      };
    default:
      return {
        icon: <Monitor className="w-4 h-4" />,
        label: eventType,
        badgeClass: "bg-muted/10 text-muted-foreground border-border/50",
      };
  }
}

function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-amber-400/30 text-amber-200 rounded-sm px-0.5 not-italic font-medium">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

function SecurityEventRow({ event, highlight = "", myEmail = "" }: { event: LocalSecurityEvent; highlight?: string; myEmail?: string }) {
  const meta = securityEventMeta(event.eventType);
  const isLogin = event.eventType === "merchant_login";
  const isAdminAction = !isLogin && !!myEmail && !!event.actorEmail && event.actorEmail !== myEmail;
  const descText =
    isLogin
      ? null
      : event.keyPrefix
      ? `${event.eventType === "api_key_generated" ? "API key generated" : event.eventType === "api_key_revoked" ? "API key revoked" : "Callback secret rotated"} (${event.keyPrefix})`
      : event.eventType === "callback_secret_rotated"
      ? "Callback signing secret rotated"
      : meta.label;
  return (
    <div className="flex items-start gap-4 py-4">
      <div className="flex flex-col items-center gap-1 shrink-0">
        <span className="inline-flex items-center justify-center w-8 h-8 rounded-full border border-border/50 bg-muted/30 text-muted-foreground">
          {meta.icon}
        </span>
        <span className="w-px flex-1 min-h-[1.5rem]" style={{ background: "var(--border)" }} />
      </div>
      <div className="flex-1 min-w-0 pb-1">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <Badge variant="outline" className={`text-xs font-medium ${meta.badgeClass}`}>
            {meta.label}
          </Badge>
          {event.keyPrefix && (
            <code className="text-xs font-mono text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
              <HighlightText text={event.keyPrefix} query={highlight} />
            </code>
          )}
        </div>
        {isLogin ? (
          <p className="text-sm text-muted-foreground">
            Signed in{event.ipAddress ? <> from <code className="text-xs font-mono text-muted-foreground bg-muted/50 px-1 py-0.5 rounded"><HighlightText text={event.ipAddress} query={highlight} /></code></> : null}
          </p>
        ) : descText ? (
          <p className="text-sm text-muted-foreground">
            <HighlightText text={descText} query={highlight} />
          </p>
        ) : null}
        {!isLogin && (event.ipAddress || event.actorEmail) && (
          <div className="flex items-center gap-2 flex-wrap mt-1">
            {event.actorEmail && (
              isAdminAction ? (
                <span className="inline-flex items-center gap-1.5 text-xs">
                  <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 bg-amber-500/10 border border-amber-500/20 text-amber-400 font-medium">
                    <Shield className="w-3 h-3" />
                    Admin action
                  </span>
                  <span className="text-muted-foreground/40">by</span>
                  <code className="font-mono text-muted-foreground bg-muted/50 px-1 py-0.5 rounded"><HighlightText text={event.actorEmail} query={highlight} /></code>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground/70">
                  <span className="text-muted-foreground/40">by you</span>
                </span>
              )
            )}
            {event.ipAddress && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground/70">
                <span className="text-muted-foreground/40">from</span>
                <code className="font-mono text-muted-foreground bg-muted/50 px-1 py-0.5 rounded"><HighlightText text={event.ipAddress} query={highlight} /></code>
              </span>
            )}
          </div>
        )}
        <p className="text-xs text-muted-foreground/50 mt-1">
          {format(new Date(event.occurredAt), "dd MMM yyyy 'at' HH:mm")}
        </p>
      </div>
      <span className="text-xs text-muted-foreground/40 shrink-0 pt-0.5 hidden sm:block">
        {format(new Date(event.occurredAt), "dd MMM yyyy")}
      </span>
    </div>
  );
}

function CredentialEventSkeletonRows() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-start gap-4 py-4">
          <div className="flex flex-col items-center gap-1 shrink-0">
            <Skeleton className="w-8 h-8 rounded-full" />
          </div>
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-3 w-28" />
          </div>
        </div>
      ))}
    </>
  );
}

// ─── Notification preference change helpers ───────────────────────────────────

const PREF_FIELD_LABELS: Record<string, string> = {
  apiKeyGeneratedEmails: "API key generated",
  apiKeyRevokedEmails: "API key revoked",
  signatureFailureAlertEmails: "Signature failure alerts",
  loginAlertEmails: "New login alerts",
  reportScheduleChangedEmails: "Report schedule changed",
  settlementStateChangedEmails: "Settlement state changed",
  reconciliationAlertEmails: "Reconciliation alerts",
  planExpiryAlertEmails: "Plan expiry alerts",
  settlementStateEmails: "Settlement state emails",
  webhookFailureEmails: "Webhook failure emails",
  reportFailureAlertEmails: "Report failure alerts",
  weeklyDeliveryDigestEmails: "Weekly delivery digest",
  ekqrSyncAlertEmails: "EKQR sync alerts",
  planChangeEmails: "Plan change emails",
};

function NotifPrefChanges({ details }: { details: string | null | undefined }) {
  if (!details) return null;
  let parsed: { changes?: Array<{ field: string; oldValue: boolean; newValue: boolean }> };
  try { parsed = JSON.parse(details); } catch { return null; }
  const changes = parsed?.changes;
  if (!Array.isArray(changes) || changes.length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5 mt-0.5">
      {changes.map((c, i) => (
        <span key={i} className="inline-flex items-center gap-1 flex-wrap text-xs">
          <span className="text-muted-foreground/70">{PREF_FIELD_LABELS[c.field] ?? c.field}:</span>
          <span className={`font-medium ${c.oldValue ? "text-emerald-400" : "text-rose-400"}`}>
            {c.oldValue ? "On" : "Off"}
          </span>
          <span className="text-muted-foreground/40">→</span>
          <span className={`font-medium ${c.newValue ? "text-emerald-400" : "text-rose-400"}`}>
            {c.newValue ? "On" : "Off"}
          </span>
        </span>
      ))}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function MerchantSecurity() {
  const qc = useQueryClient();
  const locationSearch = useSearch();
  const [, setLocation] = useLocation();

  // IP filter — read from URL on mount
  const [ipFilter, setIpFilter] = useState<string>(() => {
    const params = new URLSearchParams(locationSearch);
    return params.get("ip") ?? "";
  });

  const credEventRef = useRef<HTMLDivElement>(null);
  const notificationSettingsRef = useRef<HTMLDivElement>(null);

  // Deep-link: scroll to notification settings when ?section=notifications
  useEffect(() => {
    const params = new URLSearchParams(locationSearch);
    if (params.get("section") === "notifications") {
      setTimeout(() => notificationSettingsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyIpFilter(ip: string) {
    setIpFilter(ip);
    setSecPage(1);
    // Always scope to login events when filtering by IP — the task asks for
    // "merchant_login events from that IP"
    setSecEventType("merchant_login");
    const next = new URLSearchParams(locationSearch);
    if (ip) {
      next.set("ip", ip);
    } else {
      next.delete("ip");
    }
    setLocation(`?${next.toString()}`, { replace: true });
    // Scroll to credential event history
    setTimeout(() => credEventRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  function clearIpFilter() {
    setIpFilter("");
    setSecPage(1);
    setSecEventType("all");
    const next = new URLSearchParams(locationSearch);
    next.delete("ip");
    const qs = next.toString();
    setLocation(qs ? `?${qs}` : window.location.pathname, { replace: true });
  }

  // Security notification preferences
  const { data: me } = useGetMe();
  const apiKeyGeneratedEnabled = me?.apiKeyGeneratedEmails ?? true;
  const apiKeyRevokedEnabled = me?.apiKeyRevokedEmails ?? true;
  const signatureFailureAlertEnabled = me?.signatureFailureAlertEmails ?? true;
  const loginAlertEnabled = me?.loginAlertEmails ?? true;
  const reportScheduleChangedEnabled = me?.reportScheduleChangedEmails ?? true;
  const settlementStateChangedEnabled = me?.settlementStateChangedEmails ?? true;
  const reconciliationAlertEnabled = me?.reconciliationAlertEmails ?? true;
  const planExpiryAlertEnabled = me?.planExpiryAlertEmails ?? true;
  const settlementStateEnabled = me?.settlementStateEmails ?? true;
  const webhookFailureEnabled = me?.webhookFailureEmails ?? true;
  const reportFailureAlertEnabled = me?.reportFailureAlertEmails ?? true;
  const weeklyDeliveryDigestEnabled = me?.weeklyDeliveryDigestEmails ?? true;
  const ekqrSyncAlertEnabled = me?.ekqrSyncAlertEmails ?? true;
  const planChangeEnabled = me?.planChangeEmails ?? true;

  const disabledNotifications = me == null ? [] : [
    ...(!apiKeyGeneratedEnabled ? ["API key generated"] : []),
    ...(!apiKeyRevokedEnabled ? ["API key revoked"] : []),
    ...(!signatureFailureAlertEnabled ? ["Signature failure alerts"] : []),
    ...(!loginAlertEnabled ? ["New login alerts"] : []),
    ...(!settlementStateEnabled ? ["Settlement state emails"] : []),
    ...(!settlementStateChangedEnabled ? ["Settlement state changed"] : []),
    ...(!reconciliationAlertEnabled ? ["Reconciliation alerts"] : []),
    ...(!planExpiryAlertEnabled ? ["Plan expiry alerts"] : []),
    ...(!planChangeEnabled ? ["Plan change emails"] : []),
    ...(!webhookFailureEnabled ? ["Webhook failure emails"] : []),
    ...(!ekqrSyncAlertEnabled ? ["EKQR sync alerts"] : []),
    ...(!reportScheduleChangedEnabled ? ["Report schedule changed"] : []),
    ...(!reportFailureAlertEnabled ? ["Report failure alerts"] : []),
    ...(!weeklyDeliveryDigestEnabled ? ["Weekly delivery digest"] : []),
  ];

  const [notifBannerDismissed, setNotifBannerDismissed] = useState(false);

  // Quiet hours draft state (local until saved)
  const [qhStart, setQhStart] = useState<string>("");
  const [qhEnd, setQhEnd] = useState<string>("");
  const [qhTimezone, setQhTimezone] = useState<string>("");
  const [qhEnabled, setQhEnabled] = useState<boolean>(false);
  const [flushingQueue, setFlushingQueue] = useState(false);

  // Sync quiet hours draft state from server data when me loads
  useEffect(() => {
    if (!me) return;
    const start = (me as any).quietHoursStart ?? null;
    const end = (me as any).quietHoursEnd ?? null;
    const tz = (me as any).quietHoursTimezone ?? null;
    const enabled = !!(start && end && tz);
    setQhEnabled(enabled);
    setQhStart(start ?? "22:00");
    setQhEnd(end ?? "07:00");
    setQhTimezone(tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, [me?.email]);

  function handleSaveQuietHours() {
    if (qhEnabled) {
      if (!qhStart || !qhEnd || !qhTimezone) {
        toast.error("Please fill in start time, end time, and timezone.");
        return;
      }
      updatePrefs({ data: { quietHoursStart: qhStart, quietHoursEnd: qhEnd, quietHoursTimezone: qhTimezone } as any });
    } else {
      updatePrefs({ data: { quietHoursStart: null, quietHoursEnd: null, quietHoursTimezone: null } as any });
    }
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
    } catch {
      toast.error("Failed to flush queued emails");
    } finally {
      setFlushingQueue(false);
    }
  }

  const { mutate: updatePrefs, isPending: savingPrefs } = useUpdateMyPreferences({
    mutation: {
      onSuccess: (updated) => {
        toast.success("Notification preferences saved");
        qc.setQueryData(getGetMeQueryKey(), (old: any) => ({ ...old, ...updated }));
      },
      onError: (err: Error) => toast.error(err.message),
    },
  });

  // Callback log state
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

  const { data: rawData, isLoading: logsLoading } = useListCallbackLogs({
    status: status === "all" ? undefined : (status as any),
    signatureVerified: sigFilter === "all" ? undefined : (sigFilter as any),
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    limit: 20,
    page,
  });

  const allLogs = rawData?.data ?? [];
  const serverTotal = rawData?.total ?? 0;

  const filteredLogs = allLogs.filter(log => {
    if (search) {
      const q = search.toLowerCase();
      const matchId = String(log.id).includes(q);
      const matchEvent = (log.eventType ?? "").toLowerCase().includes(q);
      const matchQr = log.qrCodeId != null ? String(log.qrCodeId).includes(q) : false;
      if (!matchId && !matchEvent && !matchQr) return false;
    }
    return true;
  });

  const PAGE_SIZE = 20;
  const totalFiltered = search ? filteredLogs.length : serverTotal;
  const totalPages = Math.max(1, Math.ceil(serverTotal / PAGE_SIZE));
  const pageSlice = filteredLogs;

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

  // Security events state
  const [secEventType, setSecEventType] = useState("all");
  const [secDateFrom, setSecDateFrom] = useState("");
  const [secDateTo, setSecDateTo] = useState("");
  const [secSearch, setSecSearch] = useState("");
  const [secPage, setSecPage] = useState(1);
  const SEC_PAGE_SIZE = 20;

  const { data: secEventsData, isLoading: secEventsLoading } = useListSecurityEvents({
    limit: SEC_PAGE_SIZE,
    page: secPage,
    eventType: secEventType === "all" ? undefined : (secEventType as any),
    dateFrom: secDateFrom || undefined,
    dateTo: secDateTo || undefined,
    ipAddress: ipFilter || undefined,
  });

  const allSecEvents = (secEventsData?.data ?? []) as LocalSecurityEvent[];
  const secPageSlice = secSearch
    ? allSecEvents.filter(ev => {
        const q = secSearch.toLowerCase();
        const meta = securityEventMeta(ev.eventType);
        return [ev.keyPrefix ?? "", meta.label, ev.eventType.replace(/_/g, " "), ev.actorEmail ?? "", ev.ipAddress ?? ""]
          .join(" ").toLowerCase().includes(q);
      })
    : allSecEvents;
  const secTotal = secEventsData?.total ?? 0;
  const secTotalPages = Math.max(1, Math.ceil(secTotal / SEC_PAGE_SIZE));

  const anySecFilterActive = !!(secEventType !== "all" || secDateFrom || secDateTo || secSearch || ipFilter);

  // Known login IPs
  const { data: knownIpsData, isLoading: knownIpsLoading } = useListKnownLoginIps();

  // Trusted IPs
  const { data: trustedIpsData, isLoading: trustedIpsLoading } = useListTrustedIps();
  const [removingTrustedIpId, setRemovingTrustedIpId] = useState<number | null>(null);
  const { mutate: deleteTrustedIp } = useDeleteTrustedIp({
    mutation: {
      onSuccess: (_data, { id }) => {
        toast.success("Trusted IP removed. You will receive login alerts from this address again.");
        qc.invalidateQueries({ queryKey: getListTrustedIpsQueryKey() });
        setRemovingTrustedIpId(null);
      },
      onError: (err: Error) => {
        toast.error(err.message ?? "Failed to remove trusted IP");
        setRemovingTrustedIpId(null);
      },
    },
  });

  function handleRemoveTrustedIp(id: number) {
    setRemovingTrustedIpId(id);
    deleteTrustedIp({ id });
  }

  const { mutate: labelIp, isPending: labelingIp } = useLabelKnownLoginIp({
    mutation: {
      onSuccess: (updated) => {
        qc.setQueryData(getListKnownLoginIpsQueryKey(), (prev: any) => {
          if (!prev) return prev;
          return {
            ...prev,
            data: prev.data.map((row: any) =>
              row.ipAddress === updated.ipAddress ? { ...row, label: updated.label, labeledAt: updated.labeledAt } : row
            ),
          };
        });
        toast.success(
          updated.label === "trusted"
            ? "IP marked as trusted"
            : updated.label === "suspicious"
            ? "IP flagged as suspicious"
            : "IP label cleared"
        );
      },
      onError: (err: Error) => toast.error(err.message),
    },
  });

  const [labelingIpAddress, setLabelingIpAddress] = useState<string | null>(null);

  function handleLabelIp(ipAddress: string, label: "trusted" | "suspicious" | null) {
    setLabelingIpAddress(ipAddress);
    labelIp(
      { ipAddress: encodeURIComponent(ipAddress), data: { label } },
      { onSettled: () => setLabelingIpAddress(null) }
    );
  }

  const [exportingSecEvents, setExportingSecEvents] = useState(false);

  async function fetchAllSecurityEvents(params: { eventType?: string; dateFrom?: string; dateTo?: string }): Promise<LocalSecurityEvent[]> {
    const token = localStorage.getItem("rasokart_token");
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    const results: LocalSecurityEvent[] = [];
    let fetchPage = 1;
    const FETCH_LIMIT = 200;
    while (true) {
      const qp = new URLSearchParams({ limit: String(FETCH_LIMIT), page: String(fetchPage) });
      if (params.eventType && params.eventType !== "all") qp.set("eventType", params.eventType);
      if (params.dateFrom) qp.set("dateFrom", params.dateFrom);
      if (params.dateTo) qp.set("dateTo", params.dateTo);
      const res = await fetch(`/api/security/events?${qp}`, { headers });
      if (!res.ok) throw new Error("Failed to fetch security events");
      const json = await res.json();
      results.push(...(json.data as LocalSecurityEvent[]));
      if (results.length >= json.total || json.data.length < FETCH_LIMIT) break;
      fetchPage++;
    }
    return results;
  }

  async function fetchAllCallbackLogs(params: { status?: string; signatureVerified?: string; dateFrom?: string; dateTo?: string }): Promise<any[]> {
    const token = localStorage.getItem("rasokart_token");
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    const results: any[] = [];
    let fetchPage = 1;
    const FETCH_LIMIT = 100;
    while (true) {
      const qp = new URLSearchParams({ limit: String(FETCH_LIMIT), page: String(fetchPage) });
      if (params.status && params.status !== "all") qp.set("status", params.status);
      if (params.signatureVerified && params.signatureVerified !== "all") qp.set("signatureVerified", params.signatureVerified);
      if (params.dateFrom) qp.set("dateFrom", params.dateFrom);
      if (params.dateTo) qp.set("dateTo", params.dateTo);
      const res = await fetch(`/api/callbacks?${qp}`, { headers });
      if (!res.ok) throw new Error("Failed to fetch callback logs");
      const json = await res.json();
      results.push(...json.data);
      const effectiveLimit: number = json.limit ?? FETCH_LIMIT;
      if (results.length >= json.total || json.data.length < effectiveLimit) break;
      fetchPage++;
    }
    return results;
  }

  async function handleExportCsv() {
    setExporting(true);
    try {
      const [allSecEvents, allCallbackLogs] = await Promise.all([
        fetchAllSecurityEvents({ eventType: secEventType, dateFrom: secDateFrom, dateTo: secDateTo }),
        fetchAllCallbackLogs({ status, signatureVerified: sigFilter, dateFrom, dateTo }),
      ]);
      if (!allCallbackLogs.length && !allSecEvents.length) {
        toast.info("No records to export");
        return;
      }
      const csv = buildUnifiedCsvText(allCallbackLogs, allSecEvents);
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

  async function handleExportSecEventsCsv() {
    setExportingSecEvents(true);
    try {
      const allSecEvents = await fetchAllSecurityEvents({ eventType: secEventType, dateFrom: secDateFrom, dateTo: secDateTo });
      if (!allSecEvents.length) {
        toast.info("No events to export");
        return;
      }
      const csv = buildCredentialEventCsvText(allSecEvents);
      const rowCount = allSecEvents.length;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      a.download = `credential-events-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      toast.success(`Exported ${rowCount} event${rowCount !== 1 ? "s" : ""}`);
    } catch {
      toast.error("Export failed");
    } finally {
      setExportingSecEvents(false);
    }
  }

  // Admin activity log state
  const [activityPage, setActivityPage] = useState(1);
  const [activityDateFrom, setActivityDateFrom] = useState("");
  const [activityDateTo, setActivityDateTo] = useState("");
  const [exportingActivity, setExportingActivity] = useState(false);

  const ACTIVITY_PAGE_SIZE = 20;

  const { data: activityData, isLoading: activityLoading } = useListMySecurityActivity({
    page: activityPage,
    limit: ACTIVITY_PAGE_SIZE,
    dateFrom: activityDateFrom || undefined,
    dateTo: activityDateTo || undefined,
  });

  const activityRows = activityData?.data ?? [];
  const activityTotal = activityData?.total ?? 0;
  const activityTotalPages = Math.max(1, Math.ceil(activityTotal / ACTIVITY_PAGE_SIZE));

  function handleExportActivityCsv() {
    setExportingActivity(true);
    const token = localStorage.getItem("rasokart_token");
    fetch("/api/audit-logs/my-activity/export", {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(async (res) => {
        if (!res.ok) throw new Error("Export failed");
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `admin-activity-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success("Activity log exported");
      })
      .catch(() => toast.error("Export failed"))
      .finally(() => setExportingActivity(false));
  }

  function formatAction(action: string): string {
    return action.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
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
          <p className="text-muted-foreground mt-1">Incoming callback events, signature verification, delivery status, and credential changes</p>
        </div>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportCsv}
                disabled={exporting || (!filteredLogs.length && !secTotal)}
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

      {/* Callback logs filter + table */}
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
              {logsLoading ? (
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
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      #<HighlightText text={String(log.id)} query={search} />
                    </TableCell>
                    <TableCell>
                      {log.eventType ? (
                        <span className="font-mono text-xs text-sky-400">
                          <HighlightText text={log.eventType} query={search} />
                        </span>
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
                        <span className="font-mono text-xs text-blue-400">
                          QR #<HighlightText text={String(log.qrCodeId)} query={search} />
                        </span>
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

      {/* Admin Activity Log */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-violet-400" />
              Account Activity Log
            </CardTitle>
            <div className="flex items-center gap-2">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleExportActivityCsv}
                      disabled={exportingActivity || activityTotal === 0}
                      className="border-sky-500/30 text-sky-400 hover:bg-sky-500/10 hover:text-sky-300 hover:border-sky-500/50"
                    >
                      {exportingActivity
                        ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                        : <FileDown className="w-3.5 h-3.5 mr-1.5" />}
                      {exportingActivity ? "Exporting…" : "Export CSV"}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    Download all admin actions on your account as CSV
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Admin actions on your account and your own notification preference changes
          </p>
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <span className="text-xs text-muted-foreground font-medium">Date range:</span>
            <Input
              type="date"
              className="w-[150px] h-8 text-xs [color-scheme:dark]"
              value={activityDateFrom}
              onChange={e => { setActivityDateFrom(e.target.value); setActivityPage(1); }}
              title="From date"
            />
            <span className="text-muted-foreground text-sm">to</span>
            <Input
              type="date"
              className="w-[150px] h-8 text-xs [color-scheme:dark]"
              value={activityDateTo}
              onChange={e => { setActivityDateTo(e.target.value); setActivityPage(1); }}
              title="To date"
            />
            {(activityDateFrom || activityDateTo) && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs text-muted-foreground hover:text-foreground gap-1"
                onClick={() => { setActivityDateFrom(""); setActivityDateTo(""); setActivityPage(1); }}
              >
                <X className="w-3 h-3" />
                Clear
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">ID</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Details</TableHead>
                <TableHead>IP Address</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activityLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 5 }).map((_, j) => (
                      <TableCell key={j}><div className="h-4 bg-muted/50 rounded animate-pulse" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : !activityRows.length ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-12">
                    <div className="flex flex-col items-center gap-2">
                      <ClipboardList className="w-8 h-8 text-muted-foreground/30" />
                      <p>{(activityDateFrom || activityDateTo) ? "No activity in this date range" : "No account activity recorded yet"}</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                activityRows.map(row => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">#{row.id}</TableCell>
                    <TableCell>
                      <div>
                        <span className="font-mono text-xs text-violet-400">{formatAction(row.action)}</span>
                        {row.action === "notification_preferences_updated" && (
                          <Badge variant="outline" className="ml-2 text-xs font-normal text-sky-400 border-sky-500/30">
                            by you
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[260px]">
                      {row.action === "notification_preferences_updated" ? (
                        <NotifPrefChanges details={row.details} />
                      ) : (
                        <span className="text-muted-foreground/40 text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {row.ipAddress ?? <span className="text-muted-foreground/40">—</span>}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {format(new Date(row.createdAt), "MMM d, yyyy HH:mm")}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
        {activityTotalPages > 1 && (
          <div className="flex items-center justify-between px-6 py-3 border-t border-border/50">
            <p className="text-xs text-muted-foreground">
              {((activityPage - 1) * ACTIVITY_PAGE_SIZE) + 1}–{Math.min(activityPage * ACTIVITY_PAGE_SIZE, activityTotal)} of {activityTotal.toLocaleString()} events
            </p>
            <div className="flex gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => setActivityPage(p => Math.max(1, p - 1))}
                disabled={activityPage === 1}
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => setActivityPage(p => Math.min(activityTotalPages, p + 1))}
                disabled={activityPage === activityTotalPages}
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Known login locations */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <MapPin className="w-4 h-4 text-muted-foreground" />
            Known Login Locations
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            IP addresses that have previously signed into your account — up to the last 10 unique locations. Click a row to filter the event history below by that IP, or mark IPs as trusted or flag them as suspicious.
          </p>
        </CardHeader>
        <CardContent>
          {knownIpsLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map(i => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-7 w-28" />
                </div>
              ))}
            </div>
          ) : !knownIpsData?.data?.length ? (
            <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
              <MapPin className="w-7 h-7 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No login locations recorded yet</p>
              <p className="text-xs text-muted-foreground/60">IP addresses will appear here after your first login.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-border/40">
                  <TableHead className="text-xs text-muted-foreground font-medium h-8">IP Address</TableHead>
                  <TableHead className="text-xs text-muted-foreground font-medium h-8">First Seen</TableHead>
                  <TableHead className="text-xs text-muted-foreground font-medium h-8">Last Seen</TableHead>
                  <TableHead className="text-xs text-muted-foreground font-medium h-8">Status</TableHead>
                  <TableHead className="text-xs text-muted-foreground font-medium h-8 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {knownIpsData.data.map((row) => {
                  const isActive = ipFilter === row.ipAddress;
                  const isActing = labelingIpAddress === row.ipAddress && labelingIp;
                  return (
                    <TableRow
                      key={row.ipAddress}
                      className={`group border-border/40 cursor-pointer transition-colors ${isActive ? "bg-sky-500/10 hover:bg-sky-500/15" : "hover:bg-muted/30"}`}
                      onClick={() => isActive ? clearIpFilter() : applyIpFilter(row.ipAddress)}
                      title={isActive ? "Clear IP filter" : `Filter credential events by ${row.ipAddress}`}
                    >
                      <TableCell className="py-2.5">
                        <div className="flex items-center gap-2">
                          <code className={`text-xs font-mono px-1.5 py-0.5 rounded ${isActive ? "text-sky-300 bg-sky-500/20" : "text-foreground/90 bg-muted/50"}`}>
                            {row.ipAddress}
                          </code>
                          {isActive ? (
                            <span className="inline-flex items-center gap-1 text-xs text-sky-400 border border-sky-500/40 rounded-full px-1.5 py-0.5 bg-sky-500/10">
                              <X className="w-2.5 h-2.5" />
                              filtered
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-opacity">
                              click to filter ↓
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="py-2.5 text-xs text-muted-foreground">
                        {format(new Date(row.firstSeen), "dd MMM yyyy 'at' HH:mm")}
                      </TableCell>
                      <TableCell className="py-2.5 text-xs text-muted-foreground">
                        {format(new Date(row.lastSeen), "dd MMM yyyy 'at' HH:mm")}
                      </TableCell>


                      <TableCell className="py-2.5">
                        {row.label === "trusted" ? (
                          <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 gap-1 text-xs">
                            <CheckCircle2 className="w-3 h-3" />
                            Trusted
                          </Badge>
                        ) : row.label === "suspicious" ? (
                          <Badge className="bg-rose-500/10 text-rose-400 border-rose-500/20 gap-1 text-xs">
                            <AlertTriangle className="w-3 h-3" />
                            Suspicious
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground/50 border-border/40 text-xs">
                            Unlabelled
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {isActing ? (
                            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                          ) : (
                            <>
                              <TooltipProvider delayDuration={300}>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant={row.label === "trusted" ? "secondary" : "outline"}
                                      size="sm"
                                      className={`h-7 text-xs px-2.5 gap-1 ${row.label === "trusted" ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/30" : "text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10 hover:border-emerald-500/50"}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleLabelIp(row.ipAddress, row.label === "trusted" ? null : "trusted");
                                      }}
                                      disabled={labelingIp}
                                    >
                                      <CheckCircle2 className="w-3 h-3" />
                                      {row.label === "trusted" ? "Trusted" : "Trust"}
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="text-xs">
                                    {row.label === "trusted" ? "Click to remove trust label" : "Mark this IP as a trusted device"}
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                              <TooltipProvider delayDuration={300}>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant={row.label === "suspicious" ? "secondary" : "outline"}
                                      size="sm"
                                      className={`h-7 text-xs px-2.5 gap-1 ${row.label === "suspicious" ? "bg-rose-500/20 text-rose-300 border-rose-500/40 hover:bg-rose-500/30" : "text-rose-400 border-rose-500/30 hover:bg-rose-500/10 hover:border-rose-500/50"}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleLabelIp(row.ipAddress, row.label === "suspicious" ? null : "suspicious");
                                      }}
                                      disabled={labelingIp}
                                    >
                                      <AlertTriangle className="w-3 h-3" />
                                      {row.label === "suspicious" ? "Flagged" : "Flag"}
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="text-xs">
                                    {row.label === "suspicious" ? "Click to remove suspicious label" : "Flag this IP as suspicious"}
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </>
                          )}
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

      {/* Trusted Locations */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            Trusted Locations
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            IP addresses you have marked as trusted. Login alerts are suppressed from these addresses. Remove any you no longer recognise or use.
          </p>
        </CardHeader>
        <CardContent>
          {trustedIpsLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map(i => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-36" />
                  <Skeleton className="h-7 w-20 ml-auto" />
                </div>
              ))}
            </div>
          ) : !trustedIpsData?.data?.length ? (
            <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
              <ShieldOff className="w-7 h-7 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No trusted locations yet</p>
              <p className="text-xs text-muted-foreground/60">
                When you receive a login alert email, you can trust that IP to suppress future alerts.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-border/40">
                  <TableHead className="text-xs text-muted-foreground font-medium h-8">IP Address</TableHead>
                  <TableHead className="text-xs text-muted-foreground font-medium h-8">Trusted Since</TableHead>
                  <TableHead className="text-xs text-muted-foreground font-medium h-8 w-[100px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {trustedIpsData.data.map((row) => (
                  <TableRow key={row.id} className="border-border/40">
                    <TableCell className="py-2.5">
                      <code className="text-xs font-mono text-foreground/90 bg-muted/50 px-1.5 py-0.5 rounded">
                        {row.ipAddress}
                      </code>
                    </TableCell>
                    <TableCell className="py-2.5 text-xs text-muted-foreground">
                      {format(new Date(row.trustedAt), "dd MMM yyyy 'at' HH:mm")}
                    </TableCell>
                    <TableCell className="py-2.5 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs gap-1.5 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
                        disabled={removingTrustedIpId === row.id}
                        onClick={() => handleRemoveTrustedIp(row.id)}
                      >
                        {removingTrustedIpId === row.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Trash2 className="w-3 h-3" />
                        )}
                        Remove
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Security event history */}
      <Card ref={credEventRef}>
        <CardHeader className="pb-3 space-y-3">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base flex items-center gap-2 flex-1">
              <Shield className="w-4 h-4 text-muted-foreground" />
              Credential Event History
            </CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportSecEventsCsv}
              disabled={exportingSecEvents || secTotal === 0}
              className="h-7 text-xs gap-1.5 border-sky-500/30 text-sky-400 hover:bg-sky-500/10 hover:text-sky-300 hover:border-sky-500/50"
            >
              {exportingSecEvents
                ? <Loader2 className="w-3 h-3 animate-spin" />
                : <FileDown className="w-3 h-3" />}
              {exportingSecEvents ? "Exporting…" : "Export CSV"}
            </Button>
            {anySecFilterActive && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
                onClick={() => { setSecEventType("all"); setSecDateFrom(""); setSecDateTo(""); setSecSearch(""); setSecPage(1); clearIpFilter(); }}
              >
                <X className="w-3 h-3" />
                Clear
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportSecEventsCsv}
              disabled={exportingSecEvents || secTotal === 0}
              className="h-7 text-xs border-sky-500/30 text-sky-400 hover:bg-sky-500/10 hover:text-sky-300 hover:border-sky-500/50 gap-1.5"
            >
              {exportingSecEvents
                ? <Loader2 className="w-3 h-3 animate-spin" />
                : <FileDown className="w-3 h-3" />}
              {exportingSecEvents ? "Exporting…" : "Export CSV"}
            </Button>
          </div>
          <div className="flex flex-col gap-2">
            {ipFilter && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground">Filtered by IP:</span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/40 bg-sky-500/10 text-sky-300 text-xs font-mono px-2.5 py-0.5">
                  <MapPin className="w-3 h-3 shrink-0" />
                  {ipFilter}
                  <button
                    onClick={clearIpFilter}
                    className="ml-0.5 text-sky-400/60 hover:text-sky-300 transition-colors"
                    aria-label="Clear IP filter"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              </div>
            )}
            <div className="flex flex-wrap gap-1.5">
              {[
                { value: "all", label: "All" },
                { value: "merchant_login", label: "Logins" },
                { value: "api_key_generated", label: "Key Generated" },
                { value: "api_key_revoked", label: "Key Revoked" },
                { value: "callback_secret_rotated", label: "Secret Rotated" },
              ].map(opt => (
                <Button
                  key={opt.value}
                  variant={secEventType === opt.value ? "secondary" : "outline"}
                  size="sm"
                  className={`h-7 text-xs px-3 ${secEventType === opt.value ? "bg-violet-500/20 text-violet-300 border-violet-500/40 hover:bg-violet-500/30" : "text-muted-foreground hover:text-foreground"}`}
                  onClick={() => { setSecEventType(opt.value); setSecPage(1); }}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <CalendarRange className="w-3.5 h-3.5 text-muted-foreground" />
              <Input
                type="date"
                className="w-[140px] h-7 text-xs [color-scheme:dark]"
                value={secDateFrom}
                onChange={e => { setSecDateFrom(e.target.value); setSecPage(1); }}
                title="From date"
              />
              <span className="text-muted-foreground text-xs">to</span>
              <Input
                type="date"
                className="w-[140px] h-7 text-xs [color-scheme:dark]"
                value={secDateTo}
                onChange={e => { setSecDateTo(e.target.value); setSecPage(1); }}
                title="To date"
              />
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search by key prefix or description…"
                value={secSearch}
                onChange={e => { setSecSearch(e.target.value); setSecPage(1); }}
                className="h-7 pl-8 text-xs"
              />
              {secSearch && (
                <button
                  onClick={() => { setSecSearch(""); setSecPage(1); }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
          {anySecFilterActive && (
            <p className="text-xs text-muted-foreground mt-2">
              <span className="font-semibold text-foreground">{secTotal.toLocaleString()}</span> event{secTotal !== 1 ? "s" : ""} match your filters
            </p>
          )}
        </CardHeader>
        <CardContent>
          {secEventsLoading ? (
            <CredentialEventSkeletonRows />
          ) : secPageSlice.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
              <Shield className="w-8 h-8 text-muted-foreground/30" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  {secSearch
                    ? `No events match "${secSearch}"`
                    : anySecFilterActive
                    ? "No events match your filters"
                    : "No security events recorded yet"}
                </p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  {secSearch
                    ? "Try a different key prefix or description term."
                    : anySecFilterActive
                    ? "Try clearing the filters to see all events."
                    : "Login events, key generation, and secret rotations will appear here."}
                </p>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-border/40">
              {secPageSlice.map(event => (
                <SecurityEventRow key={event.id} event={event} highlight={secSearch} myEmail={me?.email ?? ""} />
              ))}
            </div>
          )}
          {secEventsData != null && (
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-border/40">
              <p className="text-xs text-muted-foreground">
                {secTotal.toLocaleString()} total event{secTotal !== 1 ? "s" : ""}
              </p>
              {secTotalPages > 1 && (
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">Page {secPage} of {secTotalPages}</span>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setSecPage(p => Math.max(1, p - 1))} disabled={secPage === 1}>Previous</Button>
                    <Button variant="outline" size="sm" onClick={() => setSecPage(p => Math.min(secTotalPages, p + 1))} disabled={secPage === secTotalPages}>Next</Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Disabled notifications summary banner */}
      {disabledNotifications.length > 0 && !notifBannerDismissed && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 px-4 py-3 flex items-start gap-3">
          <BellOff className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-amber-300">
              {disabledNotifications.length === 1
                ? "1 email notification is turned off"
                : `${disabledNotifications.length} email notifications are turned off`}
            </p>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {disabledNotifications.map(name => (
                <span
                  key={name}
                  className="inline-flex items-center gap-1 text-xs font-medium text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded px-2 py-0.5"
                >
                  <BellOff className="w-3 h-3" />
                  {name}
                </span>
              ))}
            </div>
            <p className="text-xs text-amber-400/60 mt-2">
              Review the notification settings below to re-enable any alerts you want to receive.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setNotifBannerDismissed(true)}
            className="shrink-0 p-1 rounded-md text-amber-400/60 hover:text-amber-400 hover:bg-amber-500/10 transition-colors"
            aria-label="Dismiss notification summary"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Security Notifications */}
      <Card ref={notificationSettingsRef}>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Bell className="w-4 h-4 text-muted-foreground" />
            Security Notifications
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            Choose which security events trigger an email alert to your registered address.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/5 px-4 py-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                <p className="text-sm font-medium">API key generated</p>
              </div>
              <p className="text-xs text-muted-foreground pl-5">
                Receive an email whenever a new API key is created on your account.
              </p>
            </div>
            <Switch
              checked={apiKeyGeneratedEnabled}
              onCheckedChange={val => updatePrefs({ data: { apiKeyGeneratedEmails: val } })}
              disabled={savingPrefs || me === undefined}
            />
          </div>
          {!apiKeyGeneratedEnabled && (
            <p className="text-xs text-amber-400 flex items-center gap-1.5 px-1">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              You will not be notified when a new API key is generated.
            </p>
          )}

          <div className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/5 px-4 py-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                <p className="text-sm font-medium">API key revoked</p>
              </div>
              <p className="text-xs text-muted-foreground pl-5">
                Receive an email whenever an API key on your account is revoked.
              </p>
            </div>
            <Switch
              checked={apiKeyRevokedEnabled}
              onCheckedChange={val => updatePrefs({ data: { apiKeyRevokedEmails: val } })}
              disabled={savingPrefs || me === undefined}
            />
          </div>
          {!apiKeyRevokedEnabled && (
            <p className="text-xs text-amber-400 flex items-center gap-1.5 px-1">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              You will not be notified when an API key is revoked.
            </p>
          )}

          <div className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/5 px-4 py-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                <p className="text-sm font-medium">Signature failure alerts</p>
              </div>
              <p className="text-xs text-muted-foreground pl-5">
                Receive an email alert when an elevated number of HMAC signature failures are detected on your account.
              </p>
            </div>
            <Switch
              checked={signatureFailureAlertEnabled}
              onCheckedChange={val => updatePrefs({ data: { signatureFailureAlertEmails: val } })}
              disabled={savingPrefs || me === undefined}
            />
          </div>
          {!signatureFailureAlertEnabled && (
            <p className="text-xs text-amber-400 flex items-center gap-1.5 px-1">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              You will not be alerted to elevated callback signature failures on your account.
            </p>
          )}

          <div className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/5 px-4 py-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                <p className="text-sm font-medium">New login alerts</p>
              </div>
              <p className="text-xs text-muted-foreground pl-5">
                Receive an email when your account is accessed from a new IP address.
              </p>
            </div>
            <Switch
              checked={loginAlertEnabled}
              onCheckedChange={val => updatePrefs({ data: { loginAlertEmails: val } })}
              disabled={savingPrefs || me === undefined}
            />
          </div>
          {!loginAlertEnabled && (
            <p className="text-xs text-amber-400 flex items-center gap-1.5 px-1">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              You will not be notified when your account is accessed from a new IP address.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Payments & Settlements */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Bell className="w-4 h-4 text-muted-foreground" />
            Payments &amp; Settlements
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            Choose which payment and settlement events send you an email notification.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/5 px-4 py-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                <p className="text-sm font-medium">Settlement state emails</p>
              </div>
              <p className="text-xs text-muted-foreground pl-5">
                Receive email updates on the status of your settlements.
              </p>
            </div>
            <Switch
              checked={settlementStateEnabled}
              onCheckedChange={val => updatePrefs({ data: { settlementStateEmails: val } })}
              disabled={savingPrefs || me === undefined}
            />
          </div>
          {!settlementStateEnabled && (
            <p className="text-xs text-amber-400 flex items-center gap-1.5 px-1">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              You will not receive settlement status update emails.
            </p>
          )}

          <div className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/5 px-4 py-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                <p className="text-sm font-medium">Settlement state changed</p>
              </div>
              <p className="text-xs text-muted-foreground pl-5">
                Receive an email whenever your settlement request is processed, approved, rejected, or paid.
              </p>
            </div>
            <Switch
              checked={settlementStateChangedEnabled}
              onCheckedChange={val => updatePrefs({ data: { settlementStateChangedEmails: val } })}
              disabled={savingPrefs || me === undefined}
            />
          </div>
          {!settlementStateChangedEnabled && (
            <p className="text-xs text-amber-400 flex items-center gap-1.5 px-1">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              You will not receive emails when your settlement status changes.
            </p>
          )}

          <div className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/5 px-4 py-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                <p className="text-sm font-medium">Reconciliation alerts</p>
              </div>
              <p className="text-xs text-muted-foreground pl-5">
                Receive an email alert when a reconciliation issue is detected on your account.
              </p>
            </div>
            <Switch
              checked={reconciliationAlertEnabled}
              onCheckedChange={val => updatePrefs({ data: { reconciliationAlertEmails: val } })}
              disabled={savingPrefs || me === undefined}
            />
          </div>
          {!reconciliationAlertEnabled && (
            <p className="text-xs text-amber-400 flex items-center gap-1.5 px-1">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              You will not be alerted to reconciliation issues on your account.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Plan & Billing */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Bell className="w-4 h-4 text-muted-foreground" />
            Plan &amp; Billing
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            Choose which plan and billing events send you an email notification.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/5 px-4 py-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                <p className="text-sm font-medium">Plan expiry alerts</p>
              </div>
              <p className="text-xs text-muted-foreground pl-5">
                Receive an email when your subscription plan is approaching expiry or has expired.
              </p>
            </div>
            <Switch
              checked={planExpiryAlertEnabled}
              onCheckedChange={val => updatePrefs({ data: { planExpiryAlertEmails: val } })}
              disabled={savingPrefs || me === undefined}
            />
          </div>
          {!planExpiryAlertEnabled && (
            <p className="text-xs text-amber-400 flex items-center gap-1.5 px-1">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              You will not be notified when your plan is about to expire.
            </p>
          )}

          <div className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/5 px-4 py-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                <p className="text-sm font-medium">Plan change emails</p>
              </div>
              <p className="text-xs text-muted-foreground pl-5">
                Receive an email when an admin changes your subscription plan.
              </p>
            </div>
            <Switch
              checked={planChangeEnabled}
              onCheckedChange={val => updatePrefs({ data: { planChangeEmails: val } })}
              disabled={savingPrefs || me === undefined}
            />
          </div>
          {!planChangeEnabled && (
            <p className="text-xs text-amber-400 flex items-center gap-1.5 px-1">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              You will not receive emails when your subscription plan is changed.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Integrations & Webhooks */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Bell className="w-4 h-4 text-muted-foreground" />
            Integrations &amp; Webhooks
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            Choose which integration and webhook events send you an email notification.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/5 px-4 py-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                <p className="text-sm font-medium">Webhook failure emails</p>
              </div>
              <p className="text-xs text-muted-foreground pl-5">
                Receive an email alert when webhook deliveries on your account are repeatedly failing.
              </p>
            </div>
            <Switch
              checked={webhookFailureEnabled}
              onCheckedChange={val => updatePrefs({ data: { webhookFailureEmails: val } })}
              disabled={savingPrefs || me === undefined}
            />
          </div>
          {!webhookFailureEnabled && (
            <p className="text-xs text-amber-400 flex items-center gap-1.5 px-1">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              You will not be alerted to webhook delivery failures on your account.
            </p>
          )}

          <div className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/5 px-4 py-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                <p className="text-sm font-medium">EKQR sync alerts</p>
              </div>
              <p className="text-xs text-muted-foreground pl-5">
                Receive an email when an EKQR synchronisation issue is detected on your QR codes.
              </p>
            </div>
            <Switch
              checked={ekqrSyncAlertEnabled}
              onCheckedChange={val => updatePrefs({ data: { ekqrSyncAlertEmails: val } })}
              disabled={savingPrefs || me === undefined}
            />
          </div>
          {!ekqrSyncAlertEnabled && (
            <p className="text-xs text-amber-400 flex items-center gap-1.5 px-1">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              You will not be alerted to EKQR sync issues on your account.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Reports & Digests */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Bell className="w-4 h-4 text-muted-foreground" />
            Reports &amp; Digests
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            Choose which report events and digest emails you want to receive.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/5 px-4 py-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                <p className="text-sm font-medium">Report schedule changed</p>
              </div>
              <p className="text-xs text-muted-foreground pl-5">
                Receive an email when an admin updates or resets your report schedule, or when it is automatically paused due to repeated delivery failures.
              </p>
            </div>
            <Switch
              checked={reportScheduleChangedEnabled}
              onCheckedChange={val => updatePrefs({ data: { reportScheduleChangedEmails: val } })}
              disabled={savingPrefs || me === undefined}
            />
          </div>
          {!reportScheduleChangedEnabled && (
            <p className="text-xs text-amber-400 flex items-center gap-1.5 px-1">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              You will not receive emails when your report schedule is changed by an admin or automatically paused.
            </p>
          )}

          <div className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/5 px-4 py-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                <p className="text-sm font-medium">Report failure alerts</p>
              </div>
              <p className="text-xs text-muted-foreground pl-5">
                Receive an email alert when a scheduled report fails to generate or deliver.
              </p>
            </div>
            <Switch
              checked={reportFailureAlertEnabled}
              onCheckedChange={val => updatePrefs({ data: { reportFailureAlertEmails: val } })}
              disabled={savingPrefs || me === undefined}
            />
          </div>
          {!reportFailureAlertEnabled && (
            <p className="text-xs text-amber-400 flex items-center gap-1.5 px-1">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              You will not be alerted when a scheduled report fails.
            </p>
          )}

          <div className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/5 px-4 py-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                <p className="text-sm font-medium">Weekly delivery digest</p>
              </div>
              <p className="text-xs text-muted-foreground pl-5">
                Receive a weekly email summarising your report delivery health and delivery statistics.
              </p>
            </div>
            <Switch
              checked={weeklyDeliveryDigestEnabled}
              onCheckedChange={val => updatePrefs({ data: { weeklyDeliveryDigestEmails: val } })}
              disabled={savingPrefs || me === undefined}
            />
          </div>
          {!weeklyDeliveryDigestEnabled && (
            <p className="text-xs text-amber-400 flex items-center gap-1.5 px-1">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              You will not receive the weekly report delivery digest.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Quiet Hours */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Moon className="w-4 h-4 text-indigo-400" />
            Quiet Hours
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            Set a do-not-disturb window. Emails triggered during quiet hours are held and delivered as a single digest when the window ends.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/5 px-4 py-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Moon className="w-3.5 h-3.5 text-muted-foreground" />
                <p className="text-sm font-medium">Enable quiet hours</p>
              </div>
              <p className="text-xs text-muted-foreground pl-5">
                When enabled, notifications sent during the configured window will be queued.
              </p>
            </div>
            <Switch
              checked={qhEnabled}
              onCheckedChange={setQhEnabled}
              disabled={savingPrefs || me === undefined}
            />
          </div>

          {qhEnabled && (
            <div className="space-y-3 pl-1">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="qh-start" className="text-xs text-muted-foreground uppercase tracking-wider">
                    Quiet from
                  </Label>
                  <Input
                    id="qh-start"
                    type="time"
                    value={qhStart}
                    onChange={e => setQhStart(e.target.value)}
                    className="h-8 text-sm [color-scheme:dark]"
                    disabled={savingPrefs}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="qh-end" className="text-xs text-muted-foreground uppercase tracking-wider">
                    Quiet until
                  </Label>
                  <Input
                    id="qh-end"
                    type="time"
                    value={qhEnd}
                    onChange={e => setQhEnd(e.target.value)}
                    className="h-8 text-sm [color-scheme:dark]"
                    disabled={savingPrefs}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="qh-timezone" className="text-xs text-muted-foreground uppercase tracking-wider">
                  Timezone
                </Label>
                <Input
                  id="qh-timezone"
                  type="text"
                  value={qhTimezone}
                  onChange={e => setQhTimezone(e.target.value)}
                  placeholder="e.g. Asia/Kolkata"
                  className="h-8 text-sm"
                  disabled={savingPrefs}
                  list="iana-tzones"
                />
                <datalist id="iana-tzones">
                  {[
                    "Asia/Kolkata","Asia/Colombo","Asia/Dhaka","Asia/Karachi",
                    "America/New_York","America/Chicago","America/Denver","America/Los_Angeles",
                    "Europe/London","Europe/Paris","Europe/Berlin","Europe/Moscow",
                    "Australia/Sydney","Australia/Melbourne","Pacific/Auckland",
                    "UTC","Asia/Singapore","Asia/Tokyo","Asia/Dubai","Africa/Nairobi",
                  ].map(tz => (
                    <option key={tz} value={tz} />
                  ))}
                </datalist>
                <p className="text-xs text-muted-foreground/60">
                  Enter an IANA timezone identifier. Your local timezone is detected automatically.
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                Example: <span className="font-mono text-foreground/70">22:00 – 07:00 Asia/Kolkata</span> means emails sent between 10 PM and 7 AM IST are queued and delivered together at 7 AM.
              </p>
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <Button
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={handleSaveQuietHours}
              disabled={savingPrefs || me === undefined}
            >
              {savingPrefs ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              Save quiet hours
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1.5 border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/10 hover:text-indigo-300 hover:border-indigo-500/50"
              onClick={handleFlushQueue}
              disabled={flushingQueue}
              title="Immediately deliver any queued emails whose delivery time has already passed"
            >
              {flushingQueue ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              Deliver queued now
            </Button>
          </div>
        </CardContent>
      </Card>

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
