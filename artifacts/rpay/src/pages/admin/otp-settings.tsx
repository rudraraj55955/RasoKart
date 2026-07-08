import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MessageSquare, Save, TestTube2, Lock, RefreshCw, ChevronDown, ChevronUp, AlertCircle, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useGetMe } from "@workspace/api-client-react";

const BASE_URL = import.meta.env.BASE_URL ?? "/";
const API = `${BASE_URL}api`.replace(/\/+/g, "/").replace(/\/$/, "");

const TOKEN_KEY = "rasokart_token";

function authHeaders() {
  const t = localStorage.getItem(TOKEN_KEY);
  return { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) };
}

const MASKED_KEY = "••••••••••••••••";

const PROVIDERS = [
  { value: "msg91", label: "MSG91" },
  { value: "2factor", label: "2Factor" },
  { value: "twilio", label: "Twilio" },
];

interface OtpSettings {
  id: number;
  provider: string;
  apiKeySet: boolean;
  apiKeyMasked: string | null;
  senderId: string | null;
  dltEntityId: string | null;
  dltTemplateId: string | null;
  otpTemplateText: string | null;
  otpExpirySeconds: number;
  maxResendCount: number;
  maxVerifyAttempts: number;
  otpLoginEnabled: boolean;
  smsFallbackEnabled: boolean;
  fallbackProvider: string | null;
  fallbackApiKeySet: boolean;
  fallbackApiKeyMasked: string | null;
  fallbackSenderId: string | null;
  fallbackDltTemplateId: string | null;
  updatedByEmail: string | null;
  updatedAt: string | null;
}

interface SmsLog {
  id: number;
  mobileMasked: string;
  otpPurpose: string | null;
  providerUsed: string;
  status: string;
  fallbackAttempted: boolean;
  fallbackProviderUsed: string | null;
  providerMsgId: string | null;
  errorReason: string | null;
  createdAt: string;
}

const DEFAULT_TEMPLATE = "Your login code is {otp}. Valid for 5 minutes. Do not share.";

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  success: { label: "Sent", className: "bg-green-500/20 text-green-400 border-green-500/30" },
  fallback_success: { label: "Sent (fallback)", className: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  failed: { label: "Failed", className: "bg-red-500/20 text-red-400 border-red-500/30" },
  fallback_failed: { label: "All failed", className: "bg-red-600/20 text-red-400 border-red-600/30" },
};

export default function AdminOtpSettings() {
  const { data: me } = useGetMe();
  const isSuperAdmin = me?.isSuperAdmin ?? false;

  const [settings, setSettings] = useState<OtpSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testMobile, setTestMobile] = useState("");

  const [provider, setProvider] = useState("msg91");
  const [apiKey, setApiKey] = useState("");
  const [senderId, setSenderId] = useState("");
  const [dltEntityId, setDltEntityId] = useState("");
  const [dltTemplateId, setDltTemplateId] = useState("");
  const [templateText, setTemplateText] = useState(DEFAULT_TEMPLATE);
  const [expirySeconds, setExpirySeconds] = useState(300);
  const [maxResend, setMaxResend] = useState(3);
  const [maxAttempts, setMaxAttempts] = useState(5);
  const [otpLoginEnabled, setOtpLoginEnabled] = useState(false);
  const [fallbackEnabled, setFallbackEnabled] = useState(false);
  const [fallbackProvider, setFallbackProvider] = useState("2factor");
  const [fallbackApiKey, setFallbackApiKey] = useState("");
  const [fallbackSenderId, setFallbackSenderId] = useState("");
  const [fallbackDltTemplateId, setFallbackDltTemplateId] = useState("");

  const [logs, setLogs] = useState<SmsLog[]>([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [logsPage, setLogsPage] = useState(1);
  const [logsLoading, setLogsLoading] = useState(false);
  const [showLogs, setShowLogs] = useState(false);

  async function fetchSettings() {
    setLoading(true);
    try {
      const r = await fetch(`${API}/admin/otp-settings`, { headers: authHeaders() });
      if (!r.ok) throw new Error(await r.text());
      const data: OtpSettings = await r.json();
      setSettings(data);
      setProvider(data.provider ?? "msg91");
      setApiKey(data.apiKeySet ? MASKED_KEY : "");
      setSenderId(data.senderId ?? "");
      setDltEntityId(data.dltEntityId ?? "");
      setDltTemplateId(data.dltTemplateId ?? "");
      setTemplateText(data.otpTemplateText ?? DEFAULT_TEMPLATE);
      setExpirySeconds(data.otpExpirySeconds ?? 300);
      setMaxResend(data.maxResendCount ?? 3);
      setMaxAttempts(data.maxVerifyAttempts ?? 5);
      setOtpLoginEnabled(data.otpLoginEnabled ?? false);
      setFallbackEnabled(data.smsFallbackEnabled ?? false);
      setFallbackProvider(data.fallbackProvider ?? "2factor");
      setFallbackApiKey(data.fallbackApiKeySet ? MASKED_KEY : "");
      setFallbackSenderId(data.fallbackSenderId ?? "");
      setFallbackDltTemplateId(data.fallbackDltTemplateId ?? "");
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to load OTP settings");
    } finally {
      setLoading(false);
    }
  }

  async function fetchLogs(page = 1) {
    setLogsLoading(true);
    try {
      const r = await fetch(`${API}/admin/sms-logs?page=${page}&limit=25`, { headers: authHeaders() });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      setLogs(data.logs ?? []);
      setLogsTotal(data.total ?? 0);
      setLogsPage(page);
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to load SMS logs");
    } finally {
      setLogsLoading(false);
    }
  }

  useEffect(() => { fetchSettings(); }, []);

  useEffect(() => {
    if (showLogs) fetchLogs(1);
  }, [showLogs]);

  async function handleSave() {
    if (!isSuperAdmin) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        provider,
        senderId: senderId.trim() || null,
        dltEntityId: dltEntityId.trim() || null,
        dltTemplateId: dltTemplateId.trim() || null,
        otpTemplateText: templateText.trim() || DEFAULT_TEMPLATE,
        otpExpirySeconds: expirySeconds,
        maxResendCount: maxResend,
        maxVerifyAttempts: maxAttempts,
        otpLoginEnabled,
        smsFallbackEnabled: fallbackEnabled,
        fallbackProvider: fallbackEnabled ? (fallbackProvider || null) : null,
        fallbackSenderId: fallbackEnabled ? (fallbackSenderId.trim() || null) : null,
        fallbackDltTemplateId: fallbackEnabled ? (fallbackDltTemplateId.trim() || null) : null,
      };
      if (apiKey && apiKey !== MASKED_KEY) body["apiKey"] = apiKey;
      if (fallbackEnabled && fallbackApiKey && fallbackApiKey !== MASKED_KEY) body["fallbackApiKey"] = fallbackApiKey;

      const r = await fetch(`${API}/admin/otp-settings`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: r.statusText }));
        throw new Error(err?.error ?? "Save failed");
      }
      const data: OtpSettings = await r.json();
      setSettings(data);
      if (apiKey && apiKey !== MASKED_KEY) setApiKey(MASKED_KEY);
      if (fallbackApiKey && fallbackApiKey !== MASKED_KEY) setFallbackApiKey(MASKED_KEY);
      toast.success("OTP settings saved");
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    if (!isSuperAdmin) return;
    const digits = testMobile.replace(/\D/g, "");
    if (digits.length < 10) { toast.error("Enter a valid mobile number (min 10 digits)"); return; }
    setTesting(true);
    try {
      const r = await fetch(`${API}/admin/otp-settings/test`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ mobile: digits }),
      });
      const data = await r.json().catch(() => ({ ok: false, message: r.statusText }));
      if (data.ok) {
        toast.success(data.message ?? "Test OTP sent");
      } else {
        toast.error(data.message ?? data.error ?? "Test failed — check provider config");
      }
    } catch (err: any) {
      toast.error(err?.message ?? "Test send failed");
    } finally {
      setTesting(false);
    }
  }

  function formatDate(str: string) {
    try { return new Date(str).toLocaleString(); } catch { return str; }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="h-6 w-6 animate-spin text-orange-400" />
      </div>
    );
  }

  const providerNote: Record<string, string> = {
    msg91: "API key from MSG91 dashboard (authkey). DLT Template ID required for India.",
    "2factor": "API key from 2Factor.in. Template name goes in DLT Template ID field.",
    twilio: "API key format: AccountSid:AuthToken. Sender ID = your Twilio phone number.",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <MessageSquare className="h-6 w-6 text-orange-400" />
        <div>
          <h1 className="text-xl font-semibold text-white">OTP / SMS Settings</h1>
          <p className="text-sm text-zinc-400">Configure SMS delivery for one-time passwords sent during login and password reset.</p>
        </div>
      </div>

      {!isSuperAdmin && (
        <div className="flex items-center gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-300">
          <Lock className="h-4 w-4 shrink-0" />
          <span>Viewing only — only Super Admins can modify these settings.</span>
        </div>
      )}

      {/* Primary Provider */}
      <Card className="border-zinc-800 bg-zinc-900">
        <CardHeader>
          <CardTitle className="text-base text-white">Primary SMS Provider</CardTitle>
          <CardDescription className="text-zinc-400">
            Used to dispatch OTP codes to merchant mobile numbers.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-1.5">
              <Label className="text-zinc-300">Provider</Label>
              <Select value={provider} onValueChange={setProvider} disabled={!isSuperAdmin}>
                <SelectTrigger className="bg-zinc-800 border-zinc-700 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-700">
                  {PROVIDERS.map((p) => (
                    <SelectItem key={p.value} value={p.value} className="text-white focus:bg-zinc-700">
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {providerNote[provider] && (
                <p className="text-xs text-zinc-500 mt-1">{providerNote[provider]}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-zinc-300">API Key</Label>
              <Input
                type="password"
                placeholder={settings?.apiKeySet ? "Update key (leave blank to keep existing)" : "Enter API key"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                disabled={!isSuperAdmin}
                className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500"
              />
              {settings?.apiKeySet && (
                <p className="text-xs text-zinc-500">API key is set and encrypted.</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-zinc-300">Sender ID</Label>
              <Input
                placeholder={provider === "twilio" ? "Your Twilio number, e.g. +19876543210" : "e.g. RASKRT"}
                value={senderId}
                onChange={(e) => setSenderId(e.target.value)}
                disabled={!isSuperAdmin}
                className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-zinc-300">DLT Entity ID <span className="text-zinc-500 font-normal">(India, optional)</span></Label>
              <Input
                placeholder="e.g. 1234567890123456789"
                value={dltEntityId}
                onChange={(e) => setDltEntityId(e.target.value)}
                disabled={!isSuperAdmin}
                className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-zinc-300">DLT Template ID</Label>
              <Input
                placeholder={provider === "2factor" ? "Template name" : "e.g. 1234567890123456789"}
                value={dltTemplateId}
                onChange={(e) => setDltTemplateId(e.target.value)}
                disabled={!isSuperAdmin}
                className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-zinc-300">OTP Message Template</Label>
            <Textarea
              placeholder="Your login code is {otp}. Valid for 5 minutes."
              value={templateText}
              onChange={(e) => setTemplateText(e.target.value)}
              disabled={!isSuperAdmin}
              rows={2}
              className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500 resize-none"
            />
            <p className="text-xs text-zinc-500">Use <code className="bg-zinc-800 px-1 rounded text-orange-300">{"{otp}"}</code> as the placeholder for the 6-digit code.</p>
          </div>
        </CardContent>
      </Card>

      {/* Limits & Toggle */}
      <Card className="border-zinc-800 bg-zinc-900">
        <CardHeader>
          <CardTitle className="text-base text-white">Limits & Access</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <div className="space-y-1.5">
              <Label className="text-zinc-300">OTP Expiry (seconds)</Label>
              <Input
                type="number"
                min={60}
                max={900}
                value={expirySeconds}
                onChange={(e) => setExpirySeconds(parseInt(e.target.value) || 300)}
                disabled={!isSuperAdmin}
                className="bg-zinc-800 border-zinc-700 text-white"
              />
              <p className="text-xs text-zinc-500">{expirySeconds / 60} minute{expirySeconds / 60 !== 1 ? "s" : ""}</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-zinc-300">Max Resend Attempts</Label>
              <Input
                type="number"
                min={1}
                max={10}
                value={maxResend}
                onChange={(e) => setMaxResend(parseInt(e.target.value) || 3)}
                disabled={!isSuperAdmin}
                className="bg-zinc-800 border-zinc-700 text-white"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-zinc-300">Max Verify Attempts</Label>
              <Input
                type="number"
                min={1}
                max={10}
                value={maxAttempts}
                onChange={(e) => setMaxAttempts(parseInt(e.target.value) || 5)}
                disabled={!isSuperAdmin}
                className="bg-zinc-800 border-zinc-700 text-white"
              />
            </div>
          </div>

          <Separator className="bg-zinc-800" />

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-white">Enable SMS OTP Login</p>
              <p className="text-xs text-zinc-400 mt-0.5">Merchants can log in using their registered mobile number + OTP.</p>
            </div>
            <Switch
              checked={otpLoginEnabled}
              onCheckedChange={setOtpLoginEnabled}
              disabled={!isSuperAdmin}
            />
          </div>
        </CardContent>
      </Card>

      {/* Fallback Provider */}
      <Card className="border-zinc-800 bg-zinc-900">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base text-white">Fallback Provider</CardTitle>
              <CardDescription className="text-zinc-400 mt-1">
                Used automatically if the primary provider fails to deliver the OTP.
              </CardDescription>
            </div>
            <Switch
              checked={fallbackEnabled}
              onCheckedChange={setFallbackEnabled}
              disabled={!isSuperAdmin}
            />
          </div>
        </CardHeader>
        {fallbackEnabled && (
          <CardContent className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="space-y-1.5">
                <Label className="text-zinc-300">Fallback Provider</Label>
                <Select value={fallbackProvider} onValueChange={setFallbackProvider} disabled={!isSuperAdmin}>
                  <SelectTrigger className="bg-zinc-800 border-zinc-700 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-900 border-zinc-700">
                    {PROVIDERS.filter((p) => p.value !== provider).map((p) => (
                      <SelectItem key={p.value} value={p.value} className="text-white focus:bg-zinc-700">
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-zinc-300">Fallback API Key</Label>
                <Input
                  type="password"
                  placeholder={settings?.fallbackApiKeySet ? "Update key (leave blank to keep)" : "Enter API key"}
                  value={fallbackApiKey}
                  onChange={(e) => setFallbackApiKey(e.target.value)}
                  disabled={!isSuperAdmin}
                  className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500"
                />
                {settings?.fallbackApiKeySet && (
                  <p className="text-xs text-zinc-500">Fallback key is set and encrypted.</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label className="text-zinc-300">Fallback Sender ID</Label>
                <Input
                  placeholder="Sender ID for fallback provider"
                  value={fallbackSenderId}
                  onChange={(e) => setFallbackSenderId(e.target.value)}
                  disabled={!isSuperAdmin}
                  className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-zinc-300">Fallback DLT Template ID</Label>
                <Input
                  placeholder="Template ID / name for fallback"
                  value={fallbackDltTemplateId}
                  onChange={(e) => setFallbackDltTemplateId(e.target.value)}
                  disabled={!isSuperAdmin}
                  className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500"
                />
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Test + Save */}
      {isSuperAdmin && (
        <Card className="border-zinc-800 bg-zinc-900">
          <CardHeader>
            <CardTitle className="text-base text-white">Test SMS Delivery</CardTitle>
            <CardDescription className="text-zinc-400">
              Sends a test OTP to the number you enter using the current saved configuration.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-3">
              <Input
                placeholder="Mobile number (e.g. 9876543210)"
                value={testMobile}
                onChange={(e) => setTestMobile(e.target.value)}
                className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500 max-w-xs"
              />
              <Button
                variant="outline"
                onClick={handleTest}
                disabled={testing || !testMobile}
                className="border-zinc-600 text-zinc-300 hover:bg-zinc-700"
              >
                {testing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <TestTube2 className="h-4 w-4 mr-2" />}
                Send Test OTP
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isSuperAdmin && (
        <div className="flex justify-end">
          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-orange-500 hover:bg-orange-600 text-white"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            Save Settings
          </Button>
        </div>
      )}

      {/* SMS Logs */}
      <Card className="border-zinc-800 bg-zinc-900">
        <CardHeader
          className="cursor-pointer select-none"
          onClick={() => setShowLogs((v) => !v)}
        >
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base text-white">SMS Delivery Logs</CardTitle>
              <CardDescription className="text-zinc-400 mt-1">
                Recent OTP SMS send attempts — mobile numbers are masked.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {showLogs && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => { e.stopPropagation(); fetchLogs(logsPage); }}
                  className="h-7 w-7 text-zinc-400 hover:text-white"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              )}
              {showLogs ? <ChevronUp className="h-4 w-4 text-zinc-400" /> : <ChevronDown className="h-4 w-4 text-zinc-400" />}
            </div>
          </div>
        </CardHeader>

        {showLogs && (
          <CardContent>
            {logsLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-orange-400" />
              </div>
            ) : logs.length === 0 ? (
              <p className="text-center text-zinc-500 py-8 text-sm">No SMS logs yet.</p>
            ) : (
              <>
                <div className="rounded-lg border border-zinc-800 overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-zinc-800 hover:bg-transparent">
                        <TableHead className="text-zinc-400">Mobile</TableHead>
                        <TableHead className="text-zinc-400">Purpose</TableHead>
                        <TableHead className="text-zinc-400">Provider</TableHead>
                        <TableHead className="text-zinc-400">Status</TableHead>
                        <TableHead className="text-zinc-400">Error</TableHead>
                        <TableHead className="text-zinc-400">Time</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {logs.map((log) => {
                        const badge = STATUS_BADGE[log.status] ?? { label: log.status, className: "bg-zinc-700 text-zinc-300" };
                        return (
                          <TableRow key={log.id} className="border-zinc-800 hover:bg-zinc-800/50">
                            <TableCell className="text-zinc-300 font-mono text-sm">{log.mobileMasked}</TableCell>
                            <TableCell className="text-zinc-400 text-sm capitalize">{(log.otpPurpose ?? "—").replace("_", " ").toLowerCase()}</TableCell>
                            <TableCell className="text-zinc-400 text-sm">
                              {log.fallbackAttempted && log.fallbackProviderUsed
                                ? `${log.providerUsed} → ${log.fallbackProviderUsed}`
                                : log.providerUsed}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className={`text-xs border ${badge.className}`}>
                                {badge.label}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-zinc-500 text-xs max-w-[200px] truncate">
                              {log.errorReason ?? "—"}
                            </TableCell>
                            <TableCell className="text-zinc-500 text-xs">{formatDate(log.createdAt)}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                {logsTotal > 25 && (
                  <div className="flex justify-between items-center mt-4 text-sm text-zinc-400">
                    <span>{logsTotal} total entries</span>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => fetchLogs(logsPage - 1)}
                        disabled={logsPage <= 1}
                        className="border-zinc-700 text-zinc-300 h-7"
                      >
                        Prev
                      </Button>
                      <span className="px-2 py-1">Page {logsPage}</span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => fetchLogs(logsPage + 1)}
                        disabled={logsPage * 25 >= logsTotal}
                        className="border-zinc-700 text-zinc-300 h-7"
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        )}
      </Card>

      {settings?.updatedByEmail && (
        <p className="text-xs text-zinc-500 text-right">
          Last updated by {settings.updatedByEmail}
          {settings.updatedAt ? ` on ${formatDate(settings.updatedAt)}` : ""}
        </p>
      )}
    </div>
  );
}
