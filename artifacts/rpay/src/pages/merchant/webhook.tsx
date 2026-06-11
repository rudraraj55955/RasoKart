import { useEffect, useState } from "react";
import { useGetWebhookConfig, useUpdateWebhookConfig, getGetWebhookConfigQueryKey, useGetCallbackSecret, useRotateCallbackSecret, getGetCallbackSecretQueryKey, useGetWebhookLogs, getGetWebhookLogsQueryKey, useSendWebhookTest, useRetryWebhookLog, WebhookTestRequestEventType } from "@workspace/api-client-react";
import { SECRET_WARN_DAYS, SECRET_ROTATION_OVERDUE_DAYS } from "@/lib/webhook-constants";
import type { CallbackLog } from "@workspace/api-client-react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save, Webhook, ShieldCheck, RefreshCw, Copy, AlertTriangle, Eye, CheckCircle2, XCircle, Clock, Activity, FlaskConical, Zap, ChevronRight, RotateCcw, ShieldOff, Shield, FlaskRound } from "lucide-react";
import { formatDistanceToNow, format, differenceInDays } from "date-fns";

function SignatureVerifiedBadge({ value }: { value: boolean | null | undefined }) {
  if (value === true) {
    return <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 hover:bg-emerald-500/20 text-xs">✓ Verified</Badge>;
  }
  if (value === false) {
    return <Badge className="bg-rose-500/10 text-rose-500 border-rose-500/20 hover:bg-rose-500/20 text-xs">✗ Failed</Badge>;
  }
  return <span className="text-muted-foreground text-xs">— None</span>;
}

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

type TestResult = {
  delivered: boolean;
  httpStatus: number | null;
  responseBody: string | null;
  durationMs: number;
  targetUrl: string;
  signed: boolean;
};

function WebhookTestPanel({ result, onDismiss, onRetry, isRetrying }: { result: TestResult; onDismiss: () => void; onRetry?: () => void; isRetrying?: boolean }) {
  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  };

  return (
    <div className={`rounded-lg border p-4 space-y-3 ${result.delivered ? "border-emerald-500/30 bg-emerald-500/5" : "border-rose-500/30 bg-rose-500/5"}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {result.delivered ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          ) : (
            isRetrying ? (
              <RefreshCw className="w-4 h-4 text-rose-400 animate-spin" />
            ) : (
              <XCircle className="w-4 h-4 text-rose-400" />
            )
          )}
          <span className={`text-sm font-semibold ${result.delivered ? "text-emerald-400" : "text-rose-400"}`}>
            {result.delivered ? "Test delivered successfully" : isRetrying ? "Retrying…" : "Test delivery failed"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {!result.delivered && onRetry && (
            <Button
              variant="outline"
              size="sm"
              onClick={onRetry}
              disabled={isRetrying}
              className="h-6 px-2 text-xs gap-1 border-rose-500/30 hover:border-rose-500/60 hover:bg-rose-500/10 text-rose-400 hover:text-rose-300"
            >
              <RotateCcw className={`w-3 h-3 ${isRetrying ? "animate-spin" : ""}`} />
              {isRetrying ? "Retrying…" : "Retry"}
            </Button>
          )}
          <button
            onClick={onDismiss}
            className="text-muted-foreground/50 hover:text-muted-foreground text-xs transition-colors"
          >
            Dismiss
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 text-xs">
        <div className="rounded bg-black/30 p-2 border border-border/30">
          <p className="text-muted-foreground/60 mb-0.5">HTTP Status</p>
          <p className={`font-mono font-semibold ${result.httpStatus != null && result.httpStatus >= 200 && result.httpStatus < 300 ? "text-emerald-400" : "text-rose-400"}`}>
            {result.httpStatus != null ? result.httpStatus : "No response"}
          </p>
        </div>
        <div className="rounded bg-black/30 p-2 border border-border/30">
          <p className="text-muted-foreground/60 mb-0.5">Duration</p>
          <p className="font-mono font-semibold text-foreground">{result.durationMs}ms</p>
        </div>
        <div className="rounded bg-black/30 p-2 border border-border/30">
          <p className="text-muted-foreground/60 mb-0.5">Signature</p>
          <p className={`font-semibold ${result.signed ? "text-emerald-400" : "text-amber-400"}`}>
            {result.signed ? "Signed" : "Unsigned"}
          </p>
        </div>
      </div>

      <div>
        <p className="text-xs text-muted-foreground/60 mb-1">Target URL</p>
        <p className="text-xs font-mono text-muted-foreground truncate" title={result.targetUrl}>{result.targetUrl}</p>
      </div>

      {result.responseBody != null && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs text-muted-foreground/60">Response Body</p>
            <button
              onClick={() => copy(result.responseBody!)}
              className="text-muted-foreground/50 hover:text-muted-foreground transition-colors"
              title="Copy response body"
            >
              <Copy className="w-3 h-3" />
            </button>
          </div>
          <pre className="text-xs font-mono bg-black/40 border border-border/30 rounded p-2.5 overflow-x-auto whitespace-pre-wrap break-all text-muted-foreground max-h-32 overflow-y-auto">
            {result.responseBody}
          </pre>
        </div>
      )}

      {!result.signed && (
        <p className="text-xs text-amber-400/80">
          No signing secret set — add one in the configuration above so your server can verify payload authenticity.
        </p>
      )}
    </div>
  );
}

function formatJsonBody(raw: string | null | undefined): string {
  if (!raw) return "";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function parseEventType(requestBody: string | null | undefined): string | null {
  if (!requestBody) return null;
  try {
    const parsed = JSON.parse(requestBody);
    if (typeof parsed?.event === "string" && parsed.event.length > 0) {
      return parsed.event as string;
    }
  } catch {
    // ignore parse errors
  }
  return null;
}

const EVENT_TYPE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  "payment.success":      { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/25" },
  "payment.failed":       { bg: "bg-rose-500/10",    text: "text-rose-400",    border: "border-rose-500/25"    },
  "payment.pending":      { bg: "bg-amber-500/10",   text: "text-amber-400",   border: "border-amber-500/25"   },
  "payment.received":     { bg: "bg-sky-500/10",     text: "text-sky-400",     border: "border-sky-500/25"     },
  "withdrawal.approved":  { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/25" },
  "withdrawal.rejected":  { bg: "bg-rose-500/10",    text: "text-rose-400",    border: "border-rose-500/25"    },
  "settlement.processed": { bg: "bg-violet-500/10",  text: "text-violet-400",  border: "border-violet-500/25"  },
};

function EventTypeBadge({ eventType, size = "sm" }: { eventType: string | null; size?: "sm" | "md" }) {
  if (!eventType) return null;
  const colors = EVENT_TYPE_COLORS[eventType] ?? { bg: "bg-muted/40", text: "text-muted-foreground", border: "border-border/50" };
  const cls = size === "md"
    ? `inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-mono font-semibold ${colors.bg} ${colors.text} ${colors.border}`
    : `inline-flex items-center rounded border px-1.5 py-px text-[10px] font-mono font-semibold ${colors.bg} ${colors.text} ${colors.border}`;
  return <span className={cls}>{eventType}</span>;
}

function DeliveryDetailModal({ log, onClose, onRetry, isRetrying }: { log: CallbackLog | null; onClose: () => void; onRetry?: (id: number) => void; isRetrying?: boolean }) {
  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  };

  if (!log) return null;

  const canRetry = (log.status === "failed" || log.status === "pending_retry") && !!log.requestBody;

  const reqBody = formatJsonBody(log.requestBody);
  const resBody = formatJsonBody(log.responseBody);
  const eventType = parseEventType(log.requestBody);

  return (
    <Dialog open={!!log} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" />
            Delivery Details
            {log.isTest && (
              <span className="flex items-center gap-0.5 rounded-full bg-violet-500/15 border border-violet-500/30 text-violet-400 px-2 py-0.5 text-xs font-semibold">
                <FlaskRound className="w-3 h-3" />
                Test
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-1">
          {/* Event type */}
          {eventType && (
            <div className="flex items-center gap-2">
              <p className="text-xs text-muted-foreground/60 uppercase tracking-wider font-medium">Event</p>
              <EventTypeBadge eventType={eventType} size="md" />
            </div>
          )}

          {/* Status row */}
          <div className="flex items-center gap-4 p-3 rounded-lg bg-muted/20 border border-border/50">
            <StatusBadge status={log.status} />
            {log.httpStatus != null && (
              <span className={`text-sm font-mono font-semibold ${log.httpStatus >= 200 && log.httpStatus < 300 ? "text-emerald-400" : "text-rose-400"}`}>
                HTTP {log.httpStatus}
              </span>
            )}
            <SignatureVerifiedBadge value={log.signatureVerified} />
            <span className="text-xs text-muted-foreground/70 ml-auto">
              {log.attempts} {log.attempts === 1 ? "attempt" : "attempts"}
            </span>
          </div>

          {/* Target URL */}
          <div>
            <p className="text-xs text-muted-foreground/60 uppercase tracking-wider mb-1.5 font-medium">Target URL</p>
            <div className="flex items-center gap-2 bg-black/30 border border-border/40 rounded-lg px-3 py-2">
              <code className="flex-1 text-xs font-mono text-muted-foreground break-all">{log.url}</code>
              <button onClick={() => copy(log.url)} className="shrink-0 text-muted-foreground/50 hover:text-muted-foreground transition-colors" title="Copy URL">
                <Copy className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Next retry */}
          {log.status === "pending_retry" && log.nextRetryAt != null && (
            <div className="flex items-center gap-2 p-3 rounded-lg border border-amber-500/20 bg-amber-500/5 text-amber-400">
              <Clock className="w-4 h-4 shrink-0" />
              <div>
                <p className="text-xs font-medium">Next retry scheduled</p>
                <p className="text-xs text-amber-400/70 font-mono">
                  {formatDistanceToNow(new Date(log.nextRetryAt), { addSuffix: true })}
                  {" "}— {new Date(log.nextRetryAt).toLocaleString()}
                </p>
              </div>
            </div>
          )}

          {/* Request body */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs text-muted-foreground/60 uppercase tracking-wider font-medium">Request Body</p>
              {reqBody && (
                <button onClick={() => copy(reqBody)} className="text-muted-foreground/50 hover:text-muted-foreground transition-colors" title="Copy request body">
                  <Copy className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {reqBody ? (
              <pre className="text-xs font-mono bg-black/40 border border-border/30 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all text-green-300/80 max-h-64 overflow-y-auto leading-relaxed">
                {reqBody}
              </pre>
            ) : (
              <p className="text-xs text-muted-foreground/50 italic px-1">No request body recorded</p>
            )}
          </div>

          {/* Response body */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs text-muted-foreground/60 uppercase tracking-wider font-medium">Response Body</p>
              {resBody && (
                <button onClick={() => copy(resBody)} className="text-muted-foreground/50 hover:text-muted-foreground transition-colors" title="Copy response body">
                  <Copy className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {resBody ? (
              <pre className="text-xs font-mono bg-black/40 border border-border/30 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all text-muted-foreground max-h-48 overflow-y-auto leading-relaxed">
                {resBody}
              </pre>
            ) : (
              <p className="text-xs text-muted-foreground/50 italic px-1">No response body recorded</p>
            )}
          </div>

          {/* Timestamps */}
          <div className="grid grid-cols-2 gap-3 pt-1 border-t border-border/40">
            <div>
              <p className="text-xs text-muted-foreground/60 mb-0.5">Created</p>
              <p className="text-xs font-mono text-muted-foreground">{new Date(log.createdAt).toLocaleString()}</p>
            </div>
            {log.lastAttemptAt && (
              <div>
                <p className="text-xs text-muted-foreground/60 mb-0.5">Last attempt</p>
                <p className="text-xs font-mono text-muted-foreground">{new Date(log.lastAttemptAt).toLocaleString()}</p>
              </div>
            )}
          </div>

          {/* Retry action */}
          {canRetry && onRetry && (
            <div className="pt-2 border-t border-border/40">
              <Button
                size="sm"
                variant="outline"
                disabled={isRetrying}
                onClick={() => onRetry(log.id)}
                className="w-full border-amber-500/30 text-amber-400 hover:bg-amber-500/10 hover:text-amber-300 hover:border-amber-500/50"
              >
                <RotateCcw className={`w-3.5 h-3.5 mr-1.5 ${isRetrying ? "animate-spin" : ""}`} />
                {isRetrying ? "Retrying…" : "Retry now"}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function MerchantWebhook() {
  const qc = useQueryClient();
  const { data: config, isLoading } = useGetWebhookConfig();
  const { data: secretStatus, isLoading: secretLoading } = useGetCallbackSecret();
  const { data: logsData, isLoading: logsLoading } = useGetWebhookLogs({ limit: 10 });
  const updateMutation = useUpdateWebhookConfig();
  const rotateMutation = useRotateCallbackSecret();
  const testMutation = useSendWebhookTest();
  const retryMutation = useRetryWebhookLog();

  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [events, setEvents] = useState<string[]>([]);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [selectedLog, setSelectedLog] = useState<CallbackLog | null>(null);
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const [testEventType, setTestEventType] = useState<WebhookTestRequestEventType>(WebhookTestRequestEventType.paymentsuccess);

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

  const handleSendTest = () => {
    if (!url.trim()) {
      toast.error("Save a webhook URL first before sending a test event");
      return;
    }
    setTestResult(null);
    testMutation.mutate({ data: { eventType: testEventType } }, {
      onSuccess: (data) => {
        setTestResult(data);
        if (data.delivered) {
          toast.success("Test event delivered successfully");
        } else {
          toast.error(`Test event failed — HTTP ${data.httpStatus ?? "no response"}`);
        }
      },
      onError: () => toast.error("Failed to send test event"),
      onSettled: () => qc.invalidateQueries({ queryKey: getGetWebhookLogsQueryKey() }),
    });
  };

  const handleRetryTest = () => {
    testMutation.mutate({}, {
      onSuccess: (data) => {
        setTestResult(data);
        if (data.delivered) {
          toast.success("Test event delivered successfully");
        } else {
          toast.error(`Test event failed — HTTP ${data.httpStatus ?? "no response"}`);
        }
      },
      onError: () => toast.error("Failed to send test event"),
      onSettled: () => qc.invalidateQueries({ queryKey: getGetWebhookLogsQueryKey() }),
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

  const handleRetry = (logId: number) => {
    setRetryingId(logId);
    retryMutation.mutate({ id: logId }, {
      onSuccess: (data) => {
        if (data.delivered) {
          toast.success("Retry succeeded — webhook delivered");
        } else {
          toast.error("Retry failed — endpoint still unreachable");
        }
        qc.invalidateQueries({ queryKey: getGetWebhookLogsQueryKey() });
        if (data.log) {
          setSelectedLog(prev => (prev?.id === logId ? (data.log as CallbackLog) : prev));
        }
      },
      onError: () => toast.error("Retry request failed"),
      onSettled: () => setRetryingId(null),
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

      <div className="flex items-center gap-3 flex-wrap">
        <Button onClick={handleSave} disabled={updateMutation.isPending} className="w-full sm:w-auto">
          <Save className="w-4 h-4 mr-2" />
          {updateMutation.isPending ? "Saving..." : "Save Configuration"}
        </Button>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Select
            value={testEventType}
            onValueChange={(v) => setTestEventType(v as WebhookTestRequestEventType)}
            disabled={testMutation.isPending || !url.trim()}
          >
            <SelectTrigger className="w-[190px] h-9 text-xs font-mono">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EVENTS.map(event => (
                <SelectItem key={event.id} value={event.id} className="text-xs">
                  <span className="font-mono">{event.id}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            onClick={handleSendTest}
            disabled={testMutation.isPending || !url.trim()}
            className="gap-2 h-9"
            title={!url.trim() ? "Configure and save a webhook URL first" : undefined}
          >
            {testMutation.isPending ? (
              <>
                <Zap className="w-4 h-4 animate-pulse" />
                Sending…
              </>
            ) : (
              <>
                <FlaskConical className="w-4 h-4" />
                Send test
              </>
            )}
          </Button>
        </div>
      </div>

      {testResult && (
        <WebhookTestPanel
          result={testResult}
          onDismiss={() => setTestResult(null)}
          onRetry={handleRetryTest}
          isRetrying={testMutation.isPending}
        />
      )}

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
              {logs.map(log => {
                const rowEventType = parseEventType(log.requestBody);
                return (
                <div
                  key={log.id}
                  className="flex items-center gap-3 py-3 first:pt-0 last:pb-0 group cursor-pointer hover:bg-muted/20 -mx-1 px-1 rounded transition-colors"
                  onClick={() => setSelectedLog(log)}
                >
                  <div className="w-28 shrink-0">
                    <StatusBadge status={log.status} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {rowEventType && <EventTypeBadge eventType={rowEventType} />}
                      {log.isTest && (
                        <span className="shrink-0 flex items-center gap-0.5 rounded-full bg-violet-500/15 border border-violet-500/30 text-violet-400 px-1.5 py-0.5 text-[10px] font-semibold">
                          <FlaskRound className="w-2.5 h-2.5" />
                          Test
                        </span>
                      )}
                      <p className="text-xs font-mono text-muted-foreground truncate" title={log.url}>{log.url}</p>
                    </div>
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
                  <div className="flex items-center gap-2 shrink-0">
                    {(log.status === "failed" || log.status === "pending_retry") && !!log.requestBody && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 px-2 text-xs gap-1 border-rose-500/30 hover:border-rose-500/60 hover:bg-rose-500/10 text-rose-400 hover:text-rose-300"
                        disabled={retryingId === log.id}
                        onClick={(e) => { e.stopPropagation(); handleRetry(log.id); }}
                      >
                        <RotateCcw className={`w-3 h-3 ${retryingId === log.id ? "animate-spin" : ""}`} />
                        {retryingId === log.id ? "Retrying…" : "Retry"}
                      </Button>
                    )}
                    <SignatureVerifiedBadge value={log.signatureVerified} />
                    <div className="text-xs text-muted-foreground/60 text-right">
                      {log.createdAt
                        ? formatDistanceToNow(new Date(log.createdAt), { addSuffix: true })
                        : "—"}
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40 group-hover:text-muted-foreground/70 transition-colors" />
                  </div>
                </div>
                );
              })}
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
          ) : (() => {
            const ageInDays = secretStatus?.isSet && secretStatus.lastRotatedAt != null
              ? differenceInDays(new Date(), new Date(secretStatus.lastRotatedAt))
              : null;
            const daysLeft = ageInDays != null ? Math.max(0, SECRET_ROTATION_OVERDUE_DAYS - ageInDays) : null;
            const isOverdue = ageInDays != null && ageInDays >= SECRET_ROTATION_OVERDUE_DAYS;
            const isWarningSoon = ageInDays != null && ageInDays >= SECRET_WARN_DAYS && !isOverdue;
            return (
              <div className="space-y-2">
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/20 border border-border/50">
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${secretStatus?.isSet ? "bg-emerald-500" : "bg-muted-foreground"}`} />
                    <div>
                      <p className="text-sm font-medium">{secretStatus?.isSet ? "Secret configured" : "No secret configured"}</p>
                      {secretStatus?.isSet && secretStatus.secretPrefix && (
                        <p className="text-xs text-muted-foreground font-mono">{secretStatus.secretPrefix}</p>
                      )}
                      {secretStatus?.isSet && secretStatus.lastRotatedAt != null && (
                        <p className="text-xs text-muted-foreground/70 mt-0.5">
                          Last rotated: {format(new Date(secretStatus.lastRotatedAt), "dd MMM yyyy")}
                          {" "}
                          <span className="text-muted-foreground/50">
                            ({formatDistanceToNow(new Date(secretStatus.lastRotatedAt), { addSuffix: true })})
                          </span>
                          {daysLeft != null && !isOverdue && !isWarningSoon && (
                            <span className="ml-2 font-medium text-muted-foreground/60">
                              · Rotation due in {daysLeft} day{daysLeft !== 1 ? "s" : ""}
                            </span>
                          )}
                        </p>
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
                {isWarningSoon && daysLeft != null && (
                  <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-400">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-medium">Rotation due in {daysLeft} day{daysLeft !== 1 ? "s" : ""} — </span>
                      <span className="text-xs text-amber-400/80">
                        Rotate your callback secret soon to keep your integration secure.
                      </span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleRotateSecret}
                      disabled={rotateMutation.isPending}
                      className="shrink-0 gap-1.5 border-amber-500/40 text-amber-400 hover:bg-amber-500/20 hover:border-amber-500/60 hover:text-amber-300 h-7 px-2.5 text-xs"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Rotate now
                    </Button>
                  </div>
                )}
                {isOverdue && ageInDays != null && (
                  <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-400">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-medium">Rotation overdue — </span>
                      <span className="text-xs text-amber-400/80">
                        This secret is {ageInDays} days old. Rotate it now to keep your integration secure.
                      </span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleRotateSecret}
                      disabled={rotateMutation.isPending}
                      className="shrink-0 gap-1.5 border-amber-500/40 text-amber-400 hover:bg-amber-500/20 hover:border-amber-500/60 hover:text-amber-300 h-7 px-2.5 text-xs"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Rotate now
                    </Button>
                  </div>
                )}
              </div>
            );
          })()}

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

      <DeliveryDetailModal
        log={selectedLog}
        onClose={() => setSelectedLog(null)}
        onRetry={handleRetry}
        isRetrying={retryingId === selectedLog?.id}
      />

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
