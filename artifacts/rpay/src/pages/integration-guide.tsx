import { useEffect } from "react";
import { Link } from "wouter";
import { RasoKartLogo } from "@/components/ui/rasokart-logo";
import { SiteFooter } from "@/components/ui/site-footer";
import { useCompanySettings } from "@/lib/company-settings";
import {
  Code2, Key, Webhook, Shield, CheckCircle2, ArrowRight, Terminal, Zap, Globe, Lock, BookOpen, FileText, ChevronRight,
} from "lucide-react";

const LAST_UPDATED = "20 July 2026";
const API_BASE = "https://rasokart.com/api";

const steps = [
  {
    step: "01", icon: Key, color: "text-violet-400",
    title: "Create a Merchant Account",
    desc: "Sign up and complete KYC verification. Once your account is approved, you'll have access to the merchant dashboard.",
    action: { label: "Create Account", href: "/merchant/login" },
  },
  {
    step: "02", icon: Code2, color: "text-blue-400",
    title: "Get Your API Keys",
    desc: "Navigate to API Keys in your merchant dashboard. Generate your live or test API key. Keep your secret key confidential — it is never visible again after creation.",
    action: { label: "Go to API Keys", href: "/merchant/api-keys" },
  },
  {
    step: "03", icon: Terminal, color: "text-emerald-400",
    title: "Make Your First API Call",
    desc: "Use your API key to authenticate requests. Pass it in the Authorization header as a Bearer token. Start with the health endpoint to verify connectivity.",
    code: `curl https://rasokart.com/api/healthz \\
  -H "Authorization: Bearer rasokart_live_YOUR_KEY"`,
  },
  {
    step: "04", icon: Webhook, color: "text-amber-400",
    title: "Configure Webhooks",
    desc: "Set up a webhook endpoint in your dashboard to receive real-time payment status updates. All webhook payloads are HMAC-SHA256 signed.",
    action: { label: "Configure Webhooks", href: "/merchant/webhook" },
  },
  {
    step: "05", icon: CheckCircle2, color: "text-cyan-400",
    title: "Go Live",
    desc: "Test your integration in development mode, then switch to your live API key. Monitor transactions and webhook deliveries from your dashboard.",
    action: { label: "View API Docs", href: "/api-docs" },
  },
];

const integrationTypes = [
  {
    icon: Globe, color: "text-blue-400", title: "Redirect / Hosted Page",
    desc: "Redirect customers to a RasoKart-hosted payment page. The simplest integration — no frontend code required.",
    when: "Best for: Simple checkouts, minimal dev effort, maximum security",
    pci: "PCI Scope: SAQ A",
  },
  {
    icon: Code2, color: "text-violet-400", title: "Embedded / QR Code",
    desc: "Generate a QR code or payment link and embed it in your checkout. Customers scan or click to pay via UPI.",
    when: "Best for: UPI-first flows, physical stores, WhatsApp commerce",
    pci: "PCI Scope: Out of card PCI scope (UPI only)",
  },
  {
    icon: Terminal, color: "text-emerald-400", title: "API / Server-to-Server",
    desc: "Create payment orders, virtual accounts, or payout requests directly via REST API from your server.",
    when: "Best for: Custom checkout flows, payouts, platform integrations",
    pci: "PCI Scope: SAQ A-EP or SAQ D depending on implementation",
  },
  {
    icon: Webhook, color: "text-amber-400", title: "Webhook Events",
    desc: "Receive real-time event notifications for payment success, failure, refund, payout status, and more.",
    when: "Best for: All integrations (required for reliable payment confirmation)",
    pci: "Not card-bearing — standard webhook security applies",
  },
];

const endpoints = [
  { method: "GET", path: "/api/healthz", desc: "API health check — verify connectivity" },
  { method: "POST", path: "/api/auth/login", desc: "Merchant authentication — returns JWT token" },
  { method: "GET", path: "/api/dashboard", desc: "Fetch dashboard summary (auth required)" },
  { method: "GET", path: "/api/transactions", desc: "List transactions with filtering (auth required)" },
  { method: "GET", path: "/api/api-keys", desc: "List your API keys (auth required)" },
  { method: "POST", path: "/api/api-keys", desc: "Generate a new API key (auth required)" },
  { method: "GET", path: "/api/webhooks", desc: "List webhook configurations (auth required)" },
  { method: "POST", path: "/api/webhooks", desc: "Create/update webhook endpoint (auth required)" },
];

export default function IntegrationGuide() {
  const { supportEmail } = useCompanySettings();

  useEffect(() => {
    document.title = "Integration Guide — RasoKart Developer Docs";
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2.5 shrink-0">
            <RasoKartLogo size={32} />
            <span className="font-bold text-base hidden sm:block">RasoKart</span>
          </Link>
          <span className="text-sm font-medium text-foreground">Integration Guide</span>
          <nav className="hidden md:flex items-center gap-4 text-xs text-muted-foreground">
            <Link href="/api-docs" className="hover:text-foreground transition-colors">API Docs</Link>
            <Link href="/merchant/api-keys" className="hover:text-foreground transition-colors">API Keys</Link>
            <Link href="/contact-us" className="hover:text-foreground transition-colors">Support</Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border/40">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 via-transparent to-primary/5 pointer-events-none" />
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-16 lg:py-20 w-full">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-xs font-medium mb-6">
            <Code2 className="w-3.5 h-3.5" />
            Developer Integration Guide · Last Updated: {LAST_UPDATED}
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-4">
            Integrate RasoKart in <span className="text-primary">Minutes</span>
          </h1>
          <p className="text-muted-foreground text-lg leading-relaxed max-w-2xl mb-8">
            A practical guide to integrating RasoKart payment infrastructure into your application. From your first API call to a production-ready integration.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/merchant/login" className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 rounded-lg font-medium text-sm hover:opacity-90 transition-opacity">
              Get API Keys <ArrowRight className="w-4 h-4" />
            </Link>
            <Link href="/api-docs" className="inline-flex items-center gap-2 border border-border/60 px-5 py-2.5 rounded-lg font-medium text-sm text-muted-foreground hover:text-foreground hover:border-border transition-colors">
              API Reference <BookOpen className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Quick Start Steps */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 py-16 w-full">
        <h2 className="text-2xl font-bold tracking-tight mb-2">Quick Start</h2>
        <p className="text-muted-foreground text-sm mb-8">Get from zero to a working integration in 5 steps.</p>
        <div className="space-y-4">
          {steps.map(({ step, icon: Icon, color, title, desc, action, code }) => (
            <div key={step} className="rounded-xl border border-border/60 bg-card/40 p-6">
              <div className="flex items-start gap-4">
                <div className="shrink-0">
                  <div className="w-8 h-8 rounded-full bg-card border border-border/60 flex items-center justify-center text-xs font-bold text-muted-foreground">{step}</div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <Icon className={`w-4 h-4 ${color}`} />
                    <h3 className="font-semibold text-sm">{title}</h3>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed mb-3">{desc}</p>
                  {code && (
                    <div className="bg-card/80 border border-border/60 rounded-lg p-3 font-mono text-xs text-emerald-400 overflow-x-auto">
                      <pre>{code}</pre>
                    </div>
                  )}
                  {action && (
                    <Link href={action.href} className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline">
                      {action.label} <ArrowRight className="w-3 h-3" />
                    </Link>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Integration Types */}
      <section className="border-t border-border/40 bg-card/20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-16 w-full">
          <h2 className="text-2xl font-bold tracking-tight mb-2">Integration Types</h2>
          <p className="text-muted-foreground text-sm mb-8">Choose the integration pattern that best suits your use case.</p>
          <div className="grid sm:grid-cols-2 gap-4">
            {integrationTypes.map(({ icon: Icon, color, title, desc, when, pci }) => (
              <div key={title} className="rounded-xl border border-border/60 bg-card/40 p-6">
                <div className="flex items-center gap-2 mb-3">
                  <div className="p-2 rounded-lg bg-card border border-border/50">
                    <Icon className={`w-4 h-4 ${color}`} />
                  </div>
                  <h3 className="font-semibold text-sm">{title}</h3>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed mb-3">{desc}</p>
                <p className="text-xs text-muted-foreground">{when}</p>
                <p className="text-xs text-muted-foreground/60 mt-1">{pci}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Authentication */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 py-16 w-full">
        <h2 className="text-2xl font-bold tracking-tight mb-2">Authentication</h2>
        <p className="text-muted-foreground text-sm mb-6">All API requests require authentication using your API key as a Bearer token.</p>
        <div className="rounded-xl border border-border/60 bg-card/40 p-6 space-y-4">
          <div>
            <p className="text-xs text-muted-foreground mb-2">Request Header</p>
            <div className="bg-card/80 border border-border/60 rounded-lg p-3 font-mono text-xs text-cyan-400">
              Authorization: Bearer rasokart_live_YOUR_API_KEY
            </div>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-2">Example cURL</p>
            <div className="bg-card/80 border border-border/60 rounded-lg p-3 font-mono text-xs text-emerald-400 overflow-x-auto">
              <pre>{`curl ${API_BASE}/transactions \\
  -H "Authorization: Bearer rasokart_live_YOUR_API_KEY" \\
  -H "Content-Type: application/json"`}</pre>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 mt-4">
          <div className="flex items-start gap-2 text-sm">
            <Lock className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-foreground mb-1">Keep your API key secret</p>
              <p className="text-xs text-muted-foreground">Never include API keys in client-side JavaScript, mobile app binaries, or public repositories. Use environment variables or a secrets manager. Rotate keys immediately if compromised.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Webhooks */}
      <section className="border-t border-border/40 bg-card/20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-16 w-full">
          <h2 className="text-2xl font-bold tracking-tight mb-2">Webhooks</h2>
          <p className="text-muted-foreground text-sm mb-6">Receive real-time notifications for payment events. All webhooks are signed with HMAC-SHA256.</p>
          <div className="rounded-xl border border-border/60 bg-card/40 p-6 space-y-4">
            <div>
              <p className="text-xs text-muted-foreground mb-2">Signature Verification (Node.js)</p>
              <div className="bg-card/80 border border-border/60 rounded-lg p-3 font-mono text-xs text-violet-400 overflow-x-auto">
                <pre>{`const crypto = require('crypto');

function verifyWebhook(payload, signature, secret) {
  const computed = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(computed),
    Buffer.from(signature)
  );
}`}</pre>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Always verify the webhook signature before processing events. The signature is sent in the <code className="bg-card border border-border/40 px-1 py-0.5 rounded text-xs">X-RasoKart-Signature</code> header.
            </p>
          </div>
        </div>
      </section>

      {/* API Endpoints Reference */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 py-16 w-full">
        <h2 className="text-2xl font-bold tracking-tight mb-2">Core Endpoints</h2>
        <p className="text-muted-foreground text-sm mb-6">Key REST API endpoints. See the full <Link href="/api-docs" className="text-primary hover:underline">API Reference</Link> for complete documentation.</p>
        <div className="rounded-xl border border-border/60 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60 bg-card/60">
                <th className="text-left py-3 px-4 font-medium text-foreground text-xs w-20">Method</th>
                <th className="text-left py-3 px-4 font-medium text-foreground text-xs">Endpoint</th>
                <th className="text-left py-3 px-4 font-medium text-foreground text-xs">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {endpoints.map(({ method, path, desc }) => (
                <tr key={path} className="hover:bg-card/40 transition-colors">
                  <td className="py-3 px-4">
                    <span className={`text-xs font-mono font-bold ${method === "GET" ? "text-emerald-400" : "text-amber-400"}`}>{method}</span>
                  </td>
                  <td className="py-3 px-4">
                    <code className="text-xs font-mono text-cyan-400">{path}</code>
                  </td>
                  <td className="py-3 px-4 text-xs text-muted-foreground">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Security */}
      <section className="border-t border-border/40 bg-card/20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-12 w-full">
          <h2 className="text-xl font-bold tracking-tight mb-6">Security Best Practices</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            {[
              { icon: Lock, color: "text-emerald-400", title: "Never expose API keys client-side", desc: "All API calls must originate from your server. Never embed keys in JavaScript or mobile apps." },
              { icon: Shield, color: "text-violet-400", title: "Always verify webhook signatures", desc: "Check the HMAC-SHA256 signature on every webhook before processing the event." },
              { icon: Key, color: "text-amber-400", title: "Rotate keys if compromised", desc: "If an API key is leaked, rotate it immediately from your dashboard. Old keys are invalidated instantly." },
              { icon: Zap, color: "text-blue-400", title: "Use HTTPS everywhere", desc: "All API calls must be made over HTTPS. HTTP requests are rejected." },
            ].map(({ icon: Icon, color, title, desc }) => (
              <div key={title} className="rounded-xl border border-border/60 bg-card/40 p-4 flex gap-3">
                <div className="p-2 rounded-lg bg-card border border-border/50 h-fit">
                  <Icon className={`w-4 h-4 ${color}`} />
                </div>
                <div>
                  <h3 className="font-semibold text-sm mb-1">{title}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Help */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 py-12 w-full">
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2 className="font-bold mb-1">Need help with your integration?</h2>
            <p className="text-muted-foreground text-sm">Our technical support team is available to help you integrate RasoKart into your platform.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/api-docs" className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity">
              Full API Docs <ArrowRight className="w-3.5 h-3.5" />
            </Link>
            <Link href="/contact-us" className="inline-flex items-center gap-2 border border-border/60 px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:border-border transition-colors">
              Contact Support
            </Link>
          </div>
        </div>
        <p className="text-xs text-muted-foreground/60 mt-6">
          Last Updated: {LAST_UPDATED} ·{" "}
          <Link href="/pci-dss-security" className="hover:text-muted-foreground transition-colors">PCI DSS Info</Link> ·{" "}
          <Link href="/responsible-disclosure" className="hover:text-muted-foreground transition-colors">Security Disclosure</Link>
        </p>
      </section>

      <SiteFooter />
    </div>
  );
}
