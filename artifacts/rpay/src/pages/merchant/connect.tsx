/**
 * Merchant Connect — Provider enrollment hub.
 *
 * Shows all 12 providers with their self-service enrollment status:
 *   • Category A (EKQR): admin-managed, shows live status from connections API
 *   • Category D (PhonePe, Paytm, Amazon Pay, MobiKwik): two distinct paths —
 *       A. Connect Existing Merchant Account (credential submission)
 *       B. Apply for New Merchant Account (KYC / signup)
 *   • Category D (BharatPe): enterprise partnership required; no self-service creds
 *   • Category E (Freecharge, SBI YONO, HDFC SmartHub, ICICI Eazypay, Axis Pay,
 *     Kotak Smart): unsupported due to banking regulation / ToS
 *
 * IMPORTANT — connection model for all Category D providers:
 *   None of these providers offer OAuth or third-party API access that lets
 *   RasoKart connect to an existing merchant account on their behalf.
 *   "Connect Existing Account" always means: merchant logs into the provider's
 *   portal independently → retrieves API credentials → submits them here.
 *   RasoKart never intercepts OTPs, bypasses CAPTCHA/2FA, or stores passwords.
 *
 * Credentials are write-only — never pre-populated after submission.
 * Audit log shows non-secret events (connect, credential update, disconnect).
 */

import { useState, useEffect, useRef } from "react";
import { useListProviders, useListMerchantConnections } from "@workspace/api-client-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Search, RefreshCw, Link2,
  ExternalLink, ShieldOff, CheckCircle2, Clock, AlertTriangle, XCircle, FileText,
  Key, Unlink, ArrowRight, Info, ChevronRight, UserPlus, ArrowLeft,
  Lock, AlertCircle, History, UserCog, User,
} from "lucide-react";
import { toast } from "sonner";

// ── Types ──────────────────────────────────────────────────────────────────────

interface CredentialFieldDef {
  slot: "merchantId" | "apiKey" | "apiSecret" | "webhookSecret";
  label: string;
  hint: string;
  required: boolean;
  isIdentifier?: boolean;
}

interface OnboardingInfo {
  slug: string;
  category: "A" | "D" | "E";
  existingConnectionSupported: boolean;
  existingConnectionNote: string | null;
  loginMethods: string[];
  merchantPortalUrl: string | null;
  portalDisplayName: string | null;
  credentialFields: CredentialFieldDef[];
  signupUrl: string | null;
  kycDocuments: string[];
  onboardingTimeline: string | null;
  supportsSelfSubmit: boolean;
  finalStatus: string;
  // Mobile OTP support — false for all current providers
  mobileOtpSupported: boolean;
  mobileOtpNote: string | null;
  // Email OTP login — true only for providers whose portal offers email+OTP (e.g. Pine Labs)
  emailOtpLoginAvailable: boolean;
  emailOtpNote: string | null;
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
  upi_id:          "RasoKart UPI",
  google_pay:      "RasoKart UPI",
  phonepe:         "RasoKart Collect",
  paytm:           "RasoKart Wallet",
  // paytm_merchant is the portal_session_connector — always shown with its real
  // name so merchants can distinguish it from the legacy paytm enrollment card.
  paytm_merchant:  "Paytm Business Merchant Connector",
  bharatpe:        "RasoKart Merchant",
  freecharge:      "RasoKart Pay",
  amazon_pay:      "RasoKart Digital",
  mobikwik:        "Mobile Wallet",
  sbi_yono:        "Bank UPI",
  hdfc_smarthub:   "Bank SmartQR",
  icici_eazypay:   "Bank QR",
  axis_pay:        "Bank QR",
  kotak_smart:     "Bank Smart Collect",
  razorpay:        "RasoKart Gateway",
  cashfree:        "RasoKart Payments",
  payu:            "RasoKart Gateway Plus",
  ekqr:            "RasoKart QR Gateway",
  pinelabs:        "RasoKart Plural",
  pinelabs_one:    "Pine Labs ONE",
};

const PROVIDER_DESC: Record<string, string> = {
  phonepe:        "QR-based UPI merchant payments via PhonePe Business",
  paytm:          "UPI, wallet, and net banking collections via Paytm Business",
  paytm_merchant: "Paytm Business portal — connect with your registered mobile or email address and password to sync transaction history (read-only)",
  bharatpe:      "Zero MDR UPI collections via BharatPe QR",
  amazon_pay:    "UPI merchant checkout via Amazon Pay for Business",
  mobikwik:      "Mobile wallet payment gateway via MobiKwik Business",
  pinelabs:      "Cards, UPI, wallets, and EMI via Pine Labs Plural gateway",
  pinelabs_one:  "Connect your Pine Labs ONE POS/QR merchant account to sync transactions and monitor settlement status.",
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
  pos:     { label: "POS / QR", color: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20" },
};

const STATUS_META: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  live:        { label: "Live",        color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30", icon: <CheckCircle2 className="w-3 h-3" /> },
  testing:     { label: "Testing",     color: "bg-amber-500/10 text-amber-400 border-amber-500/30",       icon: <Clock className="w-3 h-3" /> },
  coming_soon: { label: "Coming Soon", color: "bg-sky-500/10 text-sky-400 border-sky-500/30",             icon: <Clock className="w-3 h-3" /> },
  disabled:    { label: "Disabled",    color: "bg-muted text-muted-foreground border-border",             icon: <XCircle className="w-3 h-3" /> },
};

const ENROLLMENT_BADGE: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  not_enrolled:          { label: "Not Connected",  color: "bg-muted text-muted-foreground border-border",                icon: <XCircle className="w-3 h-3" /> },
  pending_kyc:           { label: "Pending KYC",    color: "bg-amber-500/10 text-amber-400 border-amber-500/30",          icon: <Clock className="w-3 h-3" /> },
  credentials_submitted: { label: "Under Review",   color: "bg-sky-500/10 text-sky-400 border-sky-500/30",                icon: <Clock className="w-3 h-3" /> },
  active:                { label: "Connected",      color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",    icon: <CheckCircle2 className="w-3 h-3" /> },
  suspended:             { label: "Suspended",      color: "bg-rose-500/10 text-rose-400 border-rose-500/30",             icon: <AlertTriangle className="w-3 h-3" /> },
  disconnected:          { label: "Disconnected",   color: "bg-muted text-muted-foreground border-border",                icon: <XCircle className="w-3 h-3" /> },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function wlName(slug: string, fallback: string): string {
  return PROVIDER_WHITE_LABEL[slug] ?? fallback;
}

function usagePct(used: number, limit: number): number {
  if (!limit) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

function usageColor(pct: number): string {
  if (pct >= 90) return "text-rose-400";
  if (pct >= 70) return "text-amber-400";
  return "text-emerald-400";
}

function progressColor(pct: number): string {
  if (pct >= 90) return "[&>div]:bg-rose-500";
  if (pct >= 70) return "[&>div]:bg-amber-500";
  return "[&>div]:bg-emerald-500";
}

// ── Provider icon ─────────────────────────────────────────────────────────────

function ProviderIcon({ slug }: { slug: string }) {
  const icons: Record<string, string> = {
    phonepe:       "📱", paytm: "💳", bharatpe: "🏪",
    freecharge:    "⚡", amazon_pay: "🛒", mobikwik: "📲",
    sbi_yono:      "🏦", hdfc_smarthub: "🏦", icici_eazypay: "🏦",
    axis_pay:      "🏦", kotak_smart: "🏦",
    ekqr:          "⚡", razorpay: "🔷", cashfree: "💰", payu: "💸",
    pinelabs:      "🌲",
    pinelabs_one:  "🖥️",
  };
  return <span className="text-xl leading-none">{icons[slug] ?? "💳"}</span>;
}

// ── Auth helper ───────────────────────────────────────────────────────────────

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

async function enrollFetch(path: string, init?: RequestInit): Promise<Response> {
  const isJson = init?.body != null;
  return fetch(path, {
    ...init,
    headers: authHeaders(isJson ? { "Content-Type": "application/json" } : {}),
  });
}

async function portalFetch(path: string, init?: RequestInit): Promise<Response> {
  const isJson = init?.body != null;
  return fetch(path, {
    ...init,
    headers: authHeaders(isJson ? { "Content-Type": "application/json" } : {}),
  });
}

// ── Portal provider slugs — providers that use the Connector Engine ────────────
// razorpay:       API Key + Secret — api_key_connector (operational).
// pinelabs_one:   Registered email ID or mobile number → OTP (authV2 OTP-first) — portal_session_connector (Playwright).
// paytm_merchant: Registered Mobile + OTP — portal_session_connector (Playwright).
const PORTAL_PROVIDER_SLUGS = new Set(["pinelabs_one", "razorpay", "paytm_merchant"]);

const PINE_LABS_OTP_COOLDOWN_STORAGE_PREFIX =
  "rasokart:pinelabs_one:otp-resend-cooldown:";
const PINE_LABS_OTP_COOLDOWN_PENDING_KEY =
  `${PINE_LABS_OTP_COOLDOWN_STORAGE_PREFIX}pending`;
type PineLabsOtpCooldownSource = "portal_link" | "otp_first";
interface PineLabsOtpCooldownRecord {
  expiresAt: number;
  source: PineLabsOtpCooldownSource;
}

function pineLabsOtpCooldownStorageKey(sessionId: number | null): string {
  return sessionId === null
    ? PINE_LABS_OTP_COOLDOWN_PENDING_KEY
    : `${PINE_LABS_OTP_COOLDOWN_STORAGE_PREFIX}${sessionId}`;
}

function readPineLabsOtpCooldown(
  sessionId: number | null,
): PineLabsOtpCooldownRecord | null {
  try {
    const keys = sessionId === null
      ? [PINE_LABS_OTP_COOLDOWN_PENDING_KEY]
      : [
          pineLabsOtpCooldownStorageKey(sessionId),
          PINE_LABS_OTP_COOLDOWN_PENDING_KEY,
        ];
    for (const key of keys) {
      const raw = sessionStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as Partial<PineLabsOtpCooldownRecord>;
      if (
        typeof parsed.expiresAt !== "number" ||
        !Number.isFinite(parsed.expiresAt) ||
        (parsed.source !== "portal_link" && parsed.source !== "otp_first")
      ) {
        sessionStorage.removeItem(key);
        continue;
      }
      if (parsed.expiresAt <= Date.now()) {
        sessionStorage.removeItem(key);
        continue;
      }
      return parsed as PineLabsOtpCooldownRecord;
    }
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
  return null;
}

function persistPineLabsOtpCooldown(
  sessionId: number | null,
  source: PineLabsOtpCooldownSource,
): number {
  const expiresAt = Date.now() + 60_000;
  try {
    sessionStorage.setItem(pineLabsOtpCooldownStorageKey(sessionId), JSON.stringify({
      expiresAt,
      source,
    } satisfies PineLabsOtpCooldownRecord));
  } catch {
    // The in-memory timer still protects the current mounted component.
  }
  return expiresAt;
}

function clearPineLabsOtpCooldown(sessionId: number | null): void {
  try {
    sessionStorage.removeItem(pineLabsOtpCooldownStorageKey(sessionId));
    if (sessionId !== null) {
      sessionStorage.removeItem(PINE_LABS_OTP_COOLDOWN_PENDING_KEY);
    }
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
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
      merchantId?: string;
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

// ── Portal session hook ───────────────────────────────────────────────────────

const PORTAL_SESSIONS_QUERY_KEY = ["merchant", "portal-sessions"] as const;

interface MerchantPortalSession {
  id: number;
  merchantId: number;
  providerSlug: string;
  status: string;
  lastErrorCode: string | null;
  lastStatusMessage: string | null;
  connectedAt: string | null;
  updatedAt: string;
}

function usePortalSessions() {
  return useQuery<MerchantPortalSession[]>({
    queryKey: PORTAL_SESSIONS_QUERY_KEY,
    queryFn: async () => {
      const res = await portalFetch("/api/merchant/portal-sessions");
      if (!res.ok) return [];
      const body = await res.json();
      return body.sessions ?? [];
    },
    staleTime: 30_000,
  });
}

async function initiatePortalSession(
  providerSlug: string,
  credentials?: { loginMethod: string; identifier: string; password?: string },
): Promise<{ status: string; message: string | null; nextStep: string | null; helpUrl: string | null }> {
  // 90-second timeout — Playwright browser navigation can take up to ~60s;
  // without a signal the button stays stuck forever if the server never responds.
  const signal = AbortSignal.timeout(90_000);
  const res = await portalFetch(`/api/merchant/portal-sessions/${providerSlug}/initiate`, {
    method: "POST",
    body: credentials ? JSON.stringify(credentials) : undefined,
    signal,
  });
  const body = await res.json().catch(() => ({ status: "FAILED", message: null, nextStep: null, helpUrl: null }));
  return {
    status:   body.status   ?? "FAILED",
    message:  body.message  ?? null,
    nextStep: body.nextStep ?? null,
    helpUrl:  body.helpUrl  ?? null,
  };
}

interface HistoryEntry {
  id: number;
  action: string;
  actorEmail: string;
  createdAt: string;
  newStatus: string | null;
  previousStatus: string | null;
  reason: string | null;
  fieldsSubmitted: string[] | null;
}

// ── Step types ────────────────────────────────────────────────────────────────

type FlowStep =
  | "choice"           // initial: choose Mobile OTP, Email OTP, Existing Creds, or New Account
  | "mobile_otp"       // mobile+OTP — show support status (unsupported for all current providers)
  | "email_otp"        // email+OTP  — show support status (unsupported for all current providers)
  | "existing_info"    // explain how to get credentials + login methods
  | "credentials"      // form with provider-specific field labels
  | "new_account";     // KYC docs + signup link

// ── Enrollment flow dialog ────────────────────────────────────────────────────

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
  const [step, setStep] = useState<FlowStep>("choice");

  // Credential form state — keyed by slot name
  const [fields, setFields] = useState<Record<string, string>>({
    merchantId: "", apiKey: "", apiSecret: "", webhookSecret: "",
  });

  const initiateEnrollment = useInitiateEnrollment();
  const submitCredentials = useSubmitCredentials();
  const info = enrollment?.onboardingInfo;
  const emailOtpAvailable = info?.emailOtpLoginAvailable ?? false;

  // Reset on open
  useEffect(() => {
    if (!open) return;
    setFields({ merchantId: "", apiKey: "", apiSecret: "", webhookSecret: "" });
    // If they already have credentials submitted, go directly to existing path
    if (
      enrollment?.enrollmentStatus === "credentials_submitted" ||
      enrollment?.enrollmentStatus === "active"
    ) {
      setStep("existing_info");
    } else {
      setStep("choice");
    }
  }, [open, enrollment?.enrollmentStatus]);

  function setField(slot: string, value: string) {
    setFields(prev => ({ ...prev, [slot]: value }));
  }

  async function handleExistingPathContinue() {
    // Initiate enrollment if not already started
    if (!enrollment || enrollment.enrollmentStatus === "not_enrolled" || enrollment.enrollmentStatus === "disconnected") {
      try {
        await initiateEnrollment.mutateAsync({ providerSlug: provider.slug });
      } catch (err: any) {
        toast.error(err.message ?? "Failed to initiate enrollment");
        return;
      }
    }
    setStep("credentials");
  }

  async function handleSubmitCredentials() {
    const credentialFields: CredentialFieldDef[] = info?.credentialFields ?? [];
    const requiredFields = credentialFields.filter(f => f.required);
    const missingRequired = requiredFields.filter(f => !fields[f.slot]?.trim());
    if (missingRequired.length > 0) {
      toast.error(`Please enter: ${missingRequired.map(f => f.label).join(", ")}`);
      return;
    }

    // Check at least one secret field is provided (merchantId alone is not enough)
    const secretSlots = ["apiKey", "apiSecret", "webhookSecret"] as const;
    const hasAnySecret = secretSlots.some(s => fields[s]?.trim());
    const hasMerchantId = fields.merchantId?.trim();
    if (!hasAnySecret && !hasMerchantId) {
      toast.error("Please enter at least one credential field");
      return;
    }

    try {
      const payload: Record<string, string> = {};
      for (const [key, val] of Object.entries(fields)) {
        if (val.trim()) payload[key] = val.trim();
      }
      await submitCredentials.mutateAsync({
        providerSlug: provider.slug,
        ...payload,
      });
      toast.success("Credentials submitted. Your account is under review by the RasoKart team.");
      onClose();
    } catch (err: any) {
      toast.error(err.message ?? "Failed to submit credentials");
    }
  }

  async function handleNewAccountContinue() {
    // Initiate enrollment (pending_kyc) if not already started
    if (!enrollment || enrollment.enrollmentStatus === "not_enrolled" || enrollment.enrollmentStatus === "disconnected") {
      try {
        await initiateEnrollment.mutateAsync({ providerSlug: provider.slug });
      } catch (err: any) {
        toast.error(err.message ?? "Failed to start enrollment");
        return;
      }
    }
    if (info?.signupUrl) {
      window.open(info.signupUrl, "_blank", "noopener,noreferrer");
    }
    toast.info("After completing KYC and getting approved, come back here to submit your API credentials.");
    onClose();
  }

  const providerName = wlName(provider.slug, provider.name);
  const credentialFields: CredentialFieldDef[] = info?.credentialFields ?? [];
  const existingSupported = info?.existingConnectionSupported ?? false;

  // ── Step: choice ─────────────────────────────────────────────────────────
  function renderChoice() {
    const mobileOtpSupported = info?.mobileOtpSupported ?? false;
    return (
      <div className="space-y-4 py-2">
        <p className="text-sm text-muted-foreground">
          Choose how you want to connect <span className="font-medium text-foreground">{providerName}</span>:
        </p>

        {/* Option 1: Mobile Number + OTP — only shown when the provider supports it.
            When mobileOtpSupported is false (e.g. paytm), the dedicated
            paytm_merchant portal card handles Mobile+OTP instead. Hiding the
            button here prevents the confusing "not supported" dead-end. */}
        {mobileOtpSupported && (
          <button
            className="w-full text-left p-4 rounded-lg border border-border/60 hover:border-sky-500/40 hover:bg-sky-500/5 transition-colors group"
            onClick={() => setStep("mobile_otp")}
          >
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-sky-500/10 flex items-center justify-center shrink-0 group-hover:bg-sky-500/20 transition-colors">
                <Smartphone className="w-4 h-4 text-sky-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground">Connect with Mobile Number + OTP</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Authenticate using your registered mobile number via the provider's OTP system
                </p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-sky-400 mt-0.5 shrink-0 transition-colors" />
            </div>
          </button>
        )}

        {/* Option 2: Email ID + OTP (only shown when provider portal supports email+OTP login) */}
        {emailOtpAvailable && (
          <button
            className="w-full text-left p-4 rounded-lg border border-border/60 hover:border-violet-500/40 hover:bg-violet-500/5 transition-colors group"
            onClick={() => setStep("email_otp")}
          >
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0 group-hover:bg-violet-500/20 transition-colors">
                <span className="text-sm">✉️</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-foreground">Connect with Email ID + OTP</p>
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border/60">
                    Check status
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Authenticate using your registered email address via the provider's OTP system
                </p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-violet-400 mt-0.5 shrink-0 transition-colors" />
            </div>
          </button>
        )}

        {/* Option 3: Provider-issued credentials */}
        <button
          className="w-full text-left p-4 rounded-lg border border-border/60 hover:border-primary/40 hover:bg-primary/5 transition-colors group"
          onClick={() => setStep("existing_info")}
        >
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/20 transition-colors">
              <Key className="w-4 h-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">Connect using provider-issued credentials</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {existingSupported
                  ? "I have API credentials issued by this provider — I'll enter them here to connect"
                  : "View information about this provider's connection requirements"}
              </p>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary mt-0.5 shrink-0 transition-colors" />
          </div>
        </button>

        {/* Option 3: New account */}
        {info?.signupUrl && (
          <button
            className="w-full text-left p-4 rounded-lg border border-border/60 hover:border-emerald-500/40 hover:bg-emerald-500/5 transition-colors group"
            onClick={() => setStep("new_account")}
          >
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0 group-hover:bg-emerald-500/20 transition-colors">
                <UserPlus className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground">Apply for a New Merchant Account</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  I don't have an account yet — I'll apply at the provider's website, complete KYC, and return here to submit credentials after approval
                </p>
                {info.onboardingTimeline && (
                  <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                    <Clock className="w-3 h-3" /> Estimated: {info.onboardingTimeline}
                  </p>
                )}
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-emerald-400 mt-0.5 shrink-0 transition-colors" />
            </div>
          </button>
        )}
      </div>
    );
  }

  // ── Step: mobile_otp ──────────────────────────────────────────────────────
  function renderMobileOtp() {
    const mobileOtpSupported = info?.mobileOtpSupported ?? false;
    const mobileOtpNote = info?.mobileOtpNote ?? null;

    return (
      <div className="space-y-4 py-2">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="text-muted-foreground/60">Connection options</span>
          <ChevronRight className="w-3 h-3" />
          <span className="text-foreground font-medium">Connect with Mobile Number + OTP</span>
        </div>

        {mobileOtpSupported ? (
          /* Future: live mobile OTP flow goes here */
          <div className="p-4 rounded-lg bg-emerald-500/5 border border-emerald-500/20 flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
            <p className="text-sm text-emerald-400">
              Mobile + OTP authentication is supported for this provider. Follow the steps below.
            </p>
          </div>
        ) : (
          <>
            {/* Unsupported notice */}
            <div className="p-4 rounded-lg bg-amber-500/5 border border-amber-500/20 space-y-2">
              <p className="text-sm font-semibold text-amber-400 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                Mobile + OTP direct connection is not supported
              </p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {mobileOtpNote ??
                  "Mobile + OTP direct connection is not supported by this provider. " +
                  "Use provider-issued credentials or complete merchant onboarding."}
              </p>
            </div>

            {/* Why not available */}
            <div className="p-3.5 rounded-lg bg-muted/30 border border-border/50 space-y-1.5">
              <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5 text-muted-foreground" />
                Why Mobile + OTP isn't available for third-party platforms
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Mobile + OTP authentication on payment provider portals is a security mechanism
                that protects merchant accounts. These providers do not expose public APIs that
                allow a third-party platform like RasoKart to initiate OTP flows, receive
                authentication tokens, or manage merchant sessions on the merchant's behalf.
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                To connect, use the <span className="font-medium text-foreground">provider-issued API credentials</span> path
                instead — API keys are specifically designed for third-party payment platform integrations.
              </p>
            </div>

            {/* Safety statement */}
            <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/20 border border-border/40">
              <Lock className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
              <p className="text-xs text-muted-foreground">
                RasoKart never intercepts OTPs, bypasses CAPTCHA or 2FA, reads SMS, or automates
                provider portal login on your behalf. All provider portal authentication happens
                entirely on the provider's own website or app.
              </p>
            </div>
          </>
        )}
      </div>
    );
  }

  // ── Step: email_otp ───────────────────────────────────────────────────────
  function renderEmailOtp() {
    const emailOtpNote = info?.emailOtpNote ?? null;

    return (
      <div className="space-y-4 py-2">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="text-muted-foreground/60">Connection options</span>
          <ChevronRight className="w-3 h-3" />
          <span className="text-foreground font-medium">Connect with Email ID + OTP</span>
        </div>

        {/* Unsupported notice — Pine Labs and all current providers */}
        <div className="p-4 rounded-lg bg-amber-500/5 border border-amber-500/20 space-y-2">
          <p className="text-sm font-semibold text-amber-400 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            Email + OTP session connection is not supported
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {emailOtpNote ??
              "Email + OTP is available for this provider's portal login, but direct RasoKart " +
              "session connection is not officially supported. Use provider-issued API credentials."}
          </p>
        </div>

        {/* Context */}
        <div className="p-3.5 rounded-lg bg-muted/30 border border-border/50 space-y-1.5">
          <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
            <Info className="w-3.5 h-3.5 text-muted-foreground" />
            Why Email + OTP isn't available for third-party platforms
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            While this provider's merchant portal accepts email ID + OTP for login, the provider
            does not expose a public API that allows a third-party platform like RasoKart to
            initiate that OTP flow or receive an authorized, reusable merchant session token.
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            To connect, use the <span className="font-medium text-foreground">provider-issued API credentials</span> path
            — these are specifically designed for third-party payment platform integrations.
          </p>
        </div>

        {/* Safety statement */}
        <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/20 border border-border/40">
          <Lock className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
          <p className="text-xs text-muted-foreground">
            RasoKart never initiates OTP flows, reads emails, intercepts codes, or automates
            provider portal login. All provider authentication happens on the provider's own
            website or app — we only store the API credentials you submit here.
          </p>
        </div>
      </div>
    );
  }

  // ── Step: existing_info ───────────────────────────────────────────────────
  function renderExistingInfo() {
    return (
      <div className="space-y-4 py-2">
        {/* How credential-based connection works for this provider */}
        <div className="p-3.5 rounded-lg bg-amber-500/5 border border-amber-500/20 space-y-2">
          <p className="text-xs font-semibold text-amber-400 flex items-center gap-1.5">
            <Info className="w-3.5 h-3.5" /> How provider-credential connection works
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {info?.existingConnectionNote ?? (
              existingSupported
                ? "Log into the provider's business portal, retrieve your API credentials, and submit them here."
                : "Direct credential connection is not available for this provider."
            )}
          </p>
        </div>

        {/* Not supported message */}
        {!existingSupported && (
          <div className="p-3.5 rounded-lg bg-rose-500/5 border border-rose-500/20">
            <p className="text-xs font-semibold text-rose-400 flex items-center gap-1.5 mb-1">
              <AlertCircle className="w-3.5 h-3.5" /> Direct merchant login connection is not supported
            </p>
            <p className="text-xs text-muted-foreground">
              This provider does not offer a payment gateway API for third-party platforms. Contact RasoKart support for partnership enquiries.
            </p>
          </div>
        )}

        {/* Portal access note — this happens entirely at the provider's website, not in RasoKart */}
        {existingSupported && info?.loginMethods && info.loginMethods.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Accessing your credentials on the provider portal
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              You will need to access the provider's portal using your registered account to retrieve the API credentials listed below. This authentication happens entirely at the provider's own website — RasoKart is not part of that login flow and does not receive your portal session, OTP, or password.
            </p>
          </div>
        )}

        {/* Portal link */}
        {existingSupported && info?.merchantPortalUrl && (
          <div className="p-3.5 rounded-lg bg-primary/5 border border-primary/20">
            <p className="text-xs font-medium text-foreground mb-1">
              Step 1 — Log into the provider portal and retrieve your credentials
            </p>
            <a
              href={info.merchantPortalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
            >
              Open {info.portalDisplayName ?? "Provider Dashboard"}
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
            {credentialFields.length > 0 && (
              <div className="mt-2.5 space-y-1">
                <p className="text-xs text-muted-foreground font-medium">You will need to retrieve:</p>
                <ul className="space-y-0.5">
                  {credentialFields.map(f => (
                    <li key={f.slot} className="text-xs text-muted-foreground flex items-start gap-1.5">
                      <span className="text-primary mt-0.5">•</span>
                      <span>
                        <span className="font-medium text-foreground">{f.label}</span>
                        {f.required ? "" : " (optional)"}
                        {" — "}{f.hint}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Security note */}
        {existingSupported && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/30 border border-border/50">
            <Lock className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
            <p className="text-xs text-muted-foreground">
              Credentials you submit are encrypted and stored securely. They are write-only — you will not be able to view them after saving.
            </p>
          </div>
        )}
      </div>
    );
  }

  // ── Step: credentials ─────────────────────────────────────────────────────
  function renderCredentials() {
    // Build the fields to show: use provider-specific definitions if available,
    // otherwise fall back to generic labels
    const formFields: CredentialFieldDef[] = credentialFields.length > 0
      ? credentialFields
      : [
          { slot: "apiKey", label: "API Key", hint: "From your provider's API Keys section", required: true },
          { slot: "apiSecret", label: "API Secret", hint: "From your provider's API Keys section", required: true },
          { slot: "webhookSecret", label: "Webhook Secret", hint: "From your provider's Webhooks section", required: false },
        ];

    return (
      <div className="space-y-4 py-2">
        {/* Step breadcrumb */}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="text-muted-foreground/60">Connect using provider-issued credentials</span>
          <ChevronRight className="w-3 h-3" />
          <span className="text-foreground font-medium">Enter API Credentials</span>
        </div>

        <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 flex items-start gap-2">
          <Key className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-400">
            Credentials are encrypted and stored securely. They are write-only — you will not be able to view them after saving. Enter the full value each time you update.
          </p>
        </div>

        <div className="space-y-3">
          {formFields.map(f => {
            const existing = f.slot === "merchantId"
              ? enrollment?.maskedIdentifier
              : f.slot === "apiKey" ? (enrollment?.hasApiKey ? "already set" : null)
              : f.slot === "apiSecret" ? (enrollment?.hasApiSecret ? "already set" : null)
              : (enrollment?.hasWebhookSecret ? "already set" : null);

            const isSecret = !f.isIdentifier;

            return (
              <div key={f.slot} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium">
                    {f.label}
                    {!f.required && <span className="text-muted-foreground ml-1">(optional)</span>}
                  </Label>
                  {f.isIdentifier && enrollment?.maskedIdentifier && (
                    <span className="text-xs text-muted-foreground">Current: {enrollment.maskedIdentifier}</span>
                  )}
                </div>
                <Input
                  type={isSecret ? "password" : "text"}
                  placeholder={existing
                    ? `Currently set — enter new value to update`
                    : f.hint}
                  value={fields[f.slot] ?? ""}
                  onChange={e => setField(f.slot, e.target.value)}
                  autoComplete="new-password"
                />
                {fields[f.slot] === "" && !existing && f.hint && (
                  <p className="text-xs text-muted-foreground">{f.hint}</p>
                )}
              </div>
            );
          })}
        </div>

        <p className="text-xs text-muted-foreground">
          Leave a field blank to keep the current value (if already set).
        </p>
      </div>
    );
  }

  // ── Step: new_account ─────────────────────────────────────────────────────
  function renderNewAccount() {
    return (
      <div className="space-y-4 py-2">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="text-muted-foreground/60">Options</span>
          <ChevronRight className="w-3 h-3" />
          <span className="text-foreground font-medium">Apply for New Merchant Account</span>
        </div>

        {/* Signup link */}
        {info?.signupUrl && (
          <div className="p-4 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
            <p className="text-sm font-medium text-foreground mb-1">
              Step 1 — Apply at the provider's official website
            </p>
            <p className="text-xs text-muted-foreground mb-3">
              Complete business KYC on the provider's portal. After approval, return here to submit your API credentials.
            </p>
            <a
              href={info.signupUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-xs font-medium text-emerald-400 hover:underline"
            >
              Apply at {info.portalDisplayName ?? provider.name}
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        )}

        {/* KYC documents */}
        {info?.kycDocuments && info.kycDocuments.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5" /> Required KYC Documents
            </p>
            <ul className="space-y-1.5">
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

        <div className="p-3 rounded-lg bg-sky-500/5 border border-sky-500/20 flex items-start gap-2">
          <Info className="w-3.5 h-3.5 text-sky-400 mt-0.5 shrink-0" />
          <p className="text-xs text-sky-400">
            After your application is approved and you have received your API credentials, return to this page and choose "Connect Existing Account" to submit them.
          </p>
        </div>
      </div>
    );
  }

  // ── Footer buttons ────────────────────────────────────────────────────────
  function renderFooter() {
    if (step === "choice") {
      return (
        <Button variant="outline" onClick={onClose}>Cancel</Button>
      );
    }

    if (step === "mobile_otp") {
      return (
        <>
          <Button variant="outline" onClick={() => setStep("choice")} className="gap-1.5">
            <ArrowLeft className="w-3.5 h-3.5" /> Back
          </Button>
          {!(info?.mobileOtpSupported) && (
            <Button onClick={() => setStep("existing_info")} className="gap-2">
              Use Provider Credentials
              <ArrowRight className="w-4 h-4" />
            </Button>
          )}
        </>
      );
    }

    if (step === "email_otp") {
      return (
        <>
          <Button variant="outline" onClick={() => setStep("choice")} className="gap-1.5">
            <ArrowLeft className="w-3.5 h-3.5" /> Back
          </Button>
          <Button onClick={() => setStep("existing_info")} className="gap-2">
            Use Provider Credentials
            <ArrowRight className="w-4 h-4" />
          </Button>
        </>
      );
    }

    if (step === "existing_info") {
      return (
        <>
          <Button variant="outline" onClick={() => setStep("choice")} className="gap-1.5">
            <ArrowLeft className="w-3.5 h-3.5" /> Back
          </Button>
          {existingSupported && (
            <Button
              onClick={handleExistingPathContinue}
              disabled={initiateEnrollment.isPending}
              className="gap-2"
            >
              {initiateEnrollment.isPending ? "Starting…" : "Enter Credentials"}
              <ArrowRight className="w-4 h-4" />
            </Button>
          )}
        </>
      );
    }

    if (step === "credentials") {
      const hasAnyValue = Object.values(fields).some(v => v.trim().length > 0);
      return (
        <>
          <Button variant="outline" onClick={() => setStep("existing_info")} className="gap-1.5">
            <ArrowLeft className="w-3.5 h-3.5" /> Back
          </Button>
          <Button
            onClick={handleSubmitCredentials}
            disabled={submitCredentials.isPending || !hasAnyValue}
            className="gap-2"
          >
            {submitCredentials.isPending ? "Submitting…" : "Submit Credentials"}
          </Button>
        </>
      );
    }

    if (step === "new_account") {
      return (
        <>
          <Button variant="outline" onClick={() => setStep("choice")} className="gap-1.5">
            <ArrowLeft className="w-3.5 h-3.5" /> Back
          </Button>
          {info?.signupUrl && (
            <Button
              onClick={handleNewAccountContinue}
              disabled={initiateEnrollment.isPending}
              className="gap-2 bg-emerald-600 hover:bg-emerald-700"
            >
              {initiateEnrollment.isPending ? "Redirecting…" : "Open Application Portal"}
              <ExternalLink className="w-3.5 h-3.5" />
            </Button>
          )}
          {!info?.signupUrl && (
            <Button variant="outline" onClick={onClose}>Close</Button>
          )}
        </>
      );
    }

    return null;
  }

  // Existing credentials submitted — show a quick note at the top of choice
  const isReenrolling = enrollment && enrollment.enrollmentStatus !== "not_enrolled" && enrollment.enrollmentStatus !== "disconnected";

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ProviderIcon slug={provider.slug} />
            Connect {providerName}
          </DialogTitle>
          <DialogDescription>
            {step === "choice" && "How would you like to connect this provider?"}
            {step === "mobile_otp" && "Connect using your registered mobile number + OTP"}
            {step === "email_otp" && "Connect using your registered email ID + OTP"}
            {step === "existing_info" && "Submit provider-issued API credentials"}
            {step === "credentials" && "Enter the API credentials you obtained from the provider portal"}
            {step === "new_account" && "Apply for a new merchant account"}
          </DialogDescription>
        </DialogHeader>

        {/* Re-enroll notice */}
        {step === "choice" && isReenrolling && (
          <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 -mt-2">
            <p className="text-xs text-amber-400">
              You already have an active enrollment for this provider. Continuing will update your credentials or restart the onboarding flow.
            </p>
          </div>
        )}

        {step === "choice" && renderChoice()}
        {step === "mobile_otp" && renderMobileOtp()}
        {step === "email_otp" && renderEmailOtp()}
        {step === "existing_info" && renderExistingInfo()}
        {step === "credentials" && renderCredentials()}
        {step === "new_account" && renderNewAccount()}

        <DialogFooter className="flex-col sm:flex-row gap-2">
          {renderFooter()}
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
  const [historyOpen, setHistoryOpen] = useState(false);
  const cmeta = CATEGORY_META[provider.category] ?? { label: provider.category, color: "bg-muted text-muted-foreground border-border" };
  const status = enrollment?.enrollmentStatus ?? "not_enrolled";
  const ebadge = ENROLLMENT_BADGE[status] ?? ENROLLMENT_BADGE.not_enrolled;
  const providerName = wlName(provider.slug, provider.name);
  const desc = PROVIDER_DESC[provider.slug] ?? provider.description;
  const canConnect = status === "not_enrolled" || status === "disconnected";
  const canUpdate = status === "pending_kyc" || status === "credentials_submitted";
  const isActive = status === "active";
  const isSuspended = status === "suspended";
  const info = enrollment?.onboardingInfo;
  const existingSupported = info?.existingConnectionSupported ?? true;
  // Show history button whenever the merchant has ever interacted with this provider
  const hasHistory = enrollment !== null && status !== "not_enrolled";

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

          {/* No-credential-API note for BharatPe */}
          {!existingSupported && status === "not_enrolled" && (
            <div className="p-2.5 rounded-lg bg-amber-500/5 border border-amber-500/20 flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-400">Enterprise partnership required — contact RasoKart support</p>
            </div>
          )}

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

          {/* Credentials under review */}
          {status === "credentials_submitted" && (
            <div className="p-2.5 rounded-lg bg-sky-500/5 border border-sky-500/20 flex items-start gap-2">
              <Info className="w-3.5 h-3.5 text-sky-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs text-sky-400">Credentials submitted — under review by RasoKart team.</p>
                {enrollment?.maskedIdentifier && (
                  <p className="text-xs text-muted-foreground mt-0.5">Merchant ID: {enrollment.maskedIdentifier}</p>
                )}
              </div>
            </div>
          )}

          {/* Connected timestamp */}
          {isActive && enrollment?.connectedAt && (
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <p className="text-xs text-muted-foreground">
                Connected {new Date(enrollment.connectedAt).toLocaleDateString("en-IN")}
              </p>
              {enrollment?.maskedIdentifier && (
                <p className="text-xs text-muted-foreground">· MID: {enrollment.maskedIdentifier}</p>
              )}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2 flex-wrap">
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
            {isActive && (
              <Button size="sm" variant="outline" className="flex-1" onClick={() => setFlowOpen(true)}>
                Update Credentials
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

          {/* History link — only when merchant has enrollment history */}
          {hasHistory && (
            <button
              onClick={() => setHistoryOpen(true)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-fit"
            >
              <History className="w-3.5 h-3.5" /> View history
            </button>
          )}
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
      <EnrollmentHistoryDialog
        providerSlug={provider.slug}
        providerName={providerName}
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
      />
    </>
  );
}

// ── Portal provider card ───────────────────────────────────────────────────────

function PortalProviderCard({
  provider,
  session,
}: {
  provider: any;
  session: MerchantPortalSession | null;
}) {
  const qc = useQueryClient();
  const [checking, setChecking] = useState(false);
  const providerName = wlName(provider.slug, provider.name);
  const cmeta = CATEGORY_META[provider.category] ?? { label: provider.category, color: "bg-muted text-muted-foreground border-border" };
  const sessionStatus = session?.status ?? null;

  async function handleCheck() {
    setChecking(true);
    try {
      const result = await initiatePortalSession(provider.slug);
      qc.invalidateQueries({ queryKey: PORTAL_SESSIONS_QUERY_KEY });
      if (result.status === "PARTNER_API_REQUIRED") {
        toast.info("Partner API access is required before automation is available for this provider.");
      } else {
        toast.info(`Session status: ${result.status}`);
      }
    } catch {
      toast.error("Could not check portal status. Please try again.");
    } finally {
      setChecking(false);
    }
  }

  return (
    <Card className="border-border/60 bg-card opacity-90">
      <CardHeader className="pb-2">
        <div className="flex items-start gap-3">
          <div className="w-14 h-14 rounded-xl bg-background border border-border/60 flex items-center justify-center shrink-0">
            <ProviderIcon slug={provider.slug} />
          </div>
          <div className="flex-1 min-w-0">
            <CardTitle className="text-base truncate">{providerName}</CardTitle>
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              <Badge variant="outline" className={`text-xs ${cmeta.color}`}>{cmeta.label}</Badge>
              <Badge variant="outline" className="text-xs border-amber-500/40 text-amber-400 flex items-center gap-1">
                <Clock className="w-3 h-3" /> Partner API Required
              </Badge>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground leading-relaxed">
          {PROVIDER_DESC[provider.slug] ?? provider.description}
        </p>

        {/* Partner API requirement notice */}
        <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 space-y-1.5">
          <p className="text-xs font-semibold text-amber-400 flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            Official Partner API Agreement Required
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            This provider requires an authorized partner API agreement before portal session
            automation is available. Apply at the provider's developer portal to get started.
          </p>
        </div>

        {/* Session status if we have a record */}
        {sessionStatus && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Info className="w-3 h-3" />
            Last check: <span className="font-medium text-foreground">{sessionStatus}</span>
            {session?.updatedAt && (
              <span>· {new Date(session.updatedAt).toLocaleDateString("en-IN")}</span>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            className="flex-1"
            onClick={handleCheck}
            disabled={checking}
          >
            {checking ? "Checking…" : "Check Status"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="gap-1"
            onClick={() => window.open("https://developer.pinelabs.com", "_blank", "noopener,noreferrer")}
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Razorpay Portal Card — API Key authentication ─────────────────────────────
// Allows a merchant to connect their own Razorpay account using API Key + Secret.
// Credentials are encrypted server-side immediately on submit; never stored or
// returned in plaintext. Raw values are wiped from component state after connect.

interface PortalTransaction {
  id: number;
  externalId: string;
  amount: number;
  currency: string;
  normalizedStatus: string | null;
  paymentMethod: string | null;
  txTimestamp: string | null;
  fetchedAt: string;
}

function RazorpayPortalCard({
  provider,
  session,
}: {
  provider: any;
  session: MerchantPortalSession | null;
}) {
  const qc = useQueryClient();
  const [keyId, setKeyId]         = useState("");
  const [keySecret, setKeySecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing]       = useState(false);

  const status      = session?.status ?? null;
  const isConnected = status === "CONNECTED";
  const isFailed    = status === "FAILED";
  const needsConnect =
    !status || status === "DISCONNECTED" || status === "EXPIRED" || isFailed;

  const providerName = wlName(provider.slug, provider.name);
  const cmeta = CATEGORY_META[provider.category] ?? {
    label: provider.category,
    color: "bg-muted text-muted-foreground border-border",
  };

  // Recent transactions — only fetched when connected
  const { data: txData } = useQuery<PortalTransaction[]>({
    queryKey: ["merchant", "portal-transactions", "razorpay"],
    queryFn: async () => {
      const res = await portalFetch(
        "/api/merchant/portal-sessions/razorpay/transactions?limit=5",
      );
      if (!res.ok) return [];
      const body = await res.json();
      return (body.transactions ?? []) as PortalTransaction[];
    },
    enabled: isConnected,
    staleTime: 60_000,
  });

  async function handleConnect() {
    if (!keyId.trim()) {
      toast.error("API Key ID is required.");
      return;
    }
    if (!keySecret.trim()) {
      toast.error("API Key Secret is required.");
      return;
    }
    setConnecting(true);
    try {
      const result = await initiatePortalSession("razorpay", {
        loginMethod: "api_key",
        identifier:  keyId.trim(),
        password:    keySecret.trim(),
      });
      if (result.status === "CONNECTED") {
        toast.success("Razorpay account connected. Transactions will sync shortly.");
        // Wipe from state immediately after successful connect
        setKeyId("");
        setKeySecret("");
        qc.invalidateQueries({ queryKey: PORTAL_SESSIONS_QUERY_KEY });
      } else {
        const msg = result.message ?? "Connection failed. Check your API credentials.";
        toast.error(msg);
        qc.invalidateQueries({ queryKey: PORTAL_SESSIONS_QUERY_KEY });
      }
    } catch {
      toast.error("Connection failed. Please try again.");
    } finally {
      setConnecting(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await portalFetch(
        "/api/merchant/portal-sessions/razorpay/sync",
        { method: "POST" },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Sync failed.");
      } else {
        const n = body.synced ?? 0;
        toast.success(`Sync complete — ${n} new transaction${n === 1 ? "" : "s"} fetched.`);
        qc.invalidateQueries({ queryKey: ["merchant", "portal-transactions", "razorpay"] });
        qc.invalidateQueries({ queryKey: PORTAL_SESSIONS_QUERY_KEY });
      }
    } catch {
      toast.error("Sync failed. Please try again.");
    } finally {
      setSyncing(false);
    }
  }

  async function handleDisconnect() {
    try {
      const res = await portalFetch(
        "/api/merchant/portal-sessions/razorpay/disconnect",
        { method: "POST" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? "Disconnect failed.");
      } else {
        toast.success("Razorpay account disconnected.");
        qc.invalidateQueries({ queryKey: PORTAL_SESSIONS_QUERY_KEY });
        qc.invalidateQueries({ queryKey: ["merchant", "portal-transactions", "razorpay"] });
      }
    } catch {
      toast.error("Disconnect failed. Please try again.");
    }
  }

  return (
    <Card className="border-border/60 bg-card">
      <CardHeader className="pb-2">
        <div className="flex items-start gap-3">
          <div className="w-14 h-14 rounded-xl bg-background border border-border/60 flex items-center justify-center shrink-0">
            <ProviderIcon slug={provider.slug} />
          </div>
          <div className="flex-1 min-w-0">
            <CardTitle className="text-base truncate">{providerName}</CardTitle>
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              <Badge
                variant="outline"
                className={`text-xs ${cmeta.color}`}
              >
                {cmeta.label}
              </Badge>
              {isConnected && (
                <Badge
                  variant="outline"
                  className="text-xs border-emerald-500/40 text-emerald-400 flex items-center gap-1"
                >
                  <CheckCircle2 className="w-3 h-3" /> Connected
                </Badge>
              )}
              {isFailed && (
                <Badge
                  variant="outline"
                  className="text-xs border-red-500/40 text-red-400 flex items-center gap-1"
                >
                  <XCircle className="w-3 h-3" /> Failed
                </Badge>
              )}
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground leading-relaxed">
          {PROVIDER_DESC[provider.slug] ??
            "Connect your Razorpay merchant account to sync transaction history and monitor settlement status inside RasoKart."}
        </p>

        {/* ── CONNECTED state ──────────────────────────────────────────── */}
        {isConnected && (
          <div className="space-y-3">
            <div className="p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20 space-y-1">
              <p className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" /> Account Connected
              </p>
              <p className="text-xs text-muted-foreground">
                {session?.connectedAt
                  ? `Connected on ${new Date(session.connectedAt).toLocaleDateString("en-IN")}`
                  : "Your Razorpay account is connected and monitored."}
              </p>
            </div>

            {/* Recent synced transactions */}
            {txData && txData.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Recent transactions</p>
                {txData.map(tx => (
                  <div
                    key={tx.id}
                    className="flex items-center justify-between text-xs py-1 border-b border-border/30 last:border-0"
                  >
                    <span className="text-muted-foreground font-mono truncate max-w-[120px]">
                      {tx.externalId}
                    </span>
                    <span className="font-medium tabular-nums">
                      ₹{((tx.amount ?? 0) / 100).toLocaleString("en-IN", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </span>
                    <span
                      className={`capitalize font-medium ${
                        tx.normalizedStatus === "SUCCESS"
                          ? "text-emerald-400"
                          : tx.normalizedStatus === "FAILED"
                          ? "text-red-400"
                          : "text-amber-400"
                      }`}
                    >
                      {tx.normalizedStatus?.toLowerCase() ?? "unknown"}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {txData && txData.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-2">
                No transactions yet. Click "Sync Now" to fetch the last 30 days.
              </p>
            )}

            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="flex-1 gap-1.5"
                onClick={handleSync}
                disabled={syncing}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
                {syncing ? "Syncing…" : "Sync Now"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="gap-1.5 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                onClick={handleDisconnect}
              >
                <Unlink className="w-3.5 h-3.5" />
                Disconnect
              </Button>
            </div>
          </div>
        )}

        {/* ── NOT CONNECTED / credential form ──────────────────────────── */}
        {needsConnect && (
          <div className="space-y-3">
            {isFailed && session?.lastStatusMessage && (
              <div className="p-2.5 rounded-lg bg-red-500/5 border border-red-500/20">
                <p className="text-xs text-red-400 flex items-start gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  {session.lastStatusMessage}
                </p>
              </div>
            )}

            <div className="space-y-2">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">API Key ID</label>
                <Input
                  className="h-8 text-xs font-mono"
                  placeholder="rzp_live_xxxxxxxxxxxx"
                  value={keyId}
                  onChange={e => setKeyId(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">API Key Secret</label>
                <div className="relative">
                  <Input
                    className="h-8 text-xs font-mono pr-12"
                    placeholder="••••••••••••••••"
                    type={showSecret ? "text" : "password"}
                    value={keySecret}
                    onChange={e => setKeySecret(e.target.value)}
                    autoComplete="new-password"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setShowSecret(v => !v)}
                    tabIndex={-1}
                  >
                    {showSecret ? "Hide" : "Show"}
                  </button>
                </div>
              </div>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              Get your keys from{" "}
              <a
                href="https://dashboard.razorpay.com/app/keys"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline-offset-2 hover:underline"
              >
                Razorpay Dashboard → Settings → API Keys
              </a>
              . Keys are encrypted with AES-256 on the server and never returned to the browser.
            </p>

            <Button
              size="sm"
              className="w-full gap-1.5"
              onClick={handleConnect}
              disabled={connecting || !keyId.trim() || !keySecret.trim()}
            >
              {connecting ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Validating credentials…
                </>
              ) : (
                <>
                  <Link2 className="w-3.5 h-3.5" />
                  Connect Razorpay Account
                </>
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Paytm Business Portal Card — credential-first portal_session_connector ─────
// Mobile + OTP login via browser automation against business.paytm.com.
// The RasoKart backend navigates the portal with Playwright, submits credentials,
// and stores only the encrypted browser session state. No passwords are stored.
// OTPs are discarded after submission and never stored, logged, or replayed.

type PaytmUiStep = "mobile" | "otp" | "password" | "connected" | "blocked" | "reconnect_needed";

function PaytmPortalCard({
  provider,
  session,
}: {
  provider: any;
  session: MerchantPortalSession | null;
}) {
  const qc = useQueryClient();

  // Derive UI step from session status
  function deriveStep(s: MerchantPortalSession | null): PaytmUiStep {
    if (!s) return "mobile";
    if (s.status === "CONNECTED") return "connected";
    if (s.status === "AWAITING_OTP") return "otp";
    if (s.status === "AWAITING_PASSWORD") return "password";
    if (s.status === "BLOCKED") return "blocked";
    if (s.status === "RECONNECT_REQUIRED" || s.status === "SESSION_EXPIRED") return "reconnect_needed";
    // FAILED, DISCONNECTED, PENDING, PORTAL_UNREACHABLE → show mobile input
    return "mobile";
  }

  const [uiStep, setUiStep] = useState<PaytmUiStep>(() => deriveStep(session));
  const [mobile, setMobile]     = useState("");
  const [otp, setOtp]           = useState("");
  const [password, setPassword] = useState("");
  const [initiating, setInitiating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [syncing, setSyncing]       = useState(false);
  const [errorMsg, setErrorMsg]     = useState<string | null>(null);
  /**
   * Ref-based in-flight guard for handleSubmitOtp.
   * A ref (not state) is used so the check is synchronous — before React
   * re-renders — making the handler truly non-reentrant on fast double-taps.
   */
  const submittingOtpRef = useRef(false);
  /**
   * Ref-based in-flight guard for handleSubmitPassword.
   * Mirrors submittingOtpRef so fast double-taps on the password submit button
   * cannot fire duplicate POST requests before React re-renders the button to
   * disabled.
   */
  const submittingPasswordRef = useRef(false);

  // Sync UI step when session prop changes (e.g. after query invalidation)
  useEffect(() => {
    setUiStep(deriveStep(session));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.status]);

  const providerName = "Paytm Business";
  const cmeta = CATEGORY_META["upi"] ?? { label: "UPI", color: "bg-violet-500/10 text-violet-400 border-violet-500/20" };
  const isConnected = uiStep === "connected";

  // Recent synced transactions (only when connected)
  const { data: txData } = useQuery<PortalTransaction[]>({
    queryKey: ["merchant", "portal-transactions", "paytm_merchant"],
    queryFn: async () => {
      const res = await portalFetch(
        "/api/merchant/portal-sessions/paytm_merchant/transactions?limit=5",
      );
      if (!res.ok) return [];
      const body = await res.json();
      return (body.transactions ?? []) as PortalTransaction[];
    },
    enabled: isConnected,
    staleTime: 60_000,
  });

  // ── Step 1: initiate (mobile / email entry) ──────────────────────────────────
  async function handleInitiate() {
    const identifier = mobile.trim();
    const isMobile = /^\d{10}$/.test(identifier);
    const isEmail  = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier);
    if (!isMobile && !isEmail) {
      setErrorMsg("Enter your 10-digit Paytm-registered mobile number or email address.");
      return;
    }
    setInitiating(true);
    setErrorMsg(null);
    try {
      const result = await initiatePortalSession("paytm_merchant", {
        loginMethod: "mobile_otp",
        identifier,
      });
      qc.invalidateQueries({ queryKey: PORTAL_SESSIONS_QUERY_KEY });

      if (result.status === "AWAITING_PASSWORD") {
        setUiStep("password");
        setMobile(""); // wipe identifier from state immediately
        toast.info(result.message ?? "Enter your Paytm Business account password below.");
      } else if (result.status === "AWAITING_OTP") {
        setUiStep("otp");
        setMobile(""); // wipe from component state immediately
        toast.success("OTP sent to your Paytm-registered mobile. Enter it below.");
      } else if (result.status === "AWAITING_USER_ACTION") {
        setErrorMsg(
          result.message ??
            "Paytm is showing a CAPTCHA. Please wait a few minutes and try again.",
        );
      } else {
        const msg =
          result.message ?? "Could not connect to Paytm Business portal. Please try again.";
        setErrorMsg(msg);
        toast.error(msg);
      }
    } catch {
      setErrorMsg("Could not reach the server. Please try again.");
    } finally {
      setInitiating(false);
    }
  }

  // ── Step 2: submit OTP ────────────────────────────────────────────────────────
  async function handleSubmitOtp() {
    // Ref guard: checked synchronously before any React re-render, so a fast
    // double-tap cannot sneak in a second call while the first is in flight.
    if (submittingOtpRef.current) return;
    submittingOtpRef.current = true;
    const otpVal = otp.trim().replace(/\s/g, "");
    if (!otpVal || otpVal.length < 4) {
      submittingOtpRef.current = false;
      setErrorMsg("Enter the OTP you received on your mobile.");
      return;
    }
    setSubmitting(true);
    setErrorMsg(null);
    try {
      // POST plaintext OTP — server encrypts immediately before passing to adapter
      const res = await portalFetch(
        "/api/merchant/portal-sessions/paytm_merchant/submit-step",
        { method: "POST", body: JSON.stringify({ otp: otpVal }) },
      );
      // Wipe OTP from component state immediately regardless of outcome
      setOtp("");

      const body = await res.json().catch(() => ({}));
      qc.invalidateQueries({ queryKey: PORTAL_SESSIONS_QUERY_KEY });

      if (body.status === "CONNECTED") {
        setUiStep("connected");
        toast.success("Paytm Business account connected. Syncing transactions…");
        // Auto-sync
        setTimeout(() => handleSync(), 1500);
      } else if (body.status === "FAILED" && body.errorCode === "OTP_EXPIRED") {
        setUiStep("mobile");
        setErrorMsg("OTP expired. Please enter your mobile number again to receive a new OTP.");
      } else {
        const msg =
          body.message ??
          "OTP verification failed. Please check the OTP and try again, or restart the connection.";
        setErrorMsg(msg);
        toast.error(msg);
      }
    } catch {
      setOtp(""); // still wipe on error
      setErrorMsg("Could not submit OTP. Please try again.");
    } finally {
      submittingOtpRef.current = false;
      setSubmitting(false);
    }
  }

  // ── Step 2b: submit Password (password-mode login) ───────────────────────────
  async function handleSubmitPassword() {
    // Synchronous ref guard — prevents duplicate POSTs from fast double-taps
    // that arrive before React re-renders the button to disabled.
    if (submittingPasswordRef.current) return;
    submittingPasswordRef.current = true;
    const pw = password.trim();
    if (!pw) {
      submittingPasswordRef.current = false;
      setErrorMsg("Enter your Paytm Business account password.");
      return;
    }
    setSubmitting(true);
    setErrorMsg(null);
    try {
      // POST plaintext password — server encrypts immediately before passing to adapter
      const res = await portalFetch(
        "/api/merchant/portal-sessions/paytm_merchant/submit-step",
        { method: "POST", body: JSON.stringify({ otp: pw }) },
      );
      // Wipe password from component state immediately regardless of outcome
      setPassword("");

      const body = await res.json().catch(() => ({}));
      qc.invalidateQueries({ queryKey: PORTAL_SESSIONS_QUERY_KEY });

      if (body.status === "CONNECTED") {
        setUiStep("connected");
        toast.success("Paytm Business account connected. Syncing transactions…");
        setTimeout(() => handleSync(), 1500);
      } else if (body.status === "AWAITING_OTP") {
        // Portal sent OTP for 2FA after password
        setUiStep("otp");
        toast.info("Paytm sent an OTP for 2-step verification. Enter it below.");
      } else {
        const msg =
          body.message ??
          "Password verification failed. Please check your credentials and try again.";
        setErrorMsg(msg);
        toast.error(msg);
      }
    } catch {
      setPassword(""); // still wipe on error
      setErrorMsg("Could not submit password. Please try again.");
    } finally {
      submittingPasswordRef.current = false;
      setSubmitting(false);
    }
  }

  // ── Sync ──────────────────────────────────────────────────────────────────────
  async function handleSync() {
    setSyncing(true);
    try {
      const res = await portalFetch(
        "/api/merchant/portal-sessions/paytm_merchant/sync",
        { method: "POST" },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Sync failed.");
      } else {
        const n = body.synced ?? 0;
        toast.success(`Sync complete — ${n} new transaction${n === 1 ? "" : "s"} fetched.`);
        qc.invalidateQueries({ queryKey: ["merchant", "portal-transactions", "paytm_merchant"] });
        qc.invalidateQueries({ queryKey: PORTAL_SESSIONS_QUERY_KEY });
      }
    } catch {
      toast.error("Sync failed. Please try again.");
    } finally {
      setSyncing(false);
    }
  }

  // ── Disconnect ────────────────────────────────────────────────────────────────
  async function handleDisconnect() {
    try {
      const res = await portalFetch(
        "/api/merchant/portal-sessions/paytm_merchant/disconnect",
        { method: "POST" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? "Disconnect failed.");
      } else {
        toast.success("Paytm Business account disconnected.");
        setUiStep("mobile");
        setErrorMsg(null);
        qc.invalidateQueries({ queryKey: PORTAL_SESSIONS_QUERY_KEY });
        qc.invalidateQueries({ queryKey: ["merchant", "portal-transactions", "paytm_merchant"] });
      }
    } catch {
      toast.error("Disconnect failed. Please try again.");
    }
  }

  // ── Reconnect ─────────────────────────────────────────────────────────────────
  async function handleReconnect() {
    setInitiating(true);
    setErrorMsg(null);
    try {
      const res = await portalFetch(
        "/api/merchant/portal-sessions/paytm_merchant/reconnect",
        { method: "POST" },
      );
      const body = await res.json().catch(() => ({}));
      qc.invalidateQueries({ queryKey: PORTAL_SESSIONS_QUERY_KEY });

      if (body.status === "CONNECTED") {
        setUiStep("connected");
        toast.success("Session reconnected successfully.");
      } else if (body.status === "AWAITING_OTP") {
        setUiStep("otp");
        toast.info("A new OTP is required. Enter it below.");
      } else if (body.status === "AWAITING_PASSWORD") {
        setUiStep("password");
        toast.info(body.message ?? "Re-enter your Paytm Business account password.");
      } else {
        // Full re-auth needed
        setUiStep("mobile");
        setErrorMsg(
          body.message ?? "Session expired. Please enter your credentials again.",
        );
      }
    } catch {
      setUiStep("mobile");
      setErrorMsg("Could not reconnect. Please enter your credentials again.");
    } finally {
      setInitiating(false);
    }
  }

  return (
    <Card className="border-border/60 bg-card">
      <CardHeader className="pb-2">
        <div className="flex items-start gap-3">
          <div className="w-14 h-14 rounded-xl bg-background border border-border/60 flex items-center justify-center shrink-0">
            <ProviderIcon slug="paytm_merchant" />
          </div>
          <div className="flex-1 min-w-0">
            <CardTitle className="text-base truncate">{providerName}</CardTitle>
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              <Badge variant="outline" className={`text-xs ${cmeta.color}`}>
                {cmeta.label}
              </Badge>
              {isConnected && (
                <Badge variant="outline" className="text-xs border-emerald-500/40 text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Connected
                </Badge>
              )}
              {uiStep === "otp" && (
                <Badge variant="outline" className="text-xs border-amber-500/40 text-amber-400 flex items-center gap-1">
                  <Clock className="w-3 h-3" /> Enter OTP
                </Badge>
              )}
              {uiStep === "password" && (
                <Badge variant="outline" className="text-xs border-sky-500/40 text-sky-400 flex items-center gap-1">
                  <Lock className="w-3 h-3" /> Enter Password
                </Badge>
              )}
              {uiStep === "blocked" && (
                <Badge variant="outline" className="text-xs border-red-500/40 text-red-400 flex items-center gap-1">
                  <XCircle className="w-3 h-3" /> Blocked
                </Badge>
              )}
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground leading-relaxed">
          {PROVIDER_DESC["paytm_merchant"]}
        </p>

        {/* ── Security note (always visible) ───────────────────────────── */}
        <div className="flex items-start gap-1.5 p-2.5 rounded-lg bg-muted/20 border border-border/40">
          <Lock className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
          <p className="text-xs text-muted-foreground leading-relaxed">
            Your credentials are AES-256 encrypted on the server before use.
            Passwords are never stored, logged, or replayed — they are used once to authenticate
            your browser session, then discarded.
          </p>
        </div>

        {/* ── CONNECTED state ───────────────────────────────────────────── */}
        {isConnected && (
          <div className="space-y-3">
            <div className="p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20 space-y-1">
              <p className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" /> Account Connected
              </p>
              <p className="text-xs text-muted-foreground">
                {session?.connectedAt
                  ? `Connected on ${new Date(session.connectedAt).toLocaleDateString("en-IN")}`
                  : "Your Paytm Business account is connected."}
              </p>
            </div>

            {/* Recent transactions */}
            {txData && txData.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Recent transactions</p>
                {txData.map(tx => (
                  <div
                    key={tx.id}
                    className="flex items-center justify-between text-xs py-1 border-b border-border/30 last:border-0"
                  >
                    <span className="text-muted-foreground font-mono truncate max-w-[120px]">
                      {tx.externalId}
                    </span>
                    <span className="font-medium tabular-nums">
                      ₹{((tx.amount ?? 0) / 100).toLocaleString("en-IN", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </span>
                    <span className={`capitalize font-medium ${
                      tx.normalizedStatus === "SUCCESS" ? "text-emerald-400"
                      : tx.normalizedStatus === "FAILED" ? "text-red-400"
                      : "text-amber-400"
                    }`}>
                      {tx.normalizedStatus?.toLowerCase() ?? "unknown"}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {txData && txData.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-2">
                No transactions yet. Click "Sync Now" to fetch the last 30 days.
              </p>
            )}

            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="flex-1 gap-1.5"
                onClick={handleSync}
                disabled={syncing}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
                {syncing ? "Syncing…" : "Sync Now"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="gap-1.5 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                onClick={handleDisconnect}
              >
                <Unlink className="w-3.5 h-3.5" />
                Disconnect
              </Button>
            </div>
          </div>
        )}

        {/* ── AWAITING_OTP state: OTP entry ─────────────────────────────── */}
        {uiStep === "otp" && (
          <div className="space-y-3">
            <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
              <p className="text-xs font-semibold text-amber-400 flex items-center gap-1.5 mb-1">
                <Clock className="w-3.5 h-3.5" /> OTP Sent
              </p>
              <p className="text-xs text-muted-foreground">
                An OTP has been sent to your Paytm-registered mobile.
                Enter it below to complete the connection.
              </p>
            </div>

            {errorMsg && (
              <div className="p-2.5 rounded-lg bg-red-500/5 border border-red-500/20">
                <p className="text-xs text-red-400 flex items-start gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  {errorMsg}
                </p>
              </div>
            )}

            <div>
              <label className="text-xs text-muted-foreground block mb-1">OTP</label>
              <Input
                className="h-8 text-sm font-mono tracking-widest"
                placeholder="••••••"
                type="password"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={8}
                value={otp}
                onChange={e => setOtp(e.target.value.replace(/\D/g, ""))}
                onKeyDown={e => e.key === "Enter" && handleSubmitOtp()}
                autoFocus
              />
            </div>

            <p className="text-xs text-muted-foreground">
              OTP is used once and discarded immediately — never stored.
            </p>

            <div className="flex gap-2">
              <Button
                size="sm"
                className="flex-1 gap-1.5"
                onClick={handleSubmitOtp}
                disabled={submitting || !otp.trim()}
              >
                {submitting ? (
                  <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Verifying…</>
                ) : (
                  <><CheckCircle2 className="w-3.5 h-3.5" /> Verify OTP</>
                )}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-muted-foreground"
                onClick={() => { setUiStep("mobile"); setOtp(""); setErrorMsg(null); }}
              >
                Start Over
              </Button>
            </div>
          </div>
        )}

        {/* ── AWAITING_PASSWORD state: password entry ───────────────────── */}
        {uiStep === "password" && (
          <div className="space-y-3">
            <div className="p-3 rounded-lg bg-sky-500/5 border border-sky-500/20">
              <p className="text-xs font-semibold text-sky-400 flex items-center gap-1.5 mb-1">
                <Lock className="w-3.5 h-3.5" /> Password Required
              </p>
              <p className="text-xs text-muted-foreground">
                Paytm Business uses password login. Enter your account password below
                to complete the connection. It is AES-256 encrypted in transit and
                never stored or logged.
              </p>
            </div>

            {errorMsg && (
              <div className="p-2.5 rounded-lg bg-red-500/5 border border-red-500/20">
                <p className="text-xs text-red-400 flex items-start gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  {errorMsg}
                </p>
              </div>
            )}

            <div>
              <label className="text-xs text-muted-foreground block mb-1">
                Paytm Business Account Password
              </label>
              <Input
                className="h-8 text-sm"
                placeholder="Your Paytm Business password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSubmitPassword()}
                autoFocus
              />
            </div>

            <p className="text-xs text-muted-foreground">
              Your password is used once to authenticate your browser session, then immediately discarded.
            </p>

            <div className="flex gap-2">
              <Button
                size="sm"
                className="flex-1 gap-1.5"
                onClick={handleSubmitPassword}
                disabled={submitting || !password.trim()}
              >
                {submitting ? (
                  <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Connecting…</>
                ) : (
                  <><CheckCircle2 className="w-3.5 h-3.5" /> Connect</>
                )}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-muted-foreground"
                onClick={() => { setUiStep("mobile"); setPassword(""); setErrorMsg(null); }}
              >
                Start Over
              </Button>
            </div>
          </div>
        )}

        {/* ── RECONNECT_REQUIRED state ──────────────────────────────────── */}
        {uiStep === "reconnect_needed" && (
          <div className="space-y-3">
            <div className="p-2.5 rounded-lg bg-amber-500/5 border border-amber-500/20 flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-medium text-amber-400">Session Expired</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Your Paytm session has expired. Click Reconnect to try restoring it,
                  or enter your mobile number to re-authenticate.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                className="flex-1"
                onClick={handleReconnect}
                disabled={initiating}
              >
                {initiating ? (
                  <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Reconnecting…</>
                ) : "Reconnect"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setUiStep("mobile"); setErrorMsg(null); }}>
                New Login
              </Button>
            </div>
          </div>
        )}

        {/* ── BLOCKED state ─────────────────────────────────────────────── */}
        {uiStep === "blocked" && (
          <div className="space-y-3">
            <div className="p-2.5 rounded-lg bg-red-500/5 border border-red-500/20 flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-red-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-medium text-red-400">Account Blocked</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {session?.lastStatusMessage ??
                    "Your Paytm Business account appears to be blocked. Please contact Paytm Business support."}
                </p>
              </div>
            </div>
            <Button size="sm" variant="outline" className="w-full" asChild>
              <a href="https://business.paytm.com" target="_blank" rel="noopener noreferrer">
                Contact Paytm Business Support <ExternalLink className="w-3 h-3 ml-1" />
              </a>
            </Button>
          </div>
        )}

        {/* ── MOBILE entry state (initial / disconnected / failed) ──────── */}
        {uiStep === "mobile" && (
          <div className="space-y-3">
            {errorMsg && (
              <div className="p-2.5 rounded-lg bg-red-500/5 border border-red-500/20">
                <p className="text-xs text-red-400 flex items-start gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  {errorMsg}
                </p>
              </div>
            )}

            {session?.status === "FAILED" && session.lastStatusMessage && !errorMsg && (
              <div className="p-2.5 rounded-lg bg-red-500/5 border border-red-500/20">
                <p className="text-xs text-red-400 flex items-start gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  {session.lastStatusMessage}
                </p>
              </div>
            )}

            <div>
              <label className="text-xs text-muted-foreground block mb-1">
                Mobile Number or Email Address
              </label>
              <Input
                className="h-8 text-sm"
                placeholder="Mobile or email registered with Paytm Business"
                type="text"
                autoComplete="username"
                value={mobile}
                onChange={e => setMobile(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleInitiate()}
              />
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              Enter the mobile number or email address registered with your Paytm Business account.
              You will be prompted for your password on the next step.
              Go to{" "}
              <a
                href="https://dashboard.paytm.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline-offset-2 hover:underline"
              >
                dashboard.paytm.com
              </a>{" "}
              if you need to verify your registered details.
            </p>

            <Button
              size="sm"
              className="w-full gap-1.5"
              onClick={handleInitiate}
              disabled={initiating || !mobile.trim()}
            >
              {initiating ? (
                <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Connecting…</>
              ) : (
                <><Link2 className="w-3.5 h-3.5" /> Connect Paytm Business</>
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Pine Labs ONE portal card ─────────────────────────────────────────────────

type PineLabsOneUiStep =
  | "identifier"
  | "password"
  | "otp"
  | "connected"
  | "blocked"
  | "reconnect_needed";

function PineLabsOnePortalCard({
  provider,
  session,
}: {
  provider: any;
  session: MerchantPortalSession | null;
}) {
  const qc = useQueryClient();

  function deriveStep(s: MerchantPortalSession | null): PineLabsOneUiStep {
    if (!s) return "identifier";
    if (s.status === "CONNECTED") return "connected";
    if (s.status === "AWAITING_OTP") return "otp";
    if (s.status === "AWAITING_PASSWORD") return "password";
    if (s.status === "BLOCKED") return "blocked";
    if (s.status === "RECONNECT_REQUIRED" || s.status === "SESSION_EXPIRED") return "reconnect_needed";
    return "identifier";
  }

  const [uiStep, setUiStep] = useState<PineLabsOneUiStep>(() => deriveStep(session));
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword]     = useState("");
  const [otp, setOtp]               = useState("");
  const [initiating, setInitiating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [syncing, setSyncing]       = useState(false);
  const [errorMsg, setErrorMsg]     = useState<string | null>(null);
  /** Loading state while the adapter clicks the portal's "Login with OTP" link. */
  const [requestingOtp, setRequestingOtp] = useState(false);
  /** True while a resend_otp submit-step request is in flight. */
  const [resending, setResending] = useState(false);
  const initialCooldown = readPineLabsOtpCooldown(session?.id ?? null);
  const resendCooldownExpiresAtRef = useRef<number | null>(initialCooldown?.expiresAt ?? null);
  /**
   * How the current AWAITING_OTP was reached:
   *   "2fa"          — portal triggered 2FA after password submission
   *   "portal_link"  — merchant clicked "Login with OTP" (portal's own link)
   *   "otp_first"    — portal sent an OTP directly after the identifier step
   *                    (the live authV2 flow for mobile/email logins — no
   *                    password page is ever shown)
   */
  const [otpSource, setOtpSource] = useState<"2fa" | PineLabsOtpCooldownSource>(
    initialCooldown?.source ?? "2fa",
  );
  const [resendCooldown, setResendCooldown] = useState(() => {
    if (!initialCooldown) return 0;
    return Math.max(0, Math.ceil((initialCooldown.expiresAt - Date.now()) / 1_000));
  });
  /**
   * Ref-based in-flight guard for handleSubmitOtp.
   * A ref (not state) is used so the check is synchronous — before React
   * re-renders — making the handler truly non-reentrant on fast double-taps.
   */
  const submittingOtpRef = useRef(false);
  /**
   * Ref-based in-flight guard for handleSubmitPassword.
   * Mirrors submittingOtpRef so fast double-taps on the password submit button
   * cannot fire duplicate POST requests before React re-renders the button to
   * disabled.
   */
  const submittingPasswordRef = useRef(false);
  /**
   * Ref-based in-flight guard for handleResendOtp.
   * Mirrors submittingOtpRef / submittingPasswordRef so fast double-taps on the
   * "Resend OTP" button cannot fire duplicate POST requests before React
   * re-renders the button to disabled.
   */
  const resendingRef = useRef(false);

  function startResendCooldown(source: PineLabsOtpCooldownSource) {
    resendCooldownExpiresAtRef.current = persistPineLabsOtpCooldown(
      session?.id ?? null,
      source,
    );
    setResendCooldown(60);
  }

  function resetResendCooldown() {
    resendCooldownExpiresAtRef.current = null;
    setResendCooldown(0);
    clearPineLabsOtpCooldown(session?.id ?? null);
  }

  useEffect(() => {
    setUiStep(deriveStep(session));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.status]);

  // Restore a cooldown after the card is remounted. The server session ID is
  // preferred; a pending key bridges the short window between initiating the
  // session and the portal-sessions query returning its ID.
  useEffect(() => {
    const cooldown = readPineLabsOtpCooldown(session?.id ?? null);
    if (!cooldown) return;
    if (session?.id != null) {
      try {
        sessionStorage.setItem(
          pineLabsOtpCooldownStorageKey(session.id),
          JSON.stringify(cooldown),
        );
        sessionStorage.removeItem(PINE_LABS_OTP_COOLDOWN_PENDING_KEY);
      } catch {
        // The in-memory timer still protects the currently mounted card.
      }
    }
    resendCooldownExpiresAtRef.current = cooldown.expiresAt;
    setResendCooldown(
      Math.max(0, Math.ceil((cooldown.expiresAt - Date.now()) / 1_000)),
    );
    setOtpSource(cooldown.source);
  }, [session?.id]);

  // Resend OTP cooldown countdown timer. The absolute expiry prevents a
  // remount/navigation from resetting the full 60 seconds.
  useEffect(() => {
    if (!resendCooldownExpiresAtRef.current) return;
    const updateCooldown = () => {
      const expiresAt = resendCooldownExpiresAtRef.current;
      if (!expiresAt) return;
      const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1_000));
      setResendCooldown(remaining);
      if (remaining === 0) {
        resendCooldownExpiresAtRef.current = null;
        clearPineLabsOtpCooldown(session?.id ?? null);
      }
    };
    updateCooldown();
    const t = setInterval(updateCooldown, 1_000);
    return () => clearInterval(t);
  }, [resendCooldown, session?.id]);

  const providerName = "Pine Labs ONE";
  const cmeta = CATEGORY_META["pos"] ?? { label: "POS", color: "bg-orange-500/10 text-orange-400 border-orange-500/20" };
  const isConnected = uiStep === "connected";

  const { data: txData } = useQuery<PortalTransaction[]>({
    queryKey: ["merchant", "portal-transactions", "pinelabs_one"],
    queryFn: async () => {
      const res = await portalFetch("/api/merchant/portal-sessions/pinelabs_one/transactions?limit=5");
      if (!res.ok) return [];
      const body = await res.json();
      return (body.transactions ?? []) as PortalTransaction[];
    },
    enabled: isConnected,
    staleTime: 60_000,
  });

  // ── Step 1: initiate (identifier entry) ────────────────────────────────────
  async function handleInitiate() {
    const id = identifier.trim();
    // Accept 10-digit mobile OR valid email. User ID / username is not a valid
    // OTP destination for Pine Labs ONE and must not be submitted.
    const isMobile = /^\d{10}$/.test(id.replace(/\D/g, ""));
    const isEmail  = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(id) && id.length <= 100;
    if (!isMobile && !isEmail) {
      setErrorMsg(
        "Enter your registered email address or 10-digit mobile number " +
        "for your Pine Labs ONE account."
      );
      return;
    }
    setInitiating(true);
    setErrorMsg(null);
    try {
      const result = await initiatePortalSession("pinelabs_one", {
        loginMethod: "mobile_password",
        identifier: id,
      });
      qc.invalidateQueries({ queryKey: PORTAL_SESSIONS_QUERY_KEY });
      setIdentifier(""); // wipe from state after submitting

      if (result.status === "AWAITING_PASSWORD") {
        setUiStep("password");
        toast.info(result.message ?? "Enter your Pine Labs ONE account password below.");
      } else if (result.status === "AWAITING_OTP") {
        // OTP-first flow (live authV2 portal): the OTP page has its own
        // Resend control, so enable the Resend button with the portal's
        // initial cooldown.
        setOtpSource("otp_first");
        startResendCooldown("otp_first");
        setUiStep("otp");
        toast.success("OTP sent to your registered email or mobile. Enter it below.");
      } else if (result.status === "AWAITING_USER_ACTION") {
        setErrorMsg(
          result.message ??
            "Pine Labs ONE is showing a CAPTCHA or device approval screen. Please wait a few minutes and try again.",
        );
      } else {
        const msg = result.message ?? "Could not connect to Pine Labs ONE portal. Please try again.";
        setErrorMsg(msg);
        toast.error(msg);
      }
    } catch {
      setErrorMsg("Could not reach the server. Please try again.");
    } finally {
      setInitiating(false);
    }
  }

  // ── Step 2: submit password ─────────────────────────────────────────────────
  async function handleSubmitPassword() {
    // Synchronous ref guard — prevents duplicate POSTs from fast double-taps
    // that arrive before React re-renders the button to disabled.
    if (submittingPasswordRef.current) return;
    submittingPasswordRef.current = true;
    const pw = password.trim();
    if (!pw) {
      submittingPasswordRef.current = false;
      setErrorMsg("Enter your Pine Labs ONE account password.");
      return;
    }
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await portalFetch(
        "/api/merchant/portal-sessions/pinelabs_one/submit-step",
        { method: "POST", body: JSON.stringify({ otp: pw }) },
      );
      setPassword(""); // wipe immediately regardless of outcome

      const body = await res.json().catch(() => ({}));
      qc.invalidateQueries({ queryKey: PORTAL_SESSIONS_QUERY_KEY });

      if (body.status === "CONNECTED") {
        setUiStep("connected");
        toast.success("Pine Labs ONE account connected. Syncing transactions…");
        setTimeout(() => handleSync(), 1500);
      } else if (body.status === "AWAITING_OTP") {
        setUiStep("otp");
        toast.info("Pine Labs ONE sent an OTP for 2-step verification. Enter it below.");
      } else {
        const msg = body.message ?? "Password verification failed. Please check your credentials and try again.";
        setErrorMsg(msg);
        toast.error(msg);
      }
    } catch {
      setPassword("");
      setErrorMsg("Could not submit password. Please try again.");
    } finally {
      setSubmitting(false);
      submittingPasswordRef.current = false;
    }
  }

  // ── Step 2b: request portal-native OTP (click "Login with OTP" link) ─────────
  // No password needed — the adapter clicks Pine Labs ONE's own OTP link.
  async function handleRequestOtpLogin() {
    setRequestingOtp(true);
    setErrorMsg(null);
    try {
      const res = await portalFetch(
        "/api/merchant/portal-sessions/pinelabs_one/submit-step",
        { method: "POST", body: JSON.stringify({ loginMethod: "portal_otp" }) },
      );
      const body = await res.json().catch(() => ({}));
      qc.invalidateQueries({ queryKey: PORTAL_SESSIONS_QUERY_KEY });

      if (body.status === "AWAITING_OTP") {
        setOtpSource("portal_link");
        setUiStep("otp");
        startResendCooldown("portal_link");
        toast.info(body.message ?? "OTP sent to your registered mobile or email. Enter it below.");
      } else if (body.errorCode === "OTP_NOT_AVAILABLE" || body.status === "AWAITING_PASSWORD") {
        // The portal's OTP login is not available for this account.
        // The server preserved the AWAITING_PASSWORD session so the merchant
        // can still use their password — stay on the password step.
        setErrorMsg(
          body.message ??
            "OTP login is not available for this account/session. Continue with Password.",
        );
      } else {
        setErrorMsg(
          body.message ??
            "Could not request OTP from Pine Labs ONE. Please try again or use your password.",
        );
      }
    } catch {
      setErrorMsg("Could not reach the server. Please try again.");
    } finally {
      setRequestingOtp(false);
    }
  }

  // ── Step 2c: resend OTP (click resend button on the portal's OTP page) ────────
  async function handleResendOtp() {
    // Guard against concurrent submits: the ref is checked synchronously
    // (before any React re-render) so a fast double-tap cannot sneak in a
    // second call before the button re-renders to disabled.
    if (resendingRef.current || resendCooldown > 0 || resending) return;
    resendingRef.current = true;
    startResendCooldown(otpSource === "portal_link" ? "portal_link" : "otp_first");
    // Start cooldown immediately to prevent double-click.
    setResending(true);
    setErrorMsg(null);
    try {
      const res = await portalFetch(
        "/api/merchant/portal-sessions/pinelabs_one/submit-step",
        { method: "POST", body: JSON.stringify({ loginMethod: "resend_otp" }) },
      );
      const body = await res.json().catch(() => ({}));
      qc.invalidateQueries({ queryKey: PORTAL_SESSIONS_QUERY_KEY });

      if (body.status === "AWAITING_OTP" && !body.errorCode) {
        // Resend succeeded — session preserved, new OTP on its way.
        toast.success("OTP resent. Check your registered mobile or email.");
      } else if (body.status === "AWAITING_OTP" && body.errorCode) {
        // Resend attempted but button not found or click failed (errorCode = RESEND_NOT_AVAILABLE etc.).
        // The existing OTP session is still alive; show the adapter's message.
        resetResendCooldown(); // re-enable button so merchant can retry
        setErrorMsg(
          body.message ??
            "Could not resend OTP. Your existing OTP may still be valid — " +
            "enter it below or start over.",
        );
      } else {
        resetResendCooldown();
        setErrorMsg(body.message ?? "Could not resend OTP. Please start over.");
      }
    } catch {
      resetResendCooldown();
      setErrorMsg("Could not reach the server. Please try again.");
    } finally {
      resendingRef.current = false;
      setResending(false);
    }
  }

  // ── Step 3: submit OTP (2FA) ────────────────────────────────────────────────
  async function handleSubmitOtp() {
    // Guard against concurrent submits: the ref is checked synchronously
    // (before any React re-render) so a fast double-tap cannot sneak in a
    // second call, and the state checks cover an Enter press racing an
    // in-flight resend or submit.
    if (submittingOtpRef.current || submitting || resending) return;
    submittingOtpRef.current = true;
    const otpVal = otp.trim().replace(/\s/g, "");
    if (!otpVal || otpVal.length < 4) {
      submittingOtpRef.current = false;
      setErrorMsg("Enter the OTP you received on your registered mobile.");
      return;
    }
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await portalFetch(
        "/api/merchant/portal-sessions/pinelabs_one/submit-step",
        { method: "POST", body: JSON.stringify({ otp: otpVal }) },
      );
      setOtp(""); // wipe immediately

      const body = await res.json().catch(() => ({}));
      qc.invalidateQueries({ queryKey: PORTAL_SESSIONS_QUERY_KEY });

      if (body.status === "CONNECTED") {
        setUiStep("connected");
        toast.success("Pine Labs ONE account connected. Syncing transactions…");
        setTimeout(() => handleSync(), 1500);
      } else if (body.status === "FAILED" && body.errorCode === "OTP_EXPIRED") {
        setUiStep("identifier");
        setErrorMsg("OTP expired. Please enter your registered email or mobile number again to start over.");
      } else {
        const msg = body.message ?? "OTP verification failed. Please check the OTP and try again.";
        setErrorMsg(msg);
        toast.error(msg);
      }
    } catch {
      setOtp("");
      setErrorMsg("Could not submit OTP. Please try again.");
    } finally {
      submittingOtpRef.current = false;
      setSubmitting(false);
    }
  }

  // ── Sync ────────────────────────────────────────────────────────────────────
  async function handleSync() {
    setSyncing(true);
    try {
      const res = await portalFetch("/api/merchant/portal-sessions/pinelabs_one/sync", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Sync failed.");
      } else {
        const n = body.synced ?? 0;
        toast.success(`Sync complete — ${n} new transaction${n === 1 ? "" : "s"} fetched.`);
        qc.invalidateQueries({ queryKey: ["merchant", "portal-transactions", "pinelabs_one"] });
        qc.invalidateQueries({ queryKey: PORTAL_SESSIONS_QUERY_KEY });
      }
    } catch {
      toast.error("Sync failed. Please try again.");
    } finally {
      setSyncing(false);
    }
  }

  // ── Disconnect ──────────────────────────────────────────────────────────────
  async function handleDisconnect() {
    try {
      const res = await portalFetch("/api/merchant/portal-sessions/pinelabs_one/disconnect", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? "Disconnect failed.");
      } else {
        toast.success("Pine Labs ONE account disconnected.");
        setUiStep("identifier");
        setErrorMsg(null);
        qc.invalidateQueries({ queryKey: PORTAL_SESSIONS_QUERY_KEY });
        qc.invalidateQueries({ queryKey: ["merchant", "portal-transactions", "pinelabs_one"] });
      }
    } catch {
      toast.error("Disconnect failed. Please try again.");
    }
  }

  // ── Reconnect ───────────────────────────────────────────────────────────────
  async function handleReconnect() {
    setInitiating(true);
    setErrorMsg(null);
    try {
      const res = await portalFetch("/api/merchant/portal-sessions/pinelabs_one/reconnect", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      qc.invalidateQueries({ queryKey: PORTAL_SESSIONS_QUERY_KEY });

      if (body.status === "CONNECTED") {
        setUiStep("connected");
        toast.success("Session reconnected successfully.");
      } else if (body.status === "AWAITING_OTP") {
        setUiStep("otp");
        toast.info("A new OTP is required. Enter it below.");
      } else if (body.status === "AWAITING_PASSWORD") {
        setUiStep("password");
        toast.info(body.message ?? "Re-enter your Pine Labs ONE account password.");
      } else {
        setUiStep("identifier");
        setErrorMsg(body.message ?? "Session expired. Please enter your credentials again.");
      }
    } catch {
      setUiStep("identifier");
      setErrorMsg("Could not reconnect. Please enter your credentials again.");
    } finally {
      setInitiating(false);
    }
  }

  return (
    <Card className="border-border/60 bg-card">
      <CardHeader className="pb-2">
        <div className="flex items-start gap-3">
          <div className="w-14 h-14 rounded-xl bg-background border border-border/60 flex items-center justify-center shrink-0">
            <ProviderIcon slug="pinelabs_one" />
          </div>
          <div className="flex-1 min-w-0">
            <CardTitle className="text-base truncate">{providerName}</CardTitle>
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              <Badge variant="outline" className={`text-xs ${cmeta.color}`}>
                {cmeta.label}
              </Badge>
              {isConnected && (
                <Badge variant="outline" className="text-xs border-emerald-500/40 text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Connected
                </Badge>
              )}
              {uiStep === "password" && (
                <Badge variant="outline" className="text-xs border-sky-500/40 text-sky-400 flex items-center gap-1">
                  <Lock className="w-3 h-3" /> Enter Password
                </Badge>
              )}
              {uiStep === "otp" && (
                <Badge variant="outline" className="text-xs border-amber-500/40 text-amber-400 flex items-center gap-1">
                  <Clock className="w-3 h-3" /> Enter OTP
                </Badge>
              )}
              {uiStep === "blocked" && (
                <Badge variant="outline" className="text-xs border-red-500/40 text-red-400 flex items-center gap-1">
                  <XCircle className="w-3 h-3" /> Blocked
                </Badge>
              )}
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground leading-relaxed">
          {PROVIDER_DESC["pinelabs_one"]}
        </p>

        {/* ── Security note ─────────────────────────────────────────────── */}
        <div className="flex items-start gap-1.5 p-2.5 rounded-lg bg-muted/20 border border-border/40">
          <Lock className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
          <p className="text-xs text-muted-foreground leading-relaxed">
            Your credentials are AES-256 encrypted on the server before use.
            Passwords are never stored, logged, or replayed — they are used once to authenticate
            your browser session, then discarded.
          </p>
        </div>

        {/* ── CONNECTED state ───────────────────────────────────────────── */}
        {isConnected && (
          <div className="space-y-3">
            <div className="p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20 space-y-1">
              <p className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" /> Account Connected
              </p>
              <p className="text-xs text-muted-foreground">
                {session?.connectedAt
                  ? `Connected on ${new Date(session.connectedAt).toLocaleDateString("en-IN")}`
                  : "Your Pine Labs ONE account is connected."}
              </p>
            </div>

            {txData && txData.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Recent transactions</p>
                {txData.map(tx => (
                  <div
                    key={tx.id}
                    className="flex items-center justify-between text-xs py-1 border-b border-border/30 last:border-0"
                  >
                    <span className="text-muted-foreground font-mono truncate max-w-[120px]">
                      {tx.externalId}
                    </span>
                    <span className="font-medium tabular-nums">
                      ₹{((tx.amount ?? 0) / 100).toLocaleString("en-IN", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </span>
                    <span className={`capitalize font-medium ${
                      tx.normalizedStatus === "SUCCESS" ? "text-emerald-400"
                      : tx.normalizedStatus === "FAILED" ? "text-red-400"
                      : "text-amber-400"
                    }`}>
                      {tx.normalizedStatus?.toLowerCase() ?? "unknown"}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {txData && txData.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-2">
                No transactions yet. Click "Sync Now" to fetch the last 30 days.
              </p>
            )}

            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="flex-1 gap-1.5"
                onClick={handleSync}
                disabled={syncing}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
                {syncing ? "Syncing…" : "Sync Now"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="gap-1.5 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                onClick={handleDisconnect}
              >
                <Unlink className="w-3.5 h-3.5" />
                Disconnect
              </Button>
            </div>
          </div>
        )}

        {/* ── AWAITING_PASSWORD state ───────────────────────────────────── */}
        {uiStep === "password" && (
          <div className="space-y-3">
            <div className="p-3 rounded-lg bg-sky-500/5 border border-sky-500/20">
              <p className="text-xs font-semibold text-sky-400 flex items-center gap-1.5 mb-1">
                <Lock className="w-3.5 h-3.5" /> Password Required
              </p>
              <p className="text-xs text-muted-foreground">
                Enter your Pine Labs ONE account password, or use Pine Labs ONE's built-in
                OTP login if your account supports it.
                Credentials are AES-256 encrypted in transit and never stored or logged.
              </p>
            </div>

            {errorMsg && (
              <div className="p-2.5 rounded-lg bg-red-500/5 border border-red-500/20">
                <p className="text-xs text-red-400 flex items-start gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  {errorMsg}
                </p>
              </div>
            )}

            <div>
              <label className="text-xs text-muted-foreground block mb-1">
                Pine Labs ONE Account Password
              </label>
              <Input
                className="h-8 text-sm"
                placeholder="Your Pine Labs ONE password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSubmitPassword()}
                autoFocus
              />
            </div>

            <p className="text-xs text-muted-foreground">
              Your password is used once to authenticate your browser session, then immediately discarded.
            </p>

            {/* Primary action: password submit */}
            <Button
              size="sm"
              className="w-full gap-1.5"
              onClick={handleSubmitPassword}
              disabled={submitting || requestingOtp || !password.trim()}
            >
              {submitting ? (
                <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Connecting…</>
              ) : (
                <><CheckCircle2 className="w-3.5 h-3.5" /> Continue with Password</>
              )}
            </Button>

            {/* Divider */}
            <div className="flex items-center gap-2">
              <div className="flex-1 h-px bg-border/40" />
              <span className="text-xs text-muted-foreground">or</span>
              <div className="flex-1 h-px bg-border/40" />
            </div>

            {/* Secondary action: portal-native OTP login */}
            <Button
              size="sm"
              variant="outline"
              className="w-full gap-1.5"
              onClick={handleRequestOtpLogin}
              disabled={submitting || requestingOtp}
            >
              {requestingOtp ? (
                <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Requesting OTP…</>
              ) : (
                <><Clock className="w-3.5 h-3.5" /> Login with OTP</>
              )}
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              Uses Pine Labs ONE's own OTP delivery — RasoKart never generates or sends the OTP.
            </p>

            <Button
              size="sm"
              variant="ghost"
              className="w-full text-muted-foreground"
              onClick={() => { setUiStep("identifier"); setPassword(""); setErrorMsg(null); }}
            >
              Start Over
            </Button>
          </div>
        )}

        {/* ── AWAITING_OTP state: OTP entry (2FA or portal-native OTP) ────── */}
        {uiStep === "otp" && (
          <div className="space-y-3">
            <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
              <p className="text-xs font-semibold text-amber-400 flex items-center gap-1.5 mb-1">
                <Clock className="w-3.5 h-3.5" /> OTP Sent
              </p>
              <p className="text-xs text-muted-foreground">
                {otpSource === "portal_link"
                  ? "Pine Labs ONE has sent an OTP to your registered mobile or email. Enter it below — it is used once and immediately discarded by RasoKart."
                  : "An OTP has been sent to your Pine Labs ONE registered mobile or email. Enter it below to complete 2-step verification."}
              </p>
            </div>

            {errorMsg && (
              <div className="p-2.5 rounded-lg bg-red-500/5 border border-red-500/20">
                <p className="text-xs text-red-400 flex items-start gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  {errorMsg}
                </p>
              </div>
            )}

            <div>
              <label className="text-xs text-muted-foreground block mb-1">OTP</label>
              <Input
                className="h-8 text-sm font-mono tracking-widest"
                placeholder="••••••"
                type="password"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={8}
                value={otp}
                onChange={e => setOtp(e.target.value.replace(/\D/g, ""))}
                onKeyDown={e => e.key === "Enter" && handleSubmitOtp()}
                autoFocus
              />
            </div>

            <p className="text-xs text-muted-foreground">
              OTP is used once and discarded immediately — never stored.
            </p>

            {/* Primary: verify OTP */}
            <Button
              size="sm"
              className="w-full gap-1.5"
              onClick={handleSubmitOtp}
              disabled={submitting || resending || !otp.trim()}
            >
              {submitting ? (
                <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Verifying…</>
              ) : (
                <><CheckCircle2 className="w-3.5 h-3.5" /> Verify OTP</>
              )}
            </Button>

            {/* Resend OTP — for portal-link and OTP-first sessions (the live
                portal's OTP page has a resend control in both cases; only the
                post-password 2FA path lacks one) */}
            {(otpSource === "portal_link" || otpSource === "otp_first") && (
              <Button
                size="sm"
                variant="outline"
                className="w-full gap-1.5"
                onClick={handleResendOtp}
                disabled={submitting || resending || resendCooldown > 0}
              >
                <RefreshCw className={`w-3.5 h-3.5${resending ? " animate-spin" : ""}`} />
                {resending
                  ? "Resending…"
                  : resendCooldown > 0
                    ? `Resend OTP (${resendCooldown}s)`
                    : "Resend OTP"}
              </Button>
            )}

            {/*
              "Back to Password" is intentionally absent:
              after a portal_otp switch the server session is AWAITING_OTP with OTP-session
              cookies in the portal browser context — the server cannot revert to a
              password session without a full re-initiation. "Start Over" below performs
              the correct action (re-enter identifier).
            */}

            <Button
              size="sm"
              variant="ghost"
              className="w-full text-muted-foreground"
              onClick={() => {
                setUiStep("identifier");
                setOtp("");
                setErrorMsg(null);
                setOtpSource("2fa");
                resetResendCooldown();
              }}
            >
              Start Over
            </Button>
          </div>
        )}

        {/* ── RECONNECT_REQUIRED state ──────────────────────────────────── */}
        {uiStep === "reconnect_needed" && (
          <div className="space-y-3">
            <div className="p-2.5 rounded-lg bg-amber-500/5 border border-amber-500/20 flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-medium text-amber-400">Session Expired</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Your Pine Labs ONE session has expired. Click Reconnect to try restoring it,
                  or enter your mobile number to re-authenticate.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" className="flex-1" onClick={handleReconnect} disabled={initiating}>
                {initiating ? (
                  <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Reconnecting…</>
                ) : "Reconnect"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setUiStep("identifier"); setErrorMsg(null); }}>
                New Login
              </Button>
            </div>
          </div>
        )}

        {/* ── BLOCKED state ─────────────────────────────────────────────── */}
        {uiStep === "blocked" && (
          <div className="space-y-3">
            <div className="p-2.5 rounded-lg bg-red-500/5 border border-red-500/20 flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-red-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-medium text-red-400">Account Blocked</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {session?.lastStatusMessage ??
                    "Your Pine Labs ONE account appears to be blocked. Please contact Pine Labs support."}
                </p>
              </div>
            </div>
            <Button size="sm" variant="outline" className="w-full" asChild>
              <a href="https://one.pinelabs.com" target="_blank" rel="noopener noreferrer">
                Contact Pine Labs Support <ExternalLink className="w-3 h-3 ml-1" />
              </a>
            </Button>
          </div>
        )}

        {/* ── IDENTIFIER entry state (initial / disconnected / failed) ──── */}
        {uiStep === "identifier" && (
          <div className="space-y-3">
            {errorMsg && (
              <div className="p-2.5 rounded-lg bg-red-500/5 border border-red-500/20">
                <p className="text-xs text-red-400 flex items-start gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  {errorMsg}
                </p>
              </div>
            )}

            {session?.status === "FAILED" && session.lastStatusMessage && !errorMsg && (
              <div className="p-2.5 rounded-lg bg-red-500/5 border border-red-500/20">
                <p className="text-xs text-red-400 flex items-start gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  {session.lastStatusMessage}
                </p>
              </div>
            )}

            <div>
              <label className="text-xs text-muted-foreground block mb-1">
                Registered Email ID or Mobile Number
              </label>
              <Input
                className="h-8 text-sm"
                placeholder="Email ID or 10-digit mobile registered with Pine Labs ONE"
                type="text"
                autoComplete="email"
                value={identifier}
                onChange={e => setIdentifier(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleInitiate()}
              />
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              Enter the email address or mobile number registered with your Pine Labs ONE
              merchant account. An OTP will be sent to whichever you enter.
              Visit{" "}
              <a
                href="https://one.pinelabs.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline-offset-2 hover:underline"
              >
                one.pinelabs.com
              </a>{" "}
              to verify your registered details if needed.
            </p>

            <Button
              size="sm"
              className="w-full gap-1.5"
              onClick={handleInitiate}
              disabled={initiating || !identifier.trim()}
            >
              {initiating ? (
                <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Connecting…</>
              ) : (
                <><Link2 className="w-3.5 h-3.5" /> Connect Pine Labs ONE</>
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
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
            Direct merchant login connection is not supported for this provider due to banking regulatory restrictions or product deprecation.
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

  // Filtered provider list for search (platform-managed gateways from DB)
  const searchLower = search.toLowerCase();
  const filtered = providers.filter(p => {
    if (!search) return true;
    const name = (PROVIDER_WHITE_LABEL[p.slug] ?? p.name).toLowerCase();
    return name.includes(searchLower) || p.slug.includes(searchLower);
  });

  // ── Category D / E / A come from the enrollments list, not the DB providers
  // list. The /api/merchant/enrollments endpoint returns ALL providers that have
  // onboarding metadata (phonepe, paytm, pinelabs, ekqr, etc.) regardless of
  // whether they have a row in the providers table, so this is the authoritative
  // source for self-service enrollment cards.
  const categoryD = (enrollments ?? []).filter(e => {
    if (e.onboardingInfo?.category !== "D") return false;
    if (!search) return true;
    const name = (PROVIDER_WHITE_LABEL[e.providerSlug] ?? e.providerSlug).toLowerCase();
    return name.includes(searchLower) || e.providerSlug.includes(searchLower);
  });
  const categoryE = (enrollments ?? []).filter(e => {
    if (e.onboardingInfo?.category !== "E") return false;
    if (!search) return true;
    const name = (PROVIDER_WHITE_LABEL[e.providerSlug] ?? e.providerSlug).toLowerCase();
    return name.includes(searchLower) || e.providerSlug.includes(searchLower);
  });
  const categoryA = (enrollments ?? []).filter(e => {
    if (!search) return e.onboardingInfo?.category === "A" || e.providerSlug === "ekqr";
    const matchesCat = e.onboardingInfo?.category === "A" || e.providerSlug === "ekqr";
    const name = (PROVIDER_WHITE_LABEL[e.providerSlug] ?? e.providerSlug).toLowerCase();
    return matchesCat && (name.includes(searchLower) || e.providerSlug.includes(searchLower));
  });

  // Platform-managed gateways (admin-activated: Cashfree, PayU, Razorpay, Pine Labs, …)
  // Exclude slugs that are rendered via the enrollment card path above.
  const knownEnrollmentSlugs = new Set([
    "phonepe", "paytm", "bharatpe", "freecharge", "amazon_pay", "mobikwik",
    "sbi_yono", "hdfc_smarthub", "icici_eazypay", "axis_pay", "kotak_smart", "ekqr",
    "pinelabs",
    // pinelabs_one uses PineLabsOnePortalCard (portal_session_connector).
    // Kept here as a defence-in-depth guard so it can NEVER fall through to the
    // generic EnrollmentCard / API-credential form, regardless of what the
    // enrollments API returns for this slug.
    "pinelabs_one",
  ]);
  // Exclude portal providers — they render in a dedicated section below
  const platformProviders = filtered.filter(
    p => !knownEnrollmentSlugs.has(p.slug) && !PORTAL_PROVIDER_SLUGS.has(p.slug),
  );

  // Portal providers: show from the providers table for known portal slugs
  const portalProviders = providers.filter(p => PORTAL_PROVIDER_SLUGS.has(p.slug));

  // Portal session hook — loads merchant's own sessions
  const { data: portalSessions } = usePortalSessions();
  const portalSessionMap = new Map<string, MerchantPortalSession>(
    (portalSessions ?? []).map(s => [s.providerSlug, s]),
  );

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
                {categoryA.map(e => (
                  <EkqrCard
                    key={e.providerSlug}
                    provider={{ id: 0, slug: e.providerSlug, name: e.providerSlug, category: "A", description: "", status: "sandbox" }}
                    connections={connections ?? null}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Provider Account Connect (Portal Automation) */}
          {portalProviders.length > 0 && (
            <div className="space-y-3">
              <div>
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                  <Key className="w-3.5 h-3.5" /> Provider Account Connect
                </h2>
                <p className="text-xs text-muted-foreground mt-1">
                  Connect your existing provider accounts to sync transaction history and monitor settlement status.
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {portalProviders.map(p =>
                  p.slug === "razorpay" ? (
                    <RazorpayPortalCard
                      key={p.slug}
                      provider={p}
                      session={portalSessionMap.get(p.slug) ?? null}
                    />
                  ) : p.slug === "paytm_merchant" ? (
                    <PaytmPortalCard
                      key={p.slug}
                      provider={p}
                      session={portalSessionMap.get(p.slug) ?? null}
                    />
                  ) : p.slug === "pinelabs_one" ? (
                    <PineLabsOnePortalCard
                      key={p.slug}
                      provider={p}
                      session={portalSessionMap.get(p.slug) ?? null}
                    />
                  ) : (
                    <PortalProviderCard
                      key={p.slug}
                      provider={p}
                      session={portalSessionMap.get(p.slug) ?? null}
                    />
                  )
                )}
              </div>
            </div>
          )}

          {/* Category D — Self-service enrollment */}
          {categoryD.length > 0 && (
            <div className="space-y-3">
              <div>
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                  Self-Service Provider Connection
                </h2>
                <p className="text-xs text-muted-foreground mt-1">
                  Connect an existing account by submitting API credentials, or apply for a new merchant account at the provider's portal.
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {categoryD.map(e => (
                  <EnrollmentCard
                    key={e.providerSlug}
                    provider={{ id: 0, slug: e.providerSlug, name: e.providerSlug, category: "D", description: "", status: "sandbox" }}
                    enrollment={e}
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
                {categoryE.map(e => (
                  <UnsupportedCard key={e.providerSlug} provider={{ id: 0, slug: e.providerSlug, name: e.providerSlug, category: "E", description: "", status: "sandbox" }} />
                ))}
              </div>
            </div>
          )}

          {filtered.length === 0 && categoryD.length === 0 && categoryE.length === 0 && (
            <div className="text-center py-16 text-muted-foreground">
              <p className="text-sm">No providers match your search</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Missing icon import used in renderExistingInfo ────────────────────────────
function Smartphone({ className }: { className?: string }) {
  return <span className={`inline-block ${className ?? ""}`}>📱</span>;
}

function useEnrollmentHistory(providerSlug: string | null) {
  return useQuery<HistoryEntry[]>({
    queryKey: ["merchant", "enrollment-history", providerSlug],
    queryFn: async () => {
      const res = await enrollFetch(`/api/merchant/enrollments/${providerSlug}/history`);
      if (!res.ok) throw new Error(`Failed to fetch history: ${res.status}`);
      return res.json();
    },
    enabled: !!providerSlug,
    staleTime: 15_000,
  });
}

function formatHistoryTs(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
}

const STATUS_DOT_COLOR: Record<string, string> = {
  active:                "bg-emerald-400",
  credentials_submitted: "bg-sky-400",
  pending_kyc:           "bg-amber-400",
  suspended:             "bg-rose-400",
  disconnected:          "bg-muted-foreground",
  not_enrolled:          "bg-muted-foreground",
};

const STATUS_LABEL: Record<string, string> = {
  not_enrolled:          "Not Connected",
  pending_kyc:           "Pending KYC",
  credentials_submitted: "Under Review",
  active:                "Connected",
  suspended:             "Suspended",
  disconnected:          "Disconnected",
};

const ACTION_LABEL: Record<string, { label: string; isAdmin: boolean }> = {
  admin_enrollment_status_change:           { label: "Status changed by admin",       isAdmin: true  },
  merchant_enrollment_credentials_submitted:{ label: "Credentials submitted",          isAdmin: false },
  merchant_enrollment_initiated:            { label: "Enrollment started",             isAdmin: false },
  merchant_enrollment_disconnected:         { label: "Disconnected",                   isAdmin: false },
};

function EnrollmentHistoryDialog({
  providerSlug,
  providerName,
  open,
  onClose,
}: {
  providerSlug: string | null;
  providerName: string;
  open: boolean;
  onClose: () => void;
}) {
  const { data: history, isLoading, isError } = useEnrollmentHistory(open ? providerSlug : null);

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="w-4 h-4 text-muted-foreground" />
            Enrollment History — {providerName}
          </DialogTitle>
          <DialogDescription>
            Timeline of all status changes and actions for this provider enrollment
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="space-y-3 py-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex gap-3 animate-pulse">
                <div className="w-2 h-2 rounded-full bg-muted mt-1.5 shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 bg-muted rounded w-3/4" />
                  <div className="h-2.5 bg-muted rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        )}

        {isError && (
          <div className="py-6 text-center">
            <p className="text-sm text-muted-foreground">Failed to load history. Please try again.</p>
          </div>
        )}

        {!isLoading && !isError && history && history.length === 0 && (
          <div className="py-8 text-center">
            <History className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No enrollment activity recorded yet.</p>
          </div>
        )}

        {!isLoading && !isError && history && history.length > 0 && (
          <div className="relative py-2">
            {/* Vertical line */}
            <div className="absolute left-[5px] top-3 bottom-3 w-px bg-border/60" />

            <div className="space-y-5">
              {history.map((entry, idx) => {
                const meta = ACTION_LABEL[entry.action] ?? { label: entry.action, isAdmin: false };
                const dotColor = STATUS_DOT_COLOR[entry.newStatus ?? ""] ?? "bg-muted-foreground";
                return (
                  <div key={entry.id} className="flex gap-4 pl-1">
                    {/* Timeline dot */}
                    <div className={`w-2.5 h-2.5 rounded-full ${idx === 0 ? dotColor : "bg-muted-foreground/40"} mt-1 shrink-0 relative z-10`} />

                    <div className="flex-1 min-w-0 space-y-1">
                      {/* Event label */}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-medium text-foreground">{meta.label}</span>
                        {entry.newStatus && (
                          <Badge
                            variant="outline"
                            className={`text-xs ${ENROLLMENT_BADGE[entry.newStatus]?.color ?? "bg-muted text-muted-foreground border-border"}`}
                          >
                            {STATUS_LABEL[entry.newStatus] ?? entry.newStatus}
                          </Badge>
                        )}
                      </div>

                      {/* Status transition */}
                      {entry.previousStatus && entry.newStatus && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <span>{STATUS_LABEL[entry.previousStatus] ?? entry.previousStatus}</span>
                          <ArrowRight className="w-3 h-3 shrink-0" />
                          <span>{STATUS_LABEL[entry.newStatus] ?? entry.newStatus}</span>
                        </div>
                      )}

                      {/* Reason */}
                      {entry.reason && (
                        <p className="text-xs text-muted-foreground italic">"{entry.reason}"</p>
                      )}

                      {/* Fields submitted (for credential updates) */}
                      {entry.fieldsSubmitted && entry.fieldsSubmitted.length > 0 && (
                        <p className="text-xs text-muted-foreground">
                          Updated: {entry.fieldsSubmitted.join(", ")}
                        </p>
                      )}

                      {/* Actor & timestamp */}
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground/70">
                        {meta.isAdmin
                          ? <UserCog className="w-3 h-3 shrink-0" />
                          : <User className="w-3 h-3 shrink-0" />
                        }
                        <span className="truncate">{entry.actorEmail}</span>
                        <span>·</span>
                        <span className="shrink-0">{formatHistoryTs(entry.createdAt)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
