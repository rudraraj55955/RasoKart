import { useEffect } from "react";
import { Link } from "wouter";
import LegalLayout, {
  Bullet, InfoBox, SectionAnchor, SectionHeading, type LegalSection,
} from "@/components/layout/legal-layout";
import { useCompanySettings } from "@/lib/company-settings";
import {
  Search, Shield, FileText, AlertTriangle, CheckCircle, Ban, Award, Phone, Scale, Eye,
} from "lucide-react";

const LAST_UPDATED = "20 July 2026";

const sections: LegalSection[] = [
  { id: "overview", icon: FileText, title: "Overview", color: "text-cyan-400" },
  { id: "scope", icon: Eye, title: "Scope", color: "text-violet-400" },
  { id: "how-to-report", icon: Search, title: "How to Report", color: "text-blue-400" },
  { id: "what-to-expect", icon: CheckCircle, title: "What to Expect", color: "text-emerald-400" },
  { id: "rules", icon: Shield, title: "Rules of Engagement", color: "text-amber-400" },
  { id: "out-of-scope", icon: Ban, title: "Out of Scope", color: "text-rose-400" },
  { id: "legal-safe-harbour", icon: Scale, title: "Legal Safe Harbour", color: "text-indigo-400" },
  { id: "recognition", icon: Award, title: "Recognition", color: "text-orange-400" },
  { id: "contact", icon: Phone, title: "Contact", color: "text-teal-400" },
];

export default function ResponsibleDisclosure() {
  const { companyName, supportEmail } = useCompanySettings();
  const securityEmail = "security@rasokart.com";

  useEffect(() => {
    document.title = "Responsible Disclosure Policy — RasoKart";
  }, []);

  return (
    <LegalLayout
      title="Responsible Disclosure Policy"
      lastUpdated={LAST_UPDATED}
      badgeText="Security Policy"
      sections={sections}
      intro={
        <p className="text-muted-foreground leading-relaxed max-w-2xl mt-3">
          <strong className="text-foreground">{companyName}</strong> ("RasoKart") is committed to maintaining the security of our platform and the data entrusted to us. We welcome responsible security research and disclosure. This policy describes how to report a vulnerability and what you can expect from us in response.
        </p>
      }
    >
      <section className="space-y-4">
        <SectionAnchor id="overview" />
        <SectionHeading icon={FileText} title="Overview" color="text-cyan-400" id="overview" />
        <p className="text-muted-foreground text-sm leading-relaxed">
          Security researchers who discover vulnerabilities in RasoKart's systems play a vital role in keeping our platform and our merchants safe. We ask that you disclose vulnerabilities to us privately and in good faith so we can investigate and remediate before any public disclosure. In return, we commit to responding promptly and treating researchers fairly.
        </p>
        <InfoBox variant="success">
          We will not pursue legal action against researchers who act in good faith and follow the guidelines in this policy.
        </InfoBox>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="scope" />
        <SectionHeading icon={Eye} title="Scope" color="text-violet-400" id="scope" />
        <p className="text-muted-foreground text-sm leading-relaxed">The following systems are in scope for security research:</p>
        <ul className="space-y-2">
          {[
            "rasokart.com and all subdomains (admin.rasokart.com, merchant.rasokart.com, agent.rasokart.com, etc.)",
            "RasoKart REST API (api.rasokart.com / rasokart.com/api)",
            "Merchant dashboard web application",
            "Admin portal",
            "Payout merchant and agent portals",
            "Mobile-responsive web interfaces",
            "Payment processing and webhook endpoints",
          ].map(item => <Bullet key={item}>{item}</Bullet>)}
        </ul>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="how-to-report" />
        <SectionHeading icon={Search} title="How to Report" color="text-blue-400" id="how-to-report" />
        <p className="text-muted-foreground text-sm leading-relaxed">Please send all vulnerability reports by email to:</p>
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm">
          <p className="font-medium mb-1">Security Team</p>
          <a href={`mailto:${securityEmail}`} className="text-primary hover:underline text-lg font-mono">{securityEmail}</a>
        </div>
        <p className="text-muted-foreground text-sm leading-relaxed">Your report should include:</p>
        <ul className="space-y-2">
          {[
            "A clear description of the vulnerability and its potential impact",
            "The affected URL, endpoint, or component",
            "Step-by-step reproduction instructions (proof of concept)",
            "Any screenshots, HTTP request/response captures, or code snippets that help illustrate the issue",
            "Your name and contact email for follow-up (anonymous reports are accepted but limit our ability to communicate back)",
          ].map(item => <Bullet key={item}>{item}</Bullet>)}
        </ul>
        <InfoBox>
          Please encrypt sensitive vulnerability details using our PGP public key if you are concerned about the confidentiality of your submission. Contact <a href={`mailto:${securityEmail}`} className="text-primary hover:underline">{securityEmail}</a> to request our public key.
        </InfoBox>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="what-to-expect" />
        <SectionHeading icon={CheckCircle} title="What to Expect" color="text-emerald-400" id="what-to-expect" />
        <p className="text-muted-foreground text-sm leading-relaxed">When you submit a valid security report, we commit to:</p>
        <ul className="space-y-2">
          {[
            "Acknowledge receipt of your report within 2 business days",
            "Provide an initial assessment of the vulnerability's severity within 5 business days",
            "Keep you updated on the progress of remediation at regular intervals",
            "Notify you when the vulnerability has been fixed",
            "Aim to resolve critical vulnerabilities within 7 days and high-severity vulnerabilities within 30 days",
            "Coordinate with you on public disclosure timing if you wish to publish a write-up",
          ].map(item => <Bullet key={item}>{item}</Bullet>)}
        </ul>
        <div className="overflow-x-auto mt-2">
          <table className="w-full text-xs text-muted-foreground border-collapse">
            <thead>
              <tr className="border-b border-border/60">
                <th className="text-left py-2 pr-4 font-medium text-foreground">Severity</th>
                <th className="text-left py-2 pr-4 font-medium text-foreground">Acknowledgement</th>
                <th className="text-left py-2 font-medium text-foreground">Target Resolution</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {[
                ["Critical", "Within 24 hours", "7 days"],
                ["High", "Within 2 business days", "30 days"],
                ["Medium", "Within 2 business days", "60 days"],
                ["Low / Informational", "Within 5 business days", "90 days"],
              ].map(([sev, ack, res]) => (
                <tr key={sev}>
                  <td className="py-2 pr-4 font-medium text-foreground">{sev}</td>
                  <td className="py-2 pr-4">{ack}</td>
                  <td className="py-2">{res}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="rules" />
        <SectionHeading icon={Shield} title="Rules of Engagement" color="text-amber-400" id="rules" />
        <p className="text-muted-foreground text-sm leading-relaxed">To qualify for safe harbour, you must:</p>
        <ul className="space-y-2">
          {[
            "Test only on accounts you own or have explicit permission to test",
            "Not access, modify, or delete data belonging to any merchant, customer, or RasoKart",
            "Not perform any attack that could degrade or disrupt the availability of our services (no DoS/DDoS)",
            "Not use automated high-volume scanning tools without prior written consent",
            "Not escalate privileges beyond what is necessary to demonstrate the vulnerability",
            "Not exploit the vulnerability for any purpose other than to demonstrate it to our security team",
            "Disclose the vulnerability to us privately before any public disclosure",
            "Allow us a reasonable time to remediate before disclosing to third parties",
          ].map(item => <Bullet key={item}>{item}</Bullet>)}
        </ul>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="out-of-scope" />
        <SectionHeading icon={Ban} title="Out of Scope" color="text-rose-400" id="out-of-scope" />
        <p className="text-muted-foreground text-sm leading-relaxed">The following are out of scope and will not be considered eligible reports:</p>
        <ul className="space-y-2">
          {[
            "Social engineering attacks against RasoKart employees or contractors",
            "Physical security issues (tailgating, office access)",
            "Vulnerabilities in third-party services or libraries that are not exploitable in the context of RasoKart",
            "Self-XSS and issues requiring unlikely user interaction or a compromised device",
            "Clickjacking on pages with no sensitive actions",
            "Missing security headers or cookie flags without demonstrated impact",
            "Rate limiting on non-critical endpoints (login rate limiting is in scope)",
            "Automated scanner output without demonstrated exploitability",
            "Denial of service via resource exhaustion using your own account",
          ].map(item => <Bullet key={item}>{item}</Bullet>)}
        </ul>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="legal-safe-harbour" />
        <SectionHeading icon={Scale} title="Legal Safe Harbour" color="text-indigo-400" id="legal-safe-harbour" />
        <p className="text-muted-foreground text-sm leading-relaxed">
          RasoKart will not pursue civil or criminal legal action against researchers who discover and report security vulnerabilities in good faith and in accordance with this policy. We consider responsible security research to be a lawful and beneficial activity. This safe harbour applies only to activities conducted strictly within the scope and rules defined in this policy.
        </p>
        <InfoBox variant="warning">
          If you engage in activities that exceed the scope of this policy — such as accessing customer data, disrupting services, or extorting payment — you will not be eligible for safe harbour and may face legal consequences.
        </InfoBox>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="recognition" />
        <SectionHeading icon={Award} title="Recognition" color="text-orange-400" id="recognition" />
        <p className="text-muted-foreground text-sm leading-relaxed">
          We genuinely appreciate the work of security researchers who help keep RasoKart secure. For valid, in-scope vulnerability reports we:
        </p>
        <ul className="space-y-2">
          {[
            "Acknowledge your contribution in our security hall of fame (with your permission)",
            "Provide a letter of acknowledgement for your records",
            "May offer a token of appreciation for critical or high-severity finds — at our discretion",
          ].map(item => <Bullet key={item}>{item}</Bullet>)}
        </ul>
        <p className="text-muted-foreground text-sm leading-relaxed">
          Note: RasoKart does not currently operate a paid bug bounty programme. All recognition is non-monetary unless separately agreed in writing.
        </p>
      </section>

      <section className="space-y-4">
        <SectionAnchor id="contact" />
        <SectionHeading icon={Phone} title="Contact" color="text-teal-400" id="contact" />
        <div className="rounded-xl border border-border/60 bg-card/40 p-4 space-y-2 text-sm">
          <p><span className="text-muted-foreground">Security Reports: </span><a href={`mailto:${securityEmail}`} className="text-primary hover:underline">{securityEmail}</a></p>
          <p><span className="text-muted-foreground">General Support: </span><a href={`mailto:${supportEmail || "support@rasokart.com"}`} className="text-primary hover:underline">{supportEmail || "support@rasokart.com"}</a></p>
          <p><span className="text-muted-foreground">Related: </span>
            <Link href="/security-policy" className="text-primary hover:underline">Security Policy</Link> ·{" "}
            <Link href="/data-security-policy" className="text-primary hover:underline">Data Security Policy</Link> ·{" "}
            <Link href="/pci-dss-security" className="text-primary hover:underline">PCI DSS & Security</Link>
          </p>
        </div>
      </section>
    </LegalLayout>
  );
}
