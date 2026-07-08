/**
 * Integration test: POST /api/smart-routing/configs/:id/rules — priority collision guard
 *
 * Covers two scenarios where a conflicting priority rule could be submitted:
 *
 * 1. TRUE CONCURRENT RACE (Promise.all)
 *    Two admin sessions both read the rules list simultaneously, both see no
 *    conflict, and both POST a rule at the same priority.  The application-level
 *    SELECT guard can't catch this — both requests race past it.  The DB-level
 *    unique constraint fires on the second INSERT, which the global error handler
 *    maps to a 409.  The test asserts: exactly one 200 and exactly one 409.
 *
 * 2. STALE BROWSER TAB (sequential)
 *    An older tab's SELECT snapshot showed no conflict, but by the time it
 *    POSTs, another tab has already saved a rule at the same priority.  The
 *    application-level SELECT guard catches this and returns a human-readable
 *    409 naming the offending provider and priority.
 */

import { describe, it, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  db,
  usersTable,
  routingConfigsTable,
  routingRulesTable,
  auditLogsTable,
} from "@workspace/db";
import { generateToken } from "../middlewares/auth";
import app from "../app";

/** Fire a POST to the in-process test server and return status + parsed body. */
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
        res.on("end", () => resolve({ status: res.statusCode!, body: JSON.parse(raw) }));
      },
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

describe(
  "POST /api/smart-routing/configs/:id/rules — priority collision guard",
  () => {
    let server: http.Server;
    let token: string;

    const ADMIN_USER = {
      id: 1,
      email: "admin@rasokart.com",
      role: "admin" as const,
      isActive: true,
      passwordUpdatedAt: null,
      isSuperAdmin: true,
    };

    const ROUTING_CONFIG = {
      id: 42,
      configName: "Default",
      strategy: "priority",
      isEnabled: true,
      fallbackEnabled: true,
      timeoutMs: 30000,
      minSuccessRateThreshold: "80.00",
      description: null,
      updatedByEmail: "admin@rasokart.com",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const INSERTED_RULE = {
      id: 100,
      configId: 42,
      providerKey: "cashfree",
      priority: 5,
      weightPercent: 100,
      minAmount: null,
      maxAmount: null,
      allowedPaymentModes: null,
      isEnabled: true,
      isFallbackOnly: false,
      maxRetries: 1,
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const originalSelect = (db as any).select.bind(db);
    const originalInsert = (db as any).insert.bind(db);

    before(async () => {
      server = http.createServer(app);
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      token = generateToken({ userId: ADMIN_USER.id, role: "admin" });
    });

    after(async () => {
      (db as any).select = originalSelect;
      (db as any).insert = originalInsert;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    afterEach(() => {
      (db as any).select = originalSelect;
      (db as any).insert = originalInsert;
    });

    it(
      "concurrent saves (Promise.all) — exactly one 200 and one 409 regardless of which wins",
      async () => {
        /**
         * Both requests race past the application-level SELECT guard because
         * neither INSERT has committed when both perform their conflict check.
         * The DB-level unique constraint (simulated below) fires on whichever
         * INSERT arrives second, and the global error handler maps the 23505
         * code to a 409 response.
         */
        let insertCount = 0;

        (db as any).select = (_fields?: unknown) => ({
          from: (table: unknown) => ({
            where: (_cond: unknown) => ({
              limit: async () => {
                if (table === usersTable) return [ADMIN_USER];
                if (table === routingConfigsTable) return [ROUTING_CONFIG];
                // Both concurrent requests see an empty rules list —
                // neither INSERT has committed yet, so neither triggers
                // the application-level guard.
                if (table === routingRulesTable) return [];
                return [];
              },
            }),
            orderBy: async () => [],
            limit: async () => {
              if (table === usersTable) return [ADMIN_USER];
              return [];
            },
          }),
        });

        (db as any).insert = (table: unknown) => ({
          values: (_vals: unknown) => ({
            returning: async () => {
              if (table === auditLogsTable) return [{}];
              if (table === routingRulesTable) {
                insertCount += 1;
                if (insertCount === 1) {
                  // First INSERT wins — simulates the row being committed.
                  return [INSERTED_RULE];
                }
                // Second INSERT loses — simulates the DB unique constraint
                // (routing_rules_enabled_priority_uniq) firing.
                const err = new Error("duplicate key value violates unique constraint");
                (err as any).code = "23505";
                (err as any).constraint = "routing_rules_enabled_priority_uniq";
                throw err;
              }
              return [{}];
            },
          }),
        });

        // Fire both requests at exactly the same time.
        const [a, b] = await Promise.all([
          post(server, "/api/smart-routing/configs/42/rules", { providerKey: "cashfree", priority: 5 }, token),
          post(server, "/api/smart-routing/configs/42/rules", { providerKey: "payu", priority: 5 }, token),
        ]);

        const statuses = [a.status, b.status].sort((x, y) => x - y);
        assert.deepEqual(
          statuses,
          [200, 409],
          `Expected exactly one 200 and one 409 but got ${a.status} and ${b.status}`,
        );

        // The 409 comes from the route-level 23505 catch handler.
        const rejected = a.status === 409 ? a : b;
        assert.equal(rejected.status, 409, "Losing request must receive HTTP 409");
        // Route-level 23505 handler returns { error: "<friendly message>" }
        assert.ok(
          typeof (rejected.body as any)["error"] === "string" &&
            (rejected.body as any)["error"].length > 0,
          "409 body must include a human-readable error string",
        );
        assert.match(
          (rejected.body as any)["error"] as string,
          /Priority 5 is already used/,
          "409 body must cite the conflicting priority number",
        );
      },
    );

    it(
      "stale-tab sequential save — 409 names the priority and owning provider",
      async () => {
        /**
         * Classic stale-tab scenario: Tab A reads rules (no conflict at priority 5),
         * Tab B also reads rules (no conflict).  Tab A saves successfully.  Tab B then
         * saves — the application-level SELECT now finds Tab A's rule and returns a
         * human-readable 409 naming the offending provider.
         */
        let ruleInserted = false;

        (db as any).select = (_fields?: unknown) => ({
          from: (table: unknown) => ({
            where: (_cond: unknown) => ({
              limit: async () => {
                if (table === usersTable) return [ADMIN_USER];
                if (table === routingConfigsTable) return [ROUTING_CONFIG];
                if (table === routingRulesTable) {
                  // After Tab A's INSERT, Tab B's conflict check sees the rule.
                  return ruleInserted ? [{ id: 99, providerKey: "cashfree" }] : [];
                }
                return [];
              },
            }),
            orderBy: async () => [],
            limit: async () => {
              if (table === usersTable) return [ADMIN_USER];
              return [];
            },
          }),
        });

        (db as any).insert = (table: unknown) => ({
          values: (_vals: unknown) => ({
            returning: async () => {
              if (table === routingRulesTable) {
                ruleInserted = true;
                return [INSERTED_RULE];
              }
              return [{}];
            },
          }),
        });

        // Tab A saves first.
        const tabA = await post(
          server,
          "/api/smart-routing/configs/42/rules",
          { providerKey: "cashfree", priority: 5 },
          token,
        );
        assert.equal(tabA.status, 200, `Tab A should succeed: ${JSON.stringify(tabA.body)}`);

        // Tab B saves with the same priority — should be rejected with a clear message.
        const tabB = await post(
          server,
          "/api/smart-routing/configs/42/rules",
          { providerKey: "payu", priority: 5 },
          token,
        );
        assert.equal(tabB.status, 409, `Stale Tab B should be rejected: ${JSON.stringify(tabB.body)}`);
        assert.match(
          tabB.body["error"] as string,
          /Priority 5 is already used/,
          "409 body must cite the conflicting priority number",
        );
        assert.match(
          tabB.body["error"] as string,
          /"cashfree"/,
          "409 body must name the provider that owns the priority",
        );
      },
    );
  },
);
