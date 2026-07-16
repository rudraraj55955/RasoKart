import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Mail, Save, TestTube2, Lock, RefreshCw, CheckCircle2, XCircle, Loader2, ShieldCheck, AlertTriangle, Server, Eye } from "lucide-react";
import { toast } from "sonner";
import { useGetMe } from "@workspace/api-client-react";

const BASE_URL = import.meta.env.BASE_URL ?? "/";
const API = `${BASE_URL}api`.replace(/\/+/g, "/").replace(/\/$/, "");
const TOKEN_KEY = "rasokart_token";

function authHeaders() {
  const t = localStorage.getItem(TOKEN_KEY);
  return { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) };
}

interface EmailOtpSettings {
  authKeySet: boolean;
  authKeyMasked: string | null;
  templateId: string;
  templateIdSet: boolean;
  templateIdSource: "env" | "not-set";
  fromEmail: string;
  fromEmailSet: boolean;
  fromEmailSource: "env" | "not-set";
  fromName: string;
  fromNameSource: "env" | "default";
  senderDomain: string;
  domainSource: "env" | "default";
  fromAddress: string;
  otpExpirySeconds: number;
  resendCooldownSeconds: number;
  otpLoginEnabled: boolean;
  testVerified: boolean;
  testVerifiedAt: string | null;
  updatedByEmail: string | null;
  updatedAt: string | null;
}

interface TestResult {
  ok: boolean;
  provider?: string;
  recipientMasked?: string;
  templateId?: string;
  fromEmail?: string;
  senderDomain?: string;
  msg91StatusCode?: number | null;
  msg91Response?: unknown;
  errorReason?: string;
  message?: string;
}

type TestStep = "idle" | "sent" | "verified";

function SourceBadge({ source }: { source: "env" | "default" | "not-set" }) {
  if (source === "env") {
    return (
      <Badge variant="outline" className="text-xs bg-green-500/10 text-green-400 border-green-500/30 ml-2">
        from env
      </Badge>
    );
  }
  if (source === "not-set") {
    return (
      <Badge variant="outline" className="text-xs bg-red-500/10 text-red-400 border-red-500/30 ml-2">
        NOT SET
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-400 border-amber-500/30 ml-2">
      default
    </Badge>
  );
}

function StatusRow({ label, value, status }: { label: string; value: string; status: "ok" | "warn" | "error" }) {
  const icons = {
    ok: <CheckCircle2 className="h-3.5 w-3.5 text-green-400 shrink-0" />,
    warn: <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />,
    error: <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />,
  };
  return (
    <div className="flex items-start gap-2 py-1.5">
      <span className="text-sm text-zinc-400 w-40 shrink-0">{label}</span>
      <span className="flex items-center gap-1.5 text-sm text-white break-all">{icons[status]}{value}</span>
    </div>
  );
}

export default function AdminOtpEmailSettings() {
  const { data: me } = useGetMe();
  const isSuperAdmin = me?.isSuperAdmin ?? false;

  const [settings, setSettings] = useState<EmailOtpSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [verifying, setVerifying] = useState(false);

  const [testEmail, setTestEmail] = useState("");
  const [testEmailUsed, setTestEmailUsed] = useState("");
  const [testCode, setTestCode] = useState("");
  const [testStep, setTestStep] = useState<TestStep>("idle");
  const [lastTestResult, setLastTestResult] = useState<TestResult | null>(null);
  const [otpLoginEnabled, setOtpLoginEnabled] = useState(false);

  async function fetchSettings() {
    setLoading(true);
    try {
      const r = await fetch(`${API}/admin/otp-email-settings`, { headers: authHeaders() });
      if (!r.ok) throw new Error(await r.text());
      const data: EmailOtpSettings = await r.json();
      setSettings(data);
      setOtpLoginEnabled(data.otpLoginEnabled ?? false);
      if (data.testVerified) setTestStep("verified");
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to load Email OTP settings");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchSettings(); }, []);

  async function handleSave() {
    if (!isSuperAdmin) return;
    if (otpLoginEnabled && !settings?.testVerified) {
      toast.error("Complete test email OTP verification before enabling Email OTP Login.");
      return;
    }
    if (otpLoginEnabled && !settings?.authKeySet) {
      toast.error("MSG91_AUTH_KEY is not configured on the server.");
      return;
    }
    if (otpLoginEnabled && (!settings?.templateIdSet || !settings?.fromEmailSet)) {
      toast.error("MSG91_EMAIL_TEMPLATE_ID and MSG91_FROM_EMAIL must be set before enabling Email OTP Login.");
      return;
    }
    setSaving(true);
    try {
      const r = await fetch(`${API}/admin/otp-email-settings`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ otpLoginEnabled }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: r.statusText }));
        throw new Error(err?.error ?? "Save failed");
      }
      const data: EmailOtpSettings = await r.json();
      setSettings(data);
      setOtpLoginEnabled(data.otpLoginEnabled);
      toast.success("Email OTP settings saved");
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    if (!isSuperAdmin) return;
    const clean = testEmail.trim();
    if (!clean.includes("@")) { toast.error("Enter a valid email address"); return; }
    setTesting(true);
    setLastTestResult(null);
    try {
      const r = await fetch(`${API}/admin/otp-email-settings/test`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ email: clean }),
      });
      const data: TestResult = await r.json().catch(() => ({ ok: false, message: r.statusText }));
      setLastTestResult(data);
      if (data.ok) {
        setTestEmailUsed(clean);
        setTestStep("sent");
        setTestCode("");
        toast.success(data.message ?? "Test OTP sent. Check your inbox.");
      } else {
        toast.error(data.message ?? data.errorReason ?? "Send failed — check MSG91 config");
      }
    } catch (err: any) {
      toast.error(err?.message ?? "Test send failed");
    } finally {
      setTesting(false);
    }
  }

  async function handleVerify() {
    if (!isSuperAdmin || testCode.trim().length !== 6) {
      toast.error("Enter the 6-digit code you received");
      return;
    }
    setVerifying(true);
    try {
      const r = await fetch(`${API}/admin/otp-email-settings/test/verify`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ email: testEmailUsed, code: testCode.trim() }),
      });
      const data = await r.json().catch(() => ({ ok: false, error: r.statusText }));
      if (data.ok) {
        setTestStep("verified");
        setSettings((prev) => prev ? { ...prev, testVerified: true } : prev);
        toast.success(data.message ?? "Email OTP delivery verified!");
      } else {
        toast.error(data.error ?? data.message ?? "Incorrect code. Try again.");
      }
    } catch (err: any) {
      toast.error(err?.message ?? "Verification failed");
    } finally {
      setVerifying(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="h-6 w-6 animate-spin text-orange-400" />
      </div>
    );
  }

  const cfg = settings;
  const missingRequired = !cfg?.templateIdSet || !cfg?.fromEmailSet;
  const canSendTest = !!cfg?.authKeySet && !!cfg?.templateIdSet && !!cfg?.fromEmailSet;
  const canEnableLogin = !!cfg?.testVerified && !!cfg?.authKeySet && !!cfg?.templateIdSet && !!cfg?.fromEmailSet;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Mail className="h-6 w-6 text-orange-400" />
        <div>
          <h1 className="text-xl font-semibold text-white">Email OTP Settings</h1>
          <p className="text-sm text-zinc-400">
            Configure MSG91 Email API for one-time passwords sent during login and password reset.
            Separate from SMS/DLT settings.
          </p>
        </div>
        {cfg?.testVerified && (
          <Badge variant="outline" className="ml-auto bg-green-500/10 text-green-400 border-green-500/30 gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5" /> Email Verified
          </Badge>
        )}
      </div>

      {!isSuperAdmin && (
        <div className="flex items-center gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-300">
          <Lock className="h-4 w-4 shrink-0" />
          <span>Viewing only — only Super Admins can modify these settings.</span>
        </div>
      )}

      {/* Environment Configuration Status */}
      <Card className="border-zinc-800 bg-zinc-900">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-zinc-400" />
            <CardTitle className="text-base text-white">Server Environment Configuration</CardTitle>
          </div>
          <CardDescription className="text-zinc-400">
            These values are read from environment variables on the VPS. To change them, update
            <code className="mx-1 bg-zinc-800 px-1 rounded text-orange-300 text-xs">/var/www/rasokart/.env</code>
            and restart PM2 with <code className="bg-zinc-800 px-1 rounded text-orange-300 text-xs">pm2 restart rasokart-api --update-env</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1">
          <StatusRow
            label="Email Provider"
            value="MSG91 Email API"
            status="ok"
          />
          <StatusRow
            label="MSG91_AUTH_KEY"
            value={cfg?.authKeySet ? "Configured ••••••••••••••••" : "NOT SET — add to .env"}
            status={cfg?.authKeySet ? "ok" : "error"}
          />

          {/* Template ID — required, no fallback */}
          <div className="flex items-start gap-2 py-1.5">
            <span className="text-sm text-zinc-400 w-40 shrink-0">MSG91_EMAIL_TEMPLATE_ID</span>
            <span className="flex items-center flex-wrap gap-1 text-sm">
              {cfg?.templateIdSet
                ? <code className="bg-zinc-800 px-1.5 py-0.5 rounded text-orange-300 text-xs font-mono">{cfg.templateId}</code>
                : <span className="text-red-400 text-xs flex items-center gap-1">
                    <XCircle className="h-3.5 w-3.5 shrink-0" />
                    Required — get exact ID from MSG91 → Email → Templates
                  </span>
              }
              {cfg && <SourceBadge source={cfg.templateIdSource} />}
            </span>
          </div>

          {/* From Email — required, no fallback */}
          <div className="flex items-start gap-2 py-1.5">
            <span className="text-sm text-zinc-400 w-40 shrink-0">MSG91_FROM_EMAIL</span>
            <span className="flex items-center flex-wrap gap-1 text-sm">
              {cfg?.fromEmailSet
                ? <code className="bg-zinc-800 px-1.5 py-0.5 rounded text-orange-300 text-xs font-mono">{cfg.fromEmail}</code>
                : <span className="text-red-400 text-xs flex items-center gap-1">
                    <XCircle className="h-3.5 w-3.5 shrink-0" />
                    Required — use verified sender for notify.rasokart.com
                  </span>
              }
              {cfg && <SourceBadge source={cfg.fromEmailSource} />}
            </span>
          </div>

          {/* From Name */}
          <div className="flex items-start gap-2 py-1.5">
            <span className="text-sm text-zinc-400 w-40 shrink-0">MSG91_FROM_NAME</span>
            <span className="flex items-center text-sm text-white">
              <code className="bg-zinc-800 px-1.5 py-0.5 rounded text-orange-300 text-xs font-mono">{cfg?.fromName}</code>
              {cfg && <SourceBadge source={cfg.fromNameSource} />}
            </span>
          </div>

          {/* Sender Domain */}
          <div className="flex items-start gap-2 py-1.5">
            <span className="text-sm text-zinc-400 w-40 shrink-0">MSG91_EMAIL_DOMAIN</span>
            <span className="flex items-center text-sm text-white">
              <code className="bg-zinc-800 px-1.5 py-0.5 rounded text-orange-300 text-xs font-mono">{cfg?.senderDomain}</code>
              {cfg && <SourceBadge source={cfg.domainSource} />}
              {cfg?.domainSource === "default" && (
                <span className="ml-2 text-xs text-zinc-500">(notify.rasokart.com is verified — optional to override)</span>
              )}
            </span>
          </div>

          <StatusRow
            label="OTP Expiry"
            value={cfg ? `${cfg.otpExpirySeconds / 60} minutes (${cfg.otpExpirySeconds}s)` : "—"}
            status="ok"
          />
          <StatusRow
            label="Resend Cooldown"
            value={cfg ? `${cfg.resendCooldownSeconds} seconds` : "—"}
            status="ok"
          />

          {/* Missing auth key */}
          {!cfg?.authKeySet && (
            <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300 space-y-1">
              <p className="font-medium flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" /> MSG91_AUTH_KEY not configured
              </p>
              <p>SSH into the VPS and add it to <code className="text-amber-300">/var/www/rasokart/.env</code>, then:</p>
              <code className="block bg-black/40 rounded px-2 py-1 font-mono text-amber-300">
                pm2 restart rasokart-api --update-env
              </code>
            </div>
          )}

          {/* Missing required env vars (template ID or from email) */}
          {cfg?.authKeySet && missingRequired && (
            <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300 space-y-2">
              <p className="font-medium flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" /> Required env vars missing — email OTP will be refused until set
              </p>
              <p>Add the following to <code className="text-amber-300">/var/www/rasokart/.env</code> on the VPS:</p>
              {!cfg.templateIdSet && (
                <code className="block bg-black/40 rounded px-2 py-1 font-mono text-amber-300">
                  MSG91_EMAIL_TEMPLATE_ID=&lt;exact_id_from_MSG91_Templates&gt;
                </code>
              )}
              {!cfg.fromEmailSet && (
                <code className="block bg-black/40 rounded px-2 py-1 font-mono text-amber-300">
                  MSG91_FROM_EMAIL=&lt;verified_sender@notify.rasokart.com&gt;
                </code>
              )}
              <code className="block bg-black/40 rounded px-2 py-1 font-mono text-amber-300">
                MSG91_FROM_NAME=RasoKart
              </code>
              <code className="block bg-black/40 rounded px-2 py-1 font-mono text-amber-300">
                MSG91_EMAIL_DOMAIN=notify.rasokart.com
              </code>
              <code className="block bg-black/40 rounded px-2 py-1 font-mono text-amber-300">
                pm2 restart rasokart-api --update-env
              </code>
              <Separator className="bg-red-500/20" />
              <p className="text-zinc-400">
                <span className="font-medium text-zinc-300">Where to find the template ID:</span>{" "}
                MSG91 dashboard → Email → Templates → click your OTP template → copy the Template ID shown at the top.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Email OTP Login Access */}
      <Card className="border-zinc-800 bg-zinc-900">
        <CardHeader>
          <CardTitle className="text-base text-white">Email OTP Login Access</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <p className="text-sm font-medium text-white">Enable Email OTP Login</p>
              <p className="text-xs text-zinc-400 mt-0.5">
                Merchants can log in using their registered email + OTP sent via MSG91.
              </p>
              {!cfg?.testVerified && (
                <p className="text-xs text-amber-400 mt-1 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3 shrink-0" />
                  Verify email delivery via the test below before enabling.
                </p>
              )}
              {!cfg?.authKeySet && (
                <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
                  <XCircle className="h-3 w-3 shrink-0" />
                  MSG91_AUTH_KEY must be set before enabling.
                </p>
              )}
              {cfg?.authKeySet && !cfg?.templateIdSet && (
                <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
                  <XCircle className="h-3 w-3 shrink-0" />
                  MSG91_EMAIL_TEMPLATE_ID must be set before enabling.
                </p>
              )}
              {cfg?.authKeySet && !cfg?.fromEmailSet && (
                <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
                  <XCircle className="h-3 w-3 shrink-0" />
                  MSG91_FROM_EMAIL must be set before enabling.
                </p>
              )}
            </div>
            <Switch
              checked={otpLoginEnabled}
              onCheckedChange={canEnableLogin ? setOtpLoginEnabled : undefined}
              disabled={!isSuperAdmin || !canEnableLogin}
            />
          </div>

          {isSuperAdmin && (
            <div className="flex justify-end">
              <Button
                onClick={handleSave}
                disabled={saving}
                size="sm"
                className="bg-orange-500 hover:bg-orange-600 text-white"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                Save Settings
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Test & Verify */}
      {isSuperAdmin && (
        <Card className="border-zinc-800 bg-zinc-900">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base text-white">Send Test Email OTP</CardTitle>
                <CardDescription className="text-zinc-400">
                  Send a real OTP via MSG91 to confirm delivery before enabling Email OTP Login.
                  Requires all three env vars (AUTH_KEY, TEMPLATE_ID, FROM_EMAIL) to be set on the VPS.
                </CardDescription>
              </div>
              {testStep === "verified" && (
                <Badge variant="outline" className="bg-green-500/10 text-green-400 border-green-500/30 gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Delivery Verified
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {!canSendTest && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300 space-y-1">
                <p className="font-medium flex items-center gap-1.5">
                  <XCircle className="h-3.5 w-3.5" /> Cannot send test OTP — configure missing env vars on the VPS first
                </p>
                {!cfg?.authKeySet && <p>• MSG91_AUTH_KEY is not set</p>}
                {!cfg?.templateIdSet && <p>• MSG91_EMAIL_TEMPLATE_ID is not set</p>}
                {!cfg?.fromEmailSet && <p>• MSG91_FROM_EMAIL is not set</p>}
              </div>
            )}

            {testStep === "idle" || testStep === "verified" ? (
              <div className="flex gap-3">
                <div className="flex-1">
                  <Label className="text-zinc-300 text-xs mb-1.5 block">Recipient Email (your real Gmail inbox)</Label>
                  <Input
                    type="email"
                    placeholder="you@gmail.com"
                    value={testEmail}
                    onChange={(e) => setTestEmail(e.target.value)}
                    className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500"
                  />
                </div>
                <div className="flex items-end">
                  <Button
                    onClick={handleTest}
                    disabled={testing || !canSendTest}
                    className="bg-zinc-700 hover:bg-zinc-600 text-white disabled:opacity-40"
                  >
                    {testing
                      ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      : <TestTube2 className="h-4 w-4 mr-2" />}
                    Send Test OTP
                  </Button>
                </div>
              </div>
            ) : null}

            {testStep === "sent" && (
              <div className="space-y-3">
                <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 text-sm text-blue-300">
                  <p>Test OTP sent to <strong>{testEmailUsed}</strong>. Check your inbox (and spam folder).</p>
                  <p className="text-xs mt-1 text-blue-400">Also check MSG91 → Logs to confirm the request was accepted.</p>
                </div>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <Label className="text-zinc-300 text-xs mb-1.5 block">Enter the 6-digit code from your inbox</Label>
                    <Input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="000000"
                      value={testCode}
                      onChange={(e) => setTestCode(e.target.value.replace(/\D/g, ""))}
                      className="bg-zinc-800 border-zinc-700 text-white font-mono tracking-widest text-center text-lg"
                    />
                  </div>
                  <div className="flex items-end gap-2">
                    <Button
                      onClick={handleVerify}
                      disabled={verifying || testCode.trim().length !== 6}
                      className="bg-green-600 hover:bg-green-700 text-white"
                    >
                      {verifying
                        ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        : <CheckCircle2 className="h-4 w-4 mr-2" />}
                      Verify
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-zinc-400"
                      onClick={() => { setTestStep("idle"); setTestCode(""); setLastTestResult(null); }}
                    >
                      <RefreshCw className="h-4 w-4 mr-1" /> Resend
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* MSG91 Response Details */}
            {lastTestResult && (
              <div className={`rounded-lg border p-4 space-y-3 text-xs ${lastTestResult.ok
                ? "border-green-500/30 bg-green-500/10"
                : "border-red-500/30 bg-red-500/10"}`}>
                <div className="flex items-center gap-2 font-medium text-sm">
                  {lastTestResult.ok
                    ? <CheckCircle2 className="h-4 w-4 text-green-400" />
                    : <XCircle className="h-4 w-4 text-red-400" />}
                  <span className={lastTestResult.ok ? "text-green-300" : "text-red-300"}>
                    MSG91 {lastTestResult.ok ? "Accepted" : "Rejected"}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-zinc-400">
                  {lastTestResult.recipientMasked && (
                    <>
                      <span>Recipient</span>
                      <span className="text-white font-mono">{lastTestResult.recipientMasked}</span>
                    </>
                  )}
                  {lastTestResult.templateId && (
                    <>
                      <span>Template ID</span>
                      <span className="text-white font-mono">{lastTestResult.templateId}</span>
                    </>
                  )}
                  {lastTestResult.fromEmail && (
                    <>
                      <span>From Email</span>
                      <span className="text-white font-mono">{lastTestResult.fromEmail}</span>
                    </>
                  )}
                  {lastTestResult.senderDomain && (
                    <>
                      <span>Sender Domain</span>
                      <span className="text-white font-mono">{lastTestResult.senderDomain}</span>
                    </>
                  )}
                  {lastTestResult.msg91StatusCode != null && (
                    <>
                      <span>HTTP Status</span>
                      <span className={`font-mono ${(lastTestResult.msg91StatusCode ?? 0) < 400 ? "text-green-400" : "text-red-400"}`}>
                        {lastTestResult.msg91StatusCode}
                      </span>
                    </>
                  )}
                  {lastTestResult.errorReason && (
                    <>
                      <span>Error Reason</span>
                      <span className="text-red-300 font-medium">{lastTestResult.errorReason}</span>
                    </>
                  )}
                </div>

                {lastTestResult.msg91Response != null && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 text-zinc-500">
                      <Eye className="h-3 w-3" /> MSG91 Response Body
                    </div>
                    <pre className="bg-black/40 rounded p-2 text-zinc-300 overflow-x-auto text-xs leading-relaxed max-h-48 overflow-y-auto">
                      {JSON.stringify(lastTestResult.msg91Response, null, 2)}
                    </pre>
                  </div>
                )}

                {!lastTestResult.ok && (
                  <div className="text-zinc-400 space-y-1">
                    <p className="font-medium text-zinc-300">Diagnostic checklist:</p>
                    <ul className="list-disc list-inside space-y-0.5 text-zinc-500">
                      <li>Check MSG91 → Logs → Failed Requests for the exact rejection reason</li>
                      <li>Verify the Template ID in MSG91 → Email → Templates (must be exact)</li>
                      <li>Verify the sender domain in MSG91 → Email → Domains (notify.rasokart.com)</li>
                      <li>Check MSG91 → Email → Suppressions for blocked addresses</li>
                      <li>Confirm outbound IP 167.233.77.68 is whitelisted in MSG91 → Settings → IP Security</li>
                      <li>Confirm MSG91_AUTH_KEY belongs to the RasoKartOTP key (Email OTP API rule)</li>
                    </ul>
                  </div>
                )}
              </div>
            )}

            {cfg?.testVerifiedAt && (
              <p className="text-xs text-zinc-500">
                Last verified: {new Date(cfg.testVerifiedAt).toLocaleString()}
                {cfg.updatedByEmail && ` by ${cfg.updatedByEmail}`}
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
