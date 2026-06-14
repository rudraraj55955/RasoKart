import { db, usersTable, quietHoursQueueTable } from "@workspace/db";
import { eq, and, lte, eq as drizzleEq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { sendMail } from "./mailer";

export interface QuietHoursUser {
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  quietHoursTimezone: string | null;
}

function parseHHMM(hhmm: string): { h: number; m: number } {
  const [h, m] = hhmm.split(":").map(Number);
  return { h: h ?? 0, m: m ?? 0 };
}

function toMinutes(h: number, m: number): number {
  return h * 60 + m;
}

function getCurrentMinutesInTz(tz: string): number {
  try {
    const now = new Date();
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    }).formatToParts(now);
    const hour = parseInt(parts.find(p => p.type === "hour")?.value ?? "0", 10);
    const minute = parseInt(parts.find(p => p.type === "minute")?.value ?? "0", 10);
    return toMinutes(hour, minute);
  } catch {
    return toMinutes(new Date().getUTCHours(), new Date().getUTCMinutes());
  }
}

export function isInQuietHours(user: QuietHoursUser): boolean {
  if (!user.quietHoursStart || !user.quietHoursEnd || !user.quietHoursTimezone) return false;

  const tz = user.quietHoursTimezone;
  const { h: sh, m: sm } = parseHHMM(user.quietHoursStart);
  const { h: eh, m: em } = parseHHMM(user.quietHoursEnd);

  const startMin = toMinutes(sh, sm);
  const endMin = toMinutes(eh, em);
  const nowMin = getCurrentMinutesInTz(tz);

  if (startMin < endMin) {
    return nowMin >= startMin && nowMin < endMin;
  } else {
    return nowMin >= startMin || nowMin < endMin;
  }
}

export function computeDeliverAfter(user: QuietHoursUser): Date {
  if (!user.quietHoursEnd || !user.quietHoursTimezone) {
    return new Date();
  }

  const tz = user.quietHoursTimezone;
  const { h: eh, m: em } = parseHHMM(user.quietHoursEnd);

  const now = new Date();

  const todayInTz = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  const [year, month, day] = todayInTz.split("-").map(Number);

  const endCandidateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(eh).padStart(2, "0")}:${String(em).padStart(2, "0")}:00`;

  const endToday = new Date(
    new Date(endCandidateStr + "+00:00").getTime() -
    getTimezoneOffsetMs(tz, new Date(endCandidateStr + "+00:00"))
  );

  const endTomorrow = new Date(endToday.getTime() + 24 * 60 * 60 * 1000);

  return endToday > now ? endToday : endTomorrow;
}

function getTimezoneOffsetMs(tz: string, date: Date): number {
  try {
    const utcStr = date.toLocaleString("en-US", { timeZone: "UTC" });
    const tzStr = date.toLocaleString("en-US", { timeZone: tz });
    const utcDate = new Date(utcStr);
    const tzDate = new Date(tzStr);
    return utcDate.getTime() - tzDate.getTime();
  } catch {
    return 0;
  }
}

export async function maybeQueueOrSendEmail(opts: {
  userId: number;
  to: string;
  subject: string;
  html: string;
}): Promise<boolean> {
  try {
    const [user] = await db
      .select({
        quietHoursStart: usersTable.quietHoursStart,
        quietHoursEnd: usersTable.quietHoursEnd,
        quietHoursTimezone: usersTable.quietHoursTimezone,
      })
      .from(usersTable)
      .where(eq(usersTable.id, opts.userId))
      .limit(1);

    if (user && isInQuietHours(user)) {
      const deliverAfter = computeDeliverAfter(user);
      await db.insert(quietHoursQueueTable).values({
        userId: opts.userId,
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
        deliverAfter,
      });
      logger.info(
        { userId: opts.userId, to: opts.to, subject: opts.subject, deliverAfter },
        "Email queued during quiet hours"
      );
      return true;
    }
  } catch (err) {
    logger.warn({ err, userId: opts.userId }, "Quiet hours check failed — sending immediately");
  }

  return sendMail({ to: opts.to, subject: opts.subject, html: opts.html });
}

function buildDigestHtml(entries: Array<{ subject: string; queuedAt: Date }>): string {
  const rows = entries
    .map(
      e => `
    <tr>
      <td style="padding:10px 14px;border:1px solid #2a2a2a;font-size:13px;color:#e5e7eb;">${escapeHtml(e.subject)}</td>
      <td style="padding:10px 14px;border:1px solid #2a2a2a;font-size:12px;color:#9ca3af;white-space:nowrap;">${e.queuedAt.toUTCString()}</td>
    </tr>`
    )
    .join("");

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Quiet Hours Digest — RasoKart</title>
</head>
<body style="margin:0;padding:0;background:#0f0f0f;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f0f;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#1a1a1a;border-radius:12px;overflow:hidden;border:1px solid #2a2a2a;">
          <tr>
            <td style="background:#111;padding:32px 40px;border-bottom:1px solid #2a2a2a;">
              <span style="font-size:22px;font-weight:700;color:#fff;letter-spacing:-0.5px;">Raso<span style="color:#f97316;">Kart</span></span>
            </td>
          </tr>
          <tr>
            <td style="padding:40px;">
              <h1 style="margin:0 0 8px;font-size:22px;font-weight:600;color:#f1f1f1;">Quiet Hours Digest</h1>
              <p style="margin:0 0 24px;font-size:14px;color:#9ca3af;line-height:1.6;">
                The following notifications were held during your quiet hours window and are now being delivered together.
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;border-collapse:collapse;">
                <thead>
                  <tr>
                    <th style="padding:8px 14px;border:1px solid #2a2a2a;text-align:left;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">Notification</th>
                    <th style="padding:8px 14px;border:1px solid #2a2a2a;text-align:left;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">Received At</th>
                  </tr>
                </thead>
                <tbody>
                  ${rows}
                </tbody>
              </table>
              <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.6;">
                You can adjust your quiet hours window in your <a href="${process.env["APP_URL"] ?? "https://rasokart.com"}/merchant/security" style="color:#f97316;text-decoration:none;">Security Settings</a>.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 40px;border-top:1px solid #2a2a2a;background:#111;">
              <p style="margin:0;font-size:12px;color:#6b7280;line-height:1.6;">
                This is an automated digest from RasoKart's quiet hours feature. Please do not reply to this email.
                For support, contact <a href="mailto:support@rasokart.com" style="color:#f97316;text-decoration:none;">support@rasokart.com</a>.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

export async function flushQuietHoursQueueForUser(userId: number): Promise<{ flushed: number }> {
  const now = new Date();

  const pending = await db
    .select()
    .from(quietHoursQueueTable)
    .where(
      and(
        eq(quietHoursQueueTable.userId, userId),
        drizzleEq(quietHoursQueueTable.flushed, false),
        lte(quietHoursQueueTable.deliverAfter, now)
      )
    );

  if (pending.length === 0) return { flushed: 0 };

  const to = pending[0]!.to;
  const count = pending.length;

  const subject = `[RasoKart] Quiet Hours Digest — ${count} notification${count === 1 ? "" : "s"}`;
  const html = buildDigestHtml(pending.map(e => ({ subject: e.subject, queuedAt: e.createdAt })));

  const sent = await sendMail({ to, subject, html });

  if (sent) {
    const ids = pending.map(e => e.id);
    for (const id of ids) {
      await db
        .update(quietHoursQueueTable)
        .set({ flushed: true, flushedAt: now })
        .where(eq(quietHoursQueueTable.id, id));
    }
    logger.info({ userId, count, to }, "Quiet hours digest sent and queue flushed");
  } else {
    logger.warn({ userId, to }, "Failed to send quiet hours digest");
  }

  return { flushed: sent ? count : 0 };
}

export async function flushAllReadyQuietHoursQueues(): Promise<{ usersProcessed: number; totalFlushed: number }> {
  const now = new Date();

  const pendingEntries = await db
    .select({ userId: quietHoursQueueTable.userId })
    .from(quietHoursQueueTable)
    .where(
      and(
        drizzleEq(quietHoursQueueTable.flushed, false),
        lte(quietHoursQueueTable.deliverAfter, now)
      )
    );

  const uniqueUserIds = [...new Set(pendingEntries.map(e => e.userId))];

  let totalFlushed = 0;
  for (const userId of uniqueUserIds) {
    const result = await flushQuietHoursQueueForUser(userId);
    totalFlushed += result.flushed;
  }

  return { usersProcessed: uniqueUserIds.length, totalFlushed };
}
