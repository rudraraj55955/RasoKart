import { Router } from "express";
import { db, invoicesTable, merchantsTable, plansTable, ledgerEntriesTable } from "@workspace/db";
import { eq, and, count, desc, sql } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";

const router = Router();
router.use(requireAuth);

function serializeInvoice(
  inv: typeof invoicesTable.$inferSelect,
  extras: { merchantName?: string | null; merchantEmail?: string | null; planName?: string | null } = {}
) {
  return {
    ...inv,
    amount: String(inv.amount),
    merchantName: extras.merchantName ?? null,
    merchantEmail: extras.merchantEmail ?? null,
    planName: extras.planName ?? null,
    periodFrom: inv.periodFrom ? inv.periodFrom.toISOString() : null,
    periodTo: inv.periodTo ? inv.periodTo.toISOString() : null,
    dueDate: inv.dueDate ? inv.dueDate.toISOString() : null,
    paidAt: inv.paidAt ? inv.paidAt.toISOString() : null,
    createdAt: inv.createdAt.toISOString(),
    updatedAt: inv.updatedAt.toISOString(),
  };
}

function generateInvoiceNumber(): string {
  const now = new Date();
  const yymm = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const rand = Math.floor(Math.random() * 90000) + 10000;
  return `INV-${yymm}-${rand}`;
}

// GET /api/invoices (admin: all; merchant: own)
router.get("/", async (req, res) => {
  const user = (req as any).user;
  const { merchantId, status, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  if (user.role === "merchant") {
    if (!user.merchantId) { res.json({ data: [], total: 0, page: pageNum, limit: limitNum }); return; }
    conditions.push(eq(invoicesTable.merchantId, user.merchantId));
  } else if (merchantId) {
    conditions.push(eq(invoicesTable.merchantId, parseInt(merchantId)));
  }
  if (status) conditions.push(eq(invoicesTable.status, status));

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [{ total }] = await db.select({ total: count() }).from(invoicesTable).where(where);

  const rows = await db
    .select({ inv: invoicesTable, m: { name: merchantsTable.businessName, email: merchantsTable.email }, p: { name: plansTable.name } })
    .from(invoicesTable)
    .leftJoin(merchantsTable, eq(invoicesTable.merchantId, merchantsTable.id))
    .leftJoin(plansTable, eq(invoicesTable.planId, plansTable.id))
    .where(where)
    .orderBy(desc(invoicesTable.createdAt))
    .limit(limitNum).offset(offset);

  res.json({
    data: rows.map(r => serializeInvoice(r.inv, { merchantName: r.m?.name, merchantEmail: r.m?.email, planName: r.p?.name })),
    total, page: pageNum, limit: limitNum,
  });
});

// POST /api/invoices (admin only)
router.post("/", requireAdmin, async (req, res) => {
  const user = (req as any).user;
  const { merchantId, planId, amount, currency, period, periodFrom, periodTo, dueDate, notes, status } = req.body;
  if (!merchantId || !amount) { res.status(400).json({ error: "merchantId and amount are required" }); return; }

  const [merchant] = await db.select().from(merchantsTable).where(eq(merchantsTable.id, merchantId)).limit(1);
  if (!merchant) { res.status(404).json({ error: "Merchant not found" }); return; }

  const invoiceNumber = generateInvoiceNumber();
  const invoiceStatus = status ?? "issued";
  const invoiceAmount = Number(amount);

  let inv: typeof invoicesTable.$inferSelect;
  let planName: string | null = null;

  if (planId) {
    const [plan] = await db.select({ name: plansTable.name }).from(plansTable).where(eq(plansTable.id, planId)).limit(1);
    planName = plan?.name ?? null;
  }

  if (invoiceStatus === "issued") {
    // Atomic: insert invoice + deduct merchant balance + ledger fee entry
    [inv] = await db.transaction(async (tx) => {
      const [merchantRow] = await tx
        .select({ balance: merchantsTable.balance })
        .from(merchantsTable)
        .where(eq(merchantsTable.id, merchantId))
        .limit(1);

      const balanceBefore = Number(merchantRow?.balance ?? 0);
      const balanceAfter = balanceBefore - invoiceAmount;

      const [created] = await tx.insert(invoicesTable).values({
        merchantId,
        planId: planId ?? null,
        invoiceNumber,
        amount,
        currency: currency ?? "INR",
        period: period ?? null,
        periodFrom: periodFrom ? new Date(periodFrom) : null,
        periodTo: periodTo ? new Date(periodTo) : null,
        status: invoiceStatus,
        dueDate: dueDate ? new Date(dueDate) : null,
        notes: notes ?? null,
        createdBy: user.id,
      }).returning();

      // Only deduct when merchant has sufficient funds — ensures DB balance and
      // ledger running balance always agree (no Math.max divergence).
      if (invoiceAmount > 0 && balanceBefore >= invoiceAmount) {
        await tx.update(merchantsTable)
          .set({ balance: sql`${merchantsTable.balance} - ${invoiceAmount}::numeric`, updatedAt: new Date() })
          .where(eq(merchantsTable.id, merchantId));

        // balanceAfter is exact: same value used in both DB write and ledger entry.
        await tx.insert(ledgerEntriesTable).values({
          merchantId,
          type: "fee",
          amount: (-invoiceAmount).toFixed(2),
          balanceBefore: balanceBefore.toFixed(2),
          balanceAfter: balanceAfter.toFixed(2),
          referenceType: "invoice",
          referenceId: created.id,
          description: `Fee charged — ${planName ? `${planName} plan` : "subscription"} invoice ${invoiceNumber}`,
          createdBy: user.id,
        });
      }

      return [created];
    });
  } else {
    [inv] = await db.insert(invoicesTable).values({
      merchantId,
      planId: planId ?? null,
      invoiceNumber,
      amount,
      currency: currency ?? "INR",
      period: period ?? null,
      periodFrom: periodFrom ? new Date(periodFrom) : null,
      periodTo: periodTo ? new Date(periodTo) : null,
      status: invoiceStatus,
      dueDate: dueDate ? new Date(dueDate) : null,
      notes: notes ?? null,
      createdBy: user.id,
    }).returning();
  }

  res.status(201).json(serializeInvoice(inv, { merchantName: merchant.businessName, merchantEmail: merchant.email, planName }));
});

// GET /api/invoices/:id
router.get("/:id", async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params.id as string);
  const rows = await db
    .select({ inv: invoicesTable, m: { name: merchantsTable.businessName, email: merchantsTable.email }, p: { name: plansTable.name } })
    .from(invoicesTable)
    .leftJoin(merchantsTable, eq(invoicesTable.merchantId, merchantsTable.id))
    .leftJoin(plansTable, eq(invoicesTable.planId, plansTable.id))
    .where(eq(invoicesTable.id, id)).limit(1);

  if (rows.length === 0) { res.status(404).json({ error: "Invoice not found" }); return; }
  const { inv, m, p } = rows[0];
  if (user.role === "merchant" && inv.merchantId !== user.merchantId) { res.status(403).json({ error: "Forbidden" }); return; }
  res.json(serializeInvoice(inv, { merchantName: m?.name, merchantEmail: m?.email, planName: p?.name }));
});

// POST /api/invoices/:id/mark-paid (admin only)
router.post("/:id/mark-paid", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string);
  const [inv] = await db.update(invoicesTable)
    .set({ status: "paid", paidAt: new Date() })
    .where(eq(invoicesTable.id, id)).returning();
  if (!inv) { res.status(404).json({ error: "Invoice not found" }); return; }
  const [m] = await db.select({ name: merchantsTable.businessName, email: merchantsTable.email })
    .from(merchantsTable).where(eq(merchantsTable.id, inv.merchantId)).limit(1);
  res.json(serializeInvoice(inv, { merchantName: m?.name ?? null, merchantEmail: m?.email ?? null }));
});

// POST /api/invoices/:id/void (admin only)
router.post("/:id/void", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string);
  const [inv] = await db.update(invoicesTable)
    .set({ status: "void" })
    .where(eq(invoicesTable.id, id)).returning();
  if (!inv) { res.status(404).json({ error: "Invoice not found" }); return; }
  const [m] = await db.select({ name: merchantsTable.businessName, email: merchantsTable.email })
    .from(merchantsTable).where(eq(merchantsTable.id, inv.merchantId)).limit(1);
  res.json(serializeInvoice(inv, { merchantName: m?.name ?? null, merchantEmail: m?.email ?? null }));
});

export default router;
