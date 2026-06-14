import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  ExternalLink,
  ShieldCheck,
  Play,
  Loader2,
  KeyRound,
  Terminal,
} from "lucide-react";
import { toast } from "sonner";

function CodeBlock({ code, language = "bash" }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="relative group">
      <pre
        className={`bg-black/60 border border-border/50 rounded-lg p-4 text-xs font-mono overflow-x-auto text-green-300 whitespace-pre-wrap`}
      >
        {code}
      </pre>
      <Button
        size="icon"
        variant="ghost"
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity h-7 w-7"
        onClick={handleCopy}
      >
        {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
      </Button>
    </div>
  );
}

function Section({
  title,
  badge,
  children,
}: {
  title: string;
  badge?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="overflow-hidden">
      <CardHeader className="cursor-pointer select-none py-4" onClick={() => setOpen((o) => !o)}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {open ? (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            )}
            <CardTitle className="text-base">{title}</CardTitle>
            {badge && (
              <Badge variant="secondary" className="text-[10px]">
                {badge}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      {open && <CardContent className="pt-0 space-y-5 pb-5">{children}</CardContent>}
    </Card>
  );
}

function EndpointRow({
  method,
  path,
  description,
}: {
  method: string;
  path: string;
  description?: string;
}) {
  const colors: Record<string, string> = {
    GET: "bg-blue-500/20 text-blue-400",
    POST: "bg-emerald-500/20 text-emerald-400",
    PUT: "bg-yellow-500/20 text-yellow-400",
    DELETE: "bg-rose-500/20 text-rose-400",
  };
  return (
    <div className="flex items-start gap-3 py-2 border-b border-border/40 last:border-0">
      <Badge className={`text-[10px] font-bold shrink-0 ${colors[method] ?? ""}`}>{method}</Badge>
      <div>
        <code className="text-sm font-mono text-foreground">{path}</code>
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
      </div>
    </div>
  );
}

interface TryItPanelProps {
  method: string;
  path: string;
  token: string;
  defaultBody?: string;
  requiresAuth?: boolean;
}

interface ApiResponse {
  status: number;
  statusText: string;
  body: string;
  durationMs: number;
}

function extractPathParams(path: string): string[] {
  const matches = path.match(/\{(\w+)\}/g);
  return matches ? matches.map((m) => m.slice(1, -1)) : [];
}

function TryItPanel({ method, path, token, defaultBody = "", requiresAuth = true }: TryItPanelProps) {
  const [open, setOpen] = useState(false);
  const [localToken, setLocalToken] = useState(token);
  const [body, setBody] = useState(defaultBody);
  const [pathValues, setPathValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<ApiResponse | null>(null);

  const params = extractPathParams(path);
  const hasBody = method === "POST" || method === "PUT" || method === "PATCH";

  const resolvedPath = path.replace(/\{(\w+)\}/g, (_, key) => pathValues[key] ?? `{${key}}`);
  const baseUrl = window.location.origin;
  const url = `${baseUrl}${resolvedPath}`;

  const fire = useCallback(async () => {
    setLoading(true);
    setResponse(null);
    const t0 = Date.now();
    try {
      const headers: Record<string, string> = {};
      const activeToken = requiresAuth ? (localToken || token) : undefined;
      if (activeToken) headers["Authorization"] = `Bearer ${activeToken}`;
      if (hasBody) headers["Content-Type"] = "application/json";

      const res = await fetch(url, {
        method,
        headers,
        body: hasBody && body.trim() ? body : undefined,
      });

      let text = "";
      try {
        const json = await res.json();
        text = JSON.stringify(json, null, 2);
      } catch {
        text = await res.text();
      }

      setResponse({
        status: res.status,
        statusText: res.statusText,
        body: text,
        durationMs: Date.now() - t0,
      });
    } catch (err: unknown) {
      setResponse({
        status: 0,
        statusText: "Network Error",
        body: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - t0,
      });
    } finally {
      setLoading(false);
    }
  }, [url, method, body, localToken, token, hasBody, requiresAuth]);

  const statusColor =
    response == null
      ? ""
      : response.status >= 200 && response.status < 300
      ? "text-emerald-400"
      : response.status >= 400
      ? "text-rose-400"
      : "text-yellow-400";

  const methodColors: Record<string, string> = {
    GET: "border-blue-500/40 bg-blue-500/5",
    POST: "border-emerald-500/40 bg-emerald-500/5",
    PUT: "border-yellow-500/40 bg-yellow-500/5",
    DELETE: "border-rose-500/40 bg-rose-500/5",
  };

  return (
    <div className={`rounded-lg border ${methodColors[method] ?? "border-border/50"} overflow-hidden`}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/5 transition-colors"
      >
        <Terminal className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs font-medium text-muted-foreground">Try it</span>
        <span className="text-xs font-mono text-foreground/70 truncate flex-1">
          {method} {path}
        </span>
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        )}
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-3 border-t border-border/30 pt-3">
          {requiresAuth && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Bearer Token</Label>
              <Input
                value={localToken}
                onChange={(e) => setLocalToken(e.target.value)}
                placeholder="Paste your JWT token here"
                className="h-7 text-xs font-mono bg-black/40"
              />
            </div>
          )}

          {params.length > 0 && (
            <div className="space-y-2">
              {params.map((param) => (
                <div key={param} className="space-y-1">
                  <Label className="text-xs text-muted-foreground">
                    Path param: <code className="font-mono">{`{${param}}`}</code>
                  </Label>
                  <Input
                    value={pathValues[param] ?? ""}
                    onChange={(e) =>
                      setPathValues((prev) => ({ ...prev, [param]: e.target.value }))
                    }
                    placeholder={`Enter ${param}`}
                    className="h-7 text-xs font-mono bg-black/40"
                  />
                </div>
              ))}
            </div>
          )}

          {hasBody && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Request Body (JSON)</Label>
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={6}
                className="text-xs font-mono bg-black/40 resize-y"
                spellCheck={false}
              />
            </div>
          )}

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={fire}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Play className="w-3 h-3 fill-current" />
              )}
              {loading ? "Sending…" : "Send Request"}
            </Button>
            <span className="text-xs text-muted-foreground font-mono truncate">{url}</span>
          </div>

          {response && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs">
                <span className={`font-bold font-mono ${statusColor}`}>
                  {response.status} {response.statusText}
                </span>
                <span className="text-muted-foreground">{response.durationMs}ms</span>
              </div>
              <pre className="bg-black/60 border border-border/50 rounded-lg p-3 text-xs font-mono overflow-x-auto text-green-300 whitespace-pre-wrap max-h-72">
                {response.body}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ApiDocs() {
  const [globalToken, setGlobalToken] = useState<string>(() => {
    try {
      return localStorage.getItem("rasokart_tryit_token") ?? localStorage.getItem("rasokart_token") ?? "";
    } catch {
      return "";
    }
  });

  const handleTokenChange = (val: string) => {
    setGlobalToken(val);
    try {
      localStorage.setItem("rasokart_tryit_token", val);
    } catch {
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">API Documentation</h1>
        <p className="text-muted-foreground mt-1">
          Reference for integrating RasoKart payment APIs into your application.
        </p>
      </div>

      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="pt-4 pb-4 space-y-3">
          <p className="text-sm font-medium mb-2">Base URL</p>
          <CodeBlock code="https://your-domain.com/api" />
          <p className="text-xs text-muted-foreground">
            All requests must include an{" "}
            <code className="font-mono bg-muted px-1 rounded">
              Authorization: Bearer &lt;token&gt;
            </code>{" "}
            header unless noted otherwise.
          </p>

          <div className="pt-1 space-y-1.5">
            <div className="flex items-center gap-2">
              <KeyRound className="w-3.5 h-3.5 text-primary shrink-0" />
              <Label className="text-xs font-medium">
                Shared Bearer Token{" "}
                <span className="text-muted-foreground font-normal">
                  — pre-fills all "Try it" panels on this page
                </span>
              </Label>
            </div>
            <Input
              value={globalToken}
              onChange={(e) => handleTokenChange(e.target.value)}
              placeholder="Paste your JWT token once — it auto-fills every panel"
              className="h-8 text-xs font-mono bg-black/40 border-primary/30"
            />
            {!globalToken && (
              <p className="text-[11px] text-muted-foreground">
                No token set. Log in via the Authentication section below to get one, or paste it
                here directly.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <Section title="Dynamic QR API" badge="4 endpoints">
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">Endpoints</p>
            <EndpointRow
              method="GET"
              path="/api/qr-codes"
              description="List your QR codes (with search, type, status filters)"
            />
            <EndpointRow
              method="POST"
              path="/api/qr-codes"
              description="Create a dynamic or static QR code"
            />
            <EndpointRow
              method="PUT"
              path="/api/qr-codes/{id}"
              description="Update QR code label or status"
            />
            <EndpointRow
              method="DELETE"
              path="/api/qr-codes/{id}"
              description="Delete a QR code"
            />
          </div>

          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">
              Create Dynamic QR — Request
            </p>
            <CodeBlock
              language="json"
              code={`{
  "type": "dynamic",
  "label": "Order #1234",
  "payload": "upi://pay?pa=merchant@upi&pn=MyStore&am=500&cu=INR",
  "amount": "500.00"
}`}
            />
          </div>

          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">
              Create Dynamic QR — Response
            </p>
            <CodeBlock
              language="json"
              code={`{
  "id": 1,
  "merchantId": 42,
  "type": "dynamic",
  "label": "Order #1234",
  "payload": "upi://pay?pa=merchant@upi&pn=MyStore&am=500&cu=INR",
  "amount": "500.00",
  "status": "active",
  "createdAt": "2026-06-08T10:00:00Z"
}`}
            />
          </div>

          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">cURL Example</p>
            <CodeBlock
              code={`curl -X POST https://your-domain.com/api/qr-codes \\
  -H "Authorization: Bearer <your-token>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "type": "dynamic",
    "label": "Order #1234",
    "payload": "upi://pay?pa=merchant@upi&pn=MyStore&am=500&cu=INR",
    "amount": "500.00"
  }'`}
            />
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">Try it</p>
            <TryItPanel method="GET" path="/api/qr-codes" token={globalToken} />
            <TryItPanel
              method="POST"
              path="/api/qr-codes"
              token={globalToken}
              defaultBody={`{
  "type": "dynamic",
  "label": "Order #1234",
  "payload": "upi://pay?pa=merchant@upi&pn=MyStore&am=500&cu=INR",
  "amount": "500.00"
}`}
            />
            <TryItPanel
              method="PUT"
              path="/api/qr-codes/{id}"
              token={globalToken}
              defaultBody={`{
  "label": "Updated Label",
  "status": "active"
}`}
            />
            <TryItPanel method="DELETE" path="/api/qr-codes/{id}" token={globalToken} />
          </div>
        </Section>

        <Section title="Virtual Account API" badge="4 endpoints">
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">Endpoints</p>
            <EndpointRow
              method="POST"
              path="/api/virtual-accounts"
              description="Create a virtual account"
            />
            <EndpointRow
              method="GET"
              path="/api/virtual-accounts"
              description="List all virtual accounts"
            />
            <EndpointRow
              method="PUT"
              path="/api/virtual-accounts/{id}"
              description="Update or close account"
            />
            <EndpointRow
              method="DELETE"
              path="/api/virtual-accounts/{id}"
              description="Delete virtual account"
            />
          </div>

          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">
              Create Virtual Account — Request
            </p>
            <CodeBlock
              language="json"
              code={`{
  "accountNumber": "1234567890123456",
  "ifsc": "HDFC0001234",
  "bankName": "HDFC Bank",
  "accountHolder": "MyStore Ltd",
  "label": "Collections Account"
}`}
            />
          </div>

          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">
              Create Virtual Account — Response
            </p>
            <CodeBlock
              language="json"
              code={`{
  "id": 5,
  "merchantId": 42,
  "accountNumber": "1234567890123456",
  "ifsc": "HDFC0001234",
  "bankName": "HDFC Bank",
  "accountHolder": "MyStore Ltd",
  "label": "Collections Account",
  "status": "active",
  "createdAt": "2026-06-08T10:00:00Z"
}`}
            />
          </div>

          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">cURL Example</p>
            <CodeBlock
              code={`curl -X POST https://your-domain.com/api/virtual-accounts \\
  -H "Authorization: Bearer <your-token>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "accountNumber": "1234567890123456",
    "ifsc": "HDFC0001234",
    "bankName": "HDFC Bank",
    "accountHolder": "MyStore Ltd"
  }'`}
            />
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">Try it</p>
            <TryItPanel method="GET" path="/api/virtual-accounts" token={globalToken} />
            <TryItPanel
              method="POST"
              path="/api/virtual-accounts"
              token={globalToken}
              defaultBody={`{
  "accountNumber": "1234567890123456",
  "ifsc": "HDFC0001234",
  "bankName": "HDFC Bank",
  "accountHolder": "MyStore Ltd",
  "label": "Collections Account"
}`}
            />
            <TryItPanel
              method="PUT"
              path="/api/virtual-accounts/{id}"
              token={globalToken}
              defaultBody={`{
  "label": "Updated Label",
  "status": "active"
}`}
            />
            <TryItPanel method="DELETE" path="/api/virtual-accounts/{id}" token={globalToken} />
          </div>
        </Section>

        <Section title="Webhook Events Reference" badge="5 event types">
          <p className="text-sm text-muted-foreground">
            RasoKart sends POST requests to your configured webhook URL when events occur.
          </p>
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">
              Payment Success Webhook Payload
            </p>
            <CodeBlock
              language="json"
              code={`{
  "event": "payment.success",
  "timestamp": "2026-06-08T10:00:00Z",
  "data": {
    "transactionId": 101,
    "utr": "UTR123456789",
    "amount": 500.00,
    "currency": "INR",
    "merchantId": 42,
    "referenceId": "ORDER-1234",
    "qrCodeId": 1,
    "status": "success"
  }
}`}
            />
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">
              Payment Failed Webhook Payload
            </p>
            <CodeBlock
              language="json"
              code={`{
  "event": "payment.failed",
  "timestamp": "2026-06-08T10:01:00Z",
  "data": {
    "transactionId": 102,
    "utr": "UTR987654321",
    "amount": 250.00,
    "currency": "INR",
    "merchantId": 42,
    "status": "failed",
    "failureReason": "Insufficient funds"
  }
}`}
            />
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">
              Virtual Account Credit Webhook
            </p>
            <CodeBlock
              language="json"
              code={`{
  "event": "va.credited",
  "timestamp": "2026-06-08T10:02:00Z",
  "data": {
    "virtualAccountId": 5,
    "accountNumber": "1234567890123456",
    "amount": 1000.00,
    "currency": "INR",
    "utr": "UTR111111111",
    "remitterName": "John Doe",
    "merchantId": 42
  }
}`}
            />
          </div>
        </Section>

        <Section title="Callback Security" badge="HMAC-SHA256">
          <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
            <ShieldCheck className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-amber-300">Two separate signing secrets</p>
              <p className="text-xs text-muted-foreground">
                RasoKart uses{" "}
                <strong className="text-foreground">two distinct secrets</strong> for different
                directions of data flow:
              </p>
              <ul className="text-xs text-muted-foreground space-y-1 mt-1 list-disc list-inside">
                <li>
                  <strong className="text-foreground">Outbound Webhook Secret</strong> — RasoKart
                  signs the event payloads it sends <em>to your endpoint</em> (payment.success,
                  va.credited, etc.). Use this to verify that incoming webhook calls genuinely came
                  from RasoKart.
                </li>
                <li>
                  <strong className="text-foreground">Inbound Callback Secret</strong> — Your server
                  signs the payment-result callbacks it sends <em>to RasoKart</em> (e.g. after a UPI
                  deep-link redirect). Use this so RasoKart can verify the callback came from you.
                </li>
              </ul>
              <p className="text-xs text-muted-foreground mt-1">
                Both secrets are generated on the{" "}
                <a
                  href="/merchant/webhook"
                  className="inline-flex items-center gap-0.5 text-primary underline underline-offset-2"
                >
                  Webhook Settings <ExternalLink className="w-3 h-3" />
                </a>{" "}
                page.
              </p>
            </div>
          </div>

          <div>
            <p className="text-sm font-medium text-muted-foreground mb-1">
              X-Signature Header Format
            </p>
            <p className="text-xs text-muted-foreground mb-2">
              Every signed request (both directions) carries an{" "}
              <code className="font-mono bg-muted px-1 rounded">X-Signature</code> header in the
              format:
            </p>
            <CodeBlock code={`X-Signature: sha256=<hex-encoded HMAC-SHA256 digest>`} />
            <p className="text-xs text-muted-foreground mt-2">
              The digest is computed over the raw request body bytes using the appropriate secret as
              the HMAC key.
            </p>
          </div>

          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">
              Verify an Inbound Webhook — Node.js
            </p>
            <CodeBlock
              language="javascript"
              code={`const crypto = require("crypto");

// Your outbound webhook secret from the Webhook Settings page
const WEBHOOK_SECRET = process.env.RASOKART_WEBHOOK_SECRET;

function verifyRasoKartWebhook(rawBody, signatureHeader) {
  // signatureHeader is the value of X-Signature from the request
  const expected = "sha256=" + crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(rawBody)          // rawBody must be the raw Buffer, not parsed JSON
    .digest("hex");

  // Constant-time comparison to prevent timing attacks
  // Buffers must be the same length or timingSafeEqual throws
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Express example
app.post("/webhook", express.raw({ type: "application/json" }), (req, res) => {
  const sig = req.headers["x-signature"];
  if (!sig || !verifyRasoKartWebhook(req.body, sig)) {
    return res.status(401).json({ error: "Invalid signature" });
  }
  const event = JSON.parse(req.body);
  // process event.event, event.data …
  res.json({ received: true });
});`}
            />
          </div>

          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">
              Verify an Inbound Webhook — Python
            </p>
            <CodeBlock
              language="python"
              code={`import hmac, hashlib, os
from flask import Flask, request, abort

WEBHOOK_SECRET = os.environ["RASOKART_WEBHOOK_SECRET"].encode()

app = Flask(__name__)

@app.route("/webhook", methods=["POST"])
def webhook():
    sig_header = request.headers.get("X-Signature", "")
    body = request.get_data()  # raw bytes — do NOT call request.json() first

    expected = "sha256=" + hmac.new(WEBHOOK_SECRET, body, hashlib.sha256).hexdigest()

    if not hmac.compare_digest(expected, sig_header):
        abort(401)  # signature mismatch — reject the request

    event = request.get_json()
    # process event["event"], event["data"] …
    return {"received": True}, 200`}
            />
          </div>

          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">
              Sign an Outbound Callback — Node.js
            </p>
            <p className="text-xs text-muted-foreground mb-2">
              When your server sends a payment-result callback <em>back to RasoKart</em>, sign it
              with your inbound callback secret:
            </p>
            <CodeBlock
              language="javascript"
              code={`const crypto = require("crypto");

// Your inbound callback secret from the Webhook Settings page
const CALLBACK_SECRET = process.env.RASOKART_CALLBACK_SECRET;

function signCallback(body) {
  // body must be the JSON string you are about to POST
  return "sha256=" + crypto
    .createHmac("sha256", CALLBACK_SECRET)
    .update(body)
    .digest("hex");
}

const payload = JSON.stringify({ transactionId: 101, status: "success" });
const signature = signCallback(payload);

await fetch("https://your-domain.com/api/callbacks/payment", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Signature": signature,
  },
  body: payload,
});`}
            />
          </div>

          <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 space-y-1">
            <p className="text-sm font-medium text-rose-300">What happens when verification fails</p>
            <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
              <li>
                RasoKart rejects inbound callbacks with a{" "}
                <code className="font-mono bg-muted px-1 rounded">401 Unauthorized</code> response
                and the payment event is not recorded.
              </li>
              <li>
                Your server should return a non-2xx status for failed outbound webhook signatures.
                RasoKart will retry delivery up to 5 times with exponential back-off before marking
                the webhook attempt as failed.
              </li>
              <li>
                Never fall back to accepting unsigned requests — always reject on mismatch to prevent
                replay or spoofing attacks.
              </li>
            </ul>
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1">
            <ShieldCheck className="w-3.5 h-3.5 text-primary shrink-0" />
            <span>
              Generate or rotate your signing secrets on the{" "}
              <a
                href="/merchant/webhook"
                className="inline-flex items-center gap-0.5 text-primary underline underline-offset-2"
              >
                Webhook Settings page <ExternalLink className="w-3 h-3" />
              </a>
              .
            </span>
          </div>
        </Section>

        <Section title="Authentication" badge="JWT Bearer">
          <p className="text-sm text-muted-foreground">
            All API requests require a valid JWT token obtained from the login endpoint.
          </p>
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">Login Request</p>
            <CodeBlock
              code={`curl -X POST https://your-domain.com/api/auth/login \\
  -H "Content-Type: application/json" \\
  -d '{"email": "you@merchant.com", "password": "your-password"}'`}
            />
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">Login Response</p>
            <CodeBlock
              language="json"
              code={`{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": 1,
    "email": "you@merchant.com",
    "role": "merchant",
    "name": "Your Name"
  }
}`}
            />
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">Using the Token</p>
            <CodeBlock
              code={`curl -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \\
  https://your-domain.com/api/transactions`}
            />
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">Try it</p>
            <TryItPanel
              method="POST"
              path="/api/auth/login"
              token=""
              requiresAuth={false}
              defaultBody={`{
  "email": "merchant@demo.com",
  "password": "Merchant@123456"
}`}
            />
          </div>
        </Section>
      </div>
    </div>
  );
}
