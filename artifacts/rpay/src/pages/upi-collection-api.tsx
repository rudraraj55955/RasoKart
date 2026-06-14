import { useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { getToken } from "@/lib/auth";
import {
  QrCode, Zap, Shield, BarChart3, Webhook, Key,
  Copy, Check, ArrowRight, RefreshCw, Globe,
  CheckCircle2, Code2, Landmark, Link2, Bell,
  Activity, FileText, Lock, FlaskConical, Play,
  AlertCircle, ChevronDown, ChevronUp, Loader2,
  Clock, Trash2, Send, ExternalLink,
} from "lucide-react";

function CodeBlock({ code, language = "json" }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="relative group">
      <pre className="bg-black/70 border border-border/50 rounded-lg p-4 text-xs font-mono overflow-x-auto text-green-300 whitespace-pre leading-relaxed">
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

// ── Sandbox tester ────────────────────────────────────────────────────────────

type SandboxEndpoint = {
  id: string;
  method: "POST" | "GET" | "DELETE";
  path: string;
  description: string;
  fields: SandboxField[];
  mockResponse: (fields: Record<string, string>) => { status: number; body: object };
};

type SandboxField = {
  name: string;
  label: string;
  placeholder: string;
  defaultValue?: string;
  required?: boolean;
  type?: "text" | "number";
};

const SANDBOX_ENDPOINTS: SandboxEndpoint[] = [
  {
    id: "create-qr",
    method: "POST",
    path: "/api/qr-codes",
    description: "Create a dynamic payment collection QR",
    fields: [
      { name: "label",     label: "Label",     placeholder: "Order #INV-2024-0042",   defaultValue: "Order #INV-2024-0042",  required: true },
      { name: "amount",    label: "Amount (₹)", placeholder: "2499.00",               defaultValue: "2499.00",               required: true, type: "number" },
      { name: "reference", label: "Reference",  placeholder: "INV-2024-0042",         defaultValue: "INV-2024-0042" },
    ],
    mockResponse: (f) => ({
      status: 201,
      body: {
        id: Math.floor(100 + Math.random() * 900),
        label: f["label"] || "Order #INV-2024-0042",
        type: "dynamic",
        status: "active",
        amount: parseFloat(f["amount"] || "2499").toFixed(2),
        reference: f["reference"] || null,
        ekqrPaymentUrl: `https://pay.rasokart.com/qr/${Math.floor(100 + Math.random() * 900)}`,
        createdAt: new Date().toISOString(),
      },
    }),
  },
  {
    id: "list-qr",
    method: "GET",
    path: "/api/qr-codes",
    description: "List QR codes (most recent first)",
    fields: [
      { name: "limit",  label: "Limit",  placeholder: "10", defaultValue: "10", type: "number" },
      { name: "status", label: "Status (optional)", placeholder: "active | expired | all", defaultValue: "" },
    ],
    mockResponse: (f) => {
      const limit = Math.min(parseInt(f["limit"] || "10", 10) || 3, 5);
      return {
        status: 200,
        body: {
          data: Array.from({ length: limit }, (_, i) => ({
            id: 180 + i,
            label: `Order #INV-2024-00${40 + i}`,
            type: "dynamic",
            status: i === 0 ? "active" : "expired",
            amount: ((i + 1) * 999).toFixed(2),
            reference: `INV-2024-00${40 + i}`,
            createdAt: new Date(Date.now() - i * 86_400_000).toISOString(),
          })),
          total: 42,
          limit,
          offset: 0,
        },
      };
    },
  },
  {
    id: "get-qr",
    method: "GET",
    path: "/api/qr-codes/:id",
    description: "Fetch a single QR code by ID",
    fields: [
      { name: "id", label: "QR Code ID", placeholder: "184", defaultValue: "184", required: true, type: "number" },
    ],
    mockResponse: (f) => ({
      status: 200,
      body: {
        id: parseInt(f["id"] || "184", 10),
        label: "Order #INV-2024-0042",
        type: "dynamic",
        status: "active",
        amount: "2499.00",
        reference: "INV-2024-0042",
        ekqrPaymentUrl: `https://pay.rasokart.com/qr/${f["id"] || "184"}`,
        depositsCount: 0,
        createdAt: "2025-06-14T10:32:00.000Z",
      },
    }),
  },
  {
    id: "list-deposits",
    method: "GET",
    path: "/api/deposits",
    description: "List received deposits",
    fields: [
      { name: "limit",  label: "Limit",  placeholder: "10", defaultValue: "5", type: "number" },
      { name: "status", label: "Status (optional)", placeholder: "completed | pending | all", defaultValue: "" },
    ],
    mockResponse: (f) => {
      const limit = Math.min(parseInt(f["limit"] || "5", 10) || 3, 5);
      return {
        status: 200,
        body: {
          data: Array.from({ length: limit }, (_, i) => ({
            id: 300 + i,
            amount: ((i + 1) * 1250).toFixed(2),
            status: "completed",
            utrNumber: `UTR${Date.now() - i}`,
            qrCodeId: 180 + i,
            paidAt: new Date(Date.now() - i * 3_600_000).toISOString(),
          })),
          total: 17,
          limit,
          offset: 0,
        },
      };
    },
  },
  {
    id: "delete-qr",
    method: "DELETE",
    path: "/api/qr-codes/:id",
    description: "Deactivate a QR code",
    fields: [
      { name: "id", label: "QR Code ID", placeholder: "184", defaultValue: "184", required: true, type: "number" },
    ],
    mockResponse: (f) => ({
      status: 200,
      body: {
        id: parseInt(f["id"] || "184", 10),
        status: "deactivated",
        message: "QR code has been deactivated successfully.",
      },
    }),
  },
];

const MAX_HISTORY = 10;

type HistoryEntry = {
  id: number;
  endpoint: SandboxEndpoint;
  resolvedPath: string;
  requestPreview: string;
  result: { status: number; body: object };
  timestamp: Date;
  expanded: boolean;
};

const METHOD_COLOR: Record<string, string> = {
  GET:    "bg-blue-500/20 text-blue-400 border-blue-500/30",
  POST:   "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  DELETE: "bg-rose-500/20 text-rose-400 border-rose-500/30",
};

const STATUS_COLOR = (status: number) =>
  status >= 200 && status < 300 ? "text-emerald-400" : "text-rose-400";

function buildRequestPreview(ep: SandboxEndpoint, merged: Record<string, string>): string {
  const rpath = ep.path.replace(":id", merged["id"] ?? "");
  const bodyFields = ep.fields.filter((f) => f.name !== "id" && !["limit", "status"].includes(f.name));
  const hasBody = ep.method === "POST" && bodyFields.length > 0;
  const bodyObj: Record<string, string | number> = {};
  if (hasBody) {
    for (const f of bodyFields) {
      bodyObj[f.name] = f.type === "number" ? parseFloat(merged[f.name] || "0") : merged[f.name] || "";
    }
  }
  return [
    `${ep.method} ${rpath}`,
    `Authorization: Bearer rasokart_live_••••••••••••••••`,
    hasBody ? `\n${JSON.stringify(bodyObj, null, 2)}` : "",
  ].filter(Boolean).join("\n");
}

function formatRelativeTime(date: Date): string {
  const secs = Math.floor((Date.now() - date.getTime()) / 1000);
  if (secs < 5)  return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

function SandboxTester() {
  const [selectedId, setSelectedId]     = useState<string>("create-qr");
  const [fieldValues, setFieldValues]   = useState<Record<string, string>>({});
  const [loading, setLoading]           = useState(false);
  const [result, setResult]             = useState<{ status: number; body: object } | null>(null);
  const [showRequest, setShowRequest]   = useState(false);
  const [copied, setCopied]             = useState(false);
  const [history, setHistory]           = useState<HistoryEntry[]>([]);
  const [historyOpen, setHistoryOpen]   = useState(false);
  const [historyIdSeq, setHistoryIdSeq] = useState(0);

  const endpoint = SANDBOX_ENDPOINTS.find((e) => e.id === selectedId)!;

  const getValue = (field: SandboxField) =>
    fieldValues[field.name] ?? field.defaultValue ?? "";

  const setField = (name: string, value: string) =>
    setFieldValues((prev) => ({ ...prev, [name]: value }));

  const handleRun = () => {
    const merged: Record<string, string> = {};
    for (const f of endpoint.fields) merged[f.name] = getValue(f);

    setLoading(true);
    setResult(null);
    setTimeout(() => {
      const res = endpoint.mockResponse(merged);
      setResult(res);
      setLoading(false);
      setShowRequest(false);

      const rp = buildRequestPreview(endpoint, merged);
      const rpath = endpoint.path.replace(
        ":id",
        merged[endpoint.fields.find((f) => f.name === "id")?.name ?? ""] ?? "",
      );
      const nextId = historyIdSeq + 1;
      setHistoryIdSeq(nextId);
      setHistory((prev) => [
        { id: nextId, endpoint, resolvedPath: rpath, requestPreview: rp, result: res, timestamp: new Date(), expanded: false },
        ...prev,
      ].slice(0, MAX_HISTORY));
    }, 600 + Math.random() * 400);
  };

  const toggleHistoryEntry = (id: number) =>
    setHistory((prev) => prev.map((h) => h.id === id ? { ...h, expanded: !h.expanded } : h));

  const resolvedPath = endpoint.path.replace(
    ":id",
    getValue(endpoint.fields.find((f) => f.name === "id") ?? endpoint.fields[0]),
  );

  const requestPreview = (() => {
    const merged: Record<string, string> = {};
    for (const f of endpoint.fields) merged[f.name] = getValue(f);
    return buildRequestPreview(endpoint, merged);
  })();

  const handleCopyResponse = () => {
    if (!result) return;
    navigator.clipboard.writeText(JSON.stringify(result.body, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card className="border-amber-500/25 bg-amber-500/5">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-amber-500/15">
            <FlaskConical className="w-4 h-4 text-amber-400" />
          </div>
          <div className="flex-1 min-w-0">
            <CardTitle className="text-base flex items-center gap-2">
              Sandbox API Tester
              <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/25 text-[10px] font-semibold">
                SANDBOX
              </Badge>
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Mock responses only — no real transactions or funds are moved.
            </p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Endpoint selector */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Endpoint</Label>
          <Select value={selectedId} onValueChange={(v) => { setSelectedId(v); setResult(null); setFieldValues({}); }}>
            <SelectTrigger className="font-mono text-sm bg-black/40 border-border/60">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SANDBOX_ENDPOINTS.map((ep) => (
                <SelectItem key={ep.id} value={ep.id}>
                  <span className="flex items-center gap-2">
                    <Badge className={`text-[10px] font-bold border ${METHOD_COLOR[ep.method]}`}>{ep.method}</Badge>
                    <span className="font-mono text-xs">{ep.path}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{endpoint.description}</p>
        </div>

        <Separator className="bg-border/40" />

        {/* Fields */}
        {endpoint.fields.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {endpoint.fields.map((field) => (
              <div key={field.name} className="space-y-1.5">
                <Label htmlFor={`sb-${field.name}`} className="text-xs">
                  {field.label}
                  {field.required && <span className="text-rose-400 ml-0.5">*</span>}
                </Label>
                <Input
                  id={`sb-${field.name}`}
                  type={field.type === "number" ? "number" : "text"}
                  placeholder={field.placeholder}
                  value={getValue(field)}
                  onChange={(e) => setField(field.name, e.target.value)}
                  className="bg-black/40 border-border/60 font-mono text-sm h-8"
                />
              </div>
            ))}
          </div>
        )}

        {/* Request preview toggle */}
        <div>
          <button
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setShowRequest((p) => !p)}
          >
            {showRequest ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {showRequest ? "Hide" : "Show"} request preview
          </button>
          {showRequest && (
            <div className="mt-2">
              <CodeBlock code={requestPreview} language="http" />
            </div>
          )}
        </div>

        {/* Run button */}
        <Button
          onClick={handleRun}
          disabled={loading}
          className="bg-teal-600 hover:bg-teal-500 text-white gap-2 w-full sm:w-auto"
        >
          {loading
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</>
            : <><Play className="w-4 h-4" /> Send Request</>}
        </Button>

        {/* Response panel */}
        {result && (
          <div className="space-y-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {result.status >= 200 && result.status < 300
                  ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  : <AlertCircle className="w-3.5 h-3.5 text-rose-400" />}
                <span className={`text-xs font-semibold ${STATUS_COLOR(result.status)}`}>
                  HTTP {result.status}
                </span>
                <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/20 text-[10px]">
                  MOCK
                </Badge>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                onClick={handleCopyResponse}
                title="Copy response"
              >
                {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              </Button>
            </div>
            <div className="relative group">
              <pre className="bg-black/70 border border-border/50 rounded-lg p-4 text-xs font-mono overflow-x-auto text-green-300 whitespace-pre leading-relaxed max-h-72 overflow-y-auto">
                {JSON.stringify(result.body, null, 2)}
              </pre>
            </div>
            <p className="text-[10px] text-muted-foreground flex items-center gap-1.5">
              <FlaskConical className="w-3 h-3 text-amber-400/70" />
              This is a simulated sandbox response. No API key is required and no data is stored.
            </p>
          </div>
        )}

        {/* ── Recent requests history ───────────────────────────────────────── */}
        {history.length > 0 && (
          <div className="space-y-2 pt-1">
            <Separator className="bg-border/40" />
            <div className="flex items-center justify-between">
              <button
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setHistoryOpen((p) => !p)}
              >
                {historyOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                <Clock className="w-3 h-3" />
                Recent requests
                <span className="ml-0.5 bg-border/60 text-[10px] rounded-full px-1.5 py-px font-semibold">
                  {history.length}
                </span>
              </button>
              <button
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-rose-400 transition-colors"
                onClick={() => setHistory([])}
                title="Clear history"
              >
                <Trash2 className="w-3 h-3" />
                Clear
              </button>
            </div>

            {historyOpen && (
              <div className="space-y-1.5 animate-in fade-in slide-in-from-top-1 duration-200">
                {history.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-lg border border-border/40 bg-black/30 overflow-hidden"
                  >
                    {/* Entry header — always visible */}
                    <button
                      className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/5 transition-colors"
                      onClick={() => toggleHistoryEntry(entry.id)}
                    >
                      <Badge
                        className={`text-[10px] font-bold shrink-0 border ${METHOD_COLOR[entry.endpoint.method]}`}
                      >
                        {entry.endpoint.method}
                      </Badge>
                      <code className="text-xs font-mono text-foreground/80 flex-1 truncate">
                        {entry.resolvedPath}
                      </code>
                      <span
                        className={`text-[11px] font-semibold shrink-0 ${STATUS_COLOR(entry.result.status)}`}
                      >
                        {entry.result.status}
                      </span>
                      <span className="text-[10px] text-muted-foreground shrink-0 w-14 text-right">
                        {formatRelativeTime(entry.timestamp)}
                      </span>
                      {entry.expanded
                        ? <ChevronUp className="w-3 h-3 text-muted-foreground shrink-0" />
                        : <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />}
                    </button>

                    {/* Entry detail — expandable */}
                    {entry.expanded && (
                      <div className="border-t border-border/30 px-3 py-3 space-y-3">
                        <div className="space-y-1">
                          <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Request</p>
                          <CodeBlock code={entry.requestPreview} language="http" />
                        </div>
                        <div className="space-y-1">
                          <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Response</p>
                          <CodeBlock code={JSON.stringify(entry.result.body, null, 2)} />
                        </div>
                        <p className="text-[10px] text-muted-foreground">
                          {entry.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Webhook Event Simulator ───────────────────────────────────────────────────

const WEBHOOK_EVENT_OPTIONS = [
  { value: "payment.success",      label: "payment.success",      desc: "Payment completed successfully" },
  { value: "payment.failed",       label: "payment.failed",       desc: "Payment failed or was declined" },
  { value: "payment.pending",      label: "payment.pending",      desc: "Payment is awaiting confirmation" },
  { value: "withdrawal.approved",  label: "withdrawal.approved",  desc: "Withdrawal / settlement approved" },
  { value: "withdrawal.rejected",  label: "withdrawal.rejected",  desc: "Withdrawal / settlement rejected" },
  { value: "settlement.processed", label: "settlement.processed", desc: "Settlement batch processed" },
] as const;

type SimulateResult = {
  delivered: boolean;
  httpStatus: number | null;
  responseBody: string | null;
  durationMs: number;
  webhookUrl: string;
  signed: boolean;
  requestBody: string;
  signatureHeader?: string;
  error?: string;
};

function WebhookSimulator() {
  const [webhookUrl, setWebhookUrl]   = useState("");
  const [eventType, setEventType]     = useState<string>("payment.success");
  const [amount, setAmount]           = useState("1000");
  const [reference, setReference]     = useState("INV-2024-0042");
  const [loading, setLoading]         = useState(false);
  const [result, setResult]           = useState<SimulateResult | null>(null);
  const [showPayload, setShowPayload] = useState(false);
  const [copiedSig, setCopiedSig]     = useState(false);
  const [copiedResp, setCopiedResp]   = useState(false);

  const handleFire = async () => {
    if (!webhookUrl.trim()) {
      toast.error("Please enter a webhook URL");
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const token = getToken();
      const res = await fetch("/api/webhooks/simulate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ webhookUrl: webhookUrl.trim(), eventType, amount, reference }),
      });
      const data = await res.json() as SimulateResult & { error?: string };
      if (!res.ok) {
        toast.error(data.error ?? "Simulation failed");
        setResult(null);
      } else {
        setResult(data);
        if (data.delivered) {
          toast.success(`Delivered — HTTP ${data.httpStatus}`);
        } else {
          toast.error(`Not delivered — HTTP ${data.httpStatus ?? "no response"}`);
        }
      }
    } catch (err: any) {
      toast.error(err?.message ?? "Network error");
    } finally {
      setLoading(false);
    }
  };

  const copySignature = () => {
    if (!result?.signatureHeader) return;
    navigator.clipboard.writeText(result.signatureHeader);
    setCopiedSig(true);
    setTimeout(() => setCopiedSig(false), 2000);
  };

  const copyResponse = () => {
    if (!result?.responseBody) return;
    navigator.clipboard.writeText(result.responseBody);
    setCopiedResp(true);
    setTimeout(() => setCopiedResp(false), 2000);
  };

  const selectedEvent = WEBHOOK_EVENT_OPTIONS.find((e) => e.value === eventType);

  return (
    <Card className="border-violet-500/25 bg-violet-500/5">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-violet-500/15">
            <Send className="w-4 h-4 text-violet-400" />
          </div>
          <div className="flex-1 min-w-0">
            <CardTitle className="text-base flex items-center gap-2">
              Webhook Event Simulator
              <Badge className="bg-violet-500/15 text-violet-400 border-violet-500/25 text-[10px] font-semibold">
                LIVE
              </Badge>
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Fire a signed HMAC-SHA256 payload to any HTTPS endpoint and see the live response.
            </p>
          </div>
          <Button asChild variant="ghost" size="sm" className="text-violet-400 hover:text-violet-300 gap-1.5 text-xs shrink-0">
            <Link href="/merchant/webhooks">
              Configure <ExternalLink className="w-3 h-3" />
            </Link>
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">

        {/* URL field */}
        <div className="space-y-1.5">
          <Label htmlFor="sim-url" className="text-xs">
            Webhook URL <span className="text-rose-400">*</span>
          </Label>
          <Input
            id="sim-url"
            type="url"
            placeholder="https://your-server.com/webhooks/rasokart"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            className="bg-black/40 border-border/60 font-mono text-sm"
          />
          <p className="text-[11px] text-muted-foreground">
            Must be HTTPS. Public internet addresses only — private/localhost IPs are blocked.
          </p>
        </div>

        <Separator className="bg-border/40" />

        {/* Event type + amount + reference */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1.5 sm:col-span-1">
            <Label className="text-xs">Event Type <span className="text-rose-400">*</span></Label>
            <Select value={eventType} onValueChange={setEventType}>
              <SelectTrigger className="font-mono text-xs bg-black/40 border-border/60">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WEBHOOK_EVENT_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    <span className="font-mono text-xs">{opt.label}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedEvent && (
              <p className="text-[11px] text-muted-foreground">{selectedEvent.desc}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sim-amount" className="text-xs">Amount (₹)</Label>
            <Input
              id="sim-amount"
              type="number"
              min="1"
              placeholder="1000"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="bg-black/40 border-border/60 font-mono text-sm h-9"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sim-ref" className="text-xs">Reference</Label>
            <Input
              id="sim-ref"
              placeholder="INV-2024-0042"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className="bg-black/40 border-border/60 font-mono text-sm h-9"
            />
          </div>
        </div>

        {/* Payload preview toggle */}
        <div>
          <button
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setShowPayload((p) => !p)}
          >
            {showPayload ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {showPayload ? "Hide" : "Show"} example payload
          </button>
          {showPayload && (
            <div className="mt-2">
              <CodeBlock
                code={JSON.stringify({
                  event: eventType,
                  test: true,
                  timestamp: new Date().toISOString(),
                  data: {
                    transactionId: "txn_test_••••••••••••••••",
                    amount: parseFloat(amount) || 1000,
                    currency: "INR",
                    reference: reference || "INV-2024-0042",
                    description: "Test event from RasoKart webhook tester",
                  },
                }, null, 2)}
              />
            </div>
          )}
        </div>

        {/* Fire button */}
        <Button
          onClick={handleFire}
          disabled={loading || !webhookUrl.trim()}
          className="bg-violet-600 hover:bg-violet-500 text-white gap-2 w-full sm:w-auto"
        >
          {loading
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Firing…</>
            : <><Send className="w-4 h-4" /> Fire Test Event</>}
        </Button>

        {/* Result panel */}
        {result && (
          <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <Separator className="bg-border/40" />

            {/* Status row */}
            <div className="flex flex-wrap items-center gap-3">
              {result.delivered
                ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                : <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />}
              <span className={`text-sm font-semibold ${result.delivered ? "text-emerald-400" : "text-rose-400"}`}>
                {result.delivered ? "Delivered" : "Not delivered"}
              </span>
              {result.httpStatus != null && (
                <Badge
                  className={`text-[10px] font-bold border ${
                    result.delivered
                      ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/25"
                      : "bg-rose-500/15 text-rose-400 border-rose-500/25"
                  }`}
                >
                  HTTP {result.httpStatus}
                </Badge>
              )}
              <span className="flex items-center gap-1 text-xs text-muted-foreground ml-auto">
                <Clock className="w-3 h-3" /> {result.durationMs}ms
              </span>
            </div>

            {/* Signature info */}
            {result.signed && result.signatureHeader && (
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Shield className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-xs font-medium text-emerald-400">HMAC-SHA256 signed</span>
                  </div>
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={copySignature} title="Copy signature">
                    {copiedSig ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  </Button>
                </div>
                <code className="text-[11px] font-mono text-muted-foreground break-all">{result.signatureHeader}</code>
              </div>
            )}

            {/* Response body */}
            {result.responseBody != null && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Response body</span>
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={copyResponse} title="Copy response">
                    {copiedResp ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  </Button>
                </div>
                <pre className="bg-black/70 border border-border/50 rounded-lg p-3 text-xs font-mono overflow-x-auto text-green-300 whitespace-pre-wrap max-h-48 overflow-y-auto">
                  {result.responseBody}
                </pre>
              </div>
            )}

            <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
              <Send className="w-3 h-3 text-violet-400/70" />
              This was a real HTTPS request to your server. No funds were moved.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Page constants ────────────────────────────────────────────────────────────

const FEATURES = [
  {
    icon: QrCode,
    title: "Dynamic QR Payments",
    description: "Generate unique per-transaction QR codes. Each code is tied to a specific amount and expires automatically, ensuring clean reconciliation.",
    color: "text-teal-400",
    bg: "bg-teal-400/10",
  },
  {
    icon: Zap,
    title: "Real-Time Notifications",
    description: "Receive instant webhook callbacks the moment a payment lands. Build responsive checkout flows with sub-second confirmation delivery.",
    color: "text-yellow-400",
    bg: "bg-yellow-400/10",
  },
  {
    icon: RefreshCw,
    title: "Auto-Reconciliation",
    description: "Every deposit is automatically matched against its originating order. Discrepancies are flagged immediately — no manual ledger work.",
    color: "text-violet-400",
    bg: "bg-violet-400/10",
  },
  {
    icon: Shield,
    title: "Signature Verification",
    description: "All webhook payloads are HMAC-signed. Verify authenticity with your callback secret to reject spoofed or tampered notifications.",
    color: "text-emerald-400",
    bg: "bg-emerald-400/10",
  },
  {
    icon: BarChart3,
    title: "Full Payment Analytics",
    description: "Track collection volume, success rates, and average transaction values. Filter by date, status, or payment method with detailed drill-downs.",
    color: "text-blue-400",
    bg: "bg-blue-400/10",
  },
  {
    icon: Landmark,
    title: "Virtual Account Assignment",
    description: "Assign dedicated virtual bank accounts per merchant or transaction for NEFT/IMPS/RTGS collections alongside QR.",
    color: "text-rose-400",
    bg: "bg-rose-400/10",
  },
];

const STEPS = [
  {
    step: "01",
    title: "Get Your API Key",
    description: "Generate a live API key from the Merchant Portal. Store it securely — it authenticates every request you make to the Collection API.",
    icon: Key,
  },
  {
    step: "02",
    title: "Create a Collection Request",
    description: "POST to /api/qr-codes with your order amount and reference. Receive a payment QR URL and a unique collection ID in response.",
    icon: Code2,
  },
  {
    step: "03",
    title: "Receive Confirmation",
    description: "When the payer completes the transaction, RasoKart delivers a signed webhook to your endpoint with the final payment status.",
    icon: Bell,
  },
];

const CREATE_QR_REQUEST = `POST /api/qr-codes
Authorization: Bearer rasokart_live_••••••••••••••••

{
  "label": "Order #INV-2024-0042",
  "type": "dynamic",
  "amount": 2499.00,
  "reference": "INV-2024-0042"
}`;

const CREATE_QR_RESPONSE = `HTTP 201 Created

{
  "id": 184,
  "label": "Order #INV-2024-0042",
  "type": "dynamic",
  "status": "active",
  "amount": "2499.00",
  "reference": "INV-2024-0042",
  "ekqrPaymentUrl": "https://pay.rasokart.com/qr/184",
  "createdAt": "2025-06-14T10:32:00.000Z"
}`;

const WEBHOOK_PAYLOAD = `POST https://your-server.com/webhooks/rasokart

X-RasoKart-Signature: sha256=a3f9c2...

{
  "event": "payment.received",
  "qrId": 184,
  "reference": "INV-2024-0042",
  "amount": "2499.00",
  "status": "completed",
  "paidAt": "2025-06-14T10:34:17.000Z"
}`;

const ENDPOINTS = [
  { method: "POST", path: "/api/qr-codes", description: "Create a dynamic payment collection QR" },
  { method: "GET",  path: "/api/qr-codes", description: "List all QR codes with filters" },
  { method: "GET",  path: "/api/qr-codes/:id", description: "Fetch a single QR code and its status" },
  { method: "POST", path: "/api/qr-codes/:id/sync", description: "Force-sync payment status from gateway" },
  { method: "DELETE", path: "/api/qr-codes/:id", description: "Deactivate a QR code" },
  { method: "GET",  path: "/api/deposits", description: "List all received deposits (filterable by date, status)" },
  { method: "GET",  path: "/api/callbacks", description: "View the full webhook delivery log" },
];

const EP_METHOD_COLOR: Record<string, string> = {
  GET: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  POST: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  DELETE: "bg-rose-500/20 text-rose-400 border-rose-500/30",
};

export default function UpiCollectionApi() {
  return (
    <div className="space-y-10 max-w-5xl">

      {/* ── Hero ─────────────────────────────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Badge className="bg-teal-500/15 text-teal-400 border-teal-500/20 text-xs">
            v2 API
          </Badge>
          <Badge variant="outline" className="text-xs">
            REST · JSON · HTTPS
          </Badge>
        </div>
        <h1 className="text-3xl font-bold tracking-tight">UPI Collection API</h1>
        <p className="text-muted-foreground text-base leading-relaxed max-w-2xl">
          Accept UPI payments programmatically. Generate dynamic QR codes, receive real-time webhooks,
          and reconcile deposits automatically — all through a single clean API.
        </p>
        <div className="flex flex-wrap gap-3 pt-1">
          <Button asChild className="bg-teal-600 hover:bg-teal-500 text-white gap-2">
            <Link href="/merchant/api-keys">
              <Key className="w-4 h-4" />
              Get API Key
            </Link>
          </Button>
          <Button asChild variant="outline" className="gap-2">
            <Link href="/merchant/api-docs">
              <FileText className="w-4 h-4" />
              Full API Docs
            </Link>
          </Button>
        </div>
      </div>

      {/* ── Stats bar ────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Uptime SLA",      value: "99.9%",    color: "text-teal-400" },
          { label: "Median Latency",  value: "<80ms",    color: "text-yellow-400" },
          { label: "Webhook Retry",   value: "5×",       color: "text-violet-400" },
          { label: "Signature Algo",  value: "HMAC-256", color: "text-emerald-400" },
        ].map((s) => (
          <Card key={s.label} className="bg-card/50 border-border/50">
            <CardContent className="pt-4 pb-4 text-center">
              <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Features ─────────────────────────────────────────────────────────── */}
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">What's included</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map((f) => (
            <Card key={f.title} className="bg-card/60 border-border/50 hover:border-border transition-colors">
              <CardContent className="pt-5 pb-5 space-y-3">
                <div className={`inline-flex items-center justify-center w-9 h-9 rounded-lg ${f.bg}`}>
                  <f.icon className={`w-4 h-4 ${f.color}`} />
                </div>
                <div>
                  <p className="font-medium text-sm">{f.title}</p>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{f.description}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* ── How it works ─────────────────────────────────────────────────────── */}
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">How it works</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {STEPS.map((s) => (
            <Card key={s.step} className="bg-card/60 border-border/50 relative overflow-hidden">
              <CardContent className="pt-5 pb-5 space-y-3">
                <div className="flex items-center gap-3">
                  <span className="text-2xl font-black text-border/40 leading-none">{s.step}</span>
                  <div className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10">
                    <s.icon className="w-4 h-4 text-primary" />
                  </div>
                </div>
                <div>
                  <p className="font-semibold text-sm">{s.title}</p>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{s.description}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* ── API Reference ────────────────────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">API Reference</h2>
          <Button asChild variant="ghost" size="sm" className="text-teal-400 hover:text-teal-300 gap-1.5 text-xs">
            <Link href="/merchant/api-docs">
              Full reference <ArrowRight className="w-3 h-3" />
            </Link>
          </Button>
        </div>
        <Card className="bg-card/60 border-border/50">
          <CardContent className="pt-5 pb-5">
            <div className="space-y-0">
              {ENDPOINTS.map((ep, i) => (
                <div key={`${ep.method}-${ep.path}`} className={`flex items-start gap-3 py-2.5 ${i < ENDPOINTS.length - 1 ? "border-b border-border/30" : ""}`}>
                  <Badge className={`text-[10px] font-bold shrink-0 border ${EP_METHOD_COLOR[ep.method] ?? "bg-muted"}`}>{ep.method}</Badge>
                  <div className="min-w-0">
                    <code className="text-sm font-mono text-foreground">{ep.path}</code>
                    <p className="text-xs text-muted-foreground mt-0.5">{ep.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Code Examples ────────────────────────────────────────────────────── */}
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Code examples</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Code2 className="w-3.5 h-3.5" /> Create a QR collection
            </p>
            <CodeBlock code={CREATE_QR_REQUEST} language="http" />
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Response
            </p>
            <CodeBlock code={CREATE_QR_RESPONSE} language="json" />
          </div>
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Webhook className="w-3.5 h-3.5 text-violet-400" /> Incoming webhook (payment confirmed)
          </p>
          <CodeBlock code={WEBHOOK_PAYLOAD} language="http" />
        </div>
      </div>

      {/* ── Sandbox Tester ───────────────────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-semibold">Try it yourself</h2>
          <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/25 text-[10px] font-semibold">
            SANDBOX
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground -mt-2">
          Fire mock API requests and inspect realistic responses — no API key or real account needed.
        </p>
        <SandboxTester />
      </div>

      {/* ── Webhook Event Simulator ───────────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-semibold">Webhook event simulator</h2>
          <Badge className="bg-violet-500/15 text-violet-400 border-violet-500/25 text-[10px] font-semibold">
            LIVE
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground -mt-2">
          Enter your endpoint URL, pick an event type, and fire a real HMAC-signed payload — see the live HTTP response inline.
        </p>
        <WebhookSimulator />
      </div>

      {/* ── Capabilities checklist ───────────────────────────────────────────── */}
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Capabilities</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[
            { icon: QrCode,        text: "Dynamic and static QR code generation" },
            { icon: Landmark,      text: "Virtual account collection (NEFT / IMPS / RTGS)" },
            { icon: Link2,         text: "Shareable payment link generation" },
            { icon: Webhook,       text: "Real-time signed webhook delivery (5× retry)" },
            { icon: RefreshCw,     text: "Manual and automatic payment status sync" },
            { icon: Activity,      text: "Full deposit and callback audit trail" },
            { icon: BarChart3,     text: "Analytics dashboard with date-range filtering" },
            { icon: Lock,          text: "HMAC-SHA256 signature on all webhook payloads" },
            { icon: Globe,         text: "Whitelist IP ranges for API access" },
            { icon: Shield,        text: "TLS 1.3 end-to-end encryption on all endpoints" },
          ].map((c) => (
            <div key={c.text} className="flex items-center gap-3 py-2 border-b border-border/20 last:border-0">
              <div className="flex items-center justify-center w-7 h-7 rounded-md bg-teal-500/10 shrink-0">
                <c.icon className="w-3.5 h-3.5 text-teal-400" />
              </div>
              <span className="text-sm text-foreground/80">{c.text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Plans notice ─────────────────────────────────────────────────────── */}
      <Card className="border-primary/20 bg-primary/5">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            API access by plan
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          <p className="text-sm text-muted-foreground">
            API key generation and webhook configuration are available on Silver, Gold, Platinum, and Enterprise plans.
            The Starter plan supports QR and Virtual Account features via the Merchant Portal — upgrade to unlock programmatic API access.
          </p>
          <div className="flex flex-wrap gap-2">
            {["Silver", "Gold", "Platinum", "Enterprise"].map((plan) => (
              <Badge key={plan} className="bg-teal-500/10 text-teal-400 border-teal-500/20 text-xs">
                {plan}
              </Badge>
            ))}
          </div>
          <Button asChild size="sm" variant="outline" className="gap-2 mt-1">
            <Link href="/merchant/plan">
              View plans &amp; pricing <ArrowRight className="w-3 h-3" />
            </Link>
          </Button>
        </CardContent>
      </Card>

      {/* ── CTA ──────────────────────────────────────────────────────────────── */}
      <Card className="border-teal-500/20 bg-teal-500/5 overflow-hidden">
        <CardContent className="pt-8 pb-8 text-center space-y-4">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-teal-500/15 mb-1">
            <QrCode className="w-6 h-6 text-teal-400" />
          </div>
          <div>
            <h3 className="text-lg font-bold">Ready to start collecting?</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Generate your API key and accept your first payment in under 5 minutes.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            <Button asChild className="bg-teal-600 hover:bg-teal-500 text-white gap-2">
              <Link href="/merchant/api-keys">
                <Key className="w-4 h-4" />
                Generate API Key
              </Link>
            </Button>
            <Button asChild variant="outline" className="gap-2">
              <Link href="/merchant/api-docs">
                <FileText className="w-4 h-4" />
                Read the Docs
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>

    </div>
  );
}
