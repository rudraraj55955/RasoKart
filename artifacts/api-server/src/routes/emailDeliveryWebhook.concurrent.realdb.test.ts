import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { emailDeliveryEventsTable, emailDeliveryLogsTable } from "@workspace/db/schema";
import emailDeliveryWebhookRouter from "./emailDeliveryWebhook";

const WEBHOOK_SECRET = "email-delivery-concurrency-test-secret";
const createdIds: number[] = [];
let server: http.Server;

function postCallback(body: Record<string, unknown>) {
  const address = server.address() as { port: number };
  const data = JSON.stringify(body);
  return new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port: address.port,
      path: "/api/webhooks/email-delivery",
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(data),
        "x-msg91-webhook-secret": WEBHOOK_SECRET,
      },
    }, (res) => {
      let raw = "";
      res.on("data", (chunk: Buffer) => { raw += chunk.toString(); });
      res.on("end", () => resolve({
        status: res.statusCode ?? 0,
        body: JSON.parse(raw) as Record<string, unknown>,
      }));
    });
    req.on("error", reject);
    req.end(data);
  });
}

describe("email delivery webhook concurrency (real DB)", () => {
  before(async () => {
    process.env["MSG91_EMAIL_WEBHOOK_SECRET"] = WEBHOOK_SECRET;
    const app = express();
    app.use(express.json());
    app.use("/api/webhooks/email-delivery", emailDeliveryWebhookRouter);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  });

  after(async () => {
    for (const id of createdIds) {
      await db.delete(emailDeliveryEventsTable).where(eq(emailDeliveryEventsTable.deliveryLogId, id));
      await db.delete(emailDeliveryLogsTable).where(eq(emailDeliveryLogsTable.id, id));
    }
    delete process.env["MSG91_EMAIL_WEBHOOK_SECRET"];
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  });

  it("keeps delivered when delivered and failed callbacks race", async () => {
    for (let iteration = 0; iteration < 5; iteration += 1) {
      const providerMessageId = `concurrent-delivery-${Date.now()}-${iteration}`;
      const [created] = await db.insert(emailDeliveryLogsTable).values({
        recipientHash: `recipient-hash-${iteration}`,
        recipientMasked: "t***@example.test",
        purpose: "PASSWORD_RESET",
        provider: "MSG91",
        status: "accepted",
        providerMessageId,
      }).returning({ id: emailDeliveryLogsTable.id });
      assert.ok(created);
      createdIds.push(created.id);

      const [delivered, failed] = await Promise.all([
        postCallback({
          status: "delivered",
          message_id: providerMessageId,
          event_id: `${providerMessageId}-delivered`,
        }),
        postCallback({
          status: "failed",
          message_id: providerMessageId,
          event_id: `${providerMessageId}-failed`,
          reason: "Your code is 654321",
        }),
      ]);

      assert.equal(delivered.status, 200);
      assert.equal(failed.status, 200);
      const [persisted] = await db
        .select({
          status: emailDeliveryLogsTable.status,
          errorReason: emailDeliveryLogsTable.errorReason,
        })
        .from(emailDeliveryLogsTable)
        .where(eq(emailDeliveryLogsTable.id, created.id))
        .limit(1);
      assert.equal(persisted?.status, "delivered");
      assert.equal(persisted?.errorReason, null);

      const events = await db
        .select({ status: emailDeliveryEventsTable.status })
        .from(emailDeliveryEventsTable)
        .where(eq(emailDeliveryEventsTable.deliveryLogId, created.id));
      assert.equal(events.length, 2);
      assert.deepEqual(new Set(events.map((event) => event.status)), new Set(["delivered", "failed"]));
    }
  });

  it("records an event ID once and acknowledges every later replay", async () => {
    const providerMessageId = `replayed-delivery-${Date.now()}`;
    const providerEventId = `${providerMessageId}-event`;
    const [created] = await db.insert(emailDeliveryLogsTable).values({
      recipientHash: "replayed-recipient-hash",
      recipientMasked: "r***@example.test",
      purpose: "PASSWORD_RESET",
      provider: "MSG91",
      status: "accepted",
      providerMessageId,
    }).returning({ id: emailDeliveryLogsTable.id });
    assert.ok(created);
    createdIds.push(created.id);

    const first = await postCallback({
      status: "delivered",
      message_id: providerMessageId,
      event_id: providerEventId,
    });
    const replay = await postCallback({
      status: "failed",
      message_id: providerMessageId,
      event_id: providerEventId,
      reason: "Secret reset link https://example.test/reset?token=hidden",
    });

    assert.deepEqual(first.body, { updated: true });
    assert.deepEqual(replay.body, { updated: false, duplicate: true });

    const events = await db
      .select({
        status: emailDeliveryEventsTable.status,
        failureSummary: emailDeliveryEventsTable.failureSummary,
      })
      .from(emailDeliveryEventsTable)
      .where(eq(emailDeliveryEventsTable.deliveryLogId, created.id));
    assert.deepEqual(events, [{ status: "delivered", failureSummary: null }]);
  });

  it("records sanitized history for a callback without an event ID", async () => {
    const providerMessageId = `no-event-id-delivery-${Date.now()}`;
    const [created] = await db.insert(emailDeliveryLogsTable).values({
      recipientHash: "no-event-id-recipient-hash",
      recipientMasked: "n***@example.test",
      purpose: "PASSWORD_RESET",
      provider: "MSG91",
      status: "accepted",
      providerMessageId,
    }).returning({ id: emailDeliveryLogsTable.id });
    assert.ok(created);
    createdIds.push(created.id);

    const response = await postCallback({
      status: "failed",
      message_id: providerMessageId,
      reason: "OTP 654321 at https://example.test/reset?token=hidden",
    });
    assert.deepEqual(response.body, { updated: true });

    const events = await db
      .select({
        providerEventId: emailDeliveryEventsTable.providerEventId,
        status: emailDeliveryEventsTable.status,
        failureSummary: emailDeliveryEventsTable.failureSummary,
      })
      .from(emailDeliveryEventsTable)
      .where(eq(emailDeliveryEventsTable.deliveryLogId, created.id));
    assert.deepEqual(events, [{
      providerEventId: null,
      status: "failed",
      failureSummary: "Provider reported delivery failure",
    }]);
  });
});