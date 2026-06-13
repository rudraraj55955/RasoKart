/**
 * Smart Routing API — Admin-only management endpoints
 *
 * Routes:
 *   GET  /api/smart-routing/configs                — list routing configs
 *   POST /api/smart-routing/configs                — create a new config
 *   PUT  /api/smart-routing/configs/:id            — update config (strategy, enabled, timeout…)
 *   GET  /api/smart-routing/configs/:id/rules      — list rules for a config
 *   POST /api/smart-routing/configs/:id/rules      — add a rule
 *   PUT  /api/smart-routing/rules/:id              — update a rule
 *   DELETE /api/smart-routing/rules/:id            — delete a rule
 *   GET  /api/smart-routing/metrics                — provider success-rate metrics
 *   GET  /api/smart-routing/logs                   — routing decision logs (admin-only)
 *   GET  /api/smart-routing/status                 — quick summary for dashboard
 *
 * SECURITY: This router is requireAuth + requireAdmin on every route.
 * Provider names, keys, and internal errors are ONLY visible here — never in merchant/customer APIs.
 */

import { Router } from "express";
import {
  db,
  routingConfigsTable,
  routingRulesTable,
  routingLogsTable,
  providerMetricsTable,
  auditLogsTable,
} from "@workspace/db";
import { eq, and, desc, asc } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";

const router = Router();
router.use(requireAuth, requireAdmin);

// ── Configs ───────────────────────────────────────────────────────────────────

/** GET /api/smart-routing/configs */
router.get("/configs", async (req, res, next) => {
  try {
    const rows = await db.select().from(routingConfigsTable).orderBy(asc(routingConfigsTable.id));
    res.json(rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() })));
  } catch (err) { next(err); }
});

/** POST /api/smart-routing/configs */
router.post("/configs", async (req, res, next) => {
  try {
    const user = (req as any).user;
    const { configName, description, strategy, isEnabled, fallbackEnabled, timeoutMs, minSuccessRateThreshold } = req.body as {
      configName?: string; description?: string; strategy?: string;
      isEnabled?: boolean; fallbackEnabled?: boolean; timeoutMs?: number;
      minSuccessRateThreshold?: number;
    };

    if (!configName?.trim()) { res.status(400).json({ error: "configName is required" }); return; }
    if (!["priority", "percentage", "success_rate", "round_robin"].includes(strategy ?? "priority")) {
      res.status(400).json({ error: "strategy must be priority | percentage | success_rate | round_robin" }); return;
    }

    const [row] = await db.insert(routingConfigsTable).values({
      configName: configName.trim(),
      description: description?.trim() ?? null,
      strategy: (strategy ?? "priority") as string,
      isEnabled: isEnabled ?? true,
      fallbackEnabled: fallbackEnabled ?? true,
      timeoutMs: timeoutMs ?? 30000,
      minSuccessRateThreshold: minSuccessRateThreshold != null ? String(minSuccessRateThreshold) : "80.00",
      updatedByEmail: user.email,
    }).returning();

    req.log.info({ configName, strategy }, "Routing config created");
    res.json({ ...row!, createdAt: row!.createdAt.toISOString(), updatedAt: row!.updatedAt.toISOString() });
  } catch (err) { next(err); }
});

/** PUT /api/smart-routing/configs/:id */
router.put("/configs/:id", async (req, res, next) => {
  try {
    const user = (req as any).user;
    const id = parseInt(req.params["id"] as string);
    const { description, strategy, isEnabled, fallbackEnabled, timeoutMs, minSuccessRateThreshold } = req.body as {
      description?: string; strategy?: string; isEnabled?: boolean;
      fallbackEnabled?: boolean; timeoutMs?: number; minSuccessRateThreshold?: number;
    };

    const [existing] = await db.select().from(routingConfigsTable).where(eq(routingConfigsTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Config not found" }); return; }

    const updateSet: Record<string, unknown> = { updatedByEmail: user.email };
    if (description !== undefined) updateSet.description = description;
    if (strategy !== undefined) updateSet.strategy = strategy;
    if (isEnabled !== undefined) updateSet.isEnabled = isEnabled;
    if (fallbackEnabled !== undefined) updateSet.fallbackEnabled = fallbackEnabled;
    if (timeoutMs !== undefined) updateSet.timeoutMs = timeoutMs;
    if (minSuccessRateThreshold !== undefined) updateSet.minSuccessRateThreshold = String(minSuccessRateThreshold);

    const [updated] = await db.update(routingConfigsTable).set(updateSet as any).where(eq(routingConfigsTable.id, id)).returning();

    await db.insert(auditLogsTable).values({
      adminId: user.id, adminEmail: user.email,
      action: "routing_config_updated", targetType: "routing_config", targetId: id,
      details: JSON.stringify(updateSet),
      ipAddress: (req as any).ip ?? null,
    });

    req.log.info({ id, ...updateSet }, "Routing config updated");
    res.json({ ...updated!, createdAt: updated!.createdAt.toISOString(), updatedAt: updated!.updatedAt.toISOString() });
  } catch (err) { next(err); }
});

// ── Rules ─────────────────────────────────────────────────────────────────────

/** GET /api/smart-routing/configs/:id/rules */
router.get("/configs/:id/rules", async (req, res, next) => {
  try {
    const id = parseInt(req.params["id"] as string);
    const rules = await db.select().from(routingRulesTable)
      .where(eq(routingRulesTable.configId, id))
      .orderBy(asc(routingRulesTable.priority));
    res.json(rules.map(r => ({ ...r, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() })));
  } catch (err) { next(err); }
});

/** POST /api/smart-routing/configs/:id/rules */
router.post("/configs/:id/rules", async (req, res, next) => {
  try {
    const configId = parseInt(req.params["id"] as string);
    const { providerKey, priority, weightPercent, minAmount, maxAmount, allowedPaymentModes, isEnabled, notes } = req.body as {
      providerKey?: string; priority?: number; weightPercent?: number;
      minAmount?: number; maxAmount?: number; allowedPaymentModes?: string[];
      isEnabled?: boolean; notes?: string;
    };

    if (!providerKey?.trim()) { res.status(400).json({ error: "providerKey is required" }); return; }

    const [existing] = await db.select().from(routingConfigsTable).where(eq(routingConfigsTable.id, configId)).limit(1);
    if (!existing) { res.status(404).json({ error: "Config not found" }); return; }

    const [row] = await db.insert(routingRulesTable).values({
      configId,
      providerKey: providerKey.trim(),
      priority: priority ?? 1,
      weightPercent: weightPercent ?? 100,
      minAmount: minAmount != null ? String(minAmount) : null,
      maxAmount: maxAmount != null ? String(maxAmount) : null,
      allowedPaymentModes: allowedPaymentModes ? JSON.stringify(allowedPaymentModes) : null,
      isEnabled: isEnabled ?? true,
      notes: notes?.trim() ?? null,
    }).returning();

    req.log.info({ configId, providerKey, priority }, "Routing rule created");
    res.json({ ...row!, createdAt: row!.createdAt.toISOString(), updatedAt: row!.updatedAt.toISOString() });
  } catch (err) { next(err); }
});

/** PUT /api/smart-routing/rules/:id */
router.put("/rules/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params["id"] as string);
    const { providerKey, priority, weightPercent, minAmount, maxAmount, allowedPaymentModes, isEnabled, notes } = req.body as {
      providerKey?: string; priority?: number; weightPercent?: number;
      minAmount?: number | null; maxAmount?: number | null; allowedPaymentModes?: string[];
      isEnabled?: boolean; notes?: string;
    };

    const [existing] = await db.select().from(routingRulesTable).where(eq(routingRulesTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Rule not found" }); return; }

    const updateSet: Record<string, unknown> = {};
    if (providerKey !== undefined) updateSet.providerKey = providerKey;
    if (priority !== undefined) updateSet.priority = priority;
    if (weightPercent !== undefined) updateSet.weightPercent = weightPercent;
    if (minAmount !== undefined) updateSet.minAmount = minAmount != null ? String(minAmount) : null;
    if (maxAmount !== undefined) updateSet.maxAmount = maxAmount != null ? String(maxAmount) : null;
    if (allowedPaymentModes !== undefined) updateSet.allowedPaymentModes = JSON.stringify(allowedPaymentModes);
    if (isEnabled !== undefined) updateSet.isEnabled = isEnabled;
    if (notes !== undefined) updateSet.notes = notes;

    const [updated] = await db.update(routingRulesTable).set(updateSet as any).where(eq(routingRulesTable.id, id)).returning();

    req.log.info({ id, ...updateSet }, "Routing rule updated");
    res.json({ ...updated!, createdAt: updated!.createdAt.toISOString(), updatedAt: updated!.updatedAt.toISOString() });
  } catch (err) { next(err); }
});

/** DELETE /api/smart-routing/rules/:id */
router.delete("/rules/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params["id"] as string);
    const [existing] = await db.select().from(routingRulesTable).where(eq(routingRulesTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Rule not found" }); return; }
    await db.delete(routingRulesTable).where(eq(routingRulesTable.id, id));
    req.log.info({ id, providerKey: existing.providerKey }, "Routing rule deleted");
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// ── Metrics ───────────────────────────────────────────────────────────────────

/** GET /api/smart-routing/metrics?window=24h */
router.get("/metrics", async (req, res, next) => {
  try {
    const timeWindow = (req.query["window"] as string) ?? "24h";
    const rows = await db.select().from(providerMetricsTable)
      .where(eq(providerMetricsTable.timeWindow, timeWindow))
      .orderBy(desc(providerMetricsTable.successRate));
    res.json(rows.map(r => ({
      ...r,
      successRate: r.successRate != null ? Number(r.successRate) : null,
      lastComputedAt: r.lastComputedAt.toISOString(),
    })));
  } catch (err) { next(err); }
});

// ── Routing Logs ──────────────────────────────────────────────────────────────

/** GET /api/smart-routing/logs?page=1&limit=50&providerKey=cashfree_payin&result=failed */
router.get("/logs", async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt((req.query["page"] as string) ?? "1"));
    const limit = Math.min(100, parseInt((req.query["limit"] as string) ?? "50"));
    const offset = (page - 1) * limit;

    const rows = await db.select().from(routingLogsTable)
      .orderBy(desc(routingLogsTable.createdAt))
      .limit(limit).offset(offset);

    const total = await db.$count(routingLogsTable);

    res.json({
      total,
      page,
      limit,
      logs: rows.map(r => ({
        ...r,
        amount: r.amount != null ? Number(r.amount) : null,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch (err) { next(err); }
});

// ── Status ────────────────────────────────────────────────────────────────────

/** GET /api/smart-routing/status — quick health summary */
router.get("/status", async (req, res, next) => {
  try {
    const [config] = await db.select().from(routingConfigsTable)
      .where(eq(routingConfigsTable.isEnabled, true))
      .orderBy(asc(routingConfigsTable.id)).limit(1);

    if (!config) {
      res.json({ configured: false, configName: null, strategy: null, providerCount: 0, fallbackEnabled: false });
      return;
    }

    const rules = await db.select().from(routingRulesTable)
      .where(and(eq(routingRulesTable.configId, config.id), eq(routingRulesTable.isEnabled, true)));

    const metrics = await db.select().from(providerMetricsTable)
      .where(eq(providerMetricsTable.timeWindow, "24h"));

    const recentLogs = await db.select().from(routingLogsTable)
      .orderBy(desc(routingLogsTable.createdAt)).limit(100);

    const successCount24h = recentLogs.filter(l => l.result === "success").length;
    const failedCount24h = recentLogs.filter(l => l.result === "failed" || l.result === "timeout").length;

    res.json({
      configured: true,
      configName: config.configName,
      strategy: config.strategy,
      isEnabled: config.isEnabled,
      fallbackEnabled: config.fallbackEnabled,
      timeoutMs: config.timeoutMs,
      providerCount: rules.length,
      providers: rules.map(r => ({
        providerKey: r.providerKey,
        priority: r.priority,
        weightPercent: r.weightPercent,
        isEnabled: r.isEnabled,
      })),
      metrics24h: metrics.map(m => ({
        providerKey: m.providerKey,
        successRate: Number(m.successRate ?? 0),
        totalAttempts: m.totalAttempts,
        avgResponseMs: m.avgResponseMs,
      })),
      recentActivity: { successCount24h, failedCount24h },
    });
  } catch (err) { next(err); }
});

export default router;
