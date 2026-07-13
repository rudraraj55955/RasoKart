import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getToken } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import {
  CheckCircle2,
  XCircle,
  Clock,
  ShieldCheck,
  AlertCircle,
  ChevronRight,
  FileText,
  Fingerprint,
  BadgeCheck,
} from "lucide-react";
import { toast } from "sonner";

async function apiFetch<T>(url: string, opts?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(url, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(opts?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error((e as any).error ?? "Request failed");
  }
  return res.json();
}

type KycStatus =
  | "PENDING"
  | "PAN_VERIFIED"
  | "AADHAAR_VERIFIED"
  | "APPROVED"
  | "MANUAL_REVIEW"
  | "NAME_MISMATCH"
  | "PAN_FAILED"
  | "AADHAAR_FAILED"
  | "CONTACT_PENDING"
  | "BLOCKED"
  | "REJECTED"
  | string;

function StatusBadge({ status }: { status: KycStatus }) {
  const map: Record<string, { label: string; cls: string }> = {
    APPROVED: {
      label: "KYC Approved",
      cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    },
    PAN_VERIFIED: {
      label: "PAN Verified",
      cls: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    },
    AADHAAR_VERIFIED: {
      label: "Aadhaar Verified",
      cls: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    },
    MANUAL_REVIEW: {
      label: "Under Review",
      cls: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    },
    NAME_MISMATCH: {
      label: "Name Mismatch",
      cls: "bg-red-500/15 text-red-400 border-red-500/30",
    },
    PENDING: {
      label: "Verification Pending",
      cls: "bg-muted/30 text-muted-foreground border-border",
    },
    BLOCKED: {
      label: "Blocked",
      cls: "bg-red-500/15 text-red-400 border-red-500/30",
    },
    REJECTED: {
      label: "Rejected",
      cls: "bg-red-500/15 text-red-400 border-red-500/30",
    },
  };
  const m = map[status] ?? {
    label: status,
    cls: "bg-muted/30 text-muted-foreground border-border",
  };
  return (
    <Badge variant="outline" className={`text-[11px] border ${m.cls}`}>
      {m.label}
    </Badge>
  );
}

function StepIcon({
  done,
  active,
  failed,
}: {
  done: boolean;
  active: boolean;
  failed: boolean;
}) {
  if (done)
    return <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />;
  if (failed) return <XCircle className="w-5 h-5 text-red-400 shrink-0" />;
  if (active)
    return <Clock className="w-5 h-5 text-blue-400 shrink-0 animate-pulse" />;
  return (
    <div className="w-5 h-5 rounded-full border border-border shrink-0" />
  );
}

export default function PayoutMerchantKyc() {
  const qc = useQueryClient();
  const [panNumber, setPanNumber] = useState("");
  const [panDone, setPanDone] = useState(false);

  const { data: kycData, isLoading } = useQuery<any>({
    queryKey: ["payout-merchant-kyc-status"],
    queryFn: () => apiFetch<any>("/api/payout-merchant/kyc/status"),
    refetchInterval: 10_000,
  });

  useEffect(() => {
    if (kycData?.panVerified) setPanDone(true);
  }, [kycData?.panVerified]);

  const status: KycStatus = kycData?.status ?? "PENDING";
  const panVerified: boolean = kycData?.panVerified ?? false;
  const aadhaarVerified: boolean = kycData?.aadhaarVerified ?? false;
  const isApproved = status === "APPROVED";
  const isManualReview = status === "MANUAL_REVIEW";
  const isBlocked = status === "BLOCKED" || status === "REJECTED";
  const nameMatchScore: number | null = kycData?.nameMatchScore ?? null;

  const panMutation = useMutation({
    mutationFn: (pan: string) =>
      apiFetch<any>("/api/payout-merchant/kyc/pan/verify", {
        method: "POST",
        body: JSON.stringify({ panNumber: pan }),
      }),
    onSuccess: (data) => {
      toast.success(`PAN verified — type: ${data.panType ?? "PERSONAL"}`);
      setPanDone(true);
      qc.invalidateQueries({ queryKey: ["payout-merchant-kyc-status"] });
    },
    onError: (err: any) => toast.error(err.message ?? "PAN verification failed"),
  });

  const aadhaarStartMutation = useMutation({
    mutationFn: () =>
      apiFetch<any>("/api/payout-merchant/kyc/aadhaar/start", { method: "POST", body: "{}" }),
    onSuccess: (data) => {
      if (data.sessionId) {
        toast.info("Aadhaar DigiLocker session started. Redirecting…");
        // Store session in sessionStorage for auth-code return
        sessionStorage.setItem("payout_kyc_aadhaar_session", data.sessionId);
        // The DigiLocker redirect is handled by the Secure ID SDK / authorization URL
        // In a production integration this would open the DigiLocker OAuth flow
        toast.success(
          "Aadhaar verification initiated. Once you complete DigiLocker consent, return here to finalize.",
        );
      }
      qc.invalidateQueries({ queryKey: ["payout-merchant-kyc-status"] });
    },
    onError: (err: any) =>
      toast.error(err.message ?? "Could not start Aadhaar verification"),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner className="w-6 h-6 text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <ShieldCheck className="w-6 h-6 text-primary" />
          Identity Verification
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Complete KYC to activate your payout account. Your information is securely encrypted.
        </p>
      </div>

      {/* Overall status */}
      <Card className="bg-card border-border/50">
        <CardContent className="p-4 flex items-center justify-between">
          <span className="text-sm text-muted-foreground">KYC Status</span>
          <StatusBadge status={status} />
        </CardContent>
      </Card>

      {/* Approved state */}
      {isApproved && (
        <Card className="bg-emerald-500/5 border-emerald-500/30">
          <CardContent className="p-5 flex items-start gap-3">
            <BadgeCheck className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-emerald-400">
                KYC Approved — Payout Account Active
              </p>
              <p className="text-xs text-emerald-400/70 mt-0.5">
                Your identity has been verified. You can now send payouts using your wallet.
              </p>
              {nameMatchScore != null && (
                <p className="text-xs text-muted-foreground mt-1">
                  Name match score: {nameMatchScore}/100
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Manual review state */}
      {isManualReview && !isApproved && (
        <Card className="bg-amber-500/5 border-amber-500/30">
          <CardContent className="p-5 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-400">Under Manual Review</p>
              <p className="text-xs text-amber-400/70 mt-0.5">
                Your KYC documents are being reviewed by our compliance team. This typically takes
                1–2 business days. You will be notified once approved.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Blocked state */}
      {isBlocked && (
        <Card className="bg-red-500/5 border-red-500/30">
          <CardContent className="p-5 flex items-start gap-3">
            <XCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-red-400">Verification Failed</p>
              <p className="text-xs text-red-400/70 mt-0.5">
                {kycData?.failureReason ?? "KYC verification could not be completed. Please contact support."}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step-by-step progress */}
      {!isApproved && !isBlocked && (
        <div className="space-y-3">
          {/* Step 1 — PAN */}
          <Card className="bg-card border-border/50">
            <CardHeader className="p-4 pb-0">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <FileText className="w-4 h-4 text-muted-foreground" />
                Step 1 — PAN Verification
                <StepIcon done={panVerified} active={!panVerified} failed={false} />
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-3">
              {panVerified ? (
                <div className="flex items-center gap-2 text-sm text-emerald-400">
                  <CheckCircle2 className="w-4 h-4" />
                  PAN verified — {kycData?.panNumberMasked ?? "••••••••••"}
                  {kycData?.panType && (
                    <Badge variant="outline" className="text-[10px] border-emerald-500/30 bg-emerald-500/15 text-emerald-400 ml-1">
                      {kycData.panType}
                    </Badge>
                  )}
                </div>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">
                    Enter your PAN number to verify your identity.
                  </p>
                  <div className="flex gap-2">
                    <Input
                      placeholder="e.g. ABCDE1234F"
                      value={panNumber}
                      onChange={(e) => setPanNumber(e.target.value.toUpperCase())}
                      maxLength={10}
                      className="uppercase font-mono text-sm"
                      disabled={panMutation.isPending}
                    />
                    <Button
                      onClick={() => {
                        if (!panNumber.trim()) return;
                        panMutation.mutate(panNumber.trim());
                      }}
                      disabled={panMutation.isPending || !panNumber.trim()}
                    >
                      {panMutation.isPending ? (
                        <Spinner className="w-4 h-4 mr-1" />
                      ) : null}
                      Verify
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Format: 5 letters + 4 digits + 1 letter (e.g. ABCDE1234F)
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          {/* Step 2 — Aadhaar */}
          <Card
            className={`bg-card border-border/50 ${!panVerified ? "opacity-50 pointer-events-none" : ""}`}
          >
            <CardHeader className="p-4 pb-0">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Fingerprint className="w-4 h-4 text-muted-foreground" />
                Step 2 — Aadhaar Verification
                <StepIcon
                  done={aadhaarVerified}
                  active={panVerified && !aadhaarVerified}
                  failed={status === "AADHAAR_FAILED"}
                />
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-3">
              {aadhaarVerified ? (
                <div className="flex items-center gap-2 text-sm text-emerald-400">
                  <CheckCircle2 className="w-4 h-4" />
                  Aadhaar verified — ••••-••••-{kycData?.aadhaarLast4 ?? "****"}
                </div>
              ) : panVerified ? (
                <>
                  <p className="text-xs text-muted-foreground">
                    Verify your Aadhaar using the secure DigiLocker consent flow. Only the last 4
                    digits of your Aadhaar number are stored.
                  </p>
                  <div className="rounded-md border border-border/50 bg-muted/10 p-3 text-xs text-muted-foreground space-y-1">
                    <p>• You will be redirected to DigiLocker to complete consent</p>
                    <p>• Full Aadhaar number is never stored on our servers</p>
                    <p>• Consent timestamp and IP are logged for compliance</p>
                  </div>
                  {status === "AADHAAR_FAILED" && (
                    <p className="text-xs text-red-400">
                      {kycData?.failureReason ?? "Aadhaar verification failed. Please try again."}
                    </p>
                  )}
                  <Button
                    onClick={() => aadhaarStartMutation.mutate()}
                    disabled={aadhaarStartMutation.isPending}
                    variant="outline"
                  >
                    {aadhaarStartMutation.isPending ? (
                      <Spinner className="w-4 h-4 mr-1" />
                    ) : (
                      <ChevronRight className="w-4 h-4 mr-1" />
                    )}
                    Start Aadhaar Verification
                  </Button>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Complete PAN verification first to unlock this step.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Step 3 — Name match & auto-approval */}
          <Card
            className={`bg-card border-border/50 ${!aadhaarVerified ? "opacity-50 pointer-events-none" : ""}`}
          >
            <CardHeader className="p-4 pb-0">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <BadgeCheck className="w-4 h-4 text-muted-foreground" />
                Step 3 — Review &amp; Approval
                <StepIcon
                  done={isApproved || isManualReview}
                  active={aadhaarVerified && !isApproved && !isManualReview}
                  failed={status === "NAME_MISMATCH"}
                />
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              {aadhaarVerified ? (
                <div className="space-y-2">
                  {nameMatchScore != null && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground text-xs">Name match score</span>
                      <span
                        className={
                          nameMatchScore >= 80
                            ? "text-emerald-400 font-medium"
                            : "text-red-400 font-medium"
                        }
                      >
                        {nameMatchScore}/100
                      </span>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {status === "NAME_MISMATCH"
                      ? (kycData?.failureReason ?? "Name mismatch detected. Please contact support.")
                      : status === "MANUAL_REVIEW"
                      ? "Application under manual review."
                      : "Awaiting auto-approval decision…"}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Complete Aadhaar verification to proceed to review.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Security note */}
      <p className="text-[10px] text-muted-foreground/60 text-center">
        Your documents are verified in real-time. Only masked data is stored. Full Aadhaar
        numbers are never retained on our servers.
      </p>
    </div>
  );
}
