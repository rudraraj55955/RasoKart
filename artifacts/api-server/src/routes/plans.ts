import { Router } from "express";
import { db, plansTable, merchantPlansTable, merchantsTable, planHistoryTable, auditLogsTable } from "@workspace/db";
import { eq, and, gte, lte, count, desc, sql, SQL } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { getMerchantPlanUsage } from "../helpers/planLimits";

const router = Router();
router.use(requireAuth);

function serializePlan(p: typeof plansTable.$inferSelect) {
  return {
    ...p,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

async function logAudit(req: any, action: string, targetId: number | null, details: object) {
  await db.insert(auditLogsTable).values({
    adminId: req.user.id, adminEmail: req.user.email, action,
    targetType: "plan", targetId, details: JSON.stringify(details), ipAddress: req.ip ?? null,
  });
}

// GET /api/plans/me — current merchant's plan
router.get("/me", async (req, res) => {
  const user = (req as any).user;
  if (!user.merchantId) { res.status(404).json({ error: "No plan assigned" }); return; }

  const rows = await db
    .select({ mp: merchantPlansTable, plan: plansTable })
    .from(merchantPlansTable)
    .leftJoin(plansTable, eq(merchantPlansTable.planId, plansTable.id))
    .where(eq(merchantPlansTable.merchantId, user.merchantId))
    .limit(1);

  if (rows.length === 0 || !rows[0].plan) { res.status(404).json({ error: "No plan assigned" }); return; }
  const { mp, plan } = rows[0];
  const isExpired = mp.expiresAt ? new Date() > mp.expiresAt : false;
  res.json({
    id: mp.id, merchantId: mp.merchantId, planId: mp.planId,
    planName: plan!.name, description: plan!.description ?? null,
    price: plan!.price, monthlyFee: plan!.monthlyFee, yearlyFee: plan!.yearlyFee, setupFee: plan!.setupFee,
    pricing: plan!.pricing, features: plan!.features, customFeatures: plan!.customFeatures,
    dynamicQrLimit: plan!.dynamicQrLimit, staticQrLimit: plan!.staticQrLimit,
    virtualAccountLimit: plan!.virtualAccountLimit, paymentLinkLimit: plan!.paymentLinkLimit,
    payoutLimit: plan!.payoutLimit, dailyTransactionLimit: plan!.dailyTransactionLimit,
    monthlyTransactionLimit: plan!.monthlyTransactionLimit,
    settlementFee: plan!.settlementFee, depositFee: plan!.depositFee,
    apiAccess: plan!.apiAccess, webhookAccess: plan!.webhookAccess, providerAccess: plan!.providerAccess,
    status: mp.status,
    assignedAt: mp.assignedAt, expiresAt: mp.expiresAt ?? null, isExpired,
    renewedAt: mp.renewedAt?.toISOString() ?? null,
    daysUntilExpiry: mp.expiresAt
      ? Math.max(0, Math.ceil((mp.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
      : null,
    notes: mp.notes ?? null,
  });
});

// GET /api/plans/me/usage
router.get("/me/usage", async (req, res) => {
  const user = (req as any).user;
  if (!user.merchantId) { res.status(404).json({ error: "No plan assigned" }); return; }
  const usage = await getMerchantPlanUsage(user.merchantId);
  if (!usage) { res.status(404).json({ error: "No plan assigned" }); return; }
  res.json(usage);
});

// GET /api/plans/me/history
router.get("/me/history", async (req, res) => {
  const user = (req as any).user;
  if (!user.merchantId) { res.json([]); return; }

  const rows = await db
    .select({ h: planHistoryTable, toPlan: { id: plansTable.id, name: plansTable.name } })
    .from(planHistoryTable)
    .leftJoin(plansTable, eq(planHistoryTable.toPlanId, plansTable.id))
    .where(eq(planHistoryTable.merchantId, user.merchantId))
    .orderBy(desc(planHistoryTable.createdAt))
    .limit(50);

  res.json(rows.map(r => ({
    ...r.h,
    toPlanName: r.toPlan?.name ?? null,
    createdAt: r.h.createdAt.toISOString(),
  })));
});

// GET /api/plans — all plans
router.get("/", async (_req, res) => {
  const rows = await db.select().from(plansTable).orderBy(plansTable.id);
  res.json(rows.map(serializePlan));
});

// GET /api/plans/history/export — admin: export plan history as CSV
router.get("/history/export", requireAdmin, async (req, res) => {
  const { merchantId, action } = req.query as Record<string, string>;

  const conditions: SQL[] = [];
  if (merchantId) conditions.push(eq(planHistoryTable.merchantId, parseInt(merchantId)));
  if (action) conditions.push(eq(planHistoryTable.action, action));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select({
      h: planHistoryTable,
      toPlan: { id: plansTable.id, name: plansTable.name },
      merchant: { id: merchantsTable.id, businessName: merchantsTable.businessName },
    })
    .from(planHistoryTable)
    .leftJoin(plansTable, eq(planHistoryTable.toPlanId, plansTable.id))
    .leftJoin(merchantsTable, eq(planHistoryTable.merchantId, merchantsTable.id))
    .where(where)
    .orderBy(desc(planHistoryTable.createdAt));

  const escape = (v: string | null | undefined) => {
    if (v == null) return "";
    const s = String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const header = "Date,Merchant,Action,Plan,Assigned By,Expires,Notes\n";
  const lines = rows.map(r => [
    escape(r.h.createdAt.toISOString()),
    escape(r.merchant?.businessName),
    escape(r.h.action),
    escape(r.toPlan?.name),
    escape(r.h.adminEmail),
    escape(r.h.expiresAt ? new Date(r.h.expiresAt).toISOString() : null),
    escape(r.h.notes),
  ].join(",")).join("\n");

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=\"plan-history.csv\"");
  res.send(header + lines);
});

// GET /api/plans/history — admin: plan history across all merchants
router.get("/history", requireAdmin, async (req, res) => {
  const { merchantId, action, fromDate, toDate, page = "1", limit = "25" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions: SQL[] = [];
  if (merchantId) conditions.push(eq(planHistoryTable.merchantId, parseInt(merchantId)));
  if (action) conditions.push(eq(planHistoryTable.action, action));
  if (fromDate) conditions.push(gte(planHistoryTable.createdAt, new Date(fromDate)));
  if (toDate) {
    const to = new Date(toDate);
    to.setUTCHours(23, 59, 59, 999);
    conditions.push(lte(planHistoryTable.createdAt, to));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [{ total }] = await db.select({ total: count() }).from(planHistoryTable).where(where);

  const rows = await db
    .select({
      h: planHistoryTable,
      toPlan: { id: plansTable.id, name: plansTable.name },
      merchant: { id: merchantsTable.id, businessName: merchantsTable.businessName },
    })
    .from(planHistoryTable)
    .leftJoin(plansTable, eq(planHistoryTable.toPlanId, plansTable.id))
    .leftJoin(merchantsTable, eq(planHistoryTable.merchantId, merchantsTable.id))
    .where(where)
    .orderBy(desc(planHistoryTable.createdAt))
    .limit(limitNum).offset(offset);

  res.json({
    data: rows.map(r => ({
      ...r.h,
      toPlanName: r.toPlan?.name ?? null,
      businessName: r.merchant?.businessName ?? null,
      createdAt: r.h.createdAt.toISOString(),
    })),
    total, page: pageNum, limit: limitNum,
  });
});

// GET /api/plans/:id — single plan (admin)
router.get("/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string);
  const [plan] = await db.select().from(plansTable).where(eq(plansTable.id, id)).limit(1);
  if (!plan) { res.status(404).json({ error: "Plan not found" }); return; }
  res.json(serializePlan(plan));
});

// POST /api/plans (admin only)
router.post("/", requireAdmin, async (req, res) => {
  const {
    name, description, price, monthlyFee, yearlyFee, setupFee, pricing, features, customFeatures,
    dynamicQrLimit, staticQrLimit, virtualAccountLimit, paymentLinkLimit, payoutLimit,
    dailyTransactionLimit, monthlyTransactionLimit,
    settlementFee, depositFee, apiAccess, webhookAccess, providerAccess, isActive,
  } = req.body;
  if (!name || !pricing || !features) { res.status(400).json({ error: "name, pricing, features required" }); return; }

  const [row] = await db.insert(plansTable).values({
    name, description: description ?? null,
    price: price ?? "0", monthlyFee: monthlyFee ?? price ?? "0",
    yearlyFee: yearlyFee ?? "0", setupFee: setupFee ?? "0",
    pricing, features, customFeatures: customFeatures ?? "[]",
    dynamicQrLimit: dynamicQrLimit ?? 10, staticQrLimit: staticQrLimit ?? 10,
    virtualAccountLimit: virtualAccountLimit ?? 5, paymentLinkLimit: paymentLinkLimit ?? 10,
    payoutLimit: payoutLimit ?? 20, dailyTransactionLimit: dailyTransactionLimit ?? 999,
    monthlyTransactionLimit: monthlyTransactionLimit ?? 9999,
    settlementFee: settlementFee ?? "2.0", depositFee: depositFee ?? "0.0",
    apiAccess: apiAccess !== false, webhookAccess: webhookAccess !== false,
    providerAccess: providerAccess === true, isActive: isActive !== false,
  }).returning();

  await logAudit(req, "plan_created", row.id, { name: row.name });
  res.status(201).json(serializePlan(row));
});

// PUT /api/plans/:id (admin only)
router.put("/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string);
  const {
    name, description, price, monthlyFee, yearlyFee, setupFee, pricing, features, customFeatures,
    dynamicQrLimit, staticQrLimit, virtualAccountLimit, paymentLinkLimit, payoutLimit,
    dailyTransactionLimit, monthlyTransactionLimit,
    settlementFee, depositFee, apiAccess, webhookAccess, providerAccess, isActive,
  } = req.body;

  const update: Record<string, unknown> = {};
  if (name !== undefined) update.name = name;
  if (description !== undefined) update.description = description;
  if (price !== undefined) update.price = price;
  if (monthlyFee !== undefined) update.monthlyFee = monthlyFee;
  if (yearlyFee !== undefined) update.yearlyFee = yearlyFee;
  if (setupFee !== undefined) update.setupFee = setupFee;
  if (pricing !== undefined) update.pricing = pricing;
  if (features !== undefined) update.features = features;
  if (customFeatures !== undefined) update.customFeatures = customFeatures;
  if (dynamicQrLimit !== undefined) update.dynamicQrLimit = dynamicQrLimit;
  if (staticQrLimit !== undefined) update.staticQrLimit = staticQrLimit;
  if (virtualAccountLimit !== undefined) update.virtualAccountLimit = virtualAccountLimit;
  if (paymentLinkLimit !== undefined) update.paymentLinkLimit = paymentLinkLimit;
  if (payoutLimit !== undefined) update.payoutLimit = payoutLimit;
  if (dailyTransactionLimit !== undefined) update.dailyTransactionLimit = dailyTransactionLimit;
  if (monthlyTransactionLimit !== undefined) update.monthlyTransactionLimit = monthlyTransactionLimit;
  if (settlementFee !== undefined) update.settlementFee = settlementFee;
  if (depositFee !== undefined) update.depositFee = depositFee;
  if (apiAccess !== undefined) update.apiAccess = apiAccess;
  if (webhookAccess !== undefined) update.webhookAccess = webhookAccess;
  if (providerAccess !== undefined) update.providerAccess = providerAccess;
  if (isActive !== undefined) update.isActive = isActive;

  const [row] = await db.update(plansTable).set(update).where(eq(plansTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Plan not found" }); return; }
  await logAudit(req, "plan_updated", row.id, { name: row.name, changes: Object.keys(update) });
  res.json(serializePlan(row));
});

// DELETE /api/plans/:id (admin only)
router.delete("/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string);
  const [plan] = await db.select().from(plansTable).where(eq(plansTable.id, id)).limit(1);
  if (!plan) { res.status(404).json({ error: "Plan not found" }); return; }
  await db.delete(merchantPlansTable).where(eq(merchantPlansTable.planId, id));
  await db.delete(plansTable).where(eq(plansTable.id, id));
  await logAudit(req, "plan_deleted", id, { name: plan.name });
  res.json({ message: "Plan deleted" });
});

export default router;
