import { db, cashfreePaymentOrdersTable, PAYIN_ORDER_STATUS } from "@workspace/db";
import { eq, and, gte, sql } from "drizzle-orm";

/**
 * Sum of a merchant's PAID payin deposits for "today" (local server day).
 *
 * Extracted as its own function so this exact production incident — the
 * daily-limit check crashing or mis-comparing status — can be unit tested
 * in isolation:
 *  - status comparison always uses the uppercase `PAYIN_ORDER_STATUS.PAID`
 *    constant, never a raw/lowercase literal
 *  - the "today" cutoff uses COALESCE(paid_at, created_at) so rows created
 *    before `paid_at` existed/was populated are still counted
 *  - COALESCE(SUM(...), 0) plus a numeric fallback below guarantees this
 *    NEVER throws or returns NaN when a merchant has zero matching rows
 *
 * @param providerKey - When provided, only counts orders dispatched via that
 *   specific provider (e.g. "upigateway" for EKQR daily-limit checks).
 *   When omitted, counts across all providers (used for the global payin limit).
 */
export async function getMerchantDailyPaidTotal(
  merchantId: number,
  startOfDay: Date,
  providerKey?: string,
): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`COALESCE(SUM(${cashfreePaymentOrdersTable.amount}), 0)` })
    .from(cashfreePaymentOrdersTable)
    .where(and(
      eq(cashfreePaymentOrdersTable.merchantId, merchantId),
      eq(cashfreePaymentOrdersTable.status, PAYIN_ORDER_STATUS.PAID),
      gte(sql`COALESCE(${cashfreePaymentOrdersTable.paidAt}, ${cashfreePaymentOrdersTable.createdAt})`, startOfDay),
      ...(providerKey ? [eq(cashfreePaymentOrdersTable.providerKey, providerKey)] : []),
    ));
  const total = Number(row?.total ?? 0);
  return Number.isFinite(total) ? total : 0;
}
