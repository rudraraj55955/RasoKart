import { useEffect, useState } from "react";
import { EVENT_TYPE_COLORS, EventTypeBadge } from "@/components/ui/event-type-badge";
import { useGetWebhookConfig, useUpdateWebhookConfig, getGetWebhookConfigQueryKey, useGetCallbackSecret, useRotateCallbackSecret, getGetCallbackSecretQueryKey, useGetWebhookLogs, getGetWebhookLogsQueryKey, useSendWebhookTest, useRetryWebhookLog, useGetWebhookLogStats, getGetWebhookLogStatsQueryKey, useGetWebhookRetryDefaults, useGetWebhookPlatformDefaults, WebhookTestRequestEventType, GetWebhookLogsStatus } from "@workspace/api-client-react";
import { SECRET_WARN_DAYS, SECRET_ROTATION_OVERDUE_DAYS } from "@/lib/webhook-constants";
import type { CallbackLog, WebhookLogDayBucket } from "@workspace/api-client-react";
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
import { getApiErrorMessage } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save, Webhook, ShieldCheck, RefreshCw, Copy, AlertTriangle, Eye, CheckCircle2, XCircle, Clock, Activity, FlaskConical, Zap, ChevronRight, ChevronDown, RotateCcw, ShieldOff, Shield, FlaskRound, X, BarChart2, Calendar, Bell, BellOff, TrendingDown, TrendingUp, Minus } from "lucide-react";
import { formatDistanceToNow, format, differenceInDays } from "date-fns";
import { SIG_VERIFIED_KEY } from "./callbacks";

const SIG_VERIFIED_DISMISSED_KEY = "rasokart_sig_verified_dismissed_until";
const SIG_VERIFIED_DISMISSED_TTL_MS = 24 * 60 * 60 * 1000;

interface SigVerifiedDismissal {
  dismissedUntil: number;
  dismissedAt: number;
}

function readSigVerifiedDismissal(): SigVerifiedDismissal | null {
  try {
    const val = localStorage.getItem(SIG_VERIFIED_DISMISSED_KEY);
    if (!val) return null;
    return JSON.parse(val) as SigVerifiedDismissal;
  } catch {
    return null;
  }
}

function isSigVerifiedStillDismissed(dismissal: SigVerifiedDismissal): boolean {
  if (Date.now() >= dismissal.dismissedUntil) return false;
  try {
    const verifiedAt = Number(localStorage.getItem(SIG_VERIFIED_KEY));
    if (Number.isFinite(verifiedAt) && verifiedAt > dismissal.dismissedAt) return false;
  } catch { /* ignore */ }
  return true;
}

function writeSigVerifiedDismissal() {
  try {
    const now = Date.now();
    const dismissal: SigVerifiedDismissal = {
      dismissedUntil: now + SIG_VERIFIED_DISMISSED_TTL_MS,
      dismissedAt: now,
    };
    localStorage.setItem(SIG_VERIFIED_DISMISSED_KEY, JSON.stringify(dismissal));
  } catch { /* ignore */ }
}

function clearSigVerifiedDismissal() {
  try {
    localStorage.removeItem(SIG_VERIFIED_DISMISSED_KEY);
  } catch { /* ignore */ }
}

type TrendDirection = "improving" | "declining" | "stable" | "nodata";

function getTrendDirection(trend: WebhookLogDayBucket[]): TrendDirection {
  const rates = trend.map(d => {
    const total = d.success + d.failed;
    return total > 0 ? d.failed / total : null;
  });
  const firstHalf = rates.slice(0, 3).filter((r): r is number => r !== null);
  const lastHalf = rates.slice(4).filter((r): r is number => r !== null);
  if (firstHalf.length === 0 && lastHalf.length === 0) return "nodata";
  if (firstHalf.length === 0 || lastHalf.length === 0) return "stable";
  const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
  const avgLast = lastHalf.reduce((a, b) => a + b, 0) / lastHalf.length;
  const diff = avgLast - avgFirst;
  if (diff > 0.05) return "declining";
  if (diff < -0.05) return "improving";
  return "stable";
}

function FailureRateSparkline({ trend }: { trend: WebhookLogDayBucket[] }) {
  const W = 56, H = 22, PAD = 2;
  const pts = trend.map((d, i) => {
    const total = d.success + d.failed;
    const rate = total > 0 ? d.success / total : null;
    return { x: PAD + (i / Math.max(trend.length - 1, 1)) * (W - PAD * 2), y: rate };
  });
  const valid = pts.filter((p): p is { x: number; y: number } => p.y !== null);
  if (valid.length < 2) {
    return <span className="text-muted-foreground/30 text-[10px] font-mono">—</span>;
  }
  const toY = (rate: number) => PAD + (1 - rate) * (H - PAD * 2);
  const dir = getTrendDirection(trend);
  const strokeColor = dir === "declining" ? "#f43f5e" : dir === "improving" ? "#34d399" : "#64748b";
  const fillColor = dir === "declining" ? "rgba(244,63,94,0.08)" : dir === "improving" ? "rgba(52,211,153,0.08)" : "rgba(100,116,139,0.06)";
  const linePath = valid.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${toY(p.y).toFixed(1)}`).join(" ");
  const last = valid[valid.length - 1];
  const first = valid[0];
  const fillPath = `${linePath} L ${last.x.toFixed(1)} ${(H - PAD).toFixed(1)} L ${first.x.toFixed(1)} ${(H - PAD).toFixed(1)} Z`;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
      <path d={fillPath} fill={fillColor} stroke="none" />
      <path d={linePath} fill="none" stroke={strokeColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {valid.map((p, i) => (
        <circle key={i} cx={p.x} cy={toY(p.y)} r={i === valid.length - 1 ? 2 : 1} fill={strokeColor} opacity={i === valid.length - 1 ? 1 : 0.4} />
      ))}
    </svg>
  );
}

function TrendArrow({ trend }: { trend: WebhookLogDayBucket[] }) {
  const dir = getTrendDirection(trend);
  if (dir === "declining") return <TrendingDown className="w-3 h-3 text-rose-400 shrink-0" />;
  if (dir === "improving") return <TrendingUp className="w-3 h-3 text-emerald-400 shrink-0" />;
  if (dir === "stable") return <Minus className="w-3 h-3 text-muted-foreground/50 shrink-0" />;
  return null;
}

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
  signatureHeader?: string;
  requestBody?: string;
};

const NODE_SNIPPET = `const crypto = require('crypto');

// rawBody must be the raw request body as a string (before JSON.parse)
function verifySignature(rawBody, signature) {
  const expected = crypto
    .createHmac('sha256', 'YOUR_CALLBACK_SECRET')
    .update(rawBody)
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expected, 'hex')
  );
}

// Express example
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['x-signature'];
  if (!verifySignature(req.body.toString(), sig)) {
    return res.status(401).send('Invalid signature');
  }
  const payload = JSON.parse(req.body);
  // handle payload.event …
  res.sendStatus(200);
});`;

const PYTHON_SNIPPET = `import hmac
import hashlib

# raw_body must be the raw request body as bytes (before json.loads)
def verify_signature(raw_body: bytes, signature: str, secret: str) -> bool:
    expected = hmac.new(
        secret.encode(),
        msg=raw_body,
        digestmod=hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature)

# Flask example
@app.route('/webhook', methods=['POST'])
def webhook():
    raw_body = request.get_data()
    sig = request.headers.get('X-Signature', '')
    if not verify_signature(raw_body, sig, 'YOUR_CALLBACK_SECRET'):
        return 'Invalid signature', 401
    payload = request.get_json(force=True)
    # handle payload['event'] …
    return '', 200`;

const PHP_SNIPPET = `<?php
// $rawBody must be the raw request body string (before json_decode)
function verifySignature(string $rawBody, string $signature): bool {
    $expected = hash_hmac('sha256', $rawBody, 'YOUR_CALLBACK_SECRET');
    return hash_equals($expected, $signature);
}

// Slim / plain PHP example
$rawBody = file_get_contents('php://input');
$sig = $_SERVER['HTTP_X_SIGNATURE'] ?? '';

if (!verifySignature($rawBody, $sig)) {
    http_response_code(401);
    echo 'Invalid signature';
    exit;
}

$payload = json_decode($rawBody, true);
// handle $payload['event'] …
http_response_code(200);`;

const RUBY_SNIPPET = `require 'openssl'

# raw_body must be the raw request body string (before JSON.parse)
def verify_signature(raw_body, signature)
  expected = OpenSSL::HMAC.hexdigest('SHA256', 'YOUR_CALLBACK_SECRET', raw_body)
  ActiveSupport::SecurityUtils.secure_compare(expected, signature)
end

# Rails example
class WebhooksController < ApplicationController
  skip_before_action :verify_authenticity_token

  def receive
    raw_body = request.raw_post
    sig = request.headers['X-Signature'].to_s
    unless verify_signature(raw_body, sig)
      return render plain: 'Invalid signature', status: :unauthorized
    end
    payload = JSON.parse(raw_body)
    # handle payload['event'] …
    head :ok
  end
end`;

const GO_SNIPPET = `package main

import (
        "crypto/hmac"
        "crypto/sha256"
        "encoding/hex"
        "encoding/json"
        "io"
        "net/http"
)

// verifySignature checks the HMAC-SHA256 signature of rawBody.
func verifySignature(rawBody []byte, signature string) bool {
        mac := hmac.New(sha256.New, []byte("YOUR_CALLBACK_SECRET"))
        mac.Write(rawBody)
        expected := hex.EncodeToString(mac.Sum(nil))
        // hmac.Equal uses constant-time comparison
        sig, err := hex.DecodeString(signature)
        if err != nil {
                return false
        }
        exp, _ := hex.DecodeString(expected)
        return hmac.Equal(sig, exp)
}

// net/http example
func webhookHandler(w http.ResponseWriter, r *http.Request) {
        rawBody, err := io.ReadAll(r.Body)
        if err != nil || !verifySignature(rawBody, r.Header.Get("X-Signature")) {
                http.Error(w, "Invalid signature", http.StatusUnauthorized)
                return
        }
        var payload map[string]any
        json.Unmarshal(rawBody, &payload)
        // handle payload["event"] …
        w.WriteHeader(http.StatusOK)
}`;

function WebhookTestPanel({ result, onDismiss, onRetry, isRetrying }: { result: TestResult; onDismiss: () => void; onRetry?: () => void; isRetrying?: boolean }) {
  const [showVerifyGuide, setShowVerifyGuide] = useState(false);
  const [activeTab, setActiveTab] = useState<"node" | "python" | "php" | "ruby" | "go">(() => {
    const stored = localStorage.getItem("rasokart_webhook_snippet_lang");
    if (stored === "python" || stored === "php" || stored === "ruby" || stored === "go") return stored;
    return "node";
  });

  const handleTabChange = (tab: "node" | "python" | "php" | "ruby" | "go") => {
    setActiveTab(tab);
    localStorage.setItem("rasokart_webhook_snippet_lang", tab);
  };

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

      {result.signed && result.signatureHeader && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs text-muted-foreground/60">X-Signature <span className="text-muted-foreground/40 font-normal">(sent with request)</span></p>
            <button
              onClick={() => copy(result.signatureHeader!)}
              className="text-muted-foreground/50 hover:text-muted-foreground transition-colors"
              title="Copy full X-Signature value"
            >
              <Copy className="w-3 h-3" />
            </button>
          </div>
          <div className="flex items-center gap-2 rounded bg-black/40 border border-emerald-500/20 px-2.5 py-1.5">
            <code className="flex-1 text-xs font-mono text-emerald-300/80 truncate" title={result.signatureHeader}>
              {result.signatureHeader.length > 48
                ? result.signatureHeader.slice(0, 48) + "…"
                : result.signatureHeader}
            </code>
            <button
              onClick={() => copy(result.signatureHeader!)}
              className="shrink-0 text-muted-foreground/50 hover:text-emerald-400 transition-colors"
              title="Copy full X-Signature value"
            >
              <Copy className="w-3 h-3" />
            </button>
          </div>
          <p className="text-xs text-muted-foreground/50 mt-1">Paste this into your HMAC verification code to confirm your algorithm produces the same output.</p>
        </div>
      )}

      {result.requestBody && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs text-muted-foreground/60">Request Body <span className="text-muted-foreground/40 font-normal">(exact JSON sent)</span></p>
            <button
              onClick={() => copy(result.requestBody!)}
              className="text-muted-foreground/50 hover:text-muted-foreground transition-colors"
              title="Copy request body"
            >
              <Copy className="w-3 h-3" />
            </button>
          </div>
          <div className="relative group">
            <pre className="text-xs font-mono bg-black/40 border border-border/30 rounded p-2.5 overflow-x-auto whitespace-pre-wrap break-all text-green-300/80 max-h-48 overflow-y-auto leading-relaxed">
              {(() => { try { return JSON.stringify(JSON.parse(result.requestBody), null, 2); } catch { return result.requestBody; } })()}
            </pre>
            <button
              onClick={() => copy(result.requestBody!)}
              className="absolute top-2 right-2 text-muted-foreground/40 hover:text-muted-foreground/80 transition-colors bg-black/60 rounded p-1 opacity-0 group-hover:opacity-100"
              title="Copy request body"
            >
              <Copy className="w-3 h-3" />
            </button>
          </div>
          <p className="text-xs text-muted-foreground/50 mt-1">This is the exact body that was signed — use it with your callback secret to reproduce the HMAC hash.</p>
        </div>
      )}

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

      {result.signed && (
        <div className="border border-emerald-500/20 rounded-lg overflow-hidden">
          <button
            onClick={() => setShowVerifyGuide(v => !v)}
            className="w-full flex items-center justify-between px-3 py-2 bg-emerald-500/10 hover:bg-emerald-500/15 transition-colors text-left"
          >
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span className="text-xs font-medium text-emerald-300">Verify on your server</span>
            </div>
            {showVerifyGuide
              ? <ChevronDown className="w-3.5 h-3.5 text-emerald-400/70 shrink-0" />
              : <ChevronRight className="w-3.5 h-3.5 text-emerald-400/70 shrink-0" />
            }
          </button>

          {showVerifyGuide && (
            <div className="p-3 space-y-3 bg-black/20">
              <p className="text-xs text-muted-foreground/70 leading-relaxed">
                Your server receives an <code className="font-mono text-emerald-300/80 bg-black/30 px-1 rounded">X-Signature</code> header with each signed webhook.
                Use HMAC-SHA256 with your callback secret to verify it before trusting the payload.
              </p>

              <div className="space-y-1.5">
                <ol className="text-xs text-muted-foreground/60 space-y-1 list-decimal list-inside">
                  <li>Read the <strong className="text-muted-foreground/80">raw request body</strong> as a string (do not parse JSON first).</li>
                  <li>Compute <code className="font-mono text-emerald-300/80 bg-black/30 px-1 rounded">HMAC-SHA256(rawBody, YOUR_CALLBACK_SECRET)</code> → hex digest.</li>
                  <li>Compare with the incoming <code className="font-mono text-emerald-300/80 bg-black/30 px-1 rounded">X-Signature</code> header using a timing-safe comparison.</li>
                  <li>Reject the request if the signatures do not match.</li>
                </ol>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-1 border-b border-border/20 pb-1 flex-wrap">
                  {(["node", "python", "php", "ruby", "go"] as const).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => handleTabChange(tab)}
                      className={`text-xs px-2 py-0.5 rounded transition-colors ${activeTab === tab ? "bg-emerald-500/20 text-emerald-300" : "text-muted-foreground/50 hover:text-muted-foreground/80"}`}
                    >
                      {tab === "node" ? "Node.js" : tab === "python" ? "Python" : tab === "php" ? "PHP" : tab === "ruby" ? "Ruby" : "Go"}
                    </button>
                  ))}
                </div>

                <div className="relative group">
                  <pre className="text-xs font-mono bg-black/40 border border-border/30 rounded p-2.5 overflow-x-auto whitespace-pre text-muted-foreground/80 max-h-52 overflow-y-auto leading-relaxed">
                    {activeTab === "node" ? NODE_SNIPPET : activeTab === "python" ? PYTHON_SNIPPET : activeTab === "php" ? PHP_SNIPPET : activeTab === "ruby" ? RUBY_SNIPPET : GO_SNIPPET}
                  </pre>
                  <button
                    onClick={() => copy(activeTab === "node" ? NODE_SNIPPET : activeTab === "python" ? PYTHON_SNIPPET : activeTab === "php" ? PHP_SNIPPET : activeTab === "ruby" ? RUBY_SNIPPET : GO_SNIPPET)}
                    className="absolute top-2 right-2 text-muted-foreground/40 hover:text-muted-foreground/80 transition-colors bg-black/60 rounded p-1"
                    title="Copy snippet"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                </div>

                <p className="text-xs text-muted-foreground/50">
                  Replace <code className="font-mono text-amber-300/70 bg-black/30 px-1 rounded">YOUR_CALLBACK_SECRET</code> with the secret shown in the signing secret section above.
                </p>
              </div>
            </div>
          )}
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


function computeExpectedRetryAt(createdAt: string, attempts: number, effectiveDelays: [number, number, number]): Date {
  let cumulative = 0;
  for (let i = 0; i < attempts; i++) {
    cumulative += i < 2 ? effectiveDelays[i] : effectiveDelays[2];
  }
  return new Date(new Date(createdAt).getTime() + cumulative * 1000);
}

function DeliveryDetailModal({ log, onClose, onRetry, isRetrying, effectiveDelays }: { log: CallbackLog | null; onClose: () => void; onRetry?: (id: number) => void; isRetrying?: boolean; effectiveDelays?: [number, number, number] }) {
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
          {log.status === "pending_retry" && (() => {
            const retryDate = log.nextRetryAt != null
              ? new Date(log.nextRetryAt)
              : effectiveDelays != null
                ? computeExpectedRetryAt(log.createdAt, log.attempts ?? 1, effectiveDelays)
                : null;
            const isEstimated = log.nextRetryAt == null && retryDate != null;
            if (!retryDate) return null;
            return (
              <div className="flex items-center gap-2 p-3 rounded-lg border border-amber-500/20 bg-amber-500/5 text-amber-400">
                <Clock className="w-4 h-4 shrink-0" />
                <div>
                  <p className="text-xs font-medium">
                    {isEstimated ? "Expected next retry" : "Next retry scheduled"}
                  </p>
                  <p className="text-xs text-amber-400/70 font-mono">
                    {formatDistanceToNow(retryDate, { addSuffix: true })}
                    {" "}— {retryDate.toLocaleString()}
                  </p>
                  {isEstimated && (
                    <p className="text-[10px] text-amber-400/50 mt-0.5">Estimated from retry delay schedule · actual time may vary</p>
                  )}
                </div>
              </div>
            );
          })()}

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

function formatDelaySeconds(secs: number): string {
  if (secs === 0) return "immediately";
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  const h = Math.floor(secs / 3600);
  const rem = secs % 3600;
  const m = Math.floor(rem / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export default function MerchantWebhook() {
  const qc = useQueryClient();
  const { data: config, isLoading } = useGetWebhookConfig();
  const { data: platformDefaults } = useGetWebhookPlatformDefaults();
  const { data: secretStatus, isLoading: secretLoading } = useGetCallbackSecret();
  const WEBHOOK_DATE_RANGE_KEY = "rasokart_webhook_date_range";
  const WEBHOOK_EVENT_FILTER_KEY = "rasokart_webhook_event_filter";
  const WEBHOOK_STATUS_FILTER_KEY = "rasokart_webhook_status_filter";
  const [eventTypeFilter, setEventTypeFilterRaw] = useState<string | null>(() => {
    try { return localStorage.getItem(WEBHOOK_EVENT_FILTER_KEY) ?? null; } catch { return null; }
  });
  const setEventTypeFilter = (value: string | null) => {
    setEventTypeFilterRaw(value);
    try {
      if (value == null) {
        localStorage.removeItem(WEBHOOK_EVENT_FILTER_KEY);
      } else {
        localStorage.setItem(WEBHOOK_EVENT_FILTER_KEY, value);
      }
    } catch { /* ignore */ }
  };
  const [statusFilter, setStatusFilterRaw] = useState<"all" | "success" | "failed" | "pending_retry">(() => {
    try {
      const stored = localStorage.getItem(WEBHOOK_STATUS_FILTER_KEY);
      if (stored === "success" || stored === "failed" || stored === "pending_retry") return stored;
    } catch { /* ignore */ }
    return "all";
  });
  const setStatusFilter = (value: "all" | "success" | "failed" | "pending_retry") => {
    setStatusFilterRaw(value);
    try {
      if (value === "all") {
        localStorage.removeItem(WEBHOOK_STATUS_FILTER_KEY);
      } else {
        localStorage.setItem(WEBHOOK_STATUS_FILTER_KEY, value);
      }
    } catch { /* ignore */ }
  };
  const [fromDate, setFromDate] = useState(() => {
    try { return JSON.parse(localStorage.getItem(WEBHOOK_DATE_RANGE_KEY) ?? "{}").from ?? ""; } catch { return ""; }
  });
  const [toDate, setToDate] = useState(() => {
    try { return JSON.parse(localStorage.getItem(WEBHOOK_DATE_RANGE_KEY) ?? "{}").to ?? ""; } catch { return ""; }
  });
  const hasDateFilter = fromDate !== "" || toDate !== "";
  const saveWebhookDateRange = (from: string, to: string) => {
    try { localStorage.setItem(WEBHOOK_DATE_RANGE_KEY, JSON.stringify({ from, to })); } catch { /* ignore */ }
  };
  const logsParams = {
    limit: 50,
    ...(eventTypeFilter != null ? { eventType: eventTypeFilter } : {}),
    ...(fromDate ? { from: new Date(fromDate).toISOString() } : {}),
    ...(toDate ? { to: new Date(toDate).toISOString() } : {}),
    ...(statusFilter !== "all" ? { status: statusFilter as GetWebhookLogsStatus } : {}),
  };
  const { data: logsData, isLoading: logsLoading } = useGetWebhookLogs(logsParams, {
    query: { queryKey: getGetWebhookLogsQueryKey(logsParams) },
  });
  const { data: logStatsData } = useGetWebhookLogStats({
    query: { refetchInterval: 60_000, queryKey: getGetWebhookLogStatsQueryKey() },
  });
  const logStatsByEventType = Object.fromEntries(
    (logStatsData?.data ?? []).map(s => [s.eventType, s])
  );
  const { data: retryDefaults } = useGetWebhookRetryDefaults();
  const updateMutation = useUpdateWebhookConfig();
  const rotateMutation = useRotateCallbackSecret();
  const testMutation = useSendWebhookTest();
  const retryMutation = useRetryWebhookLog();

  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [events, setEvents] = useState<string[]>([]);
  const [maxRetries, setMaxRetries] = useState(3);
  const [globalMaxRetries, setGlobalMaxRetries] = useState<number>(10);
  const [retryDelay1, setRetryDelay1] = useState<number | null>(null);
  const [retryDelay2, setRetryDelay2] = useState<number | null>(null);
  const [retryDelay3, setRetryDelay3] = useState<number | null>(null);
  const [failureAlertEnabled, setFailureAlertEnabled] = useState(true);
  const [failureAlertThreshold, setFailureAlertThreshold] = useState(3);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [selectedLog, setSelectedLog] = useState<CallbackLog | null>(null);
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const [testEventType, setTestEventType] = useState<WebhookTestRequestEventType>(WebhookTestRequestEventType.paymentsuccess);
  const [secretSavedAt, setSecretSavedAt] = useState<number | null>(null);
  const [secretVerifiedDismissed, setSecretVerifiedDismissed] = useState(() => {
    const d = readSigVerifiedDismissal();
    return d != null && isSigVerifiedStillDismissed(d);
  });
  const [sigVerifiedFromCallbacks, setSigVerifiedFromCallbacks] = useState<boolean>(() => {
    try { return !!localStorage.getItem(SIG_VERIFIED_KEY); } catch { return false; }
  });
  const [breakdownOpen, setBreakdownOpen] = useState(() => {
    try { return localStorage.getItem("rasokart_breakdown_open") === "true"; } catch { return false; }
  });

  useEffect(() => {
    if (config) {
      setUrl(config.url || "");
      setSecret(config.secret || "");
      setIsActive(config.isActive);
      setEvents(config.events || []);
      const cap = config.globalMaxRetries ?? 10;
      setGlobalMaxRetries(cap);
      setMaxRetries(Math.min(config.maxRetries ?? 3, cap));
      setRetryDelay1(config.retryDelay1 ?? null);
      setRetryDelay2(config.retryDelay2 ?? null);
      setRetryDelay3(config.retryDelay3 ?? null);
      setFailureAlertEnabled(config.failureAlertEnabled ?? true);
      setFailureAlertThreshold(config.failureAlertThreshold ?? 3);
    }
  }, [config]);

  const toggleEvent = (eventId: string) => {
    setEvents(prev => prev.includes(eventId) ? prev.filter(e => e !== eventId) : [...prev, eventId]);
  };

  const handleSave = () => {
    if (!url.trim()) { toast.error("Webhook URL is required"); return; }
    const hasSecret = !!secret.trim();
    updateMutation.mutate({ data: { url: url.trim(), isActive, events, secret: secret || null, maxRetries, retryDelay1, retryDelay2, retryDelay3, failureAlertEnabled, failureAlertThreshold } }, {
      onSuccess: () => {
        toast.success("Webhook configuration saved");
        qc.invalidateQueries({ queryKey: getGetWebhookConfigQueryKey() });
        if (hasSecret) {
          setSecretSavedAt(Date.now());
          clearSigVerifiedDismissal();
          setSecretVerifiedDismissed(false);
        }
      },
      onError: (err: unknown) => toast.error(getApiErrorMessage(err, "Failed to save configuration")),
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
      onSettled: () => {
        qc.invalidateQueries({ queryKey: getGetWebhookLogsQueryKey() });
        qc.invalidateQueries({ queryKey: getGetWebhookLogStatsQueryKey() });
      },
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
      onSettled: () => {
        qc.invalidateQueries({ queryKey: getGetWebhookLogsQueryKey() });
        qc.invalidateQueries({ queryKey: getGetWebhookLogStatsQueryKey() });
      },
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
        qc.invalidateQueries({ queryKey: getGetWebhookLogStatsQueryKey() });
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
          <div>
            <Label>Max retries</Label>
            <p className="text-xs text-muted-foreground mt-0.5 mb-1">
              Number of automatic retry attempts when delivery fails (0 = no retries).
              When set, this overrides the platform-wide default.
              {platformDefaults != null && (
                <span className="ml-1 text-muted-foreground/70">
                  Platform default: <span className="font-medium text-muted-foreground">{platformDefaults.platformDefaultRetries} {platformDefaults.platformDefaultRetries === 1 ? "retry" : "retries"}</span>.
                </span>
              )}
            </p>
            <p className="text-xs text-amber-400/80 mb-2">
              Global cap: <span className="font-semibold">{globalMaxRetries}</span> {globalMaxRetries === 1 ? "retry" : "retries"} (admin-configured maximum)
            </p>
            <Select
              value={String(Math.min(maxRetries, globalMaxRetries))}
              onValueChange={v => setMaxRetries(Math.min(parseInt(v, 10), globalMaxRetries))}
            >
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: globalMaxRetries + 1 }, (_, n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n === 0 ? "0 — no retries" : n === 1 ? "1 retry" : `${n} retries${n === 3 ? " (default)" : ""}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {maxRetries === 0 && (
            <p className="text-xs text-muted-foreground/60 flex items-center gap-1.5 pl-0.5">
              <span className="inline-block w-1 h-1 rounded-full bg-muted-foreground/40 shrink-0" />
              No automatic retries are configured. Failed deliveries will not be reattempted.
            </p>
          )}
          {maxRetries > 0 && (
            <div className="space-y-3 pl-1">
              <div>
                <Label className="text-xs">Retry delay schedule</Label>
                <p className="text-xs text-muted-foreground mt-0.5 mb-3">How long to wait before each retry attempt. Applies to both webhook and QR code callback retries. Leave as "System default" to use the platform-wide setting.</p>
                {(() => {
                  const ignoredSlots = [
                    retryDelay1 != null && maxRetries < 1,
                    retryDelay2 != null && maxRetries < 2,
                    retryDelay3 != null && maxRetries < 3,
                  ].filter(Boolean).length;
                  return ignoredSlots > 0 ? (
                    <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 mb-3">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                      <p className="text-xs text-amber-400/90 leading-relaxed">
                        {ignoredSlots === 1 ? "1 custom delay is" : `${ignoredSlots} custom delays are`} set on a slot that won't fire with the current max-retries value. {ignoredSlots === 1 ? "It" : "They"} will be cleared when you save.
                      </p>
                    </div>
                  ) : null;
                })()}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {([
                    { label: "After 1st failure", value: retryDelay1, setValue: setRetryDelay1, minRetries: 1 },
                    { label: "After 2nd failure", value: retryDelay2, setValue: setRetryDelay2, minRetries: 2 },
                    { label: "After 3rd+ failure", value: retryDelay3, setValue: setRetryDelay3, minRetries: 3 },
                  ] as const).map(({ label, value, setValue, minRetries }) => {
                    const active = maxRetries >= minRetries;
                    return (
                      <div key={label} className={active ? undefined : "opacity-40 pointer-events-none"}>
                        <div className="flex items-center gap-1.5 mb-1">
                          <p className="text-xs text-muted-foreground">{label}</p>
                          {!active && (
                            <span className="text-[10px] font-medium text-muted-foreground/50 bg-muted/30 border border-border/40 rounded px-1 py-px leading-none">
                              ignored
                            </span>
                          )}
                        </div>
                        <Select
                          value={value == null ? "default" : String(value)}
                          onValueChange={v => setValue(v === "default" ? null : parseInt(v, 10))}
                          disabled={!active}
                        >
                          <SelectTrigger className="w-full text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="default" className="text-xs text-muted-foreground">System default</SelectItem>
                            <SelectItem value="30" className="text-xs">30 seconds</SelectItem>
                            <SelectItem value="60" className="text-xs">1 minute</SelectItem>
                            <SelectItem value="300" className="text-xs">5 minutes</SelectItem>
                            <SelectItem value="900" className="text-xs">15 minutes</SelectItem>
                            <SelectItem value="1800" className="text-xs">30 minutes</SelectItem>
                            <SelectItem value="3600" className="text-xs">1 hour</SelectItem>
                            <SelectItem value="7200" className="text-xs">2 hours</SelectItem>
                            <SelectItem value="14400" className="text-xs">4 hours</SelectItem>
                            <SelectItem value="21600" className="text-xs">6 hours</SelectItem>
                            <SelectItem value="43200" className="text-xs">12 hours</SelectItem>
                            <SelectItem value="86400" className="text-xs">24 hours</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Retry schedule preview */}
              {(() => {
                const sysDelay1 = retryDefaults?.delay1 ?? 300;
                const sysDelay2 = retryDefaults?.delay2 ?? 900;
                const sysDelay3 = retryDefaults?.delay3 ?? 3600;
                const effectiveDelays = [
                  retryDelay1 ?? sysDelay1,
                  retryDelay2 ?? sysDelay2,
                  retryDelay3 ?? sysDelay3,
                ];
                const rows: { attempt: number; waitSecs: number; cumulativeSecs: number; isDefault: boolean }[] = [];
                let cumulative = 0;
                for (let i = 0; i < maxRetries; i++) {
                  const delaySec = i < 2 ? effectiveDelays[i] : effectiveDelays[2];
                  const isDefault = i === 0 ? retryDelay1 == null : i === 1 ? retryDelay2 == null : retryDelay3 == null;
                  cumulative += delaySec;
                  rows.push({ attempt: i + 1, waitSecs: delaySec, cumulativeSecs: cumulative, isDefault });
                }
                return (
                  <div className="rounded-lg border border-border/50 bg-muted/10 overflow-hidden">
                    <div className="flex items-center gap-2 px-3 py-2 border-b border-border/40 bg-muted/20">
                      <Clock className="w-3.5 h-3.5 text-muted-foreground/70 shrink-0" />
                      <span className="text-xs font-medium text-muted-foreground">Retry schedule preview</span>
                      <span className="text-[10px] text-muted-foreground/50 ml-auto">read-only · updates live</span>
                    </div>
                    <div className="divide-y divide-border/30">
                      <div className="flex items-center gap-3 px-3 py-2">
                        <div className="w-5 h-5 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center shrink-0">
                          <span className="text-[9px] font-bold text-primary">1</span>
                        </div>
                        <span className="text-xs text-foreground flex-1">Initial attempt</span>
                        <span className="text-xs text-muted-foreground/60 font-mono">t = 0</span>
                      </div>
                      {rows.map((row) => (
                        <div key={row.attempt} className="flex items-center gap-3 px-3 py-2">
                          <div className="w-5 h-5 rounded-full bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0">
                            <span className="text-[9px] font-bold text-amber-400">{row.attempt + 1}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className="text-xs text-foreground">Retry #{row.attempt}</span>
                            <span className="text-xs text-muted-foreground/60 ml-2">
                              wait <span className="font-mono text-amber-400/80">{formatDelaySeconds(row.waitSecs)}</span>
                              {row.isDefault && <span className="ml-1 text-muted-foreground/40">(system default)</span>}
                            </span>
                          </div>
                          <span className="text-xs text-muted-foreground/60 font-mono shrink-0">
                            t + {formatDelaySeconds(row.cumulativeSecs)}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="px-3 py-1.5 bg-muted/10 border-t border-border/30">
                      <p className="text-[10px] text-muted-foreground/50">
                        If all {maxRetries} {maxRetries === 1 ? "retry" : "retries"} fail, the delivery is marked as permanently failed after <span className="font-mono text-muted-foreground/70">{formatDelaySeconds(rows[rows.length - 1]?.cumulativeSecs ?? 0)}</span> total.
                      </p>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
          <div className="border-t border-border/50 pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {failureAlertEnabled ? <Bell className="w-4 h-4 text-amber-400" /> : <BellOff className="w-4 h-4 text-muted-foreground/50" />}
                <div>
                  <p className="font-medium text-sm">Failure alert emails</p>
                  <p className="text-xs text-muted-foreground">Get emailed when consecutive deliveries fail</p>
                </div>
              </div>
              <Switch checked={failureAlertEnabled} onCheckedChange={setFailureAlertEnabled} />
            </div>
            {failureAlertEnabled && (
              <div className="pl-6">
                <Label className="text-xs">Alert threshold</Label>
                <p className="text-xs text-muted-foreground mt-0.5 mb-2">Send an alert after this many consecutive failures</p>
                <Select value={String(failureAlertThreshold)} onValueChange={v => setFailureAlertThreshold(parseInt(v, 10))}>
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5, 7, 10].map(n => (
                      <SelectItem key={n} value={String(n)}>{n} {n === 1 ? "failure" : "failures"}{n === 3 ? " (default)" : ""}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
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
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-primary" />
              <CardTitle>Recent Deliveries</CardTitle>
            </div>
          </div>
          <CardDescription>
            {hasDateFilter
              ? "Showing deliveries in the selected window"
              : "Last 50 webhook delivery attempts to your endpoint"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Date range filter */}
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <Calendar className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-muted-foreground shrink-0">From</label>
              <input
                type="datetime-local"
                value={fromDate}
                onChange={e => { setFromDate(e.target.value); saveWebhookDateRange(e.target.value, toDate); }}
                className="h-7 rounded border border-border/50 bg-muted/30 px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary/50 [color-scheme:dark]"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-muted-foreground shrink-0">To</label>
              <input
                type="datetime-local"
                value={toDate}
                onChange={e => { setToDate(e.target.value); saveWebhookDateRange(fromDate, e.target.value); }}
                className="h-7 rounded border border-border/50 bg-muted/30 px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary/50 [color-scheme:dark]"
              />
            </div>
            {hasDateFilter && (
              <button
                onClick={() => { setFromDate(""); setToDate(""); try { localStorage.removeItem(WEBHOOK_DATE_RANGE_KEY); } catch { /* ignore */ } }}
                className="inline-flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[11px] font-medium text-rose-400 hover:bg-rose-500/20 hover:border-rose-500/50 transition-colors"
              >
                <X className="w-3 h-3" />
                Clear
              </button>
            )}
          </div>
          {/* Status filter pills */}
          <div className="flex items-center gap-1.5 flex-wrap mb-3">
            <span className="text-[11px] text-muted-foreground/60 font-medium uppercase tracking-wider shrink-0">Status</span>
            {(
              [
                { value: "all", label: "All" },
                { value: "success", label: "Success", activeClass: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40" },
                { value: "failed", label: "Failed", activeClass: "bg-rose-500/20 text-rose-300 border-rose-500/40" },
                { value: "pending_retry", label: "Pending retry", activeClass: "bg-amber-500/20 text-amber-300 border-amber-500/40" },
              ] as const
            ).map(opt => (
              <button
                key={opt.value}
                onClick={() => setStatusFilter(opt.value)}
                className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium transition-colors border ${
                  statusFilter === opt.value
                    ? opt.value === "all"
                      ? "bg-primary text-primary-foreground border-transparent"
                      : opt.activeClass
                    : "bg-muted/20 text-muted-foreground border-border/40 hover:bg-muted/40 hover:text-foreground"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {/* Event type filter pills */}
          <div className="flex items-center gap-1.5 flex-wrap mb-4 pb-3 border-b border-border/40">
            <span className="text-[11px] text-muted-foreground/60 font-medium uppercase tracking-wider shrink-0">Event</span>
            <button
              onClick={() => setEventTypeFilter(null)}
              className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                eventTypeFilter === null
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/40 text-muted-foreground hover:bg-muted/60 hover:text-foreground border border-border/50"
              }`}
            >
              All
            </button>
            {EVENTS.map(event => {
              const colors = EVENT_TYPE_COLORS[event.id] ?? { bg: "bg-muted/40", text: "text-muted-foreground", border: "border-border/50" };
              const isActive = eventTypeFilter === event.id;
              const stats = logStatsByEventType[event.id];
              const failureCount = stats ? stats.failed : 0;
              const hasFailures = failureCount > 0;
              return (
                <button
                  key={event.id}
                  onClick={() => setEventTypeFilter(isActive ? null : event.id)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-mono font-medium transition-colors ${
                    isActive
                      ? `${colors.bg} ${colors.text} ${colors.border} ring-1 ring-inset ring-current/30`
                      : "bg-muted/20 text-muted-foreground border-border/40 hover:bg-muted/40 hover:text-foreground"
                  }`}
                  title={stats ? `${stats.total} total · ${stats.success} success · ${failureCount} failed` : undefined}
                >
                  {event.id}
                  {hasFailures && (
                    <span className={`inline-flex items-center justify-center min-w-[16px] h-4 rounded-full px-1 text-[10px] font-semibold leading-none ${
                      isActive
                        ? "bg-rose-500/30 text-rose-300 border border-rose-500/40"
                        : "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                    }`}>
                      {failureCount > 99 ? "99+" : failureCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>


          {/* Event Breakdown */}
          {logStatsData && logStatsData.data.length > 0 && (
            <div className="mb-4">
              <button
                onClick={() => setBreakdownOpen(o => {
                  const next = !o;
                  try { localStorage.setItem("rasokart_breakdown_open", String(next)); } catch {}
                  return next;
                })}
                className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors mb-2 group"
              >
                <BarChart2 className="w-3.5 h-3.5" />
                Event Breakdown
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${breakdownOpen ? "rotate-180" : ""}`} />
              </button>
              {breakdownOpen && (
                <div className="rounded-lg border border-border/50 overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border/50 bg-muted/30">
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Event type</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">Total</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">Success</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">Failed</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">Rate</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">7d trend</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {logStatsData.data.map(stat => {
                        const rate = stat.total > 0 ? Math.round((stat.success / stat.total) * 100) : 0;
                        const isHighFailure = stat.total > 0 && stat.failed > 0 && rate < 80;
                        return (
                          <tr
                            key={stat.eventType}
                            onClick={() => setEventTypeFilter(eventTypeFilter === stat.eventType ? null : stat.eventType)}
                            className={`cursor-pointer transition-colors ${
                              isHighFailure
                                ? "bg-rose-500/5 hover:bg-rose-500/10"
                                : "hover:bg-muted/30"
                            } ${eventTypeFilter === stat.eventType ? "ring-1 ring-inset ring-primary/30" : ""}`}
                          >
                            <td className="px-3 py-2">
                              <EventTypeBadge eventType={stat.eventType} />
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-muted-foreground">{stat.total}</td>
                            <td className="px-3 py-2 text-right font-mono text-emerald-400">{stat.success}</td>
                            <td className={`px-3 py-2 text-right font-mono ${stat.failed > 0 ? "text-rose-400" : "text-muted-foreground/50"}`}>
                              {stat.failed}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <span className={`inline-block font-semibold tabular-nums ${
                                rate >= 95 ? "text-emerald-400" : rate >= 80 ? "text-amber-400" : "text-rose-400"
                              }`}>
                                {rate}%
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex items-center justify-end gap-1.5">
                                <FailureRateSparkline trend={stat.trend} />
                                <TrendArrow trend={stat.trend} />
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

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
                    {(log.status === "failed" || log.status === "pending_retry") && (
                      log.httpStatus != null ? (
                        <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-mono font-semibold bg-rose-500/10 border border-rose-500/25 text-rose-400">
                          {log.httpStatus}
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-mono font-semibold bg-orange-500/10 border border-orange-500/25 text-orange-400">
                          no resp
                        </span>
                      )
                    )}
                    {(log.status === "failed" || log.status === "pending_retry") && (() => {
                      const retriesDone = (log.attempts ?? 1) - 1;
                      const cfgMax = config?.maxRetries ?? 3;
                      const isExhausted = log.status === "failed" && retriesDone >= cfgMax && cfgMax > 0;
                      return (
                        <span
                          className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-amber-500/10 border border-amber-500/25 text-amber-400"
                          title={`${log.attempts ?? 1} delivery ${(log.attempts ?? 1) === 1 ? "attempt" : "attempts"}`}
                        >
                          <RotateCcw className="w-2.5 h-2.5" />
                          {isExhausted ? `${retriesDone}/${cfgMax}×` : `${log.attempts ?? 1}×`}
                        </span>
                      );
                    })()}
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
                      <span className={`text-xs font-semibold tabular-nums ${
                        log.status === "success" && (log.attempts ?? 1) === 1
                          ? "text-emerald-400"
                          : log.status === "success" && (log.attempts ?? 1) > 1
                          ? "text-amber-400"
                          : log.status === "pending_retry"
                          ? "text-amber-400"
                          : log.status === "failed"
                          ? "text-rose-400"
                          : "text-muted-foreground/70"
                      }`}>
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
                      {secretStatus?.isSet && (
                        <p className="text-xs text-muted-foreground/70 mt-0.5">
                          {secretStatus.lastRotatedAt != null ? (
                            <>
                              Last rotated: {format(new Date(secretStatus.lastRotatedAt), "dd MMM yyyy, HH:mm")}
                              {" "}
                              <span className="text-muted-foreground/50">
                                ({formatDistanceToNow(new Date(secretStatus.lastRotatedAt), { addSuffix: true })})
                              </span>
                              {daysLeft != null && !isOverdue && !isWarningSoon && (
                                <span className="ml-2 font-medium text-muted-foreground/60">
                                  · Rotation due in {daysLeft} day{daysLeft !== 1 ? "s" : ""}
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="text-muted-foreground/50">Last rotated: Never</span>
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

          {(secretSavedAt != null || sigVerifiedFromCallbacks) && !secretVerifiedDismissed && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10">
              <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-emerald-300">Secret verified</p>
                <p className="text-xs text-emerald-400/70 mt-0.5">
                  Recent callbacks are passing signature verification — your secret is correctly configured.
                </p>
              </div>
              <button
                type="button"
                aria-label="Dismiss"
                onClick={() => { writeSigVerifiedDismissal(); setSecretVerifiedDismissed(true); setSigVerifiedFromCallbacks(false); }}
                className="shrink-0 text-emerald-400/60 hover:text-emerald-300 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
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

      <DeliveryDetailModal
        log={selectedLog}
        onClose={() => setSelectedLog(null)}
        onRetry={handleRetry}
        isRetrying={retryingId === selectedLog?.id}
        effectiveDelays={[
          retryDelay1 ?? (retryDefaults?.delay1 ?? 300),
          retryDelay2 ?? (retryDefaults?.delay2 ?? 900),
          retryDelay3 ?? (retryDefaults?.delay3 ?? 3600),
        ]}
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
