import {
  type SmtpConfig,
  type MailOptions,
  type SendResult,
  getSmtpConfigFromEnv,
  sendMailWithConfig,
} from "@workspace/mailer";
import { logger } from "../lib/logger";
import { db, systemSettingsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

export type { SmtpConfig, MailOptions, SendResult };

/** Maps a raw SendResult into a human-readable, admin-safe error string. */
export function humanizeMailError(result: SendResult): string {
  const code = result.code ?? "";
  const msg = result.error ?? "";

  if (code === "SMTP_NOT_CONFIGURED") {
    return "SMTP not configured — go to Settings → Email to enter your SMTP host, username, and password.";
  }
  if (code === "ECONNREFUSED" || msg.includes("ECONNREFUSED")) {
    return "SMTP connection refused — verify the host and port in Settings → Email.";
  }
  if (code === "ENOTFOUND" || msg.includes("ENOTFOUND")) {
    return "SMTP hostname not found — check the host in Settings → Email.";
  }
  if (code === "ETIMEDOUT" || msg.includes("ETIMEDOUT") || msg.includes("timed out")) {
    return "SMTP connection timed out — the server did not respond in time. Check host/port.";
  }
  if (code === "EAUTH" || msg.includes("535") || msg.includes("authentication") || msg.includes("credentials")) {
    return "SMTP authentication failed — verify the username and password in Settings → Email.";
  }
  if (code === "EENVELOPE" || msg.includes("envelope") || msg.includes("Sender address")) {
    return "SMTP rejected the sender address — check the From address in Settings → Email.";
  }

  const raw = msg.slice(0, 200);
  return raw || "Email delivery failed — check SMTP configuration in Settings → Email.";
}

export async function getSmtpConfig(): Promise<SmtpConfig | null> {
  const KEYS = ["smtp_host", "smtp_port", "smtp_user", "smtp_pass", "smtp_from"] as const;

  let dbConfig: Record<string, string | null | undefined> = {};
  try {
    const rows = await db
      .select()
      .from(systemSettingsTable)
      .where(inArray(systemSettingsTable.key, [...KEYS]));
    dbConfig = Object.fromEntries(rows.map(r => [r.key, r.value]));
  } catch {
    // DB unavailable — fall back to env vars only
  }

  const host = dbConfig["smtp_host"] ?? process.env["SMTP_HOST"] ?? null;
  const user = dbConfig["smtp_user"] ?? process.env["SMTP_USER"] ?? null;
  const pass = dbConfig["smtp_pass"] ?? process.env["SMTP_PASS"] ?? null;

  if (!host || !user || !pass) return null;

  const portRaw = dbConfig["smtp_port"] ?? process.env["SMTP_PORT"] ?? "587";
  const port = parseInt(portRaw as string, 10);
  const from =
    dbConfig["smtp_from"] ?? process.env["SMTP_FROM"] ?? "RasoKart <noreply@rasokart.com>";

  return { host, port: isNaN(port) ? 587 : port, user, pass, from };
}

/**
 * Rich send — returns full result including provider message ID and structured error.
 * Use this when you need to store the message ID or failure code (e.g. reconciliation reports).
 */
export async function sendMailRich(opts: MailOptions): Promise<SendResult> {
  const cfg = await getSmtpConfig();
  if (!cfg) {
    logger.warn("SMTP not configured (SMTP_HOST, SMTP_USER, SMTP_PASS required) — skipping email");
    return {
      ok: false,
      code: "SMTP_NOT_CONFIGURED",
      error: "SMTP not configured — go to Settings → Email to enter your SMTP host, username, and password.",
    };
  }

  const result = await sendMailWithConfig(cfg, opts);
  if (result.ok) {
    logger.info({ to: opts.to, subject: opts.subject, messageId: result.messageId }, "Email sent successfully");
  } else {
    logger.error({ to: opts.to, subject: opts.subject, error: result.error, code: result.code }, "Failed to send email");
  }
  return result;
}

/**
 * Boolean wrapper — backward-compatible with all existing callers.
 * Returns true if the email was accepted by the SMTP server, false otherwise.
 */
export async function sendMail(opts: MailOptions): Promise<boolean> {
  const result = await sendMailRich(opts);
  return result.ok;
}

export { getSmtpConfigFromEnv };
