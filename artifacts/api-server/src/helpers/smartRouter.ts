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
  usersTable,
} from "@workspace/db";
import { eq, and, desc, inArray, sql, gte } from "drizzle-orm";
import type { Logger } from "pino";
import { createBulkNotifications } from "./notifications";

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
  /** Whether this rule is marked as fallback-only (only used after a primary has failed). */
  isFallbackOnly: boolean;
  /** Max dispatch attempts for this provider before skipping it (default 1). */
  maxRetries: number;
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
 *
 * @param exclude      Provider keys to skip (already tried / exhausted).
 * @param attemptNumber  Current attempt count (used for logging).
 * @param allowFallbackOnly  When false (default), fallback-only rules are excluded
 *                           from selection. Pass true once a primary rule has been
 *                           tried at least once so fallback rules become eligible.
 */
export async function selectProvider(
  ctx: RoutingContext,
  exclude: string[] = [],
  attemptNumber = 1,
  allowFallbackOnly = false,
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

  // Load enabled rules for this config (excluding already-exhausted providers)
  const rules = (await db.select().from(routingRulesTable)
    .where(and(
      eq(routingRulesTable.configId, config.id),
      eq(routingRulesTable.isEnabled, true),
    ))).filter(r => {
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

    // Fallback-only filter: skip fallback-only rules until a primary has been tried
    if (r.isFallbackOnly && !allowFallbackOnly) return false;

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
    isFallbackOnly: selectedRule.isFallbackOnly,
    maxRetries: selectedRule.maxRetries,
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
    isFallbackOnly: selectedRule.isFallbackOnly,
    maxRetries: selectedRule.maxRetries,
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
 * Mark the start of a payin routing chain exhaustion (all configured gateways
 * failing). Only records the timestamp once per outage — onConflictDoNothing
 * means the "since" value always reflects when the outage started, not the
 * most recent failed attempt. Cleared by `maybeNotifyGatewayRecovery` once a
 * routing attempt succeeds again.
 */
export async function recordChainExhaustedStart(): Promise<void> {
  await db.insert(systemConfigTable).values({
    key: SYSTEM_CONFIG_KEYS.PAYIN_CHAIN_EXHAUSTED_SINCE,
    value: new Date().toISOString(),
  }).onConflictDoNothing();
}

/**
 * Called after every successful smart-routing dispatch. If a chain-exhaustion
 * outage was in progress, this is the recovery: notify every merchant who had
 * at least one failed routing attempt during the outage window, then clear
 * the outage marker. Best-effort — failures here must never affect the
 * caller's success response.
 */
export async function maybeNotifyGatewayRecovery(logger?: Logger): Promise<void> {
  try {
    const [row] = await db.select().from(systemConfigTable)
      .where(eq(systemConfigTable.key, SYSTEM_CONFIG_KEYS.PAYIN_CHAIN_EXHAUSTED_SINCE))
      .limit(1);
    if (!row) return; // no outage in progress — nothing to recover from

    const exhaustedSince = new Date(row.value);
    // Always clear the marker first so a single bad timestamp or a failure
    // below can never wedge the app in a permanent "outage in progress" state.
    await db.delete(systemConfigTable)
      .where(eq(systemConfigTable.key, SYSTEM_CONFIG_KEYS.PAYIN_CHAIN_EXHAUSTED_SINCE));

    if (isNaN(exhaustedSince.getTime())) return;

    const affected = await db.selectDistinct({ merchantId: routingLogsTable.merchantId })
      .from(routingLogsTable)
      .where(and(
        gte(routingLogsTable.createdAt, exhaustedSince),
        eq(routingLogsTable.result, "failed"),
      ));
    const merchantIds = affected.map(r => r.merchantId);
    if (merchantIds.length === 0) return;

    const merchantUsers = await db.select({ id: usersTable.id })
      .from(usersTable)
      .where(and(
        inArray(usersTable.merchantId, merchantIds),
        eq(usersTable.role, "merchant"),
        eq(usersTable.isActive, true),
      ));
    if (merchantUsers.length === 0) return;

    await createBulkNotifications(merchantUsers.map(u => ({
      userId: u.id,
      type: "gateway_recovered" as const,
      title: "Payment Gateways Are Back Online",
      body: "Deposit gateways have recovered after a temporary outage. You can now retry your deposit.",
      metadata: { recoveredAt: new Date().toISOString() },
    })), { skipPrefCheck: true });

    logger?.info({
      event: "payin_gateway_recovery_notified",
      merchantCount: merchantUsers.length,
    }, "payin_gateway_recovery_notified");
  } catch {
    logger?.error({ event: "payin_gateway_recovery_notify_failed" }, "payin_gateway_recovery_notify_failed");
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

// ── Dry-run simulation ────────────────────────────────────────────────────────

export interface SimulateStep {
  step: number;
  providerKey: string;
  priority: number;
  isFallbackOnly: boolean;
  maxRetries: number;
  weightPercent: number;
  role: "primary" | "fallback";
  notes: string | null;
}

export interface SimulateRoutingResult {
  configName: string;
  strategy: string;
  amount: number;
  paymentMode: string | null;
  steps: SimulateStep[];
  totalProviders: number;
  /** True when strategy is deterministic (priority / success_rate).
   *  False for percentage / round_robin where actual selection is random/counter-based. */
  isDeterministic: boolean;
  warning: string | null;
}

/**
 * Dry-run the routing engine for a given amount + payment mode.
 *
 * Iterates through the same selection loop as `selectProvider` —
 * including the `allowFallbackOnly` gate and the per-attempt exclude list —
 * but without writing routing logs or calling any gateway.
 *
 * For deterministic strategies (priority, success_rate) the result is exact.
 * For non-deterministic strategies (percentage, round_robin) the result
 * shows the most likely/representative ordering and `isDeterministic` is false.
 */
export async function simulateRouting(params: {
  amount: number;
  paymentMode?: string;
  configName?: string;
}): Promise<SimulateRoutingResult | null> {
  // If a specific config name is requested, load it; otherwise use the first enabled config.
  const configQuery = params.configName
    ? db.select().from(routingConfigsTable)
        .where(and(
          eq(routingConfigsTable.configName, params.configName),
          eq(routingConfigsTable.isEnabled, true),
        )).limit(1)
    : db.select().from(routingConfigsTable)
        .where(eq(routingConfigsTable.isEnabled, true))
        .orderBy(asc(routingConfigsTable.id)).limit(1);

  const [config] = await configQuery;
  if (!config) return null;

  // Load all enabled rules for this config
  const allRules = await db.select().from(routingRulesTable)
    .where(and(
      eq(routingRulesTable.configId, config.id),
      eq(routingRulesTable.isEnabled, true),
    ));

  // Apply the same amount/mode filters as selectProvider
  const matchingRules = allRules.filter(r => {
    if (r.minAmount != null && params.amount < Number(r.minAmount)) return false;
    if (r.maxAmount != null && params.amount > Number(r.maxAmount)) return false;
    if (r.allowedPaymentModes && params.paymentMode) {
      try {
        const modes: string[] = JSON.parse(r.allowedPaymentModes);
        if (modes.length > 0 && !modes.includes("all") && !modes.includes(params.paymentMode)) return false;
      } catch { /* ignore parse error */ }
    }
    return true;
  });

  const allFallbackOnly = matchingRules.length > 0 && matchingRules.every(r => r.isFallbackOnly);

  if (matchingRules.length === 0) {
    return {
      configName: config.configName,
      strategy: config.strategy,
      amount: params.amount,
      paymentMode: params.paymentMode ?? null,
      steps: [],
      totalProviders: 0,
      isDeterministic: true,
      warning: "No providers match the given amount and payment mode — this payment would fail immediately.",
    };
  }

  // For success_rate strategy, pre-load metrics (same as selectProvider)
  let rateMap = new Map<string, number>();
  if (config.strategy === "success_rate") {
    const providerKeys = matchingRules.map(r => r.providerKey);
    const metrics = await db.select().from(providerMetricsTable)
      .where(and(
        inArray(providerMetricsTable.providerKey, providerKeys),
        eq(providerMetricsTable.timeWindow, "1h"),
      ));
    rateMap = new Map(metrics.map(m => [m.providerKey, Number(m.successRate ?? 0)]));
  }

  const threshold = Number(config.minSuccessRateThreshold ?? 80);

  /**
   * Walk through the same attempt loop that the live engine executes.
   *
   * Key mechanics (matching selectProvider exactly):
   *   - allowFallbackOnly starts false: fallback-only rules are excluded from
   *     the first attempt, regardless of their priority number.
   *   - After attempt 1 succeeds/fails, allowFallbackOnly = true: fallback-only
   *     rules join the pool and can be selected before remaining primary rules
   *     when their strategy rank (priority, success_rate, weight, etc.) is higher.
   *   - exclude grows with each selected provider key (one entry per attempt).
   *
   * isDeterministic is false for percentage (weighted-random) and round_robin
   * (counter-based) — we show the most representative ordering but label it so.
   */
  let allowFallbackOnly = false;
  let isDeterministic = config.strategy === "priority" || config.strategy === "success_rate";
  const excludeSet = new Set<string>();
  const steps: SimulateStep[] = [];

  // Safety cap: can never have more steps than matching rules
  for (let attempt = 1; attempt <= matchingRules.length; attempt++) {
    // Build eligible pool — same filter as selectProvider inner filter
    const eligible = matchingRules.filter(r => {
      if (excludeSet.has(r.providerKey)) return false;
      if (r.isFallbackOnly && !allowFallbackOnly) return false;
      return true;
    });

    if (eligible.length === 0) break;

    let selected = eligible[0]; // default

    switch (config.strategy) {
      case "priority":
        // Same as live: sort by priority ASC, pick lowest (highest priority)
        eligible.sort((a, b) => a.priority - b.priority);
        selected = eligible[0];
        break;

      case "success_rate": {
        // Same sort as selectProvider: preferred (rate ≥ threshold) by rate desc,
        // then degraded by priority. All of these are in the same pool now —
        // no artificial primary/fallback split — so fallback-only rules with high
        // success rates will rank above degraded primary rules, matching live behavior.
        const preferred = eligible.filter(r => (rateMap.get(r.providerKey) ?? 100) >= threshold)
          .sort((a, b) => (rateMap.get(b.providerKey) ?? 0) - (rateMap.get(a.providerKey) ?? 0));
        const degraded = eligible.filter(r => (rateMap.get(r.providerKey) ?? 100) < threshold)
          .sort((a, b) => a.priority - b.priority);
        const sorted = [...preferred, ...degraded];
        selected = sorted[0];
        break;
      }

      case "percentage":
        // Live: weighted-random. Simulation: highest-weight first as representative.
        eligible.sort((a, b) => b.weightPercent - a.weightPercent);
        selected = eligible[0];
        isDeterministic = false;
        break;

      case "round_robin": {
        // Live: rotating counter. Simulation: order by priority as canonical rotation.
        eligible.sort((a, b) => a.priority - b.priority);
        // Offset by attempt-1 to simulate rotation (counter starts where it was)
        selected = eligible[(attempt - 1) % eligible.length];
        isDeterministic = false;
        break;
      }

      default:
        eligible.sort((a, b) => a.priority - b.priority);
        selected = eligible[0];
    }

    steps.push({
      step: attempt,
      providerKey: selected.providerKey,
      priority: selected.priority,
      isFallbackOnly: selected.isFallbackOnly,
      maxRetries: selected.maxRetries,
      weightPercent: selected.weightPercent,
      role: selected.isFallbackOnly ? "fallback" : "primary",
      notes: selected.notes ?? null,
    });

    excludeSet.add(selected.providerKey);

    // After the first attempt, fallback-only rules become eligible (mirrors live engine)
    if (attempt === 1) allowFallbackOnly = true;
  }

  let warning: string | null = null;
  if (allFallbackOnly) {
    warning = "All matching rules are Fallback Only — no primary attempt will ever be made, so this payment would fail immediately.";
  } else if (!isDeterministic) {
    warning = config.strategy === "percentage"
      ? "Strategy is Percentage Split — actual provider selection is weighted-random each attempt. This simulation shows the highest-weight provider first, but real traffic is distributed across providers proportionally."
      : "Strategy is Round Robin — actual provider selection depends on the live rotation counter. This simulation shows one representative rotation starting from the current counter position.";
  }

  return {
    configName: config.configName,
    strategy: config.strategy,
    amount: params.amount,
    paymentMode: params.paymentMode ?? null,
    steps,
    totalProviders: steps.length,
    isDeterministic,
    warning,
  };
}
