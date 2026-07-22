import { Link } from "wouter";
import { RasoKartLogo } from "@/components/ui/rasokart-logo";
import { useCompanySettings } from "@/lib/company-settings";
import { Phone, Mail, MapPin, ExternalLink } from "lucide-react";

const companyLinks = [
  { label: "About Us", href: "/about-us" },
  { label: "Careers", href: "/careers" },
  { label: "Press & Media", href: "/press-media" },
  { label: "Contact Us", href: "/contact-us" },
  { label: "White-label Solutions", href: "/whitelabel-solutions" },
];

const legalLinks = [
  { label: "Privacy Policy", href: "/privacy-policy" },
  { label: "Terms & Conditions", href: "/terms-and-conditions" },
  { label: "Refund & Cancellation", href: "/refund-cancellation-policy" },
  { label: "Cookie Policy", href: "/cookie-policy" },
  { label: "Acceptable Use Policy", href: "/acceptable-use-policy" },
  { label: "Intellectual Property", href: "/intellectual-property-policy" },
  { label: "Disclaimer", href: "/disclaimer" },
];

const complianceLinks = [
  { label: "KYC & AML Policy", href: "/kyc-aml-policy" },
  { label: "Risk & Fraud Prevention", href: "/risk-fraud-prevention" },
  { label: "Data Security Policy", href: "/data-security-policy" },
  { label: "PCI DSS & Security", href: "/pci-dss-security" },
  { label: "Responsible Disclosure", href: "/responsible-disclosure" },
  { label: "Prohibited Businesses", href: "/prohibited-businesses" },
];

const supportLinks = [
  { label: "Support Center", href: "/support-center" },
  { label: "Grievance Redressal", href: "/grievance-redressal-policy" },
  { label: "Grievance Officer", href: "/grievance-officer" },
  { label: "Escalation Matrix", href: "/escalation-matrix" },
  { label: "SLA & Timelines", href: "/sla-support-timelines" },
];

const developerLinks = [
  { label: "API Documentation", href: "/api-docs" },
  { label: "Integration Guide", href: "/integration-guide" },
  { label: "Service Delivery", href: "/service-delivery-policy" },
  { label: "UPI Collection API", href: "/upi-collection-api" },
];

const merchantLinks = [
  { label: "Merchant Agreement", href: "/merchant-agreement" },
  { label: "Payment Partner Disclosure", href: "/payment-partner-disclosure" },
  { label: "Pricing & Fees", href: "/pricing-fees-settlement-policy" },
  { label: "Settlement Policy", href: "/payment-payout-settlement-policy" },
  { label: "Payout Policy", href: "/payout-policy" },
  { label: "Chargeback & Dispute", href: "/chargeback-dispute-policy" },
];

interface FooterSection {
  heading: string;
  links: { label: string; href: string }[];
}

function FooterCol({ heading, links }: FooterSection) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
        {heading}
      </p>
      <ul className="space-y-2">
        {links.map((l) => (
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
  );
}

export function SiteFooter() {
  const { companyName, supportPhone, supportEmail, companyAddress, footerText } = useCompanySettings();

  return (
    <footer className="border-t border-border/40 bg-card/20 mt-auto">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-12">
        {/* Top grid: brand + 6 columns */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-8 mb-10">
          {/* Brand column — spans 1 col on lg */}
          <div className="col-span-2 sm:col-span-3 lg:col-span-1">
            <Link href="/" className="flex items-center gap-2.5 mb-4">
              <RasoKartLogo size={28} />
              <span className="font-bold text-sm text-foreground">RasoKart</span>
            </Link>
            <p className="text-xs text-muted-foreground leading-relaxed mb-4">
              {footerText ||
                "Secure, reliable payment gateway infrastructure for modern Indian businesses."}
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

          {/* 6 content columns */}
          <FooterCol heading="Company" links={companyLinks} />
          <FooterCol heading="Legal" links={legalLinks} />
          <FooterCol heading="Compliance" links={complianceLinks} />
          <FooterCol heading="Support" links={supportLinks} />
          <FooterCol heading="Developers" links={developerLinks} />
          <FooterCol heading="Merchant" links={merchantLinks} />
        </div>

        {/* Portal quick links */}
        <div className="border-t border-border/40 pt-6 mb-4 flex flex-wrap gap-4 text-xs text-muted-foreground/60">
          <Link
            href="/merchant/login"
            className="flex items-center gap-1 hover:text-muted-foreground transition-colors"
          >
            Merchant Portal <ExternalLink className="w-2.5 h-2.5" />
          </Link>
          <Link
            href="/admin/login"
            className="flex items-center gap-1 hover:text-muted-foreground transition-colors"
          >
            Admin Console <ExternalLink className="w-2.5 h-2.5" />
          </Link>
          <Link
            href="/payout-merchant/login"
            className="flex items-center gap-1 hover:text-muted-foreground transition-colors"
          >
            Payout Portal <ExternalLink className="w-2.5 h-2.5" />
          </Link>
        </div>

        {/* Regulatory Disclosure */}
        <div className="border-t border-border/40 pt-5 mb-4">
          <p className="text-xs text-muted-foreground/60 leading-relaxed">
            <strong className="text-muted-foreground/80">Regulatory Disclosure:</strong>{" "}
            RasoKart is a software and technology platform operated by Nickey Collection Private Limited (GSTIN: 08AALCN0945P1ZT). RasoKart is not represented as an RBI-authorised Payment Aggregator and does not independently pool or settle customer or merchant funds. Regulated payment processing and settlement services are provided through approved banks and payment-service providers, subject to onboarding, KYC, risk approval and applicable terms.{" "}
            <a href="/payment-partner-disclosure" className="hover:text-muted-foreground transition-colors underline underline-offset-2">Payment Partner Disclosure</a>
          </p>
        </div>

        {/* Bottom bar */}
        <div className="border-t border-border/40 pt-5 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground/60 text-center sm:text-left">
            © {new Date().getFullYear()} NICKEY COLLECTION PRIVATE LIMITED. All rights reserved. CIN: U47820RJ2025PTC109583 · GSTIN: 08AALCN0945P1ZT.
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
            <span>·</span>
            <Link href="/security-policy" className="hover:text-muted-foreground transition-colors">
              Security
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
