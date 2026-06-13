import { Router } from "express";
import {
  db,
  moduleControlsTable,
  moduleVisibilityTable,
  merchantsTable,
  auditLogsTable,
} from "@workspace/db";
import { eq, and, ilike, count, or, sql, inArray } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";

const router = Router();
router.use(requireAuth, requireAdmin);

export const MODULE_DEFS = [
  { name: "customer_login",         label: "Customer Login",           description: "Allow customers to log in and create accounts" },
  { name: "customer_wallet",        label: "Customer Wallet",          description: "Customer wallet balance and top-up" },
  { name: "merchant_wallet",        label: "Merchant Wallet",          description: "Merchant wallet / ledger access" },
  { name: "merchant_kyc",           label: "Merchant KYC",             description: "Merchant identity and business verification" },
  { name: "merchant_withdrawals",   label: "Merchant Withdrawals",     description: "Merchants can request withdrawal of funds" },
  { name: "merchant_settlements",   label: "Merchant Settlements",     description: "Merchants can view and request settlements" },
  { name: "payout_requests",        label: "Payout Requests",          description: "Single payout / transfer requests" },
  { name: "bulk_payout",            label: "Bulk Payout",              description: "Batch / bulk transfer payout operations" },
  { name: "rasokart_services",      label: "RasoKart Services",        description: "Extra services marketplace for merchants" },
  { name: "customer_support",       label: "Customer Support / Tickets", description: "Support ticket system for merchants and customers" },
  { name: "customer_kyc",           label: "Customer KYC",             description: "Customer identity verification" },
  { name: "api_access",             label: "API Access",               description: "Merchant API key management and programmatic access" },
  { name: "live_mode",              label: "Live Mode Access",         description: "Production / live payment processing" },
  { name: "sandbox_mode",           label: "Test / Sandbox Mode",      description: "Test / sandbox payment environment" },
  { name: "smart_routing",          label: "Smart Routing",            description: "Automated payment provider routing" },
] as const;

export type ModuleName = typeof MODULE_DEFS[number]["name"];
export const MODULE_NAMES = MODULE_DEFS.map(m => m.name) as string[];

async function logAudit(req: any, action: string, details: object) {
  await db.insert(auditLogsTable).values({
    adminId: req.user.id,
    adminEmail: req.user.email,
    action,
    targetType: "module_control",
    targetId: null,
    details: JSON.stringify(details),
    ipAddress: req.ip ?? null,
  });
}

// ─── GET /api/module-control ─────────────────────────────────────────────────
// Returns all 15 modules with their global status (defaults to enabled if no DB row).
router.get("/", async (req, res, next) => {
  try {
    const dbRows = await db.select().from(moduleControlsTable);
    const dbMap = new Map(dbRows.map(r => [r.moduleName, r]));

    const modules = MODULE_DEFS.map(def => {
      const row = dbMap.get(def.name);
      return {
        name: def.name,
        label: def.label,
        description: def.description,
        enabled: row?.enabled ?? true,
        updatedAt: row?.updatedAt?.toISOString() ?? null,
        updatedByAdminEmail: row?.updatedByAdminEmail ?? null,
      };
    });

    res.json({ modules });
  } catch (err) { next(err); }
});

// ─── PUT /api/module-control/:module ─────────────────────────────────────────
// Toggle global enabled/disabled. Creates audit log.
router.put("/:module", async (req, res, next) => {
  try {
    const moduleName = req.params["module"] as string;
    const def = MODULE_DEFS.find(m => m.name === moduleName);
    if (!def) { res.status(404).json({ error: "Unknown module" }); return; }

    const { enabled } = req.body as { enabled?: boolean };
    if (typeof enabled !== "boolean") { res.status(400).json({ error: "enabled must be boolean" }); return; }

    const user = (req as any).user;

    const [row] = await db
      .insert(moduleControlsTable)
      .values({
        moduleName,
        label: def.label,
        description: def.description,
        enabled,
        updatedByAdminId: user.id,
        updatedByAdminEmail: user.email,
      })
      .onConflictDoUpdate({
        target: moduleControlsTable.moduleName,
        set: {
          enabled,
          updatedByAdminId: user.id,
          updatedByAdminEmail: user.email,
          updatedAt: new Date(),
        },
      })
      .returning();

    await logAudit(req, "module_global_toggled", { module: moduleName, label: def.label, enabled });

    res.json({
      name: row.moduleName,
      label: def.label,
      enabled: row.enabled,
      updatedAt: row.updatedAt.toISOString(),
      updatedByAdminEmail: row.updatedByAdminEmail,
    });
  } catch (err) { next(err); }
});

// ─── GET /api/module-control/:module/overrides ───────────────────────────────
// Lists merchants with their override status for a given module. Paginated + searchable.
router.get("/:module/overrides", async (req, res, next) => {
  try {
    const moduleName = req.params["module"] as string;
    if (!MODULE_NAMES.includes(moduleName)) { res.status(404).json({ error: "Unknown module" }); return; }

    const { search = "", page = "1", limit = "20" } = req.query as Record<string, string>;
    const pageNum  = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const offset   = (pageNum - 1) * limitNum;

    const conditions: any[] = [];
    if (search) {
      conditions.push(or(
        ilike(merchantsTable.businessName, `%${search}%`),
        ilike(merchantsTable.email, `%${search}%`),
      )!);
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [{ total }] = await db.select({ total: count() }).from(merchantsTable).where(where);
    const merchants   = await db.select().from(merchantsTable).where(where).limit(limitNum).offset(offset).orderBy(sql`${merchantsTable.createdAt} DESC`);

    const merchantIds = merchants.map(m => m.id);
    const overrides   = merchantIds.length > 0
      ? await db.select().from(moduleVisibilityTable).where(and(
          eq(moduleVisibilityTable.moduleName, moduleName),
          eq(moduleVisibilityTable.entityType, "merchant"),
          inArray(moduleVisibilityTable.entityId, merchantIds),
        ))
      : [];

    const overrideMap = new Map(overrides.map(o => [o.entityId, o]));

    const data = merchants.map(m => {
      const ov = overrideMap.get(m.id);
      return {
        merchantId: m.id,
        businessName: m.businessName,
        email: m.email,
        status: m.status,
        override: ov ? {
          id: ov.id,
          enabled: ov.enabled,
          updatedAt: ov.updatedAt.toISOString(),
          updatedByAdminEmail: ov.updatedByAdminEmail ?? null,
        } : null,
      };
    });

    res.json({ data, total, page: pageNum, limit: limitNum });
  } catch (err) { next(err); }
});

// ─── POST /api/module-control/:module/overrides ──────────────────────────────
// Upsert per-entity (merchant/customer) override. Creates audit log.
router.post("/:module/overrides", async (req, res, next) => {
  try {
    const moduleName = req.params["module"] as string;
    const def = MODULE_DEFS.find(m => m.name === moduleName);
    if (!def) { res.status(404).json({ error: "Unknown module" }); return; }

    const { entityType, entityId, enabled } = req.body as { entityType?: string; entityId?: number; enabled?: boolean };
    if (!entityType || !["merchant", "customer"].includes(entityType)) {
      res.status(400).json({ error: "entityType must be 'merchant' or 'customer'" });
      return;
    }
    if (!entityId || isNaN(Number(entityId))) { res.status(400).json({ error: "entityId must be a valid number" }); return; }
    if (typeof enabled !== "boolean") { res.status(400).json({ error: "enabled must be boolean" }); return; }

    const user = (req as any).user;

    const [row] = await db
      .insert(moduleVisibilityTable)
      .values({
        moduleName,
        entityType,
        entityId: Number(entityId),
        enabled,
        updatedByAdminId: user.id,
        updatedByAdminEmail: user.email,
      })
      .onConflictDoUpdate({
        target: [moduleVisibilityTable.moduleName, moduleVisibilityTable.entityType, moduleVisibilityTable.entityId],
        set: { enabled, updatedByAdminId: user.id, updatedByAdminEmail: user.email, updatedAt: new Date() },
      })
      .returning();

    await logAudit(req, "module_override_set", { module: moduleName, label: def.label, entityType, entityId, enabled });

    res.json({
      id: row.id,
      moduleName: row.moduleName,
      entityType: row.entityType,
      entityId: row.entityId,
      enabled: row.enabled,
      updatedAt: row.updatedAt.toISOString(),
      updatedByAdminEmail: row.updatedByAdminEmail ?? null,
    });
  } catch (err) { next(err); }
});

// ─── DELETE /api/module-control/:module/overrides/:entityType/:entityId ──────
// Remove a per-entity override (revert to global setting). Creates audit log.
router.delete("/:module/overrides/:entityType/:entityId", async (req, res, next) => {
  try {
    const moduleName  = req.params["module"] as string;
    const entityType  = req.params["entityType"] as string;
    const entityId    = parseInt(req.params["entityId"] as string);

    if (!MODULE_NAMES.includes(moduleName)) { res.status(404).json({ error: "Unknown module" }); return; }
    if (!["merchant", "customer"].includes(entityType)) { res.status(400).json({ error: "Invalid entityType" }); return; }
    if (isNaN(entityId)) { res.status(400).json({ error: "Invalid entityId" }); return; }

    const def = MODULE_DEFS.find(m => m.name === moduleName);

    await db.delete(moduleVisibilityTable).where(
      and(
        eq(moduleVisibilityTable.moduleName, moduleName),
        eq(moduleVisibilityTable.entityType, entityType),
        eq(moduleVisibilityTable.entityId, entityId),
      )
    );

    await logAudit(req, "module_override_removed", { module: moduleName, label: def?.label, entityType, entityId });

    res.json({ success: true });
  } catch (err) { next(err); }
});

export default router;
