import bcrypt from "bcryptjs";
import { db, usersTable, merchantsTable, transactionsTable, withdrawalsTable, callbackLogsTable, settlementsTable, apiKeysTable, webhooksTable } from "@workspace/db";
import { eq } from "drizzle-orm";

async function seed() {
  console.log("Seeding database...");

  // Admin user
  const adminHash = await bcrypt.hash("Admin@123456", 10);
  const [admin] = await db.insert(usersTable).values({
    email: "admin@rpay.com",
    passwordHash: adminHash,
    name: "Super Admin",
    role: "admin",
    isActive: true,
  }).onConflictDoUpdate({ target: usersTable.email, set: { passwordHash: adminHash, name: "Super Admin" } }).returning();
  console.log("Admin created:", admin.email);

  // Merchant 1: approved
  const [merchant1] = await db.insert(merchantsTable).values({
    businessName: "TechMart Solutions",
    contactName: "Rahul Sharma",
    email: "merchant@techmart.com",
    phone: "+91-9876543210",
    website: "https://techmart.com",
    status: "approved",
    totalDeposits: "584200",
    totalWithdrawals: "132000",
    balance: "452200",
  }).onConflictDoUpdate({ target: merchantsTable.email, set: { status: "approved" } }).returning();

  const merch1Hash = await bcrypt.hash("Merchant@123456", 10);
  await db.insert(usersTable).values({
    email: "merchant@techmart.com",
    passwordHash: merch1Hash,
    name: "Rahul Sharma",
    role: "merchant",
    isActive: true,
    merchantId: merchant1.id,
  }).onConflictDoUpdate({ target: usersTable.email, set: { merchantId: merchant1.id } });

  // Merchant 2: pending
  const [merchant2] = await db.insert(merchantsTable).values({
    businessName: "GlobalPay Inc",
    contactName: "Priya Patel",
    email: "priya@globalpay.io",
    phone: "+91-8765432109",
    status: "pending",
  }).onConflictDoUpdate({ target: merchantsTable.email, set: { status: "pending" } }).returning();

  const merch2Hash = await bcrypt.hash("Merchant@123456", 10);
  await db.insert(usersTable).values({
    email: "priya@globalpay.io",
    passwordHash: merch2Hash,
    name: "Priya Patel",
    role: "merchant",
    isActive: true,
    merchantId: merchant2.id,
  }).onConflictDoUpdate({ target: usersTable.email, set: { merchantId: merchant2.id } });

  // Merchant 3: rejected
  const [merchant3] = await db.insert(merchantsTable).values({
    businessName: "FastCash Ltd",
    contactName: "Amit Kumar",
    email: "amit@fastcash.in",
    phone: "+91-7654321098",
    status: "rejected",
    rejectionReason: "Incomplete documentation",
  }).onConflictDoUpdate({ target: merchantsTable.email, set: { status: "rejected" } }).returning();

  console.log("Merchants created");

  // Transactions
  const txData = [
    { type: "deposit", status: "success", amount: "25000.00", utr: "UTR2024001" },
    { type: "deposit", status: "success", amount: "48500.00", utr: "UTR2024002" },
    { type: "deposit", status: "pending", amount: "15000.00", utr: "UTR2024003" },
    { type: "deposit", status: "failed", amount: "8900.00", utr: "UTR2024004" },
    { type: "withdrawal", status: "success", amount: "32000.00", utr: "UTR2024005" },
    { type: "deposit", status: "success", amount: "67200.00", utr: "UTR2024006" },
    { type: "deposit", status: "success", amount: "12500.00", utr: "UTR2024007" },
    { type: "withdrawal", status: "pending", amount: "20000.00", utr: "UTR2024008" },
    { type: "deposit", status: "success", amount: "93100.00", utr: "UTR2024009" },
    { type: "deposit", status: "failed", amount: "5500.00", utr: "UTR2024010" },
    { type: "deposit", status: "success", amount: "38700.00", utr: "UTR2024011" },
    { type: "withdrawal", status: "success", amount: "50000.00", utr: "UTR2024012" },
    { type: "deposit", status: "success", amount: "29300.00", utr: "UTR2024013" },
    { type: "deposit", status: "pending", amount: "18400.00", utr: "UTR2024014" },
    { type: "deposit", status: "success", amount: "72900.00", utr: "UTR2024015" },
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

  // Withdrawals
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
  console.log("Withdrawals seeded");

  // API key
  await db.insert(apiKeysTable).values({
    merchantId: merchant1.id,
    apiKey: "rpay_live_abc123def456ghi789jkl012mno345pqr678stu",
    secretKey: "rpay_secret_xyz987wvu654tsr321qpo098nml765kji432",
    keyPrefix: "rpay_live_abc123de...",
    isActive: true,
  }).onConflictDoNothing();
  console.log("API key seeded");

  // Webhook
  await db.insert(webhooksTable).values({
    merchantId: merchant1.id,
    url: "https://techmart.com/rpay-webhook",
    isActive: true,
    events: ["payment.success", "payment.failed", "withdrawal.approved"],
    secret: "wh_secret_abc123",
  }).onConflictDoNothing();
  console.log("Webhook seeded");

  // Callback logs
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
  console.log("Callback logs seeded");

  // Settlements
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
  console.log("Settlements seeded");
  console.log("All seeding complete!");
  process.exit(0);
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
