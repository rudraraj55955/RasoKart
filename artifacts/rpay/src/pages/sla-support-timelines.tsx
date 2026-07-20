import { useEffect } from "react";
import { Link } from "wouter";
import LegalLayout, {
  Bullet, InfoBox, SectionAnchor, SectionHeading, type LegalSection,
} from "@/components/layout/legal-layout";
import { useCompanySettings } from "@/lib/company-settings";
import {
  Clock, CheckCircle, AlertTriangle, Phone, FileText, Scale, Settings, Star, Ban,
} from "lucide-react";

const LAST_UPDATED = "20 July 2026";

const sections: LegalSection[] = [
  { id: "overview", icon: FileText, title: "Overview", color: "text-cyan-400" },
  { id: "business-hours", icon: Clock, title: "Business Hours", color: "text-violet-400" },
  { id: "priority-levels", icon: Star, title: "Priority Levels", color: "text-amber-400" },
  { id: "response-times", icon: CheckCircle, title: "Response & Resolution Times", color: "text-emerald-400" },
  { id: "plan-differences", icon: Settings, title: "Plan-Based SLA Differences", color: "text-blue-400" },
  { id: "exclusions", icon: Ban, title: "Exclusions & Force Majeure", color: "text-rose-400" },
  { id: "measurement", icon: AlertTriangle, title: "SLA Measurement", color: "text-orange-400" },
  { id: "governing-law", icon: Scale, title: "Governing Law", color: "text-indigo-400" },
  { id: "contact", icon: Phone, title: "Contact", color: "text-teal-400" },
];

export default function SlaSupportTimelines() {
  const { companyName, supportEmail, supportPhone } = useCompanySettings();

  useEffect(() => {
    document.title = "SLA & Support Timelines — RasoKart";
  }, []);

  return (
    <LegalLayout
      title="SLA & Support Timelines"
      lastUpdated={LAST_UPDATED}
      badgeText="Support Policy"
      sections={sections}
      intro={
        <p className="text-muted-foreground leading-relaxed max-w-2xl mt-3">
          This document describes the service level agreements (SLAs) and support response timelines that <strong className="text-foreground">{companyName}</strong> ("RasoKart") commits to for all merchant and customer support interactions. These timelines apply unless otherwise specified in a separate written agreement.
        </p>
      }
    >
      <section className="space-y-4">
        <SectionAnchor id="overview" />
        <SectionHeading icon={FileText} title="Overview" color="text-cyan-400" id="overview" />
        <p className="text-muted-foreground text-sm leading-relaxed">
          RasoKart is committed to providing timely, effective support for all merchants and users. Our support SLAs are structured around issue priority, with the most critical payment and security issues receiving the fastest response. All SLAs are measured in business hours unless otherwise specified.
        </p>
        <InfoBox>
          SLA clock starts when a ticket is submitted and acknowledged by our support system, not when you first attempt to contact us. Ensure your contact information is accurate for faster follow-up.
        </InfoBox>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="business-hours" />
        <SectionHeading icon={Clock} title="Business Hours" color="text-violet-400" id="business-hours" />
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-muted-foreground border-collapse">
            <thead>
              <tr className="border-b border-border/60">
                <th className="text-left py-2 pr-4 font-medium text-foreground">Channel</th>
                <th className="text-left py-2 pr-4 font-medium text-foreground">Hours</th>
                <th className="text-left py-2 font-medium text-foreground">Days</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {[
                ["Email Support", "9 AM – 7 PM IST", "Monday – Saturday"],
                ["Phone Support", "10 AM – 6 PM IST", "Monday – Saturday"],
                ["Critical Incident Response", "24/7", "365 days"],
                ["Portal Ticket Submission", "24/7 (response during business hours)", "365 days"],
              ].map(([channel, hours, days]) => (
                <tr key={channel}>
                  <td className="py-2 pr-4 font-medium text-foreground">{channel}</td>
                  <td className="py-2 pr-4">{hours}</td>
                  <td className="py-2">{days}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-muted-foreground text-sm leading-relaxed">
          National public holidays in India (Rajasthan) are excluded from business hours for standard support. Critical payment outage response is available 24/7/365.
        </p>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="priority-levels" />
        <SectionHeading icon={Star} title="Priority Levels" color="text-amber-400" id="priority-levels" />
        <div className="space-y-3">
          {[
            {
              level: "P1 — Critical", color: "border-red-500/20 bg-red-500/5", badge: "text-red-400",
              desc: "Complete payment processing outage affecting multiple merchants; active security breach or fraud incident; funds missing or incorrectly debited at scale.",
              examples: ["Payment gateway down", "Mass payout failure", "Active fraud / unauthorized access"],
            },
            {
              level: "P2 — High", color: "border-amber-500/20 bg-amber-500/5", badge: "text-amber-400",
              desc: "Single merchant account suspended unexpectedly; payout stuck for >24 hours; API authentication errors; KYC verification blocking a high-value merchant.",
              examples: ["Account suspended", "Single payout stuck >24h", "API auth broken"],
            },
            {
              level: "P3 — Medium", color: "border-blue-500/20 bg-blue-500/5", badge: "text-blue-400",
              desc: "General account queries, billing questions, refund processing delays within normal timeframes, webhook configuration issues.",
              examples: ["Billing query", "Refund status", "Webhook config"],
            },
            {
              level: "P4 — Low", color: "border-border/40 bg-card/20", badge: "text-muted-foreground",
              desc: "Documentation requests, feature enquiries, general feedback, non-urgent configuration questions.",
              examples: ["Feature request", "Documentation", "General query"],
            },
          ].map(({ level, color, badge, desc, examples }) => (
            <div key={level} className={`rounded-xl border p-4 ${color}`}>
              <div className="flex items-center gap-2 mb-2">
                <span className={`text-xs font-semibold ${badge}`}>{level}</span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed mb-2">{desc}</p>
              <div className="flex flex-wrap gap-2">
                {examples.map(ex => (
                  <span key={ex} className="text-xs bg-card/60 border border-border/40 px-2 py-0.5 rounded">{ex}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="response-times" />
        <SectionHeading icon={CheckCircle} title="Response & Resolution Times" color="text-emerald-400" id="response-times" />
        <div className="rounded-xl border border-border/60 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60 bg-card/60">
                <th className="text-left py-3 px-4 font-medium text-foreground text-xs">Priority</th>
                <th className="text-left py-3 px-4 font-medium text-foreground text-xs">First Response</th>
                <th className="text-left py-3 px-4 font-medium text-foreground text-xs">Target Resolution</th>
                <th className="text-left py-3 px-4 font-medium text-foreground text-xs">Communication</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {[
                ["P1 — Critical", "2 hours (24/7)", "Same day", "Every 2 hours until resolved"],
                ["P2 — High", "4 business hours", "1–2 business days", "Daily updates"],
                ["P3 — Medium", "24 business hours", "3–5 business days", "On update or resolution"],
                ["P4 — Low", "2 business days", "7 business days", "On resolution"],
                ["Grievance Escalation (L3)", "48 hours", "15 business days", "On key milestones"],
              ].map(([priority, response, resolution, comms]) => (
                <tr key={priority} className="hover:bg-card/40 transition-colors">
                  <td className="py-3 px-4 text-xs font-medium text-foreground">{priority}</td>
                  <td className="py-3 px-4 text-xs text-muted-foreground">{response}</td>
                  <td className="py-3 px-4 text-xs text-muted-foreground">{resolution}</td>
                  <td className="py-3 px-4 text-xs text-muted-foreground">{comms}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="plan-differences" />
        <SectionHeading icon={Settings} title="Plan-Based SLA Differences" color="text-blue-400" id="plan-differences" />
        <p className="text-muted-foreground text-sm leading-relaxed">
          Merchants on higher-tier plans receive priority handling within the same support queue:
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60 bg-card/60">
                <th className="text-left py-3 px-4 font-medium text-foreground text-xs">Plan</th>
                <th className="text-left py-3 px-4 font-medium text-foreground text-xs">P3 Response</th>
                <th className="text-left py-3 px-4 font-medium text-foreground text-xs">Dedicated Support</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {[
                ["Starter (Free)", "Standard SLA", "No"],
                ["Silver", "Standard SLA", "No"],
                ["Gold", "Priority queue (12 business hours)", "Email priority"],
                ["Platinum", "Priority queue (8 business hours)", "Email priority + WhatsApp"],
                ["Enterprise / Custom", "SLA as per agreement", "Dedicated account manager"],
              ].map(([plan, response, dedicated]) => (
                <tr key={plan} className="hover:bg-card/40 transition-colors">
                  <td className="py-3 px-4 text-xs font-medium text-foreground">{plan}</td>
                  <td className="py-3 px-4 text-xs text-muted-foreground">{response}</td>
                  <td className="py-3 px-4 text-xs text-muted-foreground">{dedicated}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-muted-foreground text-sm leading-relaxed">
          For plan details and upgrade options, see our <Link href="/pricing-fees-settlement-policy" className="text-primary hover:underline">Pricing & Fees Policy</Link>.
        </p>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="exclusions" />
        <SectionHeading icon={Ban} title="Exclusions & Force Majeure" color="text-rose-400" id="exclusions" />
        <p className="text-muted-foreground text-sm leading-relaxed">SLA timelines are suspended or not applicable in the following circumstances:</p>
        <ul className="space-y-2">
          {[
            "Incidents caused by third-party payment providers, banks, NPCI, or the UPI network",
            "Force majeure events — natural disasters, government orders, power outages, or internet infrastructure failures",
            "Issues caused by the merchant's own system configuration or code",
            "Scheduled maintenance windows (communicated at least 24 hours in advance)",
            "Holidays listed in the standard Indian national holiday calendar (for standard support)",
            "Cases where the merchant has not provided the required information to investigate the issue",
          ].map(item => <Bullet key={item}>{item}</Bullet>)}
        </ul>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="measurement" />
        <SectionHeading icon={AlertTriangle} title="SLA Measurement" color="text-orange-400" id="measurement" />
        <ul className="space-y-2">
          {[
            "SLA clock starts when the support ticket is received and acknowledged by our system (not when submitted by email if the mailbox is queued)",
            "Resolution is defined as the issue being fixed and confirmed by our team — customer sign-off is not required to close the SLA clock",
            "If a customer does not respond to our requests for information within 48 hours, the SLA is paused",
            "SLA reports are available on request for Enterprise and Custom plan merchants",
          ].map(item => <Bullet key={item}>{item}</Bullet>)}
        </ul>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="governing-law" />
        <SectionHeading icon={Scale} title="Governing Law" color="text-indigo-400" id="governing-law" />
        <p className="text-muted-foreground text-sm leading-relaxed">
          This SLA policy is governed by the laws of India and is subject to the general terms of the Merchant Agreement. Disputes are subject to the jurisdiction of courts in Jaipur, Rajasthan, India.
        </p>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="contact" />
        <SectionHeading icon={Phone} title="Contact" color="text-teal-400" id="contact" />
        <div className="rounded-xl border border-border/60 bg-card/40 p-4 space-y-2 text-sm">
          <p><span className="text-muted-foreground">Support: </span><a href={`mailto:${supportEmail || "support@rasokart.com"}`} className="text-primary hover:underline">{supportEmail || "support@rasokart.com"}</a></p>
          {supportPhone && <p><span className="text-muted-foreground">Phone: </span><a href={`tel:${supportPhone}`} className="text-primary hover:underline">{supportPhone}</a></p>}
          <p><span className="text-muted-foreground">Related: </span>
            <Link href="/escalation-matrix" className="text-primary hover:underline">Escalation Matrix</Link> ·{" "}
            <Link href="/grievance-officer" className="text-primary hover:underline">Grievance Officer</Link> ·{" "}
            <Link href="/support-center" className="text-primary hover:underline">Support Center</Link>
          </p>
        </div>
      </section>
    </LegalLayout>
  );
}
