import { useState } from "react";
import { Eye, EyeOff, Save, Loader2, AlertCircle, CheckCircle2, RefreshCw, Copy, ExternalLink, Info } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  useGetCashfreePayoutConfig,
  useUpdateCashfreePayoutConfig,
  getGetCashfreePayoutConfigQueryKey,
} from "@workspace/api-client-react";
import { getToken } from "@/lib/auth";

const AUTH_HEADERS = { Authorization: `Bearer ${getToken()}` };
const WEBHOOK_URL = "https://rasokart.com/api/webhooks/payouts/cashfree";

function SecretField({
  label,
  placeholder,
  value,
  onChange,
  isSet,
  maskedValue,
  description,
  required,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  isSet?: boolean;
  maskedValue?: string;
  description?: string;
  required?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1">
        {label}
        {required && <span className="text-rose-400">*</span>}
      </Label>
      {isSet && (
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
          Saved:{" "}
          {maskedValue ? (
            <code className="font-mono">{maskedValue}</code>
          ) : (
            <span>A value is configured.</span>
          )}
        </p>
      )}
      {!isSet && required && (
        <p className="text-xs text-rose-400 flex items-center gap-1">
          <AlertCircle className="w-3 h-3 shrink-0" />
          Not configured — required for payouts to work
        </p>
      )}
      <div className="relative">
        <Input
          type={show ? "text" : "password"}
          placeholder={isSet ? `Enter new ${label} to replace` : placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="pr-10"
        />
        <button
          type="button"
          onClick={() => setShow((p) => !p)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
        >
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-7 px-2 text-xs"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
    </Button>
  );
}

export default function AdminPayoutGateway() {
  const qc = useQueryClient();
  const { data: config, isLoading } = useGetCashfreePayoutConfig({
    request: { headers: AUTH_HEADERS },
  });

  const { mutateAsync: updateConfig } = useUpdateCashfreePayoutConfig({
    request: { headers: AUTH_HEADERS },
    mutation: {},
  });

  // Credential fields
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [fundsourceId, setFundsourceId] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");

  // Gateway settings
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [env, setEnv] = useState<"test" | "live" | null>(null);
  const [baseUrl, setBaseUrl] = useState<string | null>(null);
  const [apiVersion, setApiVersion] = useState<string | null>(null);

  // Business rules
  const [merchantEnabled, setMerchantEnabled] = useState<boolean | null>(null);
  const [adminApprovalRequired, setAdminApprovalRequired] = useState<boolean | null>(null);
  const [minLimit, setMinLimit] = useState<string | null>(null);
  const [maxLimit, setMaxLimit] = useState<string | null>(null);
  const [dailyLimit, setDailyLimit] = useState<string | null>(null);

  // UI state
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Derived
  const currentEnabled = enabled !== null ? enabled : (config?.enabled ?? false);
  const currentEnv: "test" | "live" = env !== null ? env : (config?.env ?? "test");
  const currentMerchantEnabled = merchantEnabled !== null ? merchantEnabled : (config?.merchantEnabled ?? true);
  const currentAdminApproval = adminApprovalRequired !== null ? adminApprovalRequired : (config?.adminApprovalRequired ?? true);
  const currentBaseUrl = baseUrl !== null ? baseUrl : (config?.baseUrl ?? "");
  const currentApiVersion = apiVersion !== null ? apiVersion : (config?.apiVersion ?? "2024-01-01");
  const currentMinLimit = minLimit !== null ? minLimit : String(config?.minLimit ?? 100);
  const currentMaxLimit = maxLimit !== null ? maxLimit : String(config?.maxLimit ?? 200000);
  const currentDailyLimit = dailyLimit !== null ? dailyLimit : String(config?.dailyLimit ?? 1000000);

  const missingCredentials = !isLoading && config && (!config.clientIdSet || !config.clientSecretSet);
  const missingFundsource = !isLoading && config && !config.fundsourceIdSet;

  async function handleSave() {
    setSaving(true);
    setTestResult(null);
    try {
      const body: Record<string, unknown> = {
        enabled: currentEnabled,
        env: currentEnv,
        merchantEnabled: currentMerchantEnabled,
        adminApprovalRequired: currentAdminApproval,
        baseUrl: currentBaseUrl,
        apiVersion: currentApiVersion,
        minLimit: parseFloat(currentMinLimit) || 100,
        maxLimit: parseFloat(currentMaxLimit) || 200000,
        dailyLimit: parseFloat(currentDailyLimit) || 1000000,
      };
      if (clientId.trim()) body.clientId = clientId.trim();
      if (clientSecret.trim()) body.clientSecret = clientSecret.trim();
      if (fundsourceId !== "") body.fundsourceId = fundsourceId.trim();
      if (webhookSecret !== "") body.webhookSecret = webhookSecret.trim();

      await updateConfig({ data: body as any });
      qc.invalidateQueries({ queryKey: getGetCashfreePayoutConfigQueryKey() });
      setClientId("");
      setClientSecret("");
      setFundsourceId("");
      setWebhookSecret("");
      toast.success("Payout gateway settings saved");
    } catch (err: any) {
      toast.error((err?.data as any)?.error ?? err?.message ?? "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  async function handleTestConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/system-config/cashfree-payout/test-connection", {
        method: "POST",
        headers: { Authorization: AUTH_HEADERS.Authorization },
      });
      const data = await res.json();
      setTestResult(data);
      if (data.ok) toast.success(data.message);
      else toast.error(data.message);
    } catch (err: any) {
      const msg = err?.message ?? "Connection test failed";
      setTestResult({ ok: false, message: msg });
      toast.error(msg);
    } finally {
      setTesting(false);
    }
  }

  const canTest = !isLoading && (config?.clientIdSet || clientId.trim().length > 0);

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold">Payout Gateway</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Configure Cashfree Payout API — separate from Payment Collection (Payin) credentials.
        </p>
      </div>

      {/* Health banner */}
      {!isLoading && config && (
        <div className={`rounded-lg border p-3 flex items-start gap-3 text-sm ${
          !config.enabled
            ? "bg-muted/30 border-border/40 text-muted-foreground"
            : missingCredentials
              ? "bg-rose-500/10 border-rose-500/30 text-rose-300"
              : testResult
                ? testResult.ok
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                  : "bg-rose-500/10 border-rose-500/30 text-rose-300"
                : "bg-amber-500/10 border-amber-500/40 text-amber-300"
        }`}>
          {!config.enabled ? (
            <><Info className="w-4 h-4 mt-0.5 shrink-0" /><span>Payout gateway is disabled. Enable it below and configure credentials to start processing payouts.</span></>
          ) : missingCredentials ? (
            <><AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /><span>Payout Client ID or Secret is missing. Payouts will fail until credentials are saved.</span></>
          ) : testResult ? (
            testResult.ok
              ? <><CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /><span>Connection verified: {testResult.message}</span></>
              : <><AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /><span>Connection failed: {testResult.message}</span></>
          ) : (
            <><AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /><span>Credentials configured but not yet verified. Click <strong>Test Payout Connection</strong> to confirm they work.</span></>
          )}
        </div>
      )}

      {/* Payin vs Payout warning */}
      <div className="rounded-md bg-amber-500/10 border border-amber-500/30 p-3 flex gap-2.5">
        <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
        <div className="text-xs text-amber-300 space-y-0.5">
          <p className="font-semibold text-amber-200">Payout credentials are NOT the same as Payin / Payment Collection credentials</p>
          <p>Cashfree issues separate API keys for the <strong>Payout</strong> product. Log into Cashfree Dashboard → <strong>Payout</strong> → Settings → API Keys to get the correct keys. Using Payin keys here will cause "Invalid clientId/clientSecret" errors.</p>
        </div>
      </div>

      {/* ── 1. Gateway Status ── */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <CardTitle className="text-base">Gateway Status</CardTitle>
              <CardDescription className="text-xs mt-0.5">Enable payouts and set the operating mode</CardDescription>
            </div>
            <Badge variant="outline" className={currentEnv === "live" ? "border-emerald-500/50 text-emerald-400" : "border-amber-500/50 text-amber-400"}>
              {currentEnv === "live" ? "Live / Production" : "Sandbox / Test"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Switch checked={currentEnabled} onCheckedChange={setEnabled} id="payout-enabled" />
            <Label htmlFor="payout-enabled" className="cursor-pointer font-normal">
              {currentEnabled ? "Payout gateway enabled" : "Payout gateway disabled"}
            </Label>
          </div>
          <div className="space-y-1.5">
            <Label>Payout Mode</Label>
            <Select value={currentEnv} onValueChange={(v) => setEnv(v as "test" | "live")}>
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="test">Sandbox / Test — no real transfers</SelectItem>
                <SelectItem value="live">Live / Production — real bank transfers</SelectItem>
              </SelectContent>
            </Select>
            {currentEnv === "live" && (
              <p className="text-xs text-amber-400">Live mode — real bank transfers will be initiated for approved payouts.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── 2. Payout API Credentials ── */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            Payout API Credentials
            <Badge variant="outline" className="text-[10px] border-rose-500/40 text-rose-400 font-normal">Separate from Payin keys</Badge>
          </CardTitle>
          <CardDescription className="text-xs">
            From Cashfree Dashboard → Payout → Settings → API Keys.
            {" "}<span className="text-rose-400 font-medium">Do not use Payment Gateway / Payin keys here.</span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SecretField
            label="Payout Client ID"
            placeholder="Enter Payout Client ID"
            value={clientId}
            onChange={setClientId}
            isSet={config?.clientIdSet}
            maskedValue={config?.clientIdMasked}
            required
          />
          <SecretField
            label="Payout Client Secret"
            placeholder="Enter Payout Client Secret"
            value={clientSecret}
            onChange={setClientSecret}
            isSet={config?.clientSecretSet}
            description="Leave blank to keep existing secret."
            required
          />
          <SecretField
            label="Fundsource ID"
            placeholder="Enter Fundsource ID"
            value={fundsourceId}
            onChange={setFundsourceId}
            isSet={config?.fundsourceIdSet}
            maskedValue={config?.fundsourceIdMasked}
            description="Required if your Cashfree Payout account has multiple fund sources (wallets/bank accounts). Find in Cashfree Payout → Settings → Fundsources."
          />
          {missingFundsource && (
            <div className="rounded-md bg-amber-500/10 border border-amber-500/30 p-2.5 flex gap-2 text-xs text-amber-300">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>Fundsource ID not configured. If Cashfree Payout requires it (most accounts do), payouts will fail with "Invalid fundsourceId". Add it above.</span>
            </div>
          )}

          {/* Test connection result */}
          {testResult && (
            <div className={`rounded-md border p-2.5 flex items-start gap-2 text-xs ${
              testResult.ok
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                : "bg-rose-500/10 border-rose-500/30 text-rose-300"
            }`}>
              {testResult.ok
                ? <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                : <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
              <span>{testResult.message}</span>
            </div>
          )}

          <Button
            variant="outline"
            onClick={handleTestConnection}
            disabled={testing || !canTest}
            title={!canTest ? "Save Payout Client ID first before testing" : undefined}
            className="w-full sm:w-auto"
          >
            {testing ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Testing connection…</>
            ) : testResult?.ok ? (
              <><CheckCircle2 className="w-4 h-4 mr-2 text-emerald-400" />Connection verified — Test again</>
            ) : (
              <><RefreshCw className="w-4 h-4 mr-2" />Test Payout Connection</>
            )}
          </Button>
          <p className="text-xs text-muted-foreground">
            Test the connection after saving credentials. Payouts cannot be approved until credentials are verified.
          </p>
        </CardContent>
      </Card>

      {/* ── 3. API Configuration ── */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">API Configuration</CardTitle>
          <CardDescription className="text-xs">Advanced settings — leave blank to use Cashfree defaults</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Base URL Override <span className="text-xs text-muted-foreground font-normal">(optional)</span></Label>
              <Input
                placeholder={currentEnv === "live" ? "https://payout-api.cashfree.com" : "https://payout-gamma.cashfree.com"}
                value={currentBaseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Leave blank to use the standard Cashfree Payout endpoint for the selected mode.</p>
            </div>
            <div className="space-y-1.5">
              <Label>API Version</Label>
              <Input
                placeholder="2024-01-01"
                value={currentApiVersion}
                onChange={(e) => setApiVersion(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Cashfree Payout API version header value.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── 4. Webhook Configuration ── */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Webhook Configuration</CardTitle>
          <CardDescription className="text-xs">Configure this URL in your Cashfree Payout dashboard to receive real-time transfer status updates</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Payout Webhook URL</Label>
            <div className="flex items-center gap-2">
              <div className="flex-1 flex items-center gap-2 rounded-md border border-border/50 bg-muted/20 px-3 py-2 min-w-0">
                <code className="text-xs text-muted-foreground truncate flex-1 font-mono">{WEBHOOK_URL}</code>
              </div>
              <CopyButton text={WEBHOOK_URL} />
              <Button size="sm" variant="ghost" className="h-8 px-2 text-xs shrink-0" onClick={() => window.open(WEBHOOK_URL, "_blank")}>
                <ExternalLink className="w-3.5 h-3.5" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Add this URL in Cashfree Dashboard → Payout → Settings → Webhooks.</p>
          </div>

          <Separator className="opacity-30" />

          <SecretField
            label="Payout Webhook Secret"
            placeholder="Enter webhook secret for signature verification"
            value={webhookSecret}
            onChange={setWebhookSecret}
            isSet={config?.webhookSecretSet}
            description="Used to verify Cashfree Payout webhook signatures. Set the same value in Cashfree Payout Dashboard → Settings → Webhooks."
          />
        </CardContent>
      </Card>

      {/* ── 5. Business Rules ── */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Business Rules</CardTitle>
          <CardDescription className="text-xs">Control who can request payouts and set amount limits</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Merchant Payout Requests</p>
              <p className="text-xs text-muted-foreground mt-0.5">Allow merchants to create withdrawal requests from their portal</p>
            </div>
            <Switch checked={currentMerchantEnabled} onCheckedChange={setMerchantEnabled} />
          </div>

          <Separator className="opacity-30" />

          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Admin Approval Required</p>
              <p className="text-xs text-muted-foreground mt-0.5">Every withdrawal must be approved by admin before dispatching to the payout gateway</p>
            </div>
            <Switch checked={currentAdminApproval} onCheckedChange={setAdminApprovalRequired} />
          </div>

          <Separator className="opacity-30" />

          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Payout Amount Limits</Label>
            <div className="grid sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Minimum (₹)</Label>
                <Input
                  type="number"
                  min={1}
                  value={currentMinLimit}
                  onChange={(e) => setMinLimit(e.target.value)}
                  placeholder="100"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Maximum per payout (₹)</Label>
                <Input
                  type="number"
                  min={1}
                  value={currentMaxLimit}
                  onChange={(e) => setMaxLimit(e.target.value)}
                  placeholder="200000"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Daily aggregate limit (₹)</Label>
                <Input
                  type="number"
                  min={1}
                  value={currentDailyLimit}
                  onChange={(e) => setDailyLimit(e.target.value)}
                  placeholder="1000000"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Withdrawal requests outside these limits will be rejected at submission.</p>
          </div>
        </CardContent>
      </Card>

      {/* ── Save Button ── */}
      <div className="flex items-center gap-3 pb-4">
        <Button onClick={handleSave} disabled={saving} className="min-w-[140px]">
          {saving ? (
            <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving…</>
          ) : (
            <><Save className="w-4 h-4 mr-2" />Save All Settings</>
          )}
        </Button>
        <p className="text-xs text-muted-foreground">
          All settings are encrypted and stored securely. Credentials are never logged or exposed to merchants.
        </p>
      </div>
    </div>
  );
}
