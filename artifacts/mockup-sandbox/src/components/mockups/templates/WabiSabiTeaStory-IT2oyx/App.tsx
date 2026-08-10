import { useRef, useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ChevronUp, Heart, Send, MoreHorizontal } from 'lucide-react';

const INK = '#221c16';
const BONE = '#ece3d3';
const CLAY = '#b3674a';
const ROSE = '#9c6b5e';
const SMOKE = '#7d7468';

const ease = [0.22, 1, 0.36, 1];

function Reveal({ children, root, delay = 0, y = 26, className = '', style = {} }) {
  return (
    <motion.div
      className={className}
      style={style}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ root, amount: 0.45 }}
      transition={{ duration: 1.1, delay, ease }}
    >
      {children}
    </motion.div>
  );
}

function Seam() {
  return (
    <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 z-10 pointer-events-none">
      <div className="h-full w-full seam-line" />
    </div>
  );
}

export default function App() {
  const scrollRef = useRef(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const max = el.scrollHeight - el.clientHeight;
      setProgress(max > 0 ? el.scrollTop / max : 0);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  const segments = 5;
  const segFill = (i) => {
    const per = 1 / segments;
    const local = (progress - i * per) / per;
    return Math.max(0, Math.min(1, local)) * 100;
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center py-6 px-4" style={{ background: '#15110d' }}>
      <link
        href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;1,300;1,400;1,500;1,600&family=Karla:wght@300;400;500;600&display=swap"
        rel="stylesheet"
      />
      <style
        dangerouslySetInnerHTML={{
          __html: `
        .serif-i { font-family: 'Cormorant Garamond', serif; font-style: italic; }
        .serif-r { font-family: 'Cormorant Garamond', serif; }
        .sans { font-family: 'Karla', sans-serif; }
        .no-bar::-webkit-scrollbar { display: none; }
        .no-bar { scrollbar-width: none; -ms-overflow-style: none; }
        .grain::after {
          content: '';
          position: absolute; inset: 0; pointer-events: none; z-index: 40;
          opacity: 0.5; mix-blend-mode: overlay;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.55'/%3E%3C/svg%3E");
        }
        .seam-line {
          background: linear-gradient(to bottom,
            transparent 0%, ${CLAY}66 12%, ${CLAY}22 38%,
            ${CLAY}88 52%, transparent 70%, ${CLAY}55 86%, transparent 100%);
        }
        .enso {
          border-radius: 52% 48% 47% 53% / 49% 53% 47% 51%;
          border: 1.5px solid;
          mask-image: conic-gradient(from 230deg, transparent 0deg, transparent 38deg, black 70deg, black 360deg);
          -webkit-mask-image: conic-gradient(from 230deg, transparent 0deg, transparent 38deg, black 70deg, black 360deg);
        }
        .vert { writing-mode: vertical-rl; }
        @keyframes drift { 0% { transform: translateY(0); } 50% { transform: translateY(-7px); } 100% { transform: translateY(0); } }
        .drift { animation: drift 5s ease-in-out infinite; }
        @keyframes steam {
          0% { transform: translateY(0) scaleX(1); opacity: 0; }
          25% { opacity: 0.55; }
          100% { transform: translateY(-46px) scaleX(1.6); opacity: 0; }
        }
        .steam span { display:block; width: 1px; height: 34px; background: linear-gradient(to top, transparent, ${BONE}); animation: steam 3.4s ease-out infinite; }
        .steam span:nth-child(2) { animation-delay: 1.1s; margin-left: 7px; height: 28px; }
        .steam span:nth-child(3) { animation-delay: 2.2s; margin-left: -10px; height: 40px; }
        .img-wabi { filter: sepia(0.22) saturate(0.78) contrast(0.94) brightness(0.96); }
      `,
        }}
      />

      {/* PHONE / STORY FRAME */}
      <div
        className="relative grain overflow-hidden"
        style={{
          height: 'min(92vh, 860px)',
          aspectRatio: '9 / 16',
          borderRadius: '34px',
          background: INK,
          boxShadow: '0 40px 90px -20px rgba(0,0,0,0.8), 0 0 0 1px rgba(236,227,211,0.07)',
        }}
      >
        {/* STORY CHROME */}
        <div className="absolute top-0 inset-x-0 z-50 px-3 pt-3">
          <div className="flex gap-1">
            {Array.from({ length: segments }).map((_, i) => (
              <div key={i} className="h-[2px] flex-1 rounded-full overflow-hidden" style={{ background: 'rgba(236,227,211,0.22)' }}>
                <div className="h-full" style={{ width: `${segFill(i)}%`, background: BONE, transition: 'width 80ms linear' }} />
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between mt-3">
            <div className="flex items-center gap-2.5">
              <div
                className="w-8 h-8 flex items-center justify-center serif-i text-sm"
                style={{ borderRadius: '46% 54% 52% 48% / 48% 46% 54% 52%', background: BONE, color: INK }}
              >
                c
              </div>
              <div className="sans">
                <span className="text-[12px] font-medium tracking-wide" style={{ color: BONE }}>cinderandsilk.tea</span>
                <span className="text-[11px] ml-2" style={{ color: 'rgba(236,227,211,0.55)' }}>2h</span>
              </div>
            </div>
            <MoreHorizontal size={18} style={{ color: 'rgba(236,227,211,0.7)' }} />
          </div>
        </div>

        {/* SCROLL CANVAS */}
        <div ref={scrollRef} className="no-bar h-full overflow-y-scroll snap-y snap-mandatory">

          {/* ——— 01 · HERO SPLIT ——— */}
          <section className="relative h-full snap-start flex">
            <Seam />
            {/* dark half */}
            <div className="w-1/2 h-full relative flex flex-col justify-between px-5 pt-20 pb-24" style={{ background: INK }}>
              <Reveal root={scrollRef} delay={0.15}>
                <p className="sans text-[10px] tracking-[0.34em] uppercase" style={{ color: SMOKE }}>
                  No. 07 — A first pour
                </p>
              </Reveal>
              <Reveal root={scrollRef} delay={0.45} className="flex-1 flex items-center">
                <h1 className="vert serif-r font-light leading-none" style={{ color: BONE, fontSize: 'clamp(2.6rem, 9vh, 4.4rem)', letterSpacing: '0.06em' }}>
                  Cinder <span className="serif-i" style={{ color: CLAY }}>&</span> Silk
                </h1>
              </Reveal>
              <Reveal root={scrollRef} delay={0.7}>
                <div className="enso w-14 h-14 drift" style={{ borderColor: ROSE }} />
              </Reveal>
            </div>
            {/* light half */}
            <div className="w-1/2 h-full relative flex flex-col justify-end" style={{ background: BONE }}>
              <Reveal root={scrollRef} delay={0.55} className="absolute top-[18%] -left-3 right-4">
                <div className="relative">
                  <img
                    src="https://images.unsplash.com/photo-1544787219-7f47ccb76574?w=600&h=760&fit=crop"
                    alt="steeping tea"
                    className="img-wabi w-full object-cover"
                    style={{ height: '38vh', maxHeight: 320, borderRadius: '2px 60px 2px 2px' }}
                  />
                  <div className="steam absolute -top-8 left-1/2 flex">
                    <span /><span /><span />
                  </div>
                </div>
              </Reveal>
              <Reveal root={scrollRef} delay={0.85} className="px-5 pb-24">
                <p className="serif-i text-[19px] leading-snug" style={{ color: INK }}>
                  “something is steeping
                  <br />
                  in the dark.”
                </p>
                <p className="sans text-[10px] tracking-[0.28em] uppercase mt-3" style={{ color: ROSE }}>
                  keep going ↓
                </p>
              </Reveal>
            </div>
          </section>

          {/* ——— 02 · PULL QUOTE, INVERTED SPLIT ——— */}
          <section className="relative h-full snap-start flex">
            <Seam />
            <div className="w-1/2 h-full" style={{ background: BONE }} />
            <div className="w-1/2 h-full" style={{ background: '#2a221a' }} />
            <div className="absolute inset-0 flex flex-col justify-center px-7">
              <Reveal root={scrollRef} delay={0.2}>
                <p className="sans text-[10px] tracking-[0.34em] uppercase mb-7" style={{ color: CLAY }}>
                  the lover’s ritual
                </p>
              </Reveal>
              <Reveal root={scrollRef} delay={0.45}>
                <h2 className="serif-i font-light leading-[1.08]" style={{ fontSize: 'clamp(2rem, 5.4vh, 2.9rem)' }}>
                  <span style={{ color: INK }}>To be held</span>
                  <br />
                  <span style={{ color: INK }}>is to be </span>
                  <span style={{ color: BONE }}>slowly,</span>
                  <br />
                  <span style={{ color: BONE }}>slowly poured.</span>
                </h2>
              </Reveal>
              <Reveal root={scrollRef} delay={0.75} className="mt-9 max-w-[78%]">
                <p className="sans text-[12.5px] leading-relaxed font-light" style={{ color: 'rgba(236,227,211,0.82)' }}>
                  We fired this tea the way affection works — unevenly, patiently,
                  leaving marks. The cracks are the point.
                </p>
              </Reveal>
              <Reveal root={scrollRef} delay={0.95} className="mt-8">
                <div className="h-px w-16" style={{ background: CLAY }} />
              </Reveal>
            </div>
          </section>

          {/* ——— 03 · PRODUCT REVEAL ——— */}
          <section className="relative h-full snap-start flex" style={{ background: INK }}>
            <Seam />
            <div className="w-1/2 h-full relative">
              <Reveal root={scrollRef} delay={0.25} className="absolute inset-y-[12%] left-0 right-0">
                <img
                  src="https://images.unsplash.com/photo-1564890369478-c89ca6d9cde9?w=640&h=1100&fit=crop"
                  alt="smoked rose hojicha leaves"
                  className="img-wabi w-full h-full object-cover"
                  style={{ borderRadius: '0 110px 0 0' }}
                />
                <div className="absolute inset-0" style={{ background: 'linear-gradient(to right, transparent 55%, rgba(34,28,22,0.55))', borderRadius: '0 110px 0 0' }} />
              </Reveal>
            </div>
            <div className="w-1/2 h-full flex flex-col justify-center pl-4 pr-5" style={{ background: '#3a2b23' }}>
              <Reveal root={scrollRef} delay={0.4}>
                <p className="sans text-[10px] tracking-[0.3em] uppercase" style={{ color: 'rgba(236,227,211,0.5)' }}>
                  introducing
                </p>
              </Reveal>
              <Reveal root={scrollRef} delay={0.6}>
                <h3 className="serif-r font-light leading-[1.05] mt-3" style={{ color: BONE, fontSize: 'clamp(1.7rem, 4.6vh, 2.5rem)' }}>
                  Smoked Rose
                  <br />
                  <span className="serif-i" style={{ color: CLAY }}>Hōjicha</span>
                </h3>
              </Reveal>
              <Reveal root={scrollRef} delay={0.8} className="mt-6 space-y-3">
                {[
                  ['leaf', 'autumn bancha, ember-roasted'],
                  ['petal', 'wild damask rose, sun-bruised'],
                  ['finish', 'warm clay · soft smoke · skin'],
                ].map(([k, v]) => (
                  <div key={k} className="flex items-baseline gap-3">
                    <span className="sans text-[10px] uppercase tracking-[0.22em] w-12 shrink-0" style={{ color: ROSE }}>{k}</span>
                    <span className="sans text-[12px] font-light" style={{ color: 'rgba(236,227,211,0.85)' }}>{v}</span>
                  </div>
                ))}
              </Reveal>
              <Reveal root={scrollRef} delay={1.0} className="mt-8">
                <p className="serif-i text-[17px]" style={{ color: BONE }}>¥ 3,400 — 40 g, 280 jars</p>
              </Reveal>
            </div>
          </section>

          {/* ——— 04 · THE IMPERFECTION ——— */}
          <section className="relative h-full snap-start flex">
            <Seam />
            <div className="w-1/2 h-full flex flex-col justify-center px-5 pt-16" style={{ background: BONE }}>
              <Reveal root={scrollRef} delay={0.2}>
                <span className="serif-r font-light" style={{ fontSize: '4.6rem', color: CLAY, lineHeight: 1 }}>04</span>
              </Reveal>
              <Reveal root={scrollRef} delay={0.45} className="mt-5">
                <p className="serif-i text-[20px] leading-snug" style={{ color: INK }}>
                  “No two roasts
                  <br />
                  match. We stopped
                  <br />
                  trying years ago.”
                </p>
              </Reveal>
              <Reveal root={scrollRef} delay={0.7} className="mt-6">
                <p className="sans text-[11.5px] leading-relaxed font-light" style={{ color: SMOKE }}>
                  Each kiln batch keeps its own scar — a deeper char, a sweeter
                  bruise. Your jar is numbered by hand, in iron-gall ink.
                </p>
              </Reveal>
            </div>
            <div className="w-1/2 h-full relative" style={{ background: '#241e18' }}>
              <Reveal root={scrollRef} delay={0.5} className="absolute top-[16%] left-4 right-0">
                <img
                  src="https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=600&h=720&fit=crop"
                  alt="hand thrown tea cup"
                  className="img-wabi w-full object-cover"
                  style={{ height: '34vh', maxHeight: 300, borderRadius: '90px 0 0 0' }}
                />
              </Reveal>
              <Reveal root={scrollRef} delay={0.8} className="absolute bottom-[18%] left-7 right-6">
                <div className="flex items-center gap-3">
                  <div className="enso w-9 h-9" style={{ borderColor: CLAY }} />
                  <p className="sans text-[10px] tracking-[0.26em] uppercase" style={{ color: 'rgba(236,227,211,0.6)' }}>
                    kiln batch · 07-α
                  </p>
                </div>
              </Reveal>
            </div>
          </section>

          {/* ——— 05 · CTA ——— */}
          <section className="relative h-full snap-start flex" style={{ background: INK }}>
            <Seam />
            <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
              <Reveal root={scrollRef} delay={0.2}>
                <div className="enso w-20 h-20 drift mx-auto" style={{ borderColor: ROSE }} />
              </Reveal>
              <Reveal root={scrollRef} delay={0.45} className="mt-8">
                <p className="sans text-[10px] tracking-[0.36em] uppercase" style={{ color: CLAY }}>
                  pours friday · 19:00 jst
                </p>
              </Reveal>
              <Reveal root={scrollRef} delay={0.65} className="mt-4">
                <h4 className="serif-i font-light leading-tight" style={{ color: BONE, fontSize: 'clamp(1.9rem, 5vh, 2.7rem)' }}>
                  Come closer.
                  <br />
                  Be poured first.
                </h4>
              </Reveal>
              <Reveal root={scrollRef} delay={0.9} className="mt-9 w-full flex justify-center">
                <button
                  className="sans text-[12px] tracking-[0.22em] uppercase px-8 py-3 transition-colors duration-300"
                  style={{
                    color: INK,
                    background: BONE,
                    borderRadius: '2px 22px 2px 22px',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = CLAY; e.currentTarget.style.color = BONE; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = BONE; e.currentTarget.style.color = INK; }}
                >
                  reserve your jar
                </button>
              </Reveal>
              <Reveal root={scrollRef} delay={1.1} className="mt-10 flex flex-col items-center gap-1">
                <ChevronUp size={16} style={{ color: SMOKE }} />
                <p className="sans text-[10px] tracking-[0.3em] uppercase" style={{ color: SMOKE }}>
                  swipe up
                </p>
              </Reveal>
            </div>
          </section>
        </div>

        {/* STORY FOOTER */}
        <div className="absolute bottom-0 inset-x-0 z-50 px-4 pb-4 pt-8 flex items-center gap-3"
          style={{ background: 'linear-gradient(to top, rgba(21,17,13,0.8), transparent)' }}>
          <div
            className="flex-1 sans text-[12px] font-light px-4 py-2.5"
            style={{ border: '1px solid rgba(236,227,211,0.35)', borderRadius: '999px', color: 'rgba(236,227,211,0.6)' }}
          >
            Send a quiet message…
          </div>
          <Heart size={20} style={{ color: BONE }} />
          <Send size={20} style={{ color: BONE }} />
        </div>
      </div>
    </div>
  );
}