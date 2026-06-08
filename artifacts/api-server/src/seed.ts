import bcrypt from "bcryptjs";
import { and, count, eq } from "drizzle-orm";
import {
  db,
  usersTable,
  merchantsTable,
  transactionsTable,
  withdrawalsTable,
  callbackLogsTable,
  settlementsTable,
  apiKeysTable,
  webhooksTable,
  qrCodesTable,
  virtualAccountsTable,
  accountDetailsTable,
  plansTable,
  merchantPlansTable,
} from "@workspace/db";

const PLAN_TIERS = [
  {
    name: "Starter",
    description: "Free trial plan for individuals getting started.",
    price: "0", monthlyFee: "0", yearlyFee: "0", setupFee: "0",
    pricing: JSON.stringify({ qr: { monthly: 0, perTx: 2 }, va: { monthly: 0, perTx: 5 } }),
    features: JSON.stringify(["5 Dynamic QR Codes", "2 Virtual Accounts", "Email Support"]),
    customFeatures: JSON.stringify([]),
    dynamicQrLimit: 5, staticQrLimit: 5, virtualAccountLimit: 2, paymentLinkLimit: 3, payoutLimit: 5,
    dailyTransactionLimit: 50, monthlyTransactionLimit: 500,
    settlementFee: "3.0", depositFee: "1.0",
    apiAccess: false, webhookAccess: false, providerAccess: false, isActive: true,
  },
  {
    name: "Silver",
    description: "For growing businesses that need more capacity and API access.",
    price: "999", monthlyFee: "999", yearlyFee: "9990", setupFee: "0",
    pricing: JSON.stringify({ qr: { monthly: 999, perTx: 1.5 }, va: { monthly: 999, perTx: 3 } }),
    features: JSON.stringify(["25 Dynamic QR Codes", "10 Virtual Accounts", "API Access", "Priority Support"]),
    customFeatures: JSON.stringify([]),
    dynamicQrLimit: 25, staticQrLimit: 25, virtualAccountLimit: 10, paymentLinkLimit: 15, payoutLimit: 50,
    dailyTransactionLimit: 200, monthlyTransactionLimit: 3000,
    settlementFee: "2.0", depositFee: "0.5",
    apiAccess: true, webhookAccess: true, providerAccess: false, isActive: true,
  },
  {
    name: "Gold",
    description: "Built for established businesses with high transaction volumes.",
    price: "2499", monthlyFee: "2499", yearlyFee: "24990", setupFee: "999",
    pricing: JSON.stringify({ qr: { monthly: 2499, perTx: 1 }, va: { monthly: 2499, perTx: 2 } }),
    features: JSON.stringify(["100 Dynamic QR Codes", "30 Virtual Accounts", "API Access", "Webhooks", "Dedicated Support", "Advanced Analytics"]),
    customFeatures: JSON.stringify(["Priority settlement", "Custom webhook retry policy"]),
    dynamicQrLimit: 100, staticQrLimit: 100, virtualAccountLimit: 30, paymentLinkLimit: 50, payoutLimit: 200,
    dailyTransactionLimit: 1000, monthlyTransactionLimit: 15000,
    settlementFee: "1.5", depositFee: "0.25",
    apiAccess: true, webhookAccess: true, providerAccess: false, isActive: true,
  },
  {
    name: "Platinum",
    description: "High-volume plan with priority limits and lowest fees.",
    price: "4999", monthlyFee: "4999", yearlyFee: "49990", setupFee: "1999",
    pricing: JSON.stringify({ qr: { monthly: 4999, perTx: 0.75 }, va: { monthly: 4999, perTx: 1.5 } }),
    features: JSON.stringify(["500 Dynamic QR Codes", "100 Virtual Accounts", "API Access", "Webhooks", "SLA Support", "Custom Integration"]),
    customFeatures: JSON.stringify(["T+1 settlement", "Dedicated account manager", "Custom SLA"]),
    dynamicQrLimit: 500, staticQrLimit: 500, virtualAccountLimit: 100, paymentLinkLimit: 200, payoutLimit: 999,
    dailyTransactionLimit: 5000, monthlyTransactionLimit: 75000,
    settlementFee: "1.0", depositFee: "0.1",
    apiAccess: true, webhookAccess: true, providerAccess: true, isActive: true,
  },
  {
    name: "Enterprise",
    description: "Multi-provider access with dedicated infrastructure for large enterprises.",
    price: "9999", monthlyFee: "9999", yearlyFee: "99990", setupFee: "4999",
    pricing: JSON.stringify({ qr: { monthly: 9999, perTx: 0.5 }, va: { monthly: 9999, perTx: 1 } }),
    features: JSON.stringify(["Unlimited Dynamic QR Codes", "Unlimited Virtual Accounts", "Full API Access", "Multi-Provider Support", "24/7 SLA", "Dedicated Infrastructure"]),
    customFeatures: JSON.stringify(["Same-day settlement", "Multi-provider failover", "Custom integration support", "White-label option"]),
    dynamicQrLimit: 999, staticQrLimit: 999, virtualAccountLimit: 999, paymentLinkLimit: 999, payoutLimit: 999,
    dailyTransactionLimit: 50000, monthlyTransactionLimit: 999999,
    settlementFee: "0.75", depositFee: "0.05",
    apiAccess: true, webhookAccess: true, providerAccess: true, isActive: true,
  },
  {
    name: "Custom",
    description: "Unlimited scale for large enterprises with negotiated terms.",
    price: "0", monthlyFee: "0", yearlyFee: "0", setupFee: "0",
    pricing: JSON.stringify({ qr: { monthly: 0, perTx: 0.5 }, va: { monthly: 0, perTx: 1 } }),
    features: JSON.stringify(["Unlimited QR Codes", "Unlimited Virtual Accounts", "Full API Access", "24/7 Support", "Custom SLA", "Dedicated Manager"]),
    customFeatures: JSON.stringify(["Fully negotiated terms", "Any feature on request"]),
    dynamicQrLimit: 999, staticQrLimit: 999, virtualAccountLimit: 999, paymentLinkLimit: 999, payoutLimit: 999,
    dailyTransactionLimit: 999, monthlyTransactionLimit: 999,
    settlementFee: "0.5", depositFee: "0.0",
    apiAccess: true, webhookAccess: true, providerAccess: true, isActive: true,
  },
];

export async function seed() {
  console.log("Seeding database...");

  // ── Plan tiers ────────────────────────────────────────────────────────────
  for (const tier of PLAN_TIERS) {
    await db.insert(plansTable).values(tier)
      .onConflictDoUpdate({ target: plansTable.name, set: tier });
  }
  console.log("Plans seeded");

  // ── Users & Merchants ────────────────────────────────────────────────────
  const adminHash = await bcrypt.hash("Admin@123456", 10);
  const [admin] = await db
    .insert(usersTable)
    .values({ email: "admin@rpay.com", passwordHash: adminHash, name: "Super Admin", role: "admin", isActive: true })
    .onConflictDoUpdate({ target: usersTable.email, set: { passwordHash: adminHash, name: "Super Admin" } })
    .returning();
  console.log("Admin:", admin.email);

  const [merchant1] = await db
    .insert(usersTable)
    .values({ email: "merchant@demo.com", passwordHash: await bcrypt.hash("Merchant@123456", 10), name: "Demo Merchant", role: "merchant", isActive: true })
    .onConflictDoUpdate({ target: usersTable.email, set: { name: "Demo Merchant" } })
    .returning();

  const [merchant2] = await db
    .insert(usersTable)
    .values({ email: "merchant2@demo.com", passwordHash: await bcrypt.hash("Merchant@123456", 10), name: "Merchant Two", role: "merchant", isActive: true })
    .onConflictDoUpdate({ target: usersTable.email, set: { name: "Merchant Two" } })
    .returning();

  const [m1] = await db.insert(merchantsTable).values({
    businessName: "Demo Business Pvt Ltd",
    contactName: "Demo Merchant",
    email: "merchant@demo.com",
    phone: "+91-9876543210",
    status: "approved",
    balance: "15000",
    totalDeposits: "225000",
    totalWithdrawals: "210000",
  }).onConflictDoUpdate({ target: merchantsTable.email, set: { status: "approved" } }).returning();

  const [m2] = await db.insert(merchantsTable).values({
    businessName: "TechPay Solutions",
    contactName: "Merchant Two",
    email: "merchant2@demo.com",
    phone: "+91-9876543211",
    status: "approved",
    balance: "8500",
    totalDeposits: "125000",
    totalWithdrawals: "116500",
  }).onConflictDoUpdate({ target: merchantsTable.email, set: { status: "approved" } }).returning();

  // Link user accounts to their merchant rows so merchant-facing routes work
  if (m1) await db.update(usersTable).set({ merchantId: m1.id }).where(eq(usersTable.email, "merchant@demo.com"));
  if (m2) await db.update(usersTable).set({ merchantId: m2.id }).where(eq(usersTable.email, "merchant2@demo.com"));
  console.log("Merchants seeded");

  // assign plans
  const [starterPlan] = await db.select({ id: plansTable.id }).from(plansTable).where(eq(plansTable.name, "Starter")).limit(1);
  const [goldPlan] = await db.select({ id: plansTable.id }).from(plansTable).where(eq(plansTable.name, "Gold")).limit(1);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  if (starterPlan && m1) {
    await db.insert(merchantPlansTable).values({ merchantId: m1.id, planId: starterPlan.id, expiresAt })
      .onConflictDoUpdate({ target: merchantPlansTable.merchantId, set: { planId: starterPlan.id, expiresAt, status: "active" } });
  }
  if (goldPlan && m2) {
    await db.insert(merchantPlansTable).values({ merchantId: m2.id, planId: goldPlan.id, expiresAt })
      .onConflictDoUpdate({ target: merchantPlansTable.merchantId, set: { planId: goldPlan.id, expiresAt, status: "active" } });
  }
  console.log("Merchants seeded");

  // ── Transactions ────────────────────────────────────────────────────────
  const txCount = await db.select({ c: count() }).from(transactionsTable);
  if (txCount[0].c === 0) {
    const statuses = ["success", "success", "success", "success", "failed", "pending"] as const;
    for (let i = 0; i < 50; i++) {
      const merchantId = i % 3 === 0 ? m2.id : m1.id;
      const type = i % 3 === 0 ? "withdrawal" : "deposit";
      const amount = (Math.random() * 9000 + 1000).toFixed(2);
      const status = statuses[Math.floor(Math.random() * statuses.length)];
      const daysAgo = Math.floor(Math.random() * 30);
      const createdAt = new Date(Date.now() - daysAgo * 86400000 - Math.random() * 86400000);
      await db.insert(transactionsTable).values({
        merchantId, type, status, amount, currency: "INR",
        utr: `UTR${Date.now()}${i}`, createdAt,
      });
    }
  }
  console.log("Transactions seeded");

  const wCount = await db.select({ c: count() }).from(withdrawalsTable);
  if (wCount[0].c === 0) {
    for (let i = 0; i < 10; i++) {
      const merchantId = i % 2 === 0 ? m1.id : m2.id;
      const statuses = ["pending", "approved", "approved", "rejected"] as const;
      await db.insert(withdrawalsTable).values({
        merchantId, amount: (Math.random() * 5000 + 500).toFixed(2),
        bankAccount: "XXXX1234", bankName: "HDFC Bank",
        ifscCode: "HDFC0001234", accountHolder: "Demo Merchant",
        status: statuses[Math.floor(Math.random() * statuses.length)],
      });
    }
  }
  console.log("Withdrawals seeded");

  const cbCount = await db.select({ c: count() }).from(callbackLogsTable);
  if (cbCount[0].c === 0) {
    const methods = ["GET", "POST"] as const;
    const statuses = [200, 200, 200, 404, 500] as const;
    for (let i = 0; i < 20; i++) {
      const httpStatus = statuses[Math.floor(Math.random() * statuses.length)];
      await db.insert(callbackLogsTable).values({
        merchantId: i % 2 === 0 ? m1.id : m2.id,
        url: `https://api.merchant${i % 2 + 1}.com/callback`,
        status: httpStatus === 200 ? "success" : "failed",
        httpStatus,
        requestBody: JSON.stringify({ event: "payment.success", amount: 1000 }),
        responseBody: JSON.stringify({ ok: true }),
      });
    }
  }
  console.log("Callback logs seeded");

  const settCount = await db.select({ c: count() }).from(settlementsTable);
  if (settCount[0].c === 0) {
    for (let i = 0; i < 15; i++) {
      const merchantId = i % 2 === 0 ? m1.id : m2.id;
      const amount = (Math.random() * 8000 + 1000).toFixed(2);
      await db.insert(settlementsTable).values({
        merchantId, amount,
        status: i < 12 ? "processed" : "pending",
        periodFrom: new Date(Date.now() - (i + 1) * 86400000).toISOString().split("T")[0],
        periodTo: new Date(Date.now() - i * 86400000).toISOString().split("T")[0],
        transactionCount: Math.floor(Math.random() * 50 + 5),
      });
    }
  }
  console.log("Settlements seeded");

  // ── Detail data: guard with count to prevent duplicates on re-seed ────────
  const qrCount = await db.select({ c: count() }).from(qrCodesTable);
  if (qrCount[0].c === 0) {
    for (let i = 0; i < 15; i++) {
      await db.insert(qrCodesTable).values({
        merchantId: i % 2 === 0 ? m1.id : m2.id,
        type: i % 3 === 0 ? "static" : "dynamic",
        label: `QR-${i + 1}`,
        payload: JSON.stringify({ upi: `merchant${i % 2 + 1}@upi`, amount: i % 3 === 0 ? null : 500 + i * 100 }),
        amount: i % 3 === 0 ? null : String(500 + i * 100),
        status: i < 12 ? "active" : "inactive",
        createdAt: new Date(Date.now() - Math.random() * 30 * 86400000),
      });
    }
  }
  console.log("QR codes seeded");

  const vaCount = await db.select({ c: count() }).from(virtualAccountsTable);
  if (vaCount[0].c === 0) {
    for (let i = 0; i < 8; i++) {
      await db.insert(virtualAccountsTable).values({
        merchantId: i % 2 === 0 ? m1.id : m2.id,
        label: `VA-${i + 1}`,
        ifsc: "RPAY0001",
        accountNumber: `9900000${String(i).padStart(4, "0")}`,
        bankName: "RPay Virtual Bank",
        accountHolder: "Demo Merchant",
        status: "active",
        createdAt: new Date(Date.now() - Math.random() * 30 * 86400000),
      });
    }
  }
  console.log("Virtual accounts seeded");

  const txToday = await db.select({ c: count() }).from(transactionsTable)
    .where(and(eq(transactionsTable.merchantId, m1.id), eq(transactionsTable.type, "deposit")));
  if (txToday[0].c < 5) {
    for (let i = 0; i < 3; i++) {
      await db.insert(transactionsTable).values({
        merchantId: m1.id, type: "deposit", status: "success",
        amount: (Math.random() * 2000 + 200).toFixed(2), currency: "INR",
        utr: `TODAY${Date.now()}${i}`, createdAt: new Date(),
      });
    }
  }
  console.log("Today's deposits seeded");

  const adCount = await db.select({ c: count() }).from(accountDetailsTable);
  if (adCount[0].c === 0) {
    await db.insert(accountDetailsTable).values({
      type: "bank_account",
      label: "HDFC Collection Account",
      bankName: "HDFC Bank",
      accountNumber: "50200012345678",
      ifsc: "HDFC0001234",
      upiId: "rpay.collection@hdfc",
      isActive: true,
    });
    console.log("Account details seeded");
  }

  console.log("Seed complete.");
}

// Standalone runner (pnpm --filter @workspace/api-server run seed)
if (process.argv[1] && process.argv[1].includes("seed")) {
  seed()
    .then(() => process.exit(0))
    .catch(err => { console.error(err); process.exit(1); });
}
