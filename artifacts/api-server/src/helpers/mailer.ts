import nodemailer from "nodemailer";
import { logger } from "../lib/logger";
import { db, systemSettingsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
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

function createTransportFromConfig(cfg: SmtpConfig) {
  const secure = cfg.port === 465;
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure,
    auth: { user: cfg.user, pass: cfg.pass },
  });
}

export interface MailOptions {
  to: string;
  cc?: string;
  subject: string;
  html: string;
  attachments?: Array<{
    filename: string;
    content: string;
    contentType: string;
  }>;
}

/**
 * Returns true when the SMTP server is reachable and accepts the configured
 * credentials. Used by the scheduler to detect outage-clearing events.
 * Never throws — returns false on any error.
 */
export async function checkMailerHealth(): Promise<boolean> {
  const cfg = await getSmtpConfig().catch(() => null);
  if (!cfg) return false;
  const transport = createTransportFromConfig(cfg);
  try {
    await transport.verify();
    return true;
  } catch {
    return false;
  }
}

export async function sendMail(opts: MailOptions): Promise<boolean> {
  const cfg = await getSmtpConfig();
  if (!cfg) {
    logger.warn("SMTP not configured (SMTP_HOST, SMTP_USER, SMTP_PASS required) — skipping email");
    return false;
  }

  const transport = createTransportFromConfig(cfg);

  try {
    await transport.sendMail({
      from: cfg.from,
      to: opts.to,
      ...(opts.cc ? { cc: opts.cc } : {}),
      subject: opts.subject,
      html: opts.html,
      attachments: opts.attachments?.map(a => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
    });
    logger.info({ to: opts.to, cc: opts.cc, subject: opts.subject }, "Email sent successfully");
    return true;
  } catch (err) {
    logger.error({ err, to: opts.to, subject: opts.subject }, "Failed to send email");
    return false;
  }
}
