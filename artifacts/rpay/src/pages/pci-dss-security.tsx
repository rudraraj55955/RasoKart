import { useEffect } from "react";
import { Link } from "wouter";
import LegalLayout, {
  Bullet, InfoBox, SectionAnchor, SectionHeading, type LegalSection,
} from "@/components/layout/legal-layout";
import { useCompanySettings } from "@/lib/company-settings";
import {
  Shield, Lock, CheckCircle, Settings, AlertTriangle, Scale, Phone, FileText, Eye, Database,
} from "lucide-react";

const LAST_UPDATED = "20 July 2026";

const sections: LegalSection[] = [
  { id: "overview", icon: FileText, title: "Overview", color: "text-cyan-400" },
  { id: "pci-dss", icon: Shield, title: "PCI DSS Compliance", color: "text-violet-400" },
  { id: "scope", icon: Eye, title: "Scope & Architecture", color: "text-blue-400" },
  { id: "controls", icon: Lock, title: "Security Controls", color: "text-emerald-400" },
  { id: "cardholder-data", icon: Database, title: "Cardholder Data Handling", color: "text-amber-400" },
  { id: "merchant-responsibilities", icon: Settings, title: "Merchant Responsibilities", color: "text-orange-400" },
  { id: "saq", icon: CheckCircle, title: "SAQ & Compliance Attestation", color: "text-sky-400" },
  { id: "incident-response", icon: AlertTriangle, title: "Incident Response", color: "text-rose-400" },
  { id: "governing-law", icon: Scale, title: "Governing Law", color: "text-indigo-400" },
  { id: "contact", icon: Phone, title: "Contact", color: "text-teal-400" },
];

export default function PciDssSecurity() {
  const { companyName, supportEmail, supportPhone } = useCompanySettings();

  useEffect(() => {
    document.title = "PCI DSS & Security Information — RasoKart";
  }, []);

  return (
    <LegalLayout
      title="PCI DSS & Security Information"
      lastUpdated={LAST_UPDATED}
      badgeText="Security Compliance"
      sections={sections}
      intro={
        <p className="text-muted-foreground leading-relaxed max-w-2xl mt-3">
          This page provides information about <strong className="text-foreground">{companyName}</strong>'s ("RasoKart") approach to PCI DSS (Payment Card Industry Data Security Standard) compliance and our broader security posture for payment processing. This document is intended for merchants, developers, and security professionals.
        </p>
      }
    >
      <section className="space-y-4">
        <SectionAnchor id="overview" />
        <SectionHeading icon={FileText} title="Overview" color="text-cyan-400" id="overview" />
        <p className="text-muted-foreground text-sm leading-relaxed">
          PCI DSS is a globally recognised information security standard established by the PCI Security Standards Council (PCI SSC) and mandated for all organisations that store, process, or transmit cardholder data. Compliance with PCI DSS is a requirement for operating as a payment service provider in India and internationally.
        </p>
        <InfoBox variant="success">
          RasoKart's payment processing infrastructure is designed to operate within a minimised PCI DSS scope. Card data is handled exclusively by our certified upstream payment processors — RasoKart does not store, transmit, or log raw card numbers or CVVs.
        </InfoBox>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="pci-dss" />
        <SectionHeading icon={Shield} title="PCI DSS Compliance" color="text-violet-400" id="pci-dss" />
        <p className="text-muted-foreground text-sm leading-relaxed">RasoKart's compliance approach:</p>
        <ul className="space-y-2">
          {[
            "RasoKart's primary payment processing flows use certified PCI DSS Level 1 or Level 2 payment provider infrastructure (Cashfree Payments, Razorpay, and others)",
            "Card data entry is handled via hosted payment pages or iframes served by our certified providers — card details never touch RasoKart servers",
            "We use tokenisation and payment references (order IDs, reference IDs) rather than card numbers in our systems",
            "Our internal systems comply with relevant PCI DSS controls covering network security, access control, logging, and vulnerability management",
            "We undergo periodic security assessments and work with Qualified Security Assessors (QSAs) as part of our compliance programme",
          ].map(item => <Bullet key={item}>{item}</Bullet>)}
        </ul>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="scope" />
        <SectionHeading icon={Eye} title="Scope & Architecture" color="text-blue-400" id="scope" />
        <p className="text-muted-foreground text-sm leading-relaxed">
          RasoKart uses a PCI-scoped payment architecture to minimise risk:
        </p>
        <ul className="space-y-2">
          {[
            "Payment page rendering: Hosted by certified providers (Cashfree, Razorpay). The actual card entry form is served from the provider's PCI-certified domain, not rasokart.com",
            "Transaction references: RasoKart stores only transaction IDs, payment status, and amounts — not card numbers, CVVs, or expiry dates",
            "Webhook notifications: Payment status updates are received and verified via HMAC signature, never containing raw card data",
            "API tokenisation: Card charges made via API use provider-issued tokens, not raw card data",
          ].map(item => <Bullet key={item}>{item}</Bullet>)}
        </ul>
        <InfoBox>
          This architecture means that most merchants integrating with RasoKart operate under SAQ A or SAQ A-EP compliance scope — significantly reducing your PCI compliance burden.
        </InfoBox>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="controls" />
        <SectionHeading icon={Lock} title="Security Controls" color="text-emerald-400" id="controls" />
        <p className="text-muted-foreground text-sm leading-relaxed">RasoKart implements the following PCI DSS-aligned controls:</p>
        <ul className="space-y-2">
          {[
            "Network security: Firewalls, network segmentation, and IDS/IPS protecting all payment-related systems",
            "Strong access control: Role-based access, multi-factor authentication, and least-privilege principles",
            "Encryption: TLS 1.2+ for all data in transit; AES-256 for data at rest",
            "Vulnerability management: Regular patching, automated dependency scanning, and penetration testing",
            "Monitoring and logging: All access to cardholder data environments is logged and monitored",
            "Physical security: Production infrastructure hosted in ISO 27001-certified data centres with restricted physical access",
          ].map(item => <Bullet key={item}>{item}</Bullet>)}
        </ul>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="cardholder-data" />
        <SectionHeading icon={Database} title="Cardholder Data Handling" color="text-amber-400" id="cardholder-data" />
        <InfoBox variant="danger">
          RasoKart does not and will never store: full card numbers (PAN), CVV2/CVC2 codes, card expiry dates in combination with PAN, or full magnetic stripe data.
        </InfoBox>
        <p className="text-muted-foreground text-sm leading-relaxed mt-4">What RasoKart does store:</p>
        <ul className="space-y-2">
          {[
            "Transaction reference IDs from our payment providers (not card data)",
            "Payment status (success, failed, pending) and amount",
            "Masked/tokenised payment method identifiers (e.g. last 4 digits) where provided by the payment network for display purposes",
            "UPI transaction references and VPA identifiers (which are not sensitive financial credentials)",
          ].map(item => <Bullet key={item}>{item}</Bullet>)}
        </ul>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="merchant-responsibilities" />
        <SectionHeading icon={Settings} title="Merchant Responsibilities" color="text-orange-400" id="merchant-responsibilities" />
        <p className="text-muted-foreground text-sm leading-relaxed">
          While RasoKart's architecture minimises your PCI scope, you remain responsible for:
        </p>
        <ul className="space-y-2">
          {[
            "Ensuring your website or application does not capture or log card data before it reaches the provider's hosted payment form",
            "Keeping your API keys and webhook secrets confidential — never logging them or including them in client-side code",
            "Completing your own PCI DSS Self-Assessment Questionnaire (SAQ) relevant to your integration type",
            "Ensuring any third-party plugins, scripts, or JavaScript libraries on your checkout pages are from trusted, audited sources",
            "Reporting suspected card data exposure incidents to RasoKart and your acquirer immediately",
          ].map(item => <Bullet key={item}>{item}</Bullet>)}
        </ul>
        <p className="text-muted-foreground text-sm leading-relaxed">
          For guidance on which SAQ applies to your integration, see our <Link href="/integration-guide" className="text-primary hover:underline">Integration Guide</Link> or contact our technical support team.
        </p>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="saq" />
        <SectionHeading icon={CheckCircle} title="SAQ & Compliance Attestation" color="text-sky-400" id="saq" />
        <p className="text-muted-foreground text-sm leading-relaxed">
          Based on your integration type, the relevant PCI DSS SAQ for most RasoKart merchants is:
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-muted-foreground border-collapse">
            <thead>
              <tr className="border-b border-border/60">
                <th className="text-left py-2 pr-4 font-medium text-foreground">Integration Type</th>
                <th className="text-left py-2 font-medium text-foreground">Applicable SAQ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {[
                ["Hosted payment page / redirect (iframe)", "SAQ A"],
                ["JavaScript hosted fields", "SAQ A-EP"],
                ["API / server-to-server (tokenised)", "SAQ D (Merchant)"],
                ["UPI / QR code / virtual account only", "Typically out of card PCI scope"],
              ].map(([type, saq]) => (
                <tr key={type}>
                  <td className="py-2 pr-4">{type}</td>
                  <td className="py-2 font-medium text-foreground">{saq}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-muted-foreground text-sm leading-relaxed">
          We recommend consulting the official PCI SSC website at <a href="https://www.pcisecuritystandards.org" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">pcisecuritystandards.org</a> or engaging a QSA for formal compliance advice specific to your business.
        </p>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="incident-response" />
        <SectionHeading icon={AlertTriangle} title="Incident Response" color="text-rose-400" id="incident-response" />
        <p className="text-muted-foreground text-sm leading-relaxed">In the event of a suspected payment data breach:</p>
        <ul className="space-y-2">
          {[
            "Contact RasoKart's security team immediately — do not delay",
            "Preserve all system logs, access records, and evidence — do not alter or delete any data",
            "Isolate affected systems from your network where possible",
            "Do not communicate details of the breach publicly before coordinating with RasoKart and relevant authorities",
            "Cooperate fully with our forensic investigation and any PCI Forensic Investigator (PFI) engagement",
          ].map(item => <Bullet key={item}>{item}</Bullet>)}
        </ul>
        <p className="text-muted-foreground text-sm leading-relaxed">
          For responsible security disclosure and vulnerability reporting, see our <Link href="/responsible-disclosure" className="text-primary hover:underline">Responsible Disclosure Policy</Link>.
        </p>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="governing-law" />
        <SectionHeading icon={Scale} title="Governing Law" color="text-indigo-400" id="governing-law" />
        <p className="text-muted-foreground text-sm leading-relaxed">
          This document is provided for informational purposes. PCI DSS compliance is governed by the PCI SSC and your acquiring bank's requirements. RasoKart's operations are additionally subject to RBI's cyber security framework for payment system operators.
        </p>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="contact" />
        <SectionHeading icon={Phone} title="Contact" color="text-teal-400" id="contact" />
        <div className="rounded-xl border border-border/60 bg-card/40 p-4 space-y-2 text-sm">
          <p><span className="text-muted-foreground">Security: </span><a href={`mailto:${supportEmail || "security@rasokart.com"}`} className="text-primary hover:underline">{supportEmail || "security@rasokart.com"}</a></p>
          {supportPhone && <p><span className="text-muted-foreground">Phone: </span><a href={`tel:${supportPhone}`} className="text-primary hover:underline">{supportPhone}</a></p>}
          <p><span className="text-muted-foreground">Related: </span>
            <Link href="/data-security-policy" className="text-primary hover:underline">Data Security Policy</Link> ·{" "}
            <Link href="/responsible-disclosure" className="text-primary hover:underline">Responsible Disclosure</Link> ·{" "}
            <Link href="/security-policy" className="text-primary hover:underline">Security Policy</Link>
          </p>
        </div>
      </section>
    </LegalLayout>
  );
}
