import { useEffect, useState } from "react";

type ProviderStatus = "enabled" | "disabled";
type Environment = "sandbox" | "live";
type CollectionMode = "static" | "dynamic";

type Settings = {
  providerStatus: ProviderStatus;
  environment: Environment;
  collectionMode: CollectionMode;
  apiTokenMasked?: string;
  hasApiToken?: boolean;
  sellerIdentifier: string;
  createOrderEndpoint: string;
  checkTransactionEndpoint: string;
  callbackUrl: string;
  serverIp: string;
  minAmount: string;
  maxAmount: string;
  testAmount: string;
  services: Record<string, boolean>;
};

const defaultSettings: Settings = {
  providerStatus: "disabled",
  environment: "live",
  collectionMode: "dynamic",
  sellerIdentifier: "",
  createOrderEndpoint: "https://banking.mytpipay.com/api/collect-payment/v1/createOrder",
  checkTransactionEndpoint: "https://banking.mytpipay.com/api/collect-payment/v1/check-transaction",
  callbackUrl: "https://rasokart.com/api/webhooks/tpipay",
  serverIp: "167.233.77.68",
  minAmount: "1",
  maxAmount: "50000",
  testAmount: "1",
  services: {
    upiCollection: true,
    dynamicQr: true,
    staticCollection: true,
    checkTransaction: true,
    payinSettlement: true,
    payout: false,
    verifyKyc: false,
    reports: true,
    ledger: true,
    providerList: true,
  },
};

const services = [
  ["upiCollection", "RasoKart UPI Collection", "UPI collection service under RasoKart branding."],
  ["dynamicQr", "RasoKart Dynamic QR", "Create amount-linked dynamic QR orders."],
  ["staticCollection", "Static Collection", "Static merchant collection mode."],
  ["checkTransaction", "Check Transaction", "UTR/status verification API."],
  ["payinSettlement", "Payin Settlement", "Settlement visibility and reports."],
  ["payout", "RasoKart Payout", "Placeholder for payout API after activation."],
  ["verifyKyc", "Verify / KYC", "Optional verification services."],
  ["reports", "Reports", "Provider reports and logs."],
  ["ledger", "Ledger", "Wallet and transaction ledger visibility."],
  ["providerList", "Provider List", "Provider/service status mapping."],
] as const;

function authHeaders(json = false): HeadersInit {
  const token =
    localStorage.getItem("rasokart_token") ||
    localStorage.getItem("adminToken") ||
    localStorage.getItem("merchantToken") ||
    localStorage.getItem("token") ||
    "";
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (json) headers["Content-Type"] = "application/json";
  return headers;
}

export default function AdminTpipayProviderSettings() {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [apiTokenDraft, setApiTokenDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState("");
  const [testResult, setTestResult] = useState<any>(null);

  async function loadSettings() {
    setLoading(true);
    setMessage("");
    try {
      const res = await fetch("/api/admin/tpipay-provider-settings", {
        headers: authHeaders(),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to load settings");
      setSettings({ ...defaultSettings, ...(json.settings || {}) });
    } catch (err: any) {
      setMessage(err?.message || "Unable to load settings");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSettings();
  }, []);

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }

  async function saveSettings() {
    setSaving(true);
    setMessage("");
    setTestResult(null);
    try {
      if (settings.collectionMode === "dynamic" && !settings.sellerIdentifier.trim()) {
        throw new Error("sellerIdentifier is required for Dynamic QR collection.");
      }

      const payload: any = { ...settings };
      if (apiTokenDraft.trim()) payload.apiToken = apiTokenDraft.trim();

      const res = await fetch("/api/admin/tpipay-provider-settings", {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to save settings");

      setSettings({ ...defaultSettings, ...(json.settings || {}) });
      setApiTokenDraft("");
      setMessage("✅ TPiPay provider settings saved.");
    } catch (err: any) {
      setMessage(err?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function createTestQr() {
    setTesting(true);
    setMessage("");
    setTestResult(null);
    try {
      const amount = Number(settings.testAmount || 1);
      const res = await fetch("/api/admin/tpipay-provider-settings/test-qr", {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({ amount }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Test QR failed");
      setTestResult(json);
      setMessage("✅ Test QR request completed.");
    } catch (err: any) {
      setMessage(err?.message || "Test QR failed");
    } finally {
      setTesting(false);
    }
  }

  const cardClass = "rounded-2xl border border-slate-800 bg-slate-950/70 p-5 shadow-lg";
  const inputClass =
    "w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400";
  const labelClass = "mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400";

  return (
    <div className="min-h-screen bg-slate-950 p-6 text-white">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-cyan-300">
              Admin Provider Settings
            </p>
            <h1 className="text-3xl font-bold">RasoKart UPI Provider</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-400">
              Configure TPiPay payin settings from admin panel. Customer and merchant pages will only show RasoKart branding.
            </p>
          </div>
          <div className="rounded-2xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-200">
            Callback: <span className="font-mono">{settings.callbackUrl}</span>
          </div>
        </div>

        {message && (
          <div className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-slate-100">
            {message}
          </div>
        )}

        <div className="grid gap-5 lg:grid-cols-3">
          <div className={`${cardClass} lg:col-span-2`}>
            <h2 className="mb-4 text-xl font-semibold">Payin Configuration</h2>

            {loading ? (
              <p className="text-slate-400">Loading settings...</p>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className={labelClass}>Provider Status</label>
                  <select
                    className={inputClass}
                    value={settings.providerStatus}
                    onChange={(e) => update("providerStatus", e.target.value as ProviderStatus)}
                  >
                    <option value="enabled">Enabled</option>
                    <option value="disabled">Disabled</option>
                  </select>
                </div>

                <div>
                  <label className={labelClass}>Environment</label>
                  <select
                    className={inputClass}
                    value={settings.environment}
                    onChange={(e) => update("environment", e.target.value as Environment)}
                  >
                    <option value="sandbox">Sandbox</option>
                    <option value="live">Live</option>
                  </select>
                </div>

                <div>
                  <label className={labelClass}>Collection Mode</label>
                  <select
                    className={inputClass}
                    value={settings.collectionMode}
                    onChange={(e) => update("collectionMode", e.target.value as CollectionMode)}
                  >
                    <option value="static">Static Collection</option>
                    <option value="dynamic">Dynamic Collection</option>
                  </select>
                </div>

                <div>
                  <label className={labelClass}>API Token</label>
                  <input
                    className={inputClass}
                    type="password"
                    placeholder={settings.hasApiToken ? settings.apiTokenMasked || "Saved token masked" : "Paste new API token"}
                    value={apiTokenDraft}
                    onChange={(e) => setApiTokenDraft(e.target.value)}
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    Saved token is never shown fully. Enter only to replace.
                  </p>
                </div>

                <div>
                  <label className={labelClass}>sellerIdentifier</label>
                  <input
                    className={inputClass}
                    value={settings.sellerIdentifier}
                    placeholder="Seller Identifier from TPiPay"
                    onChange={(e) => update("sellerIdentifier", e.target.value)}
                  />
                </div>

                <div>
                  <label className={labelClass}>Test Amount</label>
                  <input
                    className={inputClass}
                    value={settings.testAmount}
                    onChange={(e) => update("testAmount", e.target.value)}
                  />
                </div>

                <div className="md:col-span-2">
                  <label className={labelClass}>Create Order Endpoint</label>
                  <input
                    className={inputClass}
                    value={settings.createOrderEndpoint}
                    onChange={(e) => update("createOrderEndpoint", e.target.value)}
                  />
                </div>

                <div className="md:col-span-2">
                  <label className={labelClass}>Check Transaction Endpoint</label>
                  <input
                    className={inputClass}
                    value={settings.checkTransactionEndpoint}
                    onChange={(e) => update("checkTransactionEndpoint", e.target.value)}
                  />
                </div>

                <div>
                  <label className={labelClass}>Callback URL</label>
                  <input className={inputClass} value={settings.callbackUrl} readOnly />
                </div>

                <div>
                  <label className={labelClass}>Server IP</label>
                  <input className={inputClass} value={settings.serverIp} readOnly />
                </div>

                <div>
                  <label className={labelClass}>Minimum Amount</label>
                  <input
                    className={inputClass}
                    value={settings.minAmount}
                    onChange={(e) => update("minAmount", e.target.value)}
                  />
                </div>

                <div>
                  <label className={labelClass}>Maximum Amount</label>
                  <input
                    className={inputClass}
                    value={settings.maxAmount}
                    onChange={(e) => update("maxAmount", e.target.value)}
                  />
                </div>
              </div>
            )}

            <div className="mt-5 flex flex-wrap gap-3">
              <button
                onClick={saveSettings}
                disabled={saving}
                className="rounded-xl bg-cyan-500 px-5 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-60"
              >
                {saving ? "Saving..." : "Save Settings"}
              </button>
              <button
                onClick={createTestQr}
                disabled={testing || settings.providerStatus !== "enabled"}
                className="rounded-xl bg-violet-500 px-5 py-2 text-sm font-semibold text-white hover:bg-violet-400 disabled:opacity-60"
              >
                {testing ? "Creating..." : "Create ₹1 Test QR"}
              </button>
              <button
                onClick={loadSettings}
                className="rounded-xl border border-slate-700 px-5 py-2 text-sm font-semibold text-slate-200 hover:border-cyan-400"
              >
                Refresh
              </button>
            </div>
          </div>

          <div className={cardClass}>
            <h2 className="mb-4 text-xl font-semibold">White-label Rules</h2>
            <div className="space-y-3 text-sm text-slate-300">
              <p>Customer frontend: <b>RasoKart UPI Collection</b></p>
              <p>Merchant frontend: <b>RasoKart Dynamic QR</b></p>
              <p>Provider name visible only in Admin settings.</p>
              <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-amber-200">
                Dynamic QR needs sellerIdentifier.
              </p>
            </div>
          </div>
        </div>

        <div className={cardClass}>
          <h2 className="mb-4 text-xl font-semibold">TPiPay Services Control</h2>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {services.map(([key, title, desc]) => (
              <label
                key={key}
                className="flex cursor-pointer gap-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 hover:border-cyan-500/60"
              >
                <input
                  type="checkbox"
                  checked={!!settings.services?.[key]}
                  onChange={(e) =>
                    update("services", {
                      ...(settings.services || {}),
                      [key]: e.target.checked,
                    })
                  }
                  className="mt-1"
                />
                <span>
                  <span className="block font-semibold text-white">{title}</span>
                  <span className="mt-1 block text-xs text-slate-400">{desc}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        {testResult && (
          <div className={cardClass}>
            <h2 className="mb-4 text-xl font-semibold">Test QR Result</h2>
            {testResult?.data?.qrString || testResult?.data?.vpa ? (
              <div className="mb-4 rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-4">
                <p className="text-sm text-cyan-200">UPI / QR String</p>
                <textarea
                  readOnly
                  className="mt-2 h-28 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-cyan-100"
                  value={testResult?.data?.qrString || testResult?.data?.vpa || ""}
                />
              </div>
            ) : null}
            <pre className="max-h-96 overflow-auto rounded-xl bg-black p-4 text-xs text-green-300">
              {JSON.stringify(testResult, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
