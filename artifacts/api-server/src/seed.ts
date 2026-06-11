import bcrypt from "bcryptjs";
import { and, count, eq, isNotNull, sql } from "drizzle-orm";
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
  ledgerEntriesTable,
  providersTable,
  merchantConnectionsTable,
  notificationsTable,
  reconciliationRunsTable,
  reconciliationItemsTable,
  systemConfigTable,
  SYSTEM_CONFIG_KEYS,
  SYSTEM_CONFIG_DEFAULTS,
  systemSettingsTable,
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
    .values({ email: "admin@rasokart.com", passwordHash: adminHash, name: "Super Admin", role: "admin", isActive: true })
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
    const settlementSamples = [
      { merchantId: m1.id, status: "paid", amount: "12500.00", requestedAmount: "12500.00", adminRemark: "Approved and transferred", referenceNumber: "REF20240601001", paidAt: new Date(Date.now() - 20 * 86400000), processedBy: admin.id },
      { merchantId: m2.id, status: "paid", amount: "8200.00", requestedAmount: "8200.00", adminRemark: "Bank transfer completed", referenceNumber: "REF20240602001", paidAt: new Date(Date.now() - 15 * 86400000), processedBy: admin.id },
      { merchantId: m1.id, status: "paid", amount: "5000.00", requestedAmount: "5000.00", adminRemark: "Processed successfully", referenceNumber: "REF20240605001", paidAt: new Date(Date.now() - 5 * 86400000), processedBy: admin.id },
      { merchantId: m2.id, status: "paid", amount: "9750.00", requestedAmount: "9750.00", adminRemark: "NEFT transfer done", referenceNumber: "REF20240607001", paidAt: new Date(Date.now() - 1 * 86400000), processedBy: admin.id },
      { merchantId: m1.id, status: "approved", amount: "7300.00", requestedAmount: "7300.00", adminRemark: "Approved — awaiting disbursement", processedBy: admin.id },
      { merchantId: m2.id, status: "approved", amount: "3800.00", requestedAmount: "3800.00", adminRemark: "Verified and approved", processedBy: admin.id },
      { merchantId: m1.id, status: "processing", amount: "6100.00", requestedAmount: "6100.00", adminRemark: "Under review", processedBy: admin.id, processedAt: new Date(Date.now() - 2 * 3600000) },
      { merchantId: m2.id, status: "processing", amount: "4500.00", requestedAmount: "4500.00", adminRemark: "Verifying bank details", processedBy: admin.id, processedAt: new Date(Date.now() - 1 * 3600000) },
      { merchantId: m1.id, status: "rejected", amount: "2000.00", requestedAmount: "2000.00", adminRemark: "Insufficient supporting documents", processedBy: admin.id, processedAt: new Date(Date.now() - 10 * 86400000) },
      { merchantId: m2.id, status: "rejected", amount: "1500.00", requestedAmount: "1500.00", adminRemark: "Invalid bank account details", processedBy: admin.id, processedAt: new Date(Date.now() - 8 * 86400000) },
      { merchantId: m1.id, status: "pending", amount: "4200.00", requestedAmount: "4200.00", requestedNote: "Monthly settlement request" },
      { merchantId: m2.id, status: "pending", amount: "3100.00", requestedAmount: "3100.00", requestedNote: "Urgent — need funds for operations" },
    ] as const;

    for (const s of settlementSamples) {
      await db.insert(settlementsTable).values({
        ...s,
        currency: "INR",
        transactionCount: Math.floor(Math.random() * 30 + 5),
        processedAt: "processedAt" in s ? (s as any).processedAt : undefined,
        paidAt: "paidAt" in s ? (s as any).paidAt : undefined,
        referenceNumber: "referenceNumber" in s ? (s as any).referenceNumber : undefined,
      });
    }
  }
  console.log("Settlements seeded");

  // ── QR codes — merchant-scoped guard to survive re-seeding on existing DBs ──
  const [m1QrCount] = await db.select({ c: count() }).from(qrCodesTable).where(eq(qrCodesTable.merchantId, m1.id));
  if (m1QrCount.c === 0) {
    const qrSamples = [
      { merchantId: m1.id, type: "dynamic" as const, label: "Checkout QR",       payload: "upi://pay?pa=demo@hdfc&pn=Demo+Business&cu=INR",              amount: null,      status: "active" as const },
      { merchantId: m1.id, type: "dynamic" as const, label: "Invoice #1001",     payload: "upi://pay?pa=demo@hdfc&pn=Demo+Business&cu=INR&am=2500",      amount: "2500",    status: "active" as const },
      { merchantId: m1.id, type: "static" as const,  label: "Reception Counter", payload: "upi://pay?pa=demo@hdfc&pn=Demo+Business&cu=INR",              amount: null,      status: "active" as const },
      { merchantId: m1.id, type: "dynamic" as const, label: "Product Bundle",    payload: "upi://pay?pa=demo@hdfc&pn=Demo+Business&cu=INR&am=1299",      amount: "1299",    status: "active" as const },
      { merchantId: m1.id, type: "dynamic" as const, label: "Event Ticket",      payload: "upi://pay?pa=demo@hdfc&pn=Demo+Business&cu=INR&am=500",       amount: "500",     status: "inactive" as const },
      { merchantId: m2.id, type: "dynamic" as const, label: "TechPay Checkout",  payload: "upi://pay?pa=techpay@axis&pn=TechPay+Solutions&cu=INR",       amount: null,      status: "active" as const },
      { merchantId: m2.id, type: "static" as const,  label: "TechPay Counter",   payload: "upi://pay?pa=techpay@axis&pn=TechPay+Solutions&cu=INR",       amount: null,      status: "active" as const },
      { merchantId: m2.id, type: "dynamic" as const, label: "Monthly Sub",       payload: "upi://pay?pa=techpay@axis&pn=TechPay+Solutions&cu=INR&am=999", amount: "999",    status: "active" as const },
    ];
    for (let i = 0; i < qrSamples.length; i++) {
      await db.insert(qrCodesTable).values({
        ...qrSamples[i],
        createdAt: new Date(Date.now() - (qrSamples.length - i) * 3 * 86400000),
      });
    }
  }
  console.log("QR codes seeded");

  // ── Virtual accounts — merchant-scoped guard ─────────────────────────────
  const [m1VaCount] = await db.select({ c: count() }).from(virtualAccountsTable).where(eq(virtualAccountsTable.merchantId, m1.id));
  if (m1VaCount.c === 0) {
    const vaSamples = [
      { merchantId: m1.id, label: "Primary Collection", ifsc: "RASO0001", accountNumber: "99000068001", bankName: "RasoKart Virtual Bank", accountHolder: "Demo Business Pvt Ltd", status: "active" as const },
      { merchantId: m1.id, label: "Secondary Reserve",  ifsc: "RASO0001", accountNumber: "99000068002", bankName: "RasoKart Virtual Bank", accountHolder: "Demo Business Pvt Ltd", status: "active" as const },
      { merchantId: m2.id, label: "TechPay Collection", ifsc: "RASO0001", accountNumber: "99000069001", bankName: "RasoKart Virtual Bank", accountHolder: "TechPay Solutions",       status: "active" as const },
      { merchantId: m2.id, label: "TechPay Reserve",    ifsc: "RASO0001", accountNumber: "99000069002", bankName: "RasoKart Virtual Bank", accountHolder: "TechPay Solutions",       status: "active" as const },
    ];
    for (let i = 0; i < vaSamples.length; i++) {
      await db.insert(virtualAccountsTable).values({
        ...vaSamples[i],
        createdAt: new Date(Date.now() - (vaSamples.length - i) * 5 * 86400000),
      });
    }
  }
  console.log("Virtual accounts seeded");

  // ── VA-linked transactions ────────────────────────────────────────────────
  // Seed demo transactions explicitly tagged with virtualAccountId so the
  // VA payment history drawer shows real data in the demo environment.
  const m1VAs = await db.select({ id: virtualAccountsTable.id }).from(virtualAccountsTable)
    .where(eq(virtualAccountsTable.merchantId, m1.id)).limit(2);
  const m2VAs = await db.select({ id: virtualAccountsTable.id }).from(virtualAccountsTable)
    .where(eq(virtualAccountsTable.merchantId, m2.id)).limit(2);

  if (m1VAs.length > 0) {
    const [vaLinked] = await db.select({ c: count() }).from(transactionsTable)
      .where(and(eq(transactionsTable.merchantId, m1.id), isNotNull(transactionsTable.virtualAccountId)));
    if (vaLinked.c === 0) {
      const va1 = m1VAs[0].id;
      const va2 = m1VAs[1]?.id ?? va1;
      const vaDeposits = [
        { vaId: va1, amount: "15000.00", status: "success", hoursAgo: 5 * 24 },
        { vaId: va1, amount: "8500.50",  status: "success", hoursAgo: 3 * 24 },
        { vaId: va1, amount: "3200.00",  status: "failed",  hoursAgo: 2 * 24 },
        { vaId: va1, amount: "12000.00", status: "success", hoursAgo: 1 * 24 },
        { vaId: va2, amount: "25000.00", status: "success", hoursAgo: 4 * 24 },
        { vaId: va2, amount: "9800.00",  status: "success", hoursAgo: 2 * 24 + 3 },
        { vaId: va2, amount: "4500.00",  status: "pending", hoursAgo: 6 },
      ];
      for (const d of vaDeposits) {
        const utrSuffix = Math.random().toString(36).slice(2, 8).toUpperCase();
        await db.insert(transactionsTable).values({
          merchantId: m1.id,
          virtualAccountId: d.vaId,
          type: "deposit",
          status: d.status as "success" | "failed" | "pending",
          amount: d.amount,
          currency: "INR",
          utr: `VAUTR${Date.now()}${utrSuffix}`,
          description: `Deposit via Virtual Account`,
          createdAt: new Date(Date.now() - d.hoursAgo * 3600000),
        });
      }
    }
  }

  if (m2VAs.length > 0) {
    const [vaLinked2] = await db.select({ c: count() }).from(transactionsTable)
      .where(and(eq(transactionsTable.merchantId, m2.id), isNotNull(transactionsTable.virtualAccountId)));
    if (vaLinked2.c === 0) {
      const va3 = m2VAs[0].id;
      const va4 = m2VAs[1]?.id ?? va3;
      const vaDeposits2 = [
        { vaId: va3, amount: "30000.00", status: "success", hoursAgo: 6 * 24 },
        { vaId: va3, amount: "11200.00", status: "success", hoursAgo: 2 * 24 },
        { vaId: va4, amount: "18500.00", status: "success", hoursAgo: 3 * 24 },
        { vaId: va4, amount: "6750.00",  status: "failed",  hoursAgo: 1 * 24 },
      ];
      for (const d of vaDeposits2) {
        const utrSuffix = Math.random().toString(36).slice(2, 8).toUpperCase();
        await db.insert(transactionsTable).values({
          merchantId: m2.id,
          virtualAccountId: d.vaId,
          type: "deposit",
          status: d.status as "success" | "failed" | "pending",
          amount: d.amount,
          currency: "INR",
          utr: `VAUTR${Date.now()}${utrSuffix}`,
          description: `Deposit via Virtual Account`,
          createdAt: new Date(Date.now() - d.hoursAgo * 3600000),
        });
      }
    }
  }
  console.log("VA-linked transactions seeded");

  // ── Provider-linked demo transactions — merchant-scoped guard ────────────
  // Seeds transactions with a `provider` field set so the "Volume by Provider"
  // dashboard widget has data to display in the demo environment.
  {
    const [provTxCount] = await db
      .select({ c: count() })
      .from(transactionsTable)
      .where(and(eq(transactionsTable.merchantId, m1.id), sql`${transactionsTable.provider} IS NOT NULL`));

    if (provTxCount.c === 0) {
      const DEMO_PROVIDERS = ["google_pay", "phonepe", "paytm", "bharat_pe", "upi_id"];
      const statuses: Array<"success" | "failed" | "pending"> = ["success", "success", "success", "failed", "pending"];
      for (let i = 0; i < 40; i++) {
        const merchantId = i % 3 === 0 ? m2.id : m1.id;
        const provider = DEMO_PROVIDERS[i % DEMO_PROVIDERS.length];
        const status = statuses[Math.floor(Math.random() * statuses.length)];
        const amount = (Math.random() * 18000 + 500).toFixed(2);
        const daysAgo = Math.floor(Math.random() * 30);
        const utrSuffix = Math.random().toString(36).slice(2, 10).toUpperCase();
        await db.insert(transactionsTable).values({
          merchantId,
          type: "deposit",
          status,
          amount,
          currency: "INR",
          provider,
          utr: `PVRUTR${Date.now()}${utrSuffix}`,
          description: `Deposit via ${provider.replace(/_/g, " ")}`,
          createdAt: new Date(Date.now() - daysAgo * 86400000 - Math.random() * 86400000),
        });
      }
    }
  }
  console.log("Provider-linked transactions seeded");

  // ── API Keys — merchant-scoped guard ────────────────────────────────────
  const [m1KeyCount] = await db.select({ c: count() }).from(apiKeysTable).where(eq(apiKeysTable.merchantId, m1.id));
  if (m1KeyCount.c === 0) {
    await db.insert(apiKeysTable).values([
      {
        merchantId: m1.id,
        apiKey: "rasokart_live_demo_key_m1_0001",
        secretKey: "rasokart_secret_demo_m1_live_xK9mP2nQ7rL",
        keyPrefix: "rasokart_live_demo",
        isActive: true,
        lastUsedAt: new Date(Date.now() - 2 * 86400000),
      },
      {
        merchantId: m1.id,
        apiKey: "rasokart_test_demo_key_m1_0002",
        secretKey: "rasokart_secret_demo_m1_test_yR3wS8vT1uE",
        keyPrefix: "rasokart_test_demo",
        isActive: true,
        lastUsedAt: null,
      },
      {
        merchantId: m2.id,
        apiKey: "rasokart_live_demo_key_m2_0001",
        secretKey: "rasokart_secret_demo_m2_live_zF5hJ6kM4nC",
        keyPrefix: "rasokart_live_demo",
        isActive: true,
        lastUsedAt: new Date(Date.now() - 5 * 86400000),
      },
    ]);
  }

  // ── Webhooks — upsert config for demo merchants ──────────────────────────
  await db.insert(webhooksTable).values({
    merchantId: m1.id,
    url: "https://demo-business.example.com/webhooks/rasokart",
    isActive: true,
    events: ["payment.success", "payment.failed", "settlement.paid", "settlement.approved"],
    secret: "whsec_demo_m1_rasokart_xK9mP2nQ7rL3wS8",
  }).onConflictDoUpdate({
    target: webhooksTable.merchantId,
    set: {
      url: "https://demo-business.example.com/webhooks/rasokart",
      isActive: true,
      events: ["payment.success", "payment.failed", "settlement.paid", "settlement.approved"],
    },
  });

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
      upiId: "rasokart.collection@hdfc",
      isActive: true,
    });
    console.log("Account details seeded");
  }

  // ── Ledger Entries ────────────────────────────────────────────────────────
  const ledgerCount = await db.select({ c: count() }).from(ledgerEntriesTable);
  if (ledgerCount[0].c === 0) {
    // m1 balance = 15000: sequence must close at exactly 15000
    // 0 → +50000 → 50000 → -20000 → 30000 → +25000 → 55000 → -30000 → 25000 → +2000 → 27000 → -12000 → 15000
    const m1Entries = [
      { type: "deposit",    amount:  50000, desc: "Deposit via QR Code: QR-1",                          ref: "transaction" },
      { type: "settlement", amount: -20000, desc: "Settlement approved — Approved and transferred",      ref: "settlement"  },
      { type: "deposit",    amount:  25000, desc: "Deposit via Virtual Account: VA-1",                  ref: "transaction" },
      { type: "settlement", amount: -30000, desc: "Settlement approved — Processed successfully",        ref: "settlement"  },
      { type: "adjustment", amount:   2000, desc: "Credit adjustment — Reversal of duplicate charge",   ref: "manual", createdBy: admin.id },
      { type: "settlement", amount: -12000, desc: "Settlement approved — Verified and approved",         ref: "settlement"  },
    ] as const;

    let bal = 0;
    for (let i = 0; i < m1Entries.length; i++) {
      const e = m1Entries[i];
      const before = bal;
      bal = bal + e.amount;
      const daysAgo = m1Entries.length - i + 2;
      await db.insert(ledgerEntriesTable).values({
        merchantId: m1.id,
        type: e.type,
        amount: e.amount.toFixed(2),
        balanceBefore: before.toFixed(2),
        balanceAfter: bal.toFixed(2),
        referenceType: e.ref,
        description: e.desc,
        createdBy: "createdBy" in e ? (e as any).createdBy : null,
        createdAt: new Date(Date.now() - daysAgo * 86400000),
      });
    }

    // m2 balance = 8500: 0 → +30000 → 30000 → -12500 → 17500 → +15000 → 32500 → -24000 → 8500
    const m2Entries = [
      { type: "deposit",    amount:  30000, desc: "Deposit via QR Code: QR-2",                     ref: "transaction" },
      { type: "settlement", amount: -12500, desc: "Settlement approved — Bank transfer completed",  ref: "settlement"  },
      { type: "deposit",    amount:  15000, desc: "Deposit via Virtual Account: VA-2",             ref: "transaction" },
      { type: "settlement", amount: -24000, desc: "Settlement approved — NEFT transfer done",       ref: "settlement"  },
    ] as const;

    let bal2 = 0;
    for (let i = 0; i < m2Entries.length; i++) {
      const e = m2Entries[i];
      const before = bal2;
      bal2 = bal2 + e.amount;
      const daysAgo = m2Entries.length - i + 2;
      await db.insert(ledgerEntriesTable).values({
        merchantId: m2.id,
        type: e.type,
        amount: e.amount.toFixed(2),
        balanceBefore: before.toFixed(2),
        balanceAfter: bal2.toFixed(2),
        referenceType: e.ref,
        description: e.desc,
        createdBy: null,
        createdAt: new Date(Date.now() - daysAgo * 86400000),
      });
    }
    console.log("Ledger entries seeded");
  }

  // ── Providers ────────────────────────────────────────────────────────────
  const provCount = await db.select({ c: count() }).from(providersTable);
  if (provCount[0].c === 0) {
    const PROVIDERS = [
      { name: "UPI ID",               slug: "upi_id",          category: "upi",     status: "live",        description: "Collect payments via any UPI virtual payment address",        sortOrder: 1  },
      { name: "Google Pay Business",  slug: "google_pay",      category: "upi",     status: "live",        description: "Google Pay for Business — fast UPI collections",             sortOrder: 2  },
      { name: "PhonePe Business",     slug: "phonepe",         category: "upi",     status: "live",        description: "PhonePe Business UPI merchant payments",                     sortOrder: 3  },
      { name: "Paytm Business",       slug: "paytm",           category: "upi",     status: "live",        description: "Paytm for Business — UPI, wallet, and net banking",          sortOrder: 4  },
      { name: "BharatPe",             slug: "bharatpe",        category: "upi",     status: "live",        description: "BharatPe QR — zero MDR UPI collections",                    sortOrder: 5  },
      { name: "Freecharge",           slug: "freecharge",      category: "upi",     status: "coming_soon", description: "Freecharge Business UPI — launching soon",                  sortOrder: 6  },
      { name: "Amazon Pay",           slug: "amazon_pay",      category: "upi",     status: "coming_soon", description: "Amazon Pay UPI merchant checkout — launching soon",          sortOrder: 7  },
      { name: "MobiKwik",             slug: "mobikwik",        category: "upi",     status: "coming_soon", description: "MobiKwik merchant payment gateway — launching soon",         sortOrder: 8  },
      { name: "SBI YONO",             slug: "sbi_yono",        category: "bank",    status: "testing",     description: "State Bank of India YONO merchant collection account",       sortOrder: 9  },
      { name: "HDFC SmartHub Vyapar", slug: "hdfc_smarthub",   category: "bank",    status: "testing",     description: "HDFC SmartHub Vyapar all-in-one merchant solution",          sortOrder: 10 },
      { name: "ICICI Eazypay",        slug: "icici_eazypay",   category: "bank",    status: "testing",     description: "ICICI Bank Eazypay merchant collection gateway",             sortOrder: 11 },
      { name: "Axis Bank Pay",        slug: "axis_pay",        category: "bank",    status: "testing",     description: "Axis Bank merchant payment gateway",                         sortOrder: 12 },
      { name: "Kotak Smart Collect",  slug: "kotak_smart",     category: "bank",    status: "testing",     description: "Kotak Mahindra Smart Collect merchant digital payments",     sortOrder: 13 },
      { name: "Razorpay",             slug: "razorpay",        category: "gateway", status: "live",        description: "Razorpay full-stack payment gateway (cards, UPI, wallets)", sortOrder: 14 },
      { name: "Cashfree Payments",    slug: "cashfree",        category: "gateway", status: "live",        description: "Cashfree multi-mode payment gateway",                        sortOrder: 15 },
      { name: "PayU",                 slug: "payu",            category: "gateway", status: "live",        description: "PayU merchant payment gateway",                              sortOrder: 16 },
    ];
    for (const p of PROVIDERS) {
      await db.insert(providersTable).values(p).onConflictDoUpdate({ target: providersTable.slug, set: { name: p.name, status: p.status, sortOrder: p.sortOrder } });
    }
    console.log("Providers seeded");
  }

  // ── Merchant Connections (demo data) ──────────────────────────────────────
  const [connSeedMerchant] = await db.select({ id: merchantsTable.id }).from(merchantsTable).where(eq(merchantsTable.email, "merchant2@demo.com")).limit(1);
  if (connSeedMerchant) {
    const existingConns = await db.select({ c: count() }).from(merchantConnectionsTable).where(eq(merchantConnectionsTable.merchantId, connSeedMerchant.id));
    if (existingConns[0].c === 0) {
      await db.insert(merchantConnectionsTable).values([
        { merchantId: connSeedMerchant.id, provider: "google_pay", credentials: JSON.stringify({ vpa: "merchant2@okaxis" }), monthlyLimit: "500000", isActive: true },
        { merchantId: connSeedMerchant.id, provider: "phonepe",    credentials: JSON.stringify({ vpa: "merchant2@ybl" }),   monthlyLimit: "300000", isActive: true },
        { merchantId: connSeedMerchant.id, provider: "upi_id",     credentials: "merchant2@hdfc",                           monthlyLimit: "0",      isActive: false },
      ]);
      console.log("Merchant connections seeded");
    }
  }

  // ── Notifications ─────────────────────────────────────────────────────────
  const notifCount = await db.select({ c: count() }).from(notificationsTable);
  if (notifCount[0].c === 0) {
    // Seed a few sample notifications for merchant1 (user ID will be merchant1's user)
    const [m1User] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, "merchant@demo.com")).limit(1);
    const [m2User] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, "merchant2@demo.com")).limit(1);
    if (m1User && m2User) {
      const NOTIF_SAMPLES = [
        {
          userId: m1User.id,
          type: "settlement_paid",
          title: "Settlement Paid",
          body: "Your settlement of ₹12,500 has been paid. Reference: REF20240601001",
          metadata: { settlementId: 1, referenceNumber: "REF20240601001" },
          isRead: true,
          createdAt: new Date(Date.now() - 20 * 86400000),
        },
        {
          userId: m1User.id,
          type: "settlement_approved",
          title: "Settlement Approved",
          body: "Your settlement of ₹7,300 has been approved. Disbursement will be initiated shortly.",
          metadata: { settlementId: 5, amount: 7300 },
          isRead: true,
          createdAt: new Date(Date.now() - 5 * 86400000),
        },
        {
          userId: m1User.id,
          type: "plan_expiring",
          title: "Plan Expiring in 7 Days",
          body: "Your Starter plan expires soon. Contact support to renew before your access is interrupted.",
          metadata: { planName: "Starter", daysLeft: 7 },
          isRead: false,
          createdAt: new Date(Date.now() - 1 * 86400000),
        },
        {
          userId: m1User.id,
          type: "system_notice",
          title: "Scheduled Maintenance",
          body: "RasoKart will undergo scheduled maintenance on June 15, 2026 between 2:00 AM – 4:00 AM IST. Payments will be unaffected.",
          metadata: { broadcastBy: "admin@rasokart.com" },
          isRead: false,
          createdAt: new Date(Date.now() - 3 * 3600000),
        },
        {
          userId: m2User.id,
          type: "settlement_paid",
          title: "Settlement Paid",
          body: "Your settlement of ₹9,750 has been paid. Reference: REF20240607001",
          metadata: { referenceNumber: "REF20240607001" },
          isRead: false,
          createdAt: new Date(Date.now() - 1 * 86400000),
        },
        {
          userId: m2User.id,
          type: "system_notice",
          title: "Scheduled Maintenance",
          body: "RasoKart will undergo scheduled maintenance on June 15, 2026 between 2:00 AM – 4:00 AM IST. Payments will be unaffected.",
          metadata: { broadcastBy: "admin@rasokart.com" },
          isRead: false,
          createdAt: new Date(Date.now() - 3 * 3600000),
        },
      ];
      for (const n of NOTIF_SAMPLES) {
        await db.insert(notificationsTable).values(n);
      }
      console.log("Notifications seeded");
    }
  }

  // ── Reconciliation demo run ──────────────────────────────────────────────────
  {
    const [existing] = await db
      .select({ id: reconciliationRunsTable.id })
      .from(reconciliationRunsTable)
      .limit(1);

    if (!existing) {
      const [m1] = await db.select({ id: merchantsTable.id }).from(merchantsTable).limit(1);
      if (m1) {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
        const today = new Date().toISOString().slice(0, 10);

        const [run] = await db.insert(reconciliationRunsTable).values({
          merchantId: null,
          dateFrom: thirtyDaysAgo,
          dateTo: today,
          totalDeposits: 8,
          totalSettlements: 6,
          totalMatched: 5,
          totalUnmatched: 4,
          matchedAmount: "87500.00",
          unmatchedAmount: "22300.00",
          status: "complete",
          triggeredBy: "auto",
          createdBy: null,
          notes: "Demo seed run",
        }).returning();

        // Fetch real transactions and settlements to link in seed items
        const txns = await db
          .select({ id: transactionsTable.id, amount: transactionsTable.amount, utr: transactionsTable.utr, merchantId: transactionsTable.merchantId })
          .from(transactionsTable)
          .limit(8);
        const setts = await db
          .select({ id: settlementsTable.id, amount: settlementsTable.requestedAmount, merchantId: settlementsTable.merchantId })
          .from(settlementsTable)
          .limit(6);

        const items = [];
        // 5 matched pairs
        for (let i = 0; i < Math.min(5, txns.length, setts.length); i++) {
          items.push({
            runId: run.id,
            transactionId: txns[i].id,
            settlementId: setts[i].id,
            merchantId: txns[i].merchantId,
            status: "matched",
            amount: Number(txns[i].amount).toFixed(2),
            matchedAt: new Date(),
            notes: `Deposit UTR: ${txns[i].utr}`,
          });
        }
        // 3 unmatched deposits
        for (let i = 5; i < Math.min(8, txns.length); i++) {
          items.push({
            runId: run.id,
            transactionId: txns[i].id,
            settlementId: null,
            merchantId: txns[i].merchantId,
            status: "unmatched_deposit",
            amount: Number(txns[i].amount).toFixed(2),
            matchedAt: null,
            notes: `No matching settlement found for UTR: ${txns[i].utr}`,
          });
        }
        // 1 unmatched settlement
        if (setts.length >= 6) {
          items.push({
            runId: run.id,
            transactionId: null,
            settlementId: setts[5].id,
            merchantId: setts[5].merchantId,
            status: "unmatched_settlement",
            amount: Number(setts[5].amount ?? "5000").toFixed(2),
            matchedAt: null,
            notes: `No matching deposit found for settlement #${setts[5].id}`,
          });
        }

        if (items.length > 0) {
          await db.insert(reconciliationItemsTable).values(items);
        }
        console.log("Reconciliation run seeded");
      }
    }
  }

  // System config defaults — idempotent: only insert if key doesn't exist
  for (const [key, value] of Object.entries(SYSTEM_CONFIG_DEFAULTS)) {
    await db
      .insert(systemConfigTable)
      .values({ key, value })
      .onConflictDoNothing();
  }
  console.log("System config defaults seeded");

  // Seed system settings defaults (idempotent)
  await db
    .insert(systemSettingsTable)
    .values({ key: "finance_report_email", value: null })
    .onConflictDoNothing();

  await db
    .insert(systemSettingsTable)
    .values({ key: "reconciliation_schedule", value: "daily" })
    .onConflictDoNothing();

  // Partial unique index for provider limit notification deduplication.
  // Enforces at most one provider_limit_warning and one provider_limit_reached
  // per (userId, provider, calendar month), making onConflictDoNothing() reliable.
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS notifications_provider_limit_dedup_idx
      ON notifications(user_id, type, (metadata->>'provider'), (metadata->>'monthKey'))
      WHERE type IN ('provider_limit_warning', 'provider_limit_reached')
  `);

  // Deduplication index for provider_limit_reset: one reset notification per
  // provider per calendar month (keyed by currentMonthKey in metadata).
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS notifications_provider_limit_reset_dedup_idx
      ON notifications(user_id, (metadata->>'provider'), (metadata->>'currentMonthKey'))
      WHERE type = 'provider_limit_reset'
  `);

  // Backfill connectionId on historical transactions that have a provider but no connectionId.
  // Idempotent: WHERE clause limits to rows where connection_id IS NULL AND provider IS NOT NULL.
  //
  // Tie-break rationale: when a merchant has multiple connections for the same provider
  // (e.g. after rotating credentials), we prefer the connection that was *active at the time
  // the transaction was recorded*: filter to connections created before the transaction and
  // not yet deactivated at that time (deactivated_at IS NULL OR deactivated_at > transactions.created_at).
  // Among eligible connections we ORDER BY created_at ASC so the oldest qualifying connection
  // is chosen, matching the most likely provider in use at that moment.
  await db.execute(sql`
    UPDATE transactions
    SET connection_id = (
      SELECT id
      FROM merchant_connections
      WHERE merchant_id    = transactions.merchant_id
        AND provider       = transactions.provider
        AND created_at    <= transactions.created_at
        AND (deactivated_at IS NULL OR deactivated_at > transactions.created_at)
      ORDER BY created_at ASC
      LIMIT 1
    )
    WHERE connection_id IS NULL
      AND provider IS NOT NULL
  `);
  console.log("Connection ID backfill complete.");

  console.log("Seed complete.");
}

// Standalone runner (pnpm --filter @workspace/api-server run seed)
if (process.argv[1] && process.argv[1].includes("seed")) {
  seed()
    .then(() => process.exit(0))
    .catch(err => { console.error(err); process.exit(1); });
}
