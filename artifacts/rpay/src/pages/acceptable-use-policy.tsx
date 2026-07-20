import { useEffect } from "react";
import { Link } from "wouter";
import LegalLayout, {
  Bullet, InfoBox, SectionAnchor, SectionHeading, type LegalSection,
} from "@/components/layout/legal-layout";
import { useCompanySettings } from "@/lib/company-settings";
import {
  FileText, CheckCircle, Ban, AlertTriangle, Shield, Scale, Phone, Settings, Eye, Gavel,
} from "lucide-react";

const LAST_UPDATED = "20 July 2026";

const sections: LegalSection[] = [
  { id: "overview", icon: FileText, title: "Overview", color: "text-cyan-400" },
  { id: "permitted-use", icon: CheckCircle, title: "Permitted Use", color: "text-emerald-400" },
  { id: "prohibited-use", icon: Ban, title: "Prohibited Use", color: "text-red-400" },
  { id: "system-integrity", icon: Shield, title: "System Integrity", color: "text-violet-400" },
  { id: "content-standards", icon: Eye, title: "Content Standards", color: "text-blue-400" },
  { id: "merchant-obligations", icon: Settings, title: "Merchant Obligations", color: "text-amber-400" },
  { id: "monitoring", icon: AlertTriangle, title: "Monitoring & Enforcement", color: "text-orange-400" },
  { id: "consequences", icon: Gavel, title: "Consequences of Violation", color: "text-rose-400" },
  { id: "governing-law", icon: Scale, title: "Governing Law", color: "text-indigo-400" },
  { id: "contact", icon: Phone, title: "Contact Us", color: "text-teal-400" },
];

export default function AcceptableUsePolicy() {
  const { companyName, supportEmail, supportPhone } = useCompanySettings();

  useEffect(() => {
    document.title = "Acceptable Use Policy — RasoKart";
  }, []);

  return (
    <LegalLayout
      title="Acceptable Use Policy"
      lastUpdated={LAST_UPDATED}
      badgeText="Usage Policy"
      sections={sections}
      intro={
        <p className="text-muted-foreground leading-relaxed max-w-2xl mt-3">
          This Acceptable Use Policy ("AUP") sets out the rules governing the use of RasoKart's payment gateway services and platform, operated by <strong className="text-foreground">{companyName}</strong>. All merchants, agents, payout merchants, developers, and users must comply with this policy. Using our services constitutes acceptance of these terms.
        </p>
      }
    >
      {/* Overview */}
      <section className="space-y-4">
        <SectionAnchor id="overview" />
        <SectionHeading icon={FileText} title="Overview" color="text-cyan-400" id="overview" />
        <p className="text-muted-foreground text-sm leading-relaxed">
          RasoKart provides payment infrastructure services including payment collection, virtual accounts, QR codes, payout disbursement, and API access. This AUP applies to all users of these services and is incorporated into our <Link href="/merchant-agreement" className="text-primary hover:underline">Merchant Agreement</Link> and <Link href="/terms-and-conditions" className="text-primary hover:underline">Terms and Conditions</Link>.
        </p>
        <InfoBox variant="warning">
          Violation of this policy may result in immediate suspension of your account, termination of services, withholding of funds, and/or referral to law enforcement authorities.
        </InfoBox>
      </section>

      {/* Permitted Use */}
      <section className="space-y-4">
        <SectionAnchor id="permitted-use" />
        <SectionHeading icon={CheckCircle} title="Permitted Use" color="text-emerald-400" id="permitted-use" />
        <p className="text-muted-foreground text-sm leading-relaxed">You may use RasoKart services to:</p>
        <ul className="space-y-2">
          {[
            "Accept payments for legitimate goods and services that comply with applicable law",
            "Disburse funds to verified beneficiaries for legitimate business purposes",
            "Integrate payment functionality into your website or application via our API",
            "Manage your merchant account, settlement preferences, and webhook configurations",
            "Access transaction reports and analytics for your own business operations",
            "Onboard sub-merchants or agents in accordance with your authorised plan",
          ].map(item => <Bullet key={item}>{item}</Bullet>)}
        </ul>
      </section>

      {/* Prohibited Use */}
      <section className="space-y-4">
        <SectionAnchor id="prohibited-use" />
        <SectionHeading icon={Ban} title="Prohibited Use" color="text-red-400" id="prohibited-use" />
        <InfoBox variant="danger">
          The following uses are strictly prohibited. This list is not exhaustive — RasoKart reserves the right to determine, at its sole discretion, whether a use is acceptable.
        </InfoBox>
        <p className="text-muted-foreground text-sm font-medium mt-4 mb-2">Illegal Activities</p>
        <ul className="space-y-2">
          {[
            "Processing payments for illegal goods, services, or activities under Indian or applicable international law",
            "Money laundering, terrorist financing, or any activity in violation of PMLA 2002 or FATF guidelines",
            "Facilitating fraud, including card fraud, account takeover, or identity theft",
            "Circumventing foreign exchange controls or FEMA regulations",
            "Operating unlicensed financial services including unauthorised lending, insurance, or investment advisory",
          ].map(item => <Bullet key={item}>{item}</Bullet>)}
        </ul>
        <p className="text-muted-foreground text-sm font-medium mt-4 mb-2">Restricted Business Categories</p>
        <ul className="space-y-2">
          {[
            "Businesses listed in our Prohibited Businesses Policy",
            "Adult content, gambling, or multi-level marketing (MLM) schemes without explicit written approval",
            "Sale of counterfeit, infringing, or stolen goods",
            "Businesses operating without required licences, registrations, or government approvals",
          ].map(item => <Bullet key={item}>{item}</Bullet>)}
        </ul>
        <p className="text-muted-foreground text-sm font-medium mt-4 mb-2">Platform Misuse</p>
        <ul className="space-y-2">
          {[
            "Creating false or misleading merchant accounts or submitting fraudulent KYC documents",
            "Using RasoKart services on behalf of a third party without authorisation",
            "Conducting transactions that do not correspond to actual commercial activity",
            "Splitting transactions to evade transaction limits or monitoring thresholds",
            "Using the platform to process payments for other payment service providers without approval",
          ].map(item => <Bullet key={item}>{item}</Bullet>)}
        </ul>
        <p className="text-muted-foreground text-sm leading-relaxed mt-2">
          For a complete list of prohibited business types, see our <Link href="/prohibited-businesses" className="text-primary hover:underline">Prohibited Businesses Policy</Link>.
        </p>
      </section>

      {/* System Integrity */}
      <section className="space-y-4">
        <SectionAnchor id="system-integrity" />
        <SectionHeading icon={Shield} title="System Integrity" color="text-violet-400" id="system-integrity" />
        <p className="text-muted-foreground text-sm leading-relaxed">You must not attempt to compromise the security or integrity of RasoKart's systems. Prohibited technical activities include:</p>
        <ul className="space-y-2">
          {[
            "Attempting to gain unauthorised access to our systems, databases, or other merchant accounts",
            "Conducting penetration testing, vulnerability scanning, or security research without prior written consent",
            "Uploading malware, viruses, or other malicious code to our platform",
            "Interfering with, disrupting, or overloading our servers, APIs, or network infrastructure",
            "Using automated tools to scrape, extract, or harvest data from our platform",
            "Reverse engineering, decompiling, or disassembling any component of our services",
            "Attempting to bypass authentication, rate limiting, or security controls",
          ].map(item => <Bullet key={item}>{item}</Bullet>)}
        </ul>
        <InfoBox>
          If you discover a security vulnerability, please report it responsibly via our <Link href="/responsible-disclosure" className="text-primary hover:underline">Responsible Disclosure Policy</Link> instead of exploiting it.
        </InfoBox>
      </section>

      {/* Content Standards */}
      <section className="space-y-4">
        <SectionAnchor id="content-standards" />
        <SectionHeading icon={Eye} title="Content Standards" color="text-blue-400" id="content-standards" />
        <p className="text-muted-foreground text-sm leading-relaxed">Any content you provide to RasoKart — including business descriptions, product listings, webhook URLs, API integration metadata, and support communications — must not:</p>
        <ul className="space-y-2">
          {[
            "Be false, misleading, or deceptive about your business, products, or identity",
            "Infringe third-party intellectual property rights, trademarks, or copyrights",
            "Contain hate speech, discrimination, or content that threatens individuals or groups",
            "Violate the privacy rights of any individual",
            "Be defamatory, harassing, or abusive toward RasoKart staff or other users",
          ].map(item => <Bullet key={item}>{item}</Bullet>)}
        </ul>
      </section>

      {/* Merchant Obligations */}
      <section className="space-y-4">
        <SectionAnchor id="merchant-obligations" />
        <SectionHeading icon={Settings} title="Merchant Obligations" color="text-amber-400" id="merchant-obligations" />
        <ul className="space-y-2">
          {[
            "Maintain accurate and up-to-date business information, KYC documents, and contact details",
            "Promptly respond to RasoKart's requests for information regarding specific transactions or business activities",
            "Implement adequate security controls to protect your API keys, dashboard credentials, and customer data",
            "Ensure that sub-merchants, agents, or customers acting under your account also comply with this AUP",
            "Notify RasoKart immediately if you suspect your account has been compromised",
            "Process only those transactions that represent genuine commercial activity",
            "Maintain a fair refund policy and honour legitimate refund requests",
          ].map(item => <Bullet key={item}>{item}</Bullet>)}
        </ul>
      </section>

      {/* Monitoring */}
      <section className="space-y-4">
        <SectionAnchor id="monitoring" />
        <SectionHeading icon={AlertTriangle} title="Monitoring & Enforcement" color="text-orange-400" id="monitoring" />
        <p className="text-muted-foreground text-sm leading-relaxed">
          RasoKart continuously monitors transactions, API usage patterns, and account activity for compliance with this AUP. We use automated systems and manual review processes. By using our services, you consent to this monitoring.
        </p>
        <ul className="space-y-2">
          {[
            "We may flag, hold, or review transactions that appear inconsistent with your stated business activity",
            "We may request additional documentation or business justification for specific transaction patterns",
            "We cooperate fully with law enforcement, regulators (including RBI and FIU-IND), and financial intelligence authorities",
            "We report suspicious transactions as required under PMLA 2002 and related RBI guidelines",
          ].map(item => <Bullet key={item}>{item}</Bullet>)}
        </ul>
      </section>

      {/* Consequences */}
      <section className="space-y-4">
        <SectionAnchor id="consequences" />
        <SectionHeading icon={Gavel} title="Consequences of Violation" color="text-rose-400" id="consequences" />
        <p className="text-muted-foreground text-sm leading-relaxed">If we determine, in our sole discretion, that you have violated this AUP, we may take one or more of the following actions:</p>
        <ul className="space-y-2">
          {[
            "Issue a formal warning and require remediation within a specified timeframe",
            "Impose additional transaction limits, monitoring requirements, or reserve requirements",
            "Suspend your account temporarily pending investigation",
            "Permanently terminate your account and all associated services",
            "Withhold funds pending resolution of disputes or investigation",
            "Report the violation to relevant regulatory authorities, law enforcement, or financial intelligence units",
            "Pursue civil or criminal legal action as appropriate",
          ].map(item => <Bullet key={item}>{item}</Bullet>)}
        </ul>
        <InfoBox variant="warning">
          We will provide notice before taking action where possible; however, in cases of serious, ongoing, or imminent harm, we may act immediately without prior notice.
        </InfoBox>
      </section>

      {/* Governing Law */}
      <section className="space-y-4">
        <SectionAnchor id="governing-law" />
        <SectionHeading icon={Scale} title="Governing Law" color="text-indigo-400" id="governing-law" />
        <p className="text-muted-foreground text-sm leading-relaxed">
          This Acceptable Use Policy is governed by the laws of India, including the Information Technology Act 2000, the Payment and Settlement Systems Act 2007, the Prevention of Money Laundering Act 2002, and all applicable RBI guidelines. Any disputes shall be subject to the exclusive jurisdiction of courts in Jaipur, Rajasthan, India.
        </p>
      </section>

      {/* Contact */}
      <section className="space-y-4">
        <SectionAnchor id="contact" />
        <SectionHeading icon={Phone} title="Contact Us" color="text-teal-400" id="contact" />
        <p className="text-muted-foreground text-sm leading-relaxed">
          For questions about this policy or to report a suspected violation, contact us:
        </p>
        <div className="rounded-xl border border-border/60 bg-card/40 p-4 space-y-2 text-sm">
          <p><span className="text-muted-foreground">Email: </span><a href={`mailto:${supportEmail || "support@rasokart.com"}`} className="text-primary hover:underline">{supportEmail || "support@rasokart.com"}</a></p>
          {supportPhone && <p><span className="text-muted-foreground">Phone: </span><a href={`tel:${supportPhone}`} className="text-primary hover:underline">{supportPhone}</a></p>}
          <p><span className="text-muted-foreground">Related: </span><Link href="/prohibited-businesses" className="text-primary hover:underline">Prohibited Businesses Policy</Link> · <Link href="/merchant-agreement" className="text-primary hover:underline">Merchant Agreement</Link></p>
        </div>
      </section>
    </LegalLayout>
  );
}
