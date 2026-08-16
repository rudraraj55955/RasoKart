/**
 * Merchant Connect — Provider enrollment hub.
 *
 * Shows all 12 providers with their self-service enrollment status:
 *   • Category A (EKQR): admin-managed, shows live status from connections API
 *   • Category D (PhonePe, Paytm, BharatPe, Amazon Pay, MobiKwik): self-service
 *     enrollment: onboarding link → KYC → credential submission → active
 *   • Category E (Freecharge, SBI YONO, HDFC SmartHub, ICICI Eazypay, Axis Pay,
 *     Kotak Smart): unsupported due to banking regulation / ToS
 *
 * Credentials are write-only — never pre-populated after submission.
 * Audit log shows non-secret events (connect, credential update, disconnect).
 */

import { useState, useEffect } from "react";
import { useListProviders, useListMerchantConnections } from "@workspace/api-client-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Search, AtSign, Smartphone, Store, Landmark, Building, Zap, RefreshCw, Link2,
  ExternalLink, ShieldOff, CheckCircle2, Clock, AlertTriangle, XCircle, FileText,
  Key, Unlink, ArrowRight, Info, ChevronRight,
} from "lucide-react";
import { toast } from "sonner";

// ── Types ──────────────────────────────────────────────────────────────────────

interface OnboardingInfo {
  slug: string;
  category: "A" | "D" | "E";
  signupUrl: string | null;
  kycDocuments: string[];
  loginMethods: string[];
  onboardingTimeline: string | null;
  supportsSelfSubmit: boolean;
  finalStatus: string;
}

interface Enrollment {
  id: number | null;
  providerSlug: string;
  enrollmentStatus:
    | "not_enrolled" | "pending_kyc" | "credentials_submitted"
    | "active" | "suspended" | "disconnected";
  maskedIdentifier: string | null;
  onboardingUrl: string | null;
  hasApiKey: boolean;
  hasApiSecret: boolean;
  hasWebhookSecret: boolean;
  connectedAt: string | null;
  lastVerifiedAt: string | null;
  disconnectedAt: string | null;
  disconnectedBy: string | null;
  failureReason: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  onboardingInfo: OnboardingInfo | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PROVIDER_WHITE_LABEL: Record<string, string> = {
  upi_id:        "RasoKart UPI",
  google_pay:    "RasoKart UPI",
  phonepe:       "RasoKart Collect",
  paytm:         "RasoKart Wallet",
  bharatpe:      "RasoKart Merchant",
  freecharge:    "RasoKart Pay",
  amazon_pay:    "RasoKart Digital",
  mobikwik:      "Mobile Wallet",
  sbi_yono:      "Bank UPI",
  hdfc_smarthub: "Bank SmartQR",
  icici_eazypay: "Bank QR",
  axis_pay:      "Bank QR",
  kotak_smart:   "Bank Smart Collect",
  razorpay:      "RasoKart Gateway",
  cashfree:      "RasoKart Payments",
  payu:          "RasoKart Gateway Plus",
  ekqr:          "RasoKart QR Gateway",
};

const PROVIDER_DESC: Record<string, string> = {
  phonepe:       "QR-based UPI merchant payments via PhonePe Business",
  paytm:         "UPI, wallet, and net banking collections via Paytm Business",
  bharatpe:      "Zero MDR UPI collections via BharatPe QR",
  amazon_pay:    "UPI merchant checkout via Amazon Pay for Business",
  mobikwik:      "Mobile wallet payment gateway via MobiKwik Business",
  ekqr:          "Dynamic QR and auto-credit deposits — managed by RasoKart",
  freecharge:    "Not available — deprecated provider",
  sbi_yono:      "Not available — regulated banking product",
  hdfc_smarthub: "Not available — regulated banking product",
  icici_eazypay: "Not available — regulated banking product",
  axis_pay:      "Not available — regulated banking product",
  kotak_smart:   "Not available — regulated banking product",
};

const CATEGORY_META: Record<string, { label: string; color: string }> = {
  upi:     { label: "UPI",     color: "bg-violet-500/10 text-violet-400 border-violet-500/20" },
  bank:    { label: "Bank",    color: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  gateway: { label: "Gateway", color: "bg-orange-500/10 text-orange-400 border-orange-500/20" },
};

const STATUS_META: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  live:                 { label: "Live",         color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30", icon: <CheckCircle2 className="w-3 h-3" /> },
  testing:              { label: "Testing",      color: "bg-amber-500/10 text-amber-400 border-amber-500/30",       icon: <Clock className="w-3 h-3" /> },
  coming_soon:          { label: "Coming Soon",  color: "bg-sky-500/10 text-sky-400 border-sky-500/30",             icon: <Clock className="w-3 h-3" /> },
  disabled:             { label: "Disabled",     color: "bg-muted text-muted-foreground border-border",             icon: <XCircle className="w-3 h-3" /> },
};

const ENROLLMENT_BADGE: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  not_enrolled:           { label: "Not Connected",    color: "bg-muted text-muted-foreground border-border",                icon: <XCircle className="w-3 h-3" /> },
  pending_kyc:            { label: "Pending KYC",      color: "bg-amber-500/10 text-amber-400 border-amber-500/30",          icon: <Clock className="w-3 h-3" /> },
  credentials_submitted:  { label: "Under Review",     color: "bg-sky-500/10 text-sky-400 border-sky-500/30",                icon: <Clock className="w-3 h-3" /> },
  active:                 { label: "Connected",        color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",    icon: <CheckCircle2 className="w-3 h-3" /> },
  suspended:              { label: "Suspended",        color: "bg-rose-500/10 text-rose-400 border-rose-500/30",             icon: <AlertTriangle className="w-3 h-3" /> },
  disconnected:           { label: "Disconnected",     color: "bg-muted text-muted-foreground border-border",                icon: <XCircle className="w-3 h-3" /> },
};

const ICONS: Record<string, React.ReactNode> = {
  phonepe:       <Smartphone className="w-7 h-7 text-purple-400" />,
  paytm:         <Smartphone className="w-7 h-7 text-blue-500" />,
  bharatpe:      <Store className="w-7 h-7 text-green-400" />,
  freecharge:    <Zap className="w-7 h-7 text-rose-400" />,
  sbi_yono:      <Landmark className="w-7 h-7 text-red-400" />,
  hdfc_smarthub: <Building className="w-7 h-7 text-yellow-400" />,
  icici_eazypay: <Building className="w-7 h-7 text-orange-400" />,
  axis_pay:      <Building className="w-7 h-7 text-amber-400" />,
  kotak_smart:   <Building className="w-7 h-7 text-red-500" />,
  amazon_pay:    <Store className="w-7 h-7 text-orange-400" />,
  mobikwik:      <Smartphone className="w-7 h-7 text-indigo-400" />,
  ekqr:          <Zap className="w-7 h-7 text-emerald-400" />,
  upi_id:        <AtSign className="w-7 h-7 text-emerald-400" />,
  google_pay:    <Zap className="w-7 h-7 text-blue-400" />,
};

function ProviderIcon({ slug }: { slug: string }) {
  return ICONS[slug] ?? <Zap className="w-7 h-7 text-muted-foreground" />;
}

function wlName(slug: string, name: string): string {
  return PROVIDER_WHITE_LABEL[slug] ?? name;
}

function usagePct(used: number, limit: number) {
  if (limit <= 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

function usageColor(pct: number) {
  if (pct >= 100) return "text-rose-400";
  if (pct >= 80) return "text-amber-400";
  return "text-emerald-400";
}

function progressColor(pct: number) {
  if (pct >= 100) return "[&>div]:bg-rose-500";
  if (pct >= 80) return "[&>div]:bg-amber-500";
  return "[&>div]:bg-emerald-500";
}

// ── API helpers ───────────────────────────────────────────────────────────────

/** Get the stored JWT exactly as every other merchant page does. */
function getToken(): string {
  return localStorage.getItem("rasokart_token") ?? "";
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = getToken();
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

async function enrollFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const isJson = init?.body != null;
  return fetch(path, {
    ...init,
    headers: authHeaders(isJson ? { "Content-Type": "application/json" } : {}),
  });
}

// ── API hooks ─────────────────────────────────────────────────────────────────

const ENROLLMENT_QUERY_KEY = ["merchant", "enrollments"] as const;

function useEnrollments() {
  return useQuery<Enrollment[]>({
    queryKey: ENROLLMENT_QUERY_KEY,
    queryFn: async () => {
      const res = await enrollFetch("/api/merchant/enrollments");
      if (!res.ok) throw new Error(`Failed to fetch enrollments: ${res.status}`);
      return res.json();
    },
    staleTime: 30_000,
  });
}

function useInitiateEnrollment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { providerSlug: string }) => {
      const res = await enrollFetch("/api/merchant/enrollments", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error ?? "Failed to initiate enrollment");
      }
      return res.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ENROLLMENT_QUERY_KEY }); },
  });
}

function useSubmitCredentials() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      providerSlug: string;
      apiKey?: string;
      apiSecret?: string;
      webhookSecret?: string;
    }) => {
      const { providerSlug, ...creds } = payload;
      const res = await enrollFetch(
        `/api/merchant/enrollments/${providerSlug}/credentials`,
        { method: "PUT", body: JSON.stringify(creds) },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error ?? "Failed to submit credentials");
      }
      return res.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ENROLLMENT_QUERY_KEY }); },
  });
}

function useDisconnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (providerSlug: string) => {
      const res = await enrollFetch(
        `/api/merchant/enrollments/${providerSlug}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error ?? "Failed to disconnect");
      }
      return res.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ENROLLMENT_QUERY_KEY }); },
  });
}

// ── Enrollment flow dialog ────────────────────────────────────────────────────

type FlowStep = "onboarding" | "credentials";

function EnrollFlowDialog({
  provider,
  enrollment,
  open,
  onClose,
}: {
  provider: any;
  enrollment: Enrollment | null;
  open: boolean;
  onClose: () => void;
}) {
  const [step, setStep] = useState<FlowStep>("onboarding");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");

  const initiateEnrollment = useInitiateEnrollment();
  const submitCredentials = useSubmitCredentials();
  const info = enrollment?.onboardingInfo;

  // Auto-advance if already past onboarding step
  useEffect(() => {
    if (!open) return;
    if (
      enrollment?.enrollmentStatus === "pending_kyc" ||
      enrollment?.enrollmentStatus === "credentials_submitted" ||
      enrollment?.enrollmentStatus === "disconnected"
    ) {
      setStep("onboarding");
    }
  }, [open, enrollment?.enrollmentStatus]);

  // Reset form on dialog open
  useEffect(() => {
    if (open) {
      setApiKey("");
      setApiSecret("");
      setWebhookSecret("");
    }
  }, [open]);

  async function handleInitiate() {
    try {
      await initiateEnrollment.mutateAsync({ providerSlug: provider.slug });
      setStep("credentials");
    } catch (err: any) {
      toast.error(err.message ?? "Failed to initiate enrollment");
    }
  }

  async function handleSubmitCredentials() {
    if (!apiKey && !apiSecret && !webhookSecret) {
      toast.error("Please enter at least one credential field");
      return;
    }
    try {
      await submitCredentials.mutateAsync({
        providerSlug: provider.slug,
        ...(apiKey ? { apiKey } : {}),
        ...(apiSecret ? { apiSecret } : {}),
        ...(webhookSecret ? { webhookSecret } : {}),
      });
      toast.success("Credentials submitted successfully. Your account is under review.");
      onClose();
    } catch (err: any) {
      toast.error(err.message ?? "Failed to submit credentials");
    }
  }

  const alreadyEnrolled = enrollment && enrollment.enrollmentStatus !== "not_enrolled" && enrollment.enrollmentStatus !== "disconnected";

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ProviderIcon slug={provider.slug} />
            Connect {wlName(provider.slug, provider.name)}
          </DialogTitle>
          <DialogDescription>
            {step === "onboarding"
              ? "Complete provider KYC before submitting credentials"
              : "Enter your approved API credentials from the provider portal"}
          </DialogDescription>
        </DialogHeader>

        {step === "onboarding" && (
          <div className="space-y-5 py-2">
            {/* Step indicators */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-1 text-primary font-medium">
                <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-bold">1</span>
                Sign up & KYC
              </div>
              <ChevronRight className="w-3 h-3" />
              <div className="flex items-center gap-1">
                <span className="w-5 h-5 rounded-full bg-muted text-muted-foreground flex items-center justify-center text-[10px] font-bold">2</span>
                Submit credentials
              </div>
            </div>

            {/* Onboarding link */}
            {info?.signupUrl && (
              <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
                <p className="text-sm font-medium text-foreground mb-1">
                  Step 1: Complete {wlName(provider.slug, provider.name)} KYC
                </p>
                <p className="text-xs text-muted-foreground mb-3">
                  Open the provider portal, complete business KYC, and obtain your API credentials.
                </p>
                <a
                  href={info.signupUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-xs font-medium text-primary hover:underline"
                >
                  Go to {provider.name} Business Portal <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            )}

            {/* KYC documents */}
            {info?.kycDocuments && info.kycDocuments.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5" /> Required KYC Documents
                </p>
                <ul className="space-y-1">
                  {info.kycDocuments.map(doc => (
                    <li key={doc} className="text-xs text-foreground flex items-start gap-2">
                      <span className="text-muted-foreground mt-0.5">•</span> {doc}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Timeline */}
            {info?.onboardingTimeline && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/30 border border-border/50">
                <Clock className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Estimated timeline: </span>
                  {info.onboardingTimeline}
                </p>
              </div>
            )}

            {/* Current enrollment status (if re-enrolling) */}
            {alreadyEnrolled && (
              <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
                <p className="text-xs text-amber-400">
                  You already started enrollment for this provider. Continuing will restart the onboarding flow.
                </p>
              </div>
            )}

            {enrollment?.enrollmentStatus === "credentials_submitted" && (
              <div className="p-3 rounded-lg bg-sky-500/5 border border-sky-500/20">
                <p className="text-xs text-sky-400">
                  Your credentials are currently under review. You can update them below if needed.
                </p>
              </div>
            )}
          </div>
        )}

        {step === "credentials" && (
          <div className="space-y-5 py-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-1 text-muted-foreground">
                <span className="w-5 h-5 rounded-full bg-muted text-muted-foreground flex items-center justify-center text-[10px] font-bold">1</span>
                Sign up &amp; KYC
              </div>
              <ChevronRight className="w-3 h-3" />
              <div className="flex items-center gap-1 text-primary font-medium">
                <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-bold">2</span>
                Submit credentials
              </div>
            </div>

            <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 flex items-start gap-2">
              <Key className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-400">
                Credentials are encrypted and stored securely. They are write-only — you will not be able to view them after saving. Enter the full value each time you update.
              </p>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">API Key</Label>
                <Input
                  type="password"
                  placeholder={enrollment?.hasApiKey ? "Already set — enter new value to update" : "Enter API key from provider portal"}
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">API Secret</Label>
                <Input
                  type="password"
                  placeholder={enrollment?.hasApiSecret ? "Already set — enter new value to update" : "Enter API secret from provider portal"}
                  value={apiSecret}
                  onChange={e => setApiSecret(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Webhook Secret <span className="text-muted-foreground">(optional)</span></Label>
                <Input
                  type="password"
                  placeholder={enrollment?.hasWebhookSecret ? "Already set — enter new value to update" : "Enter webhook secret (if provided)"}
                  value={webhookSecret}
                  onChange={e => setWebhookSecret(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Leave a field blank to keep the current value (if already set).
              Enter at least one credential to submit.
            </p>
          </div>
        )}

        <DialogFooter className="flex-col sm:flex-row gap-2">
          {step === "onboarding" ? (
            <>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              {enrollment?.enrollmentStatus === "credentials_submitted" ? (
                <Button onClick={() => setStep("credentials")} className="gap-2">
                  Update Credentials <ArrowRight className="w-4 h-4" />
                </Button>
              ) : (
                <Button
                  onClick={handleInitiate}
                  disabled={initiateEnrollment.isPending}
                  className="gap-2"
                >
                  {initiateEnrollment.isPending ? "Starting…" : "Start Enrollment"}
                  <ArrowRight className="w-4 h-4" />
                </Button>
              )}
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setStep("onboarding")}>Back</Button>
              <Button
                onClick={handleSubmitCredentials}
                disabled={submitCredentials.isPending || (!apiKey && !apiSecret && !webhookSecret)}
                className="gap-2"
              >
                {submitCredentials.isPending ? "Submitting…" : "Submit Credentials"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Disconnect dialog ─────────────────────────────────────────────────────────

function DisconnectDialog({
  providerSlug,
  providerName,
  open,
  onClose,
}: {
  providerSlug: string;
  providerName: string;
  open: boolean;
  onClose: () => void;
}) {
  const disconnect = useDisconnect();

  async function handleDisconnect() {
    try {
      await disconnect.mutateAsync(providerSlug);
      toast.success(`${providerName} disconnected successfully`);
      onClose();
    } catch (err: any) {
      toast.error(err.message ?? "Failed to disconnect");
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={o => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Disconnect {providerName}?</AlertDialogTitle>
          <AlertDialogDescription>
            This will clear all stored API credentials for {providerName} and set the connection status to disconnected.
            You will need to re-submit credentials to reconnect. This action is logged for audit purposes.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDisconnect}
            disabled={disconnect.isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {disconnect.isPending ? "Disconnecting…" : "Disconnect"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ── Enrollment card for Category D providers ──────────────────────────────────

function EnrollmentCard({
  provider,
  enrollment,
}: {
  provider: any;
  enrollment: Enrollment | null;
}) {
  const [flowOpen, setFlowOpen] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const cmeta = CATEGORY_META[provider.category] ?? { label: provider.category, color: "bg-muted text-muted-foreground border-border" };
  const status = enrollment?.enrollmentStatus ?? "not_enrolled";
  const ebadge = ENROLLMENT_BADGE[status] ?? ENROLLMENT_BADGE.not_enrolled;
  const providerName = wlName(provider.slug, provider.name);
  const desc = PROVIDER_DESC[provider.slug] ?? provider.description;
  const canConnect = status === "not_enrolled" || status === "disconnected";
  const canUpdate = status === "pending_kyc" || status === "credentials_submitted";
  const isActive = status === "active";
  const isSuspended = status === "suspended";

  return (
    <>
      <Card className="border-border/60 hover:border-primary/30 transition-colors bg-card">
        <CardHeader className="pb-2">
          <div className="flex items-start gap-3">
            <div className="w-14 h-14 rounded-xl bg-background border border-border/60 flex items-center justify-center shrink-0">
              <ProviderIcon slug={provider.slug} />
            </div>
            <div className="flex-1 min-w-0">
              <CardTitle className="text-base truncate">{providerName}</CardTitle>
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                <Badge variant="outline" className={`text-xs ${cmeta.color}`}>{cmeta.label}</Badge>
                <Badge variant="outline" className={`text-xs flex items-center gap-1 ${ebadge.color}`}>
                  {ebadge.icon} {ebadge.label}
                </Badge>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {desc && <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>}

          {/* Suspended alert */}
          {isSuspended && (
            <div className="p-2.5 rounded-lg bg-rose-500/5 border border-rose-500/20 flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-rose-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-medium text-rose-400">Connection suspended</p>
                {enrollment?.failureReason && (
                  <p className="text-xs text-rose-400/70 mt-0.5">{enrollment.failureReason}</p>
                )}
                <p className="text-xs text-rose-400/70 mt-1">Please reconnect to restore access.</p>
              </div>
            </div>
          )}

          {/* Credentials submitted info */}
          {status === "credentials_submitted" && (
            <div className="p-2.5 rounded-lg bg-sky-500/5 border border-sky-500/20 flex items-start gap-2">
              <Info className="w-3.5 h-3.5 text-sky-400 mt-0.5 shrink-0" />
              <p className="text-xs text-sky-400">Credentials submitted. Under review by RasoKart team.</p>
            </div>
          )}

          {/* Connected timestamp */}
          {isActive && enrollment?.connectedAt && (
            <p className="text-xs text-muted-foreground">
              Connected {new Date(enrollment.connectedAt).toLocaleDateString("en-IN")}
            </p>
          )}

          {/* Action buttons */}
          <div className="flex gap-2">
            {(canConnect || isSuspended) && (
              <Button size="sm" className="flex-1" onClick={() => setFlowOpen(true)}>
                Connect
              </Button>
            )}
            {canUpdate && (
              <Button size="sm" variant="outline" className="flex-1" onClick={() => setFlowOpen(true)}>
                Manage Enrollment
              </Button>
            )}
            {(isActive || canUpdate || isSuspended) && (
              <Button
                size="sm"
                variant="ghost"
                className="text-muted-foreground hover:text-destructive flex items-center gap-1.5"
                onClick={() => setDisconnectOpen(true)}
              >
                <Unlink className="w-3.5 h-3.5" /> Disconnect
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <EnrollFlowDialog
        provider={provider}
        enrollment={enrollment}
        open={flowOpen}
        onClose={() => setFlowOpen(false)}
      />
      <DisconnectDialog
        providerSlug={provider.slug}
        providerName={providerName}
        open={disconnectOpen}
        onClose={() => setDisconnectOpen(false)}
      />
    </>
  );
}

// ── Category E (Unsupported) card ─────────────────────────────────────────────

function UnsupportedCard({ provider }: { provider: any }) {
  const cmeta = CATEGORY_META[provider.category] ?? { label: provider.category, color: "bg-muted text-muted-foreground border-border" };
  const providerName = wlName(provider.slug, provider.name);
  const desc = PROVIDER_DESC[provider.slug] ?? provider.description;

  return (
    <Card className="border-border/30 bg-muted/10 opacity-75">
      <CardHeader className="pb-2">
        <div className="flex items-start gap-3">
          <div className="w-14 h-14 rounded-xl bg-background/50 border border-border/30 flex items-center justify-center shrink-0 grayscale">
            <ProviderIcon slug={provider.slug} />
          </div>
          <div className="flex-1 min-w-0">
            <CardTitle className="text-base text-muted-foreground truncate">{providerName}</CardTitle>
            <div className="flex items-center gap-1.5 mt-1">
              <Badge variant="outline" className={`text-xs ${cmeta.color}`}>{cmeta.label}</Badge>
              <Badge variant="outline" className="text-xs bg-muted text-muted-foreground border-border flex items-center gap-1">
                <ShieldOff className="w-3 h-3" /> Not Available
              </Badge>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {desc && <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>}
        <div className="p-2.5 rounded-lg bg-muted/30 border border-border/50">
          <p className="text-xs text-muted-foreground">
            This provider is not available for merchant connection due to regulatory restrictions or deprecation.
          </p>
        </div>
        <Button size="sm" className="w-full" variant="outline" disabled>
          Not Available
        </Button>
      </CardContent>
    </Card>
  );
}

// ── EKQR platform-managed card ────────────────────────────────────────────────

function EkqrCard({ provider, connections }: { provider: any; connections: any[] | null }) {
  const conn = connections?.find(c => c.provider === "ekqr");
  const isActive = conn?.isActive ?? false;
  const providerName = wlName(provider.slug, provider.name);

  return (
    <Card className="border-emerald-500/30 bg-card">
      <CardHeader className="pb-2">
        <div className="flex items-start gap-3">
          <div className="w-14 h-14 rounded-xl bg-emerald-500/5 border border-emerald-500/30 flex items-center justify-center shrink-0">
            <ProviderIcon slug={provider.slug} />
          </div>
          <div className="flex-1 min-w-0">
            <CardTitle className="text-base truncate">{providerName}</CardTitle>
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              <Badge variant="outline" className="text-xs bg-orange-500/10 text-orange-400 border-orange-500/20">Gateway</Badge>
              {isActive ? (
                <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-400 border-emerald-500/30 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Live &amp; Connected
                </Badge>
              ) : (
                <Badge variant="outline" className="text-xs bg-muted text-muted-foreground border-border">
                  Admin Config Required
                </Badge>
              )}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground leading-relaxed">
          {PROVIDER_DESC["ekqr"]}
        </p>
        <div className="p-2.5 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
          <p className="text-xs text-emerald-400 font-medium">RasoKart-Managed Gateway</p>
          <p className="text-xs text-muted-foreground mt-1">
            This gateway is configured and managed by the RasoKart platform team.
            Auto-deposit is fully operational — payments are credited automatically
            within 5 minutes of QR scan.
          </p>
        </div>
        {conn && (
          <div className="text-xs text-muted-foreground space-y-0.5">
            {conn.monthlyLimit > 0 && (
              <p>Monthly limit: ₹{Math.round(conn.monthlyLimit).toLocaleString("en-IN")}</p>
            )}
            <p>Status: {conn.isActive ? "Active" : "Inactive"}</p>
          </div>
        )}
        <Button size="sm" className="w-full" variant="outline" disabled>
          Managed by RasoKart
        </Button>
      </CardContent>
    </Card>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MerchantConnect() {
  const [search, setSearch] = useState("");
  const qc = useQueryClient();

  const { data: providerData, isLoading: providersLoading, refetch } = useListProviders();
  const providers = providerData?.data ?? [];

  const { data: connections, isLoading: connectionsLoading } = useListMerchantConnections();

  const {
    data: enrollments,
    isLoading: enrollmentsLoading,
  } = useEnrollments();

  // Build enrollment map for O(1) lookup by providerSlug
  const enrollmentMap = new Map<string, Enrollment>(
    (enrollments ?? []).map(e => [e.providerSlug, e])
  );

  const isLoading = providersLoading || enrollmentsLoading;

  // Filtered provider list for search
  const filtered = providers.filter(p => {
    if (!search) return true;
    const name = (PROVIDER_WHITE_LABEL[p.slug] ?? p.name).toLowerCase();
    return name.includes(search.toLowerCase()) || p.slug.includes(search.toLowerCase());
  });

  // Partition providers
  const categoryD = filtered.filter(p => {
    const info = enrollmentMap.get(p.slug)?.onboardingInfo;
    return info?.category === "D";
  });
  const categoryE = filtered.filter(p => {
    const info = enrollmentMap.get(p.slug)?.onboardingInfo;
    return info?.category === "E";
  });
  const categoryA = filtered.filter(p => {
    const info = enrollmentMap.get(p.slug)?.onboardingInfo;
    return info?.category === "A" || (!info && p.slug === "ekqr");
  });
  // Fallback: providers not in enrollment metadata (live/testing platform providers)
  const knownEnrollmentSlugs = new Set([
    "phonepe", "paytm", "bharatpe", "freecharge", "amazon_pay", "mobikwik",
    "sbi_yono", "hdfc_smarthub", "icici_eazypay", "axis_pay", "kotak_smart", "ekqr",
  ]);
  const platformProviders = filtered.filter(p => !knownEnrollmentSlugs.has(p.slug));

  // Active connections from connections API (platform-managed)
  const activeConnections = (connections ?? []).filter(c => c.isActive);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Payment Providers</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Connect payment provider accounts to collect payments through RasoKart
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            refetch();
            qc.invalidateQueries({ queryKey: ENROLLMENT_QUERY_KEY });
          }}
          className="gap-2"
        >
          <RefreshCw className="w-4 h-4" /> Refresh
        </Button>
      </div>

      {/* Search */}
      <div className="relative max-w-80">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search providers…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Platform-managed active connections */}
      {!connectionsLoading && activeConnections.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            <Link2 className="w-3.5 h-3.5" /> Your Active Connections
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {activeConnections.map(conn => {
              const pct = usagePct(Number(conn.monthlyUsed ?? 0), Number(conn.monthlyLimit ?? 0));
              const hasLimit = Number(conn.monthlyLimit ?? 0) > 0;
              return (
                <Card key={conn.id} className="border-border/60 bg-card">
                  <CardContent className="pt-4 pb-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-background border border-border/60 flex items-center justify-center shrink-0">
                          <ProviderIcon slug={conn.provider} />
                        </div>
                        <div>
                          <p className="text-sm font-semibold">
                            {PROVIDER_WHITE_LABEL[conn.provider] ?? conn.provider.replace(/_/g, " ")}
                          </p>
                          <p className="text-xs text-muted-foreground">Platform connection</p>
                        </div>
                      </div>
                      <Badge variant="outline" className="text-xs border-emerald-500/40 text-emerald-400">
                        Active
                      </Badge>
                    </div>
                    {hasLimit && (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">Used this month</span>
                          <span className={`font-semibold tabular-nums ${usageColor(pct)}`}>
                            ₹{Math.round(Number(conn.monthlyUsed ?? 0)).toLocaleString("en-IN")} / ₹{Math.round(Number(conn.monthlyLimit ?? 0)).toLocaleString("en-IN")}
                          </span>
                        </div>
                        <Progress value={pct} className={`h-1.5 bg-muted/40 ${progressColor(pct)}`} />
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i} className="animate-pulse h-52 bg-muted/30" />
          ))}
        </div>
      ) : (
        <div className="space-y-8">
          {/* Platform providers (Razorpay, Cashfree, PayU, etc.) */}
          {platformProviders.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Platform Gateways
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {platformProviders.map(p => {
                  const smeta = STATUS_META[p.status] ?? STATUS_META.disabled;
                  const cmeta = CATEGORY_META[p.category] ?? { label: p.category, color: "bg-muted text-muted-foreground border-border" };
                  const isLive = p.status === "live" || p.status === "testing";
                  return (
                    <Card key={p.id} className={`border-border/60 bg-card ${!isLive ? "opacity-70" : ""}`}>
                      <CardHeader className="pb-2">
                        <div className="flex items-start gap-3">
                          <div className={`w-14 h-14 rounded-xl bg-background border border-border/60 flex items-center justify-center shrink-0 ${!isLive ? "grayscale" : ""}`}>
                            <ProviderIcon slug={p.slug} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <CardTitle className="text-base truncate">{wlName(p.slug, p.name)}</CardTitle>
                            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                              <Badge variant="outline" className={`text-xs ${cmeta.color}`}>{cmeta.label}</Badge>
                              <Badge variant="outline" className={`text-xs flex items-center gap-1 ${smeta.color}`}>
                                {smeta.icon} {smeta.label}
                              </Badge>
                            </div>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent>
                        {p.description && (
                          <p className="text-xs text-muted-foreground mb-3 leading-relaxed">{p.description}</p>
                        )}
                        <Button size="sm" className="w-full" disabled variant="outline">
                          {isLive ? "Managed by RasoKart" : "Coming Soon"}
                        </Button>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}

          {/* EKQR — Category A */}
          {categoryA.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Live Gateway
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {categoryA.map(p => (
                  <EkqrCard key={p.id} provider={p} connections={connections ?? null} />
                ))}
              </div>
            </div>
          )}

          {/* Category D — Self-service enrollment */}
          {categoryD.length > 0 && (
            <div className="space-y-3">
              <div>
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                  Self-Service Enrollment
                </h2>
                <p className="text-xs text-muted-foreground mt-1">
                  Complete KYC on the provider portal, then submit your API credentials here.
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {categoryD.map(p => (
                  <EnrollmentCard
                    key={p.id}
                    provider={p}
                    enrollment={enrollmentMap.get(p.slug) ?? null}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Category E — Unsupported */}
          {categoryE.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                <ShieldOff className="w-3.5 h-3.5" /> Not Available
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {categoryE.map(p => (
                  <UnsupportedCard key={p.id} provider={p} />
                ))}
              </div>
            </div>
          )}

          {filtered.length === 0 && (
            <div className="text-center py-16 text-muted-foreground">
              <p className="text-sm">No providers match your search</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
