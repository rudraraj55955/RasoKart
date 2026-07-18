import { useState } from "react";
import { Link } from "wouter";
import { RasoKartLogo } from "@/components/ui/rasokart-logo";
import { useCompanySettings } from "@/lib/company-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SiteFooter } from "@/components/ui/site-footer";
import {
  Phone,
  Mail,
  MapPin,
  Clock,
  MessageSquare,
  CheckCircle,
  ArrowLeft,
  AlertCircle,
  Shield,
  Headphones,
  FileText,
} from "lucide-react";

const LAST_UPDATED = "16 July 2026";
const REGISTERED_ADDRESS = "P. No. B-46, Damodar Vila, Agarsen Nagar, Kalwad Road, Jhotwara, Jaipur – 302012, Rajasthan, India";
const WEBSITE = "https://rasokart.com";

const categories = [
  { value: "general", label: "General Enquiry" },
  { value: "payments", label: "Payment Issue" },
  { value: "account", label: "Account & KYC" },
  { value: "technical", label: "Technical Support" },
  { value: "billing", label: "Billing & Refunds" },
  { value: "kyc", label: "KYC & Compliance" },
  { value: "other", label: "Other" },
];

interface FormState {
  name: string;
  email: string;
  phone: string;
  category: string;
  subject: string;
  message: string;
}

export default function ContactUs() {
  const { companyName, supportPhone, supportEmail, whatsappPhone, companyAddress } = useCompanySettings();
  const resolvedAddress = companyAddress || REGISTERED_ADDRESS;

  const [form, setForm] = useState<FormState>({
    name: "",
    email: "",
    phone: "",
    category: "general",
    subject: "",
    message: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<{ ticketRef: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (field: keyof FormState) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    setForm((f) => ({ ...f, [field]: e.target.value }));
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim() || !form.subject.trim() || !form.message.trim()) {
      setError("Please fill in all required fields.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/public/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "Failed to submit your message. Please try again.");
        return;
      }
      setSubmitted({ ticketRef: data.ticketRef });
    } catch {
      setError("Failed to submit. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2.5 shrink-0">
            <RasoKartLogo size={32} />
            <span className="font-bold text-base hidden sm:block">RasoKart</span>
          </Link>
          <span className="text-sm font-medium text-foreground">Contact Us</span>
          <Link
            href="/"
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Home
          </Link>
        </div>
      </header>

      <div className="flex-1 mx-auto max-w-7xl px-4 sm:px-6 py-12 lg:py-16 w-full">
        {/* Hero */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-primary/30 bg-primary/10 text-primary text-xs font-medium mb-4">
            <Headphones className="w-3.5 h-3.5" />
            We're here to help
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">Contact Us</h1>
          <p className="text-muted-foreground max-w-xl mx-auto leading-relaxed">
            Have a question, issue, or feedback? Reach out to us and we'll get back to you within 2 business
            days.
          </p>
        </div>

        <div className="grid lg:grid-cols-[1fr_400px] gap-10">
          {/* Contact Form */}
          <div>
            {submitted ? (
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-8 text-center">
                <CheckCircle className="w-12 h-12 text-emerald-400 mx-auto mb-4" />
                <h2 className="text-xl font-semibold text-foreground mb-2">Message Received!</h2>
                <p className="text-sm text-muted-foreground mb-4">
                  Thank you for contacting us. We've received your message and will respond within 2 business
                  days.
                </p>
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-sm font-mono mb-4">
                  <FileText className="w-4 h-4" />
                  Ticket Reference: {submitted.ticketRef}
                </div>
                <p className="text-xs text-muted-foreground">
                  Save this reference number for follow-up correspondence.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  onClick={() => {
                    setSubmitted(null);
                    setForm({ name: "", email: "", phone: "", category: "general", subject: "", message: "" });
                  }}
                >
                  Send another message
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="rounded-2xl border border-border/50 bg-card/30 p-6 space-y-5">
                  <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                    <MessageSquare className="w-4 h-4 text-primary" />
                    Send us a message
                  </h2>

                  {error && (
                    <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2.5">
                      <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                      <p className="text-sm text-red-400">{error}</p>
                    </div>
                  )}

                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="name" className="text-xs font-medium">
                        Full Name <span className="text-red-400">*</span>
                      </Label>
                      <Input
                        id="name"
                        placeholder="Jane Doe"
                        value={form.name}
                        onChange={handleChange("name")}
                        required
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="email" className="text-xs font-medium">
                        Email Address <span className="text-red-400">*</span>
                      </Label>
                      <Input
                        id="email"
                        type="email"
                        placeholder="you@example.com"
                        value={form.email}
                        onChange={handleChange("email")}
                        required
                      />
                    </div>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="phone" className="text-xs font-medium">
                        Phone (Optional)
                      </Label>
                      <Input
                        id="phone"
                        placeholder="98765 43210"
                        value={form.phone}
                        onChange={handleChange("phone")}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="category" className="text-xs font-medium">
                        Category
                      </Label>
                      <select
                        id="category"
                        value={form.category}
                        onChange={handleChange("category")}
                        className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        {categories.map((c) => (
                          <option key={c.value} value={c.value}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="subject" className="text-xs font-medium">
                      Subject <span className="text-red-400">*</span>
                    </Label>
                    <Input
                      id="subject"
                      placeholder="Brief description of your query"
                      value={form.subject}
                      onChange={handleChange("subject")}
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="message" className="text-xs font-medium">
                      Message <span className="text-red-400">*</span>
                    </Label>
                    <Textarea
                      id="message"
                      placeholder="Please describe your query or issue in detail..."
                      rows={5}
                      value={form.message}
                      onChange={handleChange("message")}
                      required
                      maxLength={5000}
                    />
                    <p className="text-xs text-muted-foreground/60 text-right">
                      {form.message.length}/5000
                    </p>
                  </div>

                  <Button type="submit" className="w-full" disabled={submitting}>
                    {submitting ? "Submitting…" : "Submit Message"}
                  </Button>

                  <p className="text-xs text-muted-foreground/60 text-center">
                    By submitting this form you agree to our{" "}
                    <Link href="/privacy-policy" className="hover:text-muted-foreground underline underline-offset-2">
                      Privacy Policy
                    </Link>
                    .
                  </p>
                </div>
              </form>
            )}
          </div>

          {/* Contact Info sidebar */}
          <div className="space-y-4">
            <div className="rounded-2xl border border-border/50 bg-card/30 p-6 space-y-4">
              <h2 className="text-base font-semibold text-foreground">Company Details</h2>
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <MapPin className="w-4 h-4 text-muted-foreground/60 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-foreground mb-0.5">{companyName}</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">{resolvedAddress}</p>
                    <p className="text-xs text-muted-foreground/60 mt-1">CIN: U47820RJ2025PTC109583</p>
                  </div>
                </div>

                {supportPhone && (
                  <a href={`tel:${supportPhone}`} className="flex items-center gap-3 group">
                    <Phone className="w-4 h-4 text-muted-foreground/60 shrink-0" />
                    <div>
                      <p className="text-xs font-semibold text-foreground mb-0.5">Phone</p>
                      <p className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">
                        {supportPhone}
                      </p>
                    </div>
                  </a>
                )}

                {supportEmail && (
                  <a href={`mailto:${supportEmail}`} className="flex items-center gap-3 group">
                    <Mail className="w-4 h-4 text-muted-foreground/60 shrink-0" />
                    <div>
                      <p className="text-xs font-semibold text-foreground mb-0.5">Email</p>
                      <p className="text-xs text-muted-foreground group-hover:text-foreground transition-colors break-all">
                        {supportEmail}
                      </p>
                    </div>
                  </a>
                )}

                {whatsappPhone && (
                  <a
                    href={`https://wa.me/91${whatsappPhone.replace(/\D/g, "")}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 group"
                  >
                    <MessageSquare className="w-4 h-4 text-emerald-400 shrink-0" />
                    <div>
                      <p className="text-xs font-semibold text-foreground mb-0.5">WhatsApp</p>
                      <p className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">
                        {whatsappPhone}
                      </p>
                    </div>
                  </a>
                )}

                <div className="flex items-start gap-3">
                  <Clock className="w-4 h-4 text-muted-foreground/60 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-foreground mb-0.5">Support Hours</p>
                    <p className="text-xs text-muted-foreground">Mon – Sat, 10:00 AM – 6:00 PM IST</p>
                    <p className="text-xs text-muted-foreground/60 mt-0.5">Email responses within 2 business days</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-border/50 bg-card/30 p-6 space-y-3">
              <h2 className="text-sm font-semibold text-foreground">Quick Links</h2>
              <div className="space-y-2">
                {[
                  { label: "Grievance Redressal", href: "/grievance-redressal-policy", icon: Shield },
                  { label: "Refund & Cancellation Policy", href: "/refund-cancellation-policy", icon: FileText },
                  { label: "Privacy Policy", href: "/privacy-policy", icon: Shield },
                  { label: "Merchant Login", href: "/merchant", icon: ArrowLeft },
                ].map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <l.icon className="w-3.5 h-3.5 shrink-0 text-muted-foreground/60" />
                    {l.label}
                  </Link>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
              <p className="text-xs text-amber-400/80 leading-relaxed">
                For urgent account or payment issues, please include your Merchant ID and transaction
                reference when contacting us for faster resolution.
              </p>
            </div>
          </div>
        </div>
      </div>

      <SiteFooter />
    </div>
  );
}
