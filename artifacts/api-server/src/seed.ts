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
} from "@workspace/db";

export async function seed() {
  console.log("Seeding database...");

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

  console.log("Seed complete.");
}

// Standalone runner (pnpm --filter @workspace/api-server run seed)
if (process.argv[1] && process.argv[1].includes("seed")) {
  seed()
    .then(() => process.exit(0))
    .catch((e) => { console.error(e); process.exit(1); });
}
