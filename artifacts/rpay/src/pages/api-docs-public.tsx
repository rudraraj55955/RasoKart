import { useEffect } from "react";
import { Link } from "wouter";
import { RasoKartLogo } from "@/components/ui/rasokart-logo";
import { SiteFooter } from "@/components/ui/site-footer";
import { useCompanySettings } from "@/lib/company-settings";
import {
  Code2, Key, Webhook, Shield, ArrowRight, Terminal, Zap, Lock, BookOpen,
  CheckCircle2, Globe, FileText,
} from "lucide-react";

const LAST_UPDATED = "20 July 2026";
const BASE_URL = "https://rasokart.com/api";

const sections = [
  { id: "auth", title: "Authentication" },
  { id: "payments", title: "Payments & Collections" },
  { id: "payouts", title: "Payouts & Disbursements" },
  { id: "webhooks", title: "Webhooks" },
  { id: "errors", title: "Error Codes" },
];

const authEndpoints = [
  { method: "POST", path: "/api/auth/login", desc: "Authenticate and get a JWT token", auth: false },
  { method: "GET", path: "/api/auth/me", desc: "Get current authenticated user", auth: true },
];

const paymentEndpoints = [
  { id: "pay-txn-list", method: "GET", path: "/api/transactions", desc: "List all transactions (paginated)", auth: true },
  { id: "pay-txn-get", method: "GET", path: "/api/transactions/:id", desc: "Get a single transaction by ID", auth: true },
  { id: "pay-qr-list", method: "GET", path: "/api/qr-codes", desc: "List QR codes for your account", auth: true },
  { id: "pay-qr-create", method: "POST", path: "/api/qr-codes", desc: "Create a new QR code payment", auth: true },
  { id: "pay-va-list", method: "GET", path: "/api/virtual-accounts", desc: "List virtual accounts", auth: true },
  { id: "pay-dep-list", method: "GET", path: "/api/deposits", desc: "List all deposit transactions", auth: true },
  { id: "pay-link-list", method: "GET", path: "/api/payment-links", desc: "List payment links", auth: true },
];

const payoutEndpoints = [
  { id: "pout-list", method: "GET", path: "/api/withdrawals", desc: "List payout requests", auth: true },
  { id: "pout-create", method: "POST", path: "/api/withdrawals", desc: "Create a payout request", auth: true },
  { id: "pout-ben-list", method: "GET", path: "/api/payout-beneficiaries", desc: "List payout beneficiaries", auth: true },
  { id: "pout-ben-add", method: "POST", path: "/api/payout-beneficiaries", desc: "Add a payout beneficiary", auth: true },
];

const webhookEvents = [
  { event: "payment.success", desc: "Payment collected successfully" },
  { event: "payment.failed", desc: "Payment attempt failed" },
  { event: "payment.refunded", desc: "Refund processed for a transaction" },
  { event: "payout.completed", desc: "Payout disbursed to beneficiary" },
  { event: "payout.failed", desc: "Payout disbursement failed" },
  { event: "payout.reversed", desc: "Payout reversed by provider" },
  { event: "account.kyc_approved", desc: "Merchant KYC approved" },
  { event: "account.suspended", desc: "Merchant account suspended" },
];

const errorCodes = [
  { code: "400", meaning: "Bad Request — missing or invalid parameters" },
  { code: "401", meaning: "Unauthorized — invalid or missing API key" },
  { code: "403", meaning: "Forbidden — insufficient permissions for this action" },
  { code: "404", meaning: "Not Found — resource does not exist" },
  { code: "409", meaning: "Conflict — resource already exists or state conflict" },
  { code: "422", meaning: "Unprocessable Entity — validation failed" },
  { code: "429", meaning: "Too Many Requests — rate limit exceeded" },
  { code: "500", meaning: "Internal Server Error — contact support" },
  { code: "503", meaning: "Service Unavailable — temporary outage" },
];

function EndpointRow({ id, method, path, desc, auth }: { id?: string; method: string; path: string; desc: string; auth: boolean }) {
  return (
    <tr className="hover:bg-card/40 transition-colors">
      <td className="py-3 px-4 w-16">
        <span className={`text-xs font-mono font-bold ${method === "GET" ? "text-emerald-400" : "text-amber-400"}`}>{method}</span>
      </td>
      <td className="py-3 px-4">
        <code className="text-xs font-mono text-cyan-400">{path}</code>
      </td>
      <td className="py-3 px-4 text-xs text-muted-foreground">{desc}</td>
      <td className="py-3 px-4 text-xs">
        {auth ? <span className="text-amber-400 flex items-center gap-1"><Lock className="w-3 h-3" />Auth</span> : <span className="text-emerald-400">Public</span>}
      </td>
    </tr>
  );
}

export default function ApiDocsPublic() {
  const { supportEmail } = useCompanySettings();

  useEffect(() => {
    document.title = "API Documentation — RasoKart Developer Reference";
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2.5 shrink-0">
            <RasoKartLogo size={32} />
            <span className="font-bold text-base hidden sm:block">RasoKart</span>
          </Link>
          <span className="text-sm font-medium text-foreground">API Documentation</span>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <Link href="/integration-guide" className="hover:text-foreground transition-colors hidden sm:block">Integration Guide</Link>
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
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-primary/30 bg-primary/10 text-primary text-xs font-medium mb-4">
                <Code2 className="w-3.5 h-3.5" />
                REST API · Last Updated: {LAST_UPDATED}
              </div>
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">API Reference</h1>
              <p className="text-muted-foreground leading-relaxed max-w-2xl">
                The RasoKart API is a RESTful service over HTTPS. All requests and responses use JSON. Authentication is via JWT Bearer tokens generated from your API key.
              </p>
              <div className="mt-4 rounded-xl border border-border/60 bg-card/40 p-4 text-sm">
                <p className="text-xs text-muted-foreground mb-1">Base URL</p>
                <code className="font-mono text-cyan-400">{BASE_URL}</code>
              </div>
            </div>

            <div className="border-t border-border/40" />

            {/* Authentication */}
            <section id="auth" className="space-y-4" style={{ scrollMarginTop: "6rem" }}>
              <div className="flex items-center gap-2 mb-4">
                <div className="p-2 rounded-lg bg-card border border-border/50">
                  <Key className="w-4 h-4 text-amber-400" />
                </div>
                <h2 className="text-xl font-semibold">Authentication</h2>
              </div>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Most endpoints require authentication. Pass your JWT token in the Authorization header:
              </p>
              <div className="bg-card/80 border border-border/60 rounded-lg p-3 font-mono text-xs text-cyan-400">
                Authorization: Bearer YOUR_JWT_TOKEN
              </div>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Obtain a token by POSTing your merchant credentials to <code className="bg-card border border-border/40 px-1 rounded">/api/auth/login</code>. Tokens expire after 7 days.
              </p>
              <div className="rounded-xl border border-border/60 overflow-hidden">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-border/60 bg-card/60"><th className="text-left py-3 px-4 text-xs font-medium text-foreground w-16">Method</th><th className="text-left py-3 px-4 text-xs font-medium text-foreground">Endpoint</th><th className="text-left py-3 px-4 text-xs font-medium text-foreground">Description</th><th className="text-left py-3 px-4 text-xs font-medium text-foreground">Auth</th></tr></thead>
                  <tbody className="divide-y divide-border/30">{authEndpoints.map(e => <EndpointRow key={`auth-${e.method}-${e.path}`} {...e} />)}</tbody>
                </table>
              </div>
            </section>

            <div className="border-t border-border/40" />

            {/* Payments */}
            <section id="payments" className="space-y-4" style={{ scrollMarginTop: "6rem" }}>
              <div className="flex items-center gap-2 mb-4">
                <div className="p-2 rounded-lg bg-card border border-border/50">
                  <Globe className="w-4 h-4 text-emerald-400" />
                </div>
                <h2 className="text-xl font-semibold">Payments & Collections</h2>
              </div>
              <div className="rounded-xl border border-border/60 overflow-hidden">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-border/60 bg-card/60"><th className="text-left py-3 px-4 text-xs font-medium text-foreground w-16">Method</th><th className="text-left py-3 px-4 text-xs font-medium text-foreground">Endpoint</th><th className="text-left py-3 px-4 text-xs font-medium text-foreground">Description</th><th className="text-left py-3 px-4 text-xs font-medium text-foreground">Auth</th></tr></thead>
                  <tbody className="divide-y divide-border/30">{paymentEndpoints.map(e => <EndpointRow key={e.id} {...e} />)}</tbody>
                </table>
              </div>
            </section>

            <div className="border-t border-border/40" />

            {/* Payouts */}
            <section id="payouts" className="space-y-4" style={{ scrollMarginTop: "6rem" }}>
              <div className="flex items-center gap-2 mb-4">
                <div className="p-2 rounded-lg bg-card border border-border/50">
                  <Zap className="w-4 h-4 text-violet-400" />
                </div>
                <h2 className="text-xl font-semibold">Payouts & Disbursements</h2>
              </div>
              <div className="rounded-xl border border-border/60 overflow-hidden">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-border/60 bg-card/60"><th className="text-left py-3 px-4 text-xs font-medium text-foreground w-16">Method</th><th className="text-left py-3 px-4 text-xs font-medium text-foreground">Endpoint</th><th className="text-left py-3 px-4 text-xs font-medium text-foreground">Description</th><th className="text-left py-3 px-4 text-xs font-medium text-foreground">Auth</th></tr></thead>
                  <tbody className="divide-y divide-border/30">{payoutEndpoints.map(e => <EndpointRow key={e.id} {...e} />)}</tbody>
                </table>
              </div>
            </section>

            <div className="border-t border-border/40" />

            {/* Webhooks */}
            <section id="webhooks" className="space-y-4" style={{ scrollMarginTop: "6rem" }}>
              <div className="flex items-center gap-2 mb-4">
                <div className="p-2 rounded-lg bg-card border border-border/50">
                  <Webhook className="w-4 h-4 text-blue-400" />
                </div>
                <h2 className="text-xl font-semibold">Webhook Events</h2>
              </div>
              <p className="text-muted-foreground text-sm">Configure a webhook endpoint in your dashboard to receive these events. Each event is signed with HMAC-SHA256.</p>
              <div className="rounded-xl border border-border/60 overflow-hidden">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-border/60 bg-card/60"><th className="text-left py-3 px-4 text-xs font-medium text-foreground">Event</th><th className="text-left py-3 px-4 text-xs font-medium text-foreground">Description</th></tr></thead>
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
                For webhook signature verification, see the <Link href="/integration-guide" className="text-primary hover:underline">Integration Guide</Link>.
              </p>
            </section>

            <div className="border-t border-border/40" />

            {/* Error Codes */}
            <section id="errors" className="space-y-4" style={{ scrollMarginTop: "6rem" }}>
              <div className="flex items-center gap-2 mb-4">
                <div className="p-2 rounded-lg bg-card border border-border/50">
                  <FileText className="w-4 h-4 text-rose-400" />
                </div>
                <h2 className="text-xl font-semibold">Error Codes</h2>
              </div>
              <div className="rounded-xl border border-border/60 overflow-hidden">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-border/60 bg-card/60"><th className="text-left py-3 px-4 text-xs font-medium text-foreground w-16">Code</th><th className="text-left py-3 px-4 text-xs font-medium text-foreground">Meaning</th></tr></thead>
                  <tbody className="divide-y divide-border/30">
                    {errorCodes.map(({ code, meaning }) => (
                      <tr key={code} className="hover:bg-card/40 transition-colors">
                        <td className="py-3 px-4"><span className={`text-xs font-mono font-bold ${code.startsWith("2") ? "text-emerald-400" : code.startsWith("4") ? "text-amber-400" : "text-red-400"}`}>{code}</span></td>
                        <td className="py-3 px-4 text-xs text-muted-foreground">{meaning}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
