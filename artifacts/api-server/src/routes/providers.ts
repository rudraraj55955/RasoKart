import { Router } from "express";
import { db, providersTable, providerVisibilityTable, merchantsTable, auditLogsTable } from "@workspace/db";
import { eq, and, asc, isNull, count } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { ObjectStorageService, ObjectNotFoundError, InvalidImageError } from "../lib/objectStorage";
import { consumeUploadIntent } from "../lib/uploadIntentStore";

const objectStorageService = new ObjectStorageService();

/**
 * Validate a logoUrl if it points to an uploaded object-storage path.
 * Returns `{ error: string }` on a client-error failure (4xx), `{ serverError: true }` on an
 * unexpected server-side failure (5xx), or null on success.
 * Looks up the trusted declared content type from the server-side upload-intent
 * record (stored when the presigned URL was issued) and validates bytes match it.
 */
async function validateAndCleanLogoUrl(
  logoUrl: unknown,
  log: { warn: (obj: object, msg: string) => void; error: (obj: object, msg: string) => void }
): Promise<{ error: string } | { serverError: true } | null> {
  if (logoUrl == null || typeof logoUrl !== "string" || !logoUrl.startsWith("/objects/")) {
    return null;
  }
  const intent = consumeUploadIntent(logoUrl);
  const trustedContentType = intent?.contentType;
  try {
    const objectFile = await objectStorageService.getObjectEntityFile(logoUrl);
    await objectStorageService.validateImageMagicBytes(objectFile, trustedContentType);
    return null;
  } catch (err) {
    if (err instanceof InvalidImageError) {
      try {
        await objectStorageService.deleteObjectEntity(logoUrl);
      } catch (deleteErr) {
        log.warn({ err: deleteErr }, "Failed to delete invalid provider logo object");
      }
      return { error: (err as InvalidImageError).message };
    }
    if (err instanceof ObjectNotFoundError) {
      return { error: "Logo file not found in storage" };
    }
    log.error({ err }, "Unexpected error validating provider logo image");
    return { serverError: true };
  }
}

const router = Router();
router.use(requireAuth);

function mapProvider(p: typeof providersTable.$inferSelect, extras?: { visibleCount?: number; hiddenCount?: number; globalVisible?: boolean | null }) {
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    logoUrl: p.logoUrl,
    category: p.category,
    status: p.status,
    description: p.description,
    sortOrder: p.sortOrder,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    ...(extras ?? {}),
  };
}

/** Resolve visibility for a single (providerId, merchantId) pair using fallback chain */
async function resolveVisible(providerId: number, merchantId: number, providerStatus: string): Promise<boolean> {
  // 1. Check merchant-specific row
  const [merchantRow] = await db
    .select({ visible: providerVisibilityTable.visible })
    .from(providerVisibilityTable)
    .where(and(eq(providerVisibilityTable.providerId, providerId), eq(providerVisibilityTable.merchantId, merchantId)))
    .limit(1);
  if (merchantRow !== undefined) return merchantRow.visible;

  // 2. Check global rule
  const [globalRow] = await db
    .select({ visible: providerVisibilityTable.visible })
    .from(providerVisibilityTable)
    .where(and(eq(providerVisibilityTable.providerId, providerId), isNull(providerVisibilityTable.merchantId)))
    .limit(1);
  if (globalRow !== undefined) return globalRow.visible;

  // 3. Default by status
  return providerStatus === "live" || providerStatus === "testing";
}

/** Shared helper: load all providers with admin stats */
async function loadAdminProviders(category?: string, status?: string) {
  const all = await db.select().from(providersTable).orderBy(asc(providersTable.sortOrder), asc(providersTable.id));
  const withStats = await Promise.all(all.map(async (p) => {
    const [visRows, globalRow] = await Promise.all([
      db.select({ visible: providerVisibilityTable.visible, merchantId: providerVisibilityTable.merchantId })
        .from(providerVisibilityTable)
        .where(eq(providerVisibilityTable.providerId, p.id)),
      db.select({ visible: providerVisibilityTable.visible })
        .from(providerVisibilityTable)
        .where(and(eq(providerVisibilityTable.providerId, p.id), isNull(providerVisibilityTable.merchantId)))
        .limit(1),
    ]);
    const merchantRows = visRows.filter(r => r.merchantId !== null);
    const visibleCount = merchantRows.filter(r => r.visible).length;
    const hiddenCount = merchantRows.filter(r => !r.visible).length;
    const globalVisible: boolean | null = globalRow[0]?.visible ?? null;
    return mapProvider(p, { visibleCount, hiddenCount, globalVisible });
  }));
  let result = withStats;
  if (category) result = result.filter(p => p.category === category);
  if (status) result = result.filter(p => p.status === status);
  return result;
}

// GET /api/providers/admin — explicit admin endpoint (alias for admin view)
router.get("/admin", requireAdmin, async (req, res, next) => {
  try {
    const category = req.query.category as string | undefined;
    const status = req.query.status as string | undefined;
    const result = await loadAdminProviders(category, status);
    res.json({ data: result, total: result.length });
  } catch (err) {
    next(err);
  }
});

// PUT /api/providers/reorder — batch update sortOrder (admin only)
router.put("/reorder", requireAdmin, async (req, res, next) => {
  try {
    const { order } = req.body; // array of provider ids in new order
    if (!Array.isArray(order)) { res.status(400).json({ error: "order (array of ids) is required" }); return; }
    for (let i = 0; i < order.length; i++) {
      await db.update(providersTable).set({ sortOrder: i + 1, updatedAt: new Date() }).where(eq(providersTable.id, parseInt(order[i])));
    }
    res.json({ message: "Sort order updated" });
  } catch (err) {
    next(err);
  }
});

// GET /api/providers
router.get("/", async (req, res, next) => {
  try {
    const user = (req as any).user;
    const category = req.query.category as string | undefined;
    const status = req.query.status as string | undefined;

    if (user.role === "admin") {
      const result = await loadAdminProviders(category, status);
      res.json({ data: result, total: result.length });
      return;
    }

    // Merchant: return only visible providers
    const merchantId: number = user.merchantId!;
    let all = await db.select().from(providersTable).orderBy(asc(providersTable.sortOrder), asc(providersTable.id));

    // Apply filters
    if (category) all = all.filter(p => p.category === category);
    if (status) all = all.filter(p => p.status === status);

    const visible = await Promise.all(
      all.map(async (p) => ({ provider: p, visible: await resolveVisible(p.id, merchantId, p.status) }))
    );

    const result = visible.filter(v => v.visible).map(v => mapProvider(v.provider));
    res.json({ data: result, total: result.length });
  } catch (err) {
    next(err);
  }
});

// POST /api/providers (admin only)
router.post("/", requireAdmin, async (req, res, next) => {
  try {
    const { name, slug, category = "upi", status = "live", description, sortOrder = 0, logoUrl } = req.body;
    if (!name || !slug) { res.status(400).json({ error: "name and slug are required" }); return; }

    const logoResult = await validateAndCleanLogoUrl(logoUrl, req.log);
    if (logoResult !== null) {
      if ("serverError" in logoResult) { res.status(500).json({ error: "Failed to validate logo file" }); return; }
      res.status(400).json({ error: logoResult.error }); return;
    }

    const [created] = await db.insert(providersTable).values({
      name: name.trim(),
      slug: slug.trim().toLowerCase(),
      category,
      status,
      description: description ?? null,
      sortOrder: Number(sortOrder),
      logoUrl: logoUrl ?? null,
    }).returning();

    res.status(201).json(mapProvider(created));
  } catch (err: any) {
    if (err?.code === "23505") { res.status(409).json({ error: "A provider with that slug already exists" }); return; }
    next(err);
  }
});

// PUT /api/providers/:id (admin only)
router.put("/:id", requireAdmin, async (req, res, next) => {
  try {
    const id = parseInt(req.params['id'] as string);
    const { name, slug, category, status, description, sortOrder, logoUrl } = req.body;

    if (logoUrl !== undefined) {
      const logoResult = await validateAndCleanLogoUrl(logoUrl, req.log);
      if (logoResult !== null) {
        if ("serverError" in logoResult) { res.status(500).json({ error: "Failed to validate logo file" }); return; }
        res.status(400).json({ error: logoResult.error }); return;
      }
    }

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (name !== undefined) update.name = name.trim();
    if (slug !== undefined) update.slug = slug.trim().toLowerCase();
    if (category !== undefined) update.category = category;
    if (status !== undefined) update.status = status;
    if (description !== undefined) update.description = description;
    if (sortOrder !== undefined) update.sortOrder = Number(sortOrder);
    if (logoUrl !== undefined) update.logoUrl = logoUrl;

    const [updated] = await db.update(providersTable).set(update).where(eq(providersTable.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "Provider not found" }); return; }
    res.json(mapProvider(updated));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/providers/:id (admin only)
router.delete("/:id", requireAdmin, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string);
    await db.delete(providerVisibilityTable).where(eq(providerVisibilityTable.providerId, id));
    await db.delete(providersTable).where(eq(providersTable.id, id));
    res.json({ message: "Provider deleted" });
  } catch (err) {
    next(err);
  }
});

// GET /api/providers/:id/merchant-visibility (admin only)
router.get("/:id/merchant-visibility", requireAdmin, async (req, res, next) => {
  try {
    const providerId = parseInt(req.params.id as string);

    const [provider] = await db.select().from(providersTable).where(eq(providersTable.id, providerId)).limit(1);
    if (!provider) { res.status(404).json({ error: "Provider not found" }); return; }

    const merchants = await db.select({ id: merchantsTable.id, businessName: merchantsTable.businessName, email: merchantsTable.email })
      .from(merchantsTable).where(eq(merchantsTable.status, "approved")).orderBy(merchantsTable.businessName);

    const visRows = await db.select().from(providerVisibilityTable).where(eq(providerVisibilityTable.providerId, providerId));
    const globalRow = visRows.find(r => r.merchantId === null);
    const merchantMap = new Map(visRows.filter(r => r.merchantId !== null).map(r => [r.merchantId!, r.visible]));

    const result = merchants.map(m => {
      let visible: boolean;
      let source: string;
      if (merchantMap.has(m.id)) {
        visible = merchantMap.get(m.id)!;
        source = "merchant";
      } else if (globalRow !== undefined) {
        visible = globalRow.visible;
        source = "global";
      } else {
        visible = provider.status === "live" || provider.status === "testing";
        source = "default";
      }
      return { merchantId: m.id, businessName: m.businessName, email: m.email, visible, source };
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// PUT /api/providers/:id/visibility (admin only) — set global or per-merchant rule
router.put("/:id/visibility", requireAdmin, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const providerId = parseInt(req.params.id as string);
    const { merchantId, visible } = req.body;
    if (typeof visible !== "boolean") { res.status(400).json({ error: "visible (boolean) is required" }); return; }

    const mid: number | null = merchantId != null ? parseInt(merchantId) : null;

    // Upsert: check if row exists
    const existing = await db.select({ id: providerVisibilityTable.id })
      .from(providerVisibilityTable)
      .where(
        mid !== null
          ? and(eq(providerVisibilityTable.providerId, providerId), eq(providerVisibilityTable.merchantId, mid))
          : and(eq(providerVisibilityTable.providerId, providerId), isNull(providerVisibilityTable.merchantId))
      )
      .limit(1);

    if (existing[0]) {
      await db.update(providerVisibilityTable)
        .set({ visible, updatedAt: new Date() })
        .where(eq(providerVisibilityTable.id, existing[0].id));
    } else {
      await db.insert(providerVisibilityTable).values({ providerId, merchantId: mid, visible });
    }

    await db.insert(auditLogsTable).values({
      adminId: user.id,
      adminEmail: user.email,
      action: "provider_visibility_change",
      targetType: "provider",
      targetId: providerId,
      details: JSON.stringify({ merchantId: mid, visible, scope: mid ? "merchant" : "global" }),
      ipAddress: (req as any).ip ?? null,
    });

    res.json({ message: "Visibility updated" });
  } catch (err) {
    next(err);
  }
});

// POST /api/providers/:id/visibility/bulk (admin only)
router.post("/:id/visibility/bulk", requireAdmin, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const providerId = parseInt(req.params.id as string);
    const { merchantIds, visible } = req.body;
    if (!Array.isArray(merchantIds) || typeof visible !== "boolean") {
      res.status(400).json({ error: "merchantIds (array) and visible (boolean) are required" });
      return;
    }

    for (const mid of merchantIds) {
      const mId = parseInt(mid);
      const existing = await db.select({ id: providerVisibilityTable.id })
        .from(providerVisibilityTable)
        .where(and(eq(providerVisibilityTable.providerId, providerId), eq(providerVisibilityTable.merchantId, mId)))
        .limit(1);

      if (existing[0]) {
        await db.update(providerVisibilityTable)
          .set({ visible, updatedAt: new Date() })
          .where(eq(providerVisibilityTable.id, existing[0].id));
      } else {
        await db.insert(providerVisibilityTable).values({ providerId, merchantId: mId, visible });
      }
    }

    await db.insert(auditLogsTable).values({
      adminId: user.id,
      adminEmail: user.email,
      action: "provider_visibility_bulk",
      targetType: "provider",
      targetId: providerId,
      details: JSON.stringify({ merchantIds, visible, count: merchantIds.length }),
      ipAddress: (req as any).ip ?? null,
    });

    res.json({ message: `Visibility updated for ${merchantIds.length} merchants` });
  } catch (err) {
    next(err);
  }
});

export default router;
