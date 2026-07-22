import { useEffect } from "react";
import { Link } from "wouter";
import LegalLayout, {
  Bullet, InfoBox, SectionAnchor, SectionHeading, type LegalSection,
} from "@/components/layout/legal-layout";
import { useCompanySettings } from "@/lib/company-settings";
import {
  UserCheck, Phone, Mail, MapPin, Clock, FileText, Scale, AlertTriangle, Settings,
} from "lucide-react";

const LAST_UPDATED = "20 July 2026";
const CIN = "U47820RJ2025PTC109583";
const REGISTERED_ADDRESS = "P. No. B-46, Damodar Vila, Agarsen Nagar, Kalwar Road, Jhotwara, Jaipur – 302012, Rajasthan, India";

const sections: LegalSection[] = [
  { id: "overview", icon: FileText, title: "Overview", color: "text-cyan-400" },
  { id: "officer-details", icon: UserCheck, title: "Grievance Officer Details", color: "text-violet-400" },
  { id: "how-to-reach", icon: Phone, title: "How to Reach the Officer", color: "text-blue-400" },
  { id: "what-we-handle", icon: Settings, title: "What the Officer Handles", color: "text-emerald-400" },
  { id: "process", icon: AlertTriangle, title: "Grievance Process", color: "text-amber-400" },
  { id: "timelines", icon: Clock, title: "Response Timelines", color: "text-orange-400" },
  { id: "governing-law", icon: Scale, title: "Governing Law", color: "text-indigo-400" },
  { id: "contact", icon: Mail, title: "Contact & Related Links", color: "text-teal-400" },
];

export default function GrievanceOfficer() {
  const { companyName, supportEmail, supportPhone } = useCompanySettings();

  useEffect(() => {
    document.title = "Grievance Officer — RasoKart";
  }, []);

  return (
    <LegalLayout
      title="Grievance Officer"
      lastUpdated={LAST_UPDATED}
      badgeText="Customer Support"
      sections={sections}
      intro={
        <p className="text-muted-foreground leading-relaxed max-w-2xl mt-3">
          In accordance with the Information Technology Act 2000, the Consumer Protection Act 2019, and RBI guidelines for payment system operators, <strong className="text-foreground">{companyName}</strong> ("RasoKart") has designated a Grievance Officer to address customer and merchant complaints that could not be resolved through standard support channels.
        </p>
      }
    >
      <section className="space-y-4">
        <SectionAnchor id="overview" />
        <SectionHeading icon={FileText} title="Overview" color="text-cyan-400" id="overview" />
        <p className="text-muted-foreground text-sm leading-relaxed">
          The Grievance Officer is a senior representative of Nickey Collection Private Limited responsible for ensuring that all unresolved complaints and grievances are addressed promptly, fairly, and in accordance with applicable regulations. The Grievance Officer reports directly to senior management and operates independently of the standard customer support team.
        </p>
        <InfoBox>
          Please attempt to resolve your issue through our standard support channels first. The Grievance Officer should be contacted only after your complaint has not been resolved within the expected timeframes. See our <Link href="/support-center" className="text-primary hover:underline">Support Center</Link> for first-line support options.
        </InfoBox>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="officer-details" />
        <SectionHeading icon={UserCheck} title="Grievance Officer Details" color="text-violet-400" id="officer-details" />
        <div className="rounded-xl border border-border/60 bg-card/40 p-6 space-y-4">
          <div className="grid sm:grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Designation</p>
              <p className="font-medium">Grievance Officer</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Organisation</p>
              <p className="font-medium">Nickey Collection Private Limited</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">CIN</p>
              <p className="font-mono text-xs font-medium">{CIN}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Registered Office</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{REGISTERED_ADDRESS}</p>
            </div>
          </div>
          <div className="border-t border-border/40 pt-4 space-y-2">
            <p className="text-xs text-muted-foreground">The Grievance Officer can be contacted via:</p>
            <div className="flex items-center gap-2 text-sm">
              <Mail className="w-4 h-4 text-primary shrink-0" />
              <a href="mailto:grievance@rasokart.com" className="text-primary hover:underline">grievance@rasokart.com</a>
            </div>
            {supportPhone && (
              <div className="flex items-center gap-2 text-sm">
                <Phone className="w-4 h-4 text-primary shrink-0" />
                <a href={`tel:${supportPhone}`} className="text-muted-foreground hover:text-foreground transition-colors">{supportPhone}</a>
              </div>
            )}
            <div className="flex items-start gap-2 text-sm">
              <MapPin className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <span className="text-muted-foreground text-xs">{REGISTERED_ADDRESS}</span>
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="how-to-reach" />
        <SectionHeading icon={Phone} title="How to Reach the Officer" color="text-blue-400" id="how-to-reach" />
        <p className="text-muted-foreground text-sm leading-relaxed">You may contact the Grievance Officer through any of the following methods:</p>
        <ul className="space-y-2">
          {[
            "Email: grievance@rasokart.com (preferred — provides a written record of your complaint)",
            "Post: Addressed to 'The Grievance Officer, Nickey Collection Private Limited' at the registered office address above",
            "In person: By appointment only — please email in advance to schedule",
          ].map(item => <Bullet key={item}>{item}</Bullet>)}
        </ul>
        <p className="text-muted-foreground text-sm leading-relaxed">
          When contacting the Grievance Officer, please include:
        </p>
        <ul className="space-y-2">
          {[
            "Your full name and registered email address or merchant ID",
            "A clear description of your complaint and the outcome you are seeking",
            "The original support ticket reference number (if applicable)",
            "The date you first raised the issue and all previous correspondence",
          ].map(item => <Bullet key={item}>{item}</Bullet>)}
        </ul>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="what-we-handle" />
        <SectionHeading icon={Settings} title="What the Officer Handles" color="text-emerald-400" id="what-we-handle" />
        <p className="text-muted-foreground text-sm leading-relaxed">The Grievance Officer handles escalated complaints related to:</p>
        <ul className="space-y-2">
          {[
            "Payment disputes — payments collected but not settled, or settlement amounts incorrect",
            "Account suspension or termination that the merchant believes is unjustified",
            "KYC rejection where the merchant has provided all required documentation",
            "Refund processing failures or delays beyond the committed timeframe",
            "Payout failures or unexplained fund holds",
            "Privacy and data protection concerns",
            "Alleged violations of RasoKart's own policies by our staff",
            "Any complaint that has not been resolved through standard support within the SLA timeframe",
          ].map(item => <Bullet key={item}>{item}</Bullet>)}
        </ul>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="process" />
        <SectionHeading icon={AlertTriangle} title="Grievance Process" color="text-amber-400" id="process" />
        <div className="relative pl-6 border-l border-border/60 space-y-6">
          {[
            { step: "Step 1", title: "File Standard Support Request", desc: "Contact our support team via email or the merchant portal. Allow the standard SLA period for resolution." },
            { step: "Step 2", title: "Escalate to Grievance Officer", desc: "If unresolved within the SLA period, email grievance@rasokart.com with your complaint, ticket reference, and all prior correspondence." },
            { step: "Step 3", title: "Acknowledgement", desc: "The Grievance Officer will acknowledge your complaint within 48 hours of receipt." },
            { step: "Step 4", title: "Investigation", desc: "We review your complaint, gather all relevant information, and conduct a fair and impartial investigation." },
            { step: "Step 5", title: "Resolution", desc: "We provide a formal written response with our findings and, where applicable, corrective action or remediation." },
            { step: "Step 6", title: "Regulatory Escalation (if needed)", desc: "If you are unsatisfied with the outcome, you may escalate to the RBI Ombudsman for Digital Transactions or other applicable regulatory bodies." },
          ].map(({ step, title, desc }) => (
            <div key={step} className="relative">
              <div className="absolute -left-8 w-3 h-3 rounded-full bg-primary border-2 border-background top-1" />
              <span className="text-xs text-primary font-medium font-mono">{step}</span>
              <h3 className="font-semibold text-sm mt-0.5 mb-1">{title}</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="timelines" />
        <SectionHeading icon={Clock} title="Response Timelines" color="text-orange-400" id="timelines" />
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-muted-foreground border-collapse">
            <thead>
              <tr className="border-b border-border/60">
                <th className="text-left py-2 pr-4 font-medium text-foreground">Stage</th>
                <th className="text-left py-2 font-medium text-foreground">Timeframe</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {[
                ["Acknowledgement of grievance complaint", "Within 48 hours"],
                ["Initial assessment and update", "Within 5 business days"],
                ["Final resolution (standard complaints)", "Within 15 business days"],
                ["Final resolution (complex / financial disputes)", "Within 30 business days"],
              ].map(([stage, time]) => (
                <tr key={stage}>
                  <td className="py-2 pr-4">{stage}</td>
                  <td className="py-2 font-medium text-foreground">{time}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-muted-foreground text-sm leading-relaxed">
          For comprehensive SLA information, see our <Link href="/sla-support-timelines" className="text-primary hover:underline">SLA & Support Timelines page</Link>.
        </p>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="governing-law" />
        <SectionHeading icon={Scale} title="Governing Law" color="text-indigo-400" id="governing-law" />
        <p className="text-muted-foreground text-sm leading-relaxed">
          This Grievance Officer framework is maintained in accordance with the Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules 2021, the Consumer Protection Act 2019, the Payment and Settlement Systems Act 2007, and applicable RBI circulars on grievance redressal for payment system operators.
        </p>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="contact" />
        <SectionHeading icon={Mail} title="Contact & Related Links" color="text-teal-400" id="contact" />
        <div className="rounded-xl border border-border/60 bg-card/40 p-4 space-y-2 text-sm">
          <p><span className="text-muted-foreground">Grievance Email: </span><a href="mailto:grievance@rasokart.com" className="text-primary hover:underline">grievance@rasokart.com</a></p>
          <p><span className="text-muted-foreground">General Support: </span><a href={`mailto:${supportEmail || "support@rasokart.com"}`} className="text-primary hover:underline">{supportEmail || "support@rasokart.com"}</a></p>
          <p><span className="text-muted-foreground">Related: </span>
            <Link href="/grievance-redressal-policy" className="text-primary hover:underline">Grievance Redressal Policy</Link> ·{" "}
            <Link href="/escalation-matrix" className="text-primary hover:underline">Escalation Matrix</Link> ·{" "}
            <Link href="/sla-support-timelines" className="text-primary hover:underline">SLA Timelines</Link>
          </p>
        </div>
      </section>
    </LegalLayout>
  );
}
