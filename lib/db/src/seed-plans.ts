import { db, plansTable } from "./index.js";
import { eq } from "drizzle-orm";

const PLAN_TIERS = [
  {
    name: "Starter",
    description: "Perfect for individuals and small businesses getting started.",
    pricing: JSON.stringify({ qr: { monthly: 0, perTx: 2 }, va: { monthly: 0, perTx: 5 } }),
    features: JSON.stringify(["5 Dynamic QR Codes", "5 Static QR Codes", "2 Virtual Accounts", "3 Payment Links", "Email Support"]),
    dynamicQrLimit: 5,
    staticQrLimit: 5,
    virtualAccountLimit: 2,
    paymentLinkLimit: 3,
    payoutLimit: 5,
  },
  {
    name: "Startup",
    description: "For growing startups that need more capacity.",
    pricing: JSON.stringify({ qr: { monthly: 999, perTx: 1.5 }, va: { monthly: 999, perTx: 3 } }),
    features: JSON.stringify(["20 Dynamic QR Codes", "20 Static QR Codes", "5 Virtual Accounts", "10 Payment Links", "Priority Support"]),
    dynamicQrLimit: 20,
    staticQrLimit: 20,
    virtualAccountLimit: 5,
    paymentLinkLimit: 10,
    payoutLimit: 20,
  },
  {
    name: "Business",
    description: "Built for established businesses with high transaction volumes.",
    pricing: JSON.stringify({ qr: { monthly: 2999, perTx: 1 }, va: { monthly: 2999, perTx: 2 } }),
    features: JSON.stringify(["50 Dynamic QR Codes", "50 Static QR Codes", "15 Virtual Accounts", "30 Payment Links", "Dedicated Support", "Advanced Analytics"]),
    dynamicQrLimit: 50,
    staticQrLimit: 50,
    virtualAccountLimit: 15,
    paymentLinkLimit: 30,
    payoutLimit: 50,
  },
  {
    name: "Business Plus",
    description: "Enhanced capacity for high-growth businesses.",
    pricing: JSON.stringify({ qr: { monthly: 5999, perTx: 0.75 }, va: { monthly: 5999, perTx: 1.5 } }),
    features: JSON.stringify(["100 Dynamic QR Codes", "100 Static QR Codes", "30 Virtual Accounts", "50 Payment Links", "SLA Support", "Custom Webhooks", "Advanced Analytics"]),
    dynamicQrLimit: 100,
    staticQrLimit: 100,
    virtualAccountLimit: 30,
    paymentLinkLimit: 50,
    payoutLimit: 100,
  },
  {
    name: "Enterprise",
    description: "Unlimited scale for large enterprises with custom requirements.",
    pricing: JSON.stringify({ qr: { monthly: 0, perTx: 0.5 }, va: { monthly: 0, perTx: 1 } }),
    features: JSON.stringify(["Unlimited Dynamic QR Codes", "Unlimited Static QR Codes", "100 Virtual Accounts", "200 Payment Links", "24/7 Dedicated Support", "Custom Integration", "SLA Guarantee"]),
    dynamicQrLimit: 999,
    staticQrLimit: 999,
    virtualAccountLimit: 100,
    paymentLinkLimit: 200,
    payoutLimit: 999,
  },
];

async function seedPlans() {
  console.log("Seeding plan tiers...");

  for (const tier of PLAN_TIERS) {
    const existing = await db.select().from(plansTable).where(eq(plansTable.name, tier.name)).limit(1);
    if (existing.length > 0) {
      await db.update(plansTable).set(tier).where(eq(plansTable.name, tier.name));
      console.log(`Updated plan: ${tier.name}`);
    } else {
      await db.insert(plansTable).values(tier);
      console.log(`Created plan: ${tier.name}`);
    }
  }

  console.log("Done seeding plans!");
  process.exit(0);
}

seedPlans().catch(e => { console.error(e); process.exit(1); });
