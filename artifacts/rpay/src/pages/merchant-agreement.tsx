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
  Users,
  ShieldCheck,
  Ban,
  CreditCard,
  DollarSign,
  Database,
  Scale,
  XCircle,
  Gavel,
  Phone,
  AlertTriangle,
  UserCheck,
  Settings,
} from "lucide-react";

const LAST_UPDATED = "22 July 2026";
const CIN = "U47820RJ2025PTC109583";
const GSTIN = "08AALCN0945P1ZT";
const EFFECTIVE_DATE = "16 July 2026";

const sections: LegalSection[] = [
  { id: "parties", icon: Users, title: "Parties & Definitions", color: "text-cyan-400" },
  { id: "services", icon: FileText, title: "Services", color: "text-violet-400" },
  { id: "merchant-obligations", icon: ShieldCheck, title: "Merchant Obligations", color: "text-blue-400" },
  { id: "prohibited", icon: Ban, title: "Prohibited Activities", color: "text-red-400" },
  { id: "kyc", icon: UserCheck, title: "KYC Requirements", color: "text-emerald-400" },
  { id: "fees", icon: DollarSign, title: "Fees & Settlement", color: "text-amber-400" },
  { id: "payment-processing", icon: CreditCard, title: "Payment Processing", color: "text-orange-400" },
  { id: "data", icon: Database, title: "Data Handling", color: "text-sky-400" },
  { id: "indemnification", icon: AlertTriangle, title: "Indemnification", color: "text-yellow-400" },
  { id: "liability", icon: Scale, title: "Limitation of Liability", color: "text-indigo-400" },
  { id: "termination", icon: XCircle, title: "Termination", color: "text-rose-400" },
  { id: "amendments", icon: Settings, title: "Amendments", color: "text-muted-foreground" },
  { id: "governing-law", icon: Gavel, title: "Governing Law", color: "text-teal-400" },
  { id: "contact", icon: Phone, title: "Contact", color: "text-teal-400" },
];

export default function MerchantAgreement() {
  const { companyName, supportPhone, supportEmail } = useCompanySettings();

  return (
    <LegalLayout
      title="Merchant Agreement"
      lastUpdated={LAST_UPDATED}
      badgeText="Merchant Agreement"
      sections={sections}
      intro={
        <div className="space-y-3 mt-3">
          <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-5 py-4 text-sm text-amber-200 leading-relaxed max-w-2xl">
            <strong className="text-amber-100">Regulatory Disclosure:</strong>{" "}
            RasoKart is a software and technology platform operated by Nickey Collection Private Limited (GSTIN: 08AALCN0945P1ZT). RasoKart is not represented as an RBI-authorised Payment Aggregator and does not independently pool or settle customer or merchant funds. Regulated payment processing and settlement services are provided through approved banks and payment-service providers, subject to onboarding, KYC, risk approval and applicable terms.
          </div>
          <p className="text-muted-foreground leading-relaxed max-w-2xl">
            This Merchant Agreement ("Agreement") is entered into between{" "}
            <strong className="text-foreground">{companyName}</strong> (CIN: {CIN}), operating the RasoKart
            software platform ("Company", "we", "us", "our"), and the merchant who registers for
            and uses the Platform ("Merchant", "you").
          </p>
          <p className="text-muted-foreground text-sm leading-relaxed max-w-2xl">
            By registering as a merchant, you confirm that you have read, understood, and agree to be bound
            by this Agreement, along with our{" "}
            <Link href="/terms-and-conditions" className="text-primary hover:underline">Terms & Conditions</Link>,{" "}
            <Link href="/privacy-policy" className="text-primary hover:underline">Privacy Policy</Link>, and all
            other applicable policies. This Agreement is effective from {EFFECTIVE_DATE}.
          </p>
        </div>
      }
    >
      {/* 1. Parties */}
      <section>
        <SectionAnchor id="parties" />
        <SectionHeading icon={Users} title="1. Parties & Definitions" color="text-cyan-400" id="parties" />
        <div className="grid gap-3 sm:grid-cols-2 mb-4">
          {[
            { term: "Company", def: `${companyName}, CIN ${CIN}, incorporated in Rajasthan, India, operating the RasoKart platform.` },
            { term: "Merchant", def: "Any business entity or individual that registers on the Platform to use payment gateway services." },
            { term: "Platform", def: "The RasoKart payment gateway software, dashboard, APIs, and related services." },
            { term: "Services", def: "All payment collection, payout, reconciliation, and related services provided through the Platform." },
            { term: "Customer", def: "The end-user or buyer who makes a payment to the Merchant through the Platform." },
            { term: "Settlement", def: "Transfer of collected funds, net of fees, from the Platform to the Merchant's bank account." },
          ].map((d) => (
            <div key={d.term} className="rounded-xl border border-border/50 bg-card/40 p-4">
              <p className="text-sm font-semibold text-foreground mb-1">{d.term}</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{d.def}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 2. Services */}
      <section>
        <SectionAnchor id="services" />
        <SectionHeading icon={FileText} title="2. Services" color="text-violet-400" id="services" />
        <p className="text-muted-foreground text-sm mb-4 leading-relaxed">
          Subject to your compliance with this Agreement and applicable policies, the Company grants you
          access to the following services on the Platform, subject to your subscribed plan:
        </p>
        <ul className="space-y-2 mb-4">
          <Bullet>Payment collection via QR codes, virtual accounts, payment links, and payment APIs</Bullet>
          <Bullet>Payout and disbursement services via bank transfers and UPI (on eligible plans)</Bullet>
          <Bullet>Transaction monitoring, reconciliation, and settlement management</Bullet>
          <Bullet>Merchant dashboard for real-time transaction visibility and reporting</Bullet>
          <Bullet>API access for integration with your systems (on eligible plans)</Bullet>
          <Bullet>Support services as per your plan</Bullet>
        </ul>
        <InfoBox variant="warning">
          The Company reserves the right to modify, restrict, or discontinue any service or feature with
          reasonable advance notice. Merchants on the Starter (free) plan have restricted access to API,
          webhook, and payout features.
        </InfoBox>
      </section>

      {/* 3. Merchant Obligations */}
      <section>
        <SectionAnchor id="merchant-obligations" />
        <SectionHeading icon={ShieldCheck} title="3. Merchant Obligations" color="text-blue-400" id="merchant-obligations" />
        <p className="text-muted-foreground text-sm mb-4 leading-relaxed">
          You agree to comply with all of the following at all times:
        </p>
        <ul className="space-y-2 mb-4">
          <Bullet>Provide accurate and complete information during registration and promptly update any changes</Bullet>
          <Bullet>Complete all KYC verification requirements and comply with re-verification requests</Bullet>
          <Bullet>Maintain the confidentiality and security of all account credentials, API keys, and webhook secrets</Bullet>
          <Bullet>Notify the Company immediately upon detecting any actual or suspected unauthorised access to your account</Bullet>
          <Bullet>Comply with all applicable laws, including those governing payments, consumer protection, anti-money laundering, data protection, and taxation</Bullet>
          <Bullet>Accurately represent the nature, description, and price of goods or services for which payments are collected</Bullet>
          <Bullet>Maintain sufficient records of all transactions and respond to audit or investigation requests promptly</Bullet>
          <Bullet>Handle customer data in accordance with applicable privacy law and not disclose customer payment information to unauthorised parties</Bullet>
          <Bullet>Promptly respond to chargebacks, disputes, and requests for information within the specified timelines</Bullet>
          <Bullet>Not permit any third party to use the Platform services under your account without the Company's written consent</Bullet>
        </ul>
      </section>

      {/* 4. Prohibited Activities */}
      <section>
        <SectionAnchor id="prohibited" />
        <SectionHeading icon={Ban} title="4. Prohibited Activities" color="text-red-400" id="prohibited" />
        <p className="text-muted-foreground text-sm mb-4 leading-relaxed">
          You expressly agree NOT to:
        </p>
        <ul className="space-y-2 mb-4">
          <Bullet>Use the Platform for any business or product category listed in our Prohibited Businesses policy</Bullet>
          <Bullet>Process payments for fictitious, misrepresented, or inflated transactions (transaction laundering)</Bullet>
          <Bullet>Use the Platform to facilitate money laundering, terrorist financing, or any other financial crime</Bullet>
          <Bullet>Use or attempt to obtain the Platform services for any purpose that violates applicable Indian law</Bullet>
          <Bullet>Provide false, misleading, or fraudulent information to obtain or maintain Platform access</Bullet>
          <Bullet>Engage in excessive chargebacks or dispute fraud, or attempt to exploit the refund or dispute process</Bullet>
          <Bullet>Share, sell, resell, or assign Platform access to third parties without express written permission</Bullet>
          <Bullet>Interfere with the security, integrity, or availability of the Platform or its infrastructure</Bullet>
        </ul>
        <InfoBox variant="danger">
          Violation of this section may result in immediate account suspension, withholding of settlement
          funds pending investigation, and/or reporting to law enforcement and financial intelligence
          authorities as required by law.
        </InfoBox>
      </section>

      {/* 5. KYC */}
      <section>
        <SectionAnchor id="kyc" />
        <SectionHeading icon={UserCheck} title="5. KYC Requirements" color="text-emerald-400" id="kyc" />
        <p className="text-muted-foreground text-sm mb-4 leading-relaxed">
          In compliance with applicable anti-money laundering and KYC regulations, you agree to:
        </p>
        <ul className="space-y-2 mb-4">
          <Bullet>Submit all required identity and business verification documents as requested during onboarding</Bullet>
          <Bullet>Submit to periodic re-KYC as required by regulation or as requested by the Company</Bullet>
          <Bullet>Ensure that any business registration, PAN, GST, and bank account information submitted is current and accurate</Bullet>
          <Bullet>Notify us promptly of any material change in your business ownership, structure, or registered details</Bullet>
        </ul>
        <p className="text-muted-foreground text-sm leading-relaxed">
          Our detailed KYC and AML obligations are described in our{" "}
          <Link href="/kyc-aml-policy" className="text-primary hover:underline">
            KYC & AML Policy
          </Link>
          .
        </p>
      </section>

      {/* 6. Fees & Settlement */}
      <section>
        <SectionAnchor id="fees" />
        <SectionHeading icon={DollarSign} title="6. Fees & Settlement" color="text-amber-400" id="fees" />
        <ul className="space-y-2 mb-4">
          <Bullet>You agree to pay all applicable subscription fees, transaction fees, and other charges as per our Pricing, Fees & Settlement Policy</Bullet>
          <Bullet>Settlement of collected funds will be made to your registered bank account in accordance with the settlement cycle for your plan</Bullet>
          <Bullet>The Company may deduct fees, chargebacks, refunds, and other applicable amounts from your settlement disbursement</Bullet>
          <Bullet>The Company may hold, delay, or withhold settlement in cases of suspected fraud, excessive chargebacks, compliance review, or regulatory requirement</Bullet>
          <Bullet>You agree to provide accurate bank account and GST details for settlement and tax compliance purposes</Bullet>
        </ul>
        <p className="text-muted-foreground text-sm leading-relaxed">
          Full details are in our{" "}
          <Link href="/pricing-fees-settlement-policy" className="text-primary hover:underline">
            Pricing, Fees & Settlement Policy
          </Link>
          .
        </p>
      </section>

      {/* 7. Payment Processing */}
      <section>
        <SectionAnchor id="payment-processing" />
        <SectionHeading icon={CreditCard} title="7. Payment Processing" color="text-orange-400" id="payment-processing" />
        <ul className="space-y-2">
          <Bullet>The Company facilitates payment processing on your behalf through authorised banking and payment partners</Bullet>
          <Bullet>The Company is not responsible for payment failures or delays caused by the Customer's bank, network, or payment instrument</Bullet>
          <Bullet>Transaction limits, daily caps, and velocity controls may be imposed as part of risk management</Bullet>
          <Bullet>You agree to handle all payment-related Customer queries and disputes in a timely and professional manner</Bullet>
          <Bullet>You are responsible for communicating your own return, refund, and cancellation policy to Customers</Bullet>
        </ul>
      </section>

      {/* 8. Data */}
      <section>
        <SectionAnchor id="data" />
        <SectionHeading icon={Database} title="8. Data Handling" color="text-sky-400" id="data" />
        <ul className="space-y-2 mb-4">
          <Bullet>You acknowledge that the Company processes personal data of you and your Customers in accordance with our Privacy Policy</Bullet>
          <Bullet>You agree to obtain all necessary consents from your Customers for data processing activities conducted on your behalf through the Platform</Bullet>
          <Bullet>You must not store, transmit, or use Customer payment card data in violation of applicable security standards</Bullet>
          <Bullet>You agree to notify the Company promptly if you become aware of any data breach affecting Customer data processed through the Platform</Bullet>
        </ul>
      </section>

      {/* 9. Indemnification */}
      <section>
        <SectionAnchor id="indemnification" />
        <SectionHeading icon={AlertTriangle} title="9. Indemnification" color="text-yellow-400" id="indemnification" />
        <p className="text-muted-foreground text-sm leading-relaxed">
          You agree to indemnify, defend, and hold harmless the Company, its directors, officers, employees,
          and agents from and against any claims, damages, losses, liabilities, costs, and expenses
          (including reasonable legal fees) arising out of or related to: (a) your breach of this Agreement
          or any applicable policy; (b) your violation of any applicable law or regulation; (c) your
          negligence or wilful misconduct; (d) any dispute between you and your Customers; or (e) any
          fraudulent or unauthorised activity conducted through your account.
        </p>
      </section>

      {/* 10. Limitation of Liability */}
      <section>
        <SectionAnchor id="liability" />
        <SectionHeading icon={Scale} title="10. Limitation of Liability" color="text-indigo-400" id="liability" />
        <p className="text-muted-foreground text-sm leading-relaxed mb-4">
          To the maximum extent permitted by applicable law, the Company's total liability to you for any
          claim arising from or related to this Agreement shall not exceed the total platform fees paid by
          you in the 3 months immediately preceding the event giving rise to the claim. The Company shall
          not be liable for any indirect, incidental, special, consequential, or punitive damages.
        </p>
      </section>

      {/* 11. Termination */}
      <section>
        <SectionAnchor id="termination" />
        <SectionHeading icon={XCircle} title="11. Termination" color="text-rose-400" id="termination" />
        <ul className="space-y-2 mb-4">
          <Bullet>Either party may terminate this Agreement with 30 days' written notice</Bullet>
          <Bullet>The Company may terminate this Agreement immediately for breach of any material provision, fraud, insolvency, or regulatory requirement</Bullet>
          <Bullet>On termination, access to the Platform will cease; pending settlements will be processed after deducting any outstanding liabilities</Bullet>
          <Bullet>Provisions relating to fees, data, liability, and governing law shall survive termination</Bullet>
        </ul>
      </section>

      {/* 12. Amendments */}
      <section>
        <SectionAnchor id="amendments" />
        <SectionHeading icon={Settings} title="12. Amendments" color="text-muted-foreground" id="amendments" />
        <p className="text-muted-foreground text-sm leading-relaxed">
          The Company may amend this Agreement at any time. Material amendments will be communicated with
          at least 15 days' prior written notice. Continued use of the Platform after the effective date
          of any amendment constitutes your acceptance of the amended Agreement.
        </p>
      </section>

      {/* 13. Governing Law */}
      <section>
        <SectionAnchor id="governing-law" />
        <SectionHeading icon={Gavel} title="13. Governing Law & Dispute Resolution" color="text-teal-400" id="governing-law" />
        <p className="text-muted-foreground text-sm leading-relaxed mb-4">
          This Agreement is governed by the laws of India. All disputes arising hereunder shall be subject
          to the exclusive jurisdiction of the courts at Jaipur, Rajasthan, India. Before initiating legal
          proceedings, the parties agree to attempt resolution through our{" "}
          <Link href="/grievance-redressal-policy" className="text-primary hover:underline">
            Grievance Redressal Process
          </Link>
          .
        </p>
      </section>

      {/* 14. Contact */}
      <section>
        <SectionAnchor id="contact" />
        <SectionHeading icon={Phone} title="14. Contact" color="text-teal-400" id="contact" />
        <div className="rounded-xl border border-border/50 bg-card/40 p-5 space-y-2">
          <p className="text-sm font-semibold text-foreground">NICKEY COLLECTION PRIVATE LIMITED</p>
          <p className="text-xs text-muted-foreground/70">CIN: {CIN} · GSTIN: {GSTIN}</p>
          <p className="text-sm text-muted-foreground">
            P. No. B-46, Damodar Vila, Agarsen Nagar, Kalwar Road, Jhotwara, Jaipur, Rajasthan – 302012, India
          </p>
          {supportPhone && (
            <a href={`tel:${supportPhone}`} className="block text-sm text-muted-foreground hover:text-foreground">
              Phone: {supportPhone}
            </a>
          )}
          {supportEmail && (
            <a href={`mailto:${supportEmail}`} className="block text-sm text-muted-foreground hover:text-foreground">
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
