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
  systemConfigTable,
  SYSTEM_CONFIG_KEYS,
  SYSTEM_CONFIG_DEFAULTS,
} from "@workspace/db";
import { eq, and, desc, asc, ne, gte, sql, inArray } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { simulateRouting } from "../helpers/smartRouter";

const router = Router();
router.use(requireAuth, requireAdmin);

/**
 * Returns the lowest unused enabled-rule priority > conflictingPriority for the given config.
 * Pass excludeId to ignore a specific rule (used during PUT to exclude the rule being edited).
 */
async function getNextFreePriority(configId: number, conflictingPriority: number, excludeId?: number): Promise<number> {
  const conditions = excludeId !== undefined
    ? and(eq(routingRulesTable.configId, configId), eq(routingRulesTable.isEnabled, true), ne(routingRulesTable.id, excludeId))
    : and(eq(routingRulesTable.configId, configId), eq(routingRulesTable.isEnabled, true));
  // limit(1000) keeps us compatible with the test mocks that only make .where().limit() awaitable,
  // and is a safe ceiling — no real config will have 1000 enabled rules.
  const rows = await db.select({ priority: routingRulesTable.priority }).from(routingRulesTable).where(conditions).limit(1000);
  const used = new Set(rows.map(r => r.priority));
  let candidate = conflictingPriority + 1;
  while (used.has(candidate)) candidate++;
  return candidate;
}

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
      const suggestedPriority = await getNextFreePriority(configId, effectivePriority);
      res.status(409).json({
        error: `Priority ${effectivePriority} is already used by rule for "${conflicting.providerKey}". Equal-priority rules tie-break to the oldest rule (lowest ID), so your new rule would be silently ignored. Use a different priority number.`,
        suggestedPriority,
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
        const suggestedPriority = await getNextFreePriority(cid, p);
        res.status(409).json({
          error: conflict
            ? `Priority ${p} is already used by rule for "${conflict.providerKey}". Equal-priority rules tie-break to the oldest rule (lowest ID), so your new rule would be silently ignored. Use a different priority number.`
            : `Priority ${p} is already used by an enabled rule in this config. Use a different priority number.`,
          suggestedPriority,
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
          const suggestedPriority = await getNextFreePriority(existing.configId, priority, id);
          res.status(409).json({
            error: `Priority ${priority} is already used by rule for "${conflicting.providerKey}". Equal-priority rules tie-break to the oldest rule (lowest ID), so this rule would be silently ignored. Use a different priority number.`,
            suggestedPriority,
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
        const suggestedPriority = await getNextFreePriority(existing.configId, effectivePriority, id);
        res.status(409).json({
          error: `Priority ${effectivePriority} is already used by rule for "${conflicting.providerKey}". Equal-priority rules tie-break to the oldest rule (lowest ID), so this rule would be silently ignored. Use a different priority number.`,
          suggestedPriority,
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
        const suggestedPriority = rule ? await getNextFreePriority(rule.configId, effectivePriority, ruleId) : undefined;
        res.status(409).json({
          error: conflict
            ? `Priority ${effectivePriority} is already used by rule for "${conflict.providerKey}". Equal-priority rules tie-break to the oldest rule (lowest ID), so this rule would be silently ignored. Use a different priority number.`
            : `Priority ${effectivePriority} is already used by another enabled rule in this config. Use a different priority number.`,
          ...(suggestedPriority !== undefined ? { suggestedPriority } : {}),
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

// ── Coverage Check ────────────────────────────────────────────────────────────

/**
 * GET /api/smart-routing/configs/:id/coverage-check?excludeRuleId=<id>
 *
 * Checks whether the current enabled rules for this config leave any common
 * amount ranges or payment modes uncovered (i.e. no primary, non-fallback-only
 * rule would handle the payment).  Pass excludeRuleId to simulate what
 * coverage looks like *after* a specific rule is deleted — used by the
 * delete-confirm dialog to warn before the deletion takes place.
 *
 * Tests a smart set of amount checkpoints derived from the rules' own min/max
 * values plus a set of standard amounts, across every payment mode that
 * appears in any rule plus the six standard modes.
 */
router.get("/configs/:id/coverage-check", async (req, res, next) => {
  try {
    const configId = parseInt(req.params["id"] as string);
    const excludeRuleId = req.query["excludeRuleId"] ? parseInt(req.query["excludeRuleId"] as string) : null;

    const [config] = await db.select().from(routingConfigsTable)
      .where(eq(routingConfigsTable.id, configId)).limit(1);
    if (!config) { res.status(404).json({ error: "Config not found" }); return; }

    const allRules = await db.select().from(routingRulesTable)
      .where(and(
        eq(routingRulesTable.configId, configId),
        eq(routingRulesTable.isEnabled, true),
      ));

    const rules = excludeRuleId != null
      ? allRules.filter(r => r.id !== excludeRuleId)
      : allRules;

    const STANDARD_AMOUNTS = [1, 100, 500, 1000, 5000, 10000, 50000, 100000];
    const STANDARD_MODES = ["upi", "card", "netbanking", "wallet", "bnpl", "emi"];

    // Build a smart set of amount checkpoints from rule boundaries + standards
    const amountSet = new Set<number>(STANDARD_AMOUNTS);
    for (const r of rules) {
      if (r.minAmount != null) {
        const min = Number(r.minAmount);
        if (min > 1) amountSet.add(min - 1);
        amountSet.add(min);
        amountSet.add(min + 1);
      }
      if (r.maxAmount != null) {
        const max = Number(r.maxAmount);
        if (max > 1) amountSet.add(max - 1);
        amountSet.add(max);
        amountSet.add(max + 1);
      }
    }
    const testAmounts = Array.from(amountSet).filter(a => a > 0).sort((a, b) => a - b);

    // Collect every specific mode referenced in any rule; null means "no mode filter" (any)
    const modeSet = new Set<string | null>([null, ...STANDARD_MODES]);
    for (const r of rules) {
      if (r.allowedPaymentModes) {
        try {
          const modes = JSON.parse(r.allowedPaymentModes) as string[];
          if (modes.length > 0 && !modes.includes("all")) {
            for (const m of modes) modeSet.add(m);
          }
        } catch { /* ignore */ }
      }
    }
    const testModes = Array.from(modeSet);

    // Check whether a specific (amount, mode) is covered by at least one primary rule
    function isCoveredByPrimary(amount: number, mode: string | null): boolean {
      return rules.some(r => {
        if (r.isFallbackOnly) return false;
        if (r.minAmount != null && amount < Number(r.minAmount)) return false;
        if (r.maxAmount != null && amount > Number(r.maxAmount)) return false;
        if (mode != null && r.allowedPaymentModes) {
          try {
            const modes = JSON.parse(r.allowedPaymentModes) as string[];
            if (modes.length > 0 && !modes.includes("all") && !modes.includes(mode)) return false;
          } catch { /* ignore */ }
        }
        return true;
      });
    }

    // For each mode, collect uncovered amounts and build a gap description
    type Gap = {
      paymentMode: string | null;
      uncoveredAmounts: number[];
      minUncovered: number;
      maxUncovered: number;
      description: string;
    };

    const gaps: Gap[] = [];

    for (const mode of testModes) {
      const uncovered = testAmounts.filter(a => !isCoveredByPrimary(a, mode));
      if (uncovered.length === 0) continue;

      const min = uncovered[0];
      const max = uncovered[uncovered.length - 1];
      const modeLabel = mode == null ? "any payment mode" : `${mode} payments`;
      let description: string;
      if (uncovered.length === testAmounts.length) {
        description = `No primary rule covers any tested amount for ${modeLabel}`;
      } else if (min === testAmounts[0] && max === testAmounts[testAmounts.length - 1]) {
        description = `No primary rule covers tested amounts for ${modeLabel}`;
      } else if (min === testAmounts[0]) {
        description = `Amounts up to ₹${max.toLocaleString("en-IN")} are not covered for ${modeLabel}`;
      } else if (max === testAmounts[testAmounts.length - 1]) {
        description = `Amounts from ₹${min.toLocaleString("en-IN")} and above are not covered for ${modeLabel}`;
      } else {
        description = `Amounts ₹${min.toLocaleString("en-IN")}–₹${max.toLocaleString("en-IN")} are not covered for ${modeLabel}`;
      }

      gaps.push({ paymentMode: mode, uncoveredAmounts: uncovered, minUncovered: min, maxUncovered: max, description });
    }

    // De-duplicate: if "null" (any mode) has exactly the same uncovered set as a specific mode,
    // the specific mode is redundant — keep only the broadest/most useful gaps.
    // Simplification: if a gap exists for "null mode", it means ALL payments at those amounts fail.
    // Any overlapping mode-specific gap is already implied. Remove gaps whose uncoveredAmounts are
    // a subset of the null-mode gap's uncoveredAmounts.
    const nullGap = gaps.find(g => g.paymentMode === null);
    const filteredGaps = nullGap
      ? gaps.filter(g => {
          if (g.paymentMode === null) return true;
          // Keep mode-specific gap only if it has amounts NOT already flagged by null gap
          const nullUncoveredSet = new Set(nullGap.uncoveredAmounts);
          return g.uncoveredAmounts.some(a => !nullUncoveredSet.has(a));
        })
      : gaps;

    res.json({
      configName: config.configName,
      hasGaps: filteredGaps.length > 0,
      gaps: filteredGaps.map(g => ({
        paymentMode: g.paymentMode,
        uncoveredAmounts: g.uncoveredAmounts,
        minUncovered: g.minUncovered,
        maxUncovered: g.maxUncovered,
        description: g.description,
      })),
      testedAmountCount: testAmounts.length,
      testedModeCount: testModes.length,
      excludedRuleId: excludeRuleId,
    });
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
 * leading up to the event, and a resolved/ongoing status with duration derived from
 * the matching `gateway_recovered` admin notification (matched by outageStartedAt).
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

    // Load all admin-facing gateway_recovered notifications so we can correlate
    // each exhaustion event with its recovery (matched by metadata.outageStartedAt).
    const recoveryRows = await db.select({
      metadata: notificationsTable.metadata,
      createdAt: notificationsTable.createdAt,
    })
      .from(notificationsTable)
      .where(eq(notificationsTable.type, "gateway_recovered"))
      .orderBy(desc(notificationsTable.createdAt));

    // Build a map from outageStartedAt (ISO string) → recovery info.
    // Both the gateway_failover_exhausted notification (metadata.outageStartedAt,
    // read from PAYIN_CHAIN_EXHAUSTED_SINCE at alert time) and the
    // gateway_recovered notification (metadata.outageStartedAt, read from the
    // same system_config row at recovery time) use the identical ISO string —
    // so this is an exact-key match with no timestamp tolerance needed.
    type RecoveryInfo = { recoveredAt: string; durationSeconds: number };
    const recoveryMap = new Map<string, RecoveryInfo>();
    for (const rec of recoveryRows) {
      const m = (rec.metadata ?? {}) as { outageStartedAt?: string; recoveredAt?: string; durationSeconds?: number };
      if (m.outageStartedAt && m.recoveredAt && m.durationSeconds != null && !recoveryMap.has(m.outageStartedAt)) {
        recoveryMap.set(m.outageStartedAt, {
          recoveredAt: m.recoveredAt,
          durationSeconds: m.durationSeconds,
        });
      }
    }

    // Safety-net threshold: exhaustion events older than this with no matching
    // recovery notification are marked "resolved" with an explanatory note rather
    // than staying "Ongoing" forever. This covers the rare case where the boot
    // cleanup ran but the notification write failed, or the outage predates the
    // boot-cleanup feature. Two hours is generous — normal recovery happens in
    // seconds to minutes; a genuinely ongoing outage past 2h would be investigated
    // through other channels long before the Failover Events tab.
    const STALE_ONGOING_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours
    const now = Date.now();

    const seen = new Set<string>();
    const events: {
      id: number;
      createdAt: string;
      failureCount: number;
      windowMinutes: number;
      triggerMerchantId: number | null;
      providersInvolved: string[];
      status: "resolved" | "ongoing";
      resolvedAt: string | null;
      durationSeconds: number | null;
      note: string | null;
    }[] = [];

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

      // Correlate with a recovery event using the exact outageStartedAt key
      // stored in both the exhaustion notification metadata (written at alert
      // time from PAYIN_CHAIN_EXHAUSTED_SINCE) and the recovery notification
      // metadata (written at recovery time from the same system_config row).
      // The two values are the identical ISO string, so no tolerance is needed.
      const exhaustionMeta = (r.metadata ?? {}) as { outageStartedAt?: string };
      const recovery = exhaustionMeta.outageStartedAt
        ? (recoveryMap.get(exhaustionMeta.outageStartedAt) ?? null)
        : null;

      // Safety-net: if the event is older than the stale-ongoing threshold and
      // still has no matching recovery notification, treat it as resolved with
      // an explanatory note. This covers events that pre-date the boot-cleanup
      // feature, or the rare case where the boot cleanup succeeded in clearing
      // the system-config row but the notification write failed.
      const isStale = !recovery && (now - r.createdAt.getTime()) > STALE_ONGOING_THRESHOLD_MS;
      const effectiveStatus: "resolved" | "ongoing" = (recovery || isStale) ? "resolved" : "ongoing";
      const note = isStale
        ? "Auto-closed — no recovery signal was recorded. The server may have restarted during this outage."
        : null;

      events.push({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        failureCount: meta.failureCount ?? 0,
        windowMinutes,
        triggerMerchantId: meta.triggerMerchantId ?? null,
        providersInvolved: providerRows.map(p => p.providerKey),
        status: effectiveStatus,
        resolvedAt: recovery?.recoveredAt ?? null,
        durationSeconds: recovery?.durationSeconds ?? null,
        note,
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

// ── Alert Settings ────────────────────────────────────────────────────────────

/**
 * GET /api/smart-routing/alert-settings
 * Returns the current failover-alert threshold and window (with defaults).
 */
router.get("/alert-settings", async (req, res, next) => {
  try {
    const keys = [
      SYSTEM_CONFIG_KEYS.FAILOVER_ALERT_THRESHOLD,
      SYSTEM_CONFIG_KEYS.FAILOVER_ALERT_WINDOW_MINUTES,
    ];
    const rows = await db.select().from(systemConfigTable).where(inArray(systemConfigTable.key, keys));
    const map = new Map(rows.map(r => [r.key, r.value]));

    const rawThreshold = parseInt(
      map.get(SYSTEM_CONFIG_KEYS.FAILOVER_ALERT_THRESHOLD) ??
      SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.FAILOVER_ALERT_THRESHOLD]
    );
    const rawWindowMinutes = parseInt(
      map.get(SYSTEM_CONFIG_KEYS.FAILOVER_ALERT_WINDOW_MINUTES) ??
      SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.FAILOVER_ALERT_WINDOW_MINUTES]
    );
    const threshold = (Number.isFinite(rawThreshold) && rawThreshold >= 1) ? rawThreshold : 5;
    const windowMinutes = (Number.isFinite(rawWindowMinutes) && rawWindowMinutes >= 1) ? rawWindowMinutes : 60;

    res.json({ threshold, windowMinutes });
  } catch (err) { next(err); }
});

/**
 * PUT /api/smart-routing/alert-settings
 * Updates failover-alert threshold and/or window (admin-only).
 */
router.put("/alert-settings", async (req, res, next) => {
  try {
    const user = (req as any).user;
    const { threshold, windowMinutes } = req.body as { threshold?: number; windowMinutes?: number };

    if (threshold !== undefined) {
      const t = Number(threshold);
      if (!Number.isInteger(t) || t < 1 || t > 10000) {
        res.status(400).json({ error: "threshold must be a positive integer (1 – 10000)" });
        return;
      }
    }
    if (windowMinutes !== undefined) {
      const w = Number(windowMinutes);
      if (!Number.isInteger(w) || w < 1 || w > 1440) {
        res.status(400).json({ error: "windowMinutes must be a positive integer (1 – 1440)" });
        return;
      }
    }

    const upserts: { key: string; value: string; updatedByEmail: string }[] = [];
    if (threshold !== undefined) {
      upserts.push({ key: SYSTEM_CONFIG_KEYS.FAILOVER_ALERT_THRESHOLD, value: String(threshold), updatedByEmail: user.email });
    }
    if (windowMinutes !== undefined) {
      upserts.push({ key: SYSTEM_CONFIG_KEYS.FAILOVER_ALERT_WINDOW_MINUTES, value: String(windowMinutes), updatedByEmail: user.email });
    }

    if (upserts.length === 0) {
      res.status(400).json({ error: "At least one of threshold or windowMinutes must be provided" });
      return;
    }

    for (const upsert of upserts) {
      await db
        .insert(systemConfigTable)
        .values(upsert)
        .onConflictDoUpdate({
          target: systemConfigTable.key,
          set: { value: upsert.value, updatedByEmail: upsert.updatedByEmail },
        });
    }

    await db.insert(auditLogsTable).values({
      adminId: user.id,
      adminEmail: user.email,
      action: "failover_alert_settings_updated",
      targetType: "system_config",
      targetId: 0,
      details: JSON.stringify({ threshold, windowMinutes }),
      ipAddress: (req as any).ip ?? null,
    });

    req.log.info({ threshold, windowMinutes }, "failover_alert_settings_updated");

    // Return the now-current values
    const keys = [
      SYSTEM_CONFIG_KEYS.FAILOVER_ALERT_THRESHOLD,
      SYSTEM_CONFIG_KEYS.FAILOVER_ALERT_WINDOW_MINUTES,
    ];
    const rows = await db.select().from(systemConfigTable).where(inArray(systemConfigTable.key, keys));
    const map = new Map(rows.map(r => [r.key, r.value]));
    res.json({
      threshold: parseInt(map.get(SYSTEM_CONFIG_KEYS.FAILOVER_ALERT_THRESHOLD) ?? SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.FAILOVER_ALERT_THRESHOLD]),
      windowMinutes: parseInt(map.get(SYSTEM_CONFIG_KEYS.FAILOVER_ALERT_WINDOW_MINUTES) ?? SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.FAILOVER_ALERT_WINDOW_MINUTES]),
    });
  } catch (err) { next(err); }
});

export default router;
