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
  CheckCircle2, Circle, Loader2, ShieldCheck, Smartphone,
  Building2, FileCheck, CreditCard, Upload, ClipboardCheck,
  ChevronRight, AlertTriangle, Info, RefreshCw, Lock,
} from "lucide-react";

declare global {
  interface Window {
    CfSecureId: new (config: { session_id: string; mode: string }) => {
      on: (event: string, handler: (data: any) => void) => void;
      open: () => void;
    };
  }
}

type StepId = "mobile" | "consent" | "details" | "identity" | "bank" | "documents" | "review";

interface Step {
  id: StepId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const STEPS: Step[] = [
  { id: "mobile", label: "Mobile Verify", icon: Smartphone },
  { id: "consent", label: "Secure Consent", icon: Lock },
  { id: "details", label: "Business Details", icon: Building2 },
  { id: "identity", label: "Identity Check", icon: FileCheck },
  { id: "bank", label: "Bank Verify", icon: CreditCard },
  { id: "documents", label: "Documents", icon: Upload },
  { id: "review", label: "Submit", icon: ClipboardCheck },
];

interface Session {
  verificationId: string;
  sessionToken: string;
  dataAvailable: boolean;
  mode: string;
}

interface KycData {
  fullName?: string;
  panMasked?: string;
  aadhaarLast4?: string;
  businessName?: string;
  city?: string;
  state?: string;
  mismatchFlags?: string[];
}

interface VerifyStatus {
  panStatus?: string;
  gstStatus?: string;
  cinStatus?: string;
  bankStatus?: string;
}

function StatusBadge({ status }: { status?: string }) {
  if (!status || status === "PENDING") return <Badge variant="secondary" className="text-xs">Pending</Badge>;
  if (status === "VERIFIED") return <Badge className="bg-emerald-600 text-white text-xs">Verified</Badge>;
  if (status === "MISMATCH") return <Badge className="bg-amber-600 text-white text-xs">Mismatch</Badge>;
  if (status === "SKIPPED") return <Badge variant="outline" className="text-xs">Skipped</Badge>;
  return <Badge className="bg-red-600 text-white text-xs">Failed</Badge>;
}

function StepIndicator({ step, index, current, done }: { step: Step; index: number; current: number; done: boolean }) {
  const Icon = step.icon;
  const isActive = index === current;
  const isDone = done || index < current;
  return (
    <div className="flex flex-col items-center gap-1 min-w-[60px]">
      <div className={`w-9 h-9 rounded-full flex items-center justify-center border-2 transition-all ${
        isDone ? "bg-emerald-600 border-emerald-600 text-white" :
        isActive ? "bg-indigo-600 border-indigo-600 text-white" :
        "bg-neutral-800 border-neutral-700 text-neutral-500"
      }`}>
        {isDone ? <CheckCircle2 className="w-5 h-5" /> : <Icon className="w-4 h-4" />}
      </div>
      <span className={`text-[10px] font-medium text-center leading-tight ${
        isActive ? "text-white" : isDone ? "text-emerald-400" : "text-neutral-500"
      }`}>{step.label}</span>
    </div>
  );
}

export default function MerchantOnboarding() {
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [mobile, setMobile] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [kycData, setKycData] = useState<KycData | null>(null);
  const [verifyStatus, setVerifyStatus] = useState<VerifyStatus>({});

  const [panInput, setPanInput] = useState("");
  const [panName, setPanName] = useState("");
  const [gstinInput, setGstinInput] = useState("");
  const [cinInput, setCinInput] = useState("");
  const [bankAccount, setBankAccount] = useState("");
  const [bankIfsc, setBankIfsc] = useState("");

  const [businessName, setBusinessName] = useState("");
  const [gstin, setGstin] = useState("");

  const sdkContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/onboarding/status", { headers: { Authorization: `Bearer ${localStorage.getItem("rasokart_token")}` } })
      .then((r) => r.json())
      .then((data) => {
        if (!data.onboardingEnabled) { setPageLoading(false); return; }
        if (data.session) {
          const s = data.session;
          if (s.status === "SUBMITTED" || s.status === "APPROVED" || s.status === "REJECTED" || s.status === "RE_UPLOAD_REQUIRED") {
            setCurrentStep(6);
          } else if (s.status === "KYC_PENDING") {
            setCurrentStep(3);
          }
        }
        if (data.kyc) {
          const k = data.kyc;
          setKycData({ fullName: k.fullName, panMasked: k.panMasked, businessName: k.businessName, city: k.city, state: k.stateName });
          setVerifyStatus({ panStatus: k.panStatus, gstStatus: k.gstStatus, cinStatus: k.cinStatus, bankStatus: k.bankStatus });
          if (k.fullName) setPanName(k.fullName);
          if (k.businessName) setBusinessName(k.businessName);
        }
        setPageLoading(false);
      })
      .catch(() => setPageLoading(false));
  }, []);

  async function handleInitiate() {
    setError(null);
    const digits = mobile.replace(/\D/g, "");
    if (digits.length !== 10) { setError("Enter a valid 10-digit mobile number"); return; }
    setLoading(true);
    try {
      const r = await fetch("/api/onboarding/initiate", {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("rasokart_token")}`, "Content-Type": "application/json" },
        body: JSON.stringify({ mobile: digits }),
      });
      const data = await r.json();
      if (!r.ok) { setError(data.error ?? "Failed to initiate onboarding"); return; }
      setSession(data);
      setCurrentStep(1);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function launchSdk() {
    if (!session) return;
    setError(null);
    const loadAndOpen = () => {
      try {
        const sdk = new window.CfSecureId({ session_id: session.sessionToken, mode: session.mode });
        sdk.on("success", async (data: any) => {
          const authCode: string = data?.auth_code ?? data?.code;
          if (!authCode) { setError("Consent incomplete — no auth code received."); return; }
          setLoading(true);
          try {
            const r = await fetch("/api/onboarding/consent", {
              method: "POST",
              headers: { Authorization: `Bearer ${localStorage.getItem("rasokart_token")}`, "Content-Type": "application/json" },
              body: JSON.stringify({ verificationId: session.verificationId, authCode }),
            });
            const cData = await r.json();
            if (!r.ok) { setError(cData.error ?? "Consent exchange failed. Please retry."); return; }
            if (cData.kycData) {
              setKycData(cData.kycData);
              if (cData.kycData.fullName) setPanName(cData.kycData.fullName);
              if (cData.kycData.businessName) setBusinessName(cData.kycData.businessName);
            }
            toast.success("Secure consent completed!");
            setCurrentStep(2);
          } finally {
            setLoading(false);
          }
        });
        sdk.on("failure", async (err: any) => {
          await fetch("/api/onboarding/consent-denied", {
            method: "POST",
            headers: { Authorization: `Bearer ${localStorage.getItem("rasokart_token")}`, "Content-Type": "application/json" },
            body: JSON.stringify({ verificationId: session.verificationId }),
          }).catch(() => {});
          setError(err?.message ?? "Consent was denied or failed. You can try again or fill details manually.");
        });
        sdk.open();
      } catch (e: any) {
        setError("Could not launch secure consent. Please try again.");
      }
    };

    if (window.CfSecureId) { loadAndOpen(); return; }
    const script = document.createElement("script");
    script.src = "https://sdk.cashfree.com/js/secureid/latest/secureid.js";
    script.onload = loadAndOpen;
    script.onerror = () => setError("Secure consent SDK failed to load. Check your network and retry.");
    document.body.appendChild(script);
  }

  async function handleVerify(type: string) {
    if (!session) return;
    setError(null);
    setLoading(true);
    const body: Record<string, string> = { type, verificationId: session.verificationId };
    if (type === "PAN") { body["pan"] = panInput.toUpperCase(); body["name"] = panName; }
    if (type === "GST") { body["gstin"] = gstinInput.toUpperCase(); }
    if (type === "CIN") { body["cin"] = cinInput.toUpperCase(); }
    if (type === "BANK") { body["accountNumber"] = bankAccount; body["ifsc"] = bankIfsc.toUpperCase(); }
    try {
      const r = await fetch("/api/onboarding/verify", {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("rasokart_token")}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) { setError(data.error ?? "Verification failed"); return; }
      setVerifyStatus((prev) => ({ ...prev, [`${type.toLowerCase()}Status`]: data.status }));
      if (data.status === "VERIFIED") toast.success(`${type} verified successfully`);
      else if (data.status === "SKIPPED") toast.info(`${type} verification skipped`);
      else toast.warning(`${type} verification ${data.status.toLowerCase()}`);
    } catch {
      setError("Network error during verification");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit() {
    if (!session) return;
    setError(null);
    setLoading(true);
    try {
      const r = await fetch("/api/onboarding/submit", {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("rasokart_token")}`, "Content-Type": "application/json" },
        body: JSON.stringify({ verificationId: session.verificationId, businessName, gstin }),
      });
      const data = await r.json();
      if (!r.ok) { setError(data.error ?? "Submission failed"); return; }
      toast.success("Application submitted for review!");
      setCurrentStep(6);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (pageLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="max-w-3xl mx-auto space-y-6 p-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <ShieldCheck className="w-7 h-7 text-indigo-400" />
            Secure Business Onboarding
          </h1>
          <p className="text-neutral-400 text-sm mt-1">
            Complete identity verification to unlock full account features.
          </p>
        </div>

        {/* Step indicator */}
        <Card className="bg-neutral-900 border-neutral-800">
          <CardContent className="py-5 px-4">
            <div className="flex items-start justify-between overflow-x-auto gap-1">
              {STEPS.map((step, i) => (
                <div key={step.id} className="flex items-center flex-shrink-0">
                  <StepIndicator step={step} index={i} current={currentStep} done={false} />
                  {i < STEPS.length - 1 && (
                    <ChevronRight className={`w-4 h-4 mx-0.5 flex-shrink-0 ${i < currentStep ? "text-emerald-500" : "text-neutral-700"}`} />
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Step 0 — Mobile Verification */}
        {currentStep === 0 && (
          <Card className="bg-neutral-900 border-neutral-800">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2"><Smartphone className="w-5 h-5 text-indigo-400" />Verify Your Mobile Number</CardTitle>
              <CardDescription>We'll check if your registered mobile is eligible for 1-click onboarding.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>Mobile Number</Label>
                <div className="flex gap-2">
                  <span className="flex items-center px-3 bg-neutral-800 border border-neutral-700 rounded-md text-neutral-400 text-sm">+91</span>
                  <Input
                    type="tel" placeholder="9876543210" maxLength={10}
                    value={mobile} onChange={(e) => setMobile(e.target.value.replace(/\D/g, "").slice(0, 10))}
                    className="bg-neutral-800 border-neutral-700 text-white font-mono"
                  />
                </div>
                <p className="text-xs text-neutral-500">Enter the mobile number registered with your business Aadhaar / PAN.</p>
              </div>
              <Button className="w-full bg-indigo-600 hover:bg-indigo-700" onClick={handleInitiate} disabled={loading || mobile.length < 10}>
                {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Checking…</> : "Continue →"}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Step 1 — Secure Consent */}
        {currentStep === 1 && session && (
          <Card className="bg-neutral-900 border-neutral-800">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2"><Lock className="w-5 h-5 text-indigo-400" />Secure Data Consent</CardTitle>
              <CardDescription>
                Authorise RasoKart to fetch your verified identity data securely. Your data is encrypted end-to-end.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {session.dataAvailable && (
                <Alert className="border-emerald-700 bg-emerald-950/40">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  <AlertDescription className="text-emerald-300 text-sm">
                    Verified identity data is available for this mobile. 1-click onboarding will auto-fill your details.
                  </AlertDescription>
                </Alert>
              )}
              {!session.dataAvailable && (
                <Alert className="border-amber-700 bg-amber-950/40">
                  <Info className="h-4 w-4 text-amber-400" />
                  <AlertDescription className="text-amber-300 text-sm">
                    Data is not yet available for this mobile. You'll fill details manually after consent.
                  </AlertDescription>
                </Alert>
              )}
              <div className="rounded-lg border border-neutral-700 bg-neutral-800/50 p-4 space-y-2">
                <p className="text-sm font-medium text-white">What we'll access (with your consent):</p>
                <ul className="text-xs text-neutral-400 space-y-1 list-disc list-inside">
                  <li>Name, date of birth, gender</li>
                  <li>Aadhaar-linked address</li>
                  <li>PAN number (masked)</li>
                  <li>Business name (if available)</li>
                </ul>
              </div>
              <div ref={sdkContainerRef} id="secureid-container" />
              <Button className="w-full bg-indigo-600 hover:bg-indigo-700" onClick={launchSdk} disabled={loading}>
                {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Processing…</> : <><ShieldCheck className="w-4 h-4 mr-2" />Authorise Secure Access</>}
              </Button>
              <Button variant="ghost" className="w-full text-neutral-400 text-sm" onClick={() => { setCurrentStep(2); setKycData(null); }}>
                Skip — I'll fill details manually
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Step 2 — Business Details */}
        {currentStep === 2 && (
          <Card className="bg-neutral-900 border-neutral-800">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2"><Building2 className="w-5 h-5 text-indigo-400" />Business Details</CardTitle>
              <CardDescription>Review and complete your business information.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {kycData?.mismatchFlags && kycData.mismatchFlags.length > 0 && (
                <Alert className="border-amber-700 bg-amber-950/40">
                  <AlertTriangle className="h-4 w-4 text-amber-400" />
                  <AlertDescription className="text-amber-300 text-sm">
                    Some details may not match your registered account. Please review carefully.
                  </AlertDescription>
                </Alert>
              )}
              {kycData?.fullName && (
                <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-neutral-800 border border-neutral-700">
                  <div><p className="text-xs text-neutral-500">Name (from records)</p><p className="text-sm text-white font-medium">{kycData.fullName}</p></div>
                  {kycData.aadhaarLast4 && <div><p className="text-xs text-neutral-500">Aadhaar</p><p className="text-sm text-white font-mono">{kycData.aadhaarLast4}</p></div>}
                  {kycData.panMasked && <div><p className="text-xs text-neutral-500">PAN</p><p className="text-sm text-white font-mono">{kycData.panMasked}</p></div>}
                  {kycData.city && <div><p className="text-xs text-neutral-500">City</p><p className="text-sm text-white">{kycData.city}{kycData.state ? `, ${kycData.state}` : ""}</p></div>}
                </div>
              )}
              <div className="space-y-1.5">
                <Label>Business Name</Label>
                <Input value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="Your registered business name" className="bg-neutral-800 border-neutral-700 text-white" />
              </div>
              <div className="space-y-1.5">
                <Label>GSTIN <span className="text-neutral-500">(optional)</span></Label>
                <Input value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} placeholder="22AAAAA0000A1Z5" className="bg-neutral-800 border-neutral-700 text-white font-mono" />
              </div>
              <Button className="w-full bg-indigo-600 hover:bg-indigo-700" onClick={() => setCurrentStep(3)} disabled={!businessName.trim()}>
                Continue to Identity Verification →
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Step 3 — Identity & Verification */}
        {currentStep === 3 && (
          <Card className="bg-neutral-900 border-neutral-800">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2"><FileCheck className="w-5 h-5 text-indigo-400" />Identity Verification</CardTitle>
              <CardDescription>Verify your PAN, GSTIN, and CIN to complete KYC.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* PAN */}
              <div className="space-y-3 p-4 rounded-lg border border-neutral-700 bg-neutral-800/50">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-white">PAN Verification</p>
                  <StatusBadge status={verifyStatus.panStatus} />
                </div>
                {(!verifyStatus.panStatus || verifyStatus.panStatus === "PENDING" || verifyStatus.panStatus === "FAILED") && (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">PAN Number</Label>
                        <Input value={panInput} onChange={(e) => setPanInput(e.target.value.toUpperCase())} placeholder="ABCDE1234F" maxLength={10} className="bg-neutral-900 border-neutral-700 text-white font-mono text-sm" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Name (as on PAN)</Label>
                        <Input value={panName} onChange={(e) => setPanName(e.target.value)} placeholder="Full name" className="bg-neutral-900 border-neutral-700 text-white text-sm" />
                      </div>
                    </div>
                    <Button size="sm" variant="outline" className="w-full border-neutral-600" onClick={() => handleVerify("PAN")} disabled={loading || panInput.length !== 10 || !panName.trim()}>
                      {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : "Verify PAN"}
                    </Button>
                  </>
                )}
              </div>

              {/* GST */}
              <div className="space-y-3 p-4 rounded-lg border border-neutral-700 bg-neutral-800/50">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-white">GST Verification <span className="text-xs text-neutral-500">(optional)</span></p>
                  <StatusBadge status={verifyStatus.gstStatus} />
                </div>
                {(!verifyStatus.gstStatus || verifyStatus.gstStatus === "PENDING" || verifyStatus.gstStatus === "FAILED") && (
                  <>
                    <Input value={gstinInput} onChange={(e) => setGstinInput(e.target.value.toUpperCase())} placeholder="22AAAAA0000A1Z5" maxLength={15} className="bg-neutral-900 border-neutral-700 text-white font-mono text-sm" />
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="flex-1 border-neutral-600" onClick={() => handleVerify("GST")} disabled={loading || gstinInput.length !== 15}>
                        {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : "Verify GSTIN"}
                      </Button>
                      <Button size="sm" variant="ghost" className="text-neutral-500 text-xs" onClick={() => setVerifyStatus((p) => ({ ...p, gstStatus: "SKIPPED" }))}>
                        Skip
                      </Button>
                    </div>
                  </>
                )}
              </div>

              <Button className="w-full bg-indigo-600 hover:bg-indigo-700" onClick={() => setCurrentStep(4)}>
                Continue to Bank Verification →
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Step 4 — Bank Verification */}
        {currentStep === 4 && (
          <Card className="bg-neutral-900 border-neutral-800">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2"><CreditCard className="w-5 h-5 text-indigo-400" />Bank Account Verification</CardTitle>
              <CardDescription>Verify your settlement bank account.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>Account Number</Label>
                <Input value={bankAccount} onChange={(e) => setBankAccount(e.target.value.replace(/\D/g, ""))} placeholder="Enter account number" className="bg-neutral-800 border-neutral-700 text-white font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label>IFSC Code</Label>
                <Input value={bankIfsc} onChange={(e) => setBankIfsc(e.target.value.toUpperCase())} placeholder="SBIN0001234" maxLength={11} className="bg-neutral-800 border-neutral-700 text-white font-mono" />
              </div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm text-neutral-400">Verification status</p>
                <StatusBadge status={verifyStatus.bankStatus} />
              </div>
              {(!verifyStatus.bankStatus || verifyStatus.bankStatus === "PENDING" || verifyStatus.bankStatus === "FAILED") && (
                <Button variant="outline" className="w-full border-neutral-600" onClick={() => handleVerify("BANK")} disabled={loading || !bankAccount || bankIfsc.length !== 11}>
                  {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Verifying…</> : "Verify Bank Account"}
                </Button>
              )}
              <Separator className="bg-neutral-800" />
              <Button className="w-full bg-indigo-600 hover:bg-indigo-700" onClick={() => setCurrentStep(5)}>
                Continue to Documents →
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Step 5 — Documents */}
        {currentStep === 5 && (
          <Card className="bg-neutral-900 border-neutral-800">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2"><Upload className="w-5 h-5 text-indigo-400" />Supporting Documents</CardTitle>
              <CardDescription>Upload any remaining documents for review (PAN card, GST certificate, cancelled cheque).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert className="border-indigo-700 bg-indigo-950/30">
                <Info className="h-4 w-4 text-indigo-400" />
                <AlertDescription className="text-indigo-300 text-sm">
                  Your identity has been verified digitally. Upload physical copies only if requested by our team.
                </AlertDescription>
              </Alert>
              <div className="rounded-lg border border-dashed border-neutral-700 bg-neutral-800/30 p-6 text-center">
                <Upload className="w-8 h-8 text-neutral-500 mx-auto mb-2" />
                <p className="text-sm text-neutral-400">Document upload is handled in the <strong className="text-white">Verification</strong> section of your dashboard.</p>
                <Button variant="link" className="text-indigo-400 mt-1" onClick={() => window.location.href = "/merchant/verification"}>
                  Go to Verification →
                </Button>
              </div>
              <Button className="w-full bg-indigo-600 hover:bg-indigo-700" onClick={() => setCurrentStep(6)}>
                Skip & Review →
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Step 6 — Review & Submit / Status */}
        {currentStep === 6 && (
          <Card className="bg-neutral-900 border-neutral-800">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2"><ClipboardCheck className="w-5 h-5 text-indigo-400" />Review & Submit</CardTitle>
              <CardDescription>Review your details and submit for our team's review.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {kycData && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-neutral-400 uppercase tracking-wider">Verified Details</p>
                  <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-neutral-800 border border-neutral-700 text-sm">
                    {kycData.fullName && <div><p className="text-xs text-neutral-500">Name</p><p className="text-white">{kycData.fullName}</p></div>}
                    {kycData.panMasked && <div><p className="text-xs text-neutral-500">PAN</p><p className="text-white font-mono">{kycData.panMasked}</p></div>}
                    {businessName && <div><p className="text-xs text-neutral-500">Business</p><p className="text-white">{businessName}</p></div>}
                    <div><p className="text-xs text-neutral-500">PAN Check</p><StatusBadge status={verifyStatus.panStatus} /></div>
                    <div><p className="text-xs text-neutral-500">GST Check</p><StatusBadge status={verifyStatus.gstStatus} /></div>
                    <div><p className="text-xs text-neutral-500">Bank Check</p><StatusBadge status={verifyStatus.bankStatus} /></div>
                  </div>
                </div>
              )}
              <Button className="w-full bg-emerald-600 hover:bg-emerald-700" onClick={handleSubmit} disabled={loading || !session}>
                {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Submitting…</> : <><CheckCircle2 className="w-4 h-4 mr-2" />Submit Application</>}
              </Button>
              <Alert className="border-emerald-700 bg-emerald-950/30">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                <AlertDescription className="text-emerald-300 text-sm">
                  Our team reviews applications within 1–2 business days. You'll be notified once approved.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
