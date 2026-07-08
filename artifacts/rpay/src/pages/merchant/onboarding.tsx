import { useState, useEffect, useRef } from "react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  CheckCircle2, Loader2, ShieldCheck, Smartphone,
  FileCheck, CreditCard, Building2, ClipboardCheck,
  ChevronRight, AlertTriangle, Info, Lock, XCircle,
} from "lucide-react";

declare global {
  interface Window {
    CfSecureId: new (config: { session_id: string; mode: string }) => {
      on: (event: string, handler: (data: any) => void) => void;
      open: () => void;
    };
  }
}

type StepId = "mobile" | "consent" | "pan" | "aadhaar" | "bank" | "optional" | "review";

interface StepDef { id: StepId; label: string; icon: React.ComponentType<{ className?: string }>; mandatory: boolean }

const STEPS: StepDef[] = [
  { id: "mobile",   label: "Mobile",     icon: Smartphone,      mandatory: true },
  { id: "consent",  label: "Consent",    icon: Lock,            mandatory: true },
  { id: "pan",      label: "PAN",        icon: FileCheck,       mandatory: true },
  { id: "aadhaar",  label: "Aadhaar",    icon: ShieldCheck,     mandatory: true },
  { id: "bank",     label: "Bank",       icon: CreditCard,      mandatory: true },
  { id: "optional", label: "Optional",   icon: Building2,       mandatory: false },
  { id: "review",   label: "Submit",     icon: ClipboardCheck,  mandatory: true },
];

interface Session { verificationId: string; sessionToken: string; dataAvailable: boolean; mode: string }

interface KycState {
  fullName?: string;
  panMasked?: string;
  aadhaarLast4?: string;
  aadhaarStatus?: string;
  businessName?: string;
  city?: string;
  state?: string;
  stateName?: string;
  panStatus?: string;
  bankStatus?: string;
  gstinMasked?: string;
}

function VerifyBadge({ status }: { status?: string }) {
  if (!status || status === "PENDING") return <Badge variant="secondary" className="text-xs">Pending</Badge>;
  if (status === "VERIFIED") return <Badge className="bg-emerald-600 text-white text-xs">Verified ✓</Badge>;
  if (status === "SKIPPED") return <Badge variant="outline" className="text-xs text-neutral-400">Skipped</Badge>;
  return <Badge className="bg-red-600 text-white text-xs">Failed</Badge>;
}

function MandatoryTag() {
  return <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-red-400 border border-red-700 rounded px-1">Required</span>;
}

function OptionalTag() {
  return <span className="ml-1.5 text-[10px] font-medium text-neutral-400 border border-neutral-700 rounded px-1">Optional</span>;
}

function StepBar({ current }: { current: number }) {
  return (
    <div className="flex items-start justify-between overflow-x-auto gap-0.5 pb-1">
      {STEPS.map((step, i) => {
        const Icon = step.icon;
        const done = i < current;
        const active = i === current;
        return (
          <div key={step.id} className="flex items-center flex-shrink-0">
            <div className="flex flex-col items-center gap-1 min-w-[52px]">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 transition-all ${
                done   ? "bg-emerald-600 border-emerald-600 text-white" :
                active ? "bg-indigo-600 border-indigo-600 text-white" :
                         "bg-neutral-800 border-neutral-700 text-neutral-500"
              }`}>
                {done ? <CheckCircle2 className="w-4 h-4" /> : <Icon className="w-3.5 h-3.5" />}
              </div>
              <span className={`text-[9px] font-medium text-center leading-tight ${
                active ? "text-white" : done ? "text-emerald-400" : "text-neutral-600"
              }`}>{step.label}{step.mandatory ? "" : " ★"}</span>
            </div>
            {i < STEPS.length - 1 && (
              <ChevronRight className={`w-3.5 h-3.5 mx-0.5 flex-shrink-0 ${i < current ? "text-emerald-500" : "text-neutral-700"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function MerchantOnboarding() {
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [onboardingEnabled, setOnboardingEnabled] = useState(false);
  const [submitResult, setSubmitResult] = useState<"SUBMITTED" | "APPROVED" | "REJECTED" | "RE_UPLOAD_REQUIRED" | null>(null);
  const [rejectionReason, setRejectionReason] = useState<string | null>(null);

  // Session
  const [mobile, setMobile] = useState("");
  const [session, setSession] = useState<Session | null>(null);

  // KYC state (pulled from server + updated by verify calls)
  const [kycState, setKycState] = useState<KycState>({});
  const [verifyStatus, setVerifyStatus] = useState<Record<string, string>>({});

  // PAN step
  const [panInput, setPanInput] = useState("");
  const [panName, setPanName] = useState("");

  // Aadhaar step
  const [aadhaarLast4, setAadhaarLast4] = useState("");

  // Bank step
  const [bankAccount, setBankAccount] = useState("");
  const [bankIfsc, setBankIfsc] = useState("");
  const [bankHolder, setBankHolder] = useState("");

  // Optional step
  const [gstinInput, setGstinInput] = useState("");
  const [cinInput, setCinInput] = useState("");
  const [udyamInput, setUdyamInput] = useState("");
  const [businessName, setBusinessName] = useState("");

  const sdkContainerRef = useRef<HTMLDivElement>(null);
  const auth = () => `Bearer ${localStorage.getItem("rasokart_token")}`;

  // Load status on mount
  useEffect(() => {
    fetch("/api/onboarding/status", { headers: { Authorization: auth() } })
      .then((r) => r.json())
      .then((data) => {
        setOnboardingEnabled(data.onboardingEnabled ?? false);
        if (data.session) {
          const s = data.session;
          const terminal = ["SUBMITTED", "APPROVED", "REJECTED", "RE_UPLOAD_REQUIRED"];
          if (terminal.includes(s.status)) {
            setSubmitResult(s.status as any);
            setStep(6);
          } else if (s.status === "KYC_PENDING") {
            setStep(2); // jump to PAN step
          }
          // Try to restore verificationId from session for in-progress state
          if (s.verificationId && !terminal.includes(s.status)) {
            setSession({ verificationId: s.verificationId, sessionToken: "", dataAvailable: s.dataAvailable ?? false, mode: "sandbox" });
          }
        }
        if (data.kyc) {
          const k = data.kyc;
          setKycState({
            fullName: k.fullName, panMasked: k.panMasked,
            aadhaarLast4: k.aadhaarLast4, aadhaarStatus: k.aadhaarStatus,
            businessName: k.businessName, city: k.city, stateName: k.stateName,
          } as any);
          setVerifyStatus({
            panStatus: k.panStatus ?? "PENDING",
            aadhaarStatus: k.aadhaarStatus ?? "PENDING",
            bankStatus: k.bankStatus ?? "PENDING",
            gstStatus: k.gstStatus ?? "SKIPPED",
            cinStatus: k.cinStatus ?? "SKIPPED",
            udyamStatus: k.udyamStatus ?? "SKIPPED",
          });
          if (k.fullName) { setPanName(k.fullName); setBankHolder(k.fullName); }
          if (k.businessName) setBusinessName(k.businessName);
          if (data.kyc.rejectionReason) setRejectionReason(data.kyc.rejectionReason);
        }
      })
      .catch(() => {})
      .finally(() => setPageLoading(false));
  }, []);

  async function apiPost(path: string, body: object) {
    const r = await fetch(`/api/onboarding/${path}`, {
      method: "POST",
      headers: { Authorization: auth(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error ?? "Request failed");
    return data;
  }

  // Step 0 — initiate
  async function handleInitiate() {
    setError(null);
    const digits = mobile.replace(/\D/g, "");
    if (digits.length !== 10) { setError("Enter a valid 10-digit mobile number"); return; }
    setLoading(true);
    try {
      const data = await apiPost("initiate", { mobile: digits });
      setSession(data);
      setStep(1);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }

  // Step 1 — SDK consent
  function launchSdk() {
    if (!session?.sessionToken) { setError("Session token missing. Please restart."); return; }
    setError(null);
    const open = () => {
      try {
        const sdk = new window.CfSecureId({ session_id: session.sessionToken, mode: session.mode });
        sdk.on("success", async (sdkData: any) => {
          const authCode: string = sdkData?.auth_code ?? sdkData?.code;
          if (!authCode) { setError("Consent incomplete — no auth code received."); return; }
          setLoading(true);
          try {
            const cData = await apiPost("consent", { verificationId: session.verificationId, authCode });
            const k = cData.kycData ?? {};
            setKycState((prev) => ({ ...prev, fullName: k.fullName, panMasked: k.panMasked, aadhaarLast4: k.aadhaarLast4, aadhaarStatus: k.aadhaarStatus }));
            if (k.fullName) { setPanName(k.fullName); setBankHolder(k.fullName); }
            if (k.aadhaarStatus === "VERIFIED") setVerifyStatus((p) => ({ ...p, aadhaarStatus: "VERIFIED" }));
            toast.success("Secure consent completed!");
            setStep(2);
          } catch (e: any) { setError(e.message); }
          finally { setLoading(false); }
        });
        sdk.on("failure", async (err: any) => {
          await apiPost("consent-denied", { verificationId: session.verificationId }).catch(() => {});
          setError(err?.message ?? "Consent was denied or failed. You can skip and fill details manually.");
        });
        sdk.open();
      } catch { setError("Could not launch secure consent. Please try again."); }
    };
    if (window.CfSecureId) { open(); return; }
    const script = document.createElement("script");
    script.src = "https://sdk.cashfree.com/js/secureid/latest/secureid.js";
    script.onload = open;
    script.onerror = () => setError("Secure consent failed to load. Check your network and retry.");
    document.body.appendChild(script);
  }

  async function handleVerify(type: string, extra: Record<string, string> = {}) {
    if (!session?.verificationId) { setError("No active session. Please restart."); return; }
    setError(null);
    setLoading(true);
    try {
      const data = await apiPost("verify", { type, verificationId: session.verificationId, ...extra });
      setVerifyStatus((p) => ({ ...p, [`${type.toLowerCase()}Status`]: data.status }));
      if (data.status === "VERIFIED") toast.success(`${type} verified`);
      else if (data.status === "SKIPPED") toast.info(`${type} skipped`);
      else if (data.status === "PENDING") toast.info("Submitted for review");
      else toast.warning(`${type} verification ${data.status.toLowerCase()}`);
      return data.status as string;
    } catch (e: any) { setError(e.message); return undefined; }
    finally { setLoading(false); }
  }

  async function handleSubmit() {
    if (!session?.verificationId) return;
    setError(null);
    setLoading(true);
    try {
      await apiPost("submit", {
        verificationId: session.verificationId,
        businessName: businessName || undefined,
        gstin: gstinInput || undefined,
        cin: cinInput || undefined,
        udyamNumber: udyamInput || undefined,
      });
      toast.success("Application submitted for review!");
      setSubmitResult("SUBMITTED");
      setStep(6);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (pageLoading) return (
    <DashboardLayout>
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
      </div>
    </DashboardLayout>
  );

  if (!onboardingEnabled && step === 0) return (
    <DashboardLayout>
      <div className="max-w-2xl mx-auto p-6 space-y-4">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <ShieldCheck className="w-7 h-7 text-indigo-400" /> Secure Business Onboarding
        </h1>
        <Alert className="border-amber-700 bg-amber-950/30">
          <Info className="h-4 w-4 text-amber-400" />
          <AlertDescription className="text-amber-300 text-sm">
            Secure onboarding is currently unavailable. Please complete KYC via the{" "}
            <a href="/merchant/verification" className="underline text-amber-200">Verification</a> section, or contact support.
          </AlertDescription>
        </Alert>
      </div>
    </DashboardLayout>
  );

  const panVerified  = verifyStatus["panStatus"]    === "VERIFIED";
  const aadhaarVerified = verifyStatus["aadhaarStatus"] === "VERIFIED" || verifyStatus["aadhaarStatus"] === "PENDING";
  const bankVerified = verifyStatus["bankStatus"]   === "VERIFIED";
  const mandatoryMet = panVerified && aadhaarVerified && bankVerified;

  return (
    <DashboardLayout>
      <div className="max-w-2xl mx-auto space-y-5 p-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <ShieldCheck className="w-7 h-7 text-indigo-400" />
            Secure Business Onboarding
          </h1>
          <p className="text-neutral-400 text-sm mt-1">Complete identity verification to unlock your full account.</p>
        </div>

        <Card className="bg-neutral-900 border-neutral-800">
          <CardContent className="py-4 px-4">
            <StepBar current={step} />
            <p className="text-xs text-neutral-500 mt-2.5">★ = optional step &nbsp;·&nbsp; Steps 1–5 are required</p>
          </CardContent>
        </Card>

        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* ── Step 0 — Mobile ───────────────────────────────────────── */}
        {step === 0 && (
          <Card className="bg-neutral-900 border-neutral-800">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Smartphone className="w-5 h-5 text-indigo-400" />Verify Your Mobile
              </CardTitle>
              <CardDescription>We'll check if your mobile is linked to verified identity records.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>Mobile Number <MandatoryTag /></Label>
                <div className="flex gap-2">
                  <span className="flex items-center px-3 bg-neutral-800 border border-neutral-700 rounded-md text-neutral-400 text-sm">+91</span>
                  <Input type="tel" placeholder="9876543210" maxLength={10}
                    value={mobile} onChange={(e) => setMobile(e.target.value.replace(/\D/g, "").slice(0, 10))}
                    className="bg-neutral-800 border-neutral-700 text-white font-mono"
                  />
                </div>
                <p className="text-xs text-neutral-500">Enter the mobile number linked to your Aadhaar / PAN.</p>
              </div>
              <Button className="w-full bg-indigo-600 hover:bg-indigo-700" onClick={handleInitiate} disabled={loading || mobile.length < 10}>
                {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Checking…</> : "Continue →"}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* ── Step 1 — Consent ─────────────────────────────────────── */}
        {step === 1 && session && (
          <Card className="bg-neutral-900 border-neutral-800">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Lock className="w-5 h-5 text-indigo-400" />Secure Data Consent
              </CardTitle>
              <CardDescription>
                Authorise RasoKart to fetch your verified identity details (name, Aadhaar, PAN, address).
                Your data is encrypted and never shared.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {session.dataAvailable ? (
                <Alert className="border-emerald-700 bg-emerald-950/40">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  <AlertDescription className="text-emerald-300 text-sm">
                    Verified records found for this mobile — 1-click onboarding will auto-fill your details.
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert className="border-amber-700 bg-amber-950/40">
                  <Info className="h-4 w-4 text-amber-400" />
                  <AlertDescription className="text-amber-300 text-sm">
                    No pre-filled records found — you'll enter details manually in the next steps.
                  </AlertDescription>
                </Alert>
              )}
              <div className="rounded-lg border border-neutral-700 bg-neutral-800/50 p-4 space-y-1.5">
                <p className="text-xs font-medium text-neutral-300">Data accessed with your consent:</p>
                <ul className="text-xs text-neutral-400 space-y-0.5 list-disc list-inside">
                  <li>Name, date of birth, gender from Aadhaar</li>
                  <li>PAN number (masked — last 4 digits only)</li>
                  <li>Aadhaar-linked address</li>
                  <li>Business details (if available)</li>
                </ul>
              </div>
              <div ref={sdkContainerRef} id="secureid-container" />
              <Button className="w-full bg-indigo-600 hover:bg-indigo-700" onClick={launchSdk} disabled={loading}>
                {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Processing…</> : <><ShieldCheck className="w-4 h-4 mr-2" />Authorise Secure Access</>}
              </Button>
              <Button variant="ghost" className="w-full text-neutral-400 text-sm" onClick={() => setStep(2)}>
                Skip — I'll enter details manually
              </Button>
            </CardContent>
          </Card>
        )}

        {/* ── Step 2 — PAN ─────────────────────────────────────────── */}
        {step === 2 && (
          <Card className="bg-neutral-900 border-neutral-800">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <FileCheck className="w-5 h-5 text-indigo-400" />PAN Verification
                <MandatoryTag />
              </CardTitle>
              <CardDescription>
                Verify your Permanent Account Number (PAN). This is required for all merchants.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {panVerified && kycState.panMasked ? (
                <div className="flex items-center justify-between rounded-lg border border-emerald-700 bg-emerald-950/30 p-4">
                  <div>
                    <p className="text-xs text-emerald-400 font-medium">PAN Verified</p>
                    <p className="text-white font-mono text-sm mt-0.5">{kycState.panMasked}</p>
                    {kycState.fullName && <p className="text-neutral-400 text-xs mt-0.5">{kycState.fullName}</p>}
                  </div>
                  <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-sm">PAN Number</Label>
                      <Input value={panInput} onChange={(e) => setPanInput(e.target.value.toUpperCase())}
                        placeholder="ABCDE1234F" maxLength={10}
                        className="bg-neutral-800 border-neutral-700 text-white font-mono" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm">Name on PAN</Label>
                      <Input value={panName} onChange={(e) => setPanName(e.target.value)}
                        placeholder="Full name as on PAN"
                        className="bg-neutral-800 border-neutral-700 text-white" />
                    </div>
                  </div>
                  <Button className="w-full bg-indigo-600 hover:bg-indigo-700" disabled={loading || panInput.length !== 10 || !panName.trim()}
                    onClick={async () => {
                      const s = await handleVerify("PAN", { pan: panInput, name: panName });
                      if (s === "VERIFIED" || s === "MISMATCH") {
                        setKycState((p) => ({ ...p, panMasked: panInput.slice(0, 2) + "****" + panInput.slice(-2) }));
                      }
                    }}>
                    {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Verifying…</> : "Verify PAN"}
                  </Button>
                  {verifyStatus["panStatus"] === "FAILED" && (
                    <Alert variant="destructive" className="text-sm">
                      <XCircle className="h-4 w-4" />
                      <AlertDescription>PAN verification failed. Double-check the number and name, then retry.</AlertDescription>
                    </Alert>
                  )}
                  {verifyStatus["panStatus"] === "MISMATCH" && (
                    <Alert className="border-amber-700 bg-amber-950/30">
                      <AlertTriangle className="h-4 w-4 text-amber-400" />
                      <AlertDescription className="text-amber-300 text-sm">
                        PAN name mismatch — our team will review during the admin approval stage.
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              )}
              <Button className="w-full bg-emerald-700 hover:bg-emerald-600 mt-2" onClick={() => setStep(3)}
                disabled={!panVerified}>
                Continue to Aadhaar Verification →
              </Button>
              {!panVerified && (
                <p className="text-xs text-center text-neutral-500">PAN verification is required to continue.</p>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── Step 3 — Aadhaar ─────────────────────────────────────── */}
        {step === 3 && (
          <Card className="bg-neutral-900 border-neutral-800">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-indigo-400" />Aadhaar Verification
                <MandatoryTag />
              </CardTitle>
              <CardDescription>
                Confirm your Aadhaar-linked identity. We store only the last 4 digits — your full Aadhaar number is never saved.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Auto-verified via SDK */}
              {verifyStatus["aadhaarStatus"] === "VERIFIED" && kycState.aadhaarLast4 ? (
                <div className="flex items-center justify-between rounded-lg border border-emerald-700 bg-emerald-950/30 p-4">
                  <div>
                    <p className="text-xs text-emerald-400 font-medium">Aadhaar Verified via Secure Consent</p>
                    <p className="text-white font-mono text-sm mt-0.5">XXXX XXXX {kycState.aadhaarLast4}</p>
                    {kycState.fullName && <p className="text-neutral-400 text-xs mt-0.5">{kycState.fullName}</p>}
                  </div>
                  <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                </div>
              ) : (
                <div className="space-y-4">
                  <Alert className="border-indigo-700 bg-indigo-950/30">
                    <Info className="h-4 w-4 text-indigo-400" />
                    <AlertDescription className="text-indigo-300 text-sm">
                      Enter only the last 4 digits of your Aadhaar. Full Aadhaar is never stored.
                      Your document will be reviewed by our team.
                    </AlertDescription>
                  </Alert>
                  <div className="space-y-1.5">
                    <Label>Last 4 Digits of Aadhaar</Label>
                    <div className="flex gap-2 items-center">
                      <span className="text-neutral-500 font-mono text-sm">XXXX XXXX</span>
                      <Input value={aadhaarLast4} onChange={(e) => setAadhaarLast4(e.target.value.replace(/\D/g, "").slice(0, 4))}
                        placeholder="1234" maxLength={4}
                        className="bg-neutral-800 border-neutral-700 text-white font-mono w-24" />
                    </div>
                  </div>
                  <Button className="w-full bg-indigo-600 hover:bg-indigo-700" disabled={loading || aadhaarLast4.length !== 4}
                    onClick={() => handleVerify("AADHAAR", { aadhaarLast4Input: aadhaarLast4 })}>
                    {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Submitting…</> : "Submit Aadhaar Details"}
                  </Button>
                  {verifyStatus["aadhaarStatus"] === "PENDING" && (
                    <Alert className="border-amber-700 bg-amber-950/30">
                      <Info className="h-4 w-4 text-amber-400" />
                      <AlertDescription className="text-amber-300 text-sm">
                        Aadhaar details submitted. Our team will verify your document during review.
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              )}
              <Button className="w-full bg-emerald-700 hover:bg-emerald-600" onClick={() => setStep(4)}
                disabled={!aadhaarVerified}>
                Continue to Bank Verification →
              </Button>
              {!aadhaarVerified && (
                <p className="text-xs text-center text-neutral-500">Aadhaar confirmation is required to continue.</p>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── Step 4 — Bank ────────────────────────────────────────── */}
        {step === 4 && (
          <Card className="bg-neutral-900 border-neutral-800">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-indigo-400" />Bank Account Verification
                <MandatoryTag />
              </CardTitle>
              <CardDescription>
                Verify your settlement bank account. Payouts remain disabled until bank verification is approved.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {bankVerified ? (
                <div className="flex items-center justify-between rounded-lg border border-emerald-700 bg-emerald-950/30 p-4">
                  <div>
                    <p className="text-xs text-emerald-400 font-medium">Bank Account Verified</p>
                    <p className="text-white font-mono text-sm mt-0.5">{bankHolder && `${bankHolder} · `}{bankIfsc}</p>
                  </div>
                  <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label>Account Holder Name</Label>
                    <Input value={bankHolder} onChange={(e) => setBankHolder(e.target.value)}
                      placeholder="As per bank records"
                      className="bg-neutral-800 border-neutral-700 text-white" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Account Number</Label>
                    <Input value={bankAccount} onChange={(e) => setBankAccount(e.target.value.replace(/\D/g, ""))}
                      placeholder="Enter account number"
                      className="bg-neutral-800 border-neutral-700 text-white font-mono" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>IFSC Code</Label>
                    <Input value={bankIfsc} onChange={(e) => setBankIfsc(e.target.value.toUpperCase())}
                      placeholder="SBIN0001234" maxLength={11}
                      className="bg-neutral-800 border-neutral-700 text-white font-mono" />
                  </div>
                  <Alert className="border-amber-700 bg-amber-950/30 py-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                    <AlertDescription className="text-amber-300 text-xs">
                      Payouts to this account will be enabled only after verification is approved.
                    </AlertDescription>
                  </Alert>
                  <Button className="w-full bg-indigo-600 hover:bg-indigo-700"
                    disabled={loading || !bankAccount || bankIfsc.length !== 11 || !bankHolder.trim()}
                    onClick={() => handleVerify("BANK", { accountNumber: bankAccount, ifsc: bankIfsc, holderName: bankHolder })}>
                    {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Verifying…</> : "Verify Bank Account"}
                  </Button>
                  {verifyStatus["bankStatus"] === "FAILED" && (
                    <Alert variant="destructive" className="text-sm">
                      <XCircle className="h-4 w-4" />
                      <AlertDescription>Bank verification failed. Check account number and IFSC, then retry.</AlertDescription>
                    </Alert>
                  )}
                </div>
              )}
              <Button className="w-full bg-emerald-700 hover:bg-emerald-600" onClick={() => setStep(5)}
                disabled={!bankVerified}>
                Continue to Optional Documents →
              </Button>
              {!bankVerified && (
                <p className="text-xs text-center text-neutral-500">Bank verification is required to continue.</p>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── Step 5 — Optional ────────────────────────────────────── */}
        {step === 5 && (
          <Card className="bg-neutral-900 border-neutral-800">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Building2 className="w-5 h-5 text-indigo-400" />Optional Business Documents
                <OptionalTag />
              </CardTitle>
              <CardDescription>
                Adding GSTIN, CIN, or Udyam number is completely optional. You can approve without these.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <Alert className="border-emerald-700 bg-emerald-950/30 py-2">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                <AlertDescription className="text-emerald-300 text-sm">
                  All mandatory verifications are complete. These fields are optional and will not block approval.
                </AlertDescription>
              </Alert>

              <div className="space-y-1.5">
                <Label>Business Name <OptionalTag /></Label>
                <Input value={businessName} onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="Your registered business name"
                  className="bg-neutral-800 border-neutral-700 text-white" />
              </div>

              <Separator className="bg-neutral-800" />

              {/* GSTIN */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>GSTIN <OptionalTag /></Label>
                  <VerifyBadge status={verifyStatus["gstStatus"]} />
                </div>
                <div className="flex gap-2">
                  <Input value={gstinInput} onChange={(e) => setGstinInput(e.target.value.toUpperCase())}
                    placeholder="22AAAAA0000A1Z5" maxLength={15}
                    className="bg-neutral-800 border-neutral-700 text-white font-mono" />
                  <Button variant="outline" className="border-neutral-600 shrink-0" disabled={loading || gstinInput.length !== 15}
                    onClick={() => handleVerify("GST", { gstin: gstinInput })}>Verify</Button>
                </div>
              </div>

              {/* CIN */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>CIN <OptionalTag /></Label>
                  <VerifyBadge status={verifyStatus["cinStatus"]} />
                </div>
                <div className="flex gap-2">
                  <Input value={cinInput} onChange={(e) => setCinInput(e.target.value.toUpperCase())}
                    placeholder="U12345MH2020PTC123456"
                    className="bg-neutral-800 border-neutral-700 text-white font-mono" />
                  <Button variant="outline" className="border-neutral-600 shrink-0" disabled={loading || cinInput.length < 10}
                    onClick={() => handleVerify("CIN", { cin: cinInput })}>Verify</Button>
                </div>
              </div>

              {/* Udyam */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Udyam Registration <OptionalTag /></Label>
                  <VerifyBadge status={verifyStatus["udyamStatus"]} />
                </div>
                <div className="flex gap-2">
                  <Input value={udyamInput} onChange={(e) => setUdyamInput(e.target.value.toUpperCase())}
                    placeholder="UDYAM-XX-00-0000000"
                    className="bg-neutral-800 border-neutral-700 text-white font-mono" />
                  <Button variant="outline" className="border-neutral-600 shrink-0" disabled={loading || udyamInput.length < 10}
                    onClick={() => handleVerify("UDYAM", { udyamNumber: udyamInput })}>Submit</Button>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <Button variant="ghost" className="flex-1 text-neutral-400 border border-neutral-700" onClick={() => setStep(6)}>
                  Skip → Go to Review
                </Button>
                <Button className="flex-1 bg-indigo-600 hover:bg-indigo-700" onClick={() => setStep(6)}>
                  Continue to Review →
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Step 6 — Review & Submit ─────────────────────────────── */}
        {step === 6 && (
          <Card className="bg-neutral-900 border-neutral-800">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <ClipboardCheck className="w-5 h-5 text-indigo-400" />
                {submitResult ? "Application Status" : "Review & Submit"}
              </CardTitle>
              <CardDescription>
                {submitResult === "SUBMITTED" ? "Your application is under review." :
                 submitResult === "APPROVED" ? "Your KYC has been approved!" :
                 submitResult === "REJECTED" ? "Your application was rejected." :
                 submitResult === "RE_UPLOAD_REQUIRED" ? "Re-upload requested by our team." :
                 "Review your details before submitting."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Status banner */}
              {submitResult === "APPROVED" && (
                <Alert className="border-emerald-700 bg-emerald-950/30">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  <AlertDescription className="text-emerald-300">Your account is verified and fully active.</AlertDescription>
                </Alert>
              )}
              {submitResult === "REJECTED" && (
                <Alert variant="destructive">
                  <XCircle className="h-4 w-4" />
                  <AlertDescription>
                    Application rejected.{rejectionReason ? ` Reason: ${rejectionReason}` : ""}{" "}
                    Contact support if you believe this is an error.
                  </AlertDescription>
                </Alert>
              )}
              {submitResult === "RE_UPLOAD_REQUIRED" && (
                <Alert className="border-amber-700 bg-amber-950/30">
                  <AlertTriangle className="h-4 w-4 text-amber-400" />
                  <AlertDescription className="text-amber-300">
                    Our team needs additional documents.{rejectionReason ? ` Reason: ${rejectionReason}` : ""}{" "}
                    Please visit the <a href="/merchant/verification" className="underline">Verification</a> section to upload.
                  </AlertDescription>
                </Alert>
              )}
              {submitResult === "SUBMITTED" && (
                <Alert className="border-indigo-700 bg-indigo-950/30">
                  <Info className="h-4 w-4 text-indigo-400" />
                  <AlertDescription className="text-indigo-300">Under review — typically 1–2 business days.</AlertDescription>
                </Alert>
              )}

              {/* Mandatory check summary */}
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Mandatory Checks</p>
                <div className="rounded-lg border border-neutral-700 bg-neutral-800/50 divide-y divide-neutral-700">
                  {[
                    { label: "PAN Verification",     key: "panStatus",     masked: kycState.panMasked },
                    { label: "Aadhaar Verification",  key: "aadhaarStatus", masked: kycState.aadhaarLast4 ? `XXXX XXXX ${kycState.aadhaarLast4}` : null },
                    { label: "Bank Account",          key: "bankStatus",    masked: null },
                  ].map(({ label, key, masked }) => (
                    <div key={key} className="flex items-center justify-between px-4 py-3">
                      <div>
                        <p className="text-sm text-white">{label}</p>
                        {masked && <p className="text-xs text-neutral-400 font-mono">{masked}</p>}
                      </div>
                      <VerifyBadge status={verifyStatus[key]} />
                    </div>
                  ))}
                </div>
              </div>

              {/* Optional summary */}
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Optional Details</p>
                <div className="rounded-lg border border-neutral-700 bg-neutral-800/30 divide-y divide-neutral-800">
                  {[
                    { label: "GSTIN", value: kycState.gstinMasked ?? gstinInput, key: "gstStatus" },
                    { label: "CIN",   value: cinInput,                            key: "cinStatus" },
                    { label: "Udyam", value: udyamInput,                          key: "udyamStatus" },
                  ].map(({ label, value, key }) => (
                    <div key={key} className="flex items-center justify-between px-4 py-2.5">
                      <div>
                        <p className="text-sm text-neutral-300">{label}</p>
                        {value ? <p className="text-xs text-neutral-400 font-mono">{value}</p>
                               : <p className="text-xs text-neutral-600 italic">Not provided</p>}
                      </div>
                      <Badge variant="outline" className="text-xs text-neutral-500">
                        {value ? (verifyStatus[key] === "VERIFIED" ? "Verified" : "Provided") : "Optional"}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>

              {!submitResult && (
                <>
                  {!mandatoryMet && (
                    <Alert className="border-red-700 bg-red-950/30">
                      <XCircle className="h-4 w-4 text-red-400" />
                      <AlertDescription className="text-red-300 text-sm">
                        Please complete mandatory verifications (PAN, Aadhaar, Bank) before submitting.
                      </AlertDescription>
                    </Alert>
                  )}
                  <Button className="w-full bg-emerald-600 hover:bg-emerald-700" onClick={handleSubmit}
                    disabled={loading || !mandatoryMet || !session?.verificationId}>
                    {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Submitting…</> :
                               <><CheckCircle2 className="w-4 h-4 mr-2" />Submit Application</>}
                  </Button>
                  <Button variant="ghost" className="w-full text-neutral-400 text-sm" onClick={() => setStep(5)}>
                    ← Back to Optional Documents
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
