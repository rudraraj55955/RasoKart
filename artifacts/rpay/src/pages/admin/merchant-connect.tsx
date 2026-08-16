/**
 * Merchant Connect — Super Admin hub  (two tabs)
 *
 * Tab 1 — RASOKART CONNECTIONS
 *   Platform-owned provider accounts used by RasoKart itself.
 *   Connect, verify, enable/disable, reconnect, disconnect.
 *   Credentials write-only; Super Admin only.
 *
 * Tab 2 — MERCHANT CONNECTIONS
 *   Original 6-step wizard: assign a provider to a tenant merchant.
 *   Step 1: Select Merchant → Step 2: Provider → Step 3: Credentials
 *   → Step 4: Test → Step 5: Capabilities → Step 6: Activate
 */

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  CheckCircle, XCircle, Loader2, ChevronRight, ChevronLeft, RotateCcw,
  ShieldCheck, Zap, Building2, TestTube2, Settings2, Power, Search,
  Lock, Unlock, ArrowRight, AlertTriangle, RefreshCw, Plug, Unplug,
  Globe, Shield, Clock, Plus, Pencil, Trash2, ToggleLeft, ToggleRight,
} from "lucide-react";
import { toast } from "sonner";
import { getToken } from "@/lib/auth";

// ── Shared types ──────────────────────────────────────────────────────────────

interface Provider {
  id: number;
  name: string;
  slug: string;
  logoUrl: string | null;
  category: string;
  status: string;
  description: string | null;
}

interface MerchantOption {
  id: number;
  businessName: string;
  email: string;
}

// ── Platform connection types ─────────────────────────────────────────────────

interface PlatformConn {
  id: number;
  provider: string;
  label: string | null;
  environment: string;
  credentials: string | null; // always "***" or null from API
  connectionStatus: string;
  isActive: boolean;
  lastTestedAt: string | null;
  lastTestResult: string | null;
  deactivatedAt: string | null;
  createdByEmail: string | null;
  createdAt: string;
  updatedAt: string;
  capabilityPayin: boolean;
  capabilityPayout: boolean;
  capabilityUpi: boolean;
  capabilityQr: boolean;
  capabilityPaymentLinks: boolean;
  capabilityRefunds: boolean;
  capabilitySettlement: boolean;
  notes: string | null;
}

// ── Merchant wizard types ─────────────────────────────────────────────────────

interface CapabilityState {
  payin: boolean;
  payout: boolean;
  upi: boolean;
  qr: boolean;
  paymentLinks: boolean;
  refunds: boolean;
  settlement: boolean;
}

interface ConnectionResult {
  id: number;
  provider: string;
  connectionStatus: string;
  lastTestResult: string;
  lastTestedAt: string | null;
  isActive: boolean;
}

interface TestResult {
  pass: boolean;
  message: string;
  detail?: string;
  testedAt: string;
  connectionStatus: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STEPS = [
  { id: 1, label: "Merchant",     icon: Building2  },
  { id: 2, label: "Provider",     icon: Zap        },
  { id: 3, label: "Credentials",  icon: Lock       },
  { id: 4, label: "Test",         icon: TestTube2  },
  { id: 5, label: "Capabilities", icon: Settings2  },
  { id: 6, label: "Activate",     icon: Power      },
];

const CAPABILITY_LABELS: Record<keyof CapabilityState, string> = {
  payin:          "Payin (receive payments)",
  payout:         "Payout (send payments)",
  upi:            "UPI flows",
  qr:             "QR code actions",
  paymentLinks:   "Payment links",
  refunds:        "Refund issuance",
  settlement:     "Settlement data access",
};

const DEFAULT_CAPABILITIES: CapabilityState = {
  payin: true, payout: false, upi: true, qr: true,
  paymentLinks: false, refunds: false, settlement: false,
};

const CREDENTIAL_HINTS: Record<string, { fields: { name: string; hint: string }[]; note?: string }> = {
  cashfree:  { fields: [{ name: "api_key",    hint: "App ID / Client ID from Cashfree Dashboard" },
                         { name: "api_secret", hint: "Secret Key from Cashfree Dashboard" }] },
  razorpay:  { fields: [{ name: "key_id",     hint: "Key ID from Razorpay Dashboard → API Keys" },
                         { name: "key_secret", hint: "Key Secret from Razorpay Dashboard → API Keys" }] },
  payu:      { fields: [{ name: "key",        hint: "Merchant Key from PayU Dashboard" },
                         { name: "salt",       hint: "Salt from PayU Dashboard" }] },
  pinelabs:  { fields: [{ name: "merchant_id",  hint: "MID from Pine Labs Plural Console → Settings → API Keys" },
                         { name: "access_code", hint: "Access Code from Pine Labs Plural Console → Settings → API Keys" },
                         { name: "working_key", hint: "Working Key from Pine Labs Plural Console → Settings → API Keys" }],
               note: "Pine Labs Plural PG credentials — all three required. Managed via Payment Gateways, not Merchant Connect." },
  // Pine Labs ONE — POS/QR merchant account. No API keys; partner access required.
  pinelabs_one: { fields: [
                   { name: "merchant_id", hint: "Merchant ID from Pine Labs ONE portal (one.pinelabs.com)" },
                   { name: "store_id",    hint: "Store ID from Pine Labs ONE portal → Stores section" },
                 ],
                 note: "⚠ Official Pine Labs ONE partner/enterprise API access required. No public API currently available. Contact Pine Labs at developer.pinelabs.com to apply for partner access before configuring this connector." },
  ekqr:      { fields: [{ name: "api_key",    hint: "API Key / Merchant ID from EKQR dashboard" }] },
  phonepe:   { fields: [{ name: "merchant_id", hint: "PhonePe Business MID" },
                         { name: "api_key",    hint: "PhonePe API Key" }] },
  paytm:     { fields: [{ name: "merchant_id", hint: "Paytm Merchant MID" },
                         { name: "merchant_key", hint: "Paytm Merchant Key" }] },
};

// ── API helpers ───────────────────────────────────────────────────────────────

function apiHeaders(): Record<string, string> {
  const token = getToken();
  return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

async function apiGet<T>(path: string): Promise<T> {
  const r = await fetch(path, { headers: apiHeaders() });
  if (!r.ok) { const e = await r.json().catch(() => ({ error: "Unknown error" })); throw new Error(e.error ?? "Request failed"); }
  return r.json();
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, { method: "POST", headers: apiHeaders(), body: JSON.stringify(body) });
  if (!r.ok) { const e = await r.json().catch(() => ({ error: "Unknown error" })); throw new Error(e.error ?? "Request failed"); }
  return r.json();
}

async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, { method: "PUT", headers: apiHeaders(), body: JSON.stringify(body) });
  if (!r.ok) { const e = await r.json().catch(() => ({ error: "Unknown error" })); throw new Error(e.error ?? "Request failed"); }
  return r.json();
}

async function apiDelete(path: string): Promise<void> {
  const r = await fetch(path, { method: "DELETE", headers: apiHeaders() });
  if (!r.ok) { const e = await r.json().catch(() => ({ error: "Unknown error" })); throw new Error(e.error ?? "Request failed"); }
}

async function fetchProviders(): Promise<Provider[]> {
  const r = await fetch("/api/connections/providers", { headers: apiHeaders() });
  if (!r.ok) throw new Error("Failed to load providers");
  return r.json();
}

async function fetchAllProviders(): Promise<Provider[]> {
  const r = await fetch("/api/platform-connections/providers", { headers: apiHeaders() });
  if (!r.ok) throw new Error("Failed to load providers");
  return r.json();
}

async function fetchMerchants(search: string): Promise<MerchantOption[]> {
  const r = await fetch(`/api/merchants?search=${encodeURIComponent(search)}&limit=20&environment=all`, { headers: apiHeaders() });
  if (!r.ok) return [];
  const json = await r.json();
  return (json.data ?? json ?? []).map((m: any) => ({ id: m.id, businessName: m.businessName ?? m.name, email: m.email }));
}

// ── Shared badge components ───────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    live:        { label: "Live",         variant: "default"     },
    sandbox:     { label: "Sandbox",      variant: "secondary"   },
    testing:     { label: "Testing",      variant: "outline"     },
    coming_soon: { label: "Coming Soon",  variant: "outline"     },
    disabled:    { label: "Disabled",     variant: "destructive" },
  };
  const { label, variant } = map[status] ?? { label: status, variant: "outline" };
  return <Badge variant={variant} className="text-xs">{label}</Badge>;
}

function ConnectionStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active:    "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    pending:   "bg-amber-500/20 text-amber-400 border-amber-500/30",
    suspended: "bg-orange-500/20 text-orange-400 border-orange-500/30",
    failed:    "bg-red-500/20 text-red-400 border-red-500/30",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${map[status] ?? "bg-zinc-800 text-zinc-400"}`}>
      {status}
    </span>
  );
}

function EnvBadge({ env }: { env: string }) {
  return env === "live"
    ? <Badge variant="default" className="text-xs bg-emerald-600 hover:bg-emerald-600">Live</Badge>
    : <Badge variant="secondary" className="text-xs">Sandbox</Badge>;
}

function TestResultBadge({ result }: { result: string | null }) {
  if (!result || result === "untested") return <span className="text-xs text-zinc-500">Untested</span>;
  if (result === "pass") return <span className="text-xs text-emerald-400 flex items-center gap-1"><CheckCircle className="w-3 h-3" /> Pass</span>;
  return <span className="text-xs text-red-400 flex items-center gap-1"><XCircle className="w-3 h-3" /> Fail</span>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 1 — RASOKART CONNECTIONS
// ═══════════════════════════════════════════════════════════════════════════════

function buildCredentialTemplate(slug: string): string {
  const hints = CREDENTIAL_HINTS[slug];
  if (!hints) return "";
  const obj: Record<string, string> = {};
  for (const f of hints.fields) obj[f.name] = "";
  return JSON.stringify(obj, null, 2);
}

interface ConnectDialogState {
  open: boolean;
  mode: "create" | "edit";
  conn: PlatformConn | null;  // null = new
  provider: Provider | null;
}

function RasoKartConnections() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [connections, setConnections] = useState<PlatformConn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Connect / edit dialog
  const [dialog, setDialog] = useState<ConnectDialogState>({ open: false, mode: "create", conn: null, provider: null });
  const [formProvider, setFormProvider] = useState("");
  const [formLabel, setFormLabel] = useState("");
  const [formEnv, setFormEnv] = useState<"sandbox" | "live">("sandbox");
  const [formCreds, setFormCreds] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Test state per connection id
  const [testingId, setTestingId] = useState<number | null>(null);
  const [testResults, setTestResults] = useState<Record<number, { pass: boolean; message: string; testedAt: string }>>({});

  // Disconnect confirm
  const [disconnectTarget, setDisconnectTarget] = useState<PlatformConn | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([fetchAllProviders(), apiGet<PlatformConn[]>("/api/platform-connections")])
      .then(([p, c]) => { setProviders(p); setConnections(c); setError(null); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const connByProvider = Object.fromEntries(connections.map((c) => [c.provider, c]));

  const filteredProviders = providers.filter((p) =>
    !searchQuery || p.name.toLowerCase().includes(searchQuery.toLowerCase()) || p.slug.includes(searchQuery.toLowerCase())
  );

  function openCreate(p: Provider) {
    setDialog({ open: true, mode: "create", conn: null, provider: p });
    setFormProvider(p.slug);
    setFormLabel("");
    setFormEnv("sandbox");
    setFormCreds(buildCredentialTemplate(p.slug));
    setFormNotes("");
    setFormError(null);
  }

  function openEdit(conn: PlatformConn, p: Provider | null) {
    setDialog({ open: true, mode: "edit", conn, provider: p ?? null });
    setFormProvider(conn.provider);
    setFormLabel(conn.label ?? "");
    setFormEnv(conn.environment === "live" ? "live" : "sandbox");
    setFormCreds(""); // write-only — never pre-fill
    setFormNotes(conn.notes ?? "");
    setFormError(null);
  }

  async function handleFormSubmit() {
    if (!formCreds.trim() && dialog.mode === "create") {
      setFormError("Credentials are required for a new connection");
      return;
    }
    if (formCreds.trim() && formCreds.trim() !== "***") {
      try { JSON.parse(formCreds); } catch {
        setFormError("Credentials must be valid JSON");
        return;
      }
    }
    setFormBusy(true);
    setFormError(null);
    try {
      if (dialog.mode === "create") {
        const created = await apiPost<PlatformConn>("/api/platform-connections", {
          provider: formProvider,
          label:       formLabel || null,
          environment: formEnv,
          credentials: formCreds.trim() || null,
          notes:       formNotes || null,
          connectionStatus: "pending",
          isActive: false,
        });
        setConnections((prev) => [...prev, created]);
        toast.success(`${dialog.provider?.name ?? formProvider} connected (pending verification)`);
      } else if (dialog.conn) {
        const updated = await apiPut<PlatformConn>(`/api/platform-connections/${dialog.conn.id}`, {
          label:       formLabel || null,
          environment: formEnv,
          credentials: formCreds.trim() || undefined,
          notes:       formNotes || null,
        });
        setConnections((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
        toast.success("Connection updated");
      }
      setDialog({ open: false, mode: "create", conn: null, provider: null });
    } catch (e: any) {
      setFormError(e.message ?? "Failed to save");
    } finally {
      setFormBusy(false);
    }
  }

  async function handleTest(conn: PlatformConn) {
    setTestingId(conn.id);
    try {
      const result = await apiPost<{ pass: boolean; message: string; detail?: string; testedAt: string; connectionStatus: string }>(
        `/api/platform-connections/${conn.id}/test`, {}
      );
      setTestResults((prev) => ({ ...prev, [conn.id]: { pass: result.pass, message: result.message, testedAt: result.testedAt } }));
      setConnections((prev) => prev.map((c) => c.id === conn.id ? { ...c, connectionStatus: result.connectionStatus, lastTestedAt: result.testedAt, lastTestResult: result.pass ? "pass" : "fail" } : c));
      if (result.pass) toast.success(`${conn.provider} credentials verified`);
      else toast.error(`Verification failed: ${result.message}`);
    } catch (e: any) {
      toast.error(e.message ?? "Test failed");
    } finally {
      setTestingId(null);
    }
  }

  async function handleToggleActive(conn: PlatformConn) {
    try {
      const path = conn.isActive ? `/api/platform-connections/${conn.id}/disable` : `/api/platform-connections/${conn.id}/enable`;
      const updated = await apiPost<PlatformConn>(path, {});
      setConnections((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      toast.success(conn.isActive ? `${conn.provider} disabled` : `${conn.provider} enabled`);
    } catch (e: any) {
      toast.error(e.message ?? "Toggle failed");
    }
  }

  async function handleDisconnect() {
    if (!disconnectTarget) return;
    try {
      await apiDelete(`/api/platform-connections/${disconnectTarget.id}`);
      setConnections((prev) => prev.filter((c) => c.id !== disconnectTarget.id));
      toast.success(`${disconnectTarget.provider} disconnected`);
    } catch (e: any) {
      toast.error(e.message ?? "Disconnect failed");
    } finally {
      setDisconnectTarget(null);
    }
  }

  function providerFor(slug: string): Provider | undefined {
    return providers.find((p) => p.slug === slug);
  }

  if (loading) return (
    <div className="flex items-center justify-center py-16 text-zinc-400 gap-2">
      <Loader2 className="w-5 h-5 animate-spin" /> Loading platform connections…
    </div>
  );

  if (error) return (
    <Alert variant="destructive" className="my-4">
      <AlertTriangle className="w-4 h-4" />
      <AlertDescription>{error} <Button variant="link" size="sm" onClick={load}>Retry</Button></AlertDescription>
    </Alert>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <Shield className="w-4 h-4 text-violet-400" />
            RasoKart Platform Connections
          </h2>
          <p className="text-sm text-zinc-400 mt-0.5">
            Provider accounts owned by RasoKart / Nickey Collection Private Limited. Credentials are write-only and never exposed.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={load} className="gap-1.5 shrink-0">
          <RefreshCw className="w-3 h-3" /> Refresh
        </Button>
      </div>

      {/* Active connections summary */}
      {connections.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Total",    value: connections.length,                                         color: "text-white"       },
            { label: "Active",   value: connections.filter((c) => c.isActive).length,               color: "text-emerald-400" },
            { label: "Verified", value: connections.filter((c) => c.lastTestResult === "pass").length, color: "text-blue-400" },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-zinc-800/50 border border-zinc-800 rounded-lg p-3 text-center">
              <div className={`text-2xl font-bold ${color}`}>{value}</div>
              <div className="text-xs text-zinc-500 mt-0.5">{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Provider grid */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-zinc-500" />
            <Input
              className="pl-8 h-8 bg-zinc-800 border-zinc-700 text-sm"
              placeholder="Filter providers…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-2">
          {filteredProviders.map((p) => {
            const conn = connByProvider[p.slug];
            const isTesting = testingId === (conn?.id ?? -1);
            const latestTest = conn ? (testResults[conn.id] ?? null) : null;

            return (
              <div key={p.id}
                className={`bg-zinc-900 border rounded-lg p-4 transition-colors
                  ${conn?.isActive ? "border-emerald-500/20" : conn ? "border-zinc-800" : "border-zinc-800/60"}`}
              >
                <div className="flex items-center gap-3">
                  {/* Provider info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-white">{p.name}</span>
                      <StatusBadge status={p.status} />
                      {conn && <EnvBadge env={conn.environment} />}
                      {conn && <ConnectionStatusBadge status={conn.connectionStatus} />}
                    </div>
                    <div className="text-xs text-zinc-500 mt-0.5">{p.slug} · {p.category}</div>
                    {conn?.label && <div className="text-xs text-zinc-400 mt-0.5 italic">{conn.label}</div>}
                  </div>

                  {/* Status indicators */}
                  {conn && (
                    <div className="hidden sm:flex items-center gap-4 text-xs">
                      <div className="text-center">
                        <div className="text-zinc-500 mb-0.5">Verified</div>
                        <TestResultBadge result={conn.lastTestResult} />
                      </div>
                      <div className="text-center">
                        <div className="text-zinc-500 mb-0.5">Last test</div>
                        <div className="text-zinc-400">
                          {conn.lastTestedAt ? new Date(conn.lastTestedAt).toLocaleDateString() : "—"}
                        </div>
                      </div>
                      <div className="text-center">
                        <div className="text-zinc-500 mb-0.5">Active</div>
                        <Switch
                          checked={conn.isActive}
                          onCheckedChange={() => handleToggleActive(conn)}
                          className="scale-75 origin-center"
                        />
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {p.slug === "pinelabs_one" && !conn ? (
                      /* Pine Labs ONE: no public API — partner access required */
                      <a
                        href="https://developer.pinelabs.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-amber-400/80 hover:text-amber-300 transition-colors"
                        title="Apply for Pine Labs ONE partner API access"
                      >
                        <AlertTriangle className="w-3 h-3" />
                        Partner API Required
                      </a>
                    ) : !conn ? (
                      <Button size="sm" variant="outline" onClick={() => openCreate(p)} className="gap-1 text-xs h-7">
                        <Plus className="w-3 h-3" /> Connect
                      </Button>
                    ) : (
                      <>
                        <Button
                          size="sm" variant="outline"
                          onClick={() => handleTest(conn)}
                          disabled={isTesting}
                          className="gap-1 text-xs h-7"
                          title="Verify credentials"
                        >
                          {isTesting ? <Loader2 className="w-3 h-3 animate-spin" /> : <TestTube2 className="w-3 h-3" />}
                          <span className="hidden sm:inline">Verify</span>
                        </Button>
                        <Button
                          size="sm" variant="ghost"
                          onClick={() => openEdit(conn, p)}
                          className="gap-1 text-xs h-7 text-zinc-400 hover:text-white"
                          title="Edit credentials / settings"
                        >
                          <Pencil className="w-3 h-3" />
                        </Button>
                        <Button
                          size="sm" variant="ghost"
                          onClick={() => setDisconnectTarget(conn)}
                          className="gap-1 text-xs h-7 text-red-500 hover:text-red-400"
                          title="Disconnect"
                        >
                          <Unplug className="w-3 h-3" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {/* Inline test result */}
                {latestTest && (
                  <div className={`mt-3 p-2.5 rounded-md text-xs flex items-start gap-2
                    ${latestTest.pass ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-300" : "bg-red-500/10 border border-red-500/20 text-red-300"}`}>
                    {latestTest.pass ? <CheckCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> : <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
                    <span>{latestTest.message} <span className="text-zinc-500 ml-1">{new Date(latestTest.testedAt).toLocaleTimeString()}</span></span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Connect / Edit dialog */}
      <Dialog open={dialog.open} onOpenChange={(o) => !o && setDialog((d) => ({ ...d, open: false }))}>
        <DialogContent className="bg-zinc-900 border-zinc-800 max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              {dialog.mode === "create"
                ? <><Plug className="w-4 h-4 text-violet-400" /> Connect {dialog.provider?.name}</>
                : <><Pencil className="w-4 h-4 text-violet-400" /> Edit {dialog.provider?.name ?? dialog.conn?.provider}</>
              }
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Environment */}
            <div>
              <Label className="text-zinc-300 text-sm mb-1.5 block">Environment</Label>
              <Select value={formEnv} onValueChange={(v) => setFormEnv(v as "sandbox" | "live")}>
                <SelectTrigger className="bg-zinc-800 border-zinc-700">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-800">
                  <SelectItem value="sandbox">Sandbox / Test</SelectItem>
                  <SelectItem value="live">Live / Production</SelectItem>
                </SelectContent>
              </Select>
              {formEnv === "live" && (
                <p className="text-xs text-amber-400 mt-1.5 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> Live credentials will process real transactions.
                </p>
              )}
            </div>

            {/* Label */}
            <div>
              <Label className="text-zinc-300 text-sm mb-1.5 block">Label <span className="text-zinc-500 font-normal">(optional)</span></Label>
              <Input
                className="bg-zinc-800 border-zinc-700"
                placeholder="e.g. RasoKart Main Cashfree Payin"
                value={formLabel}
                onChange={(e) => setFormLabel(e.target.value)}
              />
            </div>

            {/* Credentials */}
            <div>
              <Label className="text-zinc-300 text-sm mb-1.5 block">
                Credentials <span className="text-zinc-500 font-normal">(JSON — AES-256-GCM encrypted)</span>
              </Label>
              {dialog.mode === "edit" && (
                <p className="text-xs text-zinc-500 mb-1.5 flex items-center gap-1">
                  <Lock className="w-3 h-3" /> Credentials are write-only. Leave blank to keep existing.
                </p>
              )}
              {CREDENTIAL_HINTS[formProvider] && (
                <div className="mb-2 p-2.5 bg-zinc-800/60 rounded-md text-xs space-y-1">
                  <div className="text-zinc-400 font-medium mb-1">Required fields:</div>
                  {CREDENTIAL_HINTS[formProvider].fields.map((f) => (
                    <div key={f.name} className="flex gap-2">
                      <span className="text-zinc-300 font-mono shrink-0">{f.name}</span>
                      <span className="text-zinc-500">{f.hint}</span>
                    </div>
                  ))}
                  {CREDENTIAL_HINTS[formProvider].note && (
                    <div className="text-amber-400 mt-1.5">{CREDENTIAL_HINTS[formProvider].note}</div>
                  )}
                </div>
              )}
              <Textarea
                className="bg-zinc-800 border-zinc-700 font-mono text-xs h-28"
                placeholder={`{"api_key": "...", "api_secret": "..."}`}
                value={formCreds}
                onChange={(e) => setFormCreds(e.target.value)}
              />
            </div>

            {/* Notes */}
            <div>
              <Label className="text-zinc-300 text-sm mb-1.5 block">Notes <span className="text-zinc-500 font-normal">(internal)</span></Label>
              <Input
                className="bg-zinc-800 border-zinc-700"
                placeholder="e.g. Approved 2026-08-15 · Contact: ops@rasokart.com"
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
              />
            </div>

            {formError && (
              <Alert variant="destructive">
                <AlertTriangle className="w-4 h-4" />
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog((d) => ({ ...d, open: false }))}>Cancel</Button>
            <Button onClick={handleFormSubmit} disabled={formBusy} className="bg-violet-600 hover:bg-violet-700">
              {formBusy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {dialog.mode === "create" ? "Connect" : "Update"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Disconnect confirm */}
      <AlertDialog open={!!disconnectTarget} onOpenChange={(o) => !o && setDisconnectTarget(null)}>
        <AlertDialogContent className="bg-zinc-900 border-zinc-800">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Disconnect {disconnectTarget?.provider}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the platform connection for <strong>{disconnectTarget?.provider}</strong>.
              Encrypted credentials will be deleted. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDisconnect} className="bg-red-600 hover:bg-red-700">Disconnect</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 2 — MERCHANT CONNECTIONS (original 6-step wizard, unchanged logic)
// ═══════════════════════════════════════════════════════════════════════════════

function MerchantConnectionsWizard() {
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [merchantSearch, setMerchantSearch] = useState("");
  const [merchants, setMerchants] = useState<MerchantOption[]>([]);
  const [merchantsLoading, setMerchantsLoading] = useState(false);
  const [selectedMerchant, setSelectedMerchant] = useState<MerchantOption | null>(null);

  const [providers, setProviders] = useState<Provider[]>([]);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null);

  const [ownership, setOwnership] = useState<"rasokart_owned" | "merchant_owned">("rasokart_owned");
  const [credentials, setCredentials] = useState("");
  const [notes, setNotes] = useState("");
  const [monthlyLimit, setMonthlyLimit] = useState("0");
  const [savedConnection, setSavedConnection] = useState<ConnectionResult | null>(null);

  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testLoading, setTestLoading] = useState(false);

  const [capabilities, setCapabilities] = useState<CapabilityState>({ ...DEFAULT_CAPABILITIES });
  const [activationDone, setActivationDone] = useState(false);

  useEffect(() => {
    if (step !== 1) return;
    setMerchantsLoading(true);
    fetchMerchants(merchantSearch).then(setMerchants).catch(() => {}).finally(() => setMerchantsLoading(false));
  }, [merchantSearch, step]);

  useEffect(() => {
    if (step !== 2) return;
    setProvidersLoading(true);
    fetchProviders().then(setProviders).catch(() => {}).finally(() => setProvidersLoading(false));
  }, [step]);

  function resetWizard() {
    setStep(1); setError(null); setSelectedMerchant(null); setSelectedProvider(null);
    setOwnership("rasokart_owned"); setCredentials(""); setNotes(""); setMonthlyLimit("0");
    setSavedConnection(null); setTestResult(null); setCapabilities({ ...DEFAULT_CAPABILITIES });
    setActivationDone(false); setMerchantSearch("");
  }

  async function handleSaveCredentials() {
    if (!selectedMerchant || !selectedProvider) return;
    setBusy(true); setError(null);
    try {
      const result = await apiPost<ConnectionResult>("/api/connections", {
        merchantId: selectedMerchant.id,
        provider: selectedProvider.slug,
        credentials: credentials.trim() || null,
        ownership, notes: notes.trim() || null,
        monthlyLimit: parseFloat(monthlyLimit) || 0,
        isActive: false, connectionStatus: "pending",
      });
      setSavedConnection(result); setStep(4);
    } catch (e: any) { setError(e.message ?? "Failed to save credentials"); }
    finally { setBusy(false); }
  }

  async function handleTest() {
    if (!savedConnection) return;
    setTestLoading(true); setTestResult(null); setError(null);
    try {
      const result = await apiPost<TestResult>(`/api/connections/${savedConnection.id}/test`, {});
      setTestResult(result);
      setSavedConnection((prev) => prev ? { ...prev, connectionStatus: result.connectionStatus } : prev);
    } catch (e: any) { setError(e.message ?? "Test failed"); }
    finally { setTestLoading(false); }
  }

  async function handleSaveCapabilities() {
    if (!savedConnection) return;
    setBusy(true); setError(null);
    try {
      const updated = await apiPut<ConnectionResult>(`/api/connections/${savedConnection.id}`, {
        capabilityPayin: capabilities.payin, capabilityPayout: capabilities.payout,
        capabilityUpi: capabilities.upi, capabilityQr: capabilities.qr,
        capabilityPaymentLinks: capabilities.paymentLinks, capabilityRefunds: capabilities.refunds,
        capabilitySettlement: capabilities.settlement,
      });
      setSavedConnection(updated); setStep(6);
    } catch (e: any) { setError(e.message ?? "Failed to save capabilities"); }
    finally { setBusy(false); }
  }

  async function handleActivate() {
    if (!savedConnection) return;
    setBusy(true); setError(null);
    try {
      await apiPut(`/api/connections/${savedConnection.id}`, { isActive: true, connectionStatus: "active" });
      setActivationDone(true);
    } catch (e: any) { setError(e.message ?? "Activation failed"); }
    finally { setBusy(false); }
  }

  function StepIndicator() {
    return (
      <div className="flex items-center gap-1 mb-6">
        {STEPS.map((s, i) => {
          const done = step > s.id; const active = step === s.id; const Icon = s.icon;
          return (
            <div key={s.id} className="flex items-center gap-1">
              <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-all
                ${active ? "bg-violet-600 text-white" : done ? "bg-emerald-500/20 text-emerald-400" : "bg-zinc-800 text-zinc-500"}`}>
                {done ? <CheckCircle className="w-3 h-3" /> : <Icon className="w-3 h-3" />}
                <span className="hidden sm:inline">{s.label}</span>
              </div>
              {i < STEPS.length - 1 && <ChevronRight className="w-3 h-3 text-zinc-600" />}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <Building2 className="w-4 h-4 text-violet-400" /> Assign Provider to Merchant
          </h2>
          <p className="text-sm text-zinc-400 mt-0.5">6-step wizard to connect a payment provider to a tenant merchant account</p>
        </div>
        {step > 1 && !activationDone && (
          <Button variant="outline" size="sm" onClick={resetWizard} className="gap-1.5">
            <RotateCcw className="w-3 h-3" /> Start over
          </Button>
        )}
      </div>

      <StepIndicator />

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertTriangle className="w-4 h-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Step 1 */}
      {step === 1 && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader>
            <CardTitle className="text-base text-white flex items-center gap-2">
              <Building2 className="w-4 h-4 text-violet-400" /> Step 1 — Select Merchant
            </CardTitle>
            <CardDescription>Search for the merchant you want to connect a provider to</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-zinc-500" />
              <Input className="pl-9 bg-zinc-800 border-zinc-700" placeholder="Search by business name or email…"
                value={merchantSearch} onChange={(e) => setMerchantSearch(e.target.value)} />
            </div>
            <ScrollArea className="h-64 rounded-md border border-zinc-800">
              {merchantsLoading
                ? <div className="p-4 text-sm text-zinc-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
                : merchants.length === 0
                  ? <div className="p-4 text-sm text-zinc-500">No merchants found</div>
                  : merchants.map((m) => (
                    <button key={m.id} onClick={() => { setSelectedMerchant(m); setStep(2); }}
                      className={`w-full text-left px-4 py-3 hover:bg-zinc-800 transition-colors border-b border-zinc-800 last:border-0
                        ${selectedMerchant?.id === m.id ? "bg-violet-600/10 border-l-2 border-l-violet-500" : ""}`}>
                      <div className="text-sm font-medium text-white">{m.businessName || "—"}</div>
                      <div className="text-xs text-zinc-400">{m.email} · ID {m.id}</div>
                    </button>
                  ))
              }
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Step 2 */}
      {step === 2 && selectedMerchant && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader>
            <CardTitle className="text-base text-white flex items-center gap-2">
              <Zap className="w-4 h-4 text-violet-400" /> Step 2 — Select Provider
            </CardTitle>
            <CardDescription>Connecting to: <span className="text-white font-medium">{selectedMerchant.businessName}</span></CardDescription>
          </CardHeader>
          <CardContent>
            {providersLoading
              ? <div className="py-8 text-sm text-zinc-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
              : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {providers.map((p) => (
                    <button key={p.id} onClick={() => { setSelectedProvider(p); setStep(3); }}
                      className={`text-left p-3 rounded-lg border transition-all hover:border-violet-500
                        ${selectedProvider?.id === p.id ? "border-violet-500 bg-violet-600/10" : "border-zinc-800 bg-zinc-800/50"}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-sm font-medium text-white">{p.name}</div>
                        <StatusBadge status={p.status} />
                      </div>
                      <div className="text-xs text-zinc-500 mt-1">{p.category} · {p.slug}</div>
                    </button>
                  ))}
                  {providers.length === 0 && <div className="col-span-2 py-6 text-sm text-zinc-500">No providers available</div>}
                </div>
              )
            }
            <div className="mt-4">
              <Button variant="outline" size="sm" onClick={() => setStep(1)}><ChevronLeft className="w-3 h-3 mr-1" /> Back</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3 */}
      {step === 3 && selectedMerchant && selectedProvider && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader>
            <CardTitle className="text-base text-white flex items-center gap-2">
              <Lock className="w-4 h-4 text-violet-400" /> Step 3 — Configure Credentials
            </CardTitle>
            <CardDescription>{selectedProvider.name} → {selectedMerchant.businessName}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <Label className="text-zinc-300 text-sm mb-2 block">Ownership mode</Label>
              <div className="grid grid-cols-2 gap-3">
                {(["rasokart_owned", "merchant_owned"] as const).map((mode) => (
                  <button key={mode} onClick={() => setOwnership(mode)}
                    className={`p-3 rounded-lg border text-left transition-all
                      ${ownership === mode ? "border-violet-500 bg-violet-600/10" : "border-zinc-800 bg-zinc-800/50 hover:border-zinc-700"}`}>
                    {mode === "rasokart_owned"
                      ? <><div className="text-sm font-medium text-white flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5 text-violet-400" /> RasoKart-owned</div><div className="text-xs text-zinc-400 mt-1">Our platform account assigned to this merchant</div></>
                      : <><div className="text-sm font-medium text-white flex items-center gap-1.5"><Unlock className="w-3.5 h-3.5 text-amber-400" /> Merchant-owned</div><div className="text-xs text-zinc-400 mt-1">Merchant's own approved provider credentials</div></>
                    }
                  </button>
                ))}
              </div>
            </div>
            <Separator className="border-zinc-800" />
            <div>
              <Label className="text-zinc-300 text-sm mb-2 block">Credentials <span className="text-zinc-500 font-normal">(JSON — encrypted at rest)</span></Label>
              <Textarea className="bg-zinc-800 border-zinc-700 font-mono text-xs h-28"
                placeholder={`{"api_key": "...", "api_secret": "..."}`}
                value={credentials} onChange={(e) => setCredentials(e.target.value)} />
            </div>
            <div>
              <Label className="text-zinc-300 text-sm mb-2 block">Monthly limit (₹)</Label>
              <Input type="number" min={0} className="bg-zinc-800 border-zinc-700 w-40"
                value={monthlyLimit} onChange={(e) => setMonthlyLimit(e.target.value)} />
            </div>
            <div>
              <Label className="text-zinc-300 text-sm mb-2 block">Notes</Label>
              <Input className="bg-zinc-800 border-zinc-700" placeholder="e.g. Approved by KYC team"
                value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div className="flex gap-3 pt-2">
              <Button variant="outline" size="sm" onClick={() => setStep(2)}><ChevronLeft className="w-3 h-3 mr-1" /> Back</Button>
              <Button onClick={handleSaveCredentials} disabled={busy} className="bg-violet-600 hover:bg-violet-700">
                {busy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Save & Continue <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 4 */}
      {step === 4 && savedConnection && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader>
            <CardTitle className="text-base text-white flex items-center gap-2">
              <TestTube2 className="w-4 h-4 text-violet-400" /> Step 4 — Test Connection
            </CardTitle>
            <CardDescription>Verify credentials without any financial transaction</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="p-3 rounded-lg bg-zinc-800 border border-zinc-700 text-sm space-y-1">
              <div className="flex items-center justify-between"><span className="text-zinc-400">Provider</span><span className="text-white font-medium">{savedConnection.provider}</span></div>
              <div className="flex items-center justify-between"><span className="text-zinc-400">Status</span><ConnectionStatusBadge status={savedConnection.connectionStatus} /></div>
              <div className="flex items-center justify-between"><span className="text-zinc-400">Credentials</span><span className="text-zinc-300 font-mono text-xs">●●●●●●●●</span></div>
            </div>
            {testResult && (
              <div className={`p-4 rounded-lg border ${testResult.pass ? "bg-emerald-500/10 border-emerald-500/30" : "bg-red-500/10 border-red-500/30"}`}>
                <div className="flex items-center gap-2 mb-1">
                  {testResult.pass ? <CheckCircle className="w-4 h-4 text-emerald-400" /> : <XCircle className="w-4 h-4 text-red-400" />}
                  <span className={`text-sm font-medium ${testResult.pass ? "text-emerald-300" : "text-red-300"}`}>{testResult.pass ? "Test passed" : "Test failed"}</span>
                </div>
                <p className="text-sm text-zinc-300">{testResult.message}</p>
                {testResult.detail && <p className="text-xs text-zinc-500 mt-1">{testResult.detail}</p>}
              </div>
            )}
            <div className="flex gap-3">
              <Button onClick={handleTest} disabled={testLoading} variant={testResult?.pass ? "outline" : "default"} className={testResult?.pass ? "" : "bg-violet-600 hover:bg-violet-700"}>
                {testLoading ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Testing…</> : testResult ? "Re-test" : "Run Test"}
              </Button>
              <Button onClick={() => setStep(5)} disabled={!testResult} variant="outline" className={testResult?.pass ? "border-emerald-500 text-emerald-400" : ""}>
                {testResult?.pass ? "Continue" : "Skip"} <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 5 */}
      {step === 5 && savedConnection && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader>
            <CardTitle className="text-base text-white flex items-center gap-2">
              <Settings2 className="w-4 h-4 text-violet-400" /> Step 5 — Enable Capabilities
            </CardTitle>
            <CardDescription>These are enforced server-side.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {(Object.entries(CAPABILITY_LABELS) as [keyof CapabilityState, string][]).map(([key, label]) => (
              <div key={key} className="flex items-center justify-between py-2 border-b border-zinc-800 last:border-0">
                <div>
                  <div className="text-sm text-white">{label}</div>
                  <div className="text-xs text-zinc-500">capability_{key === "paymentLinks" ? "payment_links" : key}</div>
                </div>
                <Switch checked={capabilities[key]} onCheckedChange={(v) => setCapabilities((prev) => ({ ...prev, [key]: v }))} />
              </div>
            ))}
            <div className="flex gap-3 pt-4">
              <Button variant="outline" size="sm" onClick={() => setStep(4)}><ChevronLeft className="w-3 h-3 mr-1" /> Back</Button>
              <Button onClick={handleSaveCapabilities} disabled={busy} className="bg-violet-600 hover:bg-violet-700">
                {busy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Save Capabilities <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 6 */}
      {step === 6 && savedConnection && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader>
            <CardTitle className="text-base text-white flex items-center gap-2">
              <Power className="w-4 h-4 text-violet-400" /> Step 6 — Activate Connection
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {activationDone
              ? (
                <div className="p-6 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-center space-y-3">
                  <CheckCircle className="w-10 h-10 text-emerald-400 mx-auto" />
                  <div className="text-lg font-semibold text-white">Connection activated!</div>
                  <p className="text-sm text-zinc-400">
                    <span className="text-white font-medium">{selectedMerchant?.businessName}</span> can now use{" "}
                    <span className="text-white font-medium">{selectedProvider?.name}</span>.
                  </p>
                  <Button onClick={resetWizard} className="mt-4 bg-violet-600 hover:bg-violet-700">Connect another provider</Button>
                </div>
              )
              : (
                <>
                  <div className="space-y-2 text-sm">
                    {[
                      ["Merchant",     selectedMerchant?.businessName ?? "—"],
                      ["Provider",     selectedProvider?.name ?? "—"],
                      ["Ownership",    ownership === "rasokart_owned" ? "RasoKart-owned" : "Merchant-owned"],
                      ["Monthly limit", monthlyLimit === "0" ? "Unlimited" : `₹${Number(monthlyLimit).toLocaleString()}`],
                      ["Test result",  testResult?.pass ? "✅ Passed" : testResult ? "⚠️ Failed" : "Not tested"],
                    ].map(([label, value]) => (
                      <div key={label} className="flex items-start justify-between gap-4 py-1.5 border-b border-zinc-800">
                        <span className="text-zinc-400 shrink-0">{label}</span>
                        <span className="text-white text-right">{value}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-3 pt-2">
                    <Button variant="outline" size="sm" onClick={() => setStep(5)}><ChevronLeft className="w-3 h-3 mr-1" /> Back</Button>
                    <Button onClick={handleActivate} disabled={busy} className="bg-emerald-600 hover:bg-emerald-700">
                      {busy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Power className="w-4 h-4 mr-2" />}
                      Activate Connection
                    </Button>
                  </div>
                </>
              )
            }
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROOT COMPONENT — Two-tab hub
// ═══════════════════════════════════════════════════════════════════════════════

export default function AdminMerchantConnect() {
  const [activeTab, setActiveTab] = useState<"rasokart" | "merchant">("rasokart");

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-white">Merchant Connect</h1>
        <p className="text-sm text-zinc-400 mt-0.5">
          Platform provider accounts and tenant merchant connection management
        </p>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 p-1 bg-zinc-800/50 rounded-lg w-fit mb-6">
        {([
          { id: "rasokart", label: "RasoKart Connections", icon: Shield },
          { id: "merchant", label: "Merchant Connections", icon: Building2 },
        ] as const).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all
              ${activeTab === id
                ? "bg-zinc-700 text-white shadow-sm"
                : "text-zinc-400 hover:text-zinc-300"
              }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "rasokart"
        ? <RasoKartConnections />
        : <MerchantConnectionsWizard />
      }
    </div>
  );
}
