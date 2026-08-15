/**
 * Merchant Connect — Super Admin Wizard  (Task #MC-1)
 *
 * Step 1: Select Merchant
 * Step 2: Select Provider
 * Step 3: Ownership Mode + Configure Credentials
 * Step 4: Test Connection
 * Step 5: Enable Capabilities
 * Step 6: Activate
 *
 * Reuses /api/connections (existing route — now with encryption + audit logs).
 * Never shows plaintext credentials in the UI after save.
 */

import { useState, useEffect } from "react";
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
  CheckCircle, XCircle, Loader2, ChevronRight, ChevronLeft, RotateCcw,
  ShieldCheck, Zap, Building2, TestTube2, Settings2, Power, Search,
  Lock, Unlock, CreditCard, ArrowRight, AlertTriangle,
} from "lucide-react";
// ── Types ─────────────────────────────────────────────────────────────────────

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

// ── API helpers ───────────────────────────────────────────────────────────────

function apiHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
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

async function fetchProviders(): Promise<Provider[]> {
  const r = await fetch("/api/connections/providers", { headers: apiHeaders() });
  if (!r.ok) throw new Error("Failed to load providers");
  return r.json();
}

async function fetchMerchants(search: string): Promise<MerchantOption[]> {
  const r = await fetch(`/api/merchants?search=${encodeURIComponent(search)}&limit=20&environment=all`, { headers: apiHeaders() });
  if (!r.ok) return [];
  const json = await r.json();
  return (json.data ?? json ?? []).map((m: any) => ({ id: m.id, businessName: m.businessName ?? m.name, email: m.email }));
}

// ── Step components ───────────────────────────────────────────────────────────

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

// ── Main wizard ───────────────────────────────────────────────────────────────

export default function AdminMerchantConnect() {
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1 — merchant
  const [merchantSearch, setMerchantSearch] = useState("");
  const [merchants, setMerchants] = useState<MerchantOption[]>([]);
  const [merchantsLoading, setMerchantsLoading] = useState(false);
  const [selectedMerchant, setSelectedMerchant] = useState<MerchantOption | null>(null);

  // Step 2 — provider
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null);

  // Step 3 — credentials
  const [ownership, setOwnership] = useState<"rasokart_owned" | "merchant_owned">("rasokart_owned");
  const [credentials, setCredentials] = useState("");
  const [notes, setNotes] = useState("");
  const [monthlyLimit, setMonthlyLimit] = useState("0");
  const [savedConnection, setSavedConnection] = useState<ConnectionResult | null>(null);

  // Step 4 — test
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testLoading, setTestLoading] = useState(false);

  // Step 5 — capabilities
  const [capabilities, setCapabilities] = useState<CapabilityState>({ ...DEFAULT_CAPABILITIES });

  // Step 6 — activation
  const [activationDone, setActivationDone] = useState(false);

  // Load merchants on search
  useEffect(() => {
    if (step !== 1) return;
    setMerchantsLoading(true);
    fetchMerchants(merchantSearch).then(setMerchants).catch(() => {}).finally(() => setMerchantsLoading(false));
  }, [merchantSearch, step]);

  // Load providers on step 2
  useEffect(() => {
    if (step !== 2) return;
    setProvidersLoading(true);
    fetchProviders().then(setProviders).catch(() => {}).finally(() => setProvidersLoading(false));
  }, [step]);

  function resetWizard() {
    setStep(1);
    setError(null);
    setSelectedMerchant(null);
    setSelectedProvider(null);
    setOwnership("rasokart_owned");
    setCredentials("");
    setNotes("");
    setMonthlyLimit("0");
    setSavedConnection(null);
    setTestResult(null);
    setCapabilities({ ...DEFAULT_CAPABILITIES });
    setActivationDone(false);
    setMerchantSearch("");
  }

  // ── Step 3: save credentials ──────────────────────────────────────────────

  async function handleSaveCredentials() {
    if (!selectedMerchant || !selectedProvider) return;
    setBusy(true);
    setError(null);
    try {
      const result = await apiPost<ConnectionResult>("/api/connections", {
        merchantId: selectedMerchant.id,
        provider: selectedProvider.slug,
        credentials: credentials.trim() || null,
        ownership,
        notes: notes.trim() || null,
        monthlyLimit: parseFloat(monthlyLimit) || 0,
        isActive: false,
        connectionStatus: "pending",
      });
      setSavedConnection(result);
      setStep(4);
    } catch (e: any) {
      setError(e.message ?? "Failed to save credentials");
    } finally {
      setBusy(false);
    }
  }

  // ── Step 4: test connection ───────────────────────────────────────────────

  async function handleTest() {
    if (!savedConnection) return;
    setTestLoading(true);
    setTestResult(null);
    setError(null);
    try {
      const result = await apiPost<TestResult>(`/api/connections/${savedConnection.id}/test`, {});
      setTestResult(result);
      setSavedConnection((prev) => prev ? { ...prev, connectionStatus: result.connectionStatus } : prev);
    } catch (e: any) {
      setError(e.message ?? "Test failed");
    } finally {
      setTestLoading(false);
    }
  }

  // ── Step 5: save capabilities ─────────────────────────────────────────────

  async function handleSaveCapabilities() {
    if (!savedConnection) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await apiPut<ConnectionResult>(`/api/connections/${savedConnection.id}`, {
        capabilityPayin: capabilities.payin,
        capabilityPayout: capabilities.payout,
        capabilityUpi: capabilities.upi,
        capabilityQr: capabilities.qr,
        capabilityPaymentLinks: capabilities.paymentLinks,
        capabilityRefunds: capabilities.refunds,
        capabilitySettlement: capabilities.settlement,
      });
      setSavedConnection(updated);
      setStep(6);
    } catch (e: any) {
      setError(e.message ?? "Failed to save capabilities");
    } finally {
      setBusy(false);
    }
  }

  // ── Step 6: activate ─────────────────────────────────────────────────────

  async function handleActivate() {
    if (!savedConnection) return;
    setBusy(true);
    setError(null);
    try {
      await apiPut(`/api/connections/${savedConnection.id}`, {
        isActive: true,
        connectionStatus: "active",
      });
      setActivationDone(true);
    } catch (e: any) {
      setError(e.message ?? "Activation failed");
    } finally {
      setBusy(false);
    }
  }

  // ── Progress bar ──────────────────────────────────────────────────────────

  function StepIndicator() {
    return (
      <div className="flex items-center gap-1 mb-6">
        {STEPS.map((s, i) => {
          const done = step > s.id;
          const active = step === s.id;
          const Icon = s.icon;
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

  // ── Render steps ──────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-white">Merchant Connect</h1>
            <p className="text-sm text-zinc-400 mt-0.5">Assign a payment provider to a merchant</p>
          </div>
          {step > 1 && !activationDone && (
            <Button variant="outline" size="sm" onClick={resetWizard} className="gap-1.5">
              <RotateCcw className="w-3 h-3" /> Start over
            </Button>
          )}
        </div>
      </div>

      <StepIndicator />

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertTriangle className="w-4 h-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* ── STEP 1: Select Merchant ─────────────────────────────────────── */}
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
              <Input
                className="pl-9 bg-zinc-800 border-zinc-700"
                placeholder="Search by business name or email…"
                value={merchantSearch}
                onChange={(e) => setMerchantSearch(e.target.value)}
              />
            </div>
            <ScrollArea className="h-64 rounded-md border border-zinc-800">
              {merchantsLoading
                ? <div className="p-4 text-sm text-zinc-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
                : merchants.length === 0
                  ? <div className="p-4 text-sm text-zinc-500">No merchants found</div>
                  : merchants.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => { setSelectedMerchant(m); setStep(2); }}
                      className={`w-full text-left px-4 py-3 hover:bg-zinc-800 transition-colors border-b border-zinc-800 last:border-0
                        ${selectedMerchant?.id === m.id ? "bg-violet-600/10 border-l-2 border-l-violet-500" : ""}`}
                    >
                      <div className="text-sm font-medium text-white">{m.businessName || "—"}</div>
                      <div className="text-xs text-zinc-400">{m.email} · ID {m.id}</div>
                    </button>
                  ))
              }
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* ── STEP 2: Select Provider ─────────────────────────────────────── */}
      {step === 2 && selectedMerchant && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader>
            <CardTitle className="text-base text-white flex items-center gap-2">
              <Zap className="w-4 h-4 text-violet-400" /> Step 2 — Select Provider
            </CardTitle>
            <CardDescription>
              Connecting to: <span className="text-white font-medium">{selectedMerchant.businessName}</span>
            </CardDescription>
          </CardHeader>
          <CardContent>
            {providersLoading
              ? <div className="py-8 text-sm text-zinc-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading providers…</div>
              : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {providers.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => { setSelectedProvider(p); setStep(3); }}
                      className={`text-left p-3 rounded-lg border transition-all hover:border-violet-500
                        ${selectedProvider?.id === p.id ? "border-violet-500 bg-violet-600/10" : "border-zinc-800 bg-zinc-800/50"}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-sm font-medium text-white">{p.name}</div>
                        <StatusBadge status={p.status} />
                      </div>
                      <div className="text-xs text-zinc-500 mt-1">{p.category} · {p.slug}</div>
                      {p.description && <div className="text-xs text-zinc-400 mt-1 line-clamp-2">{p.description}</div>}
                    </button>
                  ))}
                  {providers.length === 0 && <div className="col-span-2 py-6 text-sm text-zinc-500">No providers available</div>}
                </div>
              )
            }
            <div className="mt-4">
              <Button variant="outline" size="sm" onClick={() => setStep(1)}>
                <ChevronLeft className="w-3 h-3 mr-1" /> Back
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── STEP 3: Ownership + Credentials ─────────────────────────────── */}
      {step === 3 && selectedMerchant && selectedProvider && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader>
            <CardTitle className="text-base text-white flex items-center gap-2">
              <Lock className="w-4 h-4 text-violet-400" /> Step 3 — Configure Credentials
            </CardTitle>
            <CardDescription>
              {selectedProvider.name} → {selectedMerchant.businessName}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Ownership mode */}
            <div>
              <Label className="text-zinc-300 text-sm mb-2 block">Ownership mode</Label>
              <div className="grid grid-cols-2 gap-3">
                {(["rasokart_owned", "merchant_owned"] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setOwnership(mode)}
                    className={`p-3 rounded-lg border text-left transition-all
                      ${ownership === mode ? "border-violet-500 bg-violet-600/10" : "border-zinc-800 bg-zinc-800/50 hover:border-zinc-700"}`}
                  >
                    {mode === "rasokart_owned"
                      ? <><div className="text-sm font-medium text-white flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5 text-violet-400" /> RasoKart-owned</div><div className="text-xs text-zinc-400 mt-1">Our platform account assigned to this merchant</div></>
                      : <><div className="text-sm font-medium text-white flex items-center gap-1.5"><Unlock className="w-3.5 h-3.5 text-amber-400" /> Merchant-owned</div><div className="text-xs text-zinc-400 mt-1">Merchant's own approved provider credentials</div></>
                    }
                  </button>
                ))}
              </div>
              {ownership === "rasokart_owned" && (
                <p className="text-xs text-zinc-500 mt-2">RasoKart-owned credentials are never exposed to the merchant.</p>
              )}
            </div>

            <Separator className="border-zinc-800" />

            {/* Credentials */}
            <div>
              <Label className="text-zinc-300 text-sm mb-2 block">
                Credentials <span className="text-zinc-500 font-normal">(JSON — encrypted at rest)</span>
              </Label>
              <Textarea
                className="bg-zinc-800 border-zinc-700 font-mono text-xs h-28"
                placeholder={`{"api_key": "...", "api_secret": "..."}`}
                value={credentials}
                onChange={(e) => setCredentials(e.target.value)}
              />
              <p className="text-xs text-zinc-500 mt-1">
                Credentials are AES-256-GCM encrypted before storage. They are never returned in plaintext by any API.
              </p>
            </div>

            {/* Monthly limit */}
            <div>
              <Label className="text-zinc-300 text-sm mb-2 block">Monthly limit (₹)</Label>
              <Input
                type="number"
                min={0}
                className="bg-zinc-800 border-zinc-700 w-40"
                value={monthlyLimit}
                onChange={(e) => setMonthlyLimit(e.target.value)}
              />
              <p className="text-xs text-zinc-500 mt-1">Set to 0 for no limit.</p>
            </div>

            {/* Notes */}
            <div>
              <Label className="text-zinc-300 text-sm mb-2 block">Notes <span className="text-zinc-500 font-normal">(internal, optional)</span></Label>
              <Input
                className="bg-zinc-800 border-zinc-700"
                placeholder="e.g. Approved by KYC team 2026-08-15"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            <div className="flex gap-3 pt-2">
              <Button variant="outline" size="sm" onClick={() => setStep(2)}>
                <ChevronLeft className="w-3 h-3 mr-1" /> Back
              </Button>
              <Button onClick={handleSaveCredentials} disabled={busy} className="bg-violet-600 hover:bg-violet-700">
                {busy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Save & Continue <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── STEP 4: Test Connection ─────────────────────────────────────── */}
      {step === 4 && savedConnection && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader>
            <CardTitle className="text-base text-white flex items-center gap-2">
              <TestTube2 className="w-4 h-4 text-violet-400" /> Step 4 — Test Connection
            </CardTitle>
            <CardDescription>
              Verify credentials without making any financial transaction
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Connection summary */}
            <div className="p-3 rounded-lg bg-zinc-800 border border-zinc-700 text-sm space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-zinc-400">Provider</span>
                <span className="text-white font-medium">{savedConnection.provider}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-400">Status</span>
                <ConnectionStatusBadge status={savedConnection.connectionStatus} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-400">Credentials</span>
                <span className="text-zinc-300 font-mono text-xs">●●●●●●●●</span>
              </div>
            </div>

            {/* Test result */}
            {testResult && (
              <div className={`p-4 rounded-lg border ${testResult.pass
                ? "bg-emerald-500/10 border-emerald-500/30"
                : "bg-red-500/10 border-red-500/30"}`}>
                <div className="flex items-center gap-2 mb-1">
                  {testResult.pass
                    ? <CheckCircle className="w-4 h-4 text-emerald-400" />
                    : <XCircle className="w-4 h-4 text-red-400" />}
                  <span className={`text-sm font-medium ${testResult.pass ? "text-emerald-300" : "text-red-300"}`}>
                    {testResult.pass ? "Test passed" : "Test failed"}
                  </span>
                </div>
                <p className="text-sm text-zinc-300">{testResult.message}</p>
                {testResult.detail && <p className="text-xs text-zinc-500 mt-1">{testResult.detail}</p>}
                <p className="text-xs text-zinc-600 mt-2">Tested at {new Date(testResult.testedAt).toLocaleString()}</p>
              </div>
            )}

            <div className="flex gap-3">
              <Button
                onClick={handleTest}
                disabled={testLoading}
                variant={testResult?.pass ? "outline" : "default"}
                className={testResult?.pass ? "" : "bg-violet-600 hover:bg-violet-700"}
              >
                {testLoading
                  ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Testing…</>
                  : testResult ? "Re-test" : "Run Test"
                }
              </Button>
              <Button
                onClick={() => setStep(5)}
                disabled={!testResult}
                variant="outline"
                className={testResult?.pass ? "border-emerald-500 text-emerald-400 hover:bg-emerald-500/10" : ""}
              >
                {testResult?.pass ? "Continue" : "Skip (not recommended)"}
                <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </div>

            {testResult && !testResult.pass && (
              <Alert variant="destructive" className="mt-2">
                <AlertTriangle className="w-4 h-4" />
                <AlertDescription>
                  The test failed. You can still continue, but the connection will remain in <strong>failed</strong> status until it passes a test.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── STEP 5: Capabilities ──────────────────────────────────────── */}
      {step === 5 && savedConnection && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader>
            <CardTitle className="text-base text-white flex items-center gap-2">
              <Settings2 className="w-4 h-4 text-violet-400" /> Step 5 — Enable Capabilities
            </CardTitle>
            <CardDescription>
              Choose which operations this connection may perform. These are enforced server-side.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {(Object.entries(CAPABILITY_LABELS) as [keyof CapabilityState, string][]).map(([key, label]) => (
              <div key={key} className="flex items-center justify-between py-2 border-b border-zinc-800 last:border-0">
                <div>
                  <div className="text-sm text-white">{label}</div>
                  <div className="text-xs text-zinc-500">capability_{key === "paymentLinks" ? "payment_links" : key}</div>
                </div>
                <Switch
                  checked={capabilities[key]}
                  onCheckedChange={(v) => setCapabilities((prev) => ({ ...prev, [key]: v }))}
                />
              </div>
            ))}

            <div className="flex gap-3 pt-4">
              <Button variant="outline" size="sm" onClick={() => setStep(4)}>
                <ChevronLeft className="w-3 h-3 mr-1" /> Back
              </Button>
              <Button onClick={handleSaveCapabilities} disabled={busy} className="bg-violet-600 hover:bg-violet-700">
                {busy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Save Capabilities <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── STEP 6: Activate ─────────────────────────────────────────── */}
      {step === 6 && savedConnection && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader>
            <CardTitle className="text-base text-white flex items-center gap-2">
              <Power className="w-4 h-4 text-violet-400" /> Step 6 — Activate Connection
            </CardTitle>
            <CardDescription>
              Review and activate. The merchant will be able to use this provider once activated.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {activationDone
              ? (
                <div className="p-6 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-center space-y-3">
                  <CheckCircle className="w-10 h-10 text-emerald-400 mx-auto" />
                  <div className="text-lg font-semibold text-white">Connection activated!</div>
                  <p className="text-sm text-zinc-400">
                    <span className="text-white font-medium">{selectedMerchant?.businessName}</span> can now use{" "}
                    <span className="text-white font-medium">{selectedProvider?.name}</span> for enabled capabilities.
                  </p>
                  <Button onClick={resetWizard} className="mt-4 bg-violet-600 hover:bg-violet-700">
                    Connect another provider
                  </Button>
                </div>
              )
              : (
                <>
                  {/* Summary */}
                  <div className="space-y-2 text-sm">
                    {[
                      ["Merchant", selectedMerchant?.businessName ?? "—"],
                      ["Provider", selectedProvider?.name ?? "—"],
                      ["Ownership", ownership === "rasokart_owned" ? "RasoKart-owned" : "Merchant-owned"],
                      ["Monthly limit", monthlyLimit === "0" ? "Unlimited" : `₹${Number(monthlyLimit).toLocaleString()}`],
                      ["Test result", testResult?.pass ? "✅ Passed" : testResult ? "⚠️ Failed (continuing anyway)" : "Not tested"],
                      ["Capabilities", Object.entries(capabilities).filter(([, v]) => v).map(([k]) => k).join(", ") || "None"],
                    ].map(([label, value]) => (
                      <div key={label} className="flex items-start justify-between gap-4 py-1.5 border-b border-zinc-800">
                        <span className="text-zinc-400 shrink-0">{label}</span>
                        <span className="text-white text-right">{value}</span>
                      </div>
                    ))}
                  </div>

                  <div className="flex gap-3 pt-2">
                    <Button variant="outline" size="sm" onClick={() => setStep(5)}>
                      <ChevronLeft className="w-3 h-3 mr-1" /> Back
                    </Button>
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
