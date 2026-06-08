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
  ledgerEntriesTable,
  providersTable,
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
      { name: "UPI ID",                 slug: "upi_id",          category: "upi",     status: "live",         description: "Collect payments via any UPI virtual payment address",          sortOrder: 1  },
      { name: "Google Pay Business",    slug: "google_pay",      category: "upi",     status: "live",         description: "Google Pay for Business — fast UPI collections",                sortOrder: 2  },
      { name: "PhonePe Business",       slug: "phonepe",         category: "upi",     status: "live",         description: "PhonePe Business UPI merchant payments",                        sortOrder: 3  },
      { name: "Paytm Business",         slug: "paytm",           category: "upi",     status: "live",         description: "Paytm for Business — UPI, wallet, and net banking",             sortOrder: 4  },
      { name: "BharatPe",               slug: "bharatpe",        category: "upi",     status: "live",         description: "BharatPe QR — zero MDR UPI collections",                       sortOrder: 5  },
      { name: "Amazon Pay",             slug: "amazon_pay",      category: "upi",     status: "live",         description: "Amazon Pay UPI merchant checkout",                              sortOrder: 6  },
      { name: "MobiKwik",               slug: "mobikwik",        category: "upi",     status: "live",         description: "MobiKwik merchant payment gateway",                             sortOrder: 7  },
      { name: "Freecharge",             slug: "freecharge",      category: "upi",     status: "coming_soon",  description: "Freecharge Business UPI — launching soon",                     sortOrder: 8  },
      { name: "YONO SBI",               slug: "yono_sbi",        category: "bank",    status: "testing",      description: "SBI YONO merchant collection account",                         sortOrder: 9  },
      { name: "HDFC SmartHub Vyapar",   slug: "hdfc_smarthub",   category: "bank",    status: "testing",      description: "HDFC SmartHub Vyapar all-in-one merchant solution",             sortOrder: 10 },
      { name: "ICICI iMobile Pay",      slug: "icici_imobile",   category: "bank",    status: "coming_soon",  description: "ICICI Bank iMobile Pay merchant collection",                   sortOrder: 11 },
      { name: "Axis Bank Pay",          slug: "axis_pay",        category: "bank",    status: "coming_soon",  description: "Axis Bank merchant payment gateway",                            sortOrder: 12 },
      { name: "Kotak 811",              slug: "kotak_811",       category: "bank",    status: "coming_soon",  description: "Kotak Mahindra 811 merchant digital payments",                  sortOrder: 13 },
      { name: "Razorpay",               slug: "razorpay",        category: "gateway", status: "coming_soon",  description: "Razorpay full-stack payment gateway (cards, UPI, wallets)",    sortOrder: 14 },
      { name: "Cashfree Payments",      slug: "cashfree",        category: "gateway", status: "coming_soon",  description: "Cashfree multi-mode payment gateway",                          sortOrder: 15 },
      { name: "PayU",                   slug: "payu",            category: "gateway", status: "coming_soon",  description: "PayU merchant payment gateway",                                sortOrder: 16 },
    ];
    for (const p of PROVIDERS) {
      await db.insert(providersTable).values(p).onConflictDoUpdate({ target: providersTable.slug, set: { name: p.name, status: p.status, sortOrder: p.sortOrder } });
    }
    console.log("Providers seeded");
  }

  console.log("Seed complete.");
}

// Standalone runner (pnpm --filter @workspace/api-server run seed)
if (process.argv[1] && process.argv[1].includes("seed")) {
  seed()
    .then(() => process.exit(0))
    .catch(err => { console.error(err); process.exit(1); });
}
