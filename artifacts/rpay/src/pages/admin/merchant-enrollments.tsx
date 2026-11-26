/**
 * Admin — Merchant Enrollment Review
 *
 * Lists merchant-submitted provider credentials (Category D) that are awaiting
 * admin review. Super Admins can activate or suspend each enrollment.
 *
 * Status flow:
 *   credentials_submitted → active   (payments start flowing)
 *   credentials_submitted → suspended (rejected with reason)
 *   active                → suspended
 *   suspended             → active
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  CheckCircle2, Clock, AlertTriangle, XCircle, RefreshCw, Loader2,
  Key, ShieldCheck, ShieldOff, Search, ChevronLeft, ChevronRight,
  UserCheck, FlaskConical,
} from "lucide-react";
import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AdminEnrollment {
  id: number;
  merchantId: number;
  merchantBusinessName: string | null;
  merchantEmail: string | null;
  providerSlug: string;
  enrollmentStatus: string;
  maskedIdentifier: string | null;
  hasApiKey: boolean;
  hasApiSecret: boolean;
  hasWebhookSecret: boolean;
  connectedAt: string | null;
  lastVerifiedAt: string | null;
  disconnectedAt: string | null;
  failureReason: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_FILTER_OPTIONS = [
  { value: "credentials_submitted", label: "Pending Review" },
  { value: "active", label: "Active" },
  { value: "suspended", label: "Suspended" },
  { value: "all", label: "All Statuses" },
];

const PROVIDER_NAMES: Record<string, string> = {
  phonepe:    "PhonePe Business",
  paytm:      "Paytm Business",
  bharatpe:   "BharatPe",
  amazon_pay: "Amazon Pay",
  mobikwik:   "MobiKwik",
};

const ENROLLMENT_BADGE: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  credentials_submitted: { label: "Pending Review",  color: "bg-sky-500/10 text-sky-400 border-sky-500/30",              icon: <Clock className="w-3 h-3" /> },
  active:                { label: "Active",           color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",  icon: <CheckCircle2 className="w-3 h-3" /> },
  suspended:             { label: "Suspended",        color: "bg-rose-500/10 text-rose-400 border-rose-500/30",           icon: <AlertTriangle className="w-3 h-3" /> },
  pending_kyc:           { label: "Pending KYC",      color: "bg-amber-500/10 text-amber-400 border-amber-500/30",        icon: <Clock className="w-3 h-3" /> },
  disconnected:          { label: "Disconnected",     color: "bg-zinc-500/10 text-zinc-400 border-zinc-500/30",           icon: <XCircle className="w-3 h-3" /> },
};

// ── API helpers ───────────────────────────────────────────────────────────────

function adminHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { ...init, headers: { ...adminHeaders(), ...(init?.headers as Record<string, string> ?? {}) } });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ error: "Unknown error" }));
    throw new Error((err as any).error ?? "Request failed");
  }
  return r.json();
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

const ENROLLMENTS_KEY = (status: string, page: number) => ["admin", "merchant-enrollments", status, page] as const;

function useEnrollments(status: string, page: number) {
  return useQuery({
    queryKey: ENROLLMENTS_KEY(status, page),
    queryFn: () =>
      apiFetch<{ enrollments: AdminEnrollment[]; total: number; page: number; limit: number; totalPages: number }>(
        `/api/admin/merchant-enrollments?status=${encodeURIComponent(status)}&page=${page}&limit=25`
      ),
    staleTime: 30_000,
  });
}

function usePendingCount() {
  return useQuery({
    queryKey: ["admin", "merchant-enrollments", "pending-count"],
    queryFn: () => apiFetch<{ count: number }>("/api/admin/merchant-enrollments/pending-count"),
    staleTime: 60_000,
  });
}

interface TestCredentialsResult {
  pass: boolean;
  message: string;
  detail?: string;
  testedAt: string;
}

function useTestCredentials() {
  return useMutation({
    mutationFn: async (payload: { merchantId: number; providerSlug: string }) => {
      return apiFetch<TestCredentialsResult>(
        `/api/admin/merchant-enrollments/${payload.merchantId}/enrollments/${payload.providerSlug}/test`,
        { method: "POST" }
      );
    },
  });
}

function useUpdateEnrollmentStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      merchantId: number;
      providerSlug: string;
      status: "active" | "suspended";
      reason?: string;
    }) => {
      return apiFetch<{ enrollment: AdminEnrollment }>(
        `/api/admin/merchant-enrollments/${payload.merchantId}/enrollments/${payload.providerSlug}/status`,
        {
          method: "PUT",
          body: JSON.stringify({ status: payload.status, reason: payload.reason }),
        }
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "merchant-enrollments"] });
    },
  });
}

// ── Relative time helper ──────────────────────────────────────────────────────

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "Never tested";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

// ── Status Badge ──────────────────────────────────────────────────────────────

function EnrollmentStatusBadge({ status }: { status: string }) {
  const meta = ENROLLMENT_BADGE[status] ?? { label: status, color: "bg-zinc-800 text-zinc-400 border-zinc-700", icon: null };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${meta.color}`}>
      {meta.icon} {meta.label}
    </span>
  );
}

// ── Credential presence indicator ─────────────────────────────────────────────

function CredBadge({ has, label }: { has: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${has ? "bg-emerald-500/10 text-emerald-400" : "bg-zinc-800 text-zinc-500"}`}>
      <Key className="w-2.5 h-2.5" /> {label}
    </span>
  );
}

// ── Confirm status change dialog ──────────────────────────────────────────────

interface ConfirmDialogState {
  enrollment: AdminEnrollment;
  action: "active" | "suspended";
}

function ConfirmStatusDialog({
  state,
  onClose,
  onConfirm,
  busy,
}: {
  state: ConfirmDialogState | null;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  busy: boolean;
}) {
  const [reason, setReason] = useState("");

  if (!state) return null;

  const isActivate = state.action === "active";
  const providerName = PROVIDER_NAMES[state.enrollment.providerSlug] ?? state.enrollment.providerSlug;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className={`flex items-center gap-2 ${isActivate ? "text-emerald-400" : "text-rose-400"}`}>
            {isActivate
              ? <><ShieldCheck className="w-4 h-4" /> Activate Enrollment</>
              : <><ShieldOff className="w-4 h-4" /> Suspend Enrollment</>
            }
          </DialogTitle>
          <DialogDescription>
            {isActivate
              ? `Activate ${providerName} for ${state.enrollment.merchantBusinessName ?? `Merchant #${state.enrollment.merchantId}`}. Payments will start flowing immediately.`
              : `Suspend ${providerName} for ${state.enrollment.merchantBusinessName ?? `Merchant #${state.enrollment.merchantId}`}. The merchant will be notified by email.`
            }
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Credential summary */}
          <div className="p-3 rounded-lg bg-zinc-800/50 border border-zinc-700 space-y-2">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Submitted Credentials</p>
            <div className="flex flex-wrap gap-1.5">
              <CredBadge has={state.enrollment.hasApiKey} label="API Key" />
              <CredBadge has={state.enrollment.hasApiSecret} label="API Secret" />
              <CredBadge has={state.enrollment.hasWebhookSecret} label="Webhook Secret" />
            </div>
            {state.enrollment.maskedIdentifier && (
              <p className="text-xs text-zinc-400">Identifier: ···{state.enrollment.maskedIdentifier}</p>
            )}
          </div>

          {/* Reason (required for suspend, optional for activate) */}
          <div className="space-y-1.5">
            <Label className="text-xs">
              {isActivate ? "Note (optional)" : "Suspension reason"}{" "}
              {!isActivate && <span className="text-rose-400">*</span>}
            </Label>
            <Textarea
              className="bg-zinc-800 border-zinc-700 text-sm resize-none"
              rows={3}
              placeholder={
                isActivate
                  ? "e.g. Credentials verified by KYC team"
                  : "e.g. Invalid API key, credential mismatch, KYC not complete"
              }
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={busy || (!isActivate && !reason.trim())}
            className={isActivate ? "bg-emerald-600 hover:bg-emerald-700 text-white" : "bg-rose-600 hover:bg-rose-700 text-white"}
            onClick={() => onConfirm(reason)}
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
            {isActivate ? "Activate" : "Suspend"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AdminMerchantEnrollments() {
  const [statusFilter, setStatusFilter] = useState("credentials_submitted");
  const [page, setPage] = useState(1);
  const [searchText, setSearchText] = useState("");
  const [confirmState, setConfirmState] = useState<ConfirmDialogState | null>(null);
  const [testResults, setTestResults] = useState<Record<number, TestCredentialsResult>>({});
  const [testingId, setTestingId] = useState<number | null>(null);

  const qc = useQueryClient();
  const { data, isLoading, isFetching, refetch } = useEnrollments(statusFilter, page);
  const { data: pendingCountData } = usePendingCount();
  const updateStatus = useUpdateEnrollmentStatus();
  const testCredentials = useTestCredentials();

  async function handleTestCredentials(enrollment: AdminEnrollment) {
    setTestingId(enrollment.id);
    try {
      const result = await testCredentials.mutateAsync({
        merchantId: enrollment.merchantId,
        providerSlug: enrollment.providerSlug,
      });
      setTestResults((prev) => ({ ...prev, [enrollment.id]: result }));
      if (result.pass) {
        toast.success("Credential test passed");
        // Refetch enrollments so lastVerifiedAt is up-to-date on the row.
        // This ensures a subsequent failed test falls back to the correct
        // persisted timestamp rather than the stale pre-test value.
        qc.invalidateQueries({ queryKey: ["admin", "merchant-enrollments"] });
      } else {
        toast.error(`Credential test failed: ${result.message}`);
      }
    } catch (err: any) {
      toast.error(err.message ?? "Failed to test credentials");
    } finally {
      setTestingId(null);
    }
  }

  const pendingCount = pendingCountData?.count ?? 0;

  // Client-side search filter
  const filtered = (data?.enrollments ?? []).filter((e) => {
    if (!searchText.trim()) return true;
    const q = searchText.toLowerCase();
    return (
      (e.merchantBusinessName ?? "").toLowerCase().includes(q) ||
      (e.merchantEmail ?? "").toLowerCase().includes(q) ||
      e.providerSlug.toLowerCase().includes(q) ||
      String(e.merchantId).includes(q)
    );
  });

  function openConfirm(enrollment: AdminEnrollment, action: "active" | "suspended") {
    setConfirmState({ enrollment, action });
  }

  async function handleConfirm(reason: string) {
    if (!confirmState) return;
    try {
      await updateStatus.mutateAsync({
        merchantId: confirmState.enrollment.merchantId,
        providerSlug: confirmState.enrollment.providerSlug,
        status: confirmState.action,
        reason: reason.trim() || undefined,
      });
      const actionLabel = confirmState.action === "active" ? "activated" : "suspended";
      toast.success(
        `Enrollment ${actionLabel} — merchant will be notified by email.`
      );
      setConfirmState(null);
    } catch (err: any) {
      toast.error(err.message ?? "Failed to update enrollment status");
    }
  }

  const totalPages = data?.totalPages ?? 1;

  return (
    <div className="p-6 space-y-5 max-w-7xl mx-auto">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-white flex items-center gap-2">
            <UserCheck className="w-5 h-5 text-violet-400" />
            Merchant Enrollment Review
          </h1>
          <p className="text-sm text-zinc-400 mt-0.5">
            Review and activate merchant-submitted provider credentials (Category D)
          </p>
        </div>
        <div className="flex items-center gap-2">
          {pendingCount > 0 && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/30">
              <Clock className="w-3 h-3" /> {pendingCount} pending review
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-zinc-500" />
          <Input
            className="pl-8 bg-zinc-900 border-zinc-700 text-sm h-9"
            placeholder="Search merchant name, email, provider…"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="w-44 bg-zinc-900 border-zinc-700 h-9 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTER_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card className="bg-zinc-900 border-zinc-800">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-zinc-300">
            {isLoading ? "Loading…" : `${data?.total ?? 0} enrollment${data?.total !== 1 ? "s" : ""}`}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16 gap-2 text-zinc-500">
              <Loader2 className="w-5 h-5 animate-spin" /> Loading enrollments…
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-zinc-500">
              <CheckCircle2 className="w-8 h-8 mb-2 text-zinc-600" />
              <p className="text-sm">No enrollments match this filter</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-zinc-800 hover:bg-transparent">
                    <TableHead className="text-zinc-400 text-xs">Merchant</TableHead>
                    <TableHead className="text-zinc-400 text-xs">Provider</TableHead>
                    <TableHead className="text-zinc-400 text-xs">Status</TableHead>
                    <TableHead className="text-zinc-400 text-xs">Credentials</TableHead>
                    <TableHead className="text-zinc-400 text-xs">Submitted</TableHead>
                    <TableHead className="text-zinc-400 text-xs">Last Verified</TableHead>
                    <TableHead className="text-zinc-400 text-xs text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((enrollment) => (
                    <TableRow key={enrollment.id} className="border-zinc-800 hover:bg-zinc-800/30">
                      {/* Merchant */}
                      <TableCell className="py-3">
                        <div className="font-medium text-sm text-white">
                          {enrollment.merchantBusinessName ?? `Merchant #${enrollment.merchantId}`}
                        </div>
                        <div className="text-xs text-zinc-500">{enrollment.merchantEmail ?? ""} · ID {enrollment.merchantId}</div>
                      </TableCell>

                      {/* Provider */}
                      <TableCell className="py-3">
                        <div className="text-sm text-white font-medium">
                          {PROVIDER_NAMES[enrollment.providerSlug] ?? enrollment.providerSlug}
                        </div>
                        <div className="text-xs text-zinc-500">{enrollment.providerSlug}</div>
                      </TableCell>

                      {/* Status */}
                      <TableCell className="py-3">
                        <EnrollmentStatusBadge status={enrollment.enrollmentStatus} />
                        {enrollment.failureReason && (
                          <p className="text-xs text-rose-400 mt-1 max-w-[180px] truncate" title={enrollment.failureReason}>
                            {enrollment.failureReason}
                          </p>
                        )}
                      </TableCell>

                      {/* Credentials */}
                      <TableCell className="py-3">
                        <div className="flex flex-wrap gap-1">
                          <CredBadge has={enrollment.hasApiKey} label="Key" />
                          <CredBadge has={enrollment.hasApiSecret} label="Secret" />
                          <CredBadge has={enrollment.hasWebhookSecret} label="Webhook" />
                        </div>
                        {enrollment.maskedIdentifier && (
                          <p className="text-[10px] text-zinc-500 mt-1">···{enrollment.maskedIdentifier}</p>
                        )}
                      </TableCell>

                      {/* Submitted at */}
                      <TableCell className="py-3 text-xs text-zinc-400">
                        {enrollment.updatedAt
                          ? new Date(enrollment.updatedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
                          : "—"}
                      </TableCell>

                      {/* Last Verified */}
                      <TableCell className="py-3 text-xs">
                        {(() => {
                          // Only use the live testedAt when the test passed — the server
                          // only writes lastVerifiedAt on a passing test, so a failed
                          // result must not advance the displayed timestamp.
                          const liveResult = testResults[enrollment.id];
                          const liveTestedAt = liveResult?.pass ? liveResult.testedAt : null;
                          const verifiedAt = liveTestedAt ?? enrollment.lastVerifiedAt;
                          const label = relativeTime(verifiedAt);
                          const isNever = !verifiedAt;
                          return (
                            <span className={isNever ? "text-zinc-600" : "text-zinc-400"}>
                              {label}
                            </span>
                          );
                        })()}
                      </TableCell>

                      {/* Actions */}
                      <TableCell className="py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {(enrollment.enrollmentStatus === "credentials_submitted" ||
                            enrollment.enrollmentStatus === "active" ||
                            enrollment.enrollmentStatus === "suspended") && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs border-sky-500/50 text-sky-400 hover:bg-sky-500/10 hover:text-sky-300"
                              disabled={testingId === enrollment.id}
                              onClick={() => handleTestCredentials(enrollment)}
                            >
                              {testingId === enrollment.id
                                ? <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                : <FlaskConical className="w-3 h-3 mr-1" />}
                              Test Credentials
                            </Button>
                          )}
                          {(enrollment.enrollmentStatus === "credentials_submitted" || enrollment.enrollmentStatus === "suspended") && (
                            <Button
                              size="sm"
                              className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                              onClick={() => openConfirm(enrollment, "active")}
                            >
                              <ShieldCheck className="w-3 h-3 mr-1" /> Activate
                            </Button>
                          )}
                          {(enrollment.enrollmentStatus === "credentials_submitted" || enrollment.enrollmentStatus === "active") && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs border-rose-500/50 text-rose-400 hover:bg-rose-500/10 hover:text-rose-300"
                              onClick={() => openConfirm(enrollment, "suspended")}
                            >
                              <ShieldOff className="w-3 h-3 mr-1" /> Suspend
                            </Button>
                          )}
                          {enrollment.enrollmentStatus !== "credentials_submitted" &&
                           enrollment.enrollmentStatus !== "active" &&
                           enrollment.enrollmentStatus !== "suspended" && (
                            <span className="text-xs text-zinc-600">No actions available</span>
                          )}
                        </div>
                        {testResults[enrollment.id] && (
                          <div
                            className={`mt-1.5 inline-flex flex-col items-end gap-0.5 text-right ${
                              testResults[enrollment.id]!.pass ? "text-emerald-400" : "text-rose-400"
                            }`}
                          >
                            <span className="inline-flex items-center gap-1 text-xs font-medium">
                              {testResults[enrollment.id]!.pass
                                ? <CheckCircle2 className="w-3 h-3" />
                                : <XCircle className="w-3 h-3" />}
                              {testResults[enrollment.id]!.pass ? "Test passed" : "Test failed"} — {testResults[enrollment.id]!.message}
                            </span>
                            {testResults[enrollment.id]!.detail && (
                              <span className="text-[10px] text-zinc-500 max-w-[280px]">
                                {testResults[enrollment.id]!.detail}
                              </span>
                            )}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-zinc-400">
          <span>Page {page} of {totalPages}</span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || isFetching}
              onClick={() => setPage((p) => p - 1)}
              className="h-7 px-2"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages || isFetching}
              onClick={() => setPage((p) => p + 1)}
              className="h-7 px-2"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Confirm dialog */}
      <ConfirmStatusDialog
        state={confirmState}
        onClose={() => setConfirmState(null)}
        onConfirm={handleConfirm}
        busy={updateStatus.isPending}
      />
    </div>
  );
}
