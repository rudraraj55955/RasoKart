/**
 * Dormant merchant alert scheduler.
 *
 * Runs daily and finds merchants whose MERCHANT-LEVEL last login (i.e.
 * MAX(last_login_at) across all merchant users) crossed the 90-day
 * inactivity threshold.  This matches the definition used by the
 * Security Compliance panel in auditLogs.ts.
 *
 * Each newly-dormant merchant triggers one in-app notification per
 * active admin user.
 *
 * De-duplication is enforced atomically at the DB level via the partial
 * unique index `notifications_merchant_dormant_dedup_idx`.  Inserts use
 * onConflictDoNothing() so concurrent runs (startup sweep + cron +
 * admin-triggered endpoint) are all safe.
 *
 * Dedup key: `merchant_dormant_<merchantId>_<YYYY-MM-DD>` where the date
 * is the day the merchant's 90-day window expired
 * (= merchant last-login-or-creation + 90 days).  If the merchant logs
 * in again and goes dormant a second time, a new threshold date generates
 * a fresh alert.
 */

import cron from "node-cron";
import { db, usersTable, merchantsTable, notificationsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { logger } from "../lib/logger";

const INACTIVE_DAYS = 90;

export interface DormantScanResult {
  checked: number;
  notified: number;
  adminCount: number;
}

interface DormantMerchant {
  merchantId: number;
  businessName: string;
  lastLoginAt: Date | null;
  earliestCreatedAt: Date;
}

interface DormantMerchantRawRow {
  merchant_id: number;
  business_name: string;
  last_login_at: string | null;
  earliest_created_at: string;
}

/** Returns all active admin user IDs. */
async function getAdminUserIds(): Promise<number[]> {
  const rows = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.role, "admin"), eq(usersTable.isActive, true)));
  return rows.map(r => r.id);
}

/**
 * Query dormant merchants at the merchant level.
 * Uses MAX(last_login_at) across all merchant-role users for the merchant,
 * matching the compliance panel in auditLogs.ts.
 */
async function loadDormantMerchants(): Promise<DormantMerchant[]> {
  const cutoffMs = Date.now() - INACTIVE_DAYS * 24 * 60 * 60 * 1000;
  const cutoff = new Date(cutoffMs).toISOString();

  const qResult = await db.execute(sql`
    SELECT
      m.id            AS merchant_id,
      m.business_name,
      MAX(u.last_login_at)  AS last_login_at,
      MIN(u.created_at)     AS earliest_created_at
    FROM merchants m
    INNER JOIN users u
      ON u.merchant_id = m.id
     AND u.role        = 'merchant'
     AND u.is_active   = true
    GROUP BY m.id, m.business_name
    HAVING
      (MAX(u.last_login_at) IS NOT NULL AND MAX(u.last_login_at) < ${cutoff}::timestamptz)
      OR
      (MAX(u.last_login_at) IS NULL     AND MIN(u.created_at) < ${cutoff}::timestamptz)
  `);
  const rows = qResult.rows as unknown as DormantMerchantRawRow[];

  return rows.map(r => ({
    merchantId: r.merchant_id,
    businessName: r.business_name,
    lastLoginAt: r.last_login_at ? new Date(r.last_login_at) : null,
    earliestCreatedAt: new Date(r.earliest_created_at),
  }));
}

/**
 * Core scan: find merchants dormant for ≥ INACTIVE_DAYS and send one
 * in-app notification per admin per newly-dormant merchant.
 */
export async function runDormantMerchantScan(): Promise<DormantScanResult> {
  const dormantMerchants = await loadDormantMerchants();

  if (dormantMerchants.length === 0) {
    logger.info("Dormant merchant scan: no dormant merchants found");
    return { checked: 0, notified: 0, adminCount: 0 };
  }

  const adminUserIds = await getAdminUserIds();
  if (adminUserIds.length === 0) {
    logger.warn("Dormant merchant scan: no active admin users — skipping notifications");
    return { checked: dormantMerchants.length, notified: 0, adminCount: 0 };
  }

  let notified = 0;

  for (const merchant of dormantMerchants) {
    // Threshold date = merchant last login (or earliest user creation) + 90 days
    const baseDate = merchant.lastLoginAt ?? merchant.earliestCreatedAt;
    const thresholdDate = new Date(baseDate.getTime() + INACTIVE_DAYS * 24 * 60 * 60 * 1000);
    const thresholdDateStr = thresholdDate.toISOString().slice(0, 10);
    const dedupeKey = `merchant_dormant_${merchant.merchantId}_${thresholdDateStr}`;

    const lastLoginStr = merchant.lastLoginAt
      ? merchant.lastLoginAt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
      : "Never";

    const rows = adminUserIds.map(adminUserId => ({
      userId: adminUserId,
      type: "merchant_dormant" as const,
      title: "Dormant Merchant Alert",
      body: `${merchant.businessName} has been inactive for over ${INACTIVE_DAYS} days. Last login: ${lastLoginStr}.`,
      metadata: {
        merchantId: merchant.merchantId,
        businessName: merchant.businessName,
        lastLoginAt: merchant.lastLoginAt?.toISOString() ?? null,
        thresholdDate: thresholdDateStr,
        dedupeKey,
      },
    }));

    // Atomic insert: the partial unique index on (user_id, type, dedupeKey)
    // ensures each admin sees at most one notification per dormancy event.
    // onConflictDoNothing() makes concurrent runs safe.
    const inserted = await db
      .insert(notificationsTable)
      .values(rows)
      .onConflictDoNothing()
      .returning({ id: notificationsTable.id });

    if (inserted.length > 0) {
      notified++;
      logger.info(
        {
          merchantId: merchant.merchantId,
          businessName: merchant.businessName,
          thresholdDate: thresholdDateStr,
          adminCount: adminUserIds.length,
          rowsInserted: inserted.length,
        },
        "Dormant merchant alert sent to admins",
      );
    }
  }

  logger.info(
    { checked: dormantMerchants.length, notified, adminCount: adminUserIds.length },
    "Dormant merchant scan complete",
  );

  return { checked: dormantMerchants.length, notified, adminCount: adminUserIds.length };
}

/** Register the daily cron job. Called once at server startup. */
export function initDormantMerchantScheduler(): void {
  // Run daily at 09:00 server time
  cron.schedule("0 9 * * *", async () => {
    try {
      await runDormantMerchantScan();
    } catch (err) {
      logger.error({ err }, "Dormant merchant scheduler failed");
    }
  });

  logger.info("Dormant merchant alert scheduler initialized (daily at 09:00)");
}
