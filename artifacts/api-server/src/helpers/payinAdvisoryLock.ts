import { db, cashfreePaymentOrdersTable, PAYIN_ORDER_STATUS } from "@workspace/db";
import { eq, and, gte, sql, inArray } from "drizzle-orm";

/**
 * PostgreSQL advisory lock namespace for payin order serialization.
 * Must not collide with the auth-lock namespace (0x41555448 = "AUTH").
 * 0x52504159 = "RPAY" in ASCII.
 */
const PAYIN_LOCK_NS = 0x52504159;

/**
 * Returns the sum of all active payin order amounts for a merchant today.
 *
 * "Active" = CREATED (in-flight checkout) + PENDING + PAID.  This is
 * intentionally broader than getMerchantDailyPaidTotal (PAID only) because
 * CREATED rows represent payment URLs already issued to a customer — they may
 * still be fulfilled and must count toward the daily cap to prevent the
 * double-spend race:
 *
 *   Without this:  two requests both read PAID=0, both pass, both insert
 *                  CREATED rows, both get paid → total = 2× the allowed limit.
 *
 *   With this:     second request holds the advisory lock, reads
 *                  CREATED+PENDING+PAID and sees the first's CREATED row →
 *                  correctly rejects before inserting.
 *
 * @param client      A Drizzle db/tx handle.  Pass the transaction object from
 *                    withMerchantPayinLock so the read runs on the same
 *                    connection as the advisory lock.
 * @param providerKey When set, only counts orders routed via that provider.
 */
export async function getMerchantDailyActiveTotal(
  client: typeof db,
  merchantId: number,
  startOfDay: Date,
  providerKey?: string,
): Promise<number> {
  const [row] = await client
    .select({ total: sql<string>`COALESCE(SUM(${cashfreePaymentOrdersTable.amount}), 0)` })
    .from(cashfreePaymentOrdersTable)
    .where(and(
      eq(cashfreePaymentOrdersTable.merchantId, merchantId),
      inArray(cashfreePaymentOrdersTable.status, [
        PAYIN_ORDER_STATUS.CREATED,
        PAYIN_ORDER_STATUS.PENDING,
        PAYIN_ORDER_STATUS.PAID,
      ]),
      gte(
        sql`COALESCE(${cashfreePaymentOrdersTable.paidAt}, ${cashfreePaymentOrdersTable.createdAt})`,
        startOfDay,
      ),
      ...(providerKey ? [eq(cashfreePaymentOrdersTable.providerKey, providerKey)] : []),
    ));
  const total = Number(row?.total ?? 0);
  return Number.isFinite(total) ? total : 0;
}

/**
 * Runs `fn` inside a PostgreSQL transaction protected by a per-merchant
 * advisory lock (pg_advisory_xact_lock).
 *
 * ## Concurrency guarantee
 * All concurrent calls with the same `merchantId` are serialized: the second
 * caller blocks inside pg_advisory_xact_lock until the first transaction
 * commits or rolls back.  Different merchantIds never block each other because
 * the lock key is (PAYIN_LOCK_NS, merchantId) — a (int4, int4) pair.
 *
 * ## No lock leaks
 * pg_advisory_xact_lock is automatically released when the enclosing
 * transaction ends (commit or rollback), so uncaught exceptions never leave
 * stale locks.
 *
 * ## Important
 * `fn` MUST use the `tx` argument for every DB read/write that must be
 * serialized — using the global `db` inside `fn` would run on a different
 * connection and bypass the lock.
 *
 * @param merchantId Merchant to serialize on.
 * @param fn         Callback receiving the transaction handle.
 */
export async function withMerchantPayinLock<T>(
  merchantId: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fn: (tx: any) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${PAYIN_LOCK_NS}, ${merchantId})`);
    return fn(tx);
  });
}
