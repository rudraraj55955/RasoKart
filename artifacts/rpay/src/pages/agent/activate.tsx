import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { AuthLayout } from "@/components/layout/auth-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { CheckCircle2, AlertTriangle, Eye, EyeOff } from "lucide-react";
import { apiUrl } from "@/lib/api-url";

type VerifyState = "loading" | "valid" | "used" | "expired" | "invalid";

export default function AgentActivate() {
  const [, setLocation] = useLocation();
  const token = new URLSearchParams(window.location.search).get("token") ?? "";

  const [verifyState, setVerifyState] = useState<VerifyState>("loading");
  const [agentInfo, setAgentInfo] = useState<{ email: string; name: string; agentCode: string | null } | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) { setVerifyState("invalid"); return; }

    fetch(apiUrl(`/api/agent/activate/verify?token=${encodeURIComponent(token)}`))
      .then((r) => r.json())
      .then((data) => {
        if (data.valid) {
          setAgentInfo({ email: data.email, name: data.name, agentCode: data.agentCode ?? null });
          setVerifyState("valid");
        } else if (data.error?.toLowerCase().includes("already been used")) {
          setVerifyState("used");
        } else if (data.error?.toLowerCase().includes("expired")) {
          setVerifyState("expired");
        } else {
          setVerifyState("invalid");
        }
      })
      .catch(() => setVerifyState("invalid"));
  }, [token]);

  const passwordErrors: string[] = [];
  if (password.length > 0 && password.length < 8) passwordErrors.push("At least 8 characters");
  if (password.length > 0 && !/[A-Z]/.test(password)) passwordErrors.push("One uppercase letter");
  if (password.length > 0 && !/[a-z]/.test(password)) passwordErrors.push("One lowercase letter");
  if (password.length > 0 && !/\d/.test(password)) passwordErrors.push("One number");
  const confirmError = confirm.length > 0 && confirm !== password ? "Passwords do not match" : "";

  const canSubmit = password.length >= 8
    && /[A-Z]/.test(password)
    && /[a-z]/.test(password)
    && /\d/.test(password)
    && password === confirm
    && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const r = await fetch(apiUrl("/api/agent/activate/set-password"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await r.json();
      if (r.ok && data.success) {
        setDone(true);
        toast.success("Account activated! Redirecting to login…");
        setTimeout(() => setLocation("/agent/login"), 2000);
      } else {
        toast.error(data.error ?? "Failed to activate account. Please try again.");
        setSubmitting(false);
      }
    } catch {
      toast.error("Network error. Please try again.");
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout title="Activate Agent Account" subtitle="Set your password to complete activation">
      {verifyState === "loading" && (
        <div className="flex justify-center py-10">
          <Spinner className="w-8 h-8 text-primary" />
        </div>
      )}

      {verifyState === "used" && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            This invite link has already been used. Please{" "}
            <button className="underline font-medium" onClick={() => setLocation("/agent/login")}>
              log in
            </button>{" "}
            or ask your admin to resend the invite.
          </AlertDescription>
        </Alert>
      )}

      {verifyState === "expired" && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            This invite link has expired (valid for 72 hours). Please ask your admin to resend the invite.
          </AlertDescription>
        </Alert>
      )}

      {verifyState === "invalid" && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Invalid invite link. It may have already been used or never existed.
          </AlertDescription>
        </Alert>
      )}

      {verifyState === "valid" && done && (
        <Alert className="border-green-500/50 bg-green-500/10">
          <CheckCircle2 className="h-4 w-4 text-green-500" />
          <AlertDescription className="text-green-600">
            Account activated successfully! Redirecting to login…
          </AlertDescription>
        </Alert>
      )}

      {verifyState === "valid" && !done && agentInfo && (
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="rounded-lg bg-muted/40 border border-border p-4 space-y-1 text-sm">
            <p className="font-medium text-foreground">{agentInfo.name}</p>
            <p className="text-muted-foreground">{agentInfo.email}</p>
            {agentInfo.agentCode && (
              <p className="text-xs text-muted-foreground font-mono">Agent ID: {agentInfo.agentCode}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">New Password</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPw ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Choose a strong password"
                autoComplete="new-password"
                className="pr-10"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                onClick={() => setShowPw(!showPw)}
                tabIndex={-1}
              >
                {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {passwordErrors.length > 0 && (
              <ul className="text-xs text-destructive space-y-0.5 mt-1">
                {passwordErrors.map((e) => <li key={e}>• {e}</li>)}
              </ul>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirm">Confirm Password</Label>
            <div className="relative">
              <Input
                id="confirm"
                type={showConfirm ? "text" : "password"}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Repeat your password"
                autoComplete="new-password"
                className="pr-10"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                onClick={() => setShowConfirm(!showConfirm)}
                tabIndex={-1}
              >
                {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {confirmError && <p className="text-xs text-destructive">{confirmError}</p>}
          </div>

          <Button type="submit" className="w-full" disabled={!canSubmit}>
            {submitting ? (
              <><Spinner className="w-4 h-4 mr-2" /> Activating…</>
            ) : (
              "Activate Account"
            )}
          </Button>

          <p className="text-xs text-center text-muted-foreground">
            Already have access?{" "}
            <button type="button" className="underline" onClick={() => setLocation("/agent/login")}>
              Sign in
            </button>
          </p>
        </form>
      )}
    </AuthLayout>
  );
}
