import { useEffect } from "react";
import { Link } from "wouter";
import { RasoKartLogo } from "@/components/ui/rasokart-logo";
import { SiteFooter } from "@/components/ui/site-footer";
import { useCompanySettings } from "@/lib/company-settings";
import {
  Shield,
  Building2,
  AlertTriangle,
  CheckCircle2,
  ArrowLeft,
  Phone,
  Mail,
  MapPin,
  Info,
  FileText,
  Scale,
  Globe,
} from "lucide-react";

const LAST_UPDATED = "22 July 2026";
const CIN = "U47820RJ2025PTC109583";
const GSTIN = "08AALCN0945P1ZT";
const REGISTERED_ADDRESS =
  "P. No. B-46, Damodar Vila, Agarsen Nagar, Kalwar Road, Jhotwara, Jaipur – 302012, Rajasthan, India";
const WEBSITE = "https://rasokart.com";

export default function PaymentPartnerDisclosure() {
  const { companyName, supportPhone, supportEmail } = useCompanySettings();

  useEffect(() => {
    document.title = "Payment Partner Disclosure — RasoKart";
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
          <Link
            href="/"
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Home
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border/40">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-amber-500/5 pointer-events-none" />
        <div className="mx-auto max-w-4xl px-4 sm:px-6 py-16 lg:py-20">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-primary/30 bg-primary/10 text-primary text-xs font-medium mb-6">
            <Shield className="w-3.5 h-3.5" />
            Payment Partner Disclosure
          </div>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight mb-4">
            Payment Partner Disclosure
          </h1>
          <p className="text-muted-foreground text-base leading-relaxed mb-4 max-w-2xl">
            This disclosure explains the role of RasoKart, operated by{" "}
            <strong className="text-foreground">Nickey Collection Private Limited</strong>, in relation
            to payment processing and settlement services.
          </p>
          <p className="text-xs text-muted-foreground/60">
            Last Updated: {LAST_UPDATED} &nbsp;·&nbsp; Website: {WEBSITE}
          </p>
        </div>
      </section>

      {/* Main Content */}
      <main className="flex-1">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 py-12 space-y-10">

          {/* Core Regulatory Disclosure */}
          <div className="rounded-2xl border border-amber-400/30 bg-amber-400/10 px-6 py-6">
            <div className="flex items-start gap-3 mb-4">
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <h2 className="text-lg font-bold text-amber-200">Regulatory Disclosure</h2>
            </div>
            <p className="text-sm text-amber-100/90 leading-relaxed">
              RasoKart is a software and technology platform operated by{" "}
              <strong>Nickey Collection Private Limited</strong> (GSTIN: {GSTIN}). RasoKart is{" "}
              <strong>not represented as an RBI-authorised Payment Aggregator</strong> and does not
              independently pool or settle customer or merchant funds. Regulated payment processing and
              settlement services are provided through approved banks and payment-service providers,
              subject to onboarding, KYC, risk approval and applicable terms.
            </p>
          </div>

          {/* Company Details */}
          <section>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">
              <Building2 className="w-3.5 h-3.5" /> Company Information
            </div>
            <h2 className="text-2xl font-bold tracking-tight mb-5">About Nickey Collection Private Limited</h2>
            <div className="rounded-xl border border-border/50 bg-card/40 divide-y divide-border/40">
              {[
                { label: "Legal Name", value: "NICKEY COLLECTION PRIVATE LIMITED" },
                { label: "Brand Name", value: "RasoKart" },
                { label: "CIN", value: CIN },
                { label: "GSTIN", value: GSTIN },
                { label: "Incorporated", value: "12 December 2025" },
                { label: "Registrar of Companies", value: "ROC Jaipur" },
                { label: "Company Status", value: "Active" },
                { label: "Nature of Business", value: "Software & IT-Enabled Technology Platform" },
                { label: "Website", value: WEBSITE },
                { label: "Registered Office", value: REGISTERED_ADDRESS },
              ].map(({ label, value }) => (
                <div key={label} className="flex gap-4 px-5 py-3 text-sm">
                  <span className="text-muted-foreground w-40 shrink-0">{label}</span>
                  <span className="font-medium font-mono text-xs leading-relaxed">{value}</span>
                </div>
              ))}
            </div>
          </section>

          {/* What RasoKart Is */}
          <section>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">
              <Info className="w-3.5 h-3.5" /> Platform Nature
            </div>
            <h2 className="text-2xl font-bold tracking-tight mb-5">What RasoKart Is</h2>
            <p className="text-muted-foreground text-sm leading-relaxed mb-5">
              RasoKart is a software and IT-enabled technology platform. It provides merchant-management
              software, payment-provider API integration support, a transaction monitoring interface,
              reconciliation and reporting software, and a hosting and technology-support platform.
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              {[
                { icon: FileText, title: "Merchant-Management Software", desc: "Manage merchant onboarding, KYC workflows, permissions and operational records." },
                { icon: Globe, title: "Payment Integration Support", desc: "Connect and manage approved payment-service-provider integrations through a unified software interface." },
                { icon: Shield, title: "Transaction Monitoring", desc: "View transaction statuses and provider responses received through integrated services." },
                { icon: Scale, title: "Reconciliation & Reports", desc: "Maintain transaction records, reports, reconciliation information and downloadable operational statements." },
              ].map(({ icon: Icon, title, desc }) => (
                <div key={title} className="rounded-xl border border-border/50 bg-card/40 p-5">
                  <Icon className="w-4 h-4 text-primary mb-3" />
                  <h3 className="font-semibold text-sm mb-1">{title}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>
          </section>

          {/* What RasoKart Is NOT */}
          <section>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">
              <AlertTriangle className="w-3.5 h-3.5" /> Important Clarifications
            </div>
            <h2 className="text-2xl font-bold tracking-tight mb-5">What RasoKart Is Not</h2>
            <p className="text-muted-foreground text-sm leading-relaxed mb-5">
              RasoKart does not hold an RBI Payment Aggregator licence and does not independently operate
              as a settlement institution, clearing house, or bank.
            </p>
            <div className="space-y-2">
              {[
                "An RBI-authorised Payment Aggregator",
                "An RBI-licensed Payment Gateway operating independently",
                "A bank or non-banking financial company (NBFC)",
                "A settlement institution or clearing house",
                "An entity that independently pools, holds or settles merchant or customer funds",
              ].map((item) => (
                <div key={item} className="flex items-start gap-3 text-sm text-muted-foreground">
                  <span className="w-5 h-5 rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center shrink-0 mt-0.5">
                    <span className="text-rose-400 text-xs font-bold">✕</span>
                  </span>
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </section>

          {/* Payment Services Partners */}
          <section>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">
              <Building2 className="w-3.5 h-3.5" /> Payment Services
            </div>
            <h2 className="text-2xl font-bold tracking-tight mb-5">Payment Processing & Settlement</h2>
            <div className="rounded-xl border border-border/50 bg-card/40 p-6 space-y-4 text-sm text-muted-foreground leading-relaxed">
              <p>
                Regulated payment processing and settlement services accessible through the RasoKart
                platform are provided by approved banks and licensed payment-service providers
                ("Payment Partners"). These Payment Partners are independently licensed and regulated by
                the Reserve Bank of India and/or other applicable authorities.
              </p>
              <p>
                The availability of specific payment methods, transaction limits, settlement timelines,
                and fee structures depends on the policies and terms of the applicable Payment Partner.
                RasoKart does not guarantee specific settlement timelines or outcomes — these are subject
                to the Payment Partner's processes, onboarding status, KYC completion, risk approval, and
                applicable terms.
              </p>
              <p>
                Merchant onboarding for payment services requires successful completion of applicable
                KYC/AML verification procedures and risk review by the relevant Payment Partner.
                RasoKart provides the software interface and integration layer; the contractual and
                regulatory relationship for payment processing remains between the merchant and the
                relevant Payment Partner.
              </p>
              <div className="rounded-lg border border-blue-400/20 bg-blue-400/5 px-4 py-3 text-xs text-blue-200">
                <strong>Provider Display Policy:</strong> RasoKart does not publicly disclose the names of
                its payment-service partners unless contractual approval and Super Admin authorisation have
                been obtained for such public display. This policy protects the commercial relationships
                and contractual confidentiality obligations of all parties.
              </div>
            </div>
          </section>

          {/* GST Service Classification */}
          <section>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">
              <FileText className="w-3.5 h-3.5" /> GST Classification
            </div>
            <h2 className="text-2xl font-bold tracking-tight mb-5">GST Service Activities</h2>
            <p className="text-muted-foreground text-sm leading-relaxed mb-4">
              Nickey Collection Private Limited (GSTIN: {GSTIN}) provides services classified under the
              following SAC codes. A GST amendment is currently submitted and pending approval.
            </p>
            <div className="space-y-2">
              {[
                { code: "998313", title: "Information Technology Consulting and Support Services" },
                { code: "998314", title: "Information Technology Design and Development Services" },
                { code: "998315", title: "Hosting and Information Technology Infrastructure Provisioning Services" },
                { code: "998319", title: "Other Information Technology Services" },
              ].map(({ code, title }) => (
                <div key={code} className="flex items-start gap-3 rounded-xl border border-border/40 bg-card/40 px-4 py-3 text-sm">
                  <span className="font-mono text-xs text-primary font-bold pt-0.5">{code}</span>
                  <span className="text-muted-foreground">{title}</span>
                </div>
              ))}
            </div>
          </section>

          {/* Merchant Acknowledgement */}
          <section>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">
              <CheckCircle2 className="w-3.5 h-3.5" /> Merchant Acknowledgement
            </div>
            <h2 className="text-2xl font-bold tracking-tight mb-5">Merchant Acknowledgement</h2>
            <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">
              {[
                "RasoKart is a software and technology platform, not an RBI-authorised Payment Aggregator or bank.",
                "Payment processing and settlement are performed by approved banks and licensed payment-service providers, not by RasoKart independently.",
                "Merchant eligibility for payment services depends on successful KYC, risk review, and onboarding approval by the relevant Payment Partner.",
                "Settlement timelines and transaction limits are governed by the applicable Payment Partner's policies.",
                "RasoKart does not hold, pool, or independently settle merchant or customer funds.",
                "By using the RasoKart platform, merchants agree to the applicable terms of the relevant Payment Partner in addition to RasoKart's Merchant Agreement.",
              ].map((item) => (
                <div key={item} className="flex items-start gap-3">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </section>

          {/* Contact */}
          <section className="border-t border-border/40 pt-8">
            <h2 className="text-xl font-bold tracking-tight mb-4">Contact & Grievance</h2>
            <p className="text-muted-foreground text-sm leading-relaxed mb-5">
              For queries regarding this disclosure, payment-partner arrangements, or grievances, contact:
            </p>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="rounded-xl border border-border/50 bg-card/40 p-5 space-y-2">
                <p className="font-semibold text-sm">Support</p>
                {supportPhone && (
                  <a href={`tel:${supportPhone}`} className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
                    <Phone className="w-3.5 h-3.5 text-primary" /> {supportPhone}
                  </a>
                )}
                {supportEmail && (
                  <a href={`mailto:${supportEmail}`} className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors break-all">
                    <Mail className="w-3.5 h-3.5 text-primary" /> {supportEmail}
                  </a>
                )}
                <div className="flex items-start gap-2 text-xs text-muted-foreground">
                  <MapPin className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                  <span>{REGISTERED_ADDRESS}</span>
                </div>
              </div>
              <div className="rounded-xl border border-border/50 bg-card/40 p-5 space-y-2">
                <p className="font-semibold text-sm">Related Policies</p>
                {[
                  { label: "Merchant Agreement", href: "/merchant-agreement" },
                  { label: "Terms & Conditions", href: "/terms-and-conditions" },
                  { label: "Privacy Policy", href: "/privacy-policy" },
                  { label: "KYC & AML Policy", href: "/kyc-aml-policy" },
                  { label: "Grievance Redressal", href: "/grievance-redressal-policy" },
                ].map(({ label, href }) => (
                  <Link key={href} href={href} className="block text-xs text-primary hover:underline">
                    {label} →
                  </Link>
                ))}
              </div>
            </div>
            <p className="text-xs text-muted-foreground/60 mt-6">
              Nickey Collection Private Limited · CIN: {CIN} · GSTIN: {GSTIN} · Last Updated: {LAST_UPDATED}
            </p>
          </section>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
