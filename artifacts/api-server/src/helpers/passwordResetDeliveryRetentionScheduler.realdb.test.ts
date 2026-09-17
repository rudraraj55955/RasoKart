import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { eq, inArray, sql } from "drizzle-orm";
import {
  cleanupRunHistoryTable,
  db,
  emailDeliveryLogsTable,
  systemConfigTable,
  SYSTEM_CONFIG_DEFAULTS,
  SYSTEM_CONFIG_KEYS,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { generateToken } from "../middlewares/auth";
import { runPasswordResetDeliveryCleanup } from "./passwordResetDeliveryRetentionScheduler";

type HttpResult = { status: number; body: Record<string, unknown> };

function httpRequest(
  server: http.Server,
  method: string,
  path: string,
  token: string,
  body: Record<string, unknown>,
): Promise<HttpResult> {
  const address = server.address() as { port: number };
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port: address.port,
        path,
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (response) => {
        let raw = "";
        response.on("data", (chunk: Buffer) => {
          raw += chunk.toString();
        });
        response.on("end", () => {
          try {
            resolve({ status: response.statusCode!, body: JSON.parse(raw) });
          } catch {
            resolve({ status: response.statusCode!, body: { _raw: raw } });
          }
        });
      },
    );
    request.on("error", reject);
    request.end(payload);
  });
}

describe("password-reset delivery retention boundaries (real DB)", () => {
  const configKey = SYSTEM_CONFIG_KEYS.PASSWORD_RESET_DELIVERY_RETENTION_DAYS;
  const marker = `retention-boundary-${process.pid}-${Date.now()}`;
  const hashes = {
    recentUpdate: `${marker}-recent-update`,
    recentEvent: `${marker}-recent-event`,
    expired: `${marker}-expired`,
    otherPurpose: `${marker}-other-purpose`,
  };
  const allHashes = Object.values(hashes);
  let originalConfig: string | null;
  let server: http.Server;
  let token: string;
  const cleanupHistoryIds: number[] = [];

  before(async () => {
    const [config] = await db
      .select({ value: systemConfigTable.value })
      .from(systemConfigTable)
      .where(eq(systemConfigTable.key, configKey))
      .limit(1);
    originalConfig = config?.value ?? null;

    await db
      .insert(systemConfigTable)
      .values({ key: configKey, value: "7" })
      .onConflictDoUpdate({
        target: systemConfigTable.key,
        set: { value: "7", updatedAt: sql`now()` },
      });

    const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1_000);
    const recent = new Date(Date.now() - 24 * 60 * 60 * 1_000);
    await db.insert(emailDeliveryLogsTable).values([
      {
        recipientHash: hashes.recentUpdate,
        recipientMasked: "r***@example.test",
        purpose: "PASSWORD_RESET",
        provider: "test",
        status: "delivered",
        createdAt: old,
        updatedAt: recent,
        lastEventAt: old,
      },
      {
        recipientHash: hashes.recentEvent,
        recipientMasked: "r***@example.test",
        purpose: "PASSWORD_RESET",
        provider: "test",
        status: "delivered",
        createdAt: old,
        updatedAt: old,
        lastEventAt: recent,
      },
      {
        recipientHash: hashes.expired,
        recipientMasked: "e***@example.test",
        purpose: "PASSWORD_RESET",
        provider: "test",
        status: "delivered",
        createdAt: old,
        updatedAt: old,
        lastEventAt: old,
      },
      {
        recipientHash: hashes.otherPurpose,
        recipientMasked: "o***@example.test",
        purpose: "LOGIN",
        provider: "test",
        status: "delivered",
        createdAt: old,
        updatedAt: old,
        lastEventAt: old,
      },
    ]);

    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const [admin] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, "admin@rasokart.com"))
      .limit(1);
    assert.ok(admin, "seeded admin is required");
    token = generateToken({ userId: admin.id, role: "admin" });
  });

  after(async () => {
    await db.delete(emailDeliveryLogsTable).where(inArray(emailDeliveryLogsTable.recipientHash, allHashes));
    if (cleanupHistoryIds.length > 0) {
      await db
        .delete(cleanupRunHistoryTable)
        .where(inArray(cleanupRunHistoryTable.id, cleanupHistoryIds));
    }
    if (originalConfig === null) {
      await db.delete(systemConfigTable).where(eq(systemConfigTable.key, configKey));
    } else {
      await db
        .insert(systemConfigTable)
        .values({ key: configKey, value: originalConfig })
        .onConflictDoUpdate({
          target: systemConfigTable.key,
          set: { value: originalConfig, updatedAt: sql`now()` },
        });
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("keeps recently active and non-password-reset records while deleting expired password resets", async () => {
    const result = await runPasswordResetDeliveryCleanup("manual");
    assert.equal(result.retentionDays, 7);
    assert.equal(result.deleted, 1);
    const [history] = await db
      .select({ id: cleanupRunHistoryTable.id })
      .from(cleanupRunHistoryTable)
      .where(eq(cleanupRunHistoryTable.type, "password_reset_delivery"))
      .orderBy(sql`${cleanupRunHistoryTable.id} DESC`)
      .limit(1);
    assert.ok(history);
    cleanupHistoryIds.push(history.id);

    const remaining = await db
      .select({ recipientHash: emailDeliveryLogsTable.recipientHash })
      .from(emailDeliveryLogsTable)
      .where(inArray(emailDeliveryLogsTable.recipientHash, allHashes));
    const remainingHashes = new Set(remaining.map((row) => row.recipientHash));

    assert.equal(remainingHashes.has(hashes.recentUpdate), true);
    assert.equal(remainingHashes.has(hashes.recentEvent), true);
    assert.equal(remainingHashes.has(hashes.otherPurpose), true);
    assert.equal(remainingHashes.has(hashes.expired), false);
  });

  it("rejects retention below seven days without changing stored configuration", async () => {
    const response = await httpRequest(
      server,
      "PUT",
      "/api/system-config/password-reset-delivery-retention",
      token,
      { retentionDays: 6 },
    );
    assert.equal(response.status, 400);
    assert.equal(response.body["error"], "retentionDays must be an integer between 7 and 365");

    const [stored] = await db
      .select({ value: systemConfigTable.value })
      .from(systemConfigTable)
      .where(eq(systemConfigTable.key, configKey))
      .limit(1);
    assert.equal(stored?.value, "7");
  });
});