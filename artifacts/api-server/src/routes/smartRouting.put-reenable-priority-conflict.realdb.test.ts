/**
 * Integration test: PUT /api/smart-routing/rules/:id — re-enable priority
 * collision guard against the REAL database (no mocked db internals).
 *
 * This tests the second priority-collision branch in the PUT handler: when a
 * previously disabled rule is re-enabled (isEnabled false → true) without
 * changing its priority number.  Two admins enabling disabled rules that share
 * the same priority in parallel could race past the application-level SELECT
 * guard.  Only the `routing_rules_enabled_priority_uniq` unique partial index
 * in Postgres catches this race.
 *
 * We create two disabled rules at the SAME priority, fire two genuinely
 * concurrent PUTs both with { isEnabled: true }, and assert the DB-level
 * constraint ensures exactly one succeeds and one gets a 409.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { eq, and } from "drizzle-orm";
import {
  db,
  usersTable,
  routingConfigsTable,
  routingRulesTable,
} from "@workspace/db";
import { generateToken } from "../middlewares/auth";
import app from "../app";

function put(
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
        method: "PUT",
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
  "PUT /api/smart-routing/rules/:id — re-enable priority collision guard (real DB)",
  () => {
    let server: http.Server;
    let token: string;
    let configId: number;
    let ruleIdA: number;
    let ruleIdB: number;

    const SHARED_PRIORITY = 75;

    before(async () => {
      server = http.createServer(app);
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

      const [admin] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.email, "admin@rasokart.com"))
        .limit(1);
      assert.ok(admin, "seeded admin@rasokart.com must exist for this test");
      token = generateToken({ userId: admin!.id, role: "admin" });

      // Create a dedicated routing config for this test run.
      const [config] = await db
        .insert(routingConfigsTable)
        .values({
          configName: `PUT Re-enable Race Test ${Date.now()}`,
          strategy: "priority",
          isEnabled: true,
          fallbackEnabled: true,
          timeoutMs: 30000,
          minSuccessRateThreshold: "80.00",
          updatedByEmail: "admin@rasokart.com",
        })
        .returning();
      configId = config!.id;

      // Create two DISABLED rules both at the SAME priority.
      // When both are re-enabled concurrently, exactly one can win.
      const [ruleA] = await db
        .insert(routingRulesTable)
        .values({
          configId,
          providerKey: "cashfree",
          priority: SHARED_PRIORITY,
          weightPercent: 100,
          isEnabled: false,
          isFallbackOnly: false,
          maxRetries: 1,
        })
        .returning();
      ruleIdA = ruleA!.id;

      const [ruleB] = await db
        .insert(routingRulesTable)
        .values({
          configId,
          providerKey: "payu",
          priority: SHARED_PRIORITY,
          weightPercent: 100,
          isEnabled: false,
          isFallbackOnly: false,
          maxRetries: 1,
        })
        .returning();
      ruleIdB = ruleB!.id;
    });

    after(async () => {
      if (configId) {
        await db
          .delete(routingRulesTable)
          .where(eq(routingRulesTable.configId, configId));
        await db
          .delete(routingConfigsTable)
          .where(eq(routingConfigsTable.id, configId));
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it(
      "two truly concurrent re-enable PUTs at the same priority — exactly one 200, one 409",
      async () => {
        // Both rules are disabled at priority SHARED_PRIORITY.
        // Both PUTs request { isEnabled: true } without changing priority.
        //
        // The application-level SELECT guard (isEnabled false → true branch)
        // can race: both requests read isEnabled=false before either commits,
        // so neither sees a conflict at the SELECT stage.  The DB-level
        // routing_rules_enabled_priority_uniq unique partial index catches the
        // second UPDATE and the route's 23505 catch handler maps it to 409.
        const [a, b] = await Promise.all([
          put(server, `/api/smart-routing/rules/${ruleIdA}`, { isEnabled: true }, token),
          put(server, `/api/smart-routing/rules/${ruleIdB}`, { isEnabled: true }, token),
        ]);

        const statuses = [a.status, b.status].sort((x, y) => x - y);
        assert.deepEqual(
          statuses,
          [200, 409],
          `Expected exactly one 200 and one 409 from the real DB race but got ${a.status} and ${b.status}: ${JSON.stringify([a.body, b.body])}`,
        );

        const rejected = a.status === 409 ? a : b;
        assert.equal(
          rejected.status,
          409,
          "Losing PUT must receive HTTP 409 from the live unique index",
        );
        assert.ok(
          typeof rejected.body["error"] === "string" &&
            (rejected.body["error"] as string).length > 0,
          "409 body must include a human-readable error string",
        );
        assert.match(
          rejected.body["error"] as string,
          /Priority \d+ is already used/,
          "409 body must cite a priority conflict",
        );

        // Confirm the DB only ever committed one enabled rule at SHARED_PRIORITY
        // for this config — no phantom duplicate rows slipped through.
        const rows = await db
          .select()
          .from(routingRulesTable)
          .where(eq(routingRulesTable.configId, configId));
        const enabledAtPriority = rows.filter(
          (r) => r.priority === SHARED_PRIORITY && r.isEnabled,
        );
        assert.equal(
          enabledAtPriority.length,
          1,
          `Exactly one enabled rule at priority ${SHARED_PRIORITY} should exist in the DB after the race`,
        );
      },
    );
  },
);
