import { useState } from "react";
import { useGetCashfreeConfig, useUpdateCashfreeConfig, useListCashfreePaymentLogs, getGetCashfreeConfigQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getToken } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Save, Eye, EyeOff, CheckCircle2, AlertCircle, RefreshCw, Shield, Zap, CreditCard, ChevronLeft, ChevronRight } from "lucide-react";

function maskSecret(s: string, show: boolean) {
  if (show) return s;
  return s ? "••••••••••••••••" : "";
}

export default function AdminCashfreeGateway() {
  const qc = useQueryClient();
  const { data: config, isLoading } = useGetCashfreeConfig({
    request: { headers: { Authorization: `Bearer ${getToken()}` } },
  });

  const updateConfig = useUpdateCashfreeConfig();

  // Form state
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [env, setEnv] = useState<"test" | "live" | null>(null);
  const [showClientId, setShowClientId] = useState(false);
  const [showClientSecret, setShowClientSecret] = useState(false);
  const [showWebhookSecret, setShowWebhookSecret] = useState(false);
  const [saving, setSaving] = useState(false);

  // Logs
  const [logsPage, setLogsPage] = useState(1);
  const LOGS_LIMIT = 20;
  const { data: logsData, isLoading: logsLoading, refetch: refetchLogs } = useListCashfreePaymentLogs(
    { page: logsPage, limit: LOGS_LIMIT },
    { request: { headers: { Authorization: `Bearer ${getToken()}` } } },
  );

  const currentEnabled = enabled !== null ? enabled : (config?.enabled ?? false);
  const currentEnv: "test" | "live" = env !== null ? env : (config?.env ?? "test");

  async function handleSave() {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        enabled: currentEnabled,
        env: currentEnv,
      };
      if (clientId.trim()) body.clientId = clientId.trim();
      if (clientSecret.trim()) body.clientSecret = clientSecret.trim();
      if (webhookSecret !== undefined && webhookSecret !== "") body.webhookSecret = webhookSecret.trim() || "";

      await updateConfig.mutateAsync(
        { data: body as Parameters<typeof updateConfig.mutateAsync>[0]["data"] },
        { onSuccess: () => { qc.invalidateQueries({ queryKey: getGetCashfreeConfigQueryKey() }); } }
      );

      setClientId("");
      setClientSecret("");
      setWebhookSecret("");
      toast.success("Gateway configuration saved");
    } catch {
      toast.error("Failed to save gateway configuration");
    } finally {
      setSaving(false);
    }
  }

  function formatDate(ts: string) {
    return new Date(ts).toLocaleString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  }

  const totalLogs = logsData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalLogs / LOGS_LIMIT));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Payment Collection Gateway</h1>
          <p className="text-muted-foreground mt-1">Configure payment gateway credentials and webhook settings</p>
        </div>
        <div className="flex items-center gap-3">
          {isLoading ? (
            <Badge variant="outline" className="text-muted-foreground">Loading…</Badge>
          ) : config?.enabled ? (
            <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
              <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
              Enabled — {config.env === "live" ? "Live" : "Sandbox"}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              <AlertCircle className="w-3.5 h-3.5 mr-1.5" />
              Disabled
            </Badge>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Config card */}
        <div className="lg:col-span-2 space-y-4">
          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Zap className="w-4 h-4 text-primary" />
                API Credentials
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Client ID</Label>
                <div className="relative">
                  <Input
                    type={showClientId ? "text" : "password"}
                    placeholder={config?.clientIdSet ? `Current: ${config.clientIdMasked}` : "Enter Client ID"}
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    className="pr-10 font-mono text-sm"
                  />
                  <button
                    type="button"
                    className="absolute inset-y-0 right-2 flex items-center text-muted-foreground hover:text-foreground"
                    onClick={() => setShowClientId(v => !v)}
                  >
                    {showClientId ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {config?.clientIdSet
                    ? `Currently set: ${config.clientIdMasked}. Leave blank to keep unchanged.`
                    : "No Client ID configured yet."}
                </p>
              </div>

              <div className="space-y-2">
                <Label>Client Secret</Label>
                <div className="relative">
                  <Input
                    type={showClientSecret ? "text" : "password"}
                    placeholder={config?.clientSecretSet ? "••••••••••••••••" : "Enter Client Secret"}
                    value={clientSecret}
                    onChange={(e) => setClientSecret(e.target.value)}
                    className="pr-10 font-mono text-sm"
                  />
                  <button
                    type="button"
                    className="absolute inset-y-0 right-2 flex items-center text-muted-foreground hover:text-foreground"
                    onClick={() => setShowClientSecret(v => !v)}
                  >
                    {showClientSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {config?.clientSecretSet
                    ? "Client Secret is set. Leave blank to keep unchanged; enter empty to clear."
                    : "No Client Secret configured yet."}
                </p>
              </div>

              <div className="space-y-2">
                <Label>Environment</Label>
                <Select
                  value={currentEnv}
                  onValueChange={(v) => setEnv(v as "test" | "live")}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="test">Sandbox (Test)</SelectItem>
                    <SelectItem value="live">Production (Live)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Sandbox mode routes payments through the test environment; Live mode processes real transactions.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Shield className="w-4 h-4 text-amber-400" />
                Webhook Security
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Webhook Secret</Label>
                <div className="relative">
                  <Input
                    type={showWebhookSecret ? "text" : "password"}
                    placeholder={config?.webhookSecretSet ? "••••••••••••••••" : "Enter Webhook Secret"}
                    value={webhookSecret}
                    onChange={(e) => setWebhookSecret(e.target.value)}
                    className="pr-10 font-mono text-sm"
                  />
                  <button
                    type="button"
                    className="absolute inset-y-0 right-2 flex items-center text-muted-foreground hover:text-foreground"
                    onClick={() => setShowWebhookSecret(v => !v)}
                  >
                    {showWebhookSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {config?.webhookSecretSet
                    ? "Webhook secret is set. Used to verify HMAC-SHA256 signatures on incoming webhooks."
                    : "No webhook secret configured. Incoming webhooks will not be signature-verified."}
                </p>
              </div>

              <div className="rounded-md bg-muted/40 border border-border/40 p-3 text-xs text-muted-foreground space-y-1">
                <p className="font-medium text-foreground">Webhook URL to configure in your gateway dashboard:</p>
                <code className="block bg-background/60 rounded px-2 py-1 font-mono select-all">
                  {window.location.origin}/api/payment/webhook
                </code>
                <p>The gateway sends <code>x-webhook-signature</code> (base64 HMAC-SHA256) and <code>x-webhook-timestamp</code> headers.</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Status + enable sidebar */}
        <div className="space-y-4">
          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <CreditCard className="w-4 h-4 text-primary" />
                Gateway Status
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Enable Payment Collection</p>
                  <p className="text-xs text-muted-foreground">Allow merchants to accept payments via this gateway</p>
                </div>
                <Switch
                  checked={currentEnabled}
                  onCheckedChange={setEnabled}
                />
              </div>

              <div className="border-t border-border/40 pt-3 space-y-2 text-xs text-muted-foreground">
                <div className="flex justify-between">
                  <span>Client ID</span>
                  <span className={config?.clientIdSet ? "text-emerald-400" : "text-amber-400"}>
                    {config?.clientIdSet ? "Set" : "Not set"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Client Secret</span>
                  <span className={config?.clientSecretSet ? "text-emerald-400" : "text-amber-400"}>
                    {config?.clientSecretSet ? "Set" : "Not set"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Webhook Secret</span>
                  <span className={config?.webhookSecretSet ? "text-emerald-400" : "text-amber-400"}>
                    {config?.webhookSecretSet ? "Set" : "Not set"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Environment</span>
                  <span className={currentEnv === "live" ? "text-emerald-400" : "text-sky-400"}>
                    {currentEnv === "live" ? "Live" : "Sandbox"}
                  </span>
                </div>
              </div>

              <Button className="w-full" onClick={handleSave} disabled={saving}>
                <Save className="w-4 h-4 mr-2" />
                {saving ? "Saving…" : "Save Configuration"}
              </Button>
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm text-muted-foreground">Integration Guide</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground space-y-2">
              <p>1. Log into your payment gateway provider dashboard</p>
              <p>2. Navigate to <strong className="text-foreground">API Keys</strong> or Credentials section</p>
              <p>3. Copy your <strong className="text-foreground">Client ID</strong> and <strong className="text-foreground">Client Secret</strong></p>
              <p>4. Set the webhook URL to this page's endpoint (shown above)</p>
              <p>5. Copy the <strong className="text-foreground">Webhook Secret Key</strong> from your gateway and paste above</p>
              <p>6. Set environment to <strong className="text-foreground">Sandbox</strong> for testing, <strong className="text-foreground">Live</strong> for production</p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Webhook Logs */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              Webhook Logs
              {logsData && (
                <Badge variant="outline" className="ml-2 text-xs">{totalLogs.toLocaleString()} total</Badge>
              )}
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => refetchLogs()}>
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {logsLoading ? (
            <div className="text-center text-muted-foreground text-sm py-8">Loading logs…</div>
          ) : !logsData?.data?.length ? (
            <div className="text-center text-muted-foreground text-sm py-8">No webhook logs yet</div>
          ) : (
            <>
              <div className="rounded-md border border-border/40 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/40 hover:bg-transparent">
                      <TableHead className="text-xs">Received At</TableHead>
                      <TableHead className="text-xs">Event Type</TableHead>
                      <TableHead className="text-xs">Order ID</TableHead>
                      <TableHead className="text-xs">Amount</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                      <TableHead className="text-xs">Result</TableHead>
                      <TableHead className="text-xs">Note</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logsData.data.map((log) => (
                      <TableRow key={log.id} className="border-border/40 text-xs">
                        <TableCell className="font-mono text-muted-foreground whitespace-nowrap">
                          {formatDate(log.receivedAt)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{log.eventType ?? "—"}</TableCell>
                        <TableCell className="font-mono">{log.cashfreeOrderId ?? "—"}</TableCell>
                        <TableCell>{log.amount ? `₹${log.amount}` : "—"}</TableCell>
                        <TableCell>{log.status ?? "—"}</TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={
                              log.processingResult === "credited"
                                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                                : log.processingResult === "duplicate"
                                  ? "bg-sky-500/10 text-sky-400 border-sky-500/30"
                                  : log.processingResult === "error"
                                    ? "bg-red-500/10 text-red-400 border-red-500/30"
                                    : "bg-muted text-muted-foreground"
                            }
                          >
                            {log.processingResult}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground max-w-[200px] truncate">
                          {log.errorMessage ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
                  <span>Page {logsPage} of {totalPages}</span>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={logsPage <= 1} onClick={() => setLogsPage(p => p - 1)}>
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="outline" size="sm" disabled={logsPage >= totalPages} onClick={() => setLogsPage(p => p + 1)}>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
