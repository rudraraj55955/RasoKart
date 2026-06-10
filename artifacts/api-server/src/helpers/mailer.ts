import nodemailer from "nodemailer";
import { logger } from "../lib/logger";

function createTransport() {
  const host = process.env["SMTP_HOST"];
  const user = process.env["SMTP_USER"];
  const pass = process.env["SMTP_PASS"];

  if (!host || !user || !pass) {
    return null;
  }

  const port = parseInt(process.env["SMTP_PORT"] ?? "587", 10);
  const secure = port === 465;

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
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

export async function sendMail(opts: MailOptions): Promise<boolean> {
  const transport = createTransport();
  if (!transport) {
    logger.warn("SMTP not configured (SMTP_HOST, SMTP_USER, SMTP_PASS required) — skipping email");
    return false;
  }

  const from = process.env["SMTP_FROM"] ?? `RasoKart <noreply@rasokart.com>`;

  try {
    await transport.sendMail({
      from,
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
