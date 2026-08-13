/**
 * Safe dummy/demo/test data cleanup for RasoKart Admin/Super Admin.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run cleanup:dummy-data -- --dry-run
 *   pnpm --filter @workspace/scripts run cleanup:dummy-data -- --confirm CLEAN_DUMMY_DATA
 *
 * Safety:
 *  - Never deletes Super Admin / admin accounts.
 *  - Never deletes the 3 documented demo merchant logins (merchant@demo.com,
 *    merchant2@demo.com, merchant3@demo.com) — only their seeded
 *    transaction/payout/wallet/ledger history, since those logins are
 *    required by replit.md and the deploy health check.
 *  - Deletes user rows for non-protected dummy merchants (prevents orphan users).
 *  - Protected demo merchant user accounts are kept intact.
 *  - Never flags a row as dummy purely because of a small (₹1/₹10) amount.
 *  - Entire cleanup runs inside ONE database transaction: all-or-nothing.
 *  - Writes a DUMMY_DATA_CLEANUP audit_logs row per affected table.
 */
import { sql, inArray } from "drizzle-orm";
import {
  db,
  pool,
  merchantsTable,
  usersTable,
  auditLogsTable,
  merchantWalletsTable,
} from "@workspace/db";
import { DEMO_CREDENTIALS } from "@workspace/demo-credentials";

const PROTECTED_DEMO_EMAILS = DEMO_CREDENTIALS.filter((c) => c.role === "merchant").map((c) => c.email);
const FAKE_MOBILES = ["9999999999", "8888888888", "0000000000", "1234567890"];
const NAME_PATTERN = sql`(lower(${merchantsTable.email}) LIKE '%test%' OR lower(${merchantsTable.email}) LIKE '%demo%' OR lower(${merchantsTable.email}) LIKE '%dummy%' OR lower(${merchantsTable.email}) LIKE '%example%' OR lower(${merchantsTable.businessName}) LIKE '%test%' OR lower(${merchantsTable.businessName}) LIKE '%demo%' OR lower(${merchantsTable.businessName}) LIKE '%dummy%' OR lower(${merchantsTable.businessName}) LIKE '%sample%')`;
const REFERENCE_PATTERN = sql`(upper(reference_id) LIKE '%TEST%' OR upper(reference_id) LIKE '%DEMO%' OR upper(reference_id) LIKE '%DUMMY%' OR upper(reference_id) LIKE '%SAMPLE%')`;

const MERCHANT_SCOPED_TABLES = [
  "transactions",
  "withdrawals",
  "wallet_ledger",
  "settlements",
  "qr_codes",
  "virtual_accounts",
  "verification_logs",
  "kyc_verification_logs",
  "report_delivery_logs",
];

async function detect() {
  const findings: { table: string; count: number; sampleIds: number[]; reason: string }[] = [];

  const protectedRows = PROTECTED_DEMO_EMAILS.length
    ? await db.select({ id: merchantsTable.id }).from(merchantsTable).where(inArray(merchantsTable.email, PROTECTED_DEMO_EMAILS))
    : [];
  const protectedIds = protectedRows.map((r) => r.id);

  const dummyMerchantRows = await db
    .select({ id: merchantsTable.id, email: merchantsTable.email })
    .from(merchantsTable)
    .where(sql`(${NAME_PATTERN} OR ${merchantsTable.phone} IN (${sql.join(FAKE_MOBILES.map((m) => sql`${m}`), sql`, `)}))`);
  const deletableIds = dummyMerchantRows.filter((r) => !PROTECTED_DEMO_EMAILS.includes(r.email)).map((r) => r.id);

  const seededIds = [...protectedIds, ...deletableIds];

  if (deletableIds.length > 0) {
    findings.push({
      table: "merchants",
      count: deletableIds.length,
      sampleIds: deletableIds.slice(0, 10),
      reason: "email/business name matches test|demo|dummy|sample|example, or phone is a known fake number",
    });
  }

  if (seededIds.length > 0) {
    const idList = sql.join(seededIds.map((id) => sql`${id}`), sql`, `);
    for (const table of MERCHANT_SCOPED_TABLES) {
      const rows: any = await db.execute(sql`SELECT id FROM ${sql.raw(table)} WHERE merchant_id IN (${idList}) LIMIT 10000`);
      const list = rows.rows ?? rows;
      if (list.length > 0) {
        findings.push({ table, count: list.length, sampleIds: list.slice(0, 10).map((r: any) => r.id), reason: "belongs to a seeded demo merchant" });
      }
    }

    const demoUsers = await db.select({ id: usersTable.id }).from(usersTable).where(inArray(usersTable.merchantId, seededIds));
    const demoUserIds = demoUsers.map((u) => u.id);
    if (demoUserIds.length > 0) {
      const notifRows: any = await db.execute(sql`SELECT id FROM notifications WHERE user_id IN (${sql.join(demoUserIds.map((id) => sql`${id}`), sql`, `)}) LIMIT 10000`);
      const list = notifRows.rows ?? notifRows;
      if (list.length > 0) {
        findings.push({ table: "notifications", count: list.length, sampleIds: list.slice(0, 10).map((r: any) => r.id), reason: "belongs to a user account of a seeded demo merchant" });
      }
    }
  }

  // User rows for deletable (non-protected) dummy merchants — no FK cascade,
  // so these would become orphaned if not deleted alongside the merchant.
  if (deletableIds.length > 0) {
    const orphanUsers = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(inArray(usersTable.merchantId, deletableIds));
    if (orphanUsers.length > 0) {
      findings.push({
        table: "users",
        count: orphanUsers.length,
        sampleIds: orphanUsers.slice(0, 10).map((u) => u.id),
        reason: "user account linked to a deletable dummy merchant — deleted inside the same transaction before the merchant row (no orphan users remain after cleanup)",
      });
    }
  }

  const excludeList = seededIds.length > 0 ? sql.join(seededIds.map((id) => sql`${id}`), sql`, `) : sql`-1`;
  const strayRows: any = await db.execute(
    sql`SELECT id FROM transactions WHERE ${REFERENCE_PATTERN} AND merchant_id NOT IN (${excludeList}) LIMIT 10000`
  );
  const strayList = strayRows.rows ?? strayRows;
  if (strayList.length > 0) {
    findings.push({ table: "transactions", count: strayList.length, sampleIds: strayList.slice(0, 10).map((r: any) => r.id), reason: "reference_id contains TEST/DEMO/DUMMY/SAMPLE" });
  }

  return { findings, protectedIds, deletableIds, seededIds };
}

// All DELETEs run inside ONE transaction.  Any failure rolls back everything.
async function cleanup(performedBy: { adminId: number; adminEmail: string }) {
  const { protectedIds, deletableIds, seededIds } = await detect();
  const results: { table: string; rowsDeleted: number }[] = [];

  await db.transaction(async (tx) => {
    async function del(table: string, whereSql: any) {
      const res: any = await tx.execute(sql`DELETE FROM ${sql.raw(table)} WHERE ${whereSql}`);
      const rowsDeleted = res.rowCount ?? res.rows?.length ?? 0;
      if (rowsDeleted > 0) {
        results.push({ table, rowsDeleted });
        await tx.insert(auditLogsTable).values({
          adminId: performedBy.adminId,
          adminEmail: performedBy.adminEmail,
          action: "DUMMY_DATA_CLEANUP",
          targetType: table,
          targetId: null,
          details: JSON.stringify({ rowsDeleted, tableName: table, trigger: "cli" }),
        });
      }
    }

    // Step 1: dependent rows for all seeded merchants (protected + deletable)
    if (seededIds.length > 0) {
      const idList = sql.join(seededIds.map((id) => sql`${id}`), sql`, `);
      await del("notifications",         sql`user_id IN (SELECT id FROM users WHERE merchant_id IN (${idList}))`);
      await del("report_delivery_logs",  sql`merchant_id IN (${idList})`);
      await del("kyc_verification_logs", sql`merchant_id IN (${idList})`);
      await del("verification_logs",     sql`merchant_id IN (${idList})`);
      await del("virtual_accounts",      sql`merchant_id IN (${idList})`);
      await del("qr_codes",              sql`merchant_id IN (${idList})`);
      await del("settlements",           sql`merchant_id IN (${idList})`);
      await del("wallet_ledger",         sql`merchant_id IN (${idList})`);
      await del("withdrawals",           sql`merchant_id IN (${idList})`);
      await del("transactions",          sql`merchant_id IN (${idList})`);
    }

    // Step 2: reset wallet balances for protected demo merchants (accounts kept)
    if (protectedIds.length > 0) {
      await tx
        .update(merchantWalletsTable)
        .set({
          availableBalance: "0", pendingBalance: "0", holdBalance: "0", settlementBalance: "0", payoutBalance: "0",
          totalCollection: "0", totalPayout: "0", totalCharges: "0", totalRefunds: "0", totalReversals: "0",
        })
        .where(inArray(merchantWalletsTable.merchantId, protectedIds));
    }

    // Step 3: stray reference-pattern transactions outside seeded merchants
    const excludeList = seededIds.length > 0 ? sql.join(seededIds.map((id) => sql`${id}`), sql`, `) : sql`-1`;
    await del("transactions", sql`${REFERENCE_PATTERN} AND merchant_id NOT IN (${excludeList})`);

    // Step 4: user rows for deletable dummy merchants (no FK cascade; must be
    // explicit to avoid orphan users after the merchant row is deleted below)
    if (deletableIds.length > 0) {
      const deletableIdList = sql.join(deletableIds.map((id) => sql`${id}`), sql`, `);
      await del("users", sql`merchant_id IN (${deletableIdList})`);
    }

    // Step 5: delete the dummy merchant rows (CASCADE: merchant_wallets,
    // merchant_plans, merchant_kyc, merchant_documents, merchant_trusted_ips,
    // merchant_verifications, payout_beneficiaries, wallet_charges, wallet_holds)
    if (deletableIds.length > 0) {
      await del("merchants", sql`id IN (${sql.join(deletableIds.map((id) => sql`${id}`), sql`, `)})`);
    }
  });

  return results;
}

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes("--dry-run") || !args.includes("--confirm");
  const confirmIdx = args.indexOf("--confirm");
  const confirmValue = confirmIdx >= 0 ? args[confirmIdx + 1] : null;

  const { findings, protectedIds, deletableIds } = await detect();

  console.log(`\nProtected demo merchants (kept): ${protectedIds.length} — ${PROTECTED_DEMO_EMAILS.join(", ")}`);
  console.log(`Dummy merchants eligible for deletion: ${deletableIds.length}`);
  console.log("\nDetected dummy/demo/test rows:\n");
  if (findings.length === 0) {
    console.log("  (none — database is clean)");
  } else {
    for (const f of findings) {
      console.log(`  [${f.table}] ${f.count} row(s) — sample IDs: ${f.sampleIds.join(", ")}`);
      console.log(`    reason: ${f.reason}`);
    }
    console.log(`\n  TOTAL: ${findings.reduce((s, f) => s + f.count, 0)} row(s)`);
  }

  if (isDryRun) {
    console.log("\nDry run only — nothing was deleted. Re-run with --confirm CLEAN_DUMMY_DATA to delete.\n");
    await pool.end();
    return;
  }

  if (confirmValue !== "CLEAN_DUMMY_DATA") {
    console.error('\nRefusing to delete: pass exactly `--confirm CLEAN_DUMMY_DATA`.\n');
    await pool.end();
    process.exit(1);
  }

  const totalRows = findings.reduce((sum, f) => sum + f.count, 0);
  if (totalRows === 0) {
    console.log("\nNothing to delete.\n");
    await pool.end();
    return;
  }

  console.log(`\nDeleting ${totalRows} dummy row(s) inside a single transaction...`);
  const results = await cleanup({ adminId: 0, adminEmail: "cli-script" });
  for (const r of results) console.log(`  [${r.table}] deleted ${r.rowsDeleted} row(s)`);
  console.log("\nCleanup complete. All deletes committed atomically.");
  console.log("See audit_logs (action=DUMMY_DATA_CLEANUP) for full history.\n");
  await pool.end();
}

main().catch(async (err) => {
  console.error("cleanup-dummy-data failed:", err);
  await pool.end();
  process.exit(1);
});
