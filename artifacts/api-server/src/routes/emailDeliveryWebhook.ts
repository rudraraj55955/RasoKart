import crypto from "node:crypto";
import { Router } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { emailDeliveryEventsTable, emailDeliveryLogsTable } from "@workspace/db/schema";
import { hashIdentifier } from "../helpers/otp";
import {
  sanitizeEmailDeliveryReason,
  type EmailDeliveryStatus,
} from "../helpers/emailDelivery";

const router = Router();

type NormalizedStatus = EmailDeliveryStatus;

function firstString(
  value: unknown,
  keys: string[],
  maxLength = 255,
  preserveWhitespace = false,
): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return (preserveWhitespace ? candidate : candidate.trim()).slice(0, maxLength);
    }
  }
  for (const nested of Object.values(record)) {
    const result = firstString(nested, keys, maxLength, preserveWhitespace);
    if (result) return result;
  }
  return null;
}

function normalizeStatus(value: string | null): NormalizedStatus | null {
  const status = value?.toLowerCase().replace(/[\s-]+/g, "_");
  if (!status) return null;
  if (["delivered", "delivery", "delivered_to_recipient"].includes(status)) return "delivered";
  if (["bounce", "bounced", "hard_bounce", "soft_bounce", "rejected"].includes(status)) return "bounced";
  if (["failed", "failure", "delivery_failed", "permanent_failure"].includes(status)) return "failed";
  if (["accepted", "queued", "sent", "processed", "submitted"].includes(status)) return "accepted";
  return null;
}

function hasValidSecret(req: any): boolean {
  const expected = process.env.MSG91_EMAIL_WEBHOOK_SECRET || process.env.MSG91_AUTH_KEY;
  if (!expected) return false;
  const provided =
    req.get("x-msg91-webhook-secret") ||
    req.get("x-webhook-secret") ||
    (req.get("authorization")?.startsWith("Bearer ") ? req.get("authorization").slice(7) : "");
  if (!provided || provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

// POST /api/webhooks/email-delivery
// Stores no provider payload, recipient address, message body, or reset data.
router.post("/", async (req, res, next) => {
  try {
    if (!hasValidSecret(req)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const payload = req.body ?? {};
    const status = normalizeStatus(firstString(payload, ["status", "event", "event_type", "delivery_status", "type"]));
    if (!status) {
      res.status(400).json({ error: "Unsupported delivery status" });
      return;
    }

    const providerMessageId = firstString(payload, ["request_id", "requestId", "message_id", "messageId", "email_id"]);
    const providerEventId = firstString(
      payload,
      ["event_id", "eventId", "webhook_id", "webhookId"],
      1025,
      true,
    );
    if (providerEventId && providerEventId.length > 1024) {
      res.status(400).json({ error: "Event identifier is too long" });
      return;
    }
    const recipient = firstString(payload, ["email", "recipient", "to"]);
    const reason = firstString(payload, ["reason", "error", "description", "failure_reason"]);

    const conditions = [eq(emailDeliveryLogsTable.purpose, "PASSWORD_RESET")];
    if (providerMessageId) {
      conditions.push(eq(emailDeliveryLogsTable.providerMessageId, providerMessageId));
    } else if (recipient) {
      conditions.push(eq(emailDeliveryLogsTable.recipientHash, hashIdentifier(recipient.toLowerCase())));
    } else {
      res.status(400).json({ error: "Message identifier or recipient is required" });
      return;
    }

    const [existing] = await db
      .select({
        id: emailDeliveryLogsTable.id,
        provider: emailDeliveryLogsTable.provider,
        providerMessageId: emailDeliveryLogsTable.providerMessageId,
        status: emailDeliveryLogsTable.status,
      })
      .from(emailDeliveryLogsTable)
      .where(and(...conditions))
      .orderBy(desc(emailDeliveryLogsTable.createdAt))
      .limit(1);

    if (!existing) {
      // A valid but uncorrelated event is acknowledged without revealing
      // whether a reset was requested for the supplied provider identifier.
      res.json({ updated: false });
      return;
    }

    const failureSummary = status === "delivered" ? null : sanitizeEmailDeliveryReason(reason);
    const updateValues = {
      status,
      errorReason: failureSummary,
      updatedAt: new Date(),
      lastEventAt: new Date(),
      ...(providerEventId ? { providerEventId } : {}),
    };
    try {
      const result = await db.transaction(async (tx) => {
        const eventValues = {
          deliveryLogId: existing.id,
          provider: existing.provider,
          providerMessageId: providerMessageId ?? existing.providerMessageId,
          providerEventId,
          status,
          failureSummary,
        };
        const inserted = providerEventId
          ? await tx
            .insert(emailDeliveryEventsTable)
            .values(eventValues)
            .onConflictDoNothing()
            .returning({ id: emailDeliveryEventsTable.id })
          : await tx
            .insert(emailDeliveryEventsTable)
            .values(eventValues)
            .returning({ id: emailDeliveryEventsTable.id });

        if (inserted.length === 0) {
          return { updated: false, duplicate: true };
        }

        const statusRank = sql<number>`CASE ${emailDeliveryLogsTable.status}
          WHEN 'accepted' THEN 1
          WHEN 'bounced' THEN 2
          WHEN 'failed' THEN 2
          WHEN 'delivered' THEN 3
          ELSE 1
        END`;
        const incomingRank = status === "delivered" ? 3 : status === "accepted" ? 1 : 2;
        const transitionAllowed = sql`
          (${emailDeliveryLogsTable.status} = ${status}
            OR ${statusRank} < ${incomingRank})
        `;
        const updated = await tx
          .update(emailDeliveryLogsTable)
          .set(updateValues)
          .where(and(
            eq(emailDeliveryLogsTable.id, existing.id),
            transitionAllowed,
          ))
          .returning({ id: emailDeliveryLogsTable.id });

        return updated.length > 0
          ? { updated: true }
          : { updated: false, stale: true };
      });

      res.json(result);
      return;
    } catch (err: any) {
      if (providerEventId && err?.code === "23505") {
        res.json({ updated: false, duplicate: true });
        return;
      }
      throw err;
    }

  } catch (err) {
    next(err);
  }
});

export default router;