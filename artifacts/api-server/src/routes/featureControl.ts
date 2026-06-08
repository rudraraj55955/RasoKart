import { Router } from "express";
import { db, merchantFeaturesTable, merchantsTable, auditLogsTable } from "@workspace/db";
import { eq, ilike, and, count, sql, or, inArray } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";

const router = Router();
router.use(requireAuth, requireAdmin);

const FEATURE_KEYS = [
  "dynamicQr", "staticQr", "virtualAccount", "paymentLinks",
  "payouts", "withdrawals", "settlements", "webhooks", "apiKeys", "csvExport",
] as const;

type FeatureKey = typeof FEATURE_KEYS[number];

async function logAudit(req: any, action: string, targetId: number | null, details: object) {
  await db.insert(auditLogsTable).values({
    adminId: req.user.id,
    adminEmail: req.user.email,
    action,
    targetType: "merchant_features",
    targetId,
    details: JSON.stringify(details),
    ipAddress: req.ip ?? null,
  });
}

// GET /api/feature-control — list merchants with their feature settings
router.get("/", async (req, res, next) => {
  try {
    const { search, page = "1", limit = "20", feature, enabled } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    const conditions: any[] = [];
    if (search) {
      conditions.push(
        or(
          ilike(merchantsTable.businessName, `%${search}%`),
          ilike(merchantsTable.email, `%${search}%`),
        )!
      );
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const [{ total }] = await db.select({ total: count() }).from(merchantsTable).where(where);

    const merchants = await db
      .select()
      .from(merchantsTable)
      .where(where)
      .limit(limitNum)
      .offset(offset)
      .orderBy(sql`${merchantsTable.createdAt} DESC`);

    const merchantIds = merchants.map(m => m.id);
    const featureRows = merchantIds.length > 0
      ? await db.select().from(merchantFeaturesTable).where(inArray(merchantFeaturesTable.merchantId, merchantIds))
      : [];
    const featureMap = new Map(featureRows.map(f => [f.merchantId, f]));

    const data = merchants.map(m => {
      const features = featureMap.get(m.id) ?? null;
      return {
        merchantId: m.id,
        businessName: m.businessName,
        email: m.email,
        status: m.status,
        features: features ? {
          id: features.id,
          dynamicQr: features.dynamicQr,
          staticQr: features.staticQr,
          virtualAccount: features.virtualAccount,
          paymentLinks: features.paymentLinks,
          payouts: features.payouts,
          withdrawals: features.withdrawals,
          settlements: features.settlements,
          webhooks: features.webhooks,
          apiKeys: features.apiKeys,
          csvExport: features.csvExport,
          updatedAt: features.updatedAt.toISOString(),
        } : null,
      };
    });

    // Filter by feature+enabled if requested
    let filtered = data;
    if (feature && FEATURE_KEYS.includes(feature as FeatureKey) && enabled !== undefined) {
      const enabledBool = enabled === "true";
      filtered = data.filter(d => d.features ? d.features[feature as FeatureKey] === enabledBool : !enabledBool);
    }

    res.json({ data: filtered, total, page: pageNum, limit: limitNum });
  } catch (err) { next(err); }
});

// GET /api/feature-control/export/csv — download CSV
router.get("/export/csv", async (req, res, next) => {
  try {
    const { search } = req.query as Record<string, string>;
    const conditions: any[] = [];
    if (search) conditions.push(or(ilike(merchantsTable.businessName, `%${search}%`), ilike(merchantsTable.email, `%${search}%`))!);

    const merchants = await db.select().from(merchantsTable).where(conditions.length ? and(...conditions) : undefined).orderBy(sql`${merchantsTable.businessName} ASC`);
    const featureRows = await db.select().from(merchantFeaturesTable);
    const featureMap = new Map(featureRows.map(f => [f.merchantId, f]));

    const headers = ["Merchant ID", "Business Name", "Email", "Status", "Dynamic QR", "Static QR", "Virtual Account", "Payment Links", "Payouts", "Withdrawals", "Settlements", "Webhooks", "API Keys", "CSV Export"];
    const q = (v: string | number | boolean) => `"${String(v).replace(/"/g, '""')}"`;

    const rows = merchants.map(m => {
      const f = featureMap.get(m.id);
      const bool = (v?: boolean) => v !== undefined ? (v ? "Yes" : "No") : "Default";
      return [m.id, m.businessName, m.email, m.status, bool(f?.dynamicQr), bool(f?.staticQr), bool(f?.virtualAccount), bool(f?.paymentLinks), bool(f?.payouts), bool(f?.withdrawals), bool(f?.settlements), bool(f?.webhooks), bool(f?.apiKeys), bool(f?.csvExport)].map(q).join(",");
    });

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="feature-control-${Date.now()}.csv"`);
    res.send([headers.map(q).join(","), ...rows].join("\n"));
  } catch (err) { next(err); }
});

// GET /api/feature-control/:merchantId
router.get("/:merchantId", async (req, res, next) => {
  try {
    const merchantId = parseInt(req.params.merchantId);
    if (isNaN(merchantId)) { res.status(400).json({ error: "Invalid merchantId" }); return; }

    const [merchant] = await db.select().from(merchantsTable).where(eq(merchantsTable.id, merchantId)).limit(1);
    if (!merchant) { res.status(404).json({ error: "Merchant not found" }); return; }

    const [features] = await db.select().from(merchantFeaturesTable).where(eq(merchantFeaturesTable.merchantId, merchantId)).limit(1);

    res.json({
      merchantId: merchant.id,
      businessName: merchant.businessName,
      email: merchant.email,
      status: merchant.status,
      features: features ? {
        ...features,
        createdAt: features.createdAt.toISOString(),
        updatedAt: features.updatedAt.toISOString(),
      } : null,
    });
  } catch (err) { next(err); }
});

// PUT /api/feature-control/:merchantId — upsert features, audit log
router.put("/:merchantId", async (req, res, next) => {
  try {
    const merchantId = parseInt(req.params.merchantId);
    if (isNaN(merchantId)) { res.status(400).json({ error: "Invalid merchantId" }); return; }

    const [merchant] = await db.select().from(merchantsTable).where(eq(merchantsTable.id, merchantId)).limit(1);
    if (!merchant) { res.status(404).json({ error: "Merchant not found" }); return; }

    const update: Partial<Record<FeatureKey, boolean>> = {};
    for (const key of FEATURE_KEYS) {
      if (typeof req.body[key] === "boolean") update[key] = req.body[key];
    }

    const [existing] = await db.select().from(merchantFeaturesTable).where(eq(merchantFeaturesTable.merchantId, merchantId)).limit(1);

    let result;
    if (existing) {
      [result] = await db.update(merchantFeaturesTable).set(update).where(eq(merchantFeaturesTable.merchantId, merchantId)).returning();
    } else {
      [result] = await db.insert(merchantFeaturesTable).values({ merchantId, ...update }).returning();
    }

    await logAudit(req as any, "feature_updated", merchantId, { merchantName: merchant.businessName, changes: update });

    res.json({ ...result, createdAt: result.createdAt.toISOString(), updatedAt: result.updatedAt.toISOString() });
  } catch (err) { next(err); }
});

// POST /api/feature-control/bulk — bulk update a specific feature for multiple merchants
router.post("/bulk", async (req, res, next) => {
  try {
    const { merchantIds, feature, enabled } = req.body as { merchantIds: number[]; feature: FeatureKey; enabled: boolean };
    if (!Array.isArray(merchantIds) || merchantIds.length === 0) { res.status(400).json({ error: "merchantIds must be a non-empty array" }); return; }
    if (!FEATURE_KEYS.includes(feature)) { res.status(400).json({ error: "Invalid feature" }); return; }
    if (typeof enabled !== "boolean") { res.status(400).json({ error: "enabled must be a boolean" }); return; }

    const merchants = await db.select().from(merchantsTable).where(inArray(merchantsTable.id, merchantIds));
    if (merchants.length === 0) { res.status(404).json({ error: "No merchants found" }); return; }

    const existingFeatures = await db.select().from(merchantFeaturesTable).where(inArray(merchantFeaturesTable.merchantId, merchantIds));
    const existingMap = new Map(existingFeatures.map(f => [f.merchantId, f]));

    const updated: number[] = [];
    for (const merchant of merchants) {
      const existing = existingMap.get(merchant.id);
      if (existing) {
        await db.update(merchantFeaturesTable).set({ [feature]: enabled }).where(eq(merchantFeaturesTable.merchantId, merchant.id));
      } else {
        await db.insert(merchantFeaturesTable).values({ merchantId: merchant.id, [feature]: enabled });
      }
      updated.push(merchant.id);
    }

    await logAudit(req as any, "feature_bulk_updated", null, {
      feature,
      enabled,
      merchantIds: updated,
      merchantCount: updated.length,
    });

    res.json({ updated: updated.length, merchantIds: updated });
  } catch (err) { next(err); }
});

export default router;
