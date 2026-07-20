import { useEffect } from "react";
import { Link } from "wouter";
import { RasoKartLogo } from "@/components/ui/rasokart-logo";
import { SiteFooter } from "@/components/ui/site-footer";
import { useCompanySettings } from "@/lib/company-settings";
import { Newspaper, Mail, Building2, Globe, Phone, Download, FileText, Shield } from "lucide-react";

const LAST_UPDATED = "20 July 2026";
const CIN = "U47820RJ2025PTC109583";
const REGISTERED_ADDRESS = "P. No. B-46, Damodar Vila, Agarsen Nagar, Kalwad Road, Jhotwara, Jaipur – 302012, Rajasthan, India";
const WEBSITE = "https://rasokart.com";

const boilerplate = `RasoKart is a secure payment gateway SaaS platform operated by Nickey Collection Private Limited (CIN: U47820RJ2025PTC109583), incorporated in Jaipur, Rajasthan, India in December 2025. RasoKart helps businesses of all sizes collect payments, manage payouts, and grow with confidence through a fully-integrated payments operating system — including QR codes, virtual accounts, API-based payment collection, merchant self-serve dashboards, and a distributed agent network.`;

const keyFacts = [
  { label: "Legal Entity", value: "Nickey Collection Private Limited" },
  { label: "Brand", value: "RasoKart" },
  { label: "CIN", value: CIN },
  { label: "Incorporated", value: "December 2025" },
  { label: "Industry", value: "Payment Gateway / Fintech SaaS" },
  { label: "Headquarters", value: "Jaipur, Rajasthan, India" },
  { label: "Website", value: WEBSITE },
  { label: "Registered Office", value: REGISTERED_ADDRESS },
];

export default function PressMedia() {
  const { supportEmail, supportPhone } = useCompanySettings();
  const pressEmail = "press@rasokart.com";

  useEffect(() => {
    document.title = "Press & Media — RasoKart";
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2.5 shrink-0">
            <RasoKartLogo size={32} />
            <span className="font-bold text-base hidden sm:block">RasoKart</span>
          </Link>
          <span className="text-sm font-medium text-foreground">Press & Media</span>
          <Link href="/" className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0">
            ← Back to Home
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-16 w-full flex-1">
        {/* Hero */}
        <div className="mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-primary/30 bg-primary/10 text-primary text-xs font-medium mb-6">
            <Newspaper className="w-3.5 h-3.5" />
            Press & Media · Last Updated: {LAST_UPDATED}
          </div>
          <h1 className="text-4xl font-bold tracking-tight mb-4">Press & Media</h1>
          <p className="text-muted-foreground leading-relaxed max-w-2xl">
            Welcome to the RasoKart press room. Here you'll find our company boilerplate, key facts, brand guidelines, and press contact information. For media enquiries, please contact us at <a href={`mailto:${pressEmail}`} className="text-primary hover:underline">{pressEmail}</a>.
          </p>
        </div>

        <div className="border-t border-border/40 mb-10" />

        {/* Press Contact */}
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-6 mb-10">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Mail className="w-5 h-5 text-primary" /> Press Contact
          </h2>
          <div className="grid sm:grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground text-xs mb-1">Media Enquiries</p>
              <a href={`mailto:${pressEmail}`} className="text-primary hover:underline font-medium">{pressEmail}</a>
            </div>
            <div>
              <p className="text-muted-foreground text-xs mb-1">General Contact</p>
              <a href={`mailto:${supportEmail || "support@rasokart.com"}`} className="text-muted-foreground hover:text-foreground transition-colors">
                {supportEmail || "support@rasokart.com"}
              </a>
            </div>
            {supportPhone && (
              <div>
                <p className="text-muted-foreground text-xs mb-1">Phone</p>
                <a href={`tel:${supportPhone}`} className="text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
                  <Phone className="w-3.5 h-3.5" /> {supportPhone}
                </a>
              </div>
            )}
            <div>
              <p className="text-muted-foreground text-xs mb-1">Response Time</p>
              <span className="text-muted-foreground">Within 2 business days</span>
            </div>
          </div>
        </div>

        {/* Company Boilerplate */}
        <div className="rounded-xl border border-border/60 bg-card/40 p-6 mb-10">
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <FileText className="w-5 h-5 text-muted-foreground" /> Company Boilerplate
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed mb-4">{boilerplate}</p>
          <p className="text-xs text-muted-foreground/60 italic">
            You may use this boilerplate in news articles, press releases, and media coverage. Please do not modify the legal company name, CIN, or registered address.
          </p>
        </div>

        {/* Key Facts */}
        <div className="rounded-xl border border-border/60 bg-card/40 p-6 mb-10">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Building2 className="w-5 h-5 text-muted-foreground" /> Key Company Facts
          </h2>
          <div className="grid sm:grid-cols-2 gap-3">
            {keyFacts.map(({ label, value }) => (
              <div key={label} className="flex gap-3 text-sm border-b border-border/30 pb-3">
                <span className="text-muted-foreground w-36 shrink-0 text-xs">{label}</span>
                <span className="font-medium text-xs font-mono break-all">{value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Brand Guidelines */}
        <div className="rounded-xl border border-border/60 bg-card/40 p-6 mb-10">
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <Shield className="w-5 h-5 text-muted-foreground" /> Brand Guidelines
          </h2>
          <div className="space-y-3 text-sm text-muted-foreground">
            <p><strong className="text-foreground">Brand Name:</strong> Always use "RasoKart" as one word with a capital R and K. Do not use "Raso Kart", "RASOKART", or "rasokart" in running text.</p>
            <p><strong className="text-foreground">Legal Name:</strong> When the legal entity is referenced, use "Nickey Collection Private Limited" in full on first mention.</p>
            <p><strong className="text-foreground">Logo Usage:</strong> The RasoKart logo may only be used for editorial purposes — to identify or refer to RasoKart as a company or product. Do not alter, recolour, or use the logo in a way that implies endorsement.</p>
            <p><strong className="text-foreground">Trademark:</strong> "RasoKart" and the RasoKart logo are trademarks of Nickey Collection Private Limited. All rights reserved.</p>
            <p><strong className="text-foreground">Brand Assets:</strong> For official logo files, product screenshots, or other brand assets, please contact <a href={`mailto:${pressEmail}`} className="text-primary hover:underline">{pressEmail}</a>.</p>
          </div>
        </div>

        {/* Website & Social */}
        <div className="rounded-xl border border-border/60 bg-card/40 p-6 mb-10">
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <Globe className="w-5 h-5 text-muted-foreground" /> Official Channels
          </h2>
          <div className="space-y-2 text-sm">
            <div className="flex gap-3">
              <span className="text-muted-foreground w-28 text-xs">Website</span>
              <a href={WEBSITE} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{WEBSITE}</a>
            </div>
            <div className="flex gap-3">
              <span className="text-muted-foreground w-28 text-xs">Press Contact</span>
              <a href={`mailto:${pressEmail}`} className="text-primary hover:underline">{pressEmail}</a>
            </div>
            <div className="flex gap-3">
              <span className="text-muted-foreground w-28 text-xs">Support</span>
              <a href="/contact-us" className="text-muted-foreground hover:text-foreground transition-colors">{WEBSITE}/contact-us</a>
            </div>
          </div>
        </div>

        <div className="border-t border-border/40 pt-6 text-xs text-muted-foreground/60">
          <p>© {new Date().getFullYear()} Nickey Collection Private Limited. All rights reserved. Last Updated: {LAST_UPDATED}</p>
        </div>
      </div>

      <SiteFooter />
    </div>
  );
}
