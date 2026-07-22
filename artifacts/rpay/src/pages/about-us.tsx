import { useEffect } from "react";
import { Link } from "wouter";
import { RasoKartLogo } from "@/components/ui/rasokart-logo";
import { SiteFooter } from "@/components/ui/site-footer";
import { useCompanySettings } from "@/lib/company-settings";
import {
  Shield, Zap, Users, Globe, Award, ArrowRight, Building2,
  Target, Heart, CheckCircle2, MapPin, Phone, Mail, TrendingUp, Lock
} from "lucide-react";

const LAST_UPDATED = "20 July 2026";
const CIN = "U47820RJ2025PTC109583";
const INCORPORATION_DATE = "12 December 2025";
const REGISTERED_ADDRESS = "P. No. B-46, Damodar Vila, Agarsen Nagar, Kalwad Road, Jhotwara, Jaipur – 302012, Rajasthan, India";

const values = [
  { icon: Shield, title: "Security First", color: "text-emerald-400", desc: "Every API call, merchant record, and data point is protected with encryption and multi-layer security controls." },
  { icon: Zap, title: "Reliability", color: "text-amber-400", desc: "Our platform is built to be dependable. Merchants deserve software tools that work when they need them." },
  { icon: Users, title: "Merchant Success", color: "text-violet-400", desc: "Our success is measured by the success of every merchant on our platform. We build tools that genuinely move the needle for businesses." },
  { icon: Globe, title: "Transparency", color: "text-cyan-400", desc: "Clear pricing, honest policies, and real-time dashboards. No hidden fees, no surprises — just a technology partner you can trust." },
];

const milestones = [
  { year: "Dec 2025", title: "Company Founded", desc: "Nickey Collection Private Limited incorporated in Jaipur, Rajasthan with a vision to democratise payment infrastructure for Indian businesses." },
  { year: "Early 2026", title: "Platform Launch", desc: "RasoKart payment gateway platform launched with QR code payments, virtual accounts, and the merchant self-serve portal." },
  { year: "Mid 2026", title: "Payout Infrastructure", desc: "Launched the full payout engine — enabling merchants and agents to disburse funds at scale with real-time tracking." },
  { year: "July 2026", title: "Agent Network", desc: "Opened the agent portal, enabling a distributed network to onboard and support merchants across India." },
];

const GSTIN = "08AALCN0945P1ZT";

const facts = [
  { label: "Legal Name", value: "Nickey Collection Private Limited" },
  { label: "Brand Name", value: "RasoKart" },
  { label: "CIN", value: CIN },
  { label: "GSTIN", value: GSTIN },
  { label: "Incorporated", value: INCORPORATION_DATE },
  { label: "Headquarters", value: "Jaipur, Rajasthan, India" },
  { label: "Category", value: "Software & Technology Platform" },
];

export default function AboutUs() {
  const { companyName, supportEmail, supportPhone } = useCompanySettings();

  useEffect(() => {
    document.title = "About Us — RasoKart";
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
          <nav className="hidden md:flex items-center gap-6 text-sm text-muted-foreground">
            <Link href="/about-us" className="text-foreground font-medium">About</Link>
            <Link href="/careers" className="hover:text-foreground transition-colors">Careers</Link>
            <Link href="/contact-us" className="hover:text-foreground transition-colors">Contact</Link>
          </nav>
          <Link href="/merchant/login" className="flex items-center gap-1.5 text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-lg font-medium hover:opacity-90 transition-opacity">
            Merchant Login <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border/40">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-violet-500/5 pointer-events-none" />
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-20 lg:py-28">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-primary/30 bg-primary/10 text-primary text-xs font-medium mb-6">
            <Building2 className="w-3.5 h-3.5" />
            Nickey Collection Private Limited · Est. December 2025
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight mb-6 max-w-3xl">
            Software & Technology Platform for <span className="text-primary">Merchant Operations</span>
          </h1>
          <p className="text-muted-foreground text-lg leading-relaxed max-w-2xl mb-4">
            <strong className="text-foreground">Nickey Collection Private Limited</strong> provides software development, information technology consulting, hosting, infrastructure support, merchant-management technology, payment-service-provider integration support, transaction monitoring, reporting and reconciliation tools through the RasoKart platform.
          </p>
          <div className="mb-8 rounded-xl border border-amber-400/30 bg-amber-400/10 px-5 py-4 text-sm text-amber-200 leading-relaxed max-w-2xl">
            RasoKart is a software and technology platform operated by Nickey Collection Private Limited (GSTIN: 08AALCN0945P1ZT). RasoKart is not represented as an RBI-authorised Payment Aggregator and does not independently pool or settle customer or merchant funds. Regulated payment processing and settlement services are provided through approved banks and payment-service providers, subject to onboarding, KYC, risk approval and applicable terms.
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/merchant/login" className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 rounded-lg font-medium text-sm hover:opacity-90 transition-opacity">
              Get Started <ArrowRight className="w-4 h-4" />
            </Link>
            <Link href="/contact-us" className="inline-flex items-center gap-2 border border-border/60 px-5 py-2.5 rounded-lg font-medium text-sm text-muted-foreground hover:text-foreground hover:border-border transition-colors">
              Contact Us
            </Link>
          </div>
        </div>
      </section>

      {/* Mission */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 py-16 lg:py-20 w-full">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <div className="inline-flex items-center gap-2 text-xs font-medium text-primary uppercase tracking-wider mb-4">
              <Target className="w-3.5 h-3.5" /> Our Mission
            </div>
            <h2 className="text-3xl font-bold tracking-tight mb-4">
              Making payment infrastructure accessible to every business
            </h2>
            <p className="text-muted-foreground leading-relaxed mb-4">
              India's payment ecosystem is growing rapidly, but reliable, affordable gateway infrastructure has historically been accessible only to large enterprises. We built RasoKart to change that.
            </p>
            <p className="text-muted-foreground leading-relaxed mb-6">
              Whether you're a startup accepting your first payment, a merchant scaling from thousands to lakhs of transactions, or an enterprise needing a white-label gateway infrastructure — RasoKart meets you where you are.
            </p>
            <div className="space-y-3">
              {["Transparent pricing with no hidden charges", "Real-time dashboards and analytics", "Dedicated support for every merchant tier", "Bank-grade security and PCI-compliant infrastructure"].map(item => (
                <div key={item} className="flex items-center gap-3 text-sm text-muted-foreground">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  {item}
                </div>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {values.map(({ icon: Icon, title, color, desc }) => (
              <div key={title} className="rounded-xl border border-border/60 bg-card/40 p-5">
                <div className={`p-2 rounded-lg bg-card border border-border/50 w-fit mb-3`}>
                  <Icon className={`w-4 h-4 ${color}`} />
                </div>
                <h3 className="font-semibold text-sm mb-1">{title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Company Facts */}
      <section className="border-y border-border/40 bg-card/20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-12 w-full">
          <div className="grid md:grid-cols-2 gap-8 items-start">
            <div>
              <div className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wider mb-4">
                <Building2 className="w-3.5 h-3.5" /> Company Information
              </div>
              <h2 className="text-2xl font-bold tracking-tight mb-6">Legal & Registration Details</h2>
              <div className="space-y-3">
                {facts.map(({ label, value }) => (
                  <div key={label} className="flex gap-4 text-sm">
                    <span className="text-muted-foreground w-32 shrink-0">{label}</span>
                    <span className="font-medium font-mono text-xs">{value}</span>
                  </div>
                ))}
                <div className="flex gap-4 text-sm">
                  <span className="text-muted-foreground w-32 shrink-0">Reg. Office</span>
                  <span className="text-muted-foreground text-xs leading-relaxed">{REGISTERED_ADDRESS}</span>
                </div>
              </div>
            </div>
            <div>
              <div className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wider mb-4">
                <TrendingUp className="w-3.5 h-3.5" /> Our Journey
              </div>
              <h2 className="text-2xl font-bold tracking-tight mb-6">Milestones</h2>
              <div className="relative pl-6 border-l border-border/60 space-y-6">
                {milestones.map(({ year, title, desc }) => (
                  <div key={year} className="relative">
                    <div className="absolute -left-8 w-3 h-3 rounded-full bg-primary border-2 border-background top-1" />
                    <span className="text-xs text-primary font-medium font-mono">{year}</span>
                    <h3 className="font-semibold text-sm mt-0.5 mb-1">{title}</h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* What We Offer */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 py-16 w-full">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold tracking-tight mb-3">What RasoKart Offers</h2>
          <p className="text-muted-foreground max-w-xl mx-auto">A complete payments operating system — from collection to disbursement, all in one place.</p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            { icon: Shield, color: "text-emerald-400", title: "Payment Integration", desc: "Connect and manage approved payment-service-provider integrations through a unified software interface." },
            { icon: Zap, color: "text-amber-400", title: "Payout Integration", desc: "Initiate eligible payout instructions through approved payout-service partners, subject to account activation and partner approval." },
            { icon: Lock, color: "text-blue-400", title: "Fraud Prevention", desc: "Multi-layer fraud detection and risk scoring to protect every transaction on your platform." },
            { icon: Globe, color: "text-violet-400", title: "White-label Solutions", desc: "Deploy RasoKart infrastructure under your own brand — your domain, your colours, your customers." },
            { icon: Users, color: "text-rose-400", title: "Agent Network", desc: "Build and manage a distributed agent network to onboard merchants across geographies." },
            { icon: Award, color: "text-cyan-400", title: "Compliance Ready", desc: "KYC, AML, and PCI DSS-aligned software infrastructure so you stay compliant without extra work." },
          ].map(({ icon: Icon, color, title, desc }) => (
            <div key={title} className="rounded-xl border border-border/60 bg-card/40 p-6">
              <div className={`p-2 rounded-lg bg-card border border-border/50 w-fit mb-4`}>
                <Icon className={`w-5 h-5 ${color}`} />
              </div>
              <h3 className="font-semibold mb-2">{title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Contact CTA */}
      <section className="border-t border-border/40 bg-card/20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-12 w-full">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div>
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                <Heart className="w-3.5 h-3.5 text-rose-400" /> Get In Touch
              </div>
              <h2 className="text-2xl font-bold tracking-tight mb-1">Ready to get started?</h2>
              <p className="text-muted-foreground text-sm">Talk to our team or create a merchant account today.</p>
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              {supportPhone && (
                <a href={`tel:${supportPhone}`} className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
                  <Phone className="w-4 h-4 text-primary" /> {supportPhone}
                </a>
              )}
              {supportEmail && (
                <a href={`mailto:${supportEmail}`} className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
                  <Mail className="w-4 h-4 text-primary" /> {supportEmail}
                </a>
              )}
              <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(REGISTERED_ADDRESS)}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
                <MapPin className="w-4 h-4 text-primary" /> Jaipur, Rajasthan
              </a>
            </div>
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/merchant/login" className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 rounded-lg font-medium text-sm hover:opacity-90 transition-opacity">
              Create Merchant Account <ArrowRight className="w-4 h-4" />
            </Link>
            <Link href="/contact-us" className="inline-flex items-center gap-2 border border-border/60 px-5 py-2.5 rounded-lg font-medium text-sm text-muted-foreground hover:text-foreground hover:border-border transition-colors">
              Contact Our Team
            </Link>
            <Link href="/careers" className="inline-flex items-center gap-2 border border-border/60 px-5 py-2.5 rounded-lg font-medium text-sm text-muted-foreground hover:text-foreground hover:border-border transition-colors">
              Join Our Team
            </Link>
          </div>
          <p className="text-xs text-muted-foreground/60 mt-6">Last Updated: {LAST_UPDATED}</p>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
