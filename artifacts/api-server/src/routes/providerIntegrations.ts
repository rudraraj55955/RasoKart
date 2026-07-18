/**
 * Provider Integrations — Super-Admin-only API
 *
 * Manages the white-label provider architecture:
 *   GET  /api/provider-integrations            — list all backend integrations (admin sees Cashfree names)
 *   PUT  /api/provider-integrations/:key       — update metadata (env, enabled, notes, webhookUrl)
 *   GET  /api/provider-products                — list RasoKart service catalogue (admin sees internal names)
 *   PUT  /api/provider-products/:key           — update product metadata / status (admin only)
 *   GET  /api/activation-requests              — list activation requests (admin: all, merchant: own)
 *   POST /api/activation-requests              — merchant creates a request
 *   PUT  /api/activation-requests/:id          — admin approves / rejects
 *   GET  /api/provider-product-visibility      — list per-merchant visibility overrides
 *   PUT  /api/provider-product-visibility      — set visibility for a merchant+product pair
 */

import { Router } from "express";
import {
  db,
  providerIntegrationsTable,
  providerProductsTable,
  providerProductVisibilityTable,
  activationRequestsTable,
  merchantsTable,
  auditLogsTable,
} from "@workspace/db";
import { eq, and, asc, desc } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { encryptSecret, decryptSecret } from "../helpers/cryptoUtils";
import type { ProviderIntegration } from "@workspace/db";

const router = Router();
router.use(requireAuth);

// ── Provider Integrations ─────────────────────────────────────────────────────

function maskSecret(raw: string): string {
  if (raw.length <= 8) return "*".repeat(raw.length);
  return `${raw.slice(0, 4)}${"*".repeat(Math.max(0, raw.length - 8))}${raw.slice(-4)}`;
}

/** Shapes a DB row for the client — never returns raw/encrypted credential values. */
function serializeIntegration(r: ProviderIntegration) {
  const rawApiKey = r.apiKeyEncrypted ? decryptSecret(r.apiKeyEncrypted) : null;
  const rawApiSecret = r.apiSecretEncrypted ? decryptSecret(r.apiSecretEncrypted) : null;
  const apiKeyValue = rawApiKey?.ok ? rawApiKey.value : "";
  const apiSecretValue = rawApiSecret?.ok ? rawApiSecret.value : "";

  const {
    apiKeyEncrypted: _apiKeyEncrypted,
    apiSecretEncrypted: _apiSecretEncrypted,
    webhookSecretEncrypted: _webhookSecretEncrypted,
    ...rest
  } = r;

  return {
    ...rest,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    apiKeySet: apiKeyValue.length > 0,
    apiKeyMasked: apiKeyValue.length > 0 ? maskSecret(apiKeyValue) : "",
    apiSecretSet: apiSecretValue.length > 0,
    webhookSecretSet: !!r.webhookSecretEncrypted,
  };
}

/** GET /api/provider-integrations */
router.get("/integrations", requireAdmin, async (req, res, next) => {
  try {
    const rows = await db.select().from(providerIntegrationsTable).orderBy(asc(providerIntegrationsTable.id));
    res.json(rows.map(serializeIntegration));
  } catch (err) { next(err); }
});

/** POST /api/provider-integrations/integrations — register a new custom gateway (admin only) */
router.post("/integrations", requireAdmin, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const {
      providerKey, providerNameInternal, displayNamePublic, environment, productType,
      webhookUrl, notes, isEnabled, apiKey, apiSecret, webhookSecret,
    } = req.body as {
      providerKey?: string;
      providerNameInternal?: string;
      displayNamePublic?: string;
      environment?: string;
      productType?: string;
      webhookUrl?: string;
      notes?: string;
      isEnabled?: boolean;
      apiKey?: string;
      apiSecret?: string;
      webhookSecret?: string;
    };

    if (!providerNameInternal?.trim()) { res.status(400).json({ error: "providerNameInternal is required" }); return; }
    if (!displayNamePublic?.trim()) { res.status(400).json({ error: "displayNamePublic is required" }); return; }

    const slugBase = (providerKey?.trim() || providerNameInternal)
      .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    if (!slugBase) { res.status(400).json({ error: "Could not derive a valid provider key" }); return; }

    const [existing] = await db.select().from(providerIntegrationsTable)
      .where(eq(providerIntegrationsTable.providerKey, slugBase)).limit(1);
    if (existing) { res.status(400).json({ error: `Provider key "${slugBase}" already exists` }); return; }

    const [created] = await db.insert(providerIntegrationsTable).values({
      providerKey: slugBase,
      providerNameInternal: providerNameInternal.trim(),
      displayNamePublic: displayNamePublic.trim(),
      environment: environment === "live" ? "live" : "test",
      isEnabled: isEnabled ?? false,
      productType: productType?.trim() || null,
      webhookUrl: webhookUrl?.trim() || null,
      notes: notes?.trim() || null,
      isCustom: true,
      apiKeyEncrypted: apiKey?.trim() ? encryptSecret(apiKey.trim()) : null,
      apiSecretEncrypted: apiSecret?.trim() ? encryptSecret(apiSecret.trim()) : null,
      webhookSecretEncrypted: webhookSecret?.trim() ? encryptSecret(webhookSecret.trim()) : null,
      updatedByEmail: user.email,
    }).returning();

    await db.insert(auditLogsTable).values({
      adminId: user.id, adminEmail: user.email,
      action: "provider_integration_created", targetType: "provider_integration", targetId: null,
      details: JSON.stringify({ providerKey: slugBase, providerNameInternal, productType }),
      ipAddress: (req as any).ip ?? null,
    });

    req.log.info({ providerKey: slugBase }, "Custom provider integration created");
    res.status(201).json(serializeIntegration(created!));
  } catch (err) { next(err); }
});

/** PUT /api/provider-integrations/:key */
router.put("/integrations/:key", requireAdmin, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const key = req.params["key"] as string;
    const { environment, isEnabled, webhookUrl, notes, displayNamePublic, productType, apiKey, apiSecret, webhookSecret } = req.body as {
      environment?: string;
      isEnabled?: boolean;
      webhookUrl?: string;
      notes?: string;
      displayNamePublic?: string;
      productType?: string;
      apiKey?: string;
      apiSecret?: string;
      webhookSecret?: string;
    };

    const [existing] = await db.select().from(providerIntegrationsTable)
      .where(eq(providerIntegrationsTable.providerKey, key)).limit(1);
    if (!existing) { res.status(404).json({ error: "Integration not found" }); return; }

    const updateSet: Record<string, unknown> = {};
    if (environment !== undefined) updateSet.environment = environment;
    if (isEnabled !== undefined) updateSet.isEnabled = isEnabled;
    if (webhookUrl !== undefined) updateSet.webhookUrl = webhookUrl;
    if (notes !== undefined) updateSet.notes = notes;
    if (displayNamePublic !== undefined) updateSet.displayNamePublic = displayNamePublic;
    if (existing.isCustom && productType !== undefined) updateSet.productType = productType;
    if (existing.isCustom && apiKey !== undefined) updateSet.apiKeyEncrypted = apiKey.trim() ? encryptSecret(apiKey.trim()) : null;
    if (existing.isCustom && apiSecret !== undefined) updateSet.apiSecretEncrypted = apiSecret.trim() ? encryptSecret(apiSecret.trim()) : null;
    if (existing.isCustom && webhookSecret !== undefined) updateSet.webhookSecretEncrypted = webhookSecret.trim() ? encryptSecret(webhookSecret.trim()) : null;
    updateSet.updatedByEmail = user.email;

    const [updated] = await db.update(providerIntegrationsTable)
      .set(updateSet as any)
      .where(eq(providerIntegrationsTable.providerKey, key))
      .returning();

    const auditChangeSet: Record<string, unknown> = { providerKey: key };
    if (updateSet["apiKeyEncrypted"] !== undefined) auditChangeSet.apiKeyUpdated = true;
    if (updateSet["apiSecretEncrypted"] !== undefined) auditChangeSet.apiSecretUpdated = true;
    if (updateSet["webhookSecretEncrypted"] !== undefined) auditChangeSet.webhookSecretUpdated = true;
    if (updateSet["environment"] !== undefined && updateSet["environment"] !== existing.environment) auditChangeSet.environment = { from: existing.environment, to: updateSet["environment"] };
    if (updateSet["isEnabled"] !== undefined && updateSet["isEnabled"] !== existing.isEnabled) auditChangeSet.isEnabled = { from: existing.isEnabled, to: updateSet["isEnabled"] };
    if (updateSet["webhookUrl"] !== undefined && updateSet["webhookUrl"] !== existing.webhookUrl) auditChangeSet.webhookUrl = { from: existing.webhookUrl, to: updateSet["webhookUrl"] };
    if (updateSet["notes"] !== undefined && updateSet["notes"] !== existing.notes) auditChangeSet.notes = { from: existing.notes, to: updateSet["notes"] };
    if (updateSet["displayNamePublic"] !== undefined && updateSet["displayNamePublic"] !== existing.displayNamePublic) auditChangeSet.displayNamePublic = { from: existing.displayNamePublic, to: updateSet["displayNamePublic"] };
    if (updateSet["productType"] !== undefined && updateSet["productType"] !== existing.productType) auditChangeSet.productType = { from: existing.productType, to: updateSet["productType"] };

    const hasChanges = Object.keys(auditChangeSet).some(k => k !== "providerKey");
    if (hasChanges) {
      await db.insert(auditLogsTable).values({
        adminId: user.id, adminEmail: user.email,
        action: "provider_integration_updated", targetType: "provider_integration", targetId: null,
        details: JSON.stringify(auditChangeSet),
        ipAddress: (req as any).ip ?? null,
      });
    }

    req.log.info({ key, isEnabled, environment }, "Provider integration updated");
    res.json(serializeIntegration(updated!));
  } catch (err) { next(err); }
});

/** DELETE /api/provider-integrations/integrations/:key — remove a custom gateway (admin only) */
router.delete("/integrations/:key", requireAdmin, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const key = req.params["key"] as string;

    const [existing] = await db.select().from(providerIntegrationsTable)
      .where(eq(providerIntegrationsTable.providerKey, key)).limit(1);
    if (!existing) { res.status(404).json({ error: "Integration not found" }); return; }
    if (!existing.isCustom) { res.status(400).json({ error: "Built-in provider integrations cannot be deleted" }); return; }

    await db.delete(providerIntegrationsTable).where(eq(providerIntegrationsTable.providerKey, key));

    await db.insert(auditLogsTable).values({
      adminId: user.id, adminEmail: user.email,
      action: "provider_integration_deleted", targetType: "provider_integration", targetId: null,
      details: JSON.stringify({ providerKey: key }),
      ipAddress: (req as any).ip ?? null,
    });

    req.log.info({ key }, "Custom provider integration deleted");
    res.json({ message: "Integration removed" });
  } catch (err) { next(err); }
});

// ── Provider Products ─────────────────────────────────────────────────────────

/** GET /api/provider-integrations/products — all products (admin sees internal names) */
router.get("/products", requireAdmin, async (req, res, next) => {
  try {
    const rows = await db.select().from(providerProductsTable).orderBy(asc(providerProductsTable.sortOrder));
    res.json(rows.map(r => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })));
  } catch (err) { next(err); }
});

/** PUT /api/provider-integrations/products/:key — update product (admin only) */
router.put("/products/:key", requireAdmin, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const key = req.params["key"] as string;
    const { status, isEnabled, publicName, description, sortOrder, providerKey } = req.body as {
      status?: string;
      isEnabled?: boolean;
      publicName?: string;
      description?: string;
      sortOrder?: number;
      providerKey?: string;
    };

    const [existing] = await db.select().from(providerProductsTable)
      .where(eq(providerProductsTable.productKey, key)).limit(1);
    if (!existing) { res.status(404).json({ error: "Product not found" }); return; }

    const updateSet: Record<string, unknown> = {};
    if (status !== undefined) updateSet.status = status;
    if (isEnabled !== undefined) updateSet.isEnabled = isEnabled;
    if (publicName !== undefined) updateSet.publicName = publicName;
    if (description !== undefined) updateSet.description = description;
    if (sortOrder !== undefined) updateSet.sortOrder = sortOrder;
    if (providerKey !== undefined) updateSet.providerKey = providerKey;

    const [updated] = await db.update(providerProductsTable)
      .set(updateSet as any)
      .where(eq(providerProductsTable.productKey, key))
      .returning();

    req.log.info({ key, status, isEnabled }, "Provider product updated");
    res.json({ ...updated!, createdAt: updated!.createdAt.toISOString(), updatedAt: updated!.updatedAt.toISOString() });
  } catch (err) { next(err); }
});

// ── Activation Requests ───────────────────────────────────────────────────────

/** GET /api/provider-integrations/activation-requests */
router.get("/activation-requests", async (req, res, next) => {
  try {
    const user = (req as any).user;
    const isAdmin = user.role === "admin";

    const rows = isAdmin
      ? await db.select().from(activationRequestsTable).orderBy(desc(activationRequestsTable.createdAt)).limit(200)
      : await db.select().from(activationRequestsTable)
          .where(eq(activationRequestsTable.merchantId, user.merchantId))
          .orderBy(desc(activationRequestsTable.createdAt));

    res.json(rows.map(r => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })));
  } catch (err) { next(err); }
});

/** POST /api/provider-integrations/activation-requests — merchant submits request */
router.post("/activation-requests", async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (user.role !== "merchant" || !user.merchantId) {
      res.status(403).json({ error: "Merchant access only" }); return;
    }
    const { productKey, note } = req.body as { productKey?: string; note?: string };
    if (!productKey?.trim()) { res.status(400).json({ error: "productKey is required" }); return; }

    // Check product exists
    const [product] = await db.select().from(providerProductsTable)
      .where(eq(providerProductsTable.productKey, productKey)).limit(1);
    if (!product) { res.status(404).json({ error: "Service not found" }); return; }
    if (product.status === "active") { res.status(400).json({ error: "Service is already active" }); return; }

    // Check for existing pending request
    const [existing] = await db.select().from(activationRequestsTable)
      .where(and(
        eq(activationRequestsTable.merchantId, user.merchantId),
        eq(activationRequestsTable.productKey, productKey),
        eq(activationRequestsTable.status, "pending"),
      )).limit(1);
    if (existing) { res.status(400).json({ error: "A pending request already exists for this service" }); return; }

    const [row] = await db.insert(activationRequestsTable).values({
      merchantId: user.merchantId,
      productKey: productKey.trim(),
      status: "pending",
      note: note?.trim() ?? null,
    }).returning();

    req.log.info({ merchantId: user.merchantId, productKey }, "Activation request submitted");
    res.json({ ...row!, createdAt: row!.createdAt.toISOString(), updatedAt: row!.updatedAt.toISOString() });
  } catch (err) { next(err); }
});

/** PUT /api/provider-integrations/activation-requests/:id — admin approves/rejects */
router.put("/activation-requests/:id", requireAdmin, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const id = parseInt(req.params["id"] as string);
    const { status, note } = req.body as { status?: string; note?: string };

    if (!status || !["pending", "approved", "rejected"].includes(status)) {
      res.status(400).json({ error: "status must be pending, approved, or rejected" }); return;
    }

    const [existing] = await db.select().from(activationRequestsTable)
      .where(eq(activationRequestsTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Request not found" }); return; }

    const [updated] = await db.update(activationRequestsTable)
      .set({ status, note: note ?? existing.note })
      .where(eq(activationRequestsTable.id, id))
      .returning();

    await db.insert(auditLogsTable).values({
      adminId: user.id, adminEmail: user.email,
      action: `activation_request_${status}`, targetType: "activation_request", targetId: id,
      details: JSON.stringify({ productKey: existing.productKey, merchantId: existing.merchantId, note }),
      ipAddress: (req as any).ip ?? null,
    });

    req.log.info({ id, status, productKey: existing.productKey }, "Activation request updated");
    res.json({ ...updated!, createdAt: updated!.createdAt.toISOString(), updatedAt: updated!.updatedAt.toISOString() });
  } catch (err) { next(err); }
});

// ── Product Visibility ────────────────────────────────────────────────────────

/** GET /api/provider-integrations/product-visibility?merchantId=N */
router.get("/product-visibility", requireAdmin, async (req, res, next) => {
  try {
    const merchantId = req.query["merchantId"] ? parseInt(req.query["merchantId"] as string) : undefined;
    const rows = merchantId
      ? await db.select().from(providerProductVisibilityTable)
          .where(eq(providerProductVisibilityTable.merchantId, merchantId))
      : await db.select().from(providerProductVisibilityTable);
    res.json(rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() })));
  } catch (err) { next(err); }
});

/** PUT /api/provider-integrations/product-visibility */
router.put("/product-visibility", requireAdmin, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const { merchantId, productKey, visibilityStatus } = req.body as {
      merchantId?: number; productKey?: string; visibilityStatus?: string;
    };

    if (!merchantId || !productKey || !visibilityStatus) {
      res.status(400).json({ error: "merchantId, productKey, visibilityStatus required" }); return;
    }

    const [row] = await db.insert(providerProductVisibilityTable)
      .values({ merchantId, productKey, visibilityStatus })
      .onConflictDoUpdate({
        target: [providerProductVisibilityTable.productKey, providerProductVisibilityTable.merchantId],
        set: { visibilityStatus },
      }).returning();

    req.log.info({ merchantId, productKey, visibilityStatus }, "Product visibility updated");
    res.json({ ...row!, createdAt: row!.createdAt.toISOString(), updatedAt: row!.updatedAt.toISOString() });
  } catch (err) { next(err); }
});

export default router;
