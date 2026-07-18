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
  AlertTriangle,
  FileText,
  Scale,
  Globe,
  Shield,
  Phone,
  Ban,
  Info,
} from "lucide-react";

const LAST_UPDATED = "16 July 2026";

const sections: LegalSection[] = [
  { id: "general", icon: FileText, title: "General Disclaimer", color: "text-cyan-400" },
  { id: "service", icon: AlertTriangle, title: "Service Disclaimer", color: "text-orange-400" },
  { id: "accuracy", icon: Info, title: "Accuracy Disclaimer", color: "text-violet-400" },
  { id: "third-party", icon: Globe, title: "Third-Party Content", color: "text-blue-400" },
  { id: "no-warranty", icon: Ban, title: "No Warranty", color: "text-red-400" },
  { id: "liability", icon: Scale, title: "Limitation of Liability", color: "text-indigo-400" },
  { id: "regulatory", icon: Shield, title: "Regulatory Disclaimer", color: "text-emerald-400" },
  { id: "contact", icon: Phone, title: "Contact Us", color: "text-teal-400" },
];

export default function Disclaimer() {
  const { companyName, supportPhone, supportEmail } = useCompanySettings();

  return (
    <LegalLayout
      title="Disclaimer"
      lastUpdated={LAST_UPDATED}
      badgeText="Disclaimer"
      sections={sections}
      intro={
        <p className="text-muted-foreground leading-relaxed max-w-2xl mt-3">
          Please read this Disclaimer carefully before using the RasoKart platform operated by{" "}
          <strong className="text-foreground">{companyName}</strong>. By accessing or using the Platform,
          you agree to the terms of this Disclaimer.
        </p>
      }
    >
      {/* 1. General */}
      <section>
        <SectionAnchor id="general" />
        <SectionHeading icon={FileText} title="1. General Disclaimer" color="text-cyan-400" id="general" />
        <p className="text-muted-foreground text-sm leading-relaxed mb-4">
          The information, content, and services provided on the RasoKart platform (
          <a href="https://rasokart.com" className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">
            rasokart.com
          </a>
          ) are provided for general business purposes only. While we make every effort to keep the
          Platform accurate, reliable, and up to date, we make no representations or warranties of any
          kind, express or implied, about the completeness, accuracy, reliability, suitability, or
          availability of the Platform or the information, products, services, or related graphics
          contained therein.
        </p>
      </section>

      {/* 2. Service */}
      <section>
        <SectionAnchor id="service" />
        <SectionHeading icon={AlertTriangle} title="2. Service Disclaimer" color="text-orange-400" id="service" />
        <p className="text-muted-foreground text-sm leading-relaxed mb-4">
          RasoKart is a payment gateway technology platform. We are not a bank, financial institution,
          payment aggregator, payment service provider, or non-banking financial company (NBFC). We do
          not hold, manage, or invest your funds. Funds collected through the Platform are held in
          designated accounts managed by our authorised banking partners.
        </p>
        <ul className="space-y-2 mb-4">
          <Bullet>We do not guarantee that payment transactions will always be successfully processed, settled, or completed without interruption</Bullet>
          <Bullet>Payment success rates, settlement timelines, and transaction limits are subject to conditions outside our direct control, including the availability of banking and payment network infrastructure</Bullet>
          <Bullet>We are not responsible for any loss suffered due to payment failure, delay, or decline caused by the customer's bank or payment method</Bullet>
        </ul>
        <InfoBox variant="warning">
          RasoKart does not provide financial advice, investment recommendations, or tax guidance. Any
          financial decisions made based on information provided on the Platform are made at your own risk.
        </InfoBox>
      </section>

      {/* 3. Accuracy */}
      <section>
        <SectionAnchor id="accuracy" />
        <SectionHeading icon={Info} title="3. Accuracy Disclaimer" color="text-violet-400" id="accuracy" />
        <p className="text-muted-foreground text-sm leading-relaxed mb-4">
          While we strive to provide accurate and timely transaction data, reports, and analytics through
          the Platform:
        </p>
        <ul className="space-y-2">
          <Bullet>Transaction data displayed on the Platform reflects information received from banking and payment partners and may be subject to delays or corrections</Bullet>
          <Bullet>Settlement reports and reconciliation data are generated to the best of our ability but should not be relied upon as the sole basis for financial accounting or tax purposes without independent verification</Bullet>
          <Bullet>Dashboard balance figures are indicative and may not reflect holds, reserves, or pending adjustments until processed</Bullet>
        </ul>
      </section>

      {/* 4. Third-Party */}
      <section>
        <SectionAnchor id="third-party" />
        <SectionHeading icon={Globe} title="4. Third-Party Content & Links" color="text-blue-400" id="third-party" />
        <p className="text-muted-foreground text-sm leading-relaxed mb-4">
          The Platform may contain links to external websites or references to third-party services.
          These are provided for informational purposes only:
        </p>
        <ul className="space-y-2">
          <Bullet>We have no control over the content, privacy practices, or availability of external websites and are not responsible for their content or accuracy</Bullet>
          <Bullet>The inclusion of any link does not imply endorsement, sponsorship, or recommendation by us</Bullet>
          <Bullet>Third-party services integrated with the Platform operate under their own terms and privacy policies</Bullet>
        </ul>
      </section>

      {/* 5. No Warranty */}
      <section>
        <SectionAnchor id="no-warranty" />
        <SectionHeading icon={Ban} title="5. No Warranty" color="text-red-400" id="no-warranty" />
        <p className="text-muted-foreground text-sm leading-relaxed mb-4">
          To the fullest extent permitted by applicable law:
        </p>
        <ul className="space-y-2 mb-4">
          <Bullet>The Platform is provided "as is" and "as available" without warranties of any kind, whether express, implied, statutory, or otherwise</Bullet>
          <Bullet>We disclaim all implied warranties, including merchantability, fitness for a particular purpose, non-infringement, and freedom from computer virus</Bullet>
          <Bullet>We do not warrant that the Platform will be available without interruption or error, or that defects will be corrected</Bullet>
          <Bullet>We do not warrant that the Platform is free from security vulnerabilities, though we take reasonable steps to address them when identified</Bullet>
        </ul>
      </section>

      {/* 6. Liability */}
      <section>
        <SectionAnchor id="liability" />
        <SectionHeading icon={Scale} title="6. Limitation of Liability" color="text-indigo-400" id="liability" />
        <p className="text-muted-foreground text-sm leading-relaxed mb-4">
          To the maximum extent permitted by applicable law, in no event shall {companyName}, its directors,
          officers, employees, agents, partners, or licensors be liable for any:
        </p>
        <ul className="space-y-2 mb-4">
          <Bullet>Indirect, incidental, special, consequential, punitive, or exemplary damages</Bullet>
          <Bullet>Loss of profits, revenue, data, goodwill, or business opportunities</Bullet>
          <Bullet>Damages arising from your reliance on information provided on the Platform</Bullet>
          <Bullet>Damages arising from unauthorised access to or alteration of your transmissions or data, including account compromise not caused by our negligence</Bullet>
          <Bullet>Damages arising from events outside our reasonable control</Bullet>
        </ul>
        <InfoBox>
          Nothing in this Disclaimer excludes or limits liability for death or personal injury caused by
          negligence, fraud, fraudulent misrepresentation, or any other liability that cannot be excluded
          under applicable Indian law.
        </InfoBox>
      </section>

      {/* 7. Regulatory */}
      <section>
        <SectionAnchor id="regulatory" />
        <SectionHeading icon={Shield} title="7. Regulatory Disclaimer" color="text-emerald-400" id="regulatory" />
        <p className="text-muted-foreground text-sm leading-relaxed mb-4">
          RasoKart is a technology platform that facilitates payment gateway services. We are not a
          bank, insurance company, investment advisor, or regulated financial intermediary. We do not:
        </p>
        <ul className="space-y-2 mb-4">
          <Bullet>Accept deposits or operate as a bank or NBFC</Bullet>
          <Bullet>Provide investment, tax, or financial planning advice</Bullet>
          <Bullet>Operate as a licensed money transfer operator or foreign exchange dealer</Bullet>
          <Bullet>Act as an insurance intermediary or underwriter</Bullet>
        </ul>
        <p className="text-muted-foreground text-sm leading-relaxed">
          Merchants using the Platform are responsible for their own regulatory compliance, including
          obtaining all necessary licences and permissions for their business activities.
        </p>
      </section>

      {/* 8. Contact */}
      <section>
        <SectionAnchor id="contact" />
        <SectionHeading icon={Phone} title="8. Contact Us" color="text-teal-400" id="contact" />
        <p className="text-muted-foreground text-sm leading-relaxed mb-4">
          If you have any questions about this Disclaimer or wish to raise a concern:
        </p>
        <div className="rounded-xl border border-border/50 bg-card/40 p-5 space-y-2">
          <p className="text-sm font-semibold text-foreground">{companyName}</p>
          <p className="text-sm text-muted-foreground">CIN: U47820RJ2025PTC109583</p>
          <p className="text-sm text-muted-foreground">
            P. No. B-46, Damodar Vila, Agarsen Nagar, Kalwad Road, Jhotwara, Jaipur – 302012, Rajasthan
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
            Submit a query via Contact Us →
          </Link>
        </div>
      </section>
    </LegalLayout>
  );
}
