import { Router } from "express";
import { db, cashfreePaymentOrdersTable, merchantsTable, auditLogsTable } from "@workspace/db";
import { eq, and, gte, lte, sql, desc, ilike, or } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";

const router = Router();
router.use(requireAuth, requireAdmin);

/**
 * Admin-only Payin Orders visibility. Internal cashfree_order_id / cf_order_id
 * and raw payloads are never returned to the client — only RasoKart-branded
 * fields, UTR, and sanitized status are exposed, matching the white-label
 * contract used on the merchant side.
 */
function buildFilters(query: Record<string, string>) {
  const { status, merchantId, search, dateFrom, dateTo } = query;
  const conditions = [];
  if (status && status !== "all") conditions.push(eq(cashfreePaymentOrdersTable.status, status));
  if (merchantId) conditions.push(eq(cashfreePaymentOrdersTable.merchantId, parseInt(merchantId)));
  if (search) {
    conditions.push(
      or(
        ilike(cashfreePaymentOrdersTable.publicOrderId, `%${search}%`),
        ilike(cashfreePaymentOrdersTable.utr, `%${search}%`),
      )!
    );
  }
  if (dateFrom) conditions.push(gte(cashfreePaymentOrdersTable.createdAt, new Date(dateFrom)));
  if (dateTo) {
    const end = new Date(dateTo);
    end.setHours(23, 59, 59, 999);
    conditions.push(lte(cashfreePaymentOrdersTable.createdAt, end));
  }
  return conditions.length > 0 ? and(...conditions) : undefined;
}

// GET /api/admin/payin/orders
router.get("/orders", async (req, res, next) => {
  try {
    const query = req.query as Record<string, string>;
    const page = Math.max(1, parseInt(query["page"] ?? "1") || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(query["pageSize"] ?? "20") || 20));
    const where = buildFilters(query);

    const rows = await db
      .select({
        id: cashfreePaymentOrdersTable.id,
        publicOrderId: cashfreePaymentOrdersTable.publicOrderId,
        merchantId: cashfreePaymentOrdersTable.merchantId,
        merchantName: merchantsTable.businessName,
        amount: cashfreePaymentOrdersTable.amount,
        currency: cashfreePaymentOrdersTable.currency,
        status: cashfreePaymentOrdersTable.status,
        paymentMethod: cashfreePaymentOrdersTable.paymentMethod,
        utr: cashfreePaymentOrdersTable.utr,
        failureReason: cashfreePaymentOrdersTable.failureReason,
        paidAt: cashfreePaymentOrdersTable.paidAt,
        createdAt: cashfreePaymentOrdersTable.createdAt,
      })
      .from(cashfreePaymentOrdersTable)
      .leftJoin(merchantsTable, eq(cashfreePaymentOrdersTable.merchantId, merchantsTable.id))
      .where(where)
      .orderBy(desc(cashfreePaymentOrdersTable.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const [{ count: total }] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(cashfreePaymentOrdersTable)
      .where(where);

    res.json({ orders: rows, total: Number(total), page, pageSize });
  } catch (err) { next(err); }
});

// GET /api/admin/payin/orders/export/csv
router.get("/orders/export/csv", async (req, res, next) => {
  try {
    const user = (req as any).user;
    const query = req.query as Record<string, string>;
    const where = buildFilters(query);

    const rows = await db
      .select({
        id: cashfreePaymentOrdersTable.id,
        publicOrderId: cashfreePaymentOrdersTable.publicOrderId,
        merchantName: merchantsTable.businessName,
        amount: cashfreePaymentOrdersTable.amount,
        currency: cashfreePaymentOrdersTable.currency,
        status: cashfreePaymentOrdersTable.status,
        paymentMethod: cashfreePaymentOrdersTable.paymentMethod,
        utr: cashfreePaymentOrdersTable.utr,
        createdAt: cashfreePaymentOrdersTable.createdAt,
        paidAt: cashfreePaymentOrdersTable.paidAt,
      })
      .from(cashfreePaymentOrdersTable)
      .leftJoin(merchantsTable, eq(cashfreePaymentOrdersTable.merchantId, merchantsTable.id))
      .where(where)
      .orderBy(desc(cashfreePaymentOrdersTable.createdAt));

    const header = ["Order ID", "Merchant", "Amount", "Currency", "Status", "Method", "UTR", "Created At", "Paid At"];
    const csvRows = rows.map((r) => [
      r.publicOrderId ?? String(r.id),
      r.merchantName ?? "",
      String(Number(r.amount)),
      r.currency,
      r.status,
      r.paymentMethod ?? "",
      r.utr ?? "",
      r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
      r.paidAt instanceof Date ? r.paidAt.toISOString() : (r.paidAt ?? ""),
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));

    const csv = [header.join(","), ...csvRows].join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=\"payin-orders.csv\"");
    res.send(csv);

    void db.insert(auditLogsTable).values({
      adminId: user.id,
      adminEmail: user.email,
      action: "csv_export",
      targetType: "payin_orders",
      targetId: null,
      details: JSON.stringify({ count: rows.length }),
      ipAddress: (req as any).ip ?? null,
    });
  } catch (err) { next(err); }
});

export default router;
