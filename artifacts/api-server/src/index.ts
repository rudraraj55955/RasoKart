import app from "./app";
import { logger } from "./lib/logger";
import { pool } from "@workspace/db";
import { seed } from "./seed";
import { ensureSchemaGuard } from "./lib/schemaGuard";
import cron from "node-cron";
import { processPendingRetries } from "./helpers/callbackRetry";
import { initReconciliationScheduler } from "./helpers/reconScheduler";
import { initAuditReportScheduler } from "./helpers/auditReportScheduler";
import { startProviderLimitAlertScheduler, runProviderLimitAlertScan } from "./helpers/providerLimitScheduler";
import { initQrCleanupScheduler } from "./helpers/qrCleanupScheduler";
import { initVaCleanupScheduler } from "./helpers/vaCleanupScheduler";
import { initPlanExpiryScheduler } from "./helpers/planExpiryScheduler";
import { initPlanRenewalScheduler } from "./helpers/planRenewalScheduler";
import { initRateLimitCleanupScheduler } from "./helpers/rateLimitCleanupScheduler";
import { initTestEmailRetentionScheduler } from "./helpers/testEmailRetentionScheduler";
import { initAuditReportRetentionScheduler } from "./helpers/auditReportRetentionScheduler";
import { initDormantMerchantScheduler, runDormantMerchantScan } from "./helpers/dormantMerchantScheduler";
import { initEkqrSyncScheduler } from "./helpers/ekqrSyncScheduler";
import { initMerchantReportScheduler } from "./helpers/merchantReportScheduler";
import { initOverdueReportScheduler, runOverdueReportScan } from "./helpers/overdueReportScheduler";
import { initDeliveryHealthDigestScheduler } from "./helpers/reportDeliveryHealthEmail";
import { initDeliverySuccessRateAlertScheduler, runDeliverySuccessRateAlertScan } from "./helpers/deliverySuccessRateAlertScheduler";
import { flushAllReadyQuietHoursQueues } from "./helpers/quietHours";
import { db, systemConfigTable, SYSTEM_CONFIG_KEYS, SYSTEM_CONFIG_DEFAULTS } from "@workspace/db";
import { eq } from "drizzle-orm";
import { initNotifReminderScheduler, runNotifReminderScan } from "./helpers/notifReminderScheduler";
import { initSnoozeCleanupScheduler, runSnoozeCleanup } from "./helpers/snoozeCleanupScheduler";
import { initPayoutStuckCleanupScheduler, runStuckPayoutCleanup } from "./helpers/payoutStuckCleanupScheduler";
import { initCashfreeStuckOrderScheduler, runStuckCashfreeOrderScan } from "./helpers/cashfreeStuckOrderScheduler";
import { initGithubSyncLogCleanupScheduler, runGithubSyncLogCleanup } from "./helpers/githubSyncLogCleanupScheduler";
import { resolveStaleOutageOnBoot } from "./helpers/smartRouter";
import { markServerInitialized } from "./lib/startupState";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

function scheduleCallbackRetryWorker() {
  cron.schedule("* * * * *", async () => {
    try {
      await processPendingRetries();
    } catch (err) {
      logger.error({ err }, "Callback retry worker failed");
    }
  });

  logger.info("Callback retry worker registered (runs every minute)");
}

async function getQuietHoursFlushIntervalMs(): Promise<number> {
  try {
    const [row] = await db
      .select({ value: systemConfigTable.value })
      .from(systemConfigTable)
      .where(eq(systemConfigTable.key, SYSTEM_CONFIG_KEYS.QUIET_HOURS_FLUSH_INTERVAL_SECONDS))
      .limit(1);
    const seconds = parseInt(
      row?.value ?? SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.QUIET_HOURS_FLUSH_INTERVAL_SECONDS]
    );
    return Math.max(10, seconds) * 1000;
  } catch {
    const fallbackMs = parseInt(process.env["QUIET_HOURS_FLUSH_INTERVAL_MS"] ?? "60000", 10);
    return fallbackMs;
  }
}

function initQuietHoursFlushScheduler() {
  const envFallbackMs = parseInt(process.env["QUIET_HOURS_FLUSH_INTERVAL_MS"] ?? "60000", 10);

  async function tick() {
    try {
      logger.info("Quiet hours flush: scanning for ready queues");
      const { usersProcessed, totalFlushed } = await flushAllReadyQuietHoursQueues();
      if (usersProcessed > 0) {
        logger.info({ usersProcessed, totalFlushed }, "Quiet hours flush complete");
      }
    } catch (err) {
      logger.error({ err }, "Quiet hours flush sweep failed");
    }
    const intervalMs = await getQuietHoursFlushIntervalMs();
    setTimeout(tick, intervalMs);
  }

  getQuietHoursFlushIntervalMs()
    .then((intervalMs) => {
      logger.info({ intervalMs }, "Quiet hours flush scheduler registered");
      setTimeout(tick, intervalMs);
    })
    .catch(() => {
      logger.info({ intervalMs: envFallbackMs }, "Quiet hours flush scheduler registered (env fallback)");
      setTimeout(tick, envFallbackMs);
    });
}

async function main() {
  // ── 1. Bind to port IMMEDIATELY ─────────────────────────────────────────────
  // The Cloud Run startup probe fires as soon as the container image is loaded,
  // before any async work completes.  We must bind the port FIRST so the probe
  // gets an immediate HTTP 200 from GET /api/healthz.
  //
  // DO NOT await pool.query("SELECT 1") before app.listen():
  //   • The probe has a default failure threshold of ~3 attempts × 10 s = 30 s.
  //   • Even a 1–5 s cold-start round-trip to the managed PostgreSQL instance
  //     means the port is not bound when the first probe fires → connection
  //     refused → probe fails → promote fails.
  //   • This was the cause of every promote failure in this project's history.
  //
  // DB connectivity is checked AFTER the port is bound (step 2).  If the check
  // fails the server exits; Cloud Run restarts the container and retries.
  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port }, "Server listening");
  });

  // ── 2. Fatal DB connectivity check ──────────────────────────────────────────
  // Now that the port is bound and the startup probe can reach /api/healthz,
  // verify the database is reachable.  A failure here exits so Cloud Run
  // restarts the container — the probe keeps passing on each restart attempt
  // until the DB becomes available or the deployment is cancelled.
  try {
    await pool.query("SELECT 1");
    logger.info("Database connection verified");
  } catch (err) {
    logger.error({ err }, "Database health check failed — cannot start server");
    process.exit(1);
  }

  // ── 3. Schema guard ─────────────────────────────────────────────────────────
  try {
    await ensureSchemaGuard();
  } catch (err) {
    // Additive/idempotent guard — log and continue. A failure here most likely
    // means a transient DB blip, already covered by the fatal connection check
    // above; it must never itself take the server down.
    logger.error({ err }, "schema_guard_failed — continuing, guard will retry on next request");
  }

  // ── 4. Seed ─────────────────────────────────────────────────────────────────
  try {
    await seed();
    logger.info("Database seed complete");
  } catch (err) {
    // Seed failures (e.g. a still-missing optional column in an unusual
    // environment) must never crash the server — only a genuine DB
    // connection failure (checked above) is fatal. Log sanitized error and
    // keep serving; routes that depend on seeded data already handle
    // missing/empty state gracefully.
    logger.error({ err }, "Seed failed — continuing without full baseline data");
  }

  // ── 5. Schedulers ───────────────────────────────────────────────────────────
  // Startup sweep: if the server crashed or was restarted while a payin
  // routing-chain outage was in progress, PAYIN_CHAIN_EXHAUSTED_SINCE may
  // still be set in the DB with no matching gateway_recovered notification.
  // Resolve any stale outage older than the grace period so the Failover
  // Events tab doesn't permanently show those events as "Ongoing".
  resolveStaleOutageOnBoot(logger).catch((err) => {
    logger.warn({ err }, "Startup stale-outage cleanup failed");
  });

  try {
    await initReconciliationScheduler();
  } catch (err) {
    // system_config may not yet exist in an edge-case environment; log and
    // continue — schedulers that depend on it will no-op until the next restart.
    logger.error({ err }, "initReconciliationScheduler failed — continuing without recon scheduler");
  }
  initAuditReportScheduler();
  startProviderLimitAlertScheduler();
  initQrCleanupScheduler();
  initVaCleanupScheduler();
  initPlanExpiryScheduler();
  initPlanRenewalScheduler();
  initRateLimitCleanupScheduler();
  initTestEmailRetentionScheduler();
  initAuditReportRetentionScheduler();
  initDormantMerchantScheduler();
  initEkqrSyncScheduler();
  initMerchantReportScheduler();
  initOverdueReportScheduler();
  initDeliveryHealthDigestScheduler();
  initDeliverySuccessRateAlertScheduler();
  initNotifReminderScheduler();
  initSnoozeCleanupScheduler();
  initPayoutStuckCleanupScheduler();
  initCashfreeStuckOrderScheduler();
  initGithubSyncLogCleanupScheduler();
  scheduleCallbackRetryWorker();
  initQuietHoursFlushScheduler();

  // Startup sweep: immediately scan all active connections so merchants receive
  // provider_limit_reset (and warning/reached) notifications even when the server
  // was down at the start of the month. The dedup indexes make this idempotent.
  runProviderLimitAlertScan().catch((err) => {
    logger.warn({ err }, "Startup provider limit sweep failed");
  });

  // Startup sweep: scan for newly dormant merchants so admins are alerted even
  // when the server was down at the scheduled run time. Dedup keys make this safe.
  runDormantMerchantScan().catch((err) => {
    logger.warn({ err }, "Startup dormant merchant sweep failed");
  });

  // Startup sweep: scan for overdue scheduled reports so admins are alerted even
  // when the server was down at the daily run time. Dedup keys make this safe.
  runOverdueReportScan().catch((err) => {
    logger.warn({ err }, "Startup overdue report sweep failed");
  });

  // Startup sweep: check delivery success rates so admins are alerted even when
  // the server was down at the scheduled run time. Dedup keys make this safe.
  runDeliverySuccessRateAlertScan().catch((err) => {
    logger.warn({ err }, "Startup delivery success-rate alert sweep failed");
  });

  // Startup sweep: send notif reminder emails to merchants who have had
  // notifications disabled for ≥30 days and haven't received a reminder yet.
  // notif_reminder_sent_at guards against duplicate sends within 30 days.
  runNotifReminderScan().catch((err) => {
    logger.warn({ err }, "Startup notif reminder sweep failed");
  });

  // Startup sweep: clear any snooze timestamps that expired while the server
  // was down so they don't linger until the next nightly run.
  runSnoozeCleanup().catch((err) => {
    logger.warn({ err }, "Startup snooze cleanup sweep failed");
  });

  // Startup sweep: clean up payouts stuck INITIATED/PENDING past the
  // threshold (e.g. server crashed mid-transfer) so locked wallet balances
  // don't stay stuck until the next scheduled run.
  runStuckPayoutCleanup().catch((err) => {
    logger.warn({ err }, "Startup stuck payout cleanup sweep failed");
  });

  // Startup sweep: remove any orphaned .github-sync-logs/ files whose id is
  // not present in the current history (e.g. from a mid-write crash or manual
  // history edit) so they don't accumulate indefinitely on disk.
  runGithubSyncLogCleanup({ source: "manual" }).catch((err) => {
    logger.warn({ err }, "Startup GitHub sync log cleanup sweep failed");
  });

  // Startup sweep: check for Cashfree payin orders stuck in a non-PAID state
  // so an alert fires immediately if the server was down during an outage.
  runStuckCashfreeOrderScan().catch((err) => {
    logger.warn({ err }, "Startup Cashfree stuck order sweep failed");
  });

  // ── 6. Mark fully initialised ───────────────────────────────────────────────
  // From this point on /api/healthz/deep runs the full schema + credential
  // checks and returns 200 (or 503 degraded) instead of 503 "starting".
  markServerInitialized();
  logger.info("Server fully initialised — startup probe will now return full health check");
}

main();
