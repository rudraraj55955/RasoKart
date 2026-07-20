import { useEffect } from "react";
import { Link } from "wouter";
import LegalLayout, {
  Bullet, InfoBox, SectionAnchor, SectionHeading, type LegalSection,
} from "@/components/layout/legal-layout";
import { useCompanySettings } from "@/lib/company-settings";
import {
  Shield, Eye, AlertTriangle, Settings, Scale, Phone, FileText, Ban, CheckCircle, Lock,
} from "lucide-react";

const LAST_UPDATED = "20 July 2026";

const sections: LegalSection[] = [
  { id: "overview", icon: FileText, title: "Overview", color: "text-cyan-400" },
  { id: "approach", icon: Shield, title: "Our Risk Approach", color: "text-violet-400" },
  { id: "fraud-detection", icon: Eye, title: "Fraud Detection Systems", color: "text-blue-400" },
  { id: "risk-categories", icon: AlertTriangle, title: "Risk Categories", color: "text-amber-400" },
  { id: "monitoring", icon: CheckCircle, title: "Transaction Monitoring", color: "text-emerald-400" },
  { id: "merchant-obligations", icon: Settings, title: "Merchant Obligations", color: "text-orange-400" },
  { id: "high-risk", icon: Ban, title: "High-Risk Indicators", color: "text-rose-400" },
  { id: "account-actions", icon: Lock, title: "Account Actions", color: "text-red-400" },
  { id: "reporting", icon: Scale, title: "Regulatory Reporting", color: "text-indigo-400" },
  { id: "contact", icon: Phone, title: "Contact", color: "text-teal-400" },
];

export default function RiskFraudPrevention() {
  const { companyName, supportEmail, supportPhone } = useCompanySettings();

  useEffect(() => {
    document.title = "Risk & Fraud Prevention Policy — RasoKart";
  }, []);

  return (
    <LegalLayout
      title="Risk & Fraud Prevention Policy"
      lastUpdated={LAST_UPDATED}
      badgeText="Compliance Policy"
      sections={sections}
      intro={
        <p className="text-muted-foreground leading-relaxed max-w-2xl mt-3">
          <strong className="text-foreground">{companyName}</strong> ("RasoKart") maintains a comprehensive risk and fraud prevention framework to protect merchants, customers, and the integrity of India's payment ecosystem. This policy describes our approach, your obligations, and the steps we take when risk is identified.
        </p>
      }
    >
      <section className="space-y-4">
        <SectionAnchor id="overview" />
        <SectionHeading icon={FileText} title="Overview" color="text-cyan-400" id="overview" />
        <p className="text-muted-foreground text-sm leading-relaxed">
          Payment fraud represents a real and growing threat to digital commerce in India. RasoKart's risk and fraud prevention programme is designed to detect, deter, and respond to fraudulent activity across all transaction types — collections, payouts, API transactions, and refunds. This policy is part of our wider compliance framework and is informed by RBI guidelines, PMLA 2002, and global best practices.
        </p>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="approach" />
        <SectionHeading icon={Shield} title="Our Risk Approach" color="text-violet-400" id="approach" />
        <p className="text-muted-foreground text-sm leading-relaxed">Our risk management framework is built on four pillars:</p>
        <ul className="space-y-2">
          {[
            "Prevention: Merchant onboarding KYC, business verification, and plan-based access controls that stop bad actors before they reach the platform",
            "Detection: Real-time automated monitoring of all transactions for anomalous patterns, velocity breaches, and known fraud signatures",
            "Response: Rapid account action — holds, flags, suspension — when risk is detected, with a fair escalation and appeals process",
            "Reporting: Mandatory STR/SAR filing with FIU-IND and cooperation with law enforcement when required",
          ].map(item => <Bullet key={item}>{item}</Bullet>)}
        </ul>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="fraud-detection" />
        <SectionHeading icon={Eye} title="Fraud Detection Systems" color="text-blue-400" id="fraud-detection" />
        <p className="text-muted-foreground text-sm leading-relaxed">RasoKart uses a combination of automated and manual controls to detect fraud:</p>
        <ul className="space-y-2">
          {[
            "Real-time transaction velocity checks against per-merchant, per-category, and platform-wide thresholds",
            "Behavioural analytics comparing each transaction against a merchant's historical baseline",
            "Device fingerprinting and IP reputation scoring for all web and API-initiated transactions",
            "Beneficiary blacklist screening against internal and regulatory watch-lists",
            "Pattern detection for common fraud types: card testing, structuring, smurfing, and account takeover",
            "Machine learning models trained on Indian payment fraud patterns",
            "Manual review queues for flagged transactions, handled by our compliance team",
          ].map(item => <Bullet key={item}>{item}</Bullet>)}
        </ul>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="risk-categories" />
        <SectionHeading icon={AlertTriangle} title="Risk Categories" color="text-amber-400" id="risk-categories" />
        <p className="text-muted-foreground text-sm leading-relaxed">We classify merchants and transactions across risk tiers:</p>
        <ul className="space-y-2">
          {[
            "Standard Risk: Well-established businesses with consistent transaction patterns and clean compliance history",
            "Elevated Risk: Businesses in higher-risk categories (travel, gaming, education, subscription), or those with elevated chargeback rates",
            "High Risk: Businesses with repeated compliance flags, suspicious transaction patterns, or in restricted categories requiring additional approval",
            "Critical Risk: Accounts with active fraud investigation, regulatory referral, or confirmed AML indicators",
          ].map(item => <Bullet key={item}>{item}</Bullet>)}
        </ul>
        <InfoBox variant="warning">
          Risk classification may change based on your transaction history, chargeback ratio, regulatory developments, or market conditions. Higher risk classifications may result in additional controls or fund holds.
        </InfoBox>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="monitoring" />
        <SectionHeading icon={CheckCircle} title="Transaction Monitoring" color="text-emerald-400" id="monitoring" />
        <p className="text-muted-foreground text-sm leading-relaxed">
          All transactions processed through RasoKart are monitored in real time. By accepting our terms, you consent to this monitoring. Specific monitoring activities include:
        </p>
        <ul className="space-y-2">
          {[
            "Screening all transactions against RBI's negative list and OFAC/UN sanctions lists",
            "Monitoring for unusual spikes in transaction volume, average ticket size, or refund rates",
            "Detecting transactions split across multiple accounts or time periods to evade limits",
            "Tracking chargeback ratios and dispute rates per merchant",
            "Monitoring payout disbursement patterns for structuring and layering behaviour",
          ].map(item => <Bullet key={item}>{item}</Bullet>)}
        </ul>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="merchant-obligations" />
        <SectionHeading icon={Settings} title="Merchant Obligations" color="text-orange-400" id="merchant-obligations" />
        <p className="text-muted-foreground text-sm leading-relaxed">Merchants are the first line of defence against fraud. You must:</p>
        <ul className="space-y-2">
          {[
            "Verify customer identity for high-value transactions using OTP, email verification, or equivalent methods",
            "Never process transactions on behalf of another party without RasoKart's explicit written approval",
            "Report suspected fraud, unusual customer behaviour, or account compromise to RasoKart immediately",
            "Maintain customer records and transaction logs as required under your applicable regulatory obligations",
            "Implement rate limiting and anti-abuse controls on your own payment forms and checkout pages",
            "Cooperate fully with RasoKart's fraud investigations, including providing customer data when lawfully required",
          ].map(item => <Bullet key={item}>{item}</Bullet>)}
        </ul>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="high-risk" />
        <SectionHeading icon={Ban} title="High-Risk Indicators" color="text-rose-400" id="high-risk" />
        <p className="text-muted-foreground text-sm leading-relaxed">The following patterns are treated as high-risk and will trigger investigation:</p>
        <ul className="space-y-2">
          {[
            "Chargeback ratio exceeding 1% of transaction volume in any 30-day period",
            "Sudden 3x or greater increase in transaction volume without a business explanation",
            "Multiple refunds to the same customer, UPI handle, or bank account",
            "Round-number transactions (e.g. ₹10,000, ₹50,000, ₹1,00,000) processed in rapid succession",
            "Transactions originating from known fraud-associated IP addresses or geographies",
            "Inconsistency between stated business type and actual transaction patterns",
            "Customer complaints alleging unauthorised charges or product/service not delivered",
          ].map(item => <Bullet key={item}>{item}</Bullet>)}
        </ul>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="account-actions" />
        <SectionHeading icon={Lock} title="Account Actions" color="text-red-400" id="account-actions" />
        <p className="text-muted-foreground text-sm leading-relaxed">When fraud or risk is detected, RasoKart may take the following actions:</p>
        <ul className="space-y-2">
          {[
            "Place a temporary hold on specific transactions pending review (typically resolved within 1–5 business days)",
            "Request additional documentation or business justification from the merchant",
            "Impose a rolling reserve — holding a percentage of funds for a defined period as a security against future chargebacks",
            "Suspend API access or payout privileges pending investigation",
            "Permanently terminate the merchant account in cases of confirmed fraud",
            "Report confirmed fraud to law enforcement, RBI, and FIU-IND as required by law",
          ].map(item => <Bullet key={item}>{item}</Bullet>)}
        </ul>
        <InfoBox>
          If your account is flagged or held, contact our compliance team immediately. Legitimate merchants with valid supporting documentation will be prioritised for rapid resolution.
        </InfoBox>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="reporting" />
        <SectionHeading icon={Scale} title="Regulatory Reporting" color="text-indigo-400" id="reporting" />
        <p className="text-muted-foreground text-sm leading-relaxed">
          RasoKart is legally required to file Suspicious Transaction Reports (STRs) and Cash Transaction Reports (CTRs) with the Financial Intelligence Unit — India (FIU-IND) under PMLA 2002. We file such reports when:
        </p>
        <ul className="space-y-2">
          {[
            "We have reason to believe funds are proceeds of crime or being used for money laundering",
            "A transaction or pattern appears to be structured to evade reporting thresholds",
            "Activity is consistent with terrorist financing patterns",
            "We receive a directive from a competent authority",
          ].map(item => <Bullet key={item}>{item}</Bullet>)}
        </ul>
        <p className="text-muted-foreground text-sm leading-relaxed">
          We are legally prohibited from disclosing to any customer or merchant that a report has been filed or an investigation is underway (the "tipping off" prohibition).
        </p>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="contact" />
        <SectionHeading icon={Phone} title="Contact" color="text-teal-400" id="contact" />
        <div className="rounded-xl border border-border/60 bg-card/40 p-4 space-y-2 text-sm">
          <p><span className="text-muted-foreground">Fraud Reporting: </span><a href={`mailto:${supportEmail || "compliance@rasokart.com"}`} className="text-primary hover:underline">{supportEmail || "compliance@rasokart.com"}</a></p>
          {supportPhone && <p><span className="text-muted-foreground">Phone: </span><a href={`tel:${supportPhone}`} className="text-primary hover:underline">{supportPhone}</a></p>}
          <p><span className="text-muted-foreground">Related: </span>
            <Link href="/kyc-aml-policy" className="text-primary hover:underline">KYC & AML Policy</Link> ·{" "}
            <Link href="/chargeback-dispute-policy" className="text-primary hover:underline">Chargeback & Dispute Policy</Link>
          </p>
        </div>
      </section>
    </LegalLayout>
  );
}
