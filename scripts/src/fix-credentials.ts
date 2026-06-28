/**
 * fix-credentials.ts
 *
 * Idempotent production credential repair script.
 * Safe to run multiple times — only upserts users/merchants, never deletes data.
 *
 * Usage on VPS:
 *   cd /opt/rasokart
 *   DATABASE_URL="postgres://..." pnpm --filter @workspace/scripts run fix-credentials
 *
 * What it does:
 *   1. Hashes correct passwords with bcrypt
 *   2. Upserts admin user with correct hash + role + isActive
 *   3. Upserts all 3 merchant users with correct hash + role + isActive
 *   4. Upserts merchant profiles in merchants table
 *   5. Links users.merchant_id → merchants.id
 *   6. Upserts Starter/Gold plan assignments
 *
 * What it does NOT do:
 *   - Does not delete any existing data
 *   - Does not touch transactions, QR codes, VAs, providers, or nginx config
 *   - Does not read or write provider secrets
 */

import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, usersTable, merchantsTable, merchantPlansTable, plansTable } from "@workspace/db";

const ADMIN_EMAIL    = "admin@rasokart.com";
const ADMIN_PASSWORD = "Admin@123456";
const ADMIN_NAME     = "Super Admin";

const MERCHANT_PASSWORD = "Merchant@123456";

const MERCHANTS = [
  {
    email:        "merchant@demo.com",
    name:         "Demo Merchant",
    businessName: "Demo Business Pvt Ltd",
    contactName:  "Demo Merchant",
    phone:        "+91-9876543210",
    planName:     "Starter",
  },
  {
    email:        "merchant2@demo.com",
    name:         "Merchant Two",
    businessName: "TechPay Solutions",
    contactName:  "Merchant Two",
    phone:        "+91-9876543211",
    planName:     "Gold",
  },
  {
    email:        "rudraraj4496@gmail.com",
    name:         "Rudraraj",
    businessName: "Rudraraj Enterprises",
    contactName:  "Rudraraj",
    phone:        "+91-9999994496",
    planName:     "Starter",
  },
] as const;

async function run() {
  console.log("=== RasoKart Production Credential Fix ===\n");

  // ── 1. Hash passwords ───────────────────────────────────────────────────────
  console.log("Hashing passwords (bcrypt cost 10)...");
  const adminHash    = await bcrypt.hash(ADMIN_PASSWORD,    10);
  const merchantHash = await bcrypt.hash(MERCHANT_PASSWORD, 10);
  console.log("  admin hash   : computed");
  console.log("  merchant hash: computed\n");

  // ── 2. Upsert admin ─────────────────────────────────────────────────────────
  const [admin] = await db
    .insert(usersTable)
    .values({
      email:        ADMIN_EMAIL,
      passwordHash: adminHash,
      name:         ADMIN_NAME,
      role:         "admin",
      isActive:     true,
    })
    .onConflictDoUpdate({
      target: usersTable.email,
      set: {
        passwordHash: adminHash,
        name:         ADMIN_NAME,
        role:         "admin",
        isActive:     true,
      },
    })
    .returning();
  console.log(`✓ Admin upserted: ${admin.email}  (id=${admin.id})`);

  // ── 3. Upsert merchant users + profiles ────────────────────────────────────
  const planExpiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // 1 year

  for (const m of MERCHANTS) {
    // 3a. Upsert user row
    const [user] = await db
      .insert(usersTable)
      .values({
        email:        m.email,
        passwordHash: merchantHash,
        name:         m.name,
        role:         "merchant",
        isActive:     true,
      })
      .onConflictDoUpdate({
        target: usersTable.email,
        set: {
          passwordHash: merchantHash,
          name:         m.name,
          role:         "merchant",
          isActive:     true,
        },
      })
      .returning();

    // 3b. Upsert merchant profile
    const [merchant] = await db
      .insert(merchantsTable)
      .values({
        businessName: m.businessName,
        contactName:  m.contactName,
        email:        m.email,
        phone:        m.phone,
        status:       "approved",
      })
      .onConflictDoUpdate({
        target: merchantsTable.email,
        set: {
          businessName: m.businessName,
          contactName:  m.contactName,
          status:       "approved",
        },
      })
      .returning();

    // 3c. Link user → merchant
    await db
      .update(usersTable)
      .set({ merchantId: merchant.id })
      .where(eq(usersTable.email, m.email));

    // 3d. Upsert plan assignment
    const [plan] = await db
      .select({ id: plansTable.id })
      .from(plansTable)
      .where(eq(plansTable.name, m.planName))
      .limit(1);

    if (plan) {
      await db
        .insert(merchantPlansTable)
        .values({
          merchantId: merchant.id,
          planId:     plan.id,
          expiresAt:  planExpiry,
          status:     "active",
        })
        .onConflictDoUpdate({
          target: merchantPlansTable.merchantId,
          set: {
            planId:    plan.id,
            expiresAt: planExpiry,
            status:    "active",
          },
        });
      console.log(`✓ Merchant upserted: ${m.email}  (userId=${user.id}, merchantId=${merchant.id}, plan=${m.planName})`);
    } else {
      console.warn(`⚠ Plan "${m.planName}" not found — skipping plan assignment for ${m.email}`);
      console.log(`✓ Merchant upserted: ${m.email}  (userId=${user.id}, merchantId=${merchant.id})`);
    }
  }

  // ── 4. Verify logins work ───────────────────────────────────────────────────
  console.log("\n=== Verifying credentials ===");

  async function verifyLogin(email: string, password: string, storedHash: string) {
    const ok = await bcrypt.compare(password, storedHash);
    console.log(`  ${ok ? "✓" : "✗"} ${email} — bcrypt verify: ${ok ? "PASS" : "FAIL"}`);
    return ok;
  }

  // Re-read from DB to confirm what's actually stored
  const rows = await db
    .select({ email: usersTable.email, hash: usersTable.passwordHash, role: usersTable.role, isActive: usersTable.isActive, merchantId: usersTable.merchantId })
    .from(usersTable)
    .where(eq(usersTable.email, ADMIN_EMAIL));

  const merchantRows = await db
    .select({ email: usersTable.email, hash: usersTable.passwordHash, role: usersTable.role, isActive: usersTable.isActive, merchantId: usersTable.merchantId })
    .from(usersTable);

  const allRows = merchantRows.filter(r =>
    [ADMIN_EMAIL, ...MERCHANTS.map(m => m.email)].includes(r.email)
  );

  let allOk = true;
  for (const row of allRows) {
    const password = row.email === ADMIN_EMAIL ? ADMIN_PASSWORD : MERCHANT_PASSWORD;
    const ok = await bcrypt.compare(password, row.hash);
    const label = ok ? "✓ PASS" : "✗ FAIL";
    const roleOk = row.email === ADMIN_EMAIL ? row.role === "admin" : row.role === "merchant";
    const merchantLink = row.merchantId ? `merchantId=${row.merchantId}` : "NO_MERCHANT_LINK";
    console.log(`  ${label} | ${row.email} | role=${row.role}${roleOk ? "" : " ⚠WRONG_ROLE"} | isActive=${row.isActive} | ${merchantLink}`);
    if (!ok || !row.isActive) allOk = false;
  }

  console.log(`\n${allOk ? "✅ All credentials OK — production DB is ready." : "❌ Some credentials failed — check output above."}`);
  process.exit(allOk ? 0 : 1);
}

run().catch((err) => {
  console.error("❌ Fatal error:", err);
  process.exit(1);
});
