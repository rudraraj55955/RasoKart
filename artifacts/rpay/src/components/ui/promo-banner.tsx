import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight, X, ArrowRight } from "lucide-react";
import { Link } from "wouter";

export interface Campaign {
  id: number;
  internalName: string;
  publicTitle: string | null;
  subtitle: string | null;
  description: string | null;
  badge: string | null;
  ctaText: string | null;
  ctaUrl: string | null;
  secondaryCtaText: string | null;
  secondaryCtaUrl: string | null;
  desktopImageUrl: string | null;
  tabletImageUrl: string | null;
  mobileImageUrl: string | null;
  videoUrl: string | null;
  altText: string | null;
  type: string;
  theme: string | null;
  backgroundColor: string | null;
  gradientFrom: string | null;
  gradientTo: string | null;
  overlayOpacity: number | null;
  animation: string | null;
  placement: string;
  autoplay: boolean | null;
  slideSpeedMs: number | null;
  infiniteLoop: boolean | null;
  showNavArrows: boolean | null;
  showDots: boolean | null;
  pauseOnHover: boolean | null;
  countdownEndAt: string | null;
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function trackEvent(campaignId: number, eventType: "impression" | "click", placement: string) {
  const deviceType = window.innerWidth < 640 ? "mobile" : window.innerWidth < 1024 ? "tablet" : "desktop";
  try {
    await fetch(`${BASE}/api/cms/track`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ campaignId, eventType, deviceType, placement }),
    });
  } catch {
    // silent — never fail the UI for analytics
  }
}

function useCountdown(endAt: string | null) {
  const [timeLeft, setTimeLeft] = useState({ d: 0, h: 0, m: 0, s: 0 });

  useEffect(() => {
    if (!endAt) return;
    const tick = () => {
      const diff = new Date(endAt).getTime() - Date.now();
      if (diff <= 0) { setTimeLeft({ d: 0, h: 0, m: 0, s: 0 }); return; }
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setTimeLeft({ d, h, m, s });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [endAt]);

  return timeLeft;
}

// ── Single Banner Renderers ───────────────────────────────────────────────────

function AnnouncementBar({ c, onClose }: { c: Campaign; onClose: () => void }) {
  const theme = c.theme ?? "dark";
  const bg =
    theme === "cyan" ? "bg-cyan-500/15 border-cyan-400/30 text-cyan-100"
    : theme === "violet" ? "bg-violet-500/15 border-violet-400/30 text-violet-100"
    : theme === "emerald" ? "bg-emerald-500/15 border-emerald-400/30 text-emerald-100"
    : theme === "amber" ? "bg-amber-500/15 border-amber-400/30 text-amber-100"
    : "bg-primary/10 border-primary/30 text-foreground";

  return (
    <div className={`w-full border-b ${bg} py-2.5 px-4 relative`}>
      <div className="mx-auto max-w-7xl flex items-center justify-center gap-3 text-sm">
        {c.badge && <span className="font-bold uppercase text-xs tracking-wider opacity-80">{c.badge}</span>}
        {c.publicTitle && <span className="font-medium">{c.publicTitle}</span>}
        {c.ctaText && c.ctaUrl && (
          <a
            href={c.ctaUrl}
            onClick={() => trackEvent(c.id, "click", c.placement)}
            className="underline font-semibold hover:no-underline flex items-center gap-1"
          >
            {c.ctaText} <ArrowRight className="h-3 w-3" />
          </a>
        )}
      </div>
      <button
        onClick={onClose}
        className="absolute right-3 top-1/2 -translate-y-1/2 opacity-60 hover:opacity-100"
        aria-label="Close announcement"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function TextBanner({ c }: { c: Campaign }) {
  const theme = c.theme ?? "dark";
  const gradClass =
    theme === "cyan" ? "from-cyan-500/20 via-violet-500/10 to-background"
    : theme === "emerald" ? "from-emerald-500/20 via-cyan-500/10 to-background"
    : theme === "amber" ? "from-amber-500/20 via-orange-500/10 to-background"
    : theme === "violet" ? "from-violet-500/20 via-purple-500/10 to-background"
    : "from-primary/10 via-primary/5 to-background";

  const accentClass =
    theme === "cyan" ? "text-cyan-400"
    : theme === "emerald" ? "text-emerald-400"
    : theme === "amber" ? "text-amber-400"
    : theme === "violet" ? "text-violet-400"
    : "text-primary";

  return (
    <div className={`relative w-full bg-gradient-to-r ${gradClass} border-y border-border/30 py-10 px-4`}>
      <div className="mx-auto max-w-7xl text-center">
        {c.badge && (
          <span className={`inline-block mb-3 text-xs font-bold uppercase tracking-widest ${accentClass}`}>
            {c.badge}
          </span>
        )}
        {c.publicTitle && (
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-2">{c.publicTitle}</h2>
        )}
        {c.subtitle && <p className="text-muted-foreground mb-4 max-w-2xl mx-auto">{c.subtitle}</p>}
        {c.description && <p className="text-sm text-muted-foreground mb-5 max-w-xl mx-auto">{c.description}</p>}
        <div className="flex flex-wrap items-center justify-center gap-3">
          {c.ctaText && c.ctaUrl && (
            <a
              href={c.ctaUrl}
              onClick={() => trackEvent(c.id, "click", c.placement)}
            >
              <Button className={`gap-2 bg-gradient-to-r ${theme === "amber" ? "from-amber-500 to-orange-500" : theme === "emerald" ? "from-emerald-500 to-cyan-500" : "from-cyan-500 to-violet-500"} text-white hover:opacity-90`}>
                {c.ctaText} <ArrowRight className="h-4 w-4" />
              </Button>
            </a>
          )}
          {c.secondaryCtaText && c.secondaryCtaUrl && (
            <a href={c.secondaryCtaUrl} onClick={() => trackEvent(c.id, "click", c.placement)}>
              <Button variant="outline" className="gap-2 border-border/60">{c.secondaryCtaText}</Button>
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function ImageBanner({ c }: { c: Campaign }) {
  const img = c.desktopImageUrl;
  if (!img) return <TextBanner c={c} />;

  return (
    <div className="relative w-full overflow-hidden border-y border-border/30">
      <img
        src={img}
        alt={c.altText ?? c.publicTitle ?? "Promotional banner"}
        className="w-full object-cover max-h-80"
        loading="lazy"
      />
      {(c.publicTitle || c.ctaText) && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-center px-4"
          style={{ background: `rgba(0,0,0,${(c.overlayOpacity ?? 40) / 100})` }}
        >
          {c.badge && <Badge variant="outline" className="border-white/30 text-white bg-white/10">{c.badge}</Badge>}
          {c.publicTitle && <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">{c.publicTitle}</h2>}
          {c.subtitle && <p className="text-white/80 max-w-xl">{c.subtitle}</p>}
          <div className="flex flex-wrap gap-3 justify-center">
            {c.ctaText && c.ctaUrl && (
              <a href={c.ctaUrl} onClick={() => trackEvent(c.id, "click", c.placement)}>
                <Button className="bg-white text-black hover:bg-white/90 gap-2">
                  {c.ctaText} <ArrowRight className="h-4 w-4" />
                </Button>
              </a>
            )}
            {c.secondaryCtaText && c.secondaryCtaUrl && (
              <a href={c.secondaryCtaUrl} onClick={() => trackEvent(c.id, "click", c.placement)}>
                <Button variant="outline" className="border-white/40 text-white hover:bg-white/10">
                  {c.secondaryCtaText}
                </Button>
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CountdownBanner({ c }: { c: Campaign }) {
  const time = useCountdown(c.countdownEndAt);
  const pad = (n: number) => String(n).padStart(2, "0");
  const theme = c.theme ?? "amber";
  const accentClass = theme === "cyan" ? "text-cyan-400" : theme === "emerald" ? "text-emerald-400" : theme === "violet" ? "text-violet-400" : "text-amber-400";
  const bgClass = theme === "cyan" ? "from-cyan-500/15" : theme === "emerald" ? "from-emerald-500/15" : theme === "violet" ? "from-violet-500/15" : "from-amber-500/15";

  return (
    <div className={`w-full bg-gradient-to-r ${bgClass} via-background to-background border-y border-border/30 py-10 px-4`}>
      <div className="mx-auto max-w-4xl text-center">
        {c.badge && <span className={`inline-block mb-3 text-xs font-bold uppercase tracking-widest ${accentClass}`}>{c.badge}</span>}
        {c.publicTitle && <h2 className="text-2xl font-bold mb-2">{c.publicTitle}</h2>}
        {c.subtitle && <p className="text-muted-foreground mb-6">{c.subtitle}</p>}
        {c.countdownEndAt && (
          <div className="flex items-center justify-center gap-4 mb-6">
            {[{ v: time.d, l: "Days" }, { v: time.h, l: "Hours" }, { v: time.m, l: "Mins" }, { v: time.s, l: "Secs" }].map(({ v, l }) => (
              <div key={l} className="flex flex-col items-center">
                <span className={`text-3xl sm:text-4xl font-mono font-bold ${accentClass}`}>{pad(v)}</span>
                <span className="text-xs text-muted-foreground mt-1">{l}</span>
              </div>
            ))}
          </div>
        )}
        {c.ctaText && c.ctaUrl && (
          <a href={c.ctaUrl} onClick={() => trackEvent(c.id, "click", c.placement)}>
            <Button className="gap-2">
              {c.ctaText} <ArrowRight className="h-4 w-4" />
            </Button>
          </a>
        )}
      </div>
    </div>
  );
}

function FullWidthBanner({ c }: { c: Campaign }) {
  const theme = c.theme ?? "dark";
  const gradClass =
    theme === "cyan" ? "from-cyan-900/50 via-violet-900/30 to-background"
    : theme === "emerald" ? "from-emerald-900/50 via-cyan-900/30 to-background"
    : theme === "amber" ? "from-amber-900/50 via-orange-900/30 to-background"
    : theme === "violet" ? "from-violet-900/50 via-purple-900/30 to-background"
    : "from-card/60 via-card/30 to-background";

  const accentClass =
    theme === "cyan" ? "from-cyan-400 to-violet-400"
    : theme === "emerald" ? "from-emerald-400 to-cyan-400"
    : theme === "amber" ? "from-amber-400 to-orange-400"
    : theme === "violet" ? "from-violet-400 to-purple-400"
    : "from-primary to-primary/60";

  return (
    <div className={`w-full bg-gradient-to-br ${gradClass} border-y border-border/30 py-16 px-4`}>
      <div className="mx-auto max-w-7xl flex flex-col lg:flex-row items-center gap-10">
        {c.desktopImageUrl && (
          <div className="lg:w-1/2 order-2 lg:order-1">
            <img src={c.desktopImageUrl} alt={c.altText ?? ""} className="rounded-2xl object-cover w-full max-h-64 border border-border/40" loading="lazy" />
          </div>
        )}
        <div className={`${c.desktopImageUrl ? "lg:w-1/2" : "w-full text-center"} order-1 lg:order-2`}>
          {c.badge && <Badge variant="outline" className="mb-4">{c.badge}</Badge>}
          {c.publicTitle && (
            <h2 className={`text-3xl sm:text-4xl font-bold tracking-tight mb-3 bg-gradient-to-r ${accentClass} bg-clip-text text-transparent`}>
              {c.publicTitle}
            </h2>
          )}
          {c.subtitle && <p className="text-lg text-muted-foreground mb-2">{c.subtitle}</p>}
          {c.description && <p className="text-sm text-muted-foreground mb-6">{c.description}</p>}
          <div className="flex flex-wrap gap-3">
            {c.ctaText && c.ctaUrl && (
              <a href={c.ctaUrl} onClick={() => trackEvent(c.id, "click", c.placement)}>
                <Button size="lg" className={`gap-2 bg-gradient-to-r ${accentClass} text-white hover:opacity-90`}>
                  {c.ctaText} <ArrowRight className="h-4 w-4" />
                </Button>
              </a>
            )}
            {c.secondaryCtaText && c.secondaryCtaUrl && (
              <a href={c.secondaryCtaUrl} onClick={() => trackEvent(c.id, "click", c.placement)}>
                <Button size="lg" variant="outline" className="gap-2 border-border/60">{c.secondaryCtaText}</Button>
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Carousel ──────────────────────────────────────────────────────────────────

function Carousel({ campaigns }: { campaigns: Campaign[] }) {
  const [idx, setIdx] = useState(0);
  const [hovering, setHovering] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const c = campaigns[idx];

  const go = useCallback((next: number) => {
    setIdx((next + campaigns.length) % campaigns.length);
  }, [campaigns.length]);

  useEffect(() => {
    if (!c?.autoplay || hovering || campaigns.length <= 1) return;
    timerRef.current = setTimeout(() => go(idx + 1), c.slideSpeedMs ?? 5000);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [idx, hovering, c, campaigns.length, go]);

  useEffect(() => {
    const onVisible = () => {
      if (document.hidden && timerRef.current) clearTimeout(timerRef.current);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  useEffect(() => {
    if (c) trackEvent(c.id, "impression", c.placement);
  }, [idx, c?.id]);

  if (!c) return null;

  return (
    <div
      className="relative"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <div key={idx} className="animate-in fade-in duration-500">
        <SingleBannerRenderer c={c} />
      </div>

      {campaigns.length > 1 && (
        <>
          {c.showNavArrows && (
            <>
              <button
                onClick={() => go(idx - 1)}
                aria-label="Previous slide"
                className="absolute left-2 top-1/2 -translate-y-1/2 z-10 rounded-full bg-background/70 border border-border/50 p-1.5 hover:bg-background/90 transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={() => go(idx + 1)}
                aria-label="Next slide"
                className="absolute right-2 top-1/2 -translate-y-1/2 z-10 rounded-full bg-background/70 border border-border/50 p-1.5 hover:bg-background/90 transition-colors"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </>
          )}
          {c.showDots && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5 z-10">
              {campaigns.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setIdx(i)}
                  aria-label={`Go to slide ${i + 1}`}
                  className={`h-1.5 rounded-full transition-all ${i === idx ? "w-6 bg-primary" : "w-1.5 bg-foreground/30"}`}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SingleBannerRenderer({ c }: { c: Campaign }) {
  const type = c.type;
  if (type === "announcement_bar") return null; // handled separately
  if (type === "image_banner") return <ImageBanner c={c} />;
  if (type === "countdown") return <CountdownBanner c={c} />;
  if (type === "full_width" || type === "merchant_offer" || type === "api_promotion" || type === "security_announcement" || type === "feature_launch" || type === "referral_campaign") {
    return <FullWidthBanner c={c} />;
  }
  return <TextBanner c={c} />;
}

// ── Public Slot ───────────────────────────────────────────────────────────────

interface PromoBannerSlotProps {
  placement: string;
  className?: string;
}

export function PromoBannerSlot({ placement, className = "" }: PromoBannerSlotProps) {
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${BASE}/api/cms/public/banners?placement=${encodeURIComponent(placement)}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setCampaigns(d.campaigns ?? []);
      })
      .catch(() => {
        if (!cancelled) setCampaigns([]);
      });
    return () => { cancelled = true; };
  }, [placement]);

  useEffect(() => {
    if (campaigns && campaigns.length > 0 && campaigns[0].type !== "announcement_bar") {
      campaigns.forEach((c) => trackEvent(c.id, "impression", placement));
    }
  }, [campaigns, placement]);

  if (!campaigns || campaigns.length === 0 || dismissed) return null;

  const firstType = campaigns[0].type;

  if (firstType === "announcement_bar") {
    return dismissed ? null : (
      <AnnouncementBar c={campaigns[0]} onClose={() => setDismissed(true)} />
    );
  }

  if (campaigns.length === 1) {
    return (
      <div className={className}>
        <SingleBannerRenderer c={campaigns[0]} />
      </div>
    );
  }

  return (
    <div className={className}>
      <Carousel campaigns={campaigns} />
    </div>
  );
}

export default PromoBannerSlot;
