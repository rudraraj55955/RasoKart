import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Settings, Mail, Save, CheckCircle2, AlertCircle, Send, Calendar, Bell, Wifi, WifiOff, Trash2, Server, Eye, EyeOff, History, XCircle, HardDrive, RotateCcw, ShieldAlert, KeyRound, RefreshCw, Wrench, GitBranch, Zap, FlaskConical, ChevronDown, ChevronUp, Clock } from "lucide-react";
import { toast } from "sonner";
import { getToken } from "@/lib/auth";
import { getApiErrorMessage } from "@/lib/utils";
import { useGetMe, useUpdateMyPreferences, getGetMeQueryKey, getListAdminAuditLogsQueryKey, useGetLedgerBackfillLastRun, useRunLedgerBackfill, getGetLedgerBackfillLastRunQueryKey, useRunStorageCleanup, useListStorageCleanupRuns, getListStorageCleanupRunsQueryKey, useGetSignatureFailureAlertHistory, useClearSignatureFailureAlertHistory, getGetSignatureFailureAlertHistoryQueryKey, useGetWebhookFailureAlertHistory, useClearWebhookFailureAlertHistory, getGetWebhookFailureAlertHistoryQueryKey, useGetWebhookFailureAlertConfig, useUpdateWebhookFailureAlertConfig, getGetWebhookFailureAlertConfigQueryKey, useResetWebhookFailureAlertCooldown, useGetCleanupStats, getGetCleanupStatsQueryKey, useGetGithubSyncConfig, useUpdateGithubSyncConfig, getGetGithubSyncConfigQueryKey, useGetGithubSyncStatus, getGetGithubSyncStatusQueryKey, useGetGithubSyncHistory, getGetGithubSyncHistoryQueryKey, useRunGithubSync, useGetGithubSyncRunLog, useGetGithubSyncDivergence, useGetQrCleanupHistory, useGetVaCleanupHistory, useClearQrCleanupHistory, useClearVaCleanupHistory, getGetQrCleanupHistoryQueryKey, getGetVaCleanupHistoryQueryKey, useListMerchants, useGetQuietHoursFlushConfig, useUpdateQuietHoursFlushConfig, getGetQuietHoursFlushConfigQueryKey, type AdminAuditLog, type StorageCleanupRun, type SignatureFailureAlertLogEntry, type WebhookFailureAlertLogEntry, type CleanupRunHistoryEntry, type GithubSyncHistoryEntry } from "@workspace/api-client-react";

function formatTimeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes !== 1 ? "s" : ""} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours !== 1 ? "s" : ""} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days !== 1 ? "s" : ""} ago`;
}

async function apiGet(path: string) {
  const res = await fetch(`/api${path}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error("Failed to fetch settings");
  return res.json();
}

async function apiPut(path: string, body: object) {
  const res = await fetch(`/api${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    let msg = text;
    try { msg = JSON.parse(text).error ?? text; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

async function apiPost(path: string, body?: object) {
  const res = await fetch(`/api${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getToken()}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    let msg = text;
    try { msg = JSON.parse(text).error ?? text; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

type ScheduleMode = "daily" | "weekly" | "off";

const SCHEDULE_OPTIONS: { value: ScheduleMode; label: string; description: string }[] = [
  {
    value: "daily",
    label: "Daily",
    description: "Run every night at the configured time, covering the past day(s).",
  },
  {
    value: "weekly",
    label: "Weekly (every Monday)",
    description: "Run once a week on Monday mornings, covering the full previous week.",
  },
  {
    value: "off",
    label: "Off",
    description: "Disable automatic reconciliation runs entirely. Admins can still trigger runs manually.",
  },
];

interface SettingsData {
  finance_report_email: string | null;
  reconciliation_schedule: string | null;
}

interface SmtpStatus {
  configured: boolean;
}

interface SmtpConfig {
  host: string | null;
  port: string | null;
  user: string | null;
  from: string | null;
  passConfigured: boolean;
}

function MaintenanceCard() {
  const qc = useQueryClient();
  const { data: lastRun, isLoading: lastRunLoading } = useGetLedgerBackfillLastRun();

  const { mutate: runBackfill, isPending: running } = useRunLedgerBackfill({
    mutation: {
      onSuccess: (result) => {
        if (result.rowsUpdated === 0) {
          toast.info("Back-fill complete — no new rows needed.");
        } else {
          toast.success(`Back-fill complete — ${result.rowsUpdated} ledger entr${result.rowsUpdated === 1 ? "y" : "ies"} created.`);
        }
        qc.invalidateQueries({ queryKey: getGetLedgerBackfillLastRunQueryKey() });
      },
      onError: (err: Error) => toast.error(`Back-fill failed: ${err.message}`),
    },
  });

  const hasRun = lastRun?.lastRunAt != null;
  const formattedDate = hasRun
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(lastRun!.lastRunAt!))
    : null;

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Wrench className="w-4 h-4 text-muted-foreground" />
          <CardTitle className="text-base">Maintenance</CardTitle>
        </div>
        <CardDescription className="text-sm">
          One-time data operations to repair or back-fill historical records.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border border-border/50 bg-muted/5 px-4 py-3 space-y-3">
          <div>
            <p className="text-sm font-medium text-foreground">Ledger deposit back-fill</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Creates ledger entries for any successful deposits that predate the ledger feature.
              Safe to run multiple times — already-covered deposits are skipped.
            </p>
          </div>

          {!lastRunLoading && (
            <div className={`flex items-center gap-2 text-xs rounded-md px-3 py-2 border ${
              hasRun
                ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
                : "text-muted-foreground bg-muted/30 border-border/40"
            }`}>
              {hasRun ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    Last run: <strong>{formattedDate}</strong>
                    {" — "}
                    {lastRun!.rowsUpdated === 0
                      ? "no rows needed"
                      : `${lastRun!.rowsUpdated} row${lastRun!.rowsUpdated === 1 ? "" : "s"} created`}
                  </span>
                </>
              ) : (
                <>
                  <History className="w-3.5 h-3.5 shrink-0" />
                  <span>Never run</span>
                </>
              )}
            </div>
          )}

          <Button
            size="sm"
            variant="outline"
            onClick={() => runBackfill()}
            disabled={running}
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${running ? "animate-spin" : ""}`} />
            {running ? "Running…" : "Run back-fill"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminSettings() {
  const qc = useQueryClient();

  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");
    if (!hash) return;
    const el = document.getElementById(hash);
    if (el) {
      setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    }
  }, []);

  const [financeEmail, setFinanceEmail] = useState<string>("");
  const [testEmailTo, setTestEmailTo] = useState<string>("");
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>("daily");
  const [initialized, setInitialized] = useState(false);
  const [retentionDays, setRetentionDays] = useState<number>(30);
  const [retentionInitialized, setRetentionInitialized] = useState(false);

  const [vaRetentionDays, setVaRetentionDays] = useState<number>(30);
  const [vaRetentionInitialized, setVaRetentionInitialized] = useState(false);

  const [testEmailRetentionDays, setTestEmailRetentionDays] = useState<number>(30);
  const [testEmailRetentionInitialized, setTestEmailRetentionInitialized] = useState(false);

  const [storageScheduleEnabled, setStorageScheduleEnabled] = useState<boolean>(true);
  const [storageScheduleHour, setStorageScheduleHour] = useState<number>(3);
  const [storageScheduleInitialized, setStorageScheduleInitialized] = useState(false);

  const [auditLogRetentionDays, setAuditLogRetentionDays] = useState<number>(90);
  const [auditLogRetentionInitialized, setAuditLogRetentionInitialized] = useState(false);

  const [retryMaxAttempts, setRetryMaxAttempts] = useState<number>(4);
  const [retryDelay1, setRetryDelay1] = useState<number>(300);
  const [retryDelay2, setRetryDelay2] = useState<number>(900);
  const [retryDelay3, setRetryDelay3] = useState<number>(3600);
  const [retryInitialized, setRetryInitialized] = useState(false);

  const [reportRetryMaxAttempts, setReportRetryMaxAttempts] = useState<number>(3);
  const [reportRetryBackoffMs, setReportRetryBackoffMs] = useState<number>(1000);
  const [reportRetryInitialized, setReportRetryInitialized] = useState(false);

  const [webhookAlertCooldownHours, setWebhookAlertCooldownHours] = useState<number>(1);
  const [webhookAlertCooldownInitialized, setWebhookAlertCooldownInitialized] = useState(false);
  const [webhookAlertMerchantFilter, setWebhookAlertMerchantFilter] = useState<number | null>(null);

  const [githubSyncEnabled, setGithubSyncEnabled] = useState<boolean>(true);
  const [githubSyncSchedule, setGithubSyncSchedule] = useState<string>("0 2 * * *");
  const [githubSyncFailureThreshold, setGithubSyncFailureThreshold] = useState<number>(3);
  const [githubSyncRenotifyInterval, setGithubSyncRenotifyInterval] = useState<number>(10);
  const [githubSyncInitialized, setGithubSyncInitialized] = useState(false);

  const [quietHoursFlushInterval, setQuietHoursFlushInterval] = useState<number>(60);
  const [quietHoursFlushInitialized, setQuietHoursFlushInitialized] = useState(false);


  // SMTP config form state
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpFrom, setSmtpFrom] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [smtpInitialized, setSmtpInitialized] = useState(false);
  const [smtpTestTo, setSmtpTestTo] = useState("");
  const [smtpTestResult, setSmtpTestResult] = useState<"success" | "error" | null>(null);
  const [smtpTestMessage, setSmtpTestMessage] = useState("");

  const { data: me } = useGetMe();
  const alertEnabled = me?.reconciliationAlertEmails ?? true;
  const planExpiryEnabled = me?.planExpiryAlertEmails ?? true;
  const settlementStateEnabled = me?.settlementStateEmails ?? true;
  const signatureFailureEnabled = me?.signatureFailureAlertEmails ?? true;
  const webhookFailureEnabled = me?.webhookFailureEmails ?? true;
  const reportFailureEnabled = (me as any)?.reportFailureAlertEmails ?? true;
  const githubSyncFailureEnabled = (me as any)?.githubSyncFailureAlertEmails ?? true;
  const weeklyDigestEnabled = me?.weeklyDeliveryDigestEmails ?? true;

  const { mutate: updatePrefs, isPending: savingPrefs } = useUpdateMyPreferences({
    mutation: {
      onSuccess: (updated) => {
        toast.success("Notification preferences saved");
        qc.setQueryData(getGetMeQueryKey(), updated);
      },
      onError: (err: Error) => toast.error(err.message),
    },
  });

  const { data: smtpStatus, refetch: refetchSmtpStatus } = useQuery<SmtpStatus>({
    queryKey: ["/api/settings/smtp-status"],
    queryFn: () => apiGet("/settings/smtp-status"),
  });

  const smtpConfigured = smtpStatus?.configured ?? null;

  const { data: smtpConfig, isLoading: smtpConfigLoading } = useQuery<SmtpConfig>({
    queryKey: ["/api/settings/smtp"],
    queryFn: () => apiGet("/settings/smtp"),
    onSuccess: (d: SmtpConfig) => {
      if (!smtpInitialized) {
        setSmtpHost(d.host ?? "");
        setSmtpPort(d.port ?? "587");
        setSmtpUser(d.user ?? "");
        setSmtpFrom(d.from ?? "");
        setSmtpPass("");
        setSmtpInitialized(true);
      }
    },
  } as any);

  const smtpChanged =
    smtpHost !== (smtpConfig?.host ?? "") ||
    smtpPort !== (smtpConfig?.port ?? "587") ||
    smtpUser !== (smtpConfig?.user ?? "") ||
    smtpFrom !== (smtpConfig?.from ?? "") ||
    smtpPass.trim() !== "";

  const { mutate: saveSmtp, isPending: savingSmtp } = useMutation({
    mutationFn: () =>
      apiPut("/settings/smtp", {
        host: smtpHost.trim() || null,
        port: smtpPort.trim() || null,
        smtpUser: smtpUser.trim() || null,
        from: smtpFrom.trim() || null,
        ...(smtpPass.trim() ? { pass: smtpPass.trim() } : {}),
      }),
    onSuccess: () => {
      toast.success("SMTP settings saved");
      setSmtpPass("");
      setSmtpInitialized(false);
      qc.invalidateQueries({ queryKey: ["/api/settings/smtp"] });
      qc.invalidateQueries({ queryKey: ["/api/settings/smtp-status"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const { mutate: sendSmtpTest, isPending: sendingSmtpTest } = useMutation({
    mutationFn: () => {
      const to = smtpTestTo.trim() || undefined;
      return apiPost("/settings/test-email", to ? { to } : undefined);
    },
    onSuccess: (res: { to: string }) => {
      setSmtpTestResult("success");
      setSmtpTestMessage(`Test email sent to ${res.to} — check your inbox`);
    },
    onError: (err: Error) => {
      setSmtpTestResult("error");
      setSmtpTestMessage(err.message);
    },
  });

  const { data, isLoading } = useQuery<SettingsData>({
    queryKey: ["/api/settings"],
    queryFn: () => apiGet("/settings"),
    onSuccess: (d: SettingsData) => {
      if (!initialized) {
        setFinanceEmail(d.finance_report_email ?? "");
        const raw = d.reconciliation_schedule;
        setScheduleMode(raw === "weekly" || raw === "off" ? raw : "daily");
        setInitialized(true);
      }
    },
  } as any);

  const recipientCount = financeEmail.trim()
    ? financeEmail.split(",").map(e => e.trim()).filter(e => e.length > 0).length
    : 0;

  const { mutate: saveEmail, isPending: savingEmail } = useMutation({
    mutationFn: () => apiPut("/settings/finance_report_email", { value: financeEmail || null }),
    onSuccess: () => {
      toast.success("Finance report email saved");
      qc.invalidateQueries({ queryKey: ["/api/settings"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const [testHistoryFilter, setTestHistoryFilter] = useState<"all" | "success" | "failed">("all");

  const TEST_EMAIL_HISTORY_PARAMS = { action: "test_email_sent", limit: 20 } as const;

  const { data: testEmailHistory, isLoading: historyLoading } = useQuery({
    queryKey: getListAdminAuditLogsQueryKey(TEST_EMAIL_HISTORY_PARAMS),
    queryFn: () => apiGet(`/audit-logs?action=test_email_sent&limit=20`),
    staleTime: 0,
  });

  const [previewingEmail, setPreviewingEmail] = useState(false);
  const [previewingAlertEmail, setPreviewingAlertEmail] = useState(false);

  async function handlePreviewAlertEmail() {
    setPreviewingAlertEmail(true);
    try {
      const res = await fetch("/api/settings/reconciliation_alert_email/preview", {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) throw new Error("Failed to load preview");
      const html = await res.text();
      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const tab = window.open(url, "_blank");
      if (tab) {
        tab.addEventListener("load", () => URL.revokeObjectURL(url), { once: true });
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
      }
    } catch (err: any) {
      toast.error(err.message ?? "Could not load alert email preview");
    } finally {
      setPreviewingAlertEmail(false);
    }
  }

  async function handlePreviewEmail() {
    setPreviewingEmail(true);
    try {
      const res = await fetch("/api/settings/finance_report_email/preview", {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) throw new Error("Failed to load preview");
      const html = await res.text();
      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const tab = window.open(url, "_blank");
      if (tab) {
        tab.addEventListener("load", () => URL.revokeObjectURL(url), { once: true });
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
      }
    } catch (err: any) {
      toast.error(err.message ?? "Could not load email preview");
    } finally {
      setPreviewingEmail(false);
    }
  }

  const { mutate: sendTestEmail, isPending: sendingTest } = useMutation({
    mutationFn: () => {
      const overrideTrimmed = testEmailTo.trim();
      return apiPost("/settings/test-email", overrideTrimmed ? { to: overrideTrimmed } : undefined);
    },
    onSuccess: (res: { to: string }) => toast.success(`Test email sent to ${res.to} — check your inbox`),
    onError: (err: Error) => toast.error(`Test email failed: ${err.message}`),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: getListAdminAuditLogsQueryKey(TEST_EMAIL_HISTORY_PARAMS) });
    },
  });

  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const [sampleReportTo, setSampleReportTo] = useState<string>("");
  const [sampleReportResult, setSampleReportResult] = useState<"success" | "error" | null>(null);
  const [sampleReportMessage, setSampleReportMessage] = useState("");

  const { mutate: sendSampleReport, isPending: sendingSample } = useMutation({
    mutationFn: () => {
      const overrideTrimmed = sampleReportTo.trim();
      return apiPost("/settings/finance_report_email/send-sample", overrideTrimmed ? { to: overrideTrimmed } : {});
    },
    onSuccess: (res: { to: string }) => {
      setSampleReportResult("success");
      setSampleReportMessage(`Sample report sent to ${res.to} — check your inbox`);
    },
    onError: (err: Error) => {
      setSampleReportResult("error");
      setSampleReportMessage(err.message);
    },
  });

  const sampleReportToTrimmed = sampleReportTo.trim();
  const sampleReportToInvalid = sampleReportToTrimmed.length > 0 && !EMAIL_REGEX.test(sampleReportToTrimmed);

  const { mutate: saveSchedule, isPending: savingSchedule } = useMutation({
    mutationFn: () => apiPut("/settings/reconciliation_schedule", { value: scheduleMode }),
    onSuccess: () => {
      toast.success("Reconciliation schedule saved");
      qc.invalidateQueries({ queryKey: ["/api/settings"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const { data: qrCleanupData, isLoading: qrCleanupLoading } = useQuery<{ retentionDays: number; lastRunAt: string | null; lastDeleted: number | null }>({
    queryKey: ["/api/system-config/qr-cleanup"],
    queryFn: () => apiGet("/system-config/qr-cleanup"),
    onSuccess: (d: { retentionDays: number; lastRunAt: string | null; lastDeleted: number | null }) => {
      if (!retentionInitialized) {
        setRetentionDays(d.retentionDays);
        setRetentionInitialized(true);
      }
    },
  } as any);

  const currentRetentionDays = qrCleanupData?.retentionDays ?? 30;
  const retentionUnchanged = retentionDays === currentRetentionDays;

  const { mutate: saveRetention, isPending: savingRetention } = useMutation({
    mutationFn: () => apiPut("/system-config/qr-cleanup", { retentionDays }),
    onSuccess: () => {
      toast.success("QR cleanup retention saved");
      qc.invalidateQueries({ queryKey: ["/api/system-config/qr-cleanup"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const { data: vaCleanupData, isLoading: vaCleanupLoading } = useQuery<{ retentionDays: number; lastRunAt: string | null; lastDeleted: number | null }>({
    queryKey: ["/api/system-config/va-cleanup"],
    queryFn: () => apiGet("/system-config/va-cleanup"),
    onSuccess: (d: { retentionDays: number; lastRunAt: string | null; lastDeleted: number | null }) => {
      if (!vaRetentionInitialized) {
        setVaRetentionDays(d.retentionDays);
        setVaRetentionInitialized(true);
      }
    },
  } as any);

  const { data: testEmailRetentionData, isLoading: testEmailRetentionLoading } = useQuery<{ retentionDays: number }>({
    queryKey: ["/api/system-config/test-email-retention"],
    queryFn: () => apiGet("/system-config/test-email-retention"),
    onSuccess: (d: { retentionDays: number }) => {
      if (!testEmailRetentionInitialized) {
        setTestEmailRetentionDays(d.retentionDays);
        setTestEmailRetentionInitialized(true);
      }
    },
  } as any);

  const currentVaRetentionDays = vaCleanupData?.retentionDays ?? 30;
  const vaRetentionUnchanged = vaRetentionDays === currentVaRetentionDays;

  const { mutate: saveVaRetention, isPending: savingVaRetention } = useMutation({
    mutationFn: () => apiPut("/system-config/va-cleanup", { retentionDays: vaRetentionDays }),
    onSuccess: () => {
      toast.success("VA cleanup retention saved");
      qc.invalidateQueries({ queryKey: ["/api/system-config/va-cleanup"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const [qrCleanupRunResult, setQrCleanupRunResult] = useState<{ expired: number; deleted: number } | null>(null);

  const { mutate: runQrCleanupNow, isPending: runningQrCleanup } = useMutation({
    mutationFn: () => apiPost("/system-config/qr-cleanup/run"),
    onSuccess: (res: { expired: number; deleted: number }) => {
      setQrCleanupRunResult(res);
      qc.invalidateQueries({ queryKey: ["/api/system-config/qr-cleanup"] });
      qc.invalidateQueries({ queryKey: getGetQrCleanupHistoryQueryKey() });
      if (res.expired === 0 && res.deleted === 0) {
        toast.info("Cleanup complete — nothing to clean up.");
      } else {
        const parts: string[] = [];
        if (res.expired > 0) parts.push(`${res.expired} code${res.expired !== 1 ? "s" : ""} expired`);
        if (res.deleted > 0) parts.push(`${res.deleted} code${res.deleted !== 1 ? "s" : ""} deleted`);
        toast.success(`Cleanup complete — ${parts.join(", ")}.`);
      }
    },
    onError: (err: Error) => toast.error(`Cleanup failed: ${err.message}`),
  });

  const [vaCleanupRunResult, setVaCleanupRunResult] = useState<{ closed: number; deleted: number } | null>(null);
  const [qrHistoryOpen, setQrHistoryOpen] = useState(false);
  const [vaHistoryOpen, setVaHistoryOpen] = useState(false);

  const { data: qrHistoryData, isLoading: qrHistoryLoading } = useGetQrCleanupHistory({ query: { enabled: qrHistoryOpen, queryKey: getGetQrCleanupHistoryQueryKey() } });
  const { data: vaHistoryData, isLoading: vaHistoryLoading } = useGetVaCleanupHistory({ query: { enabled: vaHistoryOpen, queryKey: getGetVaCleanupHistoryQueryKey() } });

  const { mutate: clearQrHistory, isPending: clearingQrHistory } = useClearQrCleanupHistory({
    mutation: {
      onSuccess: () => {
        toast.success("QR cleanup history cleared");
        qc.invalidateQueries({ queryKey: getGetQrCleanupHistoryQueryKey() });
      },
      onError: (err: unknown) => toast.error(getApiErrorMessage(err, "Failed to clear history")),
    },
  });

  const { mutate: clearVaHistory, isPending: clearingVaHistory } = useClearVaCleanupHistory({
    mutation: {
      onSuccess: () => {
        toast.success("VA cleanup history cleared");
        qc.invalidateQueries({ queryKey: getGetVaCleanupHistoryQueryKey() });
      },
      onError: (err: unknown) => toast.error(getApiErrorMessage(err, "Failed to clear history")),
    },
  });

  const { mutate: runVaCleanupNow, isPending: runningVaCleanup } = useMutation({
    mutationFn: () => apiPost("/system-config/va-cleanup/run"),
    onSuccess: (res: { closed: number; deleted: number }) => {
      setVaCleanupRunResult(res);
      qc.invalidateQueries({ queryKey: ["/api/system-config/va-cleanup"] });
      qc.invalidateQueries({ queryKey: getGetVaCleanupHistoryQueryKey() });
      if (res.closed === 0 && res.deleted === 0) {
        toast.info("Cleanup complete — nothing to clean up.");
      } else {
        const parts: string[] = [];
        if (res.closed > 0) parts.push(`${res.closed} account${res.closed !== 1 ? "s" : ""} closed`);
        if (res.deleted > 0) parts.push(`${res.deleted} account${res.deleted !== 1 ? "s" : ""} deleted`);
        toast.success(`Cleanup complete — ${parts.join(", ")}.`);
      }
    },
    onError: (err: Error) => toast.error(`Cleanup failed: ${err.message}`),
  });

  const currentTestEmailRetentionDays = testEmailRetentionData?.retentionDays ?? 30;
  const testEmailRetentionUnchanged = testEmailRetentionDays === currentTestEmailRetentionDays;

  const { mutate: saveTestEmailRetention, isPending: savingTestEmailRetention } = useMutation({
    mutationFn: () => apiPut("/system-config/test-email-retention", { retentionDays: testEmailRetentionDays }),
    onSuccess: () => {
      toast.success("Test email history retention saved");
      qc.invalidateQueries({ queryKey: ["/api/system-config/test-email-retention"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const { data: auditLogRetentionData, isLoading: auditLogRetentionLoading } = useQuery<{ retentionDays: number }>({
    queryKey: ["/api/system-config/audit-report-retention"],
    queryFn: () => apiGet("/system-config/audit-report-retention"),
    onSuccess: (d: { retentionDays: number }) => {
      if (!auditLogRetentionInitialized) {
        setAuditLogRetentionDays(d.retentionDays);
        setAuditLogRetentionInitialized(true);
      }
    },
  } as any);

  const currentAuditLogRetentionDays = auditLogRetentionData?.retentionDays ?? 90;
  const auditLogRetentionUnchanged = auditLogRetentionDays === currentAuditLogRetentionDays;

  const { mutate: saveAuditLogRetention, isPending: savingAuditLogRetention } = useMutation({
    mutationFn: () => apiPut("/system-config/audit-report-retention", { retentionDays: auditLogRetentionDays }),
    onSuccess: () => {
      toast.success("Audit report log retention saved");
      qc.invalidateQueries({ queryKey: ["/api/system-config/audit-report-retention"] });

    },
    onError: (err: Error) => toast.error(err.message),
  });

  const { mutate: runTestEmailCleanup, isPending: runningTestEmailCleanup } = useMutation({
    mutationFn: () => apiPost("/system-config/test-email-retention/run"),
    onSuccess: (res: { deleted: number }) => {
      if (res.deleted === 0) {
        toast.info("Cleanup complete — no rows to delete.");
      } else {
        toast.success(`Cleanup complete — deleted ${res.deleted} test email history row${res.deleted === 1 ? "" : "s"}.`);
      }
    },
    onError: (err: Error) => toast.error(`Cleanup failed: ${err.message}`),
  });

  const { mutate: runAuditReportRetentionCleanup, isPending: runningAuditReportCleanup } = useMutation({
    mutationFn: () => apiPost("/system-config/audit-report-retention/run"),
    onSuccess: (res: { deleted: number }) => {
      qc.invalidateQueries({ queryKey: getGetCleanupStatsQueryKey() });
      if (res.deleted === 0) {
        toast.info("Cleanup complete — no rows to delete.");
      } else {
        toast.success(`Cleanup complete — deleted ${res.deleted} audit report log row${res.deleted === 1 ? "" : "s"}.`);
      }
    },
    onError: (err: Error) => toast.error(`Cleanup failed: ${err.message}`),
  });

  const { data: storageCleanupConfig, isLoading: storageConfigLoading } = useQuery<{ enabled: boolean; hour: number }>({
    queryKey: ["/api/system-config/storage-cleanup"],
    queryFn: () => apiGet("/system-config/storage-cleanup"),
    onSuccess: (d: { enabled: boolean; hour: number }) => {
      if (!storageScheduleInitialized) {
        setStorageScheduleEnabled(d.enabled);
        setStorageScheduleHour(d.hour);
        setStorageScheduleInitialized(true);
      }
    },
  } as any);

  const { data: webhookRetriesData, isLoading: webhookRetriesLoading } = useQuery<{ maxAttempts: number; delay1: number; delay2: number; delay3: number }>({
    queryKey: ["/api/system-config/webhook-retries"],
    queryFn: () => apiGet("/system-config/webhook-retries"),
    onSuccess: (d: { maxAttempts: number; delay1: number; delay2: number; delay3: number }) => {
      if (!retryInitialized) {
        setRetryMaxAttempts(d.maxAttempts);
        setRetryDelay1(d.delay1);
        setRetryDelay2(d.delay2);
        setRetryDelay3(d.delay3);
        setRetryInitialized(true);
      }
    },
  } as any);

  const currentStorageEnabled = storageCleanupConfig?.enabled ?? true;
  const currentStorageHour = storageCleanupConfig?.hour ?? 3;
  const storageScheduleUnchanged =
    storageScheduleEnabled === currentStorageEnabled && storageScheduleHour === currentStorageHour;

  const { mutate: saveStorageSchedule, isPending: savingStorageSchedule } = useMutation({
    mutationFn: () => apiPut("/system-config/storage-cleanup", { enabled: storageScheduleEnabled, hour: storageScheduleHour }),
    onSuccess: () => {
      toast.success("Storage cleanup schedule saved");
      qc.invalidateQueries({ queryKey: ["/api/system-config/storage-cleanup"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const { data: cleanupStats } = useGetCleanupStats();

  const currentRetryMaxAttempts = webhookRetriesData?.maxAttempts ?? 4;
  const currentRetryDelay1 = webhookRetriesData?.delay1 ?? 300;
  const currentRetryDelay2 = webhookRetriesData?.delay2 ?? 900;
  const currentRetryDelay3 = webhookRetriesData?.delay3 ?? 3600;
  const retryUnchanged = retryMaxAttempts === currentRetryMaxAttempts && retryDelay1 === currentRetryDelay1 && retryDelay2 === currentRetryDelay2 && retryDelay3 === currentRetryDelay3;
  const retryOrderWarning = retryDelay1 > retryDelay2 || retryDelay2 > retryDelay3;

  const { mutate: saveRetry, isPending: savingRetry } = useMutation({
    mutationFn: () => apiPut("/system-config/webhook-retries", { maxAttempts: retryMaxAttempts, delay1: retryDelay1, delay2: retryDelay2, delay3: retryDelay3 }),
    onSuccess: () => {
      toast.success("Webhook retry schedule saved");
      qc.invalidateQueries({ queryKey: ["/api/system-config/webhook-retries"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const { data: reportRetryData, isLoading: reportRetryLoading } = useQuery<{ maxAttempts: number; backoffBaseMs: number }>({
    queryKey: ["/api/settings/report-delivery-retries"],
    queryFn: () => apiGet("/settings/report-delivery-retries"),
    onSuccess: (d: { maxAttempts: number; backoffBaseMs: number }) => {
      if (!reportRetryInitialized) {
        setReportRetryMaxAttempts(d.maxAttempts);
        setReportRetryBackoffMs(d.backoffBaseMs);
        setReportRetryInitialized(true);
      }
    },
  } as any);

  const currentReportRetryMaxAttempts = reportRetryData?.maxAttempts ?? 3;
  const currentReportRetryBackoffMs = reportRetryData?.backoffBaseMs ?? 1000;
  const reportRetryUnchanged = reportRetryMaxAttempts === currentReportRetryMaxAttempts && reportRetryBackoffMs === currentReportRetryBackoffMs;

  const { mutate: saveReportRetry, isPending: savingReportRetry } = useMutation({
    mutationFn: () => apiPut("/settings/report-delivery-retries", { maxAttempts: reportRetryMaxAttempts, backoffBaseMs: reportRetryBackoffMs }),
    onSuccess: () => {
      toast.success("Report delivery retry settings saved");
      qc.invalidateQueries({ queryKey: ["/api/settings/report-delivery-retries"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const [cleanupResult, setCleanupResult] = useState<{ totalScanned: number; deleted: number; errors: number } | null>(null);

  const CLEANUP_RUNS_PARAMS = { limit: 20 } as const;
  const { data: cleanupRunsData, refetch: refetchCleanupRuns } = useListStorageCleanupRuns(CLEANUP_RUNS_PARAMS);
  const cleanupRuns: StorageCleanupRun[] = cleanupRunsData?.data ?? [];

  const { mutate: runCleanup, isPending: runningCleanup } = useRunStorageCleanup({
    mutation: {
      onSuccess: (result: { totalScanned: number; deleted: number; errors: number }) => {
        setCleanupResult(result);
        void refetchCleanupRuns();
        qc.invalidateQueries({ queryKey: getListStorageCleanupRunsQueryKey(CLEANUP_RUNS_PARAMS) });
        if (result.deleted === 0) {
          toast.success("No orphaned files found — storage is already clean");
        } else {
          toast.success(`Deleted ${result.deleted} orphaned file${result.deleted !== 1 ? "s" : ""}`);
        }
      },
      onError: (err: unknown) => toast.error(getApiErrorMessage(err, "Cleanup failed")),
    },
  });


  const { data: webhookAlertConfigData, isLoading: webhookAlertConfigLoading } = useGetWebhookFailureAlertConfig();

  useEffect(() => {
    if (webhookAlertConfigData && !webhookAlertCooldownInitialized) {
      setWebhookAlertCooldownHours(webhookAlertConfigData.cooldownHours);
      setWebhookAlertCooldownInitialized(true);
    }
  }, [webhookAlertConfigData, webhookAlertCooldownInitialized]);

  const currentWebhookAlertCooldownHours = webhookAlertConfigData?.cooldownHours ?? 1;
  const webhookAlertCooldownUnchanged = webhookAlertCooldownHours === currentWebhookAlertCooldownHours;

  const { mutate: saveWebhookAlertCooldown, isPending: savingWebhookAlertCooldown } = useUpdateWebhookFailureAlertConfig({
    mutation: {
      onSuccess: (updated: { cooldownHours: number }) => {
        toast.success("Webhook failure alert cooldown saved");
        qc.invalidateQueries({ queryKey: getGetWebhookFailureAlertConfigQueryKey() });
        setWebhookAlertCooldownInitialized(false);
        setWebhookAlertCooldownHours(updated.cooldownHours);
        setWebhookAlertCooldownInitialized(true);
      },
      onError: (err: Error) => toast.error(err.message),
    },
  });

  const { data: sigFailureHistoryData, refetch: refetchSigFailureHistory } = useGetSignatureFailureAlertHistory();
  const sigFailureHistory: SignatureFailureAlertLogEntry[] = sigFailureHistoryData?.data ?? [];
  const sigFailureHistoryCount = sigFailureHistoryData?.total ?? 0;

  const { mutate: clearSigFailureHistory, isPending: clearingSigFailureHistory } = useClearSignatureFailureAlertHistory({
    mutation: {
      onSuccess: () => {
        toast.success("Signature failure alert history cleared");
        qc.invalidateQueries({ queryKey: getGetSignatureFailureAlertHistoryQueryKey() });
        void refetchSigFailureHistory();
      },
      onError: (err: unknown) => toast.error(getApiErrorMessage(err, "Failed to clear history")),
    },
  });

  const webhookAlertHistoryParams = webhookAlertMerchantFilter != null
    ? { merchantId: webhookAlertMerchantFilter }
    : undefined;
  const { data: webhookAlertHistoryData, refetch: refetchWebhookAlertHistory } = useGetWebhookFailureAlertHistory(webhookAlertHistoryParams);
  const webhookAlertHistory: WebhookFailureAlertLogEntry[] = webhookAlertHistoryData?.data ?? [];

  const { data: webhookAlertGlobalData, refetch: refetchWebhookAlertGlobal } = useGetWebhookFailureAlertHistory({ limit: 1 });
  const webhookAlertGlobalCount = webhookAlertGlobalData?.total ?? 0;

  const { data: webhookAlertMerchantsData } = useListMerchants({ limit: 200 });
  const webhookAlertMerchants = webhookAlertMerchantsData?.data ?? [];
  const webhookAlertMerchantMap = new Map(webhookAlertMerchants.map((m) => [m.id, m.businessName]));

  const { mutate: clearWebhookAlertHistory, isPending: clearingWebhookAlertHistory } = useClearWebhookFailureAlertHistory({
    mutation: {
      onSuccess: () => {
        toast.success("Webhook failure alert history cleared");
        qc.invalidateQueries({ queryKey: getGetWebhookFailureAlertHistoryQueryKey() });
        void refetchWebhookAlertHistory();
        void refetchWebhookAlertGlobal();
      },
      onError: (err: unknown) => toast.error(getApiErrorMessage(err, "Failed to clear history")),
    },
  });

  const [resetCooldownMerchantId, setResetCooldownMerchantId] = useState<number | "all" | null>(null);

  const { mutate: resetWebhookCooldown, isPending: resettingWebhookCooldown } = useResetWebhookFailureAlertCooldown({
    mutation: {
      onSuccess: (res, vars) => {
        const mid = vars.params?.merchantId;
        if (mid != null) {
          toast.success(`Cooldown reset for Merchant #${mid} — next failure will trigger a fresh alert`);
        } else {
          toast.success("All webhook failure alert cooldowns reset");
        }
        qc.invalidateQueries({ queryKey: getGetWebhookFailureAlertHistoryQueryKey() });
        void refetchWebhookAlertHistory();
        setResetCooldownMerchantId(null);
      },
      onError: (err: unknown) => {
        toast.error(getApiErrorMessage(err, "Failed to reset cooldown"));
        setResetCooldownMerchantId(null);
      },
    },
  });

  const { data: githubSyncConfig, isLoading: githubSyncLoading } = useGetGithubSyncConfig();

  useEffect(() => {
    if (!githubSyncInitialized && githubSyncConfig) {
      setGithubSyncEnabled(githubSyncConfig.enabled);
      setGithubSyncSchedule(githubSyncConfig.schedule);
      setGithubSyncFailureThreshold(githubSyncConfig.failureThreshold);
      setGithubSyncRenotifyInterval(githubSyncConfig.renotifyInterval);
      setGithubSyncInitialized(true);
    }
  }, [githubSyncInitialized, githubSyncConfig]);

  const currentGithubSyncEnabled = githubSyncConfig?.enabled ?? true;
  const currentGithubSyncSchedule = githubSyncConfig?.schedule ?? "0 2 * * *";
  const currentGithubSyncFailureThreshold = githubSyncConfig?.failureThreshold ?? 3;
  const currentGithubSyncRenotifyInterval = githubSyncConfig?.renotifyInterval ?? 10;
  const githubSyncUnchanged =
    githubSyncEnabled === currentGithubSyncEnabled &&
    githubSyncSchedule === currentGithubSyncSchedule &&
    githubSyncFailureThreshold === currentGithubSyncFailureThreshold &&
    githubSyncRenotifyInterval === currentGithubSyncRenotifyInterval;
  const githubSyncThresholdsValid = githubSyncFailureThreshold >= 1 && githubSyncRenotifyInterval >= 1;

  const { mutate: saveGithubSyncConfig, isPending: savingGithubSyncConfig } = useUpdateGithubSyncConfig({
    mutation: {
      onSuccess: (updated: { enabled: boolean; schedule: string; failureThreshold: number; renotifyInterval: number }) => {
        toast.success("GitHub sync settings saved");
        setGithubSyncInitialized(false);
        qc.invalidateQueries({ queryKey: getGetGithubSyncConfigQueryKey() });
        setGithubSyncEnabled(updated.enabled);
        setGithubSyncSchedule(updated.schedule);
        setGithubSyncFailureThreshold(updated.failureThreshold);
        setGithubSyncRenotifyInterval(updated.renotifyInterval);
        setGithubSyncInitialized(true);
      },
      onError: (err: Error) => toast.error(err.message),
    },
  });

  const [githubSyncTriggering, setGithubSyncTriggering] = useState(false);

  const { data: githubSyncStatus } = useGetGithubSyncStatus({
    query: { refetchInterval: githubSyncTriggering ? 2_000 : 60_000 },
  } as any);

  const { data: githubSyncHistory } = useGetGithubSyncHistory({
    query: { refetchInterval: githubSyncTriggering ? 2_000 : 60_000 },
  } as any);

  const githubSyncIsRunning = githubSyncTriggering || githubSyncStatus?.status === "running";

  useEffect(() => {
    if (githubSyncTriggering && githubSyncStatus?.status && githubSyncStatus.status !== "running") {
      setGithubSyncTriggering(false);
    }
  }, [githubSyncTriggering, githubSyncStatus?.status]);

  const { mutate: runGithubSyncNow, isPending: runningGithubSync } = useRunGithubSync({
    mutation: {
      onSuccess: () => {
        toast.success("GitHub sync started");
        setGithubSyncTriggering(true);
        qc.invalidateQueries({ queryKey: getGetGithubSyncStatusQueryKey() });
        qc.invalidateQueries({ queryKey: getGetGithubSyncHistoryQueryKey() });
      },
      onError: (err: Error) => toast.error(getApiErrorMessage(err, "Failed to start GitHub sync")),
    },
  });

  const [githubSyncConfirmOpen, setGithubSyncConfirmOpen] = useState(false);
  const { data: githubSyncDivergence, isLoading: githubSyncDivergenceLoading } = useGetGithubSyncDivergence({
    query: { enabled: githubSyncConfirmOpen },
  } as any);

  const handleConfirmGithubSync = () => {
    setGithubSyncConfirmOpen(false);
    runGithubSyncNow();
  };

  const [selectedSyncRun, setSelectedSyncRun] = useState<GithubSyncHistoryEntry | null>(null);
  const { data: selectedSyncRunLog, isLoading: selectedSyncRunLogLoading, isError: selectedSyncRunLogError } = useGetGithubSyncRunLog(
    selectedSyncRun?.id ?? "",
    { query: { enabled: !!selectedSyncRun?.id && !!selectedSyncRun?.hasLog } } as any,
  );

  const { data: quietHoursFlushData, isLoading: quietHoursFlushLoading } = useGetQuietHoursFlushConfig({
    query: {
      onSuccess: (d: { intervalSeconds: number }) => {
        if (!quietHoursFlushInitialized) {
          setQuietHoursFlushInterval(d.intervalSeconds);
          setQuietHoursFlushInitialized(true);
        }
      },
    },
  } as any);

  const currentQuietHoursFlushInterval = quietHoursFlushData?.intervalSeconds ?? 60;
  const quietHoursFlushUnchanged = quietHoursFlushInterval === currentQuietHoursFlushInterval;

  const { mutate: saveQuietHoursFlush, isPending: savingQuietHoursFlush } = useUpdateQuietHoursFlushConfig({
    mutation: {
      onSuccess: (updated: { intervalSeconds: number }) => {
        toast.success("Quiet hours flush interval saved");
        setQuietHoursFlushInitialized(false);
        qc.invalidateQueries({ queryKey: getGetQuietHoursFlushConfigQueryKey() });
        setQuietHoursFlushInterval(updated.intervalSeconds);
        setQuietHoursFlushInitialized(true);
      },
      onError: (err: Error) => toast.error(err.message),
    },
  });

  const testEmailTrimmed = testEmailTo.trim();
  const testEmailInvalid = testEmailTrimmed.length > 0 && !EMAIL_REGEX.test(testEmailTrimmed);

  const currentEmail = data?.finance_report_email ?? null;
  const emailUnchanged = financeEmail === (currentEmail ?? "");

  const currentSchedule = (() => {
    const raw = data?.reconciliation_schedule;
    return raw === "weekly" || raw === "off" ? raw : "daily";
  })();
  const scheduleUnchanged = scheduleMode === currentSchedule;

  const webhookAlertNow = Date.now();
  const webhookAlertCooldownMs = currentWebhookAlertCooldownHours * 60 * 60 * 1000;
  const webhookAlertLatestPerMerchant = new Map<number, number>();
  for (const entry of webhookAlertHistory) {
    const t = new Date(entry.sentAt).getTime();
    if (!webhookAlertLatestPerMerchant.has(entry.merchantId) || t > webhookAlertLatestPerMerchant.get(entry.merchantId)!) {
      webhookAlertLatestPerMerchant.set(entry.merchantId, t);
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-violet-500/10 border border-violet-500/20">
          <Settings className="w-5 h-5 text-violet-400" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-foreground">System Settings</h1>
          <p className="text-sm text-muted-foreground">Configure platform-wide operational settings</p>
        </div>
      </div>

      {/* Email / SMTP Configuration */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Server className="w-4 h-4 text-muted-foreground" />
              <CardTitle className="text-base">Email / SMTP</CardTitle>
            </div>
            {smtpConfigured === true && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-400">
                <Wifi className="w-3 h-3" />
                SMTP ready
              </span>
            )}
            {smtpConfigured === false && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-400">
                <WifiOff className="w-3 h-3" />
                Not configured
              </span>
            )}
          </div>
          <CardDescription className="text-sm">
            Configure outgoing mail delivery for audit reports, reconciliation alerts, and plan notifications.
            Settings saved here take precedence over any server environment variables.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="smtp-host" className="text-sm">SMTP host</Label>
              <Input
                id="smtp-host"
                type="text"
                placeholder="smtp.example.com"
                value={smtpHost}
                onChange={e => setSmtpHost(e.target.value)}
                disabled={smtpConfigLoading}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="smtp-port" className="text-sm">Port</Label>
              <Input
                id="smtp-port"
                type="number"
                min={1}
                max={65535}
                placeholder="587"
                value={smtpPort}
                onChange={e => setSmtpPort(e.target.value)}
                disabled={smtpConfigLoading}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="smtp-user" className="text-sm">Username</Label>
            <Input
              id="smtp-user"
              type="text"
              placeholder="user@example.com"
              value={smtpUser}
              onChange={e => setSmtpUser(e.target.value)}
              disabled={smtpConfigLoading}
              autoComplete="username"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="smtp-pass" className="text-sm">
              Password
              {smtpConfig?.passConfigured && (
                <span className="ml-2 text-xs text-muted-foreground font-normal">
                  (leave blank to keep current password)
                </span>
              )}
            </Label>
            <div className="relative flex items-center">
              <Input
                id="smtp-pass"
                type={showPass ? "text" : "password"}
                placeholder={smtpConfig?.passConfigured ? "••••••••" : "Enter password"}
                value={smtpPass}
                onChange={e => setSmtpPass(e.target.value)}
                disabled={smtpConfigLoading}
                autoComplete="current-password"
                className="pr-10"
              />
              <button
                type="button"
                className="absolute right-3 text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setShowPass(v => !v)}
                tabIndex={-1}
              >
                {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="smtp-from" className="text-sm">From address</Label>
            <Input
              id="smtp-from"
              type="text"
              placeholder='RasoKart <noreply@rasokart.com>'
              value={smtpFrom}
              onChange={e => setSmtpFrom(e.target.value)}
              disabled={smtpConfigLoading}
            />
            <p className="text-xs text-muted-foreground">
              Used as the sender on all outgoing emails. Accepts plain email or{" "}
              <code className="bg-muted px-1 py-0.5 rounded text-xs">Name &lt;email&gt;</code> format.
            </p>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Button
              size="sm"
              onClick={() => saveSmtp()}
              disabled={savingSmtp || smtpConfigLoading || !smtpChanged}
            >
              <Save className="w-3.5 h-3.5 mr-1.5" />
              {savingSmtp ? "Saving…" : "Save"}
            </Button>
            {smtpChanged && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSmtpHost(smtpConfig?.host ?? "");
                  setSmtpPort(smtpConfig?.port ?? "587");
                  setSmtpUser(smtpConfig?.user ?? "");
                  setSmtpFrom(smtpConfig?.from ?? "");
                  setSmtpPass("");
                }}
                disabled={savingSmtp}
              >
                Cancel
              </Button>
            )}
          </div>

          {/* Test connection */}
          <div className="border-t border-border/50 pt-4 space-y-3">
            <div>
              <p className="text-sm font-medium text-foreground mb-0.5">Send a test email</p>
              <p className="text-xs text-muted-foreground">
                Verify your SMTP settings are working by sending a test message.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Input
                type="email"
                placeholder="recipient@example.com"
                value={smtpTestTo}
                onChange={e => {
                  setSmtpTestTo(e.target.value);
                  setSmtpTestResult(null);
                }}
                disabled={sendingSmtpTest || smtpConfigured === false}
                className="max-w-sm"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setSmtpTestResult(null);
                  sendSmtpTest();
                }}
                disabled={
                  sendingSmtpTest ||
                  smtpConfigured === false ||
                  (!smtpTestTo.trim() && !currentEmail)
                }
                title={
                  smtpConfigured === false
                    ? "Save valid SMTP credentials first"
                    : !smtpTestTo.trim() && !currentEmail
                    ? "Enter a recipient address"
                    : smtpTestTo.trim()
                    ? `Send test to ${smtpTestTo.trim()}`
                    : `Send test to ${currentEmail}`
                }
              >
                <Send className="w-3.5 h-3.5 mr-1.5" />
                {sendingSmtpTest ? "Sending…" : "Send test"}
              </Button>
            </div>

            {smtpTestResult === "success" && (
              <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-md px-3 py-2">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>{smtpTestMessage}</span>
              </div>
            )}
            {smtpTestResult === "error" && (
              <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{smtpTestMessage}</span>
              </div>
            )}
            {smtpConfigured === false && (
              <p className="text-xs text-muted-foreground">
                Fill in host, port, username, and password above, then save before sending a test.
              </p>
            )}
          </div>

          {/* Report delivery retries */}
          <div className="border-t border-border/50 pt-4 space-y-4">
            <div>
              <p className="text-sm font-medium text-foreground mb-0.5">Report delivery retries</p>
              <p className="text-xs text-muted-foreground">
                Controls how many times the scheduler retries a failed report email before pausing the schedule,
                and the exponential backoff base delay between attempts.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="report-retry-max" className="text-sm">Max delivery retries</Label>
                <Input
                  id="report-retry-max"
                  type="number"
                  min={1}
                  max={10}
                  value={reportRetryMaxAttempts}
                  onChange={e => setReportRetryMaxAttempts(parseInt(e.target.value, 10) || 1)}
                  disabled={reportRetryLoading}
                />
                <p className="text-xs text-muted-foreground">Allowed: 1–10. Default: 3.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="report-retry-backoff" className="text-sm">Retry backoff (ms)</Label>
                <Input
                  id="report-retry-backoff"
                  type="number"
                  min={100}
                  max={60000}
                  step={100}
                  value={reportRetryBackoffMs}
                  onChange={e => setReportRetryBackoffMs(parseInt(e.target.value, 10) || 100)}
                  disabled={reportRetryLoading}
                />
                <p className="text-xs text-muted-foreground">Base delay for exponential backoff. Default: 1000 ms.</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={() => saveReportRetry()}
                disabled={savingReportRetry || reportRetryLoading || reportRetryUnchanged}
              >
                <Save className="w-3.5 h-3.5 mr-1.5" />
                {savingReportRetry ? "Saving…" : "Save"}
              </Button>
              {!reportRetryUnchanged && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setReportRetryMaxAttempts(currentReportRetryMaxAttempts);
                    setReportRetryBackoffMs(currentReportRetryBackoffMs);
                  }}
                  disabled={savingReportRetry}
                >
                  Cancel
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Reconciliation Schedule */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-base">Reconciliation Schedule</CardTitle>
          </div>
          <CardDescription className="text-sm">
            Control how often the system automatically runs reconciliation. The run time is
            configured separately under the Reconciliation settings.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isLoading && currentSchedule === "off" && (
            <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-md px-3 py-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>Automatic reconciliation is currently <strong>disabled</strong>. Manual runs still work.</span>
            </div>
          )}
          {!isLoading && currentSchedule !== "off" && (
            <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-md px-3 py-2">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              <span>
                Automatic reconciliation runs <strong>{currentSchedule === "weekly" ? "weekly (every Monday)" : "daily"}</strong>.
              </span>
            </div>
          )}

          <div className="space-y-2">
            <Label className="text-sm">Schedule frequency</Label>
            <div className="space-y-2">
              {SCHEDULE_OPTIONS.map(opt => (
                <label
                  key={opt.value}
                  className={`flex items-start gap-3 rounded-lg border px-4 py-3 cursor-pointer transition-colors ${
                    scheduleMode === opt.value
                      ? "border-violet-500/50 bg-violet-500/5"
                      : "border-border/50 hover:border-border"
                  }`}
                >
                  <input
                    type="radio"
                    name="schedule-mode"
                    value={opt.value}
                    checked={scheduleMode === opt.value}
                    onChange={() => setScheduleMode(opt.value)}
                    disabled={isLoading}
                    className="mt-0.5 accent-violet-500"
                  />
                  <div>
                    <p className="text-sm font-medium text-foreground">{opt.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{opt.description}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => saveSchedule()}
              disabled={savingSchedule || isLoading || scheduleUnchanged}
            >
              <Save className="w-3.5 h-3.5 mr-1.5" />
              {savingSchedule ? "Saving…" : "Save"}
            </Button>
            {!scheduleUnchanged && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setScheduleMode(currentSchedule)}
                disabled={savingSchedule}
              >
                Cancel
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Finance Report Email */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Mail className="w-4 h-4 text-muted-foreground" />
              <CardTitle className="text-base">Finance Report Recipients</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={handlePreviewEmail}
                disabled={previewingEmail}
                title="Preview the finance report email with sample data"
              >
                <Eye className="w-3.5 h-3.5 mr-1.5" />
                {previewingEmail ? "Loading…" : "Preview email"}
              </Button>
              {smtpConfigured === true && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-400">
                <Wifi className="w-3 h-3" />
                SMTP ready
              </span>
            )}
            {smtpConfigured === false && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-400">
                <WifiOff className="w-3 h-3" />
                SMTP not configured
              </span>
            )}
            </div>
          </div>
          <CardDescription className="text-sm">
            After each reconciliation run completes, a summary email with the full CSV report attached
            will be sent to all configured addresses. Leave blank to disable automatic emails.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isLoading && currentEmail && (
            <div className="flex items-start gap-2 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-md px-3 py-2">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                Reports are currently being sent to{" "}
                {currentEmail.split(",").map(e => e.trim()).filter(Boolean).map((addr, i, arr) => (
                  <span key={addr}>
                    <strong>{addr}</strong>{i < arr.length - 1 ? ", " : ""}
                  </span>
                ))}
              </span>
            </div>
          )}
          {!isLoading && !currentEmail && (
            <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-md px-3 py-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>No finance email configured — automatic reports are disabled</span>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="finance-email" className="text-sm">Recipient email addresses</Label>
            <div className="flex items-center gap-2">
              <Input
                id="finance-email"
                type="text"
                placeholder="cfo@company.com, controller@company.com, auditor@company.com"
                value={financeEmail}
                onChange={e => setFinanceEmail(e.target.value)}
                disabled={isLoading}
                className="max-w-lg"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Separate multiple addresses with commas.
              {recipientCount > 1 && (
                <span className="ml-1 text-violet-400">{recipientCount} recipients configured.</span>
              )}
              {" "}Reports include run stats and a full CSV attachment.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="test-email-to" className="text-sm">Send test email</Label>
            <div className="flex items-center gap-2">
              <Input
                id="test-email-to"
                type="email"
                placeholder={currentEmail ? `Leave blank to use ${currentEmail.split(",")[0]?.trim()}` : "Enter recipient address"}
                value={testEmailTo}
                onChange={e => setTestEmailTo(e.target.value)}
                disabled={isLoading || sendingTest}
                className={`max-w-sm ${testEmailInvalid ? "border-red-500/70 focus-visible:ring-red-500/30" : ""}`}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => sendTestEmail()}
                disabled={sendingTest || isLoading || smtpConfigured === false || (!testEmailTrimmed && !currentEmail) || testEmailInvalid}
                title={
                  smtpConfigured === false
                    ? "SMTP is not configured — configure it in the Email / SMTP section above"
                    : testEmailInvalid
                    ? "Enter a valid email address"
                    : !testEmailTrimmed && !currentEmail
                    ? "Enter an address above or save a finance report email first"
                    : testEmailTrimmed
                    ? `Send test to ${testEmailTrimmed}`
                    : `Send test to ${currentEmail}`
                }
              >
                <Send className="w-3.5 h-3.5 mr-1.5" />
                {sendingTest ? "Sending…" : "Send test"}
              </Button>
            </div>
            {testEmailInvalid && (
              <p className="text-xs text-red-400 flex items-center gap-1">
                <AlertCircle className="w-3 h-3 shrink-0" />
                Invalid email address
              </p>
            )}
            {!testEmailInvalid && (
              <p className="text-xs text-muted-foreground">
                Optional override — if blank, the test goes to the saved finance report email.
              </p>
            )}
          </div>

          <div className="border-t border-border/50 pt-4 space-y-3">
            <div>
              <p className="text-sm font-medium text-foreground mb-0.5">Send sample report</p>
              <p className="text-xs text-muted-foreground">
                Delivers the full branded finance report email (same template as production) with realistic sample data and a CSV attachment — so you can verify exactly how it looks in your inbox before the first real reconciliation run fires.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Input
                type="email"
                placeholder={currentEmail ? `Leave blank to use ${currentEmail.split(",")[0]?.trim()}` : "Enter recipient address"}
                value={sampleReportTo}
                onChange={e => {
                  setSampleReportTo(e.target.value);
                  setSampleReportResult(null);
                }}
                disabled={isLoading || sendingSample}
                className={`max-w-sm ${sampleReportToInvalid ? "border-red-500/70 focus-visible:ring-red-500/30" : ""}`}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setSampleReportResult(null);
                  sendSampleReport();
                }}
                disabled={
                  sendingSample ||
                  isLoading ||
                  smtpConfigured === false ||
                  (!sampleReportToTrimmed && !currentEmail) ||
                  sampleReportToInvalid
                }
                title={
                  smtpConfigured === false
                    ? "SMTP is not configured — configure it in the Email / SMTP section above"
                    : sampleReportToInvalid
                    ? "Enter a valid email address"
                    : !sampleReportToTrimmed && !currentEmail
                    ? "Enter an address above or save a finance report email first"
                    : sampleReportToTrimmed
                    ? `Send sample report to ${sampleReportToTrimmed}`
                    : `Send sample report to ${currentEmail}`
                }
              >
                <Send className="w-3.5 h-3.5 mr-1.5" />
                {sendingSample ? "Sending…" : "Send sample report"}
              </Button>
            </div>

            {sampleReportToInvalid && (
              <p className="text-xs text-red-400 flex items-center gap-1">
                <AlertCircle className="w-3 h-3 shrink-0" />
                Invalid email address
              </p>
            )}
            {!sampleReportToInvalid && (
              <p className="text-xs text-muted-foreground">
                Optional override address — if blank, the sample goes to the saved recipients.
              </p>
            )}

            {sampleReportResult === "success" && (
              <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-md px-3 py-2">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>{sampleReportMessage}</span>
              </div>
            )}
            {sampleReportResult === "error" && (
              <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{sampleReportMessage}</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => saveEmail()}
              disabled={savingEmail || isLoading || emailUnchanged}
            >
              <Save className="w-3.5 h-3.5 mr-1.5" />
              {savingEmail ? "Saving…" : "Save"}
            </Button>
            {!emailUnchanged && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setFinanceEmail(currentEmail ?? "")}
                disabled={savingEmail}
              >
                Cancel
              </Button>
            )}
          </div>

          {/* Test-email send history */}
          <div className="border-t border-border/50 pt-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <History className="w-3.5 h-3.5 text-muted-foreground" />
                <p className="text-sm font-medium text-foreground">Test email history</p>
              </div>
              <div className="flex items-center gap-1">
                {(["all", "success", "failed"] as const).map(f => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setTestHistoryFilter(f)}
                    className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                      testHistoryFilter === f
                        ? "bg-violet-500/20 text-violet-300 border border-violet-500/30"
                        : "text-muted-foreground hover:text-foreground border border-transparent"
                    }`}
                  >
                    {f.charAt(0).toUpperCase() + f.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {historyLoading && (
              <p className="text-xs text-muted-foreground">Loading history…</p>
            )}

            {!historyLoading && (() => {
              const allRows: AdminAuditLog[] = testEmailHistory?.data ?? [];
              const filteredRows = allRows.filter((row: AdminAuditLog) => {
                let parsed: { success?: boolean } = {};
                try { parsed = JSON.parse(row.details ?? "{}"); } catch {}
                if (testHistoryFilter === "success") return parsed.success === true;
                if (testHistoryFilter === "failed") return parsed.success === false;
                return true;
              });

              if (filteredRows.length === 0) {
                return (
                  <p className="text-xs text-muted-foreground italic">
                    {testHistoryFilter === "all"
                      ? "No test emails have been sent yet."
                      : `No ${testHistoryFilter} entries found.`}
                  </p>
                );
              }

              return (
                <div className="space-y-1.5">
                  {filteredRows.map((row: AdminAuditLog) => {
                    let details: { recipients?: string[]; success?: boolean; error?: string } = {};
                    try { details = JSON.parse(row.details ?? "{}"); } catch {}
                    const success = details.success === true;
                    const recipients = details.recipients ?? [];
                    const recipientLabel = recipients.length > 0
                      ? recipients.join(", ")
                      : "unknown recipient";
                    const errorLabel = details.error
                      ? details.error.replace(/_/g, " ")
                      : null;

                    return (
                      <div
                        key={row.id}
                        className={`flex items-start gap-2.5 rounded-md border px-3 py-2 text-xs ${
                          success
                            ? "border-emerald-500/20 bg-emerald-500/5"
                            : "border-red-500/20 bg-red-500/5"
                        }`}
                      >
                        {success ? (
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5 text-emerald-400" />
                        ) : (
                          <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-red-400" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className={`font-medium truncate ${success ? "text-emerald-400" : "text-red-400"}`}>
                            {recipientLabel}
                          </p>
                          {!success && errorLabel && (
                            <p className="text-muted-foreground mt-0.5">{errorLabel}</p>
                          )}
                        </div>
                        <time
                          dateTime={row.createdAt}
                          className="shrink-0 text-muted-foreground tabular-nums"
                          title={new Date(row.createdAt).toLocaleString()}
                        >
                          {new Date(row.createdAt).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </time>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </CardContent>
      </Card>

      {/* Test Email History Retention */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-base">Test Email History Retention</CardTitle>
          </div>
          <CardDescription className="text-sm">
            Automatically prune test email audit log entries older than the configured number of days.
            The cleanup job runs nightly at 02:30 server time.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!testEmailRetentionLoading && currentTestEmailRetentionDays === 0 && (
            <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-md px-3 py-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>Auto-cleanup is <strong>disabled</strong>. Test email history will never be deleted automatically.</span>
            </div>
          )}
          {!testEmailRetentionLoading && currentTestEmailRetentionDays > 0 && (
            <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-md px-3 py-2">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              <span>
                Test email history entries are deleted automatically after{" "}
                <strong>{currentTestEmailRetentionDays} day{currentTestEmailRetentionDays !== 1 ? "s" : ""}</strong>.
              </span>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="test-email-retention-days" className="text-sm">Retention period (days)</Label>
            <div className="flex items-center gap-3">
              <Input
                id="test-email-retention-days"
                type="number"
                min={0}
                max={365}
                value={testEmailRetentionDays}
                onChange={e => {
                  const v = parseInt(e.target.value);
                  if (!isNaN(v)) setTestEmailRetentionDays(Math.max(0, Math.min(365, v)));
                }}
                disabled={testEmailRetentionLoading}
                className="w-32"
              />
              <span className="text-sm text-muted-foreground">days since sent</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Set to <strong>0</strong> to disable automatic cleanup entirely. Maximum is 365 days.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => saveTestEmailRetention()}
              disabled={savingTestEmailRetention || testEmailRetentionLoading || testEmailRetentionUnchanged}
            >
              <Save className="w-3.5 h-3.5 mr-1.5" />
              {savingTestEmailRetention ? "Saving…" : "Save"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => runTestEmailCleanup()}
              disabled={runningTestEmailCleanup || currentTestEmailRetentionDays === 0}
              title={currentTestEmailRetentionDays === 0 ? "Enable retention first to run cleanup" : "Run cleanup now"}
            >
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${runningTestEmailCleanup ? "animate-spin" : ""}`} />
              {runningTestEmailCleanup ? "Running…" : "Run now"}
            </Button>
            {!testEmailRetentionUnchanged && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setTestEmailRetentionDays(currentTestEmailRetentionDays)}
                disabled={savingTestEmailRetention}
              >
                Cancel
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* QR Code Auto-Cleanup */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Trash2 className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-base">QR Code Auto-Cleanup</CardTitle>
          </div>
          <CardDescription className="text-sm">
            Automatically delete expired and used QR codes after a configurable number of days.
            The cleanup job runs nightly at 02:00 server time.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!qrCleanupLoading && currentRetentionDays === 0 && (
            <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-md px-3 py-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>Auto-cleanup is <strong>disabled</strong>. Expired and used QR codes will never be deleted automatically.</span>
            </div>
          )}
          {!qrCleanupLoading && currentRetentionDays > 0 && (
            <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-md px-3 py-2">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              <span>
                Expired and used QR codes are deleted automatically after{" "}
                <strong>{currentRetentionDays} day{currentRetentionDays !== 1 ? "s" : ""}</strong>.
              </span>
            </div>
          )}
          {cleanupStats?.qrCleanup.lastRunAt != null ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/20 border border-border/40 rounded-md px-3 py-2">
              <History className="w-3.5 h-3.5 shrink-0" />
              <span>
                Last cleanup:{" "}
                <strong title={new Date(cleanupStats.qrCleanup.lastRunAt).toLocaleString()}>
                  {formatTimeAgo(cleanupStats.qrCleanup.lastRunAt)}
                </strong>
                {" — "}
                {cleanupStats.qrCleanup.lastRunDeleted === 0
                  ? "0 rows deleted"
                  : `${cleanupStats.qrCleanup.lastRunDeleted} row${cleanupStats.qrCleanup.lastRunDeleted !== 1 ? "s" : ""} deleted`}
              </span>
            </div>
          ) : cleanupStats != null ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/20 border border-border/40 rounded-md px-3 py-2">
              <History className="w-3.5 h-3.5 shrink-0" />
              <span>No cleanup runs recorded yet — job runs nightly at 02:00.</span>
            </div>
          ) : null}

          {!qrCleanupLoading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 border border-border/40 rounded-md px-3 py-2">
              <History className="w-3.5 h-3.5 shrink-0" />
              {qrCleanupData?.lastRunAt == null ? (
                <span>Last run: <strong>Never run</strong></span>
              ) : (
                <span>
                  Last run: <strong>{new Date(qrCleanupData.lastRunAt).toLocaleString()}</strong>
                  {" — "}
                  <strong>{qrCleanupData.lastDeleted ?? 0}</strong> record{qrCleanupData.lastDeleted !== 1 ? "s" : ""} deleted
                </span>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="retention-days" className="text-sm">Retention period (days)</Label>
            <div className="flex items-center gap-3">
              <Input
                id="retention-days"
                type="number"
                min={0}
                max={365}
                value={retentionDays}
                onChange={e => {
                  const v = parseInt(e.target.value);
                  if (!isNaN(v)) setRetentionDays(Math.max(0, Math.min(365, v)));
                }}
                disabled={qrCleanupLoading}
                className="w-32"
              />
              <span className="text-sm text-muted-foreground">days after expiry/use</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Set to <strong>0</strong> to disable automatic cleanup entirely.
              Maximum is 365 days.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => saveRetention()}
              disabled={savingRetention || qrCleanupLoading || retentionUnchanged}
            >
              <Save className="w-3.5 h-3.5 mr-1.5" />
              {savingRetention ? "Saving…" : "Save"}
            </Button>
            {!retentionUnchanged && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setRetentionDays(currentRetentionDays)}
                disabled={savingRetention}
              >
                Cancel
              </Button>
            )}
          </div>

          <div className="border-t border-border/50 pt-3">
            <div className="flex items-center justify-between">
              <button
                type="button"
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setQrHistoryOpen(v => !v)}
              >
                {qrHistoryOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                Recent runs
              </button>
              {qrHistoryOpen && (qrHistoryData?.data?.length ?? 0) > 0 && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                  onClick={() => clearQrHistory()}
                  disabled={clearingQrHistory}
                >
                  {clearingQrHistory ? "Clearing…" : "Clear history"}
                </button>
              )}
            </div>
            {qrHistoryOpen && (
              <div className="mt-2">
                {qrHistoryLoading ? (
                  <p className="text-xs text-muted-foreground">Loading…</p>
                ) : !qrHistoryData?.data?.length ? (
                  <p className="text-xs text-muted-foreground">No cleanup runs recorded yet.</p>
                ) : (
                  <div className="rounded-md border border-border/40 overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border/40 bg-muted/20">
                          <th className="text-left px-3 py-2 font-medium text-muted-foreground">Date &amp; time</th>
                          <th className="text-left px-3 py-2 font-medium text-muted-foreground">Trigger</th>
                          <th className="text-right px-3 py-2 font-medium text-muted-foreground">Expired</th>
                          <th className="text-right px-3 py-2 font-medium text-muted-foreground">Deleted</th>
                          <th className="text-right px-3 py-2 font-medium text-muted-foreground">Retention</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(qrHistoryData.data as CleanupRunHistoryEntry[]).map((row, i) => (
                          <tr key={row.id} className={`border-b border-border/30 last:border-0 ${i % 2 === 0 ? "" : "bg-muted/10"}`}>
                            <td className="px-3 py-2 text-foreground/80">
                              {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(row.ranAt))}
                            </td>
                            <td className="px-3 py-2">
                              {row.trigger === "manual"
                                ? <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 border border-violet-500/25 px-1.5 py-0.5 text-[10px] font-medium text-violet-400">manual</span>
                                : <span className="inline-flex items-center gap-1 rounded-full bg-muted/40 border border-border/40 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">scheduled</span>
                              }
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {(row.expired ?? 0) === 0
                                ? <span className="text-muted-foreground">0</span>
                                : <span className="text-amber-400 font-medium">{row.expired}</span>}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {row.deleted === 0
                                ? <span className="text-muted-foreground">0</span>
                                : <span className="text-amber-400 font-medium">{row.deleted}</span>}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{row.retentionDays}d</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="border-t border-border/50 pt-4 space-y-3">
            <div>
              <p className="text-sm font-medium text-foreground">Run cleanup now</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Trigger the QR cleanup job immediately, using the current retention window.
              </p>
            </div>

            <Button
              size="sm"
              variant="outline"
              onClick={() => { setQrCleanupRunResult(null); runQrCleanupNow(); }}
              disabled={runningQrCleanup || currentRetentionDays === 0}
              title={currentRetentionDays === 0 ? "Enable auto-cleanup first (set retention days > 0)" : undefined}
            >
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${runningQrCleanup ? "animate-spin" : ""}`} />
              {runningQrCleanup ? "Running…" : "Run cleanup now"}
            </Button>

            {qrCleanupRunResult !== null && (
              <div className={`flex items-center gap-2 text-xs rounded-md px-3 py-2 border ${
                qrCleanupRunResult.expired === 0 && qrCleanupRunResult.deleted === 0
                  ? "text-muted-foreground bg-muted/30 border-border/40"
                  : "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
              }`}>
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>
                  {qrCleanupRunResult.expired === 0 && qrCleanupRunResult.deleted === 0
                    ? "Nothing to clean up — all QR codes are within the retention window."
                    : [
                        qrCleanupRunResult.expired > 0 && `${qrCleanupRunResult.expired} code${qrCleanupRunResult.expired !== 1 ? "s" : ""} expired`,
                        qrCleanupRunResult.deleted > 0 && `${qrCleanupRunResult.deleted} code${qrCleanupRunResult.deleted !== 1 ? "s" : ""} deleted`,
                      ].filter(Boolean).join(", ") + "."}
                </span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Virtual Account Auto-Cleanup */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Trash2 className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-base">Virtual Account Auto-Cleanup</CardTitle>
          </div>
          <CardDescription className="text-sm">
            Automatically delete closed virtual accounts after a configurable number of days.
            The cleanup job runs nightly at 03:00 server time.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!vaCleanupLoading && currentVaRetentionDays === 0 && (
            <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-md px-3 py-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>Auto-cleanup is <strong>disabled</strong>. Closed virtual accounts will never be deleted automatically.</span>
            </div>
          )}
          {!vaCleanupLoading && currentVaRetentionDays > 0 && (
            <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-md px-3 py-2">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              <span>
                Closed virtual accounts are deleted automatically after{" "}
                <strong>{currentVaRetentionDays} day{currentVaRetentionDays !== 1 ? "s" : ""}</strong>.
              </span>
            </div>
          )}

          {!vaCleanupLoading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 border border-border/40 rounded-md px-3 py-2">
              <History className="w-3.5 h-3.5 shrink-0" />
              {vaCleanupData?.lastRunAt == null ? (
                <span>Last run: <strong>Never run</strong></span>
              ) : (
                <span>
                  Last run: <strong>{new Date(vaCleanupData.lastRunAt).toLocaleString()}</strong>
                  {" — "}
                  <strong>{vaCleanupData.lastDeleted ?? 0}</strong> record{vaCleanupData.lastDeleted !== 1 ? "s" : ""} deleted
                </span>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="va-retention-days" className="text-sm">Retention period (days)</Label>
            <div className="flex items-center gap-3">
              <Input
                id="va-retention-days"
                type="number"
                min={0}
                max={365}
                value={vaRetentionDays}
                onChange={e => {
                  const v = parseInt(e.target.value);
                  if (!isNaN(v)) setVaRetentionDays(Math.max(0, Math.min(365, v)));
                }}
                disabled={vaCleanupLoading}
                className="w-32"
              />
              <span className="text-sm text-muted-foreground">days after closing</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Set to <strong>0</strong> to disable automatic cleanup entirely.
              Maximum is 365 days.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => saveVaRetention()}
              disabled={savingVaRetention || vaCleanupLoading || vaRetentionUnchanged}
            >
              <Save className="w-3.5 h-3.5 mr-1.5" />
              {savingVaRetention ? "Saving…" : "Save"}
            </Button>
            {!vaRetentionUnchanged && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setVaRetentionDays(currentVaRetentionDays)}
                disabled={savingVaRetention}
              >
                Cancel
              </Button>
            )}
          </div>

          <div className="border-t border-border/50 pt-3">
            <div className="flex items-center justify-between">
              <button
                type="button"
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setVaHistoryOpen(v => !v)}
              >
                {vaHistoryOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                Recent runs
              </button>
              {vaHistoryOpen && (vaHistoryData?.data?.length ?? 0) > 0 && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                  onClick={() => clearVaHistory()}
                  disabled={clearingVaHistory}
                >
                  {clearingVaHistory ? "Clearing…" : "Clear history"}
                </button>
              )}
            </div>
            {vaHistoryOpen && (
              <div className="mt-2">
                {vaHistoryLoading ? (
                  <p className="text-xs text-muted-foreground">Loading…</p>
                ) : !vaHistoryData?.data?.length ? (
                  <p className="text-xs text-muted-foreground">No cleanup runs recorded yet.</p>
                ) : (
                  <div className="rounded-md border border-border/40 overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border/40 bg-muted/20">
                          <th className="text-left px-3 py-2 font-medium text-muted-foreground">Date &amp; time</th>
                          <th className="text-left px-3 py-2 font-medium text-muted-foreground">Trigger</th>
                          <th className="text-right px-3 py-2 font-medium text-muted-foreground">Closed</th>
                          <th className="text-right px-3 py-2 font-medium text-muted-foreground">Deleted</th>
                          <th className="text-right px-3 py-2 font-medium text-muted-foreground">Retention</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(vaHistoryData.data as CleanupRunHistoryEntry[]).map((row, i) => (
                          <tr key={row.id} className={`border-b border-border/30 last:border-0 ${i % 2 === 0 ? "" : "bg-muted/10"}`}>
                            <td className="px-3 py-2 text-foreground/80">
                              {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(row.ranAt))}
                            </td>
                            <td className="px-3 py-2">
                              {row.trigger === "manual"
                                ? <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 border border-violet-500/25 px-1.5 py-0.5 text-[10px] font-medium text-violet-400">manual</span>
                                : <span className="inline-flex items-center gap-1 rounded-full bg-muted/40 border border-border/40 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">scheduled</span>
                              }
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {(row.closed ?? 0) === 0
                                ? <span className="text-muted-foreground">0</span>
                                : <span className="text-amber-400 font-medium">{row.closed}</span>}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {row.deleted === 0
                                ? <span className="text-muted-foreground">0</span>
                                : <span className="text-amber-400 font-medium">{row.deleted}</span>}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{row.retentionDays}d</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="border-t border-border/50 pt-4 space-y-3">
            <div>
              <p className="text-sm font-medium text-foreground">Run cleanup now</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Trigger the VA cleanup job immediately, using the current retention window.
              </p>
            </div>

            <Button
              size="sm"
              variant="outline"
              onClick={() => { setVaCleanupRunResult(null); runVaCleanupNow(); }}
              disabled={runningVaCleanup || currentVaRetentionDays === 0}
              title={currentVaRetentionDays === 0 ? "Enable auto-cleanup first (set retention days > 0)" : undefined}
            >
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${runningVaCleanup ? "animate-spin" : ""}`} />
              {runningVaCleanup ? "Running…" : "Run cleanup now"}
            </Button>

            {vaCleanupRunResult !== null && (
              <div className={`flex items-center gap-2 text-xs rounded-md px-3 py-2 border ${
                vaCleanupRunResult.closed === 0 && vaCleanupRunResult.deleted === 0
                  ? "text-muted-foreground bg-muted/30 border-border/40"
                  : "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
              }`}>
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>
                  {vaCleanupRunResult.closed === 0 && vaCleanupRunResult.deleted === 0
                    ? "Nothing to clean up — all virtual accounts are within the retention window."
                    : [
                        vaCleanupRunResult.closed > 0 && `${vaCleanupRunResult.closed} account${vaCleanupRunResult.closed !== 1 ? "s" : ""} closed`,
                        vaCleanupRunResult.deleted > 0 && `${vaCleanupRunResult.deleted} account${vaCleanupRunResult.deleted !== 1 ? "s" : ""} deleted`,
                      ].filter(Boolean).join(", ") + "."}
                </span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Audit Report Log Retention */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-base">Scheduled Report Log Retention</CardTitle>
          </div>
          <CardDescription className="text-sm">
            Automatically delete old audit report delivery log entries after a configurable number of days.
            The cleanup job runs nightly at 02:30 server time.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!auditLogRetentionLoading && currentAuditLogRetentionDays === 0 && (
            <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-md px-3 py-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>Log retention is <strong>disabled</strong>. Audit report delivery logs will never be deleted automatically.</span>
            </div>
          )}
          {!auditLogRetentionLoading && currentAuditLogRetentionDays > 0 && (
            <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-md px-3 py-2">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              <span>
                Audit report delivery logs are deleted automatically after{" "}
                <strong>{currentAuditLogRetentionDays} day{currentAuditLogRetentionDays !== 1 ? "s" : ""}</strong>.
              </span>
            </div>
          )}
          {cleanupStats?.auditReportCleanup.lastRunAt != null ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/20 border border-border/40 rounded-md px-3 py-2">
              <History className="w-3.5 h-3.5 shrink-0" />
              <span>
                Last cleanup:{" "}
                <strong title={new Date(cleanupStats.auditReportCleanup.lastRunAt).toLocaleString()}>
                  {formatTimeAgo(cleanupStats.auditReportCleanup.lastRunAt)}
                </strong>
                {" — "}
                {cleanupStats.auditReportCleanup.lastRunDeleted === 0
                  ? "0 rows deleted"
                  : `${cleanupStats.auditReportCleanup.lastRunDeleted} row${cleanupStats.auditReportCleanup.lastRunDeleted !== 1 ? "s" : ""} deleted`}
              </span>
            </div>
          ) : cleanupStats != null ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/20 border border-border/40 rounded-md px-3 py-2">
              <History className="w-3.5 h-3.5 shrink-0" />
              <span>No cleanup runs recorded yet — job runs nightly at 02:30.</span>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="audit-log-retention" className="text-sm">Retention period</Label>
            <Select
              value={String(auditLogRetentionDays)}
              onValueChange={v => setAuditLogRetentionDays(parseInt(v))}
              disabled={auditLogRetentionLoading}
            >
              <SelectTrigger id="audit-log-retention" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="30">30 days</SelectItem>
                <SelectItem value="60">60 days</SelectItem>
                <SelectItem value="90">90 days (default)</SelectItem>
                <SelectItem value="180">180 days</SelectItem>
                <SelectItem value="365">365 days</SelectItem>
                <SelectItem value="0">Disabled (keep forever)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Applies to entries in the <strong>delivery history</strong> panel on the Audit Logs page.
              Set to <strong>Disabled</strong> to keep logs indefinitely.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => saveAuditLogRetention()}
              disabled={savingAuditLogRetention || auditLogRetentionLoading || auditLogRetentionUnchanged}
            >
              <Save className="w-3.5 h-3.5 mr-1.5" />
              {savingAuditLogRetention ? "Saving…" : "Save"}
            </Button>
            {!auditLogRetentionUnchanged && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setAuditLogRetentionDays(currentAuditLogRetentionDays)}
                disabled={savingAuditLogRetention}
              >
                Cancel
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => runAuditReportRetentionCleanup()}
              disabled={runningAuditReportCleanup || auditLogRetentionLoading}
            >
              <Trash2 className="w-3.5 h-3.5 mr-1.5" />
              {runningAuditReportCleanup ? "Running…" : "Run cleanup now"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Webhook Retries */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <RotateCcw className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-base">Webhook Retry Schedule</CardTitle>
          </div>
          <CardDescription className="text-sm">
            Configure the maximum number of delivery attempts and the backoff delays between retries.
            Delay values must be non-decreasing. Changes take effect on the next retry cycle.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {retryOrderWarning && (
            <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-md px-3 py-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>
                Delays are out of order — each retry delay must be greater than or equal to the previous one.
                Fix this before saving.
              </span>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="retry-max-attempts" className="text-sm">Max delivery attempts</Label>
            <Input
              id="retry-max-attempts"
              type="number"
              min={1}
              max={10}
              value={retryMaxAttempts}
              onChange={e => {
                const v = parseInt(e.target.value);
                if (!isNaN(v)) setRetryMaxAttempts(Math.min(10, Math.max(1, v)));
              }}
              disabled={webhookRetriesLoading}
              className="max-w-[10rem]"
            />
            <p className="text-xs text-muted-foreground">
              Total attempts including the initial delivery (1–10). Default is 4 (1 initial + 3 retries).
            </p>
          </div>

          <div className="space-y-1.5">
            <p className="text-sm font-medium text-foreground">Retry delays (seconds)</p>
            <p className="text-xs text-muted-foreground">
              Wait time before each retry after a failed delivery. Only the first{" "}
              <strong>{Math.max(0, retryMaxAttempts - 1)}</strong>{" "}
              {retryMaxAttempts - 1 === 1 ? "delay" : "delays"} will be used.
            </p>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="retry-delay-1" className="text-sm text-muted-foreground">After 1st failure</Label>
                <Input
                  id="retry-delay-1"
                  type="number"
                  min={0}
                  value={retryDelay1}
                  onChange={e => {
                    const v = parseInt(e.target.value);
                    if (!isNaN(v)) setRetryDelay1(Math.max(0, v));
                  }}
                  disabled={webhookRetriesLoading}
                  className="w-full"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="retry-delay-2" className="text-sm text-muted-foreground">After 2nd failure</Label>
                <Input
                  id="retry-delay-2"
                  type="number"
                  min={0}
                  value={retryDelay2}
                  onChange={e => {
                    const v = parseInt(e.target.value);
                    if (!isNaN(v)) setRetryDelay2(Math.max(0, v));
                  }}
                  disabled={webhookRetriesLoading}
                  className="w-full"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="retry-delay-3" className="text-sm text-muted-foreground">After 3rd failure</Label>
                <Input
                  id="retry-delay-3"
                  type="number"
                  min={0}
                  value={retryDelay3}
                  onChange={e => {
                    const v = parseInt(e.target.value);
                    if (!isNaN(v)) setRetryDelay3(Math.max(0, v));
                  }}
                  disabled={webhookRetriesLoading}
                  className="w-full"
                />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => saveRetry()}
              disabled={savingRetry || webhookRetriesLoading || retryUnchanged || retryOrderWarning}
            >
              <Save className="w-3.5 h-3.5 mr-1.5" />
              {savingRetry ? "Saving…" : "Save"}
            </Button>
            {!retryUnchanged && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setRetryMaxAttempts(currentRetryMaxAttempts);
                  setRetryDelay1(currentRetryDelay1);
                  setRetryDelay2(currentRetryDelay2);
                  setRetryDelay3(currentRetryDelay3);
                }}
                disabled={savingRetry}
              >
                Cancel
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Webhook Failure Alert Cooldown */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <WifiOff className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-base">Webhook Failure Alert Cooldown</CardTitle>
          </div>
          <CardDescription className="text-sm">
            Set how long to suppress duplicate webhook failure alert emails for the same merchant. If a merchant's webhook permanently fails multiple times within this window, only the first alert email is sent. Subsequent failures are silently logged but do not trigger a new email until the cooldown expires.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="webhook-alert-cooldown" className="text-sm">Cooldown window (hours)</Label>
              <Input
                id="webhook-alert-cooldown"
                type="number"
                min={1}
                max={168}
                value={webhookAlertCooldownHours}
                onChange={e => {
                  const v = parseInt(e.target.value);
                  if (!isNaN(v)) setWebhookAlertCooldownHours(Math.min(168, Math.max(1, v)));
                }}
                disabled={webhookAlertConfigLoading}
                className="w-full"
              />
              <p className="text-xs text-muted-foreground">
                Between 1 and 168 hours (1 week). Default is 1 hour.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => saveWebhookAlertCooldown({ data: { cooldownHours: webhookAlertCooldownHours } })}
              disabled={savingWebhookAlertCooldown || webhookAlertConfigLoading || webhookAlertCooldownUnchanged}
            >
              <Save className="w-3.5 h-3.5 mr-1.5" />
              {savingWebhookAlertCooldown ? "Saving…" : "Save"}
            </Button>
            {!webhookAlertCooldownUnchanged && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setWebhookAlertCooldownHours(currentWebhookAlertCooldownHours);
                }}
                disabled={savingWebhookAlertCooldown}
              >
                Cancel
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Maintenance */}
      <MaintenanceCard />

      {/* Signature Failure Alert History */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-muted-foreground" />
              <CardTitle className="text-base">Signature Failure Alert History</CardTitle>
            </div>
            {sigFailureHistoryCount > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="text-destructive hover:text-destructive border-destructive/40 hover:bg-destructive/10"
                onClick={() => clearSigFailureHistory()}
                disabled={clearingSigFailureHistory}
              >
                <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                {clearingSigFailureHistory ? "Clearing…" : `Clear (${sigFailureHistoryCount})`}
              </Button>
            )}
          </div>
          <CardDescription className="text-sm">
            A record of every signature failure alert email dispatched by the platform. Useful for auditing alert frequency and reviewing which merchants were affected.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sigFailureHistory.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">No alerts have been sent yet.</p>
          ) : (
            <div className="space-y-2">
              {sigFailureHistory.map((entry) => (
                <div key={entry.id} className="rounded-lg border border-border/50 bg-muted/5 px-4 py-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">
                      {new Date(entry.sentAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                    </span>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{entry.failureCount} failure{entry.failureCount !== 1 ? "s" : ""}</span>
                      <span>{entry.affectedMerchantCount} merchant{entry.affectedMerchantCount !== 1 ? "s" : ""}</span>
                      <span>{entry.recipientCount} recipient{entry.recipientCount !== 1 ? "s" : ""}</span>
                    </div>
                  </div>
                  {entry.affectedMerchants.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Merchants: {entry.affectedMerchants.map(m => `${m.name} (${m.count})`).join(", ")}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Window: {entry.windowHours}h · Threshold: {entry.threshold} · Sent to: {entry.recipientEmails.join(", ")}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Webhook Failure Alert History */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Wifi className="w-4 h-4 text-muted-foreground" />
              <CardTitle className="text-base">Webhook Failure Alert History</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-muted/60 border border-border/50 px-2.5 py-0.5 text-xs text-muted-foreground">
                <Clock className="w-3 h-3 shrink-0" />
                Cooldown: {currentWebhookAlertCooldownHours === 1 ? "1 hour" : `${currentWebhookAlertCooldownHours} hours`}
              </span>
              {webhookAlertMerchants.length > 0 && (
                <Select
                  value={webhookAlertMerchantFilter != null ? String(webhookAlertMerchantFilter) : "all"}
                  onValueChange={(v) => setWebhookAlertMerchantFilter(v === "all" ? null : parseInt(v))}
                >
                  <SelectTrigger className="h-8 text-xs w-48">
                    <SelectValue placeholder="All merchants" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All merchants</SelectItem>
                    {webhookAlertMerchants.map((m) => (
                      <SelectItem key={m.id} value={String(m.id)}>
                        {m.businessName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {webhookAlertGlobalCount > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setResetCooldownMerchantId("all");
                    resetWebhookCooldown({});
                  }}
                  disabled={resettingWebhookCooldown || clearingWebhookAlertHistory}
                  title="Clear all cooldown entries so every merchant can receive a fresh alert on their next failure"
                >
                  <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                  {resettingWebhookCooldown && resetCooldownMerchantId === "all" ? "Resetting…" : "Reset All Cooldowns"}
                </Button>
              )}
              {webhookAlertGlobalCount > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive hover:text-destructive border-destructive/40 hover:bg-destructive/10"
                  onClick={() => clearWebhookAlertHistory()}
                  disabled={clearingWebhookAlertHistory || resettingWebhookCooldown}
                  title="Clears all history across all merchants"
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                  {clearingWebhookAlertHistory ? "Clearing…" : `Clear all (${webhookAlertGlobalCount})`}
                </Button>
              )}
            </div>
          </div>
          <CardDescription className="text-sm">
            A record of every webhook permanent failure alert email dispatched to admins. Tracks which merchant's webhook failed, the URL, attempt count, and which admins were notified.
            Duplicate alerts for the same merchant are suppressed for {currentWebhookAlertCooldownHours === 1 ? "1 hour" : `${currentWebhookAlertCooldownHours} hours`} after each sent alert. Use "Reset cooldown" on any entry to immediately re-arm alerts for that merchant.
            {webhookAlertMerchantFilter != null && (
              <span className="ml-1 text-primary">
                — filtered to {webhookAlertMerchantMap.get(webhookAlertMerchantFilter) ?? `Merchant #${webhookAlertMerchantFilter}`}
                {" "}<button className="underline underline-offset-2 hover:no-underline" onClick={() => setWebhookAlertMerchantFilter(null)}>clear</button>
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {webhookAlertHistory.length === 0 && (
            <p className="text-sm text-muted-foreground py-2">
              {webhookAlertMerchantFilter != null
                ? `No webhook failure alerts for ${webhookAlertMerchantMap.get(webhookAlertMerchantFilter) ?? ("Merchant #" + webhookAlertMerchantFilter)}.`
                : "No webhook failure alert emails have been sent yet."}
            </p>
          )}
          {webhookAlertHistory.length > 0 && (
            <div className="space-y-2">
              {webhookAlertHistory.map((entry) => {
                  const merchantName = webhookAlertMerchantMap.get(entry.merchantId);
                  const entryTime = new Date(entry.sentAt).getTime();
                  const isLatestForMerchant = webhookAlertLatestPerMerchant.get(entry.merchantId) === entryTime;
                  const inCooldown = isLatestForMerchant && (webhookAlertNow - entryTime) < webhookAlertCooldownMs;
                  const cooldownExpiresAt = entryTime + webhookAlertCooldownMs;
                  return (
                    <div key={entry.id} className="rounded-lg border border-border/50 bg-muted/5 px-4 py-3 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">
                          {new Date(entry.sentAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                        </span>
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            {inCooldown && (
                              <span
                                className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 text-amber-400"
                                title={`Cooldown active — new alerts for this merchant are suppressed until ${new Date(cooldownExpiresAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`}
                              >
                                <Clock className="w-3 h-3 shrink-0" />
                                Cooldown active
                              </span>
                            )}
                          </div>
                          <button
                            className="hover:text-foreground transition-colors"
                            title={`Filter by ${merchantName ?? ("Merchant #" + entry.merchantId)}`}
                            onClick={() => setWebhookAlertMerchantFilter(entry.merchantId)}
                          >
                            {merchantName ? (
                              <span>{merchantName} <span className="opacity-60">(#{entry.merchantId})</span></span>
                            ) : (
                              <span>Merchant #{entry.merchantId}</span>
                            )}
                          </button>
                          <span>{entry.attemptCount} attempt{entry.attemptCount !== 1 ? "s" : ""}</span>
                          <span>{entry.recipientCount} recipient{entry.recipientCount !== 1 ? "s" : ""}</span>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 px-2 text-xs"
                          onClick={() => {
                            setResetCooldownMerchantId(entry.merchantId);
                            resetWebhookCooldown({ params: { merchantId: entry.merchantId } });
                          }}
                          disabled={resettingWebhookCooldown || clearingWebhookAlertHistory}
                          title={`Clear cooldown for Merchant #${entry.merchantId} so the next failure triggers a fresh alert email`}
                        >
                          <RotateCcw className="w-3 h-3 mr-1" />
                          {resettingWebhookCooldown && resetCooldownMerchantId === entry.merchantId ? "Resetting…" : "Reset cooldown"}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground font-mono break-all">{entry.failedUrl}</p>
                      {inCooldown && (
                        <p className="text-xs text-amber-400/80">
                          New failure alerts for {merchantName ?? `merchant #${entry.merchantId}`} are suppressed until{" "}
                          {new Date(cooldownExpiresAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}.
                        </p>
                      )}
                      {entry.recipientEmails.length > 0 && (
                        <p className="text-xs text-muted-foreground">
                          Sent to: {entry.recipientEmails.join(", ")}
                        </p>
                      )}
                    </div>
                );
                })}
              </div>
          )}
        </CardContent>
      </Card>

      {/* My Notification Preferences */}
      <Card className="border-border/50" id="signature-failure-alert">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-base">My Notification Preferences</CardTitle>
          </div>
          <CardDescription className="text-sm">
            Control which automated emails are sent to your account. These preferences apply only to you and do not affect other admins.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/5 px-4 py-3">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">Reconciliation alert emails</p>
              <p className="text-xs text-muted-foreground">
                Receive an email when an auto-reconciliation run finds unmatched items that require review.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Button
                size="sm"
                variant="outline"
                onClick={handlePreviewAlertEmail}
                disabled={previewingAlertEmail}
                title="Preview the unmatched-items alert email with sample data"
              >
                <Eye className="w-3.5 h-3.5 mr-1.5" />
                {previewingAlertEmail ? "Loading…" : "Preview alert email"}
              </Button>
              <Switch
                checked={alertEnabled}
                onCheckedChange={val =>
                  updatePrefs({ data: { reconciliationAlertEmails: val } })
                }
                disabled={savingPrefs || me === undefined}
              />
            </div>
          </div>
          {!alertEnabled && (
            <p className="text-xs text-amber-400 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              You will not receive alerts when unmatched reconciliation items are found.
            </p>
          )}

          <div className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/5 px-4 py-3">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">Plan expiry alert emails</p>
              <p className="text-xs text-muted-foreground">
                Receive an email when a merchant's subscription plan is about to expire.
              </p>
            </div>
            <Switch
              checked={planExpiryEnabled}
              onCheckedChange={val =>
                updatePrefs({ data: { planExpiryAlertEmails: val } })
              }
              disabled={savingPrefs || me === undefined}
            />
          </div>
          {!planExpiryEnabled && (
            <p className="text-xs text-amber-400 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              You will not receive alerts when merchant plans are approaching expiry.
            </p>
          )}

          <div className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/5 px-4 py-3">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">Settlement state change emails</p>
              <p className="text-xs text-muted-foreground">
                Receive an email when a merchant settlement changes status (e.g. approved, rejected, completed).
              </p>
            </div>
            <Switch
              checked={settlementStateEnabled}
              onCheckedChange={val =>
                updatePrefs({ data: { settlementStateEmails: val } })
              }
              disabled={savingPrefs || me === undefined}
            />
          </div>
          {!settlementStateEnabled && (
            <p className="text-xs text-amber-400 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              You will not receive emails when settlement statuses change.
            </p>
          )}

          <div className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/5 px-4 py-3">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">Signature failure alert emails</p>
              <p className="text-xs text-muted-foreground">
                Receive an email when signature verification failures spike above the configured alert threshold. Use the Signature Failure Alert card above to adjust the threshold, window, and cooldown.
              </p>
            </div>
            <Switch
              checked={signatureFailureEnabled}
              onCheckedChange={val =>
                updatePrefs({ data: { signatureFailureAlertEmails: val } as any })
              }
              disabled={savingPrefs || me === undefined}
            />
          </div>
          {!signatureFailureEnabled && (
            <p className="text-xs text-amber-400 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              You will not receive alerts when signature failures cross the alert threshold.
            </p>
          )}

          <div className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/5 px-4 py-3">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">Webhook failure emails</p>
              <p className="text-xs text-muted-foreground">
                Receive an email when a merchant's webhook permanently fails after all retry attempts are exhausted.
              </p>
            </div>
            <Switch
              checked={webhookFailureEnabled}
              onCheckedChange={val =>
                updatePrefs({ data: { webhookFailureEmails: val } })
              }
              disabled={savingPrefs || me === undefined}
            />
          </div>
          {!webhookFailureEnabled && (
            <p className="text-xs text-amber-400 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              You will not receive emails when merchant webhooks permanently fail.
            </p>
          )}

          <div className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/5 px-4 py-3">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">Report schedule auto-pause emails</p>
              <p className="text-xs text-muted-foreground">
                Receive an email when a merchant's scheduled report is automatically paused after repeated delivery failures.
              </p>
            </div>
            <Switch
              checked={reportFailureEnabled}
              onCheckedChange={val =>
                updatePrefs({ data: { reportFailureAlertEmails: val } as any })
              }
              disabled={savingPrefs || me === undefined}
            />
          </div>
          {!reportFailureEnabled && (
            <p className="text-xs text-amber-400 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              You will not receive emails when merchant report schedules are auto-paused.
            </p>
          )}

          <div className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/5 px-4 py-3">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">GitHub sync repeated-failure emails</p>
              <p className="text-xs text-muted-foreground">
                Receive an escalated email when the GitHub sync fails 3 times in a row, in addition to the dashboard banner.
              </p>
            </div>
            <Switch
              checked={githubSyncFailureEnabled}
              onCheckedChange={val =>
                updatePrefs({ data: { githubSyncFailureAlertEmails: val } as any })
              }
              disabled={savingPrefs || me === undefined}
            />
          </div>
          {!githubSyncFailureEnabled && (
            <p className="text-xs text-amber-400 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              You will not receive escalation emails when GitHub sync fails repeatedly.
            </p>
          )}

          <div className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/5 px-4 py-3">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">Weekly delivery health digest</p>
              <p className="text-xs text-muted-foreground">
                Receive a weekly summary every Monday with delivery success rates, failure counts, and auto-paused schedules across all merchants.
              </p>
            </div>
            <Switch
              checked={weeklyDigestEnabled}
              onCheckedChange={val =>
                updatePrefs({ data: { weeklyDeliveryDigestEmails: val } })
              }
              disabled={savingPrefs || me === undefined}
            />
          </div>
          {!weeklyDigestEnabled && (
            <p className="text-xs text-amber-400 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              You will not receive the weekly report delivery health digest.
            </p>
          )}
        </CardContent>
      </Card>

      {/* GitHub Sync */}
      <Card id="github-sync" className="border-border/50 scroll-mt-6">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-base">GitHub Sync</CardTitle>
          </div>
          <CardDescription className="text-sm">
            Control whether the automated GitHub repository sync job is allowed to run, and what
            cron schedule it follows. The sync script reads these settings each time it is invoked.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!githubSyncLoading && !currentGithubSyncEnabled && (
            <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-md px-3 py-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>GitHub sync is <strong>disabled</strong> — the sync script will skip automatically.</span>
            </div>
          )}
          {!githubSyncLoading && currentGithubSyncEnabled && (
            <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-md px-3 py-2">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              <span>GitHub sync is <strong>enabled</strong> — the sync script will run on schedule.</span>
            </div>
          )}

          {githubSyncStatus && (
            <div className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-xs ${githubSyncIsRunning ? "border-violet-500/20 bg-violet-500/5" : githubSyncStatus.status === "success" ? "border-emerald-500/20 bg-emerald-500/5" : githubSyncStatus.status === "failure" ? "border-red-500/20 bg-red-500/5" : "border-border/50 bg-muted/5"}`}>
              {githubSyncIsRunning && <RefreshCw className="w-4 h-4 shrink-0 text-violet-400 animate-spin" />}
              {!githubSyncIsRunning && githubSyncStatus.status === "success" && <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />}
              {!githubSyncIsRunning && githubSyncStatus.status === "failure" && <XCircle className="w-4 h-4 shrink-0 text-red-400" />}
              {!githubSyncIsRunning && githubSyncStatus.status === "never" && <History className="w-4 h-4 shrink-0 text-muted-foreground" />}
              <div className="flex flex-col gap-0.5">
                <span className={`font-medium ${githubSyncIsRunning ? "text-violet-400" : githubSyncStatus.status === "success" ? "text-emerald-400" : githubSyncStatus.status === "failure" ? "text-red-400" : "text-muted-foreground"}`}>
                  {githubSyncIsRunning ? "Sync in progress…" : `Last sync: ${githubSyncStatus.status === "never" ? "never run" : githubSyncStatus.status}`}
                </span>
                {!githubSyncIsRunning && githubSyncStatus.syncedAt && (
                  <span className="text-muted-foreground">
                    {formatTimeAgo(githubSyncStatus.syncedAt)} — {new Date(githubSyncStatus.syncedAt).toLocaleString()}
                    {githubSyncStatus.repo && <span className="ml-1 opacity-60">({githubSyncStatus.repo})</span>}
                  </span>
                )}
                {!githubSyncIsRunning && githubSyncStatus.status === "failure" && githubSyncStatus.errorMessage && (
                  <span className="text-red-300 mt-0.5">{githubSyncStatus.errorMessage}</span>
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                className="ml-auto shrink-0"
                onClick={() => setGithubSyncConfirmOpen(true)}
                disabled={githubSyncIsRunning || runningGithubSync}
              >
                <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${githubSyncIsRunning ? "animate-spin" : ""}`} />
                {githubSyncIsRunning ? "Syncing…" : "Sync now"}
              </Button>
            </div>
          )}

          {/* Sync History Log */}
          {githubSyncHistory && githubSyncHistory.entries.length > 0 && (
            <div className="rounded-lg border border-border/50 bg-muted/5 overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-border/40 bg-muted/10">
                <History className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="text-xs font-medium text-muted-foreground">Sync history (last {githubSyncHistory.entries.length} runs)</span>
              </div>
              <div className="max-h-56 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/30 bg-muted/5">
                      <th className="px-3 py-1.5 text-left font-medium text-muted-foreground w-5"></th>
                      <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">Timestamp</th>
                      <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">Repo</th>
                      <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/20">
                    {githubSyncHistory.entries.map((entry, i) => (
                      <tr
                        key={entry.id ?? i}
                        className={`hover:bg-muted/10 transition-colors ${entry.status === "failure" ? "cursor-pointer" : ""}`}
                        onClick={() => { if (entry.status === "failure") setSelectedSyncRun(entry); }}
                      >
                        <td className="px-3 py-2">
                          {entry.status === "success"
                            ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                            : <XCircle className="w-3.5 h-3.5 text-red-400" />}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                          {new Date(entry.syncedAt).toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground font-mono truncate max-w-[140px]">
                          {entry.repo ?? "—"}
                        </td>
                        <td className="px-3 py-2">
                          {entry.status === "success" ? (
                            <span className="text-emerald-400 font-medium">success</span>
                          ) : (
                            <span className="text-red-400 font-medium underline decoration-dotted" title={entry.errorMessage ?? ""}>
                              failure{entry.errorMessage ? ` — ${entry.errorMessage.slice(0, 60)}${entry.errorMessage.length > 60 ? "…" : ""}` : ""}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {githubSyncHistory && githubSyncHistory.entries.length === 0 && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground rounded-lg border border-border/50 bg-muted/5 px-3 py-2.5">
              <History className="w-3.5 h-3.5 shrink-0" />
              <span>No sync runs recorded yet. History is written after each sync script execution.</span>
            </div>
          )}

          <div className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/5 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-foreground">Enable automatic sync</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                When disabled the sync script exits immediately without pushing to GitHub.
              </p>
            </div>
            <Switch
              checked={githubSyncEnabled}
              onCheckedChange={val => setGithubSyncEnabled(val)}
              disabled={githubSyncLoading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="github-sync-schedule" className="text-sm">Cron schedule</Label>
            <Input
              id="github-sync-schedule"
              type="text"
              placeholder="0 2 * * *"
              value={githubSyncSchedule}
              onChange={e => setGithubSyncSchedule(e.target.value)}
              disabled={githubSyncLoading || !githubSyncEnabled}
              className="max-w-xs font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Standard 5-part cron expression. Examples:{" "}
              <button
                type="button"
                className="text-violet-400 hover:underline"
                onClick={() => setGithubSyncSchedule("0 2 * * *")}
              >
                0 2 * * * (daily 02:00)
              </button>
              {" · "}
              <button
                type="button"
                className="text-violet-400 hover:underline"
                onClick={() => setGithubSyncSchedule("0 */6 * * *")}
              >
                0 */6 * * * (every 6h)
              </button>
              {" · "}
              <button
                type="button"
                className="text-violet-400 hover:underline"
                onClick={() => setGithubSyncSchedule("0 2 * * 1")}
              >
                0 2 * * 1 (weekly Mon)
              </button>
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="github-sync-failure-threshold" className="text-sm">Failure alert threshold</Label>
              <Input
                id="github-sync-failure-threshold"
                type="number"
                min={1}
                step={1}
                value={githubSyncFailureThreshold}
                onChange={e => setGithubSyncFailureThreshold(parseInt(e.target.value, 10) || 0)}
                disabled={githubSyncLoading}
                className="max-w-xs"
              />
              <p className="text-xs text-muted-foreground">
                Consecutive failures needed before the dashboard banner and the first escalation email fire.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="github-sync-renotify-interval" className="text-sm">Re-notify cadence</Label>
              <Input
                id="github-sync-renotify-interval"
                type="number"
                min={1}
                step={1}
                value={githubSyncRenotifyInterval}
                onChange={e => setGithubSyncRenotifyInterval(parseInt(e.target.value, 10) || 0)}
                disabled={githubSyncLoading}
                className="max-w-xs"
              />
              <p className="text-xs text-muted-foreground">
                Once escalated, only re-send the failure email every N additional consecutive failures.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => saveGithubSyncConfig({
                data: {
                  enabled: githubSyncEnabled,
                  schedule: githubSyncSchedule,
                  failureThreshold: githubSyncFailureThreshold,
                  renotifyInterval: githubSyncRenotifyInterval,
                },
              })}
              disabled={savingGithubSyncConfig || githubSyncLoading || githubSyncUnchanged || !githubSyncThresholdsValid}
            >
              <Save className="w-3.5 h-3.5 mr-1.5" />
              {savingGithubSyncConfig ? "Saving…" : "Save"}
            </Button>
            {!githubSyncUnchanged && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setGithubSyncEnabled(currentGithubSyncEnabled);
                  setGithubSyncSchedule(currentGithubSyncSchedule);
                  setGithubSyncFailureThreshold(currentGithubSyncFailureThreshold);
                  setGithubSyncRenotifyInterval(currentGithubSyncRenotifyInterval);
                }}
                disabled={savingGithubSyncConfig}
              >
                Cancel
              </Button>
            )}
            {!githubSyncThresholdsValid && (
              <span className="text-xs text-red-400">Threshold and cadence must be at least 1.</span>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!selectedSyncRun} onOpenChange={open => { if (!open) setSelectedSyncRun(null); }}>
        <DialogContent className="sm:max-w-2xl max-h-[calc(100dvh-4rem)] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <XCircle className="w-4 h-4 text-red-400" />
              Failed Sync Run{selectedSyncRun?.syncedAt ? ` — ${new Date(selectedSyncRun.syncedAt).toLocaleString()}` : ""}
            </DialogTitle>
          </DialogHeader>
          {selectedSyncRun && (
            <div className="space-y-4 text-sm overflow-y-auto">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground mb-1">Repository</p>
                  <p className="text-xs font-mono">{selectedSyncRun.repo ?? "—"}</p>
                </div>
                <div className="rounded-lg bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground mb-1">Status</p>
                  <p className="text-xs font-medium text-red-400">failure</p>
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1.5">Error detail</p>
                <pre className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-300 whitespace-pre-wrap break-all">
                  {selectedSyncRun.errorMessage || "No error detail was captured for this run."}
                </pre>
              </div>

              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1.5">Full log</p>
                {!selectedSyncRun.hasLog && (
                  <p className="text-xs text-muted-foreground rounded-lg border border-border/50 bg-muted/5 px-3 py-2.5">
                    No full log was captured for this run.
                  </p>
                )}
                {selectedSyncRun.hasLog && selectedSyncRunLogLoading && (
                  <p className="text-xs text-muted-foreground rounded-lg border border-border/50 bg-muted/5 px-3 py-2.5">
                    Loading log…
                  </p>
                )}
                {selectedSyncRun.hasLog && !selectedSyncRunLogLoading && selectedSyncRunLogError && (
                  <p className="text-xs text-muted-foreground rounded-lg border border-border/50 bg-muted/5 px-3 py-2.5">
                    Could not load the full log for this run.
                  </p>
                )}
                {selectedSyncRun.hasLog && !selectedSyncRunLogLoading && !selectedSyncRunLogError && selectedSyncRunLog && (
                  <pre className="rounded-lg border border-border/50 bg-black/30 p-3 text-[11px] font-mono text-muted-foreground whitespace-pre-wrap break-all max-h-64 overflow-y-auto">
                    {selectedSyncRunLog.log}
                  </pre>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={githubSyncConfirmOpen} onOpenChange={setGithubSyncConfirmOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-400" />
              Force-push to GitHub?
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              This will force-push this environment's code to the{" "}
              <span className="font-mono text-xs">main</span> branch of{" "}
              <span className="font-medium">{githubSyncDivergence?.repo ?? "the configured repository"}</span>,
              overwriting whatever is currently on GitHub. Any commits on the remote that aren't in this environment will be permanently discarded.
            </p>

            {githubSyncDivergenceLoading && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground rounded-md border border-border/50 bg-muted/5 px-3 py-2">
                <RefreshCw className="w-3.5 h-3.5 shrink-0 animate-spin" />
                Checking whether the remote has diverged…
              </div>
            )}

            {!githubSyncDivergenceLoading && githubSyncDivergence?.checked && githubSyncDivergence.diverged && (
              <div className="flex items-start gap-2 text-xs text-red-300 rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2">
                <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-red-400" />
                <span>
                  The remote has <strong>{githubSyncDivergence.remoteAheadBy}</strong> commit
                  {githubSyncDivergence.remoteAheadBy === 1 ? "" : "s"} not present here — likely pushed directly on GitHub.
                  Forcing this sync will permanently overwrite {githubSyncDivergence.remoteAheadBy === 1 ? "it" : "them"}.
                </span>
              </div>
            )}

            {!githubSyncDivergenceLoading && githubSyncDivergence?.checked && !githubSyncDivergence.diverged && (
              <div className="flex items-center gap-2 text-xs text-emerald-400 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                {githubSyncDivergence.reason ?? "The remote has no commits that aren't already reflected here."}
              </div>
            )}

            {!githubSyncDivergenceLoading && githubSyncDivergence && !githubSyncDivergence.checked && (
              <div className="flex items-start gap-2 text-xs text-amber-400 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>Couldn't verify whether the remote has diverged ({githubSyncDivergence.reason ?? "check failed"}) — proceed with caution.</span>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setGithubSyncConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" size="sm" onClick={handleConfirmGithubSync}>
              Force push anyway
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Quiet Hours Flush Interval */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-base">Quiet Hours Flush Interval</CardTitle>
          </div>
          <CardDescription className="text-sm">
            How often the quiet hours email sweeper scans for messages ready to deliver.
            Lower values reduce delivery latency after quiet hours end; higher values reduce DB load.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="qh-flush-interval" className="text-sm">Flush interval (seconds)</Label>
            <Input
              id="qh-flush-interval"
              type="number"
              min={10}
              max={86400}
              step={1}
              value={quietHoursFlushInterval}
              onChange={e => setQuietHoursFlushInterval(parseInt(e.target.value, 10) || 60)}
              disabled={quietHoursFlushLoading}
              className="max-w-xs"
            />
            <p className="text-xs text-muted-foreground">
              Allowed: 10–86 400 s (10 s to 24 h). Default: 60 s. The new value takes
              effect at the next scheduled tick — no restart required.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => saveQuietHoursFlush({ data: { intervalSeconds: quietHoursFlushInterval } })}
              disabled={savingQuietHoursFlush || quietHoursFlushLoading || quietHoursFlushUnchanged}
            >
              <Save className="w-3.5 h-3.5 mr-1.5" />
              {savingQuietHoursFlush ? "Saving…" : "Save"}
            </Button>
            {!quietHoursFlushUnchanged && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setQuietHoursFlushInterval(currentQuietHoursFlushInterval)}
                disabled={savingQuietHoursFlush}
              >
                Cancel
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── EKQR / UPI Gateway — moved to Payment Gateways hub ──────── */}
      <Card className="border-teal-500/20 bg-teal-500/5">
        <CardContent className="p-4 flex items-center gap-4">
          <div className="p-2 rounded-lg bg-teal-500/10 border border-teal-500/20 shrink-0">
            <Zap className="w-4 h-4 text-teal-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">UPI Gateway</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Configuration has moved to the Payment Gateways hub — API key, mode, webhook secret, connection test and sandbox/live toggle are all available there.
            </p>
          </div>
          <a href="/admin/payment-gateways">
            <Button size="sm" variant="outline" className="shrink-0 border-teal-500/30 text-teal-400 hover:bg-teal-500/10">
              Open Payment Gateways
            </Button>
          </a>
        </CardContent>
      </Card>


    </div>
  );
}
