import { useEffect, useState } from "react";
import { useGetWebhookConfig, useUpdateWebhookConfig, getGetWebhookConfigQueryKey, useGetCallbackSecret, useRotateCallbackSecret, getGetCallbackSecretQueryKey, useGetWebhookLogs } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Save, Webhook, ShieldCheck, RefreshCw, Copy, AlertTriangle, Eye, CheckCircle2, XCircle, Clock, Activity } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const EVENTS = [
  { id: "payment.success", label: "Payment Success" },
  { id: "payment.failed", label: "Payment Failed" },
  { id: "payment.pending", label: "Payment Pending" },
  { id: "withdrawal.approved", label: "Withdrawal Approved" },
  { id: "withdrawal.rejected", label: "Withdrawal Rejected" },
  { id: "settlement.processed", label: "Settlement Processed" },
];

function StatusBadge({ status }: { status: string }) {
  if (status === "success") {
    return (
      <span className="flex items-center gap-1 text-emerald-400">
        <CheckCircle2 className="w-3.5 h-3.5" />
        <span className="text-xs font-medium">Success</span>
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="flex items-center gap-1 text-rose-400">
        <XCircle className="w-3.5 h-3.5" />
        <span className="text-xs font-medium">Failed</span>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-amber-400">
      <Clock className="w-3.5 h-3.5" />
      <span className="text-xs font-medium">Pending retry</span>
    </span>
  );
}

export default function MerchantWebhook() {
  const qc = useQueryClient();
  const { data: config, isLoading } = useGetWebhookConfig();
  const { data: secretStatus, isLoading: secretLoading } = useGetCallbackSecret();
  const { data: logsData, isLoading: logsLoading } = useGetWebhookLogs({ limit: 10 });
  const updateMutation = useUpdateWebhookConfig();
  const rotateMutation = useRotateCallbackSecret();

  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [events, setEvents] = useState<string[]>([]);
  const [newSecret, setNewSecret] = useState<string | null>(null);

  useEffect(() => {
    if (config) {
      setUrl(config.url || "");
      setSecret(config.secret || "");
      setIsActive(config.isActive);
      setEvents(config.events || []);
    }
  }, [config]);

  const toggleEvent = (eventId: string) => {
    setEvents(prev => prev.includes(eventId) ? prev.filter(e => e !== eventId) : [...prev, eventId]);
  };

  const handleSave = () => {
    if (!url.trim()) { toast.error("Webhook URL is required"); return; }
    updateMutation.mutate({ data: { url: url.trim(), isActive, events, secret: secret || null } }, {
      onSuccess: () => { toast.success("Webhook configuration saved"); qc.invalidateQueries({ queryKey: getGetWebhookConfigQueryKey() }); },
      onError: () => toast.error("Failed to save configuration"),
    });
  };

  const handleRotateSecret = () => {
    if (!confirm("Generate a new callback signing secret? Any existing integrations using the old secret will stop working immediately.")) return;
    rotateMutation.mutate(undefined, {
      onSuccess: (data) => {
        setNewSecret(data.secret);
        qc.invalidateQueries({ queryKey: getGetCallbackSecretQueryKey() });
      },
      onError: () => toast.error("Failed to rotate secret"),
    });
  };

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  };

  const logs = logsData?.data ?? [];

  if (isLoading) return <div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 bg-muted/50 rounded-lg animate-pulse" />)}</div>;

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center border border-primary/20"><Webhook className="w-5 h-5 text-primary" /></div>
        <div><h1 className="text-3xl font-bold tracking-tight">Webhook</h1><p className="text-muted-foreground mt-0.5">Configure callback URL for payment events</p></div>
      </div>

      <Card>
        <CardHeader><CardTitle>Endpoint Configuration</CardTitle><CardDescription>RasoKart will send POST requests to this URL for the selected events</CardDescription></CardHeader>
        <CardContent className="space-y-5">
          <div>
            <Label>Webhook URL</Label>
            <Input className="mt-1.5 font-mono" placeholder="https://yourapp.com/webhook" value={url} onChange={e => setUrl(e.target.value)} />
          </div>
          <div>
            <Label>Signing Secret <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Input className="mt-1.5 font-mono" type="password" placeholder="Used to verify payload authenticity" value={secret} onChange={e => setSecret(e.target.value)} />
          </div>
          <div className="flex items-center justify-between py-3 border-t border-border/50">
            <div>
              <p className="font-medium text-sm">Active</p>
              <p className="text-xs text-muted-foreground">Enable or disable webhook delivery</p>
            </div>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Events</CardTitle><CardDescription>Select which events trigger your webhook</CardDescription></CardHeader>
        <CardContent>
          <div className="space-y-3">
            {EVENTS.map(event => (
              <div key={event.id} className="flex items-center gap-3 p-2 rounded hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => toggleEvent(event.id)}>
                <Checkbox id={event.id} checked={events.includes(event.id)} onCheckedChange={() => toggleEvent(event.id)} />
                <div className="flex-1">
                  <label htmlFor={event.id} className="text-sm font-medium cursor-pointer">{event.label}</label>
                  <p className="text-xs text-muted-foreground font-mono">{event.id}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Button onClick={handleSave} disabled={updateMutation.isPending} className="w-full sm:w-auto">
        <Save className="w-4 h-4 mr-2" />
        {updateMutation.isPending ? "Saving..." : "Save Configuration"}
      </Button>

      {/* Recent Deliveries */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" />
            <CardTitle>Recent Deliveries</CardTitle>
          </div>
          <CardDescription>Last 10 webhook delivery attempts to your endpoint</CardDescription>
        </CardHeader>
        <CardContent>
          {logsLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-14 bg-muted/40 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <Activity className="w-8 h-8 text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">No deliveries yet</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Delivery logs appear here once webhooks are triggered</p>
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {logs.map(log => (
                <div key={log.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="w-28 shrink-0">
                    <StatusBadge status={log.status} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-mono text-muted-foreground truncate" title={log.url}>{log.url}</p>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-xs text-muted-foreground/70">
                        {log.httpStatus != null ? (
                          <span className={log.httpStatus >= 200 && log.httpStatus < 300 ? "text-emerald-400/80" : "text-rose-400/80"}>
                            HTTP {log.httpStatus}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/50">No response</span>
                        )}
                      </span>
                      <span className="text-xs text-muted-foreground/50">·</span>
                      <span className="text-xs text-muted-foreground/70">
                        {log.attempts} {log.attempts === 1 ? "attempt" : "attempts"}
                      </span>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground/60 shrink-0 text-right">
                    {log.createdAt
                      ? formatDistanceToNow(new Date(log.createdAt), { addSuffix: true })
                      : "—"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-primary/20">
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            <CardTitle>Callback Signing Secret</CardTitle>
          </div>
          <CardDescription>
            Secure the <code className="font-mono text-xs bg-muted px-1 rounded">POST /api/callbacks</code> endpoint by requiring HMAC-SHA256 signatures on all inbound payment notifications
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {secretLoading ? (
            <div className="h-10 bg-muted/50 rounded animate-pulse" />
          ) : (
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/20 border border-border/50">
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${secretStatus?.isSet ? "bg-emerald-500" : "bg-muted-foreground"}`} />
                <div>
                  <p className="text-sm font-medium">{secretStatus?.isSet ? "Secret configured" : "No secret configured"}</p>
                  {secretStatus?.isSet && secretStatus.secretPrefix && (
                    <p className="text-xs text-muted-foreground font-mono">{secretStatus.secretPrefix}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {secretStatus?.isSet && (
                  <Badge variant="secondary" className="text-[10px] text-emerald-400 border-emerald-500/30 bg-emerald-500/10">Active</Badge>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRotateSecret}
                  disabled={rotateMutation.isPending}
                  className="gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  {secretStatus?.isSet ? "Rotate" : "Generate"}
                </Button>
              </div>
            </div>
          )}

          <div className="space-y-2 text-sm text-muted-foreground">
            <p>When a secret is set, every inbound callback request must include:</p>
            <code className="block bg-black/60 border border-border/50 rounded p-3 text-xs font-mono text-green-300">
              X-Signature: sha256={"<hmac-sha256-of-raw-body>"}
            </code>
            <p>Compute the signature in your payment provider or backend:</p>
            <code className="block bg-black/60 border border-border/50 rounded p-3 text-xs font-mono text-green-300 whitespace-pre">{`const sig = 'sha256=' + crypto
  .createHmac('sha256', YOUR_CALLBACK_SECRET)
  .update(rawRequestBody)
  .digest('hex');`}</code>
            <p className="text-xs">Requests with a missing or invalid signature are rejected with <code className="font-mono bg-muted px-1 rounded">401 Unauthorized</code>.</p>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!newSecret} onOpenChange={() => setNewSecret(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Eye className="w-5 h-5 text-amber-500" />Save your callback signing secret</DialogTitle></DialogHeader>
          <Alert className="border-rose-500/30 bg-rose-500/5">
            <AlertTriangle className="w-4 h-4 text-rose-500" />
            <AlertDescription className="text-rose-200/80 font-medium">This secret is shown only once and cannot be retrieved later. Copy it now.</AlertDescription>
          </Alert>
          {newSecret && (
            <div className="mt-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Callback Signing Secret</p>
              <div className="flex items-center gap-2 bg-muted/30 rounded-lg p-3 border border-border/50">
                <code className="flex-1 text-sm break-all text-amber-400 font-mono">{newSecret}</code>
                <Button variant="ghost" size="icon" onClick={() => copy(newSecret)}><Copy className="w-4 h-4" /></Button>
              </div>
              <p className="text-xs text-muted-foreground mt-3">Use this value as <code className="font-mono bg-muted px-1 rounded">YOUR_CALLBACK_SECRET</code> in your integration.</p>
            </div>
          )}
          <Button className="w-full mt-2" onClick={() => setNewSecret(null)}>I have saved my secret</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
