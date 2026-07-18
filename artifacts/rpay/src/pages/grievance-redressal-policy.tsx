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
  Phone,
  Clock,
  Scale,
  AlertTriangle,
  Shield,
  ArrowUp,
  BookOpen,
  Building,
} from "lucide-react";

const LAST_UPDATED = "16 July 2026";
const CIN = "U47820RJ2025PTC109583";

const sections: LegalSection[] = [
  { id: "overview", icon: FileText, title: "Overview", color: "text-cyan-400" },
  { id: "who-can-file", icon: UserCheck, title: "Who Can File a Grievance", color: "text-violet-400" },
  { id: "types", icon: BookOpen, title: "Types of Grievances", color: "text-blue-400" },
  { id: "how-to-file", icon: Phone, title: "How to File a Grievance", color: "text-emerald-400" },
  { id: "officer", icon: UserCheck, title: "Grievance Officer", color: "text-teal-400" },
  { id: "timeline", icon: Clock, title: "Resolution Timeline", color: "text-amber-400" },
  { id: "escalation", icon: ArrowUp, title: "Escalation", color: "text-orange-400" },
  { id: "regulatory", icon: Building, title: "Regulatory Contacts", color: "text-indigo-400" },
  { id: "rights", icon: Scale, title: "Your Rights", color: "text-pink-400" },
  { id: "contact", icon: Phone, title: "Contact Us", color: "text-teal-400" },
];

export default function GrievanceRedressalPolicy() {
  const { companyName, supportPhone, supportEmail, grievanceOfficerName } = useCompanySettings();

  return (
    <LegalLayout
      title="Grievance Redressal Policy"
      lastUpdated={LAST_UPDATED}
      badgeText="Grievance Policy"
      sections={sections}
      intro={
        <p className="text-muted-foreground leading-relaxed max-w-2xl mt-3">
          <strong className="text-foreground">{companyName}</strong> ("RasoKart") is committed to
          addressing merchant and customer grievances promptly and fairly. This policy sets out the
          mechanism for filing, escalating, and resolving grievances in accordance with applicable law.
        </p>
      }
    >
      {/* 1. Overview */}
      <section>
        <SectionAnchor id="overview" />
        <SectionHeading icon={FileText} title="1. Overview" color="text-cyan-400" id="overview" />
        <p className="text-muted-foreground text-sm leading-relaxed mb-4">
          We believe in fair, transparent, and timely resolution of all grievances raised by merchants,
          users, and customers in connection with our Platform. This Grievance Redressal Policy is established
          in accordance with applicable Indian laws and our own commitment to high service standards.
        </p>
        <InfoBox variant="success">
          We aim to acknowledge every grievance within 48 hours and resolve it within 30 days of receipt.
          Complex cases may require additional time, in which case we will keep you informed of progress.
        </InfoBox>
      </section>

      {/* 2. Who Can File */}
      <section>
        <SectionAnchor id="who-can-file" />
        <SectionHeading icon={UserCheck} title="2. Who Can File a Grievance" color="text-violet-400" id="who-can-file" />
        <p className="text-muted-foreground text-sm mb-4 leading-relaxed">
          Any of the following parties may file a grievance with us:
        </p>
        <ul className="space-y-2">
          <Bullet>Registered merchants on the RasoKart platform</Bullet>
          <Bullet>End customers of merchants who have transacted through the Platform</Bullet>
          <Bullet>Authorised representatives of the above</Bullet>
          <Bullet>Any individual whose personal data is processed by us in connection with our services</Bullet>
        </ul>
      </section>

      {/* 3. Types of Grievances */}
      <section>
        <SectionAnchor id="types" />
        <SectionHeading icon={BookOpen} title="3. Types of Grievances We Address" color="text-blue-400" id="types" />
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            { title: "Payment & Transaction Issues", desc: "Failed transactions, incorrect deductions, unprocessed refunds, or settlement discrepancies." },
            { title: "Account & KYC Issues", desc: "Account suspension, KYC rejection, incorrect status, or access-related problems." },
            { title: "Service Quality", desc: "Platform downtime, feature unavailability, or unsatisfactory support response." },
            { title: "Billing & Fees", desc: "Incorrect charges, disputed fee deductions, or billing errors." },
            { title: "Data & Privacy", desc: "Concerns about handling of personal data, data accuracy, or data access requests." },
            { title: "Policy Disputes", desc: "Disagreement with a decision made under any of our policies." },
          ].map((t) => (
            <div key={t.title} className="rounded-xl border border-border/50 bg-card/40 p-4">
              <p className="text-sm font-semibold text-foreground mb-1">{t.title}</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{t.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 4. How to File */}
      <section>
        <SectionAnchor id="how-to-file" />
        <SectionHeading icon={Phone} title="4. How to File a Grievance" color="text-emerald-400" id="how-to-file" />
        <p className="text-muted-foreground text-sm mb-4 leading-relaxed">
          You may file a grievance through any of the following channels:
        </p>
        <div className="space-y-3 mb-4">
          {[
            {
              channel: "Online Form",
              detail: "Submit via our Contact Us page with category 'Grievance'.",
              link: "/contact-us",
              linkLabel: "Go to Contact Us",
            },
            {
              channel: "Email",
              detail: supportEmail || "Email our support team with 'Grievance' in the subject line.",
              link: supportEmail ? `mailto:${supportEmail}` : null,
              linkLabel: "Email us",
            },
            {
              channel: "Phone",
              detail: supportPhone
                ? `Call us at ${supportPhone} during business hours (Mon–Sat, 10 AM – 6 PM IST).`
                : "Call our support number during business hours (Mon–Sat, 10 AM – 6 PM IST).",
              link: supportPhone ? `tel:${supportPhone}` : null,
              linkLabel: "Call now",
            },
            {
              channel: "Written Correspondence",
              detail: "Write to our registered office address (see contact section below).",
              link: null,
              linkLabel: null,
            },
          ].map((c) => (
            <div key={c.channel} className="flex gap-4 rounded-xl border border-border/50 bg-card/40 p-4">
              <div className="w-2 h-2 rounded-full bg-primary/60 shrink-0 mt-2" />
              <div>
                <p className="text-sm font-semibold text-foreground mb-0.5">{c.channel}</p>
                <p className="text-xs text-muted-foreground leading-relaxed">{c.detail}</p>
                {c.link && c.linkLabel && (
                  <a href={c.link} className="text-xs text-primary hover:underline mt-1 block">
                    {c.linkLabel} →
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
        <InfoBox>
          When filing a grievance, please include: your registered email address, merchant ID (if applicable),
          the nature of your grievance, relevant transaction or reference IDs, and any supporting
          documentation.
        </InfoBox>
      </section>

      {/* 5. Grievance Officer */}
      <section>
        <SectionAnchor id="officer" />
        <SectionHeading icon={UserCheck} title="5. Grievance Officer" color="text-teal-400" id="officer" />
        <div className="rounded-xl border border-teal-500/20 bg-teal-500/5 p-5">
          <div className="flex items-start gap-3">
            <UserCheck className="w-5 h-5 text-teal-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-foreground mb-1">Designated Grievance Officer</p>
              {grievanceOfficerName ? (
                <p className="text-sm text-muted-foreground mb-2">{grievanceOfficerName}</p>
              ) : (
                <p className="text-sm text-muted-foreground mb-2">Grievance Officer, {companyName}</p>
              )}
              <p className="text-sm text-muted-foreground">
                {companyName}
                <br />
                CIN: {CIN}
                <br />
                P. No. B-46, Damodar Vila, Agarsen Nagar, Kalwad Road, Jhotwara, Jaipur – 302012, Rajasthan
              </p>
              {supportEmail && (
                <a
                  href={`mailto:${supportEmail}`}
                  className="text-sm text-primary hover:underline block mt-2"
                >
                  {supportEmail}
                </a>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* 6. Timeline */}
      <section>
        <SectionAnchor id="timeline" />
        <SectionHeading icon={Clock} title="6. Grievance Resolution Timeline" color="text-amber-400" id="timeline" />
        <div className="space-y-3">
          {[
            { milestone: "Acknowledgement", timing: "Within 48 hours", desc: "We will acknowledge receipt of your grievance and provide a reference number." },
            { milestone: "Initial Response", timing: "Within 5 business days", desc: "We will provide an initial update on the status of your grievance and the expected resolution timeline." },
            { milestone: "Resolution", timing: "Within 30 days", desc: "We aim to fully resolve most grievances within 30 days of receipt. Complex cases may take longer and you will be kept informed." },
            { milestone: "Final Communication", timing: "Within 30 days", desc: "A final response letter or email communicating the outcome and any remedial action taken." },
          ].map((m) => (
            <div key={m.milestone} className="flex gap-4 rounded-xl border border-border/50 bg-card/40 p-4">
              <div className="shrink-0">
                <p className="text-xs font-semibold text-amber-400">{m.timing}</p>
              </div>
              <div className="border-l border-border/60 pl-4">
                <p className="text-sm font-semibold text-foreground mb-0.5">{m.milestone}</p>
                <p className="text-xs text-muted-foreground leading-relaxed">{m.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 7. Escalation */}
      <section>
        <SectionAnchor id="escalation" />
        <SectionHeading icon={ArrowUp} title="7. Escalation" color="text-orange-400" id="escalation" />
        <p className="text-muted-foreground text-sm mb-4 leading-relaxed">
          If you are not satisfied with the resolution provided at the initial level, or if your grievance
          has not been resolved within 30 days, you may:
        </p>
        <ul className="space-y-2 mb-4">
          <Bullet>Request escalation of your grievance to senior management by clearly stating your dissatisfaction and reference number in your response</Bullet>
          <Bullet>Write directly to the Grievance Officer at the address provided above</Bullet>
          <Bullet>Approach appropriate consumer forums or regulatory bodies as described in the Regulatory Contacts section below</Bullet>
        </ul>
      </section>

      {/* 8. Regulatory */}
      <section>
        <SectionAnchor id="regulatory" />
        <SectionHeading icon={Building} title="8. Regulatory Contacts" color="text-indigo-400" id="regulatory" />
        <p className="text-muted-foreground text-sm mb-4 leading-relaxed">
          If your grievance remains unresolved through our internal process, you may contact the following
          regulatory or consumer protection bodies:
        </p>
        <div className="space-y-3">
          <div className="rounded-xl border border-border/50 bg-card/40 p-4">
            <p className="text-sm font-semibold text-foreground mb-1">National Consumer Disputes Redressal Commission (NCDRC)</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              For consumer disputes:{" "}
              <a
                href="https://edaakhil.nic.in"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                edaakhil.nic.in
              </a>
            </p>
          </div>
          <div className="rounded-xl border border-border/50 bg-card/40 p-4">
            <p className="text-sm font-semibold text-foreground mb-1">Reserve Bank of India (RBI)</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              For payment-related complaints:{" "}
              <a
                href="https://cms.rbi.org.in"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                cms.rbi.org.in
              </a>
            </p>
          </div>
          <div className="rounded-xl border border-border/50 bg-card/40 p-4">
            <p className="text-sm font-semibold text-foreground mb-1">Cyber Crime Portal</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              For suspected fraud or cybercrime:{" "}
              <a
                href="https://cybercrime.gov.in"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                cybercrime.gov.in
              </a>{" "}
              or call 1930.
            </p>
          </div>
        </div>
      </section>

      {/* 9. Rights */}
      <section>
        <SectionAnchor id="rights" />
        <SectionHeading icon={Scale} title="9. Your Rights Under This Policy" color="text-pink-400" id="rights" />
        <ul className="space-y-2">
          <Bullet>The right to file a grievance without prejudice to any other legal remedy available to you</Bullet>
          <Bullet>The right to receive a timely acknowledgement and response</Bullet>
          <Bullet>The right to escalate an unresolved or unsatisfactorily resolved grievance</Bullet>
          <Bullet>The right to be treated fairly, with dignity, and without discrimination throughout the grievance process</Bullet>
          <Bullet>The right to receive a final written communication explaining the outcome and reasoning</Bullet>
        </ul>
      </section>

      {/* 10. Contact */}
      <section>
        <SectionAnchor id="contact" />
        <SectionHeading icon={Phone} title="10. Contact Us" color="text-teal-400" id="contact" />
        <div className="rounded-xl border border-border/50 bg-card/40 p-5 space-y-2">
          <p className="text-sm font-semibold text-foreground">{companyName}</p>
          <p className="text-sm text-muted-foreground">CIN: {CIN}</p>
          <p className="text-sm text-muted-foreground">
            P. No. B-46, Damodar Vila, Agarsen Nagar, Kalwad Road, Jhotwara, Jaipur – 302012, Rajasthan
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
          <Link href="/contact-us" className="block text-sm text-primary hover:underline pt-1">
            Submit online via Contact Us →
          </Link>
        </div>
      </section>
    </LegalLayout>
  );
}
