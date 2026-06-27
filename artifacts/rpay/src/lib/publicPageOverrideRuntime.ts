type Service = { icon: string; title: string; desc?: string };

const services: Service[] = [
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

const apis: Service[] = [
  { icon: "📱", title: "Recharge API", desc: "Mobile, DTH and data recharge APIs for partner platforms." },
  { icon: "🧾", title: "BBPS API", desc: "Utility bill collection APIs with clean status tracking." },
  { icon: "💸", title: "Money Transfer API", desc: "Transfer workflows with transaction logs and callbacks." },
  { icon: "🚗", title: "FASTag API", desc: "FASTag recharge and account service workflows." },
  { icon: "✈️", title: "Flight Booking API", desc: "Travel booking service modules for branded portals." },
  { icon: "🏨", title: "Hotel Booking API", desc: "Hotel booking flow for merchants and distributors." },
  { icon: "🚌", title: "Bus Booking API", desc: "Bus booking service for customer and agent panels." },
  { icon: "📲", title: "UPI Collection API", desc: "QR, collect request, intent link and webhook tracking." },
  { icon: "💳", title: "Payment Gateway API", desc: "Payin checkout, payment links and payment reports." },
  { icon: "🏦", title: "Payout API", desc: "Single and bulk payout workflow with approval controls." },
  { icon: "🏛️", title: "Virtual Account API", desc: "Collection accounts with reconciliation reporting." },
  { icon: "✅", title: "KYC API", desc: "Verification workflow for onboarding and risk controls." },
];

const features: Service[] = [
  { icon: "🏷️", title: "100% Your Brand", desc: "Your logo, domain, colour scheme and customer-facing portal." },
  { icon: "⚡", title: "Ready in 7 Days", desc: "Launch with ready service modules and app-ready experience." },
  { icon: "💰", title: "Low Investment", desc: "Start with a full service stack without building from scratch." },
  { icon: "👥", title: "Manage Your Network", desc: "Retailers, distributors, agents, roles and wallet controls." },
  { icon: "📊", title: "Real-time Analytics", desc: "Live transactions, commissions, reports and service performance." },
  { icon: "🔐", title: "Secure Operations", desc: "Audit logs, access control, webhook logs and admin controls." },
];

function chipList() {
  return services.map((s) => `<span class="rk-chip"><b>${s.icon}</b>${s.title}</span>`).join("");
}

function cardList(items: Service[]) {
  return items.map((s) => `
    <article class="rk-card">
      <div class="rk-icon">${s.icon}</div>
      <h3>${s.title}</h3>
      ${s.desc ? `<p>${s.desc}</p>` : ""}
    </article>
  `).join("");
}

function tiers() {
  return `
    <article class="rk-tier">
      <h3>Retailer</h3>
      <p>For shops and individual entrepreneurs.</p>
      <ul>
        <li>✓ All 20+ services enabled</li>
        <li>✓ Branded Android app</li>
        <li>✓ Customer-facing portal</li>
        <li>✓ Commission on every transaction</li>
        <li>✓ 24/7 support access</li>
      </ul>
      <a href="/merchant">Get Started →</a>
    </article>
    <article class="rk-tier rk-tier-hot">
      <span>Most Popular</span>
      <h3>Distributor</h3>
      <p>For regional operators managing networks.</p>
      <ul>
        <li>✓ Everything in Retailer</li>
        <li>✓ Multi-level agent management</li>
        <li>✓ Custom domain</li>
        <li>✓ Commission sharing rules</li>
        <li>✓ Bulk wallet top-up tools</li>
        <li>✓ Priority onboarding support</li>
      </ul>
      <a href="/merchant">Apply Now</a>
    </article>
    <article class="rk-tier">
      <h3>Enterprise</h3>
      <p>For larger fintech and service operators.</p>
      <ul>
        <li>✓ Everything in Distributor</li>
        <li>✓ iOS + Android branded apps</li>
        <li>✓ Dedicated API access</li>
        <li>✓ Full white-label admin console</li>
        <li>✓ Custom feature development</li>
        <li>✓ Dedicated account manager</li>
      </ul>
      <a href="/merchant">Contact Sales →</a>
    </article>
  `;
}

function footer() {
  const cols = [
    ["Payments", ["BBPS Bill Payment", "Payment Gateway", "UPI Collection", "QR Code & UPI ID", "Payout API", "Virtual Account", "AEPS Services", "FASTag Services"]],
    ["Utility APIs", ["Recharge API", "Metro Card API", "E-Challan API", "MNP Lookup API", "Tariff Plan API", "DTH Info API", "KYC Verification", "Digital Gold"]],
    ["Travel", ["Flight Booking", "Train Booking", "Bus Booking", "Hotel Booking Solutions"]],
    ["Developers", ["API Documentation", "API Reference", "Postman Collection", "Sandbox Guide", "Webhooks Docs", "Console Login"]],
    ["Company", ["About RasoKart", "Contact Us", "Partner Program", "Legal", "Terms of Service", "Privacy Policy", "Refund Policy"]],
  ];

  return cols.map(([title, links]) => `
    <div>
      <h4>${title}</h4>
      ${(links as string[]).map((l) => `<a href="#">${l}</a>`).join("")}
    </div>
  `).join("");
}

function pageHtml(kind: "upi" | "white") {
  const isUpi = kind === "upi";
  const heroTitle = isUpi
    ? `3 Ways to <span>Collect UPI Payments</span>`
    : `Launch Your Own <span>Fintech Brand</span>`;

  const heroText = isUpi
    ? "Generate dynamic QR codes, payment requests and intent links from one clean RasoKart API. Built for fast checkout, real-time callbacks and automatic reconciliation."
    : "Launch a branded fintech platform with recharge, bill payments, money transfer, travel booking and payment services under your own business identity.";

  return `
    <div id="rk-public-page">
      <nav class="rk-nav">
        <a class="rk-brand" href="/"><span>RK</span>RasoKart</a>
        <div class="rk-nav-pill">
          <a href="/">Home</a>
          <a href="/upi-collection-api">UPI API</a>
          <a href="/api-docs">API Docs</a>
          <a href="/merchant">Login</a>
        </div>
        <div class="rk-nav-actions">
          <a href="/merchant">Login</a>
          <a class="rk-primary" href="/merchant">Get Started</a>
        </div>
      </nav>

      <header class="rk-hero">
        <div class="rk-badges">
          <span>Secure API</span><span>Instant Webhook</span><span>Fast Settlement</span><span>White-label Ready</span>
        </div>
        <h1>${heroTitle}</h1>
        <p>${heroText}</p>
        <div class="rk-actions">
          <a href="/merchant">Get API Key</a>
          <a href="/api-docs">View API Reference</a>
        </div>
      </header>

      ${isUpi ? `
      <section class="rk-section">
        <div class="rk-head">
          <span>Collection Methods</span>
          <h2>One API. <b>Multiple Collection Flows.</b></h2>
          <p>RasoKart gives merchants QR, collect request, intent link and webhook-first reporting.</p>
        </div>
        <div class="rk-grid rk-grid-3">
          ${cardList([
            { icon: "▦", title: "Dynamic QR Code", desc: "Generate secure amount-linked QR codes for every order." },
            { icon: "⚡", title: "UPI Collect Request", desc: "Create payment requests with customer details and callback URL." },
            { icon: "🔗", title: "UPI Intent / Deeplink", desc: "Open supported apps directly from web or mobile checkout." },
          ])}
        </div>
      </section>

      <section class="rk-section rk-two">
        <div class="rk-phone">
          <span>Live Payment Demo</span>
          <div class="rk-qr">▦</div>
          <h3>Scan to Pay</h3>
          <p>Dynamic QR generated by RasoKart collection API</p>
          <div><small>UPI Apps</small><small>Bank Apps</small></div>
        </div>
        <div class="rk-head rk-left">
          <span>Why RasoKart</span>
          <h2>Fast way to accept <b>payments in India</b></h2>
          <p>Clean API flows, detailed logs, webhook tracking, settlement visibility and merchant-ready reporting.</p>
          <div class="rk-stat-grid">
            <div><b>0%</b><small>MDR display configurable</small></div>
            <div><b>T+0</b><small>Settlement label configurable</small></div>
            <div><b>99.9%</b><small>Uptime SLA</small></div>
            <div><b>24/7</b><small>Webhook monitoring</small></div>
          </div>
        </div>
      </section>

      <section class="rk-section">
        <div class="rk-head">
          <span>API Reference</span>
          <h2>Request <b>Parameters</b></h2>
          <p>Create payment request with amount, customer information, reference ID and webhook URL.</p>
        </div>
        <div class="rk-api-ref">
          <div class="rk-table-wrap">
            <table>
              <thead><tr><th>Parameter</th><th>Type</th><th>Status</th><th>Description</th></tr></thead>
              <tbody>
                <tr><td>amount</td><td>number</td><td>required</td><td>Transaction amount in INR</td></tr>
                <tr><td>currency</td><td>string</td><td>required</td><td>Default value INR</td></tr>
                <tr><td>type</td><td>string</td><td>required</td><td>Dynamic QR / Collect / Intent</td></tr>
                <tr><td>order_id</td><td>string</td><td>required</td><td>Unique merchant reference</td></tr>
                <tr><td>customer_name</td><td>string</td><td>optional</td><td>Customer display name</td></tr>
                <tr><td>customer_mobile</td><td>string</td><td>optional</td><td>Customer mobile number</td></tr>
                <tr><td>webhook_url</td><td>string</td><td>required</td><td>Merchant callback URL</td></tr>
              </tbody>
            </table>
          </div>
          <pre>{
  "amount": 499,
  "currency": "INR",
  "type": "DYNAMIC_QR",
  "order_id": "RK_1001",
  "customer_mobile": "9999999999",
  "webhook_url": "https://merchant.example/webhook"
}</pre>
        </div>
      </section>
      ` : ""}

      <section class="rk-section">
        <div class="rk-head">
          <span>What's Included</span>
          <h2>One Platform. <b>20+ Services.</b></h2>
          <p>Everything your customers need in one branded RasoKart portal — fully operational from day one.</p>
        </div>
        <div class="rk-chip-cloud">${chipList()}</div>
      </section>

      <section class="rk-section">
        <div class="rk-head">
          <span>Why White-label?</span>
          <h2>Built to Make Your <b>Business Profitable</b></h2>
        </div>
        <div class="rk-grid rk-grid-3">${cardList(features)}</div>
      </section>

      <section class="rk-section">
        <div class="rk-head">
          <span>Partner Tiers</span>
          <h2>Choose Your <b>Partnership Level</b></h2>
        </div>
        <div class="rk-tier-grid">${tiers()}</div>
      </section>

      <section class="rk-section rk-two">
        <div>
          <div class="rk-head rk-left">
            <span>How It Works</span>
            <h2>Launch in <b>4 Simple Steps</b></h2>
          </div>
          <div class="rk-steps">
            <article><b>01</b><div><h3>Apply & Onboard</h3><p>Submit business details and onboarding request.</p></div></article>
            <article><b>02</b><div><h3>Brand Configuration</h3><p>Configure logo, domain, colour and service modules.</p></div></article>
            <article><b>03</b><div><h3>Wallet & Commission Setup</h3><p>Set wallets, service access and commission rules.</p></div></article>
            <article><b>04</b><div><h3>Go Live & Earn</h3><p>Launch portal, add merchants and track every transaction.</p></div></article>
          </div>
        </div>
        <div>
          <div class="rk-head rk-left">
            <span>Who It's For</span>
            <h2>Built for Every <b>Service Network</b></h2>
          </div>
          <div class="rk-grid rk-grid-2">
            ${cardList([
              { icon: "🏪", title: "Retail Shops", desc: "Local shops and mobile stores." },
              { icon: "📦", title: "Distributors", desc: "Regional service networks." },
              { icon: "🏛️", title: "Business Correspondents", desc: "Assisted service operators." },
              { icon: "💻", title: "Tech Startups", desc: "Teams launching fintech products." },
              { icon: "🏢", title: "NBFCs & MFIs", desc: "Financial service institutions." },
              { icon: "🤝", title: "Travel Agents", desc: "Travel and financial services." },
            ])}
          </div>
        </div>
      </section>

      <section class="rk-section">
        <div class="rk-head">
          <span>Platform Services</span>
          <h2>Power Your Platform with <b>RasoKart APIs</b></h2>
        </div>
        <div class="rk-grid rk-grid-3">${cardList(apis)}</div>
      </section>

      <section class="rk-cta">
        <div>
          <h2>Launch Your Branded Fintech Platform Today</h2>
          <p>20+ services, branded portal, app-ready experience and unified RasoKart dashboard.</p>
        </div>
        <div>
          <a href="/merchant">🚀 Apply Now</a>
          <a href="/merchant">Talk to Sales →</a>
        </div>
      </section>

      <footer class="rk-footer">
        <div class="rk-footer-brand">
          <h3>RasoKart</h3>
          <p>White-label payment infrastructure and service platform for merchants, distributors and fintech operators.</p>
        </div>
        <div class="rk-footer-grid">${footer()}</div>
        <div class="rk-copy">© 2026 RasoKart. All rights reserved.</div>
      </footer>
    </div>
  `;
}

function wantedPath() {
  const p = window.location.pathname;
  if (p === "/upi-collection" || p === "/upi-collection-api") return "upi";
  if (p === "/whitelabel" || p === "/whitelabel-solutions") return "white";
  return "";
}

function renderPublicOverride() {
  const kind = wantedPath();
  const old = document.getElementById("rk-public-page");

  if (!kind) {
    document.body.classList.remove("rk-public-override-active");
    old?.remove();
    return;
  }

  document.body.classList.add("rk-public-override-active");

  if (old) return;

  const mount = document.createElement("div");
  mount.innerHTML = pageHtml(kind as "upi" | "white");
  document.body.prepend(mount.firstElementChild as Element);
}

function start() {
  renderPublicOverride();

  const push = history.pushState;
  history.pushState = function (...args) {
    push.apply(this, args);
    setTimeout(renderPublicOverride, 80);
  };

  window.addEventListener("popstate", () => setTimeout(renderPublicOverride, 80));
  setTimeout(renderPublicOverride, 300);
  setTimeout(renderPublicOverride, 1000);
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
}

export {};
