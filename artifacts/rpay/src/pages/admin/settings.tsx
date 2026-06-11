import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Settings, Mail, Save, CheckCircle2, AlertCircle, Send, Calendar, Bell, Wifi, WifiOff, Trash2, Server, Eye, EyeOff, History, XCircle, HardDrive, RotateCcw, ShieldAlert } from "lucide-react";
import { TestEmailHistoryPanel } from "@/components/test-email-history-panel";
import { toast } from "sonner";
import { getToken } from "@/lib/auth";
import { getApiErrorMessage } from "@/lib/utils";
import { useGetMe, useUpdateMyPreferences, getGetMeQueryKey, getListAdminAuditLogsQueryKey, useRunStorageCleanup, useListStorageCleanupRuns, getListStorageCleanupRunsQueryKey, useClearTestEmailHistory, type AdminAuditLog, type StorageCleanupRun } from "@workspace/api-client-react";

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

export default function AdminSettings() {
  const qc = useQueryClient();
  const [financeEmail, setFinanceEmail] = useState<string>("");
  const [testEmailTo, setTestEmailTo] = useState<string>("");
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>("daily");
  const [initialized, setInitialized] = useState(false);
  const [retentionDays, setRetentionDays] = useState<number>(30);
  const [retentionInitialized, setRetentionInitialized] = useState(false);

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

  const { mutate: updatePrefs, isPending: savingPrefs } = useUpdateMyPreferences({
    mutation: {
      onSuccess: (updated) => {
        toast.success("Notification preferences saved");
        qc.setQueryData(getGetMeQueryKey(), updated);
      },
      onError: (err: unknown) => toast.error(getApiErrorMessage(err, "Failed to save notification preferences")),
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
    onError: (err: unknown) => toast.error(getApiErrorMessage(err, "Failed to save SMTP settings")),
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
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["test-email-history"] });
      qc.invalidateQueries({ queryKey: ["test-email-history-count"] });
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
    onError: (err: unknown) => toast.error(getApiErrorMessage(err, "Failed to save email settings")),
  });

  const [testHistoryFilter, setTestHistoryFilter] = useState<"all" | "success" | "failed">("all");
  const [smtpHistoryFilter, setSmtpHistoryFilter] = useState<"all" | "success" | "failed">("all");
  const [testHistoryLimit, setTestHistoryLimit] = useState(10);

  const testHistoryQueryUrl = testHistoryFilter === "all"
    ? `/audit-logs?action=test_email_sent&limit=${testHistoryLimit}`
    : `/audit-logs?action=test_email_sent&detailsSuccess=${testHistoryFilter === "success"}&limit=${testHistoryLimit}`;

  const { data: testEmailHistory, isLoading: historyLoading } = useQuery({
    queryKey: ["test-email-history", testHistoryFilter, testHistoryLimit],
    queryFn: () => apiGet(testHistoryQueryUrl),
    staleTime: 0,
  });

  interface FinanceEmailLogEntry {
    id: number;
    runId: number;
    runExists: boolean;
    emailType: string;
    recipients: string;
    status: string;
    errorMessage: string | null;
    sentAt: string;
  }

  const { data: financeEmailLogs, isLoading: financeLogsLoading } = useQuery<{ data: FinanceEmailLogEntry[] }>({
    queryKey: ["/api/settings/finance_report_email/logs"],
    queryFn: () => apiGet("/settings/finance_report_email/logs"),
    staleTime: 30_000,
  });

  const { data: testEmailSuccessCount } = useQuery({
    queryKey: ["test-email-history-count", "success"],
    queryFn: () => apiGet(`/audit-logs?action=test_email_sent&detailsSuccess=true&limit=1`),
    staleTime: 30_000,
  });

  const { data: testEmailFailedCount } = useQuery({
    queryKey: ["test-email-history-count", "failed"],
    queryFn: () => apiGet(`/audit-logs?action=test_email_sent&detailsSuccess=false&limit=1`),
    staleTime: 30_000,
  });

  const testHistorySuccessTotal: number = testEmailSuccessCount?.total ?? 0;
  const testHistoryFailedTotal: number = testEmailFailedCount?.total ?? 0;

  function handleTestHistoryFilter(f: "all" | "success" | "failed") {
    setTestHistoryFilter(f);
    setTestHistoryLimit(10);
  }

  const [clearHistoryConfirm, setClearHistoryConfirm] = useState(false);

  const { mutate: clearTestEmailHistory, isPending: clearingHistory } = useClearTestEmailHistory({
    mutation: {
      onSuccess: (res) => {
        toast.success(`Cleared ${res.deleted} test email ${res.deleted === 1 ? "entry" : "entries"}`);
        setClearHistoryConfirm(false);
        qc.invalidateQueries({ queryKey: ["test-email-history"] });
        qc.invalidateQueries({ queryKey: ["test-email-history-count"] });
      },
      onError: (err: unknown) => toast.error(getApiErrorMessage(err, "Failed to clear history")),
    },
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
    mutationFn: (recipientOverride?: string) => {
      const to = recipientOverride ?? testEmailTo.trim();
      return apiPost("/settings/test-email", to ? { to } : undefined);
    },
    onSuccess: (res: { to: string }) => toast.success(`Test email sent to ${res.to} — check your inbox`),
    onError: (err: unknown) => toast.error(getApiErrorMessage(err, "Test email failed")),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["test-email-history"] });
      qc.invalidateQueries({ queryKey: ["test-email-history-count"] });
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

  const [retryingLogId, setRetryingLogId] = useState<number | null>(null);

  const { mutate: retryFinanceEmail } = useMutation({
    mutationFn: (logId: number) => {
      setRetryingLogId(logId);
      return apiPost(`/settings/finance_report_email/logs/${logId}/resend`);
    },
    onSuccess: (res: { to: string }) => toast.success(`Email re-sent to ${res.to}`),
    onError: (err: unknown) => toast.error(getApiErrorMessage(err, "Failed to resend email")),
    onSettled: () => {
      setRetryingLogId(null);
      qc.invalidateQueries({ queryKey: ["/api/settings/finance_report_email/logs"] });
    },
  });

  const { mutate: saveSchedule, isPending: savingSchedule } = useMutation({
    mutationFn: () => apiPut("/settings/reconciliation_schedule", { value: scheduleMode }),
    onSuccess: () => {
      toast.success("Reconciliation schedule saved");
      qc.invalidateQueries({ queryKey: ["/api/settings"] });
    },
    onError: (err: unknown) => toast.error(getApiErrorMessage(err, "Failed to save reconciliation schedule")),
  });

  const { data: qrCleanupData, isLoading: qrCleanupLoading } = useQuery<{ retentionDays: number }>({
    queryKey: ["/api/system-config/qr-cleanup"],
    queryFn: () => apiGet("/system-config/qr-cleanup"),
    onSuccess: (d: { retentionDays: number }) => {
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
    onError: (err: unknown) => toast.error(getApiErrorMessage(err, "Failed to save QR cleanup retention")),
  });

  const [sigAlertThreshold, setSigAlertThreshold] = useState<number>(10);
  const [sigAlertWindowHours, setSigAlertWindowHours] = useState<number>(1);
  const [sigAlertRateLimitHours, setSigAlertRateLimitHours] = useState<number>(1);
  const [sigAlertInitialized, setSigAlertInitialized] = useState(false);

  const [storageScheduleEnabled, setStorageScheduleEnabled] = useState<boolean>(true);
  const [storageScheduleHour, setStorageScheduleHour] = useState<number>(3);
  const [storageScheduleInitialized, setStorageScheduleInitialized] = useState(false);

  const { data: sigAlertData, isLoading: sigAlertLoading } = useQuery<{ threshold: number; windowHours: number; rateLimitHours: number }>({
    queryKey: ["/api/system-config/signature-failure-alert"],
    queryFn: () => apiGet("/system-config/signature-failure-alert"),
    onSuccess: (d: { threshold: number; windowHours: number; rateLimitHours: number }) => {
      if (!sigAlertInitialized) {
        setSigAlertThreshold(d.threshold);
        setSigAlertWindowHours(d.windowHours);
        setSigAlertRateLimitHours(d.rateLimitHours);
        setSigAlertInitialized(true);
      }
    },
  } as any);

  const currentSigAlertThreshold = sigAlertData?.threshold ?? 10;
  const currentSigAlertWindowHours = sigAlertData?.windowHours ?? 1;
  const currentSigAlertRateLimitHours = sigAlertData?.rateLimitHours ?? 1;
  const sigAlertUnchanged =
    sigAlertThreshold === currentSigAlertThreshold &&
    sigAlertWindowHours === currentSigAlertWindowHours &&
    sigAlertRateLimitHours === currentSigAlertRateLimitHours;

  const { mutate: saveSigAlert, isPending: savingSigAlert } = useMutation({
    mutationFn: () => apiPut("/system-config/signature-failure-alert", {
      threshold: sigAlertThreshold,
      windowHours: sigAlertWindowHours,
      rateLimitHours: sigAlertRateLimitHours,
    }),
    onSuccess: () => {
      toast.success("Signature failure alert settings saved");
      qc.invalidateQueries({ queryKey: ["/api/system-config/signature-failure-alert"] });
    },
    onError: (err: unknown) => toast.error(getApiErrorMessage(err, "Failed to save signature failure alert settings")),
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

  const [cleanupResult, setCleanupResult] = useState<{ totalScanned: number; deleted: number; errors: number } | null>(null);

  const CLEANUP_RUNS_PARAMS = { limit: 20 } as const;
  const { data: cleanupRunsData, refetch: refetchCleanupRuns } = useListStorageCleanupRuns(CLEANUP_RUNS_PARAMS);
  const cleanupRuns: StorageCleanupRun[] = cleanupRunsData?.data ?? [];

  const { mutate: runCleanup, isPending: runningCleanup } = useRunStorageCleanup({
    mutation: {
      onSuccess: (result) => {
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

  const testEmailTrimmed = testEmailTo.trim();
  const testEmailInvalid = testEmailTrimmed.length > 0 && !EMAIL_REGEX.test(testEmailTrimmed);

  const currentEmail = data?.finance_report_email ?? null;
  const emailUnchanged = financeEmail === (currentEmail ?? "");

  const currentSchedule = (() => {
    const raw = data?.reconciliation_schedule;
    return raw === "weekly" || raw === "off" ? raw : "daily";
  })();
  const scheduleUnchanged = scheduleMode === currentSchedule;

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

            {/* Test-email send history */}
            <TestEmailHistoryPanel
              data={(() => {
                const all: AdminAuditLog[] = testEmailHistory?.data ?? [];
                return all.filter((row: AdminAuditLog) => {
                  if (smtpHistoryFilter === "all") return true;
                  let parsed: { success?: boolean } = {};
                  try { parsed = JSON.parse(row.details ?? "{}"); } catch {}
                  return smtpHistoryFilter === "success"
                    ? parsed.success === true
                    : parsed.success === false;
                });
              })()}
              isLoading={historyLoading}
              filter={smtpHistoryFilter}
              onFilterChange={setSmtpHistoryFilter}
              onClear={() => clearTestEmailHistory()}
              clearing={clearingHistory}
              clearConfirm={clearHistoryConfirm}
              onClearConfirmChange={setClearHistoryConfirm}
            />
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
                onClick={() => sendTestEmail(undefined)}
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
          <TestEmailHistoryPanel
            data={testEmailHistory?.data ?? []}
            isLoading={historyLoading}
            filter={testHistoryFilter}
            onFilterChange={handleTestHistoryFilter}
            total={testEmailHistory?.total}
            onLoadMore={() => setTestHistoryLimit(l => l + 10)}
            successCount={testHistorySuccessTotal}
            failedCount={testHistoryFailedTotal}
            onRetry={(recipient) => {
              setTestEmailTo(recipient);
              sendTestEmail(recipient);
            }}
            retrying={sendingTest}
            onClear={() => clearTestEmailHistory()}
            clearing={clearingHistory}
            clearConfirm={clearHistoryConfirm}
            onClearConfirmChange={setClearHistoryConfirm}
          />

          {/* Finance Report Email Log */}
          <div className="border-t border-border/50 pt-4 space-y-3">
            <div className="flex items-center gap-1.5">
              <History className="w-3.5 h-3.5 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">Finance Report Email Log</p>
            </div>
            <p className="text-xs text-muted-foreground">
              Last 10 finance report emails sent — real reconciliation runs and sample sends.
            </p>

            {financeLogsLoading && (
              <p className="text-xs text-muted-foreground">Loading…</p>
            )}

            {!financeLogsLoading && (() => {
              const logs = financeEmailLogs?.data ?? [];

              if (logs.length === 0) {
                return (
                  <p className="text-xs text-muted-foreground italic">
                    No finance report emails have been sent yet.
                  </p>
                );
              }

              return (
                <div className="space-y-1.5">
                  {logs.map((entry: FinanceEmailLogEntry) => {
                    const success = entry.status === "sent";
                    const typeLabel = entry.emailType
                      .replace(/_/g, " ")
                      .replace(/\b\w/g, c => c.toUpperCase());
                    const recipientList = entry.recipients
                      .split(",")
                      .map((r: string) => r.trim())
                      .filter(Boolean);
                    const recipientLabel = recipientList.length > 1
                      ? `${recipientList[0]} +${recipientList.length - 1} more`
                      : recipientList[0] ?? entry.recipients;

                    return (
                      <div
                        key={entry.id}
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
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={`font-medium ${success ? "text-emerald-400" : "text-red-400"}`}>
                              {success ? "Sent" : "Failed"}
                            </span>
                            <span className="text-muted-foreground">·</span>
                            <span className="text-foreground/80">{typeLabel}</span>
                            {entry.runId > 0 && (
                              <>
                                <span className="text-muted-foreground">·</span>
                                {entry.runExists ? (
                                  <Link
                                    to={`/admin/reconciliation?run=${entry.runId}`}
                                    className="text-violet-400 hover:text-violet-300 hover:underline transition-colors"
                                    title={`View reconciliation run #${entry.runId}`}
                                  >
                                    Run #{entry.runId}
                                  </Link>
                                ) : (
                                  <span className="text-muted-foreground">Run #{entry.runId}</span>
                                )}
                              </>
                            )}
                            <span className="text-muted-foreground">·</span>
                            <span className="text-muted-foreground truncate max-w-[200px]" title={entry.recipients}>
                              {recipientLabel}
                            </span>
                          </div>
                          {!success && entry.errorMessage && (
                            <p className="text-muted-foreground mt-0.5 truncate max-w-xs" title={entry.errorMessage}>
                              {entry.errorMessage}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {!success && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 text-xs border-red-500/30 hover:border-red-400/60 hover:bg-red-500/10 text-red-400 hover:text-red-300"
                              disabled={retryingLogId === entry.id}
                              onClick={() => retryFinanceEmail(entry.id)}
                            >
                              <RotateCcw className={`w-3 h-3 mr-1 ${retryingLogId === entry.id ? "animate-spin" : ""}`} />
                              {retryingLogId === entry.id ? "Sending…" : "Retry"}
                            </Button>
                          )}
                          <time
                            dateTime={entry.sentAt}
                            className="text-muted-foreground tabular-nums"
                            title={new Date(entry.sentAt).toLocaleString()}
                          >
                            {new Date(entry.sentAt).toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </time>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
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
        </CardContent>
      </Card>

      {/* Storage Cleanup */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-base">Storage Cleanup</CardTitle>
          </div>
          <CardDescription className="text-sm">
            Remove orphaned uploaded files that were never linked to any merchant or provider logo.
            These accumulate when upload sessions are abandoned before the file is confirmed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            The cleanup job scans all tracked upload records, identifies any whose storage path
            is not in active use, deletes them from object storage, and removes the corresponding
            database rows. It is safe to run at any time.
          </p>

          {/* Auto-schedule */}
          <div className="border border-border/50 rounded-lg p-4 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <p className="text-sm font-medium text-foreground">Automatic nightly cleanup</p>
                <p className="text-xs text-muted-foreground">
                  Run the orphan cleanup job automatically every night at the configured hour.
                </p>
              </div>
              <Switch
                checked={storageScheduleEnabled}
                onCheckedChange={setStorageScheduleEnabled}
                disabled={storageConfigLoading}
              />
            </div>

            {!storageConfigLoading && currentStorageEnabled && (
              <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-md px-3 py-2">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>Auto-cleanup runs nightly at <strong>{String(currentStorageHour).padStart(2, "0")}:00</strong> server time.</span>
              </div>
            )}
            {!storageConfigLoading && !currentStorageEnabled && (
              <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-md px-3 py-2">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>Auto-cleanup is <strong>disabled</strong>. Orphaned files will only be removed by running cleanup manually.</span>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="storage-cleanup-hour" className="text-sm">Run at hour (0–23, server time)</Label>
              <div className="flex items-center gap-3">
                <Input
                  id="storage-cleanup-hour"
                  type="number"
                  min={0}
                  max={23}
                  value={storageScheduleHour}
                  onChange={e => {
                    const v = parseInt(e.target.value);
                    if (!isNaN(v)) setStorageScheduleHour(Math.max(0, Math.min(23, v)));
                  }}
                  disabled={storageConfigLoading}
                  className="w-24"
                />
                <span className="text-sm text-muted-foreground">
                  {String(storageScheduleHour).padStart(2, "0")}:00 server time
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={() => saveStorageSchedule()}
                disabled={savingStorageSchedule || storageConfigLoading || storageScheduleUnchanged}
              >
                <Save className="w-3.5 h-3.5 mr-1.5" />
                {savingStorageSchedule ? "Saving…" : "Save schedule"}
              </Button>
              {!storageScheduleUnchanged && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setStorageScheduleEnabled(currentStorageEnabled);
                    setStorageScheduleHour(currentStorageHour);
                  }}
                  disabled={savingStorageSchedule}
                >
                  Cancel
                </Button>
              )}
            </div>
          </div>

          {/* Manual run */}
          <div className="border-t border-border/50 pt-4 space-y-3">
            <div>
              <p className="text-sm font-medium text-foreground mb-0.5">Run immediately</p>
              <p className="text-xs text-muted-foreground">Trigger a cleanup run right now without waiting for the next scheduled time.</p>
            </div>

            {cleanupResult && (
              <div className={`flex items-start gap-2 text-xs rounded-md px-3 py-2 border ${
                cleanupResult.errors > 0
                  ? "text-amber-400 bg-amber-500/10 border-amber-500/20"
                  : "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
              }`}>
                {cleanupResult.errors > 0
                  ? <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  : <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
                <span>
                  Scanned <strong>{cleanupResult.totalScanned}</strong> record{cleanupResult.totalScanned !== 1 ? "s" : ""} —{" "}
                  deleted <strong>{cleanupResult.deleted}</strong>{cleanupResult.deleted !== 1 ? "" : " file"}
                  {cleanupResult.errors > 0 && (
                    <>, <span className="text-red-400">{cleanupResult.errors} failed</span></>
                  )}
                  {cleanupResult.deleted === 0 && cleanupResult.errors === 0 && " — storage is clean"}
                  .
                </span>
              </div>
            )}

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => { setCleanupResult(null); runCleanup(); }}
                disabled={runningCleanup}
              >
                <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                {runningCleanup ? "Running…" : "Run cleanup now"}
              </Button>
            </div>
          </div>

          {/* Run history */}
          {cleanupRuns.length > 0 && (
            <div className="space-y-2 pt-1">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <History className="w-3.5 h-3.5" />
                <span>Past runs</span>
              </div>
              <div className="rounded-md border border-border/50 overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/50 bg-muted/20">
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">Run at</th>
                      <th className="px-3 py-2 text-right font-medium text-muted-foreground">Scanned</th>
                      <th className="px-3 py-2 text-right font-medium text-muted-foreground">Deleted</th>
                      <th className="px-3 py-2 text-right font-medium text-muted-foreground">Errors</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cleanupRuns.map((run, idx) => (
                      <tr
                        key={run.id}
                        className={`border-b border-border/30 last:border-0 ${idx % 2 === 0 ? "" : "bg-muted/10"}`}
                      >
                        <td className="px-3 py-2 tabular-nums text-muted-foreground whitespace-nowrap">
                          {new Date(run.runAt).toLocaleString(undefined, {
                            month: "short", day: "numeric", year: "numeric",
                            hour: "2-digit", minute: "2-digit",
                          })}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{run.totalScanned}</td>
                        <td className={`px-3 py-2 text-right tabular-nums font-medium ${run.deleted > 0 ? "text-emerald-400" : "text-muted-foreground"}`}>
                          {run.deleted}
                        </td>
                        <td className={`px-3 py-2 text-right tabular-nums ${run.errors > 0 ? "text-red-400 font-medium" : "text-muted-foreground"}`}>
                          {run.errors}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground truncate max-w-[140px]" title={run.triggeredBy}>
                          {run.triggeredBy}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Signature Failure Alert */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-base">Signature Failure Alert</CardTitle>
          </div>
          <CardDescription className="text-sm">
            Configure when admins receive email alerts for signature verification failures.
            Failures above the threshold within the detection window trigger an alert, rate-limited to avoid flooding.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="sig-alert-threshold" className="text-sm">Alert threshold</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="sig-alert-threshold"
                  type="number"
                  min={1}
                  max={10000}
                  value={sigAlertThreshold}
                  onChange={e => {
                    const v = parseInt(e.target.value);
                    if (!isNaN(v)) setSigAlertThreshold(Math.max(1, Math.min(10000, v)));
                  }}
                  disabled={sigAlertLoading}
                  className="w-28"
                />
                <span className="text-sm text-muted-foreground">failures</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Alert fires when failures exceed this number.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sig-alert-window" className="text-sm">Detection window</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="sig-alert-window"
                  type="number"
                  min={0.25}
                  max={72}
                  step={0.25}
                  value={sigAlertWindowHours}
                  onChange={e => {
                    const v = parseFloat(e.target.value);
                    if (!isNaN(v)) setSigAlertWindowHours(Math.max(0.25, Math.min(72, v)));
                  }}
                  disabled={sigAlertLoading}
                  className="w-24"
                />
                <span className="text-sm text-muted-foreground">hours</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Rolling window over which failures are counted.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sig-alert-rate-limit" className="text-sm">Alert cooldown</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="sig-alert-rate-limit"
                  type="number"
                  min={0.25}
                  max={72}
                  step={0.25}
                  value={sigAlertRateLimitHours}
                  onChange={e => {
                    const v = parseFloat(e.target.value);
                    if (!isNaN(v)) setSigAlertRateLimitHours(Math.max(0.25, Math.min(72, v)));
                  }}
                  disabled={sigAlertLoading}
                  className="w-24"
                />
                <span className="text-sm text-muted-foreground">hours</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Minimum time between consecutive alert emails.
              </p>
            </div>
          </div>

          {!sigAlertLoading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 border border-border/50 rounded-md px-3 py-2">
              <ShieldAlert className="w-3.5 h-3.5 shrink-0 text-amber-400" />
              <span>
                An alert fires when more than <strong>{currentSigAlertThreshold}</strong> signature failure{currentSigAlertThreshold !== 1 ? "s" : ""} occur within{" "}
                <strong>{currentSigAlertWindowHours === 1 ? "1 hour" : `${currentSigAlertWindowHours} hours`}</strong>,
                at most once every <strong>{currentSigAlertRateLimitHours === 1 ? "hour" : `${currentSigAlertRateLimitHours} hours`}</strong>.
              </span>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => saveSigAlert()}
              disabled={savingSigAlert || sigAlertLoading || sigAlertUnchanged}
            >
              <Save className="w-3.5 h-3.5 mr-1.5" />
              {savingSigAlert ? "Saving…" : "Save"}
            </Button>
            {!sigAlertUnchanged && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSigAlertThreshold(currentSigAlertThreshold);
                  setSigAlertWindowHours(currentSigAlertWindowHours);
                  setSigAlertRateLimitHours(currentSigAlertRateLimitHours);
                }}
                disabled={savingSigAlert}
              >
                Cancel
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* My Notification Preferences */}
      <Card className="border-border/50">
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
                updatePrefs({ data: { signatureFailureAlertEmails: val } })
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
        </CardContent>
      </Card>
    </div>
  );
}
