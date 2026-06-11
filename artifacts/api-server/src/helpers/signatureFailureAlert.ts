import { db, callbackLogsTable, usersTable, systemConfigTable, SYSTEM_CONFIG_KEYS, SYSTEM_CONFIG_DEFAULTS } from "@workspace/db";
import { eq, and, count, gte, inArray } from "drizzle-orm";
import { logger } from "../lib/logger";
import { sendMail } from "./mailer";

const APP_DOMAIN = process.env["APP_DOMAIN"] ?? "https://rasokart.com";

let lastAlertSentAt: Date | null = null;

export function resetAlertRateLimit(): void {
  lastAlertSentAt = null;
  logger.info("Signature failure alert rate-limit reset");
}

async function loadAlertConfig(): Promise<{ threshold: number; cooldownHours: number }> {
  const keys = [
    SYSTEM_CONFIG_KEYS.SIGNATURE_FAILURE_ALERT_THRESHOLD,
    SYSTEM_CONFIG_KEYS.SIGNATURE_FAILURE_ALERT_COOLDOWN_HOURS,
  ];

  const rows = await db
    .select()
    .from(systemConfigTable)
    .where(inArray(systemConfigTable.key, keys));

  const map = new Map(rows.map((r) => [r.key, r.value]));

  return {
    threshold: parseInt(
      map.get(SYSTEM_CONFIG_KEYS.SIGNATURE_FAILURE_ALERT_THRESHOLD) ??
        SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.SIGNATURE_FAILURE_ALERT_THRESHOLD]
    ),
    cooldownHours: parseInt(
      map.get(SYSTEM_CONFIG_KEYS.SIGNATURE_FAILURE_ALERT_COOLDOWN_HOURS) ??
        SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.SIGNATURE_FAILURE_ALERT_COOLDOWN_HOURS]
    ),
  };
}

async function getAdminEmails(): Promise<string[]> {
  const admins = await db
    .select({ email: usersTable.email })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.role, "admin"),
        eq(usersTable.isActive, true),
        eq(usersTable.signatureFailureAlertEmails, true),
      )
    );
  return admins.map((a) => a.email);
}

function buildAlertHtml(failureCount: number, threshold: number): string {
  const adminLink = `${APP_DOMAIN}/admin/callbacks`;
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; background: #0f0f0f; color: #e5e5e5; margin: 0; padding: 24px;">
  <div style="max-width: 600px; margin: 0 auto; background: #1a1a1a; border-radius: 8px; overflow: hidden; border: 1px solid #2a2a2a;">
    <div style="background: #7f1d1d; padding: 20px 24px;">
      <h1 style="margin: 0; font-size: 20px; color: #fff; letter-spacing: 0.5px;">RasoKart — Signature Failure Alert</h1>
      <p style="margin: 4px 0 0; color: #fca5a5; font-size: 13px;">Elevated HMAC signature failures detected</p>
    </div>
    <div style="padding: 24px;">
      <p style="margin: 0 0 16px; color: #f87171; font-size: 14px; font-weight: 600;">
        ⚠️ <strong>${failureCount}</strong> callback signature failure${failureCount === 1 ? "" : "s"} detected in the last 24 hours (threshold: ${threshold}).
      </p>
      <p style="margin: 0 0 20px; color: #a1a1aa; font-size: 13px;">
        This may indicate misconfigured callback secrets on one or more merchant integrations, or a potential replay/spoofing attempt. Please review the callback logs for details.
      </p>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr style="background: #111;">
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px; width: 50%;">Failures (last 24h)</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px; color: #f87171; font-weight: 600;">${failureCount}</td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; color: #a1a1aa; font-size: 13px;">Alert Threshold</td>
          <td style="padding: 10px 14px; border: 1px solid #2a2a2a; font-size: 13px;">${threshold}</td>
        </tr>
      </table>

      <div style="text-align: center; margin-bottom: 20px;">
        <a href="${adminLink}"
           style="display: inline-block; background: #7c3aed; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-size: 14px; font-weight: 600; letter-spacing: 0.3px;">
          View Callback Logs
        </a>
      </div>

      <p style="margin: 0; color: #71717a; font-size: 12px;">
        If the link above doesn't work, copy this URL into your browser:<br>
        <span style="color: #818cf8;">${adminLink}</span>
      </p>
    </div>
    <div style="padding: 14px 24px; background: #111; border-top: 1px solid #2a2a2a;">
      <p style="margin: 0; color: #52525b; font-size: 11px;">
        This alert was sent by RasoKart. To stop receiving signature failure alerts, update your notification preferences in Admin Settings.
      </p>
    </div>
  </div>
</body>
</html>`;
}

export async function checkAndAlertSignatureFailures(): Promise<void> {
  try {
    const { threshold, cooldownHours } = await loadAlertConfig();

    if (lastAlertSentAt != null) {
      const cooldownMs = cooldownHours * 60 * 60 * 1000;
      if (Date.now() - lastAlertSentAt.getTime() < cooldownMs) {
        logger.debug(
          { lastAlertSentAt, cooldownHours },
          "Signature failure alert suppressed — within cooldown window"
        );
        return;
      }
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [{ total }] = await db
      .select({ total: count() })
      .from(callbackLogsTable)
      .where(
        and(
          eq(callbackLogsTable.signatureVerified, false),
          gte(callbackLogsTable.createdAt, since),
        )
      );

    if (total < threshold) {
      logger.debug(
        { total, threshold },
        "Signature failure count below threshold — no alert"
      );
      return;
    }

    const recipients = await getAdminEmails();

    if (recipients.length === 0) {
      logger.info(
        { total, threshold },
        "No admins opted in to signature failure alert emails — skipping"
      );
      return;
    }

    const html = buildAlertHtml(total, threshold);
    const subject = `[RasoKart] ⚠️ Signature Failure Alert — ${total} failure${total === 1 ? "" : "s"} in last 24h`;

    const results = await Promise.allSettled(
      recipients.map((email) => sendMail({ to: email, subject, html }))
    );

    const sent = results.filter((r) => r.status === "fulfilled" && r.value).length;
    const failed = results.length - sent;

    lastAlertSentAt = new Date();

    logger.info(
      { total, threshold, totalAdmins: recipients.length, sent, failed },
      "Signature failure alert emails dispatched"
    );
  } catch (err) {
    logger.error({ err }, "Failed to check/send signature failure alert");
  }
}
