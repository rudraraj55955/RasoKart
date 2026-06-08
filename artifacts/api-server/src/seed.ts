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
    price: "0",
    pricing: JSON.stringify({ qr: { monthly: 0, perTx: 2 }, va: { monthly: 0, perTx: 5 } }),
    features: JSON.stringify(["5 Dynamic QR Codes", "2 Virtual Accounts", "Email Support"]),
    dynamicQrLimit: 5, staticQrLimit: 5, virtualAccountLimit: 2, paymentLinkLimit: 3, payoutLimit: 5,
    dailyTransactionLimit: 50, monthlyTransactionLimit: 500,
    settlementFee: "3.0", depositFee: "1.0",
    apiAccess: false, webhookAccess: false, isActive: true,
  },
  {
    name: "Silver",
    description: "For growing businesses that need more capacity and API access.",
    price: "999",
    pricing: JSON.stringify({ qr: { monthly: 999, perTx: 1.5 }, va: { monthly: 999, perTx: 3 } }),
    features: JSON.stringify(["25 Dynamic QR Codes", "10 Virtual Accounts", "API Access", "Priority Support"]),
    dynamicQrLimit: 25, staticQrLimit: 25, virtualAccountLimit: 10, paymentLinkLimit: 15, payoutLimit: 50,
    dailyTransactionLimit: 200, monthlyTransactionLimit: 3000,
    settlementFee: "2.0", depositFee: "0.5",
    apiAccess: true, webhookAccess: true, isActive: true,
  },
  {
    name: "Gold",
    description: "Built for established businesses with high transaction volumes.",
    price: "2499",
    pricing: JSON.stringify({ qr: { monthly: 2499, perTx: 1 }, va: { monthly: 2499, perTx: 2 } }),
    features: JSON.stringify(["100 Dynamic QR Codes", "30 Virtual Accounts", "API Access", "Webhooks", "Dedicated Support", "Advanced Analytics"]),
    dynamicQrLimit: 100, staticQrLimit: 100, virtualAccountLimit: 30, paymentLinkLimit: 50, payoutLimit: 200,
    dailyTransactionLimit: 1000, monthlyTransactionLimit: 15000,
    settlementFee: "1.5", depositFee: "0.25",
    apiAccess: true, webhookAccess: true, isActive: true,
  },
  {
    name: "Platinum",
    description: "High-volume plan with priority limits and lowest fees.",
    price: "4999",
    pricing: JSON.stringify({ qr: { monthly: 4999, perTx: 0.75 }, va: { monthly: 4999, perTx: 1.5 } }),
    features: JSON.stringify(["500 Dynamic QR Codes", "100 Virtual Accounts", "API Access", "Webhooks", "SLA Support", "Custom Integration"]),
    dynamicQrLimit: 500, staticQrLimit: 500, virtualAccountLimit: 100, paymentLinkLimit: 200, payoutLimit: 999,
    dailyTransactionLimit: 5000, monthlyTransactionLimit: 75000,
    settlementFee: "1.0", depositFee: "0.1",
    apiAccess: true, webhookAccess: true, isActive: true,
  },
  {
    name: "Custom",
    description: "Unlimited scale for large enterprises with negotiated terms.",
    price: "0",
    pricing: JSON.stringify({ qr: { monthly: 0, perTx: 0.5 }, va: { monthly: 0, perTx: 1 } }),
    features: JSON.stringify(["Unlimited QR Codes", "Unlimited Virtual Accounts", "Full API Access", "24/7 Support", "Custom SLA", "Dedicated Manager"]),
    dynamicQrLimit: 999, staticQrLimit: 999, virtualAccountLimit: 999, paymentLinkLimit: 999, payoutLimit: 999,
    dailyTransactionLimit: 999, monthlyTransactionLimit: 999,
    settlementFee: "0.5", depositFee: "0.0",
    apiAccess: true, webhookAccess: true, isActive: true,
  },
];

export async function seed() {
  console.log("Seeding database...");

  // ── Plan tiers ────────────────────────────────────────────────────────────
  // Upsert by name so re-seeding is idempotent.
  for (const tier of PLAN_TIERS) {
    await db.insert(plansTable).values(tier)
      .onConflictDoUpdate({ target: plansTable.name, set: tier });
  }
  console.log("Plans seeded");

  // ── Users & Merchants ────────────────────────────────────────────────────
  // These tables have unique constraints on email → safe to upsert every boot.

  const adminHash = await bcrypt.hash("Admin@123456", 10);
  const [admin] = await db
    .insert(usersTable)
    .values({ email: "admin@rpay.com", passwordHash: adminHash, name: "Super Admin", role: "admin", isActive: true })
    .onConflictDoUpdate({ target: usersTable.email, set: { passwordHash: adminHash, name: "Super Admin" } })
    .returning();
  console.log("Admin:", admin.email);

  const [merchant1] = await db
    .insert(merchantsTable)
    .values({
      businessName: "TechMart Solutions",
      contactName: "Rahul Sharma",
      email: "merchant@techmart.com",
      phone: "+91-9876543210",
      website: "https://techmart.com",
      status: "approved",
      totalDeposits: "584200",
      totalWithdrawals: "132000",
      balance: "452200",
    })
    .onConflictDoUpdate({ target: merchantsTable.email, set: { status: "approved" } })
    .returning();

  const merch1Hash = await bcrypt.hash("Merchant@123456", 10);
  await db
    .insert(usersTable)
    .values({ email: "merchant@techmart.com", passwordHash: merch1Hash, name: "Rahul Sharma", role: "merchant", isActive: true, merchantId: merchant1.id })
    .onConflictDoUpdate({ target: usersTable.email, set: { merchantId: merchant1.id } });

  const [merchant2] = await db
    .insert(merchantsTable)
    .values({ businessName: "GlobalPay Inc", contactName: "Priya Patel", email: "priya@globalpay.io", phone: "+91-8765432109", status: "pending" })
    .onConflictDoUpdate({ target: merchantsTable.email, set: { status: "pending" } })
    .returning();

  const merch2Hash = await bcrypt.hash("Merchant@123456", 10);
  await db
    .insert(usersTable)
    .values({ email: "priya@globalpay.io", passwordHash: merch2Hash, name: "Priya Patel", role: "merchant", isActive: true, merchantId: merchant2.id })
    .onConflictDoUpdate({ target: usersTable.email, set: { merchantId: merchant2.id } });

  await db
    .insert(merchantsTable)
    .values({ businessName: "FastCash Ltd", contactName: "Amit Kumar", email: "amit@fastcash.in", phone: "+91-7654321098", status: "rejected", rejectionReason: "Incomplete documentation" })
    .onConflictDoUpdate({ target: merchantsTable.email, set: { status: "rejected" } });

  // Assign plans to merchants so limit enforcement works
  const [starterPlan] = await db.select({ id: plansTable.id }).from(plansTable).where(eq(plansTable.name, "Starter")).limit(1);
  const [goldPlan] = await db.select({ id: plansTable.id }).from(plansTable).where(eq(plansTable.name, "Gold")).limit(1);
  if (starterPlan) {
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days from now
    await db.insert(merchantPlansTable).values({ merchantId: merchant1.id, planId: starterPlan.id, expiresAt })
      .onConflictDoUpdate({ target: merchantPlansTable.merchantId, set: { planId: starterPlan.id, expiresAt } });
  }
  if (goldPlan) {
    const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // 1 year
    await db.insert(merchantPlansTable).values({ merchantId: merchant2.id, planId: goldPlan.id, expiresAt })
      .onConflictDoUpdate({ target: merchantPlansTable.merchantId, set: { planId: goldPlan.id, expiresAt } });
  }

  console.log("Merchants seeded");

  // ── Transactions ─────────────────────────────────────────────────────────
  // Uses UTR as unique key → onConflictDoNothing is safe.
  const txData = [
    { type: "deposit",    status: "success", amount: "25000.00", utr: "UTR2024001" },
    { type: "deposit",    status: "success", amount: "48500.00", utr: "UTR2024002" },
    { type: "deposit",    status: "pending", amount: "15000.00", utr: "UTR2024003" },
    { type: "deposit",    status: "failed",  amount: "8900.00",  utr: "UTR2024004" },
    { type: "withdrawal", status: "success", amount: "32000.00", utr: "UTR2024005" },
    { type: "deposit",    status: "success", amount: "67200.00", utr: "UTR2024006" },
    { type: "deposit",    status: "success", amount: "12500.00", utr: "UTR2024007" },
    { type: "withdrawal", status: "pending", amount: "20000.00", utr: "UTR2024008" },
    { type: "deposit",    status: "success", amount: "93100.00", utr: "UTR2024009" },
    { type: "deposit",    status: "failed",  amount: "5500.00",  utr: "UTR2024010" },
    { type: "deposit",    status: "success", amount: "38700.00", utr: "UTR2024011" },
    { type: "withdrawal", status: "success", amount: "50000.00", utr: "UTR2024012" },
    { type: "deposit",    status: "success", amount: "29300.00", utr: "UTR2024013" },
    { type: "deposit",    status: "pending", amount: "18400.00", utr: "UTR2024014" },
    { type: "deposit",    status: "success", amount: "72900.00", utr: "UTR2024015" },
  ];
  for (let i = 0; i < txData.length; i++) {
    const d = new Date();
    d.setDate(d.getDate() - Math.floor(i * 2));
    await db.insert(transactionsTable).values({
      merchantId: merchant1.id,
      type: txData[i].type,
      status: txData[i].status,
      amount: txData[i].amount,
      currency: "INR",
      utr: txData[i].utr,
      referenceId: `REF${1000 + i}`,
      description: `Sample ${txData[i].type} transaction`,
      createdAt: d,
      updatedAt: d,
    }).onConflictDoNothing();
  }
  console.log("Transactions seeded");

  // ── API key & Webhook ─────────────────────────────────────────────────────
  // Both have unique constraints → onConflictDoNothing is safe.
  await db.insert(apiKeysTable).values({
    merchantId: merchant1.id,
    apiKey: "rpay_live_abc123def456ghi789jkl012mno345pqr678stu",
    secretKey: "rpay_secret_xyz987wvu654tsr321qpo098nml765kji432",
    keyPrefix: "rpay_live_abc123de...",
    isActive: true,
  }).onConflictDoNothing();

  await db.insert(webhooksTable).values({
    merchantId: merchant1.id,
    url: "https://techmart.com/rpay-webhook",
    isActive: true,
    events: ["payment.success", "payment.failed", "withdrawal.approved"],
    secret: "wh_secret_abc123",
  }).onConflictDoNothing();

  // ── Detail data: guard with count to prevent duplicates on re-seed ────────
  // Withdrawals, CallbackLogs, Settlements have no stable natural unique key.
  // We skip these blocks when records already exist for merchant1.

  const [{ wdCount }] = await db
    .select({ wdCount: count() })
    .from(withdrawalsTable)
    .where(eq(withdrawalsTable.merchantId, merchant1.id));

  if (Number(wdCount) === 0) {
    const wdData = [
      { amount: "50000.00", status: "approved" },
      { amount: "32000.00", status: "pending" },
      { amount: "20000.00", status: "rejected" },
      { amount: "75000.00", status: "approved" },
      { amount: "15000.00", status: "pending" },
    ];
    for (let i = 0; i < wdData.length; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i * 4);
      await db.insert(withdrawalsTable).values({
        merchantId: merchant1.id,
        amount: wdData[i].amount,
        currency: "INR",
        status: wdData[i].status,
        bankAccount: `50${i}0123456789`,
        bankName: "HDFC Bank",
        ifscCode: `HDFC000${i}001`,
        accountHolder: "Rahul Sharma",
        rejectionReason: wdData[i].status === "rejected" ? "Insufficient balance" : null,
        createdAt: d,
        updatedAt: d,
      });
    }
  }
  console.log("Withdrawals seeded");

  const [{ cbCount }] = await db
    .select({ cbCount: count() })
    .from(callbackLogsTable)
    .where(eq(callbackLogsTable.merchantId, merchant1.id));

  if (Number(cbCount) === 0) {
    for (let i = 0; i < 8; i++) {
      const d = new Date();
      d.setDate(d.getDate() - Math.floor(i * 1.5));
      const status = i % 3 === 0 ? "failed" : "success";
      await db.insert(callbackLogsTable).values({
        merchantId: merchant1.id,
        url: "https://techmart.com/rpay-webhook",
        status,
        httpStatus: status === "success" ? 200 : 500,
        requestBody: JSON.stringify({ event: "payment.success", amount: 25000, utr: `UTR202400${i + 1}` }),
        responseBody: status === "success" ? JSON.stringify({ received: true }) : JSON.stringify({ error: "Connection timeout" }),
        attempts: status === "failed" ? 3 : 1,
        createdAt: d,
      });
    }
  }
  console.log("Callback logs seeded");

  const [{ stCount }] = await db
    .select({ stCount: count() })
    .from(settlementsTable)
    .where(eq(settlementsTable.merchantId, merchant1.id));

  if (Number(stCount) === 0) {
    for (let i = 0; i < 3; i++) {
      const from = new Date();
      from.setDate(from.getDate() - (i + 1) * 7);
      const to = new Date();
      to.setDate(to.getDate() - i * 7);
      await db.insert(settlementsTable).values({
        merchantId: merchant1.id,
        amount: (50000 + i * 25000).toFixed(2),
        currency: "INR",
        status: i < 2 ? "processed" : "pending",
        periodFrom: from.toISOString().slice(0, 10),
        periodTo: to.toISOString().slice(0, 10),
        transactionCount: 10 + i * 5,
        createdAt: to,
        updatedAt: to,
      });
    }
  }
  console.log("Settlements seeded");

  // ── QR Codes ──────────────────────────────────────────────────────────────
  const [{ qrCount }] = await db
    .select({ qrCount: count() })
    .from(qrCodesTable)
    .where(eq(qrCodesTable.merchantId, merchant1.id));

  let demoQrId: number | undefined;
  if (Number(qrCount) === 0) {
    const [qr1] = await db.insert(qrCodesTable).values({
      merchantId: merchant1.id,
      type: "dynamic",
      label: "Store Checkout",
      payload: "upi://pay?pa=techmart@hdfc&pn=TechMart+Solutions&tn=Payment&cu=INR",
      status: "active",
    }).returning();
    demoQrId = qr1.id;

    await db.insert(qrCodesTable).values({
      merchantId: merchant1.id,
      type: "static",
      label: "Product Page QR",
      payload: "upi://pay?pa=techmart@hdfc&pn=TechMart+Solutions&am=499&tn=Product+Purchase&cu=INR",
      amount: "499.00",
      status: "active",
    });

    await db.insert(qrCodesTable).values({
      merchantId: merchant1.id,
      type: "dynamic",
      label: "Event Registration",
      payload: "upi://pay?pa=techmart@hdfc&pn=TechMart+Solutions&tn=Event+Registration&cu=INR",
      status: "inactive",
    });
  } else {
    const [existingQr] = await db.select().from(qrCodesTable)
      .where(and(eq(qrCodesTable.merchantId, merchant1.id), eq(qrCodesTable.status, "active")))
      .limit(1);
    demoQrId = existingQr?.id;
  }
  console.log("QR codes seeded");

  // ── Virtual Accounts ──────────────────────────────────────────────────────
  const [{ vaCount }] = await db
    .select({ vaCount: count() })
    .from(virtualAccountsTable)
    .where(eq(virtualAccountsTable.merchantId, merchant1.id));

  let demoVaId: number | undefined;
  if (Number(vaCount) === 0) {
    const [va1] = await db.insert(virtualAccountsTable).values({
      merchantId: merchant1.id,
      accountNumber: "999001234567890",
      ifsc: "HDFC0001234",
      bankName: "HDFC Bank",
      accountHolder: "TechMart Solutions",
      label: "Primary Collection Account",
      balance: "0.00",
      status: "active",
    }).returning();
    demoVaId = va1.id;

    await db.insert(virtualAccountsTable).values({
      merchantId: merchant1.id,
      accountNumber: "999001234567891",
      ifsc: "ICIC0005678",
      bankName: "ICICI Bank",
      accountHolder: "TechMart Solutions",
      label: "Secondary Account",
      balance: "0.00",
      status: "active",
    });
  } else {
    const [existingVa] = await db.select().from(virtualAccountsTable)
      .where(and(eq(virtualAccountsTable.merchantId, merchant1.id), eq(virtualAccountsTable.status, "active")))
      .limit(1);
    demoVaId = existingVa?.id;
  }
  console.log("Virtual accounts seeded");

  // ── Today's Deposit Transactions (QR & VA linked) ─────────────────────────
  // Seed today's demo deposits so the dashboard "Today's Deposits" card shows data.
  const todayDeposits = [
    { utr: "TODAY001", amount: "12500.00", sourceType: "qr",  sourceId: demoQrId, label: "Store Checkout", status: "success" },
    { utr: "TODAY002", amount: "4999.00",  sourceType: "va",  sourceId: demoVaId, label: "Primary Collection Account", status: "success" },
    { utr: "TODAY003", amount: "8750.00",  sourceType: "qr",  sourceId: demoQrId, label: "Store Checkout", status: "success" },
    { utr: "TODAY004", amount: "2200.00",  sourceType: "va",  sourceId: demoVaId, label: "Primary Collection Account", status: "pending" },
    { utr: "TODAY005", amount: "15000.00", sourceType: "qr",  sourceId: demoQrId, label: "Store Checkout", status: "failed" },
  ];

  for (const dep of todayDeposits) {
    const now = new Date();
    now.setMinutes(now.getMinutes() - Math.floor(Math.random() * 480)); // within last 8 hours
    if (dep.sourceId) {
      await db.insert(transactionsTable).values({
        merchantId: merchant1.id,
        type: "deposit",
        status: dep.status,
        amount: dep.amount,
        currency: "INR",
        utr: dep.utr,
        referenceId: `SIM-${dep.sourceType.toUpperCase()}-${dep.sourceId}-SEED`,
        description: `Payment via ${dep.sourceType === "qr" ? "QR Code" : "Virtual Account"}: ${dep.label}`,
        metadata: JSON.stringify({ sourceType: dep.sourceType, sourceId: dep.sourceId, simulated: true }),
        createdAt: now,
        updatedAt: now,
      }).onConflictDoNothing();
    }
  }
  console.log("Today's deposits seeded");

  // ── Account Details ─────────────────────────────────────────────────────────
  const adCount = await db.select({ c: count() }).from(accountDetailsTable);
  if (adCount[0].c === 0) {
    await db.insert(accountDetailsTable).values([
      { type: "bank", label: "HDFC Bank – Primary", accountHolder: "RPay Payments Pvt Ltd", accountNumber: "50200012345678", ifsc: "HDFC0001234", bankName: "HDFC Bank", isGlobal: true, isActive: true, sortOrder: 1 },
      { type: "bank", label: "ICICI Bank – Secondary", accountHolder: "RPay Payments Pvt Ltd", accountNumber: "123456789012", ifsc: "ICIC0000456", bankName: "ICICI Bank", isGlobal: true, isActive: true, sortOrder: 2 },
      { type: "upi", label: "PhonePe UPI", upiId: "rpay@phonepe", provider: "phonepe", isGlobal: true, isActive: true, sortOrder: 3 },
      { type: "upi", label: "GPay UPI", upiId: "rpay@gpay", provider: "gpay", isGlobal: false, isActive: true, sortOrder: 4 },
      { type: "qr", label: "Paytm QR Code", qrPayload: "00020101021226180014paytm.com/qr/rpa01", provider: "paytm", isGlobal: true, isActive: true, sortOrder: 5 },
    ]);
    console.log("Account details seeded");
  }

  console.log("Seed complete.");
}

// Standalone runner (pnpm --filter @workspace/api-server run seed)
if (process.argv[1] && process.argv[1].includes("seed")) {
  seed()
    .then(() => process.exit(0))
    .catch((e) => { console.error(e); process.exit(1); });
}
