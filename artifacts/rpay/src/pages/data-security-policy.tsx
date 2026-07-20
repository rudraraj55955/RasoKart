import { useEffect } from "react";
import { Link } from "wouter";
import LegalLayout, {
  Bullet, InfoBox, SectionAnchor, SectionHeading, type LegalSection,
} from "@/components/layout/legal-layout";
import { useCompanySettings } from "@/lib/company-settings";
import {
  Lock, Database, Shield, Eye, Clock, AlertTriangle, Scale, Phone, FileText, Settings,
} from "lucide-react";

const LAST_UPDATED = "20 July 2026";

const sections: LegalSection[] = [
  { id: "overview", icon: FileText, title: "Overview", color: "text-cyan-400" },
  { id: "data-we-protect", icon: Database, title: "Data We Protect", color: "text-violet-400" },
  { id: "encryption", icon: Lock, title: "Encryption Standards", color: "text-blue-400" },
  { id: "access-controls", icon: Shield, title: "Access Controls", color: "text-emerald-400" },
  { id: "infrastructure", icon: Settings, title: "Infrastructure Security", color: "text-amber-400" },
  { id: "data-handling", icon: Eye, title: "Merchant Data Handling", color: "text-orange-400" },
  { id: "retention", icon: Clock, title: "Data Retention", color: "text-sky-400" },
  { id: "breach", icon: AlertTriangle, title: "Data Breach Response", color: "text-rose-400" },
  { id: "governing-law", icon: Scale, title: "Governing Law", color: "text-indigo-400" },
  { id: "contact", icon: Phone, title: "Contact", color: "text-teal-400" },
];

export default function DataSecurityPolicy() {
  const { companyName, supportEmail, supportPhone } = useCompanySettings();

  useEffect(() => {
    document.title = "Data Security Policy — RasoKart";
  }, []);

  return (
    <LegalLayout
      title="Data Security Policy"
      lastUpdated={LAST_UPDATED}
      badgeText="Security Policy"
      sections={sections}
      intro={
        <p className="text-muted-foreground leading-relaxed max-w-2xl mt-3">
          This Data Security Policy describes how <strong className="text-foreground">{companyName}</strong> ("RasoKart") protects the data it processes on behalf of merchants, customers, and users. It complements our <Link href="/privacy-policy" className="text-primary hover:underline">Privacy Policy</Link> and our <Link href="/pci-dss-security" className="text-primary hover:underline">PCI DSS & Security Information</Link> page.
        </p>
      }
    >
      <section className="space-y-4">
        <SectionAnchor id="overview" />
        <SectionHeading icon={FileText} title="Overview" color="text-cyan-400" id="overview" />
        <p className="text-muted-foreground text-sm leading-relaxed">
          Protecting the data entrusted to us is a core responsibility at RasoKart. We apply security controls across all layers of our platform — from network infrastructure to application code to data storage — to ensure that merchant, customer, and transaction data is kept confidential, integral, and available.
        </p>
        <InfoBox variant="success">
          RasoKart is designed with a security-first architecture. Cardholder data is never stored on our servers. Payment credentials are processed through PCI-aligned provider infrastructure only.
        </InfoBox>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="data-we-protect" />
        <SectionHeading icon={Database} title="Data We Protect" color="text-violet-400" id="data-we-protect" />
        <p className="text-muted-foreground text-sm leading-relaxed">RasoKart processes and protects the following categories of data:</p>
        <ul className="space-y-2">
          {[
            "Merchant identity data: name, email, phone, PAN, Aadhaar (masked), bank account details",
            "Business data: GST registration, incorporation documents, business address",
            "Transaction data: payment amounts, timestamps, transaction IDs, UPI/QR references",
            "Customer-provided data: customer name, email, phone (as shared by merchants in payment requests)",
            "API credentials: API keys and webhook secrets (stored as salted hashes, never in plaintext)",
            "Platform usage data: dashboard activity logs, login history, IP addresses",
          ].map(item => <Bullet key={item}>{item}</Bullet>)}
        </ul>
        <InfoBox variant="warning">
          RasoKart does not store card numbers, CVVs, or full card data. Such data is handled exclusively by our PCI DSS-certified payment provider partners.
        </InfoBox>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="encryption" />
        <SectionHeading icon={Lock} title="Encryption Standards" color="text-blue-400" id="encryption" />
        <ul className="space-y-2">
          {[
            "All data in transit is encrypted using TLS 1.2 or TLS 1.3 (older versions disabled)",
            "All data at rest in our databases is encrypted using AES-256",
            "API keys and webhook secrets are stored using one-way bcrypt hashing — we cannot recover these in plaintext",
            "Sensitive fields (e.g. masked Aadhaar numbers, PAN) are encrypted at the column level in our database",
            "HTTPS is enforced across all RasoKart domains with HSTS headers and certificate pinning where applicable",
          ].map(item => <Bullet key={item}>{item}</Bullet>)}
        </ul>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="access-controls" />
        <SectionHeading icon={Shield} title="Access Controls" color="text-emerald-400" id="access-controls" />
        <ul className="space-y-2">
          {[
            "Role-based access control (RBAC) enforces least-privilege access across all internal systems",
            "Multi-factor authentication is required for all administrative access to production systems",
            "All privileged access is logged and subject to periodic review",
            "Database access is limited to whitelisted internal IP addresses only — direct public database access is not permitted",
            "Merchant dashboard access requires email verification and is protected by rate-limited login with brute-force detection",
            "API access is authenticated via HMAC-signed API keys with per-endpoint permission scopes",
          ].map(item => <Bullet key={item}>{item}</Bullet>)}
        </ul>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="infrastructure" />
        <SectionHeading icon={Settings} title="Infrastructure Security" color="text-amber-400" id="infrastructure" />
        <ul className="space-y-2">
          {[
            "All production servers are hosted in ISO 27001-aligned data centres with physical access controls",
            "Network segmentation separates payment processing infrastructure from other systems",
            "Web application firewalls (WAF) protect against OWASP Top 10 attacks including SQL injection and XSS",
            "DDoS protection is active across all public-facing endpoints",
            "Automated vulnerability scanning and dependency monitoring are performed on a continuous basis",
            "Security patches are applied within 7 days for critical vulnerabilities and 30 days for others",
            "Penetration testing is conducted periodically by independent security researchers",
          ].map(item => <Bullet key={item}>{item}</Bullet>)}
        </ul>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="data-handling" />
        <SectionHeading icon={Eye} title="Merchant Data Handling" color="text-orange-400" id="data-handling" />
        <p className="text-muted-foreground text-sm leading-relaxed">As a merchant, you are responsible for the security of your own customers' data. RasoKart:</p>
        <ul className="space-y-2">
          {[
            "Processes customer data only as necessary to facilitate payment transactions",
            "Does not sell merchant or customer data to third parties",
            "Shares data with payment providers, banks, and regulators only as required to process transactions or comply with law",
            "Provides merchants with data export capabilities for their own records",
            "Retains transaction data for regulatory compliance (see Retention section below)",
          ].map(item => <Bullet key={item}>{item}</Bullet>)}
        </ul>
        <p className="text-muted-foreground text-sm leading-relaxed">
          Merchants must comply with applicable data protection laws — including the Digital Personal Data Protection Act 2023 (DPDP Act) — when handling customer data collected via RasoKart-powered checkout flows.
        </p>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="retention" />
        <SectionHeading icon={Clock} title="Data Retention" color="text-sky-400" id="retention" />
        <ul className="space-y-2">
          {[
            "Transaction records: Minimum 5 years as required by PMLA 2002 and RBI guidelines",
            "KYC documents: Minimum 5 years after account closure",
            "Audit logs and access logs: Minimum 2 years",
            "Customer communications and support tickets: Minimum 1 year",
            "API usage logs: 90 days for operational purposes, then anonymised for longer retention",
          ].map(item => <Bullet key={item}>{item}</Bullet>)}
        </ul>
        <p className="text-muted-foreground text-sm leading-relaxed">
          After the applicable retention period, data is securely deleted or anonymised. You may request deletion of specific non-regulatory data by contacting us; however, data required for legal compliance cannot be deleted before the statutory minimum period.
        </p>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="breach" />
        <SectionHeading icon={AlertTriangle} title="Data Breach Response" color="text-rose-400" id="breach" />
        <p className="text-muted-foreground text-sm leading-relaxed">
          In the event of a confirmed or suspected data security breach, RasoKart will:
        </p>
        <ul className="space-y-2">
          {[
            "Activate our incident response plan immediately upon detection",
            "Contain the breach and preserve forensic evidence",
            "Notify affected merchants within 72 hours of becoming aware of a breach, where practicable",
            "Notify the relevant Data Protection Board and regulators as required by the DPDP Act 2023 and applicable RBI circulars",
            "Provide a detailed post-incident report within 30 days of resolution",
            "Implement remediation measures to prevent recurrence",
          ].map(item => <Bullet key={item}>{item}</Bullet>)}
        </ul>
        <InfoBox variant="warning">
          If you suspect a security incident involving your RasoKart account — such as unauthorised access, API key compromise, or suspicious transactions — report it immediately via our <Link href="/responsible-disclosure" className="text-primary hover:underline">Responsible Disclosure</Link> process or contact support directly.
        </InfoBox>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="governing-law" />
        <SectionHeading icon={Scale} title="Governing Law" color="text-indigo-400" id="governing-law" />
        <p className="text-muted-foreground text-sm leading-relaxed">
          This policy is governed by the laws of India, including the Information Technology Act 2000, the Digital Personal Data Protection Act 2023, and applicable RBI guidelines. Disputes are subject to the jurisdiction of courts in Jaipur, Rajasthan, India.
        </p>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="contact" />
        <SectionHeading icon={Phone} title="Contact" color="text-teal-400" id="contact" />
        <div className="rounded-xl border border-border/60 bg-card/40 p-4 space-y-2 text-sm">
          <p><span className="text-muted-foreground">Security Team: </span><a href={`mailto:${supportEmail || "security@rasokart.com"}`} className="text-primary hover:underline">{supportEmail || "security@rasokart.com"}</a></p>
          {supportPhone && <p><span className="text-muted-foreground">Phone: </span><a href={`tel:${supportPhone}`} className="text-primary hover:underline">{supportPhone}</a></p>}
          <p><span className="text-muted-foreground">Related: </span>
            <Link href="/privacy-policy" className="text-primary hover:underline">Privacy Policy</Link> ·{" "}
            <Link href="/pci-dss-security" className="text-primary hover:underline">PCI DSS & Security</Link> ·{" "}
            <Link href="/responsible-disclosure" className="text-primary hover:underline">Responsible Disclosure</Link>
          </p>
        </div>
      </section>
    </LegalLayout>
  );
}
