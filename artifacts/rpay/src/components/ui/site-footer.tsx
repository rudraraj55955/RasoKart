import { Link } from "wouter";
import { RasoKartLogo } from "@/components/ui/rasokart-logo";
import { useCompanySettings } from "@/lib/company-settings";
import { Phone, Mail, MapPin, ExternalLink } from "lucide-react";

const legalLinks = [
  { label: "Privacy Policy", href: "/privacy-policy" },
  { label: "Terms & Conditions", href: "/terms-and-conditions" },
  { label: "Refund & Cancellation", href: "/refund-cancellation-policy" },
  { label: "Service Delivery", href: "/service-delivery-policy" },
  { label: "Cookie Policy", href: "/cookie-policy" },
  { label: "Disclaimer", href: "/disclaimer" },
];

const merchantLinks = [
  { label: "Merchant Agreement", href: "/merchant-agreement" },
  { label: "Prohibited Businesses", href: "/prohibited-businesses" },
  { label: "KYC & AML Policy", href: "/kyc-aml-policy" },
  { label: "Pricing & Fees", href: "/pricing-fees-settlement-policy" },
  { label: "Payment & Settlement", href: "/payment-payout-settlement-policy" },
  { label: "Chargeback & Dispute", href: "/chargeback-dispute-policy" },
];

const supportLinks = [
  { label: "Contact Us", href: "/contact-us" },
  { label: "Grievance Redressal", href: "/grievance-redressal-policy" },
  { label: "Security & Disclosure", href: "/security-policy" },
];

export function SiteFooter() {
  const { companyName, supportPhone, supportEmail, companyAddress, footerText } = useCompanySettings();

  return (
    <footer className="border-t border-border/40 bg-card/20 mt-auto">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
          {/* Brand column */}
          <div className="col-span-2 md:col-span-1">
            <Link href="/" className="flex items-center gap-2.5 mb-4">
              <RasoKartLogo size={28} />
              <span className="font-bold text-sm text-foreground">RasoKart</span>
            </Link>
            <p className="text-xs text-muted-foreground leading-relaxed mb-4">
              {footerText ||
                "Secure, reliable payment gateway infrastructure for modern businesses."}
            </p>
            <div className="space-y-1.5">
              {supportPhone && (
                <a
                  href={`tel:${supportPhone}`}
                  className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Phone className="w-3 h-3 text-muted-foreground/60 shrink-0" />
                  {supportPhone}
                </a>
              )}
              {supportEmail && (
                <a
                  href={`mailto:${supportEmail}`}
                  className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors break-all"
                >
                  <Mail className="w-3 h-3 text-muted-foreground/60 shrink-0" />
                  {supportEmail}
                </a>
              )}
              {companyAddress && (
                <div className="flex items-start gap-2 text-xs text-muted-foreground">
                  <MapPin className="w-3 h-3 text-muted-foreground/60 shrink-0 mt-0.5" />
                  <span className="leading-snug">{companyAddress}</span>
                </div>
              )}
            </div>
          </div>

          {/* Legal */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Legal Policies
            </p>
            <ul className="space-y-2">
              {legalLinks.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Merchant */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Merchant
            </p>
            <ul className="space-y-2">
              {merchantLinks.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Support */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Support
            </p>
            <ul className="space-y-2">
              {supportLinks.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
              <li>
                <Link
                  href="/merchant"
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Merchant Login
                  <ExternalLink className="w-2.5 h-2.5" />
                </Link>
              </li>
              <li>
                <Link
                  href="/admin/login"
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Admin Console
                  <ExternalLink className="w-2.5 h-2.5" />
                </Link>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="border-t border-border/40 pt-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground/60 text-center sm:text-left">
            © {new Date().getFullYear()} {companyName}. All rights reserved. CIN:
            U47820RJ2025PTC109583.
          </p>
          <div className="flex items-center gap-4 text-xs text-muted-foreground/60">
            <Link href="/privacy-policy" className="hover:text-muted-foreground transition-colors">
              Privacy
            </Link>
            <span>·</span>
            <Link href="/terms-and-conditions" className="hover:text-muted-foreground transition-colors">
              Terms
            </Link>
            <span>·</span>
            <Link href="/cookie-policy" className="hover:text-muted-foreground transition-colors">
              Cookies
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
