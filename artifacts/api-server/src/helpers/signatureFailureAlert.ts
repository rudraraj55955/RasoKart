import { db, callbackLogsTable, merchantsTable, usersTable, signatureFailureAlertLogsTable } from "@workspace/db";
import { and, eq, gte, count, sql, desc } from "drizzle-orm";
import { logger } from "../lib/logger";
import { sendMail } from "./mailer";

const APP_DOMAIN = process.env["APP_DOMAIN"] ?? "https://rasokart.com";

export const ALERT_THRESHOLD = (() => {
  const raw = process.env["SIGNATURE_FAILURE_ALERT_THRESHOLD"];
  if (raw) {
    const parsed = parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 10;
})();

const WINDOW_HOURS = (() => {
  const raw = process.env["SIGNATURE_FAILURE_ALERT_WINDOW_HOURS"];
  if (raw) {
    const parsed = parseFloat(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 1;
})();

const RATE_LIMIT_MS = (() => {
  const raw = process.env["SIGNATURE_FAILURE_ALERT_RATE_LIMIT_HOURS"];
  if (raw) {
    const parsed = parseFloat(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed * 60 * 60 * 1000;
  }
  return 60 * 60 * 1000;
})();

/**
 * Module-level state for rate limiting and in-flight deduplication.
 *
 * Node.js is single-threaded: the synchronous checks and writes to both
 * variables run atomically within a single event-loop tick — before any
 * `await` yields control — so no concurrent call can slip through the guard.
 *
 * - `checkInFlight`: prevents two concurrent async invocations from both
 *   querying the DB and dispatching emails. Once set to true at the top of the
 *   function (before the first await), every subsequent call will see it and
 *   return immediately.
 * - `lastAlertSentAt`: rate-limits alerts to at most one per RATE_LIMIT_MS
 *   window. It is seeded from the DB on startup (see seedLastAlertSentAt) so
 *   restarts do not reset the cooldown.
 */
let checkInFlight = false;
let lastAlertSentAt: Date | null = null;

/**
 * Seed the in-memory rate-limit timestamp from the most recent DB record.
 * Call once at server startup so restarts don't bypass the cooldown window.
 */
export async function seedLastAlertSentAt(): Promise<void> {
  try {
    const [latest] = await db
      .select({ sentAt: signatureFailureAlertLogsTable.sentAt })
      .from(signatureFailureAlertLogsTable)
      .orderBy(desc(signatureFailureAlertLogsTable.sentAt))
      .limit(1);

    if (latest) {
      lastAlertSentAt = latest.sentAt;
      logger.info(
        { lastAlertSentAt },
        "Seeded signature failure alert rate-limit from DB"
      );
    }
  } catch (err) {
    logger.warn({ err }, "Could not seed signature failure alert rate-limit from DB — will start fresh");
  }
}

async function getAdminEmails(): Promise<string[]> {
  const admins = await db
    .select({ email: usersTable.email })
    .from(usersTable)
    .where(and(
      eq(usersTable.role, "admin"),
      eq(usersTable.isActive, true),
      eq(usersTable.signatureFailureAlertEmails, true),
    ));
  return admins.map(a => a.email);
}

function buildSignatureFailureAlertHtml(opts: {
  failureCount: number;
  affectedMerchants: { name: string; count: number }[];
  windowHours: number;
  threshold: number;
  callbacksLink: string;
}): string {
  const { failureCount, affectedMerchants, windowHours, threshold, callbacksLink } = opts;

  const merchantRows = affectedMerchants
    .map((m, i) => `
      <tr${i % 2 === 0 ? ' style="background: #111;"' : ""}>
        <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px;">${escapeHtml(m.name)}</td>
        <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; color: #f87171; font-weight: 600; text-align: right;">${m.count}</td>
      </tr>`)
    .join("");

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; background: #0f0f0f; color: #e5e5e5; margin: 0; padding: 24px;">
  <div style="max-width: 600px; margin: 0 auto; background: #1a1a1a; border-radius: 8px; overflow: hidden; border: 1px solid #2a2a2a;">
    <div style="background: #7f1d1d; padding: 20px 24px;">
      <h1 style="margin: 0; font-size: 20px; color: #fff; letter-spacing: 0.5px;">RasoKart — Signature Failure Alert</h1>
      <p style="margin: 4px 0 0; color: #fca5a5; font-size: 13px;">Threshold exceeded: possible replay or HMAC misconfiguration</p>
    </div>
    <div style="padding: 24px;">
      <p style="margin: 0 0 16px; color: #f87171; font-size: 14px; font-weight: 600;">
        🚨 <strong>${failureCount}</strong> signature verification failure${failureCount !== 1 ? "s" : ""} detected in the last ${windowHours === 1 ? "hour" : `${windowHours} hours`}.
      </p>
      <p style="margin: 0 0 20px; color: #a1a1aa; font-size: 13px;">
        The platform has crossed the alert threshold of <strong>${threshold}</strong> signature failures within a ${windowHours}-hour rolling window.
        This may indicate a replay attack, HMAC misconfiguration, or a misconfigured integration sending requests with invalid signatures.
        Please review the callbacks page for details.
      </p>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <thead>
          <tr style="background: #0f0f0f;">
            <th style="padding: 10px 14px; border: 1px solid #2a2a2a; text-align: left; font-size: 12px; color: #71717a; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Affected Merchant</th>
            <th style="padding: 10px 14px; border: 1px solid #2a2a2a; text-align: right; font-size: 12px; color: #71717a; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Failures</th>
          </tr>
        </thead>
        <tbody>
          ${merchantRows}
        </tbody>
      </table>

      <div style="text-align: center; margin-bottom: 20px;">
        <a href="${callbacksLink}"
           style="display: inline-block; background: #7c3aed; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-size: 14px; font-weight: 600; letter-spacing: 0.3px;">
          Review Callbacks in Admin Portal
        </a>
      </div>

      <p style="margin: 0; color: #71717a; font-size: 12px;">
        If the link above doesn't work, copy this URL into your browser:<br>
        <span style="color: #818cf8;">${callbacksLink}</span>
      </p>
    </div>
    <div style="padding: 14px 24px; background: #111; border-top: 1px solid #2a2a2a;">
      <p style="margin: 0; color: #52525b; font-size: 11px;">
        This alert was sent by RasoKart. Alerts are rate-limited to at most one per hour.
        To stop receiving these alerts, update your notification preferences in Admin Settings.
      </p>
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function checkAndAlertSignatureFailures(): Promise<void> {
  // ── Synchronous guards (run atomically in the event loop before any await) ──
  //
  // 1. Rate-limit: skip if we already sent an alert within the cooldown window.
  // 2. In-flight: skip if another async invocation is already mid-check.
  //
  // Because both checks and the `checkInFlight = true` write happen synchronously
  // (before the first `await`), Node.js's single-threaded model guarantees that
  // no concurrent call can pass through both checks simultaneously.
  if (lastAlertSentAt !== null && Date.now() - lastAlertSentAt.getTime() < RATE_LIMIT_MS) {
    return;
  }
  if (checkInFlight) {
    return;
  }
  checkInFlight = true;

  try {
    const since = new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000);

    const [{ total }] = await db
      .select({ total: count() })
      .from(callbackLogsTable)
      .where(and(
        eq(callbackLogsTable.signatureVerified, false),
        gte(callbackLogsTable.createdAt, since),
      ));

    if (total <= ALERT_THRESHOLD) {
      return;
    }

    const recipients = await getAdminEmails();
    if (recipients.length === 0) {
      logger.info("No admins opted in to signature failure alert emails — skipping");
      return;
    }

    const merchantFailures = await db
      .select({
        merchantId: callbackLogsTable.merchantId,
        merchantName: merchantsTable.businessName,
        failureCount: count(),
      })
      .from(callbackLogsTable)
      .leftJoin(merchantsTable, eq(callbackLogsTable.merchantId, merchantsTable.id))
      .where(and(
        eq(callbackLogsTable.signatureVerified, false),
        gte(callbackLogsTable.createdAt, since),
      ))
      .groupBy(callbackLogsTable.merchantId, merchantsTable.businessName)
      .orderBy(sql`count(*) DESC`)
      .limit(20);

    const affectedMerchants = merchantFailures.map(row => ({
      name: row.merchantName ?? `Merchant #${row.merchantId}`,
      count: row.failureCount,
    }));

    const callbacksLink = `${APP_DOMAIN}/admin/callbacks?signatureVerified=failed`;
    const html = buildSignatureFailureAlertHtml({
      failureCount: total,
      affectedMerchants,
      windowHours: WINDOW_HOURS,
      threshold: ALERT_THRESHOLD,
      callbacksLink,
    });

    const subject = `[RasoKart] 🚨 Signature Failure Alert — ${total} failure${total !== 1 ? "s" : ""} in ${WINDOW_HOURS === 1 ? "1 hour" : `${WINDOW_HOURS} hours`}`;

    // Set the rate-limit timestamp BEFORE dispatching emails so the guard stays
    // closed even if the mailer throws — preventing a flood of retries.
    lastAlertSentAt = new Date();

    const results = await Promise.allSettled(
      recipients.map(email => sendMail({ to: email, subject, html }))
    );

    const sent = results.filter(r => r.status === "fulfilled" && r.value).length;
    const failed = results.length - sent;

    logger.info(
      { total, affectedMerchants: affectedMerchants.length, threshold: ALERT_THRESHOLD, windowHours: WINDOW_HOURS, sent, failed },
      "Admin signature failure alert emails dispatched"
    );

    // Persist this alert dispatch to the DB for audit history.
    // Fire-and-forget: a DB write failure must not retroactively re-open the
    // rate-limit gate (lastAlertSentAt is already set above).
    db.insert(signatureFailureAlertLogsTable).values({
      sentAt: lastAlertSentAt,
      failureCount: total,
      affectedMerchantCount: affectedMerchants.length,
      recipientCount: sent,
      recipientEmails: JSON.stringify(recipients),
      affectedMerchants: JSON.stringify(affectedMerchants),
      windowHours: WINDOW_HOURS,
      threshold: ALERT_THRESHOLD,
    }).catch((err: unknown) => {
      logger.warn({ err }, "Failed to persist signature failure alert log to DB");
    });
  } catch (err) {
    logger.error({ err }, "Failed to check or send signature failure alert");
  } finally {
    checkInFlight = false;
  }
}
