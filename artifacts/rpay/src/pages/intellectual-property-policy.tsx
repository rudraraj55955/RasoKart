import { useEffect } from "react";
import { Link } from "wouter";
import LegalLayout, {
  Bullet, InfoBox, SectionAnchor, SectionHeading, type LegalSection,
} from "@/components/layout/legal-layout";
import { useCompanySettings } from "@/lib/company-settings";
import {
  Globe, Shield, FileText, Key, AlertTriangle, Scale, Phone, Eye, Ban, Settings,
} from "lucide-react";

const LAST_UPDATED = "20 July 2026";

const sections: LegalSection[] = [
  { id: "overview", icon: FileText, title: "Overview", color: "text-cyan-400" },
  { id: "our-ip", icon: Shield, title: "RasoKart Intellectual Property", color: "text-violet-400" },
  { id: "trademarks", icon: Globe, title: "Trademarks", color: "text-blue-400" },
  { id: "software-api", icon: Key, title: "Software & API", color: "text-emerald-400" },
  { id: "user-content", icon: Eye, title: "User Content & Licence", color: "text-amber-400" },
  { id: "third-party", icon: Settings, title: "Third-Party IP", color: "text-orange-400" },
  { id: "infringement", icon: AlertTriangle, title: "Reporting Infringement", color: "text-rose-400" },
  { id: "dmca", icon: Ban, title: "DMCA / Takedown Process", color: "text-red-400" },
  { id: "governing-law", icon: Scale, title: "Governing Law", color: "text-indigo-400" },
  { id: "contact", icon: Phone, title: "Contact", color: "text-teal-400" },
];

export default function IntellectualPropertyPolicy() {
  const { companyName, supportEmail } = useCompanySettings();

  useEffect(() => {
    document.title = "Intellectual Property Policy — RasoKart";
  }, []);

  return (
    <LegalLayout
      title="Intellectual Property Policy"
      lastUpdated={LAST_UPDATED}
      badgeText="IP Policy"
      sections={sections}
      intro={
        <p className="text-muted-foreground leading-relaxed max-w-2xl mt-3">
          This Intellectual Property Policy explains how <strong className="text-foreground">{companyName}</strong> ("RasoKart") protects its intellectual property and how users may lawfully use it. It also explains how to report intellectual property infringement on our platform.
        </p>
      }
    >
      <section className="space-y-4">
        <SectionAnchor id="overview" />
        <SectionHeading icon={FileText} title="Overview" color="text-cyan-400" id="overview" />
        <p className="text-muted-foreground text-sm leading-relaxed">
          All intellectual property associated with the RasoKart platform — including the software, APIs, documentation, brand assets, and content — is owned by or licensed to Nickey Collection Private Limited. Access to our services does not transfer any ownership rights to users.
        </p>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="our-ip" />
        <SectionHeading icon={Shield} title="RasoKart Intellectual Property" color="text-violet-400" id="our-ip" />
        <p className="text-muted-foreground text-sm leading-relaxed">The following are owned exclusively by Nickey Collection Private Limited:</p>
        <ul className="space-y-2">
          {[
            "The RasoKart name, brand identity, logo, and all visual design elements",
            "The RasoKart payment gateway platform, including all frontend and backend software",
            "All APIs, SDKs, developer tools, and associated documentation",
            "The merchant portal, admin portal, agent portal, and payout merchant portal UX/UI designs",
            "All written content, policies, guides, and marketing materials published on rasokart.com",
            "Proprietary algorithms, fraud detection systems, and risk-scoring models",
            "Any improvements, modifications, or derivative works created by RasoKart",
          ].map(item => <Bullet key={item}>{item}</Bullet>)}
        </ul>
        <InfoBox>
          Your subscription to RasoKart grants you a limited, non-exclusive, non-transferable licence to use our services for your own business purposes only. All ownership remains with Nickey Collection Private Limited.
        </InfoBox>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="trademarks" />
        <SectionHeading icon={Globe} title="Trademarks" color="text-blue-400" id="trademarks" />
        <p className="text-muted-foreground text-sm leading-relaxed">
          "RasoKart" and the RasoKart logo are trademarks of Nickey Collection Private Limited. You may not use our trademarks without prior written permission, except as follows:
        </p>
        <ul className="space-y-2">
          {[
            "Editorial reference: You may refer to RasoKart by name in a factually accurate, non-misleading editorial context",
            "Merchant disclosure: Merchants may state 'Payments secured by RasoKart' with prior written approval",
            "Press coverage: Journalists and media outlets may use the RasoKart name and logo for editorial purposes following our brand guidelines",
          ].map(item => <Bullet key={item}>{item}</Bullet>)}
        </ul>
        <p className="text-muted-foreground text-sm leading-relaxed">
          You must not use our trademarks in a way that suggests endorsement, affiliation, or partnership with RasoKart unless formally agreed in writing. See our <Link href="/press-media" className="text-primary hover:underline">Press & Media page</Link> for brand guidelines.
        </p>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="software-api" />
        <SectionHeading icon={Key} title="Software & API" color="text-emerald-400" id="software-api" />
        <p className="text-muted-foreground text-sm leading-relaxed">Our software and APIs are proprietary. Developers accessing our APIs must comply with the following:</p>
        <ul className="space-y-2">
          {[
            "You may integrate RasoKart APIs into your application solely for the purpose of enabling payment functionality for your own business",
            "You must not reverse engineer, decompile, disassemble, or attempt to derive the source code of any part of our platform",
            "You must not build a competing payment gateway, aggregator, or infrastructure product using RasoKart's APIs or platform knowledge",
            "API keys are confidential and may not be shared, resold, or sublicensed",
            "All API usage must comply with our rate limits, usage policies, and the terms in our Merchant Agreement",
          ].map(item => <Bullet key={item}>{item}</Bullet>)}
        </ul>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="user-content" />
        <SectionHeading icon={Eye} title="User Content & Licence" color="text-amber-400" id="user-content" />
        <p className="text-muted-foreground text-sm leading-relaxed">
          When you submit content to RasoKart — including business descriptions, logos, product names, and communications — you represent that you own or have the right to use such content, and you grant RasoKart a non-exclusive, royalty-free, worldwide licence to:
        </p>
        <ul className="space-y-2">
          {[
            "Display your content as part of operating the RasoKart platform",
            "Use your business name in our merchant directories or case studies (only with your prior consent)",
            "Store, process, and backup your content as necessary for service delivery",
          ].map(item => <Bullet key={item}>{item}</Bullet>)}
        </ul>
        <p className="text-muted-foreground text-sm leading-relaxed">
          You retain all ownership of your content. This licence terminates when you close your account, except where retention is required by law or our data retention policy.
        </p>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="third-party" />
        <SectionHeading icon={Settings} title="Third-Party IP" color="text-orange-400" id="third-party" />
        <p className="text-muted-foreground text-sm leading-relaxed">
          RasoKart's platform includes third-party open-source components and licensed software. We comply with all applicable third-party licence terms. Our platform does not grant you any rights to such third-party software beyond what is necessary to use RasoKart's services.
        </p>
        <p className="text-muted-foreground text-sm leading-relaxed">
          As a merchant on our platform, you are responsible for ensuring that any third-party content, products, or services you offer through RasoKart do not infringe the intellectual property rights of others.
        </p>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="infringement" />
        <SectionHeading icon={AlertTriangle} title="Reporting Infringement" color="text-rose-400" id="infringement" />
        <p className="text-muted-foreground text-sm leading-relaxed">
          If you believe that content on the RasoKart platform infringes your intellectual property rights, please notify us promptly. To file a valid notice, include:
        </p>
        <ul className="space-y-2">
          {[
            "Identification of the copyrighted work or trademark claimed to be infringed",
            "Identification of the material on our platform that you claim is infringing, with sufficient detail for us to locate it",
            "Your contact information (name, address, email, phone number)",
            "A statement that you have a good faith belief that the use is not authorised by the IP owner, its agent, or law",
            "A statement that the information in your notice is accurate, and that you are the IP owner or authorised to act on their behalf",
            "Your electronic or physical signature",
          ].map(item => <Bullet key={item}>{item}</Bullet>)}
        </ul>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="dmca" />
        <SectionHeading icon={Ban} title="DMCA / Takedown Process" color="text-red-400" id="dmca" />
        <p className="text-muted-foreground text-sm leading-relaxed">
          We will respond to valid infringement notices in accordance with applicable law. Upon receipt of a valid notice, we will:
        </p>
        <ul className="space-y-2">
          {[
            "Promptly investigate the claim and review the allegedly infringing content",
            "Remove or disable access to the infringing content if the claim is substantiated",
            "Notify the user whose content was removed and provide an opportunity to file a counter-notice",
            "Restore content if we receive a valid counter-notice and no court order is filed within the statutory period",
          ].map(item => <Bullet key={item}>{item}</Bullet>)}
        </ul>
        <InfoBox variant="warning">
          Filing a false infringement claim is a serious legal matter. Misrepresentation may expose you to liability for damages, costs, and attorney's fees.
        </InfoBox>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="governing-law" />
        <SectionHeading icon={Scale} title="Governing Law" color="text-indigo-400" id="governing-law" />
        <p className="text-muted-foreground text-sm leading-relaxed">
          This policy is governed by the laws of India, including the Copyright Act 1957, the Trade Marks Act 1999, the Information Technology Act 2000, and the Patents Act 1970. Disputes will be resolved in the courts of Jaipur, Rajasthan.
        </p>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="contact" />
        <SectionHeading icon={Phone} title="Contact" color="text-teal-400" id="contact" />
        <div className="rounded-xl border border-border/60 bg-card/40 p-4 space-y-2 text-sm">
          <p><span className="text-muted-foreground">IP Infringement Notices: </span><a href={`mailto:${supportEmail || "legal@rasokart.com"}`} className="text-primary hover:underline">{supportEmail || "legal@rasokart.com"}</a></p>
          <p><span className="text-muted-foreground">General Legal: </span><a href={`mailto:${supportEmail || "legal@rasokart.com"}`} className="text-primary hover:underline">{supportEmail || "legal@rasokart.com"}</a></p>
          <p><span className="text-muted-foreground">Related Policies: </span>
            <Link href="/acceptable-use-policy" className="text-primary hover:underline">Acceptable Use</Link> ·{" "}
            <Link href="/merchant-agreement" className="text-primary hover:underline">Merchant Agreement</Link>
          </p>
        </div>
      </section>
    </LegalLayout>
  );
}
