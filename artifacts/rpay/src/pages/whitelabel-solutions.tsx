import React from "react";

const services = [
  "Mobile Recharge", "DTH Recharge", "Data Card Recharge", "Postpaid Bill",
  "Landline Bill", "Electricity Bill", "Gas Bill", "Water Bill",
  "Insurance Premium", "Money Transfer", "AEPS", "BBPS",
  "FASTag Recharge", "Flight Booking", "Hotel Booking", "Bus Booking",
  "Gift Vouchers", "Digital Gold", "KYC Verification", "UPI Collection",
  "Payment Gateway", "Prepaid Cards", "QR Code & UPI", "Payout API",
  "Virtual Account", "Settlement API", "Webhook API", "Merchant API"
];

const benefits = [
  ["🏷️", "100% Your Brand", "Your logo, domain, colour scheme and complete customer experience under RasoKart white-label structure."],
  ["⚡", "Ready to Launch", "Start with a ready fintech platform instead of building everything from scratch."],
  ["💰", "Low Investment", "Launch services, manage merchants and grow revenue without heavy infrastructure cost."],
  ["👥", "Manage Network", "Create merchant, agent, distributor and retailer hierarchy with role-based access."],
  ["📊", "Real-time Analytics", "Track collections, payouts, commissions, settlements and service-wise performance."],
  ["🔐", "Security First", "Webhook logs, API keys, activity logs, admin controls and white-label privacy rules."]
];

const tiers = [
  {
    name: "Retailer",
    text: "For shop owners and individual operators.",
    items: ["20+ services enabled", "Customer-facing portal", "Branded Android WebView app", "Commission tracking", "Support access"],
    cta: "Get Started"
  },
  {
    name: "Distributor",
    text: "For regional operators managing retailers and agents.",
    popular: true,
    items: ["Everything in Retailer", "Agent management panel", "Custom commission sharing", "Wallet top-up tools", "Priority onboarding"],
    cta: "Apply Now"
  },
  {
    name: "Enterprise",
    text: "For fintech operators and large merchant networks.",
    items: ["Everything in Distributor", "Dedicated API access", "White-label admin console", "Custom feature development", "Account manager"],
    cta: "Contact Sales"
  }
];

const steps = [
  ["01", "Apply & Onboard", "Submit your business details, KYC and required onboarding information."],
  ["02", "Brand Configuration", "Set logo, colour theme, domain, service visibility and admin permissions."],
  ["03", "Wallet & Commission Setup", "Configure wallet limits, settlement rules, service charges and commission slabs."],
  ["04", "Go Live & Earn", "Launch portal, onboard merchants/agents and monitor transactions from dashboard."]
];

const apiServices = [
  ["📱", "Recharge API", "Mobile, DTH and data card recharge services."],
  ["📄", "BBPS API", "Bill payment services for electricity, gas, water and other billers."],
  ["💸", "Money Transfer API", "Bank transfer, payout and wallet movement workflows."],
  ["🚗", "FASTag API", "Recharge and balance check structure for FASTag services."],
  ["✈️", "Travel API", "Flight, hotel and bus booking service modules."],
  ["🔐", "Payment Gateway", "Cards, UPI, QR, payment links, webhooks and dashboard."]
];

export default function WhitelabelSolutionsPage() {
  return (
    <main className="wl-page">
      <style>{`
        .wl-page {
          min-height: 100vh;
          background:
            radial-gradient(circle at 15% 0%, rgba(98, 92, 255, .16), transparent 32rem),
            radial-gradient(circle at 85% 12%, rgba(34, 211, 238, .14), transparent 30rem),
            linear-gradient(180deg, #050817 0%, #070b18 45%, #050712 100%);
          color: #eef6ff;
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .wl-wrap { width: min(1120px, calc(100% - 28px)); margin: 0 auto; }
        .wl-nav {
          position: sticky; top: 0; z-index: 50;
          background: rgba(5, 8, 20, .82);
          backdrop-filter: blur(18px);
          border-bottom: 1px solid rgba(148,163,184,.12);
        }
        .wl-nav-in { height: 72px; display:flex; align-items:center; justify-content:space-between; gap:16px; }
        .wl-brand { display:flex; align-items:center; gap:10px; color:white; text-decoration:none; font-weight:900; }
        .wl-logo {
          width:38px; height:38px; border-radius:14px; display:grid; place-items:center;
          background: linear-gradient(135deg,#24f0c8,#5b7cff); box-shadow:0 18px 50px rgba(36,240,200,.22);
          color:#03111d; font-weight:1000;
        }
        .wl-menu { display:flex; gap:8px; padding:6px; border-radius:999px; border:1px solid rgba(148,163,184,.16); background:rgba(15,23,42,.72); }
        .wl-menu a, .wl-actions a { color:#b8c6dd; text-decoration:none; font-size:13px; font-weight:800; padding:10px 14px; border-radius:999px; }
        .wl-menu a:hover, .wl-actions a:hover { background:rgba(255,255,255,.06); color:white; }
        .wl-actions { display:flex; align-items:center; gap:8px; }
        .wl-primary {
          color:#03111d !important; background:linear-gradient(135deg,#2ff5c8,#6d7cff) !important;
          box-shadow:0 16px 44px rgba(47,245,200,.26);
        }
        .wl-hero { padding:86px 0 70px; text-align:center; border-bottom:1px solid rgba(148,163,184,.08); }
        .wl-crumb { color:#7c8aa4; font-size:13px; margin-bottom:18px; }
        .wl-badge {
          display:inline-flex; gap:8px; align-items:center; padding:8px 13px; border-radius:999px;
          border:1px solid rgba(139,92,246,.28); color:#c4b5fd; background:rgba(88,28,135,.18);
          font-size:12px; font-weight:900; letter-spacing:.08em; text-transform:uppercase;
        }
        .wl-title {
          max-width:850px; margin:18px auto 0; font-size:clamp(42px,7vw,78px);
          line-height:.95; letter-spacing:-.06em; font-weight:950;
        }
        .wl-grad { background:linear-gradient(135deg,#6d7cff,#22d3ee,#ec4899); -webkit-background-clip:text; color:transparent; }
        .wl-sub { max-width:760px; margin:22px auto 0; color:#aab6cc; line-height:1.75; font-size:18px; }
        .wl-cta { margin-top:30px; display:flex; justify-content:center; gap:12px; flex-wrap:wrap; }
        .wl-btn {
          min-height:48px; padding:0 20px; display:inline-flex; align-items:center; justify-content:center; gap:9px;
          border-radius:999px; border:1px solid rgba(148,163,184,.18); background:rgba(15,23,42,.76);
          color:#eef6ff; text-decoration:none; font-weight:900; font-size:14px;
        }
        .wl-section { padding:68px 0; }
        .wl-head { text-align:center; max-width:780px; margin:0 auto 32px; }
        .wl-kicker { color:#22d3ee; text-transform:uppercase; letter-spacing:.18em; font-size:12px; font-weight:1000; }
        .wl-h2 { margin:8px 0 0; font-size:clamp(30px,4.8vw,54px); line-height:1.05; letter-spacing:-.05em; }
        .wl-muted { color:#a3afc4; line-height:1.7; }
        .wl-split { display:grid; grid-template-columns:1fr .9fr; gap:34px; align-items:center; }
        .wl-stats { display:grid; grid-template-columns:repeat(2,1fr); gap:14px; }
        .wl-stat {
          border:1px solid rgba(148,163,184,.16); border-radius:22px; padding:26px;
          background:linear-gradient(180deg,rgba(15,23,42,.92),rgba(10,15,30,.86));
          box-shadow:0 22px 80px rgba(0,0,0,.22);
        }
        .wl-stat strong { display:block; font-size:38px; color:#32f5c8; letter-spacing:-.05em; }
        .wl-stat span { color:#a3afc4; font-weight:800; }
        .wl-chips { display:flex; flex-wrap:wrap; justify-content:center; gap:10px; }
        .wl-chip {
          padding:10px 14px; border-radius:999px; border:1px solid rgba(148,163,184,.16);
          background:rgba(15,23,42,.78); color:#c8d5ea; font-weight:850; font-size:13px;
        }
        .wl-grid-3 { display:grid; grid-template-columns:repeat(3,1fr); gap:18px; }
        .wl-card {
          position:relative; overflow:hidden; border:1px solid rgba(148,163,184,.14); border-radius:24px; padding:28px;
          background:radial-gradient(circle at 0% 0%,rgba(34,211,238,.13),transparent 16rem),linear-gradient(180deg,rgba(15,23,42,.9),rgba(9,14,28,.92));
          box-shadow:0 20px 70px rgba(0,0,0,.24);
        }
        .wl-card h3 { margin:12px 0 10px; font-size:21px; }
        .wl-card p { margin:0; color:#a4b0c6; line-height:1.65; }
        .wl-icon { width:44px; height:44px; border-radius:15px; display:grid; place-items:center; background:rgba(34,211,238,.11); font-size:24px; }
        .wl-tiers .wl-card { min-height:360px; }
        .wl-popular { position:absolute; right:22px; top:20px; font-size:11px; font-weight:1000; color:white; background:linear-gradient(135deg,#6d7cff,#a855f7); padding:7px 10px; border-radius:999px; }
        .wl-list { display:grid; gap:12px; margin:22px 0 26px; padding:0; list-style:none; }
        .wl-list li { color:#cbd7eb; font-size:14px; }
        .wl-list li::before { content:"✓"; color:#32f5c8; margin-right:9px; font-weight:1000; }
        .wl-steps { display:grid; gap:14px; }
        .wl-step { display:grid; grid-template-columns:48px 1fr; gap:16px; align-items:flex-start; padding:20px; border-radius:20px; border:1px solid rgba(148,163,184,.14); background:rgba(15,23,42,.72); }
        .wl-step b { display:grid; place-items:center; width:48px; height:48px; border-radius:16px; background:linear-gradient(135deg,#6d7cff,#22d3ee); color:#06111f; }
        .wl-cta-box {
          display:flex; justify-content:space-between; align-items:center; gap:24px; border:1px solid rgba(34,211,238,.18);
          border-radius:28px; padding:38px; background:radial-gradient(circle at 10% 0%,rgba(34,211,238,.18),transparent 22rem),rgba(15,23,42,.78);
        }
        .wl-footer { padding:52px 0 28px; background:rgba(10,15,30,.58); border-top:1px solid rgba(148,163,184,.12); }
        .wl-foot-grid { display:grid; grid-template-columns:1.2fr repeat(4,1fr); gap:28px; }
        .wl-foot-grid h4 { margin:0 0 14px; color:#dbeafe; }
        .wl-foot-grid a, .wl-foot-grid p { display:block; color:#9da9bd; text-decoration:none; margin:9px 0; font-size:14px; line-height:1.6; }
        @media(max-width:900px){
          .wl-menu{display:none}.wl-split,.wl-foot-grid{grid-template-columns:1fr}.wl-grid-3{grid-template-columns:repeat(2,1fr)}.wl-cta-box{flex-direction:column;align-items:flex-start}
        }
        @media(max-width:620px){
          .wl-wrap{width:min(100% - 22px,1120px)}.wl-actions a:not(.wl-primary){display:none}.wl-hero{padding:56px 0}.wl-grid-3,.wl-stats{grid-template-columns:1fr}.wl-card{padding:22px}
        }
      `}</style>

      <nav className="wl-nav">
        <div className="wl-wrap wl-nav-in">
          <a className="wl-brand" href="/"><span className="wl-logo">RK</span><span>RasoKart</span></a>
          <div className="wl-menu">
            <a href="/">Home</a><a href="/whitelabel-solutions">Solutions</a><a href="/upi-collection-api">UPI API</a><a href="/api-docs">Docs</a>
          </div>
          <div className="wl-actions"><a href="/login">Login</a><a className="wl-primary" href="/login">Get Started</a></div>
        </div>
      </nav>

      <section className="wl-hero">
        <div className="wl-wrap">
          <div className="wl-crumb">Home › Solutions › White-label Platform</div>
          <span className="wl-badge">White-label fintech platform</span>
          <h1 className="wl-title">Launch Your Own <span className="wl-grad">Fintech Brand</span></h1>
          <p className="wl-sub">
            RasoKart gives you a branded fintech platform with recharge, bill payments, money transfer,
            UPI collection, payout, booking and merchant services under your own business structure.
          </p>
          <div className="wl-cta">
            <a className="wl-btn wl-primary" href="/login">🚀 Apply Now</a>
            <a className="wl-btn" href="/login">Login to Console →</a>
          </div>
        </div>
      </section>

      <section className="wl-section">
        <div className="wl-wrap wl-split">
          <div>
            <div className="wl-kicker">What is white-label?</div>
            <h2 className="wl-h2">Your Brand. <span className="wl-grad">Our Technology.</span> Your Profit.</h2>
            <p className="wl-muted">
              Offer financial services to your customers without building the platform from zero.
              RasoKart powers the technology, while customers see your brand, your portal and your service experience.
            </p>
          </div>
          <div className="wl-stats">
            <div className="wl-stat"><strong>20+</strong><span>Services included</span></div>
            <div className="wl-stat"><strong>Fast</strong><span>Go-live workflow</span></div>
            <div className="wl-stat"><strong>100%</strong><span>Your brand</span></div>
            <div className="wl-stat"><strong>Admin</strong><span>Full control panel</span></div>
          </div>
        </div>
      </section>

      <section className="wl-section">
        <div className="wl-wrap">
          <div className="wl-head">
            <div className="wl-kicker">What's included</div>
            <h2 className="wl-h2">One Platform. <span className="wl-grad">20+ Services.</span></h2>
            <p className="wl-muted">Everything customers need in one branded portal and APK-ready WebView experience.</p>
          </div>
          <div className="wl-chips">{services.map((s) => <span className="wl-chip" key={s}>{s}</span>)}</div>
        </div>
      </section>

      <section className="wl-section">
        <div className="wl-wrap">
          <div className="wl-head"><div className="wl-kicker">Why white-label?</div><h2 className="wl-h2">Built to Make Your <span className="wl-grad">Business Profitable</span></h2></div>
          <div className="wl-grid-3">
            {benefits.map(([icon,title,text]) => <article className="wl-card" key={title}><div className="wl-icon">{icon}</div><h3>{title}</h3><p>{text}</p></article>)}
          </div>
        </div>
      </section>

      <section className="wl-section wl-tiers">
        <div className="wl-wrap">
          <div className="wl-head"><div className="wl-kicker">Partner tiers</div><h2 className="wl-h2">Choose Your <span className="wl-grad">Partnership Level</span></h2></div>
          <div className="wl-grid-3">
            {tiers.map((tier) => (
              <article className="wl-card" key={tier.name}>
                {tier.popular ? <span className="wl-popular">MOST POPULAR</span> : null}
                <h3>{tier.name}</h3><p>{tier.text}</p>
                <ul className="wl-list">{tier.items.map((i) => <li key={i}>{i}</li>)}</ul>
                <a className={tier.popular ? "wl-btn wl-primary" : "wl-btn"} href="/login">{tier.cta} →</a>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="wl-section">
        <div className="wl-wrap wl-split">
          <div>
            <div className="wl-kicker">How it works</div>
            <h2 className="wl-h2">Launch in <span className="wl-grad">4 Simple Steps</span></h2>
            <div className="wl-steps">
              {steps.map(([n,t,d]) => <div className="wl-step" key={n}><b>{n}</b><div><h3>{t}</h3><p className="wl-muted">{d}</p></div></div>)}
            </div>
          </div>
          <div>
            <div className="wl-kicker">Who it's for</div>
            <div className="wl-grid-3" style={{gridTemplateColumns:"repeat(2,1fr)", marginTop:16}}>
              {["Retail Shops","Distributors","Business Correspondents","Tech Startups","NBFCs & MFIs","Travel Agents"].map((x) => <article className="wl-card" key={x}><h3>{x}</h3><p>Manage services, customers, commissions and operations from RasoKart console.</p></article>)}
            </div>
          </div>
        </div>
      </section>

      <section className="wl-section">
        <div className="wl-wrap">
          <div className="wl-head"><div className="wl-kicker">Platform services</div><h2 className="wl-h2">Power Your Platform with <span className="wl-grad">RasoKart APIs</span></h2></div>
          <div className="wl-grid-3">
            {apiServices.map(([icon,title,text]) => <article className="wl-card" key={title}><div className="wl-icon">{icon}</div><h3>{title}</h3><p>{text}</p></article>)}
          </div>
        </div>
      </section>

      <section className="wl-section">
        <div className="wl-wrap">
          <div className="wl-cta-box">
            <div><h2>Launch your branded fintech platform today</h2><p className="wl-muted">20+ services, your brand, admin controls, APK-ready structure and merchant-ready dashboard.</p></div>
            <div className="wl-cta"><a className="wl-btn wl-primary" href="/login">🚀 Apply Now</a><a className="wl-btn" href="/api-docs">API Docs →</a></div>
          </div>
        </div>
      </section>

      <footer className="wl-footer">
        <div className="wl-wrap wl-foot-grid">
          <div><a className="wl-brand" href="/"><span className="wl-logo">RK</span><span>RasoKart</span></a><p>White-label payment, collection, payout and fintech service platform for merchants and partners.</p></div>
          <div><h4>Payments</h4><a>Payment Gateway</a><a>UPI Collection</a><a>QR Code & UPI</a><a>Payout API</a></div>
          <div><h4>Utility APIs</h4><a>Recharge API</a><a>BBPS API</a><a>FASTag</a><a>KYC</a></div>
          <div><h4>Travel</h4><a>Flight Booking</a><a>Hotel Booking</a><a>Bus Booking</a></div>
          <div><h4>Developers</h4><a href="/api-docs">API Docs</a><a href="/upi-collection-api">UPI API</a><a href="/login">Console Login</a></div>
        </div>
      </footer>
    </main>
  );
}
