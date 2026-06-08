import { Router } from "express";
import { db, accountDetailsTable, accountVisibilityRulesTable, merchantsTable, auditLogsTable } from "@workspace/db";
import { eq, ilike, and, count, sql, inArray, or } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";

const router = Router();
router.use(requireAuth);

async function logAudit(req: any, action: string, targetId: number | null, details: object) {
  await db.insert(auditLogsTable).values({
    adminId: req.user.id,
    adminEmail: req.user.email,
    action,
    targetType: "account_detail",
    targetId,
    details: JSON.stringify(details),
    ipAddress: req.ip ?? null,
  });
}

function serializeDetail(d: any) {
  return {
    ...d,
    createdAt: d.createdAt instanceof Date ? d.createdAt.toISOString() : d.createdAt,
    updatedAt: d.updatedAt instanceof Date ? d.updatedAt.toISOString() : d.updatedAt,
  };
}

// GET /api/account-details — admin: all; merchant: visible ones
router.get("/", async (req, res, next) => {
  try {
    const user = (req as any).user;
    const { search, type, isActive, page = "1", limit = "50" } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(200, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    const conditions: any[] = [];
    if (search) conditions.push(ilike(accountDetailsTable.label, `%${search}%`));
    if (type && type !== "all") conditions.push(eq(accountDetailsTable.type, type));
    if (isActive && isActive !== "all") conditions.push(eq(accountDetailsTable.isActive, isActive === "true"));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    if (user.role === "admin") {
      const [{ total }] = await db.select({ total: count() }).from(accountDetailsTable).where(where);
      const data = await db.select().from(accountDetailsTable).where(where).limit(limitNum).offset(offset).orderBy(sql`${accountDetailsTable.sortOrder} ASC, ${accountDetailsTable.createdAt} DESC`);
      res.json({ data: data.map(serializeDetail), total, page: pageNum, limit: limitNum });
      return;
    }

    // Merchant: show global details + ones with explicit visible=true rule
    const merchantId = user.merchantId;
    if (!merchantId) { res.status(403).json({ error: "No merchant associated" }); return; }

    const allDetails = await db.select().from(accountDetailsTable).where(where).orderBy(sql`${accountDetailsTable.sortOrder} ASC, ${accountDetailsTable.createdAt} DESC`);
    const detailIds = allDetails.map(d => d.id);
    const rules = detailIds.length > 0
      ? await db.select().from(accountVisibilityRulesTable).where(and(inArray(accountVisibilityRulesTable.accountDetailId, detailIds), eq(accountVisibilityRulesTable.merchantId, merchantId)))
      : [];
    const ruleMap = new Map(rules.map(r => [r.accountDetailId, r.visible]));

    const visible = allDetails.filter(d => {
      if (!d.isActive) return false;
      const ruleVisible = ruleMap.get(d.id);
      if (ruleVisible !== undefined) return ruleVisible;
      return d.isGlobal;
    });

    res.json({ data: visible.map(serializeDetail), total: visible.length, page: 1, limit: visible.length });
  } catch (err) { next(err); }
});

// POST /api/account-details — admin only
router.post("/", requireAdmin, async (req, res, next) => {
  try {
    const { type, label, accountNumber, ifsc, bankName, accountHolder, upiId, qrPayload, provider, metadata, isGlobal, sortOrder } = req.body;
    if (!type || !label) { res.status(400).json({ error: "type and label are required" }); return; }

    const [created] = await db.insert(accountDetailsTable).values({
      type, label,
      accountNumber: accountNumber ?? null,
      ifsc: ifsc ?? null,
      bankName: bankName ?? null,
      accountHolder: accountHolder ?? null,
      upiId: upiId ?? null,
      qrPayload: qrPayload ?? null,
      provider: provider ?? null,
      metadata: metadata ? JSON.stringify(metadata) : null,
      isGlobal: isGlobal !== false,
      isActive: true,
      sortOrder: sortOrder ?? 0,
    }).returning();

    await logAudit(req as any, "account_detail_created", created.id, { type, label });
    res.status(201).json(serializeDetail(created));
  } catch (err) { next(err); }
});

// GET /api/account-details/export/csv — admin only (must be before /:id)
router.get("/export/csv", requireAdmin, async (req, res, next) => {
  try {
    const { type, isActive } = req.query as Record<string, string>;
    const conditions: any[] = [];
    if (type && type !== "all") conditions.push(eq(accountDetailsTable.type, type));
    if (isActive && isActive !== "all") conditions.push(eq(accountDetailsTable.isActive, isActive === "true"));

    const data = await db.select().from(accountDetailsTable).where(conditions.length ? and(...conditions) : undefined).orderBy(sql`${accountDetailsTable.sortOrder} ASC, ${accountDetailsTable.createdAt} DESC`);

    const headers = ["ID", "Type", "Label", "Account Holder", "Account Number", "IFSC", "Bank Name", "UPI ID", "Provider", "Is Active", "Is Global", "Created At"];
    const q = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = data.map(d => [d.id, d.type, d.label, d.accountHolder, d.accountNumber, d.ifsc, d.bankName, d.upiId, d.provider, d.isActive ? "Yes" : "No", d.isGlobal ? "Yes" : "No", d.createdAt.toISOString()].map(q).join(","));

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="account-details-${Date.now()}.csv"`);
    res.send([headers.map(q).join(","), ...rows].join("\n"));
  } catch (err) { next(err); }
});

// GET /api/account-details/:id — admin only
router.get("/:id", requireAdmin, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const [detail] = await db.select().from(accountDetailsTable).where(eq(accountDetailsTable.id, id)).limit(1);
    if (!detail) { res.status(404).json({ error: "Account detail not found" }); return; }
    res.json(serializeDetail(detail));
  } catch (err) { next(err); }
});

// PUT /api/account-details/:id — admin only
router.put("/:id", requireAdmin, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const [existing] = await db.select().from(accountDetailsTable).where(eq(accountDetailsTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Account detail not found" }); return; }

    const { type, label, accountNumber, ifsc, bankName, accountHolder, upiId, qrPayload, provider, metadata, isActive, isGlobal, sortOrder } = req.body;
    const update: any = {};
    if (type !== undefined) update.type = type;
    if (label !== undefined) update.label = label;
    if (accountNumber !== undefined) update.accountNumber = accountNumber;
    if (ifsc !== undefined) update.ifsc = ifsc;
    if (bankName !== undefined) update.bankName = bankName;
    if (accountHolder !== undefined) update.accountHolder = accountHolder;
    if (upiId !== undefined) update.upiId = upiId;
    if (qrPayload !== undefined) update.qrPayload = qrPayload;
    if (provider !== undefined) update.provider = provider;
    if (metadata !== undefined) update.metadata = typeof metadata === "string" ? metadata : JSON.stringify(metadata);
    if (typeof isActive === "boolean") update.isActive = isActive;
    if (typeof isGlobal === "boolean") update.isGlobal = isGlobal;
    if (sortOrder !== undefined) update.sortOrder = sortOrder;

    const [updated] = await db.update(accountDetailsTable).set(update).where(eq(accountDetailsTable.id, id)).returning();
    await logAudit(req as any, "account_detail_updated", id, { label: updated.label, changes: Object.keys(update) });
    res.json(serializeDetail(updated));
  } catch (err) { next(err); }
});

// DELETE /api/account-details/:id — admin only
router.delete("/:id", requireAdmin, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const [existing] = await db.select().from(accountDetailsTable).where(eq(accountDetailsTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Account detail not found" }); return; }

    await db.delete(accountVisibilityRulesTable).where(eq(accountVisibilityRulesTable.accountDetailId, id));
    await db.delete(accountDetailsTable).where(eq(accountDetailsTable.id, id));
    await logAudit(req as any, "account_detail_deleted", id, { label: existing.label, type: existing.type });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// GET /api/account-details/:id/visibility — list all merchants + their visibility status
router.get("/:id/visibility", requireAdmin, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const [detail] = await db.select().from(accountDetailsTable).where(eq(accountDetailsTable.id, id)).limit(1);
    if (!detail) { res.status(404).json({ error: "Account detail not found" }); return; }

    const { search, page = "1", limit = "50" } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(200, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    const conditions: any[] = [];
    if (search) conditions.push(or(ilike(merchantsTable.businessName, `%${search}%`), ilike(merchantsTable.email, `%${search}%`))!);
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [{ total }] = await db.select({ total: count() }).from(merchantsTable).where(where);
    const merchants = await db.select().from(merchantsTable).where(where).limit(limitNum).offset(offset).orderBy(sql`${merchantsTable.businessName} ASC`);

    const rules = await db.select().from(accountVisibilityRulesTable).where(eq(accountVisibilityRulesTable.accountDetailId, id));
    const ruleMap = new Map(rules.map(r => [r.merchantId, r.visible]));

    const data = merchants.map(m => {
      const ruleVisible = ruleMap.get(m.id);
      const effectiveVisible = ruleVisible !== undefined ? ruleVisible : detail.isGlobal;
      return {
        merchantId: m.id,
        businessName: m.businessName,
        email: m.email,
        status: m.status,
        explicitRule: ruleVisible !== undefined ? ruleVisible : null,
        effectiveVisible,
        isDefault: ruleVisible === undefined,
      };
    });

    res.json({ data, total, page: pageNum, limit: limitNum, isGlobal: detail.isGlobal });
  } catch (err) { next(err); }
});

// PUT /api/account-details/:id/visibility — set visibility for merchants
router.put("/:id/visibility", requireAdmin, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const [detail] = await db.select().from(accountDetailsTable).where(eq(accountDetailsTable.id, id)).limit(1);
    if (!detail) { res.status(404).json({ error: "Account detail not found" }); return; }

    const { merchantIds, visible, allMerchants, resetToDefault } = req.body as {
      merchantIds?: number[];
      visible?: boolean;
      allMerchants?: boolean;
      resetToDefault?: boolean;
    };

    if (allMerchants) {
      // Update isGlobal flag + clear all per-merchant rules
      await db.update(accountDetailsTable).set({ isGlobal: visible !== false }).where(eq(accountDetailsTable.id, id));
      await db.delete(accountVisibilityRulesTable).where(eq(accountVisibilityRulesTable.accountDetailId, id));
      await logAudit(req as any, "visibility_rule_updated", id, { scope: "all_merchants", visible: visible !== false });
      res.json({ success: true, scope: "all_merchants" });
      return;
    }

    if (!Array.isArray(merchantIds) || merchantIds.length === 0) {
      res.status(400).json({ error: "merchantIds must be a non-empty array (or use allMerchants: true)" });
      return;
    }

    if (resetToDefault) {
      // Remove explicit rules → fall back to isGlobal default
      await db.delete(accountVisibilityRulesTable).where(
        and(eq(accountVisibilityRulesTable.accountDetailId, id), inArray(accountVisibilityRulesTable.merchantId, merchantIds))
      );
      await logAudit(req as any, "visibility_rule_updated", id, { scope: "reset_to_default", merchantIds });
      res.json({ success: true, scope: "reset", count: merchantIds.length });
      return;
    }

    if (typeof visible !== "boolean") {
      res.status(400).json({ error: "visible must be a boolean" });
      return;
    }

    // Upsert visibility rules for each merchant
    for (const merchantId of merchantIds) {
      const [existing] = await db.select().from(accountVisibilityRulesTable).where(
        and(eq(accountVisibilityRulesTable.accountDetailId, id), eq(accountVisibilityRulesTable.merchantId, merchantId))
      ).limit(1);
      if (existing) {
        await db.update(accountVisibilityRulesTable).set({ visible }).where(eq(accountVisibilityRulesTable.id, existing.id));
      } else {
        await db.insert(accountVisibilityRulesTable).values({ accountDetailId: id, merchantId, visible });
      }
    }

    await logAudit(req as any, "visibility_rule_updated", id, { merchantIds, visible, count: merchantIds.length });
    res.json({ success: true, updated: merchantIds.length });
  } catch (err) { next(err); }
});

export default router;
