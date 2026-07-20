import { useEffect } from "react";
import { Link } from "wouter";
import LegalLayout, {
  Bullet, InfoBox, SectionAnchor, SectionHeading, type LegalSection,
} from "@/components/layout/legal-layout";
import { useCompanySettings } from "@/lib/company-settings";
import {
  ArrowUp, Phone, Mail, FileText, Clock, Scale, AlertTriangle, Shield, UserCheck, Building2,
} from "lucide-react";

const LAST_UPDATED = "20 July 2026";

const sections: LegalSection[] = [
  { id: "overview", icon: FileText, title: "Overview", color: "text-cyan-400" },
  { id: "level1", icon: Phone, title: "Level 1 — Standard Support", color: "text-emerald-400" },
  { id: "level2", icon: AlertTriangle, title: "Level 2 — Escalated Support", color: "text-amber-400" },
  { id: "level3", icon: UserCheck, title: "Level 3 — Grievance Officer", color: "text-violet-400" },
  { id: "level4", icon: Building2, title: "Level 4 — Regulatory Escalation", color: "text-rose-400" },
  { id: "timelines", icon: Clock, title: "Escalation Timelines", color: "text-blue-400" },
  { id: "governing-law", icon: Scale, title: "Governing Law", color: "text-indigo-400" },
  { id: "contact", icon: Mail, title: "Contact", color: "text-teal-400" },
];

export default function EscalationMatrix() {
  const { companyName, supportEmail, supportPhone } = useCompanySettings();

  useEffect(() => {
    document.title = "Escalation Matrix — RasoKart Support";
  }, []);

  return (
    <LegalLayout
      title="Escalation Matrix"
      lastUpdated={LAST_UPDATED}
      badgeText="Customer Support"
      sections={sections}
      intro={
        <p className="text-muted-foreground leading-relaxed max-w-2xl mt-3">
          This Escalation Matrix outlines the structured process for escalating unresolved complaints at <strong className="text-foreground">{companyName}</strong> ("RasoKart"). It is designed to ensure that every complaint receives appropriate attention and is resolved at the right level of authority within the committed timeframe.
        </p>
      }
    >
      <section className="space-y-4">
        <SectionAnchor id="overview" />
        <SectionHeading icon={FileText} title="Overview" color="text-cyan-400" id="overview" />
        <p className="text-muted-foreground text-sm leading-relaxed">
          Our escalation framework has four levels. Most issues should be resolved at Level 1 or Level 2. If you are not satisfied with the resolution at any level, you may proceed to the next level only after allowing the committed response time to elapse.
        </p>
        <InfoBox>
          Always start with Level 1 support. Jumping directly to senior escalation levels for issues that have not gone through standard support will only delay resolution.
        </InfoBox>
      </section>

      {/* Level 1 */}
      <section className="space-y-4">
        <SectionAnchor id="level1" />
        <SectionHeading icon={Phone} title="Level 1 — Standard Support" color="text-emerald-400" id="level1" />
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5">
          <div className="flex items-center gap-2 mb-3">
            <ArrowUp className="w-4 h-4 text-emerald-400" />
            <span className="text-emerald-400 text-xs font-semibold uppercase tracking-wide">First Contact Resolution</span>
          </div>
          <p className="text-muted-foreground text-sm leading-relaxed mb-3">Contact our standard support team for all initial queries and complaints.</p>
          <div className="space-y-2 text-sm">
            <div className="flex gap-3">
              <span className="text-muted-foreground w-24 text-xs">Email</span>
              <a href={`mailto:${supportEmail || "support@rasokart.com"}`} className="text-primary hover:underline">{supportEmail || "support@rasokart.com"}</a>
            </div>
            {supportPhone && (
              <div className="flex gap-3">
                <span className="text-muted-foreground w-24 text-xs">Phone</span>
                <a href={`tel:${supportPhone}`} className="text-muted-foreground hover:text-foreground">{supportPhone}</a>
              </div>
            )}
            <div className="flex gap-3">
              <span className="text-muted-foreground w-24 text-xs">Portal</span>
              <Link href="/contact-us" className="text-primary hover:underline">Contact Form</Link>
            </div>
            <div className="flex gap-3">
              <span className="text-muted-foreground w-24 text-xs">Hours</span>
              <span className="text-muted-foreground">Mon–Sat, 10 AM – 6 PM IST</span>
            </div>
            <div className="flex gap-3">
              <span className="text-muted-foreground w-24 text-xs">SLA</span>
              <span className="font-medium text-foreground">24 business hours response</span>
            </div>
          </div>
          <p className="text-muted-foreground text-xs mt-3">Handles: Payments, account queries, KYC, API issues, refunds, billing</p>
        </div>
      </section>

      {/* Level 2 */}
      <section className="space-y-4">
        <SectionAnchor id="level2" />
        <SectionHeading icon={AlertTriangle} title="Level 2 — Escalated Support" color="text-amber-400" id="level2" />
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-5">
          <div className="flex items-center gap-2 mb-3">
            <ArrowUp className="w-4 h-4 text-amber-400" />
            <span className="text-amber-400 text-xs font-semibold uppercase tracking-wide">When Level 1 unresolved after SLA</span>
          </div>
          <p className="text-muted-foreground text-sm leading-relaxed mb-3">
            If your issue is not resolved within 24–48 business hours at Level 1, reply to your existing support thread and request escalation to a Senior Support Lead.
          </p>
          <div className="space-y-2 text-sm">
            <div className="flex gap-3">
              <span className="text-muted-foreground w-24 text-xs">How</span>
              <span className="text-muted-foreground">Reply to existing ticket and include "ESCALATE" in the subject</span>
            </div>
            <div className="flex gap-3">
              <span className="text-muted-foreground w-24 text-xs">SLA</span>
              <span className="font-medium text-foreground">4 business hours response; resolution within 3 business days</span>
            </div>
          </div>
          <p className="text-muted-foreground text-xs mt-3">Handles: Complex payment disputes, account block reviews, technical escalations requiring developer involvement</p>
        </div>
      </section>

      {/* Level 3 */}
      <section className="space-y-4">
        <SectionAnchor id="level3" />
        <SectionHeading icon={UserCheck} title="Level 3 — Grievance Officer" color="text-violet-400" id="level3" />
        <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-5">
          <div className="flex items-center gap-2 mb-3">
            <ArrowUp className="w-4 h-4 text-violet-400" />
            <span className="text-violet-400 text-xs font-semibold uppercase tracking-wide">When Level 2 unresolved after SLA</span>
          </div>
          <p className="text-muted-foreground text-sm leading-relaxed mb-3">
            If your issue remains unresolved after the Level 2 SLA period, escalate to our designated Grievance Officer. Include all prior correspondence and ticket references.
          </p>
          <div className="space-y-2 text-sm">
            <div className="flex gap-3">
              <span className="text-muted-foreground w-24 text-xs">Email</span>
              <a href="mailto:grievance@rasokart.com" className="text-primary hover:underline">grievance@rasokart.com</a>
            </div>
            <div className="flex gap-3">
              <span className="text-muted-foreground w-24 text-xs">More Info</span>
              <Link href="/grievance-officer" className="text-primary hover:underline">Grievance Officer page</Link>
            </div>
            <div className="flex gap-3">
              <span className="text-muted-foreground w-24 text-xs">SLA</span>
              <span className="font-medium text-foreground">48 hours acknowledgement; 15 business days resolution</span>
            </div>
          </div>
          <p className="text-muted-foreground text-xs mt-3">Handles: All unresolved complaints, account termination disputes, data privacy issues</p>
        </div>
      </section>

      {/* Level 4 */}
      <section className="space-y-4">
        <SectionAnchor id="level4" />
        <SectionHeading icon={Building2} title="Level 4 — Regulatory Escalation" color="text-rose-400" id="level4" />
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-5">
          <div className="flex items-center gap-2 mb-3">
            <ArrowUp className="w-4 h-4 text-rose-400" />
            <span className="text-rose-400 text-xs font-semibold uppercase tracking-wide">External escalation (regulatory authorities)</span>
          </div>
          <p className="text-muted-foreground text-sm leading-relaxed mb-3">
            If you are not satisfied with the outcome from Level 3, you have the right to escalate to external regulatory bodies. RasoKart fully cooperates with all regulatory inquiries.
          </p>
          <ul className="space-y-2">
            {[
              { title: "RBI Ombudsman for Digital Transactions", detail: "For payment and digital transaction disputes — cms.rbi.org.in", href: "https://cms.rbi.org.in" },
              { title: "Consumer Disputes Redressal Commission", detail: "For consumer complaints — consumerhelpline.gov.in", href: "https://consumerhelpline.gov.in" },
              { title: "CERT-In", detail: "For cybersecurity incidents — cert-in.org.in", href: "https://www.cert-in.org.in" },
              { title: "National Cyber Crime Reporting Portal", detail: "For cybercrime complaints — cybercrime.gov.in", href: "https://cybercrime.gov.in" },
            ].map(({ title, detail, href }) => (
              <li key={title} className="flex gap-2 text-sm">
                <span className="text-primary/60 shrink-0">›</span>
                <span>
                  <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-foreground hover:text-primary transition-colors">{title}</a>
                  <span className="text-muted-foreground"> — {detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Timelines Summary */}
      <section className="space-y-4">
        <SectionAnchor id="timelines" />
        <SectionHeading icon={Clock} title="Escalation Timelines" color="text-blue-400" id="timelines" />
        <div className="rounded-xl border border-border/60 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60 bg-card/60">
                <th className="text-left py-3 px-4 font-medium text-foreground text-xs">Level</th>
                <th className="text-left py-3 px-4 font-medium text-foreground text-xs">First Response</th>
                <th className="text-left py-3 px-4 font-medium text-foreground text-xs">Target Resolution</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {[
                ["Level 1 — Standard Support", "24 business hours", "2–5 business days"],
                ["Level 2 — Escalated Support", "4 business hours", "3 business days"],
                ["Level 3 — Grievance Officer", "48 hours", "15 business days"],
                ["Level 4 — Regulatory", "Per regulator SLA", "Per regulator SLA"],
              ].map(([level, response, resolution]) => (
                <tr key={level} className="hover:bg-card/40 transition-colors">
                  <td className="py-3 px-4 text-xs font-medium text-foreground">{level}</td>
                  <td className="py-3 px-4 text-xs text-muted-foreground">{response}</td>
                  <td className="py-3 px-4 text-xs text-muted-foreground">{resolution}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-muted-foreground text-sm leading-relaxed">
          For full SLA details, see our <Link href="/sla-support-timelines" className="text-primary hover:underline">SLA & Support Timelines page</Link>.
        </p>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="governing-law" />
        <SectionHeading icon={Scale} title="Governing Law" color="text-indigo-400" id="governing-law" />
        <p className="text-muted-foreground text-sm leading-relaxed">
          This escalation framework is maintained in accordance with the Consumer Protection Act 2019, the Information Technology Act 2000, and applicable RBI circulars. Disputes are subject to the jurisdiction of courts in Jaipur, Rajasthan, India.
        </p>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="contact" />
        <SectionHeading icon={Mail} title="Contact" color="text-teal-400" id="contact" />
        <div className="rounded-xl border border-border/60 bg-card/40 p-4 space-y-2 text-sm">
          <p><span className="text-muted-foreground">L1/L2 Support: </span><a href={`mailto:${supportEmail || "support@rasokart.com"}`} className="text-primary hover:underline">{supportEmail || "support@rasokart.com"}</a></p>
          <p><span className="text-muted-foreground">L3 Grievance: </span><a href="mailto:grievance@rasokart.com" className="text-primary hover:underline">grievance@rasokart.com</a></p>
          <p><span className="text-muted-foreground">Related: </span>
            <Link href="/grievance-officer" className="text-primary hover:underline">Grievance Officer</Link> ·{" "}
            <Link href="/grievance-redressal-policy" className="text-primary hover:underline">Grievance Redressal Policy</Link> ·{" "}
            <Link href="/support-center" className="text-primary hover:underline">Support Center</Link>
          </p>
        </div>
      </section>
    </LegalLayout>
  );
}
