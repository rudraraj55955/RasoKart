import { useEffect } from "react";
import { Link } from "wouter";
import { RasoKartLogo } from "@/components/ui/rasokart-logo";
import { SiteFooter } from "@/components/ui/site-footer";
import { useCompanySettings } from "@/lib/company-settings";
import {
  Briefcase, Code2, Shield, Users, BarChart3, Headphones,
  Heart, Zap, Globe, ArrowRight, Mail, CheckCircle2, Clock
} from "lucide-react";

const LAST_UPDATED = "20 July 2026";

const openings = [
  { dept: "Engineering", roles: ["Backend Engineer (Node.js / TypeScript)", "Frontend Engineer (React / TypeScript)", "DevOps / Infrastructure Engineer", "QA Engineer (Automation)"] },
  { dept: "Product & Design", roles: ["Product Manager — Payments", "UI/UX Designer (Fintech)"] },
  { dept: "Operations & Compliance", roles: ["KYC & Compliance Analyst", "Risk & Fraud Analyst", "Merchant Onboarding Specialist"] },
  { dept: "Sales & Growth", roles: ["Business Development Manager", "Agent / Channel Partner Manager", "Customer Success Manager"] },
  { dept: "Support", roles: ["Technical Support Specialist", "Merchant Support Executive"] },
];

const perks = [
  { icon: Zap, color: "text-amber-400", title: "Fast-Paced Environment", desc: "Work on live, production fintech infrastructure used by real merchants and businesses across India." },
  { icon: Globe, color: "text-cyan-400", title: "Remote-Friendly", desc: "We hire across India. Many roles are hybrid or fully remote with flexible working hours." },
  { icon: Heart, color: "text-rose-400", title: "Meaningful Impact", desc: "Every feature you ship directly impacts how merchants collect and disburse money for their businesses." },
  { icon: BarChart3, color: "text-violet-400", title: "Growth Opportunities", desc: "Early-stage team means high ownership, direct mentorship, and room to grow your career rapidly." },
  { icon: Shield, color: "text-emerald-400", title: "Security-First Culture", desc: "We take data protection and compliance seriously — you'll work with industry-standard practices from day one." },
  { icon: Users, color: "text-blue-400", title: "Collaborative Team", desc: "Small, driven team where everyone's voice matters and good ideas get implemented quickly." },
];

export default function Careers() {
  const { supportEmail } = useCompanySettings();
  const careersEmail = supportEmail ? supportEmail.replace(/^[^@]+@/, "careers@") : "careers@rasokart.com";

  useEffect(() => {
    document.title = "Careers — Join the RasoKart Team";
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2.5 shrink-0">
            <RasoKartLogo size={32} />
            <span className="font-bold text-base hidden sm:block">RasoKart</span>
          </Link>
          <nav className="hidden md:flex items-center gap-6 text-sm text-muted-foreground">
            <Link href="/about-us" className="hover:text-foreground transition-colors">About</Link>
            <Link href="/careers" className="text-foreground font-medium">Careers</Link>
            <Link href="/contact-us" className="hover:text-foreground transition-colors">Contact</Link>
          </nav>
          <Link href="/" className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
            ← Back to Home
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border/40">
        <div className="absolute inset-0 bg-gradient-to-br from-violet-500/5 via-transparent to-primary/5 pointer-events-none" />
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-20 lg:py-28 w-full">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-primary/30 bg-primary/10 text-primary text-xs font-medium mb-6">
            <Briefcase className="w-3.5 h-3.5" />
            We're Hiring — Join RasoKart
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-6 max-w-3xl">
            Build the Future of <span className="text-primary">Indian Fintech</span>
          </h1>
          <p className="text-muted-foreground text-lg leading-relaxed max-w-2xl mb-8">
            RasoKart is on a mission to make payment infrastructure accessible to every Indian business. We're a small, fast-moving team and we're looking for talented people who want to make a real impact.
          </p>
          <a
            href={`mailto:${careersEmail}?subject=Career Enquiry — RasoKart`}
            className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-6 py-3 rounded-lg font-medium hover:opacity-90 transition-opacity"
          >
            <Mail className="w-4 h-4" /> Apply Now
          </a>
        </div>
      </section>

      {/* Perks */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 py-16 w-full">
        <h2 className="text-2xl font-bold tracking-tight mb-2">Why RasoKart?</h2>
        <p className="text-muted-foreground text-sm mb-8">Life at RasoKart is fast-paced, collaborative, and deeply rewarding.</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {perks.map(({ icon: Icon, color, title, desc }) => (
            <div key={title} className="rounded-xl border border-border/60 bg-card/40 p-5">
              <div className="p-2 rounded-lg bg-card border border-border/50 w-fit mb-3">
                <Icon className={`w-4 h-4 ${color}`} />
              </div>
              <h3 className="font-semibold text-sm mb-1">{title}</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Open Roles */}
      <section className="border-t border-border/40 bg-card/20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-16 w-full">
          <h2 className="text-2xl font-bold tracking-tight mb-2">Open Positions</h2>
          <p className="text-muted-foreground text-sm mb-8">
            Don't see a perfect match? Send us your resume anyway — we're always looking for exceptional talent.
          </p>
          <div className="grid md:grid-cols-2 gap-6">
            {openings.map(({ dept, roles }) => (
              <div key={dept} className="rounded-xl border border-border/60 bg-card/40 p-6">
                <div className="flex items-center gap-2 mb-4">
                  <div className="p-1.5 rounded bg-primary/10 border border-primary/20">
                    {dept === "Engineering" ? <Code2 className="w-4 h-4 text-primary" /> :
                     dept === "Operations & Compliance" ? <Shield className="w-4 h-4 text-emerald-400" /> :
                     dept === "Support" ? <Headphones className="w-4 h-4 text-cyan-400" /> :
                     dept === "Sales & Growth" ? <BarChart3 className="w-4 h-4 text-amber-400" /> :
                     <Briefcase className="w-4 h-4 text-violet-400" />}
                  </div>
                  <h3 className="font-semibold text-sm">{dept}</h3>
                </div>
                <ul className="space-y-2">
                  {roles.map(role => (
                    <li key={role}>
                      <a
                        href={`mailto:${careersEmail}?subject=Application: ${encodeURIComponent(role)}`}
                        className="flex items-center justify-between group text-sm text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <span className="flex items-center gap-2">
                          <CheckCircle2 className="w-3.5 h-3.5 text-primary/40 group-hover:text-primary transition-colors" />
                          {role}
                        </span>
                        <ArrowRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How to Apply */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 py-12 w-full">
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-8">
          <h2 className="text-xl font-bold tracking-tight mb-3">How to Apply</h2>
          <p className="text-muted-foreground text-sm leading-relaxed mb-4">
            Send your resume, LinkedIn profile (optional), and a short note about why you want to join RasoKart to:
          </p>
          <a href={`mailto:${careersEmail}`} className="text-primary font-medium hover:underline text-sm">
            {careersEmail}
          </a>
          <p className="text-xs text-muted-foreground mt-4 leading-relaxed">
            Please mention the role you're applying for in the subject line. We review every application and get back within 5–7 business days.
            All candidates are treated equally regardless of background, gender, or experience level.
          </p>
          <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="w-3.5 h-3.5" /> Response time: 5–7 business days
          </div>
        </div>
        <p className="text-xs text-muted-foreground/60 mt-6">Last Updated: {LAST_UPDATED}</p>
      </section>

      <SiteFooter />
    </div>
  );
}
