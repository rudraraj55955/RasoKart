import { useState, useEffect } from "react";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { useGetMe } from "@workspace/api-client-react";
import { Loader2, ShieldCheck, TestTube, AlertTriangle, CheckCircle2, Eye, EyeOff, Info } from "lucide-react";

interface Settings {
  id?: number;
  mode: string;
  clientIdSet: boolean;
  clientSecretSet: boolean;
  apiVersion: string;
  onboardingEnabled: boolean;
  panEnabled: boolean;
  gstEnabled: boolean;
  cinEnabled: boolean;
  bankEnabled: boolean;
  ocrEnabled: boolean;
  updatedByEmail?: string | null;
  updatedAt?: string | null;
}

const DEFAULT: Settings = {
  mode: "test", clientIdSet: false, clientSecretSet: false, apiVersion: "2023-08-01",
  onboardingEnabled: false, panEnabled: true, gstEnabled: true, cinEnabled: false, bankEnabled: true, ocrEnabled: false,
};

export default function AdminSecureIdSettings() {
  const { data: meData } = useGetMe();
  const isSuperAdmin = !!(meData as any)?.isSuperAdmin;

  const [settings, setSettings] = useState<Settings>(DEFAULT);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [showId, setShowId] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const token = () => localStorage.getItem("rasokart_token");

  useEffect(() => {
    fetch("/api/admin/secure-id-settings", { headers: { Authorization: `Bearer ${token()}` } })
      .then((r) => r.json())
      .then((d) => { setSettings(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    setTestResult(null);
    try {
      const body: Record<string, unknown> = {
        mode: settings.mode,
        apiVersion: settings.apiVersion,
        onboardingEnabled: settings.onboardingEnabled,
        panEnabled: settings.panEnabled,
        gstEnabled: settings.gstEnabled,
        cinEnabled: settings.cinEnabled,
        bankEnabled: settings.bankEnabled,
        ocrEnabled: settings.ocrEnabled,
      };
      if (clientId.trim()) body["clientId"] = clientId.trim();
      if (clientSecret.trim()) body["clientSecret"] = clientSecret.trim();

      const r = await fetch("/api/admin/secure-id-settings", {
        method: "PUT",
        headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) { toast.error(d.error ?? "Failed to save settings"); return; }
      setSettings(d);
      setClientId("");
      setClientSecret("");
      toast.success("Secure ID settings saved");
    } catch {
      toast.error("Network error — could not save settings");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await fetch("/api/admin/secure-id-settings/test", {
        method: "POST",
        headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
      });
      const d = await r.json();
      setTestResult(d);
      if (d.ok) toast.success("Provider credentials verified");
      else toast.error(d.message ?? "Credential test failed");
    } catch {
      setTestResult({ ok: false, message: "Connection failed" });
    } finally {
      setTesting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6 p-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <ShieldCheck className="w-7 h-7 text-indigo-400" />
            Secure Onboarding Provider
          </h1>
          <p className="text-neutral-400 text-sm mt-1">Configure the identity verification provider for merchant onboarding.</p>
        </div>

        {!isSuperAdmin && (
          <Alert className="border-amber-700 bg-amber-950/30">
            <Info className="h-4 w-4 text-amber-400" />
            <AlertDescription className="text-amber-300 text-sm">
              Viewing only — Super Admin access required to modify provider settings.
            </AlertDescription>
          </Alert>
        )}

        {/* Provider credentials */}
        <Card className="bg-neutral-900 border-neutral-800">
          <CardHeader>
            <CardTitle className="text-white">Provider Credentials</CardTitle>
            <CardDescription>API credentials for the identity verification provider. Stored AES-256-GCM encrypted at rest.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-1.5">
              <Label>Mode</Label>
              <Select value={settings.mode} onValueChange={(v) => setSettings((s) => ({ ...s, mode: v }))} disabled={!isSuperAdmin}>
                <SelectTrigger className="bg-neutral-800 border-neutral-700 text-white w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-neutral-800 border-neutral-700">
                  <SelectItem value="test">Test / Sandbox</SelectItem>
                  <SelectItem value="live">Live / Production</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>API Version</Label>
              <Input value={settings.apiVersion} onChange={(e) => setSettings((s) => ({ ...s, apiVersion: e.target.value }))}
                placeholder="2023-08-01" disabled={!isSuperAdmin} className="bg-neutral-800 border-neutral-700 text-white font-mono w-48" />
            </div>
            <Separator className="bg-neutral-800" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Client ID {settings.clientIdSet && <Badge variant="outline" className="ml-1 text-xs text-emerald-400 border-emerald-700">Set</Badge>}</Label>
                <div className="relative">
                  <Input type={showId ? "text" : "password"} value={clientId}
                    onChange={(e) => setClientId(e.target.value)} placeholder={settings.clientIdSet ? "Leave blank to keep current" : "Enter Client ID"}
                    disabled={!isSuperAdmin} className="bg-neutral-800 border-neutral-700 text-white pr-10" />
                  <button className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-white" onClick={() => setShowId((v) => !v)} type="button">
                    {showId ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Client Secret {settings.clientSecretSet && <Badge variant="outline" className="ml-1 text-xs text-emerald-400 border-emerald-700">Set</Badge>}</Label>
                <div className="relative">
                  <Input type={showSecret ? "text" : "password"} value={clientSecret}
                    onChange={(e) => setClientSecret(e.target.value)} placeholder={settings.clientSecretSet ? "Leave blank to keep current" : "Enter Client Secret"}
                    disabled={!isSuperAdmin} className="bg-neutral-800 border-neutral-700 text-white pr-10" />
                  <button className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-white" onClick={() => setShowSecret((v) => !v)} type="button">
                    {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>
            {isSuperAdmin && (
              <div className="flex gap-3 pt-2">
                <Button className="bg-indigo-600 hover:bg-indigo-700" onClick={handleSave} disabled={saving}>
                  {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving…</> : "Save Settings"}
                </Button>
                <Button variant="outline" className="border-neutral-600" onClick={handleTest} disabled={testing || !settings.clientIdSet}>
                  {testing ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Testing…</> : <><TestTube className="w-4 h-4 mr-2" />Test Credentials</>}
                </Button>
              </div>
            )}
            {testResult && (
              <Alert className={testResult.ok ? "border-emerald-700 bg-emerald-950/30" : "border-red-700 bg-red-950/30"}>
                {testResult.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <AlertTriangle className="h-4 w-4 text-red-400" />}
                <AlertDescription className={testResult.ok ? "text-emerald-300 text-sm" : "text-red-300 text-sm"}>{testResult.message}</AlertDescription>
              </Alert>
            )}
            {settings.updatedByEmail && (
              <p className="text-xs text-neutral-500">Last updated by <strong className="text-neutral-400">{settings.updatedByEmail}</strong>
                {settings.updatedAt ? ` on ${new Date(settings.updatedAt).toLocaleDateString("en-IN")}` : ""}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Feature toggles */}
        <Card className="bg-neutral-900 border-neutral-800">
          <CardHeader>
            <CardTitle className="text-white">Feature Toggles</CardTitle>
            <CardDescription>Control which verification checks are enabled for merchant onboarding.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {([
              { key: "onboardingEnabled", label: "Secure Onboarding Enabled", desc: "Activates the 1-click onboarding flow for merchants" },
              { key: "panEnabled", label: "PAN Verification", desc: "Verify merchant PAN with the provider" },
              { key: "gstEnabled", label: "GST Verification", desc: "Verify GSTIN (optional, can be skipped by merchant)" },
              { key: "cinEnabled", label: "CIN Verification", desc: "Verify Company Identification Number" },
              { key: "bankEnabled", label: "Bank Account Verification", desc: "Verify settlement bank account + IFSC" },
              { key: "ocrEnabled", label: "OCR / Document Scan", desc: "Enable document OCR extraction (if supported)" },
            ] as const).map(({ key, label, desc }) => (
              <div key={key} className="flex items-center justify-between py-2">
                <div>
                  <p className="text-sm font-medium text-white">{label}</p>
                  <p className="text-xs text-neutral-500">{desc}</p>
                </div>
                <Switch
                  checked={settings[key as keyof Settings] as boolean}
                  onCheckedChange={(v) => setSettings((s) => ({ ...s, [key]: v }))}
                  disabled={!isSuperAdmin}
                />
              </div>
            ))}
            {isSuperAdmin && (
              <Button className="bg-indigo-600 hover:bg-indigo-700 mt-2" onClick={handleSave} disabled={saving}>
                {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving…</> : "Save Toggles"}
              </Button>
            )}
          </CardContent>
        </Card>

        <Card className="bg-neutral-900 border-neutral-800">
          <CardHeader>
            <CardTitle className="text-white">About</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-neutral-400 space-y-1.5">
            <p>• Identity verification is powered by a third-party provider. Credentials are never exposed to merchants.</p>
            <p>• All raw API responses are AES-256-GCM encrypted before storage and only decryptable by Super Admins.</p>
            <p>• The verification flow is white-labeled — merchants see only "RasoKart Secure Onboarding" branding.</p>
            <p>• Tokens are cleared from the database immediately after use (auth code cleared after exchange, access token cleared after data fetch).</p>
          </CardContent>
        </Card>
      </div>
  );
}
