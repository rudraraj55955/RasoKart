import { useState } from "react";
import { Link } from "wouter";
import { RasoKartLogo } from "@/components/ui/rasokart-logo";
import { useCompanySettings } from "@/lib/company-settings";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
  Smartphone,
  Download,
  Menu,
  X,
  SendHorizonal,
  Banknote,
  Clock,
} from "lucide-react";
import { InstallAppButton } from "@/components/ui/install-app-banner";

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
  { icon: FileText, label: "Settlement & payout requests" },
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
  const { companyName, supportPhone, footerText } = useCompanySettings();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-foreground antialiased">
      {/* NAV */}
      <header className="fixed inset-x-0 top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          {/* Logo — always routes home */}
          <Link href="/" className="flex items-center gap-3 hover:opacity-90 transition-opacity">
            <RasoKartLogo size={36} />
            <span className="text-xl font-bold tracking-tight">RasoKart</span>
          </Link>

          {/* Desktop nav — only at lg+ (1024px+); 768px has too many items to fit without overflow */}
          <nav className="hidden items-center gap-6 text-sm text-muted-foreground lg:flex">
            <a href="#services" className="transition-colors hover:text-foreground">Services</a>
            <a href="#features" className="transition-colors hover:text-foreground">Dashboard</a>
            <a href="#settlement" className="transition-colors hover:text-foreground">Settlement</a>
            <Link href="/merchant/api-docs" className="transition-colors hover:text-foreground">API Docs</Link>
            <a href="#plans" className="transition-colors hover:text-foreground">Plans</a>
            <a href="#payout-portal" className="transition-colors hover:text-foreground">Payout Portal</a>
            <a href="#contact" className="transition-colors hover:text-foreground">Contact</a>
          </nav>

          <div className="flex items-center gap-2">
            {/* CTA buttons — desktop only (lg+ = 1024px+) */}
            <Link href="/payout-merchant/login">
              <Button variant="ghost" size="sm" className="hidden lg:inline-flex gap-1 text-amber-400 hover:text-amber-300 hover:bg-amber-400/10">
                <SendHorizonal className="h-3.5 w-3.5" />
                Payout Login
              </Button>
            </Link>
            <Link href="/merchant">
              <Button variant="ghost" size="sm" className="hidden lg:inline-flex">Merchant Login</Button>
            </Link>
            <Link href="/merchant/apply">
              <Button size="sm" className="hidden lg:inline-flex bg-primary text-primary-foreground hover:bg-primary/90">
                Apply Now
              </Button>
            </Link>

            {/* Hamburger — below lg (below 1024px) */}
            <button
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md p-2 text-muted-foreground hover:text-foreground lg:hidden"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
            >
              <Menu className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Mobile navigation drawer — Sheet renders in a portal, works on all widths below md */}
      <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <SheetContent side="right" className="flex w-72 flex-col border-l border-border/40 bg-background/95 p-0 backdrop-blur-xl">
          <SheetHeader className="border-b border-border/40 px-5 py-4">
            <div className="flex items-center gap-3">
              <RasoKartLogo size={28} />
              <SheetTitle className="text-lg font-bold">RasoKart</SheetTitle>
            </div>
          </SheetHeader>
          <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-4">
            {[
              { label: "Services", href: "#services" },
              { label: "Dashboard", href: "#features" },
              { label: "Settlement", href: "#settlement" },
              { label: "API Docs", href: "/merchant/api-docs" },
              { label: "Plans", href: "#plans" },
              { label: "Payout Portal", href: "#payout-portal" },
              { label: "Contact", href: "#contact" },
            ].map((link) => (
              <a
                key={link.label}
                href={link.href}
                className="flex min-h-[44px] items-center rounded-lg px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                onClick={() => setMobileMenuOpen(false)}
              >
                {link.label}
              </a>
            ))}
            <div className="my-2 border-t border-border/40" />
            <Link href="/payout-merchant/login" onClick={() => setMobileMenuOpen(false)}>
              <span className="flex min-h-[44px] items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-amber-400 transition-colors hover:bg-amber-400/10">
                <SendHorizonal className="h-4 w-4 shrink-0" /> Payout Merchant Login
              </span>
            </Link>
            <Link href="/payout-merchant/signup" onClick={() => setMobileMenuOpen(false)}>
              <span className="flex min-h-[44px] items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-amber-300 transition-colors hover:bg-amber-400/10">
                <Banknote className="h-4 w-4 shrink-0" /> Sign Up for Payouts
              </span>
            </Link>
            <Link href="/merchant" onClick={() => setMobileMenuOpen(false)}>
              <span className="flex min-h-[44px] items-center rounded-lg px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground">
                Merchant Login
              </span>
            </Link>
            <Link href="/merchant/apply" onClick={() => setMobileMenuOpen(false)}>
              <span className="flex min-h-[44px] items-center rounded-lg px-3 py-2.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/10">
                Apply as Merchant →
              </span>
            </Link>
          </nav>
        </SheetContent>
      </Sheet>

      {/* HERO */}
      <section className="relative flex min-h-screen items-center overflow-hidden pt-16">
        {/* glow blobs — clipped so they can't cause horizontal overflow */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-40 left-1/4 h-[600px] w-[600px] rounded-full bg-cyan-500/10 blur-3xl" />
          <div className="absolute bottom-0 right-1/4 h-[500px] w-[500px] rounded-full bg-violet-500/10 blur-3xl" />
        </div>

        <div className="relative mx-auto w-full max-w-7xl px-4 py-24 sm:px-6 lg:py-32">
          <div className="min-w-0 max-w-3xl">
            <Badge className="mb-6 border-cyan-400/30 bg-cyan-400/10 text-cyan-400" variant="outline">
              India's Leading Payment Infrastructure
            </Badge>
            <h1 className="mb-6 text-4xl font-extrabold leading-tight tracking-tight sm:text-6xl lg:text-7xl">
              Collect Smarter,{" "}
              <span className="bg-gradient-to-r from-cyan-400 to-violet-400 bg-clip-text text-transparent">
                Settle Faster
              </span>
            </h1>
            <p className="mb-10 max-w-2xl text-base text-muted-foreground sm:text-xl">
              RasoKart provides enterprise-grade QR, UPI, and virtual account collection infrastructure
              with real-time reconciliation, instant payouts, and a powerful merchant dashboard — all
              from a single platform.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:gap-4">
              <Link href="/merchant/apply">
                <Button size="lg" className="w-full gap-2 bg-gradient-to-r from-cyan-500 to-violet-500 text-white hover:opacity-90 sm:w-auto">
                  Apply as Merchant
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link href="/merchant">
                <Button size="lg" variant="outline" className="w-full gap-2 border-border/60 sm:w-auto">
                  Merchant Login
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </div>

          {/* Stats grid — 2 cols on mobile, 4 cols on sm+ */}
          <div className="mt-16 grid grid-cols-2 gap-4 sm:mt-20 sm:grid-cols-4 sm:gap-6">
            {stats.map((s) => (
              <div key={s.label} className="min-w-0 rounded-2xl border border-border/40 bg-card/40 p-4 backdrop-blur-sm sm:p-5">
                <div className="text-xl font-bold leading-none text-foreground sm:text-2xl">{s.value}</div>
                <div className="mt-1.5 text-xs text-muted-foreground sm:text-sm">{s.label}</div>
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
                    { label: "Available Balance", value: "₹1,82,400", change: "For Payout", color: "text-violet-400" },
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
                disbursements, and full balance history — with one-click payout requests.
              </p>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { icon: IndianRupee, label: "Real-time balance visibility" },
                  { icon: CheckCircle2, label: "One-click payout requests" },
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

              <div className="flex flex-wrap gap-3">
                <Link href="/upi-collection-api">
                  <Button className="w-fit gap-2 bg-gradient-to-r from-cyan-500 to-blue-500 text-white hover:opacity-90">
                    <Terminal className="h-4 w-4" />
                    UPI Collection API
                  </Button>
                </Link>
                <Link href="/merchant/api-docs">
                  <Button variant="outline" className="w-fit gap-2 border-border/60">
                    <BookOpen className="h-4 w-4" />
                    Merchant API Docs
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* PAYOUT PORTAL — dedicated payout merchant section */}
      <section id="payout-portal" className="relative py-24 bg-gradient-to-b from-card/10 to-background">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute left-0 top-1/3 h-[400px] w-[400px] rounded-full bg-amber-500/8 blur-3xl" />
          <div className="absolute right-0 bottom-1/3 h-[300px] w-[300px] rounded-full bg-orange-500/6 blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-7xl px-4 sm:px-6">
          <div className="grid items-center gap-16 lg:grid-cols-2">
            {/* Visual */}
            <div className="order-2 lg:order-1">
              <div className="rounded-2xl border border-amber-400/20 bg-card/40 p-6 backdrop-blur-sm">
                <div className="mb-4 flex items-center justify-between">
                  <span className="text-sm font-semibold text-amber-400">Payout Dashboard</span>
                  <Badge className="border-amber-400/30 bg-amber-400/10 text-amber-400" variant="outline">Live</Badge>
                </div>
                <div className="space-y-3">
                  {[
                    { label: "Wallet Balance", value: "₹2,40,000", sub: "Available", color: "text-amber-400" },
                    { label: "Today's Payouts", value: "₹85,400", sub: "12 transfers", color: "text-emerald-400" },
                    { label: "Pending Payouts", value: "₹14,600", sub: "3 in queue", color: "text-orange-400" },
                    { label: "Success Rate", value: "98.7%", sub: "Last 30 days", color: "text-cyan-400" },
                  ].map((row) => (
                    <div key={row.label} className="flex items-center justify-between rounded-xl border border-border/30 bg-background/30 px-4 py-3">
                      <div>
                        <div className="text-xs text-muted-foreground">{row.label}</div>
                        <div className={`text-lg font-bold ${row.color}`}>{row.value}</div>
                      </div>
                      <div className="text-xs text-muted-foreground">{row.sub}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex gap-2">
                  <div className="flex-1 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-center text-xs text-amber-400">Send Payout</div>
                  <div className="flex-1 rounded-lg border border-border/30 bg-primary/10 px-3 py-2 text-center text-xs text-primary">View History</div>
                </div>
              </div>
            </div>

            {/* Copy */}
            <div className="order-1 lg:order-2">
              <Badge className="mb-4 border-amber-400/30 bg-amber-400/10 text-amber-400" variant="outline">
                Payout Portal
              </Badge>
              <h2 className="mb-6 text-4xl font-bold tracking-tight sm:text-5xl">
                Instant Payouts,{" "}
                <span className="bg-gradient-to-r from-amber-400 to-orange-400 bg-clip-text text-transparent">
                  Zero Hassle
                </span>
              </h2>
              <p className="mb-6 text-muted-foreground">
                RasoKart's Payout Portal is purpose-built for businesses that need to disburse funds at
                scale — salary payments, vendor settlements, commission payouts, and more.
                Register, complete KYC, and start sending payouts.
              </p>
              <div className="mb-8 grid grid-cols-2 gap-3">
                {[
                  { icon: Banknote, label: "Bank + UPI transfers" },
                  { icon: Clock, label: "T+0 instant settlement" },
                  { icon: CheckCircle2, label: "KYC-verified merchants" },
                  { icon: Shield, label: "Dual approval workflow" },
                  { icon: BarChart3, label: "Payout analytics" },
                  { icon: FileText, label: "Transaction slip & audit" },
                ].map((f) => (
                  <div key={f.label} className="flex items-center gap-2 text-sm text-foreground/80">
                    <f.icon className="h-4 w-4 shrink-0 text-amber-400" />
                    <span>{f.label}</span>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-3">
                <Link href="/payout-merchant/signup">
                  <Button className="gap-2 bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:opacity-90">
                    <Banknote className="h-4 w-4" />
                    Register as Payout Merchant
                  </Button>
                </Link>
                <Link href="/payout-merchant/login">
                  <Button variant="outline" className="gap-2 border-amber-400/40 text-amber-400 hover:bg-amber-400/10">
                    <SendHorizonal className="h-4 w-4" />
                    Payout Portal Login
                  </Button>
                </Link>
              </div>
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
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Merchant Portal", href: "/merchant", cta: "Login →", color: "text-cyan-400", bg: "bg-cyan-400/10" },
                  { label: "Apply as Merchant", href: "/merchant/apply", cta: "Get started →", color: "text-emerald-400", bg: "bg-emerald-400/10" },
                  { label: "Payout Portal", href: "/payout-merchant/login", cta: "Login →", color: "text-amber-400", bg: "bg-amber-400/10" },
                  { label: "Payout Sign Up", href: "/payout-merchant/signup", cta: "Register →", color: "text-orange-400", bg: "bg-orange-400/10" },
                ].map((p) => (
                  <Link key={p.label} href={p.href}>
                    <div className={`cursor-pointer rounded-xl border border-border/40 ${p.bg} p-4 text-center transition-all hover:border-border/80`}>
                      <div className={`text-xs font-medium ${p.color}`}>{p.label}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{p.cta}</div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* GET THE APP */}
      <section className="py-16 bg-gradient-to-b from-background to-card/30">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-xs font-medium text-primary mb-6">
            <Smartphone className="w-3.5 h-3.5" />
            Available on all devices
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold mb-4">Get RasoKart on your device</h2>
          <p className="text-muted-foreground max-w-xl mx-auto mb-10">
            Install RasoKart as a web app on any device — no app store required. Works on Android, iOS, and desktop.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-10">
            <InstallAppButton appName="RasoKart" variant="default" className="w-full sm:w-auto min-w-[180px] justify-center" />
            <a href="/downloads/rasokart.apk" download className="w-full sm:w-auto">
              <button className="w-full inline-flex items-center justify-center gap-2 rounded-md border border-border/50 bg-card/60 hover:bg-card px-6 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors min-w-[180px]">
                <Download className="w-4 h-4" />
                Android APK
              </button>
            </a>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl mx-auto">
            {[
              { icon: Smartphone, label: "Android", desc: "Install via APK or Chrome" },
              { icon: Globe, label: "iOS / iPhone", desc: "Add to Home Screen in Safari" },
              { icon: BarChart3, label: "Desktop", desc: "Install from Chrome or Edge" },
            ].map(({ icon: Icon, label, desc }) => (
              <div key={label} className="rounded-xl border border-border/40 bg-card/30 p-4 flex flex-col items-center gap-2">
                <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
                  <Icon className="w-4 h-4 text-primary" />
                </div>
                <p className="text-sm font-medium">{label}</p>
                <p className="text-xs text-muted-foreground text-center">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-border/40 bg-card/20 py-12">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-5">
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
                <li><Link href="/merchant" className="transition-colors hover:text-foreground">Merchant Login</Link></li>
                <li><Link href="/merchant/apply" className="transition-colors hover:text-foreground">Apply as Merchant</Link></li>
                <li><Link href="/payout-merchant/login" className="transition-colors hover:text-foreground text-amber-400/80">Payout Portal Login</Link></li>
                <li><Link href="/payout-merchant/signup" className="transition-colors hover:text-foreground text-amber-400/60">Payout Sign Up</Link></li>
                <li><a href="mailto:support@rasokart.com" className="transition-colors hover:text-foreground">Support</a></li>
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

            <div>
              <div className="mb-3 text-sm font-semibold">Developers</div>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><Link href="/upi-collection-api" className="transition-colors hover:text-foreground">UPI Collection API</Link></li>
                <li><Link href="/merchant/api-docs" className="transition-colors hover:text-foreground">Merchant API Docs</Link></li>
              </ul>
            </div>
          </div>

          <div className="mt-10 flex flex-col items-center justify-between gap-4 border-t border-border/40 pt-6 text-xs text-muted-foreground sm:flex-row">
            <span>
              © {new Date().getFullYear()} Powered by RasoKart. Operated by {companyName}. All rights reserved.
              {" "}Support: {supportPhone}
            </span>
            <div className="flex flex-wrap gap-x-6 gap-y-1.5 justify-center sm:justify-end">
              <Link href="/privacy-policy" className="transition-colors hover:text-foreground">Privacy Policy</Link>
              <Link href="/terms-and-conditions" className="transition-colors hover:text-foreground">Terms of Service</Link>
              <Link href="/refund-cancellation-policy" className="transition-colors hover:text-foreground">Refund Policy</Link>
              <Link href="/merchant-agreement" className="transition-colors hover:text-foreground">Merchant Agreement</Link>
              <Link href="/contact-us" className="transition-colors hover:text-foreground">Contact</Link>
            </div>
          </div>
          {footerText && (
            <p className="mt-3 text-center text-xs text-muted-foreground/80">{footerText}</p>
          )}
        </div>
      </footer>
    </div>
  );
}
