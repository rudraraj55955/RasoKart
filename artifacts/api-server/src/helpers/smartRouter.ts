/**
 * RasoKart Smart Routing Engine
 *
 * Selects the best payment provider based on the configured strategy,
 * logs every routing decision, and updates provider metrics.
 *
 * IMPORTANT: This module is backend-only.
 * Provider names, keys, and internal IDs are NEVER returned to merchants or customers.
 * Only public RasoKart reference IDs are surfaced externally.
 *
 * Strategies:
 *   priority      — try providers in ascending priority order; fallback on failure
 *   percentage    — weighted-random selection by weight_percent; fallback on failure
 *   success_rate  — sort by recent success_rate DESC; fallback on failure
 *   round_robin   — rotate evenly across enabled providers; fallback on failure
 */

import {
  db,
  routingConfigsTable,
  routingRulesTable,
  routingLogsTable,
  providerMetricsTable,
  systemConfigTable,
  SYSTEM_CONFIG_KEYS,
} from "@workspace/db";
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import type { Logger } from "pino";

// ── Types ────────────────────────────────────────────────────────────────────

export interface RoutingContext {
  merchantId: number;
  amount: number;
  paymentMode?: string;
  configName?: string;
  logger?: Logger;
}

export interface RoutingDecision {
  providerKey: string;
  routingLogId: number;
  configId: number;
  configName: string;
  strategy: string;
  priority: number;
  attemptNumber: number;
}

export interface RoutingResult {
  success: boolean;
  providerKey: string;
  providerSessionId?: string;
  providerOrderId?: string;
  publicOrderId?: string;
  errorMessage?: string;
}

// ── Routing state (round-robin counters per configName) ────────────────────
const rrCounters: Record<string, number> = {};

// ── Main API ─────────────────────────────────────────────────────────────────

/**
 * Select the next provider based on routing config + strategy.
 * Returns null if no eligible providers are found.
 * Does NOT make the actual API call — caller is responsible for that.
 */
export async function selectProvider(
  ctx: RoutingContext,
  exclude: string[] = [],
  attemptNumber = 1,
): Promise<RoutingDecision | null> {
  const configName = ctx.configName ?? "default";

  // Load config
  const [config] = await db.select().from(routingConfigsTable)
    .where(and(
      eq(routingConfigsTable.configName, configName),
      eq(routingConfigsTable.isEnabled, true),
    )).limit(1);

  if (!config) {
    ctx.logger?.warn({ configName }, "Smart routing: no enabled config found");
    return null;
  }

  // Load enabled rules for this config (excluding already-tried providers)
  let rulesQuery = db.select().from(routingRulesTable)
    .where(and(
      eq(routingRulesTable.configId, config.id),
      eq(routingRulesTable.isEnabled, true),
    ));

  const rules = (await rulesQuery).filter(r => {
    if (exclude.includes(r.providerKey)) return false;

    // Amount range filter
    if (r.minAmount != null && ctx.amount < Number(r.minAmount)) return false;
    if (r.maxAmount != null && ctx.amount > Number(r.maxAmount)) return false;

    // Payment mode filter
    if (r.allowedPaymentModes && ctx.paymentMode) {
      try {
        const modes: string[] = JSON.parse(r.allowedPaymentModes);
        if (modes.length > 0 && !modes.includes("all") && !modes.includes(ctx.paymentMode)) return false;
      } catch { /* ignore parse error */ }
    }

    return true;
  });

  if (rules.length === 0) return null;

  // Sort / select by strategy
  let selectedRule = rules[0];

  switch (config.strategy) {
    case "priority":
      rules.sort((a, b) => a.priority - b.priority);
      selectedRule = rules[0];
      break;

    case "success_rate": {
      // Load recent success rates
      const providerKeys = rules.map(r => r.providerKey);
      const metrics = await db.select().from(providerMetricsTable)
        .where(and(
          inArray(providerMetricsTable.providerKey, providerKeys),
          eq(providerMetricsTable.timeWindow, "1h"),
        ));
      const rateMap = new Map(metrics.map(m => [m.providerKey, Number(m.successRate ?? 0)]));

      // Threshold: if success rate < threshold, deprioritize (but still use as fallback)
      const threshold = Number(config.minSuccessRateThreshold ?? 80);
      const preferred = rules.filter(r => (rateMap.get(r.providerKey) ?? 100) >= threshold);
      const fallback = rules.filter(r => (rateMap.get(r.providerKey) ?? 100) < threshold);

      const sorted = [
        ...preferred.sort((a, b) => (rateMap.get(b.providerKey) ?? 0) - (rateMap.get(a.providerKey) ?? 0)),
        ...fallback.sort((a, b) => a.priority - b.priority),
      ];
      selectedRule = sorted[0];
      break;
    }

    case "percentage": {
      // Weighted-random selection
      const total = rules.reduce((s, r) => s + r.weightPercent, 0);
      let rand = Math.random() * total;
      selectedRule = rules[rules.length - 1]; // default to last
      for (const rule of rules) {
        rand -= rule.weightPercent;
        if (rand <= 0) { selectedRule = rule; break; }
      }
      break;
    }

    case "round_robin": {
      const idx = (rrCounters[configName] ?? 0) % rules.length;
      selectedRule = rules[idx];
      rrCounters[configName] = (idx + 1) % rules.length;
      break;
    }

    default:
      rules.sort((a, b) => a.priority - b.priority);
      selectedRule = rules[0];
  }

  // Create routing log entry
  const [log] = await db.insert(routingLogsTable).values({
    merchantId: ctx.merchantId,
    configId: config.id,
    configName: config.configName,
    strategyUsed: config.strategy,
    attemptNumber,
    providerKey: selectedRule.providerKey,
    result: "pending",
    amount: String(ctx.amount),
    paymentMode: ctx.paymentMode ?? null,
  }).returning();

  ctx.logger?.info({
    configName,
    strategy: config.strategy,
    providerKey: selectedRule.providerKey,
    priority: selectedRule.priority,
    attemptNumber,
  }, "Smart routing: provider selected");

  return {
    providerKey: selectedRule.providerKey,
    routingLogId: log!.id,
    configId: config.id,
    configName: config.configName,
    strategy: config.strategy,
    priority: selectedRule.priority,
    attemptNumber,
  };
}

/**
 * Record the outcome of a routing attempt.
 * Updates both the routing log and the provider's metrics.
 * Must be called after every provider attempt (success or failure).
 */
export async function recordRoutingResult(params: {
  routingLogId: number;
  providerKey: string;
  result: "success" | "failed" | "timeout" | "disabled" | "skipped";
  responseTimeMs?: number;
  publicReferenceId?: string;
  providerReferenceId?: string;
  errorMessage?: string;
}): Promise<void> {
  const { routingLogId, providerKey, result, responseTimeMs, publicReferenceId, providerReferenceId, errorMessage } = params;

  // Update log entry
  await db.update(routingLogsTable)
    .set({
      result,
      responseTimeMs: responseTimeMs ?? null,
      publicReferenceId: publicReferenceId ?? null,
      providerReferenceId: providerReferenceId ?? null,
      errorMessage: errorMessage ?? null,
    })
    .where(eq(routingLogsTable.id, routingLogId));

  // Update provider metrics for all time windows
  const isSuccess = result === "success";
  const isFailed = result === "failed";
  const isTimeout = result === "timeout";

  for (const timeWindow of ["1h", "24h", "7d"]) {
    await db.insert(providerMetricsTable)
      .values({
        providerKey,
        timeWindow,
        totalAttempts: 1,
        successCount: isSuccess ? 1 : 0,
        failedCount: isFailed ? 1 : 0,
        timeoutCount: isTimeout ? 1 : 0,
        avgResponseMs: responseTimeMs ?? null,
        successRate: isSuccess ? "100.00" : "0.00",
        lastComputedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [providerMetricsTable.providerKey, providerMetricsTable.timeWindow],
        set: {
          totalAttempts: sql`${providerMetricsTable.totalAttempts} + 1`,
          successCount: sql`${providerMetricsTable.successCount} + ${isSuccess ? 1 : 0}`,
          failedCount: sql`${providerMetricsTable.failedCount} + ${isFailed ? 1 : 0}`,
          timeoutCount: sql`${providerMetricsTable.timeoutCount} + ${isTimeout ? 1 : 0}`,
          successRate: sql`ROUND(
            CAST(${providerMetricsTable.successCount} + ${isSuccess ? 1 : 0} AS numeric) /
            NULLIF(${providerMetricsTable.totalAttempts} + 1, 0) * 100, 2
          )`,
          avgResponseMs: responseTimeMs != null
            ? sql`CASE WHEN ${providerMetricsTable.avgResponseMs} IS NULL THEN ${responseTimeMs}
                       ELSE (${providerMetricsTable.avgResponseMs} + ${responseTimeMs}) / 2 END`
            : providerMetricsTable.avgResponseMs,
          lastComputedAt: new Date(),
        },
      });
  }
}

/**
 * Convenience: load cashfree credentials from system_config.
 * Used by the smart router to try Cashfree as a provider.
 * Returns null if credentials are not configured or Cashfree is not enabled.
 */
export async function loadCashfreePayinConfig(): Promise<{
  clientId: string;
  clientSecret: string;
  env: "test" | "live";
} | null> {
  const rows = await db.select().from(systemConfigTable)
    .where(inArray(systemConfigTable.key, [
      SYSTEM_CONFIG_KEYS.CASHFREE_CLIENT_ID,
      SYSTEM_CONFIG_KEYS.CASHFREE_CLIENT_SECRET,
      SYSTEM_CONFIG_KEYS.CASHFREE_ENV,
      SYSTEM_CONFIG_KEYS.CASHFREE_ENABLED,
    ]));
  const cfg = new Map(rows.map(r => [r.key, r.value]));

  if (cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_ENABLED) !== "true") return null;
  const clientId = cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_CLIENT_ID) ?? "";
  const clientSecret = cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_CLIENT_SECRET) ?? "";
  if (!clientId || !clientSecret) return null;

  return {
    clientId,
    clientSecret,
    env: (cfg.get(SYSTEM_CONFIG_KEYS.CASHFREE_ENV) ?? "test") as "test" | "live",
  };
}

/**
 * Check whether smart routing is configured and has at least one enabled provider.
 * Used by admin status endpoint.
 */
export async function getRoutingStatus(): Promise<{
  configured: boolean;
  configName: string | null;
  strategy: string | null;
  providerCount: number;
  fallbackEnabled: boolean;
}> {
  const [config] = await db.select().from(routingConfigsTable)
    .where(eq(routingConfigsTable.isEnabled, true))
    .orderBy(asc(routingConfigsTable.id)).limit(1);

  if (!config) return { configured: false, configName: null, strategy: null, providerCount: 0, fallbackEnabled: false };

  const rules = await db.select().from(routingRulesTable)
    .where(and(eq(routingRulesTable.configId, config.id), eq(routingRulesTable.isEnabled, true)));

  return {
    configured: true,
    configName: config.configName,
    strategy: config.strategy,
    providerCount: rules.length,
    fallbackEnabled: config.fallbackEnabled,
  };
}

import { asc } from "drizzle-orm";
