import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { db } from "@workspace/db";
import { emailDeliveryEventsTable, emailDeliveryLogsTable, usersTable } from "@workspace/db/schema";
import adminEmailDeliveryRouter from "./adminEmailDelivery";
import emailDeliveryWebhookRouter from "./emailDeliveryWebhook";
import { generateToken } from "../middlewares/auth";
import {
  shouldApplyEmailDeliveryStatus,
  type EmailDeliveryStatus,
} from "../helpers/emailDelivery";

const WEBHOOK_SECRET = "email-delivery-test-secret";
const MESSAGE_ID = "provider-message-2771";

type StoredDelivery = {
  id: number;
  status: string;
  providerEventId: string | null;
  errorReason: string | null;
};

let server: http.Server;
let stored: StoredDelivery;
let originalSelect: typeof db.select;
let originalUpdate: typeof db.update;
let originalInsert: typeof db.insert;
let originalTransaction: typeof db.transaction;
const seenEventIds = new Set<string>();
let insertedEventCount = 0;
let updateErrorOnce = false;

function request(body: Record<string, unknown>, authenticated = true) {
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
        ...(authenticated ? { "x-msg91-webhook-secret": WEBHOOK_SECRET } : {}),
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

function installDeliveryDbMock() {
  (db as any).select = () => ({
    from: () => ({
      where: () => {
        return {
          orderBy: () => ({
            limit: async () => [{
              id: stored.id,
              provider: "MSG91",
              providerMessageId: MESSAGE_ID,
              status: stored.status,
            }],
          }),
        };
      },
    }),
  });
  (db as any).insert = () => ({
    values: (values: { providerEventId: string | null }) => {
      const returning = async () => {
        insertedEventCount += 1;
        return [{ id: insertedEventCount }];
      };
      return {
        returning,
        onConflictDoNothing: () => ({
          returning: async () => {
            if (values.providerEventId && seenEventIds.has(values.providerEventId)) return [];
            if (values.providerEventId) seenEventIds.add(values.providerEventId);
            insertedEventCount += 1;
            return [{ id: insertedEventCount }];
          },
        }),
      };
    },
  });
  (db as any).update = () => ({
    set: (values: Partial<StoredDelivery>) => ({
      where: () => ({
        returning: async () => {
          if (updateErrorOnce) {
            updateErrorOnce = false;
            throw new Error("simulated delivery update failure");
          }
          const incoming = values.status as EmailDeliveryStatus;
          const current = stored.status as EmailDeliveryStatus;
          const eventIsNew = !values.providerEventId || values.providerEventId !== stored.providerEventId;
          if (!eventIsNew || !shouldApplyEmailDeliveryStatus(current, incoming)) return [];
          stored = { ...stored, ...values };
          return [{ id: stored.id }];
        },
      }),
    }),
  });
  (db as any).transaction = async (callback: (tx: {
    insert: typeof db.insert;
    update: typeof db.update;
  }) => Promise<unknown>) => {
    const eventSnapshot = new Set(seenEventIds);
    const eventCountSnapshot = insertedEventCount;
    try {
      return await callback({
        insert: db.insert,
        update: db.update,
      });
    } catch (error) {
      seenEventIds.clear();
      for (const eventId of eventSnapshot) seenEventIds.add(eventId);
      insertedEventCount = eventCountSnapshot;
      throw error;
    }
  };
}

describe("POST /api/webhooks/email-delivery", () => {
  before(async () => {
    process.env["MSG91_EMAIL_WEBHOOK_SECRET"] = WEBHOOK_SECRET;
    originalSelect = db.select;
    originalUpdate = db.update;
    originalInsert = db.insert;
    originalTransaction = db.transaction;
    const app = express();
    app.use(express.json());
    app.use("/api/webhooks/email-delivery", emailDeliveryWebhookRouter);
    app.use((_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({ error: "Internal server error" });
    });
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  });

  beforeEach(() => {
    stored = { id: 2771, status: "accepted", providerEventId: null, errorReason: null };
    seenEventIds.clear();
    insertedEventCount = 0;
    updateErrorOnce = false;
    installDeliveryDbMock();
  });

  afterEach(() => {
    (db as any).select = originalSelect;
    (db as any).update = originalUpdate;
    (db as any).insert = originalInsert;
    (db as any).transaction = originalTransaction;
  });

  after(async () => {
    delete process.env["MSG91_EMAIL_WEBHOOK_SECRET"];
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  });

  it("rejects an unauthenticated callback without touching the delivery record", async () => {
    const response = await request({ status: "delivered", message_id: MESSAGE_ID }, false);
    assert.equal(response.status, 401);
    assert.deepEqual(response.body, { error: "Unauthorized" });
    assert.equal(stored.status, "accepted");
  });

  it("authenticates callbacks and prevents out-of-order terminal downgrades", async () => {
    let response = await request({
      status: "delivered",
      message_id: MESSAGE_ID,
      event_id: "event-delivered",
    });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { updated: true });
    assert.equal(stored.status, "delivered");

    installDeliveryDbMock();
    response = await request({
      status: "failed",
      message_id: MESSAGE_ID,
      event_id: "event-failed-late",
      reason: "Delayed provider failure",
    });
    assert.deepEqual(response.body, { updated: false, stale: true });
    assert.equal(stored.status, "delivered");

    installDeliveryDbMock();
    response = await request({
      status: "bounced",
      message_id: MESSAGE_ID,
      event_id: "event-bounced-late",
    });
    assert.deepEqual(response.body, { updated: false, stale: true });
    assert.equal(stored.status, "delivered");
  });

  it("deduplicates replayed provider event IDs", async () => {
    const payload = {
      status: "bounced",
      message_id: MESSAGE_ID,
      event_id: "event-replayed",
      reason: "Mailbox unavailable",
    };
    const first = await request(payload);
    assert.deepEqual(first.body, { updated: true });
    assert.equal(stored.status, "bounced");

    installDeliveryDbMock();
    const replay = await request(payload);
    assert.deepEqual(replay.body, { updated: false, duplicate: true });
    assert.equal(stored.status, "bounced");
  });

  it("records correlated callbacks that do not include a provider event ID", async () => {
    const response = await request({
      status: "failed",
      message_id: MESSAGE_ID,
      reason: "OTP 654321 at https://example.test/reset?token=hidden",
    });

    assert.deepEqual(response.body, { updated: true });
    assert.equal(insertedEventCount, 1);
    assert.equal(stored.status, "failed");
    assert.equal(stored.errorReason, "Provider reported delivery failure");
  });

  it("rolls back the event claim when the status update fails so a retry can succeed", async () => {
    const payload = {
      status: "delivered",
      message_id: MESSAGE_ID,
      event_id: "event-retry-after-update-error",
    };
    updateErrorOnce = true;
    const failed = await request(payload);
    assert.equal(failed.status, 500);
    assert.equal(seenEventIds.size, 0);
    assert.equal(stored.status, "accepted");

    installDeliveryDbMock();
    const retry = await request(payload);
    assert.deepEqual(retry.body, { updated: true });
    assert.equal(seenEventIds.size, 1);
    assert.equal(stored.status, "delivered");
  });

  it("keeps distinct event IDs that share their first 255 characters", async () => {
    const sharedPrefix = "e".repeat(255);
    const first = await request({
      status: "bounced",
      message_id: MESSAGE_ID,
      event_id: `${sharedPrefix}-first`,
    });
    assert.deepEqual(first.body, { updated: true });

    installDeliveryDbMock();
    const second = await request({
      status: "delivered",
      message_id: MESSAGE_ID,
      event_id: `${sharedPrefix}-second`,
    });
    assert.deepEqual(second.body, { updated: true });
    assert.equal(stored.status, "delivered");
    assert.equal(seenEventIds.size, 2);
  });

  it("keeps opaque event IDs distinct when they differ only by whitespace", async () => {
    const first = await request({
      status: "bounced",
      message_id: MESSAGE_ID,
      event_id: "opaque-event-id",
    });
    assert.deepEqual(first.body, { updated: true });

    installDeliveryDbMock();
    const second = await request({
      status: "delivered",
      message_id: MESSAGE_ID,
      event_id: " opaque-event-id ",
    });
    assert.deepEqual(second.body, { updated: true });
    assert.equal(stored.status, "delivered");
    assert.equal(seenEventIds.size, 2);
  });

  it("does not return or persist reset secrets supplied in callback fields", async () => {
    const secrets = {
      otp: "654321",
      token: "reset-token-secret",
      password: "password-secret",
      link: "https://example.test/reset?token=secret",
      hash: "reset-hash-secret",
      messageBody: "Your reset code is 654321",
    };
    const response = await request({
      status: "failed",
      message_id: MESSAGE_ID,
      event_id: "event-sensitive",
      reason: `OTP ${secrets.otp}; token=${secrets.token}; reset link ${secrets.link}`,
      ...secrets,
    });

    assert.deepEqual(response.body, { updated: true });
    assert.equal(stored.errorReason, "Provider reported delivery failure");
    const exposed = JSON.stringify({ response: response.body, stored });
    for (const forbiddenKey of ["otp", "token", "password", "link", "hash", "messageBody"]) {
      assert.equal(
        Object.hasOwn(response.body, forbiddenKey),
        false,
        `response must not include ${forbiddenKey}`,
      );
    }
    for (const value of Object.values(secrets)) {
      assert.equal(exposed.includes(value), false, `must not expose or persist ${value}`);
    }
  });
});

const LIST_LOG_FIELDS = [
  "id",
  "purpose",
  "provider",
  "providerMessageId",
  "status",
  "errorReason",
  "createdAt",
  "updatedAt",
  "lastEventAt",
].sort();

const EVENT_FIELDS = [
  "id",
  "provider",
  "providerMessageId",
  "providerEventId",
  "status",
  "failureSummary",
  "receivedAt",
].sort();

const SENSITIVE_DELIVERY_FIELDS = [
  "recipient",
  "recipientEmail",
  "email",
  "to",
  "otp",
  "token",
  "password",
  "link",
  "resetLink",
  "hash",
  "message",
  "messageBody",
  "body",
];

function assertSanitizedRows(
  rows: unknown,
  allowedFields: string[],
  label: string,
) {
  assert.ok(Array.isArray(rows), `${label} must be an array`);
  for (const row of rows) {
    assert.ok(row && typeof row === "object" && !Array.isArray(row), `${label} entries must be objects`);
    assert.deepEqual(Object.keys(row as Record<string, unknown>).sort(), allowedFields);
    const serialized = JSON.stringify(row);
    for (const field of SENSITIVE_DELIVERY_FIELDS) {
      assert.equal(
        Object.hasOwn(row as Record<string, unknown>, field),
        false,
        `${label} must not expose sensitive field ${field}`,
      );
      assert.equal(
        serialized.includes(`sensitive-${field}`),
        false,
        `${label} must not expose sensitive value for ${field}`,
      );
    }
  }
}

describe("GET /api/admin/email-delivery sanitized contracts", () => {
  let adminServer: http.Server;
  let savedSelect: typeof db.select;
  let savedInsert: typeof db.insert;

  const users = {
    merchant: {
      id: 801,
      email: "merchant@example.test",
      role: "merchant",
      isActive: true,
      isSuperAdmin: false,
      passwordUpdatedAt: null,
    },
    admin: {
      id: 802,
      email: "admin@example.test",
      role: "admin",
      isActive: true,
      isSuperAdmin: true,
      passwordUpdatedAt: null,
    },
  };

  function adminRequest(path: string, token?: string) {
    const address = adminServer.address() as { port: number };
    return new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
      const req = http.request({
        hostname: "127.0.0.1",
        port: address.port,
        path: `/api/admin/email-delivery${path}`,
        headers: token ? { authorization: `Bearer ${token}` } : {},
      }, (res) => {
        let raw = "";
        res.on("data", (chunk: Buffer) => { raw += chunk.toString(); });
        res.on("end", () => resolve({
          status: res.statusCode ?? 0,
          body: JSON.parse(raw) as Record<string, unknown>,
        }));
      });
      req.on("error", reject);
      req.end();
    });
  }

  function projectedRow(selection: Record<string, unknown>) {
    return Object.fromEntries(Object.keys(selection).map((key) => {
      const values: Record<string, unknown> = {
        id: 901,
        purpose: "password_reset",
        provider: "MSG91",
        providerMessageId: "provider-message-sanitized",
        providerEventId: "provider-event-sanitized",
        status: "delivered",
        errorReason: null,
        failureSummary: null,
        createdAt: new Date("2026-09-16T10:00:00.000Z"),
        updatedAt: new Date("2026-09-16T10:01:00.000Z"),
        lastEventAt: new Date("2026-09-16T10:01:00.000Z"),
        receivedAt: new Date("2026-09-16T10:01:00.000Z"),
      };
      return [key, values[key] ?? `sensitive-${key}`];
    }));
  }

  before(async () => {
    savedSelect = db.select;
    savedInsert = db.insert;
    const app = express();
    app.use("/api/admin/email-delivery", adminEmailDeliveryRouter);
    app.use((_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({ error: "Internal server error" });
    });
    adminServer = http.createServer(app);
    await new Promise<void>((resolve) => adminServer.listen(0, "127.0.0.1", resolve));
  });

  beforeEach(() => {
    (db as any).select = (selection?: Record<string, unknown>) => ({
      from: (table: unknown) => {
        if (table === usersTable) {
          return {
            where: () => ({
              limit: async () => [currentUser],
            }),
          };
        }
        if (table === emailDeliveryLogsTable && selection && Object.hasOwn(selection, "total")) {
          return { where: async () => [{ total: 1 }] };
        }
        if (table === emailDeliveryLogsTable) {
          const row = projectedRow(selection ?? {});
          return {
            where: () => ({
              orderBy: () => ({
                limit: () => ({
                  offset: async () => [row],
                }),
              }),
            }),
          };
        }
        if (table === emailDeliveryEventsTable) {
          const row = projectedRow(selection ?? {});
          return {
            where: () => ({
              orderBy: async () => [row],
            }),
          };
        }
        throw new Error("Unexpected table in admin delivery test");
      },
    });
    (db as any).insert = () => ({
      values: () => Promise.resolve(),
    });
  });

  let currentUser = users.admin;

  afterEach(() => {
    (db as any).select = savedSelect;
    (db as any).insert = savedInsert;
    currentUser = users.admin;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => adminServer.close((err) => err ? reject(err) : resolve()));
  });

  it("rejects unauthenticated delivery history requests", async () => {
    const list = await adminRequest("/");
    const events = await adminRequest("/901/events");
    assert.equal(list.status, 401);
    assert.equal(events.status, 401);
  });

  it("rejects authenticated users without admin authorization", async () => {
    currentUser = users.merchant;
    const token = generateToken({ userId: currentUser.id, role: currentUser.role });
    const list = await adminRequest("/", token);
    const events = await adminRequest("/901/events", token);
    assert.equal(list.status, 403);
    assert.equal(events.status, 403);
  });

  it("allowlists list response fields and rejects nested recipient or reset-secret data", async () => {
    const token = generateToken({ userId: currentUser.id, role: currentUser.role });
    const response = await adminRequest("/", token);
    assert.equal(response.status, 200);
    assert.deepEqual(Object.keys(response.body).sort(), ["limit", "logs", "page", "total", "totalPages"]);
    assertSanitizedRows(response.body["logs"], LIST_LOG_FIELDS, "delivery logs");
  });

  it("allowlists event-history fields and rejects nested recipient or reset-secret data", async () => {
    const token = generateToken({ userId: currentUser.id, role: currentUser.role });
    const response = await adminRequest("/901/events", token);
    assert.equal(response.status, 200);
    assert.deepEqual(Object.keys(response.body), ["events"]);
    assertSanitizedRows(response.body["events"], EVENT_FIELDS, "delivery events");
  });
});
