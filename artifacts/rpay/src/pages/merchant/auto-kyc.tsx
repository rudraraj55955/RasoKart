import { useState, useEffect } from "react";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import { ShieldCheck, FileCheck, Loader2, CheckCircle2, XCircle, ChevronRight, Lock, Info, Smartphone, Mail } from "lucide-react";

declare global {
  interface Window {
    CfSecureId: new (config: { session_id: string; mode: string }) => {
      on: (event: string, handler: (data: any) => void) => void;
      open: () => void;
    };
  }
}

type Status =
  | "PENDING" | "PAN_VERIFIED" | "PAN_FAILED"
  | "AADHAAR_VERIFIED" | "AADHAAR_FAILED" | "NAME_MISMATCH"
  | "CONTACT_PENDING" | "MANUAL_REVIEW"
  | "APPROVED" | "REJECTED" | "BLOCKED";

interface StatusResp {
  status: Status;
  panVerified: boolean;
  panNumberMasked?: string;
  aadhaarVerified: boolean;
  aadhaarLast4?: string;
  mobileVerified: boolean;
  emailVerified: boolean;
  nameMatchScore: number | null;
  failureReason: string | null;
}

const auth = () => `Bearer ${localStorage.getItem("rasokart_token")}`;

async function api<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`/api/merchant-kyc${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", Authorization: auth(), ...(opts?.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Something went wrong");
  return data as T;
}

export default function MerchantAutoKyc() {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<StatusResp | null>(null);
  const [pan, setPan] = useState("");
  const [busy, setBusy] = useState(false);
  const [sdkError, setSdkError] = useState<string | null>(null);
  const [mobileOtpSent, setMobileOtpSent] = useState(false);
  const [mobileOtp, setMobileOtp] = useState("");
  const [emailOtpSent, setEmailOtpSent] = useState(false);
  const [emailOtp, setEmailOtp] = useState("");

  const load = () => {
    setLoading(true);
    api<StatusResp>("/status").then(setStatus).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const submitPan = async () => {
    setBusy(true);
    try {
      await api("/pan/verify", { method: "POST", body: JSON.stringify({ panNumber: pan.trim().toUpperCase() }) });
      toast.success("PAN verified successfully");
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  // Aadhaar via Cashfree Secure ID DigiLocker consent — never Offline Aadhaar OTP or Aadhaar Masking.
  function launchDigilocker() {
    setSdkError(null);
    setBusy(true);
    api<{ ok: boolean; sessionId: string; mode: string }>("/aadhaar/digilocker/start", { method: "POST" })
      .then((session) => {
        const open = () => {
          try {
            const sdk = new window.CfSecureId({ session_id: session.sessionId, mode: session.mode });
            sdk.on("success", async (sdkData: any) => {
              const authCode: string = sdkData?.auth_code ?? sdkData?.code;
              if (!authCode) { setSdkError("DigiLocker consent incomplete — no auth code received."); setBusy(false); return; }
              try {
                await api("/aadhaar/digilocker/complete", { method: "POST", body: JSON.stringify({ authCode }) });
                toast.success("Aadhaar verified via DigiLocker");
                load();
              } catch (e: any) {
                setSdkError(e.message);
              } finally {
                setBusy(false);
              }
            });
            sdk.on("failure", (err: any) => {
              setSdkError(err?.message ?? "DigiLocker consent was denied or failed.");
              setBusy(false);
            });
            sdk.open();
          } catch {
            setSdkError("Could not launch DigiLocker consent. Please try again.");
            setBusy(false);
          }
        };
        if (window.CfSecureId) { open(); return; }
        const script = document.createElement("script");
        script.src = "https://sdk.cashfree.com/js/secureid/latest/secureid.js";
        script.onload = open;
        script.onerror = () => { setSdkError("DigiLocker SDK failed to load. Check your network and retry."); setBusy(false); };
        document.body.appendChild(script);
      })
      .catch((e: any) => { setSdkError(e.message); setBusy(false); });
  }

  const requestMobileOtp = async () => {
    setBusy(true);
    try {
      await api("/mobile/verify/request", { method: "POST" });
      setMobileOtpSent(true);
      toast.success("OTP sent to your registered mobile number");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const confirmMobileOtp = async () => {
    setBusy(true);
    try {
      await api("/mobile/verify/confirm", { method: "POST", body: JSON.stringify({ otp: mobileOtp.trim() }) });
      toast.success("Mobile number verified");
      setMobileOtp("");
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const requestEmailOtp = async () => {
    setBusy(true);
    try {
      await api("/email/verify/request", { method: "POST" });
      setEmailOtpSent(true);
      toast.success("OTP sent to your registered email address");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const confirmEmailOtp = async () => {
    setBusy(true);
    try {
      await api("/email/verify/confirm", { method: "POST", body: JSON.stringify({ otp: emailOtp.trim() }) });
      toast.success("Email address verified");
      setEmailOtp("");
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const s = status?.status ?? "PENDING";
  const isApproved = s === "APPROVED";
  const isTerminalFail = s === "REJECTED" || s === "BLOCKED";
  const showAadhaarStep = status?.panVerified && !status?.aadhaarVerified;
  const showContactSteps = status?.panVerified && status?.aadhaarVerified && !isApproved;
  const showResultStep = status?.aadhaarVerified && status?.mobileVerified && status?.emailVerified && !isApproved;

  return (
    <div className="max-w-2xl mx-auto space-y-6 py-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-emerald-500" />
            RasoKart KYC Verification
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Complete your identity verification to activate your merchant account.
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : isApproved ? (
          <Card className="border-emerald-600/30 bg-emerald-950/20">
            <CardContent className="pt-6 flex flex-col items-center text-center gap-3 py-10">
              <CheckCircle2 className="h-12 w-12 text-emerald-500" />
              <h2 className="text-lg font-medium">You're verified!</h2>
              <p className="text-sm text-muted-foreground">Your KYC verification is complete and your account is fully active.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {status?.failureReason && (
              <Alert variant="destructive">
                <XCircle className="h-4 w-4" />
                <AlertDescription>{status.failureReason}</AlertDescription>
              </Alert>
            )}
            {sdkError && (
              <Alert variant="destructive">
                <XCircle className="h-4 w-4" />
                <AlertDescription>{sdkError}</AlertDescription>
              </Alert>
            )}

            {s === "MANUAL_REVIEW" && (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>Your verification is complete and is under manual review by our team. You'll be notified once approved.</AlertDescription>
              </Alert>
            )}

            {!status?.panVerified && !isTerminalFail && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base"><FileCheck className="h-4 w-4" /> Step 1 — PAN Verification</CardTitle>
                  <CardDescription>Enter your PAN card number as registered with the Income Tax Department.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="pan">PAN Number</Label>
                    <Input id="pan" placeholder="ABCDE1234F" maxLength={10} value={pan}
                      onChange={(e) => setPan(e.target.value.toUpperCase())} className="uppercase tracking-wider" />
                  </div>
                  <Button onClick={submitPan} disabled={busy || pan.trim().length !== 10} className="w-full">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    Verify PAN <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </CardContent>
              </Card>
            )}

            {showAadhaarStep && !isTerminalFail && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base"><Lock className="h-4 w-4" /> Step 2 — Aadhaar Verification via DigiLocker</CardTitle>
                  <CardDescription>Securely authorise access to your DigiLocker-verified Aadhaar details. No OTP or Aadhaar number sharing required.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Button onClick={launchDigilocker} disabled={busy} className="w-full">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Lock className="h-4 w-4 mr-2" />}
                    Verify with DigiLocker
                  </Button>
                </CardContent>
              </Card>
            )}

            {showContactSteps && !isTerminalFail && (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base"><Smartphone className="h-4 w-4" /> Step 3 — Mobile Verification</CardTitle>
                    <CardDescription>Confirm your registered mobile number with a one-time code.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {status?.mobileVerified ? (
                      <div className="flex items-center gap-2 text-sm text-emerald-400"><CheckCircle2 className="h-4 w-4" /> Mobile number verified</div>
                    ) : !mobileOtpSent ? (
                      <Button onClick={requestMobileOtp} disabled={busy} className="w-full">
                        {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                        Send OTP to my mobile
                      </Button>
                    ) : (
                      <>
                        <div className="space-y-1.5">
                          <Label htmlFor="mobile-otp">Enter OTP</Label>
                          <Input id="mobile-otp" placeholder="6-digit OTP" maxLength={6} value={mobileOtp}
                            onChange={(e) => setMobileOtp(e.target.value.replace(/\D/g, ""))} />
                        </div>
                        <Button onClick={confirmMobileOtp} disabled={busy || mobileOtp.length < 4} className="w-full">
                          {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                          Verify Mobile OTP
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setMobileOtpSent(false)} className="w-full">Resend OTP</Button>
                      </>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base"><Mail className="h-4 w-4" /> Step 4 — Email Verification</CardTitle>
                    <CardDescription>Confirm your registered email address with a one-time code.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {status?.emailVerified ? (
                      <div className="flex items-center gap-2 text-sm text-emerald-400"><CheckCircle2 className="h-4 w-4" /> Email address verified</div>
                    ) : !emailOtpSent ? (
                      <Button onClick={requestEmailOtp} disabled={busy} className="w-full">
                        {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                        Send OTP to my email
                      </Button>
                    ) : (
                      <>
                        <div className="space-y-1.5">
                          <Label htmlFor="email-otp">Enter OTP</Label>
                          <Input id="email-otp" placeholder="6-digit OTP" maxLength={6} value={emailOtp}
                            onChange={(e) => setEmailOtp(e.target.value.replace(/\D/g, ""))} />
                        </div>
                        <Button onClick={confirmEmailOtp} disabled={busy || emailOtp.length < 4} className="w-full">
                          {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                          Verify Email OTP
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setEmailOtpSent(false)} className="w-full">Resend OTP</Button>
                      </>
                    )}
                  </CardContent>
                </Card>
              </>
            )}

            {(showResultStep || isTerminalFail) && (
              <Card>
                <CardContent className="pt-6 flex items-center gap-3">
                  <Badge variant={isTerminalFail || s === "NAME_MISMATCH" ? "destructive" : "secondary"}>{s.replace(/_/g, " ")}</Badge>
                  <span className="text-sm text-muted-foreground">
                    {isTerminalFail ? "Your KYC was rejected. Please contact support." : "Awaiting final review."}
                  </span>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
  );
}
