import { db, merchantPlansTable, plansTable, qrCodesTable, virtualAccountsTable, withdrawalsTable } from "@workspace/db";
import { eq, and, count, ne } from "drizzle-orm";
import type { Response } from "express";

export interface PlanLimitCheck {
  allowed: boolean;
  message?: string;
}

type LimitType = "dynamicQr" | "staticQr" | "virtualAccount" | "paymentLink" | "payout";

export async function checkPlanLimit(
  merchantId: number,
  limitType: LimitType,
): Promise<PlanLimitCheck> {
  const rows = await db
    .select({ plan: plansTable })
    .from(merchantPlansTable)
    .leftJoin(plansTable, eq(merchantPlansTable.planId, plansTable.id))
    .where(eq(merchantPlansTable.merchantId, merchantId))
    .limit(1);

  if (rows.length === 0 || !rows[0].plan) {
    return { allowed: false, message: "No plan assigned. Please contact support to get a plan." };
  }

  const plan = rows[0].plan;
  let limit: number;
  let used: number;
  let label: string;

  switch (limitType) {
    case "dynamicQr": {
      limit = plan.dynamicQrLimit;
      label = "Dynamic QR codes";
      // Count active (non-expired, non-deleted) dynamic QR codes
      const [{ total }] = await db
        .select({ total: count() })
        .from(qrCodesTable)
        .where(and(
          eq(qrCodesTable.merchantId, merchantId),
          eq(qrCodesTable.type, "dynamic"),
          ne(qrCodesTable.status, "expired"),
        ));
      used = total;
      break;
    }
    case "staticQr": {
      limit = plan.staticQrLimit;
      label = "Static QR codes";
      // Count active/inactive (non-expired) static QR codes
      const [{ total }] = await db
        .select({ total: count() })
        .from(qrCodesTable)
        .where(and(
          eq(qrCodesTable.merchantId, merchantId),
          eq(qrCodesTable.type, "static"),
          ne(qrCodesTable.status, "expired"),
        ));
      used = total;
      break;
    }
    case "virtualAccount": {
      limit = plan.virtualAccountLimit;
      label = "Virtual accounts";
      const [{ total }] = await db
        .select({ total: count() })
        .from(virtualAccountsTable)
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
      // Count pending + approved withdrawals (rejected ones don't consume the limit)
      const [{ total }] = await db
        .select({ total: count() })
        .from(withdrawalsTable)
        .where(and(
          eq(withdrawalsTable.merchantId, merchantId),
          ne(withdrawalsTable.status, "rejected"),
        ));
      used = total;
      break;
    }
  }

  if (used >= limit) {
    return {
      allowed: false,
      message: `${label} limit reached (${used}/${limit}). Upgrade your plan to create more.`,
    };
  }

  return { allowed: true };
}

export async function getMerchantPlanUsage(merchantId: number) {
  const rows = await db
    .select({ plan: plansTable })
    .from(merchantPlansTable)
    .leftJoin(plansTable, eq(merchantPlansTable.planId, plansTable.id))
    .where(eq(merchantPlansTable.merchantId, merchantId))
    .limit(1);

  if (rows.length === 0 || !rows[0].plan) return null;
  const plan = rows[0].plan;

  const [dynamicQrCount] = await db
    .select({ total: count() })
    .from(qrCodesTable)
    .where(and(eq(qrCodesTable.merchantId, merchantId), eq(qrCodesTable.type, "dynamic"), ne(qrCodesTable.status, "expired")));

  const [staticQrCount] = await db
    .select({ total: count() })
    .from(qrCodesTable)
    .where(and(eq(qrCodesTable.merchantId, merchantId), eq(qrCodesTable.type, "static"), ne(qrCodesTable.status, "expired")));

  const [vaCount] = await db
    .select({ total: count() })
    .from(virtualAccountsTable)
    .where(and(eq(virtualAccountsTable.merchantId, merchantId), eq(virtualAccountsTable.status, "active")));

  const [payoutCount] = await db
    .select({ total: count() })
    .from(withdrawalsTable)
    .where(and(eq(withdrawalsTable.merchantId, merchantId), ne(withdrawalsTable.status, "rejected")));

  return {
    dynamicQr: { used: dynamicQrCount.total, limit: plan.dynamicQrLimit },
    staticQr: { used: staticQrCount.total, limit: plan.staticQrLimit },
    virtualAccount: { used: vaCount.total, limit: plan.virtualAccountLimit },
    paymentLink: { used: 0, limit: plan.paymentLinkLimit },
    payout: { used: payoutCount.total, limit: plan.payoutLimit },
  };
}

export function rejectWithLimitError(res: Response, message: string) {
  res.status(403).json({ error: message });
}
