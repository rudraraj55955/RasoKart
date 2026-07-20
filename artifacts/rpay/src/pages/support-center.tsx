import { useEffect } from "react";
import { Link } from "wouter";
import { RasoKartLogo } from "@/components/ui/rasokart-logo";
import { SiteFooter } from "@/components/ui/site-footer";
import { useCompanySettings } from "@/lib/company-settings";
import {
  Headphones, MessageSquare, Phone, Mail, Clock, ChevronRight,
  ShieldCheck, CreditCard, Key, Webhook, UserCheck, FileText,
  AlertTriangle, HelpCircle, ArrowRight, Search,
} from "lucide-react";

const LAST_UPDATED = "20 July 2026";

const channels = [
  { icon: Mail, color: "text-blue-400", title: "Email Support", desc: "For general queries, billing, and account issues. Typical response within 24 hours on business days.", action: "support@rasokart.com", href: "mailto:support@rasokart.com" },
  { icon: Phone, color: "text-emerald-400", title: "Phone Support", desc: "Available for urgent payment and technical issues. Business hours: Mon–Sat, 10 AM – 6 PM IST.", action: "Call Now", href: "#phone" },
  { icon: MessageSquare, color: "text-violet-400", title: "Raise a Ticket", desc: "Submit a detailed support ticket via our Contact page for tracking and escalation.", action: "Contact Us", href: "/contact-us" },
  { icon: Headphones, color: "text-amber-400", title: "Merchant Portal", desc: "Logged-in merchants can raise and track support tickets directly from their dashboard.", action: "Go to Dashboard", href: "/merchant/dashboard" },
];

const categories = [
  {
    icon: CreditCard, color: "text-emerald-400", title: "Payments & Transactions",
    links: [
      { label: "Payment failed — what should I do?", href: "/contact-us" },
      { label: "Transaction showing as pending", href: "/contact-us" },
      { label: "Refund not received by customer", href: "/refund-cancellation-policy" },
      { label: "Understanding your settlement", href: "/payment-payout-settlement-policy" },
      { label: "Chargeback filed against my account", href: "/chargeback-dispute-policy" },
    ],
  },
  {
    icon: UserCheck, color: "text-violet-400", title: "Account & KYC",
    links: [
      { label: "How to complete KYC verification", href: "/kyc-aml-policy" },
      { label: "Account suspended — next steps", href: "/contact-us" },
      { label: "Updating business details or bank account", href: "/merchant/profile" },
      { label: "Understanding KYC & AML requirements", href: "/kyc-aml-policy" },
    ],
  },
  {
    icon: Key, color: "text-amber-400", title: "API & Integration",
    links: [
      { label: "Getting started with the API", href: "/integration-guide" },
      { label: "API key generation and rotation", href: "/merchant/api-keys" },
      { label: "API documentation reference", href: "/api-docs" },
      { label: "Testing in sandbox / development mode", href: "/integration-guide" },
    ],
  },
  {
    icon: Webhook, color: "text-blue-400", title: "Webhooks",
    links: [
      { label: "Configuring webhook endpoints", href: "/merchant/webhook" },
      { label: "Webhook event types and payloads", href: "/api-docs" },
      { label: "Webhook delivery failures", href: "/contact-us" },
      { label: "Signature verification guide", href: "/integration-guide" },
    ],
  },
  {
    icon: FileText, color: "text-rose-400", title: "Billing & Plans",
    links: [
      { label: "Understanding your plan and limits", href: "/pricing-fees-settlement-policy" },
      { label: "Upgrading or downgrading your plan", href: "/merchant/plan" },
      { label: "Invoice and billing queries", href: "/contact-us" },
      { label: "Transaction fee schedule", href: "/pricing-fees-settlement-policy" },
    ],
  },
  {
    icon: ShieldCheck, color: "text-cyan-400", title: "Security & Compliance",
    links: [
      { label: "Reporting a security vulnerability", href: "/responsible-disclosure" },
      { label: "PCI DSS & security information", href: "/pci-dss-security" },
      { label: "Data privacy and your rights", href: "/privacy-policy" },
      { label: "Reporting fraud or suspicious activity", href: "/risk-fraud-prevention" },
    ],
  },
];

const slaRows = [
  { type: "Critical (payment outage / fraud)", response: "2 hours", resolution: "Same day" },
  { type: "High (account blocked / payout stuck)", response: "4 business hours", resolution: "1–2 business days" },
  { type: "Medium (general account / billing query)", response: "24 business hours", resolution: "2–5 business days" },
  { type: "Low (information / documentation)", response: "2 business days", resolution: "5 business days" },
];

export default function SupportCenter() {
  const { supportEmail, supportPhone, companyName } = useCompanySettings();

  useEffect(() => {
    document.title = "Support Center — RasoKart Help";
  }, []);

  const resolvedPhone = supportPhone || "9358774496";
  const resolvedEmail = supportEmail || "support@rasokart.com";

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2.5 shrink-0">
            <RasoKartLogo size={32} />
            <span className="font-bold text-base hidden sm:block">RasoKart</span>
          </Link>
          <span className="text-sm font-medium text-foreground">Support Center</span>
          <Link href="/" className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0">
            ← Back to Home
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border/40">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-cyan-500/5 pointer-events-none" />
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-16 lg:py-20 w-full">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-primary/30 bg-primary/10 text-primary text-xs font-medium mb-6">
            <Headphones className="w-3.5 h-3.5" />
            RasoKart Support Center
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-4">How can we help?</h1>
          <p className="text-muted-foreground text-lg leading-relaxed max-w-2xl mb-8">
            Browse our help resources below, or contact our support team directly. We're here to help you resolve issues quickly and get back to running your business.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/contact-us" className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 rounded-lg font-medium text-sm hover:opacity-90 transition-opacity">
              <MessageSquare className="w-4 h-4" /> Raise a Ticket
            </Link>
            <a href={`tel:${resolvedPhone}`} className="inline-flex items-center gap-2 border border-border/60 px-5 py-2.5 rounded-lg font-medium text-sm text-muted-foreground hover:text-foreground hover:border-border transition-colors">
              <Phone className="w-4 h-4" /> {resolvedPhone}
            </a>
            <a href={`mailto:${resolvedEmail}`} className="inline-flex items-center gap-2 border border-border/60 px-5 py-2.5 rounded-lg font-medium text-sm text-muted-foreground hover:text-foreground hover:border-border transition-colors">
              <Mail className="w-4 h-4" /> {resolvedEmail}
            </a>
          </div>
        </div>
      </section>

      {/* Support Channels */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 py-12 w-full">
        <h2 className="text-xl font-bold tracking-tight mb-6">Contact Options</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {channels.map(({ icon: Icon, color, title, desc, action, href }) => {
            const inner = (
              <>
                <div className="p-2 rounded-lg bg-card border border-border/50 w-fit mb-3">
                  <Icon className={`w-4 h-4 ${color}`} />
                </div>
                <h3 className="font-semibold text-sm mb-1">{title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed mb-3">{desc}</p>
                <span className="text-xs text-primary flex items-center gap-1">{action} <ArrowRight className="w-3 h-3" /></span>
              </>
            );
            const cls = "rounded-xl border border-border/60 bg-card/40 p-5 hover:border-primary/30 transition-colors group block";
            if (href.startsWith("/")) {
              return <Link key={title} href={href} className={cls}>{inner}</Link>;
            }
            return <a key={title} href={href} className={cls}>{inner}</a>;
          })}
        </div>
      </section>

      {/* Help Topics */}
      <section className="border-t border-border/40 bg-card/20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-12 w-full">
          <h2 className="text-xl font-bold tracking-tight mb-2">Help Topics</h2>
          <p className="text-muted-foreground text-sm mb-8">Browse common support topics or click to learn more.</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {categories.map(({ icon: Icon, color, title, links }) => (
              <div key={title} className="rounded-xl border border-border/60 bg-card/40 p-5">
                <div className="flex items-center gap-2 mb-4">
                  <div className="p-1.5 rounded bg-card border border-border/50">
                    <Icon className={`w-4 h-4 ${color}`} />
                  </div>
                  <h3 className="font-semibold text-sm">{title}</h3>
                </div>
                <ul className="space-y-2">
                  {links.map(({ label, href }) => (
                    <li key={label}>
                      <Link href={href} className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors group">
                        <ChevronRight className="w-3 h-3 text-primary/40 group-hover:text-primary transition-colors shrink-0" />
                        {label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SLA */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 py-12 w-full">
        <h2 className="text-xl font-bold tracking-tight mb-2">Response & Resolution Times</h2>
        <p className="text-muted-foreground text-sm mb-6">
          We aim to respond to all queries within these timeframes. For full SLA details, see our <Link href="/sla-support-timelines" className="text-primary hover:underline">SLA & Support Timelines page</Link>.
        </p>
        <div className="rounded-xl border border-border/60 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60 bg-card/60">
                <th className="text-left py-3 px-4 font-medium text-foreground text-xs">Issue Type</th>
                <th className="text-left py-3 px-4 font-medium text-foreground text-xs">First Response</th>
                <th className="text-left py-3 px-4 font-medium text-foreground text-xs">Target Resolution</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {slaRows.map(({ type, response, resolution }) => (
                <tr key={type} className="hover:bg-card/40 transition-colors">
                  <td className="py-3 px-4 text-xs text-muted-foreground">{type}</td>
                  <td className="py-3 px-4 text-xs font-medium text-foreground">{response}</td>
                  <td className="py-3 px-4 text-xs font-medium text-foreground">{resolution}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Escalation */}
      <section className="border-t border-border/40 bg-card/20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-12 w-full">
          <h2 className="text-xl font-bold tracking-tight mb-2">Need to Escalate?</h2>
          <p className="text-muted-foreground text-sm mb-6">If your issue is not resolved within the expected timeframe, you can escalate through the following channels:</p>
          <div className="flex flex-wrap gap-4">
            <Link href="/escalation-matrix" className="inline-flex items-center gap-2 border border-border/60 px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:border-border transition-colors">
              <AlertTriangle className="w-4 h-4 text-amber-400" /> Escalation Matrix
            </Link>
            <Link href="/grievance-officer" className="inline-flex items-center gap-2 border border-border/60 px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:border-border transition-colors">
              <UserCheck className="w-4 h-4 text-violet-400" /> Grievance Officer
            </Link>
            <Link href="/grievance-redressal-policy" className="inline-flex items-center gap-2 border border-border/60 px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:border-border transition-colors">
              <HelpCircle className="w-4 h-4 text-blue-400" /> Grievance Redressal Policy
            </Link>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-4 w-full">
        <p className="text-xs text-muted-foreground/60">Last Updated: {LAST_UPDATED}</p>
      </div>

      <SiteFooter />
    </div>
  );
}
