import { Router } from "express";
import { db, merchantConnectionsTable, merchantsTable } from "@workspace/db";
import { eq, and, ilike, or, count, sql } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";

const router = Router();
router.use(requireAuth);

function formatConn(c: typeof merchantConnectionsTable.$inferSelect) {
  return { ...c, monthlyLimit: Number(c.monthlyLimit) };
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

      res.json({
        data: joined.map(r => ({ ...formatConn(r.conn), businessName: r.businessName, merchantEmail: r.merchantEmail })),
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

    res.json({
      data: joined.map(r => ({ ...formatConn(r.conn), businessName: r.businessName, merchantEmail: r.merchantEmail })),
      total: totalCount,
      page: pageNum,
      limit: limitNum,
    });
    return;
  }

  // Merchant: own connections
  const merchantId: number = user.merchantId!;
  const rows = await db.select().from(merchantConnectionsTable).where(eq(merchantConnectionsTable.merchantId, merchantId));
  res.json(rows.map(formatConn));
});

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
  res.json(formatConn(result));
});

// PUT /api/connections/:id
router.put("/:id", async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params.id);
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
  res.json(formatConn(result));
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
