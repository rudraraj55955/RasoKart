import { Router } from "express";
import { db, qrCodesTable, merchantsTable } from "@workspace/db";
import { eq, and, ilike, count, sql, or, desc } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";

const router = Router();
router.use(requireAuth);

// Auto-expire QR codes
async function expireOldQrCodes() {
  await db.execute(sql`
    UPDATE qr_codes SET status = 'expired'
    WHERE expires_at IS NOT NULL AND expires_at < NOW() AND status = 'active'
  `);
}

// GET /api/qr-codes
router.get("/", async (req, res) => {
  await expireOldQrCodes().catch(() => {});
  const user = (req as any).user;
  const { type, status, search, merchantId, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  if (user.role !== "admin") conditions.push(eq(qrCodesTable.merchantId, user.merchantId!));
  if (merchantId && user.role === "admin") conditions.push(eq(qrCodesTable.merchantId, parseInt(merchantId)));
  if (type && type !== "all") conditions.push(eq(qrCodesTable.type, type));
  if (status && status !== "all") conditions.push(eq(qrCodesTable.status, status));
  if (search) conditions.push(or(ilike(qrCodesTable.label, `%${search}%`), ilike(qrCodesTable.payload, `%${search}%`), ilike(qrCodesTable.orderId, `%${search}%`))!);

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [{ total }] = await db.select({ total: count() }).from(qrCodesTable).where(where);

  const rows = await db.select({ qr: qrCodesTable, merchantName: merchantsTable.businessName })
    .from(qrCodesTable)
    .leftJoin(merchantsTable, eq(qrCodesTable.merchantId, merchantsTable.id))
    .where(where)
    .limit(limitNum).offset(offset)
    .orderBy(desc(qrCodesTable.createdAt));

  res.json({
    data: rows.map(r => ({
      ...r.qr,
      merchantName: r.merchantName ?? null,
      expiresAt: r.qr.expiresAt instanceof Date ? r.qr.expiresAt.toISOString() : r.qr.expiresAt,
    })),
    total, page: pageNum, limit: limitNum,
  });
});

// POST /api/qr-codes
router.post("/", async (req, res) => {
  const user = (req as any).user;
  const merchantId = user.merchantId!;
  const { type, label, payload, amount, orderId, expiresAt } = req.body;
  if (!type || !payload) { res.status(400).json({ error: "type and payload required" }); return; }
  const [row] = await db.insert(qrCodesTable).values({
    merchantId, type, label: label ?? null, payload,
    amount: amount ?? null,
    orderId: orderId ?? null,
    expiresAt: expiresAt ? new Date(expiresAt) : null,
  }).returning();
  res.status(201).json({
    ...row,
    merchantName: null,
    expiresAt: row.expiresAt instanceof Date ? row.expiresAt.toISOString() : row.expiresAt,
  });
});

// PUT /api/qr-codes/:id
router.put("/:id", async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params.id);
  const { label, status } = req.body;
  const update: Record<string, unknown> = {};
  if (label !== undefined) update.label = label;
  if (status !== undefined) update.status = status;

  const conditions = [eq(qrCodesTable.id, id)];
  if (user.role !== "admin") conditions.push(eq(qrCodesTable.merchantId, user.merchantId!));

  const [row] = await db.update(qrCodesTable).set(update).where(and(...conditions)).returning();
  if (!row) { res.status(404).json({ error: "QR code not found" }); return; }
  res.json({
    ...row,
    merchantName: null,
    expiresAt: row.expiresAt instanceof Date ? row.expiresAt.toISOString() : row.expiresAt,
  });
});

// DELETE /api/qr-codes/:id
router.delete("/:id", async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params.id);
  const conditions = [eq(qrCodesTable.id, id)];
  if (user.role !== "admin") conditions.push(eq(qrCodesTable.merchantId, user.merchantId!));
  await db.delete(qrCodesTable).where(and(...conditions));
  res.json({ message: "QR code deleted" });
});

export default router;
