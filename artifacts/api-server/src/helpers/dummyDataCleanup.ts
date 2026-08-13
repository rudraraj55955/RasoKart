import { sql, inArray, eq } from "drizzle-orm";
import {
  db,
  merchantsTable,
  usersTable,
  transactionsTable,
  withdrawalsTable,
  walletLedgerTable,
  merchantWalletsTable,
  settlementsTable,
  qrCodesTable,
  virtualAccountsTable,
  verificationLogsTable,
  kycVerificationLogsTable,
  reportDeliveryLogsTable,
  notificationsTable,
  auditLogsTable,
} from "@workspace/db";
import { DEMO_CREDENTIALS } from "@workspace/demo-credentials";

// Documented demo merchant logins that must always keep working (required by
// replit.md + the deploy health check). Their merchant/user rows are never
// deleted, but their seeded transaction/payout/wallet/ledger history is
// treated as dummy data and cleaned up like any other seeded row.
export const PROTECTED_DEMO_EMAILS = DEMO_CREDENTIALS.filter((c) => c.role === "merchant").map((c) => c.email);

const FAKE_MOBILES = ["9999999999", "8888888888", "0000000000", "1234567890"];
const NAME_PATTERN = sql`(lower(${merchantsTable.email}) LIKE '%test%' OR lower(${merchantsTable.email}) LIKE '%demo%' OR lower(${merchantsTable.email}) LIKE '%dummy%' OR lower(${merchantsTable.email}) LIKE '%example%' OR lower(${merchantsTable.businessName}) LIKE '%test%' OR lower(${merchantsTable.businessName}) LIKE '%demo%' OR lower(${merchantsTable.businessName}) LIKE '%dummy%' OR lower(${merchantsTable.businessName}) LIKE '%sample%')`;
const REFERENCE_PATTERN_SQL = (col: any) => sql`(upper(${col}) LIKE '%TEST%' OR upper(${col}) LIKE '%DEMO%' OR upper(${col}) LIKE '%DUMMY%' OR upper(${col}) LIKE '%SAMPLE%')`;

export interface DummyDataFinding {
  table: string;
  count: number;
  sampleIds: number[];
  reason: string;
}

export interface DetectionResult {
  findings: DummyDataFinding[];
  protectedDemoMerchantIds: number[];
  deletableDummyMerchantIds: number[];
  seededMerchantIds: number[];
}

async function getProtectedDemoMerchantIds(): Promise<number[]> {
  if (PROTECTED_DEMO_EMAILS.length === 0) return [];
  const rows = await db
    .select({ id: merchantsTable.id })
    .from(merchantsTable)
    .where(inArray(merchantsTable.email, PROTECTED_DEMO_EMAILS));
  return rows.map((r) => r.id);
}

async function getDeletableDummyMerchants(): Promise<{ id: number; email: string; businessName: string; phone: string }[]> {
  const rows = await db
    .select({ id: merchantsTable.id, email: merchantsTable.email, businessName: merchantsTable.businessName, phone: merchantsTable.phone })
    .from(merchantsTable)
    .where(
      sql`(${NAME_PATTERN} OR ${merchantsTable.phone} IN (${sql.join(FAKE_MOBILES.map((m) => sql`${m}`), sql`, `)}))`
    );
  return rows.filter((r) => !PROTECTED_DEMO_EMAILS.includes(r.email));
}

export async function detectDummyData(): Promise<DetectionResult> {
  const findings: DummyDataFinding[] = [];

  const protectedIds = await getProtectedDemoMerchantIds();
  const deletableMerchants = await getDeletableDummyMerchants();
  const deletableIds = deletableMerchants.map((m) => m.id);
  const seededMerchantIds = [...protectedIds, ...deletableIds];

  if (deletableIds.length > 0) {
    findings.push({
      table: "merchants",
      count: deletableIds.length,
      sampleIds: deletableIds.slice(0, 10),
      reason: "email/business name matches test|demo|dummy|sample|example pattern, or phone is a known fake number (9999999999/8888888888/0000000000/1234567890)",
    });
  }

  if (seededMerchantIds.length > 0) {
    const merchantScoped: { table: string; col: any; label: string }[] = [
      { table: "transactions", col: transactionsTable.merchantId, label: "transactions" },
      { table: "withdrawals", col: withdrawalsTable.merchantId, label: "withdrawals" },
      { table: "wallet_ledger", col: walletLedgerTable.merchantId, label: "wallet_ledger" },
      { table: "settlements", col: settlementsTable.merchantId, label: "settlements" },
      { table: "qr_codes", col: qrCodesTable.merchantId, label: "qr_codes" },
      { table: "virtual_accounts", col: virtualAccountsTable.merchantId, label: "virtual_accounts" },
      { table: "verification_logs", col: verificationLogsTable.merchantId, label: "verification_logs" },
      { table: "kyc_verification_logs", col: kycVerificationLogsTable.merchantId, label: "kyc_verification_logs" },
      { table: "report_delivery_logs", col: reportDeliveryLogsTable.merchantId, label: "report_delivery_logs" },
    ];

    for (const t of merchantScoped) {
      const rows: { id: number }[] = await db.execute(
        sql`SELECT id FROM ${sql.raw(t.table)} WHERE merchant_id IN (${sql.join(seededMerchantIds.map((id) => sql`${id}`), sql`, `)}) LIMIT 10000`
      ).then((r: any) => r.rows ?? r);
      if (rows.length > 0) {
        findings.push({
          table: t.label,
          count: rows.length,
          sampleIds: rows.slice(0, 10).map((r) => r.id),
          reason: "belongs to a seeded demo merchant (documented demo login or a matched dummy merchant record)",
        });
      }
    }

    // Notifications belong to users, not merchants directly.
    const demoUsers = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(inArray(usersTable.merchantId, seededMerchantIds));
    const demoUserIds = demoUsers.map((u) => u.id);
    if (demoUserIds.length > 0) {
      const notifRows = await db
        .select({ id: notificationsTable.id })
        .from(notificationsTable)
        .where(inArray(notificationsTable.userId, demoUserIds));
      if (notifRows.length > 0) {
        findings.push({
          table: "notifications",
          count: notifRows.length,
          sampleIds: notifRows.slice(0, 10).map((r) => r.id),
          reason: "belongs to a user account of a seeded demo merchant",
        });
      }
    }
  }

  // User rows linked to deletable (non-protected) dummy merchants.
  // These have no FK cascade from merchants → users, so they must be
  // deleted explicitly before the merchant row to prevent orphan users.
  // Protected demo merchant users are NOT included — those logins are kept.
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

  // Reference-pattern rows not already covered above (e.g. a real merchant's
  // stray TEST/DEMO/DUMMY/SAMPLE-labeled transaction or payout reference).
  const stray = await db.execute(
    sql`SELECT id FROM transactions WHERE ${REFERENCE_PATTERN_SQL(sql.raw("reference_id"))} AND merchant_id NOT IN (${
      seededMerchantIds.length > 0 ? sql.join(seededMerchantIds.map((id) => sql`${id}`), sql`, `) : sql`-1`
    }) LIMIT 10000`
  ).then((r: any) => r.rows ?? r);
  if (stray.length > 0) {
    findings.push({
      table: "transactions",
      count: stray.length,
      sampleIds: stray.slice(0, 10).map((r: any) => r.id),
      reason: "reference_id contains TEST/DEMO/DUMMY/SAMPLE",
    });
  }

  return { findings, protectedDemoMerchantIds: protectedIds, deletableDummyMerchantIds: deletableIds, seededMerchantIds };
}

export interface CleanupResult {
  table: string;
  rowsDeleted: number;
}

// executeCleanup wraps every DELETE and the wallet-balance reset in a single
// PostgreSQL transaction.  If any step throws, the entire operation is rolled
// back — the database is left exactly as it was before the call.
export async function executeCleanup(performedBy: { adminId: number; adminEmail: string }): Promise<CleanupResult[]> {
  const { protectedDemoMerchantIds, deletableDummyMerchantIds, seededMerchantIds } = await detectDummyData();
  const results: CleanupResult[] = [];

  await db.transaction(async (tx) => {
    // Helper: execute a DELETE inside the transaction and write one audit-log row
    // per table (also inside the transaction — rolled back on failure).
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
          details: JSON.stringify({ rowsDeleted, tableName: table }),
        });
      }
    }

    // ── Step 1: delete all dependent rows for every seeded merchant ──────────
    // Order: leaf rows first so no FK violations fire.
    if (seededMerchantIds.length > 0) {
      const idList = sql.join(seededMerchantIds.map((id) => sql`${id}`), sql`, `);
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

    // ── Step 2: reset wallet balances for the 3 protected demo merchants ─────
    // Their merchant/user rows stay; their seeded history was just deleted above.
    if (protectedDemoMerchantIds.length > 0) {
      await tx
        .update(merchantWalletsTable)
        .set({
          availableBalance: "0", pendingBalance: "0", holdBalance: "0",
          settlementBalance: "0", payoutBalance: "0", totalCollection: "0",
          totalPayout: "0", totalCharges: "0", totalRefunds: "0", totalReversals: "0",
        })
        .where(inArray(merchantWalletsTable.merchantId, protectedDemoMerchantIds));
    }

    // ── Step 3: stray reference-pattern rows outside any seeded merchant ─────
    const excludeList = seededMerchantIds.length > 0
      ? sql.join(seededMerchantIds.map((id) => sql`${id}`), sql`, `)
      : sql`-1`;
    await del(
      "transactions",
      sql`${REFERENCE_PATTERN_SQL(sql.raw("reference_id"))} AND merchant_id NOT IN (${excludeList})`
    );

    // ── Step 4: delete user rows for deletable dummy merchants ───────────────
    // The users table has no FK CASCADE from merchants, so users would otherwise
    // become orphaned after the merchant row is deleted.  Deleting them here,
    // inside the same transaction, ensures zero orphan users.
    // Protected demo merchant users (IDs 1, 2, 3) are NOT touched.
    if (deletableDummyMerchantIds.length > 0) {
      const deletableIdList = sql.join(deletableDummyMerchantIds.map((id) => sql`${id}`), sql`, `);
      await del("users", sql`merchant_id IN (${deletableIdList})`);
    }

    // ── Step 5: delete the dummy merchant rows ────────────────────────────────
    // DB CASCADE handles: merchant_wallets, merchant_plans, merchant_kyc,
    // merchant_documents, merchant_trusted_ips, merchant_verifications,
    // payout_beneficiaries, wallet_charges, wallet_holds.
    if (deletableDummyMerchantIds.length > 0) {
      await del("merchants", sql`id IN (${sql.join(deletableDummyMerchantIds.map((id) => sql`${id}`), sql`, `)})`);
    }

    // If any step above threw, db.transaction() automatically issues ROLLBACK.
  });

  return results;
}

export async function getCleanupHistory(limit = 50) {
  return db
    .select()
    .from(auditLogsTable)
    .where(eq(auditLogsTable.action, "DUMMY_DATA_CLEANUP"))
    .orderBy(sql`${auditLogsTable.createdAt} DESC`)
    .limit(limit);
}
