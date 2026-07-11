/**
 * Integration test: PUT /api/smart-routing/rules/:id — priority collision
 * guard against the REAL database (no mocked db internals).
 *
 * This complements smartRouting.priority-conflict.test.ts (which mocks db
 * internals to simulate races for POST).  Here we create two real routing-rule
 * rows at different priorities, fire two genuinely concurrent HTTP PUTs that
 * both try to move their rule to the SAME target priority, and let the actual
 * `routing_rules_enabled_priority_uniq` unique partial index in Postgres decide
 * which one wins.  This proves the DB-level constraint — not just the
 * application-level SELECT guard — catches the race for the PUT (edit) path,
 * and that the route's 23505 catch handler maps it to a 409 with a
 * human-readable message.
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
  "PUT /api/smart-routing/rules/:id — priority collision guard (real DB)",
  () => {
    let server: http.Server;
    let token: string;
    let configId: number;
    let ruleIdA: number;
    let ruleIdB: number;

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
          configName: `PUT Race Test ${Date.now()}`,
          strategy: "priority",
          isEnabled: true,
          fallbackEnabled: true,
          timeoutMs: 30000,
          minSuccessRateThreshold: "80.00",
          updatedByEmail: "admin@rasokart.com",
        })
        .returning();
      configId = config!.id;

      // Create two rules at distinct starting priorities.
      // Both will try to move to priority 50 concurrently.
      const [ruleA] = await db
        .insert(routingRulesTable)
        .values({
          configId,
          providerKey: "cashfree",
          priority: 10,
          weightPercent: 100,
          isEnabled: true,
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
          priority: 20,
          weightPercent: 100,
          isEnabled: true,
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
      "two truly concurrent PUTs moving different rules to the same priority — exactly one 200, one 409",
      async () => {
        // Both rules start at different priorities (10 and 20).
        // Both PUTs try to move their rule to priority 50 at the same time.
        // The application-level SELECT guard can race past for both requests
        // (neither sees the other's uncommitted UPDATE).  The DB-level
        // routing_rules_enabled_priority_uniq unique partial index fires on
        // whichever UPDATE arrives second, and the route's 23505 catch handler
        // must map that to a 409.
        const [a, b] = await Promise.all([
          put(server, `/api/smart-routing/rules/${ruleIdA}`, { priority: 50 }, token),
          put(server, `/api/smart-routing/rules/${ruleIdB}`, { priority: 50 }, token),
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
          /Priority 50 is already used/,
          "409 body must cite the conflicting priority number",
        );

        // Confirm the DB only ever committed one enabled rule at priority 50
        // for this config — no phantom duplicate rows.
        const rows = await db
          .select()
          .from(routingRulesTable)
          .where(eq(routingRulesTable.configId, configId));
        const atPriority50 = rows.filter((r) => r.priority === 50 && r.isEnabled);
        assert.equal(
          atPriority50.length,
          1,
          "Exactly one enabled rule at priority 50 should exist in the DB after the race",
        );
      },
    );
  },
);
