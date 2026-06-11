import cron from "node-cron";
import { db, merchantPlansTable, merchantsTable, plansTable } from "@workspace/db";
import { eq, and, isNotNull, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { notifyAdminsOfPlanExpiry } from "./adminNotifyEmail";

const ALERT_THRESHOLDS_DAYS = [7, 3, 1];

async function checkPlanExpiries(): Promise<void> {
  try {
    const now = new Date();

    const expiringPlans = await db
      .select({
        merchantId: merchantPlansTable.merchantId,
        merchantName: merchantsTable.businessName,
        planName: plansTable.name,
        expiresAt: merchantPlansTable.expiresAt,
      })
      .from(merchantPlansTable)
      .innerJoin(merchantsTable, eq(merchantPlansTable.merchantId, merchantsTable.id))
      .innerJoin(plansTable, eq(merchantPlansTable.planId, plansTable.id))
      .where(and(
        eq(merchantPlansTable.status, "active"),
        isNotNull(merchantPlansTable.expiresAt),
        sql`${merchantPlansTable.expiresAt} > now()`,
        sql`${merchantPlansTable.expiresAt} <= now() + interval '8 days'`,
      ));

    if (expiringPlans.length === 0) {
      logger.info("Plan expiry check: no plans expiring within 8 days");
      return;
    }

    let notified = 0;

    for (const plan of expiringPlans) {
      if (!plan.expiresAt) continue;

      const msUntilExpiry = plan.expiresAt.getTime() - now.getTime();
      const daysUntilExpiry = Math.ceil(msUntilExpiry / (1000 * 60 * 60 * 24));

      if (!ALERT_THRESHOLDS_DAYS.includes(daysUntilExpiry)) continue;

      const expiresAtFmt = plan.expiresAt.toISOString().slice(0, 10);

      logger.info(
        { merchantId: plan.merchantId, merchantName: plan.merchantName, daysUntilExpiry, expiresAt: expiresAtFmt },
        "Plan expiry alert threshold reached — dispatching admin notification"
      );

      await notifyAdminsOfPlanExpiry({
        merchantId: plan.merchantId,
        merchantName: plan.merchantName,
        planName: plan.planName,
        daysUntilExpiry,
        expiresAt: expiresAtFmt,
      });

      notified++;
    }

    logger.info({ checked: expiringPlans.length, notified }, "Plan expiry check complete");
  } catch (err) {
    logger.error({ err }, "Plan expiry scheduler check failed");
  }
}

export function initPlanExpiryScheduler(): void {
  // Run daily at 08:00 server time
  cron.schedule("0 8 * * *", checkPlanExpiries);
  logger.info("Plan expiry alert scheduler initialized (daily at 08:00)");
}
