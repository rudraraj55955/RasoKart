import type { ComponentType, ReactNode } from "react";
import { Link } from "wouter";
import { RasoKartLogo } from "@/components/ui/rasokart-logo";
import { ChevronRight, ArrowLeft, Shield } from "lucide-react";
import { SiteFooter } from "@/components/ui/site-footer";

export interface LegalSection {
  id: string;
  icon: ComponentType<{ className?: string }>;
  title: string;
  color: string;
}

interface LegalLayoutProps {
  title: string;
  subtitle?: string;
  lastUpdated: string;
  version?: string;
  badgeText?: string;
  sections: LegalSection[];
  intro?: ReactNode;
  children: ReactNode;
}

export function SectionAnchor({ id }: { id: string }) {
  return <span id={id} className="block" style={{ scrollMarginTop: "6rem" }} />;
}

export function SectionHeading({
  icon: Icon,
  title,
  color,
  id,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  color: string;
  id: string;
}) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="p-2 rounded-lg bg-card border border-border/50">
        <Icon className={`w-5 h-5 ${color}`} />
      </div>
      <h2 className="text-xl font-semibold text-foreground">{title}</h2>
      <a
        href={`#${id}`}
        className="ml-auto text-muted-foreground/40 hover:text-muted-foreground transition-colors text-xs"
      >
        #
      </a>
    </div>
  );
}

export function Bullet({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-2 text-muted-foreground text-sm leading-relaxed">
      <ChevronRight className="w-4 h-4 text-primary/60 shrink-0 mt-0.5" />
      <span>{children}</span>
    </li>
  );
}

export function InfoBox({
  children,
  variant = "neutral",
}: {
  children: ReactNode;
  variant?: "neutral" | "warning" | "danger" | "success";
}) {
  const styles = {
    neutral: "border-border/50 bg-card/40",
    warning: "border-amber-500/20 bg-amber-500/5",
    danger: "border-red-500/20 bg-red-500/5",
    success: "border-emerald-500/20 bg-emerald-500/5",
  };
  const textStyles = {
    neutral: "text-muted-foreground",
    warning: "text-amber-400/80",
    danger: "text-red-400/80",
    success: "text-emerald-400/80",
  };
  return (
    <div className={`rounded-xl border px-4 py-3 ${styles[variant]}`}>
      <p className={`text-sm leading-relaxed ${textStyles[variant]}`}>{children}</p>
    </div>
  );
}

export default function LegalLayout({
  title,
  subtitle,
  lastUpdated,
  version,
  badgeText = "Legal Document",
  sections,
  intro,
  children,
}: LegalLayoutProps) {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Sticky Header */}
      <header className="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2.5 shrink-0">
            <RasoKartLogo size={32} />
            <span className="font-bold text-base hidden sm:block">RasoKart</span>
          </Link>
          <span className="text-sm font-medium text-foreground truncate">{title}</span>
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
        <div className="lg:grid lg:grid-cols-[240px_1fr] lg:gap-12 xl:grid-cols-[280px_1fr]">
          {/* Sidebar TOC — desktop only */}
          <aside className="hidden lg:block">
            <div className="sticky top-24 space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Contents
              </p>
              {sections.map((s) => (
                <a
                  key={s.id}
                  href={`#${s.id}`}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-card/60 transition-colors group"
                >
                  <s.icon className={`w-3.5 h-3.5 ${s.color} shrink-0`} />
                  <span>{s.title}</span>
                </a>
              ))}
            </div>
          </aside>

          {/* Main content */}
          <main className="min-w-0 space-y-10">
            {/* Hero */}
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-primary/30 bg-primary/10 text-primary text-xs font-medium mb-4">
                <Shield className="w-3.5 h-3.5" />
                {badgeText} · Last Updated: {lastUpdated}
                {version && <span className="text-primary/60">· v{version}</span>}
              </div>
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">{title}</h1>
              {subtitle && (
                <p className="text-muted-foreground leading-relaxed max-w-2xl">{subtitle}</p>
              )}
              {intro}
            </div>

            <div className="border-t border-border/40" />

            {children}

            {/* Footer note */}
            <div className="border-t border-border/40 pt-8">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-muted-foreground/60">
                <span>© {new Date().getFullYear()} NICKEY COLLECTION PRIVATE LIMITED. All rights reserved.</span>
                <div className="flex items-center gap-4">
                  <span>Last Updated: {lastUpdated}</span>
                  <Link href="/" className="hover:text-muted-foreground transition-colors">
                    ← Back to Home
                  </Link>
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>

      <SiteFooter />
    </div>
  );
}
