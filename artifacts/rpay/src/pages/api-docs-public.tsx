import { useEffect } from "react";
import { Link } from "wouter";
import { RasoKartLogo } from "@/components/ui/rasokart-logo";
import { SiteFooter } from "@/components/ui/site-footer";
import { useCompanySettings } from "@/lib/company-settings";
import {
  Code2, Key, Webhook, Shield, ArrowRight, Terminal, Zap, Lock, BookOpen,
  CheckCircle2, Globe, FileText, Download, ExternalLink, AlertTriangle,
  Package, Play,
} from "lucide-react";

const LAST_UPDATED = "11 August 2026";
const BASE_URL = "https://rasokart.com/api";
const OPENAPI_YAML_URL = "/api/openapi.yaml";
const OPENAPI_JSON_URL = "/api/openapi.json";
const SWAGGER_URL = "/api/swagger";

const sections = [
  { id: "overview",   title: "Overview" },
  { id: "getting-started", title: "Getting Started" },
  { id: "auth",       title: "Authentication" },
  { id: "payments",   title: "Pay-in APIs" },
  { id: "payouts",    title: "Payout APIs" },
  { id: "webhooks",   title: "Webhooks" },
  { id: "sandbox",    title: "Sandbox / Test Mode" },
  { id: "errors",     title: "Error Codes" },
  { id: "openapi",    title: "OpenAPI / Postman" },
];

const authEndpoints = [
  { method: "POST", path: "/api/auth/login",                    desc: "Password login — returns a JWT",          auth: false },
  { method: "GET",  path: "/api/auth/me",                       desc: "Returns the authenticated user identity", auth: true },
  { method: "POST", path: "/api/auth/merchant/otp/request",     desc: "Request an OTP (login or signup verify)", auth: false },
  { method: "POST", path: "/api/auth/merchant/otp/verify",      desc: "Verify OTP and receive a JWT",            auth: false },
  { method: "POST", path: "/api/auth/merchant/password/forgot", desc: "Request a password-reset OTP",           auth: false },
  { method: "POST", path: "/api/auth/merchant/password/reset",  desc: "Reset password with OTP",                auth: false },
  { method: "POST", path: "/api/auth/logout",                   desc: "Invalidate session (client must clear token)", auth: true },
];

const paymentEndpoints = [
  { id: "pay-txn-list",    method: "GET",  path: "/api/transactions",        desc: "List all transactions (paginated)",      auth: true },
  { id: "pay-txn-get",     method: "GET",  path: "/api/transactions/:id",    desc: "Get a single transaction by ID",         auth: true },
  { id: "pay-qr-list",     method: "GET",  path: "/api/qr-codes",            desc: "List QR codes for your account",         auth: true },
  { id: "pay-qr-create",   method: "POST", path: "/api/qr-codes",            desc: "Create a new static/dynamic QR code",   auth: true },
  { id: "pay-qr-get",      method: "GET",  path: "/api/qr-codes/:id",        desc: "Get a specific QR code",                auth: true },
  { id: "pay-va-list",     method: "GET",  path: "/api/virtual-accounts",    desc: "List virtual accounts",                  auth: true },
  { id: "pay-va-create",   method: "POST", path: "/api/virtual-accounts",    desc: "Create a virtual account",              auth: true },
  { id: "pay-link-list",   method: "GET",  path: "/api/payment-links",       desc: "List payment links",                    auth: true },
  { id: "pay-link-create", method: "POST", path: "/api/payment-links",       desc: "Create a shareable payment link",       auth: true },
  { id: "pay-ledger",      method: "GET",  path: "/api/ledger",              desc: "List ledger entries with balance",       auth: true },
  { id: "pay-settlements", method: "GET",  path: "/api/settlements",         desc: "List settlement batches",               auth: true },
];

const payoutEndpoints = [
  { id: "pout-list",       method: "GET",  path: "/api/withdrawals",                     desc: "List payout requests",                  auth: true },
  { id: "pout-create",     method: "POST", path: "/api/withdrawals",                     desc: "Create a payout request",               auth: true },
  { id: "pout-get",        method: "GET",  path: "/api/withdrawals/:id",                 desc: "Get a single payout request",           auth: true },
  { id: "pout-ben-list",   method: "GET",  path: "/api/payout-beneficiaries",            desc: "List payout beneficiaries",             auth: true },
  { id: "pout-ben-add",    method: "POST", path: "/api/payout-beneficiaries",            desc: "Add a payout beneficiary",              auth: true },
  { id: "pout-ben-get",    method: "GET",  path: "/api/payout-beneficiaries/:id",        desc: "Get a specific beneficiary",            auth: true },
  { id: "pout-ben-del",    method: "DELETE", path: "/api/payout-beneficiaries/:id",      desc: "Delete a beneficiary",                  auth: true },
];

const notImplementedApis = [
  { name: "Refunds API",    note: "NOT IMPLEMENTED — future roadmap item" },
  { name: "Chargebacks API", note: "NOT IMPLEMENTED — managed manually via dashboard" },
  { name: "API versioning (/v1, /v2)", note: "NOT IMPLEMENTED — all routes are currently unversioned" },
];

const webhookEvents = [
  { event: "payment.success",      desc: "Payment notification received via partner — transaction confirmed" },
  { event: "payment.failed",       desc: "Payment attempt failed at provider level" },
  { event: "payment.refunded",     desc: "Refund processed by payment partner — NOT IMPLEMENTED on outbound API" },
  { event: "payout.completed",     desc: "Payout processed to beneficiary bank account" },
  { event: "payout.failed",        desc: "Payout processing failed at partner level" },
  { event: "payout.reversed",      desc: "Payout reversed by payment partner" },
  { event: "account.kyc_approved", desc: "Merchant KYC approved" },
  { event: "account.suspended",    desc: "Merchant account suspended" },
];

const errorCodes = [
  { code: "400", meaning: "Bad Request — missing or invalid parameters" },
  { code: "401", meaning: "Unauthorized — invalid or missing token" },
  { code: "403", meaning: "Forbidden — insufficient permissions for this action" },
  { code: "404", meaning: "Not Found — resource does not exist" },
  { code: "409", meaning: "Conflict — resource already exists or state conflict" },
  { code: "422", meaning: "Unprocessable Entity — validation failed" },
  { code: "429", meaning: "Too Many Requests — rate limit exceeded" },
  { code: "500", meaning: "Internal Server Error — contact support" },
  { code: "503", meaning: "Service Unavailable — temporary outage" },
];

function Badge({ method }: { method: string }) {
  const colors: Record<string, string> = {
    GET:    "text-emerald-400",
    POST:   "text-amber-400",
    PUT:    "text-blue-400",
    PATCH:  "text-violet-400",
    DELETE: "text-red-400",
  };
  return <span className={`text-xs font-mono font-bold ${colors[method] ?? "text-foreground"}`}>{method}</span>;
}

function EndpointRow({ id, method, path, desc, auth }: { id?: string; method: string; path: string; desc: string; auth: boolean }) {
  return (
    <tr className="hover:bg-card/40 transition-colors">
      <td className="py-3 px-4 w-16"><Badge method={method} /></td>
      <td className="py-3 px-4"><code className="text-xs font-mono text-cyan-400">{path}</code></td>
      <td className="py-3 px-4 text-xs text-muted-foreground">{desc}</td>
      <td className="py-3 px-4 text-xs">
        {auth
          ? <span className="text-amber-400 flex items-center gap-1"><Lock className="w-3 h-3" />Bearer JWT</span>
          : <span className="text-emerald-400">Public</span>}
      </td>
    </tr>
  );
}

function SectionHeading({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <div className="p-2 rounded-lg bg-card border border-border/50">{icon}</div>
      <h2 className="text-xl font-semibold">{title}</h2>
    </div>
  );
}

export default function ApiDocsPublic() {
  const { supportEmail } = useCompanySettings();

  useEffect(() => {
    document.title = "API Documentation — RasoKart Developer Reference";
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2.5 shrink-0">
            <RasoKartLogo size={32} />
            <span className="font-bold text-base hidden sm:block">RasoKart</span>
          </Link>
          <span className="text-sm font-medium text-foreground">Developer Documentation</span>
          <div className="flex items-center gap-2 text-xs">
            <a
              href={SWAGGER_URL}
              className="hidden sm:flex items-center gap-1.5 border border-border/60 px-3 py-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:border-border transition-colors"
            >
              <Play className="w-3 h-3" /> API Explorer
            </a>
            <Link href="/merchant/login" className="bg-primary/10 text-primary px-3 py-1.5 rounded-lg hover:bg-primary/20 transition-colors font-medium">
              Get API Keys →
            </Link>
          </div>
        </div>
      </header>

      <div className="flex-1 mx-auto max-w-7xl px-4 sm:px-6 py-12 w-full">
        <div className="lg:grid lg:grid-cols-[200px_1fr] lg:gap-12">
          {/* Sidebar */}
          <aside className="hidden lg:block">
            <div className="sticky top-24 space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Contents</p>
              {sections.map(s => (
                <a key={s.id} href={`#${s.id}`} className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-card/60 transition-colors">
                  {s.title}
                </a>
              ))}
              <div className="border-t border-border/40 pt-3 mt-4 space-y-1">
                <a href={SWAGGER_URL} className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-primary hover:bg-card/60 transition-colors">
                  <Play className="w-3 h-3" /> API Explorer
                </a>
                <a href={OPENAPI_YAML_URL} className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-card/60 transition-colors">
                  <Download className="w-3 h-3" /> openapi.yaml
                </a>
                <Link href="/integration-guide" className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-card/60 transition-colors">
                  <Code2 className="w-3 h-3" /> Integration Guide
                </Link>
                <Link href="/pci-dss-security" className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-card/60 transition-colors">
                  <Shield className="w-3 h-3" /> PCI DSS Info
                </Link>
              </div>
            </div>
          </aside>

          <main className="min-w-0 space-y-12">
            {/* Hero */}
            <div id="overview" style={{ scrollMarginTop: "6rem" }}>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-primary/30 bg-primary/10 text-primary text-xs font-medium mb-4">
                <Code2 className="w-3.5 h-3.5" />
                REST API · OpenAPI 3.1.0 · Last Updated: {LAST_UPDATED}
              </div>
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">API Reference</h1>
              <p className="text-muted-foreground leading-relaxed max-w-2xl">
                The RasoKart API is a RESTful service over HTTPS. All requests and responses use JSON.
                Authentication uses JWT Bearer tokens. The full machine-readable specification is available at{" "}
                <a href={OPENAPI_YAML_URL} className="text-primary hover:underline font-mono text-xs">/api/openapi.yaml</a>.
              </p>

              {/* Quick links */}
              <div className="mt-6 grid sm:grid-cols-3 gap-3">
                <a href={SWAGGER_URL} className="flex items-center gap-3 p-4 rounded-xl border border-primary/30 bg-primary/5 hover:bg-primary/10 transition-colors group">
                  <Play className="w-5 h-5 text-primary shrink-0" />
                  <div>
                    <p className="text-sm font-semibold">API Explorer</p>
                    <p className="text-xs text-muted-foreground">Swagger UI — browse all endpoints</p>
                  </div>
                </a>
                <a href={OPENAPI_YAML_URL} className="flex items-center gap-3 p-4 rounded-xl border border-border/60 bg-card/40 hover:bg-card/60 transition-colors group">
                  <Download className="w-5 h-5 text-emerald-400 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold">OpenAPI Spec</p>
                    <p className="text-xs text-muted-foreground">370 paths · openapi.yaml</p>
                  </div>
                </a>
                <a href={OPENAPI_JSON_URL} className="flex items-center gap-3 p-4 rounded-xl border border-border/60 bg-card/40 hover:bg-card/60 transition-colors group">
                  <Package className="w-5 h-5 text-amber-400 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold">JSON Spec</p>
                    <p className="text-xs text-muted-foreground">openapi.json — for SDK generators</p>
                  </div>
                </a>
              </div>

              <div className="mt-5 rounded-xl border border-border/60 bg-card/40 p-4 text-sm">
                <p className="text-xs text-muted-foreground mb-1">Base URL</p>
                <code className="font-mono text-cyan-400">{BASE_URL}</code>
              </div>

              <div className="mt-4 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-200/90 leading-relaxed">
                <strong className="text-amber-300">Important:</strong> Live payment processing requires approved partner credentials from your RasoKart account manager. All examples are for integration reference — no real money movement occurs with sandbox credentials.
              </div>
            </div>

            <div className="border-t border-border/40" />

            {/* Getting Started */}
            <section id="getting-started" className="space-y-4" style={{ scrollMarginTop: "6rem" }}>
              <SectionHeading icon={<Terminal className="w-4 h-4 text-cyan-400" />} title="Getting Started" />
              <ol className="space-y-4 text-sm text-muted-foreground">
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center">1</span>
                  <span><strong className="text-foreground">Apply for a merchant account</strong> at <Link href="/merchant/register" className="text-primary hover:underline">/merchant/register</Link>. Complete KYC verification.</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center">2</span>
                  <span><strong className="text-foreground">Obtain API keys</strong> from your merchant dashboard under Settings → API Keys.</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center">3</span>
                  <span><strong className="text-foreground">Authenticate</strong> by posting credentials to <code className="bg-card border border-border/40 px-1 rounded text-xs">POST /api/auth/login</code>. Save the returned JWT.</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center">4</span>
                  <span><strong className="text-foreground">Include the token</strong> on every request: <code className="bg-card border border-border/40 px-1 rounded text-xs">Authorization: Bearer &lt;token&gt;</code></span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center">5</span>
                  <span><strong className="text-foreground">Browse the full API</strong> in the <a href={SWAGGER_URL} className="text-primary hover:underline">interactive API Explorer</a> or <a href={OPENAPI_YAML_URL} className="text-primary hover:underline">download the OpenAPI spec</a>.</span>
                </li>
              </ol>

              <div className="bg-card/80 border border-border/60 rounded-lg p-4 font-mono text-xs text-cyan-400 leading-relaxed">
                <p className="text-muted-foreground mb-2"># Example: login and call an endpoint</p>
                <p>curl -X POST {BASE_URL}/auth/login \</p>
                <p className="pl-4">-H 'Content-Type: application/json' \</p>
                <p className="pl-4">-d {'\'{"email":"you@example.com","password":"..."}\''}</p>
                <p className="mt-3 text-muted-foreground"># → {"{ token: \"...\" }"}</p>
                <p className="mt-3">curl {BASE_URL}/transactions \</p>
                <p className="pl-4">-H 'Authorization: Bearer &lt;token&gt;'</p>
              </div>
            </section>

            <div className="border-t border-border/40" />

            {/* Authentication */}
            <section id="auth" className="space-y-4" style={{ scrollMarginTop: "6rem" }}>
              <SectionHeading icon={<Key className="w-4 h-4 text-amber-400" />} title="Authentication" />
              <p className="text-muted-foreground text-sm leading-relaxed">
                All protected endpoints require a JWT in the <code className="bg-card border border-border/40 px-1 rounded text-xs">Authorization</code> header.
                Tokens are issued by <code className="bg-card border border-border/40 px-1 rounded text-xs">POST /api/auth/login</code> and expire after <strong>7 days</strong>.
              </p>
              <div className="bg-card/80 border border-border/60 rounded-lg p-3 font-mono text-xs text-cyan-400">
                Authorization: Bearer YOUR_JWT_TOKEN
              </div>
              <p className="text-muted-foreground text-sm">OTP-based login is also supported (request → verify → JWT). Rate limiting applies to all auth endpoints.</p>
              <div className="rounded-xl border border-border/60 overflow-hidden">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-border/60 bg-card/60">
                    <th className="text-left py-3 px-4 text-xs font-medium text-foreground w-16">Method</th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-foreground">Endpoint</th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-foreground">Description</th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-foreground">Auth</th>
                  </tr></thead>
                  <tbody className="divide-y divide-border/30">{authEndpoints.map(e => <EndpointRow key={`auth-${e.method}-${e.path}`} {...e} />)}</tbody>
                </table>
              </div>
            </section>

            <div className="border-t border-border/40" />

            {/* Pay-in */}
            <section id="payments" className="space-y-4" style={{ scrollMarginTop: "6rem" }}>
              <SectionHeading icon={<Globe className="w-4 h-4 text-emerald-400" />} title="Pay-in APIs" />
              <p className="text-muted-foreground text-sm leading-relaxed">
                Accept payments via QR codes, virtual accounts, and payment links.
                All pay-in flows are provider-backed (Cashfree, PayU, UPI Gateway, EKQR).
                Provider activation is required before live transactions.
              </p>
              <div className="rounded-xl border border-border/60 overflow-hidden">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-border/60 bg-card/60">
                    <th className="text-left py-3 px-4 text-xs font-medium text-foreground w-16">Method</th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-foreground">Endpoint</th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-foreground">Description</th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-foreground">Auth</th>
                  </tr></thead>
                  <tbody className="divide-y divide-border/30">{paymentEndpoints.map(e => <EndpointRow key={e.id} {...e} />)}</tbody>
                </table>
              </div>

              {/* Not implemented */}
              <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-4 space-y-2">
                <p className="text-xs font-semibold text-amber-300 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> Not Yet Implemented</p>
                {notImplementedApis.map(n => (
                  <p key={n.name} className="text-xs text-muted-foreground">
                    <code className="text-amber-400/80">{n.name}</code> — {n.note}
                  </p>
                ))}
              </div>
            </section>

            <div className="border-t border-border/40" />

            {/* Payouts */}
            <section id="payouts" className="space-y-4" style={{ scrollMarginTop: "6rem" }}>
              <SectionHeading icon={<Zap className="w-4 h-4 text-violet-400" />} title="Payout APIs" />
              <p className="text-muted-foreground text-sm leading-relaxed">
                Initiate bank transfers to verified beneficiaries. Payouts are processed via Cashfree Payouts.
                Beneficiaries must be created and verified before a payout can be initiated.
              </p>
              <div className="rounded-xl border border-border/60 overflow-hidden">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-border/60 bg-card/60">
                    <th className="text-left py-3 px-4 text-xs font-medium text-foreground w-16">Method</th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-foreground">Endpoint</th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-foreground">Description</th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-foreground">Auth</th>
                  </tr></thead>
                  <tbody className="divide-y divide-border/30">{payoutEndpoints.map(e => <EndpointRow key={e.id} {...e} />)}</tbody>
                </table>
              </div>
            </section>

            <div className="border-t border-border/40" />

            {/* Webhooks */}
            <section id="webhooks" className="space-y-4" style={{ scrollMarginTop: "6rem" }}>
              <SectionHeading icon={<Webhook className="w-4 h-4 text-blue-400" />} title="Webhooks" />
              <p className="text-muted-foreground text-sm">
                Configure an HTTPS endpoint in your dashboard under Settings → Webhooks.
                Each delivery is signed with <strong>HMAC-SHA256</strong> using your webhook secret.
                Verify the signature before trusting the payload.
              </p>
              <div className="bg-card/80 border border-border/60 rounded-lg p-3 font-mono text-xs leading-relaxed text-muted-foreground">
                <p className="text-cyan-400">X-Rasokart-Signature: sha256=&lt;hex-digest&gt;</p>
                <p className="mt-2"># Verify with HMAC-SHA256 of raw request body</p>
                <p># using your webhook secret from the dashboard</p>
              </div>
              <div className="rounded-xl border border-border/60 overflow-hidden">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-border/60 bg-card/60">
                    <th className="text-left py-3 px-4 text-xs font-medium text-foreground">Event</th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-foreground">Description</th>
                  </tr></thead>
                  <tbody className="divide-y divide-border/30">
                    {webhookEvents.map(({ event, desc }) => (
                      <tr key={event} className="hover:bg-card/40 transition-colors">
                        <td className="py-3 px-4"><code className="text-xs font-mono text-violet-400">{event}</code></td>
                        <td className="py-3 px-4 text-xs text-muted-foreground">{desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-sm text-muted-foreground">
                For full signature verification examples, see the <Link href="/integration-guide" className="text-primary hover:underline">Integration Guide</Link>.
              </p>
            </section>

            <div className="border-t border-border/40" />

            {/* Sandbox */}
            <section id="sandbox" className="space-y-4" style={{ scrollMarginTop: "6rem" }}>
              <SectionHeading icon={<Shield className="w-4 h-4 text-cyan-400" />} title="Sandbox / Test Mode" />
              <p className="text-muted-foreground text-sm leading-relaxed">
                RasoKart does not have a global sandbox toggle. Sandbox mode is configured at the
                <strong className="text-foreground"> provider-credential level</strong>:
              </p>
              <ul className="space-y-2 text-sm text-muted-foreground list-none">
                {[
                  ["Cashfree PG", "Use Cashfree's test environment credentials in dashboard → Providers → Cashfree"],
                  ["PayU",        "Use PayU UAT merchant key/salt in dashboard → Providers → PayU"],
                  ["Razorpay",    "NOT LIVE — planned (coming soon)"],
                  ["EKQR / UPI",  "Sandbox mode via provider setting in EKQR Gateway config"],
                ].map(([provider, note]) => (
                  <li key={provider} className="flex gap-3 items-start">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <span><strong className="text-foreground">{provider}:</strong> {note}</span>
                  </li>
                ))}
              </ul>
              <div className="rounded-xl border border-border/60 bg-card/40 p-4 text-sm text-muted-foreground">
                <p className="font-medium text-foreground mb-1">API endpoint is the same for sandbox and live.</p>
                <p>The active provider credential (sandbox vs live) determines whether a real transaction occurs.</p>
                <p className="mt-2">Contact <a href={`mailto:${supportEmail}`} className="text-primary hover:underline">{supportEmail}</a> to request sandbox credentials.</p>
              </div>
            </section>

            <div className="border-t border-border/40" />

            {/* Error codes */}
            <section id="errors" className="space-y-4" style={{ scrollMarginTop: "6rem" }}>
              <SectionHeading icon={<FileText className="w-4 h-4 text-rose-400" />} title="Error Codes" />
              <p className="text-sm text-muted-foreground">All error responses are JSON: <code className="bg-card border border-border/40 px-1 rounded text-xs">{`{ "error": "Human-readable message" }`}</code></p>
              <div className="rounded-xl border border-border/60 overflow-hidden">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-border/60 bg-card/60">
                    <th className="text-left py-3 px-4 text-xs font-medium text-foreground w-16">Code</th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-foreground">Meaning</th>
                  </tr></thead>
                  <tbody className="divide-y divide-border/30">
                    {errorCodes.map(({ code, meaning }) => (
                      <tr key={code} className="hover:bg-card/40 transition-colors">
                        <td className="py-3 px-4">
                          <span className={`text-xs font-mono font-bold ${code.startsWith("2") ? "text-emerald-400" : code.startsWith("4") ? "text-amber-400" : "text-red-400"}`}>{code}</span>
                        </td>
                        <td className="py-3 px-4 text-xs text-muted-foreground">{meaning}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="bg-card/80 border border-border/60 rounded-lg p-3 text-xs font-mono text-muted-foreground">
                <p className="text-cyan-400 mb-1">// Rate limit headers on 429</p>
                <p>ratelimit: "5-in-15min"; r=0; t=900</p>
                <p>retry-after: 900</p>
              </div>
            </section>

            <div className="border-t border-border/40" />

            {/* OpenAPI / Postman */}
            <section id="openapi" className="space-y-6" style={{ scrollMarginTop: "6rem" }}>
              <SectionHeading icon={<BookOpen className="w-4 h-4 text-emerald-400" />} title="OpenAPI / Postman" />

              {/* OpenAPI */}
              <div className="space-y-3">
                <h3 className="text-base font-semibold">OpenAPI 3.1.0 Specification</h3>
                <p className="text-sm text-muted-foreground">
                  The full machine-readable API contract with 370 documented paths, schemas, and examples.
                  Compatible with Postman, Insomnia, code-generation tools, and AI assistants.
                </p>
                <div className="grid sm:grid-cols-2 gap-3">
                  <a href={OPENAPI_YAML_URL}
                    className="flex items-center gap-3 p-4 rounded-xl border border-border/60 bg-card/40 hover:bg-card/60 transition-colors"
                  >
                    <Download className="w-5 h-5 text-emerald-400 shrink-0" />
                    <div>
                      <p className="text-sm font-semibold">openapi.yaml</p>
                      <code className="text-xs text-muted-foreground">/api/openapi.yaml</code>
                    </div>
                  </a>
                  <a href={OPENAPI_JSON_URL}
                    className="flex items-center gap-3 p-4 rounded-xl border border-border/60 bg-card/40 hover:bg-card/60 transition-colors"
                  >
                    <Package className="w-5 h-5 text-amber-400 shrink-0" />
                    <div>
                      <p className="text-sm font-semibold">openapi.json</p>
                      <code className="text-xs text-muted-foreground">/api/openapi.json</code>
                    </div>
                  </a>
                </div>
              </div>

              {/* Swagger */}
              <div className="space-y-3">
                <h3 className="text-base font-semibold">Interactive API Explorer</h3>
                <p className="text-sm text-muted-foreground">
                  Browse all 370 API endpoints, view request/response schemas, and explore models in the Swagger UI.
                  No login required to browse.
                </p>
                <a href={SWAGGER_URL}
                  className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
                >
                  <Play className="w-4 h-4" /> Open API Explorer <ExternalLink className="w-3.5 h-3.5 opacity-70" />
                </a>
              </div>

              {/* Postman */}
              <div className="space-y-3">
                <h3 className="text-base font-semibold">Postman Collection</h3>
                <p className="text-sm text-muted-foreground">
                  Import the curated Postman collection to test the key merchant APIs.
                  Variables: <code className="bg-card border border-border/40 px-1 rounded text-xs">{"{{base_url}}"}</code>{" "}
                  <code className="bg-card border border-border/40 px-1 rounded text-xs">{"{{merchant_token}}"}</code>{" "}
                  <code className="bg-card border border-border/40 px-1 rounded text-xs">{"{{merchant_id}}"}</code>
                </p>
                <div className="bg-card/80 border border-border/60 rounded-lg p-4 text-sm space-y-2">
                  <p className="font-medium">To import into Postman:</p>
                  <ol className="space-y-1 text-muted-foreground text-xs list-decimal list-inside">
                    <li>Download <code className="text-cyan-400">rasokart.postman_collection.json</code> from the RasoKart GitHub repository</li>
                    <li>Open Postman → Import → Upload File</li>
                    <li>Or: <strong>Import from OpenAPI</strong> using <code className="text-cyan-400">{OPENAPI_YAML_URL}</code></li>
                    <li>Set <code className="text-cyan-400">{"{{base_url}}"}</code> to <code className="text-cyan-400">{BASE_URL}</code></li>
                    <li>Run <code className="text-cyan-400">POST {"{{base_url}}"}/auth/login</code> and copy the token to <code className="text-cyan-400">{"{{merchant_token}}"}</code></li>
                  </ol>
                </div>
                <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-xs text-amber-200/80">
                  <strong className="text-amber-300">Tip:</strong> You can also paste the OpenAPI YAML URL directly into Postman's "Import from Link" to auto-generate the full collection from the live spec.
                </div>
              </div>

              {/* Docs subdomain note */}
              <div className="rounded-xl border border-border/60 bg-card/40 p-4 text-sm space-y-2">
                <p className="font-medium flex items-center gap-2"><Globe className="w-4 h-4 text-muted-foreground" /> Planned: Developer Subdomain</p>
                <p className="text-muted-foreground text-xs">
                  <code>docs.rasokart.com</code> and <code>developers.rasokart.com</code> are planned subdomains.
                  Currently all documentation is available at <code>rasokart.com/api-docs</code> and <code>rasokart.com/api/swagger</code>.
                  DNS configuration is a separate deployment step requiring manual approval.
                </p>
              </div>
            </section>

            <div className="border-t border-border/40" />

            {/* CTA */}
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <h2 className="font-bold mb-1">Ready to build?</h2>
                <p className="text-muted-foreground text-sm">Get your API keys from the merchant dashboard and start integrating.</p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Link href="/merchant/login" className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity">
                  Get API Keys <ArrowRight className="w-3.5 h-3.5" />
                </Link>
                <a href={SWAGGER_URL} className="inline-flex items-center gap-2 border border-border/60 px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:border-border transition-colors">
                  <Play className="w-3.5 h-3.5" /> API Explorer
                </a>
                <Link href="/integration-guide" className="inline-flex items-center gap-2 border border-border/60 px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:border-border transition-colors">
                  Integration Guide
                </Link>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-muted-foreground/60 pt-4 border-t border-border/40">
              <span>© {new Date().getFullYear()} Nickey Collection Private Limited. All rights reserved.</span>
              <span>Last Updated: {LAST_UPDATED}</span>
            </div>
          </main>
        </div>
      </div>

      <SiteFooter />
    </div>
  );
}
