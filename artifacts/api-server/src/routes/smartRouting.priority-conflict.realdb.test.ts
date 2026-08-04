/**
 * Integration test: POST /api/smart-routing/configs/:id/rules — priority collision
 * guard against the REAL database (no mocked db internals).
 *
 * This complements smartRouting.priority-conflict.test.ts (which mocks `db.select`/
 * `db.insert` to deterministically simulate the race). Here we create a real
 * routing config row, fire two genuinely concurrent HTTP POSTs for the same
 * (configId, priority) pair, and let the actual `routing_rules_enabled_priority_uniq`
 * unique partial index in Postgres decide which one wins. This proves the DB-level
 * constraint — not just the mocked simulation — actually catches the race, and that
 * the route's 23505 catch handler maps it to a 409 with a human-readable message.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { eq } from "drizzle-orm";
import {
  db,
  usersTable,
  routingConfigsTable,
  routingRulesTable,
} from "@workspace/db";
import { generateToken } from "../middlewares/auth";
import app from "../app";

function post(
  server: http.Server,
  path: string,
  body: unknown,
  token: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const addr = server.address() as { port: number };
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: addr.port,
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
          Authorization: `Bearer ${token}`,
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk: Buffer) => { raw += chunk.toString(); });
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode!, body: JSON.parse(raw) });
          } catch {
            resolve({ status: res.statusCode!, body: { _raw: raw } });
          }
        });
      },
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

describe(
  "POST /api/smart-routing/configs/:id/rules — priority collision guard (real DB)",
  () => {
    let server: http.Server;
    let token: string;
    let configId: number;

    before(async () => {
      server = http.createServer(app);
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

      const [admin] = await db.select().from(usersTable).where(eq(usersTable.email, "admin@rasokart.com")).limit(1);
      assert.ok(admin, "seeded admin@rasokart.com must exist for this test");
      token = generateToken({ userId: admin!.id, role: "admin" });

      const [config] = await db.insert(routingConfigsTable).values({
        configName: `RealDB Race Test ${Date.now()}`,
        strategy: "priority",
        isEnabled: true,
        fallbackEnabled: true,
        timeoutMs: 30000,
        minSuccessRateThreshold: "80.00",
        updatedByEmail: "admin@rasokart.com",
      }).returning();
      configId = config!.id;
    });

    after(async () => {
      if (configId) {
        await db.delete(routingRulesTable).where(eq(routingRulesTable.configId, configId));
        await db.delete(routingConfigsTable).where(eq(routingConfigsTable.id, configId));
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it(
      "two truly concurrent POSTs at the same priority against the live DB — exactly one 200, one 409",
      async () => {
        const [a, b] = await Promise.all([
          post(server, `/api/smart-routing/configs/${configId}/rules`, { providerKey: "cashfree", priority: 7 }, token),
          post(server, `/api/smart-routing/configs/${configId}/rules`, { providerKey: "payu", priority: 7 }, token),
        ]);

        const statuses = [a.status, b.status].sort((x, y) => x - y);
        assert.deepEqual(
          statuses,
          [200, 409],
          `Expected exactly one 200 and one 409 from the real DB race but got ${a.status} and ${b.status}: ${JSON.stringify([a.body, b.body])}`,
        );

        const rejected = a.status === 409 ? a : b;
        assert.equal(rejected.status, 409, "Losing request must receive HTTP 409 from the live unique index");
        assert.ok(
          typeof rejected.body["error"] === "string" && (rejected.body["error"] as string).length > 0,
          "409 body must include a human-readable error string",
        );
        assert.match(
          rejected.body["error"] as string,
          /Priority 7 is already used/,
          "409 body must cite the conflicting priority number",
        );

        // Confirm the DB itself only ever committed one enabled rule at priority 7 for this config.
        const rows = await db.select().from(routingRulesTable).where(eq(routingRulesTable.configId, configId));
        const atPriority7 = rows.filter((r) => r.priority === 7 && r.isEnabled);
        assert.equal(atPriority7.length, 1, "Exactly one enabled rule at priority 7 should exist in the DB after the race");

        // --- suggestedPriority is fresh, not stale ---
        // The 409 body must carry a suggestedPriority that is different from the
        // conflicting priority (7) that was just inserted into the DB.
        const suggested = rejected.body["suggestedPriority"];
        assert.ok(
          typeof suggested === "number",
          `409 body must include a numeric suggestedPriority, got: ${JSON.stringify(suggested)}`,
        );
        assert.notEqual(
          suggested,
          7,
          `suggestedPriority must not equal the conflicting priority 7 (getNextFreePriority returned a stale value)`,
        );

        // Use the suggested priority for a third POST — it must succeed (200),
        // proving that getNextFreePriority returned a slot that is actually free
        // after the concurrent race resolved.
        const winner = a.status === 200 ? a : b;
        const winnerProvider = (winner.body as Record<string, unknown>)["providerKey"] as string;
        // Pick a provider that wasn't used by either of the first two POSTs.
        const thirdProvider = winnerProvider === "cashfree" ? "razorpay" : "cashfree";
        const third = await post(
          server,
          `/api/smart-routing/configs/${configId}/rules`,
          { providerKey: thirdProvider, priority: suggested },
          token,
        );
        assert.equal(
          third.status,
          200,
          `Third POST using suggestedPriority=${suggested} must succeed (200) but got ${third.status}: ${JSON.stringify(third.body)}`,
        );
      },
    );
  },
);
