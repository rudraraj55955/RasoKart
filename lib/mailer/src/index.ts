import nodemailer from "nodemailer";

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

export interface MailOptions {
  to: string;
  cc?: string;
  subject: string;
  html: string;
  attachments?: Array<{
    filename: string;
    content: string | Buffer;
    contentType: string;
  }>;
}

export interface SendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
  code?: string;
}

export function getSmtpConfigFromEnv(): SmtpConfig | null {
  const host = process.env["SMTP_HOST"] ?? null;
  const user = process.env["SMTP_USER"] ?? null;
  const pass = process.env["SMTP_PASS"] ?? null;

  if (!host || !user || !pass) return null;

  const portRaw = process.env["SMTP_PORT"] ?? "587";
  const port = parseInt(portRaw, 10);
  const from =
    process.env["SMTP_FROM"] ?? "RasoKart <noreply@rasokart.com>";

  return { host, port: isNaN(port) ? 587 : port, user, pass, from };
}

export function createTransport(cfg: SmtpConfig) {
  const secure = cfg.port === 465;
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure,
    auth: { user: cfg.user, pass: cfg.pass },
    connectionTimeout: 10_000,
    greetingTimeout: 8_000,
    socketTimeout: 15_000,
  });
}

export async function sendMailWithConfig(
  cfg: SmtpConfig,
  opts: MailOptions,
): Promise<SendResult> {
  const transport = createTransport(cfg);
  try {
    const info = await transport.sendMail({
      from: cfg.from,
      to: opts.to,
      ...(opts.cc ? { cc: opts.cc } : {}),
      subject: opts.subject,
      html: opts.html,
      attachments: opts.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
    });
    return { ok: true, messageId: info.messageId };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message ?? String(err),
      code: err?.code ?? (err?.responseCode ? String(err.responseCode) : undefined),
    };
  }
}
