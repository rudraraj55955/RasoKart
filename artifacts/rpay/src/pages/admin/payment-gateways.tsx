import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  useGetCashfreeConfig, useGetCashfreePayoutConfig,
  useGetEkqrConfig, useUpdateEkqrConfig, useTestEkqrConnection, useTestEkqrWebhook,
  getGetEkqrConfigQueryKey,
  useListProviderIntegrations, useUpdateProviderIntegration, useDeleteProviderIntegration,
  getListProviderIntegrationsQueryKey,
} from "@workspace/api-client-react";
import type { ProviderIntegration } from "@workspace/api-client-react";
import { getToken } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { useDisableGatewayGuard } from "@/components/admin/disable-gateway-dialog";
import { AddGatewayDialog } from "@/components/admin/add-gateway-dialog";
import { CredentialHistoryDialog } from "@/components/admin/credential-history-dialog";
import { toast } from "sonner";
import {
  CreditCard, Landmark, Zap, PlusCircle, CheckCircle2, XCircle, AlertCircle,
  Eye, EyeOff, Save, FlaskConical, Copy, ExternalLink, GitMerge,
  Users, ArrowRight, Shield, Activity, Settings2, Layers, Plug, Trash2,
} from "lucide-react";

const authHeader = () => ({ Authorization: `Bearer ${getToken()}` });

function StatusBadge({ enabled }: { enabled: boolean }) {
  return enabled
    ? <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-[10px] h-5">Active</Badge>
    : <Badge className="bg-zinc-500/10 text-zinc-400 border-zinc-500/30 text-[10px] h-5">Disabled</Badge>;
}

function EnvBadge({ env }: { env: string }) {
  return env === "live"
    ? <Badge className="bg-violet-500/10 text-violet-400 border-violet-500/30 text-[10px] h-5">Live</Badge>
    : <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/30 text-[10px] h-5">Test / Sandbox</Badge>;
}

function ConnectedBadge({ connected }: { connected: boolean }) {
  return connected
    ? <span className="flex items-center gap-1 text-xs text-emerald-400"><CheckCircle2 className="w-3 h-3" />Connected</span>
    : <span className="flex items-center gap-1 text-xs text-zinc-400"><XCircle className="w-3 h-3" />Not configured</span>;
}

function copyToClipboard(text: string, label: string) {
  navigator.clipboard.writeText(text).then(() => toast.success(`${label} copied`));
}

// ── Overview provider cards ───────────────────────────────────────────────────

function CashfreePayinCard({ onConfigure }: { onConfigure: () => void }) {
  const { data, isLoading } = useGetCashfreeConfig({ request: { headers: authHeader() } });
  return (
    <Card className="border-border/50 hover:border-violet-500/30 transition-colors">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="p-2 rounded-lg bg-violet-500/10 border border-violet-500/20">
            <CreditCard className="w-4 h-4 text-violet-400" />
          </div>
          <div className="flex flex-col items-end gap-1">
            {!isLoading && data && <StatusBadge enabled={data.enabled} />}
            {!isLoading && data && <EnvBadge env={data.env} />}
          </div>
        </div>
        <CardTitle className="text-sm font-semibold mt-2">Payin Gateway</CardTitle>
        <CardDescription className="text-xs">
          Payment gateway for collecting payments via UPI, Cards, Netbanking
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">API Credentials</span>
            <ConnectedBadge connected={data?.clientIdSet ?? false} />
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Webhook Secret</span>
            <ConnectedBadge connected={data?.webhookSecretSet ?? false} />
          </div>
        </div>
        <Separator className="opacity-30" />
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="flex-1 h-7 text-xs" onClick={onConfigure}>
            <Settings2 className="w-3 h-3 mr-1.5" />Configure
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs px-2" asChild>
            <Link href="/admin/cashfree-gateway">
              <ExternalLink className="w-3 h-3" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function CashfreePayoutCard({ onConfigure }: { onConfigure: () => void }) {
  const { data, isLoading } = useGetCashfreePayoutConfig({ request: { headers: authHeader() } });
  return (
    <Card className="border-border/50 hover:border-blue-500/30 transition-colors">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/20">
            <Landmark className="w-4 h-4 text-blue-400" />
          </div>
          <div className="flex flex-col items-end gap-1">
            {!isLoading && data && <StatusBadge enabled={data.enabled} />}
            {!isLoading && data && <EnvBadge env={data.env} />}
          </div>
        </div>
        <CardTitle className="text-sm font-semibold mt-2">Payout Gateway</CardTitle>
        <CardDescription className="text-xs">
          Disburse funds to merchant bank accounts via IMPS, NEFT, UPI
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">API Credentials</span>
            <ConnectedBadge connected={data?.clientIdSet ?? false} />
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Environment</span>
            {!isLoading && data
              ? <span className="text-xs text-foreground">{data.env === "live" ? "Production" : "Test"}</span>
              : <span className="text-xs text-muted-foreground">—</span>}
          </div>
        </div>
        <Separator className="opacity-30" />
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="flex-1 h-7 text-xs" onClick={onConfigure}>
            <Settings2 className="w-3 h-3 mr-1.5" />Configure
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs px-2" asChild>
            <Link href="/admin/payout-gateway">
              <ExternalLink className="w-3 h-3" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function EkqrCard({ onConfigure }: { onConfigure: () => void }) {
  const { data, isLoading } = useGetEkqrConfig({ request: { headers: authHeader() } } as any);
  return (
    <Card className="border-border/50 hover:border-teal-500/30 transition-colors">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="p-2 rounded-lg bg-teal-500/10 border border-teal-500/20">
            <Zap className="w-4 h-4 text-teal-400" />
          </div>
          <div className="flex flex-col items-end gap-1">
            {!isLoading && data && <StatusBadge enabled={data.enabled} />}
            {!isLoading && data && <EnvBadge env={(data as any).env ?? "test"} />}
          </div>
        </div>
        <CardTitle className="text-sm font-semibold mt-2">UPI Gateway</CardTitle>
        <CardDescription className="text-xs">
          Dynamic QR code generation and auto-credit via UPI Collection
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Link href="/admin/upi-gateways" className="flex items-center gap-1.5 text-xs text-primary hover:underline">
          <ArrowRight className="w-3 h-3" /> Manage in the new UPI Gateways page
        </Link>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">API Key</span>
            <ConnectedBadge connected={data?.apiKeySet ?? false} />
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Webhook Signature</span>
            <ConnectedBadge connected={data?.webhookSecretSet ?? false} />
          </div>
        </div>
        <Separator className="opacity-30" />
        <Button size="sm" variant="outline" className="w-full h-7 text-xs" onClick={onConfigure}>
          <Settings2 className="w-3 h-3 mr-1.5" />Configure
        </Button>
      </CardContent>
    </Card>
  );
}

function AddGatewayCard({ onCreated }: { onCreated: (providerKey: string) => void }) {
  return (
    <AddGatewayDialog
      onCreated={onCreated}
      trigger={
        <Card className="border-border/30 border-dashed hover:border-primary/40 hover:bg-muted/10 transition-colors cursor-pointer h-full">
          <CardHeader className="pb-3">
            <div className="p-2 rounded-lg bg-muted/30 border border-border/30 w-fit">
              <PlusCircle className="w-4 h-4 text-primary" />
            </div>
            <CardTitle className="text-sm font-semibold mt-2">Add Gateway</CardTitle>
            <CardDescription className="text-xs">Register a new payment provider integration</CardDescription>
          </CardHeader>
          <CardContent>
            <Badge variant="outline" className="text-[10px] text-primary border-primary/30 bg-primary/5">Custom</Badge>
          </CardContent>
        </Card>
      }
    />
  );
}

function CustomGatewayCard({ integration, onConfigure }: { integration: ProviderIntegration; onConfigure: () => void }) {
  return (
    <Card className="border-border/50 hover:border-primary/30 transition-colors">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="p-2 rounded-lg bg-primary/10 border border-primary/20">
            <Plug className="w-4 h-4 text-primary" />
          </div>
          <div className="flex flex-col items-end gap-1">
            <StatusBadge enabled={integration.isEnabled} />
            <EnvBadge env={integration.environment} />
          </div>
        </div>
        <CardTitle className="text-sm font-semibold mt-2">{integration.displayNamePublic}</CardTitle>
        <CardDescription className="text-xs capitalize">
          {(integration.productType ?? "custom").replace("_", " ")} · Custom integration
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">API Credentials</span>
            <ConnectedBadge connected={integration.apiKeySet} />
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Webhook Secret</span>
            <ConnectedBadge connected={integration.webhookSecretSet} />
          </div>
        </div>
        <Separator className="opacity-30" />
        <Button size="sm" variant="outline" className="w-full h-7 text-xs" onClick={onConfigure}>
          <Settings2 className="w-3 h-3 mr-1.5" />Configure
        </Button>
      </CardContent>
    </Card>
  );
}

// ── EKQR Full Config panel ────────────────────────────────────────────────────

function EkqrConfigPanel() {
  const qc = useQueryClient();
  const { data: ekqrConfig, isLoading: ekqrLoading } = useGetEkqrConfig({ request: { headers: authHeader() } } as any);

  const [ekqrApiKey, setEkqrApiKey] = useState("");
  const [ekqrEnabled, setEkqrEnabled] = useState<boolean | null>(null);
  const [ekqrEnv, setEkqrEnv] = useState<"test" | "live" | null>(null);
  const [ekqrWebhookSecret, setEkqrWebhookSecret] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [webhookTestResult, setWebhookTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const currentEnabled = ekqrEnabled !== null ? ekqrEnabled : (ekqrConfig?.enabled ?? false);
  const currentEnv: "test" | "live" = ekqrEnv !== null ? ekqrEnv : ((ekqrConfig as any)?.env ?? "test");
  const unchanged = ekqrApiKey === "" && ekqrWebhookSecret === ""
    && ekqrEnabled === null && ekqrEnv === null;

  const { guardSave, dialog: disableGuardDialog } = useDisableGatewayGuard("ekqr");

  const { mutate: saveConfig, isPending: saving } = useUpdateEkqrConfig({
    mutation: {
      onSuccess: () => {
        toast.success("UPI Gateway settings saved");
        setEkqrApiKey(""); setEkqrWebhookSecret("");
        setEkqrEnabled(null); setEkqrEnv(null);
        qc.invalidateQueries({ queryKey: getGetEkqrConfigQueryKey() });
      },
      onError: (err: Error) => toast.error(err.message),
    },
  });

  const { mutate: testConn, isPending: testing } = useTestEkqrConnection({
    mutation: {
      onSuccess: (d: any) => {
        setTestResult(d);
        if (d.ok) toast.success("Gateway connection successful");
        else toast.error(`Test failed: ${d.msg}`);
      },
      onError: (err: Error) => toast.error(err.message),
    },
  });

  const { mutate: testWebhook, isPending: testingWebhook } = useTestEkqrWebhook({
    mutation: {
      onSuccess: (d: any) => {
        const ok = d?.ok ?? true;
        setWebhookTestResult({ ok, msg: d?.msg ?? "Simulated webhook delivered" });
        if (ok) toast.success("Test webhook sent — check Webhook Logs");
        else toast.error(`Webhook test failed: ${d?.msg}`);
      },
      onError: (err: Error) => {
        setWebhookTestResult({ ok: false, msg: err.message });
        toast.error(err.message);
      },
    },
  });

  function handleSave() {
    const body: Record<string, unknown> = { enabled: currentEnabled, env: currentEnv };
    if (ekqrApiKey.trim()) body.apiKey = ekqrApiKey.trim();
    if (ekqrWebhookSecret !== "") body.webhookSecret = ekqrWebhookSecret.trim();
    const willDisable = (ekqrConfig?.enabled ?? false) === true && currentEnabled === false;
    guardSave(willDisable, () => saveConfig({ data: body as any }));
  }

  const WEBHOOK_URL = "https://rasokart.com/api/payment/webhook";

  return (
    <div className="space-y-5 max-w-2xl">
      {/* Status header */}
      <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/20 border border-border/40">
        <div className="p-2 rounded-lg bg-teal-500/10 border border-teal-500/20">
          <Zap className="w-4 h-4 text-teal-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">UPI Gateway</p>
          <p className="text-xs text-muted-foreground">UPI Collection for merchants — dynamic QR code generation</p>
          {ekqrConfig?.lastUpdatedByEmail && ekqrConfig?.lastUpdatedAt && (
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
              <span>
                Last changed by <span className="font-medium text-foreground">{ekqrConfig.lastUpdatedByEmail}</span> on {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(ekqrConfig.lastUpdatedAt))}
              </span>
              <CredentialHistoryDialog section="ekqr" label="UPI Gateway" />
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!ekqrLoading && ekqrConfig && <StatusBadge enabled={ekqrConfig.enabled} />}
          {!ekqrLoading && ekqrConfig && <EnvBadge env={(ekqrConfig as any).env ?? "test"} />}
        </div>
      </div>

      <Link href="/admin/upi-gateways" className="flex items-center gap-1.5 text-xs text-primary hover:underline">
        <ArrowRight className="w-3 h-3" /> This gateway is now managed from the consolidated UPI Gateways page
      </Link>

      {/* Webhook URL */}
      <div className="space-y-1.5">
        <Label className="text-xs">Webhook URL (set in your gateway dashboard)</Label>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-xs font-mono bg-muted/40 border border-border/40 rounded-md px-3 py-2 text-teal-300 truncate">
            {WEBHOOK_URL}
          </code>
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0 shrink-0"
            onClick={() => copyToClipboard(WEBHOOK_URL, "Webhook URL")}>
            <Copy className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Enable + Mode row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="flex items-center justify-between p-3 rounded-lg border border-border/40 bg-muted/10">
          <div>
            <p className="text-sm font-medium">Enable Gateway</p>
            <p className="text-xs text-muted-foreground">Activate for merchants with UPI gateway connection</p>
          </div>
          <Switch
            checked={currentEnabled}
            onCheckedChange={v => setEkqrEnabled(v)}
            disabled={ekqrLoading}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Mode</Label>
          <Select
            value={currentEnv}
            onValueChange={v => setEkqrEnv(v as "test" | "live")}
            disabled={ekqrLoading}
          >
            <SelectTrigger className="h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="test" className="text-xs">
                <span className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
                  Sandbox / Test
                </span>
              </SelectItem>
              <SelectItem value="live" className="text-xs">
                <span className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
                  Live / Production
                </span>
              </SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">Controls API endpoint used for order creation</p>
        </div>
      </div>

      {/* API Key */}
      <div className="space-y-1.5">
        <Label className="text-xs">API Key</Label>
        {ekqrConfig?.apiKeySet && ekqrApiKey === "" && (
          <p className="text-xs text-muted-foreground">
            Current key: <span className="font-mono text-foreground/80">{ekqrConfig.apiKeyMasked || "••••••••"}</span>
            {" — "}enter a new key to replace
          </p>
        )}
        <div className="relative">
          <Input
            type={showKey ? "text" : "password"}
            placeholder={ekqrConfig?.apiKeySet ? "Enter new API key to replace…" : "Enter gateway API key"}
            value={ekqrApiKey}
            onChange={e => setEkqrApiKey(e.target.value)}
            className="h-9 text-xs pr-9 font-mono"
          />
          <button
            type="button"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            onClick={() => setShowKey(v => !v)}
          >
            {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Webhook Signature Secret */}
      <div className="space-y-1.5">
        <Label className="text-xs">Webhook Signature Secret</Label>
        <p className="text-xs text-muted-foreground">
          {ekqrConfig?.webhookSecretSet
            ? "A secret is configured — incoming webhooks are signature-verified (HMAC-SHA256). Enter a new value to rotate, or clear and save to remove."
            : "Optional. When set, incoming webhooks must include a valid HMAC-SHA256 signature or they will be rejected with 401."}
        </p>
        <div className="relative">
          <Input
            type={showSecret ? "text" : "password"}
            placeholder={ekqrConfig?.webhookSecretSet ? "Enter new secret to rotate…" : "Enter webhook signature secret"}
            value={ekqrWebhookSecret}
            onChange={e => setEkqrWebhookSecret(e.target.value)}
            className="h-9 text-xs pr-9 font-mono"
          />
          <button
            type="button"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            onClick={() => setShowSecret(v => !v)}
          >
            {showSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
        </div>
        {ekqrConfig?.webhookSecretSet && (
          <p className="text-xs text-emerald-400 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" />Signature verification active
          </p>
        )}
      </div>

      {/* Test result banners */}
      {testResult && (
        <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-md border ${
          testResult.ok ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-destructive/10 text-destructive border-destructive/20"
        }`}>
          {testResult.ok ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : <AlertCircle className="w-3.5 h-3.5 shrink-0" />}
          {testResult.ok ? "Connection successful — API key is valid" : testResult.msg}
        </div>
      )}
      {webhookTestResult && (
        <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-md border ${
          webhookTestResult.ok ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-destructive/10 text-destructive border-destructive/20"
        }`}>
          {webhookTestResult.ok ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : <AlertCircle className="w-3.5 h-3.5 shrink-0" />}
          {webhookTestResult.ok
            ? <>Simulated webhook processed — visible in <a href="/admin/webhook-logs" className="underline">Webhook Logs → UPI Incoming</a></>
            : webhookTestResult.msg}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2 flex-wrap pt-1">
        <Button size="sm" onClick={handleSave} disabled={saving || ekqrLoading || unchanged}>
          <Save className="w-3.5 h-3.5 mr-1.5" />
          {saving ? "Saving…" : "Save Changes"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => { setTestResult(null); testConn(undefined as any); }}
          disabled={testing || ekqrLoading || !ekqrConfig?.apiKeySet}>
          <FlaskConical className="w-3.5 h-3.5 mr-1.5" />
          {testing ? "Testing…" : "Test Connection"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => { setWebhookTestResult(null); testWebhook(undefined as any); }}
          disabled={testingWebhook || !ekqrConfig?.apiKeySet}>
          <Zap className="w-3.5 h-3.5 mr-1.5" />
          {testingWebhook ? "Sending…" : "Send Test Webhook"}
        </Button>
        {!unchanged && (
          <Button size="sm" variant="ghost" onClick={() => {
            setEkqrApiKey(""); setEkqrWebhookSecret("");
            setEkqrEnabled(null); setEkqrEnv(null);
            setTestResult(null); setWebhookTestResult(null);
          }} disabled={saving}>
            Cancel
          </Button>
        )}
      </div>

      <Separator className="opacity-30" />

      {/* Quick links */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Quick links</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" className="h-7 text-xs gap-1.5" asChild>
            <Link href="/admin/webhook-logs"><Activity className="w-3 h-3" />Webhook Logs</Link>
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs gap-1.5" asChild>
            <Link href="/admin/qr-providers"><Layers className="w-3 h-3" />QR Provider Assignments</Link>
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs gap-1.5" asChild>
            <Link href="/admin/providers"><Users className="w-3 h-3" />Payment Providers</Link>
          </Button>
        </div>
      </div>

      {disableGuardDialog}
    </div>
  );
}

// ── Cashfree summary panels ───────────────────────────────────────────────────

function CashfreePayinPanel() {
  const { data, isLoading } = useGetCashfreeConfig({ request: { headers: authHeader() } });
  return (
    <div className="space-y-5 max-w-2xl">
      <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/20 border border-border/40">
        <div className="p-2 rounded-lg bg-violet-500/10 border border-violet-500/20">
          <CreditCard className="w-4 h-4 text-violet-400" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium">Payin Gateway</p>
          <p className="text-xs text-muted-foreground">Full configuration available on the dedicated page</p>
        </div>
        {!isLoading && data && (
          <div className="flex items-center gap-2">
            <StatusBadge enabled={data.enabled} />
            <EnvBadge env={data.env} />
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="rounded-lg border border-border/40 p-3">
          <p className="text-xs text-muted-foreground mb-1">Client ID</p>
          <ConnectedBadge connected={data?.clientIdSet ?? false} />
        </div>
        <div className="rounded-lg border border-border/40 p-3">
          <p className="text-xs text-muted-foreground mb-1">Client Secret</p>
          <ConnectedBadge connected={data?.clientSecretSet ?? false} />
        </div>
        <div className="rounded-lg border border-border/40 p-3">
          <p className="text-xs text-muted-foreground mb-1">Webhook Secret</p>
          <ConnectedBadge connected={data?.webhookSecretSet ?? false} />
        </div>
      </div>
      <Button asChild>
        <Link href="/admin/cashfree-gateway">
          Open Full Configuration <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
        </Link>
      </Button>
    </div>
  );
}

function CashfreePayoutPanel() {
  const { data, isLoading } = useGetCashfreePayoutConfig({ request: { headers: authHeader() } });
  return (
    <div className="space-y-5 max-w-2xl">
      <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/20 border border-border/40">
        <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/20">
          <Landmark className="w-4 h-4 text-blue-400" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium">Payout Gateway</p>
          <p className="text-xs text-muted-foreground">Full configuration available on the dedicated page</p>
        </div>
        {!isLoading && data && (
          <div className="flex items-center gap-2">
            <StatusBadge enabled={data.enabled} />
            <EnvBadge env={data.env} />
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="rounded-lg border border-border/40 p-3">
          <p className="text-xs text-muted-foreground mb-1">Client ID</p>
          <ConnectedBadge connected={data?.clientIdSet ?? false} />
        </div>
        <div className="rounded-lg border border-border/40 p-3">
          <p className="text-xs text-muted-foreground mb-1">Client Secret</p>
          <ConnectedBadge connected={data?.clientSecretSet ?? false} />
        </div>
        <div className="rounded-lg border border-border/40 p-3">
          <p className="text-xs text-muted-foreground mb-1">Environment</p>
          <span className="text-xs text-foreground">{data?.env === "live" ? "Live" : "Test"}</span>
        </div>
      </div>
      <Button asChild>
        <Link href="/admin/payout-gateway">
          Open Full Configuration <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
        </Link>
      </Button>
    </div>
  );
}

// ── Custom gateway config panel ───────────────────────────────────────────────

function CustomGatewayConfigPanel({ integration }: { integration: ProviderIntegration }) {
  const qc = useQueryClient();
  const [displayName, setDisplayName] = useState(integration.displayNamePublic);
  const [productType, setProductType] = useState(integration.productType ?? "other");
  const [environment, setEnvironment] = useState<"test" | "live">(integration.environment as "test" | "live");
  const [webhookUrl, setWebhookUrl] = useState(integration.webhookUrl ?? "");
  const [notes, setNotes] = useState(integration.notes ?? "");
  const [enabled, setEnabled] = useState(integration.isEnabled);
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [showApiSecret, setShowApiSecret] = useState(false);
  const [showWebhookSecret, setShowWebhookSecret] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { guardSave, dialog: disableGuardDialog } = useDisableGatewayGuard(
    integration.providerKey,
    integration.displayNamePublic,
    {
      apiKeySet: integration.apiKeySet,
      apiSecretSet: integration.apiSecretSet,
      webhookSecretSet: integration.webhookSecretSet,
    },
  );

  const { mutate: saveConfig, isPending: saving } = useUpdateProviderIntegration({
    request: { headers: authHeader() },
    mutation: {
      onSuccess: () => {
        toast.success("Gateway settings saved");
        setApiKey(""); setApiSecret(""); setWebhookSecret("");
        qc.invalidateQueries({ queryKey: getListProviderIntegrationsQueryKey() });
      },
      onError: (err: Error) => toast.error(err.message),
    },
  } as any);

  const { mutate: deleteIntegration, isPending: deleting } = useDeleteProviderIntegration({
    request: { headers: authHeader() },
    mutation: {
      onSuccess: () => {
        toast.success("Gateway removed");
        qc.invalidateQueries({ queryKey: getListProviderIntegrationsQueryKey() });
      },
      onError: (err: Error) => toast.error(err.message),
    },
  } as any);

  function doSave() {
    const body: Record<string, unknown> = {
      displayNamePublic: displayName.trim(),
      productType,
      environment,
      webhookUrl: webhookUrl.trim(),
      notes: notes.trim(),
      isEnabled: enabled,
    };
    if (apiKey.trim()) body.apiKey = apiKey.trim();
    if (apiSecret.trim()) body.apiSecret = apiSecret.trim();
    if (webhookSecret.trim()) body.webhookSecret = webhookSecret.trim();
    saveConfig({ key: integration.providerKey, data: body as any });
  }

  function handleSave() {
    const willDisable = integration.isEnabled === true && enabled === false;
    guardSave(willDisable, doSave);
  }

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/20 border border-border/40">
        <div className="p-2 rounded-lg bg-primary/10 border border-primary/20">
          <Plug className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{integration.displayNamePublic}</p>
          <p className="text-xs text-muted-foreground">Custom provider integration · {integration.providerKey}</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge enabled={integration.isEnabled} />
          <EnvBadge env={integration.environment} />
        </div>
      </div>

      <div>
        <Label className="text-xs">Display Name</Label>
        <Input className="h-9 text-xs mt-1.5" value={displayName} onChange={e => setDisplayName(e.target.value)} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="text-xs">Product Type</Label>
          <Select value={productType} onValueChange={setProductType}>
            <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="payin" className="text-xs">Payin</SelectItem>
              <SelectItem value="payout" className="text-xs">Payout</SelectItem>
              <SelectItem value="upi_qr" className="text-xs">UPI / QR</SelectItem>
              <SelectItem value="other" className="text-xs">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Mode</Label>
          <Select value={environment} onValueChange={v => setEnvironment(v as "test" | "live")}>
            <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="test" className="text-xs">Sandbox / Test</SelectItem>
              <SelectItem value="live" className="text-xs">Live / Production</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-center justify-between p-3 rounded-lg border border-border/40 bg-muted/10">
        <div>
          <p className="text-sm font-medium">Enable Gateway</p>
          <p className="text-xs text-muted-foreground">Activate this custom provider for merchants</p>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Webhook URL</Label>
        <Input className="h-9 text-xs font-mono" value={webhookUrl} onChange={e => setWebhookUrl(e.target.value)}
          placeholder="https://api.rasokart.com/api/payment/webhook" />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">API Key</Label>
        {integration.apiKeySet && apiKey === "" && (
          <p className="text-xs text-muted-foreground">
            Current key: <span className="font-mono text-foreground/80">{integration.apiKeyMasked || "••••••••"}</span>
            {" — "}enter a new key to replace
          </p>
        )}
        <div className="relative">
          <Input
            type={showApiKey ? "text" : "password"}
            placeholder={integration.apiKeySet ? "Enter new API key to replace…" : "Enter gateway API key"}
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            className="h-9 text-xs pr-9 font-mono"
          />
          <button type="button" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            onClick={() => setShowApiKey(v => !v)}>
            {showApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">API Secret</Label>
        <div className="relative">
          <Input
            type={showApiSecret ? "text" : "password"}
            placeholder={integration.apiSecretSet ? "Enter new secret to replace…" : "Enter API secret"}
            value={apiSecret}
            onChange={e => setApiSecret(e.target.value)}
            className="h-9 text-xs pr-9 font-mono"
          />
          <button type="button" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            onClick={() => setShowApiSecret(v => !v)}>
            {showApiSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Webhook Signature Secret</Label>
        <div className="relative">
          <Input
            type={showWebhookSecret ? "text" : "password"}
            placeholder={integration.webhookSecretSet ? "Enter new secret to rotate…" : "Enter webhook signature secret"}
            value={webhookSecret}
            onChange={e => setWebhookSecret(e.target.value)}
            className="h-9 text-xs pr-9 font-mono"
          />
          <button type="button" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            onClick={() => setShowWebhookSecret(v => !v)}>
            {showWebhookSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
        </div>
        {integration.webhookSecretSet && (
          <p className="text-xs text-emerald-400 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" />Signature verification active
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Internal Notes</Label>
        <Input className="h-9 text-xs" value={notes} onChange={e => setNotes(e.target.value)}
          placeholder="Internal notes for admins..." />
      </div>

      <div className="flex items-center gap-2 flex-wrap pt-1">
        <Button size="sm" onClick={handleSave} disabled={saving}>
          <Save className="w-3.5 h-3.5 mr-1.5" />
          {saving ? "Saving…" : "Save Changes"}
        </Button>
      </div>

      <Separator className="opacity-30" />

      <div className="rounded-lg border border-red-500/30 bg-red-950/10 p-3">
        {!confirmDelete ? (
          <Button variant="ghost" size="sm" className="h-7 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10"
            onClick={() => setConfirmDelete(true)}>
            <Trash2 className="w-3 h-3 mr-1.5" />Remove this gateway
          </Button>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-red-400">Permanently remove this gateway integration?</p>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setConfirmDelete(false)}>Cancel</Button>
              <Button size="sm" className="h-7 text-xs bg-red-600 hover:bg-red-700" disabled={deleting}
                onClick={() => guardSave(true, () => deleteIntegration({ key: integration.providerKey }))}>
                {deleting ? "Removing…" : "Confirm Remove"}
              </Button>
            </div>
          </div>
        )}
      </div>

      {disableGuardDialog}
    </div>
  );
}

// ── Routing summary panel ─────────────────────────────────────────────────────

function RoutingPanel() {
  return (
    <div className="space-y-4 max-w-2xl">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {[
          { icon: GitMerge, title: "Smart Routing", desc: "Configure default/fallback providers, strategy, and failover rules", href: "/admin/smart-routing", color: "text-violet-400", bg: "bg-violet-500/10 border-violet-500/20" },
          { icon: Layers, title: "Provider Integrations", desc: "Manage provider_integrations table, webhooks, and product types", href: "/admin/provider-integrations", color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/20" },
          { icon: Activity, title: "Payment Providers", desc: "Enable / disable providers and configure per-provider settings", href: "/admin/providers", color: "text-teal-400", bg: "bg-teal-500/10 border-teal-500/20" },
          { icon: Shield, title: "Visibility Rules", desc: "Control which products and providers are visible to merchants", href: "/admin/visibility-rules", color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20" },
        ].map(({ icon: Icon, title, desc, href, color, bg }) => (
          <Card key={href} className="border-border/40 hover:border-border/70 transition-colors">
            <CardContent className="p-4 flex items-start gap-3">
              <div className={`p-2 rounded-lg border ${bg} shrink-0 mt-0.5`}>
                <Icon className={`w-4 h-4 ${color}`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
                <Button size="sm" variant="ghost" className="h-6 text-xs mt-2 px-0 hover:bg-transparent" asChild>
                  <Link href={href}>Open <ArrowRight className="w-3 h-3 ml-1" /></Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card className="border-border/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Routing Logic Overview</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {[
            ["Default provider", "Set in Smart Routing → routing config"],
            ["Fallback provider", "Activated when default fails or exceeds threshold"],
            ["Priority order", "Configurable per routing rule (1 = highest)"],
            ["Auto-switch on failure", "Enabled via Smart Routing fallback strategy"],
            ["Amount limits", "Min/max amount per routing rule"],
            ["Manual force (admin)", "Available via Payment Providers page"],
          ].map(([key, val]) => (
            <div key={key} className="flex items-start gap-2 text-xs">
              <span className="text-muted-foreground w-40 shrink-0">{key}</span>
              <span className="text-foreground/80">{val}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Merchant Access panel ─────────────────────────────────────────────────────

function MerchantAccessPanel() {
  return (
    <div className="space-y-4 max-w-2xl">
      <p className="text-sm text-muted-foreground">
        Control which merchants can access each payment provider. Provider names are always white-labelled on the merchant side — merchants see only the display name (e.g. "RasoKart QR Gateway"), never the underlying provider.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {[
          { icon: Layers, title: "QR Provider Assignments", desc: "Assign UPI QR provider to individual merchants, set monthly limits", href: "/admin/qr-providers", color: "text-teal-400", bg: "bg-teal-500/10 border-teal-500/20" },
          { icon: Users, title: "Merchant Access", desc: "Grant or revoke merchant access to product modules and payment methods", href: "/admin/merchant-access", color: "text-violet-400", bg: "bg-violet-500/10 border-violet-500/20" },
          { icon: Activity, title: "Payment Providers", desc: "Enable/disable each provider per merchant and view UPI gateway connection settings", href: "/admin/providers", color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/20" },
          { icon: Shield, title: "Visibility Rules", desc: "Fine-grained show/hide control for provider products", href: "/admin/visibility-rules", color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20" },
        ].map(({ icon: Icon, title, desc, href, color, bg }) => (
          <Card key={href} className="border-border/40 hover:border-border/70 transition-colors">
            <CardContent className="p-4 flex items-start gap-3">
              <div className={`p-2 rounded-lg border ${bg} shrink-0 mt-0.5`}>
                <Icon className={`w-4 h-4 ${color}`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
                <Button size="sm" variant="ghost" className="h-6 text-xs mt-2 px-0 hover:bg-transparent" asChild>
                  <Link href={href}>Open <ArrowRight className="w-3 h-3 ml-1" /></Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card className="border-amber-500/20 bg-amber-500/5">
        <CardContent className="p-4 flex items-start gap-3">
          <Shield className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-xs font-medium text-amber-300">White-label policy</p>
            <p className="text-xs text-muted-foreground mt-1">
              Merchant-facing UI always shows generic names: <strong className="text-foreground/80">RasoKart Payments</strong>,
              {" "}<strong className="text-foreground/80">RasoKart QR Gateway</strong>. Provider names are never exposed to merchants.
              API keys and secrets are never exposed in frontend responses.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AdminPaymentGateways() {
  const qc = useQueryClient();
  const [tab, setTab] = useState("overview");
  const [configTab, setConfigTab] = useState("ekqr");

  const { data: integrations = [] } = useListProviderIntegrations({
    request: { headers: authHeader() },
  } as any);
  const customIntegrations = integrations.filter((i: ProviderIntegration) => i.isCustom);

  function openConfigTab(provider: string) {
    setConfigTab(provider);
    setTab("configure");
  }

  return (
    <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-violet-500/10 border border-violet-500/20">
            <CreditCard className="w-5 h-5 text-violet-400" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Payment Gateways</h1>
            <p className="text-sm text-muted-foreground">Configure payment providers, routing rules, and merchant access</p>
          </div>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="h-9">
            <TabsTrigger value="overview" className="text-xs px-3">Overview</TabsTrigger>
            <TabsTrigger value="configure" className="text-xs px-3">Configure</TabsTrigger>
            <TabsTrigger value="routing" className="text-xs px-3">Routing & Rules</TabsTrigger>
            <TabsTrigger value="merchant-access" className="text-xs px-3">Merchant Access</TabsTrigger>
          </TabsList>

          {/* ── Overview ────────────────────────────────────────────────── */}
          <TabsContent value="overview" className="mt-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <CashfreePayinCard onConfigure={() => openConfigTab("cashfree-payin")} />
              <CashfreePayoutCard onConfigure={() => openConfigTab("cashfree-payout")} />
              <EkqrCard onConfigure={() => openConfigTab("ekqr")} />
              {customIntegrations.map((integration: ProviderIntegration) => (
                <CustomGatewayCard
                  key={integration.providerKey}
                  integration={integration}
                  onConfigure={() => openConfigTab(integration.providerKey)}
                />
              ))}
              <AddGatewayCard onCreated={(providerKey) => {
                qc.invalidateQueries({ queryKey: getListProviderIntegrationsQueryKey() });
                openConfigTab(providerKey);
              }} />
            </div>

            <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                { href: "/admin/smart-routing", icon: GitMerge, label: "Smart Routing", desc: "Configure failover and provider priority" },
                { href: "/admin/qr-providers", icon: Layers, label: "QR Provider Assignments", desc: "Assign UPI provider to merchants" },
                { href: "/admin/webhook-logs", icon: Activity, label: "Webhook Logs", desc: "Incoming webhook history" },
              ].map(({ href, icon: Icon, label, desc }) => (
                <Link key={href} href={href}>
                  <div className="flex items-center gap-3 p-3 rounded-lg border border-border/40 hover:border-border/70 hover:bg-muted/20 transition-colors cursor-pointer">
                    <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate">{label}</p>
                      <p className="text-xs text-muted-foreground truncate">{desc}</p>
                    </div>
                    <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0 ml-auto" />
                  </div>
                </Link>
              ))}
            </div>
          </TabsContent>

          {/* ── Configure ───────────────────────────────────────────────── */}
          <TabsContent value="configure" className="mt-5">
            <Tabs value={configTab} onValueChange={setConfigTab}>
              <TabsList className="h-8 mb-5 flex-wrap h-auto">
                <TabsTrigger value="cashfree-payin" className="text-xs px-3">
                  <CreditCard className="w-3 h-3 mr-1.5" />Payin Gateway
                </TabsTrigger>
                <TabsTrigger value="cashfree-payout" className="text-xs px-3">
                  <Landmark className="w-3 h-3 mr-1.5" />Payout Gateway
                </TabsTrigger>
                <TabsTrigger value="ekqr" className="text-xs px-3">
                  <Zap className="w-3 h-3 mr-1.5" />UPI Gateway
                </TabsTrigger>
                {customIntegrations.map((integration: ProviderIntegration) => (
                  <TabsTrigger key={integration.providerKey} value={integration.providerKey} className="text-xs px-3">
                    <Plug className="w-3 h-3 mr-1.5" />{integration.displayNamePublic}
                  </TabsTrigger>
                ))}
              </TabsList>
              <TabsContent value="cashfree-payin"><CashfreePayinPanel /></TabsContent>
              <TabsContent value="cashfree-payout"><CashfreePayoutPanel /></TabsContent>
              <TabsContent value="ekqr"><EkqrConfigPanel /></TabsContent>
              {customIntegrations.map((integration: ProviderIntegration) => (
                <TabsContent key={integration.providerKey} value={integration.providerKey}>
                  <CustomGatewayConfigPanel integration={integration} />
                </TabsContent>
              ))}
            </Tabs>
          </TabsContent>

          {/* ── Routing & Rules ─────────────────────────────────────────── */}
          <TabsContent value="routing" className="mt-5">
            <RoutingPanel />
          </TabsContent>

          {/* ── Merchant Access ─────────────────────────────────────────── */}
          <TabsContent value="merchant-access" className="mt-5">
            <MerchantAccessPanel />
          </TabsContent>
        </Tabs>
      </div>
  );
}
