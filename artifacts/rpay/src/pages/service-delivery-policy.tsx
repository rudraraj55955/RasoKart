import { Link } from "wouter";
import LegalLayout, {
  Bullet,
  InfoBox,
  SectionAnchor,
  SectionHeading,
  type LegalSection,
} from "@/components/layout/legal-layout";
import { useCompanySettings } from "@/lib/company-settings";
import {
  Globe,
  Zap,
  Clock,
  Wrench,
  LifeBuoy,
  AlertTriangle,
  ShieldCheck,
  Phone,
  FileText,
  Settings,
} from "lucide-react";

const LAST_UPDATED = "16 July 2026";

const sections: LegalSection[] = [
  { id: "overview", icon: FileText, title: "Overview", color: "text-cyan-400" },
  { id: "services", icon: Globe, title: "Services We Provide", color: "text-violet-400" },
  { id: "availability", icon: Zap, title: "Platform Availability (SLA)", color: "text-emerald-400" },
  { id: "activation", icon: Clock, title: "Service Activation", color: "text-amber-400" },
  { id: "maintenance", icon: Wrench, title: "Maintenance & Downtime", color: "text-orange-400" },
  { id: "support", icon: LifeBuoy, title: "Merchant Support", color: "text-blue-400" },
  { id: "limitations", icon: AlertTriangle, title: "Service Limitations", color: "text-yellow-400" },
  { id: "merchant-duties", icon: ShieldCheck, title: "Merchant Responsibilities", color: "text-teal-400" },
  { id: "modifications", icon: Settings, title: "Service Modifications", color: "text-muted-foreground" },
  { id: "contact", icon: Phone, title: "Contact Us", color: "text-teal-400" },
];

export default function ServiceDeliveryPolicy() {
  const { companyName, supportPhone, supportEmail } = useCompanySettings();

  return (
    <LegalLayout
      title="Service Delivery Policy"
      lastUpdated={LAST_UPDATED}
      badgeText="Service Policy"
      sections={sections}
      intro={
        <p className="text-muted-foreground leading-relaxed max-w-2xl mt-3">
          This Service Delivery Policy describes how{" "}
          <strong className="text-foreground">{companyName}</strong> ("RasoKart") delivers its payment
          gateway services to merchants, including service scope, availability commitments, support
          timelines, and service limitations.
        </p>
      }
    >
      {/* 1. Overview */}
      <section>
        <SectionAnchor id="overview" />
        <SectionHeading icon={FileText} title="1. Overview" color="text-cyan-400" id="overview" />
        <p className="text-muted-foreground text-sm leading-relaxed">
          RasoKart provides a Software-as-a-Service (SaaS) payment gateway platform that enables merchants to
          collect payments, manage payouts, generate QR codes and virtual accounts, access payment links,
          and view reconciliation and settlement reports — all through a unified merchant dashboard and API.
          This policy sets out the standards and commitments we make to our merchants in delivering these
          services.
        </p>
      </section>

      {/* 2. Services */}
      <section>
        <SectionAnchor id="services" />
        <SectionHeading icon={Globe} title="2. Services We Provide" color="text-violet-400" id="services" />
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            { title: "QR Code Collection", desc: "Dynamic and static UPI QR codes for in-person and digital payment collection." },
            { title: "Virtual Accounts", desc: "Unique bank virtual account numbers (VAs) for NEFT, RTGS, and IMPS-based deposits." },
            { title: "Payment Links", desc: "Shareable, trackable payment links for invoicing and remote collections." },
            { title: "Payout API", desc: "Programmatic disbursement of funds to bank accounts and UPI IDs." },
            { title: "Reconciliation Engine", desc: "Automated matching of deposits against settlements with full audit trail." },
            { title: "Merchant Dashboard", desc: "Real-time visibility into transactions, balances, settlements, and analytics." },
          ].map((s) => (
            <div key={s.title} className="rounded-xl border border-border/50 bg-card/40 p-4">
              <p className="text-sm font-semibold text-foreground mb-1">{s.title}</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
          Feature availability depends on your subscribed plan. See our{" "}
          <Link href="/pricing-fees-settlement-policy" className="text-primary hover:underline">
            Pricing & Fees Policy
          </Link>{" "}
          for plan-specific feature details.
        </p>
      </section>

      {/* 3. Availability */}
      <section>
        <SectionAnchor id="availability" />
        <SectionHeading icon={Zap} title="3. Platform Availability (SLA)" color="text-emerald-400" id="availability" />
        <p className="text-muted-foreground text-sm mb-4 leading-relaxed">
          We target the following platform availability standards for the merchant dashboard and API:
        </p>
        <div className="space-y-3 mb-4">
          {[
            { label: "Merchant Dashboard", sla: "99.5% monthly uptime", note: "Excludes scheduled maintenance windows" },
            { label: "Payment API (collection)", sla: "99.5% monthly uptime", note: "Excludes banking partner outages and scheduled maintenance" },
            { label: "Payout API", sla: "99.0% monthly uptime", note: "Subject to banking and settlement partner availability" },
          ].map((r) => (
            <div key={r.label} className="flex items-start justify-between gap-4 rounded-lg border border-border/50 bg-card/40 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-foreground">{r.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{r.note}</p>
              </div>
              <span className="text-sm text-emerald-400 font-semibold shrink-0">{r.sla}</span>
            </div>
          ))}
        </div>
        <InfoBox variant="warning">
          SLA commitments apply to the availability of the RasoKart platform itself. Payment success rates and
          settlement timelines are also subject to factors outside our direct control, including network
          conditions, banking partner availability, and regulatory processing times.
        </InfoBox>
      </section>

      {/* 4. Activation */}
      <section>
        <SectionAnchor id="activation" />
        <SectionHeading icon={Clock} title="4. Service Activation Timeline" color="text-amber-400" id="activation" />
        <div className="space-y-3">
          {[
            { step: "Registration", time: "Immediate", desc: "Merchant account is created upon successful email verification and form submission." },
            { step: "KYC Review", time: "1–3 business days", desc: "We review submitted KYC documents (PAN, business registration, bank details). Complex cases may take longer." },
            { step: "Account Approval", time: "Up to 5 business days", desc: "Once KYC is verified, your account is activated. You will be notified by email." },
            { step: "Settlement Activation", time: "After KYC approval", desc: "Settlement to your bank account is activated after your bank account is verified." },
            { step: "API Access", time: "After account activation (paid plans)", desc: "API keys are available immediately after account activation for eligible plans." },
          ].map((s) => (
            <div key={s.step} className="flex gap-4 rounded-xl border border-border/50 bg-card/40 p-4">
              <div className="shrink-0 text-right">
                <p className="text-xs font-semibold text-primary whitespace-nowrap">{s.time}</p>
              </div>
              <div className="border-l border-border/60 pl-4">
                <p className="text-sm font-semibold text-foreground mb-0.5">{s.step}</p>
                <p className="text-xs text-muted-foreground leading-relaxed">{s.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 5. Maintenance */}
      <section>
        <SectionAnchor id="maintenance" />
        <SectionHeading icon={Wrench} title="5. Maintenance & Downtime" color="text-orange-400" id="maintenance" />
        <ul className="space-y-2 mb-4">
          <Bullet>Scheduled maintenance will be announced with a minimum of 24 hours' advance notice via email and/or an in-platform notification</Bullet>
          <Bullet>Scheduled maintenance is generally performed during off-peak hours (between 1:00 AM and 5:00 AM IST) to minimise impact</Bullet>
          <Bullet>Emergency maintenance may be performed without advance notice when required to address critical security vulnerabilities or operational incidents</Bullet>
          <Bullet>During maintenance windows, some or all platform features may be temporarily unavailable</Bullet>
          <Bullet>We will publish status updates at our status page or notify you by email during extended incidents</Bullet>
        </ul>
      </section>

      {/* 6. Support */}
      <section>
        <SectionAnchor id="support" />
        <SectionHeading icon={LifeBuoy} title="6. Merchant Support" color="text-blue-400" id="support" />
        <p className="text-muted-foreground text-sm mb-4 leading-relaxed">
          We provide merchant support through the following channels:
        </p>
        <div className="grid gap-3 sm:grid-cols-2 mb-4">
          {[
            { channel: "Email Support", desc: "Submit queries via our Contact Us page or directly by email. Response within 2 business days.", priority: "All plans" },
            { channel: "Phone Support", desc: "Available during business hours (Mon–Sat, 10:00 AM – 6:00 PM IST).", priority: "Silver plan & above" },
            { channel: "In-Platform Tickets", desc: "Raise support tickets directly from your merchant dashboard.", priority: "All plans" },
            { channel: "Priority Support", desc: "Dedicated account manager and priority response SLA.", priority: "Gold plan & above" },
          ].map((s) => (
            <div key={s.channel} className="rounded-xl border border-border/50 bg-card/40 p-4">
              <div className="flex items-start justify-between gap-2 mb-1">
                <p className="text-sm font-semibold text-foreground">{s.channel}</p>
                <span className="text-xs text-primary/80 shrink-0">{s.priority}</span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 7. Limitations */}
      <section>
        <SectionAnchor id="limitations" />
        <SectionHeading icon={AlertTriangle} title="7. Service Limitations" color="text-yellow-400" id="limitations" />
        <ul className="space-y-2">
          <Bullet>Payment success rates depend on the customer's bank, network conditions, and payment method — we cannot guarantee 100% payment success</Bullet>
          <Bullet>Settlement timelines may be extended during banking holidays, RBI system outages, or as a result of risk management holds</Bullet>
          <Bullet>Transaction and API rate limits apply; exceeding these limits may result in temporary throttling</Bullet>
          <Bullet>Certain features are plan-restricted; Starter plan merchants do not have access to API, webhook, or payout API features</Bullet>
          <Bullet>We do not guarantee compatibility with all third-party systems, e-commerce platforms, or browsers; integration support is provided on a best-effort basis</Bullet>
        </ul>
      </section>

      {/* 8. Merchant Responsibilities */}
      <section>
        <SectionAnchor id="merchant-duties" />
        <SectionHeading icon={ShieldCheck} title="8. Merchant Responsibilities" color="text-teal-400" id="merchant-duties" />
        <ul className="space-y-2">
          <Bullet>Merchants are responsible for maintaining accurate business and banking information in their account profile</Bullet>
          <Bullet>Merchants are responsible for ensuring their own website, app, or integration correctly implements the RasoKart API and handles payment states (success, failure, pending) appropriately</Bullet>
          <Bullet>Merchants must promptly complete KYC re-verification requests and comply with periodic compliance reviews</Bullet>
          <Bullet>Merchants are responsible for their customers' refund expectations and must communicate their own refund policy clearly to customers</Bullet>
        </ul>
      </section>

      {/* 9. Modifications */}
      <section>
        <SectionAnchor id="modifications" />
        <SectionHeading icon={Settings} title="9. Service Modifications" color="text-muted-foreground" id="modifications" />
        <p className="text-muted-foreground text-sm leading-relaxed">
          We may add, modify, or discontinue any service or feature with reasonable notice. Material changes to
          the service scope will be communicated with a minimum of 30 days' notice. If a material change
          adversely affects your use of the Platform, you may terminate your account in accordance with our
          Terms and Conditions without penalty during the notice period.
        </p>
      </section>

      {/* 10. Contact */}
      <section>
        <SectionAnchor id="contact" />
        <SectionHeading icon={Phone} title="10. Contact Us" color="text-teal-400" id="contact" />
        <div className="rounded-xl border border-border/50 bg-card/40 p-5 space-y-2">
          <p className="text-sm font-semibold text-foreground">{companyName}</p>
          <p className="text-sm text-muted-foreground">
            P. No. B-46, Damodar Vila, Agarsen Nagar, Kalwar Road, Jhotwara, Jaipur – 302012, Rajasthan
          </p>
          {supportPhone && (
            <a href={`tel:${supportPhone}`} className="block text-sm text-muted-foreground hover:text-foreground transition-colors">
              Phone: {supportPhone}
            </a>
          )}
          {supportEmail && (
            <a href={`mailto:${supportEmail}`} className="block text-sm text-muted-foreground hover:text-foreground transition-colors">
              Email: {supportEmail}
            </a>
          )}
          <Link href="/contact-us" className="block text-sm text-primary hover:underline pt-1">
            Submit a query via our Contact Us page →
          </Link>
        </div>
      </section>
    </LegalLayout>
  );
}
