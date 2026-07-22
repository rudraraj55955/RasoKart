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
  FileText,
  UserCheck,
  ShieldCheck,
  Ban,
  CreditCard,
  DollarSign,
  Key,
  Scale,
  AlertTriangle,
  XCircle,
  Gavel,
  Phone,
  BookOpen,
  Settings,
  Globe,
} from "lucide-react";

const LAST_UPDATED = "22 July 2026";
const CIN = "U47820RJ2025PTC109583";
const GSTIN = "08AALCN0945P1ZT";
const WEBSITE = "https://rasokart.com";
const EFFECTIVE_DATE = "16 July 2026";

const sections: LegalSection[] = [
  { id: "definitions", icon: BookOpen, title: "Definitions", color: "text-cyan-400" },
  { id: "eligibility", icon: UserCheck, title: "Eligibility & Registration", color: "text-violet-400" },
  { id: "obligations", icon: ShieldCheck, title: "Merchant Obligations", color: "text-blue-400" },
  { id: "acceptable-use", icon: Ban, title: "Acceptable Use", color: "text-red-400" },
  { id: "payment-services", icon: CreditCard, title: "Payment Processing", color: "text-emerald-400" },
  { id: "fees", icon: DollarSign, title: "Fees & Charges", color: "text-amber-400" },
  { id: "settlement", icon: DollarSign, title: "Settlement & Payouts", color: "text-orange-400" },
  { id: "api-integration", icon: Key, title: "API & Integrations", color: "text-sky-400" },
  { id: "intellectual-property", icon: Globe, title: "Intellectual Property", color: "text-pink-400" },
  { id: "disclaimers", icon: AlertTriangle, title: "Disclaimers", color: "text-yellow-400" },
  { id: "liability", icon: Scale, title: "Limitation of Liability", color: "text-indigo-400" },
  { id: "termination", icon: XCircle, title: "Termination", color: "text-rose-400" },
  { id: "governing-law", icon: Gavel, title: "Governing Law", color: "text-teal-400" },
  { id: "amendments", icon: Settings, title: "Amendments", color: "text-muted-foreground" },
  { id: "contact", icon: Phone, title: "Contact Us", color: "text-teal-400" },
];

export default function TermsAndConditions() {
  const { companyName, supportPhone, supportEmail } = useCompanySettings();

  return (
    <LegalLayout
      title="Terms and Conditions"
      lastUpdated={LAST_UPDATED}
      badgeText="Terms of Service"
      sections={sections}
      intro={
        <div className="space-y-3 mt-3">
          <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-5 py-4 text-sm text-amber-200 leading-relaxed max-w-2xl">
            <strong className="text-amber-100">Regulatory Disclosure:</strong>{" "}
            RasoKart is a software and technology platform operated by Nickey Collection Private Limited (GSTIN: 08AALCN0945P1ZT). RasoKart is not represented as an RBI-authorised Payment Aggregator and does not independently pool or settle customer or merchant funds. Regulated payment processing and settlement services are provided through approved banks and payment-service providers, subject to onboarding, KYC, risk approval and applicable terms.
          </div>
          <p className="text-muted-foreground leading-relaxed max-w-2xl">
            These Terms and Conditions ("Terms") govern your access to and use of the RasoKart software
            platform operated by{" "}
            <strong className="text-foreground">{companyName}</strong> ("RasoKart", "we", "our",
            or "us"), CIN {CIN}. By registering as a merchant or otherwise accessing the platform at{" "}
            <a href={WEBSITE} className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">
              {WEBSITE}
            </a>
            , you agree to be bound by these Terms. If you do not agree, do not use the Platform.
            <br />
            <span className="text-xs text-muted-foreground/70 mt-1 block">
              Effective date: {EFFECTIVE_DATE}
            </span>
          </p>
        </div>
      }
    >
      {/* 1. Definitions */}
      <section>
        <SectionAnchor id="definitions" />
        <SectionHeading icon={BookOpen} title="1. Definitions" color="text-cyan-400" id="definitions" />
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            { term: "Platform", def: "The RasoKart payment gateway software, APIs, merchant dashboard, and related services accessible at rasokart.com." },
            { term: "Merchant / You", def: "Any individual or entity that registers on the Platform to collect or disburse payments." },
            { term: "Services", def: "Payment collection, QR codes, virtual accounts, payment links, payouts, reconciliation, and related features provided through the Platform." },
            { term: "Transaction", def: "Any payment, refund, payout, or transfer initiated through the Platform." },
            { term: "Settlement", def: "The transfer of collected funds, net of fees and applicable deductions, to the Merchant's designated bank account." },
            { term: "API Keys", def: "Credentials issued to authenticated merchants to access the RasoKart API programmatically." },
          ].map((d) => (
            <div key={d.term} className="rounded-xl border border-border/50 bg-card/40 p-4">
              <p className="text-sm font-semibold text-foreground mb-1">{d.term}</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{d.def}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 2. Eligibility & Registration */}
      <section>
        <SectionAnchor id="eligibility" />
        <SectionHeading icon={UserCheck} title="2. Eligibility & Registration" color="text-violet-400" id="eligibility" />
        <p className="text-muted-foreground text-sm mb-4 leading-relaxed">
          To use the Platform you must:
        </p>
        <ul className="space-y-2 mb-4">
          <Bullet>Be at least 18 years of age and legally capable of entering into a binding contract</Bullet>
          <Bullet>Register a business or operate as a sole proprietor, partnership, LLP, or private/public limited company incorporated under applicable Indian law</Bullet>
          <Bullet>Provide accurate, complete, and up-to-date information during registration and throughout your use of the Platform</Bullet>
          <Bullet>Complete all mandatory KYC verification steps as required by us or applicable law</Bullet>
          <Bullet>Not be on any sanctions list or prohibited from receiving financial services under applicable law</Bullet>
          <Bullet>Not operate in any business category listed in our Prohibited Businesses policy</Bullet>
        </ul>
        <InfoBox variant="warning">
          We reserve the right to refuse registration, suspend, or terminate any account at our sole discretion,
          including where we reasonably believe that applicable regulatory, risk management, or compliance
          requirements are not met.
        </InfoBox>
      </section>

      {/* 3. Merchant Obligations */}
      <section>
        <SectionAnchor id="obligations" />
        <SectionHeading icon={ShieldCheck} title="3. Merchant Obligations" color="text-blue-400" id="obligations" />
        <p className="text-muted-foreground text-sm mb-4 leading-relaxed">
          As a merchant using the Platform, you agree to:
        </p>
        <ul className="space-y-2 mb-4">
          <Bullet>Keep your account credentials, API keys, and webhook secrets confidential and not share them with unauthorised persons</Bullet>
          <Bullet>Notify us immediately if you suspect any unauthorised access to your account or API keys</Bullet>
          <Bullet>Provide and maintain accurate business and banking information required for settlements</Bullet>
          <Bullet>Comply with all applicable laws, rules, and regulations including those related to payments, consumer protection, data protection, and tax</Bullet>
          <Bullet>Maintain adequate records of all transactions processed through the Platform and cooperate in any investigation or audit</Bullet>
          <Bullet>Not engage in any activity that could damage the reputation, security, or operations of the Platform</Bullet>
          <Bullet>Promptly respond to chargebacks, disputes, and enquiries from us or our banking partners within the timelines specified</Bullet>
          <Bullet>Use the Platform only for lawful purposes and in accordance with these Terms and any supplemental policies</Bullet>
        </ul>
      </section>

      {/* 4. Acceptable Use */}
      <section>
        <SectionAnchor id="acceptable-use" />
        <SectionHeading icon={Ban} title="4. Acceptable Use" color="text-red-400" id="acceptable-use" />
        <p className="text-muted-foreground text-sm mb-4 leading-relaxed">
          You may not use the Platform to:
        </p>
        <ul className="space-y-2 mb-4">
          <Bullet>Process payments for products, services, or business categories listed in our Prohibited Businesses policy</Bullet>
          <Bullet>Conduct fraudulent, deceptive, or illegal transactions or misrepresent the nature or value of any transaction</Bullet>
          <Bullet>Launder money, finance terrorism, or otherwise violate anti-money laundering (AML) or counter-financing of terrorism (CFT) laws</Bullet>
          <Bullet>Introduce viruses, malware, or other malicious code into the Platform</Bullet>
          <Bullet>Attempt to reverse-engineer, decompile, scrape, or otherwise gain unauthorised access to the Platform's source code or data</Bullet>
          <Bullet>Circumvent, disable, or interfere with security features or access controls of the Platform</Bullet>
          <Bullet>Use the Platform in a manner that causes disproportionate load, denial-of-service, or disruption to other users</Bullet>
          <Bullet>Resell or sublicense access to the Platform without our prior written consent</Bullet>
        </ul>
        <InfoBox variant="danger">
          Violation of this Acceptable Use Policy may result in immediate suspension or termination of your
          account, withholding of any unsettled funds pending investigation, and referral to law enforcement
          authorities where appropriate.
        </InfoBox>
      </section>

      {/* 5. Payment Processing */}
      <section>
        <SectionAnchor id="payment-services" />
        <SectionHeading icon={CreditCard} title="5. Payment Processing Services" color="text-emerald-400" id="payment-services" />
        <p className="text-muted-foreground text-sm mb-4 leading-relaxed">
          RasoKart facilitates payment collection and disbursement on your behalf through authorised banking and payment partners. You acknowledge and agree that:
        </p>
        <ul className="space-y-2 mb-4">
          <Bullet>We act as a technology intermediary; actual funds movement is facilitated through our banking and payment partners</Bullet>
          <Bullet>Payment authorisation, authentication, and settlement timelines are subject to the policies of our banking and payment partners</Bullet>
          <Bullet>We are not responsible for delays or failures caused by your customer's bank, network downtime, or regulatory holds outside our control</Bullet>
          <Bullet>We may implement transaction limits, velocity controls, and risk management holds to protect the integrity of the Platform</Bullet>
          <Bullet>Transactions may be declined, reversed, or held for review where fraud, suspicious activity, or policy violations are detected</Bullet>
        </ul>
      </section>

      {/* 6. Fees */}
      <section>
        <SectionAnchor id="fees" />
        <SectionHeading icon={DollarSign} title="6. Fees & Charges" color="text-amber-400" id="fees" />
        <p className="text-muted-foreground text-sm mb-4 leading-relaxed">
          Use of the Platform is subject to fees as described in our{" "}
          <Link href="/pricing-fees-settlement-policy" className="text-primary hover:underline">
            Pricing, Fees & Settlement Policy
          </Link>
          . Key points:
        </p>
        <ul className="space-y-2 mb-4">
          <Bullet>Platform subscription fees are charged based on your plan (Starter, Silver, Gold, Platinum, Enterprise, or Custom)</Bullet>
          <Bullet>Transaction fees may apply and will be deducted from the settlement amount before disbursement</Bullet>
          <Bullet>GST and other applicable taxes will be charged as required by law</Bullet>
          <Bullet>We reserve the right to revise fee structures with 30 days' prior notice; continued use of the Platform after the effective date constitutes acceptance</Bullet>
          <Bullet>All fees are non-refundable except as expressly stated in our Refund & Cancellation Policy</Bullet>
        </ul>
      </section>

      {/* 7. Settlement */}
      <section>
        <SectionAnchor id="settlement" />
        <SectionHeading icon={DollarSign} title="7. Settlement & Payouts" color="text-orange-400" id="settlement" />
        <ul className="space-y-2 mb-4">
          <Bullet>Settlement of collected funds to your registered bank account is subject to successful KYC verification and approved account status</Bullet>
          <Bullet>Settlement cycles and timelines are defined in our Payment, Payout & Settlement Policy; standard timelines are T+1 to T+3 business days depending on your plan</Bullet>
          <Bullet>We reserve the right to hold, delay, or set off settlement amounts in cases of suspected fraud, excessive chargebacks, disputes, or pending compliance review</Bullet>
          <Bullet>You are solely responsible for the accuracy of bank account details provided for settlement; we are not liable for funds sent to incorrect accounts provided by you</Bullet>
          <Bullet>A reserve or security deposit may be maintained as a risk management measure, the terms of which will be communicated to you separately</Bullet>
        </ul>
      </section>

      {/* 8. API & Integrations */}
      <section>
        <SectionAnchor id="api-integration" />
        <SectionHeading icon={Key} title="8. API & Integrations" color="text-sky-400" id="api-integration" />
        <ul className="space-y-2">
          <Bullet>API access is available to merchants on eligible plans; Starter plan merchants do not have API access</Bullet>
          <Bullet>You are responsible for the security of your API keys and must rotate them immediately if compromised</Bullet>
          <Bullet>We may impose rate limits on API usage; exceeding limits may result in temporary blocking of API requests</Bullet>
          <Bullet>You must implement webhook signature verification to protect your systems from spoofed callbacks</Bullet>
          <Bullet>We may modify, deprecate, or discontinue API endpoints with reasonable notice; it is your responsibility to update your integration accordingly</Bullet>
        </ul>
      </section>

      {/* 9. Intellectual Property */}
      <section>
        <SectionAnchor id="intellectual-property" />
        <SectionHeading icon={Globe} title="9. Intellectual Property" color="text-pink-400" id="intellectual-property" />
        <p className="text-muted-foreground text-sm mb-4 leading-relaxed">
          All intellectual property rights in the Platform, including but not limited to software, APIs, documentation, brand assets, and content, are owned by or licensed to us. You are granted a limited, non-exclusive, non-transferable licence to use the Platform solely for your authorised business purposes in accordance with these Terms.
        </p>
        <InfoBox>
          You must not copy, modify, reproduce, distribute, or create derivative works of any part of the
          Platform without our prior written consent. Our name, logo, and trademarks may not be used without
          express written permission.
        </InfoBox>
      </section>

      {/* 10. Disclaimers */}
      <section>
        <SectionAnchor id="disclaimers" />
        <SectionHeading icon={AlertTriangle} title="10. Disclaimers" color="text-yellow-400" id="disclaimers" />
        <p className="text-muted-foreground text-sm mb-4 leading-relaxed">
          The Platform is provided on an "as is" and "as available" basis without warranties of any kind, whether express or implied, including:
        </p>
        <ul className="space-y-2 mb-4">
          <Bullet>No warranty that the Platform will be uninterrupted, error-free, or free of viruses or other harmful components</Bullet>
          <Bullet>No warranty as to the accuracy, completeness, or fitness for a particular purpose of any information provided through the Platform</Bullet>
          <Bullet>No warranty that payment transactions will always be successfully authorised, settled, or completed without delay</Bullet>
        </ul>
        <InfoBox variant="warning">
          We do not guarantee that the Platform will meet your specific business requirements. Your use of the
          Platform is at your own risk to the extent permitted by applicable law.
        </InfoBox>
      </section>

      {/* 11. Limitation of Liability */}
      <section>
        <SectionAnchor id="liability" />
        <SectionHeading icon={Scale} title="11. Limitation of Liability" color="text-indigo-400" id="liability" />
        <p className="text-muted-foreground text-sm mb-4 leading-relaxed">
          To the maximum extent permitted by applicable law:
        </p>
        <ul className="space-y-2 mb-4">
          <Bullet>We shall not be liable for any indirect, incidental, consequential, special, or punitive damages, including loss of profits, revenue, business, data, or goodwill</Bullet>
          <Bullet>Our total aggregate liability to you for any claim arising from or related to the Platform or these Terms shall not exceed the total fees paid by you to us in the 3 months immediately preceding the event giving rise to the claim</Bullet>
          <Bullet>We shall not be liable for delays, failures, or losses caused by events outside our reasonable control, including acts of God, regulatory actions, banking partner failures, network outages, or force majeure events</Bullet>
        </ul>
      </section>

      {/* 12. Termination */}
      <section>
        <SectionAnchor id="termination" />
        <SectionHeading icon={XCircle} title="12. Termination" color="text-rose-400" id="termination" />
        <ul className="space-y-2 mb-4">
          <Bullet>You may terminate your account at any time by contacting our support team; pending settlements will be processed in accordance with normal timelines</Bullet>
          <Bullet>We may suspend or terminate your account immediately if you breach these Terms, engage in fraudulent or illegal activity, or where required by law or regulation</Bullet>
          <Bullet>On termination, your access to the Platform will cease; you remain liable for all obligations, fees, chargebacks, and liabilities incurred prior to termination</Bullet>
          <Bullet>Sections that by their nature should survive termination (including but not limited to Fees, Liability, Governing Law) will continue in effect after termination</Bullet>
        </ul>
      </section>

      {/* 13. Governing Law */}
      <section>
        <SectionAnchor id="governing-law" />
        <SectionHeading icon={Gavel} title="13. Governing Law & Jurisdiction" color="text-teal-400" id="governing-law" />
        <p className="text-muted-foreground text-sm leading-relaxed mb-4">
          These Terms are governed by and construed in accordance with the laws of India. Any disputes arising from or in connection with these Terms shall be subject to the exclusive jurisdiction of the courts of Jaipur, Rajasthan, India.
        </p>
        <InfoBox>
          Before initiating legal proceedings, you agree to first attempt to resolve disputes through our
          Grievance Redressal process. See our{" "}
          <Link href="/grievance-redressal-policy" className="text-primary hover:underline">
            Grievance Redressal Policy
          </Link>
          .
        </InfoBox>
      </section>

      {/* 14. Amendments */}
      <section>
        <SectionAnchor id="amendments" />
        <SectionHeading icon={Settings} title="14. Amendments" color="text-muted-foreground" id="amendments" />
        <p className="text-muted-foreground text-sm leading-relaxed">
          We may update these Terms at any time. Material changes will be communicated via email or an in-platform notification at least 15 days before taking effect. Your continued use of the Platform after the effective date of any update constitutes acceptance of the revised Terms. It is your responsibility to review these Terms periodically.
        </p>
      </section>

      {/* 15. Contact */}
      <section>
        <SectionAnchor id="contact" />
        <SectionHeading icon={Phone} title="15. Contact Us" color="text-teal-400" id="contact" />
        <p className="text-muted-foreground text-sm leading-relaxed mb-4">
          For questions or concerns regarding these Terms, please contact us:
        </p>
        <div className="rounded-xl border border-border/50 bg-card/40 p-5 space-y-2">
          <p className="text-sm font-semibold text-foreground">NICKEY COLLECTION PRIVATE LIMITED</p>
          <p className="text-xs text-muted-foreground/70">CIN: {CIN} · GSTIN: {GSTIN}</p>
          <p className="text-sm text-muted-foreground">
            P. No. B-46, Damodar Vila, Agarsen Nagar, Kalwar Road, Jhotwara, Jaipur, Rajasthan – 302012, India
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
          <div className="pt-1">
            <Link href="/contact-us" className="text-sm text-primary hover:underline">
              Submit a query via our Contact Us page →
            </Link>
          </div>
        </div>
      </section>
    </LegalLayout>
  );
}
