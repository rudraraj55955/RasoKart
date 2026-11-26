import crypto from "node:crypto";
import { db } from "@workspace/db";
import { emailDeliveryLogsTable } from "@workspace/db/schema";
import { hashIdentifier } from "./otp";

export type EmailDeliveryStatus = "accepted" | "delivered" | "bounced" | "failed";

const STATUS_RANK: Record<EmailDeliveryStatus, number> = {
  accepted: 1,
  bounced: 2,
  failed: 2,
  delivered: 3,
};

export function shouldApplyEmailDeliveryStatus(
  current: EmailDeliveryStatus,
  incoming: EmailDeliveryStatus,
): boolean {
  if (current === incoming) return true;
  return STATUS_RANK[incoming] > STATUS_RANK[current];
}

export function sanitizeEmailDeliveryReason(reason: string | null): string | null {
  return reason?.trim() ? "Provider reported delivery failure" : null;
}

export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at < 1) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.length <= 2) return `${local[0] ?? ""}***@${domain}`;
  return `${local[0]}${"*".repeat(Math.min(local.length - 2, 5))}${local[local.length - 1]}@${domain}`;
}

export function extractProviderMessageId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const candidate = record.request_id ?? record.requestId ?? record.message_id ?? record.messageId ?? record.email_id;
  return typeof candidate === "string" && candidate.trim() ? candidate.trim().slice(0, 255) : null;
}

export function hashProviderPayload(payload: string): string {
  return crypto.createHash("sha256").update(payload).digest("hex");
}

export async function recordPasswordResetEmailDelivery(opts: {
  to: string;
  provider: string;
  status: EmailDeliveryStatus;
  providerMessageId?: string | null;
  errorReason?: string | null;
  otpId?: number | null;
  userId?: number | null;
}): Promise<void> {
  await db.insert(emailDeliveryLogsTable).values({
    recipientHash: hashIdentifier(opts.to),
    recipientMasked: maskEmail(opts.to),
    purpose: "PASSWORD_RESET",
    provider: opts.provider,
    status: opts.status,
    providerMessageId: opts.providerMessageId ?? null,
    errorReason: sanitizeEmailDeliveryReason(opts.errorReason ?? null),
    otpId: opts.otpId ?? null,
    userId: opts.userId ?? null,
  });
}