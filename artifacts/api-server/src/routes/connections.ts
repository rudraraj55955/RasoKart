import { Router } from "express";
import { db, merchantConnectionsTable, merchantsTable, transactionsTable, paymentLinksTable, notificationsTable } from "@workspace/db";
import { eq, and, ilike, or, count, sql, sum, isNull, gte, lt } from "drizzle-orm";
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
  const rows = await db.select().from(merchantConnectionsTable).where(eq(merchantConnectionsTable.merchantId, merchantId));
  const connUsageMap = await getMonthlyUsedByConnectionId(merchantId);

  // Fire-and-forget: create provider limit and reset notifications as needed
  const formatted = rows.map(r => formatConn(r, connUsageMap.get(r.id) ?? 0));
  Promise.all(
    formatted
      .filter(r => r.isActive && r.monthlyLimit > 0)
      .flatMap(r => [
        maybeNotifyProviderLimit(user.id, r.provider, r.monthlyUsed, r.monthlyLimit),
        maybeNotifyProviderLimitReset(user.id, r.provider, r.monthlyLimit),
      ])
  ).catch((err) => {
    logger.warn({ err }, "Provider limit notification background task failed");
  });

  res.json(formatted);
});

/**
 * Creates provider limit notifications when usage crosses 80% or 100% of the
 * monthly limit. Both thresholds are evaluated independently so that jumping
 * straight from <80% to >=100% fires both notifications. Deduplication is
 * enforced by a partial unique index in the DB (notifications_provider_limit_dedup_idx),
 * with `.onConflictDoNothing()` as the DB-level guard against races.
 */
async function maybeNotifyProviderLimit(
  userId: number,
  provider: string,
  monthlyUsed: number,
  monthlyLimit: number,
): Promise<void> {
  if (monthlyLimit <= 0) return;
  const pct = monthlyUsed / monthlyLimit;
  if (pct < 0.8) return;

  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const usedFmt = Math.round(monthlyUsed).toLocaleString("en-IN");
  const limitFmt = Math.round(monthlyLimit).toLocaleString("en-IN");
  const pctStr = Math.round(pct * 100);

  // Both thresholds are checked independently:
  // - warning fires once when usage first crosses 80%
  // - reached fires once when usage first hits 100%
  // If usage jumps straight from <80% to >=100%, both notifications are created.
  const candidates: Array<{ type: string; title: string; body: string }> = [];

  if (pct >= 0.8) {
    candidates.push({
      type: "provider_limit_warning",
      title: `${provider} limit at ${pctStr}%`,
      body: `You have used ₹${usedFmt} of your ₹${limitFmt} monthly limit for ${provider}. Consider upgrading your plan or reducing usage.`,
    });
  }

  if (pct >= 1) {
    candidates.push({
      type: "provider_limit_reached",
      title: `${provider} monthly limit reached`,
      body: `You have used ₹${usedFmt} of your ₹${limitFmt} monthly limit for ${provider}. New payments via this provider may be rejected until next month.`,
    });
  }

  for (const entry of candidates) {
    // onConflictDoNothing() is the DB-level idempotency guard backed by the
    // partial unique index `notifications_provider_limit_dedup_idx` created in seed.ts.
    await db.insert(notificationsTable)
      .values({
        userId,
        type: entry.type,
        title: entry.title,
        body: entry.body,
        metadata: { provider, monthKey },
        isRead: false,
      })
      .onConflictDoNothing();
  }
}

/**
 * Creates a `provider_limit_reset` notification when a new calendar month begins
 * and the merchant had a `provider_limit_reached` notification last month for
 * the same provider. Fires at most once per provider per month — deduplicated by
 * the partial unique index `notifications_provider_limit_reset_dedup_idx`.
 */
async function maybeNotifyProviderLimitReset(
  userId: number,
  provider: string,
  monthlyLimit: number,
): Promise<void> {
  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  // Compute last month
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthKey = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, "0")}`;

  // Check if this merchant had a provider_limit_reached notification last month
  const [prior] = await db
    .select({ id: notificationsTable.id })
    .from(notificationsTable)
    .where(
      and(
        eq(notificationsTable.userId, userId),
        eq(notificationsTable.type, "provider_limit_reached"),
        sql`${notificationsTable.metadata}->>'provider' = ${provider}`,
        sql`${notificationsTable.metadata}->>'monthKey' = ${lastMonthKey}`,
      )
    )
    .limit(1);

  if (!prior) return;

  const limitFmt = Math.round(monthlyLimit).toLocaleString("en-IN");

  await db.insert(notificationsTable)
    .values({
      userId,
      type: "provider_limit_reset",
      title: `${provider} monthly limit has reset`,
      body: `Your monthly limit for ${provider} has reset to ₹${limitFmt}. Payments via this provider are now available again for the new month.`,
      metadata: { provider, currentMonthKey, lastMonthKey },
      isRead: false,
    })
    .onConflictDoNothing();
}

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

  let result;
  if (existing.length > 0) {
    [result] = await db.update(merchantConnectionsTable)
      .set({ credentials: credentials ?? null, monthlyLimit: String(monthlyLimit), isActive: !!isActive })
      .where(and(eq(merchantConnectionsTable.merchantId, merchantId), eq(merchantConnectionsTable.provider, provider)))
      .returning();
  } else {
    [result] = await db.insert(merchantConnectionsTable)
      .values({ merchantId, provider, credentials: credentials ?? null, monthlyLimit: String(monthlyLimit), isActive: !!isActive })
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
  if (isActive !== undefined) update.isActive = !!isActive;

  const whereClause = user.role === "admin"
    ? eq(merchantConnectionsTable.id, id)
    : and(eq(merchantConnectionsTable.id, id), eq(merchantConnectionsTable.merchantId, user.merchantId!));

  const [result] = await db.update(merchantConnectionsTable)
    .set(update)
    .where(whereClause)
    .returning();

  if (!result) { res.status(404).json({ error: "Connection not found" }); return; }

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
