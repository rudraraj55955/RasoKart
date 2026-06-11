import { Router } from "express";
import { db, merchantConnectionsTable, merchantsTable, transactionsTable, paymentLinksTable } from "@workspace/db";
import { eq, and, ilike, or, count, sql, sum, isNull, gte, lt } from "drizzle-orm";
import { maybeNotifyProviderLimit, maybeNotifyProviderLimitReset } from "../helpers/providerLimitNotifier";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { deriveUpiPayloadFromConnections } from "../helpers/upiPayload";
import { logger } from "../lib/logger";

const router = Router();
router.use(requireAuth);

function formatConn(c: typeof merchantConnectionsTable.$inferSelect, monthlyUsed: number) {
  return { ...c, monthlyLimit: Number(c.monthlyLimit), monthlyUsed };
}

/** Returns a map keyed by connectionId → monthlyUsed for one merchant */
async function getMonthlyUsedByConnectionId(merchantId: number): Promise<Map<number, number>> {
  const rows = await db
    .select({ connectionId: transactionsTable.connectionId, total: sum(transactionsTable.amount) })
    .from(transactionsTable)
    .where(
      and(
        eq(transactionsTable.merchantId, merchantId),
        eq(transactionsTable.type, "deposit"),
        eq(transactionsTable.status, "success"),
        sql`date_trunc('month', ${transactionsTable.createdAt}) = date_trunc('month', now())`
      )
    )
    .groupBy(transactionsTable.connectionId);
  const map = new Map<number, number>();
  for (const r of rows) {
    if (r.connectionId != null) map.set(r.connectionId, Number(r.total ?? 0));
  }
  return map;
}

/**
 * Returns a map keyed by connectionId → monthlyUsed,
 * batching all connections in a single query.
 */
async function buildMonthlyUsageMap(connectionIds: number[]): Promise<Map<number, number>> {
  if (connectionIds.length === 0) return new Map();
  const rows = await db
    .select({
      connectionId: transactionsTable.connectionId,
      total: sum(transactionsTable.amount),
    })
    .from(transactionsTable)
    .where(
      and(
        sql`${transactionsTable.connectionId} = ANY(${sql.raw(`ARRAY[${connectionIds.join(",")}]::int[]`)})`,
        eq(transactionsTable.type, "deposit"),
        eq(transactionsTable.status, "success"),
        sql`date_trunc('month', ${transactionsTable.createdAt}) = date_trunc('month', now())`
      )
    )
    .groupBy(transactionsTable.connectionId);
  const map = new Map<number, number>();
  for (const r of rows) {
    if (r.connectionId != null) map.set(r.connectionId, Number(r.total ?? 0));
  }
  return map;
}

// GET /api/connections
// Admin: returns paginated { data, total } for all merchants, with search/provider/page/limit
// Merchant: returns flat array of own connections
router.get("/", async (req, res) => {
  const user = (req as any).user;

  if (user.role === "admin") {
    const { search, provider, page = "1", limit = "20", merchantId } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    const conditions: any[] = [];
    if (provider && provider !== "") conditions.push(eq(merchantConnectionsTable.provider, provider));
    if (merchantId && !isNaN(parseInt(merchantId))) conditions.push(eq(merchantConnectionsTable.merchantId, parseInt(merchantId)));

    if (search) {
      const nameSearch = or(
        ilike(merchantsTable.businessName, `%${search}%`),
        ilike(merchantsTable.email, `%${search}%`)
      )!;
      const joined = await db
        .select({ conn: merchantConnectionsTable, businessName: merchantsTable.businessName, merchantEmail: merchantsTable.email })
        .from(merchantConnectionsTable)
        .innerJoin(merchantsTable, eq(merchantConnectionsTable.merchantId, merchantsTable.id))
        .where(conditions.length ? and(...conditions, nameSearch) : nameSearch)
        .orderBy(sql`${merchantsTable.businessName} ASC`)
        .limit(limitNum)
        .offset(offset);

      const [{ total: totalCount }] = await db
        .select({ total: count() })
        .from(merchantConnectionsTable)
        .innerJoin(merchantsTable, eq(merchantConnectionsTable.merchantId, merchantsTable.id))
        .where(conditions.length ? and(...conditions, nameSearch) : nameSearch);

      const connectionIds = joined.map(r => r.conn.id);
      const usageMap = await buildMonthlyUsageMap(connectionIds);

      res.json({
        data: joined.map(r => ({ ...formatConn(r.conn, usageMap.get(r.conn.id) ?? 0), businessName: r.businessName, merchantEmail: r.merchantEmail })),
        total: totalCount,
        page: pageNum,
        limit: limitNum,
      });
      return;
    }

    const where = conditions.length ? and(...conditions) : undefined;
    const [{ total: totalCount }] = await db.select({ total: count() }).from(merchantConnectionsTable).where(where);

    const joined = await db
      .select({ conn: merchantConnectionsTable, businessName: merchantsTable.businessName, merchantEmail: merchantsTable.email })
      .from(merchantConnectionsTable)
      .innerJoin(merchantsTable, eq(merchantConnectionsTable.merchantId, merchantsTable.id))
      .where(where)
      .orderBy(sql`${merchantsTable.businessName} ASC`)
      .limit(limitNum)
      .offset(offset);

    const connectionIds = joined.map(r => r.conn.id);
    const usageMap = await buildMonthlyUsageMap(connectionIds);

    res.json({
      data: joined.map(r => ({ ...formatConn(r.conn, usageMap.get(r.conn.id) ?? 0), businessName: r.businessName, merchantEmail: r.merchantEmail })),
      total: totalCount,
      page: pageNum,
      limit: limitNum,
    });
    return;
  }

  // Merchant: own connections
  const merchantId: number = user.merchantId!;
  const [rows, merchantRow] = await Promise.all([
    db.select().from(merchantConnectionsTable).where(eq(merchantConnectionsTable.merchantId, merchantId)),
    db.select({ email: merchantsTable.email, businessName: merchantsTable.businessName })
      .from(merchantsTable).where(eq(merchantsTable.id, merchantId)).limit(1),
  ]);
  const connUsageMap = await getMonthlyUsedByConnectionId(merchantId);
  const merchantEmail = merchantRow[0]?.email ?? "";
  const merchantName = merchantRow[0]?.businessName ?? "";

  // Fire-and-forget: create provider limit and reset notifications (+ email alerts) as needed
  const formatted = rows.map(r => formatConn(r, connUsageMap.get(r.id) ?? 0));
  Promise.all(
    formatted
      .filter(r => r.isActive && r.monthlyLimit > 0)
      .flatMap(r => [
        maybeNotifyProviderLimit(user.id, r.provider, r.monthlyUsed, r.monthlyLimit, merchantEmail, merchantName),
        maybeNotifyProviderLimitReset(user.id, r.provider, r.monthlyLimit),
      ])
  ).catch((err) => {
    logger.warn({ err }, "Provider limit notification background task failed");
  });

  res.json(formatted);
});

/**
 * After a connection is created or updated, backfill upiPayload on all of the
 * merchant's payment links that were created before a provider was connected
 * (i.e. links where upiPayload is currently NULL).
 */
async function backfillUpiPayloads(merchantId: number): Promise<void> {
  const [merchantRow] = await db.select({ businessName: merchantsTable.businessName })
    .from(merchantsTable).where(eq(merchantsTable.id, merchantId)).limit(1);
  const merchantName = merchantRow?.businessName ?? "Merchant";

  const connections = await db.select({
    provider: merchantConnectionsTable.provider,
    credentials: merchantConnectionsTable.credentials,
    isActive: merchantConnectionsTable.isActive,
  })
    .from(merchantConnectionsTable)
    .where(and(eq(merchantConnectionsTable.merchantId, merchantId), eq(merchantConnectionsTable.isActive, true)))
    .limit(10);

  if (!connections.length) return;

  const nullLinks = await db.select({
    id: paymentLinksTable.id,
    amount: paymentLinksTable.amount,
    title: paymentLinksTable.title,
  })
    .from(paymentLinksTable)
    .where(and(eq(paymentLinksTable.merchantId, merchantId), isNull(paymentLinksTable.upiPayload)));

  for (const link of nullLinks) {
    const payload = deriveUpiPayloadFromConnections(
      connections,
      merchantName,
      link.amount ?? null,
      link.title ?? null,
    );
    if (payload) {
      await db.update(paymentLinksTable)
        .set({ upiPayload: payload })
        .where(eq(paymentLinksTable.id, link.id));
    }
  }
}

/**
 * Re-run the connection→transaction backfill scoped to a single merchant.
 * Mirrors the seed backfill time-window logic: for each provider-tagged
 * transaction that has no connectionId yet, assign the oldest qualifying
 * connection (created before the transaction, not yet deactivated at that
 * time).  Safe to call fire-and-forget after any isActive toggle.
 */
async function backfillConnectionIds(merchantId: number): Promise<void> {
  await db.execute(sql`
    UPDATE transactions
    SET connection_id = (
      SELECT id
      FROM merchant_connections
      WHERE merchant_id  = transactions.merchant_id
        AND provider     = transactions.provider
        AND created_at  <= transactions.created_at
        AND (deactivated_at IS NULL OR deactivated_at > transactions.created_at)
      ORDER BY created_at ASC
      LIMIT 1
    )
    WHERE connection_id IS NULL
      AND provider      IS NOT NULL
      AND merchant_id   = ${merchantId}
  `);
}

// POST /api/connections  (upsert by provider)
// Admin can supply merchantId in body; merchant uses their own
router.post("/", async (req, res) => {
  const user = (req as any).user;
  const { provider, credentials, monthlyLimit = 0, isActive = true, merchantId: bodyMerchantId } = req.body;

  const merchantId: number = user.role === "admin"
    ? (bodyMerchantId ? parseInt(bodyMerchantId) : 0)
    : user.merchantId!;

  if (!merchantId) { res.status(400).json({ error: "merchantId is required" }); return; }
  if (!provider) { res.status(400).json({ error: "Provider required" }); return; }

  const existing = await db.select().from(merchantConnectionsTable)
    .where(and(eq(merchantConnectionsTable.merchantId, merchantId), eq(merchantConnectionsTable.provider, provider)))
    .limit(1);

  // Compute deactivatedAt: stamp the current time when deactivating, clear it when activating.
  const deactivatedAt = !isActive ? new Date() : null;

  let result;
  if (existing.length > 0) {
    [result] = await db.update(merchantConnectionsTable)
      .set({ credentials: credentials ?? null, monthlyLimit: String(monthlyLimit), isActive: !!isActive, deactivatedAt })
      .where(and(eq(merchantConnectionsTable.merchantId, merchantId), eq(merchantConnectionsTable.provider, provider)))
      .returning();
  } else {
    [result] = await db.insert(merchantConnectionsTable)
      .values({ merchantId, provider, credentials: credentials ?? null, monthlyLimit: String(monthlyLimit), isActive: !!isActive, deactivatedAt })
      .returning();
  }

  // Backfill upiPayload on payment links that were created before this connection existed
  backfillUpiPayloads(merchantId).catch(() => {});

  const connMapPost = await getMonthlyUsedByConnectionId(result.merchantId);
  res.json(formatConn(result, connMapPost.get(result.id) ?? 0));
});

// PUT /api/connections/:id
router.put("/:id", async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params['id'] as string);
  const { provider, credentials, monthlyLimit, isActive } = req.body;

  const update: Record<string, unknown> = {};
  if (provider !== undefined) update.provider = provider;
  if (credentials !== undefined) update.credentials = credentials;
  if (monthlyLimit !== undefined) update.monthlyLimit = String(monthlyLimit);
  if (isActive !== undefined) {
    update.isActive = !!isActive;
    // Record the exact moment of deactivation so backfill can use a time-window filter.
    // Only set deactivatedAt when transitioning to inactive; clear it when re-activating.
    if (!isActive) {
      update.deactivatedAt = new Date();
    } else {
      update.deactivatedAt = null;
    }
  }

  const whereClause = user.role === "admin"
    ? eq(merchantConnectionsTable.id, id)
    : and(eq(merchantConnectionsTable.id, id), eq(merchantConnectionsTable.merchantId, user.merchantId!));

  const [result] = await db.update(merchantConnectionsTable)
    .set(update)
    .where(whereClause)
    .returning();

  if (!result) { res.status(404).json({ error: "Connection not found" }); return; }

  // When isActive is toggled, re-map historical transactions to the correct
  // connection.  Fire-and-forget: the response is already sent; errors are
  // logged but do not affect the caller.
  if (isActive !== undefined) {
    backfillConnectionIds(result.merchantId).catch((err) => {
      logger.warn({ err, merchantId: result.merchantId }, "Connection backfill failed after isActive toggle");
    });
  }

  // Backfill upiPayload on payment links that were created before this connection existed
  backfillUpiPayloads(result.merchantId).catch(() => {});

  const connMapPut = await getMonthlyUsedByConnectionId(result.merchantId);
  res.json(formatConn(result, connMapPut.get(result.id) ?? 0));
});

// DELETE /api/connections/:id
router.delete("/:id", async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params.id);

  const whereClause = user.role === "admin"
    ? eq(merchantConnectionsTable.id, id)
    : and(eq(merchantConnectionsTable.id, id), eq(merchantConnectionsTable.merchantId, user.merchantId!));

  await db.delete(merchantConnectionsTable).where(whereClause);
  res.json({ message: "Connection deleted" });
});

export default router;
