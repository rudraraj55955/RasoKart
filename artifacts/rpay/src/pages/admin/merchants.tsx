import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { useUpload } from "@workspace/object-storage-web";
import {
  useListMerchants, useApproveMerchant, useRejectMerchant,
  useSuspendMerchant, useUnsuspendMerchant,
  useListPlans, useAssignMerchantPlan, useGetMerchantPlan, useGetMerchantPlanHistory,
  useUpgradeMerchantPlan, useDowngradeMerchantPlan, useSuspendMerchantPlan,
  useReinstateMerchantPlan, useRenewMerchantPlan, useBulkAssignMerchantPlan, useBulkUnassignMerchantPlan,
  useBulkApproveMerchants, useBulkSuspendMerchants, useBulkRejectMerchants,
  useUpdateMerchantBranding, useGetMerchantPlanUsageAdmin,
  useGetAdminMerchantCallbackSecret, useResetAdminMerchantCallbackSecret,
  useUpdateMerchantCallbackWindow,
  useScheduleMerchantPlanRenewal, useGetMerchant,
  useListMerchantCredentialEvents,
  useListCallbackLogs, useRetryCallback, useGetWebhookLogAttempts,
  useGetAdminMerchantWebhookConfig,
  useUpdateMerchantWebhookMaxRetries,
  useGetWebhookFailureAlertHistory,
  useGetMerchantsWebhookFailureCounts,
  useGetKycSummary, useListKycDocuments, useReviewKycDocument,
  getListMerchantsQueryKey,
  listMerchants,
  previewMerchantPlanEmail,
  type WebhookFailureAlertLogEntry,
} from "@workspace/api-client-react";
import { ExportCsvButton, downloadCsvFromUrl } from "@/components/ui/export-csv-button";
import { useQueryClient } from "@tanstack/react-query";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CheckCircle, XCircle, Search, CreditCard, Calendar, History, ShieldOff, ShieldCheck, TrendingUp, TrendingDown, PauseCircle, PlayCircle, RefreshCw, AlertTriangle, Paintbrush, Users, UserCheck, UserX, RotateCcw, Upload, Loader2, X, Info, KeyRound, Clock, Bell, BellOff, Activity, ExternalLink, ChevronDown, ChevronRight, CheckCircle2, Eye, Mail } from "lucide-react";
import { toast } from "sonner";
import { format, formatDistanceToNow, differenceInSeconds } from "date-fns";
import { getApiErrorMessage } from "@/lib/utils";
import { SECRET_WARN_DAYS, SECRET_ROTATION_OVERDUE_DAYS } from "@/lib/webhook-constants";

function MerchantWebhookAttemptTimeline({ logId, totalAttempts, status, nextRetryAt }: {
  logId: number;
  totalAttempts: number;
  status: string;
  nextRetryAt?: string | null;
}) {
  const { data, isLoading } = useGetWebhookLogAttempts(logId);
  const attempts = data?.data ?? [];

  if (isLoading) {
    return <div className="flex items-center gap-2 py-1"><div className="h-3 w-3 rounded-full bg-muted/50 animate-pulse" /><div className="h-3 w-40 rounded bg-muted/50 animate-pulse" /></div>;
  }
  if (attempts.length === 0) return null;

  const sorted = [...attempts].sort((a, b) => a.attemptNumber - b.attemptNumber);
  const isPendingRetry = status === "pending_retry";

  return (
    <TooltipProvider>
      <div className="flex items-start gap-0 flex-wrap">
        {sorted.map((attempt: any, idx: number) => {
          const isSuccess = attempt.httpStatus != null && attempt.httpStatus >= 200 && attempt.httpStatus < 300;
          const prev = sorted[idx - 1];
          const delaySeconds = prev ? differenceInSeconds(new Date(attempt.firedAt), new Date(prev.firedAt)) : null;
          return (
            <div key={attempt.id} className="flex items-center gap-1.5">
              {idx > 0 && delaySeconds != null && (
                <div className="flex items-center gap-1 mx-1">
                  <span className="text-muted-foreground/40 text-xs">→</span>
                  <span className="text-xs text-muted-foreground/60 font-mono">+{delaySeconds < 60 ? `${delaySeconds}s` : `${Math.round(delaySeconds / 60)}m`}</span>
                  <span className="text-muted-foreground/40 text-xs">→</span>
                </div>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className={`flex items-center gap-1.5 px-2 py-1 rounded border cursor-default text-xs ${isSuccess ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-400" : "bg-rose-500/10 border-rose-500/25 text-rose-400"}`}>
                    {isSuccess ? <CheckCircle2 className="w-3 h-3 shrink-0" /> : <XCircle className="w-3 h-3 shrink-0" />}
                    <span className="font-semibold">#{attempt.attemptNumber}</span>
                    {attempt.httpStatus != null && <span className="font-mono opacity-75">{attempt.httpStatus}</span>}
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs space-y-1">
                  <p className="font-semibold">Attempt {attempt.attemptNumber}</p>
                  <p className="text-muted-foreground">{format(new Date(attempt.firedAt), "MMM d, yyyy HH:mm:ss")}</p>
                  {attempt.httpStatus != null && <p>HTTP {attempt.httpStatus}</p>}
                </TooltipContent>
              </Tooltip>
            </div>
          );
        })}
        {isPendingRetry && nextRetryAt && (
          <div className="flex items-center gap-1 mx-1">
            <span className="text-muted-foreground/40 text-xs">→</span>
            <span className="text-xs text-amber-400/70 font-mono">in {formatDistanceToNow(new Date(nextRetryAt))}</span>
            <span className="text-muted-foreground/40 text-xs">→</span>
            <div className="flex items-center gap-1 px-2 py-1 rounded border bg-amber-500/10 border-amber-500/25 text-amber-400 cursor-default">
              <Clock className="w-3 h-3 shrink-0 animate-pulse" style={{ animationDuration: "2s" }} />
              <span className="text-xs font-semibold">#{totalAttempts + 1}</span>
              <span className="text-xs opacity-75">pending</span>
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

function MerchantWebhookRow({ log, onRetry, isRetrying }: { log: any; onRetry: (id: number) => void; isRetrying: boolean }) {
  const [open, setOpen] = useState(false);
  const isFailed = log.status === "failed";
  const isPendingRetry = log.status === "pending_retry";

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <TableRow className="cursor-pointer" onClick={() => setOpen(!open)}>
        <TableCell>{open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</TableCell>
        <TableCell className="max-w-[220px] truncate text-sm font-mono" title={log.url}>{log.url}</TableCell>
        <TableCell>
          <div className="flex items-center gap-1.5">
            <StatusBadge status={log.status} />
            {isPendingRetry && <RefreshCw className="w-3 h-3 text-amber-400 animate-spin" style={{ animationDuration: "3s" }} />}
          </div>
        </TableCell>
        <TableCell><span className={`font-mono text-sm ${log.httpStatus === 200 ? "text-emerald-500" : "text-rose-500"}`}>{log.httpStatus ?? "—"}</span></TableCell>
        <TableCell className="text-center">{log.attempts}</TableCell>
        <TableCell className="text-sm text-muted-foreground">
          {log.lastAttemptAt ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-default">{formatDistanceToNow(new Date(log.lastAttemptAt), { addSuffix: true })}</span>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">{format(new Date(log.lastAttemptAt), "MMM d, yyyy HH:mm:ss")}</TooltipContent>
            </Tooltip>
          ) : log.createdAt ? (
            <span>{format(new Date(log.createdAt), "MMM d, HH:mm")}</span>
          ) : "—"}
        </TableCell>
        <TableCell onClick={e => e.stopPropagation()}>
          {isFailed && (
            <Button variant="outline" size="sm" className="h-7 px-2 text-xs gap-1" disabled={isRetrying} onClick={() => onRetry(log.id)}>
              <RotateCcw className={`w-3 h-3 ${isRetrying ? "animate-spin" : ""}`} /> Retry
            </Button>
          )}
        </TableCell>
      </TableRow>
      <CollapsibleContent asChild>
        <TableRow>
          <TableCell colSpan={7} className="bg-muted/20 pb-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 px-2 pt-2">
              <div className="md:col-span-2 p-3 rounded-lg bg-background/50 border border-border/50">
                <p className="text-xs font-medium text-muted-foreground mb-2.5 uppercase tracking-wider">Attempt Timeline</p>
                <MerchantWebhookAttemptTimeline logId={log.id} totalAttempts={log.attempts ?? 0} status={log.status} nextRetryAt={log.nextRetryAt} />
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider">Request Body</p>
                <pre className="text-xs bg-background/50 rounded p-3 overflow-x-auto border border-border/50 whitespace-pre-wrap max-h-40">{log.requestBody ? (() => { try { return JSON.stringify(JSON.parse(log.requestBody), null, 2); } catch { return log.requestBody; } })() : "—"}</pre>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider">Response Body</p>
                <pre className="text-xs bg-background/50 rounded p-3 overflow-x-auto border border-border/50 whitespace-pre-wrap max-h-40">{log.responseBody ? (() => { try { return JSON.stringify(JSON.parse(log.responseBody), null, 2); } catch { return log.responseBody; } })() : "—"}</pre>
              </div>
              {log.eventType && (
                <div className="md:col-span-2">
                  <p className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider">Event Type</p>
                  <span className="text-xs font-mono text-foreground">{log.eventType}</span>
                </div>
              )}
            </div>
          </TableCell>
        </TableRow>
      </CollapsibleContent>
    </Collapsible>
  );
}

const ACTION_COLOR: Record<string, string> = {
  assigned: "text-sky-400",
  upgraded: "text-emerald-400",
  downgraded: "text-amber-400",
  renewed: "text-violet-400",
  suspended: "text-orange-400",
  reinstated: "text-emerald-400",
  expired: "text-rose-400",
  removed: "text-muted-foreground",
};

const PLAN_SUB_STATUS_COLOR: Record<string, string> = {
  active: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
  suspended: "text-orange-400 border-orange-500/30 bg-orange-500/10",
  expired: "text-rose-400 border-rose-500/30 bg-rose-500/10",
};

export default function AdminMerchants() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [search, setSearch] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("search") ?? "";
  });
  const [status, setStatus] = useState("all");
  const [expiryStatus, setExpiryStatus] = useState<"" | "expiring" | "expired">("");
  const [rejectionReasonFilter, setRejectionReasonFilter] = useState("");
  const [callbackSecretFilter, setCallbackSecretFilter] = useState<"" | "true" | "false">("");
  const [loginAlertFilter, setLoginAlertFilter] = useState<"" | "false">("");
  const [securityEmailsDisabledFilter, setSecurityEmailsDisabledFilter] = useState<"" | "true">("");
  const [settlementStateEmailsFilter, setSettlementStateEmailsFilter] = useState<"" | "false">("");
  const [reportScheduleEmailsFilter, setReportScheduleEmailsFilter] = useState<"" | "false">("");
  const [planExpiryAlertEmailsFilter, setPlanExpiryAlertEmailsFilter] = useState<"" | "false">("");
  const [page, setPage] = useState(1);
  const [rejectId, setRejectId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [brandingMerchant, setBrandingMerchant] = useState<{ id: number; name: string; logoUrl: string | null; brandColor: string | null } | null>(null);
  const [brandingLogoUrl, setBrandingLogoUrl] = useState("");
  const [brandingColor, setBrandingColor] = useState("");
  const [brandingLogoError, setBrandingLogoError] = useState(false);
  const [brandingSavedLogoError, setBrandingSavedLogoError] = useState(false);
  const [brandingIsReplacing, setBrandingIsReplacing] = useState(false);
  const brandingFileInputRef = useRef<HTMLInputElement>(null);
  const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
  const { uploadFile: uploadLogo, isUploading: isUploadingLogo } = useUpload({
    basePath: `${base}/api/storage`,
    requestHeaders: {
      Authorization: `Bearer ${localStorage.getItem("rasokart_token") ?? ""}`,
    },
    onSuccess: (response) => {
      setBrandingLogoUrl(`${base}/api/storage${response.objectPath}`);
      setBrandingLogoError(false);
      toast.success("Logo uploaded");
    },
    onError: () => toast.error("Logo upload failed"),
  });
  const [assignPlanMerchant, setAssignPlanMerchant] = useState<{ id: number; name: string; callbackTimestampWindowSeconds?: number | null; loginAlertEmails?: boolean; signatureFailureAlertEmails?: boolean; webhookFailureEmails?: boolean; apiKeyGeneratedEmails?: boolean; apiKeyRevokedEmails?: boolean; reportScheduleChangedEmails?: boolean; settlementStateChangedEmails?: boolean; planExpiryAlertEmails?: boolean } | null>(null);
  const [windowEditMode, setWindowEditMode] = useState(false);
  const [windowInput, setWindowInput] = useState("");
  const [retriesEditMode, setRetriesEditMode] = useState(false);
  const [retriesInput, setRetriesInput] = useState("");
  const [selectedPlanId, setSelectedPlanId] = useState<string>("");
  const [expiresAt, setExpiresAt] = useState<string>("");
  const [assignNotes, setAssignNotes] = useState<string>("");
  const [assignScheduledRenewalAt, setAssignScheduledRenewalAt] = useState<string>("");
  const [actionNotes, setActionNotes] = useState<string>("");
  const [showHistory, setShowHistory] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"upgrade" | "downgrade" | "suspend" | "reinstate" | "renew" | "schedule-renewal" | null>(null);
  const [renewExpiresAt, setRenewExpiresAt] = useState<string>("");
  const [actionExpiresAt, setActionExpiresAt] = useState<string>("");
  const [renewScheduledRenewalAt, setRenewScheduledRenewalAt] = useState<string>("");
  const [scheduleRenewalDate, setScheduleRenewalDate] = useState<string>("");
  const [confirmSecretReset, setConfirmSecretReset] = useState(false);
  const [credEventFilter, setCredEventFilter] = useState<"" | "key_generated" | "key_revoked" | "secret_rotated">("");
  const [webhookLogsMerchant, setWebhookLogsMerchant] = useState<{ id: number; name: string } | null>(null);
  const [webhookLogsStatus, setWebhookLogsStatus] = useState<"all" | "success" | "failed" | "pending_retry">("all");
  const [webhookLogsPage, setWebhookLogsPage] = useState(1);
  const [scrollToAlerts, setScrollToAlerts] = useState(false);
  const webhookAlertsRef = useRef<HTMLDivElement>(null);
  const [planEmailPreview, setPlanEmailPreview] = useState<{ html: string; subject: string } | null>(null);
  const [planEmailPreviewLoading, setPlanEmailPreviewLoading] = useState(false);

  // KYC review state — tracks inline note per document id and pending review action
  const [kycReviewState, setKycReviewState] = useState<Record<number, { action: "approved" | "rejected"; note: string } | null>>({});
  const [kycConfirming, setKycConfirming] = useState<Record<number, boolean>>({});

  // Parse ?open=<merchantId> once on mount (e.g. linked from QR/VA detail panels)
  const [deepLinkId] = useState<number | null>(() => {
    const raw = new URLSearchParams(window.location.search).get("open");
    if (!raw) return null;
    const id = parseInt(raw);
    return isNaN(id) ? null : id;
  });
  const deepLinkOpenedRef = useRef(false);

  // Bulk selection state
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [selectAllMode, setSelectAllMode] = useState(false);
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [bulkPlanId, setBulkPlanId] = useState<string>("");
  const [bulkExpiresAt, setBulkExpiresAt] = useState<string>("");
  const [bulkNotes, setBulkNotes] = useState<string>("");
  const [bulkStatusAction, setBulkStatusAction] = useState<"approve" | "suspend" | "reinstate" | null>(null);
  const [bulkRejectOpen, setBulkRejectOpen] = useState(false);
  const [bulkRejectReason, setBulkRejectReason] = useState("");

  // Bulk result summary state
  const [bulkResultOpen, setBulkResultOpen] = useState(false);
  const [bulkResultTitle, setBulkResultTitle] = useState("");
  const [bulkResultItems, setBulkResultItems] = useState<{ id: number; name: string; success: boolean; reason?: string | null }[]>([]);
  const [bulkRetryContext, setBulkRetryContext] = useState<
    | { type: "assign"; planId: number; planName: string; expiresAt: string | null; notes: string | null }
    | { type: "approve" }
    | { type: "suspend" | "reinstate" }
    | null
  >(null);

  // Single-action result summary state
  const [singleActionResult, setSingleActionResult] = useState<{
    open: boolean;
    title: string;
    merchantName: string;
    newStatus: string;
    timestamp: string;
  } | null>(null);

  // Undo state — tracks reverse action for bulk approve/suspend/plan-assign within 10-second window
  const [bulkUndoState, setBulkUndoState] = useState<
    | { action: "approve" | "suspend" | "reinstate"; ids: number[]; deadline: number }
    | { action: "plan-assign"; items: { id: number; previousPlanId: number | null }[]; deadline: number }
    | null
  >(null);
  const [bulkUndoSecondsLeft, setBulkUndoSecondsLeft] = useState(0);
  const [bulkUndoUsed, setBulkUndoUsed] = useState(false);

  const { data, isLoading } = useListMerchants({ status: status as any, search, page, limit: 20, expiryStatus: expiryStatus as any || undefined, rejectionReason: rejectionReasonFilter || undefined, callbackSecretSet: callbackSecretFilter as any || undefined, loginAlertEmails: loginAlertFilter as any || undefined, securityEmailsDisabled: securityEmailsDisabledFilter as any || undefined, settlementStateEmails: settlementStateEmailsFilter as any || undefined, reportScheduleEmails: reportScheduleEmailsFilter as any || undefined, planExpiryAlertEmails: planExpiryAlertEmailsFilter as any || undefined });
  const { data: plans } = useListPlans();
  const { data: currentMerchantPlan, isLoading: planLoading } = useGetMerchantPlan(
    assignPlanMerchant?.id ?? 0,
    { query: { enabled: !!assignPlanMerchant, queryKey: ["getMerchantPlan", assignPlanMerchant?.id ?? 0] } }
  );
  const { data: planHistory } = useGetMerchantPlanHistory(
    assignPlanMerchant?.id ?? 0,
    { query: { enabled: !!assignPlanMerchant && showHistory, queryKey: ["getMerchantPlanHistory", assignPlanMerchant?.id ?? 0] } }
  );
  const { data: merchantPlanUsage } = useGetMerchantPlanUsageAdmin(
    assignPlanMerchant?.id ?? 0,
    { query: { enabled: !!assignPlanMerchant && !!currentMerchantPlan, queryKey: ["getMerchantPlanUsageAdmin", assignPlanMerchant?.id ?? 0] } }
  );
  const { data: callbackSecretStatus, refetch: refetchCallbackSecret } = useGetAdminMerchantCallbackSecret(
    assignPlanMerchant?.id ?? 0,
    { query: { enabled: !!assignPlanMerchant, queryKey: ["getAdminMerchantCallbackSecret", assignPlanMerchant?.id ?? 0] } }
  );
  const { data: merchantWebhookConfig, isLoading: webhookConfigLoading, isError: webhookConfigError, refetch: refetchWebhookConfig } = useGetAdminMerchantWebhookConfig(
    assignPlanMerchant?.id ?? 0,
    { query: { enabled: !!assignPlanMerchant, queryKey: ["getAdminMerchantWebhookConfig", assignPlanMerchant?.id ?? 0], retry: false } }
  );
  const { data: merchantWebhookAlertHistory, isLoading: webhookAlertHistoryLoading } = useGetWebhookFailureAlertHistory(
    { merchantId: assignPlanMerchant?.id ?? 0, limit: 50 },
    { query: { enabled: !!assignPlanMerchant, queryKey: ["getWebhookFailureAlertHistory", "merchant", assignPlanMerchant?.id ?? 0] } }
  );
  const merchantWebhookAlerts: WebhookFailureAlertLogEntry[] = merchantWebhookAlertHistory?.data ?? [];
  const { data: credentialEvents, isLoading: credEventsLoading } = useListMerchantCredentialEvents(
    assignPlanMerchant?.id ?? 0,
    credEventFilter ? { eventType: credEventFilter } : undefined,
    { query: { enabled: !!assignPlanMerchant, queryKey: ["listMerchantCredentialEvents", assignPlanMerchant?.id ?? 0, credEventFilter] } }
  );
  const { data: kycSummary, isLoading: kycSummaryLoading } = useGetKycSummary(
    assignPlanMerchant?.id ?? 0,
    { query: { enabled: !!assignPlanMerchant, queryKey: ["getKycSummary", assignPlanMerchant?.id ?? 0] } }
  );
  const { data: kycDocumentsResponse, isLoading: kycDocsLoading } = useListKycDocuments(
    assignPlanMerchant ? { merchantId: assignPlanMerchant.id } : undefined,
    { query: { enabled: !!assignPlanMerchant, queryKey: ["listKycDocuments", "merchant", assignPlanMerchant?.id ?? 0] } }
  );
  const kycDocuments = kycDocumentsResponse?.data ?? [];
  const reviewKycMutation = useReviewKycDocument({
    mutation: {
      onSuccess: (_, vars) => {
        toast.success(`Document ${vars.data.status === "approved" ? "approved" : "rejected"}`);
        qc.invalidateQueries({ queryKey: ["getKycSummary", assignPlanMerchant?.id ?? 0] });
        qc.invalidateQueries({ queryKey: ["listKycDocuments", "merchant", assignPlanMerchant?.id ?? 0] });
        setKycReviewState(prev => ({ ...prev, [vars.id]: null }));
        setKycConfirming(prev => ({ ...prev, [vars.id]: false }));
      },
      onError: (_, vars) => {
        toast.error("Failed to update KYC document");
        setKycConfirming(prev => ({ ...prev, [vars.id]: false }));
      },
    },
  });
  // Fetch the deep-link merchant by ID so the panel opens regardless of which page they're on
  const { data: deepLinkMerchant } = useGetMerchant(
    deepLinkId ?? 0,
    { query: { enabled: deepLinkId != null } as any }
  );
  const { data: webhookLogsData, isLoading: webhookLogsLoading } = useListCallbackLogs(
    webhookLogsMerchant ? {
      merchantId: webhookLogsMerchant.id,
      status: webhookLogsStatus === "all" ? undefined : webhookLogsStatus as any,
      page: webhookLogsPage,
      limit: 20,
    } : undefined,
    { query: { enabled: !!webhookLogsMerchant, queryKey: ["listCallbackLogs", "merchant", webhookLogsMerchant?.id ?? 0, webhookLogsStatus, webhookLogsPage] } }
  );
  const { mutate: retryWebhookLog, isPending: isRetryingWebhookLog } = useRetryCallback({
    mutation: {
      onSuccess: () => {
        toast.success("Callback queued for retry");
        qc.invalidateQueries({ queryKey: ["listCallbackLogs", "merchant", webhookLogsMerchant?.id ?? 0] });
      },
      onError: () => toast.error("Failed to queue retry"),
    },
  });

  const resetCallbackSecretMutation = useResetAdminMerchantCallbackSecret();
  const updateCallbackWindowMutation = useUpdateMerchantCallbackWindow();
  const updateWebhookMaxRetriesMutation = useUpdateMerchantWebhookMaxRetries();
  const updateBrandingMutation = useUpdateMerchantBranding();
  const approveMutation = useApproveMerchant();
  const rejectMutation = useRejectMerchant();
  const merchantSuspendMutation = useSuspendMerchant();
  const merchantUnsuspendMutation = useUnsuspendMerchant();
  const assignPlanMutation = useAssignMerchantPlan();
  const upgradeMutation = useUpgradeMerchantPlan();
  const downgradeMutation = useDowngradeMerchantPlan();
  const suspendPlanMutation = useSuspendMerchantPlan();
  const reinstatePlanMutation = useReinstateMerchantPlan();
  const renewMutation = useRenewMerchantPlan();
  const scheduleRenewalMutation = useScheduleMerchantPlanRenewal();
  const bulkAssignMutation = useBulkAssignMerchantPlan();
  const bulkUnassignMutation = useBulkUnassignMerchantPlan();
  const bulkApproveMutation = useBulkApproveMerchants();
  const bulkSuspendMutation = useBulkSuspendMerchants();
  const bulkRejectMutation = useBulkRejectMerchants();

  // Clean ?open= param from the URL immediately so back-navigation doesn't re-trigger the panel
  useEffect(() => {
    if (deepLinkId == null) return;
    window.history.replaceState(null, "", window.location.pathname);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Open the merchant panel once the deep-link merchant is fetched (works regardless of pagination)
  useEffect(() => {
    if (!deepLinkMerchant || deepLinkId == null || deepLinkOpenedRef.current) return;
    deepLinkOpenedRef.current = true;
    openAssignPlan(deepLinkId, deepLinkMerchant.businessName, deepLinkMerchant.callbackTimestampWindowSeconds, deepLinkMerchant.loginAlertEmails, deepLinkMerchant.signatureFailureAlertEmails, deepLinkMerchant.webhookFailureEmails, deepLinkMerchant.apiKeyGeneratedEmails, deepLinkMerchant.apiKeyRevokedEmails, deepLinkMerchant.reportScheduleChangedEmails, deepLinkMerchant.settlementStateChangedEmails, deepLinkMerchant.planExpiryAlertEmails);
  }, [deepLinkMerchant, deepLinkId]);

  // Scroll to Webhook Failure Alerts section when panel opens via badge click
  useEffect(() => {
    if (!scrollToAlerts || !assignPlanMerchant) return;
    const timer = setTimeout(() => {
      webhookAlertsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      setScrollToAlerts(false);
    }, 120);
    return () => clearTimeout(timer);
  }, [scrollToAlerts, assignPlanMerchant]);

  // Countdown timer for undo window
  useEffect(() => {
    if (!bulkUndoState || bulkUndoUsed) return;
    const tick = () => {
      const left = Math.max(0, Math.ceil((bulkUndoState.deadline - Date.now()) / 1000));
      setBulkUndoSecondsLeft(left);
    };
    tick();
    const interval = setInterval(tick, 500);
    return () => clearInterval(interval);
  }, [bulkUndoState, bulkUndoUsed]);

  const handleBulkUndo = () => {
    if (!bulkUndoState || bulkUndoUsed || bulkUndoSecondsLeft === 0) return;
    setBulkUndoUsed(true);

    if (bulkUndoState.action === "plan-assign") {
      const { items } = bulkUndoState;
      // Split into: merchants with a prior plan (reassign) vs first-time assignments (unassign/remove)
      const reassignGroups = new Map<number, number[]>();
      const unassignIds: number[] = [];
      for (const item of items) {
        if (item.previousPlanId != null) {
          const group = reassignGroups.get(item.previousPlanId) ?? [];
          group.push(item.id);
          reassignGroups.set(item.previousPlanId, group);
        } else {
          unassignIds.push(item.id);
        }
      }
      const allResults: { id: number; name: string; success: boolean; reason?: string | null }[] = [];
      let totalUpdated = 0;
      const promises: Promise<void>[] = [];
      for (const [previousPlanId, ids] of reassignGroups.entries()) {
        promises.push(
          bulkAssignMutation.mutateAsync({ data: { merchantIds: ids, planId: previousPlanId, expiresAt: null, notes: null } })
            .then(result => {
              totalUpdated += result.updated;
              allResults.push(...(result.results ?? []));
            })
        );
      }
      if (unassignIds.length > 0) {
        promises.push(
          bulkUnassignMutation.mutateAsync({ data: { merchantIds: unassignIds } })
            .then(result => {
              totalUpdated += result.updated;
              allResults.push(...(result.results ?? []));
            })
        );
      }
      Promise.all(promises).then(() => {
        qc.invalidateQueries({ queryKey: getListMerchantsQueryKey() });
        setBulkResultTitle("Undo — Plan Assignment");
        setBulkResultItems(allResults);
        setBulkUndoState(null);
        toast.success(`Undo: restored ${totalUpdated} merchant${totalUpdated !== 1 ? "s" : ""}`);
      }).catch(() => {
        setBulkUndoUsed(false);
        toast.error("Undo failed");
      });
      return;
    }

    const { action, ids } = bulkUndoState;

    if (action === "approve") {
      bulkApproveMutation.mutate({ data: { merchantIds: ids } }, {
        onSuccess: (result) => {
          qc.invalidateQueries({ queryKey: getListMerchantsQueryKey() });
          setBulkResultTitle("Undo — Approve");
          setBulkResultItems(result.results ?? []);
          setBulkUndoState(null);
          toast.success(`Undo: approved ${result.updated} merchant${result.updated !== 1 ? "s" : ""}`);
        },
        onError: () => { setBulkUndoUsed(false); toast.error("Undo failed"); },
      });
    } else {
      bulkSuspendMutation.mutate({ data: { merchantIds: ids, action } }, {
        onSuccess: (result) => {
          qc.invalidateQueries({ queryKey: getListMerchantsQueryKey() });
          const actionLabel = action === "suspend" ? "Suspend" : "Reinstate";
          setBulkResultTitle(`Undo — ${actionLabel}`);
          setBulkResultItems(result.results ?? []);
          setBulkUndoState(null);
          toast.success(`Undo: ${action === "suspend" ? "suspended" : "reinstated"} ${result.updated} merchant${result.updated !== 1 ? "s" : ""}`);
        },
        onError: () => { setBulkUndoUsed(false); toast.error("Undo failed"); },
      });
    }
  };

  const handleBulkResultClose = (open: boolean) => {
    setBulkResultOpen(open);
    if (!open) {
      setBulkUndoState(null);
      setBulkUndoUsed(false);
    }
  };

  const invalidatePlanData = (id: number) => {
    qc.invalidateQueries({ queryKey: ["getMerchantPlan", id] });
    qc.invalidateQueries({ queryKey: ["getMerchantPlanHistory", id] });
  };

  const handlePlanAction = (action: typeof confirmAction) => {
    if (!assignPlanMerchant) return;
    const id = assignPlanMerchant.id;
    const notes = actionNotes || null;

    const afterSuccess = (msg: string, extra?: () => void) => {
      toast.success(msg);
      invalidatePlanData(id);
      qc.invalidateQueries({ queryKey: getListMerchantsQueryKey() });
      setConfirmAction(null);
      setActionNotes("");
      setActionExpiresAt("");
      extra?.();
    };

    if (action === "upgrade" || action === "downgrade") {
      if (!selectedPlanId) return;
      const mutation = action === "upgrade" ? upgradeMutation : downgradeMutation;
      mutation.mutate({ id, data: { planId: parseInt(selectedPlanId), expiresAt: actionExpiresAt || null, notes } }, {
        onSuccess: () => afterSuccess(`Plan ${action}d`, () => setSelectedPlanId("")),
        onError: () => toast.error(`Failed to ${action} plan`),
      });
    } else if (action === "suspend") {
      suspendPlanMutation.mutate({ id, data: { notes } }, {
        onSuccess: () => afterSuccess("Plan suspended"),
        onError: () => toast.error("Failed to suspend plan"),
      });
    } else if (action === "reinstate") {
      reinstatePlanMutation.mutate({ id, data: { notes } }, {
        onSuccess: () => afterSuccess("Plan reinstated"),
        onError: () => toast.error("Failed to reinstate plan"),
      });
    } else if (action === "renew") {
      const defaultExpiry = new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0];
      renewMutation.mutate({ id, data: { expiresAt: renewExpiresAt || defaultExpiry, scheduledRenewalAt: renewScheduledRenewalAt || null, notes } }, {
        onSuccess: () => afterSuccess("Plan renewed", () => { setRenewExpiresAt(""); setRenewScheduledRenewalAt(""); }),
        onError: () => toast.error("Failed to renew plan"),
      });
    } else if (action === "schedule-renewal") {
      const dateVal = scheduleRenewalDate || null;
      scheduleRenewalMutation.mutate({ id, data: { scheduledRenewalAt: dateVal } }, {
        onSuccess: () => afterSuccess(dateVal ? "Renewal scheduled" : "Scheduled renewal cancelled", () => setScheduleRenewalDate("")),
        onError: () => toast.error("Failed to update scheduled renewal"),
      });
    }
  };

  const isActionPending = upgradeMutation.isPending || downgradeMutation.isPending || suspendPlanMutation.isPending || reinstatePlanMutation.isPending || renewMutation.isPending || scheduleRenewalMutation.isPending;

  const handlePreviewPlanEmail = async (
    variant: "assigned" | "suspended" | "reinstated",
    opts?: { planId?: number; notes?: string; expiresAt?: string }
  ) => {
    if (!assignPlanMerchant) return;
    setPlanEmailPreviewLoading(true);
    try {
      const params: { variant: "assigned" | "suspended" | "reinstated"; planId?: number; notes?: string; expiresAt?: string } = { variant };
      if (opts?.planId) params.planId = opts.planId;
      if (opts?.notes) params.notes = opts.notes;
      if (opts?.expiresAt) params.expiresAt = opts.expiresAt;
      const result = await previewMerchantPlanEmail(assignPlanMerchant.id, params);
      setPlanEmailPreview(result);
    } catch {
      toast.error("Failed to load email preview");
    } finally {
      setPlanEmailPreviewLoading(false);
    }
  };

  const handlePreviewBulkPlanEmail = async () => {
    const sampleId = selected.values().next().value;
    if (!sampleId || !bulkPlanId) return;
    setPlanEmailPreviewLoading(true);
    try {
      const params: { variant: "assigned"; planId?: number; notes?: string; expiresAt?: string } = { variant: "assigned" };
      params.planId = parseInt(bulkPlanId);
      if (bulkExpiresAt) params.expiresAt = bulkExpiresAt;
      if (bulkNotes) params.notes = bulkNotes;
      const result = await previewMerchantPlanEmail(sampleId, params);
      setPlanEmailPreview(result);
    } catch {
      toast.error("Failed to load email preview");
    } finally {
      setPlanEmailPreviewLoading(false);
    }
  };

  const handleApprove = (id: number) => {
    approveMutation.mutate({ id }, {
      onSuccess: (merchant) => {
        qc.invalidateQueries({ queryKey: getListMerchantsQueryKey() });
        setSingleActionResult({ open: true, title: "Merchant Approved", merchantName: merchant.businessName, newStatus: merchant.status, timestamp: new Date().toISOString() });
      },
      onError: () => toast.error("Failed to approve merchant"),
    });
  };

  const handleSuspend = (id: number) => {
    merchantSuspendMutation.mutate({ id }, {
      onSuccess: (merchant) => {
        qc.invalidateQueries({ queryKey: getListMerchantsQueryKey() });
        setSingleActionResult({ open: true, title: "Merchant Suspended", merchantName: merchant.businessName, newStatus: merchant.status, timestamp: new Date().toISOString() });
      },
      onError: () => toast.error("Failed to suspend merchant"),
    });
  };

  const handleUnsuspend = (id: number) => {
    merchantUnsuspendMutation.mutate({ id }, {
      onSuccess: (merchant) => {
        qc.invalidateQueries({ queryKey: getListMerchantsQueryKey() });
        setSingleActionResult({ open: true, title: "Merchant Reinstated", merchantName: merchant.businessName, newStatus: merchant.status, timestamp: new Date().toISOString() });
      },
      onError: () => toast.error("Failed to unsuspend merchant"),
    });
  };

  const handleReject = () => {
    if (!rejectId || !rejectReason.trim()) return;
    rejectMutation.mutate({ id: rejectId, data: { reason: rejectReason } }, {
      onSuccess: (merchant) => {
        setRejectId(null); setRejectReason("");
        qc.invalidateQueries({ queryKey: getListMerchantsQueryKey() });
        setSingleActionResult({ open: true, title: "Merchant Rejected", merchantName: merchant.businessName, newStatus: merchant.status, timestamp: new Date().toISOString() });
      },
      onError: () => toast.error("Failed to reject merchant"),
    });
  };

  const openBranding = (merchant: { id: number; businessName: string; logoUrl?: string | null; brandColor?: string | null }) => {
    setBrandingMerchant({ id: merchant.id, name: merchant.businessName, logoUrl: merchant.logoUrl ?? null, brandColor: merchant.brandColor ?? null });
    setBrandingLogoUrl(merchant.logoUrl ?? "");
    setBrandingColor(merchant.brandColor ?? "");
    setBrandingLogoError(false);
    setBrandingSavedLogoError(false);
    setBrandingIsReplacing(false);
  };

  const closeBranding = () => { setBrandingMerchant(null); };

  const handleSaveBranding = () => {
    if (!brandingMerchant) return;
    updateBrandingMutation.mutate({
      id: brandingMerchant.id,
      data: { logoUrl: brandingLogoUrl.trim() || null, brandColor: brandingColor.trim() || null },
    }, {
      onSuccess: () => {
        toast.success("Branding updated");
        qc.invalidateQueries({ queryKey: getListMerchantsQueryKey() });
        closeBranding();
      },
      onError: () => toast.error("Failed to update branding"),
    });
  };

  const openAssignPlan = (id: number, name: string, callbackTimestampWindowSeconds?: number | null, loginAlertEmails?: boolean, signatureFailureAlertEmails?: boolean, webhookFailureEmails?: boolean, apiKeyGeneratedEmails?: boolean, apiKeyRevokedEmails?: boolean, reportScheduleChangedEmails?: boolean, settlementStateChangedEmails?: boolean, planExpiryAlertEmails?: boolean) => {
    setAssignPlanMerchant({ id, name, callbackTimestampWindowSeconds, loginAlertEmails, signatureFailureAlertEmails, webhookFailureEmails, apiKeyGeneratedEmails, apiKeyRevokedEmails, reportScheduleChangedEmails, settlementStateChangedEmails, planExpiryAlertEmails });
    setWindowEditMode(false);
    setWindowInput("");
    setSelectedPlanId("");
    setExpiresAt("");
    setAssignNotes("");
    setAssignScheduledRenewalAt("");
    setShowHistory(false);
    setCredEventFilter("");
  };

  const closeAssignPlan = () => {
    setAssignPlanMerchant(null);
    setSelectedPlanId("");
    setExpiresAt("");
    setAssignNotes("");
    setAssignScheduledRenewalAt("");
    setShowHistory(false);
    setConfirmSecretReset(false);
    setConfirmAction(null);
    setScheduleRenewalDate("");
    setWindowEditMode(false);
    setWindowInput("");
    setCredEventFilter("");
  };

  const handleAssignPlan = () => {
    if (!assignPlanMerchant || !selectedPlanId) return;
    const selectedPlan = plans?.find(p => String(p.id) === selectedPlanId);
    const isPaid = selectedPlan && selectedPlan.monthlyFee !== "0" && selectedPlan.name.toLowerCase() !== "custom";
    if (isPaid && !expiresAt) return;
    assignPlanMutation.mutate({
      id: assignPlanMerchant.id,
      data: {
        planId: parseInt(selectedPlanId),
        expiresAt: expiresAt || null,
        scheduledRenewalAt: assignScheduledRenewalAt || null,
        notes: assignNotes || null,
      },
    }, {
      onSuccess: () => {
        toast.success("Plan assigned successfully");
        qc.invalidateQueries({ queryKey: ["getMerchantPlan", assignPlanMerchant.id] });
        qc.invalidateQueries({ queryKey: ["getMerchantPlanHistory", assignPlanMerchant.id] });
        qc.invalidateQueries({ queryKey: getListMerchantsQueryKey() });
        closeAssignPlan();
      },
      onError: () => toast.error("Failed to assign plan"),
    });
  };

  const handleBulkAssign = () => {
    if (!bulkPlanId || selected.size === 0) return;
    const planName = plans?.find(p => String(p.id) === bulkPlanId)?.name ?? "plan";
    const planId = parseInt(bulkPlanId);
    const expiresAt = bulkExpiresAt || null;
    const notes = bulkNotes || null;
    bulkAssignMutation.mutate({
      data: {
        merchantIds: Array.from(selected),
        planId,
        expiresAt,
        notes,
      },
    }, {
      onSuccess: (result) => {
        const { updated, failed, results } = result;
        qc.invalidateQueries({ queryKey: getListMerchantsQueryKey() });
        clearSelection();
        closeBulkDialog();
        setBulkResultTitle(`Bulk Plan Assignment — ${planName}`);
        setBulkResultItems(results ?? []);
        setBulkRetryContext({ type: "assign", planId, planName, expiresAt, notes });
        setBulkResultOpen(true);
        const undoItems = (results ?? [])
          .filter(r => r.success)
          .map(r => ({ id: r.id, previousPlanId: r.previousPlanId ?? null }));
        if (undoItems.length > 0) {
          setBulkUndoState({ action: "plan-assign", items: undoItems, deadline: Date.now() + 10000 });
          setBulkUndoUsed(false);
        } else {
          setBulkUndoState(null);
        }
        const label = `Bulk assigned plan to ${updated} merchant${updated !== 1 ? "s" : ""} — ${failed} failed`;
        if (failed === 0) {
          toast.success(label);
        } else {
          toast.warning(label);
        }
      },
      onError: () => toast.error("Bulk plan assignment failed"),
    });
  };

  const closeBulkDialog = () => {
    setBulkDialogOpen(false);
    setBulkPlanId("");
    setBulkExpiresAt("");
    setBulkNotes("");
  };

  const handleBulkStatusAction = () => {
    if (!bulkStatusAction || selected.size === 0) return;
    const ids = Array.from(selected);

    if (bulkStatusAction === "approve") {
      bulkApproveMutation.mutate({ data: { merchantIds: ids } }, {
        onSuccess: (result) => {
          const { updated, failed, results } = result;
          qc.invalidateQueries({ queryKey: getListMerchantsQueryKey() });
          clearSelection();
          setBulkStatusAction(null);
          setBulkResultTitle("Bulk Approve");
          setBulkResultItems(results ?? []);
          setBulkRetryContext({ type: "approve" });
          setBulkResultOpen(true);
          const successIds = (results ?? []).filter(r => r.success).map(r => r.id);
          if (successIds.length > 0) {
            setBulkUndoState({ action: "suspend", ids: successIds, deadline: Date.now() + 10000 });
            setBulkUndoUsed(false);
          } else {
            setBulkUndoState(null);
          }
          const label = `Bulk approved ${updated} merchant${updated !== 1 ? "s" : ""} — ${failed} failed`;
          if (failed === 0) {
            toast.success(label);
          } else {
            toast.warning(label);
          }
        },
        onError: () => toast.error("Bulk approve failed"),
      });
    } else {
      const actionLabel = bulkStatusAction === "suspend" ? "suspended" : "reinstated";
      const capturedAction = bulkStatusAction;
      bulkSuspendMutation.mutate({ data: { merchantIds: ids, action: bulkStatusAction } }, {
        onSuccess: (result) => {
          const { updated, failed, results } = result;
          qc.invalidateQueries({ queryKey: getListMerchantsQueryKey() });
          clearSelection();
          const capturedAction = bulkStatusAction;
          setBulkStatusAction(null);
          setBulkResultTitle(`Bulk ${capturedAction === "suspend" ? "Suspend" : "Reinstate"}`);
          setBulkResultItems(results ?? []);
          setBulkRetryContext({ type: capturedAction });
          setBulkResultOpen(true);
          const successIds = (results ?? []).filter(r => r.success).map(r => r.id);
          if (successIds.length > 0) {
            const undoAction = capturedAction === "suspend" ? "reinstate" : "suspend";
            setBulkUndoState({ action: undoAction, ids: successIds, deadline: Date.now() + 10000 });
            setBulkUndoUsed(false);
          } else {
            setBulkUndoState(null);
          }
          const label = `Bulk ${actionLabel} ${updated} merchant${updated !== 1 ? "s" : ""} — ${failed} failed`;
          if (failed === 0) {
            toast.success(label);
          } else {
            toast.warning(label);
          }
        },
        onError: () => toast.error(`Bulk ${capturedAction} failed`),
      });
    }
  };

  const isBulkStatusPending = bulkApproveMutation.isPending || bulkSuspendMutation.isPending;

  const handleBulkReject = () => {
    if (!bulkRejectReason.trim() || selected.size === 0) return;
    const ids = [...selected];
    bulkRejectMutation.mutate({ data: { merchantIds: ids, reason: bulkRejectReason.trim() } }, {
      onSuccess: (result) => {
        const label = `Bulk rejected ${result.updated} merchant${result.updated !== 1 ? "s" : ""} — ${result.failed} failed`;
        if (result.failed === 0) {
          toast.success(label);
        } else {
          toast.warning(label);
        }
        setBulkRejectOpen(false);
        setBulkRejectReason("");
        clearSelection();
        qc.invalidateQueries({ queryKey: getListMerchantsQueryKey() });
      },
      onError: () => toast.error("Bulk reject failed"),
    });
  };

  const handleRetryFailed = () => {
    if (!bulkRetryContext) return;
    const failedIds = bulkResultItems.filter(r => !r.success).map(r => r.id);
    if (failedIds.length === 0) return;

    setBulkResultOpen(false);

    if (bulkRetryContext.type === "assign") {
      const { planId, planName, expiresAt, notes } = bulkRetryContext;
      bulkAssignMutation.mutate({ data: { merchantIds: failedIds, planId, expiresAt, notes } }, {
        onSuccess: (result) => {
          const { updated, failed, results } = result;
          qc.invalidateQueries({ queryKey: getListMerchantsQueryKey() });
          setBulkResultTitle(`Bulk Plan Assignment — ${planName}`);
          setBulkResultItems(results ?? []);
          setBulkRetryContext({ type: "assign", planId, planName, expiresAt, notes });
          setBulkResultOpen(true);
          const label = `Retry: assigned plan to ${updated} merchant${updated !== 1 ? "s" : ""} — ${failed} failed`;
          if (failed === 0) toast.success(label); else toast.warning(label);
        },
        onError: () => toast.error("Retry bulk plan assignment failed"),
      });
    } else if (bulkRetryContext.type === "approve") {
      bulkApproveMutation.mutate({ data: { merchantIds: failedIds } }, {
        onSuccess: (result) => {
          const { updated, failed, results } = result;
          qc.invalidateQueries({ queryKey: getListMerchantsQueryKey() });
          setBulkResultTitle("Bulk Approve");
          setBulkResultItems(results ?? []);
          setBulkRetryContext({ type: "approve" });
          setBulkResultOpen(true);
          const label = `Retry: approved ${updated} merchant${updated !== 1 ? "s" : ""} — ${failed} failed`;
          if (failed === 0) toast.success(label); else toast.warning(label);
        },
        onError: () => toast.error("Retry bulk approve failed"),
      });
    } else if (bulkRetryContext.type === "suspend" || bulkRetryContext.type === "reinstate") {
      const capturedAction = bulkRetryContext.type;
      const actionLabel = capturedAction === "suspend" ? "suspended" : "reinstated";
      bulkSuspendMutation.mutate({ data: { merchantIds: failedIds, action: capturedAction } }, {
        onSuccess: (result) => {
          const { updated, failed, results } = result;
          qc.invalidateQueries({ queryKey: getListMerchantsQueryKey() });
          setBulkResultTitle(`Bulk ${capturedAction === "suspend" ? "Suspend" : "Reinstate"}`);
          setBulkResultItems(results ?? []);
          setBulkRetryContext({ type: capturedAction });
          setBulkResultOpen(true);
          const label = `Retry: ${actionLabel} ${updated} merchant${updated !== 1 ? "s" : ""} — ${failed} failed`;
          if (failed === 0) toast.success(label); else toast.warning(label);
        },
        onError: () => toast.error(`Retry bulk ${capturedAction} failed`),
      });
    }
  };

  const exportCsv = () => downloadCsvFromUrl("/api/merchants/export/csv", "merchants.csv", {
    status: status !== "all" ? status : undefined,
    search: search || undefined,
    expiryStatus: expiryStatus || undefined,
    rejectionReason: rejectionReasonFilter || undefined,
    callbackSecretSet: callbackSecretFilter || undefined,
    loginAlertEmails: loginAlertFilter || undefined,
    securityEmailsDisabled: securityEmailsDisabledFilter || undefined,
    settlementStateEmails: settlementStateEmailsFilter || undefined,
    reportScheduleEmails: reportScheduleEmailsFilter || undefined,
    planExpiryAlertEmails: planExpiryAlertEmailsFilter || undefined,
  });

  const merchants = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 20);

  const anyFilterActive = !!search || status !== "all" || !!expiryStatus || !!rejectionReasonFilter || callbackSecretFilter !== "" || loginAlertFilter !== "" || securityEmailsDisabledFilter !== "" || settlementStateEmailsFilter !== "" || reportScheduleEmailsFilter !== "" || planExpiryAlertEmailsFilter !== "";
  const [grandTotal, setGrandTotal] = useState(0);
  useEffect(() => {
    if (!anyFilterActive && !isLoading && data?.total != null) {
      setGrandTotal(data.total);
    }
  }, [anyFilterActive, isLoading, data?.total]);

  const pageWebhookCountsIds = merchants.length > 0 ? merchants.map(m => m.id).join(",") : "";
  const { data: webhookFailureCountsData } = useGetMerchantsWebhookFailureCounts(
    { merchantIds: pageWebhookCountsIds },
    { query: { enabled: merchants.length > 0, queryKey: ["getMerchantsWebhookFailureCounts", pageWebhookCountsIds] } }
  );
  const webhookFailureCounts: Record<number, number> = webhookFailureCountsData?.counts
    ? Object.fromEntries(Object.entries(webhookFailureCountsData.counts).map(([k, v]) => [Number(k), v]))
    : {};

  // Running cache of email preference fields for every merchant whose list row has been loaded.
  // Grows as the admin pages through merchants or selects-all, so opt-out counts are always exact
  // for the actual selection, not just the visible page.
  const [merchantEmailPrefsCache, setMerchantEmailPrefsCache] = useState<
    Map<number, { reportScheduleChangedEmails?: boolean; settlementStateChangedEmails?: boolean }>
  >(new Map());

  // Merge current-page merchants into the cache whenever the list response changes
  useEffect(() => {
    if (!data?.data?.length) return;
    setMerchantEmailPrefsCache(prev => {
      const next = new Map(prev);
      for (const m of data.data) {
        next.set(m.id, {
          reportScheduleChangedEmails: m.reportScheduleChangedEmails,
          settlementStateChangedEmails: m.settlementStateChangedEmails,
        });
      }
      return next;
    });
  }, [data?.data]);

  // Opt-out counts for bulk email pre-flight warnings.
  // Uses the running cache so counts cover all selected merchants, including those from other pages
  // or fetched via "select all". Only falls back to partial-data mode when the cache is missing
  // entries for some selected IDs (e.g. the user selected then navigated but never triggered a
  // full fetch — extremely rare in practice).
  const selectedPrefsFromCache = Array.from(selected).map(id => merchantEmailPrefsCache.get(id));
  const reportScheduleOptOutCount = selectedPrefsFromCache.filter(p => p?.reportScheduleChangedEmails === false).length;
  const settlementStateOptOutCount = selectedPrefsFromCache.filter(p => p?.settlementStateChangedEmails === false).length;
  const optOutDataIsPartial = selectedPrefsFromCache.some(p => p === undefined);

  const now = Date.now();
  const expiringCount = merchants.filter(m => {
    if (!m.currentPlanExpiresAt || m.currentPlanIsExpired) return false;
    const msLeft = new Date(m.currentPlanExpiresAt).getTime() - now;
    return msLeft > 0 && msLeft <= 7 * 86400000;
  }).length;
  const expiredCount = merchants.filter(m => m.currentPlanIsExpired).length;

  const allPageIds = merchants.map(m => m.id);
  const allPageSelected = allPageIds.length > 0 && allPageIds.every(id => selected.has(id));
  const somePageSelected = allPageIds.some(id => selected.has(id));
  const selectedOnPage = allPageIds.filter(id => selected.has(id)).length;
  const selectedOffPage = selected.size - selectedOnPage;

  const clearSelection = () => { setSelected(new Set()); setSelectAllMode(false); };

  const handleSearchChange = (v: string) => { setSearch(v); setPage(1); clearSelection(); };
  const handleStatusChange = (v: string) => {
    setStatus(v);
    setPage(1);
    clearSelection();
    if (v !== "rejected" && v !== "all") setRejectionReasonFilter("");
  };
  const handleExpiryChange = (v: "" | "expiring" | "expired") => { setExpiryStatus(v); setPage(1); clearSelection(); };
  const handleRejectionReasonFilterChange = (v: string) => { setRejectionReasonFilter(v); setPage(1); clearSelection(); };

  const handleSelectAllPages = async () => {
    try {
      const allData = await listMerchants({ status: status as any, search, page: 1, limit: total, expiryStatus: expiryStatus as any || undefined, rejectionReason: rejectionReasonFilter || undefined });
      setSelected(new Set(allData.data.map(m => m.id)));
      setSelectAllMode(true);
      // Populate the email prefs cache with all fetched merchants so opt-out counts are exact
      setMerchantEmailPrefsCache(prev => {
        const next = new Map(prev);
        for (const m of allData.data) {
          next.set(m.id, {
            reportScheduleChangedEmails: m.reportScheduleChangedEmails,
            settlementStateChangedEmails: m.settlementStateChangedEmails,
          });
        }
        return next;
      });
    } catch {
      toast.error("Failed to select all merchants");
    }
  };

  const toggleSelectAll = () => {
    if (allPageSelected) {
      setSelected(prev => {
        const next = new Set(prev);
        allPageIds.forEach(id => next.delete(id));
        return next;
      });
      setSelectAllMode(false);
    } else {
      setSelected(prev => {
        const next = new Set(prev);
        allPageIds.forEach(id => next.add(id));
        return next;
      });
    }
  };

  const toggleSelect = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setSelectAllMode(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Merchants</h1>
          <p className="text-muted-foreground mt-1">{total} total merchants</p>
        </div>
        <ExportCsvButton onExport={exportCsv} />
      </div>

      {(expiringCount > 0 || expiredCount > 0) && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-400 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>
            {[
              expiredCount > 0 && `${expiredCount} merchant${expiredCount === 1 ? "" : "s"} with an expired plan`,
              expiringCount > 0 && `${expiringCount} merchant${expiringCount === 1 ? "" : "s"} expiring within 7 days`,
            ].filter(Boolean).join(" · ")}
          </span>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search merchants..." value={search} onChange={e => handleSearchChange(e.target.value)} />
          </div>
          <div className="flex gap-1 flex-wrap">
            {(["all", "pending", "approved", "rejected", "suspended"] as const).map(tab => (
              <button
                key={tab}
                onClick={() => handleStatusChange(tab)}
                className={`px-3 py-1.5 rounded-md text-sm capitalize transition-colors border ${
                  status === tab
                    ? "bg-primary text-primary-foreground border-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50 border-transparent"
                }`}
              >
                {tab === "all" ? "All" : tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
          <div className="flex gap-1 flex-wrap">
            {([
              { value: "", label: "Any Expiry" },
              { value: "expiring", label: "Expiring Soon" },
              { value: "expired", label: "Expired" },
            ] as const).map(tab => (
              <button
                key={tab.value}
                onClick={() => handleExpiryChange(tab.value)}
                className={`px-3 py-1.5 rounded-md text-sm transition-colors border ${
                  expiryStatus === tab.value
                    ? tab.value === "expired"
                      ? "bg-rose-500/20 text-rose-400 border-rose-500/40"
                      : tab.value === "expiring"
                        ? "bg-amber-500/20 text-amber-400 border-amber-500/40"
                        : "bg-primary text-primary-foreground border-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50 border-transparent"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="flex gap-1 flex-wrap">
            <button
              onClick={() => { setCallbackSecretFilter(""); setPage(1); }}
              className={`px-3 py-1.5 rounded-md text-sm transition-colors border flex items-center gap-1.5 ${
                callbackSecretFilter === ""
                  ? "bg-primary text-primary-foreground border-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50 border-transparent"
              }`}
            >
              Any Secret
            </button>
            <button
              onClick={() => { setCallbackSecretFilter("false"); setPage(1); }}
              className={`px-3 py-1.5 rounded-md text-sm transition-colors border flex items-center gap-1.5 ${
                callbackSecretFilter === "false"
                  ? "bg-rose-500/20 text-rose-400 border-rose-500/40"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50 border-transparent"
              }`}
            >
              <KeyRound className="w-3.5 h-3.5" />
              No Secret
            </button>
            <button
              onClick={() => { setCallbackSecretFilter("true"); setPage(1); }}
              className={`px-3 py-1.5 rounded-md text-sm transition-colors border flex items-center gap-1.5 ${
                callbackSecretFilter === "true"
                  ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/40"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50 border-transparent"
              }`}
            >
              <KeyRound className="w-3.5 h-3.5" />
              Secret Set
            </button>
          </div>
          <div className="flex gap-1 flex-wrap items-center">
            <span className="text-xs text-muted-foreground pr-1">Login Alerts:</span>
            <button
              onClick={() => { setLoginAlertFilter(""); setPage(1); }}
              className={`px-3 py-1.5 rounded-md text-sm transition-colors border flex items-center gap-1.5 ${
                loginAlertFilter === ""
                  ? "bg-primary text-primary-foreground border-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50 border-transparent"
              }`}
            >
              Any
            </button>
            <button
              onClick={() => { setLoginAlertFilter("false"); setPage(1); }}
              className={`px-3 py-1.5 rounded-md text-sm transition-colors border flex items-center gap-1.5 ${
                loginAlertFilter === "false"
                  ? "bg-amber-500/20 text-amber-400 border-amber-500/40"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50 border-transparent"
              }`}
            >
              <BellOff className="w-3.5 h-3.5" />
              Alerts Off
            </button>
          </div>
          <div className="flex gap-1 flex-wrap items-center">
            <span className="text-xs text-muted-foreground pr-1">Security Emails:</span>
            <button
              onClick={() => { setSecurityEmailsDisabledFilter(""); setPage(1); }}
              className={`px-3 py-1.5 rounded-md text-sm transition-colors border flex items-center gap-1.5 ${
                securityEmailsDisabledFilter === ""
                  ? "bg-primary text-primary-foreground border-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50 border-transparent"
              }`}
            >
              Any
            </button>
            <button
              onClick={() => { setSecurityEmailsDisabledFilter("true"); setPage(1); }}
              className={`px-3 py-1.5 rounded-md text-sm transition-colors border flex items-center gap-1.5 ${
                securityEmailsDisabledFilter === "true"
                  ? "bg-amber-500/20 text-amber-400 border-amber-500/40"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50 border-transparent"
              }`}
            >
              <BellOff className="w-3.5 h-3.5" />
              Any Disabled
            </button>
          </div>
          <div className="flex gap-1 flex-wrap items-center">
            <span className="text-xs text-muted-foreground pr-1">Settlement Emails:</span>
            <button
              onClick={() => { setSettlementStateEmailsFilter(""); setPage(1); }}
              className={`px-3 py-1.5 rounded-md text-sm transition-colors border flex items-center gap-1.5 ${
                settlementStateEmailsFilter === ""
                  ? "bg-primary text-primary-foreground border-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50 border-transparent"
              }`}
            >
              Any
            </button>
            <button
              onClick={() => { setSettlementStateEmailsFilter("false"); setPage(1); }}
              className={`px-3 py-1.5 rounded-md text-sm transition-colors border flex items-center gap-1.5 ${
                settlementStateEmailsFilter === "false"
                  ? "bg-amber-500/20 text-amber-400 border-amber-500/40"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50 border-transparent"
              }`}
            >
              <BellOff className="w-3.5 h-3.5" />
              Opted Out
            </button>
          </div>
          <div className="flex gap-1 flex-wrap items-center">
            <span className="text-xs text-muted-foreground pr-1">Report Emails:</span>
            <button
              onClick={() => { setReportScheduleEmailsFilter(""); setPage(1); }}
              className={`px-3 py-1.5 rounded-md text-sm transition-colors border flex items-center gap-1.5 ${
                reportScheduleEmailsFilter === ""
                  ? "bg-primary text-primary-foreground border-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50 border-transparent"
              }`}
            >
              Any
            </button>
            <button
              onClick={() => { setReportScheduleEmailsFilter("false"); setPage(1); }}
              className={`px-3 py-1.5 rounded-md text-sm transition-colors border flex items-center gap-1.5 ${
                reportScheduleEmailsFilter === "false"
                  ? "bg-amber-500/20 text-amber-400 border-amber-500/40"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50 border-transparent"
              }`}
            >
              <BellOff className="w-3.5 h-3.5" />
              Opted Out
            </button>
          </div>
          <div className="flex gap-1 flex-wrap items-center">
            <span className="text-xs text-muted-foreground pr-1">Plan Expiry Alerts:</span>
            <button
              onClick={() => { setPlanExpiryAlertEmailsFilter(""); setPage(1); }}
              className={`px-3 py-1.5 rounded-md text-sm transition-colors border flex items-center gap-1.5 ${
                planExpiryAlertEmailsFilter === ""
                  ? "bg-primary text-primary-foreground border-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50 border-transparent"
              }`}
            >
              Any
            </button>
            <button
              onClick={() => { setPlanExpiryAlertEmailsFilter("false"); setPage(1); }}
              className={`px-3 py-1.5 rounded-md text-sm transition-colors border flex items-center gap-1.5 ${
                planExpiryAlertEmailsFilter === "false"
                  ? "bg-amber-500/20 text-amber-400 border-amber-500/40"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50 border-transparent"
              }`}
            >
              <BellOff className="w-3.5 h-3.5" />
              Opted Out
            </button>
          </div>
        </div>
        {(status === "rejected" || status === "all") && (
          <div className="relative max-w-sm">
            <XCircle className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Filter by rejection reason…"
              value={rejectionReasonFilter}
              onChange={e => handleRejectionReasonFilterChange(e.target.value)}
            />
          </div>
        )}
      </div>

      {/* Filter chips */}
      {(!!search || status !== "all" || !!expiryStatus || !!rejectionReasonFilter || !!callbackSecretFilter || !!loginAlertFilter || !!securityEmailsDisabledFilter || !!settlementStateEmailsFilter || !!reportScheduleEmailsFilter || !!planExpiryAlertEmailsFilter) && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground font-medium">Filters:</span>
          {!!search && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/40 bg-sky-500/10 px-3 py-1 text-xs font-medium text-sky-300">
              Search: {search}
              <button
                onClick={() => handleSearchChange("")}
                className="ml-0.5 rounded-full p-0.5 hover:bg-sky-500/20 transition-colors"
                aria-label="Clear search filter"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
          {status !== "all" && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/40 bg-sky-500/10 px-3 py-1 text-xs font-medium text-sky-300">
              Status: {status.charAt(0).toUpperCase() + status.slice(1)}
              <button
                onClick={() => handleStatusChange("all")}
                className="ml-0.5 rounded-full p-0.5 hover:bg-sky-500/20 transition-colors"
                aria-label="Clear status filter"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
          {expiryStatus === "expiring" && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-300">
              Expiring Soon
              <button
                onClick={() => handleExpiryChange("")}
                className="ml-0.5 rounded-full p-0.5 hover:bg-amber-500/20 transition-colors"
                aria-label="Clear expiry filter"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
          {expiryStatus === "expired" && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/40 bg-rose-500/10 px-3 py-1 text-xs font-medium text-rose-300">
              Expired Plan
              <button
                onClick={() => handleExpiryChange("")}
                className="ml-0.5 rounded-full p-0.5 hover:bg-rose-500/20 transition-colors"
                aria-label="Clear expiry filter"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
          {!!rejectionReasonFilter && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/40 bg-sky-500/10 px-3 py-1 text-xs font-medium text-sky-300">
              Reason: {rejectionReasonFilter}
              <button
                onClick={() => handleRejectionReasonFilterChange("")}
                className="ml-0.5 rounded-full p-0.5 hover:bg-sky-500/20 transition-colors"
                aria-label="Clear rejection reason filter"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
          {callbackSecretFilter === "false" && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/40 bg-rose-500/10 px-3 py-1 text-xs font-medium text-rose-300">
              No Secret
              <button
                onClick={() => { setCallbackSecretFilter(""); setPage(1); }}
                className="ml-0.5 rounded-full p-0.5 hover:bg-rose-500/20 transition-colors"
                aria-label="Clear callback secret filter"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
          {callbackSecretFilter === "true" && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
              Secret Set
              <button
                onClick={() => { setCallbackSecretFilter(""); setPage(1); }}
                className="ml-0.5 rounded-full p-0.5 hover:bg-emerald-500/20 transition-colors"
                aria-label="Clear callback secret filter"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
          {loginAlertFilter === "false" && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-300">
              <BellOff className="w-3 h-3" />
              Login Alerts Off
              <button
                onClick={() => { setLoginAlertFilter(""); setPage(1); }}
                className="ml-0.5 rounded-full p-0.5 hover:bg-amber-500/20 transition-colors"
                aria-label="Clear login alert filter"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
          {securityEmailsDisabledFilter === "true" && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-300">
              <BellOff className="w-3 h-3" />
              Security Email Disabled
              <button
                onClick={() => { setSecurityEmailsDisabledFilter(""); setPage(1); }}
                className="ml-0.5 rounded-full p-0.5 hover:bg-amber-500/20 transition-colors"
                aria-label="Clear security emails filter"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
          {settlementStateEmailsFilter === "false" && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-300">
              <BellOff className="w-3 h-3" />
              Settlement Emails Off
              <button
                onClick={() => { setSettlementStateEmailsFilter(""); setPage(1); }}
                className="ml-0.5 rounded-full p-0.5 hover:bg-amber-500/20 transition-colors"
                aria-label="Clear settlement state emails filter"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
          {reportScheduleEmailsFilter === "false" && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-300">
              <BellOff className="w-3 h-3" />
              Report Emails Off
              <button
                onClick={() => { setReportScheduleEmailsFilter(""); setPage(1); }}
                className="ml-0.5 rounded-full p-0.5 hover:bg-amber-500/20 transition-colors"
                aria-label="Clear report schedule emails filter"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
          {planExpiryAlertEmailsFilter === "false" && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-300">
              <BellOff className="w-3 h-3" />
              Plan Expiry Alerts Off
              <button
                onClick={() => { setPlanExpiryAlertEmailsFilter(""); setPage(1); }}
                className="ml-0.5 rounded-full p-0.5 hover:bg-amber-500/20 transition-colors"
                aria-label="Clear plan expiry alert emails filter"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
          <span className="ml-auto text-xs text-muted-foreground whitespace-nowrap">
            {isLoading
              ? <span className="inline-block w-24 h-3 bg-muted/60 rounded animate-pulse align-middle" />
              : <>{total.toLocaleString()} of {grandTotal.toLocaleString()} merchant{grandTotal !== 1 ? "s" : ""}</>}
          </span>
        </div>
      )}

      {/* Bulk action toolbar */}
      {selected.size > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5">
          <div className="flex items-center gap-3 flex-wrap">
            <Users className="w-4 h-4 text-primary shrink-0" />
            <span className="text-sm font-medium text-primary">
              {selectAllMode ? `All ${total} merchants selected` : `${selected.size} merchant${selected.size !== 1 ? "s" : ""} selected`}
              {!selectAllMode && selectedOffPage > 0 && (
                <span className="text-xs text-primary/60 ml-1.5">(includes {selectedOffPage} from other page{selectedOffPage !== 1 ? "s" : ""})</span>
              )}
            </span>
            <div className="flex gap-2 ml-auto flex-wrap">
              <Button
                size="sm"
                variant="outline"
                className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
                onClick={() => setBulkStatusAction("approve")}
              >
                <UserCheck className="w-3.5 h-3.5 mr-1.5" />
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-orange-400 border-orange-500/30 hover:bg-orange-500/10"
                onClick={() => setBulkStatusAction("suspend")}
              >
                <UserX className="w-3.5 h-3.5 mr-1.5" />
                Suspend
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-sky-400 border-sky-500/30 hover:bg-sky-500/10"
                onClick={() => setBulkStatusAction("reinstate")}
              >
                <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                Reinstate
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-rose-400 border-rose-500/30 hover:bg-rose-500/10"
                onClick={() => { setBulkRejectReason(""); setBulkRejectOpen(true); }}
              >
                <XCircle className="w-3.5 h-3.5 mr-1.5" />
                Reject
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-primary border-primary/30 hover:bg-primary/10"
                onClick={() => { setBulkPlanId(""); setBulkExpiresAt(""); setBulkNotes(""); setBulkDialogOpen(true); }}
              >
                <CreditCard className="w-3.5 h-3.5 mr-1.5" />
                Assign Plan
              </Button>
              <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={clearSelection}>
                Clear
              </Button>
            </div>
          </div>
          {/* Select all pages banner */}
          {!selectAllMode && allPageSelected && total > merchants.length && (
            <div className="text-xs text-center text-primary/70 border-t border-primary/20 pt-2">
              All {merchants.length} merchants on this page are selected.{" "}
              <button
                className="underline text-primary font-medium hover:text-primary/80"
                onClick={handleSelectAllPages}
              >
                Select all {total} merchants
              </button>
            </div>
          )}
          {selectAllMode && (
            <div className="text-xs text-center text-primary/70 border-t border-primary/20 pt-2">
              All {total} merchants are selected.{" "}
              <button
                className="underline text-primary font-medium hover:text-primary/80"
                onClick={clearSelection}
              >
                Clear selection
              </button>
            </div>
          )}
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={allPageSelected ? true : somePageSelected ? "indeterminate" : false}
                    onCheckedChange={toggleSelectAll}
                    aria-label="Select all on this page"
                  />
                </TableHead>
                <TableHead>Business</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Secret</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                [1,2,3,4,5].map(i => (
                  <TableRow key={i}>
                    {[1,2,3,4,5,6,7,8,9].map(j => <TableCell key={j}><div className="h-4 bg-muted/50 animate-pulse rounded" /></TableCell>)}
                  </TableRow>
                ))
              ) : merchants.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-10">No merchants found</TableCell>
                </TableRow>
              ) : merchants.map(merchant => (
                <TableRow key={merchant.id} className={selected.has(merchant.id) ? "bg-primary/5" : undefined}>
                  <TableCell>
                    <Checkbox
                      checked={selected.has(merchant.id)}
                      onCheckedChange={() => toggleSelect(merchant.id)}
                      aria-label={`Select ${merchant.businessName}`}
                    />
                  </TableCell>
                  <TableCell>
                    <div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="font-medium">{merchant.businessName}</p>
                        {(webhookFailureCounts[merchant.id] ?? 0) > 0 && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-amber-400 hover:bg-amber-500/20 transition-colors cursor-pointer"
                                  onClick={e => {
                                    e.stopPropagation();
                                    openAssignPlan(merchant.id, merchant.businessName, merchant.callbackTimestampWindowSeconds, merchant.loginAlertEmails, merchant.signatureFailureAlertEmails, merchant.webhookFailureEmails, merchant.apiKeyGeneratedEmails, merchant.apiKeyRevokedEmails, merchant.reportScheduleChangedEmails, merchant.settlementStateChangedEmails, merchant.planExpiryAlertEmails);
                                    setScrollToAlerts(true);
                                  }}
                                  aria-label={`${webhookFailureCounts[merchant.id]} webhook failure alert${webhookFailureCounts[merchant.id] !== 1 ? "s" : ""}`}
                                >
                                  <AlertTriangle className="w-3 h-3 shrink-0" />
                                  <span className="text-[11px] font-semibold tabular-nums leading-none">{webhookFailureCounts[merchant.id]}</span>
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="text-xs">
                                {webhookFailureCounts[merchant.id]} webhook failure alert{webhookFailureCounts[merchant.id] !== 1 ? "s" : ""} — click to view
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                        {merchant.loginAlertEmails === false && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 p-0.5 text-amber-400" aria-label="Login alerts disabled">
                                  <BellOff className="w-3 h-3 shrink-0" />
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="text-xs">
                                Login alerts disabled
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">{merchant.email}</p>
                      {merchant.status === "rejected" && merchant.rejectionReason && (
                        <p className="text-xs text-rose-400 mt-0.5 max-w-[200px] truncate" title={merchant.rejectionReason}>
                          ✕ {merchant.rejectionReason}
                        </p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div>
                      <p className="text-sm">{merchant.contactName}</p>
                      <p className="text-xs text-muted-foreground">{merchant.phone}</p>
                    </div>
                  </TableCell>
                  <TableCell><StatusBadge status={merchant.status} /></TableCell>
                  <TableCell>
                    {merchant.currentPlanName ? (
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-sm font-medium">{merchant.currentPlanName}</span>
                          {merchant.currentPlanIsExpired ? (
                            <Badge variant="outline" className="text-xs py-0 text-rose-400 border-rose-500/30 bg-rose-500/10">
                              Expired
                            </Badge>
                          ) : (() => {
                            if (!merchant.currentPlanExpiresAt) return null;
                            const msLeft = new Date(merchant.currentPlanExpiresAt).getTime() - now;
                            if (msLeft > 0 && msLeft <= 7 * 86400000) {
                              return (
                                <Badge variant="outline" className="text-xs py-0 text-amber-400 border-amber-500/30 bg-amber-500/10">
                                  Expires soon
                                </Badge>
                              );
                            }
                            return null;
                          })()}
                          {merchant.currentPlanStatus && merchant.currentPlanStatus !== "active" && !merchant.currentPlanIsExpired && (
                            <Badge
                              variant="outline"
                              className={`text-xs py-0 ${PLAN_SUB_STATUS_COLOR[merchant.currentPlanStatus] ?? ""}`}
                            >
                              {merchant.currentPlanStatus}
                            </Badge>
                          )}
                        </div>
                        {merchant.currentPlanExpiresAt && (
                          <span className={`text-xs ${merchant.currentPlanIsExpired ? "text-rose-400" : "text-muted-foreground"}`}>
                            {merchant.currentPlanIsExpired ? "Expired " : "Expires "}
                            {format(new Date(merchant.currentPlanExpiresAt), "MMM d, yyyy")}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground italic">No plan</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {merchant.callbackSecretSet ? (
                      <Badge variant="outline" className="text-xs py-0 text-emerald-400 border-emerald-500/30 bg-emerald-500/10 gap-1">
                        <KeyRound className="w-3 h-3" />
                        Set
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs py-0 text-rose-400 border-rose-500/30 bg-rose-500/10 gap-1">
                        <KeyRound className="w-3 h-3" />
                        Not Set
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">₹{Number(merchant.balance).toLocaleString()}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{format(new Date(merchant.createdAt), "MMM d, yyyy")}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {merchant.status === "pending" && (
                        <>
                          <Button size="sm" variant="ghost" className="text-emerald-500 hover:bg-emerald-500/10" onClick={() => handleApprove(merchant.id)}>
                            <CheckCircle className="w-4 h-4 mr-1" /> Approve
                          </Button>
                          <Button size="sm" variant="ghost" className="text-rose-500 hover:bg-rose-500/10" onClick={() => { setRejectId(merchant.id); setRejectReason(""); }}>
                            <XCircle className="w-4 h-4 mr-1" /> Reject
                          </Button>
                        </>
                      )}
                      {merchant.status === "approved" && (
                        <Button size="sm" variant="ghost" className="text-orange-500 hover:bg-orange-500/10" onClick={() => handleSuspend(merchant.id)}>
                          <ShieldOff className="w-4 h-4 mr-1" /> Suspend
                        </Button>
                      )}
                      {merchant.status === "suspended" && (
                        <Button size="sm" variant="ghost" className="text-emerald-500 hover:bg-emerald-500/10" onClick={() => handleUnsuspend(merchant.id)}>
                          <ShieldCheck className="w-4 h-4 mr-1" /> Reinstate
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" className="text-primary hover:bg-primary/10" onClick={() => openAssignPlan(merchant.id, merchant.businessName, merchant.callbackTimestampWindowSeconds, merchant.loginAlertEmails, merchant.signatureFailureAlertEmails, merchant.webhookFailureEmails, merchant.apiKeyGeneratedEmails, merchant.apiKeyRevokedEmails, merchant.reportScheduleChangedEmails, merchant.settlementStateChangedEmails, merchant.planExpiryAlertEmails)}>
                        <CreditCard className="w-4 h-4 mr-1" /> {merchant.currentPlanName ? "Change Plan" : "Assign Plan"}
                      </Button>
                      <Button size="sm" variant="ghost" className="text-violet-400 hover:bg-violet-500/10" onClick={() => openBranding(merchant)}>
                        <Paintbrush className="w-4 h-4 mr-1" /> Branding
                      </Button>
                      <Button size="sm" variant="ghost" className="text-sky-400 hover:bg-sky-500/10" onClick={() => { setWebhookLogsMerchant({ id: merchant.id, name: merchant.businessName }); setWebhookLogsStatus("all"); setWebhookLogsPage(1); }}>
                        <Activity className="w-4 h-4 mr-1" /> Webhooks
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex justify-center items-center gap-3 text-sm">
          <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button>
          <span className="text-muted-foreground">Page {page} of {totalPages}</span>
          <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>Next</Button>
        </div>
      )}

      {/* Reject Dialog */}
      <Dialog open={!!rejectId} onOpenChange={() => { setRejectId(null); setRejectReason(""); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject Merchant</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <Label>Rejection reason *</Label>
            <Textarea placeholder="Explain why this merchant is being rejected..." rows={3} value={rejectReason} onChange={e => setRejectReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRejectId(null); setRejectReason(""); }}>Cancel</Button>
            <Button variant="destructive" onClick={handleReject} disabled={!rejectReason.trim() || rejectMutation.isPending}>
              {rejectMutation.isPending ? "Rejecting..." : "Reject Merchant"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Reject Dialog */}
      <Dialog open={bulkRejectOpen} onOpenChange={open => { if (!open) { setBulkRejectOpen(false); setBulkRejectReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <XCircle className="w-4 h-4 text-rose-400" />
              Reject {selected.size} Merchant{selected.size !== 1 ? "s" : ""}
            </DialogTitle>
            <DialogDescription>
              Provide a shared rejection reason. This will be applied to all {selected.size} selected merchant{selected.size !== 1 ? "s" : ""}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label>Rejection reason *</Label>
            <Textarea
              placeholder="Explain why these merchants are being rejected..."
              rows={3}
              value={bulkRejectReason}
              onChange={e => setBulkRejectReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setBulkRejectOpen(false); setBulkRejectReason(""); }}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={handleBulkReject}
              disabled={!bulkRejectReason.trim() || bulkRejectMutation.isPending}
            >
              {bulkRejectMutation.isPending ? "Rejecting..." : `Reject ${selected.size} Merchant${selected.size !== 1 ? "s" : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Branding Dialog */}
      <Dialog open={!!brandingMerchant} onOpenChange={closeBranding}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Paintbrush className="w-4 h-4 text-violet-400" /> Branding — {brandingMerchant?.name}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            {/* Current saved logo thumbnail */}
            {brandingMerchant?.logoUrl && !brandingIsReplacing ? (
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-medium mb-2">Current Logo</p>
                  <div className="flex items-center gap-4 p-3 bg-muted/30 rounded-lg border border-border/50">
                    {brandingSavedLogoError ? (
                      <span className="text-xs text-rose-400 flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5" /> Logo can't be loaded
                      </span>
                    ) : (
                      <img
                        src={brandingMerchant.logoUrl}
                        alt="Current logo"
                        className="h-8 max-w-[120px] object-contain rounded"
                        onError={() => setBrandingSavedLogoError(true)}
                        onLoad={() => setBrandingSavedLogoError(false)}
                      />
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={() => { setBrandingIsReplacing(true); setBrandingLogoUrl(brandingMerchant.logoUrl ?? ""); setBrandingLogoError(false); }}
                  >
                    <Upload className="w-3.5 h-3.5" /> Replace
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="gap-1 text-muted-foreground"
                    onClick={() => { setBrandingLogoUrl(""); setBrandingLogoError(false); setBrandingSavedLogoError(false); setBrandingIsReplacing(true); }}
                  >
                    <X className="w-3.5 h-3.5" /> Remove
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label>Upload Logo File</Label>
                  <div className="flex items-center gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      disabled={isUploadingLogo}
                      onClick={() => brandingFileInputRef.current?.click()}
                    >
                      {isUploadingLogo ? (
                        <><Loader2 className="w-4 h-4 animate-spin" /> Uploading…</>
                      ) : (
                        <><Upload className="w-4 h-4" /> Choose File</>
                      )}
                    </Button>
                    {brandingLogoUrl && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="gap-1 text-muted-foreground"
                        onClick={() => { setBrandingLogoUrl(""); setBrandingLogoError(false); }}
                      >
                        <X className="w-3.5 h-3.5" /> Clear
                      </Button>
                    )}
                    {brandingIsReplacing && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="gap-1 text-muted-foreground"
                        onClick={() => { setBrandingLogoUrl(brandingMerchant?.logoUrl ?? ""); setBrandingLogoError(false); setBrandingIsReplacing(false); }}
                      >
                        Cancel
                      </Button>
                    )}
                    <input
                      ref={brandingFileInputRef}
                      type="file"
                      accept="image/png,image/svg+xml,image/webp,image/jpeg,image/gif"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) uploadLogo(file);
                        e.target.value = "";
                      }}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="adminLogoUrl">Or paste a URL</Label>
                  <Input
                    id="adminLogoUrl"
                    placeholder="https://yourbrand.com/logo.png"
                    value={brandingLogoUrl}
                    onChange={e => { setBrandingLogoUrl(e.target.value); setBrandingLogoError(false); }}
                  />
                  {brandingLogoUrl && (
                    <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg border border-border/50">
                      <p className="text-xs text-muted-foreground shrink-0">Preview:</p>
                      {brandingLogoError ? (
                        <span className="text-xs text-rose-400">Could not load image</span>
                      ) : (
                        <img
                          src={brandingLogoUrl}
                          alt="logo"
                          className="h-8 max-w-[120px] object-contain rounded"
                          onError={() => setBrandingLogoError(true)}
                          onLoad={() => setBrandingLogoError(false)}
                        />
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
            <div className="space-y-2">
              <Label htmlFor="adminBrandColor">Brand Colour</Label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={brandingColor && /^#[0-9a-f]{3,8}$/i.test(brandingColor) ? brandingColor : "#6366f1"}
                  onChange={e => setBrandingColor(e.target.value)}
                  className="h-9 w-12 cursor-pointer rounded border border-input bg-transparent p-0.5"
                />
                <Input
                  id="adminBrandColor"
                  placeholder="#6366f1"
                  value={brandingColor}
                  onChange={e => setBrandingColor(e.target.value)}
                  className="max-w-[160px] font-mono"
                />
                {brandingColor && /^#[0-9a-f]{3,8}$/i.test(brandingColor) && (
                  <div className="w-6 h-6 rounded-full border border-white/20" style={{ background: brandingColor }} />
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeBranding}>Cancel</Button>
            <Button onClick={handleSaveBranding} disabled={updateBrandingMutation.isPending}>
              {updateBrandingMutation.isPending ? "Saving…" : "Save Branding"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Webhook Logs Dialog */}
      <Dialog open={!!webhookLogsMerchant} onOpenChange={open => { if (!open) setWebhookLogsMerchant(null); }}>
        <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-sky-400" />
              Webhook Deliveries — {webhookLogsMerchant?.name}
            </DialogTitle>
            <DialogDescription className="flex items-center gap-2">
              Callback log history for this merchant.{" "}
              <a
                href={`/admin/callbacks`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline text-xs"
              >
                View all in Callback Logs <ExternalLink className="w-3 h-3" />
              </a>
            </DialogDescription>
          </DialogHeader>

          {/* Status filter */}
          <div className="flex gap-1 flex-wrap shrink-0">
            {(["all", "failed", "pending_retry", "success"] as const).map(s => {
              const label = s === "all" ? "All" : s === "pending_retry" ? "Pending Retry" : s.charAt(0).toUpperCase() + s.slice(1);
              const activeClass = s === "all"
                ? "bg-primary text-primary-foreground border-primary"
                : s === "failed"
                  ? "bg-rose-500/20 text-rose-400 border-rose-500/40"
                  : s === "pending_retry"
                    ? "bg-amber-500/20 text-amber-400 border-amber-500/40"
                    : "bg-emerald-500/20 text-emerald-400 border-emerald-500/40";
              const isActive = webhookLogsStatus === s;
              return (
                <button
                  key={s}
                  onClick={() => { setWebhookLogsStatus(s); setWebhookLogsPage(1); }}
                  className={`px-3 py-1.5 rounded-md text-xs transition-colors border ${isActive ? activeClass : "text-muted-foreground hover:text-foreground hover:bg-muted/50 border-transparent"}`}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* Table */}
          <div className="flex-1 overflow-auto min-h-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>URL</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>HTTP</TableHead>
                  <TableHead className="text-center">Attempts</TableHead>
                  <TableHead>Last Attempt</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {webhookLogsLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 7 }).map((_, j) => (
                        <TableCell key={j}><div className="h-4 bg-muted/50 rounded animate-pulse" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : !webhookLogsData?.data?.length ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-10">
                      No webhook deliveries found
                    </TableCell>
                  </TableRow>
                ) : (
                  webhookLogsData.data.map(log => (
                    <MerchantWebhookRow
                      key={log.id}
                      log={log}
                      onRetry={(id) => retryWebhookLog({ id })}
                      isRetrying={isRetryingWebhookLog}
                    />
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {(webhookLogsData?.total ?? 0) > 20 && (
            <div className="flex justify-between items-center shrink-0 pt-2 border-t border-border/40">
              <span className="text-xs text-muted-foreground">{webhookLogsData!.total} total</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setWebhookLogsPage(p => Math.max(1, p - 1))} disabled={webhookLogsPage === 1}>Previous</Button>
                <Button variant="outline" size="sm" onClick={() => setWebhookLogsPage(p => p + 1)} disabled={webhookLogsPage * 20 >= (webhookLogsData?.total ?? 0)}>Next</Button>
              </div>
            </div>
          )}

          <DialogFooter className="shrink-0">
            <Button variant="outline" onClick={() => setWebhookLogsMerchant(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Status Action Confirmation Dialog */}
      <Dialog open={!!bulkStatusAction} onOpenChange={open => { if (!open) setBulkStatusAction(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {bulkStatusAction === "approve" && <UserCheck className="w-4 h-4 text-emerald-400" />}
              {bulkStatusAction === "suspend" && <UserX className="w-4 h-4 text-orange-400" />}
              {bulkStatusAction === "reinstate" && <RotateCcw className="w-4 h-4 text-sky-400" />}
              {bulkStatusAction === "approve" && "Approve Merchants"}
              {bulkStatusAction === "suspend" && "Suspend Merchants"}
              {bulkStatusAction === "reinstate" && "Reinstate Merchants"}
            </DialogTitle>
            <DialogDescription>
              {bulkStatusAction === "approve" && `Approve ${selected.size} selected merchant${selected.size !== 1 ? "s" : ""}? Their accounts will become active.`}
              {bulkStatusAction === "suspend" && `Suspend ${selected.size} selected merchant${selected.size !== 1 ? "s" : ""}? They will lose access until reinstated.`}
              {bulkStatusAction === "reinstate" && `Reinstate ${selected.size} selected merchant${selected.size !== 1 ? "s" : ""}? Their accounts will be reactivated.`}
            </DialogDescription>
          </DialogHeader>
          {settlementStateOptOutCount > 0 && (
            <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-amber-400">
              <BellOff className="w-4 h-4 shrink-0 mt-0.5" />
              <p className="text-xs leading-relaxed">
                <span className="font-semibold">{optOutDataIsPartial ? "At least" : ""} {settlementStateOptOutCount} of {selected.size} merchant{settlementStateOptOutCount !== 1 ? "s" : ""}</span>
                {" "}ha{settlementStateOptOutCount !== 1 ? "ve" : "s"} opted out of settlement state change emails and will not receive a notification.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkStatusAction(null)} disabled={isBulkStatusPending}>Cancel</Button>
            <Button
              onClick={handleBulkStatusAction}
              disabled={isBulkStatusPending}
              className={
                bulkStatusAction === "approve" ? "bg-emerald-600 hover:bg-emerald-700 text-white" :
                bulkStatusAction === "suspend" ? "bg-orange-600 hover:bg-orange-700 text-white" :
                "bg-sky-600 hover:bg-sky-700 text-white"
              }
            >
              {isBulkStatusPending ? "Processing..." :
                bulkStatusAction === "approve" ? `Approve ${selected.size}` :
                bulkStatusAction === "suspend" ? `Suspend ${selected.size}` :
                `Reinstate ${selected.size}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Assign Plan Dialog */}
      <Dialog open={bulkDialogOpen} onOpenChange={open => { if (!open) closeBulkDialog(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Bulk Assign Plan</DialogTitle>
            <DialogDescription>
              Assign a plan to {selected.size} selected merchant{selected.size !== 1 ? "s" : ""}. This will replace any existing plan.
            </DialogDescription>
          </DialogHeader>
          {reportScheduleOptOutCount > 0 && (
            <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-amber-400">
              <BellOff className="w-4 h-4 shrink-0 mt-0.5" />
              <p className="text-xs leading-relaxed">
                <span className="font-semibold">{optOutDataIsPartial ? "At least" : ""} {reportScheduleOptOutCount} of {selected.size} merchant{reportScheduleOptOutCount !== 1 ? "s" : ""}</span>
                {" "}ha{reportScheduleOptOutCount !== 1 ? "ve" : "s"} opted out of plan assignment emails and will not receive a notification.
              </p>
            </div>
          )}
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Select Plan *</Label>
              <Select value={bulkPlanId} onValueChange={setBulkPlanId}>
                <SelectTrigger><SelectValue placeholder="Choose a plan..." /></SelectTrigger>
                <SelectContent>
                  {plans?.map(plan => (
                    <SelectItem key={plan.id} value={String(plan.id)}>
                      {plan.name}
                      {plan.monthlyFee !== "0" ? ` — ₹${parseInt(plan.monthlyFee).toLocaleString()}/mo` : " — Free"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {bulkPlanId && plans && (() => {
              const plan = plans.find(p => String(p.id) === bulkPlanId);
              if (!plan) return null;
              return (
                <div className="rounded-lg border border-border/50 bg-muted/20 p-3 space-y-2">
                  <p className="text-sm font-medium">{plan.name}</p>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-muted-foreground">
                    <span>Dynamic QR: {plan.dynamicQrLimit >= 999 ? "∞" : plan.dynamicQrLimit}</span>
                    <span>Virtual Accounts: {plan.virtualAccountLimit >= 999 ? "∞" : plan.virtualAccountLimit}</span>
                    <span>Settlement: {plan.settlementFee}%</span>
                    <span>Daily Tx: {plan.dailyTransactionLimit >= 999 ? "∞" : plan.dailyTransactionLimit}</span>
                    <span>API: {plan.apiAccess ? "✓ Enabled" : "✗ Disabled"}</span>
                    <span>Webhooks: {plan.webhookAccess ? "✓ Enabled" : "✗ Disabled"}</span>
                  </div>
                </div>
              );
            })()}

            {(() => {
              const plan = bulkPlanId ? plans?.find(p => String(p.id) === bulkPlanId) : undefined;
              const isPaid = plan && plan.monthlyFee !== "0" && plan.name.toLowerCase() !== "custom";
              return (
                <div className="space-y-2">
                  <Label className="flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5" />
                    Plan Expiry Date{isPaid ? <span className="text-rose-400">*</span> : <span className="text-muted-foreground">(optional)</span>}
                  </Label>
                  <Input type="date" value={bulkExpiresAt} onChange={e => setBulkExpiresAt(e.target.value)} min={new Date().toISOString().split("T")[0]} />
                  {isPaid && !bulkExpiresAt ? (
                    <div className="flex items-start gap-2.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-rose-400">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      <p className="text-xs leading-relaxed">
                        <span className="font-semibold">Expiry date is required</span> for paid plans ({plan.name}).
                        Set a date to enable the assign button.
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">{isPaid ? "" : "Leave empty for no expiry."}</p>
                  )}
                </div>
              );
            })()}

            {/* Short / far expiry warnings — bulk */}
            {bulkExpiresAt && (() => {
              const days = Math.round((new Date(bulkExpiresAt).getTime() - Date.now()) / 86400000);
              if (days < 7) return (
                <div className="flex items-start gap-2.5 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2.5 text-yellow-400">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <p className="text-xs leading-relaxed">
                    <span className="font-semibold">This plan expires very soon</span> — did you mean a longer period?
                  </p>
                </div>
              );
              if (days > 730) return (
                <div className="flex items-start gap-2.5 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2.5 text-yellow-400">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <p className="text-xs leading-relaxed">
                    <span className="font-semibold">This expiry date is over 2 years away</span> — please confirm.
                  </p>
                </div>
              );
              return null;
            })()}

            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Textarea placeholder="e.g. Batch onboarding, promo upgrade..." rows={2} value={bulkNotes} onChange={e => setBulkNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeBulkDialog}>Cancel</Button>
            {bulkPlanId && (
              <Button
                variant="outline"
                className="text-violet-400 border-violet-500/30 hover:bg-violet-500/10 gap-1.5"
                disabled={planEmailPreviewLoading}
                onClick={handlePreviewBulkPlanEmail}
              >
                {planEmailPreviewLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
                Preview Email
              </Button>
            )}
            {(() => {
              const plan = bulkPlanId ? plans?.find(p => String(p.id) === bulkPlanId) : undefined;
              const isPaid = plan && plan.monthlyFee !== "0" && plan.name.toLowerCase() !== "custom";
              const missingExpiry = isPaid && !bulkExpiresAt;
              return (
                <Button onClick={handleBulkAssign} disabled={!bulkPlanId || !!missingExpiry || bulkAssignMutation.isPending}>
                  {bulkAssignMutation.isPending ? "Assigning..." : `Assign to ${selected.size} Merchant${selected.size !== 1 ? "s" : ""}`}
                </Button>
              );
            })()}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign Plan Dialog */}
      <Dialog open={!!assignPlanMerchant} onOpenChange={closeAssignPlan}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Assign Plan — {assignPlanMerchant?.name}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            {/* Current Plan */}
            {planLoading ? (
              <div className="rounded-lg border border-border/50 bg-muted/10 p-3 animate-pulse h-12" />
            ) : currentMerchantPlan ? (
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-primary shrink-0" />
                  <div className="flex-1">
                    <p className="text-xs text-muted-foreground">Current Plan</p>
                    <p className="text-sm font-semibold">{currentMerchantPlan.planName}</p>
                  </div>
                  {currentMerchantPlan.isExpired && <Badge variant="destructive" className="text-xs">Expired</Badge>}
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                  <div>
                    <span className="block font-medium text-foreground">{currentMerchantPlan.settlementFee}%</span>
                    Settlement
                  </div>
                  <div>
                    <span className="block font-medium text-foreground">{currentMerchantPlan.apiAccess ? "✓" : "✗"}</span>
                    API Access
                  </div>
                  <div>
                    <span className="block font-medium text-foreground">
                      {currentMerchantPlan.expiresAt
                        ? (currentMerchantPlan.isExpired ? "Expired" : format(new Date(currentMerchantPlan.expiresAt), "MMM d, yyyy"))
                        : "No expiry"}
                    </span>
                    Expiry
                  </div>
                </div>
                {currentMerchantPlan.scheduledRenewalAt && (
                  <div className="flex items-center gap-2 rounded-md border border-violet-500/30 bg-violet-500/10 px-2.5 py-2 text-xs text-violet-400">
                    <Clock className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      <span className="font-semibold">Auto-renewal scheduled</span> for{" "}
                      {format(new Date(currentMerchantPlan.scheduledRenewalAt), "MMM d, yyyy")}
                      {new Date(currentMerchantPlan.scheduledRenewalAt) <= new Date() && (
                        <span className="ml-1 text-rose-400 font-semibold">(overdue — will process within the hour)</span>
                      )}
                    </span>
                  </div>
                )}

                {/* QR Code lifecycle breakdown */}
                {merchantPlanUsage && (
                  <div className="border-t border-primary/10 pt-2 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">QR Code Usage</p>
                      <button
                        type="button"
                        className="text-xs text-primary hover:underline flex items-center gap-1"
                        onClick={() => {
                          const name = encodeURIComponent(assignPlanMerchant?.name ?? "");
                          closeAssignPlan();
                          navigate(`/admin/qr-codes?merchant=${name}`);
                        }}
                      >
                        View QR Codes →
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-md bg-background/50 border border-border/40 px-2.5 py-2 space-y-1.5">
                        <p className="text-xs font-medium text-foreground">Dynamic QR</p>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                          <span className="text-emerald-400">
                            <span className="font-semibold">{merchantPlanUsage.dynamicQr.used}</span>
                            <span className="text-muted-foreground"> active</span>
                          </span>
                          <span className="text-sky-400">
                            <span className="font-semibold">{merchantPlanUsage.dynamicQr.usedCount ?? 0}</span>
                            <span className="text-muted-foreground"> used</span>
                          </span>
                          <span className="text-rose-400">
                            <span className="font-semibold">{merchantPlanUsage.dynamicQr.expiredCount ?? 0}</span>
                            <span className="text-muted-foreground"> expired</span>
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Limit: {merchantPlanUsage.dynamicQr.limit >= 999 ? "∞" : merchantPlanUsage.dynamicQr.limit}
                        </div>
                      </div>
                      <div className="rounded-md bg-background/50 border border-border/40 px-2.5 py-2 space-y-1.5">
                        <p className="text-xs font-medium text-foreground">Static QR</p>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                          <span className="text-emerald-400">
                            <span className="font-semibold">{merchantPlanUsage.staticQr.used}</span>
                            <span className="text-muted-foreground"> active</span>
                          </span>
                          <span className="text-sky-400">
                            <span className="font-semibold">{merchantPlanUsage.staticQr.usedCount ?? 0}</span>
                            <span className="text-muted-foreground"> used</span>
                          </span>
                          <span className="text-rose-400">
                            <span className="font-semibold">{merchantPlanUsage.staticQr.expiredCount ?? 0}</span>
                            <span className="text-muted-foreground"> expired</span>
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Limit: {merchantPlanUsage.staticQr.limit >= 999 ? "∞" : merchantPlanUsage.staticQr.limit}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Other resource usage breakdown */}
                {merchantPlanUsage && (
                  <div className="border-t border-primary/10 pt-2 space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Other Resources</p>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="rounded-md bg-background/50 border border-border/40 px-2.5 py-2 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-medium text-foreground">Virtual Accounts</p>
                          <button
                            type="button"
                            className="text-xs text-primary hover:underline flex items-center gap-1"
                            onClick={() => {
                              const name = encodeURIComponent(assignPlanMerchant?.name ?? "");
                              closeAssignPlan();
                              navigate(`/admin/virtual-accounts?merchant=${name}`);
                            }}
                          >
                            View →
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                          <span className="text-emerald-400">
                            <span className="font-semibold">{merchantPlanUsage.virtualAccount.used}</span>
                            <span className="text-muted-foreground"> active</span>
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Limit: {merchantPlanUsage.virtualAccount.limit >= 999 ? "∞" : merchantPlanUsage.virtualAccount.limit}
                        </div>
                      </div>
                      <div className="rounded-md bg-background/50 border border-border/40 px-2.5 py-2 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-medium text-foreground">Payment Links</p>
                          <button
                            type="button"
                            className="text-xs text-primary hover:underline flex items-center gap-1"
                            onClick={() => {
                              const name = encodeURIComponent(assignPlanMerchant?.name ?? "");
                              closeAssignPlan();
                              navigate(`/admin/payment-links?merchant=${name}`);
                            }}
                          >
                            View →
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                          <span className="text-emerald-400">
                            <span className="font-semibold">{merchantPlanUsage.paymentLink.used}</span>
                            <span className="text-muted-foreground"> active</span>
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Limit: {merchantPlanUsage.paymentLink.limit >= 999 ? "∞" : merchantPlanUsage.paymentLink.limit}
                        </div>
                      </div>
                      <div className="rounded-md bg-background/50 border border-border/40 px-2.5 py-2 space-y-1.5">
                        <p className="text-xs font-medium text-foreground">Payouts</p>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                          <span className="text-sky-400">
                            <span className="font-semibold">{merchantPlanUsage.payout.used}</span>
                            <span className="text-muted-foreground"> this cycle</span>
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Limit: {merchantPlanUsage.payout.limit >= 999 ? "∞" : merchantPlanUsage.payout.limit}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-muted-foreground/30 bg-muted/5 p-3 flex items-center gap-2 text-muted-foreground">
                <CreditCard className="w-4 h-4 shrink-0" />
                <p className="text-xs">No plan currently assigned</p>
              </div>
            )}

            {/* Security Email Preferences */}
            <div className="rounded-lg border border-border/50 bg-muted/10 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <BellOff className="w-4 h-4 text-muted-foreground shrink-0" />
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Security Email Preferences</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    { key: "loginAlertEmails", label: "Login Alerts" },
                    { key: "signatureFailureAlertEmails", label: "Signature Failures" },
                    { key: "webhookFailureEmails", label: "Webhook Failures" },
                    { key: "apiKeyGeneratedEmails", label: "API Key Generated" },
                    { key: "apiKeyRevokedEmails", label: "API Key Revoked" },
                  ] as const
                ).map(({ key, label }) => {
                  const enabled = assignPlanMerchant?.[key] !== false;
                  return (
                    <span
                      key={key}
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium border ${
                        enabled
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                          : "bg-amber-500/10 text-amber-400 border-amber-500/30"
                      }`}
                    >
                      {enabled ? (
                        <CheckCircle className="w-3 h-3 shrink-0" />
                      ) : (
                        <BellOff className="w-3 h-3 shrink-0" />
                      )}
                      {label}
                    </span>
                  );
                })}
              </div>
            </div>

            {/* Notification Preferences */}
            <div className="rounded-lg border border-border/50 bg-muted/10 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Bell className="w-4 h-4 text-muted-foreground shrink-0" />
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Notification Preferences</p>
                {(() => {
                  const allEmailKeys = [
                    "loginAlertEmails", "signatureFailureAlertEmails", "webhookFailureEmails",
                    "apiKeyGeneratedEmails", "apiKeyRevokedEmails",
                    "reportScheduleChangedEmails", "settlementStateChangedEmails", "planExpiryAlertEmails",
                  ] as const;
                  const disabledCount = allEmailKeys.filter(k => assignPlanMerchant?.[k] === false).length;
                  const total = allEmailKeys.length;
                  return disabledCount > 0 ? (
                    <span className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30">
                      <BellOff className="w-2.5 h-2.5 shrink-0" />
                      {disabledCount} of {total} disabled
                    </span>
                  ) : (
                    <span className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                      <CheckCircle className="w-2.5 h-2.5 shrink-0" />
                      All enabled
                    </span>
                  );
                })()}
              </div>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    { key: "reportScheduleChangedEmails", label: "Report Schedule Changes" },
                    { key: "settlementStateChangedEmails", label: "Settlement State Changes" },
                    { key: "planExpiryAlertEmails", label: "Plan Expiry Alerts" },
                  ] as const
                ).map(({ key, label }) => {
                  const enabled = assignPlanMerchant?.[key] !== false;
                  return (
                    <span
                      key={key}
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium border ${
                        enabled
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                          : "bg-amber-500/10 text-amber-400 border-amber-500/30"
                      }`}
                    >
                      {enabled ? (
                        <CheckCircle className="w-3 h-3 shrink-0" />
                      ) : (
                        <BellOff className="w-3 h-3 shrink-0" />
                      )}
                      {label}
                    </span>
                  );
                })}
              </div>
              <p className="text-[11px] text-muted-foreground/60">
                Opted-out merchants will not receive these emails even when triggered by admin actions.
              </p>
            </div>

            {/* Callback Secret */}
            <div className="rounded-lg border border-border/50 bg-muted/10 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-muted-foreground shrink-0" />
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Callback Signing Secret</p>
                </div>
                <button
                  type="button"
                  className="text-xs text-sky-400 hover:underline flex items-center gap-1 shrink-0"
                  onClick={() => {
                    if (!assignPlanMerchant) return;
                    setWebhookLogsMerchant({ id: assignPlanMerchant.id, name: assignPlanMerchant.name });
                    setWebhookLogsStatus("all");
                    setWebhookLogsPage(1);
                  }}
                >
                  <Activity className="w-3 h-3" /> View Webhook Logs →
                </button>
              </div>
              {callbackSecretStatus == null ? (
                <div className="animate-pulse h-5 bg-muted/30 rounded w-32" />
              ) : callbackSecretStatus.isSet ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span className="text-xs text-emerald-400 font-medium">Set</span>
                    {callbackSecretStatus.secretPrefix && (
                      <span className="font-mono text-xs text-muted-foreground">{callbackSecretStatus.secretPrefix}</span>
                    )}
                  </div>
                  {callbackSecretStatus.lastRotatedAt && (() => {
                    const ageDays = Math.floor((now - new Date(callbackSecretStatus.lastRotatedAt).getTime()) / 86400000);
                    const isOverdue = ageDays >= SECRET_ROTATION_OVERDUE_DAYS;
                    const isWarn = ageDays >= SECRET_WARN_DAYS && !isOverdue;
                    const daysLeft = SECRET_ROTATION_OVERDUE_DAYS - ageDays;
                    return (
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs text-muted-foreground">
                            Last rotated {ageDays === 0 ? "today" : `${ageDays} day${ageDays !== 1 ? "s" : ""} ago`}
                            <span className="text-muted-foreground/60"> ({format(new Date(callbackSecretStatus.lastRotatedAt), "dd MMM yyyy")})</span>
                          </span>
                          {isOverdue ? (
                            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-rose-500/15 text-rose-400 border border-rose-500/30">
                              <span className="w-1.5 h-1.5 rounded-full bg-rose-400 inline-block" />
                              Overdue
                            </span>
                          ) : isWarn ? (
                            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
                              Rotation recommended
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                              Fresh
                            </span>
                          )}
                        </div>
                        {isOverdue && (
                          <p className="text-[11px] text-rose-400/80">
                            Secret is {ageDays} days old — {SECRET_ROTATION_OVERDUE_DAYS}-day limit exceeded
                          </p>
                        )}
                        {isWarn && (
                          <p className="text-[11px] text-amber-400/80">
                            {daysLeft} day{daysLeft !== 1 ? "s" : ""} until rotation deadline
                          </p>
                        )}
                      </div>
                    );
                  })()}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <ShieldOff className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="text-xs text-muted-foreground">Not configured</span>
                </div>
              )}
              {callbackSecretStatus?.isSet && !confirmSecretReset && (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-1 text-rose-400 border-rose-500/30 hover:bg-rose-500/10 gap-1.5"
                  onClick={() => setConfirmSecretReset(true)}
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Reset secret
                </Button>
              )}
              {callbackSecretStatus?.isSet && confirmSecretReset && (
                <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 space-y-2">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-rose-400 leading-relaxed">
                      <span className="font-semibold">This will clear the callback signing secret.</span>{" "}
                      All future callback requests from this merchant will not require signature verification until they generate a new secret.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setConfirmSecretReset(false)}
                      disabled={resetCallbackSecretMutation.isPending}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      className="bg-rose-600 hover:bg-rose-700 text-white gap-1.5"
                      disabled={resetCallbackSecretMutation.isPending}
                      onClick={() => {
                        if (!assignPlanMerchant) return;
                        resetCallbackSecretMutation.mutate({ id: assignPlanMerchant.id }, {
                          onSuccess: () => {
                            toast.success("Callback secret cleared — merchant can now regenerate");
                            setConfirmSecretReset(false);
                            refetchCallbackSecret();
                          },
                          onError: () => toast.error("Failed to reset callback secret"),
                        });
                      }}
                    >
                      {resetCallbackSecretMutation.isPending ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Resetting…</> : "Confirm Reset"}
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* Replay-Protection Window */}
            <div className="rounded-lg border border-border/50 bg-muted/10 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Replay-Protection Window</p>
              </div>
              {!windowEditMode ? (
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-foreground font-mono">
                      {assignPlanMerchant?.callbackTimestampWindowSeconds != null
                        ? `${assignPlanMerchant.callbackTimestampWindowSeconds}s`
                        : "300s (global default)"}
                    </span>
                    {assignPlanMerchant?.callbackTimestampWindowSeconds != null && (
                      <span className="text-xs text-muted-foreground">custom</span>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs gap-1.5 h-7 px-2"
                    onClick={() => {
                      setWindowInput(String(assignPlanMerchant?.callbackTimestampWindowSeconds ?? 300));
                      setWindowEditMode(true);
                    }}
                  >
                    Edit
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Set how many seconds around the current time an inbound <code className="font-mono">X-Timestamp</code> is accepted (1–86400). Clear to restore the global default (300 s).
                  </p>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={1}
                      max={86400}
                      value={windowInput}
                      onChange={e => setWindowInput(e.target.value)}
                      placeholder="300"
                      className="h-7 text-xs w-28 font-mono"
                    />
                    <span className="text-xs text-muted-foreground">seconds</span>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-3 text-xs"
                      disabled={updateCallbackWindowMutation.isPending}
                      onClick={() => { setWindowEditMode(false); setWindowInput(""); }}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      className="h-7 px-3 text-xs gap-1.5"
                      disabled={updateCallbackWindowMutation.isPending}
                      onClick={() => {
                        if (!assignPlanMerchant) return;
                        const trimmed = windowInput.trim();
                        const parsed = trimmed === "" ? null : parseInt(trimmed, 10);
                        if (parsed !== null && (!Number.isInteger(parsed) || parsed < 1 || parsed > 86400)) {
                          toast.error("Window must be between 1 and 86400 seconds");
                          return;
                        }
                        updateCallbackWindowMutation.mutate(
                          { id: assignPlanMerchant.id, data: { windowSeconds: parsed } },
                          {
                            onSuccess: (updated) => {
                              setAssignPlanMerchant(prev => prev ? { ...prev, callbackTimestampWindowSeconds: updated.callbackTimestampWindowSeconds } : prev);
                              setWindowEditMode(false);
                              setWindowInput("");
                              toast.success(parsed === null ? "Replay-protection window reset to default" : `Replay-protection window set to ${parsed}s`);
                              qc.invalidateQueries({ queryKey: getListMerchantsQueryKey() });
                            },
                            onError: () => toast.error("Failed to update replay-protection window"),
                          }
                        );
                      }}
                    >
                      {updateCallbackWindowMutation.isPending ? <><Loader2 className="w-3 h-3 animate-spin" /> Saving…</> : "Save"}
                    </Button>
                    {assignPlanMerchant?.callbackTimestampWindowSeconds != null && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-3 text-xs text-muted-foreground hover:text-foreground"
                        disabled={updateCallbackWindowMutation.isPending}
                        onClick={() => {
                          if (!assignPlanMerchant) return;
                          updateCallbackWindowMutation.mutate(
                            { id: assignPlanMerchant.id, data: { windowSeconds: null } },
                            {
                              onSuccess: (updated) => {
                                setAssignPlanMerchant(prev => prev ? { ...prev, callbackTimestampWindowSeconds: updated.callbackTimestampWindowSeconds } : prev);
                                setWindowEditMode(false);
                                setWindowInput("");
                                toast.success("Replay-protection window reset to default");
                                qc.invalidateQueries({ queryKey: getListMerchantsQueryKey() });
                              },
                              onError: () => toast.error("Failed to reset replay-protection window"),
                            }
                          );
                        }}
                      >
                        Reset to default
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Webhook Max Retries */}
            <div className="rounded-lg border border-border/50 bg-muted/10 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-muted-foreground shrink-0" />
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Max Delivery Retries</p>
              </div>
              {webhookConfigLoading ? (
                <div className="animate-pulse h-5 bg-muted/30 rounded w-24" />
              ) : webhookConfigError || merchantWebhookConfig == null ? (
                <p className="text-xs text-muted-foreground italic">No webhook configured for this merchant.</p>
              ) : !retriesEditMode ? (
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-foreground font-mono">{merchantWebhookConfig.maxRetries}</span>
                    <span className="text-xs text-muted-foreground">{merchantWebhookConfig.maxRetries === 1 ? "retry" : "retries"}</span>
                    <span className="text-xs text-muted-foreground/60">·</span>
                    <span className="text-xs text-muted-foreground/70">global cap: <span className="font-mono">{merchantWebhookConfig.globalMaxRetries}</span></span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs gap-1.5 h-7 px-2"
                    onClick={() => {
                      setRetriesInput(String(merchantWebhookConfig.maxRetries));
                      setRetriesEditMode(true);
                    }}
                  >
                    Edit
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Set how many times a failed webhook delivery is automatically retried (1–{merchantWebhookConfig.globalMaxRetries}). Global cap: <span className="font-mono font-semibold text-foreground">{merchantWebhookConfig.globalMaxRetries}</span>.
                  </p>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={1}
                      max={merchantWebhookConfig.globalMaxRetries}
                      value={retriesInput}
                      onChange={e => setRetriesInput(e.target.value)}
                      placeholder="3"
                      className="h-7 text-xs w-20 font-mono"
                    />
                    <span className="text-xs text-muted-foreground">retries</span>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-3 text-xs"
                      disabled={updateWebhookMaxRetriesMutation.isPending}
                      onClick={() => { setRetriesEditMode(false); setRetriesInput(""); }}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      className="h-7 px-3 text-xs gap-1.5"
                      disabled={updateWebhookMaxRetriesMutation.isPending}
                      onClick={() => {
                        if (!assignPlanMerchant) return;
                        const parsed = parseInt(retriesInput.trim(), 10);
                        const cap = merchantWebhookConfig.globalMaxRetries;
                        if (!Number.isInteger(parsed) || parsed < 1 || parsed > cap) {
                          toast.error(`Retries must be between 1 and ${cap}`);
                          return;
                        }
                        updateWebhookMaxRetriesMutation.mutate(
                          { id: assignPlanMerchant.id, data: { maxRetries: parsed } },
                          {
                            onSuccess: () => {
                              refetchWebhookConfig();
                              setRetriesEditMode(false);
                              setRetriesInput("");
                              toast.success(`Max retries set to ${parsed}`);
                            },
                            onError: (err: any) => {
                              const msg = err?.response?.data?.error ?? "Failed to update max retries";
                              toast.error(msg);
                            },
                          }
                        );
                      }}
                    >
                      {updateWebhookMaxRetriesMutation.isPending ? <><Loader2 className="w-3 h-3 animate-spin" /> Saving…</> : "Save"}
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* Webhook Failure Alerts */}
            <div ref={webhookAlertsRef} className="rounded-lg border border-border/50 bg-muted/10 p-3 space-y-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-muted-foreground shrink-0" />
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Webhook Failure Alerts</p>
                {merchantWebhookAlerts.length > 0 && (
                  <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                    {merchantWebhookAlerts.length} alert{merchantWebhookAlerts.length !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
              {webhookAlertHistoryLoading ? (
                <div className="space-y-2">
                  {[1, 2].map(i => (
                    <div key={i} className="animate-pulse h-14 rounded-lg bg-muted/30" />
                  ))}
                </div>
              ) : merchantWebhookAlerts.length === 0 ? (
                <div className="flex flex-col items-center gap-1.5 py-4 text-center">
                  <AlertTriangle className="w-5 h-5 text-muted-foreground/30" />
                  <p className="text-xs text-muted-foreground">No webhook failure alerts sent for this merchant.</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {merchantWebhookAlerts.map((entry) => (
                    <div key={entry.id} className="rounded-lg border border-border/50 bg-muted/5 px-3 py-2.5 space-y-1">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="text-xs font-medium">
                          {new Date(entry.sentAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                        </span>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span>{entry.attemptCount} attempt{entry.attemptCount !== 1 ? "s" : ""}</span>
                          <span>{entry.recipientCount} recipient{entry.recipientCount !== 1 ? "s" : ""}</span>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground font-mono break-all">{entry.failedUrl}</p>
                      {entry.recipientEmails.length > 0 && (
                        <p className="text-[11px] text-muted-foreground/70">
                          Sent to: {entry.recipientEmails.join(", ")}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Credential History */}
            <div className="rounded-lg border border-border/50 bg-muted/10 p-3 space-y-3">
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-muted-foreground shrink-0" />
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Credential History</p>
                {credentialEvents && credentialEvents.length > 0 && (
                  <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                    {credentialEvents.length} event{credentialEvents.length !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
              {/* Filter chips */}
              <div className="flex flex-wrap gap-1.5">
                {(["", "key_generated", "key_revoked", "secret_rotated"] as const).map(f => {
                  const labels: Record<string, string> = {
                    "": "All",
                    key_generated: "Key Generated",
                    key_revoked: "Key Revoked",
                    secret_rotated: "Secret Rotated",
                  };
                  const activeColors: Record<string, string> = {
                    "": "bg-primary/20 text-primary border-primary/40",
                    key_generated: "bg-emerald-500/20 text-emerald-400 border-emerald-500/40",
                    key_revoked: "bg-rose-500/20 text-rose-400 border-rose-500/40",
                    secret_rotated: "bg-violet-500/20 text-violet-400 border-violet-500/40",
                  };
                  const isActive = credEventFilter === f;
                  return (
                    <button
                      key={f}
                      onClick={() => setCredEventFilter(f)}
                      className={`px-2.5 py-1 rounded-md text-xs transition-colors border ${isActive ? activeColors[f] : "text-muted-foreground hover:text-foreground hover:bg-muted/50 border-transparent"}`}
                    >
                      {labels[f]}
                    </button>
                  );
                })}
              </div>
              {/* Event list */}
              {credEventsLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3, 4].map(i => (
                    <div key={i} className="flex items-start gap-2">
                      <div className="animate-pulse h-3 w-3 rounded-full bg-muted/40 mt-0.5 shrink-0" />
                      <div className="flex-1 space-y-1.5">
                        <div className="animate-pulse h-3 bg-muted/30 rounded w-2/3" />
                        <div className="animate-pulse h-2.5 bg-muted/20 rounded w-1/2" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : !credentialEvents || credentialEvents.length === 0 ? (
                <div className="flex flex-col items-center gap-1.5 py-6 text-center">
                  <History className="w-6 h-6 text-muted-foreground/30" />
                  <p className="text-xs text-muted-foreground">No credential events found.</p>
                </div>
              ) : (
                <div className="space-y-0 max-h-96 overflow-y-auto pr-1 divide-y divide-border/30">
                  {credentialEvents.map((ev, i) => {
                    const eventConfig: Record<string, { label: string; color: string; bgColor: string; icon: React.ReactNode }> = {
                      key_generated: { label: "Key Generated", color: "text-emerald-400", bgColor: "bg-emerald-500/10", icon: <KeyRound className="w-3 h-3 text-emerald-400 shrink-0" /> },
                      key_revoked:   { label: "Key Revoked",   color: "text-rose-400",    bgColor: "bg-rose-500/10",    icon: <XCircle className="w-3 h-3 text-rose-400 shrink-0" /> },
                      secret_rotated: { label: "Secret Rotated", color: "text-violet-400", bgColor: "bg-violet-500/10", icon: <RotateCcw className="w-3 h-3 text-violet-400 shrink-0" /> },
                    };
                    const cfg = eventConfig[ev.eventType] ?? { label: ev.eventType, color: "text-muted-foreground", bgColor: "bg-muted/10", icon: null };
                    return (
                      <div key={i} className="flex items-start gap-2.5 text-xs py-2.5 first:pt-0 last:pb-0">
                        <div className={`mt-0.5 p-1 rounded ${cfg.bgColor} shrink-0`}>{cfg.icon}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`font-medium ${cfg.color}`}>{cfg.label}</span>
                            {ev.keyPrefix && (
                              <span className="font-mono text-[10px] bg-muted/40 px-1.5 py-0.5 rounded text-muted-foreground border border-border/40">{ev.keyPrefix}</span>
                            )}
                            <span className="text-muted-foreground/60 ml-auto shrink-0 text-[10px]">
                              {formatDistanceToNow(new Date(ev.occurredAt), { addSuffix: true })}
                            </span>
                          </div>
                          <p className="text-muted-foreground/50 text-[10px] mt-0.5">{format(new Date(ev.occurredAt), "dd MMM yyyy, HH:mm:ss")}</p>
                          <div className="flex flex-wrap gap-x-3 mt-1 text-[10px]">
                            {ev.actorEmail && (
                              <span className="text-muted-foreground/70 flex items-center gap-1">
                                <span className="text-muted-foreground/40">by</span>
                                <span className="font-medium">{ev.actorEmail}</span>
                              </span>
                            )}
                            {ev.ipAddress && (
                              <span className="font-mono text-muted-foreground/50">
                                <span className="text-muted-foreground/40 not-font-mono">IP </span>{ev.ipAddress}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* KYC Verification */}
            <div className="rounded-lg border border-border/50 bg-muted/10 p-3 space-y-3">
              <div className="flex items-center gap-2">
                {kycSummaryLoading ? (
                  <div className="w-4 h-4 rounded-full bg-muted/40 animate-pulse shrink-0" />
                ) : kycSummary?.isVerified ? (
                  <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : (
                  <ShieldOff className="w-4 h-4 text-muted-foreground shrink-0" />
                )}
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">KYC Verification</p>
                {kycSummary != null && (
                  <span className={`ml-auto text-xs font-medium px-2 py-0.5 rounded-full border tabular-nums ${
                    kycSummary.isVerified
                      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                      : "bg-muted/30 border-border/50 text-muted-foreground"
                  }`}>
                    {kycSummary.isVerified ? "Verified" : `${kycSummary.approvedCount} of ${kycSummary.requiredDocTypes.length} docs`}
                  </span>
                )}
              </div>

              {/* Summary stats row */}
              {!kycSummaryLoading && kycSummary != null && (
                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                  {kycSummary.pendingCount > 0 && (
                    <span className="flex items-center gap-1 text-amber-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                      {kycSummary.pendingCount} pending
                    </span>
                  )}
                  {kycSummary.approvedCount > 0 && (
                    <span className="flex items-center gap-1 text-emerald-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                      {kycSummary.approvedCount} approved
                    </span>
                  )}
                  {kycSummary.rejectedCount > 0 && (
                    <span className="flex items-center gap-1 text-rose-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-400 shrink-0" />
                      {kycSummary.rejectedCount} rejected
                    </span>
                  )}
                  {kycSummary.totalDocs === 0 && (
                    <span className="text-muted-foreground/60">No documents submitted yet</span>
                  )}
                </div>
              )}

              {/* Document list */}
              {kycDocsLoading ? (
                <div className="space-y-2">
                  {[1, 2].map(i => (
                    <div key={i} className="animate-pulse h-14 rounded-lg bg-muted/30" />
                  ))}
                </div>
              ) : kycDocuments.length === 0 ? (
                <div className="flex flex-col items-center gap-1.5 py-4 text-center">
                  <ShieldOff className="w-5 h-5 text-muted-foreground/30" />
                  <p className="text-xs text-muted-foreground">No KYC documents submitted.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {kycDocuments.map((doc) => {
                    const reviewEntry = kycReviewState[doc.id];
                    const isConfirming = kycConfirming[doc.id];
                    const docStatusColors: Record<string, string> = {
                      approved: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
                      rejected: "text-rose-400 bg-rose-500/10 border-rose-500/30",
                      pending: "text-amber-400 bg-amber-500/10 border-amber-500/30",
                    };
                    const statusColor = docStatusColors[doc.status] ?? "text-muted-foreground bg-muted/20 border-border/40";
                    return (
                      <div key={doc.id} className="rounded-lg border border-border/50 bg-muted/5 px-3 py-2.5 space-y-2">
                        <div className="flex items-start gap-2 flex-wrap">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-medium text-foreground capitalize">{doc.docType.replace(/_/g, " ")}</span>
                              {doc.fileName && (
                                <span className="text-[10px] text-muted-foreground/60 font-mono truncate max-w-[140px]" title={doc.fileName}>{doc.fileName}</span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                              <span className={`text-[10px] px-1.5 py-0.5 rounded border capitalize font-medium ${statusColor}`}>{doc.status}</span>
                              {doc.adminNote && (
                                <span className="text-[10px] text-muted-foreground/70 italic">"{doc.adminNote}"</span>
                              )}
                              <a
                                href={doc.fileUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[10px] text-primary hover:underline flex items-center gap-0.5 ml-auto"
                              >
                                View <ExternalLink className="w-2.5 h-2.5" />
                              </a>
                            </div>
                          </div>
                        </div>

                        {/* Inline review controls */}
                        {!reviewEntry && (
                          <div className="flex gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 text-[10px] text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
                              onClick={() => setKycReviewState(prev => ({ ...prev, [doc.id]: { action: "approved", note: "" } }))}
                            >
                              <CheckCircle className="w-3 h-3 mr-1" />Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 text-[10px] text-rose-400 border-rose-500/30 hover:bg-rose-500/10"
                              onClick={() => setKycReviewState(prev => ({ ...prev, [doc.id]: { action: "rejected", note: "" } }))}
                            >
                              <XCircle className="w-3 h-3 mr-1" />Reject
                            </Button>
                          </div>
                        )}

                        {/* Confirm review form */}
                        {reviewEntry && (
                          <div className="space-y-1.5 pt-1 border-t border-border/40">
                            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                              {reviewEntry.action === "approved" ? "Confirming approval" : "Confirming rejection"}
                            </p>
                            <Input
                              className="h-7 text-xs"
                              placeholder="Admin note (optional)…"
                              value={reviewEntry.note}
                              onChange={e => setKycReviewState(prev => ({
                                ...prev,
                                [doc.id]: { ...reviewEntry, note: e.target.value },
                              }))}
                            />
                            <div className="flex gap-1.5">
                              <Button
                                size="sm"
                                className={`h-6 px-2 text-[10px] ${reviewEntry.action === "approved" ? "bg-emerald-600 hover:bg-emerald-700 text-white" : "bg-rose-600 hover:bg-rose-700 text-white"}`}
                                disabled={isConfirming || reviewKycMutation.isPending}
                                onClick={() => {
                                  setKycConfirming(prev => ({ ...prev, [doc.id]: true }));
                                  reviewKycMutation.mutate({
                                    id: doc.id,
                                    data: { status: reviewEntry.action, adminNote: reviewEntry.note || undefined },
                                  });
                                }}
                              >
                                {isConfirming ? <Loader2 className="w-3 h-3 animate-spin" /> : "Confirm"}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 px-2 text-[10px] text-muted-foreground"
                                disabled={isConfirming || reviewKycMutation.isPending}
                                onClick={() => setKycReviewState(prev => ({ ...prev, [doc.id]: null }))}
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Plan Actions (if plan exists) */}
            {currentMerchantPlan && (
              <div className="space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Quick Actions</p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10" onClick={() => { setConfirmAction("upgrade"); setSelectedPlanId(""); setActionNotes(""); setActionExpiresAt(""); }}>
                    <TrendingUp className="w-3.5 h-3.5 mr-1" />Upgrade
                  </Button>
                  <Button size="sm" variant="outline" className="text-amber-400 border-amber-500/30 hover:bg-amber-500/10" onClick={() => { setConfirmAction("downgrade"); setSelectedPlanId(""); setActionNotes(""); setActionExpiresAt(""); }}>
                    <TrendingDown className="w-3.5 h-3.5 mr-1" />Downgrade
                  </Button>
                  {currentMerchantPlan.status !== "suspended" ? (
                    <Button size="sm" variant="outline" className="text-orange-400 border-orange-500/30 hover:bg-orange-500/10" onClick={() => { setConfirmAction("suspend"); setActionNotes(""); }}>
                      <PauseCircle className="w-3.5 h-3.5 mr-1" />Suspend
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10" onClick={() => { setConfirmAction("reinstate"); setActionNotes(""); }}>
                      <PlayCircle className="w-3.5 h-3.5 mr-1" />Reinstate
                    </Button>
                  )}
                  <Button size="sm" variant="outline" className="text-violet-400 border-violet-500/30 hover:bg-violet-500/10" onClick={() => { setConfirmAction("renew"); setRenewExpiresAt(""); setRenewScheduledRenewalAt(""); setActionNotes(""); }}>
                    <RefreshCw className="w-3.5 h-3.5 mr-1" />Renew
                  </Button>
                  <Button size="sm" variant="outline" className="text-sky-400 border-sky-500/30 hover:bg-sky-500/10" onClick={() => { setConfirmAction("schedule-renewal"); setScheduleRenewalDate(currentMerchantPlan.scheduledRenewalAt ? new Date(currentMerchantPlan.scheduledRenewalAt).toISOString().split("T")[0] : ""); }}>
                    <Clock className="w-3.5 h-3.5 mr-1" />Schedule Renewal
                  </Button>
                </div>

                {/* Inline action confirmation */}
                {confirmAction && (
                  <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-3">
                    <p className="text-sm font-medium capitalize">{confirmAction} Plan</p>
                    {(confirmAction === "upgrade" || confirmAction === "downgrade") && (
                      <div className="space-y-3">
                        <div className="space-y-1.5">
                          <Label className="text-xs">Select Target Plan</Label>
                          <Select value={selectedPlanId} onValueChange={v => { setSelectedPlanId(v); setActionExpiresAt(""); }}>
                            <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Choose plan..." /></SelectTrigger>
                            <SelectContent>
                              {plans?.filter(p => String(p.id) !== String(currentMerchantPlan.planId))
                                .map(plan => (
                                <SelectItem key={plan.id} value={String(plan.id)}>
                                  {plan.name}{plan.monthlyFee !== "0" ? ` — ₹${parseInt(plan.monthlyFee).toLocaleString()}/mo` : " — Free"}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        {selectedPlanId && (() => {
                          const targetPlan = plans?.find(p => String(p.id) === selectedPlanId);
                          const isPaid = targetPlan && targetPlan.monthlyFee !== "0" && targetPlan.name.toLowerCase() !== "custom";
                          return (
                            <div className="space-y-1.5">
                              <Label className="text-xs flex items-center gap-1.5">
                                <Calendar className="w-3.5 h-3.5" />
                                Plan Expiry Date{isPaid ? <span className="text-rose-400">*</span> : <span className="text-muted-foreground">(optional)</span>}
                              </Label>
                              <Input type="date" className="h-8 text-sm" value={actionExpiresAt} onChange={e => setActionExpiresAt(e.target.value)} min={new Date().toISOString().split("T")[0]} />
                              {isPaid && !actionExpiresAt ? (
                                <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-2 text-rose-400">
                                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                  <p className="text-xs leading-relaxed">
                                    <span className="font-semibold">Expiry date is required</span> for paid plans ({targetPlan.name}).
                                    Set a date to confirm.
                                  </p>
                                </div>
                              ) : actionExpiresAt ? (() => {
                                const days = Math.round((new Date(actionExpiresAt).getTime() - Date.now()) / 86400000);
                                if (days < 7) return (
                                  <div className="flex items-start gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-2.5 py-2 text-yellow-400">
                                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                    <p className="text-xs leading-relaxed"><span className="font-semibold">This plan expires very soon</span> — did you mean a longer period?</p>
                                  </div>
                                );
                                if (days > 730) return (
                                  <div className="flex items-start gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-2.5 py-2 text-yellow-400">
                                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                    <p className="text-xs leading-relaxed"><span className="font-semibold">This expiry date is over 2 years away</span> — please confirm.</p>
                                  </div>
                                );
                                return null;
                              })() : (
                                <p className="text-xs text-muted-foreground">Leave empty for no expiry.</p>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    )}
                    {confirmAction === "renew" && (
                      <div className="space-y-1.5">
                        <Label className="text-xs">New Expiry Date</Label>
                        <Input type="date" className="h-8 text-sm" value={renewExpiresAt} onChange={e => setRenewExpiresAt(e.target.value)} min={new Date().toISOString().split("T")[0]} />
                        <p className="text-xs text-muted-foreground">Required. Set the new expiry date for the plan.</p>
                        {renewExpiresAt && (() => {
                          const days = Math.round((new Date(renewExpiresAt).getTime() - Date.now()) / 86400000);
                          if (days < 7) return (
                            <div className="flex items-start gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-2.5 py-2 text-yellow-400">
                              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                              <p className="text-xs leading-relaxed">
                                <span className="font-semibold">This plan expires very soon</span> — did you mean a longer period?
                              </p>
                            </div>
                          );
                          if (days > 730) return (
                            <div className="flex items-start gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-2.5 py-2 text-yellow-400">
                              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                              <p className="text-xs leading-relaxed">
                                <span className="font-semibold">This expiry date is over 2 years away</span> — please confirm.
                              </p>
                            </div>
                          );
                          return null;
                        })()}
                        <div className="pt-1 space-y-1.5">
                          <Label className="text-xs flex items-center gap-1.5"><Clock className="w-3 h-3" />Schedule Next Auto-Renewal (optional)</Label>
                          <Input type="date" className="h-8 text-sm" value={renewScheduledRenewalAt} onChange={e => setRenewScheduledRenewalAt(e.target.value)} min={renewExpiresAt || new Date().toISOString().split("T")[0]} />
                          <p className="text-xs text-muted-foreground">Leave blank to keep the existing schedule, or pick a date to auto-renew.</p>
                        </div>
                      </div>
                    )}
                    {confirmAction === "schedule-renewal" && (
                      <div className="space-y-1.5">
                        <Label className="text-xs flex items-center gap-1.5"><Clock className="w-3 h-3" />Auto-Renewal Date</Label>
                        <Input type="date" className="h-8 text-sm" value={scheduleRenewalDate} onChange={e => setScheduleRenewalDate(e.target.value)} min={new Date().toISOString().split("T")[0]} />
                        <p className="text-xs text-muted-foreground">The plan will be automatically renewed on this date. Leave blank and confirm to cancel an existing schedule.</p>
                        {currentMerchantPlan.scheduledRenewalAt && !scheduleRenewalDate && (
                          <div className="flex items-center gap-2 rounded-md border border-orange-500/30 bg-orange-500/10 px-2.5 py-2 text-xs text-orange-400">
                            <BellOff className="w-3.5 h-3.5 shrink-0" />
                            <span>Confirming with an empty date will <span className="font-semibold">cancel</span> the current scheduled renewal ({format(new Date(currentMerchantPlan.scheduledRenewalAt), "MMM d, yyyy")}).</span>
                          </div>
                        )}
                        {scheduleRenewalDate && currentMerchantPlan.expiresAt && new Date(scheduleRenewalDate) > new Date(currentMerchantPlan.expiresAt) && (
                          <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-400">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                            <span>This date is after the current expiry. The plan will have lapsed before auto-renewal runs.</span>
                          </div>
                        )}
                      </div>
                    )}
                    <div className="space-y-1.5">
                      <Label className="text-xs">Notes (optional)</Label>
                      <Input className="h-8 text-sm" value={actionNotes} onChange={e => setActionNotes(e.target.value)} placeholder="Internal note..." />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => { setConfirmAction(null); setActionNotes(""); setActionExpiresAt(""); setScheduleRenewalDate(""); }}>Cancel</Button>
                      {(confirmAction === "suspend" || confirmAction === "reinstate" || confirmAction === "upgrade" || confirmAction === "downgrade") && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-violet-400 border-violet-500/30 hover:bg-violet-500/10 gap-1.5"
                          disabled={planEmailPreviewLoading || ((confirmAction === "upgrade" || confirmAction === "downgrade") && !selectedPlanId)}
                          onClick={() => {
                            if (confirmAction === "suspend") {
                              handlePreviewPlanEmail("suspended", { notes: actionNotes || undefined });
                            } else if (confirmAction === "reinstate") {
                              handlePreviewPlanEmail("reinstated", { notes: actionNotes || undefined });
                            } else {
                              handlePreviewPlanEmail("assigned", {
                                planId: selectedPlanId ? parseInt(selectedPlanId) : undefined,
                                expiresAt: actionExpiresAt || undefined,
                                notes: actionNotes || undefined,
                              });
                            }
                          }}
                        >
                          {planEmailPreviewLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
                          Preview Email
                        </Button>
                      )}
                      <Button size="sm" onClick={() => handlePlanAction(confirmAction)} disabled={isActionPending || ((confirmAction === "upgrade" || confirmAction === "downgrade") && (!selectedPlanId || (() => { const tp = plans?.find(p => String(p.id) === selectedPlanId); return !!(tp && tp.monthlyFee !== "0" && tp.name.toLowerCase() !== "custom" && !actionExpiresAt); })()))}>
                        {isActionPending ? "Processing..." : confirmAction === "schedule-renewal"
                          ? (scheduleRenewalDate ? "Set Auto-Renewal" : "Cancel Auto-Renewal")
                          : `Confirm ${confirmAction.charAt(0).toUpperCase() + confirmAction.slice(1)}`}
                      </Button>
                    </div>
                  </div>
                )}
                <Separator />
              </div>
            )}

            {/* Plan selector (initial assign) */}
            <div className="space-y-2">
              <Label>{currentMerchantPlan ? "Force Change Plan" : "Select Plan"}</Label>
              <Select value={selectedPlanId} onValueChange={v => { setSelectedPlanId(v); setConfirmAction(null); }}>
                <SelectTrigger><SelectValue placeholder="Choose a plan..." /></SelectTrigger>
                <SelectContent>
                  {plans?.map(plan => (
                    <SelectItem key={plan.id} value={String(plan.id)}>
                      {plan.name}
                      {plan.monthlyFee !== "0" ? ` — ₹${parseInt(plan.monthlyFee).toLocaleString()}/mo` : " — Free"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Preview selected plan */}
            {selectedPlanId && plans && (() => {
              const plan = plans.find(p => String(p.id) === selectedPlanId);
              if (!plan) return null;
              return (
                <div className="rounded-lg border border-border/50 bg-muted/20 p-3 space-y-2">
                  <p className="text-sm font-medium">{plan.name}</p>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-muted-foreground">
                    <span>Dynamic QR: {plan.dynamicQrLimit >= 999 ? "∞" : plan.dynamicQrLimit}</span>
                    <span>Virtual Accounts: {plan.virtualAccountLimit >= 999 ? "∞" : plan.virtualAccountLimit}</span>
                    <span>Settlement: {plan.settlementFee}%</span>
                    <span>Daily Tx: {plan.dailyTransactionLimit >= 999 ? "∞" : plan.dailyTransactionLimit}</span>
                    <span>API: {plan.apiAccess ? "✓ Enabled" : "✗ Disabled"}</span>
                    <span>Webhooks: {plan.webhookAccess ? "✓ Enabled" : "✗ Disabled"}</span>
                  </div>
                </div>
              );
            })()}

            {/* Expiry Date */}
            {(() => {
              const plan = selectedPlanId ? plans?.find(p => String(p.id) === selectedPlanId) : undefined;
              const isPaid = plan && plan.monthlyFee !== "0" && plan.name.toLowerCase() !== "custom";
              return (
                <div className="space-y-2">
                  <Label className="flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5" />
                    Plan Expiry Date{isPaid ? <span className="text-rose-400">*</span> : <span className="text-muted-foreground">(optional)</span>}
                  </Label>
                  <Input type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} min={new Date().toISOString().split("T")[0]} />
                  {isPaid && !expiresAt ? (
                    <div className="flex items-start gap-2.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-rose-400">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      <p className="text-xs leading-relaxed">
                        <span className="font-semibold">Expiry date is required</span> for paid plans ({plan.name}).
                        Set a date to enable the assign button.
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">{isPaid ? "" : "Leave empty for no expiry."}</p>
                  )}
                </div>
              );
            })()}

            {/* Short / far expiry warnings */}
            {expiresAt && (() => {
              const days = Math.round((new Date(expiresAt).getTime() - Date.now()) / 86400000);
              if (days < 7) return (
                <div className="flex items-start gap-2.5 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2.5 text-yellow-400">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <p className="text-xs leading-relaxed">
                    <span className="font-semibold">This plan expires very soon</span> — did you mean a longer period?
                  </p>
                </div>
              );
              if (days > 730) return (
                <div className="flex items-start gap-2.5 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2.5 text-yellow-400">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <p className="text-xs leading-relaxed">
                    <span className="font-semibold">This expiry date is over 2 years away</span> — please confirm.
                  </p>
                </div>
              );
              return null;
            })()}

            {/* Schedule Auto-Renewal — shown when a plan and expiry are selected */}
            {selectedPlanId && (() => {
              const plan = plans?.find(p => String(p.id) === selectedPlanId);
              const isPaid = plan && plan.monthlyFee !== "0" && plan.name.toLowerCase() !== "custom";
              if (!isPaid || !expiresAt) return null;
              return (
                <div className="space-y-2">
                  <Label className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" />
                    Schedule Auto-Renewal <span className="text-muted-foreground">(optional)</span>
                  </Label>
                  <Input type="date" value={assignScheduledRenewalAt} onChange={e => setAssignScheduledRenewalAt(e.target.value)} min={expiresAt || new Date().toISOString().split("T")[0]} />
                  {assignScheduledRenewalAt ? (
                    <p className="text-xs text-violet-400/80">
                      <span className="font-semibold">Auto-renewal set:</span> the plan will be automatically renewed on {format(new Date(assignScheduledRenewalAt), "MMM d, yyyy")}.
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Set a future date to auto-renew this plan on expiry. Leave blank to manage renewals manually.
                    </p>
                  )}
                </div>
              );
            })()}

            {/* Notes */}
            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Textarea placeholder="e.g. Trial period, special arrangement..." rows={2} value={assignNotes} onChange={e => setAssignNotes(e.target.value)} />
            </div>

            <Separator />

            {/* Plan History toggle */}
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-muted-foreground"
              onClick={() => setShowHistory(h => !h)}
            >
              <History className="w-4 h-4 mr-2" />
              {showHistory ? "Hide" : "Show"} Plan History
            </Button>

            {showHistory && (
              <div className="space-y-2">
                {!planHistory || planHistory.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2 text-center">No plan history for this merchant.</p>
                ) : planHistory.map(entry => (
                  <div key={entry.id} className="flex items-start gap-3 text-xs">
                    <div className="w-1 h-1 rounded-full bg-primary/40 mt-1.5 shrink-0" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`font-medium capitalize ${ACTION_COLOR[entry.action] ?? "text-muted-foreground"}`}>{entry.action}</span>
                        {entry.toPlanName && <Badge variant="outline" className="text-xs py-0">{entry.toPlanName}</Badge>}
                        <span className="text-muted-foreground ml-auto">{formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true })}</span>
                      </div>
                      {entry.adminEmail && <p className="text-muted-foreground">by {entry.adminEmail}</p>}
                      {entry.expiresAt && (
                        <p className="text-muted-foreground">
                          expires {format(new Date(entry.expiresAt), "dd MMM yyyy")}
                        </p>
                      )}
                      {entry.notes && <p className="text-muted-foreground italic">"{entry.notes}"</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          {assignPlanMerchant?.reportScheduleChangedEmails === false && (
            <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-amber-400">
              <BellOff className="w-4 h-4 shrink-0 mt-0.5" />
              <p className="text-xs leading-relaxed">
                <span className="font-semibold">This merchant has opted out of plan assignment emails</span> and will not receive a notification when the plan is assigned.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={closeAssignPlan}>Cancel</Button>
            {selectedPlanId && (
              <Button
                variant="outline"
                className="text-violet-400 border-violet-500/30 hover:bg-violet-500/10 gap-1.5"
                disabled={planEmailPreviewLoading}
                onClick={() => handlePreviewPlanEmail("assigned", {
                  planId: parseInt(selectedPlanId),
                  expiresAt: expiresAt || undefined,
                  notes: assignNotes || undefined,
                })}
              >
                {planEmailPreviewLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
                Preview Email
              </Button>
            )}
            {(() => {
              const plan = selectedPlanId ? plans?.find(p => String(p.id) === selectedPlanId) : undefined;
              const isPaid = plan && plan.monthlyFee !== "0" && plan.name.toLowerCase() !== "custom";
              const missingExpiry = isPaid && !expiresAt;
              return (
                <Button onClick={handleAssignPlan} disabled={!selectedPlanId || !!missingExpiry || assignPlanMutation.isPending}>
                  {assignPlanMutation.isPending ? "Assigning..." : currentMerchantPlan ? "Change Plan" : "Assign Plan"}
                </Button>
              );
            })()}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Plan Email Preview Modal */}
      <Dialog open={!!planEmailPreview} onOpenChange={(open) => { if (!open) setPlanEmailPreview(null); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
              <Mail className="w-4 h-4 text-violet-400" />
              Email Preview
            </DialogTitle>
          </DialogHeader>
          {planEmailPreview && (
            <>
              <div className="rounded-md bg-muted/40 border border-border px-3 py-2 text-xs text-muted-foreground space-y-1 shrink-0">
                <div className="flex items-start gap-1.5">
                  <span className="opacity-60 shrink-0">Subject:</span>
                  <span className="text-foreground font-medium break-all">{planEmailPreview.subject}</span>
                </div>
                <p className="text-[11px] text-muted-foreground/70 italic">
                  This is a preview only — no email has been sent.
                </p>
              </div>
              <div className="flex-1 min-h-0 rounded-md border border-border overflow-hidden">
                <iframe
                  srcDoc={planEmailPreview.html}
                  title="Email preview"
                  className="w-full h-full min-h-[420px]"
                  sandbox="allow-same-origin"
                />
              </div>
            </>
          )}
          <DialogFooter>
            <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => setPlanEmailPreview(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Single-Action Result Summary Dialog */}
      <Dialog open={singleActionResult?.open ?? false} onOpenChange={(open) => setSingleActionResult(prev => prev ? { ...prev, open } : null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0" />
              {singleActionResult?.title}
            </DialogTitle>
            <DialogDescription>
              {singleActionResult?.timestamp && format(new Date(singleActionResult.timestamp), "PPpp")}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-between px-3 py-3 rounded-md bg-muted/40 border border-border/50">
            <span className="font-medium text-sm">{singleActionResult?.merchantName}</span>
            {singleActionResult?.newStatus && (
              <StatusBadge status={singleActionResult.newStatus} />
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => setSingleActionResult(prev => prev ? { ...prev, open: false } : null)}>Dismiss</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Action Result Summary Dialog */}
      <Dialog open={bulkResultOpen} onOpenChange={handleBulkResultClose}>
        <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{bulkResultTitle} — Results</DialogTitle>
            <DialogDescription>
              {bulkResultItems.filter(r => r.success).length} succeeded
              {bulkResultItems.filter(r => !r.success).length > 0 && `, ${bulkResultItems.filter(r => !r.success).length} skipped or failed`}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto space-y-1 py-2 min-h-0">
            {bulkResultItems.map(item => (
              <div
                key={item.id}
                className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm ${item.success ? "bg-emerald-500/10" : "bg-rose-500/10"}`}
              >
                {item.success
                  ? <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                  : <XCircle className="w-4 h-4 text-rose-400 shrink-0" />}
                <span className="flex-1 font-medium truncate">{item.name}</span>
                {!item.success && item.reason && (
                  <span className="text-xs text-rose-400/80 shrink-0">{item.reason}</span>
                )}
              </div>
            ))}
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            {bulkResultItems.filter(r => !r.success).length > 0 && bulkRetryContext && (
              <Button
                variant="outline"
                className="border-amber-500/40 text-amber-400 hover:bg-amber-500/10"
                onClick={handleRetryFailed}
                disabled={bulkAssignMutation.isPending || bulkApproveMutation.isPending || bulkSuspendMutation.isPending}
              >
                <RotateCcw className="w-4 h-4 mr-2" />
                Retry failed ({bulkResultItems.filter(r => !r.success).length})
              </Button>
            )}
            {bulkUndoState && !bulkUndoUsed && (
              <div className="flex items-center gap-2 flex-1">
                <Button
                  variant="outline"
                  className="text-amber-400 border-amber-500/30 hover:bg-amber-500/10 gap-1.5"
                  disabled={bulkUndoSecondsLeft === 0 || bulkApproveMutation.isPending || bulkSuspendMutation.isPending || bulkAssignMutation.isPending || bulkUnassignMutation.isPending}
                  onClick={handleBulkUndo}
                >
                  <RotateCcw className="w-4 h-4" />
                  Undo
                  {bulkUndoSecondsLeft > 0
                    ? <span className="text-amber-400/70">({bulkUndoSecondsLeft}s)</span>
                    : <span className="text-muted-foreground">(expired)</span>}
                </Button>
                <span className="text-xs text-muted-foreground">
                  {bulkUndoState.action === "plan-assign"
                    ? `Restores previous plan for ${bulkUndoState.items.length} merchant${bulkUndoState.items.length !== 1 ? "s" : ""}`
                    : `Reverses the ${bulkUndoState.ids.length} successful change${bulkUndoState.ids.length !== 1 ? "s" : ""}`}
                </span>
              </div>
            )}
            {bulkUndoUsed && (bulkApproveMutation.isPending || bulkSuspendMutation.isPending || bulkAssignMutation.isPending || bulkUnassignMutation.isPending) && (
              <span className="text-xs text-muted-foreground flex items-center gap-1.5 flex-1">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Undoing…
              </span>
            )}
            <Button onClick={() => handleBulkResultClose(false)}>Dismiss</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
