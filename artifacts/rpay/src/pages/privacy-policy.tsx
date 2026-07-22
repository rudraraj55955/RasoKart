import { Link } from "wouter";
import { RasoKartLogo } from "@/components/ui/rasokart-logo";
import { useCompanySettings } from "@/lib/company-settings";
import { SiteFooter } from "@/components/ui/site-footer";
import {
  Shield,
  Database,
  Eye,
  Lock,
  Clock,
  Cookie,
  UserCheck,
  Baby,
  Scale,
  Phone,
  Mail,
  MapPin,
  ChevronRight,
  ArrowLeft,
} from "lucide-react";

const LAST_UPDATED = "16 July 2026";
const LEGAL_NAME = "Nickey Collection Private Limited";
const CIN = "U47820RJ2025PTC109583";
const INCORPORATION_DATE = "12 December 2025";
const REGISTERED_OFFICE =
  "P. No. B-46, Damodar Vila, Agarsen Nagar, Kalwad Road, Jhotwara, Jaipur – 302012, Rajasthan, India";
const WEBSITE = "https://rasokart.com";
const DEFAULT_SUPPORT_PHONE = "9358774496";

interface Section {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  color: string;
}

const sections: Section[] = [
  { id: "information-collect", icon: Database, title: "Information We Collect", color: "text-cyan-400" },
  { id: "how-we-use", icon: Eye, title: "How We Use Information", color: "text-violet-400" },
  { id: "service-providers", icon: Shield, title: "Payment and Service Providers", color: "text-blue-400" },
  { id: "data-security", icon: Lock, title: "Data Security", color: "text-emerald-400" },
  { id: "data-retention", icon: Clock, title: "Data Retention", color: "text-amber-400" },
  { id: "cookies", icon: Cookie, title: "Cookies", color: "text-orange-400" },
  { id: "user-rights", icon: UserCheck, title: "Your Rights", color: "text-pink-400" },
  { id: "childrens-privacy", icon: Baby, title: "Children's Privacy", color: "text-red-400" },
  { id: "legal-compliance", icon: Scale, title: "Legal Compliance", color: "text-indigo-400" },
  { id: "contact", icon: Phone, title: "Contact and Grievance", color: "text-teal-400" },
  { id: "policy-updates", icon: Shield, title: "Policy Updates", color: "text-muted-foreground" },
];

function SectionAnchor({ id }: { id: string }) {
  return <span id={id} className="block" style={{ scrollMarginTop: "6rem" }} />;
}

function SectionHeading({
  icon: Icon,
  title,
  color,
  id,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  color: string;
  id: string;
}) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className={`p-2 rounded-lg bg-card border border-border/50`}>
        <Icon className={`w-5 h-5 ${color}`} />
      </div>
      <h2 className="text-xl font-semibold text-foreground">{title}</h2>
      <a href={`#${id}`} className="ml-auto text-muted-foreground/40 hover:text-muted-foreground transition-colors text-xs">
        #
      </a>
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2 text-muted-foreground text-sm leading-relaxed">
      <ChevronRight className="w-4 h-4 text-primary/60 shrink-0 mt-0.5" />
      <span>{children}</span>
    </li>
  );
}

export default function PrivacyPolicy() {
  const { companyName, supportPhone, supportEmail, grievanceOfficerName } = useCompanySettings();
  const resolvedPhone = supportPhone || DEFAULT_SUPPORT_PHONE;
  const resolvedCompany = companyName || LEGAL_NAME;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2.5 shrink-0">
            <RasoKartLogo size={32} />
            <span className="font-bold text-base hidden sm:block">RasoKart</span>
          </Link>
          <span className="text-sm font-medium text-foreground">Privacy Policy</span>
          <Link
            href="/"
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Home
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-12 lg:py-16">
        <div className="lg:grid lg:grid-cols-[240px_1fr] lg:gap-12 xl:grid-cols-[280px_1fr]">
          {/* Sidebar TOC — desktop only */}
          <aside className="hidden lg:block">
            <div className="sticky top-24 space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Contents
              </p>
              {sections.map((s) => (
                <a
                  key={s.id}
                  href={`#${s.id}`}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-card/60 transition-colors group"
                >
                  <s.icon className={`w-3.5 h-3.5 ${s.color} shrink-0`} />
                  <span>{s.title}</span>
                </a>
              ))}
            </div>
          </aside>

          {/* Main content */}
          <main className="min-w-0 space-y-10">
            {/* Hero */}
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-primary/30 bg-primary/10 text-primary text-xs font-medium mb-4">
                <Shield className="w-3.5 h-3.5" />
                Last Updated: {LAST_UPDATED}
              </div>
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">Privacy Policy</h1>
              <p className="text-muted-foreground leading-relaxed max-w-2xl">
                This Privacy Policy explains how <strong className="text-foreground">{resolvedCompany}</strong>{" "}
                ("RasoKart", "we", "our", or "us") collects, uses, stores, and protects information
                when you use our payment gateway platform at{" "}
                <a href={WEBSITE} className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">
                  {WEBSITE}
                </a>
                {" "}("Platform"). By accessing or using the Platform, you agree to the practices described
                in this Policy.
              </p>
              <p className="text-muted-foreground text-sm mt-3">
                <strong className="text-foreground">CIN:</strong> {CIN} &nbsp;|&nbsp;{" "}
                <strong className="text-foreground">GSTIN:</strong> 08AALCN0945P1ZT &nbsp;|&nbsp;{" "}
                <strong className="text-foreground">Incorporated:</strong> {INCORPORATION_DATE}
              </p>
              <div className="mt-4 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-xs text-amber-200 leading-relaxed max-w-2xl">
                <strong className="text-amber-100">Regulatory Disclosure:</strong>{" "}
                RasoKart is a software and technology platform operated by Nickey Collection Private Limited. RasoKart is not represented as an RBI-authorised Payment Aggregator and does not independently pool or settle customer or merchant funds. Regulated payment processing and settlement services are provided through approved banks and payment-service providers, subject to onboarding, KYC, risk approval and applicable terms.
              </div>
            </div>

            {/* Divider */}
            <div className="border-t border-border/40" />

            {/* 1. Information We Collect */}
            <section>
              <SectionAnchor id="information-collect" />
              <SectionHeading icon={Database} title="1. Information We Collect" color="text-cyan-400" id="information-collect" />
              <p className="text-muted-foreground text-sm mb-4 leading-relaxed">
                We collect information necessary to provide, operate, and improve the Platform. This includes:
              </p>
              <div className="space-y-4">
                <div className="rounded-xl border border-border/50 bg-card/40 p-4">
                  <p className="text-sm font-semibold text-foreground mb-2">Account and Identity Information</p>
                  <ul className="space-y-1.5">
                    <Bullet>Name, email address, mobile number and account credentials</Bullet>
                    <Bullet>Business and merchant KYC information, including business type and registration details</Bullet>
                    <Bullet>PAN, GST number, bank account details and other verification documents where required by law or regulation</Bullet>
                  </ul>
                </div>
                <div className="rounded-xl border border-border/50 bg-card/40 p-4">
                  <p className="text-sm font-semibold text-foreground mb-2">Transaction and Financial Information</p>
                  <ul className="space-y-1.5">
                    <Bullet>Payment, refund, settlement and payout transaction data</Bullet>
                    <Bullet>Order and invoice details, amounts, currency, and transaction status</Bullet>
                    <Bullet>Reconciliation records and settlement history</Bullet>
                  </ul>
                </div>
                <div className="rounded-xl border border-border/50 bg-card/40 p-4">
                  <p className="text-sm font-semibold text-foreground mb-2">Technical and Usage Information</p>
                  <ul className="space-y-1.5">
                    <Bullet>Device information, IP address, browser type and version, and operating system</Bullet>
                    <Bullet>Cookies, session tokens and usage logs collected automatically during your use of the Platform</Bullet>
                    <Bullet>API usage logs and webhook delivery records</Bullet>
                  </ul>
                </div>
                <div className="rounded-xl border border-border/50 bg-card/40 p-4">
                  <p className="text-sm font-semibold text-foreground mb-2">Communications and Support</p>
                  <ul className="space-y-1.5">
                    <Bullet>Customer support queries, feedback and correspondence</Bullet>
                    <Bullet>Documents and files you upload during KYC verification or support requests</Bullet>
                  </ul>
                </div>
              </div>
            </section>

            {/* 2. How We Use Information */}
            <section>
              <SectionAnchor id="how-we-use" />
              <SectionHeading icon={Eye} title="2. How We Use Information" color="text-violet-400" id="how-we-use" />
              <p className="text-muted-foreground text-sm mb-4 leading-relaxed">
                We use the information collected for the following purposes:
              </p>
              <ul className="space-y-2">
                <Bullet>Account creation, authentication and secure login management</Bullet>
                <Bullet>Merchant onboarding, KYC verification and compliance checks</Bullet>
                <Bullet>Processing payments, payouts, settlements and refunds on behalf of merchants</Bullet>
                <Bullet>Fraud prevention, security monitoring, risk management and detection of suspicious activity</Bullet>
                <Bullet>Meeting legal, regulatory, KYC and AML compliance obligations under applicable Indian law</Bullet>
                <Bullet>Providing customer support, resolving disputes and sending service notifications</Bullet>
                <Bullet>Improving the functionality, performance and reliability of the Platform</Bullet>
                <Bullet>Generating reports, analytics and audit trails required for operations and compliance</Bullet>
              </ul>
            </section>

            {/* 3. Payment and Service Providers */}
            <section>
              <SectionAnchor id="service-providers" />
              <SectionHeading icon={Shield} title="3. Payment and Service Providers" color="text-blue-400" id="service-providers" />
              <p className="text-muted-foreground text-sm leading-relaxed mb-4">
                To operate the Platform, we may share limited and necessary information with authorised third
                parties under strict confidentiality obligations. This includes:
              </p>
              <ul className="space-y-2 mb-4">
                <Bullet>
                  <strong className="text-foreground">Banks and payment settlement entities</strong> — to process and settle transactions
                </Bullet>
                <Bullet>
                  <strong className="text-foreground">Payment gateway and processing partners</strong> — to authorise and route payment transactions
                </Bullet>
                <Bullet>
                  <strong className="text-foreground">Identity and KYC verification providers</strong> — to verify PAN, Aadhaar, and business documents as required by law
                </Bullet>
                <Bullet>
                  <strong className="text-foreground">Technology and infrastructure providers</strong> — to host, secure and operate the Platform
                </Bullet>
                <Bullet>
                  <strong className="text-foreground">Regulatory and law enforcement authorities</strong> — when required by applicable law, court order, or regulatory directive
                </Bullet>
              </ul>
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
                <p className="text-sm text-amber-400/80 leading-relaxed">
                  We do not sell, rent or trade your personal information to third parties for their independent
                  marketing purposes. Information is shared with partners only to the extent strictly required
                  to deliver the services you use.
                </p>
              </div>
            </section>

            {/* 4. Data Security */}
            <section>
              <SectionAnchor id="data-security" />
              <SectionHeading icon={Lock} title="4. Data Security" color="text-emerald-400" id="data-security" />
              <p className="text-muted-foreground text-sm leading-relaxed mb-4">
                We implement reasonable technical and organisational security measures to protect your information,
                including:
              </p>
              <ul className="space-y-2 mb-4">
                <Bullet>Encryption of data in transit using TLS/HTTPS</Bullet>
                <Bullet>Access controls and role-based permissions limiting data access to authorised personnel</Bullet>
                <Bullet>Continuous security monitoring, activity logging and anomaly detection</Bullet>
                <Bullet>Secure server infrastructure with regular security assessments</Bullet>
              </ul>
              <div className="rounded-xl border border-border/50 bg-card/40 px-4 py-3">
                <p className="text-sm text-muted-foreground leading-relaxed">
                  While we take these measures seriously, no system can guarantee absolute security. We encourage
                  you to keep your account credentials confidential and notify us immediately of any suspected
                  unauthorised access.
                </p>
              </div>
            </section>

            {/* 5. Data Retention */}
            <section>
              <SectionAnchor id="data-retention" />
              <SectionHeading icon={Clock} title="5. Data Retention" color="text-amber-400" id="data-retention" />
              <p className="text-muted-foreground text-sm leading-relaxed mb-4">
                We retain your information only for as long as is necessary for the purposes described in this
                Policy and as required by applicable law:
              </p>
              <ul className="space-y-2">
                <Bullet>
                  Transaction and financial records are retained for the periods required under applicable Indian
                  tax, accounting and regulatory laws
                </Bullet>
                <Bullet>
                  KYC and identity verification records are retained as required under Prevention of Money
                  Laundering Act (PMLA) and Reserve Bank of India guidelines
                </Bullet>
                <Bullet>
                  Account information is retained while your account is active and for a reasonable period
                  thereafter for audit, dispute resolution and legal purposes
                </Bullet>
                <Bullet>
                  You may request deletion of certain data subject to compliance obligations that may require us
                  to retain it
                </Bullet>
              </ul>
            </section>

            {/* 6. Cookies */}
            <section>
              <SectionAnchor id="cookies" />
              <SectionHeading icon={Cookie} title="6. Cookies" color="text-orange-400" id="cookies" />
              <p className="text-muted-foreground text-sm leading-relaxed mb-4">
                We use cookies and similar technologies to operate and improve the Platform:
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  {
                    title: "Essential Cookies",
                    desc: "Required for the Platform to function correctly. These cannot be disabled as they enable core features such as login, session management and security.",
                  },
                  {
                    title: "Authentication Cookies",
                    desc: "Store your login session token securely to keep you signed in during your session and enforce role-based access.",
                  },
                  {
                    title: "Analytics Cookies",
                    desc: "Help us understand how the Platform is used — which features are accessed most, how navigation flows, and where improvements can be made.",
                  },
                  {
                    title: "Preference Cookies",
                    desc: "Remember your settings and preferences (such as display preferences) to improve your experience on return visits.",
                  },
                ].map((c) => (
                  <div key={c.title} className="rounded-xl border border-border/50 bg-card/40 p-4">
                    <p className="text-sm font-semibold text-foreground mb-1.5">{c.title}</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">{c.desc}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* 7. User Rights */}
            <section>
              <SectionAnchor id="user-rights" />
              <SectionHeading icon={UserCheck} title="7. Your Rights" color="text-pink-400" id="user-rights" />
              <p className="text-muted-foreground text-sm leading-relaxed mb-4">
                Subject to applicable law and our compliance obligations, you have the following rights regarding
                your personal information:
              </p>
              <ul className="space-y-2 mb-4">
                <Bullet>
                  <strong className="text-foreground">Access:</strong> Request a copy of the personal information we hold about you
                </Bullet>
                <Bullet>
                  <strong className="text-foreground">Correction:</strong> Request correction of inaccurate or incomplete personal information
                </Bullet>
                <Bullet>
                  <strong className="text-foreground">Deletion:</strong> Request deletion of your personal information, subject to legal retention requirements
                </Bullet>
                <Bullet>
                  <strong className="text-foreground">Account assistance:</strong> Contact us for any account-related query, concern or data request
                </Bullet>
              </ul>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Please note that certain data may need to be retained for compliance, regulatory, audit or
                dispute resolution purposes even after you submit a deletion request. To exercise any of these
                rights, contact us using the details in the{" "}
                <a href="#contact" className="text-primary hover:underline">
                  Contact and Grievance
                </a>{" "}
                section below.
              </p>
            </section>

            {/* 8. Children's Privacy */}
            <section>
              <SectionAnchor id="childrens-privacy" />
              <SectionHeading icon={Baby} title="8. Children's Privacy" color="text-red-400" id="childrens-privacy" />
              <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-4">
                <p className="text-sm text-muted-foreground leading-relaxed">
                  The Platform is intended solely for use by persons who are{" "}
                  <strong className="text-foreground">18 years of age or older</strong>. We do not knowingly collect,
                  process or store personal information from persons below the age of 18. If you believe a minor
                  has provided us with personal information, please contact us immediately and we will take steps
                  to delete such information promptly.
                </p>
              </div>
            </section>

            {/* 9. Legal Compliance */}
            <section>
              <SectionAnchor id="legal-compliance" />
              <SectionHeading icon={Scale} title="9. Legal Compliance" color="text-indigo-400" id="legal-compliance" />
              <p className="text-muted-foreground text-sm leading-relaxed mb-4">
                Our collection, processing and protection of personal information is conducted in accordance with
                applicable Indian laws and regulations, including:
              </p>
              <ul className="space-y-2 mb-4">
                <Bullet>
                  The Information Technology Act, 2000 and the Information Technology (Reasonable Security
                  Practices and Procedures and Sensitive Personal Data or Information) Rules, 2011
                </Bullet>
                <Bullet>Prevention of Money Laundering Act (PMLA) and related KYC and AML obligations</Bullet>
                <Bullet>
                  Reserve Bank of India guidelines applicable to payment aggregators, intermediaries and
                  merchants
                </Bullet>
                <Bullet>
                  Income Tax Act, 1961 and applicable GST laws requiring retention of financial records
                </Bullet>
              </ul>
              <p className="text-muted-foreground text-sm leading-relaxed">
                We may disclose personal information to government authorities, regulators, courts or law
                enforcement agencies when required to do so by applicable law, a valid court order, or a lawful
                directive from a regulatory authority. We will endeavour to notify you of such disclosure where
                permitted by law.
              </p>
            </section>

            {/* 10. Contact and Grievance */}
            <section>
              <SectionAnchor id="contact" />
              <SectionHeading icon={Phone} title="10. Contact and Grievance" color="text-teal-400" id="contact" />
              <p className="text-muted-foreground text-sm leading-relaxed mb-6">
                If you have any questions, concerns or requests regarding this Privacy Policy or the processing
                of your personal information, please contact us using the details below. We will endeavour to
                respond within a reasonable time.
              </p>

              <div className="grid gap-4 sm:grid-cols-2 mb-6">
                <div className="rounded-xl border border-border/50 bg-card/40 p-5 space-y-3">
                  <p className="text-sm font-semibold text-foreground">Company Details</p>
                  <div className="space-y-2">
                    <div className="flex gap-2 text-sm">
                      <span className="text-muted-foreground/60 shrink-0 w-20 text-xs pt-0.5">Legal Name</span>
                      <span className="text-muted-foreground leading-snug">{resolvedCompany}</span>
                    </div>
                    <div className="flex gap-2 text-sm">
                      <span className="text-muted-foreground/60 shrink-0 w-20 text-xs pt-0.5">CIN</span>
                      <span className="text-muted-foreground font-mono text-xs">{CIN}</span>
                    </div>
                    <div className="flex gap-2 text-sm">
                      <MapPin className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0 mt-0.5" />
                      <span className="text-muted-foreground text-xs leading-snug">{REGISTERED_OFFICE}</span>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-border/50 bg-card/40 p-5 space-y-3">
                  <p className="text-sm font-semibold text-foreground">Support Contact</p>
                  <div className="space-y-2">
                    <a
                      href={`tel:${resolvedPhone}`}
                      className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Phone className="w-3.5 h-3.5 text-teal-400 shrink-0" />
                      {resolvedPhone}
                    </a>
                    {supportEmail ? (
                      <a
                        href={`mailto:${supportEmail}`}
                        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors break-all"
                      >
                        <Mail className="w-3.5 h-3.5 text-teal-400 shrink-0" />
                        {supportEmail}
                      </a>
                    ) : (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground/50">
                        <Mail className="w-3.5 h-3.5 shrink-0" />
                        <span>Contact via phone or portal support</span>
                      </div>
                    )}
                    <a
                      href={WEBSITE}
                      className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Shield className="w-3.5 h-3.5 text-teal-400 shrink-0" />
                      {WEBSITE}
                    </a>
                  </div>
                </div>
              </div>

              {/* Grievance Officer */}
              <div className="rounded-xl border border-teal-500/20 bg-teal-500/5 p-5">
                <div className="flex items-start gap-3">
                  <UserCheck className="w-5 h-5 text-teal-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-foreground mb-1">Grievance Officer</p>
                    {grievanceOfficerName ? (
                      <p className="text-sm text-muted-foreground">{grievanceOfficerName}</p>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        For grievances related to this Privacy Policy or your personal data, please write to us at
                        the registered office address above or contact us via the support details provided.
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground/60 mt-2">
                      We will acknowledge your grievance within 48 hours and endeavour to resolve it within 30 days.
                    </p>
                  </div>
                </div>
              </div>
            </section>

            {/* 11. Policy Updates */}
            <section>
              <SectionAnchor id="policy-updates" />
              <SectionHeading icon={Shield} title="11. Policy Updates" color="text-muted-foreground" id="policy-updates" />
              <p className="text-muted-foreground text-sm leading-relaxed mb-3">
                We may update this Privacy Policy from time to time to reflect changes in our practices,
                technology, legal requirements or for other operational reasons. When we make material changes,
                we will:
              </p>
              <ul className="space-y-2 mb-4">
                <Bullet>Publish the updated Privacy Policy on this page with a revised "Last Updated" date</Bullet>
                <Bullet>
                  Notify registered merchants and users of significant changes via email or an in-platform
                  notification where appropriate
                </Bullet>
              </ul>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Your continued use of the Platform after the effective date of any update constitutes your
                acceptance of the revised Privacy Policy. We encourage you to review this page periodically.
              </p>
            </section>

            {/* Footer note */}
            <div className="border-t border-border/40 pt-8">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-muted-foreground/60">
                <span>
                  © {new Date().getFullYear()} {resolvedCompany}. All rights reserved.
                </span>
                <div className="flex items-center gap-4">
                  <span>Last Updated: {LAST_UPDATED}</span>
                  <Link href="/" className="hover:text-muted-foreground transition-colors">
                    ← Back to Home
                  </Link>
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
