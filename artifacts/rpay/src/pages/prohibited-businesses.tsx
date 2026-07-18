import LegalLayout, {
  Bullet,
  InfoBox,
  SectionAnchor,
  SectionHeading,
  type LegalSection,
} from "@/components/layout/legal-layout";
import { useCompanySettings } from "@/lib/company-settings";
import {
  Ban,
  FileText,
  AlertTriangle,
  Scale,
  Phone,
  Shield,
  Flag,
  BookOpen,
} from "lucide-react";

const LAST_UPDATED = "16 July 2026";

const sections: LegalSection[] = [
  { id: "overview", icon: FileText, title: "Overview", color: "text-cyan-400" },
  { id: "financial-fraud", icon: AlertTriangle, title: "Financial & Fraud Services", color: "text-red-400" },
  { id: "illegal-content", icon: Ban, title: "Illegal & Restricted Content", color: "text-rose-400" },
  { id: "gambling", icon: Flag, title: "Gambling & Gaming", color: "text-orange-400" },
  { id: "substances", icon: AlertTriangle, title: "Regulated Substances", color: "text-amber-400" },
  { id: "weapons", icon: Shield, title: "Weapons & Dangerous Goods", color: "text-red-500" },
  { id: "regulated", icon: Scale, title: "Regulated & Licensed Activities", color: "text-violet-400" },
  { id: "high-risk", icon: AlertTriangle, title: "High-Risk & Other Categories", color: "text-yellow-400" },
  { id: "consequences", icon: Scale, title: "Consequences of Violation", color: "text-indigo-400" },
  { id: "contact", icon: Phone, title: "Contact & Reporting", color: "text-teal-400" },
];

const categoryGroups = [
  {
    id: "financial-fraud",
    icon: AlertTriangle,
    color: "text-red-400",
    title: "Financial Services & Fraud",
    items: [
      "Unlicensed money lending, chit funds, and NBFCs not registered with RBI",
      "Ponzi schemes, multi-level marketing (MLM) with deceptive structures, and pyramid schemes",
      "Unlicensed cryptocurrency exchanges, crypto trading platforms, or related products",
      "Unlicensed investment advisory, portfolio management, or securities dealing services",
      "Foreign exchange services not authorised under FEMA",
      "Shell companies and front businesses with no legitimate commercial activity",
      "Businesses facilitating tax evasion or money laundering",
    ],
  },
  {
    id: "illegal-content",
    icon: Ban,
    color: "text-rose-400",
    title: "Illegal & Restricted Content",
    items: [
      "Adult content, pornography, or explicit material of any kind",
      "Child sexual abuse material (CSAM) — absolutely prohibited",
      "Content promoting hate speech, incitement to violence, or discrimination based on religion, ethnicity, caste, gender, or sexual orientation",
      "Pirated software, media, or counterfeit products",
      "Sale of personal data, private communications, or hacking services",
      "Phishing, scam, or social engineering tools and services",
    ],
  },
  {
    id: "gambling",
    icon: Flag,
    color: "text-orange-400",
    title: "Gambling & Fantasy Gaming",
    items: [
      "Online gambling, betting, or wagering platforms without valid licences",
      "Sports betting without required regulatory approvals",
      "Unlicensed daily fantasy sports platforms with cash prizes",
      "Casino services, slot machines, or games of chance operated without a valid licence",
    ],
  },
  {
    id: "substances",
    icon: AlertTriangle,
    color: "text-amber-400",
    title: "Regulated Substances",
    items: [
      "Narcotics, controlled substances, or drugs classified as illegal under the Narcotic Drugs and Psychotropic Substances Act, 1985",
      "Prescription drugs sold without valid prescription or pharmacy licence",
      "Tobacco products, e-cigarettes, and vaping products marketed or sold to minors",
      "Alcohol sold without appropriate excise licence or to minors",
      "Steroids, hormones, or controlled medicines sold without authorisation",
    ],
  },
  {
    id: "weapons",
    icon: Shield,
    color: "text-red-500",
    title: "Weapons & Dangerous Goods",
    items: [
      "Firearms, ammunition, explosives, or related accessories without required licences",
      "Knives, bladed weapons, or restricted weapons under applicable law",
      "Chemicals, biological agents, or materials that are prohibited under Indian law",
      "Counterfeit currency, documents, or identification materials",
    ],
  },
  {
    id: "regulated",
    icon: Scale,
    color: "text-violet-400",
    title: "Regulated & Licensed Activities",
    items: [
      "Pharmaceutical and medical devices without CDSCO/FSSAI licences",
      "Financial products (insurance, securities, mutual funds) without IRDAI/SEBI licences",
      "Money transfer or remittance without RBI authorisation",
      "Travel agencies and ticketing services operating without required registrations",
      "Educational services offering degrees or certifications without UGC/AICTE recognition",
    ],
  },
  {
    id: "high-risk",
    icon: AlertTriangle,
    color: "text-yellow-400",
    title: "High-Risk & Other Categories",
    items: [
      "Escort, relationship, or companionship services",
      "Get-rich-quick or work-from-home scam services",
      "Debt collection agencies not authorised under applicable law",
      "Businesses with a history of excessive chargebacks or fraud",
      "Any business designated as a terrorist organisation or operating in a sanctioned jurisdiction",
      "Any business that enables or facilitates any of the above categories",
    ],
  },
];

export default function ProhibitedBusinesses() {
  const { companyName, supportPhone, supportEmail } = useCompanySettings();

  return (
    <LegalLayout
      title="Prohibited Businesses"
      lastUpdated={LAST_UPDATED}
      badgeText="Acceptable Use"
      sections={sections}
      intro={
        <p className="text-muted-foreground leading-relaxed max-w-2xl mt-3">
          This policy lists the business categories and activities that are strictly prohibited on the
          RasoKart platform operated by{" "}
          <strong className="text-foreground">{companyName}</strong>. Merchants found operating in any
          prohibited category will have their accounts suspended and settlement funds may be withheld
          pending investigation.
        </p>
      }
    >
      {/* 1. Overview */}
      <section>
        <SectionAnchor id="overview" />
        <SectionHeading icon={FileText} title="1. Overview" color="text-cyan-400" id="overview" />
        <p className="text-muted-foreground text-sm leading-relaxed mb-4">
          RasoKart is committed to maintaining a safe, legal, and compliant payment ecosystem. We are
          required by law and our banking and payment partners to ensure that the Platform is not used for
          illegal, harmful, or high-risk business activities. The categories below are prohibited from using
          the Platform. This list is not exhaustive — we reserve the right to refuse or terminate accounts
          for any business that we determine to be high-risk, harmful, or non-compliant.
        </p>
        <InfoBox variant="danger">
          If you are unsure whether your business qualifies for RasoKart services, please contact us before
          registering. Operating a prohibited business on the Platform is a serious violation that may result
          in immediate account termination, fund withholding, and referral to law enforcement.
        </InfoBox>
      </section>

      {/* Category sections */}
      {categoryGroups.map((group) => (
        <section key={group.id}>
          <SectionAnchor id={group.id} />
          <SectionHeading icon={group.icon} title={`Prohibited: ${group.title}`} color={group.color} id={group.id} />
          <ul className="space-y-2">
            {group.items.map((item) => (
              <Bullet key={item}>{item}</Bullet>
            ))}
          </ul>
        </section>
      ))}

      {/* Consequences */}
      <section>
        <SectionAnchor id="consequences" />
        <SectionHeading icon={Scale} title="Consequences of Violation" color="text-indigo-400" id="consequences" />
        <p className="text-muted-foreground text-sm mb-4 leading-relaxed">
          If we determine that your account has been used for prohibited activities, we may take any or all
          of the following actions:
        </p>
        <ul className="space-y-2 mb-4">
          <Bullet>Immediate suspension or permanent termination of your merchant account</Bullet>
          <Bullet>Withholding of pending settlement funds for up to 180 days pending investigation</Bullet>
          <Bullet>Deduction of any losses, fines, or penalties incurred by us as a result of your prohibited activity from withheld funds</Bullet>
          <Bullet>Reporting to applicable regulatory authorities, financial intelligence agencies, or law enforcement</Bullet>
          <Bullet>Legal action for damages, losses, or expenses incurred</Bullet>
          <Bullet>Permanent blacklisting from the Platform and related services</Bullet>
        </ul>
      </section>

      {/* Contact & Reporting */}
      <section>
        <SectionAnchor id="contact" />
        <SectionHeading icon={Phone} title="Contact & Reporting" color="text-teal-400" id="contact" />
        <p className="text-muted-foreground text-sm leading-relaxed mb-4">
          If you believe a merchant on the Platform is operating a prohibited business or engaging in
          fraudulent activity, please report it to us immediately. We take all reports seriously and will
          investigate promptly.
        </p>
        <div className="rounded-xl border border-border/50 bg-card/40 p-5 space-y-2">
          <p className="text-sm font-semibold text-foreground">{companyName}</p>
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
          <a href="/contact-us" className="block text-sm text-primary hover:underline pt-1">
            Report a violation via our Contact Us page →
          </a>
        </div>
      </section>
    </LegalLayout>
  );
}
