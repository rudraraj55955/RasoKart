import { db, merchantPlansTable, plansTable, qrCodesTable, virtualAccountsTable, withdrawalsTable, transactionsTable } from "@workspace/db";
import { eq, and, count, ne, gte, sql } from "drizzle-orm";
import type { Response } from "express";

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
        .where(and(eq(qrCodesTable.merchantId, merchantId), eq(qrCodesTable.type, "dynamic"), ne(qrCodesTable.status, "expired")));
      used = total;
      break;
    }
    case "staticQr": {
      limit = plan.staticQrLimit;
      label = "Static QR codes";
      const [{ total }] = await db.select({ total: count() }).from(qrCodesTable)
        .where(and(eq(qrCodesTable.merchantId, merchantId), eq(qrCodesTable.type, "static"), ne(qrCodesTable.status, "expired")));
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
      used = 0;
      break;
    }
    case "payout": {
      limit = plan.payoutLimit;
      label = "Payouts";
      const [{ total }] = await db.select({ total: count() }).from(withdrawalsTable)
        .where(and(eq(withdrawalsTable.merchantId, merchantId), ne(withdrawalsTable.status, "rejected")));
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
    return {
      allowed: false,
      message: `${label} limit reached (${used}/${limit}). Upgrade your plan to continue.`,
    };
  }
  return { allowed: true };
}

export async function getMerchantPlanUsage(merchantId: number) {
  const result = await getPlanForMerchant(merchantId);
  if (!result) return null;
  const { plan, mp } = result;

  const [dynamicQrCount] = await db.select({ total: count() }).from(qrCodesTable)
    .where(and(eq(qrCodesTable.merchantId, merchantId), eq(qrCodesTable.type, "dynamic"), ne(qrCodesTable.status, "expired")));
  const [staticQrCount] = await db.select({ total: count() }).from(qrCodesTable)
    .where(and(eq(qrCodesTable.merchantId, merchantId), eq(qrCodesTable.type, "static"), ne(qrCodesTable.status, "expired")));
  const [vaCount] = await db.select({ total: count() }).from(virtualAccountsTable)
    .where(and(eq(virtualAccountsTable.merchantId, merchantId), eq(virtualAccountsTable.status, "active")));
  const [payoutCount] = await db.select({ total: count() }).from(withdrawalsTable)
    .where(and(eq(withdrawalsTable.merchantId, merchantId), ne(withdrawalsTable.status, "rejected")));

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
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
    paymentLink: { used: 0, limit: plan.paymentLinkLimit },
    payout: { used: payoutCount.total, limit: plan.payoutLimit },
    dailyTransaction: { used: dailyTxCount.total, limit: plan.dailyTransactionLimit },
    monthlyTransaction: { used: monthlyTxCount.total, limit: plan.monthlyTransactionLimit },
  };
}

export function rejectWithLimitError(res: Response, message: string) {
  res.status(403).json({ error: message });
}
