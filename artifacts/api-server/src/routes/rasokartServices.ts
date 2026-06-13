/**
 * RasoKart Services — Merchant-facing white-label service catalogue
 *
 * IMPORTANT: This endpoint NEVER exposes:
 *   - Provider names (Cashfree, PhonePe, etc.)
 *   - cashfree_order_id / cashfree_transfer_id
 *   - provider credentials, secrets, or raw API responses
 *
 * Merchants see only:
 *   - publicName (e.g. "RasoKart Payment Gateway")
 *   - status (active / coming_soon / disabled)
 *   - Their activation request status
 *
 * Routes:
 *   GET /api/merchant/rasokart-services              — service list for the authenticated merchant
 *   POST /api/merchant/rasokart-services/request     — submit activation request
 *   GET /api/merchant/rasokart-services/requests     — merchant's own activation requests
 */

import { Router } from "express";
import {
  db,
  providerProductsTable,
  providerProductVisibilityTable,
  activationRequestsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requireModule } from "../middlewares/checkModule";

const router = Router();
router.use(requireAuth);

/** Merchant-safe product fields — never expose providerKey or internalName */
function toPublicProduct(p: typeof providerProductsTable.$inferSelect) {
  return {
    productKey:  p.productKey,
    publicName:  p.publicName,
    description: p.description,
    iconKey:     p.iconKey,
    status:      p.status,
    isEnabled:   p.isEnabled,
    sortOrder:   p.sortOrder,
  };
}

/**
 * GET /api/merchant/rasokart-services
 * Returns the RasoKart service catalogue with per-merchant activation request state.
 * Never leaks internal provider names.
 */
router.get("/rasokart-services", async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (user.role !== "merchant" || !user.merchantId) {
      res.status(403).json({ error: "Merchant access only" }); return;
    }
    const merchantId: number = user.merchantId;

    // Load all enabled products (public fields only — no providerKey, no internalName)
    const products = await db.select().from(providerProductsTable)
      .where(eq(providerProductsTable.isEnabled, true))
      .orderBy(providerProductsTable.sortOrder);

    // Visibility overrides for this merchant
    const visibilityRows = await db.select().from(providerProductVisibilityTable)
      .where(eq(providerProductVisibilityTable.merchantId, merchantId));
    const visibilityMap = new Map(visibilityRows.map(v => [v.productKey, v.visibilityStatus]));

    // Merchant's activation requests (keyed by productKey, latest status)
    const requestRows = await db.select().from(activationRequestsTable)
      .where(eq(activationRequestsTable.merchantId, merchantId));
    const requestMap = new Map<string, typeof requestRows[0]>();
    for (const r of requestRows) {
      const existing = requestMap.get(r.productKey);
      if (!existing || r.createdAt > existing.createdAt) requestMap.set(r.productKey, r);
    }

    const services = products.map(p => {
      const visibility = visibilityMap.get(p.productKey) ?? "visible";
      const request = requestMap.get(p.productKey);
      return {
        ...toPublicProduct(p),
        visibility,
        activationRequest: request ? {
          id: request.id,
          status: request.status,
          createdAt: request.createdAt.toISOString(),
        } : null,
      };
    }).filter(s => s.visibility !== "hidden");

    res.json({ services });
  } catch (err) { next(err); }
});

/**
 * POST /api/merchant/rasokart-services/request
 * Submit an activation request for a RasoKart service.
 * Returns only public fields — no provider details.
 */
router.post("/rasokart-services/request", requireModule("rasokart_services"), async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (user.role !== "merchant" || !user.merchantId) {
      res.status(403).json({ error: "Merchant access only" }); return;
    }
    const { productKey, note } = req.body as { productKey?: string; note?: string };
    if (!productKey?.trim()) { res.status(400).json({ error: "productKey is required" }); return; }

    const [product] = await db.select({
      productKey: providerProductsTable.productKey,
      status: providerProductsTable.status,
      isEnabled: providerProductsTable.isEnabled,
      publicName: providerProductsTable.publicName,
    }).from(providerProductsTable)
      .where(eq(providerProductsTable.productKey, productKey)).limit(1);

    if (!product || !product.isEnabled) {
      res.status(404).json({ error: "Service not found" }); return;
    }
    if (product.status === "active") {
      res.status(400).json({ error: "This service is already active on your account" }); return;
    }

    const [existing] = await db.select().from(activationRequestsTable)
      .where(and(
        eq(activationRequestsTable.merchantId, user.merchantId),
        eq(activationRequestsTable.productKey, productKey),
        eq(activationRequestsTable.status, "pending"),
      )).limit(1);

    if (existing) {
      res.status(400).json({
        error: "Your activation request is already pending review",
        requestId: existing.id,
      }); return;
    }

    const [row] = await db.insert(activationRequestsTable).values({
      merchantId: user.merchantId,
      productKey: productKey.trim(),
      status: "pending",
      note: note?.trim() ?? null,
    }).returning();

    req.log.info({ merchantId: user.merchantId, productKey }, "RasoKart service activation requested");

    res.json({
      requestId: row!.id,
      productKey: row!.productKey,
      publicServiceName: product.publicName,
      status: row!.status,
      createdAt: row!.createdAt.toISOString(),
      message: "Your activation request has been submitted. RasoKart team will review it shortly.",
    });
  } catch (err) { next(err); }
});

/**
 * GET /api/merchant/rasokart-services/requests
 * Merchant's own activation requests — no provider data exposed.
 */
router.get("/rasokart-services/requests", async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (user.role !== "merchant" || !user.merchantId) {
      res.status(403).json({ error: "Merchant access only" }); return;
    }

    const rows = await db.select({
      id: activationRequestsTable.id,
      productKey: activationRequestsTable.productKey,
      status: activationRequestsTable.status,
      createdAt: activationRequestsTable.createdAt,
      updatedAt: activationRequestsTable.updatedAt,
      // publicName from join
      publicName: providerProductsTable.publicName,
    })
      .from(activationRequestsTable)
      .leftJoin(providerProductsTable, eq(activationRequestsTable.productKey, providerProductsTable.productKey))
      .where(eq(activationRequestsTable.merchantId, user.merchantId))
      .orderBy(activationRequestsTable.createdAt);

    res.json(rows.map(r => ({
      id: r.id,
      productKey: r.productKey,
      publicServiceName: r.publicName ?? r.productKey,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })));
  } catch (err) { next(err); }
});

export default router;
