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
  UserCheck,
  FileText,
  AlertTriangle,
  Shield,
  Database,
  Clock,
  Scale,
  Phone,
  Eye,
  ShieldCheck,
} from "lucide-react";

const LAST_UPDATED = "22 July 2026";
const CIN = "U47820RJ2025PTC109583";
const GSTIN = "08AALCN0945P1ZT";

const sections: LegalSection[] = [
  { id: "overview", icon: FileText, title: "Overview", color: "text-cyan-400" },
  { id: "kyc-requirements", icon: UserCheck, title: "KYC Requirements", color: "text-violet-400" },
  { id: "documents", icon: FileText, title: "Required Documents", color: "text-blue-400" },
  { id: "enhanced-dd", icon: Shield, title: "Enhanced Due Diligence", color: "text-emerald-400" },
  { id: "monitoring", icon: Eye, title: "Transaction Monitoring", color: "text-amber-400" },
  { id: "suspicious", icon: AlertTriangle, title: "Suspicious Activity", color: "text-orange-400" },
  { id: "records", icon: Database, title: "Record Keeping", color: "text-sky-400" },
  { id: "merchant-obligations", icon: ShieldCheck, title: "Merchant Obligations", color: "text-teal-400" },
  { id: "legal-basis", icon: Scale, title: "Legal Basis", color: "text-indigo-400" },
  { id: "contact", icon: Phone, title: "Contact Us", color: "text-teal-400" },
];

export default function KycAmlPolicy() {
  const { companyName, supportPhone, supportEmail } = useCompanySettings();

  return (
    <LegalLayout
      title="KYC & AML Policy"
      lastUpdated={LAST_UPDATED}
      badgeText="Compliance Policy"
      sections={sections}
      intro={
        <div className="space-y-3 mt-3">
          <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-5 py-4 text-sm text-amber-200 leading-relaxed max-w-2xl">
            <strong className="text-amber-100">Regulatory Disclosure:</strong>{" "}
            RasoKart is a software and technology platform operated by NICKEY COLLECTION PRIVATE LIMITED (CIN: {CIN} · GSTIN: {GSTIN}). RasoKart is not represented as an RBI-authorised Payment Aggregator and does not independently pool or settle customer or merchant funds.
          </div>
          <p className="text-muted-foreground leading-relaxed max-w-2xl">
            <strong className="text-foreground">{companyName}</strong> ("RasoKart") is committed to
            maintaining a robust Know Your Customer (KYC) and Anti-Money Laundering (AML) framework in
            accordance with applicable Indian law. This policy describes our obligations and the compliance
            expectations placed on merchants using the Platform.
          </p>
        </div>
      }
    >
      {/* 1. Overview */}
      <section>
        <SectionAnchor id="overview" />
        <SectionHeading icon={FileText} title="1. Overview" color="text-cyan-400" id="overview" />
        <p className="text-muted-foreground text-sm leading-relaxed mb-4">
          We are committed to preventing the use of our Platform for money laundering, terrorist financing,
          financial fraud, and other financial crimes. Our KYC/AML programme ensures that we know who we
          are doing business with, monitor transactions for suspicious activity, and comply with all
          applicable regulatory requirements.
        </p>
        <InfoBox variant="warning">
          All merchants using the Platform must complete mandatory KYC verification before accessing full
          platform functionality and receiving settlements. Incomplete or non-compliant KYC will result in
          restricted access and suspended settlements.
        </InfoBox>
      </section>

      {/* 2. KYC Requirements */}
      <section>
        <SectionAnchor id="kyc-requirements" />
        <SectionHeading icon={UserCheck} title="2. KYC Requirements" color="text-violet-400" id="kyc-requirements" />
        <p className="text-muted-foreground text-sm mb-4 leading-relaxed">
          All merchants are required to complete KYC verification, which includes verification of:
        </p>
        <div className="grid gap-3 sm:grid-cols-2 mb-4">
          {[
            { title: "Identity Verification", desc: "Government-issued photo ID of the authorised signatory/proprietor (PAN card, Aadhaar, passport, or driving licence)." },
            { title: "PAN Verification", desc: "Permanent Account Number (PAN) of the business or proprietor, mandatory for all merchants." },
            { title: "Business Verification", desc: "Business registration certificate, GST registration, or other applicable business licence." },
            { title: "Address Verification", desc: "Proof of business address — utility bill, lease agreement, or official correspondence." },
            { title: "Bank Account Verification", desc: "Cancelled cheque or bank statement for the registered settlement account." },
            { title: "Aadhaar Verification", desc: "Aadhaar-based identity verification may be required for individual/proprietor merchants." },
          ].map((r) => (
            <div key={r.title} className="rounded-xl border border-border/50 bg-card/40 p-4">
              <p className="text-sm font-semibold text-foreground mb-1">{r.title}</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{r.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 3. Documents */}
      <section>
        <SectionAnchor id="documents" />
        <SectionHeading icon={FileText} title="3. Required Documents by Business Type" color="text-blue-400" id="documents" />
        <div className="space-y-3">
          {[
            {
              type: "Sole Proprietorship",
              docs: ["PAN card of proprietor", "Aadhaar card of proprietor", "Business registration certificate or GST certificate", "Bank account statement or cancelled cheque"],
            },
            {
              type: "Private / Public Limited Company & LLP",
              docs: ["Certificate of Incorporation / Certificate of Registration", "PAN of the company", "Board resolution authorising account opening", "PAN and Aadhaar of all directors/partners", "GST registration certificate", "Bank account details"],
            },
            {
              type: "Partnership Firm",
              docs: ["Partnership deed", "PAN of the firm", "PAN and Aadhaar of all partners", "GST registration", "Bank account details"],
            },
          ].map((g) => (
            <div key={g.type} className="rounded-xl border border-border/50 bg-card/40 p-4">
              <p className="text-sm font-semibold text-foreground mb-2">{g.type}</p>
              <ul className="space-y-1">
                {g.docs.map((d) => (
                  <Bullet key={d}>{d}</Bullet>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
          Additional documents may be required depending on your business nature, risk profile, or
          regulatory requirements. We reserve the right to request supplementary information at any time.
        </p>
      </section>

      {/* 4. Enhanced DD */}
      <section>
        <SectionAnchor id="enhanced-dd" />
        <SectionHeading icon={Shield} title="4. Enhanced Due Diligence (EDD)" color="text-emerald-400" id="enhanced-dd" />
        <p className="text-muted-foreground text-sm mb-4 leading-relaxed">
          Enhanced due diligence may be applied to merchants in higher-risk categories, including:
        </p>
        <ul className="space-y-2 mb-4">
          <Bullet>Merchants with high transaction volumes or large average ticket sizes</Bullet>
          <Bullet>Merchants in industries identified as higher risk by our risk management framework</Bullet>
          <Bullet>Merchants flagged by our screening tools against sanctions or watchlists</Bullet>
          <Bullet>Politically Exposed Persons (PEPs) and their associates</Bullet>
          <Bullet>Merchants operating cross-border or in multiple jurisdictions</Bullet>
        </ul>
        <p className="text-muted-foreground text-sm leading-relaxed">
          EDD may include additional document requirements, enhanced ongoing monitoring, increased scrutiny
          of transactions, and more frequent re-KYC cycles.
        </p>
      </section>

      {/* 5. Transaction Monitoring */}
      <section>
        <SectionAnchor id="monitoring" />
        <SectionHeading icon={Eye} title="5. Transaction Monitoring" color="text-amber-400" id="monitoring" />
        <p className="text-muted-foreground text-sm mb-4 leading-relaxed">
          We continuously monitor transactions on the Platform to detect and prevent suspicious activity,
          including:
        </p>
        <ul className="space-y-2">
          <Bullet>Unusual transaction patterns, volumes, or frequencies inconsistent with the stated business nature</Bullet>
          <Bullet>Structuring of transactions to avoid detection thresholds</Bullet>
          <Bullet>Transactions involving sanctioned countries, individuals, or entities</Bullet>
          <Bullet>Sudden spikes in transaction volumes without apparent business justification</Bullet>
          <Bullet>Transactions associated with known fraud patterns or flagged customer data</Bullet>
        </ul>
      </section>

      {/* 6. Suspicious Activity */}
      <section>
        <SectionAnchor id="suspicious" />
        <SectionHeading icon={AlertTriangle} title="6. Suspicious Activity Reporting" color="text-orange-400" id="suspicious" />
        <p className="text-muted-foreground text-sm mb-4 leading-relaxed">
          We are obligated by law to report suspicious transactions and activities to the Financial
          Intelligence Unit – India (FIU-IND) and other relevant authorities. Where suspicious activity is
          detected:
        </p>
        <ul className="space-y-2 mb-4">
          <Bullet>We may freeze or suspend transactions, accounts, or settlements pending investigation</Bullet>
          <Bullet>We will file Suspicious Transaction Reports (STRs) as required by the Prevention of Money Laundering Act (PMLA)</Bullet>
          <Bullet>We may not be able to disclose to you that a report has been filed ("tipping off" prohibition)</Bullet>
          <Bullet>Funds associated with suspicious activity may be withheld in accordance with regulatory requirements</Bullet>
        </ul>
        <InfoBox variant="danger">
          Merchants must not "tip off" their customers or associates that a suspicious activity report or
          regulatory enquiry is underway. Such "tipping off" is itself a criminal offence under PMLA.
        </InfoBox>
      </section>

      {/* 7. Records */}
      <section>
        <SectionAnchor id="records" />
        <SectionHeading icon={Database} title="7. Record Keeping" color="text-sky-400" id="records" />
        <ul className="space-y-2">
          <Bullet>We maintain KYC records and transaction data for a minimum of 5 years from the date of the last transaction or account closure, whichever is later, as required by PMLA</Bullet>
          <Bullet>Records include identity documents, transaction histories, and correspondence related to KYC and compliance reviews</Bullet>
          <Bullet>Records are maintained securely and are available to regulatory authorities upon lawful request</Bullet>
        </ul>
      </section>

      {/* 8. Merchant Obligations */}
      <section>
        <SectionAnchor id="merchant-obligations" />
        <SectionHeading icon={ShieldCheck} title="8. Merchant Obligations" color="text-teal-400" id="merchant-obligations" />
        <p className="text-muted-foreground text-sm mb-4 leading-relaxed">
          As a merchant using the Platform, you are responsible for:
        </p>
        <ul className="space-y-2">
          <Bullet>Conducting your own KYC of your customers where required by applicable law</Bullet>
          <Bullet>Not facilitating, knowingly or unknowingly, money laundering, terrorist financing, or any other financial crime</Bullet>
          <Bullet>Promptly notifying us if you become aware of any suspicious activity involving a transaction processed through the Platform</Bullet>
          <Bullet>Providing truthful and complete information during KYC and any subsequent verification or compliance review</Bullet>
          <Bullet>Cooperating fully with any investigation or audit related to compliance obligations</Bullet>
        </ul>
      </section>

      {/* 9. Legal Basis */}
      <section>
        <SectionAnchor id="legal-basis" />
        <SectionHeading icon={Scale} title="9. Legal Basis" color="text-indigo-400" id="legal-basis" />
        <p className="text-muted-foreground text-sm mb-4 leading-relaxed">
          Our KYC and AML programme is implemented in accordance with:
        </p>
        <ul className="space-y-2">
          <Bullet>Prevention of Money Laundering Act, 2002 (PMLA) and the PMLA (Maintenance of Records) Rules, 2005</Bullet>
          <Bullet>RBI Master Directions on KYC (as updated from time to time)</Bullet>
          <Bullet>Foreign Exchange Management Act, 1999 (FEMA)</Bullet>
          <Bullet>Unlawful Activities (Prevention) Act, 1967</Bullet>
          <Bullet>FIU-IND guidelines on Suspicious Transaction Reporting</Bullet>
        </ul>
      </section>

      {/* 10. Contact */}
      <section>
        <SectionAnchor id="contact" />
        <SectionHeading icon={Phone} title="10. Contact Us" color="text-teal-400" id="contact" />
        <div className="rounded-xl border border-border/50 bg-card/40 p-5 space-y-2">
          <p className="text-sm font-semibold text-foreground">NICKEY COLLECTION PRIVATE LIMITED</p>
          <p className="text-xs text-muted-foreground/70">CIN: {CIN} · GSTIN: {GSTIN}</p>
          <p className="text-sm text-muted-foreground">P. No. B-46, Damodar Vila, Agarsen Nagar, Kalwar Road, Jhotwara, Jaipur, Rajasthan – 302012, India</p>
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
