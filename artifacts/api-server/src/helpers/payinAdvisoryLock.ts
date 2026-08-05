import { db, cashfreePaymentOrdersTable, PAYIN_ORDER_STATUS } from "@workspace/db";
import { eq, and, gte, sql, inArray } from "drizzle-orm";

/**
 * PostgreSQL advisory lock namespace for per-merchant payin serialization.
 * Must not collide with the auth-lock namespace (0x41555448 = "AUTH").
 * 0x52504159 = "RPAY" in ASCII.
 */
const PAYIN_LOCK_NS = 0x52504159;

/**
 * PostgreSQL advisory lock namespace for per-provider payin serialization.
 * 0x52505250 = "RPRP" in ASCII — distinct from PAYIN_LOCK_NS so provider and
 * merchant lock keys cannot collide even when a merchantId happens to equal
 * the hashed value of a providerKey.
 */
const PAYIN_PROVIDER_LOCK_NS = 0x52505250;

/**
 * Maps a provider key string to a deterministic int32 suitable for use as the
 * second argument of pg_advisory_xact_lock(int4, int4).
 *
 * Uses a djb2-style multiply-xor hash so that different providerKey strings
 * (e.g. "upigateway", "cashfree") produce different lock keys with high
 * probability, while the same key always produces the same int32.
 */
function providerKeyToLockInt(providerKey: string): number {
  let h = 5381;
  for (let i = 0; i < providerKey.length; i++) {
    h = Math.imul(h, 33) ^ providerKey.charCodeAt(i);
  }
  return h | 0; // force 32-bit signed integer
}

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
 * Returns the sum of all active payin order amounts for a specific provider
 * today, counted **across all merchants**.
 *
 * This is the provider-scoped counterpart of getMerchantDailyActiveTotal.
 * Use it for the EKQR/UPIGateway provider-level daily cap check so that two
 * different merchants cannot together exceed the shared provider quota:
 *
 *   Per-merchant check (old): A reads 0 for A's slice, passes; B reads 0 for
 *     B's slice, passes; both inserted → combined exceeds provider cap.
 *
 *   Provider-wide check (new): whichever request runs second reads the first's
 *     CREATED row (already committed) → correctly rejects before inserting.
 *
 * @param client      A Drizzle db/tx handle. Pass the transaction object from
 *                    withMerchantPayinLock so the read runs on the same
 *                    connection as the advisory lock.
 * @param startOfDay  Start of the current calendar day (merchant-timezone-aware).
 * @param providerKey Provider to aggregate (e.g. "upigateway").
 */
export async function getProviderDailyActiveTotal(
  client: typeof db,
  startOfDay: Date,
  providerKey: string,
): Promise<number> {
  const [row] = await client
    .select({ total: sql<string>`COALESCE(SUM(${cashfreePaymentOrdersTable.amount}), 0)` })
    .from(cashfreePaymentOrdersTable)
    .where(and(
      eq(cashfreePaymentOrdersTable.providerKey, providerKey),
      inArray(cashfreePaymentOrdersTable.status, [
        PAYIN_ORDER_STATUS.CREATED,
        PAYIN_ORDER_STATUS.PENDING,
        PAYIN_ORDER_STATUS.PAID,
      ]),
      gte(
        sql`COALESCE(${cashfreePaymentOrdersTable.paidAt}, ${cashfreePaymentOrdersTable.createdAt})`,
        startOfDay,
      ),
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

/**
 * Runs `fn` inside a PostgreSQL transaction protected by a per-provider
 * advisory lock (pg_advisory_xact_lock).
 *
 * ## Why this exists (vs withMerchantPayinLock)
 * withMerchantPayinLock serializes requests from the SAME merchant, but
 * requests from DIFFERENT merchants acquire different lock keys and therefore
 * never block each other.  For providers with a single shared daily quota
 * (e.g. EKQR / UPIGateway), two merchants can both read the same stale
 * provider total, both pass the cap check, both receive a payment URL from
 * the provider, and both commit CREATED rows — together exceeding the cap.
 *
 * withProviderPayinLock serializes ALL merchants for the same providerKey,
 * so the second caller always sees the first's committed CREATED row when it
 * re-reads the provider total inside the transaction.
 *
 * ## Concurrency guarantee
 * All concurrent calls with the same `providerKey` are serialized regardless
 * of merchantId.  Different providerKeys never block each other.
 *
 * ## No lock leaks
 * pg_advisory_xact_lock is automatically released when the enclosing
 * transaction ends (commit or rollback).
 *
 * ## Important
 * `fn` MUST use the `tx` argument for every DB read/write that must be
 * serialized — using the global `db` bypasses the lock.
 *
 * @param providerKey Provider to serialize on (e.g. "upigateway").
 * @param fn          Callback receiving the transaction handle.
 */
export async function withProviderPayinLock<T>(
  providerKey: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fn: (tx: any) => Promise<T>,
): Promise<T> {
  const lockKey = providerKeyToLockInt(providerKey);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${PAYIN_PROVIDER_LOCK_NS}, ${lockKey})`);
    return fn(tx);
  });
}
