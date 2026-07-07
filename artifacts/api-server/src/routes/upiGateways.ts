/**
 * UPI Gateways — consolidated admin management
 *
 * Single admin surface over the existing `providers` / `provider_integrations` /
 * `provider_visibility` / `routing_rules` tables — no new data model. A "UPI gateway"
 * is a `providers` row (category upi|bank, or slug ekqr) joined to its
 * `provider_integrations` config/credentials row (matched on providerKey = providers.slug).
 *
 * RBAC:
 *   - super admin: full control (create/update/delete/credentials/assign-merchants)
 *   - admin:       view + test-connection + test-webhook only
 *   - merchant:    no access (route is admin-only)
 */

import { Router } from "express";
import {
  db,
  providersTable,
  providerIntegrationsTable,
  providerVisibilityTable,
  merchantsTable,
  auditLogsTable,
  routingConfigsTable,
  routingRulesTable,
} from "@workspace/db";
import type { Provider, ProviderIntegration } from "@workspace/db";
import { eq, and, asc, isNull, inArray, sql } from "drizzle-orm";
import { requireAuth, requireAdmin, requireSuperAdmin } from "../middlewares/auth";
import { encryptSecret, decryptSecret } from "../helpers/cryptoUtils";

const router = Router();
router.use(requireAuth, requireAdmin);

const ROUTING_CONFIG_NAME = "upi_collection";

/** Only these provider categories (plus slug === "ekqr" and custom integrations) belong on the UPI Gateways page. */
function isUpiScoped(p: Provider): boolean {
  return p.category === "upi" || p.category === "bank" || p.slug === "ekqr";
}

function maskSecret(raw: string): string {
  if (raw.length <= 8) return "*".repeat(raw.length);
  return `${raw.slice(0, 4)}${"*".repeat(Math.max(0, raw.length - 8))}${raw.slice(-4)}`;
}

function decryptedValue(encrypted: string | null): string {
  if (!encrypted) return "";
  const r = decryptSecret(encrypted);
  return r.ok ? r.value : "";
}

type GatewayStats = {
  visibilityCount: number;
  assignedMerchantsCount: number;
  globalVisible: boolean | null;
};

function serializeGateway(
  id: number,
  isOrphanCustom: boolean,
  p: Pick<Provider, "name" | "slug" | "category" | "status" | "description" | "sortOrder" | "logoUrl" | "createdAt" | "updatedAt">,
  integ: ProviderIntegration | undefined,
  stats: GatewayStats,
) {
  const category: "upi" | "bank_upi" | "qr" | "custom" =
    integ?.isCustom || isOrphanCustom ? "custom" : p.slug === "ekqr" ? "qr" : p.category === "bank" ? "bank_upi" : "upi";

  const apiKeyValue = decryptedValue(integ?.apiKeyEncrypted ?? null);
  const clientIdValue = decryptedValue(integ?.clientIdEncrypted ?? null);

  return {
    id,
    name: p.name,
    slug: p.slug,
    category,
    status: p.status,
    mode: integ?.environment === "live" ? "live" : "test",
    isEnabled: integ?.isEnabled ?? false,
    isCustom: integ?.isCustom ?? isOrphanCustom,
    logoUrl: p.logoUrl ?? null,
    description: p.description ?? null,
    sortOrder: p.sortOrder,
    apiBaseUrl: integ?.apiBaseUrl ?? null,
    webhookUrl: integ?.webhookUrl ?? null,
    notes: integ?.notes ?? null,
    apiKeySet: apiKeyValue.length > 0,
    apiKeyMasked: apiKeyValue.length > 0 ? maskSecret(apiKeyValue) : "",
    clientIdSet: clientIdValue.length > 0,
    clientIdMasked: clientIdValue.length > 0 ? maskSecret(clientIdValue) : "",
    clientSecretSet: !!integ?.clientSecretEncrypted,
    webhookSecretSet: !!integ?.webhookSecretEncrypted,
    minAmount: integ?.minAmount ?? null,
    maxAmount: integ?.maxAmount ?? null,
    dailyLimit: integ?.dailyLimit ?? null,
    supportsDynamicQr: integ?.supportsDynamicQr ?? false,
    supportsStaticQr: integ?.supportsStaticQr ?? false,
    supportsPaymentLinks: integ?.supportsPaymentLinks ?? false,
    supportsWebhooks: integ?.supportsWebhooks ?? false,
    visibilityCount: stats.visibilityCount,
    assignedMerchantsCount: stats.assignedMerchantsCount,
    globalVisible: stats.globalVisible,
    routingPriority: p.sortOrder,
    updatedByEmail: integ?.updatedByEmail ?? null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: (integ?.updatedAt ?? p.updatedAt).toISOString(),
  };
}

async function loadGatewayStats(providerId: number): Promise<GatewayStats> {
  const rows = await db.select({ visible: providerVisibilityTable.visible, merchantId: providerVisibilityTable.merchantId })
    .from(providerVisibilityTable)
    .where(eq(providerVisibilityTable.providerId, providerId));
  const merchantRows = rows.filter(r => r.merchantId !== null);
  const globalRow = rows.find(r => r.merchantId === null);
  return {
    visibilityCount: merchantRows.length,
    assignedMerchantsCount: merchantRows.filter(r => r.visible).length,
    globalVisible: globalRow ? globalRow.visible : null,
  };
}

/** Finds (or lazily creates) the canonical routing config that mirrors UPI Gateway state into Smart Routing. */
async function getOrCreateRoutingConfig(): Promise<{ id: number }> {
  const [existing] = await db.select({ id: routingConfigsTable.id }).from(routingConfigsTable)
    .where(eq(routingConfigsTable.configName, ROUTING_CONFIG_NAME)).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(routingConfigsTable).values({
    configName: ROUTING_CONFIG_NAME,
    description: "Auto-managed mirror of UPI Gateways enable/priority state (managed by the UPI Gateways page)",
    strategy: "priority",
    isEnabled: true,
    fallbackEnabled: true,
  }).returning({ id: routingConfigsTable.id });
  return created!;
}

/** Keeps the routing_rules row for a gateway's providerKey in sync with its enabled/priority state. */
async function syncRoutingRule(providerKey: string, priority: number, isEnabled: boolean): Promise<void> {
  const config = await getOrCreateRoutingConfig();
  const [existingRule] = await db.select({ id: routingRulesTable.id }).from(routingRulesTable)
    .where(and(eq(routingRulesTable.configId, config.id), eq(routingRulesTable.providerKey, providerKey))).limit(1);
  if (existingRule) {
    await db.update(routingRulesTable).set({ priority, isEnabled }).where(eq(routingRulesTable.id, existingRule.id));
  } else {
    await db.insert(routingRulesTable).values({ configId: config.id, providerKey, priority, isEnabled, weightPercent: 100 });
  }
}

async function removeRoutingRule(providerKey: string): Promise<void> {
  const config = await getOrCreateRoutingConfig();
  await db.delete(routingRulesTable).where(and(eq(routingRulesTable.configId, config.id), eq(routingRulesTable.providerKey, providerKey)));
}

async function logAudit(req: any, action: string, targetId: number | null, details: Record<string, unknown>) {
  const user = req.user;
  await db.insert(auditLogsTable).values({
    adminId: user.id,
    adminEmail: user.email,
    action,
    targetType: "upi_gateway",
    targetId,
    details: JSON.stringify(details),
    ipAddress: req.ip ?? null,
  });
}

// ── GET /api/admin/upi-gateways ────────────────────────────────────────────────
router.get("/", async (req, res, next) => {
  try {
    const search = (req.query["search"] as string | undefined)?.trim().toLowerCase();
    const category = req.query["category"] as string | undefined;
    const status = req.query["status"] as string | undefined;
    const visibility = req.query["visibility"] as string | undefined;

    const allProviders = await db.select().from(providersTable).orderBy(asc(providersTable.sortOrder), asc(providersTable.id));
    const scopedProviders = allProviders.filter(isUpiScoped);
    const slugs = scopedProviders.map(p => p.slug);

    const integrations = slugs.length
      ? await db.select().from(providerIntegrationsTable).where(inArray(providerIntegrationsTable.providerKey, slugs))
      : [];
    const integByKey = new Map(integrations.map(i => [i.providerKey, i]));

    const orphanCustoms = await db.select().from(providerIntegrationsTable)
      .where(eq(providerIntegrationsTable.isCustom, true));

    let rows = await Promise.all(scopedProviders.map(async p => {
      const stats = await loadGatewayStats(p.id);
      return serializeGateway(p.id, false, p, integByKey.get(p.slug), stats);
    }));

    // Orphan customs: provider_integrations rows with isCustom=true but no matching providers row.
    const orphans = orphanCustoms.filter(i => !allProviders.some(p => p.slug === i.providerKey));
    rows = rows.concat(orphans.map(i => serializeGateway(-i.id, true, {
      name: i.providerNameInternal,
      slug: i.providerKey,
      category: "upi",
      status: i.isEnabled ? "live" : "disabled",
      description: i.notes,
      sortOrder: 999,
      logoUrl: null,
      createdAt: i.createdAt,
      updatedAt: i.updatedAt,
    }, i, { visibilityCount: 0, assignedMerchantsCount: 0, globalVisible: null })));

    if (search) {
      rows = rows.filter(r => r.name.toLowerCase().includes(search) || r.slug.toLowerCase().includes(search));
    }
    if (category) {
      rows = rows.filter(r => r.category === category);
    }
    if (status) {
      rows = rows.filter(r => r.status === status);
    }
    if (visibility === "all") {
      rows = rows.filter(r => r.visibilityCount === 0 && r.globalVisible !== false);
    } else if (visibility === "selected") {
      rows = rows.filter(r => r.visibilityCount > 0);
    } else if (visibility === "hidden") {
      rows = rows.filter(r => r.globalVisible === false);
    }

    rows.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
    res.json({ data: rows, total: rows.length });
  } catch (err) { next(err); }
});

// ── GET /api/admin/upi-gateways/:id ─────────────────────────────────────────────
router.get("/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params["id"] as string);
    if (id < 0) {
      const [integ] = await db.select().from(providerIntegrationsTable).where(eq(providerIntegrationsTable.id, -id)).limit(1);
      if (!integ) { res.status(404).json({ error: "Gateway not found" }); return; }
      res.json(serializeGateway(id, true, {
        name: integ.providerNameInternal, slug: integ.providerKey, category: "upi",
        status: integ.isEnabled ? "live" : "disabled", description: integ.notes, sortOrder: 999,
        logoUrl: null, createdAt: integ.createdAt, updatedAt: integ.updatedAt,
      }, integ, { visibilityCount: 0, assignedMerchantsCount: 0, globalVisible: null }));
      return;
    }
    const [p] = await db.select().from(providersTable).where(eq(providersTable.id, id)).limit(1);
    if (!p || !isUpiScoped(p)) { res.status(404).json({ error: "Gateway not found" }); return; }
    const [integ] = await db.select().from(providerIntegrationsTable).where(eq(providerIntegrationsTable.providerKey, p.slug)).limit(1);
    const stats = await loadGatewayStats(p.id);
    res.json(serializeGateway(p.id, false, p, integ, stats));
  } catch (err) { next(err); }
});

// ── POST /api/admin/upi-gateways (super admin only) ────────────────────────────
router.post("/", requireSuperAdmin, async (req, res, next) => {
  try {
    const body = req.body as {
      name?: string; slug?: string; category?: string; status?: string; mode?: string;
      apiBaseUrl?: string; apiKey?: string; clientId?: string; clientSecret?: string; webhookSecret?: string;
      supportsDynamicQr?: boolean; supportsStaticQr?: boolean; supportsPaymentLinks?: boolean; supportsWebhooks?: boolean;
      minAmount?: string; maxAmount?: string; dailyLimit?: string; priority?: number; notes?: string;
    };
    if (!body.name?.trim()) { res.status(400).json({ error: "name is required" }); return; }

    const slug = (body.slug?.trim() || body.name).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    if (!slug) { res.status(400).json({ error: "Could not derive a valid slug" }); return; }

    const [existingProvider] = await db.select().from(providersTable).where(eq(providersTable.slug, slug)).limit(1);
    if (existingProvider) { res.status(400).json({ error: `A gateway with slug "${slug}" already exists` }); return; }

    const providerCategory = body.category === "bank_upi" ? "bank" : "upi";
    const status = ["live", "testing", "coming_soon", "disabled"].includes(body.status ?? "") ? body.status! : "testing";
    const isCustom = body.category === "custom";

    const [createdProvider] = await db.insert(providersTable).values({
      name: body.name.trim(),
      slug,
      category: providerCategory,
      status,
      sortOrder: body.priority ?? 0,
    }).returning();

    const [createdInteg] = await db.insert(providerIntegrationsTable).values({
      providerKey: slug,
      providerNameInternal: body.name.trim(),
      displayNamePublic: "RasoKart UPI Collection",
      environment: body.mode === "live" ? "live" : "test",
      isEnabled: status === "live",
      isCustom,
      apiBaseUrl: body.apiBaseUrl?.trim() || null,
      webhookUrl: `/api/admin/upi-gateways/${createdProvider!.id}/webhook`,
      notes: body.notes?.trim() || null,
      apiKeyEncrypted: body.apiKey?.trim() ? encryptSecret(body.apiKey.trim()) : null,
      clientIdEncrypted: body.clientId?.trim() ? encryptSecret(body.clientId.trim()) : null,
      clientSecretEncrypted: body.clientSecret?.trim() ? encryptSecret(body.clientSecret.trim()) : null,
      webhookSecretEncrypted: body.webhookSecret?.trim() ? encryptSecret(body.webhookSecret.trim()) : null,
      minAmount: body.minAmount ?? null,
      maxAmount: body.maxAmount ?? null,
      dailyLimit: body.dailyLimit ?? null,
      supportsDynamicQr: body.supportsDynamicQr ?? true,
      supportsStaticQr: body.supportsStaticQr ?? true,
      supportsPaymentLinks: body.supportsPaymentLinks ?? (providerCategory === "upi"),
      supportsWebhooks: body.supportsWebhooks ?? false,
      updatedByEmail: (req as any).user.email,
    }).returning();

    await syncRoutingRule(slug, createdProvider!.sortOrder, createdInteg!.isEnabled);

    await logAudit(req, "upi_gateway_created", createdProvider!.id, { slug, name: body.name, category: body.category, status });

    req.log.info({ slug, id: createdProvider!.id }, "UPI gateway created");
    const stats = await loadGatewayStats(createdProvider!.id);
    res.status(201).json(serializeGateway(createdProvider!.id, false, createdProvider!, createdInteg!, stats));
  } catch (err: any) {
    if (err?.code === "23505") { res.status(400).json({ error: "A gateway with that slug already exists" }); return; }
    next(err);
  }
});

// ── PATCH /api/admin/upi-gateways/:id (super admin only) ───────────────────────
router.patch("/:id", requireSuperAdmin, async (req, res, next) => {
  try {
    const id = parseInt(req.params["id"] as string);
    if (id < 0) { res.status(400).json({ error: "Legacy custom integrations without a provider record must be edited from Provider Integrations" }); return; }

    const [p] = await db.select().from(providersTable).where(eq(providersTable.id, id)).limit(1);
    if (!p || !isUpiScoped(p)) { res.status(404).json({ error: "Gateway not found" }); return; }
    const [integ] = await db.select().from(providerIntegrationsTable).where(eq(providerIntegrationsTable.providerKey, p.slug)).limit(1);

    const body = req.body as {
      name?: string; category?: string; status?: string; mode?: string; isEnabled?: boolean;
      apiBaseUrl?: string; apiKey?: string; clientId?: string; clientSecret?: string; webhookSecret?: string;
      supportsDynamicQr?: boolean; supportsStaticQr?: boolean; supportsPaymentLinks?: boolean; supportsWebhooks?: boolean;
      minAmount?: string; maxAmount?: string; dailyLimit?: string; priority?: number; notes?: string;
    };

    const providerUpdate: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name !== undefined) providerUpdate.name = body.name.trim();
    if (body.category !== undefined) providerUpdate.category = body.category === "bank_upi" ? "bank" : "upi";
    if (body.status !== undefined) providerUpdate.status = body.status;
    if (body.priority !== undefined) providerUpdate.sortOrder = body.priority;
    if (Object.keys(providerUpdate).length > 1) {
      await db.update(providersTable).set(providerUpdate).where(eq(providersTable.id, id));
    }

    const integUpdate: Record<string, unknown> = {};
    let credentialsChanged = false;
    if (body.name !== undefined) integUpdate.providerNameInternal = body.name.trim();
    if (body.mode !== undefined) integUpdate.environment = body.mode === "live" ? "live" : "test";
    if (body.isEnabled !== undefined) integUpdate.isEnabled = body.isEnabled;
    if (body.apiBaseUrl !== undefined) integUpdate.apiBaseUrl = body.apiBaseUrl.trim() || null;
    if (body.notes !== undefined) integUpdate.notes = body.notes.trim() || null;
    if (body.supportsDynamicQr !== undefined) integUpdate.supportsDynamicQr = body.supportsDynamicQr;
    if (body.supportsStaticQr !== undefined) integUpdate.supportsStaticQr = body.supportsStaticQr;
    if (body.supportsPaymentLinks !== undefined) integUpdate.supportsPaymentLinks = body.supportsPaymentLinks;
    if (body.supportsWebhooks !== undefined) integUpdate.supportsWebhooks = body.supportsWebhooks;
    if (body.minAmount !== undefined) integUpdate.minAmount = body.minAmount || null;
    if (body.maxAmount !== undefined) integUpdate.maxAmount = body.maxAmount || null;
    if (body.dailyLimit !== undefined) integUpdate.dailyLimit = body.dailyLimit || null;
    if (body.apiKey !== undefined) { integUpdate.apiKeyEncrypted = body.apiKey.trim() ? encryptSecret(body.apiKey.trim()) : null; credentialsChanged = true; }
    if (body.clientId !== undefined) { integUpdate.clientIdEncrypted = body.clientId.trim() ? encryptSecret(body.clientId.trim()) : null; credentialsChanged = true; }
    if (body.clientSecret !== undefined) { integUpdate.clientSecretEncrypted = body.clientSecret.trim() ? encryptSecret(body.clientSecret.trim()) : null; credentialsChanged = true; }
    if (body.webhookSecret !== undefined) { integUpdate.webhookSecretEncrypted = body.webhookSecret.trim() ? encryptSecret(body.webhookSecret.trim()) : null; credentialsChanged = true; }
    integUpdate.updatedByEmail = (req as any).user.email;

    let savedInteg = integ;
    if (integ) {
      const [updated] = await db.update(providerIntegrationsTable).set(integUpdate as any)
        .where(eq(providerIntegrationsTable.providerKey, p.slug)).returning();
      savedInteg = updated;
    } else {
      const [created] = await db.insert(providerIntegrationsTable).values({
        providerKey: p.slug,
        providerNameInternal: body.name?.trim() || p.name,
        displayNamePublic: "RasoKart UPI Collection",
        environment: body.mode === "live" ? "live" : "test",
        isEnabled: body.isEnabled ?? false,
        webhookUrl: `/api/admin/upi-gateways/${p.id}/webhook`,
        ...integUpdate,
      } as any).returning();
      savedInteg = created;
    }

    const [freshProvider] = await db.select().from(providersTable).where(eq(providersTable.id, id)).limit(1);
    await syncRoutingRule(p.slug, freshProvider!.sortOrder, savedInteg!.isEnabled);

    if (body.isEnabled !== undefined && integ && body.isEnabled !== integ.isEnabled) {
      await logAudit(req, body.isEnabled ? "upi_gateway_enabled" : "upi_gateway_disabled", id, { slug: p.slug });
    }
    if (credentialsChanged) {
      await logAudit(req, "upi_gateway_credentials_updated", id, { slug: p.slug, fields: Object.keys(integUpdate).filter(k => k.endsWith("Encrypted")) });
    }
    const nonCredentialFields = Object.keys({ ...providerUpdate, ...integUpdate }).filter(k => !k.endsWith("Encrypted") && k !== "updatedAt" && k !== "updatedByEmail");
    if (nonCredentialFields.length > 0 && !(body.isEnabled !== undefined && Object.keys(body).length === 1)) {
      await logAudit(req, "upi_gateway_updated", id, { slug: p.slug, fields: nonCredentialFields });
    }

    req.log.info({ id, slug: p.slug }, "UPI gateway updated");
    const stats = await loadGatewayStats(id);
    res.json(serializeGateway(id, false, freshProvider!, savedInteg, stats));
  } catch (err) { next(err); }
});

// ── DELETE /api/admin/upi-gateways/:id (super admin only) ──────────────────────
router.delete("/:id", requireSuperAdmin, async (req, res, next) => {
  try {
    const id = parseInt(req.params["id"] as string);
    if (id < 0) {
      const integId = -id;
      const [integ] = await db.select().from(providerIntegrationsTable).where(eq(providerIntegrationsTable.id, integId)).limit(1);
      if (!integ) { res.status(404).json({ error: "Gateway not found" }); return; }
      if (integ.isEnabled) { res.status(409).json({ error: "Disable this gateway before deleting it" }); return; }
      await removeRoutingRule(integ.providerKey);
      await db.delete(providerIntegrationsTable).where(eq(providerIntegrationsTable.id, integId));
      await logAudit(req, "upi_gateway_deleted", id, { slug: integ.providerKey });
      res.json({ message: "Gateway deleted" });
      return;
    }

    const [p] = await db.select().from(providersTable).where(eq(providersTable.id, id)).limit(1);
    if (!p || !isUpiScoped(p)) { res.status(404).json({ error: "Gateway not found" }); return; }
    const [integ] = await db.select().from(providerIntegrationsTable).where(eq(providerIntegrationsTable.providerKey, p.slug)).limit(1);

    if (integ?.isEnabled) { res.status(409).json({ error: "Disable this gateway before deleting it" }); return; }
    const assignedRows = await db.select().from(providerVisibilityTable)
      .where(eq(providerVisibilityTable.providerId, id));
    const hasMerchantAssignments = assignedRows.some(r => r.merchantId !== null);
    if (hasMerchantAssignments) { res.status(409).json({ error: "Gateway is still assigned to merchants — unassign before deleting" }); return; }

    await removeRoutingRule(p.slug);
    await db.delete(providerVisibilityTable).where(eq(providerVisibilityTable.providerId, id));
    if (integ) await db.delete(providerIntegrationsTable).where(eq(providerIntegrationsTable.providerKey, p.slug));
    await db.delete(providersTable).where(eq(providersTable.id, id));

    await logAudit(req, "upi_gateway_deleted", id, { slug: p.slug });
    req.log.info({ id, slug: p.slug }, "UPI gateway deleted");
    res.json({ message: "Gateway deleted" });
  } catch (err) { next(err); }
});

// ── POST /api/admin/upi-gateways/:id/test-connection ────────────────────────────
router.post("/:id/test-connection", async (req, res, next) => {
  try {
    const id = parseInt(req.params["id"] as string);
    const integ = id < 0
      ? (await db.select().from(providerIntegrationsTable).where(eq(providerIntegrationsTable.id, -id)).limit(1))[0]
      : (await db.select().from(providerIntegrationsTable)
          .where(eq(providerIntegrationsTable.providerKey, (await db.select({ slug: providersTable.slug }).from(providersTable).where(eq(providersTable.id, id)).limit(1))[0]?.slug ?? "")).limit(1))[0];

    if (!integ) { res.status(404).json({ error: "Gateway not found" }); return; }

    const hasCreds = !!integ.apiKeyEncrypted || !!integ.clientIdEncrypted;
    if (!hasCreds) {
      res.json({ success: false, message: "No credentials configured for this gateway yet." });
      return;
    }

    if (integ.apiBaseUrl) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        await fetch(integ.apiBaseUrl, { method: "HEAD", signal: controller.signal }).catch(() =>
          fetch(integ.apiBaseUrl as string, { method: "GET", signal: controller.signal }));
        clearTimeout(timeout);
        res.json({ success: true, message: "Credentials are configured and the API base URL is reachable." });
      } catch {
        res.json({ success: false, message: "Credentials are configured, but the API base URL could not be reached." });
      }
      return;
    }

    res.json({ success: true, message: "Credentials are configured for this gateway." });
  } catch (err) { next(err); }
});

// ── POST /api/admin/upi-gateways/:id/test-webhook ────────────────────────────────
router.post("/:id/test-webhook", async (req, res, next) => {
  try {
    const id = parseInt(req.params["id"] as string);
    const integ = id < 0
      ? (await db.select().from(providerIntegrationsTable).where(eq(providerIntegrationsTable.id, -id)).limit(1))[0]
      : (await db.select().from(providerIntegrationsTable)
          .where(eq(providerIntegrationsTable.providerKey, (await db.select({ slug: providersTable.slug }).from(providersTable).where(eq(providersTable.id, id)).limit(1))[0]?.slug ?? "")).limit(1))[0];

    if (!integ) { res.status(404).json({ error: "Gateway not found" }); return; }
    if (!integ.webhookUrl) {
      res.json({ success: false, message: "No webhook URL configured for this gateway." });
      return;
    }

    try {
      const base = `${req.protocol}://${req.get("host")}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(`${base}${integ.webhookUrl}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Test-Webhook": "true" },
        body: JSON.stringify({ event: "test", providerKey: integ.providerKey, timestamp: new Date().toISOString() }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      res.json({
        success: response.status < 500,
        message: response.status < 500
          ? `Webhook endpoint responded with status ${response.status}.`
          : `Webhook endpoint returned an error status ${response.status}.`,
      });
    } catch {
      res.json({ success: false, message: "Could not reach the webhook endpoint." });
    }
  } catch (err) { next(err); }
});

/** Internal receiver used purely as a target for "Test Webhook" self-checks. Always safely acknowledges. */
router.post("/:id/webhook", async (req, res) => {
  res.json({ received: true });
});

// ── POST /api/admin/upi-gateways/:id/assign-merchants (super admin only) ───────
router.post("/:id/assign-merchants", requireSuperAdmin, async (req, res, next) => {
  try {
    const id = parseInt(req.params["id"] as string);
    if (id < 0) { res.status(400).json({ error: "Merchant assignment is not available for legacy custom integrations" }); return; }
    const [p] = await db.select().from(providersTable).where(eq(providersTable.id, id)).limit(1);
    if (!p || !isUpiScoped(p)) { res.status(404).json({ error: "Gateway not found" }); return; }

    const body = req.body as {
      mode?: string;
      merchantIds?: number[];
      perMerchant?: Array<{ merchantId: number; isActive?: boolean; minAmount?: string; maxAmount?: string; dailyLimit?: string; priorityOverride?: number }>;
    };
    if (!body.mode || !["all", "selected", "hide"].includes(body.mode)) {
      res.status(400).json({ error: "mode must be all, selected, or hide" }); return;
    }

    if (body.mode === "hide") {
      await db.delete(providerVisibilityTable).where(and(eq(providerVisibilityTable.providerId, id), isNull(providerVisibilityTable.merchantId)));
      await db.insert(providerVisibilityTable).values({ providerId: id, merchantId: null, visible: false });
    } else if (body.mode === "all") {
      await db.delete(providerVisibilityTable).where(eq(providerVisibilityTable.providerId, id));
      await db.insert(providerVisibilityTable).values({ providerId: id, merchantId: null, visible: true });
    } else {
      const ids = body.merchantIds ?? [];
      await db.delete(providerVisibilityTable).where(eq(providerVisibilityTable.providerId, id));
      for (const mid of ids) {
        const override = body.perMerchant?.find(o => o.merchantId === mid);
        await db.insert(providerVisibilityTable).values({
          providerId: id,
          merchantId: mid,
          visible: override?.isActive ?? true,
          minAmount: override?.minAmount ?? null,
          maxAmount: override?.maxAmount ?? null,
          dailyLimit: override?.dailyLimit ?? null,
          priorityOverride: override?.priorityOverride ?? null,
        });
      }
    }

    await logAudit(req, "upi_gateway_merchants_assigned", id, {
      slug: p.slug, mode: body.mode, merchantIds: body.merchantIds ?? [],
    });

    req.log.info({ id, slug: p.slug, mode: body.mode }, "UPI gateway merchant assignment updated");
    res.json({ message: "Merchant assignment updated" });
  } catch (err) { next(err); }
});

// ── GET /api/admin/upi-gateways/:id/merchants (helper for Assign Merchants dialog) ──
router.get("/:id/merchants", async (req, res, next) => {
  try {
    const id = parseInt(req.params["id"] as string);
    if (id < 0) { res.json([]); return; }
    const [p] = await db.select().from(providersTable).where(eq(providersTable.id, id)).limit(1);
    if (!p) { res.status(404).json({ error: "Gateway not found" }); return; }

    // Include approved/active/verified merchants regardless of verification_status
    const merchants = await db.select({
      id: merchantsTable.id,
      businessName: merchantsTable.businessName,
      email: merchantsTable.email,
      phone: merchantsTable.phone,
      status: merchantsTable.status,
      verificationStatus: merchantsTable.verificationStatus,
    })
      .from(merchantsTable)
      .where(sql`lower(${merchantsTable.status}) IN ('approved', 'active', 'verified')`)
      .orderBy(asc(merchantsTable.businessName));

    const visRows = await db.select().from(providerVisibilityTable).where(eq(providerVisibilityTable.providerId, id));
    const merchantMap = new Map(visRows.filter(r => r.merchantId !== null).map(r => [r.merchantId!, r]));
    const globalRow = visRows.find(r => r.merchantId === null);

    const result = merchants.map(m => {
      const override = merchantMap.get(m.id);
      const visible = override ? override.visible : globalRow ? globalRow.visible : true;
      return {
        merchantId: m.id,
        businessName: m.businessName,
        email: m.email,
        phone: m.phone ?? null,
        status: m.status,
        verificationStatus: m.verificationStatus ?? "pending",
        isActive: visible,
        minAmount: override?.minAmount ?? null,
        maxAmount: override?.maxAmount ?? null,
        dailyLimit: override?.dailyLimit ?? null,
        priorityOverride: override?.priorityOverride ?? null,
        source: override ? "merchant" : globalRow ? "global" : "default",
      };
    });
    res.json(result);
  } catch (err) { next(err); }
});

export default router;
