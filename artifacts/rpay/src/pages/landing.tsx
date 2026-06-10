import { Link } from "wouter";
import { RasoKartLogo } from "@/components/ui/rasokart-logo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  QrCode,
  Landmark,
  Wallet,
  Zap,
  BarChart3,
  Shield,
  Globe,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Code2,
  Bell,
  FileText,
  Users,
  TrendingUp,
  Lock,
  Mail,
  Phone,
  MapPin,
  IndianRupee,
  BookOpen,
  Terminal,
  Webhook,
  Key,
} from "lucide-react";

const services = [
  {
    icon: QrCode,
    title: "QR Collection",
    description:
      "Generate dynamic and static QR codes for instant UPI payments. Track every scan and collection in real time.",
    color: "text-cyan-400",
    bg: "bg-cyan-400/10",
  },
  {
    icon: Landmark,
    title: "Virtual Accounts",
    description:
      "Assign unique virtual bank accounts to each merchant for seamless NEFT, RTGS, and IMPS collections.",
    color: "text-violet-400",
    bg: "bg-violet-400/10",
  },
  {
    icon: Wallet,
    title: "UPI Collection",
    description:
      "Accept UPI payments via VPA aliases, payment links, or QR — fully reconciled and audited automatically.",
    color: "text-emerald-400",
    bg: "bg-emerald-400/10",
  },
  {
    icon: Zap,
    title: "Payout API",
    description:
      "Disburse funds instantly to bank accounts and UPI IDs via a single REST API with webhook callbacks.",
    color: "text-amber-400",
    bg: "bg-amber-400/10",
  },
  {
    icon: FileText,
    title: "Payment Links",
    description:
      "Create shareable, trackable payment links for invoices, subscriptions, and one-time collections.",
    color: "text-rose-400",
    bg: "bg-rose-400/10",
  },
  {
    icon: BarChart3,
    title: "Reconciliation Engine",
    description:
      "Automated matching of deposits against settlements with period-overlap logic and full audit trail.",
    color: "text-blue-400",
    bg: "bg-blue-400/10",
  },
];

const merchantFeatures = [
  { icon: TrendingUp, label: "Real-time deposit & balance dashboard" },
  { icon: QrCode, label: "QR code generation & scan tracking" },
  { icon: Landmark, label: "Virtual account management" },
  { icon: Code2, label: "API key & webhook configuration" },
  { icon: FileText, label: "Settlement & withdrawal requests" },
  { icon: Bell, label: "Smart notification alerts" },
  { icon: BarChart3, label: "Collection trend charts" },
  { icon: Lock, label: "Role-based access control" },
];

const planFeatures = [
  "Unlimited QR code generation",
  "Virtual account provisioning",
  "UPI collection with auto-reconciliation",
  "Real-time webhook delivery",
  "API integration with sandbox",
  "Dedicated account manager",
  "24/7 technical support",
  "SLA-backed uptime guarantee",
];

const stats = [
  { value: "₹500Cr+", label: "Processed Monthly" },
  { value: "10,000+", label: "Active Merchants" },
  { value: "99.9%", label: "Uptime SLA" },
  { value: "< 2s", label: "Avg Settlement Time" },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground antialiased">
      {/* NAV */}
      <header className="fixed inset-x-0 top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <RasoKartLogo size={36} />
            <span className="text-xl font-bold tracking-tight">RasoKart</span>
          </div>
          <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <a href="#services" className="transition-colors hover:text-foreground">Services</a>
            <a href="#features" className="transition-colors hover:text-foreground">Dashboard</a>
            <a href="#settlement" className="transition-colors hover:text-foreground">Settlement</a>
            <a href="#api-docs" className="transition-colors hover:text-foreground">API Docs</a>
            <a href="#plans" className="transition-colors hover:text-foreground">Plans</a>
            <a href="#contact" className="transition-colors hover:text-foreground">Contact</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/merchant">
              <Button variant="ghost" size="sm">Merchant Login</Button>
            </Link>
            <Link href="/admin">
              <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90">
                Admin Portal
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* HERO */}
      <section className="relative flex min-h-screen items-center overflow-hidden pt-16">
        {/* glow blobs */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-40 left-1/4 h-[600px] w-[600px] rounded-full bg-cyan-500/10 blur-3xl" />
          <div className="absolute bottom-0 right-1/4 h-[500px] w-[500px] rounded-full bg-violet-500/10 blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:py-32">
          <div className="max-w-3xl">
            <Badge className="mb-6 border-cyan-400/30 bg-cyan-400/10 text-cyan-400" variant="outline">
              India's Leading Payment Infrastructure
            </Badge>
            <h1 className="mb-6 text-5xl font-extrabold leading-tight tracking-tight sm:text-6xl lg:text-7xl">
              Collect Smarter,{" "}
              <span className="bg-gradient-to-r from-cyan-400 to-violet-400 bg-clip-text text-transparent">
                Settle Faster
              </span>
            </h1>
            <p className="mb-10 max-w-2xl text-lg text-muted-foreground sm:text-xl">
              RasoKart provides enterprise-grade QR, UPI, and virtual account collection infrastructure
              with real-time reconciliation, instant payouts, and a powerful merchant dashboard — all
              from a single platform.
            </p>
            <div className="flex flex-wrap gap-4">
              <Link href="/merchant/apply">
                <Button size="lg" className="gap-2 bg-gradient-to-r from-cyan-500 to-violet-500 text-white hover:opacity-90">
                  Apply as Merchant
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link href="/merchant">
                <Button size="lg" variant="outline" className="gap-2 border-border/60">
                  Merchant Login
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </div>

          {/* Stats row */}
          <div className="mt-20 grid grid-cols-2 gap-6 sm:grid-cols-4">
            {stats.map((s) => (
              <div key={s.label} className="rounded-2xl border border-border/40 bg-card/40 p-5 backdrop-blur-sm">
                <div className="text-2xl font-bold text-foreground sm:text-3xl">{s.value}</div>
                <div className="mt-1 text-sm text-muted-foreground">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SERVICES */}
      <section id="services" className="relative py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="mb-16 text-center">
            <Badge className="mb-4 border-violet-400/30 bg-violet-400/10 text-violet-400" variant="outline">
              Payment Services
            </Badge>
            <h2 className="text-4xl font-bold tracking-tight sm:text-5xl">
              Everything You Need to{" "}
              <span className="bg-gradient-to-r from-cyan-400 to-violet-400 bg-clip-text text-transparent">
                Collect Payments
              </span>
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">
              From QR codes to virtual accounts — RasoKart gives you every payment collection method
              under one roof, with unified reporting.
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {services.map((svc) => (
              <div
                key={svc.title}
                className="group rounded-2xl border border-border/40 bg-card/40 p-6 backdrop-blur-sm transition-all hover:border-border/80 hover:bg-card/70"
              >
                <div className={`mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl ${svc.bg}`}>
                  <svc.icon className={`h-6 w-6 ${svc.color}`} />
                </div>
                <h3 className="mb-2 text-lg font-semibold">{svc.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{svc.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* MERCHANT FEATURES */}
      <section id="features" className="relative py-24">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute left-0 top-1/2 h-[400px] w-[400px] -translate-y-1/2 rounded-full bg-emerald-500/8 blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-7xl px-4 sm:px-6">
          <div className="grid items-center gap-16 lg:grid-cols-2">
            <div>
              <Badge className="mb-4 border-emerald-400/30 bg-emerald-400/10 text-emerald-400" variant="outline">
                Merchant Dashboard
              </Badge>
              <h2 className="mb-6 text-4xl font-bold tracking-tight sm:text-5xl">
                A Dashboard Built for{" "}
                <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
                  Growing Businesses
                </span>
              </h2>
              <p className="mb-8 text-muted-foreground">
                Your merchant portal gives you full visibility into every collection, transaction,
                and settlement — with analytics, alerts, and API integrations at your fingertips.
              </p>
              <Link href="/merchant/apply">
                <Button className="gap-2 bg-gradient-to-r from-emerald-500 to-cyan-500 text-white hover:opacity-90">
                  Get Started Today
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {merchantFeatures.map((f) => (
                <div
                  key={f.label}
                  className="flex items-center gap-3 rounded-xl border border-border/40 bg-card/40 p-4 text-sm"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <f.icon className="h-4 w-4 text-primary" />
                  </div>
                  <span className="leading-tight text-foreground/80">{f.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* PLANS / WHY RASOKART */}
      <section id="plans" className="relative py-24">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute right-0 top-1/2 h-[400px] w-[400px] -translate-y-1/2 rounded-full bg-amber-500/8 blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-7xl px-4 sm:px-6">
          <div className="mb-16 text-center">
            <Badge className="mb-4 border-amber-400/30 bg-amber-400/10 text-amber-400" variant="outline">
              Why RasoKart
            </Badge>
            <h2 className="text-4xl font-bold tracking-tight sm:text-5xl">
              Enterprise Infrastructure,{" "}
              <span className="bg-gradient-to-r from-amber-400 to-rose-400 bg-clip-text text-transparent">
                Startup Pricing
              </span>
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">
              Plans starting free — scale as you grow with Silver, Gold, Platinum, and custom
              enterprise tiers. Every plan includes core collection features.
            </p>
          </div>

          <div className="mx-auto max-w-3xl rounded-2xl border border-border/40 bg-card/40 p-8 backdrop-blur-sm">
            <div className="grid gap-3 sm:grid-cols-2">
              {planFeatures.map((f) => (
                <div key={f} className="flex items-center gap-3 text-sm">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                  <span className="text-foreground/80">{f}</span>
                </div>
              ))}
            </div>
            <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-border/40 pt-6">
              <div>
                <div className="text-sm text-muted-foreground">Plans starting at</div>
                <div className="text-3xl font-bold">
                  Free <span className="text-lg font-normal text-muted-foreground">— Starter plan</span>
                </div>
              </div>
              <Link href="/merchant/apply">
                <Button className="gap-2 bg-gradient-to-r from-amber-500 to-rose-500 text-white hover:opacity-90">
                  Apply Now
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* SETTLEMENT DASHBOARD */}
      <section id="settlement" className="relative py-24">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute right-0 top-0 h-[400px] w-[400px] rounded-full bg-violet-500/8 blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-7xl px-4 sm:px-6">
          <div className="grid items-center gap-16 lg:grid-cols-2">
            {/* Visual mock */}
            <div className="order-2 lg:order-1">
              <div className="rounded-2xl border border-border/40 bg-card/40 p-6 backdrop-blur-sm">
                <div className="mb-4 flex items-center justify-between">
                  <span className="text-sm font-semibold">Settlement Overview</span>
                  <Badge className="border-emerald-400/30 bg-emerald-400/10 text-emerald-400" variant="outline">Live</Badge>
                </div>
                <div className="space-y-3">
                  {[
                    { label: "Total Collected", value: "₹12,45,600", change: "+8.2%", color: "text-emerald-400" },
                    { label: "Pending Settlement", value: "₹3,20,000", change: "4 requests", color: "text-amber-400" },
                    { label: "Settled This Month", value: "₹9,25,600", change: "12 batches", color: "text-cyan-400" },
                    { label: "Available Balance", value: "₹1,82,400", change: "Withdrawable", color: "text-violet-400" },
                  ].map((row) => (
                    <div key={row.label} className="flex items-center justify-between rounded-xl border border-border/30 bg-background/30 px-4 py-3">
                      <div>
                        <div className="text-xs text-muted-foreground">{row.label}</div>
                        <div className={`text-lg font-bold ${row.color}`}>{row.value}</div>
                      </div>
                      <div className="text-xs text-muted-foreground">{row.change}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex gap-2">
                  <div className="flex-1 rounded-lg border border-border/30 bg-emerald-500/10 px-3 py-2 text-center text-xs text-emerald-400">Request Settlement</div>
                  <div className="flex-1 rounded-lg border border-border/30 bg-primary/10 px-3 py-2 text-center text-xs text-primary">View History</div>
                </div>
              </div>
            </div>

            {/* Copy */}
            <div className="order-1 lg:order-2">
              <Badge className="mb-4 border-violet-400/30 bg-violet-400/10 text-violet-400" variant="outline">
                Settlement Dashboard
              </Badge>
              <h2 className="mb-6 text-4xl font-bold tracking-tight sm:text-5xl">
                Track Every Rupee,{" "}
                <span className="bg-gradient-to-r from-violet-400 to-cyan-400 bg-clip-text text-transparent">
                  Settle on Schedule
                </span>
              </h2>
              <p className="mb-6 text-muted-foreground">
                Merchants get a real-time settlement dashboard showing collected funds, pending
                disbursements, and full balance history — with one-click withdrawal requests.
              </p>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { icon: IndianRupee, label: "Real-time balance visibility" },
                  { icon: CheckCircle2, label: "One-click withdrawal requests" },
                  { icon: BarChart3, label: "Collection trend charts" },
                  { icon: FileText, label: "Downloadable settlement CSV" },
                  { icon: Bell, label: "Settlement status alerts" },
                  { icon: TrendingUp, label: "Month-on-month comparison" },
                ].map((f) => (
                  <div key={f.label} className="flex items-center gap-2 text-sm text-foreground/80">
                    <f.icon className="h-4 w-4 shrink-0 text-violet-400" />
                    <span>{f.label}</span>
                  </div>
                ))}
              </div>
              <div className="mt-8">
                <Link href="/merchant/apply">
                  <Button className="gap-2 bg-gradient-to-r from-violet-500 to-cyan-500 text-white hover:opacity-90">
                    Get Merchant Access
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* API DOCUMENTATION */}
      <section id="api-docs" className="relative py-24">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute left-0 top-1/2 h-[400px] w-[400px] -translate-y-1/2 rounded-full bg-cyan-500/8 blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-7xl px-4 sm:px-6">
          <div className="mb-16 text-center">
            <Badge className="mb-4 border-cyan-400/30 bg-cyan-400/10 text-cyan-400" variant="outline">
              API Documentation
            </Badge>
            <h2 className="text-4xl font-bold tracking-tight sm:text-5xl">
              Build on RasoKart's{" "}
              <span className="bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
                REST API
              </span>
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">
              A clean, versioned REST API with webhook events, HMAC signature verification,
              and a full sandbox environment for integration testing.
            </p>
          </div>

          <div className="grid gap-8 lg:grid-cols-2">
            {/* Code block */}
            <div className="rounded-2xl border border-border/40 bg-zinc-950 p-6 font-mono text-sm">
              <div className="mb-3 flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-rose-500" />
                <div className="h-3 w-3 rounded-full bg-amber-500" />
                <div className="h-3 w-3 rounded-full bg-emerald-500" />
                <span className="ml-2 text-xs text-zinc-500">collect-payment.sh</span>
              </div>
              <pre className="overflow-x-auto leading-relaxed text-zinc-300">
{`curl -X POST https://rasokart.com/api/callbacks \\
  -H "Content-Type: application/json" \\
  -H "X-Api-Key: rasokart_live_your_key" \\
  -H "X-Signature: sha256=abc123..." \\
  -d '{
    "amount": 50000,
    "orderId": "ORD-2026-001",
    "merchantRef": "INV-101",
    "description": "Product purchase"
  }'

# Response
{
  "status": "success",
  "transactionId": 4821,
  "utr": "SBIN0002026061001234",
  "amount": 50000,
  "timestamp": "2026-06-10T12:34:56Z"
}`}
              </pre>
            </div>

            {/* Feature list */}
            <div className="flex flex-col justify-center gap-6">
              {[
                {
                  icon: Key,
                  title: "API Key Authentication",
                  desc: "Scoped API keys with prefix `rasokart_live_` for production and `rasokart_secret_` for server-side operations.",
                  color: "text-cyan-400",
                  bg: "bg-cyan-400/10",
                },
                {
                  icon: Webhook,
                  title: "Webhook Callbacks",
                  desc: "Real-time HTTPS callbacks with HMAC-SHA256 signature verification. Automatic retry with exponential back-off.",
                  color: "text-violet-400",
                  bg: "bg-violet-400/10",
                },
                {
                  icon: Terminal,
                  title: "Sandbox Environment",
                  desc: "Simulate deposits, test webhook delivery, and verify signature handling — without moving real money.",
                  color: "text-emerald-400",
                  bg: "bg-emerald-400/10",
                },
                {
                  icon: BookOpen,
                  title: "Interactive Docs",
                  desc: "Full OpenAPI documentation with request/response examples, error codes, and code snippets in multiple languages.",
                  color: "text-amber-400",
                  bg: "bg-amber-400/10",
                },
              ].map((f) => (
                <div key={f.title} className="flex gap-4">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${f.bg}`}>
                    <f.icon className={`h-5 w-5 ${f.color}`} />
                  </div>
                  <div>
                    <div className="mb-1 font-semibold">{f.title}</div>
                    <div className="text-sm text-muted-foreground">{f.desc}</div>
                  </div>
                </div>
              ))}

              <Link href="/merchant/api-docs">
                <Button variant="outline" className="w-fit gap-2 border-border/60">
                  <BookOpen className="h-4 w-4" />
                  View Full API Docs
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* SECURITY TRUST STRIP */}
      <section className="border-y border-border/40 bg-card/20 py-12">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-center gap-10 text-muted-foreground">
            {[
              { icon: Shield, label: "PCI-DSS Compliant" },
              { icon: Lock, label: "256-bit TLS Encryption" },
              { icon: Globe, label: "Multi-region Redundancy" },
              { icon: Users, label: "Dedicated Support Team" },
            ].map((t) => (
              <div key={t.label} className="flex items-center gap-2 text-sm">
                <t.icon className="h-4 w-4 text-primary" />
                <span>{t.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CONTACT / APPLY CTA */}
      <section id="contact" className="relative py-24">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute left-1/2 top-1/2 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/8 blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-7xl px-4 sm:px-6">
          <div className="grid gap-12 lg:grid-cols-2">
            {/* CTA */}
            <div className="flex flex-col justify-center">
              <Badge className="mb-4 w-fit border-primary/30 bg-primary/10 text-primary" variant="outline">
                Get Started
              </Badge>
              <h2 className="mb-4 text-4xl font-bold tracking-tight sm:text-5xl">
                Ready to Accept Payments?
              </h2>
              <p className="mb-8 text-muted-foreground">
                Join thousands of merchants on RasoKart. Apply for an account today — our team will
                review and onboard you within 24 hours.
              </p>
              <div className="flex flex-wrap gap-4">
                <Link href="/merchant/apply">
                  <Button size="lg" className="gap-2 bg-gradient-to-r from-cyan-500 to-violet-500 text-white hover:opacity-90">
                    Apply as Merchant
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
                <Link href="/merchant">
                  <Button size="lg" variant="outline" className="gap-2 border-border/60">
                    Existing Merchant Login
                  </Button>
                </Link>
              </div>
            </div>

            {/* Contact info */}
            <div className="flex flex-col justify-center gap-6">
              <div className="rounded-2xl border border-border/40 bg-card/40 p-6 backdrop-blur-sm">
                <h3 className="mb-4 font-semibold">Get in Touch</h3>
                <div className="space-y-4 text-sm text-muted-foreground">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                      <Mail className="h-4 w-4 text-primary" />
                    </div>
                    <span>support@rasokart.com</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                      <Phone className="h-4 w-4 text-primary" />
                    </div>
                    <span>+91 1800 123 4567 (Toll Free)</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                      <MapPin className="h-4 w-4 text-primary" />
                    </div>
                    <span>Mumbai, Maharashtra, India</span>
                  </div>
                </div>
              </div>

              {/* Portal links */}
              <div className="grid grid-cols-3 gap-4">
                {[
                  { label: "Admin Portal", href: "/admin", color: "text-rose-400", bg: "bg-rose-400/10" },
                  { label: "Merchant Portal", href: "/merchant", color: "text-cyan-400", bg: "bg-cyan-400/10" },
                  { label: "Agent Portal", href: "/agent", color: "text-violet-400", bg: "bg-violet-400/10" },
                ].map((p) => (
                  <Link key={p.label} href={p.href}>
                    <div className={`cursor-pointer rounded-xl border border-border/40 ${p.bg} p-4 text-center transition-all hover:border-border/80`}>
                      <div className={`text-xs font-medium ${p.color}`}>{p.label}</div>
                      <div className="mt-1 text-xs text-muted-foreground">Login →</div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-border/40 bg-card/20 py-12">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            <div className="lg:col-span-2">
              <div className="mb-4 flex items-center gap-3">
                <RasoKartLogo size={32} />
                <span className="text-lg font-bold">RasoKart</span>
              </div>
              <p className="max-w-xs text-sm text-muted-foreground">
                India's most trusted payment gateway infrastructure for modern businesses.
                Collect, reconcile, and settle with confidence.
              </p>
            </div>

            <div>
              <div className="mb-3 text-sm font-semibold">Portal Access</div>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><Link href="/admin" className="transition-colors hover:text-foreground">Admin Login</Link></li>
                <li><Link href="/merchant" className="transition-colors hover:text-foreground">Merchant Login</Link></li>
                <li><Link href="/agent" className="transition-colors hover:text-foreground">Agent Login</Link></li>
                <li><Link href="/merchant/apply" className="transition-colors hover:text-foreground">Apply as Merchant</Link></li>
              </ul>
            </div>

            <div>
              <div className="mb-3 text-sm font-semibold">Services</div>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>QR Code Collection</li>
                <li>Virtual Accounts</li>
                <li>UPI Payments</li>
                <li>Payout API</li>
                <li>Payment Links</li>
              </ul>
            </div>
          </div>

          <div className="mt-10 flex flex-col items-center justify-between gap-4 border-t border-border/40 pt-6 text-xs text-muted-foreground sm:flex-row">
            <span>© {new Date().getFullYear()} RasoKart Technologies Pvt. Ltd. All rights reserved.</span>
            <div className="flex gap-6">
              <span className="cursor-pointer transition-colors hover:text-foreground">Privacy Policy</span>
              <span className="cursor-pointer transition-colors hover:text-foreground">Terms of Service</span>
              <span className="cursor-pointer transition-colors hover:text-foreground">Refund Policy</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
