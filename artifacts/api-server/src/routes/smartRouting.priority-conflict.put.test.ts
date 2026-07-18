/**
 * Integration test: PUT /api/smart-routing/rules/:id — priority collision guard
 *
 * Covers two scenarios where a conflicting priority rule could reach the PUT handler:
 *
 * 1. TRUE CONCURRENT RACE (Promise.all)
 *    Two admin sessions both read the rules list simultaneously, both see no
 *    conflict at priority 5, and both PUT an update to a rule targeting that
 *    priority.  The application-level SELECT guard can't catch this — both
 *    requests race past it.  The DB-level unique constraint fires on the second
 *    UPDATE, which the PUT catch-handler maps to a 409.
 *    The test asserts: exactly one 200 and exactly one 409.
 *
 * 2. STALE BROWSER TAB (sequential)
 *    Tab A's UPDATE successfully moves rule 100 to priority 5.  Tab B still
 *    holds a stale snapshot showing that priority 5 is free and tries to PUT
 *    rule 101 to the same priority.  The application-level SELECT guard detects
 *    the conflict and returns a human-readable 409 naming the owning provider
 *    ("cashfree").
 *
 * Mock strategy
 * ─────────────
 * The PUT handler calls db.select() with different field shapes on each visit
 * to routingRulesTable, which allows the mock to return targeted responses
 * without inspecting WHERE conditions:
 *
 *   db.select()                                    → no fields  → "get existing rule"
 *   db.select({ id, providerKey })                 → app-level conflict check
 *   db.select({ configId, priority })              → catch-handler: look up rule info
 *   db.select({ providerKey })  (key only)         → catch-handler: find conflicting provider
 *
 * This approach is stable under concurrency because every routingRulesTable
 * select is fully determined by the field shape alone, with no position counter.
 */

import { describe, it, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  db,
  usersTable,
  routingRulesTable,
} from "@workspace/db";
import { generateToken } from "../middlewares/auth";
import app from "../app";

/** Fire a PUT to the in-process test server and return status + parsed body. */
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
        res.on("end", () => resolve({ status: res.statusCode!, body: JSON.parse(raw) }));
      },
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

describe(
  "PUT /api/smart-routing/rules/:id — priority collision guard",
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

    /** Rule 100 — cashfree, currently at priority 3, enabled */
    const RULE_100 = {
      id: 100,
      configId: 42,
      providerKey: "cashfree",
      priority: 3,
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

    /** Rule 101 — payu, currently at priority 7, enabled (used by sequential test) */
    const RULE_101 = {
      id: 101,
      configId: 42,
      providerKey: "payu",
      priority: 7,
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

    const RULE_100_UPDATED = { ...RULE_100, priority: 5, updatedAt: new Date() };

    const originalSelect = (db as any).select.bind(db);
    const originalUpdate = (db as any).update.bind(db);

    before(async () => {
      server = http.createServer(app);
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      token = generateToken({ userId: ADMIN_USER.id, role: "admin" });
    });

    after(async () => {
      (db as any).select = originalSelect;
      (db as any).update = originalUpdate;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    afterEach(() => {
      (db as any).select = originalSelect;
      (db as any).update = originalUpdate;
    });

    it(
      "concurrent saves (Promise.all) — exactly one 200 and one 409 regardless of which wins",
      async () => {
        /**
         * Both requests race past the application-level SELECT guard because
         * neither UPDATE has committed when both perform their conflict check.
         * The DB-level unique constraint (simulated below) fires on whichever
         * UPDATE arrives second, and the PUT catch-handler maps the 23505 to
         * a 409 response with a human-readable message.
         *
         * Mock field-shape routing:
         *   select()                 (no fields)    → "get existing rule"  → RULE_100
         *   select({ id, providerKey })             → app-level conflict   → [] (both race past)
         *   select({ configId, priority })          → catch: rule lookup   → RULE_100
         *   select({ providerKey } only)            → catch: find conflict → { providerKey: "cashfree" }
         */
        let updateCount = 0;

        (db as any).select = (fields?: unknown) => {
          const keys = fields ? Object.keys(fields as object) : [];
          return {
            from: (table: unknown) => ({
              where: (_cond: unknown) => ({
                limit: async () => {
                  if (table === usersTable) return [ADMIN_USER];
                  if (table === routingRulesTable) {
                    if (keys.length === 0) {
                      // db.select() with no args — "get existing rule" fetch
                      return [RULE_100];
                    }
                    if (keys.includes("id") && keys.includes("providerKey")) {
                      // app-level priority conflict check — both requests race past
                      return [];
                    }
                    if (keys.includes("configId") && keys.includes("priority")) {
                      // catch-handler: look up the rule's configId + priority
                      return [RULE_100];
                    }
                    if (keys.includes("providerKey") && !keys.includes("id")) {
                      // catch-handler: find the provider that owns the conflicting priority
                      return [{ providerKey: "cashfree" }];
                    }
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
          };
        };

        (db as any).update = (_table: unknown) => ({
          set: (_values: unknown) => ({
            where: (_cond: unknown) => ({
              returning: async () => {
                updateCount += 1;
                if (updateCount === 1) {
                  // First UPDATE wins — simulates the row being committed.
                  return [RULE_100_UPDATED];
                }
                // Second UPDATE loses — simulates the DB unique constraint
                // (routing_rules_enabled_priority_uniq) firing.
                const err = new Error("duplicate key value violates unique constraint");
                (err as any).code = "23505";
                (err as any).constraint = "routing_rules_enabled_priority_uniq";
                throw err;
              },
            }),
          }),
        });

        // Fire both requests at exactly the same time — rule 100 (cashfree) and
        // rule 101 (payu) both moving to priority 5 in the same config, racing
        // through the conflict check before either UPDATE commits.
        const [a, b] = await Promise.all([
          put(server, "/api/smart-routing/rules/100", { priority: 5 }, token),
          put(server, "/api/smart-routing/rules/101", { priority: 5 }, token),
        ]);

        const statuses = [a.status, b.status].sort((x, y) => x - y);
        assert.deepEqual(
          statuses,
          [200, 409],
          `Expected exactly one 200 and one 409 but got ${a.status} and ${b.status}`,
        );

        const rejected = a.status === 409 ? a : b;
        assert.equal(rejected.status, 409, "Losing request must receive HTTP 409");
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
         * Classic stale-tab scenario:
         *   Tab A reads rule 100 (priority 3), sees priority 5 is free.
         *   Tab B reads rule 101 (priority 7), also sees priority 5 is free.
         *   Tab A saves successfully — rule 100 now occupies priority 5.
         *   Tab B then saves — the application-level SELECT now finds rule 100
         *   at priority 5 and returns a human-readable 409 naming "cashfree".
         *
         * The `ruleUpdated` flag tracks Tab A's commit and drives the mock:
         *   Before Tab A commits → "get existing" returns RULE_100, conflict → []
         *   After  Tab A commits → "get existing" returns RULE_101, conflict → RULE_100
         */
        let ruleUpdated = false;

        (db as any).select = (fields?: unknown) => {
          const keys = fields ? Object.keys(fields as object) : [];
          return {
            from: (table: unknown) => ({
              where: (_cond: unknown) => ({
                limit: async () => {
                  if (table === usersTable) return [ADMIN_USER];
                  if (table === routingRulesTable) {
                    if (keys.length === 0) {
                      // "get existing rule" — return the rule for whichever tab is active
                      return ruleUpdated ? [RULE_101] : [RULE_100];
                    }
                    if (keys.includes("id") && keys.includes("providerKey")) {
                      // app-level priority conflict check
                      // After Tab A commits, rule 100 now owns priority 5 → conflict for Tab B
                      return ruleUpdated
                        ? [{ id: 100, providerKey: "cashfree" }]
                        : [];
                    }
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
          };
        };

        (db as any).update = (_table: unknown) => ({
          set: (_values: unknown) => ({
            where: (_cond: unknown) => ({
              returning: async () => {
                ruleUpdated = true;
                return [RULE_100_UPDATED];
              },
            }),
          }),
        });

        // Tab A saves first — moves rule 100 from priority 3 to priority 5.
        const tabA = await put(
          server,
          "/api/smart-routing/rules/100",
          { priority: 5 },
          token,
        );
        assert.equal(tabA.status, 200, `Tab A should succeed: ${JSON.stringify(tabA.body)}`);

        // Tab B saves with a stale view — tries to move rule 101 to priority 5,
        // but the application-level guard detects the conflict with rule 100 ("cashfree").
        const tabB = await put(
          server,
          "/api/smart-routing/rules/101",
          { priority: 5 },
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
