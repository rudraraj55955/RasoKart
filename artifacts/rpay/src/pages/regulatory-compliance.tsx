import { Link } from "wouter";
import LegalLayout, {
  SectionAnchor,
  SectionHeading,
  Bullet,
  type LegalSection,
} from "@/components/layout/legal-layout";
import {
  Shield,
  Building2,
  Users,
  Scale,
  AlertCircle,
  CheckCircle2,
  FileText,
} from "lucide-react";

const sections: LegalSection[] = [
  { id: "platform-nature", icon: Shield, title: "Platform Nature & Scope", color: "text-primary" },
  { id: "not-pa", icon: Scale, title: "Not an RBI Licensed Payment Aggregator", color: "text-amber-400" },
  { id: "payment-partners", icon: Building2, title: "Authorised Banking & Payment Partners", color: "text-sky-400" },
  { id: "merchant-onboarding", icon: Users, title: "Merchant Onboarding & Eligibility", color: "text-violet-400" },
  { id: "compliance", icon: CheckCircle2, title: "Compliance Commitments", color: "text-emerald-400" },
  { id: "related-policies", icon: FileText, title: "Related Policies & Disclosures", color: "text-muted-foreground" },
];

export default function RegulatoryCompliance() {
  return (
    <LegalLayout
      title="Regulatory & Compliance"
      subtitle="Important information about RasoKart's legal status, regulatory position, and compliance obligations."
      lastUpdated="August 2026"
      badgeText="Compliance"
      sections={sections}
      intro={
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-5 py-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-200 leading-relaxed">
            <strong className="text-amber-100">Important Notice:</strong>{" "}
            RasoKart provides software and payment technology services. Payment processing is performed only through authorised banking/payment partners after successful onboarding.
          </p>
        </div>
      }
    >
      {/* 1. Platform Nature */}
      <section>
        <SectionAnchor id="platform-nature" />
        <SectionHeading icon={Shield} title="Platform Nature & Scope" color="text-primary" id="platform-nature" />
        <ul className="space-y-3">
          <Bullet>
            <strong className="text-foreground">Software &amp; Technology Platform:</strong>{" "}
            RasoKart is a software and payment technology platform operated by Nickey Collection Private Limited (CIN: U47820RJ2025PTC109583 · GSTIN: 08AALCN0945P1ZT). RasoKart provides technology infrastructure, dashboards, and tools that enable merchants to manage payment operations.
          </Bullet>
          <Bullet>
            <strong className="text-foreground">Not a Financial Product:</strong>{" "}
            RasoKart's software subscription plans are not financial, lending, investment or deposit products. They are technology service subscriptions only.
          </Bullet>
          <Bullet>
            <strong className="text-foreground">Services for Lawful Businesses Only:</strong>{" "}
            Services are available only to lawful businesses operating in compliance with applicable Indian laws and regulations. Merchants engaged in prohibited, illegal, or specifically regulated activities that require their own licences are not eligible. See our{" "}
            <Link href="/prohibited-businesses" className="text-primary hover:underline">
              Prohibited Businesses Policy
            </Link>{" "}
            for a full list of ineligible business categories.
          </Bullet>
        </ul>
      </section>

      {/* 2. Not an RBI PA */}
      <section>
        <SectionAnchor id="not-pa" />
        <SectionHeading icon={Scale} title="Not an RBI Licensed Payment Aggregator" color="text-amber-400" id="not-pa" />
        <ul className="space-y-3">
          <Bullet>
            RasoKart is <strong className="text-foreground">not an RBI-licensed Payment Aggregator</strong>. RasoKart is not represented as, and does not operate as, an RBI-authorised Payment Aggregator.
          </Bullet>
          <Bullet>
            RasoKart does <strong className="text-foreground">not independently pool, hold, or settle</strong> customer or merchant funds. No merchant or customer funds are held by RasoKart at any point.
          </Bullet>
          <Bullet>
            RasoKart does <strong className="text-foreground">not independently process payments</strong>. All actual payment processing, collection, and fund movement is performed by authorised regulated entities (licensed Payment Aggregators, banks, and payment service providers).
          </Bullet>
        </ul>
      </section>

      {/* 3. Authorised Partners */}
      <section>
        <SectionAnchor id="payment-partners" />
        <SectionHeading icon={Building2} title="Authorised Banking & Payment Partners" color="text-sky-400" id="payment-partners" />
        <ul className="space-y-3">
          <Bullet>
            All payment processing, collection, settlement, and payout services accessible through the RasoKart platform are provided exclusively <strong className="text-foreground">through authorised banking/payment partners</strong> — licensed Payment Aggregators, banks, and regulated payment service providers.
          </Bullet>
          <Bullet>
            Settlement information displayed in the merchant portal is received from these authorised payment partners. RasoKart does not independently settle merchant funds.
          </Bullet>
          <Bullet>
            Payout services are available only to approved business merchants after successful KYC and onboarding. All payouts are processed through authorised banking/payment partners.
          </Bullet>
          <Bullet>
            For details of our current authorised payment partners and the services they provide, see our{" "}
            <Link href="/payment-partner-disclosure" className="text-primary hover:underline">
              Payment Partner Disclosure
            </Link>.
          </Bullet>
        </ul>
      </section>

      {/* 4. Merchant Onboarding */}
      <section>
        <SectionAnchor id="merchant-onboarding" />
        <SectionHeading icon={Users} title="Merchant Onboarding & Eligibility" color="text-violet-400" id="merchant-onboarding" />
        <ul className="space-y-3">
          <Bullet>
            <strong className="text-foreground">KYC/KYB Required:</strong>{" "}
            Merchant onboarding is subject to Know Your Customer (KYC) and Know Your Business (KYB) verification. Merchants must complete identity and business verification as a condition of accessing payment services.
          </Bullet>
          <Bullet>
            <strong className="text-foreground">Partner Approval Required:</strong>{" "}
            Access to live payment processing is contingent on approval by RasoKart's authorised banking and payment partners. Partner approvals are subject to the partner's own risk and compliance policies.
          </Bullet>
          <Bullet>
            <strong className="text-foreground">Ongoing Compliance:</strong>{" "}
            Merchants must maintain compliance with RasoKart's Acceptable Use Policy, Prohibited Businesses Policy, and all applicable laws for the duration of their engagement.
          </Bullet>
        </ul>
      </section>

      {/* 5. Compliance Commitments */}
      <section>
        <SectionAnchor id="compliance" />
        <SectionHeading icon={CheckCircle2} title="Compliance Commitments" color="text-emerald-400" id="compliance" />
        <ul className="space-y-3">
          <Bullet>
            RasoKart maintains AML/KYC policies, data security practices (including PCI DSS-aligned standards), and grievance redressal mechanisms in accordance with applicable Indian regulations.
          </Bullet>
          <Bullet>
            Merchant data is processed in accordance with the Information Technology Act, 2000, the Digital Personal Data Protection Act, 2023, and applicable RBI data localisation requirements.
          </Bullet>
          <Bullet>
            RasoKart cooperates fully with law enforcement agencies and regulatory authorities as required by applicable law.
          </Bullet>
          <Bullet>
            RasoKart operates an accessible Grievance Redressal mechanism. Merchants and customers may raise concerns via our{" "}
            <Link href="/grievance-officer" className="text-primary hover:underline">Grievance Officer</Link>{" "}
            or{" "}
            <Link href="/escalation-matrix" className="text-primary hover:underline">Escalation Matrix</Link>.
          </Bullet>
        </ul>
      </section>

      {/* 6. Related Policies */}
      <section>
        <SectionAnchor id="related-policies" />
        <SectionHeading icon={FileText} title="Related Policies & Disclosures" color="text-muted-foreground" id="related-policies" />
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
          {[
            { label: "Payment Partner Disclosure", href: "/payment-partner-disclosure" },
            { label: "KYC & AML Policy", href: "/kyc-aml-policy" },
            { label: "Risk & Fraud Prevention", href: "/risk-fraud-prevention" },
            { label: "Prohibited Businesses", href: "/prohibited-businesses" },
            { label: "Payout Policy", href: "/payout-policy" },
            { label: "Settlement Policy", href: "/payment-payout-settlement-policy" },
            { label: "Pricing & Fees Policy", href: "/pricing-fees-settlement-policy" },
            { label: "Merchant Agreement", href: "/merchant-agreement" },
            { label: "Data Security Policy", href: "/data-security-policy" },
            { label: "PCI DSS & Security", href: "/pci-dss-security" },
          ].map(({ label, href }) => (
            <li key={href} className="flex items-center gap-2 text-muted-foreground">
              <span className="w-1 h-1 rounded-full bg-primary/60 shrink-0" />
              <Link href={href} className="hover:text-foreground transition-colors">
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </LegalLayout>
  );
}
