import { Link } from "wouter";
import LegalLayout, {
  Bullet,
  InfoBox,
  SectionAnchor,
  SectionHeading,
  type LegalSection,
} from "@/components/layout/legal-layout";
import { useCompanySettings } from "@/lib/company-settings";
import { Cookie, FileText, Settings, Globe, Shield, Clock, Phone, Database } from "lucide-react";

const LAST_UPDATED = "16 July 2026";

const sections: LegalSection[] = [
  { id: "what-are-cookies", icon: Cookie, title: "What Are Cookies?", color: "text-cyan-400" },
  { id: "types", icon: Database, title: "Types of Cookies We Use", color: "text-violet-400" },
  { id: "essential", icon: Shield, title: "Essential Cookies", color: "text-emerald-400" },
  { id: "analytics", icon: Globe, title: "Analytics Cookies", color: "text-amber-400" },
  { id: "third-party", icon: Globe, title: "Third-Party Cookies", color: "text-orange-400" },
  { id: "control", icon: Settings, title: "Managing Your Cookies", color: "text-blue-400" },
  { id: "local-storage", icon: Database, title: "Local Storage", color: "text-sky-400" },
  { id: "updates", icon: Clock, title: "Policy Updates", color: "text-muted-foreground" },
  { id: "contact", icon: Phone, title: "Contact Us", color: "text-teal-400" },
];

export default function CookiePolicy() {
  const { companyName, supportPhone, supportEmail } = useCompanySettings();

  return (
    <LegalLayout
      title="Cookie Policy"
      lastUpdated={LAST_UPDATED}
      badgeText="Cookie Policy"
      sections={sections}
      intro={
        <p className="text-muted-foreground leading-relaxed max-w-2xl mt-3">
          This Cookie Policy explains how <strong className="text-foreground">{companyName}</strong>{" "}
          ("RasoKart", "we", "our", or "us") uses cookies and similar technologies on the RasoKart
          platform. By continuing to use the Platform, you consent to the use of cookies as described
          in this policy.
        </p>
      }
    >
      {/* 1. What Are Cookies */}
      <section>
        <SectionAnchor id="what-are-cookies" />
        <SectionHeading icon={Cookie} title="1. What Are Cookies?" color="text-cyan-400" id="what-are-cookies" />
        <p className="text-muted-foreground text-sm leading-relaxed mb-4">
          Cookies are small text files placed on your device (computer, tablet, or mobile) by websites you
          visit. They are widely used to make websites work efficiently, to remember your preferences, and
          to provide analytical information to site owners.
        </p>
        <p className="text-muted-foreground text-sm leading-relaxed">
          In addition to cookies, we may also use similar technologies such as local storage, session
          storage, and browser fingerprinting to provide certain platform functionality.
        </p>
      </section>

      {/* 2. Types */}
      <section>
        <SectionAnchor id="types" />
        <SectionHeading icon={Database} title="2. Types of Cookies We Use" color="text-violet-400" id="types" />
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            {
              name: "Session Cookies",
              lifespan: "Session only",
              desc: "Temporary cookies that are deleted when you close your browser. Used to maintain your login session.",
            },
            {
              name: "Persistent Cookies",
              lifespan: "Up to 12 months",
              desc: "Remain on your device between sessions to remember your preferences and settings.",
            },
            {
              name: "First-Party Cookies",
              lifespan: "Varies",
              desc: "Cookies set by RasoKart directly, necessary for core platform functionality.",
            },
            {
              name: "Third-Party Cookies",
              lifespan: "Varies",
              desc: "Cookies set by external services used by the Platform (e.g., analytics). See section 5.",
            },
          ].map((c) => (
            <div key={c.name} className="rounded-xl border border-border/50 bg-card/40 p-4">
              <div className="flex items-start justify-between gap-2 mb-1">
                <p className="text-sm font-semibold text-foreground">{c.name}</p>
                <span className="text-xs text-muted-foreground/60 shrink-0">{c.lifespan}</span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{c.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 3. Essential */}
      <section>
        <SectionAnchor id="essential" />
        <SectionHeading icon={Shield} title="3. Essential Cookies (Always Active)" color="text-emerald-400" id="essential" />
        <p className="text-muted-foreground text-sm mb-4 leading-relaxed">
          Essential cookies are strictly necessary for the Platform to function. They cannot be disabled.
          These cookies do not store any personally identifiable information beyond what is required for
          session management and security.
        </p>
        <div className="space-y-2">
          {[
            { cookie: "rasokart_token", purpose: "Stores your authentication token to keep you logged in during your session. Deleted on logout." },
            { cookie: "rasokart_session", purpose: "Maintains your active session state across page loads." },
            { cookie: "rasokart_csrf", purpose: "CSRF protection token to prevent cross-site request forgery attacks." },
          ].map((c) => (
            <div key={c.cookie} className="flex gap-3 rounded-lg border border-border/50 bg-card/40 px-4 py-3">
              <code className="text-xs text-primary font-mono shrink-0">{c.cookie}</code>
              <p className="text-xs text-muted-foreground leading-relaxed">{c.purpose}</p>
            </div>
          ))}
        </div>
        <InfoBox variant="success">
          Essential cookies are required for login, security, and core functionality. These cannot be turned
          off without breaking your ability to use the Platform.
        </InfoBox>
      </section>

      {/* 4. Analytics */}
      <section>
        <SectionAnchor id="analytics" />
        <SectionHeading icon={Globe} title="4. Analytics Cookies" color="text-amber-400" id="analytics" />
        <p className="text-muted-foreground text-sm mb-4 leading-relaxed">
          Analytics cookies help us understand how merchants and users interact with the Platform, which
          features are used most, and where we can improve. This information is collected in aggregate form
          and is not used to identify you individually.
        </p>
        <div className="space-y-2">
          {[
            { cookie: "rasokart_analytics", purpose: "Tracks general usage patterns, page views, and feature interactions to help us improve the platform." },
            { cookie: "rasokart_cookie_consent", purpose: "Stores your cookie consent preference (essential only / all). Expires after 12 months." },
          ].map((c) => (
            <div key={c.cookie} className="flex gap-3 rounded-lg border border-border/50 bg-card/40 px-4 py-3">
              <code className="text-xs text-amber-400 font-mono shrink-0">{c.cookie}</code>
              <p className="text-xs text-muted-foreground leading-relaxed">{c.purpose}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          Analytics cookies are optional. You can opt out by selecting "Essential only" in our cookie
          consent banner.
        </p>
      </section>

      {/* 5. Third-Party */}
      <section>
        <SectionAnchor id="third-party" />
        <SectionHeading icon={Globe} title="5. Third-Party Cookies" color="text-orange-400" id="third-party" />
        <p className="text-muted-foreground text-sm leading-relaxed mb-4">
          Certain features of the Platform may involve third-party services that set their own cookies on
          your device. These may include:
        </p>
        <ul className="space-y-2 mb-4">
          <Bullet>Identity and KYC verification providers (set cookies during verification flows)</Bullet>
          <Bullet>Content delivery networks (CDNs) for faster asset loading</Bullet>
          <Bullet>Error monitoring services used for platform stability</Bullet>
        </ul>
        <InfoBox variant="warning">
          We do not use third-party advertising cookies or tracking pixels. We do not sell your data to
          advertisers. Third-party service cookies are limited to those strictly necessary for service
          delivery.
        </InfoBox>
      </section>

      {/* 6. Control */}
      <section>
        <SectionAnchor id="control" />
        <SectionHeading icon={Settings} title="6. Managing Your Cookie Preferences" color="text-blue-400" id="control" />
        <p className="text-muted-foreground text-sm mb-4 leading-relaxed">
          You can manage your cookie preferences in the following ways:
        </p>
        <ul className="space-y-2 mb-4">
          <Bullet>
            <strong className="text-foreground">Cookie Consent Banner:</strong> When you first visit the
            Platform, a cookie consent banner allows you to accept all cookies or select essential cookies
            only.
          </Bullet>
          <Bullet>
            <strong className="text-foreground">Browser Settings:</strong> You can configure your browser to
            block or delete cookies. Note that blocking essential cookies will prevent you from logging in
            and using core Platform features.
          </Bullet>
          <Bullet>
            <strong className="text-foreground">Opt-Out of Analytics:</strong> Select "Essential only" in
            our cookie consent banner to disable analytics cookies while retaining full Platform
            functionality.
          </Bullet>
        </ul>
        <div className="space-y-2">
          {[
            { browser: "Google Chrome", url: "chrome://settings/cookies" },
            { browser: "Mozilla Firefox", url: "about:preferences#privacy" },
            { browser: "Safari", url: "Preferences > Privacy" },
            { browser: "Microsoft Edge", url: "edge://settings/privacy" },
          ].map((b) => (
            <div key={b.browser} className="flex items-center justify-between rounded-lg border border-border/50 bg-card/40 px-4 py-2.5">
              <span className="text-sm text-foreground">{b.browser}</span>
              <code className="text-xs text-muted-foreground">{b.url}</code>
            </div>
          ))}
        </div>
      </section>

      {/* 7. Local Storage */}
      <section>
        <SectionAnchor id="local-storage" />
        <SectionHeading icon={Database} title="7. Local Storage" color="text-sky-400" id="local-storage" />
        <p className="text-muted-foreground text-sm leading-relaxed mb-4">
          In addition to cookies, we use browser local storage to store:
        </p>
        <div className="space-y-2">
          {[
            { key: "rasokart_token", purpose: "Authentication token (mirrors the session cookie for SPA navigation)" },
            { key: "rasokart_cookie_consent", purpose: "Your cookie consent preference" },
            { key: "rasokart_theme", purpose: "Your display theme preference (if applicable)" },
          ].map((ls) => (
            <div key={ls.key} className="flex gap-3 rounded-lg border border-border/50 bg-card/40 px-4 py-3">
              <code className="text-xs text-sky-400 font-mono shrink-0">{ls.key}</code>
              <p className="text-xs text-muted-foreground">{ls.purpose}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          You can clear local storage via your browser's developer tools or by clearing browser site data.
        </p>
      </section>

      {/* 8. Updates */}
      <section>
        <SectionAnchor id="updates" />
        <SectionHeading icon={Clock} title="8. Policy Updates" color="text-muted-foreground" id="updates" />
        <p className="text-muted-foreground text-sm leading-relaxed">
          We may update this Cookie Policy from time to time. When we make material changes, we will update
          the "Last Updated" date and display the updated cookie consent banner so you can review and
          re-consent to our updated cookie practices. Continued use of the Platform after the effective
          date of any update constitutes acceptance.
        </p>
      </section>

      {/* 9. Contact */}
      <section>
        <SectionAnchor id="contact" />
        <SectionHeading icon={Phone} title="9. Contact Us" color="text-teal-400" id="contact" />
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
          <Link href="/contact-us" className="block text-sm text-primary hover:underline pt-1">
            Submit a query via Contact Us →
          </Link>
        </div>
      </section>
    </LegalLayout>
  );
}
