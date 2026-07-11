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
  notificationsTable,
} from "@workspace/db";
import { eq, and, desc, asc, ne, gte, sql } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { simulateRouting } from "../helpers/smartRouter";

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
    const { providerKey, priority, weightPercent, minAmount, maxAmount, allowedPaymentModes, isEnabled, isFallbackOnly, maxRetries, notes } = req.body as {
      providerKey?: string; priority?: number; weightPercent?: number;
      minAmount?: number; maxAmount?: number; allowedPaymentModes?: string[];
      isEnabled?: boolean; isFallbackOnly?: boolean; maxRetries?: number; notes?: string;
    };

    if (!providerKey?.trim()) { res.status(400).json({ error: "providerKey is required" }); return; }

    const [existing] = await db.select().from(routingConfigsTable).where(eq(routingConfigsTable.id, configId)).limit(1);
    if (!existing) { res.status(404).json({ error: "Config not found" }); return; }

    const effectivePriority = priority ?? 1;
    const [conflicting] = await db.select({ id: routingRulesTable.id, providerKey: routingRulesTable.providerKey })
      .from(routingRulesTable)
      .where(and(
        eq(routingRulesTable.configId, configId),
        eq(routingRulesTable.priority, effectivePriority),
        eq(routingRulesTable.isEnabled, true),
      )).limit(1);
    if (conflicting) {
      res.status(409).json({
        error: `Priority ${effectivePriority} is already used by rule for "${conflicting.providerKey}". Equal-priority rules tie-break to the oldest rule (lowest ID), so your new rule would be silently ignored. Use a different priority number.`,
      });
      return;
    }

    const effectiveEnabled = isEnabled ?? true;
    const effectiveFallbackOnly = isFallbackOnly ?? false;
    if (effectiveEnabled && effectiveFallbackOnly) {
      const otherEnabledRules = await db.select({ isFallbackOnly: routingRulesTable.isFallbackOnly })
        .from(routingRulesTable)
        .where(and(eq(routingRulesTable.configId, configId), eq(routingRulesTable.isEnabled, true)));
      const wouldBeAllFallbackOnly = otherEnabledRules.every(r => r.isFallbackOnly);
      if (wouldBeAllFallbackOnly) {
        res.status(422).json({
          error: "This would leave zero primary (non-fallback) rules enabled in this config — every payment order would fail immediately. Add or enable a primary rule first, then set this one to fallback-only.",
        });
        return;
      }
    }

    const [row] = await db.insert(routingRulesTable).values({
      configId,
      providerKey: providerKey.trim(),
      priority: priority ?? 1,
      weightPercent: weightPercent ?? 100,
      minAmount: minAmount != null ? String(minAmount) : null,
      maxAmount: maxAmount != null ? String(maxAmount) : null,
      allowedPaymentModes: allowedPaymentModes ? JSON.stringify(allowedPaymentModes) : null,
      isEnabled: isEnabled ?? true,
      isFallbackOnly: isFallbackOnly ?? false,
      maxRetries: maxRetries != null ? Math.max(1, Math.min(5, maxRetries)) : 1,
      notes: notes?.trim() ?? null,
    }).returning();

    req.log.info({ configId, providerKey, priority, isFallbackOnly, maxRetries }, "Routing rule created");

    res.json({
      ...row!,
      createdAt: row!.createdAt.toISOString(),
      updatedAt: row!.updatedAt.toISOString(),
    });
  } catch (err) {
    const pgErr = (err as any)?.code ? (err as any) : (err as any)?.cause;
    const isRoutingPriorityConflict = pgErr?.code === "23505" &&
      (!pgErr?.constraint || pgErr?.constraint === "routing_rules_enabled_priority_uniq");
    if (isRoutingPriorityConflict) {
      try {
        const p: number = (req.body as any).priority ?? 1;
        const cid = parseInt(req.params["id"] as string);
        const [conflict] = await db.select({ providerKey: routingRulesTable.providerKey })
          .from(routingRulesTable)
          .where(and(eq(routingRulesTable.configId, cid), eq(routingRulesTable.priority, p), eq(routingRulesTable.isEnabled, true)))
          .limit(1);
        res.status(409).json({
          error: conflict
            ? `Priority ${p} is already used by rule for "${conflict.providerKey}". Equal-priority rules tie-break to the oldest rule (lowest ID), so your new rule would be silently ignored. Use a different priority number.`
            : `Priority ${p} is already used by an enabled rule in this config. Use a different priority number.`,
        });
      } catch {
        res.status(409).json({ error: "A priority conflict was detected. Use a different priority number." });
      }
      return;
    }
    next(err);
  }
});

/** PUT /api/smart-routing/rules/:id */
router.put("/rules/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params["id"] as string);
    const { providerKey, priority, weightPercent, minAmount, maxAmount, allowedPaymentModes, isEnabled, isFallbackOnly, maxRetries, notes } = req.body as {
      providerKey?: string; priority?: number; weightPercent?: number;
      minAmount?: number | null; maxAmount?: number | null; allowedPaymentModes?: string[];
      isEnabled?: boolean; isFallbackOnly?: boolean; maxRetries?: number; notes?: string;
    };

    const [existing] = await db.select().from(routingRulesTable).where(eq(routingRulesTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Rule not found" }); return; }

    if (priority !== undefined && priority !== existing.priority) {
      const newEnabled = isEnabled !== undefined ? isEnabled : existing.isEnabled;
      if (newEnabled) {
        const [conflicting] = await db.select({ id: routingRulesTable.id, providerKey: routingRulesTable.providerKey })
          .from(routingRulesTable)
          .where(and(
            eq(routingRulesTable.configId, existing.configId),
            eq(routingRulesTable.priority, priority),
            eq(routingRulesTable.isEnabled, true),
            ne(routingRulesTable.id, id),
          )).limit(1);
        if (conflicting) {
          res.status(409).json({
            error: `Priority ${priority} is already used by rule for "${conflicting.providerKey}". Equal-priority rules tie-break to the oldest rule (lowest ID), so this rule would be silently ignored. Use a different priority number.`,
          });
          return;
        }
      }
    } else if (isEnabled === true && existing.isEnabled === false) {
      // Re-enabling a disabled rule without changing priority: the effective priority
      // stays existing.priority, so it can still collide with another already-enabled rule.
      const effectivePriority = priority !== undefined ? priority : existing.priority;
      const [conflicting] = await db.select({ id: routingRulesTable.id, providerKey: routingRulesTable.providerKey })
        .from(routingRulesTable)
        .where(and(
          eq(routingRulesTable.configId, existing.configId),
          eq(routingRulesTable.priority, effectivePriority),
          eq(routingRulesTable.isEnabled, true),
          ne(routingRulesTable.id, id),
        )).limit(1);
      if (conflicting) {
        res.status(409).json({
          error: `Priority ${effectivePriority} is already used by rule for "${conflicting.providerKey}". Equal-priority rules tie-break to the oldest rule (lowest ID), so this rule would be silently ignored. Use a different priority number.`,
        });
        return;
      }
    }

    const effectiveEnabled = isEnabled !== undefined ? isEnabled : existing.isEnabled;
    const effectiveFallbackOnly = isFallbackOnly !== undefined ? isFallbackOnly : existing.isFallbackOnly;
    if (effectiveEnabled && effectiveFallbackOnly) {
      const otherEnabledRules = await db.select({ isFallbackOnly: routingRulesTable.isFallbackOnly })
        .from(routingRulesTable)
        .where(and(
          eq(routingRulesTable.configId, existing.configId),
          eq(routingRulesTable.isEnabled, true),
          ne(routingRulesTable.id, id),
        ));
      const wouldBeAllFallbackOnly = otherEnabledRules.every(r => r.isFallbackOnly);
      if (wouldBeAllFallbackOnly) {
        res.status(422).json({
          error: "This would leave zero primary (non-fallback) rules enabled in this config — every payment order would fail immediately. Add or enable a primary rule first, then set this one to fallback-only.",
        });
        return;
      }
    }

    const updateSet: Record<string, unknown> = {};
    if (providerKey !== undefined) updateSet.providerKey = providerKey;
    if (priority !== undefined) updateSet.priority = priority;
    if (weightPercent !== undefined) updateSet.weightPercent = weightPercent;
    if (minAmount !== undefined) updateSet.minAmount = minAmount != null ? String(minAmount) : null;
    if (maxAmount !== undefined) updateSet.maxAmount = maxAmount != null ? String(maxAmount) : null;
    if (allowedPaymentModes !== undefined) updateSet.allowedPaymentModes = JSON.stringify(allowedPaymentModes);
    if (isEnabled !== undefined) updateSet.isEnabled = isEnabled;
    if (isFallbackOnly !== undefined) updateSet.isFallbackOnly = isFallbackOnly;
    if (maxRetries !== undefined) updateSet.maxRetries = Math.max(1, Math.min(5, maxRetries));
    if (notes !== undefined) updateSet.notes = notes;

    const [updated] = await db.update(routingRulesTable).set(updateSet as any).where(eq(routingRulesTable.id, id)).returning();

    req.log.info({ id, ...updateSet }, "Routing rule updated");

    res.json({
      ...updated!,
      createdAt: updated!.createdAt.toISOString(),
      updatedAt: updated!.updatedAt.toISOString(),
    });
  } catch (err) {
    const pgErr = (err as any)?.code ? (err as any) : (err as any)?.cause;
    const isRoutingPriorityConflict = pgErr?.code === "23505" &&
      (!pgErr?.constraint || pgErr?.constraint === "routing_rules_enabled_priority_uniq");
    if (isRoutingPriorityConflict) {
      try {
        const ruleId = parseInt(req.params["id"] as string);
        const [rule] = await db.select({ configId: routingRulesTable.configId, priority: routingRulesTable.priority })
          .from(routingRulesTable).where(eq(routingRulesTable.id, ruleId)).limit(1);
        const effectivePriority: number = (req.body as any).priority ?? rule?.priority;
        let conflict: { providerKey: string } | undefined;
        if (rule) {
          const [c] = await db.select({ providerKey: routingRulesTable.providerKey })
            .from(routingRulesTable)
            .where(and(
              eq(routingRulesTable.configId, rule.configId),
              eq(routingRulesTable.priority, effectivePriority),
              eq(routingRulesTable.isEnabled, true),
              ne(routingRulesTable.id, ruleId),
            )).limit(1);
          conflict = c;
        }
        res.status(409).json({
          error: conflict
            ? `Priority ${effectivePriority} is already used by rule for "${conflict.providerKey}". Equal-priority rules tie-break to the oldest rule (lowest ID), so this rule would be silently ignored. Use a different priority number.`
            : `Priority ${effectivePriority} is already used by another enabled rule in this config. Use a different priority number.`,
        });
      } catch {
        res.status(409).json({ error: "A priority conflict was detected. Use a different priority number." });
      }
      return;
    }
    next(err);
  }
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

// ── Simulate (dry-run) ────────────────────────────────────────────────────────

/**
 * GET /api/smart-routing/simulate?amount=1000&paymentMode=upi
 *
 * Dry-runs the routing engine for the given amount + payment mode.
 * Returns the ordered list of providers that would be attempted — no logs
 * written, no external calls made.
 */
router.get("/simulate", async (req, res, next) => {
  try {
    const amount = parseFloat((req.query["amount"] as string) ?? "0");
    if (!isFinite(amount) || amount <= 0) {
      res.status(400).json({ error: "amount must be a positive number" });
      return;
    }
    const paymentMode = (req.query["paymentMode"] as string | undefined) || undefined;
    const configName = (req.query["configName"] as string | undefined) || undefined;

    const result = await simulateRouting({ amount, paymentMode, configName });
    if (!result) {
      res.status(404).json({ error: "No enabled routing config found" });
      return;
    }

    req.log.info({ amount, paymentMode, configName: result.configName, steps: result.steps.length }, "Smart routing simulated (dry-run)");
    res.json(result);
  } catch (err) { next(err); }
});

// ── Failover Events & Failure Trends ─────────────────────────────────────────

/**
 * GET /api/smart-routing/failover-events?limit=20
 *
 * Chain-exhaustion events: each admin gets a copy of the `gateway_failover_exhausted`
 * notification, so events are deduplicated by (createdAt, failureCount, triggerMerchantId)
 * before returning — one row per real outage alert, not one per admin recipient.
 * Also includes, per event, the distinct provider keys attempted in the hour window
 * leading up to the event (from routing_logs) so admins can see which providers were
 * involved in the exhausted chain.
 */
router.get("/failover-events", async (req, res, next) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt((req.query["limit"] as string) ?? "20")));

    const rows = await db.select({
      id: notificationsTable.id,
      title: notificationsTable.title,
      body: notificationsTable.body,
      metadata: notificationsTable.metadata,
      createdAt: notificationsTable.createdAt,
    })
      .from(notificationsTable)
      .where(eq(notificationsTable.type, "gateway_failover_exhausted"))
      .orderBy(desc(notificationsTable.createdAt));

    const seen = new Set<string>();
    const events: { id: number; createdAt: string; failureCount: number; windowMinutes: number; triggerMerchantId: number | null; providersInvolved: string[] }[] = [];

    for (const r of rows) {
      const meta = (r.metadata ?? {}) as { failureCount?: number; windowMinutes?: number; triggerMerchantId?: number };
      const dedupKey = `${r.createdAt.toISOString()}|${meta.failureCount ?? 0}|${meta.triggerMerchantId ?? ""}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);

      const windowMinutes = meta.windowMinutes ?? 60;
      const windowStart = new Date(r.createdAt.getTime() - windowMinutes * 60 * 1000);
      const providerRows = await db.selectDistinct({ providerKey: routingLogsTable.providerKey })
        .from(routingLogsTable)
        .where(and(
          gte(routingLogsTable.createdAt, windowStart),
          sql`${routingLogsTable.createdAt} <= ${r.createdAt}`,
          eq(routingLogsTable.result, "failed"),
        ));

      events.push({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        failureCount: meta.failureCount ?? 0,
        windowMinutes,
        triggerMerchantId: meta.triggerMerchantId ?? null,
        providersInvolved: providerRows.map(p => p.providerKey),
      });

      if (events.length >= limit) break;
    }

    res.json({ events });
  } catch (err) { next(err); }
});

/**
 * GET /api/smart-routing/failure-trend?days=7
 *
 * Rolling per-day, per-provider failure-rate trend computed directly from
 * routing_logs (not the aggregate providerMetricsTable, which only tracks
 * rolling windows like 24h/7d without a daily breakdown).
 */
router.get("/failure-trend", async (req, res, next) => {
  try {
    const days = Math.min(30, Math.max(1, parseInt((req.query["days"] as string) ?? "7")));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const rows = await db.select({
      day: sql<string>`to_char(${routingLogsTable.createdAt}, 'YYYY-MM-DD')`,
      providerKey: routingLogsTable.providerKey,
      total: sql<number>`COUNT(*)::int`,
      failed: sql<number>`COUNT(*) FILTER (WHERE ${routingLogsTable.result} IN ('failed', 'timeout'))::int`,
    })
      .from(routingLogsTable)
      .where(gte(routingLogsTable.createdAt, since))
      .groupBy(sql`to_char(${routingLogsTable.createdAt}, 'YYYY-MM-DD')`, routingLogsTable.providerKey)
      .orderBy(sql`to_char(${routingLogsTable.createdAt}, 'YYYY-MM-DD')`);

    res.json({
      days,
      trend: rows.map(r => ({
        day: r.day,
        providerKey: r.providerKey,
        totalAttempts: r.total,
        failedAttempts: r.failed,
        failureRate: r.total > 0 ? Number(((r.failed / r.total) * 100).toFixed(2)) : 0,
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
