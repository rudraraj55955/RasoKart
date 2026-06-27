type ServiceItem = {
  icon: string;
  title: string;
  desc?: string;
  status?: "Active" | "Coming Soon";
};

type TierItem = {
  name: string;
  desc: string;
  popular?: boolean;
  features: string[];
  cta: string;
};

const coreServices: ServiceItem[] = [
  { icon: "📱", title: "Mobile Recharge" },
  { icon: "📺", title: "DTH Recharge" },
  { icon: "📡", title: "Data Card Recharge" },
  { icon: "☎️", title: "Postpaid Bill" },
  { icon: "📞", title: "Landline Bill" },
  { icon: "⚡", title: "Electricity Bill" },
  { icon: "🔥", title: "Gas Bill" },
  { icon: "💧", title: "Water Bill" },
  { icon: "🛡️", title: "Insurance Premium" },
  { icon: "💸", title: "Money Transfer" },
  { icon: "🏦", title: "AEPS" },
  { icon: "🧾", title: "BBPS" },
  { icon: "🚗", title: "FASTag Recharge" },
  { icon: "✈️", title: "Flight Booking" },
  { icon: "🏨", title: "Hotel Booking" },
  { icon: "🚌", title: "Bus Booking" },
  { icon: "🎁", title: "Gift Vouchers" },
  { icon: "🏅", title: "Digital Gold" },
  { icon: "✅", title: "KYC Verification" },
  { icon: "📲", title: "UPI Collection" },
  { icon: "💳", title: "Payment Gateway" },
  { icon: "💼", title: "Prepaid Cards" },
];

const apiServices: ServiceItem[] = [
  { icon: "📱", title: "Recharge API", desc: "Mobile, DTH and data recharge APIs for merchant platforms." },
  { icon: "🧾", title: "BBPS API", desc: "Utility bill collection APIs with clean reporting and callbacks." },
  { icon: "💸", title: "Money Transfer API", desc: "Bank transfer workflows with transaction tracking and status logs." },
  { icon: "🚗", title: "FASTag API", desc: "FASTag recharge and balance workflows for customer portals." },
  { icon: "✈️", title: "Flight Booking API", desc: "Travel service APIs ready for white-label distribution." },
  { icon: "🏨", title: "Hotel Booking API", desc: "Hotel inventory and booking flow integration for partners." },
  { icon: "🚌", title: "Bus Booking API", desc: "Bus booking services for agents, merchants and customer apps." },
  { icon: "📲", title: "UPI Collection API", desc: "Dynamic QR, collect requests, intent links and webhook tracking." },
  { icon: "💳", title: "Payment Gateway API", desc: "Payin checkout, payment links and transaction dashboard." },
  { icon: "🏦", title: "Payout API", desc: "Single and bulk payout workflows with approval controls." },
  { icon: "🏛️", title: "Virtual Account API", desc: "Collection accounts with automated reconciliation and reporting." },
  { icon: "✅", title: "KYC API", desc: "Verification workflows for onboarding and risk checks." },
];

const profitCards: ServiceItem[] = [
  { icon: "🏷️", title: "100% Your Brand", desc: "Your logo, domain, colour scheme and customer-facing portal." },
  { icon: "⚡", title: "Ready in 7 Days", desc: "Launch with ready service modules, app shell and admin operations." },
  { icon: "💰", title: "Low Investment", desc: "Start with a complete fintech stack without building from scratch." },
  { icon: "👥", title: "Manage Your Network", desc: "Retailers, distributors, sub-agents, roles and wallet controls." },
  { icon: "📊", title: "Real-time Analytics", desc: "Live transactions, service performance, commissions and reports." },
  { icon: "🔐", title: "Bank-grade Security", desc: "Secure access, audit logs, webhooks and operational controls." },
];

const tiers: TierItem[] = [
  {
    name: "Retailer",
    desc: "For individual entrepreneurs and shop owners.",
    cta: "Get Started →",
    features: [
      "All 20+ services enabled",
      "Branded Android app",
      "Customer-facing portal",
      "Commission on every transaction",
      "24/7 support access",
    ],
  },
  {
    name: "Distributor",
    desc: "For regional operators managing a network.",
    popular: true,
    cta: "Apply Now",
    features: [
      "Everything in Retailer",
      "Multi-level agent management panel",
      "Custom domain",
      "Custom commission sharing rules",
      "Bulk wallet top-up tools",
      "Priority onboarding support",
    ],
  },
  {
    name: "Enterprise",
    desc: "For large fintech and service operators.",
    cta: "Contact Sales →",
    features: [
      "Everything in Distributor",
      "iOS + Android branded apps",
      "Dedicated API access",
      "Full white-label admin console",
      "Custom feature development",
      "Dedicated account manager",
    ],
  },
];

const steps: ServiceItem[] = [
  { icon: "01", title: "Apply & Onboard", desc: "Submit onboarding details and complete business verification flow." },
  { icon: "02", title: "Brand Configuration", desc: "Configure logo, colour theme, domain, modules and app experience." },
  { icon: "03", title: "Wallet & Commission Setup", desc: "Define wallets, limits, service access and commission rules." },
  { icon: "04", title: "Go Live & Earn", desc: "Launch portal, add merchants and track every transaction from dashboard." },
];

const audience: ServiceItem[] = [
  { icon: "🏪", title: "Retail Shops", desc: "Local shops and mobile stores offering digital services." },
  { icon: "📦", title: "Distributors", desc: "Regional operators building retailer networks." },
  { icon: "🏛️", title: "Business Correspondents", desc: "Field service operators and assisted digital platforms." },
  { icon: "💻", title: "Tech Startups", desc: "Teams launching fintech products without building infrastructure." },
  { icon: "🏢", title: "NBFCs & MFIs", desc: "Financial institutions needing branded collection platforms." },
  { icon: "🤝", title: "Travel Agents", desc: "Agents bundling flights, hotels and financial services." },
];

const footerColumns = [
  ["Payments", ["BBPS Bill Payment", "Payment Gateway", "UPI Collection", "QR Code & UPI ID", "Payout API", "Virtual Account", "AEPS Services", "FASTag Services"]],
  ["Utility APIs", ["Recharge API", "Metro Card API", "E-Challan API", "MNP Lookup API", "Tariff Plan API", "DTH Info API", "KYC Verification", "Digital Gold", "Gift Vouchers"]],
  ["Travel", ["Flight Booking", "Train Booking", "Bus Booking", "Hotel Booking Solutions"]],
  ["Developers", ["API Documentation", "API Reference", "Postman Collection", "Sandbox Guide", "Webhooks Docs", "Changelog", "Console Login"]],
  ["Company", ["About RasoKart", "Contact Us", "Partner Program", "Legal", "Terms of Service", "Privacy Policy", "Refund Policy"]],
];

function chipsHtml(items: ServiceItem[]) {
  return items.map((item) => `
    <span class="rk-service-chip">
      <span>${item.icon}</span>
      <span>${item.title}</span>
    </span>
  `).join("");
}

function cardsHtml(items: ServiceItem[], className = "") {
  return items.map((item) => `
    <article class="rk-eco-card ${className}">
      <div class="rk-card-icon">${item.icon}</div>
      <h3>${item.title}</h3>
      ${item.desc ? `<p>${item.desc}</p>` : ""}
    </article>
  `).join("");
}

function tierHtml() {
  return tiers.map((tier) => `
    <article class="rk-tier-card ${tier.popular ? "rk-tier-popular" : ""}">
      ${tier.popular ? `<span class="rk-popular">Most Popular</span>` : ""}
      <h3>${tier.name}</h3>
      <p>${tier.desc}</p>
      <ul>
        ${tier.features.map((f) => `<li>✓ ${f}</li>`).join("")}
      </ul>
      <a class="rk-tier-btn" href="/merchant">${tier.cta}</a>
    </article>
  `).join("");
}

function stepsHtml() {
  return steps.map((step) => `
    <article class="rk-step-card">
      <span>${step.icon}</span>
      <div>
        <h3>${step.title}</h3>
        <p>${step.desc}</p>
      </div>
    </article>
  `).join("");
}

function footerHtml() {
  return footerColumns.map(([title, links]) => `
    <div class="rk-footer-col">
      <h4>${title}</h4>
      ${(links as string[]).map((link) => `<a href="#">${link}</a>`).join("")}
    </div>
  `).join("");
}

function ecosystemHtml() {
  return `
    <section id="rk-services-ecosystem" class="rk-ecosystem">
      <div class="rk-eco-wrap">
        <div class="rk-eco-heading">
          <span class="rk-kicker">What's Included</span>
          <h2>One Platform. <span>20+ Services.</span></h2>
          <p>Everything your customers need in one branded RasoKart portal — fully operational from day one.</p>
        </div>

        <div class="rk-chip-cloud">
          ${chipsHtml(coreServices)}
        </div>

        <div class="rk-eco-heading rk-heading-space">
          <span class="rk-kicker">Why White-label?</span>
          <h2>Built to Make Your <span>Business Profitable</span></h2>
        </div>

        <div class="rk-card-grid">
          ${cardsHtml(profitCards)}
        </div>

        <div class="rk-eco-heading rk-heading-space">
          <span class="rk-kicker">Partner Tiers</span>
          <h2>Choose Your <span>Partnership Level</span></h2>
        </div>

        <div class="rk-tier-grid">
          ${tierHtml()}
        </div>

        <div class="rk-two-col rk-heading-space">
          <div>
            <span class="rk-kicker">How It Works</span>
            <h2>Launch in <span>4 Simple Steps</span></h2>
            <div class="rk-step-list">${stepsHtml()}</div>
          </div>

          <div>
            <span class="rk-kicker">Who It's For</span>
            <h2>Built for Every <span>Service Network</span></h2>
            <div class="rk-audience-grid">${cardsHtml(audience, "rk-small-card")}</div>
          </div>
        </div>

        <div class="rk-eco-heading rk-heading-space">
          <span class="rk-kicker">Platform Services</span>
          <h2>Power Your Platform with <span>RasoKart APIs</span></h2>
        </div>

        <div class="rk-api-grid">
          ${cardsHtml(apiServices)}
        </div>

        <div class="rk-big-cta">
          <div>
            <h2>Launch Your Branded Fintech Platform Today</h2>
            <p>20+ services, branded portal, app-ready experience and unified RasoKart dashboard.</p>
          </div>
          <div class="rk-cta-actions">
            <a href="/merchant">🚀 Apply Now</a>
            <a href="/admin">Talk to Sales →</a>
          </div>
        </div>

        <div class="rk-footer-cta">
          <div>
            <h3>Ready to power your payments?</h3>
            <p>Start with RasoKart sandbox, API docs and a complete service ecosystem.</p>
          </div>
          <div class="rk-cta-actions">
            <a href="/merchant">🚀 Start Building</a>
            <a href="/api-docs">📄 API Docs →</a>
          </div>
        </div>

        <footer class="rk-public-footer">
          <div class="rk-footer-brand">
            <h3>RasoKart</h3>
            <p>White-label payment infrastructure and service platform for merchants, distributors and fintech operators.</p>
          </div>
          <div class="rk-footer-grid">
            ${footerHtml()}
          </div>
          <div class="rk-footer-bottom">
            <span>© 2026 RasoKart. All rights reserved.</span>
            <span>Terms · Privacy · Refunds · Contact</span>
          </div>
        </footer>
      </div>
    </section>
  `;
}

function isAllowedPath() {
  return ["/", "/upi-collection-api", "/whitelabel-solutions"].includes(window.location.pathname);
}

function injectEcosystem() {
  const old = document.getElementById("rk-services-ecosystem");
  if (!isAllowedPath()) {
    old?.remove();
    return;
  }

  if (old) return;

  const main = document.querySelector("main") || document.getElementById("root");
  if (!main) return;

  const host = document.createElement("div");
  host.innerHTML = ecosystemHtml();

  const section = host.firstElementChild;
  if (!section) return;

  main.appendChild(section);
}

function startServicesEcosystem() {
  injectEcosystem();

  const originalPushState = history.pushState;
  history.pushState = function (...args) {
    originalPushState.apply(this, args);
    setTimeout(injectEcosystem, 150);
  };

  window.addEventListener("popstate", () => setTimeout(injectEcosystem, 150));

  const observer = new MutationObserver(() => injectEcosystem());
  observer.observe(document.body, { childList: true, subtree: true });

  setTimeout(injectEcosystem, 300);
  setTimeout(injectEcosystem, 1000);
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startServicesEcosystem, { once: true });
  } else {
    startServicesEcosystem();
  }
}

export {};
