/**
 * EKQR QR code auto-sync scheduler.
 *
 * Runs every 5 minutes and polls EKQR for QR codes that:
 *   - Were created via EKQR (ekqr_order_id IS NOT NULL)
 *   - Are still in 'active' status
 *   - Are older than N minutes (configurable, default 15)
 *
 * For each stale QR code, calls check_order_status.
 * If EKQR reports SUCCESS, marks the QR code as 'used' (same path as the
 * manual sync endpoint and the webhook handler).
 *
 * After the batch, counts QR codes that are still stuck (active + stale
 * after the sync attempt). If the count exceeds the configured threshold,
 * sends an alert email to opted-in admins with a cooldown guard.
 */

import cron, { type ScheduledTask } from "node-cron";
import { db, qrCodesTable, systemConfigTable, SYSTEM_CONFIG_KEYS, SYSTEM_CONFIG_DEFAULTS } from "@workspace/db";
import { and, eq, isNotNull, lt, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { ekqrCheckOrderStatus, ekqrFormatDate } from "./ekqr";
import { decryptSecret } from "./cryptoUtils";
import { notifyAdminsOfStuckEkqrQrCodes } from "./adminNotifyEmail";
import { creditEkqrQrPayment } from "./ekqrCredit";

let syncTask: ScheduledTask | null = null;

// ── Config loaders ───────────────────────────────────────────────────────────

async function loadSyncConfig(): Promise<{
  enabled: boolean;
  staleMinutes: number;
  stuckThreshold: number;
  alertCooldownHours: number;
  apiKey: string;
}> {
  const rows = await db
    .select()
    .from(systemConfigTable)
    .where(
      sql`key IN (
        ${SYSTEM_CONFIG_KEYS.EKQR_SYNC_ENABLED},
        ${SYSTEM_CONFIG_KEYS.EKQR_SYNC_STALE_MINUTES},
        ${SYSTEM_CONFIG_KEYS.EKQR_SYNC_STUCK_THRESHOLD},
        ${SYSTEM_CONFIG_KEYS.EKQR_SYNC_ALERT_COOLDOWN_HOURS},
        ${SYSTEM_CONFIG_KEYS.EKQR_API_KEY},
        ${SYSTEM_CONFIG_KEYS.EKQR_ENABLED}
      )`
    );

  const map = new Map(rows.map((r) => [r.key, r.value]));

  const ekqrGloballyEnabled = map.get(SYSTEM_CONFIG_KEYS.EKQR_ENABLED) === "true";
  const syncEnabled = map.get(SYSTEM_CONFIG_KEYS.EKQR_SYNC_ENABLED)
    ?? SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.EKQR_SYNC_ENABLED];

  const staleMinutesRaw = parseInt(
    map.get(SYSTEM_CONFIG_KEYS.EKQR_SYNC_STALE_MINUTES)
      ?? SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.EKQR_SYNC_STALE_MINUTES]
  );
  const stuckThresholdRaw = parseInt(
    map.get(SYSTEM_CONFIG_KEYS.EKQR_SYNC_STUCK_THRESHOLD)
      ?? SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.EKQR_SYNC_STUCK_THRESHOLD]
  );
  const cooldownRaw = parseInt(
    map.get(SYSTEM_CONFIG_KEYS.EKQR_SYNC_ALERT_COOLDOWN_HOURS)
      ?? SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.EKQR_SYNC_ALERT_COOLDOWN_HOURS]
  );

  const storedApiKey = map.get(SYSTEM_CONFIG_KEYS.EKQR_API_KEY) ?? "";
  const apiKeyDecrypt = storedApiKey ? decryptSecret(storedApiKey) : { ok: true as const, value: "" };
  const apiKey = apiKeyDecrypt.ok ? apiKeyDecrypt.value : "";

  return {
    enabled: ekqrGloballyEnabled && syncEnabled === "true",
    staleMinutes: isNaN(staleMinutesRaw) ? 15 : Math.max(1, staleMinutesRaw),
    stuckThreshold: isNaN(stuckThresholdRaw) ? 10 : Math.max(1, stuckThresholdRaw),
    alertCooldownHours: isNaN(cooldownRaw) ? 4 : Math.max(1, cooldownRaw),
    apiKey,
  };
}

// ── Persist run stats ────────────────────────────────────────────────────────

async function persistSyncStats(synced: number, stuck: number): Promise<void> {
  const now = new Date().toISOString();
  const entries = [
    { key: SYSTEM_CONFIG_KEYS.EKQR_SYNC_LAST_RUN_AT, value: now },
    { key: SYSTEM_CONFIG_KEYS.EKQR_SYNC_LAST_SYNCED, value: String(synced) },
    { key: SYSTEM_CONFIG_KEYS.EKQR_SYNC_LAST_STUCK, value: String(stuck) },
  ];
  for (const entry of entries) {
    await db
      .insert(systemConfigTable)
      .values({ key: entry.key, value: entry.value })
      .onConflictDoUpdate({
        target: systemConfigTable.key,
        set: { value: entry.value, updatedAt: sql`now()` },
      });
  }
}

// ── Core sync logic ──────────────────────────────────────────────────────────

export async function runEkqrSync(
  trigger: "scheduled" | "manual" = "scheduled"
): Promise<{ synced: number; stuck: number; skipped: number }> {
  const cfg = await loadSyncConfig();

  if (!cfg.enabled) {
    logger.info("EKQR sync scheduler is disabled — skipping");
    return { synced: 0, stuck: 0, skipped: 0 };
  }

  if (!cfg.apiKey) {
    logger.warn("EKQR sync: no API key configured — skipping");
    return { synced: 0, stuck: 0, skipped: 0 };
  }

  const staleThreshold = new Date(Date.now() - cfg.staleMinutes * 60 * 1000);

  // Find active EKQR QR codes older than the stale threshold
  const staleQrs = await db
    .select()
    .from(qrCodesTable)
    .where(
      and(
        eq(qrCodesTable.status, "active"),
        isNotNull(qrCodesTable.ekqrOrderId),
        lt(qrCodesTable.createdAt, staleThreshold)
      )
    )
    .limit(200);

  if (staleQrs.length === 0) {
    logger.info({ trigger, staleMinutes: cfg.staleMinutes }, "EKQR sync: no stale QR codes found");
    await persistSyncStats(0, 0);
    return { synced: 0, stuck: 0, skipped: 0 };
  }

  logger.info(
    { trigger, staleMinutes: cfg.staleMinutes, count: staleQrs.length },
    "EKQR sync: processing stale QR codes"
  );

  let synced = 0;
  let skipped = 0;

  for (const qr of staleQrs) {
    if (!qr.ekqrOrderId) continue;

    try {
      const txnDate = ekqrFormatDate(qr.createdAt instanceof Date ? qr.createdAt : new Date(qr.createdAt));
      const { parsed } = await ekqrCheckOrderStatus(cfg.apiKey, qr.ekqrOrderId, txnDate);

      const ekqrConfirmed = parsed.status === true && parsed.data?.status?.toUpperCase() === "SUCCESS";

      if (ekqrConfirmed) {
        const data = parsed.data!;
        const rawPayload = JSON.stringify(parsed);

        // Use the same full crediting path as the webhook handler:
        // marks QR as used, inserts transaction + QR payment event,
        // fires merchant callbackUrl. UTR uniqueness prevents double-credit
        // if a webhook already processed the same payment.
        const result = await creditEkqrQrPayment({
          qr,
          amount:   data.amount,
          upiTxnId: data.upi_txn_id,
          ekqrId:   null,   // check_order_status response doesn't include EKQR's internal id
          rawPayload,
          pInfo:    qr.label ?? qr.merchantReference ?? "QR Payment",
        });

        logger.info(
          { qrId: qr.id, ekqrOrderId: qr.ekqrOrderId, merchantId: qr.merchantId, processingResult: result.processingResult },
          "EKQR sync: payment processing complete"
        );

        // Count credited and duplicate as "synced" (payment was accounted for)
        if (result.processingResult === "credited" || result.processingResult === "duplicate") {
          synced++;
        } else {
          skipped++;
        }
      } else {
        skipped++;
      }
    } catch (err) {
      logger.warn({ err, qrId: qr.id, ekqrOrderId: qr.ekqrOrderId }, "EKQR sync: status check failed for QR code");
      skipped++;
    }
  }

  // Count remaining stuck QR codes (still active and stale after sync)
  const [stuckRow] = await db
    .select({ n: sql<number>`count(*)` })
    .from(qrCodesTable)
    .where(
      and(
        eq(qrCodesTable.status, "active"),
        isNotNull(qrCodesTable.ekqrOrderId),
        lt(qrCodesTable.createdAt, staleThreshold)
      )
    );

  const stuck = Number(stuckRow?.n ?? 0);

  logger.info(
    { trigger, synced, skipped, stuck, stuckThreshold: cfg.stuckThreshold },
    "EKQR sync run complete"
  );

  await persistSyncStats(synced, stuck);

  // Fire alert if stuck count exceeds threshold
  if (stuck >= cfg.stuckThreshold) {
    notifyAdminsOfStuckEkqrQrCodes({
      stuck,
      threshold: cfg.stuckThreshold,
      staleMinutes: cfg.staleMinutes,
      cooldownHours: cfg.alertCooldownHours,
    }).catch((err) => {
      logger.error({ err }, "EKQR sync: failed to send stuck QR alert email");
    });
  }

  return { synced, stuck, skipped };
}

// ── Scheduler registration ────────────────────────────────────────────────────

export function initEkqrSyncScheduler(): void {
  if (syncTask) {
    syncTask.stop();
    syncTask = null;
  }

  syncTask = cron.schedule("*/5 * * * *", async () => {
    try {
      await runEkqrSync("scheduled");
    } catch (err) {
      logger.error({ err }, "EKQR sync scheduler job failed");
    }
  });

  logger.info("EKQR sync scheduler registered (runs every 5 minutes)");
}
