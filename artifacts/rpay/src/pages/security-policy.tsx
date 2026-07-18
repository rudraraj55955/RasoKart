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
  Shield,
  Lock,
  AlertTriangle,
  FileText,
  Phone,
  Eye,
  Search,
  Clock,
  Ban,
  CheckCircle,
} from "lucide-react";

const LAST_UPDATED = "16 July 2026";

const sections: LegalSection[] = [
  { id: "overview", icon: FileText, title: "Overview", color: "text-cyan-400" },
  { id: "security-practices", icon: Lock, title: "Our Security Practices", color: "text-violet-400" },
  { id: "account-security", icon: Shield, title: "Account Security", color: "text-emerald-400" },
  { id: "data-security", icon: Eye, title: "Data Security", color: "text-blue-400" },
  { id: "disclosure", icon: Search, title: "Responsible Disclosure", color: "text-amber-400" },
  { id: "scope", icon: CheckCircle, title: "Scope", color: "text-teal-400" },
  { id: "how-to-report", icon: AlertTriangle, title: "How to Report", color: "text-orange-400" },
  { id: "out-of-scope", icon: Ban, title: "Out of Scope", color: "text-red-400" },
  { id: "what-to-expect", icon: Clock, title: "What to Expect", color: "text-indigo-400" },
  { id: "contact", icon: Phone, title: "Contact", color: "text-teal-400" },
];

export default function SecurityPolicy() {
  const { companyName, supportPhone, supportEmail } = useCompanySettings();

  return (
    <LegalLayout
      title="Security & Responsible Disclosure"
      lastUpdated={LAST_UPDATED}
      badgeText="Security Policy"
      sections={sections}
      intro={
        <p className="text-muted-foreground leading-relaxed max-w-2xl mt-3">
          <strong className="text-foreground">{companyName}</strong> ("RasoKart") is committed to maintaining
          the security and integrity of the Platform and the data of all merchants and users. This policy
          describes our security practices and our Responsible Disclosure Programme for reporting
          vulnerabilities.
        </p>
      }
    >
      {/* 1. Overview */}
      <section>
        <SectionAnchor id="overview" />
        <SectionHeading icon={FileText} title="1. Overview" color="text-cyan-400" id="overview" />
        <p className="text-muted-foreground text-sm leading-relaxed">
          The security of our merchants, their customers, and their financial data is our top priority.
          We invest in robust security controls, continuous monitoring, and regular security reviews. We also
          welcome responsible disclosure from security researchers who identify potential vulnerabilities
          in our Platform.
        </p>
      </section>

      {/* 2. Security Practices */}
      <section>
        <SectionAnchor id="security-practices" />
        <SectionHeading icon={Lock} title="2. Our Security Practices" color="text-violet-400" id="security-practices" />
        <div className="grid gap-3 sm:grid-cols-2 mb-4">
          {[
            { title: "Encryption in Transit", desc: "All data transmitted between your browser and our servers is encrypted using TLS 1.2 or higher." },
            { title: "Encryption at Rest", desc: "Sensitive data including personal information and financial records is encrypted at rest." },
            { title: "Access Controls", desc: "Role-based access control (RBAC) limits data access to authorised personnel only. All access is logged and audited." },
            { title: "Security Monitoring", desc: "Continuous 24×7 monitoring for anomalies, intrusion attempts, and suspicious activity." },
            { title: "Regular Audits", desc: "Periodic internal and external security audits of our infrastructure, code, and processes." },
            { title: "Secure Development", desc: "Security-first coding practices, code reviews, and dependency scanning in our development lifecycle." },
          ].map((p) => (
            <div key={p.title} className="rounded-xl border border-border/50 bg-card/40 p-4">
              <p className="text-sm font-semibold text-foreground mb-1">{p.title}</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{p.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 3. Account Security */}
      <section>
        <SectionAnchor id="account-security" />
        <SectionHeading icon={Shield} title="3. Account Security" color="text-emerald-400" id="account-security" />
        <p className="text-muted-foreground text-sm mb-4 leading-relaxed">
          As a merchant, you share responsibility for the security of your account. We recommend:
        </p>
        <ul className="space-y-2 mb-4">
          <Bullet>Use a strong, unique password (minimum 12 characters with a mix of letters, numbers, and symbols)</Bullet>
          <Bullet>Never share your account password, API keys, or webhook secrets with anyone</Bullet>
          <Bullet>Rotate your API keys periodically and immediately if you suspect compromise</Bullet>
          <Bullet>Use IP whitelisting for API access where available in your plan</Bullet>
          <Bullet>Monitor your account activity regularly and report suspicious logins immediately</Bullet>
          <Bullet>Keep your registered email address and phone number up to date for security notifications</Bullet>
          <Bullet>Log out of your dashboard when using shared or public computers</Bullet>
        </ul>
        <InfoBox variant="danger">
          If you suspect your account has been compromised, contact us immediately at{" "}
          {supportPhone ? `+91 ${supportPhone}` : "our support number"}. We will take immediate steps
          to secure your account.
        </InfoBox>
      </section>

      {/* 4. Data Security */}
      <section>
        <SectionAnchor id="data-security" />
        <SectionHeading icon={Eye} title="4. Data Security" color="text-blue-400" id="data-security" />
        <ul className="space-y-2">
          <Bullet>We do not store full card numbers, CVVs, or full bank account credentials on our servers</Bullet>
          <Bullet>Payment card data is handled in compliance with applicable industry security standards</Bullet>
          <Bullet>Personal data is processed and stored in accordance with our Privacy Policy and applicable Indian data protection law</Bullet>
          <Bullet>Data access by employees is on a need-to-know basis and is logged and audited</Bullet>
          <Bullet>We use secure, isolated server infrastructure with firewalls, intrusion detection, and DDoS protection</Bullet>
        </ul>
      </section>

      {/* 5. Disclosure Programme */}
      <section>
        <SectionAnchor id="disclosure" />
        <SectionHeading icon={Search} title="5. Responsible Disclosure Programme" color="text-amber-400" id="disclosure" />
        <p className="text-muted-foreground text-sm leading-relaxed mb-4">
          We welcome the help of security researchers in identifying vulnerabilities in our Platform. If you
          believe you have discovered a security vulnerability, we ask that you report it to us responsibly
          by following the guidelines below. We commit to investigating all genuine reports promptly and
          acknowledging your contribution.
        </p>
        <InfoBox variant="warning">
          We do not currently operate a bug bounty programme with monetary rewards. We do, however,
          publicly acknowledge responsible disclosures (with your permission) and will notify you of the
          outcome of our investigation.
        </InfoBox>
      </section>

      {/* 6. Scope */}
      <section>
        <SectionAnchor id="scope" />
        <SectionHeading icon={CheckCircle} title="6. In-Scope for Responsible Disclosure" color="text-teal-400" id="scope" />
        <p className="text-muted-foreground text-sm mb-3 leading-relaxed">
          The following are in scope for our responsible disclosure programme:
        </p>
        <ul className="space-y-2">
          <Bullet>Authentication and session management vulnerabilities on rasokart.com</Bullet>
          <Bullet>Injection vulnerabilities (SQL injection, command injection, XSS) in the Platform</Bullet>
          <Bullet>Insecure direct object references (IDOR) allowing access to other merchants' data</Bullet>
          <Bullet>API authentication bypasses or privilege escalation vulnerabilities</Bullet>
          <Bullet>Data exposure or leakage affecting merchant or customer data</Bullet>
          <Bullet>CSRF vulnerabilities on critical actions</Bullet>
          <Bullet>Server-side request forgery (SSRF) vulnerabilities</Bullet>
        </ul>
      </section>

      {/* 7. How to Report */}
      <section>
        <SectionAnchor id="how-to-report" />
        <SectionHeading icon={AlertTriangle} title="7. How to Report a Vulnerability" color="text-orange-400" id="how-to-report" />
        <div className="space-y-3 mb-4">
          {[
            { step: "1", title: "Document the vulnerability", desc: "Prepare a clear, detailed description including: the vulnerability type, affected URL or endpoint, steps to reproduce, and potential impact." },
            { step: "2", title: "Email our security team", desc: supportEmail ? `Send your report to ${supportEmail} with the subject: [SECURITY] Vulnerability Report.` : "Send your report to our security email with the subject: [SECURITY] Vulnerability Report." },
            { step: "3", title: "Await acknowledgement", desc: "We will acknowledge receipt within 48 hours and provide a tracking reference." },
            { step: "4", title: "Cooperate with our investigation", desc: "Be available for follow-up questions and do not disclose the vulnerability to others until we have resolved it (see below)." },
          ].map((s) => (
            <div key={s.step} className="flex gap-4 rounded-xl border border-border/50 bg-card/40 p-4">
              <div className="w-7 h-7 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-bold flex items-center justify-center shrink-0">
                {s.step}
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground mb-0.5">{s.title}</p>
                <p className="text-xs text-muted-foreground leading-relaxed">{s.desc}</p>
              </div>
            </div>
          ))}
        </div>
        <InfoBox>
          Please do not attempt to exploit any vulnerability beyond what is strictly necessary to demonstrate
          its existence. Do not access, modify, or delete any data that does not belong to you. Do not
          conduct denial-of-service testing.
        </InfoBox>
      </section>

      {/* 8. Out of Scope */}
      <section>
        <SectionAnchor id="out-of-scope" />
        <SectionHeading icon={Ban} title="8. Out of Scope" color="text-red-400" id="out-of-scope" />
        <p className="text-muted-foreground text-sm mb-3 leading-relaxed">
          The following are NOT in scope for our responsible disclosure programme:
        </p>
        <ul className="space-y-2">
          <Bullet>Denial-of-service (DoS/DDoS) attacks or testing</Bullet>
          <Bullet>Social engineering, phishing, or vishing attacks against our staff</Bullet>
          <Bullet>Physical security issues</Bullet>
          <Bullet>Vulnerabilities in third-party services we use (report those to the third party directly)</Bullet>
          <Bullet>Theoretical vulnerabilities with no demonstrable real-world impact</Bullet>
          <Bullet>Automated scanning reports without manual validation</Bullet>
          <Bullet>Clickjacking on non-sensitive pages</Bullet>
          <Bullet>Missing security headers with no demonstrable exploitability</Bullet>
        </ul>
      </section>

      {/* 9. What to Expect */}
      <section>
        <SectionAnchor id="what-to-expect" />
        <SectionHeading icon={Clock} title="9. What to Expect After Reporting" color="text-indigo-400" id="what-to-expect" />
        <div className="space-y-2">
          {[
            { timeframe: "Within 48 hours", action: "We will acknowledge your report and assign a tracking reference." },
            { timeframe: "Within 7 days", action: "We will provide an initial assessment of the vulnerability and its severity." },
            { timeframe: "Within 30–90 days", action: "We aim to resolve critical and high-severity vulnerabilities. You will be notified when the fix is deployed." },
            { timeframe: "After resolution", action: "We will notify you of the fix and, with your permission, acknowledge your contribution in our disclosure notes." },
          ].map((e) => (
            <div key={e.timeframe} className="flex items-start gap-4 rounded-lg border border-border/50 bg-card/40 px-4 py-3">
              <span className="text-xs font-semibold text-indigo-400 shrink-0 w-28">{e.timeframe}</span>
              <p className="text-xs text-muted-foreground leading-relaxed">{e.action}</p>
            </div>
          ))}
        </div>
        <p className="text-sm text-muted-foreground mt-4 leading-relaxed">
          We request that you do not publicly disclose the vulnerability until 90 days after the fix has
          been deployed, or until we provide written permission to disclose.
        </p>
      </section>

      {/* 10. Contact */}
      <section>
        <SectionAnchor id="contact" />
        <SectionHeading icon={Phone} title="10. Contact" color="text-teal-400" id="contact" />
        <div className="rounded-xl border border-border/50 bg-card/40 p-5 space-y-2">
          <p className="text-sm font-semibold text-foreground">{companyName}</p>
          {supportEmail && (
            <div>
              <p className="text-sm text-muted-foreground font-medium">Security Reports:</p>
              <a href={`mailto:${supportEmail}?subject=[SECURITY] Vulnerability Report`} className="block text-sm text-primary hover:underline">
                {supportEmail}
              </a>
            </div>
          )}
          {supportPhone && (
            <a href={`tel:${supportPhone}`} className="block text-sm text-muted-foreground hover:text-foreground">
              Phone: {supportPhone}
            </a>
          )}
          <Link href="/contact-us" className="block text-sm text-primary hover:underline pt-1">
            General enquiries via Contact Us →
          </Link>
        </div>
      </section>
    </LegalLayout>
  );
}
