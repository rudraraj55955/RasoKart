import { db, merchantPlansTable, plansTable, qrCodesTable, virtualAccountsTable, withdrawalsTable, transactionsTable, notificationsTable, paymentLinksTable } from "@workspace/db";
import { eq, and, count, ne, gte, sql, notInArray } from "drizzle-orm";
import type { Response } from "express";
import { createNotification } from "./notifications";

export interface PlanLimitCheck {
  allowed: boolean;
  message?: string;
}

type LimitType = "dynamicQr" | "staticQr" | "virtualAccount" | "paymentLink" | "payout" | "dailyTransaction" | "monthlyTransaction";

export async function getPlanForMerchant(merchantId: number) {
  const rows = await db
    .select({ plan: plansTable, mp: merchantPlansTable })
    .from(merchantPlansTable)
    .leftJoin(plansTable, eq(merchantPlansTable.planId, plansTable.id))
    .where(eq(merchantPlansTable.merchantId, merchantId))
    .limit(1);
  if (rows.length === 0 || !rows[0].plan) return null;
  return { plan: rows[0].plan, mp: rows[0].mp };
}

export async function checkPlanFeatureAccess(merchantId: number, feature: "api" | "webhook"): Promise<PlanLimitCheck> {
  const result = await getPlanForMerchant(merchantId);
  if (!result) return { allowed: false, message: "No plan assigned. Please contact support." };
  const { plan, mp } = result;

  if (mp.expiresAt && new Date() > mp.expiresAt) {
    return { allowed: false, message: "Your plan has expired. Please renew to continue using this feature." };
  }

  if (feature === "api" && !plan.apiAccess) {
    return { allowed: false, message: "API access is not included in your current plan. Please upgrade." };
  }
  if (feature === "webhook" && !plan.webhookAccess) {
    return { allowed: false, message: "Webhook access is not included in your current plan. Please upgrade." };
  }
  return { allowed: true };
}

export async function checkPlanLimit(
  merchantId: number,
  limitType: LimitType,
  userId?: number,
): Promise<PlanLimitCheck> {
  const result = await getPlanForMerchant(merchantId);
  if (!result) return { allowed: false, message: "No plan assigned. Please contact support to get a plan." };
  const { plan, mp } = result;

  if (mp.expiresAt && new Date() > mp.expiresAt) {
    return { allowed: false, message: "Your plan has expired. Please renew your subscription to continue." };
  }

  let limit: number;
  let used: number;
  let label: string;

  switch (limitType) {
    case "dynamicQr": {
      limit = plan.dynamicQrLimit;
      label = "Dynamic QR codes";
      const [{ total }] = await db.select({ total: count() }).from(qrCodesTable)
        .where(and(eq(qrCodesTable.merchantId, merchantId), eq(qrCodesTable.type, "dynamic"), notInArray(qrCodesTable.status, ["expired", "used"])));
      used = total;
      break;
    }
    case "staticQr": {
      limit = plan.staticQrLimit;
      label = "Static QR codes";
      const [{ total }] = await db.select({ total: count() }).from(qrCodesTable)
        .where(and(eq(qrCodesTable.merchantId, merchantId), eq(qrCodesTable.type, "static"), notInArray(qrCodesTable.status, ["expired", "used"])));
      used = total;
      break;
    }
    case "virtualAccount": {
      limit = plan.virtualAccountLimit;
      label = "Virtual accounts";
      const [{ total }] = await db.select({ total: count() }).from(virtualAccountsTable)
        .where(and(eq(virtualAccountsTable.merchantId, merchantId), eq(virtualAccountsTable.status, "active")));
      used = total;
      break;
    }
    case "paymentLink": {
      limit = plan.paymentLinkLimit;
      label = "Payment links";
      const [{ total: plTotal }] = await db.select({ total: count() }).from(paymentLinksTable)
        .where(and(eq(paymentLinksTable.merchantId, merchantId), eq(paymentLinksTable.status, "active")));
      used = plTotal;
      break;
    }
    case "payout": {
      limit = plan.payoutLimit;
      label = "Payouts";
      const payoutMonthStart = new Date(); payoutMonthStart.setDate(1); payoutMonthStart.setHours(0, 0, 0, 0);
      const [{ total }] = await db.select({ total: count() }).from(withdrawalsTable)
        .where(and(
          eq(withdrawalsTable.merchantId, merchantId),
          ne(withdrawalsTable.status, "rejected"),
          gte(withdrawalsTable.createdAt, payoutMonthStart),
        ));
      used = total;
      break;
    }
    case "dailyTransaction": {
      limit = plan.dailyTransactionLimit;
      label = "Daily transactions";
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const [{ total }] = await db.select({ total: count() }).from(transactionsTable)
        .where(and(eq(transactionsTable.merchantId, merchantId), gte(transactionsTable.createdAt, todayStart)));
      used = total;
      break;
    }
    case "monthlyTransaction": {
      limit = plan.monthlyTransactionLimit;
      label = "Monthly transactions";
      const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
      const [{ total }] = await db.select({ total: count() }).from(transactionsTable)
        .where(and(eq(transactionsTable.merchantId, merchantId), gte(transactionsTable.createdAt, monthStart)));
      used = total;
      break;
    }
  }

  if (used >= limit) {
    // Fire-and-forget a limit_exceeded notification (deduped once per limit type per calendar day)
    if (userId) {
      void fireExceededNotification(userId, limitType, label, used, limit);
    }
    return {
      allowed: false,
      message: `${label} limit reached (${used}/${limit}). Upgrade your plan to continue.`,
    };
  }
  return { allowed: true };
}

async function fireExceededNotification(userId: number, limitType: LimitType, label: string, used: number, limit: number) {
  try {
    const todayStr = new Date().toISOString().slice(0, 10);
    const dedupeKey = `limit_exceeded_${limitType}_${todayStr}`;
    const [existing] = await db.select({ id: notificationsTable.id })
      .from(notificationsTable)
      .where(and(
        eq(notificationsTable.userId, userId),
        eq(notificationsTable.type, "limit_exceeded"),
        sql`${notificationsTable.metadata}->>'dedupeKey' = ${dedupeKey}`,
      ))
      .limit(1);
    if (existing) return;
    await createNotification({
      userId,
      type: "limit_exceeded",
      title: `${label} Limit Reached`,
      body: `You have reached your plan limit for ${label.toLowerCase()} (${used}/${limit}). Upgrade your plan to continue using this feature.`,
      metadata: { limitType, used, limit, dedupeKey },
    });
  } catch {
    // best-effort — do not block the request
  }
}

export async function getMerchantPlanUsage(merchantId: number) {
  const result = await getPlanForMerchant(merchantId);
  if (!result) return null;
  const { plan, mp } = result;

  const [dynamicQrCount] = await db.select({ total: count() }).from(qrCodesTable)
    .where(and(eq(qrCodesTable.merchantId, merchantId), eq(qrCodesTable.type, "dynamic"), notInArray(qrCodesTable.status, ["expired", "used"])));
  const [staticQrCount] = await db.select({ total: count() }).from(qrCodesTable)
    .where(and(eq(qrCodesTable.merchantId, merchantId), eq(qrCodesTable.type, "static"), notInArray(qrCodesTable.status, ["expired", "used"])));
  const [vaCount] = await db.select({ total: count() }).from(virtualAccountsTable)
    .where(and(eq(virtualAccountsTable.merchantId, merchantId), eq(virtualAccountsTable.status, "active")));
  const [paymentLinkCount] = await db.select({ total: count() }).from(paymentLinksTable)
    .where(and(eq(paymentLinksTable.merchantId, merchantId), eq(paymentLinksTable.status, "active")));
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);

  const [payoutCount] = await db.select({ total: count() }).from(withdrawalsTable)
    .where(and(
      eq(withdrawalsTable.merchantId, merchantId),
      ne(withdrawalsTable.status, "rejected"),
      gte(withdrawalsTable.createdAt, monthStart),
    ));
  const [dailyTxCount] = await db.select({ total: count() }).from(transactionsTable)
    .where(and(eq(transactionsTable.merchantId, merchantId), gte(transactionsTable.createdAt, todayStart)));
  const [monthlyTxCount] = await db.select({ total: count() }).from(transactionsTable)
    .where(and(eq(transactionsTable.merchantId, merchantId), gte(transactionsTable.createdAt, monthStart)));

  const isExpired = mp.expiresAt ? new Date() > mp.expiresAt : false;

  return {
    planName: plan.name,
    isExpired,
    expiresAt: mp.expiresAt ? mp.expiresAt.toISOString() : null,
    daysUntilExpiry: mp.expiresAt
      ? Math.max(0, Math.ceil((mp.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
      : null,
    apiAccess: plan.apiAccess,
    webhookAccess: plan.webhookAccess,
    settlementFee: plan.settlementFee,
    depositFee: plan.depositFee,
    dynamicQr: { used: dynamicQrCount.total, limit: plan.dynamicQrLimit },
    staticQr: { used: staticQrCount.total, limit: plan.staticQrLimit },
    virtualAccount: { used: vaCount.total, limit: plan.virtualAccountLimit },
    paymentLink: { used: paymentLinkCount.total, limit: plan.paymentLinkLimit },
    payout: { used: payoutCount.total, limit: plan.payoutLimit },
    dailyTransaction: { used: dailyTxCount.total, limit: plan.dailyTransactionLimit },
    monthlyTransaction: { used: monthlyTxCount.total, limit: plan.monthlyTransactionLimit },
  };
}

export function rejectWithLimitError(res: Response, message: string) {
  res.status(403).json({ error: message });
}
